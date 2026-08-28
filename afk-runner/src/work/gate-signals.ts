// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateAssumption, GateBlocker, GateFinding } from './gate-model.js'
import type { ReviewLoopResult } from './review-loop.js'

/**
 * Open findings as the gate digest renders them (sdd-runner `findingsOf`
 * copy): the id doubles as the gap line; the resolver sidecar's outcome or
 * justification is the evidence.
 */
export function findingsOf(result: ReviewLoopResult): {
  blockers: GateBlocker[]
  material: GateFinding[]
  nitpicks: GateFinding[]
} {
  const blockers = result.openBlockers.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: entry.outcome ?? entry.justification ?? '',
  }))
  const material = result.openMaterial.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  const nitpicks = result.openNitpicks.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  return { blockers, material, nitpicks }
}

export interface CostSummary {
  readonly costUsd: number
  readonly costKnown: boolean
}

/**
 * Spend over the run's `done` events (usage-aggregate copy, resolve seam
 * omitted — afk-runner has no pricing DB): an agent that finished with
 * tokens but a zero cost is unknown spend, fail-closed for the ladder (R4).
 */
export function costSummaryOf(events: readonly SddEvent[]): CostSummary {
  let costUsd = 0
  let costKnown = true
  for (const event of events) {
    if (event.type !== 'done') continue
    costUsd += event.usage.costUsd
    const tokens =
      event.usage.inputTokens +
      event.usage.outputTokens +
      event.usage.reasoningTokens +
      event.usage.cachedReadTokens +
      event.usage.cachedWriteTokens
    if (event.usage.costUsd === 0 && tokens > 0) costKnown = false
  }
  return { costUsd, costKnown }
}

export interface GateSignals {
  readonly assumptions: readonly GateAssumption[]
  readonly trajectory: KernelContext['perRound']
  readonly costUsd: number
  readonly costKnown: boolean
  readonly durationMs: number
}

/** Everything a presentation needs beyond the review result itself (gate-signals copy). */
export async function gatherGateSignals(
  sidecarDir: string,
  rounds: number,
  context: KernelContext,
  events: readonly SddEvent[],
  createdAt: string,
  now: Date,
): Promise<GateSignals> {
  const { costUsd, costKnown } = costSummaryOf(events)
  return {
    assumptions: await gatherAssumptions(sidecarDir, rounds),
    trajectory: context.perRound,
    costUsd,
    costKnown,
    durationMs: Math.max(0, now.getTime() - new Date(createdAt).getTime()),
  }
}
