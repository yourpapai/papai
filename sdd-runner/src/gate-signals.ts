// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readEvents } from './events.js'
import type { SddEvent } from './events.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { buildResolveCost, costAndDuration, logPathFor, nowOf } from './gate-digest.js'
import type { GateAssumption } from './gate-model.js'
import { replayEvents } from './replay.js'
import type { ReviewLoopResult } from './review-loop.js'
import type { RunState } from './run-state.js'

export async function gatherGateSignals(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  reviewResult: ReviewLoopResult,
): Promise<{
  events: readonly SddEvent[]
  costUsd: number
  costKnown: boolean
  durationMs: number
  assumptions: readonly GateAssumption[]
  trajectory: ReturnType<typeof replayEvents>['perRound']
}> {
  const events = readEvents(logPathFor(state))
  const resolve = deps.resolveCost ?? (await buildResolveCost())
  const { costUsd, durationMs, costKnown } = costAndDuration(events, state.createdAt, nowOf(deps), resolve)
  const assumptions = await gatherAssumptions(ctx.sidecarDir, reviewResult.rounds)
  const trajectory = replayEvents(logPathFor(state)).perRound
  return { events, costUsd, costKnown, durationMs, assumptions, trajectory }
}
