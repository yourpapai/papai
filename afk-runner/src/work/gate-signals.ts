// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateAssumption, GateBlocker, GateFinding } from './gate-model.js'
import type { ReviewLoopResult } from './review-loop.js'

/** Row width that keeps a checkbox line readable and the grammar intact. */
const MAX_GAP_LEN = 200

/**
 * A gap as a gate row can safely carry it: one line, no leading redirect
 * marker, bounded length. The checkbox grammar anchors on `- [x] F3` at line
 * start and a redirect is a line opening with an arrow, so an unsanitized
 * multi-line gap could otherwise be parsed back as a decision it never was.
 */
export function sanitizeRowGap(id: string, gaps: Record<string, string> | undefined): string {
  const raw = gaps?.[id]
  if (raw === undefined || raw.trim() === '') return id
  const flat = raw
    .replace(/\s+/gu, ' ')
    .replace(/^[\s→]+/u, '')
    .trim()
  if (flat === '') return id
  return flat.length > MAX_GAP_LEN ? `${flat.slice(0, MAX_GAP_LEN - 1)}…` : flat
}

/**
 * Open findings as the gate digest renders them: the row carries the finding's
 * verbatim gap (joined from the round's findings sidecars, sanitized); the
 * resolver sidecar's outcome or justification is the evidence.
 */
export function findingsOf(result: ReviewLoopResult): {
  blockers: GateBlocker[]
  material: GateFinding[]
  nitpicks: GateFinding[]
} {
  const blockers = result.openBlockers.map((entry) => ({
    id: entry.id,
    gap: sanitizeRowGap(entry.id, result.gaps),
    evidence: entry.outcome ?? entry.justification ?? '',
  }))
  const material = result.openMaterial.map((entry) => ({
    id: entry.id,
    gap: sanitizeRowGap(entry.id, result.gaps),
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  const nitpicks = result.openNitpicks.map((entry) => ({
    id: entry.id,
    gap: sanitizeRowGap(entry.id, result.gaps),
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  return { blockers, material, nitpicks }
}

export interface CostSummary {
  readonly costUsd: number
  readonly costKnown: boolean
}

export interface UsageTotals extends CostSummary {
  readonly tokens: number
}

/**
 * Spend over the run's `done` events (usage-aggregate copy, resolve seam
 * omitted — afk-runner has no pricing DB): an agent that finished with
 * tokens but a zero cost is unknown spend, fail-closed for the ladder (R4).
 * Tokens ride the same fold (U9 cross-run accounting) — cost stays the
 * summary's shape so its render consumers are unchanged.
 */
export function usageTotalsOf(events: readonly SddEvent[]): UsageTotals {
  let costUsd = 0
  let costKnown = true
  let tokens = 0
  for (const event of events) {
    if (event.type !== 'done') continue
    costUsd += event.usage.costUsd
    const eventTokens =
      event.usage.inputTokens +
      event.usage.outputTokens +
      event.usage.reasoningTokens +
      event.usage.cachedReadTokens +
      event.usage.cachedWriteTokens
    tokens += eventTokens
    if (event.usage.costUsd === 0 && eventTokens > 0) costKnown = false
  }
  return { costUsd, costKnown, tokens }
}

export function costSummaryOf(events: readonly SddEvent[]): CostSummary {
  const { costUsd, costKnown } = usageTotalsOf(events)
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
