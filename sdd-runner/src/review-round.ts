// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Resolution } from './agent-layer.js'
import { concernRecords } from './concern-model.js'
import type { ConcernRecord } from './concern-model.js'
import type { FindingCounts } from './events.js'
import { readRoundDigests, recordRoundDigests } from './materialize.js'
import type { ResolverOutput, ReviewLoopDeps, ReviewLoopOptions, ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution, readResolutionsLedger } from './review-model.js'
import type { ConvergenceContext } from './review-model.js'

export interface ClosedRound {
  readonly verdict: ReviewLoopResult['verdict']
  readonly raised: FindingCounts
  readonly openLists: Pick<ReviewLoopResult, 'openBlockers' | 'openMaterial' | 'openNitpicks'>
  /** Cross-round concern history as of this round's close (loop-memory D5). */
  readonly concernHistory: readonly ConcernRecord[]
}

/**
 * Close a round: snapshot the agent-authored artifacts as the resolver left
 * them — the next round compares against this to tell a real edit from a
 * claimed one — then take the verdict over them, record it, materialize the
 * round's views, and persist the cross-round concern history the thrash gate
 * reads. The concern sidecar is written after materialization and before the
 * `round_close` event, so a run interrupted at the boundary still leaves the
 * history the next round would have compared against.
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
  const concernHistory = await writeConcernSidecar(deps, round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap })
  const openOf = (cls: Resolution['class']): Resolution[] =>
    resolved.resolutions.filter(
      (entry) => entry.class === cls && isOpenResolution(entry, context.assumptions, context.digests),
    )
  return {
    verdict,
    raised,
    concernHistory,
    openLists: {
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    },
  }
}

/** Round-close concern sidecar (loop-memory D5): persist the cross-round concern history. */
async function writeConcernSidecar(deps: ReviewLoopDeps, round: number): Promise<readonly ConcernRecord[]> {
  const ledger = await readResolutionsLedger(deps.sidecarDir, round + 1)
  const records = concernRecords(ledger)
  await mkdir(path.dirname(path.join(deps.sidecarDir, 'concerns.json')), { recursive: true })
  await writeFile(path.join(deps.sidecarDir, 'concerns.json'), `${JSON.stringify(records, null, 2)}\n`)
  return records
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
