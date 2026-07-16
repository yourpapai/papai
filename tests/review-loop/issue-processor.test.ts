// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger, type LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { processPendingIssues } from '../../review-loop/src/issue-processor.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { newCollector } from '../../review-loop/src/loop-trace.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir, silentReporter } from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'Race in queue',
  severity: 'high',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'src/q.ts 1-2',
  file: 'src/q.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'lock',
  confidence: 0.9,
}

function buildRecord(): LedgerIssueRecord {
  return {
    id: 'rec-1',
    issue,
    status: 'discovered',
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

function mockSpawnForFixer(): SpawnFn {
  return (_cmd: string, args: readonly string[], opts: { cwd: string }): Promise<SpawnResult> => {
    const prompt = args[args.length - 1] ?? ''
    const outputMatch = prompt.match(/(?:to|JSON to):\s*(\S+)/u)
    const outputPath = outputMatch?.[1] ?? null
    if (prompt.includes('Verify and fix') && outputPath !== null) {
      writeFileSync(
        path.join(opts.cwd, outputPath),
        JSON.stringify({
          verdict: 'valid',
          fixability: 'auto',
          fixed: true,
          reasoning: 'ok',
          targetFiles: [],
          commitSha: 'abc',
        }),
      )
      writeFileSync(path.join(opts.cwd, 'fixed.ts'), 'ok\n')
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

const passingExec: ShellExecFn = (): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

describe('processPendingIssues', () => {
  test('fixes an issue, emits verify/build/fix trace events, and tallies a fixed decision', async () => {
    const repoRoot = makeTempDir('issue-proc-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    ledger.snapshot.issues['rec-1'] = buildRecord()
    await setupRepo(runState.worktreePath)

    const { logger, events } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      { config, runState, ledger, spawn: mockSpawnForFixer(), exec: passingExec, log: reporter, trace: logger },
      1,
      newCollector(),
      [ledger.snapshot.issues['rec-1']],
    )

    expect(fixed).toBe(1)
    expect(ledger.snapshot.issues['rec-1'].status).toBe('fixed_pending_review')
    const types = events.map((e) => e.event)
    expect(types).toContain('verify_complete')
    expect(types).toContain('build_complete')
    expect(types).toContain('fix_complete')
    const summary = types.filter((t) => t === 'fix_complete')
    expect(summary).toHaveLength(1)
  })
})
