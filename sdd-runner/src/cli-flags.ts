// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AutonomyOverrides } from './cli.js'
import type { Verbosity } from './renderer.js'

const GATE_VERBOSITY_VALUES: Record<string, Verbosity> = {
  quiet: 'quiet',
  brief: 'brief',
  normal: 'normal',
  debug: 'debug',
}

function parseAutoDeadlineFlag(val: string): number {
  const minutes = Number(val)
  if (!Number.isFinite(minutes) || minutes <= 0 || String(minutes) !== val.trim()) {
    throw new Error(`invalid --auto-deadline: ${val}`)
  }
  return minutes
}

export interface TrailingFlags {
  readonly autoDeadlineMinutes?: number
  readonly verbosity?: 'quiet' | 'brief' | 'normal' | 'debug'
}

export function parseTrailingFlags(args: readonly string[], start: number): TrailingFlags {
  let autoDeadlineMinutes: number | undefined
  let verbosity: TrailingFlags['verbosity'] | undefined
  let i = start
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--autonomy') {
      throw new Error('the --autonomy flag was removed: autonomy is single-mode now (budget/deadline config keys)')
    } else if (arg === '--auto-deadline') {
      const val = args[i + 1] ?? ''
      autoDeadlineMinutes = parseAutoDeadlineFlag(val)
      i += 2
    } else if (arg === '--verbosity') {
      const val = args[i + 1] ?? ''
      const vb = GATE_VERBOSITY_VALUES[val]
      if (vb === undefined) throw new Error(`invalid --verbosity: ${val}`)
      verbosity = vb
      i += 2
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (autoDeadlineMinutes === undefined && verbosity === undefined) return {}
  return {
    ...(autoDeadlineMinutes === undefined ? {} : { autoDeadlineMinutes }),
    ...(verbosity === undefined ? {} : { verbosity }),
  }
}

export function autonomyOverridesOf(deadline: number | undefined): AutonomyOverrides {
  if (deadline === undefined) return {}
  return { deadlineMinutes: deadline }
}

export function parseVetoArg(raw: string): { id: string; redirect?: string } {
  const eq = raw.indexOf('=')
  if (eq <= 0) throw new Error(`--veto expects <id>=<redirect> (split on the first =): got "${raw}"`)
  const id = raw.slice(0, eq)
  const redirect = raw.slice(eq + 1)
  return redirect === '' ? { id } : { id, redirect }
}

interface GateResumeFlags {
  readonly confirmAll: boolean
  readonly abort: boolean
  readonly extend: boolean
  readonly waitDeadline: boolean
  readonly noWait: boolean
  readonly gateVerbosity: Verbosity | undefined
  readonly vetoes: { id: string; redirect?: string }[]
}

export function parseGateResumeFlags(args: readonly string[]): GateResumeFlags {
  let confirmAll = false
  let abort = false
  let extend = false
  let waitDeadline = false
  let noWait = false
  let gateVerbosity: Verbosity | undefined
  const vetoes: { id: string; redirect?: string }[] = []
  for (let i = 3; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--confirm-all') confirmAll = true
    else if (arg === '--abort') abort = true
    else if (arg === '--extend') extend = true
    else if (arg === '--wait-deadline') waitDeadline = true
    else if (arg === '--no-wait') noWait = true
    else if (arg === '--verbosity') {
      const val = args[i + 1] ?? ''
      const vb = GATE_VERBOSITY_VALUES[val]
      if (vb === undefined) throw new Error(`invalid --verbosity: ${val}`)
      gateVerbosity = vb
      i += 1
    } else if (arg === '--veto') {
      const raw = args[i + 1]
      if (raw === undefined) throw new Error('--veto expects <id>=<redirect>')
      vetoes.push(parseVetoArg(raw))
      i += 1
    } else throw new Error(`unknown flag: ${arg}`)
  }
  return { confirmAll, abort, extend, waitDeadline, noWait, gateVerbosity, vetoes }
}
