// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDuration } from './live-format.js'
import { aggregatePhaseMs, aggregateUsage, PHASE_KEYS } from './summary-metrics.js'
import type { RoundMetric } from './trace-log.js'

/**
 * The summary lines derived from round metrics, split out of `summary.ts` when
 * that file passed `max-lines`. They share one shape — read the metrics, return
 * a line or `null` when there is nothing worth saying — and none of them knows
 * anything about the ledger, the run directory or the verdict.
 *
 * `buildInspectorLine` takes `inspect` rather than `SummaryOptions` on purpose:
 * that type lives in `summary.ts`, and importing it back would make a cycle
 * (`import/no-cycle` is an error here).
 */

export function msToSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function buildTimingLine(metrics: readonly RoundMetric[], wallMs: number): string {
  const phaseMs = aggregatePhaseMs(metrics)
  const totalMs = PHASE_KEYS.reduce((s, k) => s + phaseMs[k], 0)
  const parts = PHASE_KEYS.filter((k) => phaseMs[k] > 0).map((k) => `${k} ${msToSeconds(phaseMs[k])}`)
  const breakdown = parts.length === 0 ? 'no phase timing recorded' : parts.join(', ')
  const usage = aggregateUsage(metrics)
  const cachedPart = usage.cachedReadTokens > 0 ? ` / cached ${formatCount(usage.cachedReadTokens)}` : ''
  const tokens = `in ${formatCount(usage.inputTokens)}${cachedPart} / out ${formatCount(usage.outputTokens)} / reasoning ${formatCount(usage.reasoningTokens)}`
  const cost = usage.costUsd > 0 ? `Cost: $${usage.costUsd.toFixed(3)} (${tokens})` : `Tokens: ${tokens}`
  return `Duration: ${formatDuration(wallMs)} wall · phases ${formatDuration(totalMs)} (${breakdown}) · ${cost}`
}

export function buildInspectorLine(metrics: readonly RoundMetric[], inspect: boolean): string | null {
  if (!inspect) return null
  const runs = metrics.reduce((s, m) => s + m.inspector.runs, 0)
  if (runs === 0) return null
  const rejected = metrics.reduce((s, m) => s + m.inspector.rejected, 0)
  const rate = `${((100 * rejected) / runs).toFixed(1)}%`
  return `Inspector: ${runs} runs, ${rejected} rejected (${rate} reject rate)`
}

/**
 * Reported from the reviewer's answers, with the fixer's second opinion folded
 * in only as the divergence count — the two distributions side by side would
 * invite reading one as a correction of the other, and neither is authoritative.
 *
 * Omitted entirely when nobody answered: a row of zeros reads as "nothing is
 * reachable" rather than "nobody was asked".
 */
export function buildExposureLine(metrics: readonly RoundMetric[]): string | null {
  const cited = metrics.reduce((s, m) => s + m.reviewerExposure.caller, 0)
  const none = metrics.reduce((s, m) => s + m.reviewerExposure.none, 0)
  if (cited + none === 0) return null
  const divergent = metrics.reduce((s, m) => s + m.exposureDivergent, 0)
  return `Exposure: ${cited} cited, ${none} none, ${divergent} divergent (advisory — orders dispatch, gates nothing)`
}

/**
 * Counted over accepted fixes only — a rejected fix leaving no test behind is
 * not a finding. `unmeasured` is reported separately rather than folded into
 * the denominator, so a run whose diffs could not be read does not read as a
 * run whose fixer skipped its tests.
 */
export function buildCheckBehindLine(metrics: readonly RoundMetric[]): string | null {
  const withCheck = metrics.reduce((s, m) => s + m.checkBehind.defect.withCheck, 0)
  const measured = withCheck + metrics.reduce((s, m) => s + m.checkBehind.defect.withoutCheck, 0)
  const unmeasured = metrics.reduce((s, m) => s + m.checkBehind.defect.unmeasured, 0)
  const cleanups = metrics.reduce(
    (s, m) =>
      s + m.checkBehind.cleanup.withCheck + m.checkBehind.cleanup.withoutCheck + m.checkBehind.cleanup.unmeasured,
    0,
  )
  if (measured + unmeasured + cleanups === 0) return null
  const tail = unmeasured > 0 ? ` (${unmeasured} unmeasured)` : ''
  // Cleanups are counted, never folded in: deleting code introduces no
  // non-trivial logic, so a cleanup that leaves no check is following the rule
  // rather than breaking it, and averaging the two hides both answers.
  const cleanupTail = cleanups > 0 ? `; ${cleanups} cleanup ${cleanups === 1 ? 'fix' : 'fixes'} not counted` : ''
  return `Checks left behind: ${withCheck} of ${measured} accepted defect fixes${tail}${cleanupTail}`
}

/**
 * What the reviewer reported, split by kind. Reported so the effect of
 * admitting cleanups can be read after the fact — it gates nothing.
 */
export function buildKindLine(metrics: readonly RoundMetric[]): string | null {
  const cleanup = metrics.reduce((s, m) => s + m.reviewerKind.cleanup, 0)
  const defect = metrics.reduce((s, m) => s + m.reviewerKind.defect, 0)
  if (cleanup === 0) return null
  return `Findings: ${defect} defect, ${cleanup} cleanup`
}
