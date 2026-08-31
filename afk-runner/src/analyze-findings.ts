// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import type { SddEvent } from './events.js'

/** Finding-lifecycle metrics over the findings/resolutions sidecar joins (D3). */

/** The lens-overlap gap key: a skeptic finds the same concern, asks a different question — the gap joins, not the question. */
function gapKey(gap: string): string {
  return gap.trim().toLowerCase()
}

/**
 * Duplicate-id rate over the resolutions ledger: entries whose id repeats
 * within a single round's ledger (the dead-dedup signature) over all
 * resolution entries. Cross-round re-feeds are the ledger working as
 * designed and belong to `concernPersistence`.
 */
export function duplicateIdRate(bundle: RunBundle): Metric<number> {
  const entries = bundle.resolutions.reduce((acc, round) => acc + round.items.length, 0)
  if (entries === 0) return unknownMetric('no resolutions sidecars')
  const duplicates = bundle.resolutions.reduce(
    (acc, round) => acc + (round.items.length - new Set(round.items.map((item) => item.id)).size),
    0,
  )
  return knownMetric(duplicates / entries)
}

/**
 * Lens overlap: skeptic findings whose normalized gap matches a reviewer
 * finding of the same round, over all skeptic findings — the gap joins, not
 * the question (a second lens asks a different question about the same
 * concern). Master's fingerprint join approximated by gap normalization
 * until loop-memory's `fingerprintOf` lands.
 */
export function lensOverlapRate(bundle: RunBundle): Metric<number> {
  const reviewerByRound = new Map(bundle.findings.map((round) => [round.round, round.items]))
  let skepticTotal = 0
  let matches = 0
  for (const round of bundle.skepticFindings) {
    const reviewerKeys = new Set((reviewerByRound.get(round.round) ?? []).map((finding) => gapKey(finding.gap)))
    for (const finding of round.items) {
      skepticTotal += 1
      if (reviewerKeys.has(gapKey(finding.gap))) matches += 1
    }
  }
  if (skepticTotal === 0) return unknownMetric('no skeptic findings sidecars')
  return knownMetric(matches / skepticTotal)
}

export function classChurn(bundle: RunBundle): Metric<number> {
  const roundsOf = new Map<string, Set<number>>()
  const classesOf = new Map<string, Set<string>>()
  for (const round of bundle.findings) {
    for (const finding of round.items) {
      const rounds = roundsOf.get(finding.id) ?? new Set<number>()
      rounds.add(round.round)
      roundsOf.set(finding.id, rounds)
      const classes = classesOf.get(finding.id) ?? new Set<string>()
      classes.add(finding.class)
      classesOf.set(finding.id, classes)
    }
  }
  const multiRoundIds = [...roundsOf.entries()].filter(([, rounds]) => rounds.size >= 2)
  if (multiRoundIds.length === 0) return unknownMetric('no finding id spans multiple rounds')
  const churned = multiRoundIds.filter(([id]) => (classesOf.get(id)?.size ?? 0) >= 2)
  return knownMetric(churned.length / multiRoundIds.length)
}

export type ResolverActionMix = Readonly<Record<string, number>>

export function resolverActionMix(bundle: RunBundle): Metric<ResolverActionMix> {
  const mix: Record<string, number> = {}
  let total = 0
  for (const round of bundle.resolutions) {
    for (const item of round.items) {
      mix[item.resolution] = (mix[item.resolution] ?? 0) + 1
      total += 1
    }
  }
  if (total === 0) return unknownMetric('no resolutions sidecars')
  return knownMetric(mix)
}

/**
 * Cross-round concern-cluster persistence. Reports unknown until
 * `afk-runner-loop-memory` lands its `fingerprintOf` — imported then, never
 * copied (the duplicates gate); a sidecar-gap join is not the same metric.
 */
export function concernPersistence(_bundle: RunBundle): Metric<number> {
  return unknownMetric('concern fingerprints not yet available (afk-runner-loop-memory)')
}

export const R2_CAUSES = ['r2-fired', 'cost-unknown', 'over-ceiling', 'preview', 'trajectory-blocked'] as const
export type R2Cause = (typeof R2_CAUSES)[number]

/** Nonzero per-cause counts over a run's (or the corpus's) cap-hit gate states. */
export type R2CauseMix = Readonly<Partial<Record<R2Cause, number>>>

export interface R2Eligibility {
  readonly eligible: number
  readonly gateStates: number
  readonly byCause: R2CauseMix
}

interface AutoRecord {
  readonly rule: string
  readonly decision: string
}

/** Why an eligible state could not be attributed: no records, or metered-ness the memo cannot answer. */
type Unattributed = 'records' | 'metered'

/**
 * The D5 cause table: `r2-fired` / metered+cost-unknown → `cost-unknown` /
 * else R4 → `over-ceiling` / legacy `preview`. The unmetered cell closes
 * `over-ceiling` because the cost-unknown branch is unreachable on an
 * unmetered run; an R4 decision on a cost-unknown run whose memo cannot
 * answer metered-ness degrades rather than guesses.
 */
