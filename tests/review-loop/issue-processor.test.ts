// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger, type IssueLedger, type LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import { processPendingIssues, sanitizeSubject } from '../../review-loop/src/issue-processor.js'
import type { ReviewerIssue, Verdict } from '../../review-loop/src/issue-schema.js'
import { newCollector, type RoundCollector } from '../../review-loop/src/loop-trace.js'
import type { ProgressReporter } from '../../review-loop/src/progress-log.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger, type TraceEvent } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  mockSpawnForFixerAndInspector,
  silentReporter,
} from './test-helpers.js'

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

const passingExec: ShellExecFn = (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
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

interface ScenarioResult {
  fixed: number
  ledger: IssueLedger
  events: TraceEvent[]
  collector: RoundCollector
}

async function runScenario(spawn: SpawnFn, exec: ShellExecFn = passingExec, inspect = true): Promise<ScenarioResult> {
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
  const collector = newCollector()
  const { pool } = fakePool({ size: 1, worktreePath: runState.worktreePath })
  const fixed = await processPendingIssues(
    { config, runState, ledger, spawn, exec, log: reporter, trace: logger, pool, inspect },
    1,
    collector,
    [ledger.snapshot.issues['rec-1']],
  )
  return { fixed, ledger, events, collector }
}

function eventTypes(events: readonly TraceEvent[]): string[] {
  return events.map((e) => e.event)
}

function recordOf(ledger: IssueLedger): LedgerIssueRecord {
  const record = ledger.snapshot.issues['rec-1']
  if (record === undefined) {
    throw new Error('Missing test record')
  }
  return record
}

function createFailingThenPassingExec(): ShellExecFn {
  let calls = 0
  return (_cwd?: string) => {
    calls += 1
    if (calls === 1) return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'build failed' })
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

function createAlwaysFailingExec(): ShellExecFn {
  return (_cwd?: string) => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'build failed' })
}

function writeFixerResult(opts: { cwd: string; outputPath: string; verdict: Verdict; fixed: boolean }): void {
  writeFileSync(
    path.join(opts.cwd, opts.outputPath),
    JSON.stringify({
      verdict: opts.verdict,
      fixability: 'auto',
      fixed: opts.fixed,
      reasoning: 'mock fixer reasoning',
      targetFiles: [],
      commitSha: 'abc',
      commitMessage: 'fix: mock',
      severity: 'low',
    }),
  )
  if (opts.fixed) writeFileSync(path.join(opts.cwd, 'fixed.ts'), 'ok\n')
}

