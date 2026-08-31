// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import type { LedgerIssueRecord, IssueLedger } from '../../review-loop/src/issue-ledger.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import { processBatched } from '../../review-loop/src/issue-processor-batch.js'
import type { IssueProcessorDeps } from '../../review-loop/src/issue-processor.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { newCollector, type RoundCollector } from '../../review-loop/src/round-collector.js'
import { createRunState, type RunState } from '../../review-loop/src/run-state.js'
import type { StopController } from '../../review-loop/src/stop-controller.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import type { TraceEvent } from '../../review-loop/src/trace-log.js'
import type { WorkerPool } from '../../review-loop/src/worker-pool.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  claudeRunContext,
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

interface BatchSpawnOptions {
  /** Per-member fixer outcome; members absent from the map default to valid+fixed. */
  fixer?: Record<string, { verdict: string; fixed: boolean }>
  /** Per-member inspector verdict; absent ids default to addresses=true. */
  inspector?: Record<string, boolean>
  /** When true the inspector agent exits non-zero (unavailable). */
  inspectorFails?: boolean
  /** Extra wall-clock ms each fixer call takes, so deferral estimates are non-zero. */
  fixerDelayMs?: number
  /** When false a "fixed" claim writes no file — the no_commit case. */
  editFiles?: boolean
}

/**
 * One spawn driving both agent roles. The cluster fixer prompt embeds member ids
 * (`{"id": ...}`) and the aggregated inspector prompt embeds them the same way,
 * so per-id verdicts are expressed by echoing the ids found in the prompt.
 * A "fixed" member writes `fix-<id>.ts` and declares it in `targetFiles`.
 */
function batchSpawn(opts: BatchSpawnOptions): SpawnFn {
  return (_cmd, args, spawnOpts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    const ids = [...prompt.matchAll(/"id":\s*"([^"]+)"/gu)].map((m) => m[1]!)

    const respond = (body: unknown): Promise<SpawnResult> => {
      writeFileSync(path.resolve(spawnOpts.cwd, outputPath), JSON.stringify(body))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    }

    if (prompt.includes('You are an inspector')) {
      if (opts.inspectorFails === true) {
        return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'agent exploded' } satisfies SpawnResult)
      }
      return respond({
        results: ids.map((id) => ({
          id,
          addresses: opts.inspector?.[id] ?? true,
          reasoning: 'mock aggregated inspector',
          confidence: 0.8,
        })),
      })
    }

    const fixerBody = {
      results: ids.map((id) => {
        const outcome = opts.fixer?.[id] ?? { verdict: 'valid', fixed: true }
        const fixed = outcome.fixed
        const editFiles = fixed && (opts.editFiles ?? true)
        if (editFiles) writeFileSync(path.join(spawnOpts.cwd, `fix-${id}.ts`), 'fixed\n')
        return {
          id,
          verdict: outcome.verdict,
          fixability: outcome.verdict === 'valid' ? 'auto' : 'manual',
          fixed,
          reasoning: `batch fix ${id}`,
          targetFiles: editFiles ? [`fix-${id}.ts`] : [],
          severity: 'low',
        }
      }),
    }
    if (opts.fixerDelayMs === undefined) return respond(fixerBody)
    return new Promise<SpawnResult>((resolve) => {
      setTimeout(() => {
        writeFileSync(path.resolve(spawnOpts.cwd, outputPath), JSON.stringify(fixerBody))
        resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
      }, opts.fixerDelayMs)
    })
  }
}

interface BatchScenario {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  collector: RoundCollector
  events: TraceEvent[]
  workerRepo: string
  mergeCount: () => number
  execCalls: () => number
}

