// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { rmSync } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openClaudeContext, resolveAgentBackend, type ResolvedAgentBackend } from './backend-select.js'
import { createShellExec, runBuildCheck, type ShellExecFn } from './build-checker.js'
import { parseCliArgs, type CliArgs } from './cli-args.js'
import { MergeConflictError, formatBuildFailureMessage } from './cli-errors.js'
import { loadReviewLoopConfig, type ReviewLoopConfig } from './config.js'
import { applyCommitIdentity } from './git-identity.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { LiveRenderer, type RendererStream } from './live-renderer.js'
import { runReviewLoop } from './loop-controller.js'
import type { ProgressReporter } from './progress-log.js'
import { poolHooks } from './publish-fix.js'
import { readPersistedRunStats, writeRunArtifacts } from './run-artifacts.js'
import { createRunState, loadRunState, type RunState } from './run-state.js'
import { RunStats } from './run-stats.js'
import { realSpawn } from './spawn.js'
import { createRunStopController, reportStop, type StopController } from './stop-controller.js'
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

export { parseCliArgs, type CliArgs } from './cli-args.js'
export { readPersistedRunStats, writeRunArtifacts } from './run-artifacts.js'

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

interface ExecuteInput {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
  inspect: boolean
  startedAt: number
  stop: StopController
}

async function executeReviewLoop(input: ExecuteInput): Promise<CliOutcome> {
  const { config, runState, exec, log, inspect } = input
  const result = await runReviewLoop({
    config,
    runState,
    ledger: input.ledger,
    spawn: realSpawn,
    exec,
    log,
    trace: input.trace,
    pool: input.pool,
    inspect,
    stop: input.stop,
  })
  // Write summary/metrics/trace BEFORE finalizeRun so they always exist for
  // post-mortem, even if the final build check or merge throws.
  await writeRunArtifacts(runState.runDir, result, {
    poolSize: config.poolSize,
    inspect,
    wallMs: Date.now() - input.startedAt,
    stats: log.stats,
  })

  if (result.doneReason === 'stopped') {
    reportStop(config, runState, log)
    return { exitCode: STOPPED_EXIT_CODE }
  }

  await finalizeRun(config, runState, {
    exec,
    // The build check's output is scrubbed at its single producer on the
    // claude route (D5), so build-check.log reads one scrubbed copy.
    runBuildCheck: (deps) => runBuildCheck({ ...deps, credentialValue: config.claude?.credentialValue }),
    mergeWorktree,
    removeWorktree,
  })
  return { exitCode: 0 }
}

/**
 * The exit code of a run that stopped at its own bound rather than finishing.
 *
 * Distinct from both 0 and 1 because it is neither: the loop did not complete
 * its rounds, and nothing failed. `75` is `EX_TEMPFAIL` from `sysexits.h` —
 * "temporary failure, the user is invited to retry" — which is precisely the
 * case, and the caller that drives this loop reads it to tell an honest report
 * ("stopped early, what it fixed is on the branch") from a false one ("timed
 * out and was killed", or "passed").
 */
export const STOPPED_EXIT_CODE = 75

export interface CliOutcome {
  exitCode: number
}

interface OpenRun {
  runState: RunState
  ledger: IssueLedger
  log: LiveRenderer
  exec: ShellExecFn
  trace: TraceLogger
  pool: WorkerPool
}

/**
 * Everything a run needs before it can review anything: its state, its ledger,
 * its worktree, its reporter and its pool of workers.
 *
 * Each half of every pair below is the fresh-run answer or the resumed-run one,
 * and they are kept together here so that "what `--resume-run` changes" is one
 * function to read rather than five scattered conditionals.
 */
async function openRun(config: ReviewLoopConfig, args: CliArgs, stdout: RendererStream): Promise<OpenRun> {
  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, await resolvePlanPath(args.planPath, config.repoRoot))
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  await prepareWorktree(config, runState, args.resetWorktree)

  const priorStats = args.resumeRunId === undefined ? undefined : await readPersistedRunStats(runState.runDir)
  const log = new LiveRenderer(stdout, RunStats.rehydrate(priorStats, { pricing: config.pricing }))
  const exec = createShellExec(runState.worktreePath, config.checkCommand, config.buildTimeoutMs)
  const trace = createFileTraceLogger(runState.tracePath)
  await cleanWorkerWorktrees(runState.worktreePath, args.resumeRunId)
  const pool = await createWorkerPool(config, runState, poolHooks(config, log))

  return { runState, ledger, log, exec, trace, pool }
}

/**
 * `stdout` is the live renderer's sink, real by default so a run still prints its
 * progress. It writes past every console suppression, so a test can only quiet it here.
 */
/**
 * The startup preamble, split from `runCli` when the claude seams pushed it
 * past `max-lines-per-function`: config load, the backend credential guard and
 * the commit identity, in that order. The guard runs before identity, worktree,
 * install or any spawn (D4) — a refused credential environment must cost
 * nothing — and the opencode route never calls the resolver, its credentials
 * being the gateway's, not Anthropic's.
 */
async function loadRunPreamble(argv: readonly string[]): Promise<{
  args: CliArgs
  config: ReviewLoopConfig
  resolvedClaude: ResolvedAgentBackend | null
}> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({ configPath: args.configPath, repoRoot: args.repoRoot })
  if (args.poolSize !== undefined) config.poolSize = args.poolSize
  const resolvedClaude: ResolvedAgentBackend | null =
    config.backend === 'claude' ? resolveAgentBackend('claude', process.env) : null
  // Before the first worktree, let alone the first commit: `createWorktree` and
  // every git child after it inherit this process's environment, and a runner
  // with no `user.name` anywhere cannot commit at all — see `git-identity.ts`.
  applyCommitIdentity(config.commitAuthor, process.env)
  return { args, config, resolvedClaude }
}

export async function runCli(argv: readonly string[], stdout: RendererStream = process.stdout): Promise<CliOutcome> {
  const startedAt = Date.now()
  const { args, config, resolvedClaude } = await loadRunPreamble(argv)

  const { runState, ledger, log, exec, trace, pool } = await openRun(config, args, stdout)

  const stop = createRunStopController(config, log, startedAt)

  let claudeParent: string | null = null
  try {
    // The claude context opens as the first statement of the finally-protected
    // region — never between mkdtemp and coverage, where a throw would leak
    // the dir outside every teardown path (D8).
    if (config.backend === 'claude' && resolvedClaude !== null) {
      claudeParent = await openClaudeContext(config, resolvedClaude)
    }
    return await executeReviewLoop({
      config,
      runState,
      ledger,
      exec,
      log,
      trace,
      pool,
      inspect: !args.noInspect,
      startedAt,
      stop,
    })
  } finally {
    if (claudeParent !== null) {
      // Best-effort: takes every per-spawn child with it. A SIGKILL'd run
      // leaks one tmp parent the OS cleaner owns — the same residual every
      // tmp scratch has.
      rmSync(claudeParent, { recursive: true, force: true })
    }
    stop.dispose()
    await pool.close()
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2))
    .then((outcome) => {
      // Only a non-zero code is spelled out. A clean run exits by running out of
      // work, which lets whatever is still flushing — the trace log's
      // fire-and-forget appends among them — finish first.
      if (outcome.exitCode !== 0) process.exit(outcome.exitCode)
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
