// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Resolution } from '../agent-layer.js'
import type { FindingCounts } from '../events.js'
import { readRoundDigests, readRoundGaps, recordRoundDigests } from './materialize.js'
import type { ResolverOutput, ReviewLoopDeps, ReviewLoopOptions, ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution } from './review-model.js'
import type { ConvergenceContext } from './review-model.js'

export interface ClosedRound {
  readonly verdict: ReviewLoopResult['verdict']
  readonly raised: FindingCounts
  readonly openLists: Pick<ReviewLoopResult, 'openBlockers' | 'openMaterial' | 'openNitpicks'>
  readonly gaps: Record<string, string>
}

/**
 * Close a round: snapshot the agent-authored artifacts as the resolver left
 * them — the next round compares against this to tell a real edit from a
 * claimed one — then take the verdict over them, record it, and materialize
 * the round's views.
 */
export async function closeRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  resolved: ResolverOutput,
  round: number,
  cap: number,
): Promise<ClosedRound> {
  await recordRoundDigests(deps.sidecarDir, options.changeDir, round)
  const context = await roundContext(deps, resolved, round)
  const { verdict, raised, open } = evaluateConvergence(resolved.resolutions, context)
  deps.emit({ altitude: 'L2', type: 'convergence', round, verdict, counts: raised, open })
  await deps.materialize(round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap })
  const openOf = (cls: Resolution['class']): Resolution[] =>
    resolved.resolutions.filter(
      (entry) => entry.class === cls && isOpenResolution(entry, context.assumptions, context.digests),
    )
  return {
    verdict,
    raised,
    openLists: {
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    },
    gaps: await readRoundGaps(deps.sidecarDir, round),
  }
}

/**
 * The openness context for this round: the assumptions the resolver just logged
 * and the change-folder snapshots either side of it.
 */
async function roundContext(
  deps: ReviewLoopDeps,
  resolved: ResolverOutput,
  round: number,
): Promise<ConvergenceContext> {
  const [current, previous] = await Promise.all([
    readRoundDigests(deps.sidecarDir, round),
    readRoundDigests(deps.sidecarDir, round - 1),
  ])
  return { assumptions: resolved.assumptions, digests: { previous, current: current ?? {} } }
}