async function setupBatch(
  records: readonly LedgerIssueRecord[],
  opts?: {
    exec?: ShellExecFn
    spawnOptions?: BatchSpawnOptions
    stop?: StopController
    inspect?: boolean
    spawn?: SpawnFn
    configOverrides?: Partial<ReviewLoopConfig>
  },
): Promise<{ scenario: BatchScenario; run: () => Promise<number> }> {
  const repoRoot = makeTempDir('batch-verify-')
  const config = createReviewLoopConfigFixture(repoRoot, { batchVerify: true, ...opts?.configOverrides })
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
  const spawn = opts?.spawn ?? batchSpawn(opts?.spawnOptions ?? {})

  const deps: IssueProcessorDeps = {
    config,
    runState,
    ledger,
    spawn,
    exec,
    log: silentReporter(),
    trace: logger,
    pool: countingPool,
    inspect: opts?.inspect ?? true,
    stop: opts?.stop,
  }
  return {
    scenario: {
      config,
      runState,
      ledger,
      collector,
      events,
      workerRepo,
      mergeCount: () => merges,
      execCalls: () => execCalls,
    },
    run: () => processBatched(deps, 1, collector, [...records]),
  }
}

describe('processBatched verification phase', () => {
  test('one build + one inspector over the aggregated diff; approved members committed and merged', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const recB = buildRecord('rec-b', 'src/b.ts')
    const { scenario, run } = await setupBatch([recA, recB])
    const fixed = await run()

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

  test('per-member fixer verdicts: invalid member rejected at the fixer step, valid member verified', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const recB = buildRecord('rec-b', 'src/b.ts')
    const { scenario, run } = await setupBatch([recA, recB], {
      spawnOptions: { fixer: { 'rec-b': { verdict: 'invalid', fixed: false } } },
    })
    const fixed = await run()

    expect(fixed).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-b']?.status).toBe('rejected')
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('fixed_pending_review')
    expect(scenario.collector.decisions.invalid).toBe(1)
    expect(scenario.collector.decisions.fixed).toBe(1)
  })

  test('build failure attributes via claimed files: implicated cluster needs_human, clean cluster merges', async () => {
    // Two clusters that will not co-cluster: different kinds.
    const recDefect = buildRecord('rec-defect', 'src/defect.ts', { kind: 'defect', severity: 'high' })
    const recCleanup = buildRecord('rec-cleanup', 'src/cleanup.ts', {
      kind: 'cleanup',
      title: 'Dead helper to delete',
      severity: 'low',
    })
    const failingExec: ShellExecFn = () =>
      Promise.resolve({ exitCode: 1, stdout: '', stderr: 'src/defect.ts(3,1): error TS2322: boom' })
    const { scenario, run } = await setupBatch([recDefect, recCleanup], { exec: failingExec })
    const fixed = await run()

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
    const { scenario, run } = await setupBatch([recA, recB], { exec: failingExec })
    const fixed = await run()

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
    const { scenario, run } = await setupBatch([recA, recB], {
      spawnOptions: { inspector: { 'rec-a': false } },
    })
    const fixed = await run()

    expect(fixed).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('needs_human')
    expect(scenario.ledger.snapshot.issues['rec-b']?.status).toBe('fixed_pending_review')
    expect(scenario.collector.decisions.inspector_rejected).toBe(1)
    expect(scenario.collector.decisions.fixed).toBe(1)
    expect(scenario.collector.inspector).toEqual({ runs: 2, rejected: 1 })
  })

  test('inspector unavailable treats every fixed member as needs_human and merges nothing', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, run } = await setupBatch([recA], { spawnOptions: { inspectorFails: true } })
    const fixed = await run()

    expect(fixed).toBe(0)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('needs_human')
    expect(scenario.collector.decisions.needs_human).toBe(1)
    expect(scenario.mergeCount()).toBe(0)
    const status = (await execGit(scenario.workerRepo, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
  })

  test('inspect:false skips the inspector and merges after the build alone', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, run } = await setupBatch([recA], { inspect: false })
    const fixed = await run()

    expect(fixed).toBe(1)
    expect(scenario.events.filter((e) => e.event === 'inspect_complete').length).toBe(0)
    expect(scenario.mergeCount()).toBe(1)
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('fixed_pending_review')
  })

  test('fixer claims fixed but the tree is unchanged: no_commit, nothing merged or verified', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const { scenario, run } = await setupBatch([recA], { spawnOptions: { editFiles: false } })
    const fixed = await run()

    expect(fixed).toBe(0)
    // Same as the per-issue path: the fixer verdict was already recorded, and
    // no_commit is a claim about the diff, not a verdict change.
    expect(scenario.ledger.snapshot.issues['rec-a']?.status).toBe('verified')
    expect(scenario.collector.decisions.no_commit).toBe(1)
    expect(scenario.collector.inspector.runs).toBe(0)
    expect(scenario.execCalls()).toBe(0)
  })
})

