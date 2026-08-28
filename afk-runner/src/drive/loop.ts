// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { EventInput, SddEvent, StageId } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import type { KernelContext, KernelMachine, KernelSnapshot } from '../kernel/machine.js'
import { createAppendBoundary } from './boundary.js'
import type { AppendBoundary } from './boundary.js'
import { declaredFailureOf, escalationOwed } from './failure-budget.js'

/**
 * Park vocabulary (C5 D6): `gate-pending` — a presented gate awaits an
 * answer; `stopped` — a calm stop; `final` — the machine reached a final
 * (completed/aborted) or an unknown position parks defensively. The tail
 * declaring work retired the old `awaiting-tail`; the append boundary's
 * refusal remains the alarm for genuinely illegal movement.
 */
export type ParkedReason = 'final' | 'gate-pending' | 'stopped'

export type Successor = { readonly enter: string } | { readonly park: ParkedReason }

export interface WorkIO {
  /** Validated append: the only write path to the log. */
  readonly append: (event: EventInput) => SddEvent
  /** Folded context at the moment this work run was entered. */
  readonly context: KernelContext
  /** Run directory for scratch files (steer markers, session ledger). */
  readonly runDir: string
}

export interface WorkSpec {
  /** Work kind — data identifying what runs (scheduling by registry query, design D3). */
  readonly kind: string
  readonly run: (io: WorkIO) => void | Promise<void>
}

export interface StateModule {
  readonly work: WorkSpec | null
  /** Pure reader of folded context → outcome key; the single decision input for live runs and resumes alike. */
  readonly outcomeOf: (context: KernelContext) => string
  readonly successors: Readonly<Record<string, Successor>>
}

export type WorkFor = (state: string) => StateModule | null

export interface StopSeam {
  readonly stopRequested: () => boolean
  readonly consumeMarker?: () => void
}

export interface DriveDeps {
  readonly machine: KernelMachine
  readonly logPath: string
  readonly stop?: StopSeam
  readonly now?: () => Date
}

export interface DriveResult {
  readonly position: string
  readonly context: KernelContext
  readonly parked: ParkedReason
}

function stageEnter(stage: string): EventInput {
  return { altitude: 'L2', type: 'stage_enter', stage: stage as StageId }
}

function stageExit(stage: string): EventInput {
  return { altitude: 'L2', type: 'stage_exit', stage: stage as StageId }
}

function foldCurrent(deps: DriveDeps): KernelSnapshot {
  return foldLogOrInitial(deps.machine, deps.logPath).snapshot
}

/**
 * The drivable position key: a plain string passes through; a compound
 * snapshot value (C4's `{ gate: 'awaiting' }` is the first) flattens to a
 * dot-path (`gate.awaiting`) so the work registry stays a flat string map.
 */
export function positionOf(snapshot: KernelSnapshot): string {
  return flattenPosition(snapshot.value)
}

export function flattenPosition(value: KernelSnapshot['value']): string {
  if (typeof value === 'string') return value
  return Object.entries(value)
    .map(([parent, child]) => `${parent}.${String(child)}`)
    .join('.')
}

interface LoopState {
  /** True once this drive call has appended an enter — a successor-entered state must not re-enter. */
  entered: boolean
}

type BracketResult =
  | { readonly kind: 'stopped'; readonly context: KernelContext }
  | { readonly kind: 'settled'; readonly successor: Successor; readonly context: KernelContext }

/**
 * Open the work bracket (appending the enter unless this drive already entered
 * the state — resume re-entry appends the graph's own self-loop), run the
 * work, close the bracket, and resolve the settled successor from the folded
 * context.
 *
 * C6 failure catch (D2/D3): a classified failure appends `stage_failed` and
 * skips the exit append — the bracket stays open, the stage map untouched
 * (failure is crash-shaped by design; the stage still owes work). Under
 * budget the settled successor re-enters this stage (the self-successor
 * re-run); over budget it parks gate-pending for the escalation presentation.
 * Untyped errors rethrow unchanged — refusal-alarm crash semantics.
 */
