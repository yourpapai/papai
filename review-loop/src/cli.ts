// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { LineSink, SpawnFn, SpawnResult } from './agent-runner.js'
import { createShellExec, runBuildCheck, type ShellExecFn } from './build-checker.js'
import { loadReviewLoopConfig, type ReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { LiveRenderer } from './live-renderer.js'
import { runReviewLoop, type ReviewLoopResult } from './loop-controller.js'
import { createRunState, loadRunState, type RunState } from './run-state.js'
import { buildMetricsJson, formatSummary } from './summary.js'
import { createFileTraceLogger } from './trace-log.js'
import {
  createWorktree,
  mergeWorktree,
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
}

const DEFAULT_CONFIG_PATH = path.join(import.meta.dir, '..', 'config.json')

function readValueArg(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1]
  if (value === undefined) {
    throw new Error(`Missing value for ${name}`)
  }
  return value
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let configPath = DEFAULT_CONFIG_PATH
  let planPath: string | undefined
  let repoRoot: string | undefined
  let resumeRunId: string | undefined
  let shouldResetWorktree = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      configPath = readValueArg(argv, index, '--config')
      index += 1
      continue
    }
    if (arg === '--plan') {
      planPath = readValueArg(argv, index, '--plan')
      index += 1
      continue
    }
    if (arg === '--repo') {
      repoRoot = readValueArg(argv, index, '--repo')
      index += 1
      continue
    }
    if (arg === '--resume-run') {
      resumeRunId = readValueArg(argv, index, '--resume-run')
      index += 1
      continue
    }
    if (arg === '--reset-worktree') {
      shouldResetWorktree = true
      continue
    }
  }

  if (planPath === undefined) {
    throw new Error('Missing required --plan')
  }

  return { configPath, planPath, repoRoot, resumeRunId, resetWorktree: shouldResetWorktree }
}

export function splitLines(pending: string, chunk: string): { lines: string[]; remaining: string } {
  const parts = (pending + chunk).split('\n')
  const remaining = parts.pop() ?? ''
  const lines = parts.filter((line) => line.length > 0)
  return { lines, remaining }
}

export interface FinalizeDeps {
  exec: ShellExecFn
  runBuildCheck: typeof runBuildCheck
  mergeWorktree: (repoRoot: string, branchName: string) => Promise<void>
  removeWorktree: (repoRoot: string, worktreePath: string, runId: string) => Promise<void>
}

export async function finalizeRun(config: ReviewLoopConfig, runState: RunState, deps: FinalizeDeps): Promise<void> {
  const build = await deps.runBuildCheck({ exec: deps.exec })
  if (!build.passed) {
    throw new Error(
      `Final build check failed; worktree preserved at ${runState.worktreePath} for inspection, merge skipped.`,
    )
  }
  await deps.mergeWorktree(config.repoRoot, `review-loop/${runState.runId}`)
  await deps.removeWorktree(config.repoRoot, runState.worktreePath, runState.runId)
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

interface SpawnCtx {
  readonly child: ChildProcess
  stdout: string
  stderr: string
  pending: string
  timedOut: boolean
  timer: ReturnType<typeof setTimeout> | null
  killTimer: ReturnType<typeof setTimeout> | null
  readonly onLine?: LineSink
}

function setupKillTimers(ctx: SpawnCtx, options: { timeout?: number; killGraceMs?: number }): void {
  const grace = options.killGraceMs ?? 5000
  if (options.timeout === undefined || options.timeout <= 0) return
  ctx.timer = setTimeout(() => {
    ctx.timedOut = true
    killGroup(ctx.child, 'SIGTERM')
    ctx.killTimer = setTimeout(() => {
      killGroup(ctx.child, 'SIGKILL')
    }, grace)
  }, options.timeout)
}

function clearKillTimers(ctx: SpawnCtx): void {
  if (ctx.timer !== null) clearTimeout(ctx.timer)
  if (ctx.killTimer !== null) clearTimeout(ctx.killTimer)
}

export const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const ctx: SpawnCtx = {
      child: spawn(command, [...args], {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }),
      stdout: '',
      stderr: '',
      pending: '',
      timedOut: false,
      timer: null,
      killTimer: null,
      onLine,
    }
    setupKillTimers(ctx, options)
    ctx.child.stdout?.on('data', (chunk: Buffer) => {
      ctx.stdout += chunk.toString()
      const split = splitLines(ctx.pending, chunk.toString())
      ctx.pending = split.remaining
      for (const line of split.lines) {
        ctx.onLine?.(line)
      }
    })
    ctx.child.stderr?.on('data', (chunk: Buffer) => {
      ctx.stderr += chunk.toString()
    })
    ctx.child.on('error', (err: Error) => {
      clearKillTimers(ctx)
      resolve({ exitCode: 1, stdout: ctx.stdout, stderr: ctx.stderr + err.message })
    })
    ctx.child.on('close', (code, signal) => {
      clearKillTimers(ctx)
      if (ctx.pending.length > 0) {
        ctx.onLine?.(ctx.pending)
      }
      if (ctx.timedOut) {
        resolve({
          exitCode: 1,
          stdout: ctx.stdout,
          stderr: `${ctx.stderr}Process timed out after ${options.timeout}ms\n`,
        })
        return
      }
      resolve({ exitCode: code ?? (signal === null ? 0 : 1), stdout: ctx.stdout, stderr: ctx.stderr })
    })
  })
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

export async function writeRunArtifacts(runDir: string, result: ReviewLoopResult): Promise<void> {
  const summary = formatSummary(result)
  await writeFile(path.join(runDir, 'summary.txt'), `${summary}\n`)
  try {
    await writeFile(path.join(runDir, 'metrics.json'), `${JSON.stringify(buildMetricsJson(result), null, 2)}\n`)
  } catch (error) {
    console.warn(`[review-loop] metrics.json write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(summary)
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  })

  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, args.planPath)
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  await prepareWorktree(config, runState, args.resetWorktree)

  const log = new LiveRenderer(process.stdout)
  const exec = createShellExec(runState.worktreePath, config.checkCommand, config.buildTimeoutMs)
  const trace = createFileTraceLogger(runState.tracePath)

  try {
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: realSpawn,
      exec,
      log,
      trace,
    })

    await finalizeRun(config, runState, {
      exec,
      runBuildCheck,
      mergeWorktree,
      removeWorktree,
    })

    await writeRunArtifacts(runState.runDir, result)
  } catch (error) {
    console.error('Review loop failed:', error)
    console.error(`Worktree preserved at ${runState.worktreePath} for inspection.`)
    throw error
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
