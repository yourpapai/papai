// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { z } from 'zod'

import type { FindingCounts } from './events.js'
import { openCountsOf, replayEvents } from './replay.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence } from './review-model.js'

export function guardedReviewResult(
  reviewResult: ReviewLoopResult,
  logPath: string,
  sidecarDir: string,
): ReviewLoopResult {
  const outcome = integrityOf(sidecarDir, logPath, reviewResult.rounds)
  if (outcome === 'clear') return reviewResult
  return integrityBlocked(
    reviewResult,
    outcome === 'unparseable' ? 'sidecar unparseable' : 'sidecar/event count mismatch',
  )
}
function sameCounts(a: FindingCounts, b: FindingCounts): boolean {
  return a.blocker === b.blocker && a.material === b.material && a.nitpick === b.nitpick
}
/**
 * Cross-check a round's recomputed counts against what its convergence event
 * recorded — both sets, since a rule reads one or the other and a drift in
 * either would let it decide on a number the log does not support. A pre-split
 * line carries no open set and folds it equal to its raised set, so such a log
 * agrees with a recompute whose sets also coincide, and disagrees exactly when
 * the raised counts themselves drifted.
 */
export function integrityOf(sidecarDir: string, logPath: string, round: number): 'clear' | 'mismatch' | 'unparseable' {
  const recomputed = countsFromSidecarSync(sidecarDir, round)
  if (recomputed === null) return 'unparseable'
  const verdict = replayEvents(logPath).lastVerdict
  if (verdict === null) return 'clear'
  if (!sameCounts(verdict.counts, recomputed.raised)) return 'mismatch'
  return sameCounts(openCountsOf(verdict), recomputed.open) ? 'clear' : 'mismatch'
}
function integrityBlocked(reviewResult: ReviewLoopResult, why: string): ReviewLoopResult {
  return {
    ...reviewResult,
    openBlockers: [{ id: 'POLICY-INTEGRITY', class: 'BLOCKER', resolution: 'evidence-answered', outcome: why }],
  }
}
function countsFromSidecarSync(
  sidecarDir: string,
  round: number,
): { raised: FindingCounts; open: FindingCounts } | null {
  try {
    const raw = readFileSync(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const digests = {
      previous: readDigestsSync(sidecarDir, round - 1),
      current: readDigestsSync(sidecarDir, round) ?? {},
    }
    const context = { assumptions: parsed.assumptions, digests }
    const { raised, open } = evaluateConvergence(parsed.resolutions, context)
    return { raised, open }
  } catch {
    return null
  }
}
const DigestsSchema = z.record(z.string(), z.string())

/** A round's snapshot read synchronously; the ladder runs without awaiting. */
function readDigestsSync(sidecarDir: string, round: number): Record<string, string> | null {
  if (round < 1) return null
  try {
    return DigestsSchema.parse(JSON.parse(readFileSync(path.join(sidecarDir, `round-hashes-${round}.json`), 'utf8')))
  } catch {
    return null
  }
}
