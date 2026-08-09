// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { createShellExec, runBuildCheck, type ShellExecFn } from './build-checker.js'
import { MergeConflictError, formatBuildFailureMessage } from './cli-errors.js'
import { loadReviewLoopConfig, type ReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { LiveRenderer, type RendererStream } from './live-renderer.js'
import { runReviewLoop, type ReviewLoopResult } from './loop-controller.js'
import type { ProgressReporter } from './progress-log.js'
import { createRunState, loadRunState, type RunState } from './run-state.js'
import { RunStats, PersistedStatsSchema, type PersistedStats } from './run-stats.js'
import { realSpawn } from './spawn.js'
import { buildMetricsJson, buildSummary } from './summary.js'
import { createFileTraceLogger, type TraceLogger } from './trace-log.js'
import { createWorkerPool, type WorkerPool } from './worker-pool.js'
import {
  cleanWorkerWorktrees,
  createWorktree,
  mergeWorktree,
  type MergeResult,
  removeWorktree,
  resetWorktree,
  worktreeExists,
  worktreeIsDirty,
} from './worktree.js'

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot?: string
  resumeRunId?: string
  resetWorktree: boolean
  poolSize?: number
  noInspect: boolean
}

const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')

function readValueArg(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1]
  if (value === undefined) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

interface ParsedFlags {
  configPath: string
  planPath?: string
  repoRoot?: string
  resumeRunId?: string
  resetWorktree: boolean
  poolSize?: number
  noInspect: boolean
}

function parseFlag(argv: readonly string[], index: number, flags: ParsedFlags): number {
  const arg = argv[index]
  if (arg === undefined) return index
  switch (arg) {
    case '--config':
      flags.configPath = readValueArg(argv, index, '--config')
      return index + 1
    case '--plan':
      flags.planPath = readValueArg(argv, index, '--plan')
      return index + 1
    case '--repo':
      flags.repoRoot = readValueArg(argv, index, '--repo')
      return index + 1
    case '--resume-run':
      flags.resumeRunId = readValueArg(argv, index, '--resume-run')
      return index + 1
    case '--reset-worktree':
      flags.resetWorktree = true
      return index
    case '--pool-size': {
      const value = Number(readValueArg(argv, index, '--pool-size'))
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--pool-size must be a positive integer')
      }
      flags.poolSize = value
      return index + 1
    }
    case '--no-inspect':
      flags.noInspect = true
      return index
    default:
      return index
  }
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags: ParsedFlags = {
    configPath: DEFAULT_CONFIG_PATH,
    resetWorktree: false,
    noInspect: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    index = parseFlag(argv, index, flags)
  }
  if (flags.planPath === undefined) {
    throw new Error('Missing required --plan')
  }
  return {
    configPath: flags.configPath,
    planPath: flags.planPath,
    repoRoot: flags.repoRoot,
    resumeRunId: flags.resumeRunId,
    resetWorktree: flags.resetWorktree,
    poolSize: flags.poolSize,
    noInspect: flags.noInspect,
  }
}

export interface FinalizeDeps {
  exec: ShellExecFn
  runBuildCheck: typeof runBuildCheck
  mergeWorktree: (repoRoot: string, branchName: string) => Promise<MergeResult>
  removeWorktree: (repoRoot: string, worktreePath: string, runId: string) => Promise<void>
}

export async function finalizeRun(config: ReviewLoopConfig, runState: RunState, deps: FinalizeDeps): Promise<void> {
  const build = await deps.runBuildCheck({ exec: deps.exec })
  if (!build.passed) {
    await writeFile(path.join(runState.runDir, 'build-check.log'), `${build.stdout}\n--- stderr ---\n${build.stderr}\n`)
    throw new Error(formatBuildFailureMessage(runState, build))
  }
  const branchName = `review-loop/${runState.runId}`
  const result = await deps.mergeWorktree(config.repoRoot, branchName)
  if (!result.ok) {
    throw new MergeConflictError(branchName, result.conflictFiles, runState)
  }
  await deps.removeWorktree(config.repoRoot, runState.worktreePath, runState.runId)
}

export async function resolvePlanPath(planPath: string, repoRoot: string): Promise<string> {
  const resolved = path.isAbsolute(planPath) ? planPath : path.resolve(repoRoot, planPath)
  try {
    await access(resolved)
  } catch {
    throw new Error(`Plan file not found: ${resolved} (--plan "${planPath}" resolved against repo root ${repoRoot})`)
  }
  return resolved
}

