// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import { fingerprintOf } from './concern-model.js'
import type { AutoDecisionKind, AutoDecisionRule, SddEvent } from './events.js'

/** Finding-lifecycle metrics over the findings/resolutions sidecar joins. */

/**
 * Duplicate-id rate over the resolutions ledger: entries whose id repeats
 * within a single round's ledger (the dead-dedup signature the fix-command
 * r3 sidecar exposed) over all resolution entries. Cross-round re-feeds are
 * the ledger working as designed and belong to `concernPersistence`.
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

export function lensOverlapRate(bundle: RunBundle): Metric<number> {
  const reviewerByRound = new Map(bundle.findings.map((round) => [round.round, round.items]))
  let skepticTotal = 0
  let matches = 0
  for (const round of bundle.skepticFindings) {
    const reviewerFingerprints = new Set(
      (reviewerByRound.get(round.round) ?? []).map((finding) => fingerprintOf(finding.gap)),
    )
    for (const finding of round.items) {
      skepticTotal += 1
      if (reviewerFingerprints.has(fingerprintOf(finding.gap))) matches += 1
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
 * Cross-round concern-cluster persistence: distinct concerns (fingerprinted
 * gaps — `fingerprintOf` imported from the loop-memory change, D5) that
 * re-appear in ≥2 rounds over all distinct concerns. Folds sidecar gaps and
 * fingerprinted finding events together, so both eras compute.
 */
export function concernPersistence(bundle: RunBundle): Metric<number> {
  const roundsOf = new Map<string, Set<number>>()
  const note = (fingerprint: string, round: number): void => {
    const rounds = roundsOf.get(fingerprint) ?? new Set<number>()
    rounds.add(round)
    roundsOf.set(fingerprint, rounds)
  }
  for (const round of bundle.findings) {
    for (const finding of round.items) note(fingerprintOf(finding.gap), round.round)
  }
  for (const event of bundle.events) {
    if (event.type === 'finding' && event.fingerprint !== undefined) note(event.fingerprint, event.round)
  }
  if (roundsOf.size === 0) return unknownMetric('no findings sidecars or fingerprinted finding events')
  const persisting = [...roundsOf.values()].filter((rounds) => rounds.size >= 2)
  return knownMetric(persisting.length / roundsOf.size)
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
  readonly rule: AutoDecisionRule
  readonly decision: AutoDecisionKind
}

/**
 * Why each cap-hit gate state didn't (or did) let R2 fire, joined from the
 * event log plus the run's cost-knownness: the state joins to the first
 * early-mode gate presented after its convergence and before the next one,
 * then that gate's `auto_decision` records name the fate. The R2 trajectory
 * predicate itself is the attribution for ineligible states —
 * `trajectory-blocked` is exactly the ratio's complement — so an R4 decision
 * recorded on an ineligible state (R4 pre-empts the trajectory check on the
 * ladder) still reads as trajectory-blocked, and only eligible states consume
 * the gap causes.
 */
function blockingCauseOf(records: readonly AutoRecord[], costKnown: boolean): R2Cause | null {
  if (records.some((record) => record.rule === 'R2' && record.decision === 'extend')) return 'r2-fired'
  if (records.some((record) => record.rule === 'R4')) return costKnown ? 'over-ceiling' : 'cost-unknown'
  if (records.some((record) => record.decision === 'preview')) return 'preview'
  return null
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
 * R2 trajectory-extend eligibility over convergence event pairs: every
 * cap-hit round (round === cap, verdict open) is one gate state; it is
 * eligible when the later record has zero blockers, ≥1 material, and a
 * strictly smaller open total than its predecessor — the exact predicate
 * `auto-policy.ts` R2 applies (trajectory window 2). Each state also carries
 * its blocking cause in `byCause` (nonzero entries only, fixed cause order):
 * eligible states are attributed from their joined gate's auto_decision
 * records (`r2-fired`, `cost-unknown`/`over-ceiling` by `costKnown`,
 * `preview`), ineligible states are the `trajectory-blocked` complement. An
 * eligible state with no joined gate or no attribution records degrades the
 * metric to unknown — reduced coverage, never a wrong breakdown.
 */
export function r2EligibilityRate(bundle: RunBundle, costKnown = true): Metric<R2Eligibility> {
  const { caps, earlyPresentations, autoByGate, convergences } = r2EventIndexOf(bundle.events)
  const openTotal = (counts: { blocker: number; material: number; nitpick: number }): number =>
    counts.blocker + counts.material + counts.nitpick
  const causes: R2Cause[] = []
  let gateStates = 0
  let eligible = 0
  let unattributed = 0
  for (let i = 1; i < convergences.length; i += 1) {
    const previous = convergences[i - 1]
    const current = convergences[i]
    if (current === undefined || previous === undefined) continue
    if (caps.get(current.round) !== current.round || current.verdict !== 'open') continue
    gateStates += 1
    const trajectoryEligible =
      current.counts.blocker === 0 &&
      current.counts.material > 0 &&
      openTotal(current.counts) < openTotal(previous.counts)
    if (!trajectoryEligible) {
      causes.push('trajectory-blocked')
      continue
    }
    eligible += 1
    const nextSeq = convergences[i + 1]?.seq ?? Number.POSITIVE_INFINITY
    const gateVersion = earlyPresentations.find(
      (presentation) => presentation.seq > current.seq && presentation.seq < nextSeq,
    )?.version
    const records = gateVersion === undefined ? [] : (autoByGate.get(gateVersion) ?? [])
    const cause = blockingCauseOf(records, costKnown)
    if (cause === null) unattributed += 1
    else causes.push(cause)
  }
  if (gateStates === 0) return unknownMetric('no cap-hit convergence pairs')
  if (unattributed > 0) {
    return unknownMetric(`no gate/auto-decision records for ${unattributed} eligible cap-hit state(s)`)
  }
  return knownMetric({ eligible, gateStates, byCause: causeMixOf(causes) })
}
