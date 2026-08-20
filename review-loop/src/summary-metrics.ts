// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PhaseMs, RoundMetric, UsageTotals } from './trace-log.js'

/**
 * Arithmetic over a run's round metrics, split from `summary.ts`, which is
 * about rendering them. These are the only functions in the pair that a caller
 * can reuse without wanting a string back — `buildMetricsJson` needs the totals
 * and none of the prose.
 */

export const PHASE_KEYS: (keyof PhaseMs)[] = ['review', 'match', 'verify', 'build', 'inspect', 'fix']

export function sumDecisions(metrics: readonly RoundMetric[], key: keyof RoundMetric['decisions']): number {
  return metrics.reduce((s, m) => s + m.decisions[key], 0)
}

export function aggregatePhaseMs(metrics: readonly RoundMetric[]): PhaseMs {
  const phaseMs: PhaseMs = { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  for (const m of metrics) {
    for (const k of PHASE_KEYS) {
      phaseMs[k] += m.phaseMs[k]
    }
  }
  return phaseMs
}

export function aggregateUsage(metrics: readonly RoundMetric[]): UsageTotals {
  return metrics.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.usage.inputTokens,
      outputTokens: acc.outputTokens + m.usage.outputTokens,
      reasoningTokens: acc.reasoningTokens + m.usage.reasoningTokens,
      cachedReadTokens: acc.cachedReadTokens + m.usage.cachedReadTokens,
      cachedWriteTokens: acc.cachedWriteTokens + m.usage.cachedWriteTokens,
      costUsd: acc.costUsd + m.usage.costUsd,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
    },
  )
}
