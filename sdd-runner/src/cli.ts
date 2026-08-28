// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveTarget } from './cli-routing.js'
import type { DepthProfile } from './events.js'
import type {
  RunContinueResult,
  RunGateResumeResult,
  RunResumeResult,
  RunStartResult,
  StartOptions,
} from './orchestrator.js'
import type { AutonomyOverrides } from './orchestrator.js'
import { stopRunMessage } from './stop-controller.js'
import type { StopRunResult } from './stop-controller.js'

export interface GateReopenResult {
  readonly runId: string
  readonly gateVersion: number
}

export interface CliHarness {
  /** The work dir routing decisions are made against. */
  readonly workDir: string
  readonly runStart: (options: StartOptions) => Promise<RunStartResult>
  readonly runResume: (runId: string, autonomy?: AutonomyOverrides) => Promise<RunResumeResult>
  readonly runGateResume: (runId: string) => Promise<RunGateResumeResult>
  readonly runContinue: (runId: string | null, autonomy?: AutonomyOverrides) => Promise<RunContinueResult>
  readonly buildReport: (runId: string, pr: boolean) => Promise<string>
  /** Liveness-aware stop (stop-dead-runs D2): live → marker, dead → settled. */
  readonly requestCalmStop: (runId: string) => Promise<StopRunResult>
  readonly runGateReopen: (runId: string, gateVersion: number) => Promise<GateReopenResult>
  readonly stdout: (line: string) => void
  /** A live terminal owns stdin — enables the interactive session screen paths. */
  readonly interactive?: () => boolean
  /**
   * The session screen loop: one call owns the whole interactive surface
   * (list ⇄ create, actions, notices) and resolves only on explicit quit.
   */
  readonly sessionLoop?: (options: {
    readonly initial: 'list' | 'create'
    readonly depth?: DepthProfile
    readonly plan?: true
  }) => Promise<void>
  /** Version of the run's most recently answered gate, null when none settled. */
  readonly latestSettledGateVersion?: (runId: string) => Promise<number | null>
}

export interface ParsedRoute {
  readonly target: string | undefined
  readonly verb: 'route' | 'stop'
  readonly depth?: DepthProfile
  /** Operator routing override (D3): force the plan branch at intake. */
  readonly plan?: true
  readonly configPath?: string
  readonly pr: boolean
  readonly reopen?: true | number
}

const DEPTH_VALUES: Record<string, DepthProfile> = { S: 'S', M: 'M', L: 'L' }

export function parseSddArgs(argv: readonly string[]): ParsedRoute {
  const args = [...argv]
  const { verb, target, rest } = parseTargetArg(args)
  let i = rest
  for (; i < args.length && args[i]?.startsWith('-') !== true; i += 1) {
    rejectLegacyShape(verb, target, args[i] ?? '')
  }
  return { target, verb, ...parseFlagArgs(args, i) }
}

function parseTargetArg(args: readonly string[]): {
  readonly verb: 'route' | 'stop'
  readonly target: string | undefined
  readonly rest: number
} {
  if (args[0] === 'stop') {
    if (args[1] !== undefined && !args[1].startsWith('-')) return { verb: 'stop', target: args[1], rest: 2 }
    return { verb: 'stop', target: undefined, rest: 1 }
  }
  if (args[0] !== undefined && !args[0].startsWith('-')) return { verb: 'route', target: args[0], rest: 1 }
  return { verb: 'route', target: undefined, rest: 0 }
}

function rejectLegacyShape(verb: 'route' | 'stop', target: string | undefined, positional: string): void {
  if (verb === 'route' && target !== undefined && LEGACY_SUBCOMMANDS.has(target)) {
    throw new Error(
      `the '${target}' subcommand was removed: use 'sdd <task-file>' to start, 'sdd <run-id>' to route by state, 'sdd stop [<id>]' to calm-stop`,
    )
  }
  throw new Error(`unexpected positional argument: ${positional} — the surface is: sdd [<target>] [flags]`)
}

interface FlagState {
  readonly depth?: DepthProfile
  readonly plan?: true
  readonly configPath?: string
  readonly pr: boolean
  readonly reopen?: true | number
}

