// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Finding, Resolution } from '../agent-layer.js'
import type { FindingCounts } from '../events.js'
import { concernRecords, detectConcernThrash } from './concern-model.js'
import type { ConcernRecord } from './concern-model.js'
import { readRoundDigests, readRoundGaps, recordRoundDigests } from './materialize.js'
import type { ResolverOutput, ReviewLoopDeps, ReviewLoopOptions, ReviewLoopResult } from './review-loop.js'
import { evaluateConvergence, isOpenResolution, readResolutionsLedger } from './review-model.js'
import type { ConvergenceContext } from './review-model.js'

export interface ClosedRound {
  readonly verdict: ReviewLoopResult['verdict']
  readonly raised: FindingCounts
  readonly openLists: Pick<ReviewLoopResult, 'openBlockers' | 'openMaterial' | 'openNitpicks'>
  readonly gaps: Record<string, string>
  /** Cross-round concern history as of this round's close (loop-memory D5). */
  readonly concernHistory: readonly ConcernRecord[]
  /** Thrashing concerns detected at this close (loop-memory D6); empty when none. */
  readonly recurringConcerns: readonly ConcernRecord[]
}

/**
 * Close a round: snapshot the agent-authored artifacts as the resolver left
 * them — the next round compares against this to tell a real edit from a
 * claimed one — then take the verdict over them, record it (carrying thrash
 * cluster ids when the round re-raised a recurring concern, so the fold holds
 * the thrash fact), materialize the round's views, and persist the cross-round
 * concern history the next detection compares against. The concern sidecar is
 * written after materialization and before the `round_close` event, so a run
 * interrupted at the boundary still leaves the history behind.
 */
export async function closeRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  resolved: ResolverOutput,
  merged: readonly Finding[],
  round: number,
  cap: number,
): Promise<ClosedRound> {
  await recordRoundDigests(deps.sidecarDir, options.changeDir, round)
  const context = await roundContext(deps, resolved, round)
  const { verdict, raised, open } = evaluateConvergence(resolved.resolutions, context)
  const concernHistory = await concernHistoryAt(deps, round)
  const recurringConcerns = detectConcernThrash(concernHistory, merged, round)
  deps.emit({
    altitude: 'L2',
    type: 'convergence',
    round,
    verdict,
    counts: raised,
    open,
    ...(recurringConcerns.length === 0 ? {} : { concerns: recurringConcerns.map((record) => record.fingerprint) }),
  })
  await deps.materialize(round)
  await writeConcernSidecar(deps, round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap })
  const openOf = (cls: Resolution['class']): Resolution[] =>
    resolved.resolutions.filter(
      (entry) => entry.class === cls && isOpenResolution(entry, context.assumptions, context.digests),
    )
  return {
    verdict,
    raised,
    concernHistory,
    recurringConcerns,
    openLists: {
      openBlockers: openOf('BLOCKER'),
      openMaterial: openOf('MATERIAL'),
      openNitpicks: openOf('NITPICK'),
    },
    gaps: await readRoundGaps(deps.sidecarDir, round),
  }
}

/** The cross-round concern history including this round's just-written resolutions. */
async function concernHistoryAt(deps: ReviewLoopDeps, round: number): Promise<readonly ConcernRecord[]> {
  return concernRecords(await readResolutionsLedger(deps.sidecarDir, round + 1))
}

/** Round-close concern sidecar (loop-memory D5): persist the cross-round concern history. */
async function writeConcernSidecar(deps: ReviewLoopDeps, round: number): Promise<void> {
  const records = await concernHistoryAt(deps, round)
  const target = path.join(deps.sidecarDir, 'concerns.json')
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(records, null, 2)}\n`)
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
