// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { FindingCounts } from '../events.js'
import { openCountsOf } from '../legacy-fold.js'
import type { DigestRecord } from '../legacy-fold.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence } from './review-model.js'
import type { ArtifactDigests } from './review-model.js'

const DigestsSchema = z.record(z.string(), z.string())

function sameCounts(a: FindingCounts, b: FindingCounts): boolean {
  return a.blocker === b.blocker && a.material === b.material && a.nitpick === b.nitpick
}

/**
 * Cross-check a round's recomputed counts against what its convergence record
 * recorded — both sets, since a rule reads one or the other and a drift in
 * either would let it decide on a number the log does not support. A pre-split
 * record carries no open set and folds it equal to its raised set, so such a
 * log agrees with a recompute whose sets also coincide, and disagrees exactly
 * when the raised counts themselves drifted.
 */
export async function integrityOf(
  sidecarDir: string,
  record: DigestRecord,
): Promise<'clear' | 'mismatch' | 'unparseable'> {
  const recomputed = await countsFromSidecar(sidecarDir, record.round)
  if (recomputed === null) return 'unparseable'
  if (!sameCounts(record.counts, recomputed.raised)) return 'mismatch'
  return sameCounts(openCountsOf(record), recomputed.open) ? 'clear' : 'mismatch'
}

/**
 * The review result the ladder may decide on: the recorded one, unless the
 * sidecar-recomputed counts disagree with the gate round's convergence record
 * or cannot be read at all — then the result carries an open BLOCKER naming
 * the integrity failure, so no rule can auto-decide and the gate waits for a
 * human. A gate round with no recorded convergence record has nothing to
 * contradict and passes through unchanged.
 */
export async function guardedReviewResult(
  reviewResult: ReviewLoopResult,
  perRound: readonly DigestRecord[],
  sidecarDir: string,
): Promise<ReviewLoopResult> {
  const record = perRound.find((entry) => entry.round === reviewResult.rounds) ?? null
  if (record === null) return reviewResult
  const outcome = await integrityOf(sidecarDir, record)
  if (outcome === 'clear') return reviewResult
  return integrityBlocked(
    reviewResult,
    outcome === 'unparseable' ? 'sidecar unparseable' : 'sidecar/event count mismatch',
  )
}

function integrityBlocked(reviewResult: ReviewLoopResult, why: string): ReviewLoopResult {
  return {
    ...reviewResult,
    openBlockers: [{ id: 'POLICY-INTEGRITY', class: 'BLOCKER', resolution: 'evidence-answered', outcome: why }],
  }
}

async function countsFromSidecar(
  sidecarDir: string,
  round: number,
): Promise<{ readonly raised: FindingCounts; readonly open: FindingCounts } | null> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const digests = {
      previous: await readDigests(sidecarDir, round - 1),
      current: (await readDigests(sidecarDir, round)) ?? {},
    }
    const { raised, open } = evaluateConvergence(parsed.resolutions, {
      assumptions: parsed.assumptions,
      digests,
    })
    return { raised, open }
  } catch {
    return null
  }
}

/** A round's snapshot, or null when that round recorded none (round 0, or a pre-change run). */
async function readDigests(sidecarDir: string, round: number): Promise<ArtifactDigests | null> {
  if (round < 1) return null
  try {
    const raw = await readFile(path.join(sidecarDir, `round-hashes-${round}.json`), 'utf8')
    return DigestsSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
