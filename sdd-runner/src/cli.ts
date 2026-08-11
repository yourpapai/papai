// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DepthProfile } from './events.js'
import type { RunGateResumeResult, RunResumeResult, RunStartResult, StartOptions } from './orchestrator.js'
import type { GateResumeOptions } from './orchestrator.js'
import type { Verbosity } from './renderer.js'

export interface CliHarness {
  readonly runStart: (options: StartOptions) => Promise<RunStartResult>
  readonly runResume: (runId: string) => Promise<RunResumeResult>
  readonly runGateResume: (runId: string, options: GateResumeOptions) => Promise<RunGateResumeResult>
  readonly buildReport: (runId: string, pr: boolean) => Promise<string>
  readonly stdout: (line: string) => void
}

export async function main(argv: readonly string[], harness: CliHarness): Promise<number> {
  const cmd = parseCliArgs(argv)
  if (cmd.subcommand === 'start') {
    await harness.runStart({ taskFile: cmd.taskFile, depthOverride: cmd.depth })
    return 0
  }
  if (cmd.subcommand === 'resume') {
    await harness.runResume(cmd.runId)
    return 0
  }
  if (cmd.subcommand === 'gate') {
    await harness.runGateResume(cmd.runId, { confirmAll: cmd.confirmAll, abort: cmd.abort })
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
    }
  | { readonly subcommand: 'resume'; readonly runId: string }
  | { readonly subcommand: 'gate'; readonly runId: string; readonly confirmAll: boolean; readonly abort: boolean }
  | { readonly subcommand: 'report'; readonly runId: string; readonly pr: boolean }

const VALID_SUBCOMMANDS = new Set(['start', 'resume', 'gate', 'report'])

const DEPTH_VALUES: Record<string, DepthProfile> = { S: 'S', M: 'M', L: 'L' }
const VERBOSITY_VALUES: Record<string, Verbosity> = { brief: 'brief', normal: 'normal', debug: 'debug' }

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
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  return { subcommand: 'start', taskFile, depth, verbosity }
}

function parseGate(args: readonly string[]): CliCommand {
  if (args[1] !== 'resume') throw new Error('gate requires: gate resume <runId>')
  const runId = args[2]
  if (runId === undefined) throw new Error('gate resume requires a run id')
  let confirmAll = false
  let abort = false
  for (let i = 3; i < args.length; i += 1) {
    if (args[i] === '--confirm-all') confirmAll = true
    else if (args[i] === '--abort') abort = true
    else throw new Error(`unknown flag: ${args[i]}`)
  }
  return { subcommand: 'gate', runId, confirmAll, abort }
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
  if (subcommand === undefined) throw new Error('missing subcommand: start | resume | gate | report')
  if (!VALID_SUBCOMMANDS.has(subcommand)) throw new Error(`unknown subcommand: ${subcommand}`)
  if (subcommand === 'start') return parseStart(args)
  if (subcommand === 'gate') return parseGate(args)
  if (subcommand === 'report') return parseReport(args)
  const runId = args[1]
  if (runId === undefined) throw new Error('resume requires a run id')
  return { subcommand: 'resume', runId }
}