function createSequentialInspectorSpawn(addressesByCall: readonly boolean[]): SpawnFn {
  let inspectorCall = 0
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

    if (prompt.includes('You are an inspector')) {
      const addresses = addressesByCall[inspectorCall] ?? true
      inspectorCall += 1
      writeFileSync(
        path.join(opts.cwd, outputPath),
        JSON.stringify({ addresses, reasoning: 'mock inspector reasoning', confidence: 0.8 }),
      )
    } else {
      writeFixerResult({ cwd: opts.cwd, outputPath, verdict: 'valid', fixed: true })
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

function createFixerValidThenInvalidSpawn(): SpawnFn {
  let fixerCall = 0
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

    if (prompt.includes('You are an inspector')) {
      writeFileSync(
        path.join(opts.cwd, outputPath),
        JSON.stringify({ addresses: false, reasoning: 'wrong fix', confidence: 0.8 }),
      )
    } else {
      fixerCall += 1
      const verdict: Verdict = fixerCall === 1 ? 'valid' : 'invalid'
      const fixed = verdict === 'valid'
      writeFixerResult({ cwd: opts.cwd, outputPath, verdict, fixed })
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

function createInspectorMalformedThenValidSpawn(): SpawnFn {
  let inspectorRunAttempts = 0
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

    if (prompt.includes('You are an inspector')) {
      inspectorRunAttempts += 1
      if (inspectorRunAttempts <= 2) {
        writeFileSync(path.join(opts.cwd, outputPath), 'not-json')
      } else {
        writeFileSync(
          path.join(opts.cwd, outputPath),
          JSON.stringify({ addresses: true, reasoning: 'mock', confidence: 0.8 }),
        )
      }
    } else {
      writeFixerResult({ cwd: opts.cwd, outputPath, verdict: 'valid', fixed: true })
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

function createAlwaysFailingInspectorSpawn(): SpawnFn {
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

    if (prompt.includes('You are an inspector')) {
      writeFileSync(path.join(opts.cwd, outputPath), 'not-json')
    } else {
      writeFixerResult({ cwd: opts.cwd, outputPath, verdict: 'valid', fixed: true })
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
}

describe('processPendingIssues', () => {
  test('fixes an issue, emits verify/build/inspect/fix trace events, and tallies a fixed decision', async () => {
    const { fixed, ledger, events, collector } = await runScenario(mockSpawnForFixerAndInspector({}))

    expect(fixed).toBe(1)
    expect(recordOf(ledger).status).toBe('fixed_pending_review')
    const types = eventTypes(events)
    expect(types).toContain('verify_complete')
    expect(types).toContain('build_complete')
    expect(types).toContain('inspect_complete')
    expect(types).toContain('fix_complete')
    expect(types.filter((t) => t === 'fix_complete')).toHaveLength(1)
    expect(collector.inspector.runs).toBe(1)
    expect(collector.inspector.rejected).toBe(0)
  })
})

describe('processIssue unified retry budget', () => {
  test('fixer verdict invalid → terminal rejected, no inspector call', async () => {
    const inspectorCount = { current: 0 }
    const { fixed, ledger, events, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ fixerVerdict: 'invalid', fixerFixed: false, inspectorCallCount: inspectorCount }),
    )
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('rejected')
    expect(inspectorCount.current).toBe(0)
    expect(eventTypes(events)).not.toContain('inspect_complete')
    expect(collector.decisions.invalid).toBe(1)
  })

  test('fixer verdict already_fixed → terminal already_fixed', async () => {
    const { fixed, ledger, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ fixerVerdict: 'already_fixed', fixerFixed: false }),
    )
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('already_fixed')
    expect(collector.decisions.already_fixed).toBe(1)
  })

  test('fixer verdict needs_human → terminal needs_human', async () => {
    const { fixed, ledger, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ fixerVerdict: 'needs_human', fixerFixed: false }),
    )
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('needs_human')
    expect(collector.decisions.needs_human).toBe(1)
  })

  test('fixer verdict plan_drift → terminal needs_human', async () => {
    const { fixed, ledger, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ fixerVerdict: 'plan_drift', fixerFixed: false }),
    )
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('needs_human')
    expect(collector.decisions.plan_drift).toBe(1)
  })

  test('fixer valid + build pass + inspector accepts → fixed', async () => {
    const { fixed, ledger, collector } = await runScenario(mockSpawnForFixerAndInspector({ inspectorAddresses: true }))
    expect(fixed).toBe(1)
    expect(recordOf(ledger).status).toBe('fixed_pending_review')
    expect(collector.decisions.fixed).toBe(1)
    expect(collector.inspector.runs).toBe(1)
    expect(collector.inspector.rejected).toBe(0)
  })

  test('fixer valid + build pass + inspector rejects → retry, second attempt accepts → fixed', async () => {
    const { fixed, ledger, events, collector } = await runScenario(createSequentialInspectorSpawn([false, true]))
    expect(fixed).toBe(1)
    expect(recordOf(ledger).status).toBe('fixed_pending_review')
    expect(collector.inspector.runs).toBe(2)
    expect(collector.inspector.rejected).toBe(1)
    expect(eventTypes(events).filter((t) => t === 'fix_complete')).toHaveLength(1)
  })

  test('fixer retry + inspector rejects again → terminal needs_human', async () => {
    const { fixed, ledger, collector } = await runScenario(createSequentialInspectorSpawn([false, false]))
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('needs_human')
    expect(collector.decisions.inspector_rejected).toBe(1)
  })

  test('fixer retry returns verdict invalid (agrees with inspector) → terminal rejected', async () => {
    const { fixed, ledger, collector } = await runScenario(createFixerValidThenInvalidSpawn())
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('rejected')
    expect(collector.decisions.invalid).toBe(1)
  })

  test('fixer valid + build fails (attempt 1) → retry, second build passes + inspector accepts → fixed', async () => {
    const { fixed, ledger, events, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ inspectorAddresses: true }),
      createFailingThenPassingExec(),
    )
    expect(fixed).toBe(1)
    expect(recordOf(ledger).status).toBe('fixed_pending_review')
    expect(collector.inspector.runs).toBe(1)
    expect(eventTypes(events).filter((t) => t === 'build_complete')).toHaveLength(2)
  })

  test('fixer retry + build fails → terminal needs_human (no inspector call)', async () => {
    const inspectorCount = { current: 0 }
    const { fixed, ledger, events, collector } = await runScenario(
      mockSpawnForFixerAndInspector({ inspectorCallCount: inspectorCount }),
      createAlwaysFailingExec(),
    )
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('needs_human')
    expect(inspectorCount.current).toBe(0)
    expect(eventTypes(events)).not.toContain('inspect_complete')
    expect(collector.decisions.needs_human).toBe(1)
  })

  test('inspector times out / malformed → treated as rejection, consumes retry budget, then accepts → fixed', async () => {
    const { fixed, ledger, collector } = await runScenario(createInspectorMalformedThenValidSpawn())
    expect(fixed).toBe(1)
    expect(recordOf(ledger).status).toBe('fixed_pending_review')
    expect(collector.inspector.runs).toBe(2)
    expect(collector.inspector.rejected).toBe(1)
  })

  test('inspector failure reports "inspector unavailable" and bumps tallies on every invocation', async () => {
    const { fixed, ledger, events, collector } = await runScenario(createAlwaysFailingInspectorSpawn())
    expect(fixed).toBe(0)
    expect(recordOf(ledger).status).toBe('needs_human')
    const inspectEvents = events.filter((e) => e.event === 'inspect_complete')
    expect(inspectEvents).toHaveLength(2)
    for (const e of inspectEvents) {
      expect(e.reasoning).toBe('inspector unavailable')
    }
    expect(collector.inspector.runs).toBe(2)
    expect(collector.inspector.rejected).toBe(2)
  })
})