async function runWorkBracket(
  deps: DriveDeps,
  boundary: AppendBoundary,
  loop: LoopState,
  position: string,
  module: StateModule,
  snapshot: KernelSnapshot,
): Promise<BracketResult> {
  const bracketOpen = snapshot.context.stages[position] === 'active'
  if (!bracketOpen || !loop.entered) {
    boundary.append(stageEnter(position))
    loop.entered = true
  }
  const runDir = path.dirname(deps.logPath)
  try {
    await module.work?.run({ append: boundary.append, context: snapshot.context, runDir })
  } catch (error) {
    const failure = declaredFailureOf(error)
    if (failure === null) throw error
    boundary.append({
      altitude: 'L2',
      type: 'stage_failed',
      stage: position as StageId,
      kind: failure.kind,
      reason: failure.reason,
      ...(failure.resumeHint === undefined ? {} : { resumeHint: failure.resumeHint }),
    })
    const failed = foldCurrent(deps)
    if (escalationOwed(failed.context, position)) {
      return { kind: 'settled', successor: { park: 'gate-pending' }, context: failed.context }
    }
    return { kind: 'settled', successor: { enter: position }, context: failed.context }
  }
  boundary.append(stageExit(position))
  if (deps.stop?.stopRequested() === true) {
    deps.stop.consumeMarker?.()
    return { kind: 'stopped', context: foldCurrent(deps).context }
  }
  const settled = foldCurrent(deps)
  const settledOutcome = module.outcomeOf(settled.context)
  const successor = module.successors[settledOutcome] ?? null
  if (successor === null) {
    throw new Error(`work at '${position}' completed with unmapped outcome '${settledOutcome}'`)
  }
  return { kind: 'settled', successor, context: settled.context }
}

/**
 * The generic drive loop (design D1/D2/D3): derive the next action solely from
 * the folded machine state and the work declared by the active state's module.
 * The loop names no stage; the enter/exit bracket is loop mechanics; after a
 * state's work completes, the successor-or-park rule applies (enter the
 * successor iff it declares work, else park). Resume is the same code path: a
 * fresh process re-folds, and work at an interrupted state re-runs via the
 * registry — the re-entry append is the graph's own self-loop edge. Continuation
 * form: each step either parks (returns) or recurses into the next position.
 */
export function drive(deps: DriveDeps, workFor: WorkFor): Promise<DriveResult> {
  const boundary: AppendBoundary = createAppendBoundary(deps.machine, deps.logPath, { now: deps.now })
  return driveStep(deps, workFor, boundary, { entered: false })
}

async function driveStep(
  deps: DriveDeps,
  workFor: WorkFor,
  boundary: AppendBoundary,
  loop: LoopState,
): Promise<DriveResult> {
  const snapshot = foldCurrent(deps)
  const position = positionOf(snapshot)
  if (snapshot.status === 'done') return { position, context: snapshot.context, parked: 'final' }
  const module = workFor(position)
  if (module === null) return { position, context: snapshot.context, parked: 'final' }

  let context = snapshot.context
  let successor: Successor | null = module.successors[module.outcomeOf(context)] ?? null
  // A self-successor means the state still owes its own work (the extended
  // round after a gate settle, a crashed mid-round): run the bracket rather
  // than re-entering — the outcome is indistinguishable from fresh entry.
  const selfEnter = successor !== null && 'enter' in successor && successor.enter === position
  if (successor === null || selfEnter) {
    if (module.work === null) {
      throw new Error(`workless state '${position}' has no successor for outcome '${module.outcomeOf(context)}'`)
    }
    const bracket = await runWorkBracket(deps, boundary, loop, position, module, snapshot)
    if (bracket.kind === 'stopped') {
      return { position, context: bracket.context, parked: 'stopped' }
    }
    successor = bracket.successor
    context = bracket.context
  }

  if ('park' in successor) {
    const parked = foldCurrent(deps)
    // The work may itself have finished the run (a ladder auto-settle during
    // the presentation) — a done snapshot parks final over the module's park.
    if (parked.status === 'done') return { position: positionOf(parked), context: parked.context, parked: 'final' }
    return { position: positionOf(parked), context: parked.context, parked: successor.park }
  }
  const target = successor.enter
  if (target === position) return driveStep(deps, workFor, boundary, loop)
  const targetModule = workFor(target)
  if (targetModule === null || targetModule.work === null) {
    return { position, context, parked: 'final' }
  }
  boundary.append(stageEnter(target))
  loop.entered = true
  return driveStep(deps, workFor, boundary, loop)
}
