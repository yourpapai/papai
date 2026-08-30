// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import { fingerprintOf } from './concern-model.js'
import type { SddEvent } from './events.js'

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

export interface R2Eligibility {
  readonly eligible: number
  readonly gateStates: number
}

/**
 * R2 trajectory-extend eligibility over convergence event pairs: every
 * cap-hit round (round === cap, verdict open) is one gate state; it is
 * eligible when the later record has zero blockers, ≥1 material, and a
 * strictly smaller open total than its predecessor — the exact predicate
 * `auto-policy.ts` R2 applies (trajectory window 2).
 */
export function r2EligibilityRate(bundle: RunBundle): Metric<R2Eligibility> {
  const caps = new Map<number, number>()
  for (const event of bundle.events) {
    if (event.type === 'round_open') caps.set(event.round, event.cap)
  }
  const convergences = bundle.events.filter(
    (event): event is Extract<SddEvent, { type: 'convergence' }> => event.type === 'convergence',
  )
  const openTotal = (counts: { blocker: number; material: number; nitpick: number }): number =>
    counts.blocker + counts.material + counts.nitpick
  let gateStates = 0
  let eligible = 0
  for (let i = 1; i < convergences.length; i += 1) {
    const previous = convergences[i - 1]
    const current = convergences[i]
    if (current === undefined || previous === undefined) continue
    if (caps.get(current.round) !== current.round || current.verdict !== 'open') continue
    gateStates += 1
    if (
      current.counts.blocker === 0 &&
      current.counts.material > 0 &&
      openTotal(current.counts) < openTotal(previous.counts)
    ) {
      eligible += 1
    }
  }
  if (gateStates === 0) return unknownMetric('no cap-hit convergence pairs')
  return knownMetric({ eligible, gateStates })
}
