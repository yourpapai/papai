// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { flattenPosition } from './drive/loop.js'
import type { ParkedReason } from './drive/loop.js'
import type { SddEvent } from './events.js'
import { readEvents } from './events.js'
import type { StageId } from './events.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldEvents } from './kernel/fold.js'
import type { KernelContext } from './kernel/machine.js'
import type { RunState } from './run-state.js'
import { resolveRoundCap, saveRunState } from './run-state.js'

interface MemoSeed {
  readonly runId: string
  readonly workDir: string
  readonly repoRoot: string
  readonly changeName: string
  readonly createdAt: string
  /** Run-analysis D5: a runtime input riding the seed — never a fold projection. */
  readonly metered?: boolean
}

export function logPathOf(runDir: string): string {
  return path.join(runDir, 'events.ndjson')
}

/**
 * Terminal parks map to the memo's terminal statuses (C5 D6): session-id
 * release follows through TERMINAL_STATUSES. C6 D8: an abort settled at an
 * escalation gate is failure-caused terminal — the dormant `failed` status
 * finally means something (the agent couldn't do the job) vs `aborted` (a
 * human chose to stop).
 */
function memoStatusOf(
  halted: ParkedReason,
  position: string,
  failureCaused: boolean,
): 'running' | 'stopped' | 'completed' | 'aborted' | 'failed' {
  if (halted === 'final' && position === 'aborted') return failureCaused ? 'failed' : 'aborted'
  if (halted === 'final') return 'completed'
  if (halted === 'stopped') return 'stopped'
  return 'running'
}

export interface MemoFields {
  readonly stage: StageId
  readonly depth: KernelContext['depth']
  readonly round: number
  readonly roundCap: number
  readonly gate: { readonly mode: 'early' | 'final' | 'plan' | 'escalation'; readonly version: number } | null
  readonly status: 'running' | 'stopped' | 'completed' | 'aborted' | 'failed'
  readonly createdAt: string
  readonly updatedAt: string
  readonly autoExtendsUsed: number
  readonly gateDeadlineAt: string | null
  readonly gateDeadlineReArmed: boolean
  readonly plan: { readonly childCount: number; readonly digest: string } | null
  readonly children: Readonly<Record<string, { readonly status: 'pending' | 'running' | 'done' | 'failed' }>> | null
}

/** The last plan event's payload (childCount + digest) — the memo projects the dormant plan fields, no producer exists (U2). */
function lastPlanOf(events: readonly SddEvent[]): MemoFields['plan'] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && event.type === 'plan') return { childCount: event.childCount, digest: event.digest }
  }
  return null
}

/**
 * The memo projection as a pure function of the log (C5 D7 — parity
 * complete): every field sdd-runner persisted derives from the events and
 * the folded context. Terminal rules reconciled against the real persisted
 * `state.json`s: `gate` nulls at terminal status (legacy nulls at finalize),
 * `stage` holds the last ENTERED stage rather than the final position
 * (legacy completed runs say `gate`, not `completed`), and the deadline
 * residues mirror the fold's non-projected context.
 */
export function memoFieldsOf(
  events: readonly SddEvent[],
  context: KernelContext,
  halted: ParkedReason,
  position: string,
): MemoFields {
  const lastEnter = [...events].reverse().find((event) => event.type === 'stage_enter')
  // Failure-caused terminal (C6 D8), derived from the events: an answered
  // abort at an escalation-mode gate. Parity-free — no historical run ever
  // persisted `failed`.
  const failureCaused = events.some(
    (event) =>
      event.type === 'gate' && event.action === 'answered' && event.outcome === 'abort' && event.mode === 'escalation',
  )
  return {
    stage: lastEnter !== undefined && lastEnter.type === 'stage_enter' ? lastEnter.stage : 'intake',
    depth: context.depth,
    round: context.round?.current ?? 0,
    roundCap: context.round?.cap ?? resolveRoundCap({ depth: context.depth }),
    gate:
      halted === 'final' || context.gate === null ? null : { mode: context.gate.mode, version: context.gate.version },
    status: memoStatusOf(halted, position, failureCaused),
    createdAt: events[0]?.ts ?? new Date().toISOString(),
    updatedAt: events[events.length - 1]?.ts ?? new Date().toISOString(),
    autoExtendsUsed: context.autoDecisions.filter((record) => record.decision === 'extend').length,
    gateDeadlineAt: context.gateDeadlineAt,
    gateDeadlineReArmed: context.gateDeadlineReArmed,
    plan: lastPlanOf(events),
    children: Object.keys(context.children).length === 0 ? null : context.children,
  }
}

/**
 * The derived memo (design D6): written after appends as a pure projection of
 * the log — stage from the last entered stage, round and gate from context,
 * timestamps from the first and last events. Never read for control flow; a
 * missing or stale copy changes nothing.
 */
export async function writeRunMemo(
  seed: MemoSeed,
  halted: ParkedReason,
  position: string,
  context: KernelContext,
  logPath: string,
): Promise<void> {
  const events = readEventsOf(logPath)
  const runDir = path.join(seed.workDir, 'runs', seed.runId)
  const memo: RunState = {
    runId: seed.runId,
    repoRoot: seed.repoRoot,
    workDir: seed.workDir,
    changeName: seed.changeName,
    ...(seed.metered === undefined ? {} : { metered: seed.metered }),
    ...memoFieldsOf(events, context, halted, position),
    createdAt: events[0]?.ts ?? seed.createdAt,
    updatedAt: events[events.length - 1]?.ts ?? seed.createdAt,
    runDir,
    statePath: path.join(runDir, 'state.json'),
  }
  await saveRunState(memo, new Date(memo.updatedAt))
}

export function foldRun(logPath: string): {
  readonly context: KernelContext
  readonly position: string
  readonly createdAt: string | null
} {
  const events = readEventsOf(logPath)
  const snapshot = foldEvents(pipelineMachine, events).snapshot
  return {
    context: snapshot.context,
    position: flattenPosition(snapshot.value),
    createdAt: events[0]?.ts ?? null,
  }
}

export function readEventsOf(logPath: string): readonly SddEvent[] {
  return existsSync(logPath) ? readEvents(logPath) : []
}

export type { MemoSeed }
