// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import type { SddEvent } from './events.js'
import { looksAnswered } from './gate-answered.js'

/** Gate forensics and the three-writer decision-record consistency audit. */

export interface GateAnswerForensic {
  readonly version: number
  readonly mode: 'early' | 'final' | 'plan'
  readonly latencyMs: number
  readonly settledBy: 'human' | 'policy' | 'waiter'
  readonly rule: string | null
}

export interface GateNeverAnswered {
  readonly version: number
  readonly mode: 'early' | 'final' | 'plan'
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
}

const GATE_ABORT_RE = /^\s*ABORT\s*$/mu
const GATE_EXTEND_RE = /^\s*→ RUN 1 MORE\s*$/mu

export function gateFileOutcome(md: string): 'abort' | 'extend' | 'answered' | 'pending' {
  if (GATE_ABORT_RE.test(md)) return 'abort'
  if (GATE_EXTEND_RE.test(md)) return 'extend'
  if (looksAnswered(md)) return 'answered'
  return 'pending'
}

interface GateEventMaps {
  readonly presentedAt: ReadonlyMap<number, string>
  readonly answeredAt: ReadonlyMap<number, string>
  readonly modeOf: ReadonlyMap<number, 'early' | 'final' | 'plan'>
  readonly autoBy: ReadonlyMap<number, readonly { rule: string; decision: string }[]>
}

function gateEventMapsOf(events: readonly SddEvent[]): GateEventMaps {
  const presentedAt = new Map<number, string>()
  const answeredAt = new Map<number, string>()
  const modeOf = new Map<number, 'early' | 'final' | 'plan'>()
  const autoBy = new Map<number, { rule: string; decision: string }[]>()
  for (const event of events) {
    if (event.type === 'gate') {
      modeOf.set(event.version, event.mode)
      if (event.action === 'presented' && !presentedAt.has(event.version)) presentedAt.set(event.version, event.ts)
      if (event.action === 'answered' && !answeredAt.has(event.version)) answeredAt.set(event.version, event.ts)
    } else if (event.type === 'auto_decision') {
      const list = autoBy.get(event.gateVersion) ?? []
      list.push({ rule: event.rule, decision: event.decision })
      autoBy.set(event.gateVersion, list)
    }
  }
  return { presentedAt, answeredAt, modeOf, autoBy }
}

function autoRecordOf(
  bundle: RunBundle,
  maps: GateEventMaps,
  version: number,
  decision: string,
): { rule: string; origin: 'policy' | 'waiter' } | null {
  const record = (maps.autoBy.get(version) ?? []).find((entry) => entry.decision === decision)
  if (record === undefined) return null
  return { rule: record.rule, origin: bundle.expiryClaimVersions.includes(version) ? 'waiter' : 'policy' }
}

function answeredForensicsOf(bundle: RunBundle, maps: GateEventMaps): GateAnswerForensic[] {
  return [...maps.answeredAt.entries()]
    .filter(([version]) => maps.presentedAt.has(version))
    .sort((a, b) => a[0] - b[0])
    .map(([version, ts]) => {
      const auto = autoRecordOf(bundle, maps, version, 'approve')
      return {
        version,
        mode: maps.modeOf.get(version) ?? 'final',
        latencyMs: Math.max(0, new Date(ts).getTime() - new Date(maps.presentedAt.get(version) ?? ts).getTime()),
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

function extendsOf(bundle: RunBundle, maps: GateEventMaps): GateExtendForensic[] {
  const list: GateExtendForensic[] = []
  for (const [version, records] of maps.autoBy) {
    if (records.some((entry) => entry.decision === 'extend')) {
      list.push({
        version,
        origin: bundle.expiryClaimVersions.includes(version) ? 'waiter' : 'policy',
        rule: records.find((entry) => entry.decision === 'extend')?.rule ?? null,
      })
    }
  }
  for (const gate of bundle.gateFiles) {
    if (gateFileOutcome(gate.md) !== 'extend') continue
    if (autoRecordOf(bundle, maps, gate.version, 'extend') !== null) continue
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
  return knownMetric({
    answered: answeredForensicsOf(bundle, maps),
    neverAnswered: neverAnsweredOf(maps, now),
    extends: extendsOf(bundle, maps),
    autoDecisionsByRule,
  })
}

export interface DecisionConsistency {
  readonly answeredWithoutPresented: readonly number[]
  readonly completedAfterUnsupersededAbort: boolean
  readonly bakResidue: boolean
  readonly gateFilesWithoutAnsweredEvent: readonly number[]
  readonly eraContaminated: boolean
}

/**
 * Three-writer consistency audit: event log, gate files, and persisted state
 * must agree. Phantom answers (answered with no presented of that version)
 * and completion after an ABORT no later presented-and-answered gate chain
 * supersedes are the development-era contamination signatures — such runs are
 * flagged so corpus aggregates can exclude them.
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
    eraContaminated: answeredWithoutPresented.length > 0 || completedAfterUnsupersededAbort,
  }
}
