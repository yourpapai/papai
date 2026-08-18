// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AutonomyLevel } from './config.js'
import type { DepthProfile } from './events.js'
import type {
  RunContinueResult,
  RunGateResumeResult,
  RunResumeResult,
  RunStartResult,
  StartOptions,
} from './orchestrator.js'
import type { GateResumeOptions } from './orchestrator.js'
import type { Verbosity } from './renderer.js'
import type { PendingGateEntry } from './run-state.js'

export interface CliHarness {
  readonly runStart: (options: StartOptions) => Promise<RunStartResult>
  readonly runResume: (runId: string, autonomy?: AutonomyOverrides) => Promise<RunResumeResult>
  readonly runGateResume: (runId: string, options: GateResumeOptions) => Promise<RunGateResumeResult>
  readonly runContinue: (runId: string | null, autonomy?: AutonomyOverrides) => Promise<RunContinueResult>
  readonly listPendingGates: () => Promise<PendingGateEntry[]>
  readonly buildReport: (runId: string, pr: boolean) => Promise<string>
  readonly stdout: (line: string) => void
}

export interface AutonomyOverrides {
  readonly level?: AutonomyLevel
  readonly deadlineMinutes?: number
}

export async function main(argv: readonly string[], harness: CliHarness): Promise<number> {
  const cmd = parseCliArgs(argv)
  if (cmd.subcommand === 'start') {
    await harness.runStart({
      taskFile: cmd.taskFile,
      depthOverride: cmd.depth,
      verbosity: cmd.verbosity,
      ...autonomyOverridesOf(cmd.autonomy, cmd.autoDeadlineMinutes),
    })
    return 0
  }
  if (cmd.subcommand === 'resume') {
    await harness.runResume(cmd.runId, autonomyOverridesOf(cmd.autonomy, cmd.autoDeadlineMinutes))
    return 0
  }
  if (cmd.subcommand === 'continue') {
    await harness.runContinue(cmd.runId, autonomyOverridesOf(cmd.autonomy, cmd.autoDeadlineMinutes))
    return 0
  }
  if (cmd.subcommand === 'gate') {
    if (cmd.runId === null) {
      const pending = await harness.listPendingGates()
      if (pending.length === 0) harness.stdout('no runs await gate decisions')
      for (const entry of pending) {
        harness.stdout(
          `gate-pending: ${entry.runId}  (${entry.changeName}, gate v${entry.gateVersion}, updated ${entry.updatedAt})`,
        )
        harness.stdout(`  sdd-runner gate resume ${entry.runId}`)
      }
      return 0
    }
    await harness.runGateResume(cmd.runId, {
      ...(cmd.confirmAll ? { confirmAll: true } : {}),
      ...(cmd.abort ? { abort: true } : {}),
      ...(cmd.extend ? { extend: true } : {}),
      ...(cmd.vetoes.length > 0 ? { vetoes: cmd.vetoes } : {}),
    })
    return 0
  }
  const body = await harness.buildReport(cmd.runId, cmd.pr)
  harness.stdout(body)
  return 0
}

export type CliCommand =
  | {
      readonly subcommand: 'start'
      readonly taskFile: string
      readonly depth?: DepthProfile
      readonly verbosity: Verbosity
      readonly autonomy?: AutonomyLevel
      readonly autoDeadlineMinutes?: number
    }
  | {
      readonly subcommand: 'resume'
      readonly runId: string
      readonly autonomy?: AutonomyLevel
      readonly autoDeadlineMinutes?: number
    }
  | {
      readonly subcommand: 'continue'
      readonly runId: string | null
      readonly autonomy?: AutonomyLevel
      readonly autoDeadlineMinutes?: number
    }
  | {
      readonly subcommand: 'gate'
      readonly runId: string | null
      readonly confirmAll: boolean
      readonly abort: boolean
      readonly extend: boolean
      readonly vetoes: readonly { readonly id: string; readonly redirect?: string }[]
    }
  | { readonly subcommand: 'report'; readonly runId: string; readonly pr: boolean }

const VALID_SUBCOMMANDS = new Set(['start', 'resume', 'gate', 'continue', 'report'])

const DEPTH_VALUES: Record<string, DepthProfile> = { S: 'S', M: 'M', L: 'L' }
const VERBOSITY_VALUES: Record<string, Verbosity> = { brief: 'brief', normal: 'normal', debug: 'debug' }
const AUTONOMY_VALUES: Record<string, AutonomyLevel> = { observe: 'observe', assist: 'assist', auto: 'auto' }

interface ParsedAutonomyFlags {
  readonly autonomy?: AutonomyLevel
  readonly autoDeadlineMinutes?: number
}

function parseAutonomyFlag(val: string): AutonomyLevel {
  const level = AUTONOMY_VALUES[val]
  if (level === undefined) throw new Error(`invalid --autonomy: ${val}`)
  return level
}

function parseAutoDeadlineFlag(val: string): number {
  const minutes = Number(val)
  if (!Number.isFinite(minutes) || minutes <= 0 || String(minutes) !== val.trim()) {
    throw new Error(`invalid --auto-deadline: ${val}`)
  }
  return minutes
}

