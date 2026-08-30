// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { realSpawn } from '../../review-loop/src/spawn.js'
import { typedSpawn } from './agent-seam.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import type { DepthProfile } from './events.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldLog } from './kernel/fold.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { ExecFn } from './openspec-driver.js'
import { resumeRun } from './run-resume.js'
import { stopRunOperator } from './run-stop.js'
import type { OperatorStop } from './run-stop.js'
import { startRun, statusRun } from './run.js'
import type { RunDeps, RunStatus } from './run.js'
import { oneSecondTick } from './work/gate-waiter.js'
import { buildRunReport } from './work/report.js'

export function runCli(argv: readonly string[]): string {
  const runDir = argv[0]
  if (runDir === undefined || runDir.length === 0) {
    throw new Error('usage: afk-runner <runDir>')
  }
  const logPath = path.join(runDir, 'events.ndjson')
  if (!existsSync(logPath)) {
    throw new Error(`events.ndjson not found: ${logPath}`)
  }
  const { snapshot, accounting } = foldLog(pipelineMachine, logPath)
  const value = typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
  const lines: string[] = [
    `value: ${value}`,
    ...Object.entries(snapshot.context.stages).map(([stage, status]) => `${stage}: ${status}`),
    `events: ${accounting.total} (mapped ${accounting.mapped}, tolerated ${accounting.tolerated})`,
  ]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** The folded full-state summary the status command prints. */
export function fullStateSummary(status: RunStatus): string {
  const context = status.context
  const lines: string[] = [
    `value: ${status.position}`,
    ...Object.entries(context.stages).map(([stage, stageStatus]) => `${stage}: ${stageStatus}`),
    `depth: ${context.depth ?? 'unclassified'}`,
    `round: ${context.round === null ? 'none' : `${context.round.current}/${context.round.cap}`}`,
    `rounds recorded: ${context.perRound.length}`,
    `last verdict: ${context.lastVerdict === null ? 'none' : `${context.lastVerdict.verdict} (${context.lastVerdict.counts.blocker}b ${context.lastVerdict.counts.material}m ${context.lastVerdict.counts.nitpick}n)`}`,
    `gate: ${context.gate === null ? 'none' : `${context.gate.mode} v${context.gate.version}${context.gate.answered ? ' answered' : ' awaiting'}`}`,
    `halted: ${status.parked}`,
  ]
  return lines.join('\n')
}

const EXEC_GIT: ExecGitFn = (cwd, args) => {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return Promise.resolve({
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  })
}

const EXEC_OPENSPEC: ExecFn = (args, options) => {
  const proc = Bun.spawnSync([...args], {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return Promise.resolve({
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode ?? 1,
  })
}

export interface CliDeps extends RunDeps {
  readonly spawn: SpawnFn
}

/** Prototype CLI config: repo root is the cwd, the work dir sits beside it, model from the environment. */
export function defaultCliDeps(cwd: string = process.cwd()): CliDeps {
  const config: RunnerConfig = {
    repoRoot: cwd,
    workDir: path.join(cwd, '.afk-runner'),
    model: process.env['AFK_RUNNER_MODEL'] ?? 'opencode',
    budget: 5,
  }
  return {
    config,
    spawn: typedSpawn(realSpawn),
    execGit: EXEC_GIT,
    driver: createOpenSpecDriver({ exec: EXEC_OPENSPEC, cwd: config.repoRoot }),
    // The operator runs the CLI interactively — gate-pending parks keep the
    // process alive in the foreground waiter (C4 design D3).
    gateWait: { tick: oneSecondTick },
  }
}

function parseDepth(raw: string | undefined): DepthProfile | undefined {
  if (raw === undefined) return undefined
  if (raw === 'S' || raw === 'M' || raw === 'L') return raw
  throw new Error(`invalid --depth '${raw}' (expected S, M, or L)`)
}

export async function runStartCommand(deps: RunDeps, args: readonly string[]): Promise<string> {
  const taskFile = args[0]
  if (taskFile === undefined || taskFile.length === 0) {
    throw new Error('usage: afk-runner start <taskFile> [--depth S|M|L]')
  }
  const depthFlag = args.indexOf('--depth')
  const depthOverride = parseDepth(depthFlag === -1 ? undefined : args[depthFlag + 1])
  const result = await startRun(deps, { taskFile, depthOverride })
  const lines = [`run: ${result.runId}`, `halted: ${result.halted}`, `position: ${result.position}`]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

export async function runStatusCommand(deps: RunDeps, runId: string): Promise<string> {
  const status = await statusRun(deps, runId)
  const lines = [`run: ${runId}`, fullStateSummary(status)]
  if (status.parked === 'final') lines.push(`report: afk-runner report ${runId}`)
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** The passive report command (C5 D8): `report <runId> [--pr]` prints the summary without writing run state. */
export async function runReportCommand(deps: RunDeps, args: readonly string[]): Promise<string> {
  const runId = args[0]
  if (runId === undefined || runId.length === 0) throw new Error('usage: afk-runner report <runId> [--pr]')
  const pr = args.includes('--pr')
  const report = await buildRunReport({ config: deps.config, execGit: deps.execGit }, runId, pr)
  console.log(report)
  return report
}

export async function runResumeCommand(deps: RunDeps, runId: string): Promise<string> {
  const result = await resumeRun(deps, runId)
  const lines = [
    `run: ${result.runId}`,
    `halted: ${result.halted}`,
    `position: ${result.position}`,
    `resumed: ${result.drove ? 're-entered work' : 'already parked'}`,
  ]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** Outcome → the operator line the stop verb prints (C6 D7). */
export function stopMessageOf(result: OperatorStop, steerPath: string): string {
  if (result.kind === 'calm-requested') {
    return `calm stop requested for ${result.runId} — honored at the next boundary`
  }
  if (result.kind === 'aborted') {
    return `run ${result.runId} aborted by operator — the session id is released`
  }
  if (result.kind === 'gate-pending') {
    return `run ${result.runId} awaits a gate decision — write 'abort' to ${steerPath} to end it`
  }
  return `run ${result.runId} is already final (${result.position}) — nothing to stop`
}

/** The stop verb (C6 D7): calm-stop marker for live runs, `run_abort` for dead ones. */
export async function runStopCommand(deps: RunDeps, runId: string): Promise<string> {
  const result = await stopRunOperator(deps, runId)
  const steerPath = path.join(deps.config.workDir, 'runs', runId, 'steer.md')
  const summary = stopMessageOf(result, steerPath)
  console.log(summary)
  return summary
}

function printUsage(): void {
  console.log(
    [
      'usage:',
      '  afk-runner start <taskFile> [--depth S|M|L]   drive a fresh think-half run to park',
      '  afk-runner status <runId>                     print the folded full-state summary',
      '  afk-runner resume <runId>                     re-enter an interrupted or parked run',
      '  afk-runner stop <runId>                       calm-stop a live run; abort a dead one',
      '  afk-runner report <runId> [--pr]              print the passive run report',
      '  afk-runner <runDir>                           print the fold summary of a run dir',
    ].join('\n'),
  )
}

export function cliMain(argv: readonly string[]): Promise<string | undefined> {
  const [command, ...rest] = argv
  if (
    command === 'start' ||
    command === 'status' ||
    command === 'resume' ||
    command === 'report' ||
    command === 'stop'
  ) {
    const deps = defaultCliDeps()
    if (command === 'start') return runStartCommand(deps, rest)
    if (command === 'report') return runReportCommand(deps, rest)
    if (command === 'stop') {
      const runId = rest[0]
      if (runId === undefined || runId.length === 0) throw new Error('usage: afk-runner stop <runId>')
      return runStopCommand(deps, runId)
    }
    const runId = rest[0]
    if (runId === undefined || runId.length === 0) throw new Error(`usage: afk-runner ${command} <runId>`)
    return command === 'status' ? runStatusCommand(deps, runId) : runResumeCommand(deps, runId)
  }
  if (argv.length === 1 && argv[0] !== 'help') return Promise.resolve(runCli(argv))
  printUsage()
  return Promise.resolve(undefined)
}

const argv = process.argv.slice(2)
if (argv.length > 0 && import.meta.main) {
  void cliMain(argv)
}
