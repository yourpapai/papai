// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { foldOf, knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import { flattenPosition } from './drive/loop.js'
import type { ParkedReason } from './drive/loop.js'
import type { SddEvent } from './events.js'
import { memoFieldsOf } from './memo-project.js'
import { resolveRoundCap } from './run-state.js'
import { looksAnswered } from './work/gate-waiter.js'

/**
 * Gate forensics (D4): settle-origin attribution by emission order — the
 * prelude emits its `auto_decision` *before* the settle seam appends `gate
 * answered`; the deadline waiter emits *after* its write. Per gate version:
 * a settle-kind record before its answered event → policy; after → waiter;
 * answered with no settle record → human. The unconditional waiter
 * fingerprints (`rule:'none' decision:'pending'` records, `gate rearmed`
 * events) cover the non-settling paths. Both producers' emission order is
 * pinned by tests in their own suites so this join cannot silently rot.
 */

type GateMode = 'early' | 'final' | 'plan' | 'escalation'

export interface GateAnswerForensic {
  readonly version: number
  readonly mode: GateMode
  readonly latencyMs: number
  readonly settledBy: 'human' | 'policy' | 'waiter'
  readonly rule: string | null
}

export interface GateNeverAnswered {
  readonly version: number
  readonly mode: GateMode
  readonly ageMs: number
}

export interface GateExtendForensic {
  readonly version: number
  readonly origin: 'human' | 'policy' | 'waiter'
  readonly rule: string | null
}

export interface GateForensics {
  readonly answered: readonly GateAnswerForensic[]
  readonly neverAnswered: readonly GateNeverAnswered[]
  readonly extends: readonly GateExtendForensic[]
  readonly autoDecisionsByRule: Readonly<Record<string, number>>
  readonly waiterPendingRecords: number
  readonly waiterRearms: number
}

const GATE_ABORT_RE = /^\s*ABORT\s*$/mu
const GATE_EXTEND_RE = /^\s*→ RUN 1 MORE\s*$/mu

export function gateFileOutcome(md: string): 'abort' | 'extend' | 'answered' | 'pending' {
  if (GATE_ABORT_RE.test(md)) return 'abort'
  if (GATE_EXTEND_RE.test(md)) return 'extend'
  if (looksAnswered(md)) return 'answered'
  return 'pending'
}

interface AutoRecord {
  readonly seq: number
  readonly rule: string
  readonly decision: string
}

interface GateEventMaps {
  readonly presentedAt: ReadonlyMap<number, string>
  readonly answeredAt: ReadonlyMap<number, string>
  readonly answeredSeq: ReadonlyMap<number, number>
  readonly modeOf: ReadonlyMap<number, GateMode>
  readonly autoBy: ReadonlyMap<number, readonly AutoRecord[]>
  readonly waiterPendingBy: ReadonlyMap<number, number>
  readonly waiterRearmsBy: ReadonlyMap<number, number>
}

/** Settle-kind decisions: the kinds that settle a gate through the seam (both settle-origin producers emit exactly one per settle). */
function gateEventMapsOf(events: readonly SddEvent[]): GateEventMaps {
  const presentedAt = new Map<number, string>()
  const answeredAt = new Map<number, string>()
  const answeredSeq = new Map<number, number>()
  const modeOf = new Map<number, GateMode>()
  const autoBy = new Map<number, AutoRecord[]>()
  const waiterPendingBy = new Map<number, number>()
  const waiterRearmsBy = new Map<number, number>()
  for (const event of events) {
    if (event.type === 'gate') {
      modeOf.set(event.version, event.mode)
      if (event.action === 'presented' && !presentedAt.has(event.version)) presentedAt.set(event.version, event.ts)
      if (event.action === 'answered' && !answeredAt.has(event.version)) {
        answeredAt.set(event.version, event.ts)
        answeredSeq.set(event.version, event.seq)
      }
      if (event.action === 'rearmed') waiterRearmsBy.set(event.version, (waiterRearmsBy.get(event.version) ?? 0) + 1)
    } else if (event.type === 'auto_decision') {
      const records = autoBy.get(event.gateVersion) ?? []
      records.push({ seq: event.seq, rule: event.rule, decision: event.decision })
      autoBy.set(event.gateVersion, records)
      if (event.rule === 'none' && event.decision === 'pending') {
        waiterPendingBy.set(event.gateVersion, (waiterPendingBy.get(event.gateVersion) ?? 0) + 1)
      }
    }
  }
  return {
    presentedAt,
    answeredAt,
    answeredSeq,
    modeOf,
    autoBy,
    waiterPendingBy,
    waiterRearmsBy,
  }
}

