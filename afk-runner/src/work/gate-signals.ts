// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { AgentUsage, SddEvent } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import type { ConcernRecord } from './concern-model.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { GateAssumption, GateBlocker, GateFinding } from './gate-model.js'
import type { ReviewLoopResult } from './review-loop.js'

/** The persisted `sidecars/concerns.json` shape (loop-memory D5) — parse, never trust. */
const ConcernHistorySchema = z.array(
  z.object({
    fingerprint: z.string().min(1),
    firstRound: z.number().int().positive(),
    lastRound: z.number().int().positive(),
    entries: z.array(
      z.object({
        round: z.number().int().positive(),
        id: z.string().min(1),
        class: z.string().min(1),
        resolution: z.string().min(1),
        outcome: z.string().optional(),
      }),
    ),
  }),
)

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

/** The zero usage every accumulation starts from (one home: accounting and the analyzer both import it). */
export const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0,
  wallMs: 0,
}

/** Sum two usages field by field. */
export function plusUsage(acc: AgentUsage, add: AgentUsage): AgentUsage {
  return {
    inputTokens: acc.inputTokens + add.inputTokens,
    outputTokens: acc.outputTokens + add.outputTokens,
    reasoningTokens: acc.reasoningTokens + add.reasoningTokens,
    cachedReadTokens: acc.cachedReadTokens + add.cachedReadTokens,
    cachedWriteTokens: acc.cachedWriteTokens + add.cachedWriteTokens,
    costUsd: acc.costUsd + add.costUsd,
    wallMs: acc.wallMs + add.wallMs,
  }
}

/** Every token bucket of a usage record, summed. */
export function tokensOf(usage: AgentUsage): number {
  return (
    usage.inputTokens + usage.outputTokens + usage.reasoningTokens + usage.cachedReadTokens + usage.cachedWriteTokens
  )
}

/**
 * Spend over the run's `done` events (usage-aggregate copy, resolve seam
 * omitted — afk-runner has no pricing DB): an agent that finished with
 * tokens but a zero cost is unknown spend, fail-closed for the ladder (R4).
 * Tokens ride the same fold (U9 cross-run accounting) — cost stays the
 * summary's shape so its render consumers are unchanged. The accumulation
 * itself is `EMPTY_USAGE`/`plusUsage` (master `bfa4ebedf` shape) — one home,
 * shared with the analyzer's per-role/per-round fold.
 */
export function usageTotalsOf(events: readonly SddEvent[]): UsageTotals {
  let usage: AgentUsage = EMPTY_USAGE
  let costKnown = true
  for (const event of events) {
    if (event.type !== 'done') continue
    usage = plusUsage(usage, event.usage)
    if (event.usage.costUsd === 0 && tokensOf(event.usage) > 0) costKnown = false
  }
  return { costUsd: usage.costUsd, costKnown, tokens: tokensOf(usage) }
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

/**
 * The thrash clusters a gate should carry (loop-memory D6): the persisted
 * concern history filtered to the cluster ids on the folded last verdict —
 * fold-derived, so a resumed run gathers the same block after a crash.
 */
export async function concernHistoryOf(
  sidecarDir: string,
  lastVerdict: { readonly concerns?: readonly string[] } | null,
): Promise<readonly ConcernRecord[]> {
  const clusters = lastVerdict?.concerns ?? []
  if (clusters.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(sidecarDir, 'concerns.json'), 'utf8'))
    if (!Array.isArray(parsed)) return []
    const wanted = new Set(clusters)
    const records: readonly ConcernRecord[] = ConcernHistorySchema.parse(parsed)
    return records.filter((record) => wanted.has(record.fingerprint))
  } catch {
    return []
  }
}