export async function prepareWorktree(config: ReviewLoopConfig, runState: RunState, reset: boolean): Promise<void> {
  if (!worktreeExists(runState.worktreePath)) {
    await createWorktree(config.repoRoot, runState.worktreePath, runState.runId)
  } else if (reset) {
    await resetWorktree(runState.worktreePath)
  } else if (await worktreeIsDirty(runState.worktreePath)) {
    console.warn(
      `Warning: worktree at ${runState.worktreePath} has uncommitted changes from a previous run. ` +
        `Pass --reset-worktree to discard them before resuming.`,
    )
  }
}

const MetricsEnvelopeSchema = z.object({ runStats: PersistedStatsSchema.optional() })

export async function readPersistedRunStats(runDir: string): Promise<PersistedStats | undefined> {
  try {
    const parsed = MetricsEnvelopeSchema.safeParse(
      JSON.parse(await readFile(path.join(runDir, 'metrics.json'), 'utf8')),
    )
    return parsed.success ? parsed.data.runStats : undefined
  } catch {
    return undefined
  }
}

export async function writeRunArtifacts(
  runDir: string,
  result: ReviewLoopResult,
  options: { poolSize: number; inspect: boolean; wallMs: number; stats?: RunStats },
): Promise<void> {
  const closed = Object.values(result.ledger.issues).filter((r) => r.status === 'closed').length
  const summary = buildSummary({
    doneReason: result.doneReason,
    rounds: result.rounds,
    metrics: result.metrics ?? [],
    ledger: result.ledger,
    runDir,
    wallMs: options.wallMs,
    options: { poolSize: options.poolSize, inspect: options.inspect },
    stats: options.stats?.snapshot(),
  })
  await writeFile(path.join(runDir, 'summary.txt'), `${summary}\n`)
  try {
    await writeFile(
      path.join(runDir, 'metrics.json'),
      `${JSON.stringify(
        buildMetricsJson(
          result.doneReason,
          result.rounds,
          closed,
          result.metrics ?? [],
          options,
          options.stats?.persist(),
        ),
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    console.warn(`[review-loop] metrics.json write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(summary)
}

async function executeReviewLoop(
  config: ReviewLoopConfig,
  runState: RunState,
  ledger: IssueLedger,
  exec: ShellExecFn,
  log: ProgressReporter,
  trace: TraceLogger,
  pool: WorkerPool,
  inspect: boolean,
  startedAt: number,
): Promise<void> {
  const result = await runReviewLoop({
    config,
    runState,
    ledger,
    spawn: realSpawn,
    exec,
    log,
    trace,
    pool,
    inspect,
  })
  // Write summary/metrics/trace BEFORE finalizeRun so they always exist for
  // post-mortem, even if the final build check or merge throws.
  await writeRunArtifacts(runState.runDir, result, {
    poolSize: config.poolSize,
    inspect,
    wallMs: Date.now() - startedAt,
    stats: log.stats,
  })
  await finalizeRun(config, runState, { exec, runBuildCheck, mergeWorktree, removeWorktree })
}

/**
 * `stdout` is the live renderer's sink, real by default so a run still prints its
 * progress. It writes past every console suppression, so a test can only quiet it here.
 */
export async function runCli(argv: readonly string[], stdout: RendererStream = process.stdout): Promise<void> {
  const startedAt = Date.now()
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({ configPath: args.configPath, repoRoot: args.repoRoot })
  if (args.poolSize !== undefined) config.poolSize = args.poolSize

  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, await resolvePlanPath(args.planPath, config.repoRoot))
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  await prepareWorktree(config, runState, args.resetWorktree)

  const priorStats = args.resumeRunId === undefined ? undefined : await readPersistedRunStats(runState.runDir)
  const stats = RunStats.rehydrate(priorStats, { pricing: config.pricing })
  const log = new LiveRenderer(stdout, stats)
  const exec = createShellExec(runState.worktreePath, config.checkCommand, config.buildTimeoutMs)
  const trace = createFileTraceLogger(runState.tracePath)
  await cleanWorkerWorktrees(runState.worktreePath, args.resumeRunId)
  const pool = await createWorkerPool(config, runState, {
    onMergeDiff: (workerId, diff) => {
      log.diff(`worker-${workerId}`, diff)
    },
    warn: (message) => {
      log.event(message)
    },
  })

  try {
    await executeReviewLoop(config, runState, ledger, exec, log, trace, pool, !args.noInspect, startedAt)
  } finally {
    await pool.close()
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
