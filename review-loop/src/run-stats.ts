// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { estimateCostUsd, matchPrice, type PricingTable } from './cost.js'
import type { DiffStats } from './diff-stats.js'

export interface UsageInput {
  input: number
  output: number
  reasoning: number
  model?: string
}

export interface LabelStats {
  input: number
  output: number
  reasoning: number
  toolCalls: number
  added: number
  removed: number
}

export interface StatsTotals extends LabelStats {
  estimatedCostUsd?: number
}

export interface StatsSnapshot {
  totals: StatsTotals & { elapsedMs: number }
  perLabel: Record<string, LabelStats>
}

export const LabelStatsSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  toolCalls: z.number(),
  added: z.number(),
  removed: z.number(),
})

export const PersistedStatsSchema = z.object({
  totals: LabelStatsSchema.extend({ estimatedCostUsd: z.number().optional() }),
  perLabel: z.record(z.string(), LabelStatsSchema),
})
export type PersistedStats = z.infer<typeof PersistedStatsSchema>

export interface RunStatsOptions {
  pricing?: PricingTable
  model?: string
  startedAt?: number
  now?: () => number
}

function clamp(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

function emptyLabelStats(): LabelStats {
  return { input: 0, output: 0, reasoning: 0, toolCalls: 0, added: 0, removed: 0 }
}

export class RunStats {
  private readonly pricing: PricingTable | undefined
  private readonly model: string | undefined
  private readonly startedAt: number
  private readonly now: () => number
  private readonly totals: LabelStats = emptyLabelStats()
  private readonly perLabel = new Map<string, LabelStats>()
  private estimatedCost = 0
  private hasCost = false

  constructor(options: RunStatsOptions = {}) {
    this.pricing = options.pricing
    this.model = options.model
    this.now = options.now ?? Date.now
    this.startedAt = options.startedAt ?? this.now()
  }

  static rehydrate(persisted: PersistedStats | undefined, options: RunStatsOptions = {}): RunStats {
    const stats = new RunStats(options)
    if (persisted === undefined) return stats
    for (const [label, entry] of Object.entries(persisted.perLabel)) {
      stats.perLabel.set(label, { ...entry })
    }
    stats.totals.input = persisted.totals.input
    stats.totals.output = persisted.totals.output
    stats.totals.reasoning = persisted.totals.reasoning
    stats.totals.toolCalls = persisted.totals.toolCalls
    stats.totals.added = persisted.totals.added
    stats.totals.removed = persisted.totals.removed
    if (persisted.totals.estimatedCostUsd !== undefined) {
      stats.estimatedCost = persisted.totals.estimatedCostUsd
      stats.hasCost = true
    }
    return stats
  }

  addUsage(label: string, delta: UsageInput): void {
    const entry = this.labelEntry(label)
    entry.input += clamp(delta.input)
    entry.output += clamp(delta.output)
    entry.reasoning += clamp(delta.reasoning)
    this.totals.input += clamp(delta.input)
    this.totals.output += clamp(delta.output)
    this.totals.reasoning += clamp(delta.reasoning)
    const model = delta.model ?? this.model
    if (this.pricing !== undefined && model !== undefined) {
      const price = matchPrice(this.pricing, model)
      if (price !== undefined) {
        this.estimatedCost += estimateCostUsd(price, clamp(delta.input), clamp(delta.output))
        this.hasCost = true
      }
    }
  }

  addToolCalls(label: string, n: number): void {
    const delta = Math.floor(clamp(n))
    this.labelEntry(label).toolCalls += delta
    this.totals.toolCalls += delta
  }

  addDiff(label: string, diff: DiffStats): void {
    const entry = this.labelEntry(label)
    entry.added += clamp(diff.added)
    entry.removed += clamp(diff.removed)
    this.totals.added += clamp(diff.added)
    this.totals.removed += clamp(diff.removed)
  }

  snapshot(): StatsSnapshot {
    return {
      totals: { ...this.totals, ...this.costField(), elapsedMs: Math.max(0, this.now() - this.startedAt) },
      perLabel: Object.fromEntries([...this.perLabel].map(([label, entry]) => [label, { ...entry }])),
    }
  }

  persist(): PersistedStats {
    return {
      totals: { ...this.totals, ...this.costField() },
      perLabel: Object.fromEntries([...this.perLabel].map(([label, entry]) => [label, { ...entry }])),
    }
  }

  private costField(): { estimatedCostUsd?: number } {
    return this.hasCost ? { estimatedCostUsd: this.estimatedCost } : {}
  }

  private labelEntry(label: string): LabelStats {
    let entry = this.perLabel.get(label)
    if (entry === undefined) {
      entry = emptyLabelStats()
      this.perLabel.set(label, entry)
    }
    return entry
  }
}
