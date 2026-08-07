// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDuration, formatTokenCount } from '../../review-loop/src/live-format.js'
import type { StatsSnapshot } from '../../review-loop/src/run-stats.js'
import type { IterationResult } from './pipeline.js'
import type { MutationImproveRunState } from './run-state.js'

export interface RunSummaryInput {
  runState: MutationImproveRunState
  results: readonly IterationResult[]
  stats: StatsSnapshot
  aborted: boolean
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

function mergedRow(entry: MutationImproveRunState['merged'][number], stats: StatsSnapshot): string {
  const outcome = entry.capped === true ? 'capped' : 'improved'
  const diff = stats.perLabel[`iter-${entry.iter}`]
  const diffPart = diff !== undefined && (diff.added > 0 || diff.removed > 0) ? `+${diff.added}/-${diff.removed}` : '-'
  return `  ${entry.file}  ${pct(entry.beforeScore)} → ${pct(entry.afterScore)}  ${outcome}  ${diffPart}`
}

function totalsLine(stats: StatsSnapshot): string {
  const t = stats.totals
  const parts = [`in ${formatTokenCount(t.input)} / out ${formatTokenCount(t.output)}`]
  if (t.estimatedCostUsd !== undefined) parts.push(`~$${t.estimatedCostUsd.toFixed(2)} est`)
  if (t.toolCalls > 0) parts.push(`tools ${t.toolCalls}`)
  if (t.added > 0 || t.removed > 0) parts.push(`+${t.added}/-${t.removed}`)
  parts.push(formatDuration(t.elapsedMs))
  return `Totals: ${parts.join(' · ')}`
}

export function buildRunSummary(input: RunSummaryInput): string {
  const { runState, results, stats, aborted } = input
  const status = aborted ? 'aborted' : runState.failed.length > 0 ? 'completed with failures' : 'completed'
  const lines = [
    `Run summary (${runState.runId}) — ${status}: ${runState.merged.length} merged, ${runState.failed.length} failed, ${results.length} iterations`,
  ]
  for (const entry of runState.merged) {
    lines.push(mergedRow(entry, stats))
  }
  for (const f of runState.failed) {
    lines.push(`  ${f.file ?? '(no file)'}  failed at ${f.gate}: ${f.reason}`)
  }
  lines.push(totalsLine(stats))
  return lines.join('\n')
}
