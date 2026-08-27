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

export type ParkedReason = 'awaiting-tail' | 'gate-pending' | 'stopped'

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

function positionOf(snapshot: KernelSnapshot): string {
  return typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
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
  await module.work?.run({ append: boundary.append, context: snapshot.context, runDir })
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
  const module = workFor(position)
  if (module === null) return { position, context: snapshot.context, parked: 'awaiting-tail' }

  let context = snapshot.context
  let successor = module.successors[module.outcomeOf(context)] ?? null
  if (successor === null) {
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
    return { position, context: foldCurrent(deps).context, parked: successor.park }
  }
  const target = successor.enter
  const targetModule = workFor(target)
  if (targetModule === null || targetModule.work === null) {
    return { position, context, parked: 'awaiting-tail' }
  }
  boundary.append(stageEnter(target))
  loop.entered = true
  return driveStep(deps, workFor, boundary, loop)
}
