// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Resolution } from './agent-layer.js'
import type { FindingCounts } from './events.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateBlocker, GateFinding } from './gate-model.js'
import { readRoundDigests, readRoundGaps } from './materialize.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution } from './review-model.js'

export function blockersOf(result: ReviewLoopResult): GateBlocker[] {
  return findingsOf(result).blockers
}

/** Row width that keeps a checkbox line readable and the grammar intact. */
const MAX_GAP_LEN = 200

/**
 * A gap as a gate row can safely carry it: one line, no leading redirect
 * marker, bounded length. The checkbox grammar anchors on `- [x] F3` at line
 * start and a redirect is a line opening with an arrow, so an unsanitized
 * multi-line gap could otherwise be parsed back as a decision it never was.
 */
function rowGap(id: string, gaps: Record<string, string> | undefined): string {
  const raw = gaps?.[id]
  if (raw === undefined || raw.trim() === '') return id
  const flat = raw
    .replace(/\s+/gu, ' ')
    .replace(/^[\s→]+/u, '')
    .trim()
  if (flat === '') return id
  return flat.length > MAX_GAP_LEN ? `${flat.slice(0, MAX_GAP_LEN - 1)}…` : flat
}

export function findingsOf(result: ReviewLoopResult): {
  blockers: GateBlocker[]
  material: GateFinding[]
  nitpicks: GateFinding[]
} {
  const blockers = result.openBlockers.map((entry) => ({
    id: entry.id,
    gap: rowGap(entry.id, result.gaps),
    evidence: entry.outcome ?? entry.justification ?? '',
  }))
  const detailed = (entry: Resolution): GateFinding => ({
    id: entry.id,
    gap: rowGap(entry.id, result.gaps),
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  })
  return {
    blockers,
    material: result.openMaterial.map(detailed),
    nitpicks: result.openNitpicks.map(detailed),
  }
}

const EMPTY_COUNTS: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }

/**
 * Rebuild a round's review result from its sidecars, applying the same openness
 * predicate the live loop used. A resumed run's gate must see the set the run
 * would have seen; recomputing it by class alone would show a resumed operator
 * findings the live one had already settled.
 */
export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  // An unreadable sidecar keeps the pre-change reading — empty buckets, treated
  // as converged — rather than becoming a new gating condition here. The
  // ladder's integrity cross-check is what fails closed on an unparseable
  // sidecar; duplicating that in the reader would change resume routing.
  const empty = { outcome, rounds: round, verdict: 'converged', raised: EMPTY_COUNTS } as const
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const [current, previous] = await Promise.all([
      readRoundDigests(sidecarDir, round),
      readRoundDigests(sidecarDir, round - 1),
    ])
    const context = { assumptions: parsed.assumptions, digests: { previous, current: current ?? {} } }
    const gaps = await readRoundGaps(sidecarDir, round)
    const { verdict, raised } = evaluateConvergence(parsed.resolutions, context)
    const openOf = (cls: Resolution['class']): Resolution[] =>
      parsed.resolutions.filter((r) => r.class === cls && isOpenResolution(r, context.assumptions, context.digests))
    return {
      outcome,
      rounds: round,
      verdict,
      raised,
      gaps,
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    }
  } catch {
    return { ...empty, openBlockers: [], openMaterial: [], openNitpicks: [] }
  }
}

export async function prepareResumeInput(
  sidecarDir: string,
  round: number,
  gateMode: 'early' | 'final',
): Promise<{
  assumptions: readonly { id: string; text: string; blast_radius: string }[]
  reviewResult: ReviewLoopResult
  requiredAck: string | undefined
}> {
  const assumptions = await gatherAssumptions(sidecarDir, round)
  const capHitFired = gateMode === 'early'
  const reviewResult = await readReviewResultFromSidecars(sidecarDir, round, capHitFired ? 'cap-hit' : 'converged')
  const findings = findingsOf(reviewResult)
  const requiredAck = capHitFired && findings.blockers.length === 0 ? 'T1' : undefined
  return { assumptions, reviewResult, requiredAck }
}
