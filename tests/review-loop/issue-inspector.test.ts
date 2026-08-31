// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import {
  runAggregatedInspector,
  runAggregatedInspectorOrTreatAsRejection,
  runInspector,
} from '../../review-loop/src/issue-inspector.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { newCollector } from '../../review-loop/src/round-collector.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  claudeRecordingSpawn,
  claudeRunContext,
  claudeScratchResponder,
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'x',
  kind: 'defect',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'src/q.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'f',
  confidence: 0.9,
}

function mockSpawnInspect(addresses: boolean): SpawnFn {
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)?.[1]
    if (prompt.includes('You are an inspector') && outputPath !== undefined) {
      writeFileSync(
        path.resolve(opts.cwd, outputPath),
        JSON.stringify({ addresses, reasoning: 'mock', confidence: 0.8 }),
      )
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

function createPromptCapturingSpawn(): { spawn: SpawnFn; getPrompt: () => string } {
  let capturedPrompt = ''
  const spawn: SpawnFn = (_cmd, args, opts) => {
    const prompt = args[args.length - 1]!
    capturedPrompt = prompt
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)![1]!
    writeFileSync(
      path.resolve(opts.cwd, outputPath),
      JSON.stringify({ addresses: true, reasoning: 'mock', confidence: 0.8 }),
    )
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
  return {
    spawn,
    getPrompt: () => capturedPrompt,
  }
}

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

describe('runInspector', () => {
  test('returns InspectorResult with addresses=true when agent accepts', async () => {
    const repoRoot = makeTempDir('inspector-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const result = await runInspector(
      {
        spawn: mockSpawnInspect(true),
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        fixerReasoning: 'mock fixer reasoning',
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
      },
      1,
      'rec-1',
      logger,
    )
    expect(result.addresses).toBe(true)
    expect(result.usage).toBeDefined()
  })

  test('inspector prompt contains the fixer reasoning', async () => {
    const repoRoot = makeTempDir('inspector-prompt-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const expectedReasoning = 'the fixer claims it added a lock around the queue flush'
    const { spawn, getPrompt } = createPromptCapturingSpawn()

    const result = await runInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        fixerReasoning: expectedReasoning,
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
      },
      1,
      'rec-1',
      logger,
    )
    expect(result.addresses).toBe(true)
    const prompt = getPrompt()
    expect(prompt).toContain('Fixer reasoning (what the fixer claims it did):')
    expect(prompt).toContain(expectedReasoning)
  })

  test('inspector prompt writes to an absolute path under the worktree cwd', async () => {
    // Regression: see agentWritePath. The prompt must embed an absolute path so
    // the agent cannot mis-resolve it against an unrelated project root.
    const repoRoot = makeTempDir('inspector-abspath-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const { spawn, getPrompt } = createPromptCapturingSpawn()

    await runInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        fixerReasoning: 'mock',
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
      },
      1,
      'rec-1',
      logger,
    )

    const prompt = getPrompt()
    const expected = path.join(runState.worktreePath, '.review-loop', 'inspect.json')
    expect(prompt).toContain(expected)
  })

  test('inspector diff includes uncommitted fixer edits (HEAD === baseline)', async () => {
    // Reproduces the empty-diff bug: the fixer is told not to commit, so at
    // inspector time HEAD still equals baselineSha. A commit-to-commit diff
    // would be empty; the diff must include the working-tree changes.
    const repoRoot = makeTempDir('inspector-diff-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    // Simulate the fixer's uncommitted edit (no add, no commit).
    writeFileSync(path.join(runState.worktreePath, 'README.md'), 'fix applied\n')
    const { logger } = createCapturingTraceLogger()
    const { spawn, getPrompt } = createPromptCapturingSpawn()

    await runInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issue,
        baselineSha,
        fixerReasoning: 'mock',
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
      },
      1,
      'rec-1',
      logger,
    )
    const prompt = getPrompt()
    expect(prompt).toContain('fix applied')
    expect(prompt).toContain('-hi')
  })

  test('inspector diff includes newly created (untracked) fixer files', async () => {
    // Reproduces the untracked-file bug: `git diff <baseline>` only shows
    // changes to tracked files, so a fixer that creates a new file would have
    // that file invisible to the inspector — guaranteeing rejection.
    const repoRoot = makeTempDir('inspector-untracked-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    // Simulate the fixer creating a brand-new file (no add, no commit).
    writeFileSync(path.join(runState.worktreePath, 'new-module.ts'), 'export const FIX = 42\n')
    const { logger } = createCapturingTraceLogger()
    const { spawn, getPrompt } = createPromptCapturingSpawn()

    await runInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issue,
        baselineSha,
        fixerReasoning: 'created new-module.ts',
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
      },
      1,
      'rec-1',
      logger,
    )
    const prompt = getPrompt()
    expect(prompt).toContain('new-module.ts')
    expect(prompt).toContain('export const FIX = 42')
  })
})

