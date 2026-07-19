// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runBuildCheck } from '../../review-loop/src/build-checker.js'
import { finalizeRun, parseCliArgs, resolvePlanPath, runCli, type FinalizeDeps } from '../../review-loop/src/cli.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import { createIssueLedger, saveIssueLedger, type IssueLedger } from '../../review-loop/src/issue-ledger.js'
import { createRunState, PersistedRunStateSchema, type RunState } from '../../review-loop/src/run-state.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

describe('parseCliArgs', () => {
  test('defaults configPath to review-loop/config.json', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.configPath.endsWith('review-loop/config.json')).toBe(true)
    expect(args.repoRoot).toBeUndefined()
  })

  test('parses --config and --plan', () => {
    const args = parseCliArgs(['--config', '/path/to/config.json', '--plan', '/path/to/plan.md'])
    expect(args.configPath).toBe('/path/to/config.json')
    expect(args.planPath).toBe('/path/to/plan.md')
  })

  test('parses --resume-run', () => {
    const args = parseCliArgs([
      '--config',
      '/path/to/config.json',
      '--plan',
      '/path/to/plan.md',
      '--resume-run',
      '2026-07-15T10-30-00-000Z',
    ])
    expect(args.resumeRunId).toBe('2026-07-15T10-30-00-000Z')
  })

  test('resetWorktree defaults to false', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.resetWorktree).toBe(false)
  })

  test('parses --reset-worktree as a boolean flag', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md', '--reset-worktree'])
    expect(args.resetWorktree).toBe(true)
  })

  test('throws on missing --plan', () => {
    expect(() => parseCliArgs(['--config', '/path/to/config.json'])).toThrow('Missing required --plan')
  })

  test('parses --pool-size as a positive integer', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md', '--pool-size', '5'])
    expect(args.poolSize).toBe(5)
  })

  test('throws when --pool-size is not a positive integer', () => {
    expect(() => parseCliArgs(['--plan', '/path/to/plan.md', '--pool-size', '0'])).toThrow(
      '--pool-size must be a positive integer',
    )
    expect(() => parseCliArgs(['--plan', '/path/to/plan.md', '--pool-size', 'abc'])).toThrow(
      '--pool-size must be a positive integer',
    )
  })

  test('parses --no-inspect as a boolean flag', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md', '--no-inspect'])
    expect(args.noInspect).toBe(true)
  })

  test('noInspect defaults to false', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.noInspect).toBe(false)
  })
})

async function setupFinalizeFixtures(): Promise<{ config: ReviewLoopConfig; runState: RunState }> {
  const repoRoot = makeTempDir('cli-')
  const config = createReviewLoopConfigFixture(repoRoot)
  const planPath = path.join(repoRoot, 'plan.md')
  writeFileSync(planPath, '# Plan')
  const runState = await createRunState(config, planPath)
  return { config, runState }
}

describe('resolvePlanPath', () => {
  test('resolves a repo-root-relative plan path against the repo root', async () => {
    const repoRoot = makeTempDir('plan-rel-')
    writeFileSync(path.join(repoRoot, 'plan.md'), '# Plan')

    const resolved = await resolvePlanPath('./plan.md', repoRoot)

    expect(resolved).toBe(path.join(repoRoot, 'plan.md'))
  })

  test('passes through an existing absolute plan path', async () => {
    const repoRoot = makeTempDir('plan-abs-repo-')
    const dir = makeTempDir('plan-abs-')
    const absolute = path.join(dir, 'plan.md')
    writeFileSync(absolute, '# Plan')

    await expect(resolvePlanPath(absolute, repoRoot)).resolves.toBe(absolute)
  })

  test('throws a clear error naming the resolved path when the plan is missing', async () => {
    const repoRoot = makeTempDir('plan-missing-')
    const expected = path.resolve(repoRoot, 'docs/plans/nope.md')

    await expect(resolvePlanPath('./docs/plans/nope.md', repoRoot)).rejects.toThrow(expected)
  })
})