function parseFlagArgs(args: readonly string[], start: number): FlagState {
  let depth: DepthProfile | undefined
  let plan: true | undefined
  let configPath: string | undefined
  let pr = false
  let reopen: true | number | undefined
  for (let i = start; i < args.length; i += 1) {
    const arg = args[i] ?? ''
    if (arg === '--depth') {
      const val = args[i + 1] ?? ''
      const depthValue = DEPTH_VALUES[val]
      if (depthValue === undefined) throw new Error(`invalid --depth: ${val} (S|M|L)`)
      depth = depthValue
      i += 1
    } else if (arg === '--plan') {
      plan = true
    } else if (arg === '--config') {
      configPath = args[i + 1]
      if (configPath === undefined) throw new Error('--config requires a path')
      i += 1
    } else if (arg === '--pr') {
      pr = true
    } else if (arg === '--reopen') {
      const next = args[i + 1]
      if (next !== undefined && /^\d+$/u.test(next)) {
        reopen = Number(next)
        i += 1
      } else {
        reopen = true
      }
    } else if (REMOVED_FLAGS.has(arg)) {
      throw new Error(
        `${arg} was removed: hand-edit the gate file (gate-<n>.md) as the non-interactive decision path, then rerun \`sdd <run-id>\``,
      )
    } else {
      throw new Error(`unknown flag: ${arg} (valid: --depth S|M|L, --plan, --config <path>, --pr, --reopen [<n>])`)
    }
  }
  if (plan !== undefined && depth !== undefined) {
    throw new Error('--plan and --depth conflict: a forced plan branch cannot take an explicit depth')
  }
  return {
    ...(depth === undefined ? {} : { depth }),
    ...(plan === undefined ? {} : { plan }),
    ...(configPath === undefined ? {} : { configPath }),
    pr,
    ...(reopen === undefined ? {} : { reopen }),
  }
}

const LEGACY_SUBCOMMANDS = new Set(['start', 'resume', 'gate', 'continue', 'report', 'audit', 'watch'])

const REMOVED_FLAGS = new Set([
  '--confirm-all',
  '--abort',
  '--extend',
  '--veto',
  '--wait-deadline',
  '--no-wait',
  '--autonomy',
  '--verbosity',
])

function requireSessionLoop(
  harness: CliHarness,
): (options: {
  readonly initial: 'list' | 'create'
  readonly depth?: DepthProfile
  readonly plan?: true
}) => Promise<void> {
  if (harness.sessionLoop === undefined) {
    throw new Error('interactive session screen requires a harness with sessionLoop (TTY only)')
  }
  return harness.sessionLoop
}

async function runInteractive(
  initial: 'list' | 'create',
  harness: CliHarness,
  depth?: DepthProfile,
  plan?: true,
): Promise<number> {
  const loop = requireSessionLoop(harness)
  await loop({ initial, ...(depth === undefined ? {} : { depth }), ...(plan === undefined ? {} : { plan }) })
  return 0
}

export async function main(argv: readonly string[], harness: CliHarness): Promise<number> {
  const parsed = parseSddArgs(argv)
  const tty = harness.interactive?.() === true
  if (parsed.verb === 'stop') {
    const action = await resolveTarget({ workDir: harness.workDir, target: parsed.target, verb: 'stop' })
    if (action.kind !== 'stop') throw new Error('stop requires an active run')
    const result = await harness.requestCalmStop(action.runId)
    harness.stdout(stopRunMessage(result))
    return 0
  }
  const action = await resolveTarget({ workDir: harness.workDir, target: parsed.target, tty })
  if (action.kind === 'select') return runInteractive('list', harness, parsed.depth, parsed.plan)
  if (action.kind === 'create') return runInteractive('create', harness, parsed.depth, parsed.plan)
  if (parsed.reopen !== undefined) {
    if (action.kind === 'start') rejectStartReopen()
    if (action.kind !== 'gate' && action.kind !== 'resume' && action.kind !== 'report') {
      throw new Error('unroutable target for --reopen')
    }
    const version = parsed.reopen === true ? 1 : parsed.reopen
    await harness.runGateReopen(action.runId, version)
    return 0
  }
  if (action.kind === 'start') {
    await harness.runStart({
      taskFile: action.taskFile,
      ...(parsed.depth === undefined ? {} : { depthOverride: parsed.depth }),
      ...(parsed.plan === undefined ? {} : { forcePlan: true }),
    })
    return 0
  }
  if (action.kind === 'gate') {
    await harness.runGateResume(action.runId)
    return 0
  }
  if (action.kind === 'resume') {
    await harness.runResume(action.runId)
    return 0
  }
  const body = await harness.buildReport(action.runId, parsed.pr)
  harness.stdout(body)
  return 0
}

function rejectStartReopen(): never {
  throw new Error('--reopen applies to a run, not a task file')
}
