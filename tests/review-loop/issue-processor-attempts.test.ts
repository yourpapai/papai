// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'

import { createIssueLedger, type LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import {
  buildAttemptPrompt,
  runFixerRaw,
  type AttemptPromptDeps,
} from '../../review-loop/src/issue-processor-attempts.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import {
  claudeRecordingSpawn,
  claudeRunContext,
  claudeScratchResponder,
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('buildAttemptPrompt', () => {
  test('builds inspector-rejection retry prompt', () => {
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
    const deps: AttemptPromptDeps = {
      config: { checkCommand: 'bun check:full' },
      cwd: '/tmp/worktree',
      resultPath: '/tmp/result.json',
    }
    const record: LedgerIssueRecord = {
      id: 'rec-1',
      issue,
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }

    const prompt = buildAttemptPrompt(deps, record, {
      kind: 'inspector_rejection',
      inspectorReasoning: 'does not address the bug',
    })

    expect(prompt).toContain('rejected by an inspector')
    expect(prompt).toContain('does not address the bug')
  })

  test('initial fixer prompt writes to an absolute path under the worker cwd', () => {
    // Regression: see agentWritePath. The fixer prompt must embed an absolute
    // path so the agent cannot mis-resolve it against an unrelated project root.
    const deps: AttemptPromptDeps = {
      config: { checkCommand: 'bun check:full' },
      cwd: '/tmp/worktree',
      resultPath: '/tmp/result.json',
    }
    const record: LedgerIssueRecord = {
      id: 'rec-1',
      issue: {
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
      },
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }

    const prompt = buildAttemptPrompt(deps, record, null)

    expect(prompt).toContain('/tmp/worktree/.review-loop/result.json')
  })
})

describe('runFixerRaw backend threading', () => {
  test('passes the resolved backend and claude context into the fixer spawn', async () => {
    const repoRoot = makeTempDir('fixer-claude-')
    const context = claudeRunContext()
    const config = createReviewLoopConfigFixture(repoRoot, { backend: 'claude', claude: context })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    const ledger = await createIssueLedger(runState.runDir)
    const { logger } = createCapturingTraceLogger()
    const { spawn, commands } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'r',
        targetFiles: [],
        fixed: true,
      })),
    )

    const { pool, workers } = fakePool({ size: 1, worktreePaths: [runState.worktreePath] })
    const worker = workers[0]!

    const prompt = `Fix the issue. Write your result as JSON to: ${path.join(runState.worktreePath, '.review-loop', 'result.json')}`

    const result = await runFixerRaw(
      {
        config,
        runState,
        ledger,
        spawn,
        exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
        log: silentReporter(),
        trace: logger,
        pool,
      },
      worker,
      prompt,
      'fixer-w1',
    )

    expect(result.value.fixed).toBe(true)
    expect(commands[0]).toBe('claude')
  })

  test('the fixer role effort rides the spawn as --effort after --model (D4, D6)', async () => {
    const repoRoot = makeTempDir('fixer-effort-')
    const context = claudeRunContext()
    const config = createReviewLoopConfigFixture(repoRoot, {
      backend: 'claude',
      claude: context,
      fixer: { model: 'opencode/claude-sonnet-4-6', extraArgs: [], effort: 'medium' },
    })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    const ledger = await createIssueLedger(runState.runDir)
    const { logger } = createCapturingTraceLogger()
    const { spawn, args } = claudeRecordingSpawn(
      claudeScratchResponder(() => ({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'r',
        targetFiles: [],
        fixed: true,
      })),
    )
    const { pool, workers } = fakePool({ size: 1, worktreePaths: [runState.worktreePath] })
    const worker = workers[0]!

    const prompt = `Fix the issue. Write your result as JSON to: ${path.join(runState.worktreePath, '.review-loop', 'result.json')}`

    await runFixerRaw(
      {
        config,
        runState,
        ledger,
        spawn,
        exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
        log: silentReporter(),
        trace: logger,
        pool,
      },
      worker,
      prompt,
      'fixer-w1',
    )

    const argv = args[0]!
    const model = argv.indexOf('--model')
    expect(argv.slice(model + 2, model + 4)).toEqual(['--effort', 'medium'])
  })
})