describe('finalizeRun', () => {
  test('aborts merge and preserves worktree when final build fails', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: (_cwd?: string) => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'TypeError: broken' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    const promise = finalizeRun(config, runState, deps)
    await expect(promise).rejects.toThrow(/Final build check failed[\s\S]*TypeError: broken/u)
    expect(readFileSync(path.join(runState.runDir, 'build-check.log'), 'utf8')).toContain('TypeError: broken')
    expect(merged).toBe(0)
    expect(removed).toBe(0)
  })

  test('truncates long build output in the error but keeps the full log', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    const firstLine = 'LINE-ZERO-SHOULD-BE-TRUNCATED-FROM-TAIL'
    const stdout = [firstLine, ...Array.from({ length: 60 }, (_, i) => `output-line-${i + 1}`)].join('\n')
    const deps: FinalizeDeps = {
      exec: (_cwd?: string) => Promise.resolve({ exitCode: 1, stdout, stderr: '' }),
      runBuildCheck,
      mergeWorktree: () => Promise.resolve(),
      removeWorktree: () => Promise.resolve(),
    }

    let message = ''
    await finalizeRun(config, runState, deps).catch((error: unknown) => {
      message = errorMessage(error)
    })

    expect(message).toContain('Final build check failed')
    expect(message).toContain('output-line-60')
    expect(message).toContain('truncated')
    expect(message).not.toContain(firstLine)

    const log = readFileSync(path.join(runState.runDir, 'build-check.log'), 'utf8')
    expect(log).toContain(firstLine)
    expect(log).toContain('output-line-60')
  })

  test('merges and removes worktree when final build passes', async () => {
    const { config, runState } = await setupFinalizeFixtures()
    let merged = 0
    let removed = 0
    const deps: FinalizeDeps = {
      exec: (_cwd?: string) => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      runBuildCheck,
      mergeWorktree: () => {
        merged += 1
        return Promise.resolve()
      },
      removeWorktree: () => {
        removed += 1
        return Promise.resolve()
      },
    }

    await finalizeRun(config, runState, deps)

    expect(merged).toBe(1)
    expect(removed).toBe(1)
  })
})

function createFakeOpencodeScript(scenarioPath: string): string {
  return `#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const prompt = args[args.length - 1] ?? ''

function extractOutputPath(text) {
  const match = text.match(/(?:to|JSON to):\\s*(\\S+)/)
  return match?.[1] ?? null
}

const scenario = JSON.parse(readFileSync(${JSON.stringify(scenarioPath)}, 'utf8'))
const outputPath = extractOutputPath(prompt)

if (prompt.includes('Review the current implementation')) {
  const issues = scenario.reviewerIssues[scenario._reviewerCall ?? 0] ?? '{"issues":[]}'
  scenario._reviewerCall = (scenario._reviewerCall ?? 0) + 1
  writeFileSync(${JSON.stringify(scenarioPath)}, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, issues)
} else if (prompt.includes('You are an inspector')) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify({ addresses: true, reasoning: 'mock', confidence: 0.9 }))
} else if (prompt.includes('Verify and fix') || prompt.includes('build error')) {
  if (scenario.fixerExitsNonZero === true) {
    console.error('simulated fixer failure')
    process.exit(1)
  }
  const result = scenario.fixerResults[scenario._fixerCall ?? 0] ?? '{}'
  scenario._fixerCall = (scenario._fixerCall ?? 0) + 1
  writeFileSync(${JSON.stringify(scenarioPath)}, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, result)
  if (scenario.fixerCreatesFile) {
    const targetDir = path.dirname(scenario.fixerCreatesFile)
    if (targetDir !== '.') {
      try { mkdirSync(targetDir, { recursive: true }) } catch {}
    }
    writeFileSync(scenario.fixerCreatesFile, 'fixed\\n')
  }
} else if (prompt.includes('Match newly found')) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify({ matches: scenario.matches ?? [] }))
}
process.exit(0)
`
}

interface RunCliFixture {
  dir: string
  configPath: string
  planPath: string
  repoPath: string
  workDir: string
  runCliWithPath: (args: string[]) => Promise<void>
  getRunDir: () => string
}

