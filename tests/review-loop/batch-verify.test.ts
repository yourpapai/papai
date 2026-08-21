// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { BatchMember, FixedBatch } from '../../review-loop/src/batch-outcomes.js'
import { verifyAndMergeBatches } from '../../review-loop/src/batch-verify.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import type { LedgerIssueRecord, IssueLedger } from '../../review-loop/src/issue-ledger.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import type { IssueProcessorDeps } from '../../review-loop/src/issue-processor.js'
import type { FixerResult, ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { newCollector, type RoundCollector } from '../../review-loop/src/round-collector.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import type { TraceEvent } from '../../review-loop/src/trace-log.js'
import type { WorkerPool } from '../../review-loop/src/worker-pool.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'English literal not localized',
  kind: 'defect',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'src/a.ts 1-2',
  file: 'src/a.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'localize',
  confidence: 0.9,
}

function buildRecord(id: string, file: string, overrides?: Partial<ReviewerIssue>): LedgerIssueRecord {
  return {
    id,
    issue: { ...issue, file, evidence: `${file} 1-2`, ...overrides },
    status: 'discovered',
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
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

const passingExec: ShellExecFn = (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

const fixerResultOf = (targetFiles: readonly string[]): FixerResult => ({
  verdict: 'valid',
  fixability: 'auto',
  fixed: true,
  reasoning: 'batch fix',
  targetFiles: [...targetFiles],
  severity: 'low',
})

/** One claimed-fixed batch: record + fixer result per member, plus the edit on disk. */
function makeBatch(
  workerRepo: string,
  records: readonly LedgerIssueRecord[],
  opts?: { targetFiles?: readonly string[]; writeEdits?: boolean },
): FixedBatch {
  const targetFiles = opts?.targetFiles ?? records.map((r) => `fix-${r.id}.ts`)
  const members: BatchMember[] = records.map((record, i) => ({
    record,
    fixerResult: fixerResultOf([targetFiles[i]!]),
  }))
  if (opts?.writeEdits !== false) {
    for (const file of targetFiles) writeFileSync(path.join(workerRepo, file), 'fixed\n')
  }
  const claims = new Set([
    ...records.flatMap((r) => [r.issue.file, ...(r.issue.spans ?? []).map((s) => s.file)]),
    ...targetFiles,
  ])
  return { members, claims }
}

/**
 * An inspector spawn that echoes the ids embedded in the aggregated prompt,
 * with per-id verdicts from the map (absent ids default to addresses=true).
 */
function inspectorSpawn(verdicts: Record<string, boolean>, unavailable = false): SpawnFn {
  return (_cmd, args, spawnOpts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)?.[1]
    if (unavailable) return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'agent exploded' } satisfies SpawnResult)
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    const ids = [...prompt.matchAll(/"id":\s*"([^"]+)"/gu)].map((m) => m[1]!)
    writeFileSync(
      path.resolve(spawnOpts.cwd, outputPath),
      JSON.stringify({
        results: ids.map((id) => ({ id, addresses: verdicts[id] ?? true, reasoning: 'mock', confidence: 0.8 })),
      }),
    )
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

interface VerifyScenario {
  deps: IssueProcessorDeps
  ledger: IssueLedger
  collector: RoundCollector
  events: TraceEvent[]
  workerRepo: string
  mergeCount: () => number
  execCalls: () => number
}

async function setupVerify(
  records: readonly LedgerIssueRecord[],
  opts?: { exec?: ShellExecFn; spawn?: SpawnFn; inspect?: boolean },
): Promise<{ scenario: VerifyScenario; verify: (batches: readonly FixedBatch[]) => Promise<number> }> {
  const repoRoot = makeTempDir('batch-verify-')
  const config = createReviewLoopConfigFixture(repoRoot)
  writeFileSync(path.join(repoRoot, 'plan.md'), '# Plan')
  const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
  const ledger = await createIssueLedger(runState.runDir)
  await setupRepo(runState.worktreePath)
  const workerRepo = makeTempDir('batch-verify-worker-')
  await setupRepo(workerRepo)
  for (const record of records) ledger.snapshot.issues[record.id] = record

  const { pool } = fakePool({ size: 1, worktreePaths: [workerRepo] })
  let merges = 0
  const countingPool: WorkerPool = {
    ...pool,
    mergeWorkerIntoPrimary(worker) {
      merges += 1
      return pool.mergeWorkerIntoPrimary(worker)
    },
  }
  let execCalls = 0
  const exec: ShellExecFn = (cwd) => {
    execCalls += 1
    return (opts?.exec ?? passingExec)(cwd)
  }
  const collector = newCollector()
  const { logger, events } = createCapturingTraceLogger()
  const deps: IssueProcessorDeps = {
    config,
    runState,
    ledger,
    spawn: opts?.spawn ?? inspectorSpawn({}),
    exec,
    log: silentReporter(),
    trace: logger,
    pool: countingPool,
    inspect: opts?.inspect ?? true,
  }
  return {
    scenario: { deps, ledger, collector, events, workerRepo, mergeCount: () => merges, execCalls: () => execCalls },
    verify: (batches) => verifyAndMergeBatches(deps, 1, collector, batches),
  }
}

describe('verifyAndMergeBatches', () => {
  test('one build + one inspector over the aggregated diff; approved members committed and merged', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const recB = buildRecord('rec-b', 'src/b.ts')
    const { scenario, verify } = await setupVerify([recA, recB])
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA, recB])])

    expect(fixed).toBe(2)
    expect(scenario.execCalls()).toBe(1)
    expect(scenario.mergeCount()).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('fixed_pending_review')
    expect(scenario.ledger.snapshot.issues['rec-b']?.status).toBe('fixed_pending_review')
    expect(scenario.ledger.snapshot.issues['rec-a']?.fixAttempts).toBe(1)
    expect(scenario.collector.decisions.fixed).toBe(2)
    expect(scenario.collector.inspector).toEqual({ runs: 2, rejected: 0 })

    const subjects = (await execGit(scenario.workerRepo, ['log', '--format=%s'])).stdout
    const fixCommits = subjects.split('\n').filter((s) => s.startsWith('fix(review-loop):'))
    expect(fixCommits.length).toBe(1)
    expect(fixCommits[0]).toContain('(+2)')
    expect(scenario.events.filter((e) => e.event === 'build_complete').length).toBe(1)
    expect(scenario.events.filter((e) => e.event === 'inspect_complete').length).toBe(2)
  })

  test('build failure attributes via claimed files: implicated member needs_human, clean batch merges', async () => {
    const recDefect = buildRecord('rec-defect', 'src/defect.ts', { severity: 'high' })
    const recCleanup = buildRecord('rec-cleanup', 'src/cleanup.ts', {
      kind: 'cleanup',
      title: 'Dead helper to delete',
    })
    const failingExec: ShellExecFn = () =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'src/defect.ts(3,1): error TS2322: boom' })
    const { scenario, verify } = await setupVerify([recDefect, recCleanup], { exec: failingExec })
    const fixed = await verify([
      makeBatch(scenario.workerRepo, [recDefect]),
      makeBatch(scenario.workerRepo, [recCleanup]),
    ])

    expect(fixed).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-defect']?.status).toBe('needs_human')
    expect(scenario.ledger.snapshot.issues['rec-cleanup']?.status).toBe('fixed_pending_review')
    expect(scenario.collector.decisions.needs_human).toBe(1)
    expect(scenario.collector.decisions.fixed).toBe(1)
    expect(scenario.mergeCount()).toBe(1)
    expect(scenario.events.filter((e) => e.event === 'inspect_complete').length).toBe(1)
  })

  test('unattributable build failure marks every batched member needs_human and merges nothing', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const recB = buildRecord('rec-b', 'src/b.ts')
    const failingExec: ShellExecFn = () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'command failed' })
    const { scenario, verify } = await setupVerify([recA, recB], { exec: failingExec })
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA]), makeBatch(scenario.workerRepo, [recB])])

    expect(fixed).toBe(0)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('needs_human')
    expect(scenario.ledger.snapshot.issues['rec-b']?.status).toBe('needs_human')
    expect(scenario.collector.decisions.needs_human).toBe(2)
    expect(scenario.mergeCount()).toBe(0)
    expect(scenario.events.filter((e) => e.event === 'inspect_complete').length).toBe(0)
    const status = (await execGit(scenario.workerRepo, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
  })

  test('inspector addresses:false for one member sends only that member to needs_human', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const recB = buildRecord('rec-b', 'src/b.ts')
    const { scenario, verify } = await setupVerify([recA, recB], { spawn: inspectorSpawn({ 'rec-a': false }) })
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA, recB])])

    expect(fixed).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('needs_human')
    expect(scenario.ledger.snapshot.issues['rec-b']?.status).toBe('fixed_pending_review')
    expect(scenario.collector.decisions.inspector_rejected).toBe(1)
    expect(scenario.collector.decisions.fixed).toBe(1)
    expect(scenario.collector.inspector).toEqual({ runs: 2, rejected: 1 })
  })

  test('inspector unavailable treats every fixed member as needs_human and merges nothing', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, verify } = await setupVerify([recA], { spawn: inspectorSpawn({}, true) })
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA])])

    expect(fixed).toBe(0)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('needs_human')
    expect(scenario.collector.decisions.needs_human).toBe(1)
    expect(scenario.mergeCount()).toBe(0)
    const status = (await execGit(scenario.workerRepo, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
  })

  test('inspect:false skips the inspector and merges after the build alone', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, verify } = await setupVerify([recA], { inspect: false })
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA])])

    expect(fixed).toBe(1)
    expect(scenario.events.filter((e) => e.event === 'inspect_complete').length).toBe(0)
    expect(scenario.mergeCount()).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('fixed_pending_review')
  })

  test('no claimed file changed on disk: no_commit for every member, nothing built or merged', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, verify } = await setupVerify([recA])
    const fixed = await verify([makeBatch(scenario.workerRepo, [recA], { writeEdits: false })])

    expect(fixed).toBe(0)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('discovered')
    expect(scenario.collector.decisions.no_commit).toBe(1)
    expect(scenario.collector.inspector.runs).toBe(0)
    expect(scenario.execCalls()).toBe(0)
  })

  test('a surviving member sharing files with a rejected member is held back for split retry', async () => {
    const recDefect = buildRecord('rec-defect', 'src/defect.ts', { severity: 'high' })
    const recCleanup = buildRecord('rec-cleanup', 'src/cleanup.ts', {
      kind: 'cleanup',
      title: 'Dead helper to delete',
    })
    // Both batches edit the same file; the inspector rejects the defect member.
    const { scenario, verify } = await setupVerify([recDefect, recCleanup], {
      spawn: inspectorSpawn({ 'rec-defect': false }),
    })
    const fixed = await verify([
      makeBatch(scenario.workerRepo, [recDefect], { targetFiles: ['shared.ts'] }),
      makeBatch(scenario.workerRepo, [recCleanup], { targetFiles: ['shared.ts'] }),
    ])

    expect(fixed).toBe(0)
    expect(scenario.ledger.snapshot.issues['rec-defect']?.status).toBe('needs_human')
    expect(scenario.ledger.snapshot.issues['rec-cleanup']?.status).toBe('needs_human')
    // One rejection from the inspector, one from entanglement with it.
    expect(scenario.collector.decisions.inspector_rejected).toBe(1)
    expect(scenario.collector.decisions.needs_human).toBe(1)
    const subjects = (await execGit(scenario.workerRepo, ['log', '--format=%s'])).stdout
    expect(subjects).not.toContain('fix(review-loop):')
  })
})
