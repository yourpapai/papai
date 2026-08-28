// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StageId } from './events.js'
import type { ReplayState } from './replay.js'
import type { PersistedRunState } from './run-state.js'

export interface ResumePoint {
  readonly stage: StageId
  readonly round: number
  readonly reason: string
}

function isDone(artifacts: Record<string, string>, id: string): boolean {
  return artifacts[id] === 'done'
}

function draftComplete(state: PersistedRunState, artifacts: Record<string, string>): boolean {
  if (!isDone(artifacts, 'proposal') || !isDone(artifacts, 'specs')) return false
  return state.depth === 'S' || isDone(artifacts, 'design')
}

/**
 * The review loop counts as settled when a converged verdict is recorded, a
 * cap-hit verdict was accepted by a human at an early gate (approve =
 * human-decree convergence, possibly via extend rounds whose last verdict
 * stays `open`), or the pipeline already moved past review into decompose
 * (severity-based convergence — nitpick-only cap-hit — flows through without
 * any gate). A presented-but-unanswered gate cannot reach the later clauses:
 * `state.gate !== null` short-circuits earlier.
 */
function reviewSettled(replay: ReplayState): boolean {
  if (replay.lastVerdict?.verdict === 'converged') return true
  if (replay.gate?.mode === 'early' && replay.gate.answered) return true
  return replay.stages.decompose !== 'pending'
}

interface PendingChild {
  readonly id: string
  readonly position: number
  readonly total: number
}

/**
 * D6 continuation child (D8 crash window): a run born in the post-review tail
 * — persisted stage 'atomicity'/'gate' while its own log holds no review
 * history (no review stage enter, no round, no verdict — the review evidence
 * lives in the parent's log, so the replay fold cannot see it settled). Its
 * resume re-enters at the persisted tail entry instead of re-reviewing. A
 * normal run persists those stages only after its own review settled, which
 * the replay guard reflects, so drifted singles stay on the artifact cascade.
 */
export function isContinuationTailEntry(state: PersistedRunState, replay: ReplayState): boolean {
  return (
    (state.stage === 'atomicity' || state.stage === 'gate') &&
    replay.stages.review === 'pending' &&
    replay.round === null &&
    replay.lastVerdict === null
  )
}

/** Next child in topo order whose status is not done; a missing map counts as all-pending (D10). */
function nextPendingChild(state: PersistedRunState): PendingChild | null {
  if (state.plan === undefined) return null
  const childIds = state.plan.childIds
  const children = state.children ?? {}
  for (const [index, id] of childIds.entries()) {
    if (children[id]?.status !== 'done') return { id, position: index + 1, total: childIds.length }
  }
  return null
}

export function deriveResumePoint(
  state: PersistedRunState,
  artifacts: Record<string, string>,
  replay: ReplayState,
): ResumePoint {
  if (state.gate !== null) return { stage: 'gate', round: state.round, reason: 'gate-pending' }
  const pendingChild = nextPendingChild(state)
  if (pendingChild !== null) {
    return {
      stage: 'decompose',
      round: state.round,
      reason: `children pending: next ${pendingChild.id} (${pendingChild.position} of ${pendingChild.total})`,
    }
  }
  if (state.depth === null) return { stage: 'intake', round: 0, reason: 'depth not classified' }
  if (isContinuationTailEntry(state, replay)) {
    return { stage: state.stage, round: state.round, reason: 'continuation child tail entry' }
  }
  if (!draftComplete(state, artifacts)) return { stage: 'draft', round: 0, reason: 'draft artifacts incomplete' }
  if (!reviewSettled(replay)) {
    const round = Math.max(state.round, replay.round?.current ?? 0, 1)
    return { stage: 'review', round, reason: 'review loop not converged' }
  }
  if (!isDone(artifacts, 'tasks')) return { stage: 'decompose', round: state.round, reason: 'tasks.md missing' }
  if (state.depth !== 'S' && replay.stages.atomicity !== 'done') {
    return { stage: 'atomicity', round: state.round, reason: 'atomicity check not recorded' }
  }
  return { stage: 'gate', round: state.round, reason: 'all stages complete' }
}