async function setupRunCliFixtures(opts: { poolSize?: number; inspector?: boolean } = {}): Promise<RunCliFixture> {
  const dir = makeTempDir('cli-integration-')
  const binDir = path.join(dir, 'bin')
  const scenarioPath = path.join(dir, 'scenario.json')
  const configPath = path.join(dir, 'config.json')
  const planPath = path.join(dir, 'plan.md')
  const repoPath = path.join(dir, 'repo')
  const workDir = path.join(dir, '.review-loop')

  writeFileSync(planPath, '# Implementation plan\n')

  const config: Record<string, unknown> = {
    repoRoot: repoPath,
    workDir,
    maxRounds: 5,
    maxNoProgressRounds: 2,
    checkCommand: 'true',
    poolSize: opts.poolSize ?? 3,
    reviewer: { model: 'test-reviewer', extraArgs: [] },
    fixer: { model: 'test-fixer', extraArgs: [] },
    matcher: { model: 'test-matcher', extraArgs: [] },
  }
  if (opts.inspector === true) {
    config['inspector'] = { model: 'test-inspector', extraArgs: [] }
  }
  writeFileSync(configPath, JSON.stringify(config))

  const { execFileSync } = await import('node:child_process')
  execFileSync('git', ['init', repoPath])
  execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@test.com'])
  execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', repoPath, 'checkout', '-b', 'main'])
  writeFileSync(path.join(repoPath, '.gitignore'), '.review-loop/\n')
  writeFileSync(path.join(repoPath, 'README.md'), 'hello')
  execFileSync('git', ['-C', repoPath, 'add', '.'])
  execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'])

  mkdirSync(binDir, { recursive: true })
  const scriptPath = path.join(binDir, 'opencode')
  writeFileSync(scriptPath, createFakeOpencodeScript(scenarioPath))
  chmodSync(scriptPath, 0o755)

  const runCliWithPath = async (args: string[]): Promise<void> => {
    const oldPath = process.env['PATH']
    process.env['PATH'] = `${binDir}:${oldPath}`
    process.env['FAKE_OPENCODE_SCENARIO'] = scenarioPath
    try {
      await runCli(args)
    } finally {
      process.env['PATH'] = oldPath
      delete process.env['FAKE_OPENCODE_SCENARIO']
    }
  }

  const getRunDir = (): string => {
    const runRoot = path.join(workDir, 'runs')
    const entries = readdirSync(runRoot)
    expect(entries.length).toBe(1)
    return path.join(runRoot, entries[0]!)
  }

  return { dir, configPath, planPath, repoPath, workDir, runCliWithPath, getRunDir }
}

async function createResumableRunState(
  repoPath: string,
  workDir: string,
  planPath: string,
  runId: string,
): Promise<{ runDir: string; ledger: IssueLedger }> {
  const runDir = path.join(workDir, 'runs', runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    path.join(runDir, 'state.json'),
    JSON.stringify({
      runId,
      repoRoot: repoPath,
      planPath,
      currentRound: 0,
      noProgressRounds: 0,
    }),
  )
  const ledger = await createIssueLedger(runDir)
  await saveIssueLedger(ledger)
  return { runDir, ledger }
}