/**
 * The emission-order join (D4): a settle-kind record with seq below the
 * answered event's seq names the prelude (policy); above it names the
 * waiter. A version the waiter touched without settling is recognized by its
 * fingerprints, not by order.
 */
function settleOriginOf(
  maps: GateEventMaps,
  version: number,
  decision: 'approve' | 'extend',
): { readonly origin: 'policy' | 'waiter'; readonly rule: string } | null {
  const records = (maps.autoBy.get(version) ?? []).filter((record) => record.decision === decision)
  const answeredSeq = maps.answeredSeq.get(version)
  const record = records[0]
  if (record === undefined) return null
  if (answeredSeq !== undefined && record.seq < answeredSeq) return { origin: 'policy', rule: record.rule }
  if (answeredSeq !== undefined && record.seq > answeredSeq) return { origin: 'waiter', rule: record.rule }
  // No answered event to order against (a crash window): the waiter
  // fingerprints name the waiter, everything else reads as policy.
  const waiterTouched = (maps.waiterPendingBy.get(version) ?? 0) > 0 || (maps.waiterRearmsBy.get(version) ?? 0) > 0
  return { origin: waiterTouched ? 'waiter' : 'policy', rule: record.rule }
}

function answeredForensicsOf(maps: GateEventMaps): GateAnswerForensic[] {
  return [...maps.answeredAt.entries()]
    .filter(([version]) => maps.presentedAt.has(version))
    .sort((a, b) => a[0] - b[0])
    .map(([version, ts]) => {
      const presented = maps.presentedAt.get(version) ?? ts
      const approve = settleOriginOf(maps, version, 'approve')
      const extend = approve === null ? settleOriginOf(maps, version, 'extend') : null
      const auto = approve ?? extend
      return {
        version,
        mode: maps.modeOf.get(version) ?? 'final',
        latencyMs: Math.max(0, new Date(ts).getTime() - new Date(presented).getTime()),
        settledBy: auto === null ? 'human' : auto.origin,
        rule: auto === null ? null : auto.rule,
      }
    })
}

function neverAnsweredOf(maps: GateEventMaps, now: Date): GateNeverAnswered[] {
  return [...maps.presentedAt.entries()]
    .filter(([version]) => !maps.answeredAt.has(version))
    .sort((a, b) => a[0] - b[0])
    .map(([version, ts]) => ({
      version,
      mode: maps.modeOf.get(version) ?? 'final',
      ageMs: Math.max(0, now.getTime() - new Date(ts).getTime()),
    }))
}

function extendsOf(maps: GateEventMaps, bundle: RunBundle): GateExtendForensic[] {
  const list: GateExtendForensic[] = []
  for (const [version, records] of maps.autoBy) {
    if (!records.some((record) => record.decision === 'extend')) continue
    const auto = settleOriginOf(maps, version, 'extend')
    if (auto === null) continue
    list.push({ version, origin: auto.origin, rule: auto.rule })
  }
  for (const gate of bundle.gateFiles) {
    if (gateFileOutcome(gate.md) !== 'extend') continue
    if (settleOriginOf(maps, gate.version, 'extend') !== null) continue
    list.push({ version: gate.version, origin: 'human', rule: null })
  }
  return list.sort((a, b) => a.version - b.version)
}

export function gateForensics(bundle: RunBundle, now: Date): Metric<GateForensics> {
  const maps = gateEventMapsOf(bundle.events)
  if (maps.presentedAt.size === 0 && maps.answeredAt.size === 0 && bundle.gateFiles.length === 0) {
    return unknownMetric('no gate events or gate files')
  }
  const autoDecisionsByRule: Record<string, number> = {}
  for (const records of maps.autoBy.values()) {
    for (const record of records) autoDecisionsByRule[record.rule] = (autoDecisionsByRule[record.rule] ?? 0) + 1
  }
  let waiterPendingRecords = 0
  for (const count of maps.waiterPendingBy.values()) waiterPendingRecords += count
  let waiterRearms = 0
  for (const count of maps.waiterRearmsBy.values()) waiterRearms += count
  return knownMetric({
    answered: answeredForensicsOf(maps),
    neverAnswered: neverAnsweredOf(maps, now),
    extends: extendsOf(maps, bundle),
    autoDecisionsByRule,
    waiterPendingRecords,
    waiterRearms,
  })
}