describe('processBatched deferral', () => {
  test('low cluster deferred when the budget is spent; records stay discovered and are counted', async () => {
    const recDefect = buildRecord('rec-defect', 'src/defect.ts', {
      kind: 'defect',
      severity: 'high',
      title: 'Race in queue',
    })
    // Different kind, so this never co-clusters with the defect above.
    const recLow = buildRecord('rec-low', 'src/low.ts', {
      kind: 'cleanup',
      severity: 'low',
      title: 'Dead helper to delete',
    })
    const stop: StopController = {
      requested: () => null,
      request: () => {},
      dispose: () => {},
      remainingMs: () => 0,
    }
    const { scenario, run } = await setupBatch([recDefect, recLow], {
      stop,
      spawnOptions: { fixerDelayMs: 5 },
    })
    const fixed = await run()

    // The high defect ran (never deferred); the low cluster was deferred.
    expect(scenario.ledger.snapshot.issues['rec-defect']?.status).toBe('fixed_pending_review')
    expect(scenario.ledger.snapshot.issues['rec-low']?.status).toBe('discovered')
    expect(scenario.collector.deferred).toBe(1)
    expect(fixed).toBe(1)
  })
})

/**
 * The claude-route batch fake: the same prompt-keyed responder as `batchSpawn`,
 * reading the prompt off stdin and emitting a healthy claude result line. The
 * conditionals live here, at module level, not inside the test body.
 */
function claudeBatchSpawn(commands: string[], argvs?: string[][]): SpawnFn {
  return (_cmd, args, spawnOpts, onLine) => {
    commands.push(_cmd)
    argvs?.push([...args])
    const prompt = spawnOpts.stdin ?? ''
    const outputPath = prompt.match(/as JSON to:\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    const ids = [...prompt.matchAll(/"id":\s*"([^"]+)"/gu)].map((m) => m[1]!)
    onLine?.(
      JSON.stringify({
        type: 'result',
        is_error: false,
        stop_reason: 'end_turn',
        session_id: 'sess-batch',
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    )
    if (prompt.includes('You are an inspector')) {
      writeFileSync(
        path.resolve(spawnOpts.cwd, outputPath),
        JSON.stringify({
          results: ids.map((id) => ({ id, addresses: true, reasoning: 'ok', confidence: 0.9 })),
        }),
      )
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
    }
    for (const id of ids) writeFileSync(path.join(spawnOpts.cwd, `fix-${id}.ts`), 'fixed\n')
    writeFileSync(
      path.resolve(spawnOpts.cwd, outputPath),
      JSON.stringify({
        results: ids.map((id) => ({
          id,
          verdict: 'valid',
          fixability: 'auto',
          fixed: true,
          reasoning: `batch fix ${id}`,
          targetFiles: [`fix-${id}.ts`],
          severity: 'low',
        })),
      }),
    )
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

describe('processBatched backend threading', () => {
  test('the batch fixer spawn receives the resolved backend and claude context', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const commands: string[] = []

    const { run } = await setupBatch([recA], {
      spawn: claudeBatchSpawn(commands),
      configOverrides: { backend: 'claude', claude: claudeRunContext() },
    })
    const fixed = await run()

    expect(fixed).toBe(1)
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.every((command) => command === 'claude')).toBe(true)
  })

  test('the batch fixer effort rides the spawn as --effort after --model (D4, D6)', async () => {
    const recA = buildRecord('rec-a', 'src/a.ts')
    const commands: string[] = []
    const argvs: string[][] = []

    const { run } = await setupBatch([recA], {
      spawn: claudeBatchSpawn(commands, argvs),
      configOverrides: {
        backend: 'claude',
        claude: claudeRunContext(),
        fixer: { model: 'opencode/claude-sonnet-4-6', extraArgs: [], effort: 'medium' },
      },
    })
    const fixed = await run()

    expect(fixed).toBe(1)
    const argv = argvs[0]!
    const model = argv.indexOf('--model')
    expect(argv.slice(model + 2, model + 4)).toEqual(['--effort', 'medium'])
  })
})