function mockAggregatedSpawn(verdicts: Record<string, boolean>): SpawnFn {
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    const ids = [...prompt.matchAll(/"id":\s*"([^"]+)"/gu)].map((m) => m[1]!)
    writeFileSync(
      path.resolve(opts.cwd, outputPath),
      JSON.stringify({
        results: ids.map((id) => ({
          id,
          addresses: verdicts[id] ?? true,
          reasoning: 'mock aggregated',
          confidence: 0.8,
        })),
      }),
    )
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

describe('runAggregatedInspector', () => {
  const members = [
    { id: 'rec-a', issue: { ...issue, file: 'src/a.ts' } },
    { id: 'rec-b', issue: { ...issue, file: 'src/b.ts' } },
  ]

  test('returns per-id verdicts and emits one inspect_complete per member', async () => {
    const repoRoot = makeTempDir('agg-inspector-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    writeFileSync(path.join(runState.worktreePath, 'README.md'), 'fix applied\n')
    const { logger, events } = createCapturingTraceLogger()
    const collector = newCollector()

    const result = await runAggregatedInspector(
      {
        spawn: mockAggregatedSpawn({ 'rec-a': true, 'rec-b': false }),
        cwd: runState.worktreePath,
        issues: members,
        baselineSha,
        outputPath: path.join(runState.runDir, 'inspect-aggregated.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-aggregated',
      },
      1,
      logger,
      collector,
    )

    expect(result.kind).toBe('inspected')
    expect(result.results).toEqual([
      { id: 'rec-a', addresses: true, reasoning: 'mock aggregated', confidence: 0.8 },
      { id: 'rec-b', addresses: false, reasoning: 'mock aggregated', confidence: 0.8 },
    ])
    const completes = events.filter((e) => e.event === 'inspect_complete')
    expect(completes.map((e) => (e as { issueId?: string }).issueId)).toEqual(['rec-a', 'rec-b'])
    expect(collector.inspector).toEqual({ runs: 2, rejected: 1 })
  })

  test('diff includes uncommitted edits across all batches', async () => {
    const repoRoot = makeTempDir('agg-inspector-diff-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    writeFileSync(path.join(runState.worktreePath, 'src-a.ts'), 'export const A = 1\n')
    writeFileSync(path.join(runState.worktreePath, 'src-b.ts'), 'export const B = 2\n')
    const { logger } = createCapturingTraceLogger()

    let capturedPrompt = ''
    const spawn: SpawnFn = (_cmd, args, opts) => {
      const prompt = args[args.length - 1]!
      capturedPrompt = prompt
      const outputPath = prompt.match(/JSON to:\s*(\S+)/u)![1]!
      writeFileSync(path.resolve(opts.cwd, outputPath), JSON.stringify({ results: [] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    }

    await runAggregatedInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issues: members,
        baselineSha,
        outputPath: path.join(runState.runDir, 'inspect-aggregated.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-aggregated',
      },
      1,
      logger,
    )

    expect(capturedPrompt).toContain('src-a.ts')
    expect(capturedPrompt).toContain('src-b.ts')
  })
})

describe('runAggregatedInspectorOrTreatAsRejection', () => {
  test('agent failure degrades to unavailable with all members rejected', async () => {
    const repoRoot = makeTempDir('agg-inspector-unavail-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const collector = newCollector()
    const failingSpawn: SpawnFn = () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'agent exploded' })

    const result = await runAggregatedInspectorOrTreatAsRejection(
      {
        config: {
          fixer: { model: 'm', extraArgs: [] },
          agentTimeoutMs: 1000,
        },
        spawn: failingSpawn,
        log: silentReporter(),
        trace: logger,
      },
      runState.worktreePath,
      [
        { id: 'rec-a', issue },
        { id: 'rec-b', issue },
      ],
      'HEAD',
      1,
      runState.runDir,
      runState.logPath,
      collector,
    )

    expect(result.kind).toBe('unavailable')
    // The per-member results carry the same reasoning string as the outcome.
    expect(result.results.every((r) => r.reasoning.includes('agent exploded'))).toBe(true)
    expect(result.results.every((r) => !r.addresses)).toBe(true)
    expect(collector.inspector.runs).toBe(2)
    expect(collector.inspector.rejected).toBe(2)
  })
})

describe('issue-inspector backend threading', () => {
  test('runInspector passes the resolved backend and claude context into the inspector spawn', async () => {
    const repoRoot = makeTempDir('inspector-claude-')
    const context = claudeRunContext()
    const config = createReviewLoopConfigFixture(repoRoot, { backend: 'claude', claude: context })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const { spawn, commands } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({ addresses: true, reasoning: 'ok', confidence: 0.9 })),
    )

    const result = await runInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        fixerReasoning: 'mock reasoning',
        outputPath: path.join(runState.runDir, 'inspect.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-w1',
        backend: 'claude',
        claude: context,
      },
      1,
      'rec-claude',
      logger,
    )

    expect(result.addresses).toBe(true)
    expect(commands[0]).toBe('claude')
  })

  test('runAggregatedInspector threads the backend through its deps plumbing', async () => {
    const repoRoot = makeTempDir('inspector-claude-agg-')
    const context = claudeRunContext()
    const config = createReviewLoopConfigFixture(repoRoot, { backend: 'claude', claude: context })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const { spawn, commands } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({
        results: [{ id: 'rec-agg', addresses: true, reasoning: 'ok', confidence: 0.9 }],
      })),
    )

    const result = await runAggregatedInspector(
      {
        spawn,
        cwd: runState.worktreePath,
        issues: [{ id: 'rec-agg', issue }],
        baselineSha: 'HEAD',
        outputPath: path.join(runState.runDir, 'inspect-aggregated.json'),
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
        label: 'inspector-aggregated',
        backend: 'claude',
        claude: context,
      },
      1,
      logger,
    )

    expect(result.results[0]?.addresses).toBe(true)
    expect(commands[0]).toBe('claude')
  })
})