function parseAutonomyFlags(args: readonly string[], start: number): ParsedAutonomyFlags {
  let autonomy: AutonomyLevel | undefined
  let autoDeadlineMinutes: number | undefined
  let i = start
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--autonomy') {
      const val = args[i + 1] ?? ''
      autonomy = parseAutonomyFlag(val)
      i += 2
    } else if (arg === '--auto-deadline') {
      const val = args[i + 1] ?? ''
      autoDeadlineMinutes = parseAutoDeadlineFlag(val)
      i += 2
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (autonomy === undefined && autoDeadlineMinutes === undefined) return {}
  return {
    ...(autonomy === undefined ? {} : { autonomy }),
    ...(autoDeadlineMinutes === undefined ? {} : { autoDeadlineMinutes }),
  }
}

function autonomyOverridesOf(autonomy: AutonomyLevel | undefined, deadline: number | undefined): AutonomyOverrides {
  if (autonomy === undefined && deadline === undefined) return {}
  return {
    ...(autonomy === undefined ? {} : { level: autonomy }),
    ...(deadline === undefined ? {} : { deadlineMinutes: deadline }),
  }
}

function parseStart(args: readonly string[]): CliCommand {
  const taskFile = args[1]
  if (taskFile === undefined) throw new Error('start requires a task file path')
  let depth: DepthProfile | undefined
  let verbosity: Verbosity = 'normal'
  let i = 2
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--depth') {
      const val = args[i + 1] ?? ''
      const dp = DEPTH_VALUES[val]
      if (dp === undefined) throw new Error(`invalid --depth: ${val}`)
      depth = dp
      i += 2
    } else if (arg === '--verbosity') {
      const val = args[i + 1] ?? ''
      const vb = VERBOSITY_VALUES[val]
      if (vb === undefined) throw new Error(`invalid --verbosity: ${val}`)
      verbosity = vb
      i += 2
    } else if (arg === '--autonomy' || arg === '--auto-deadline') {
      break
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  const parsed = parseAutonomyFlags(args, i)
  return { subcommand: 'start', taskFile, depth, verbosity, ...parsed }
}

function parseVetoArg(raw: string): { id: string; redirect?: string } {
  const eq = raw.indexOf('=')
  if (eq <= 0) throw new Error(`--veto expects <id>=<redirect> (split on the first =): got "${raw}"`)
  const id = raw.slice(0, eq)
  const redirect = raw.slice(eq + 1)
  return redirect === '' ? { id } : { id, redirect }
}

function parseGate(args: readonly string[]): CliCommand {
  if (args[1] === undefined)
    return { subcommand: 'gate', runId: null, confirmAll: false, abort: false, extend: false, vetoes: [] }
  if (args[1] !== 'resume')
    throw new Error('gate requires: gate resume <runId> [flags] (or bare `gate` to list pending gates)')
  const runId = args[2]
  if (runId === undefined) throw new Error('gate resume requires a run id (or run bare `gate` to list pending gates)')
  let confirmAll = false
  let abort = false
  let extend = false
  const vetoes: { id: string; redirect?: string }[] = []
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--confirm-all') confirmAll = true
    else if (arg === '--abort') abort = true
    else if (arg === '--extend') extend = true
    else if (arg === '--veto') {
      const raw = args[i + 1]
      if (raw === undefined) throw new Error('--veto expects <id>=<redirect>')
      vetoes.push(parseVetoArg(raw))
      i += 1
    } else throw new Error(`unknown flag: ${arg}`)
  }
  if (extend && (confirmAll || abort || vetoes.length > 0)) {
    throw new Error('--extend cannot be combined with --confirm-all, --veto, or --abort')
  }
  return { subcommand: 'gate', runId, confirmAll, abort, extend, vetoes }
}

function parseReport(args: readonly string[]): CliCommand {
  const runId = args[1]
  if (runId === undefined) throw new Error('report requires a run id')
  let pr = false
  for (let i = 2; i < args.length; i += 1) {
    if (args[i] === '--pr') pr = true
    else throw new Error(`unknown flag: ${args[i]}`)
  }
  return { subcommand: 'report', runId, pr }
}

export function parseCliArgs(args: readonly string[]): CliCommand {
  const subcommand = args[0]
  if (subcommand === undefined) throw new Error('missing subcommand: start | resume | gate | continue | report')
  if (!VALID_SUBCOMMANDS.has(subcommand)) throw new Error(`unknown subcommand: ${subcommand}`)
  if (subcommand === 'start') return parseStart(args)
  if (subcommand === 'gate') return parseGate(args)
  if (subcommand === 'report') return parseReport(args)
  if (subcommand === 'continue') {
    const flagStart = hasPositionalRunId(args) ? 2 : 1
    const parsed = parseAutonomyFlags(args, flagStart)
    const runId: string | null = hasPositionalRunId(args) ? args[1]! : null
    return { subcommand: 'continue', runId, ...parsed }
  }
  const runId = args[1]
  if (runId === undefined) throw new Error('resume requires a run id')
  const parsed = parseAutonomyFlags(args, 2)
  return { subcommand: 'resume', runId, ...parsed }
}

function hasPositionalRunId(args: readonly string[]): boolean {
  const first = args[1]
  return first !== undefined && !first.startsWith('--')
}
