// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'

import { readEvents } from '../events.js'
import type { SddEvent } from '../events.js'
import { initialStep, step } from './machine.js'
import type { KernelEvent, KernelMachine, KernelSnapshot } from './machine.js'

export interface FoldAccounting {
  readonly total: number
  readonly mapped: number
  readonly tolerated: number
}

export interface FoldResult {
  readonly snapshot: KernelSnapshot
  readonly accounting: FoldAccounting
}

export function toKernelEvent(event: SddEvent): KernelEvent | null {
  if (event.type === 'stage_enter') return { type: 'stage.enter', stage: event.stage }
  if (event.type === 'stage_exit') return { type: 'stage.exit', stage: event.stage }
  if (event.type === 'stage_failed') return { type: 'stage.failed', stage: event.stage, kind: event.kind }
  if (event.type === 'depth') return { type: 'depth', profile: event.profile }
  if (event.type === 'round_open') return { type: 'round.open', round: event.round, cap: event.cap }
  if (event.type === 'round_close') return { type: 'round.close', round: event.round, cap: event.cap }
  if (event.type === 'finding') return { type: 'finding', action: event.action, round: event.round }
  if (event.type === 'convergence') {
    return { type: 'convergence', round: event.round, verdict: event.verdict, counts: event.counts }
  }
  if (event.type === 'gate' && event.action === 'presented') {
    return {
      type: 'gate.presented',
      mode: event.mode,
      version: event.version,
      ...(event.deadlineAt === undefined ? {} : { deadlineAt: event.deadlineAt }),
    }
  }
  if (event.type === 'gate' && event.action === 'answered') {
    return { type: 'gate.answered', ...(event.outcome === undefined ? {} : { outcome: event.outcome }) }
  }
  if (event.type === 'gate' && event.action === 'rearmed') {
    return { type: 'gate.rearmed', version: event.version, deadlineAt: event.deadlineAt ?? '' }
  }
  if (event.type === 'auto_decision') {
    return {
      type: 'auto.decision',
      rule: event.rule,
      decision: event.decision,
      evidenceDigest: event.evidenceDigest,
      gateVersion: event.gateVersion,
      seq: event.seq,
      ts: event.ts,
    }
  }
  if (event.type === 'plan') return { type: 'plan' }
  if (event.type === 'run_abort') return { type: 'run.abort' }
  if (event.type === 'child_spawned') return { type: 'child.spawned', child: event.child }
  if (event.type === 'child_done') return { type: 'child.done', child: event.child, outcome: event.outcome }
  return null
}

export function foldEvents(machine: KernelMachine, events: readonly SddEvent[]): FoldResult {
  let snapshot = initialStep(machine)[0]
  let mapped = 0
  let tolerated = 0
  for (const event of events) {
    const kernelEvent = toKernelEvent(event)
    if (kernelEvent === null) {
      tolerated += 1
      continue
    }
    mapped += 1
    snapshot = step(machine, snapshot, kernelEvent)[0]
  }
  return { snapshot, accounting: { total: events.length, mapped, tolerated } }
}

export function foldLog(machine: KernelMachine, logPath: string): FoldResult {
  return foldEvents(machine, readEvents(logPath))
}

/** Fold the log at path, treating a not-yet-created log as empty (fresh-run boot, append probes). */
export function foldLogOrInitial(machine: KernelMachine, logPath: string): FoldResult {
  if (!existsSync(logPath)) return foldEvents(machine, [])
  return foldLog(machine, logPath)
}
