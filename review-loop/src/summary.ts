// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewLoopResult } from './loop-controller.js'
import type { PhaseMs, RoundMetric, Severity, SeverityCounts, UsageTotals } from './trace-log.js'

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const PHASE_KEYS: (keyof PhaseMs)[] = ['review', 'match', 'verify', 'build', 'inspect', 'fix']

interface StatusCounts {
  open: number
  closed: number
  rejected: number
  alreadyFixed: number
  needsHuman: number
  reopened: number
}

export interface MetricsJson {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  poolSize: number
  burndown: RoundMetric[]
  usage: UsageTotals
  phaseMs: PhaseMs
  totals: StatusCounts & { inspectorRejected: number }
}

export interface SummaryOptions {
  poolSize: number
  inspect: boolean
}

function sumDecisions(metrics: readonly RoundMetric[], key: keyof RoundMetric['decisions']): number {
  return metrics.reduce((s, m) => s + m.decisions[key], 0)
}

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

function burndownBlock(metrics: readonly RoundMetric[]): string {
  const header = 'round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix'
  const rows = metrics.map((m) => {
    const decided =
      m.decisions.fixed +
      m.decisions.invalid +
      m.decisions.already_fixed +
      m.decisions.needs_human +
      m.decisions.plan_drift +
      m.decisions.no_commit +
      m.decisions.inspector_rejected
    return [
      String(m.round).padEnd(6),
      String(m.newIssues).padEnd(4),
      String(m.cumulativeOpen).padEnd(5),
      String(m.decisions.fixed).padEnd(6),
      String(m.decisions.invalid).padEnd(9),
      String(m.decisions.needs_human).padEnd(12),
      String(m.decisions.plan_drift).padEnd(11),
      String(m.decisions.inspector_rejected).padEnd(9),
      avgSeverity(m.reviewerSeverity, m.newIssues).padEnd(7),
      avgSeverity(m.fixerSeverity, decided),
    ].join('')
  })
  return ['Burndown:', header, ...rows].join('\n')
}

function aggregatePhaseMs(metrics: readonly RoundMetric[]): PhaseMs {
  const phaseMs: PhaseMs = { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  for (const m of metrics) {
    for (const k of PHASE_KEYS) {
      phaseMs[k] += m.phaseMs[k]
    }
  }
  return phaseMs
}

function aggregateUsage(metrics: readonly RoundMetric[]): UsageTotals {
  return metrics.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.usage.inputTokens,
      outputTokens: acc.outputTokens + m.usage.outputTokens,
      reasoningTokens: acc.reasoningTokens + m.usage.reasoningTokens,
      costUsd: acc.costUsd + m.usage.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  )
}

function msToSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function computeStatusLines(metrics: readonly RoundMetric[], closed: number): string[] {
  const lastMetric = metrics.length > 0 ? metrics[metrics.length - 1] : undefined
  const openIssues = lastMetric === undefined ? 0 : lastMetric.cumulativeOpen
  return [
    `Closed issues: ${closed}`,
    `Open issues: ${openIssues}`,
    `Rejected issues: ${sumDecisions(metrics, 'invalid')}`,
    `Already fixed: ${sumDecisions(metrics, 'already_fixed')}`,
    `Needs human: ${sumDecisions(metrics, 'needs_human')}`,
    `Reopened issues: 0`,
  ]
}

function computeObservabilityLines(metrics: readonly RoundMetric[], options: SummaryOptions): string[] {
  const totalInspectorRuns = metrics.reduce((s, m) => s + m.inspector.runs, 0)
  const totalInspectorRejected = metrics.reduce((s, m) => s + m.inspector.rejected, 0)
  const usage = aggregateUsage(metrics)
  const phaseMs = aggregatePhaseMs(metrics)
  const rejectRate =
    totalInspectorRuns === 0 ? 'n/a' : `${((100 * totalInspectorRejected) / totalInspectorRuns).toFixed(1)}%`

  const lines: string[] = []
  if (options.inspect) {
    lines.push(`Inspector: ${totalInspectorRuns} runs, ${totalInspectorRejected} rejected (${rejectRate} reject rate)`)
  }

  lines.push(
    '',
    `Total cost: $${usage.costUsd.toFixed(3)} (in ${usage.inputTokens} / out ${usage.outputTokens} / reasoning ${usage.reasoningTokens} tokens)`,
    'Wall clock:',
    `  review:  ${msToSeconds(phaseMs.review)}`,
    `  match:   ${msToSeconds(phaseMs.match)}`,
    `  verify:  ${msToSeconds(phaseMs.verify)}`,
    `  build:   ${msToSeconds(phaseMs.build)}`,
    `  inspect: ${msToSeconds(phaseMs.inspect)}`,
    `  fix:     ${msToSeconds(phaseMs.fix)}`,
  )
  return lines
}

export function buildSummary(
  doneReason: string,
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
): string {
  const lines = [
    `Done reason: ${doneReason}`,
    `Rounds executed: ${rounds}`,
    options.poolSize > 1 ? `Pool size: ${options.poolSize}` : '',
    ...computeStatusLines(metrics, closed),
    ...computeObservabilityLines(metrics, options),
  ]

  if (metrics.length > 0) {
    lines.push('', burndownBlock(metrics))
  }

  return lines.filter(Boolean).join('\n')
}

export function buildMetricsJson(
  doneReason: ReviewLoopResult['doneReason'],
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
): MetricsJson {
  const lastMetric = metrics.length > 0 ? metrics[metrics.length - 1] : undefined
  return {
    doneReason,
    rounds,
    poolSize: options.poolSize,
    burndown: [...metrics],
    usage: aggregateUsage(metrics),
    phaseMs: aggregatePhaseMs(metrics),
    totals: {
      open: lastMetric === undefined ? 0 : lastMetric.cumulativeOpen,
      closed,
      rejected: sumDecisions(metrics, 'invalid'),
      alreadyFixed: sumDecisions(metrics, 'already_fixed'),
      needsHuman: sumDecisions(metrics, 'needs_human'),
      reopened: 0,
      inspectorRejected: metrics.reduce((s, m) => s + m.inspector.rejected, 0),
    },
  }
}
