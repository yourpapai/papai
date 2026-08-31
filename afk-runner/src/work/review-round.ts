// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { recordRoundDigests } from './materialize.js'
import type { ResolverOutput, ReviewLoopDeps, ReviewLoopOptions } from './review-loop.js'
import { evaluateConvergence } from './review-model.js'

export interface ClosedRound {
  readonly verdict: 'converged' | 'open'
  readonly counts: ReturnType<typeof evaluateConvergence>['counts']
}

/**
 * Round close: snapshot the agent-authored artifacts as the resolver left them
 * — the next round compares against this to tell a real edit from a claimed
 * one — then record the round's verdict and materialize its views.
 */
export async function closeRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  resolved: ResolverOutput,
  round: number,
  cap: number,
): Promise<ClosedRound> {
  await recordRoundDigests(deps.sidecarDir, options.changeDir, round)
  const { verdict, counts } = evaluateConvergence(resolved.resolutions)
  deps.emit({ altitude: 'L2', type: 'convergence', round, verdict, counts })
  await deps.materialize(round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap })
  return { verdict, counts }
}