export interface DecisionConsistency {
  readonly answeredWithoutPresented: readonly number[]
  readonly completedAfterUnsupersededAbort: boolean
  readonly bakResidue: boolean
  readonly gateFilesWithoutAnsweredEvent: readonly number[]
  /** D9: fields where the persisted memo diverges from the memo recomputed off the log (empty when fresh or memo-less). */
  readonly memoDivergingFields: readonly string[]
  readonly eraContaminated: boolean
}

/**
 * Fold-vs-memo freshness (D9): recompute `memoFieldsOf` off the kernel fold
 * and compare the parity oracle's field set against the persisted memo — a
 * stale or divergent memo is a crash window or a hand edit, flagged with its
 * diverging fields, never a failure. Timestamps are exempt (the save clock
 * legitimately trails the last event); `gate`/`status` follow the parity
 * oracle's legacy-terminal exemptions so inherited memos do not false-flag.
 */
function memoDivergenceOf(bundle: RunBundle): readonly string[] {
  if (bundle.state === null || bundle.events.length === 0) return []
  const { snapshot } = foldOf(bundle.events)
  const foldDone = snapshot.status === 'done'
  const halted: ParkedReason = foldDone ? 'final' : 'gate-pending'
  const derived = memoFieldsOf(bundle.events, snapshot.context, halted, flattenPosition(snapshot.value))
  const persisted = bundle.state
  const diverging: string[] = []
  if (derived.stage !== persisted.stage) diverging.push('stage')
  if (derived.depth !== persisted.depth) diverging.push('depth')
  if (derived.round !== persisted.round) diverging.push('round')
  if (derived.roundCap !== resolveRoundCap(persisted)) diverging.push('roundCap')
  if (derived.autoExtendsUsed !== (persisted.autoExtendsUsed ?? 0)) diverging.push('autoExtendsUsed')
  if (derived.gateDeadlineReArmed !== (persisted.gateDeadlineReArmed ?? false)) diverging.push('gateDeadlineReArmed')
  if (derived.gateDeadlineAt !== null && derived.gateDeadlineAt !== (persisted.gateDeadlineAt ?? 'never')) {
    diverging.push('gateDeadlineAt')
  }
  if (persisted.plan !== undefined && derived.plan !== persisted.plan) diverging.push('plan')
  const legacyImperativeTerminal = persisted.status !== 'running' && !foldDone
  if (!legacyImperativeTerminal && derived.gate !== persisted.gate) diverging.push('gate')
  if (foldDone && derived.status !== persisted.status) diverging.push('status')
  return diverging
}

/**
 * Decision-record consistency audit (D9): the derived memo must match its
 * recomputation, every answered gate needs a presented of the same version,
 * completion must not follow an unsuperseded abort, and gate files recording
 * a decision need their answered event. Answered-without-presented sequences
 * and completion-after-abort are the inherited development-era contamination
 * signatures — such runs carry the era flag so corpus aggregates exclude
 * them.
 */
export function decisionConsistency(bundle: RunBundle): DecisionConsistency {
  const maps = gateEventMapsOf(bundle.events)
  const answeredWithoutPresented = [...maps.answeredAt.keys()]
    .filter((version) => !maps.presentedAt.has(version))
    .sort((a, b) => a - b)
  const abortVersions = bundle.gateFiles
    .filter((gate) => gateFileOutcome(gate.md) === 'abort')
    .map((gate) => gate.version)
  const supersededLater = (version: number): boolean =>
    [...maps.answeredAt.keys()].some((other) => other > version && maps.presentedAt.has(other))
  const completedAfterUnsupersededAbort =
    bundle.state?.status === 'completed' &&
    abortVersions.length > 0 &&
    !abortVersions.every((version) => supersededLater(version))
  const pendingVersion = bundle.state?.gate?.version ?? null
  const gateFilesWithoutAnsweredEvent = bundle.gateFiles
    .filter(
      (gate) =>
        gateFileOutcome(gate.md) !== 'pending' && !maps.answeredAt.has(gate.version) && gate.version !== pendingVersion,
    )
    .map((gate) => gate.version)
  return {
    answeredWithoutPresented,
    completedAfterUnsupersededAbort,
    bakResidue: bundle.stateBak,
    gateFilesWithoutAnsweredEvent,
    memoDivergingFields: memoDivergenceOf(bundle),
    eraContaminated: answeredWithoutPresented.length > 0 || completedAfterUnsupersededAbort,
  }
}
