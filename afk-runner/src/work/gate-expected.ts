// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Resolution } from '../agent-layer.js'
import type { FindingCounts } from '../events.js'
import type { DigestRecord } from '../legacy-fold.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import { guardedReviewResult } from './gate-integrity.js'
import type { ExpectedGateContent } from './gate-model.js'
import { sanitizeRowGap } from './gate-signals.js'
import { readRoundDigests, readRoundGaps } from './materialize.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution } from './review-model.js'

const EMPTY_COUNTS: FindingCounts = { blocker: 0, material: 0, nitpick: 0 }

/** The escalation gate's expected content: the trajectory ack, nothing else — no assumptions, no blockers, no veto (C6 D4). */
export function escalationExpectedContent(): ExpectedGateContent {
  return { assumptions: [], blockers: [], requiredAck: 'T1', gateMode: 'escalation' }
}

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
    const [current, previous, gaps] = await Promise.all([
      readRoundDigests(sidecarDir, round),
      readRoundDigests(sidecarDir, round - 1),
      readRoundGaps(sidecarDir, round),
    ])
    const context = { assumptions: parsed.assumptions, digests: { previous, current: current ?? {} } }
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

/**
 * Expected gate content at settle time (prepareResumeInput copy):
 * assumptions, blockers, findings, ack. `perRound` (the fold's digest
 * records) threads the F-C2 guard (D3 site 3): when the counts-integrity
 * cross-check substitutes the open POLICY-INTEGRITY BLOCKER, the settle
 * grammar declares it — the rendered row is acknowledgeable through the
 * standard response form instead of rejecting as unknown. Callers that pass
 * no records (resume routing, the producers' own settles) keep the raw
 * reading — the deliberate contract at `readReviewResultFromSidecars`.
 */
export async function expectedContentFor(
  sidecarDir: string,
  round: number,
  gateMode: 'early' | 'final' | 'escalation',
  perRound: readonly DigestRecord[] = [],
): Promise<ExpectedGateContent> {
  if (gateMode === 'escalation') return escalationExpectedContent()
  const assumptions = await gatherAssumptions(sidecarDir, round)
  const capHitFired = gateMode === 'early'
  const raw = await readReviewResultFromSidecars(sidecarDir, round, capHitFired ? 'cap-hit' : 'converged')
  const reviewResult = await guardedReviewResult(raw, perRound, sidecarDir)
  const gaps = reviewResult.gaps
  const blockerIds = new Set(reviewResult.openBlockers.map((entry) => entry.id))
  return {
    assumptions,
    blockers: [...blockerIds].map((id) => ({ id, gap: sanitizeRowGap(id, gaps), evidence: '' })),
    ...(reviewResult.openMaterial.length === 0
      ? {}
      : {
          findings: reviewResult.openMaterial.map((entry) => ({
            id: entry.id,
            gap: sanitizeRowGap(entry.id, gaps),
            evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
          })),
        }),
    ...(capHitFired && blockerIds.size === 0 ? { requiredAck: 'T1' } : {}),
    gateMode,
  }
}