function blockingCauseOf(
  records: readonly AutoRecord[],
  costKnown: boolean,
  metered: boolean | undefined,
): R2Cause | Unattributed {
  if (records.some((record) => record.rule === 'R2' && record.decision === 'extend')) return 'r2-fired'
  if (records.some((record) => record.rule === 'R4')) {
    if (metered === false) return 'over-ceiling'
    if (costKnown) return 'over-ceiling'
    if (metered === undefined) return 'metered'
    return 'cost-unknown'
  }
  if (records.some((record) => record.decision === 'preview')) return 'preview'
  return 'records'
}

function causeMixOf(causes: readonly R2Cause[]): R2CauseMix {
  const mix: Partial<Record<R2Cause, number>> = {}
  for (const cause of R2_CAUSES) {
    const count = causes.filter((candidate) => candidate === cause).length
    if (count > 0) mix[cause] = count
  }
  return mix
}

interface R2EventIndex {
  readonly caps: ReadonlyMap<number, number>
  readonly earlyPresentations: readonly { readonly seq: number; readonly version: number }[]
  readonly autoByGate: ReadonlyMap<number, readonly AutoRecord[]>
  readonly convergences: readonly Extract<SddEvent, { type: 'convergence' }>[]
}

/** One pass over the event log: caps, early presentations, decisions per gate version, convergences. */
function r2EventIndexOf(events: readonly SddEvent[]): R2EventIndex {
  const caps = new Map<number, number>()
  const earlyPresentations: { seq: number; version: number }[] = []
  const autoByGate = new Map<number, AutoRecord[]>()
  const convergences: Extract<SddEvent, { type: 'convergence' }>[] = []
  for (const event of events) {
    if (event.type === 'round_open') caps.set(event.round, event.cap)
    else if (event.type === 'convergence') convergences.push(event)
    else if (event.type === 'gate' && event.action === 'presented' && event.mode === 'early') {
      earlyPresentations.push({ seq: event.seq, version: event.version })
    } else if (event.type === 'auto_decision') {
      const records = autoByGate.get(event.gateVersion) ?? []
      records.push({ rule: event.rule, decision: event.decision })
      autoByGate.set(event.gateVersion, records)
    }
  }
  return { caps, earlyPresentations, autoByGate, convergences }
}

/**
 * R2 eligibility with blocking-cause attribution over the post-split
 * vocabulary: every cap-hit round (round === cap, verdict open —
 * `needs-review` never enumerates a gate state, its verification round
 * precedes any presentation) is one gate state. Eligibility reads the
 * convergence record's `open` count set (absent → the raised fallback, the
 * grammar's own rule); the trajectory strict-decrease reads raised totals.
 * Each eligible state joins to the first early presentation after its
 * convergence and before the next one, and that gate's `auto_decision`
 * records name the fate (D5 table) with metered-ness from the memo. A state
 * that cannot be attributed — no records, or a memo that cannot answer
 * metered-ness on a cost-unknown run — degrades the metric to unknown,
 * never a wrong breakdown.
 */
export function r2EligibilityRate(bundle: RunBundle, costKnown: boolean): Metric<R2Eligibility> {
  const { caps, earlyPresentations, autoByGate, convergences } = r2EventIndexOf(bundle.events)
  const metered = bundle.state?.metered
  const openTotal = (counts: { blocker: number; material: number; nitpick: number }): number =>
    counts.blocker + counts.material + counts.nitpick
  const causes: R2Cause[] = []
  let gateStates = 0
  let eligible = 0
  let unattributedRecords = 0
  let unattributedMetered = 0
  for (let i = 1; i < convergences.length; i += 1) {
    const previous = convergences[i - 1]
    const current = convergences[i]
    if (current === undefined || previous === undefined) continue
    if (caps.get(current.round) !== current.round || current.verdict !== 'open') continue
    gateStates += 1
    const openCounts = current.open ?? current.counts
    const openEligible = openCounts.blocker === 0 && openCounts.material > 0
    const raisedDecreasing = openTotal(current.counts) < openTotal(previous.counts)
    if (!(openEligible && raisedDecreasing)) {
      causes.push('trajectory-blocked')
      continue
    }
    eligible += 1
    const nextSeq = convergences[i + 1]?.seq ?? Number.POSITIVE_INFINITY
    const gateVersion = earlyPresentations.find(
      (presentation) => presentation.seq > current.seq && presentation.seq < nextSeq,
    )?.version
    const records = gateVersion === undefined ? [] : (autoByGate.get(gateVersion) ?? [])
    const cause = blockingCauseOf(records, costKnown, metered)
    if (cause === 'records') unattributedRecords += 1
    else if (cause === 'metered') unattributedMetered += 1
    else causes.push(cause)
  }
  if (gateStates === 0) return unknownMetric('no cap-hit convergence pairs')
  if (unattributedMetered > 0) {
    return unknownMetric(`memo metered-ness unknown — cannot attribute ${unattributedMetered} cost-unknown state(s)`)
  }
  if (unattributedRecords > 0) {
    return unknownMetric(`no gate/auto-decision records for ${unattributedRecords} eligible cap-hit state(s)`)
  }
  return knownMetric({ eligible, gateStates, byCause: causeMixOf(causes) })
}