describe('runCli', () => {
  test('--pool-size overrides config.poolSize', async () => {
    const fixture = await setupRunCliFixtures({ poolSize: 3 })
    const scenario = {
      reviewerIssues: [JSON.stringify({ issues: [] })],
      fixerResults: [],
    }
    writeFileSync(path.join(path.dirname(fixture.configPath), 'scenario.json'), JSON.stringify(scenario))

    await fixture.runCliWithPath(['--config', fixture.configPath, '--plan', fixture.planPath, '--pool-size', '5'])

    const summary = readFileSync(path.join(fixture.getRunDir(), 'summary.txt'), 'utf8')
    expect(summary).toContain('Pool size: 5')
  })

  test('--no-inspect skips inspector calls', async () => {
    const fixture = await setupRunCliFixtures({ poolSize: 1, inspector: true })
    const scenario = {
      reviewerIssues: [
        JSON.stringify({
          issues: [
            {
              title: 'Race condition',
              severity: 'high',
              summary: 'Concurrent messages bypass lock.',
              whyItMatters: 'Stale replies.',
              evidence: 'queue.ts:84',
              file: 'src/queue.ts',
              lineStart: 84,
              lineEnd: 107,
              suggestedFix: 'Lock earlier.',
              confidence: 0.9,
            },
          ],
        }),
        JSON.stringify({ issues: [] }),
      ],
      matches: [],
      fixerResults: [
        JSON.stringify({
          verdict: 'valid',
          fixability: 'auto',
          reasoning: 'Unsafe.',
          targetFiles: ['src/queue.ts'],
          fixed: true,
          commitSha: 'abc123',
          commitMessage: 'fix: race',
        }),
      ],
      fixerCreatesFile: 'src/queue.ts',
    }
    writeFileSync(path.join(path.dirname(fixture.configPath), 'scenario.json'), JSON.stringify(scenario))

    await fixture.runCliWithPath([
      '--config',
      fixture.configPath,
      '--plan',
      fixture.planPath,
      '--no-inspect',
      '--pool-size',
      '1',
    ])

    const runDir = fixture.getRunDir()
    expect(existsSync(path.join(runDir, 'inspect.json'))).toBe(false)
    const summary = readFileSync(path.join(runDir, 'summary.txt'), 'utf8')
    expect(summary).not.toContain('Inspector:')
  })

  test('stale worker worktrees from a prior run are cleaned at startup', async () => {
    const fixture = await setupRunCliFixtures({ poolSize: 1 })
    const runId = '2026-07-15T10-30-00-000Z-stale'
    const primaryWorktreePath = path.join(fixture.workDir, 'worktrees', runId)
    const staleWorkerPath = path.join(fixture.workDir, 'worktrees', `${runId}-worker-1`)

    await createResumableRunState(fixture.repoPath, fixture.workDir, fixture.planPath, runId)
    await execGit(fixture.repoPath, ['worktree', 'add', primaryWorktreePath, '-b', `review-loop/${runId}`])
    await execGit(fixture.repoPath, ['worktree', 'add', staleWorkerPath, '-b', `review-loop/${runId}-worker-1`])

    const scenario = {
      reviewerIssues: [JSON.stringify({ issues: [] })],
      fixerResults: [],
    }
    writeFileSync(path.join(path.dirname(fixture.configPath), 'scenario.json'), JSON.stringify(scenario))

    await fixture.runCliWithPath(['--config', fixture.configPath, '--plan', fixture.planPath, '--resume-run', runId])

    expect(existsSync(staleWorkerPath)).toBe(false)
  })

  test('on fixer timeout (non-zero exit), worker worktrees are preserved for inspection', async () => {
    const fixture = await setupRunCliFixtures({ poolSize: 2 })
    // Reviewer reports one issue; fixer exits non-zero (simulating timeout/error).
    const scenario = {
      reviewerIssues: [
        JSON.stringify({
          issues: [
            {
              title: 'Bug',
              severity: 'high',
              summary: 's',
              whyItMatters: 'w',
              evidence: 'queue.ts:1',
              file: 'src/queue.ts',
              lineStart: 1,
              lineEnd: 2,
              suggestedFix: 'fix',
              confidence: 0.9,
            },
          ],
        }),
      ],
      matches: [],
      // No fixer result; fixer spawn exits non-zero (simulates timeout / crash).
      fixerResults: [],
      fixerExitsNonZero: true,
    }
    writeFileSync(path.join(path.dirname(fixture.configPath), 'scenario.json'), JSON.stringify(scenario))

    await expect(
      fixture.runCliWithPath(['--config', fixture.configPath, '--plan', fixture.planPath, '--pool-size', '2']),
    ).rejects.toThrow()

    // The worker worktree directories should still exist (not cleaned up).
    const runDir = fixture.getRunDir()
    const state = PersistedRunStateSchema.parse(JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8')))
    const worker1Path = path.join(fixture.workDir, 'worktrees', `${state.runId}-worker-1`)
    const worker2Path = path.join(fixture.workDir, 'worktrees', `${state.runId}-worker-2`)
    expect(existsSync(worker1Path)).toBe(true)
    expect(existsSync(worker2Path)).toBe(true)
  })
})