function createFixerOnlySpawn(opts: { fixed?: boolean; writeFile?: boolean } = {}): {
  spawn: SpawnFn
  calls: { current: number }
} {
  const calls = { current: 0 }
  const spawn: SpawnFn = (_cmd, args, spawnOpts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    calls.current += 1
    writeFileSync(
      path.join(spawnOpts.cwd, outputPath),
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        fixed: opts.fixed ?? true,
        reasoning: 'mock fixer reasoning',
        targetFiles: [],
        commitSha: 'abc',
        commitMessage: 'fix: mock',
        severity: 'low',
      }),
    )
    if (opts.writeFile !== false) {
      writeFileSync(path.join(spawnOpts.cwd, `fixed-${calls.current}.ts`), 'ok\n')
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  return { spawn, calls }
}

describe('processPendingIssues pool dispatch', () => {
  async function setupTwoIssues(): Promise<{
    runState: Awaited<ReturnType<typeof createRunState>>
    ledger: IssueLedger
    recordA: LedgerIssueRecord
    recordB: LedgerIssueRecord
  }> {
    const repoRoot = makeTempDir('issue-proc-pool-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)
    const issueA: ReviewerIssue = { ...issue, title: 'Race in queue A', file: 'src/a.ts' }
    const issueB: ReviewerIssue = { ...issue, title: 'Race in queue B', file: 'src/b.ts' }
    ledger.snapshot.issues['rec-a'] = {
      id: 'rec-a',
      issue: issueA,
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    ledger.snapshot.issues['rec-b'] = {
      id: 'rec-b',
      issue: issueB,
      status: 'discovered',
      firstSeenRound: 1,
      latestSeenRound: 1,
      fixAttempts: 0,
      verifierDecision: null,
    }
    return { runState, ledger, recordA: ledger.snapshot.issues['rec-a'], recordB: ledger.snapshot.issues['rec-b'] }
  }

  test('K=2 pool processes 2 independent-file issues in parallel', async () => {
    const { runState, ledger, recordA, recordB } = await setupTwoIssues()
    const workerRepo1 = makeTempDir('worker-')
    const workerRepo2 = makeTempDir('worker-')
    await setupRepo(workerRepo1)
    await setupRepo(workerRepo2)
    const { spawn } = createFixerOnlySpawn()
    const { pool, acquireLog, releaseLog } = fakePool({ size: 2, worktreePaths: [workerRepo1, workerRepo2] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      {
        config: createReviewLoopConfigFixture(runState.repoRoot),
        runState,
        ledger,
        spawn,
        exec: passingExec,
        log: reporter,
        trace: logger,
        pool,
        inspect: false,
      },
      1,
      collector,
      [recordA, recordB],
    )

    expect(fixed).toBe(2)
    expect(acquireLog).toHaveLength(2)
    expect(releaseLog).toHaveLength(2)
    expect(releaseLog[0]!).toBeGreaterThanOrEqual(acquireLog[1]!)
  })

  test('K=1 pool serializes (equivalent to today)', async () => {
    const { runState, ledger, recordA, recordB } = await setupTwoIssues()
    const workerRepo = makeTempDir('worker-')
    await setupRepo(workerRepo)
    const { spawn } = createFixerOnlySpawn()
    const { pool, acquireLog, releaseLog } = fakePool({ size: 1, worktreePaths: [workerRepo] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      {
        config: createReviewLoopConfigFixture(runState.repoRoot),
        runState,
        ledger,
        spawn,
        exec: passingExec,
        log: reporter,
        trace: logger,
        pool,
        inspect: false,
      },
      1,
      collector,
      [recordA, recordB],
    )

    expect(fixed).toBe(2)
    expect(acquireLog).toHaveLength(2)
    expect(releaseLog).toHaveLength(2)
    expect(acquireLog[1]!).toBeGreaterThanOrEqual(releaseLog[0]!)
  })

  test('merge conflict does not consume retry budget', async () => {
    const repoRoot = makeTempDir('issue-proc-merge-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)
    const workerRepo = makeTempDir('worker-')
    await setupRepo(workerRepo)
    ledger.snapshot.issues['rec-1'] = buildRecord()
    const { spawn, calls } = createFixerOnlySpawn()
    const { pool } = fakePool({ size: 1, worktreePaths: [workerRepo], mergeOk: false, conflictFiles: ['x.ts'] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const fixed = await processPendingIssues(
      { config, runState, ledger, spawn, exec: passingExec, log: reporter, trace: logger, pool, inspect: false },
      1,
      collector,
      [ledger.snapshot.issues['rec-1']],
    )

    expect(fixed).toBe(0)
    expect(ledger.snapshot.issues['rec-1'].status).toBe('needs_human')
    expect(ledger.snapshot.issues['rec-1'].fixAttempts).toBe(0)
    expect(calls.current).toBe(1)
    expect(collector.decisions.needs_human).toBe(1)
  })

  test('build check runs against the worker worktree, not the primary', async () => {
    const repoRoot = makeTempDir('issue-proc-build-cwd-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)
    const workerRepo = makeTempDir('worker-')
    await setupRepo(workerRepo)
    ledger.snapshot.issues['rec-1'] = buildRecord()
    const { spawn } = createFixerOnlySpawn()
    const { pool } = fakePool({ size: 1, worktreePaths: [workerRepo] })
    const collector = newCollector()
    const { logger } = createCapturingTraceLogger()
    const reporter: ProgressReporter = silentReporter()

    const execCwdLog: (string | undefined)[] = []
    const recordingExec: ShellExecFn = (cwd?: string) => {
      execCwdLog.push(cwd)
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }

    const fixed = await processPendingIssues(
      { config, runState, ledger, spawn, exec: recordingExec, log: reporter, trace: logger, pool, inspect: false },
      1,
      collector,
      [ledger.snapshot.issues['rec-1']],
    )

    expect(fixed).toBe(1)
    expect(execCwdLog).toEqual([workerRepo])
  })
})

describe('sanitizeSubject', () => {
  test('strips backticks and quotes while keeping surrounding text', () => {
    expect(sanitizeSubject('`fix: "x"`')).toBe('fix: x')
  })

  test('collapses to the first line and trims whitespace', () => {
    expect(sanitizeSubject('line one\nline two')).toBe('line one')
  })

  test('returns empty string when input is only backticks and quotes', () => {
    expect(sanitizeSubject('``````')).toBe('')
    expect(sanitizeSubject('""\'')).toBe('')
  })

  test('slices to at most 100 characters', () => {
    expect(sanitizeSubject('x'.repeat(150)).length).toBe(100)
  })
})
