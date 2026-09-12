// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

//
// Regression test for the parallel-save race in `processPendingIssues`.
//
// `dispatchNext` runs as K coroutines. Each one mutates the shared in-memory
// ledger and then persists via `saveLedger`. Without serialization, those
// saves overlap and the last `writeFile` to complete wins, which can persist
// a stale stringify (one that predates another coroutine's mutation). On
// crash-resume, already-completed issues can be re-dispatched.
//
// This suite injects a slow saveLedger via `IssueProcessorDeps.saveLedger`
// and asserts that at most one save is in flight at any moment.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger, type IssueLedger, type LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { processPendingIssues } from '../../review-loop/src/issue-processor.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { newCollector } from '../../review-loop/src/round-collector.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

const passingExec: ShellExecFn = () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

const baseIssue: ReviewerIssue = {
  title: 'Race in queue',
  kind: 'defect',
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

function createFixerOnlySpawn(): SpawnFn {
  let calls = 0
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    calls += 1
    writeFileSync(
      path.resolve(opts.cwd, outputPath),
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        fixed: true,
        reasoning: 'mock fixer reasoning',
        targetFiles: [],
        commitSha: 'abc',
        commitMessage: 'fix: mock',
        severity: 'low',
      }),
    )
    writeFileSync(path.join(opts.cwd, `fixed-${calls}.ts`), 'ok\n')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

describe('processPendingIssues ledger save serialization', () => {
  test('parallel workers never overlap saveLedger writes', async () => {
    const repoRoot = makeTempDir('issue-proc-save-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)

    const workerRepo1 = makeTempDir('worker-')
    const workerRepo2 = makeTempDir('worker-')
    await setupRepo(workerRepo1)
    await setupRepo(workerRepo2)

    const recordA: LedgerIssueRecord = {
      id: 'rec-a',
      issue: { ...baseIssue, title: 'A', file: 'src/a.ts' },
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    const recordB: LedgerIssueRecord = {
      id: 'rec-b',
      issue: { ...baseIssue, title: 'B', file: 'src/b.ts' },
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    ledger.snapshot.issues['rec-a'] = recordA
    ledger.snapshot.issues['rec-b'] = recordB

    // Concurrency probe: counts in-flight saves; tracks the high-water mark.
    const stats = { active: 0, max: 0, calls: 0 }
    const slowSave = async (l: IssueLedger): Promise<void> => {
      stats.calls += 1
      stats.active += 1
      stats.max = Math.max(stats.max, stats.active)
      try {
        // Long enough to widenens the race window. Without serialization, two
        // parallel workers reaching this point overlap (active=2). With the
        // saveChain, the second save blocks until the first completes.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100)
        })
        await writeFile(l.path, JSON.stringify(l.snapshot, null, 2))
      } finally {
        stats.active -= 1
      }
    }

    const { pool } = fakePool({ size: 2, worktreePaths: [workerRepo1, workerRepo2] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      {
        config: createReviewLoopConfigFixture(runState.repoRoot),
        runState,
        ledger,
        spawn: createFixerOnlySpawn(),
        exec: passingExec,
        log: reporter,
        trace: logger,
        pool,
        inspect: false,
        saveLedger: slowSave,
      },
      1,
      collector,
      [recordA, recordB],
    )

    expect(fixed).toBe(2)
    expect(stats.calls).toBe(2)
    expect(stats.max).toBe(1)
  })

  test('transient saveLedger rejection does not abort the round', async () => {
    const repoRoot = makeTempDir('issue-proc-save-fail-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)

    const workerRepo1 = makeTempDir('worker-')
    const workerRepo2 = makeTempDir('worker-')
    await setupRepo(workerRepo1)
    await setupRepo(workerRepo2)

    const recordA: LedgerIssueRecord = {
      id: 'rec-a',
      issue: { ...baseIssue, title: 'A', file: 'src/a.ts' },
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    const recordB: LedgerIssueRecord = {
      id: 'rec-b',
      issue: { ...baseIssue, title: 'B', file: 'src/b.ts' },
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    ledger.snapshot.issues['rec-a'] = recordA
    ledger.snapshot.issues['rec-b'] = recordB

    let calls = 0
    const saves: Array<(l: IssueLedger) => Promise<void>> = [
      () => Promise.reject(new Error('transient disk error')),
      async (l) => {
        await writeFile(l.path, JSON.stringify(l.snapshot, null, 2))
      },
    ]
    const flakySave = async (l: IssueLedger): Promise<void> => {
      calls += 1
      const fn = saves.shift()!
      await fn(l)
    }

    const { pool } = fakePool({ size: 2, worktreePaths: [workerRepo1, workerRepo2] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      {
        config: createReviewLoopConfigFixture(runState.repoRoot),
        runState,
        ledger,
        spawn: createFixerOnlySpawn(),
        exec: passingExec,
        log: reporter,
        trace: logger,
        pool,
        inspect: false,
        saveLedger: flakySave,
      },
      1,
      collector,
      [recordA, recordB],
    )

    expect(fixed).toBe(2)
    expect(calls).toBe(2)
  })
})
