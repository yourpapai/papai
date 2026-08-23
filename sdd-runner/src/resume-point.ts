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

export function deriveResumePoint(
  state: PersistedRunState,
  artifacts: Record<string, string>,
  replay: ReplayState,
): ResumePoint {
  if (state.gate !== null) return { stage: 'gate', round: state.round, reason: 'gate-pending' }
  if (state.depth === null) return { stage: 'intake', round: 0, reason: 'depth not classified' }
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
