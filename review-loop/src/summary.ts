// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  formatIssueRef,
  GROUP_LABEL,
  GROUP_MARK,
  GROUP_ORDER,
  groupForStatus,
  type IssueGroup,
} from './issue-format.js'
import type { IssueLedgerSnapshot, LedgerIssueRecord } from './issue-ledger.js'
import { formatDuration } from './live-renderer.js'
import type { ReviewLoopResult } from './loop-controller.js'
import { burndownBlock } from './summary-burndown.js'
import type { PhaseMs, RoundMetric, UsageTotals } from './trace-log.js'

const PHASE_KEYS: (keyof PhaseMs)[] = ['review', 'match', 'verify', 'build', 'inspect', 'fix']

const GROUP_CAP = 20

const RUN_ARTIFACTS = ['summary.txt', 'metrics.json', 'ledger.json', 'trace.jsonl', 'agent-output.log', 'state.json']

export interface MetricsJson {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  poolSize: number
  burndown: RoundMetric[]
  usage: UsageTotals
  phaseMs: PhaseMs
  totals: {
    open: number
    closed: number
    rejected: number
    alreadyFixed: number
    needsHuman: number
    reopened: number
    inspectorRejected: number
  }
}

export interface SummaryOptions {
  poolSize: number
  inspect: boolean
}

export interface SummaryInput {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  metrics: readonly RoundMetric[]
  ledger: IssueLedgerSnapshot
  runDir: string
  options: SummaryOptions
}

interface IssueCounts {
  open: number
  fixed: number
  rejected: number
  needsHuman: number
  alreadyFixed: number
}

function countIssues(ledger: IssueLedgerSnapshot): IssueCounts {
  const counts: IssueCounts = { open: 0, fixed: 0, rejected: 0, needsHuman: 0, alreadyFixed: 0 }
  for (const record of Object.values(ledger.issues)) {
    switch (groupForStatus(record.status)) {
      case 'needsHuman':
        counts.needsHuman += 1
        break
      case 'fixed':
        counts.fixed += 1
        break
      case 'rejected':
        counts.rejected += 1
        break
      case 'alreadyFixed':
        counts.alreadyFixed += 1
        break
      case 'open':
        counts.open += 1
        break
    }
  }
  return counts
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function breakdownParts(counts: IssueCounts): string[] {
  const parts: string[] = []
  if (counts.fixed > 0) parts.push(`${counts.fixed} fixed`)
  if (counts.needsHuman > 0) parts.push(`${counts.needsHuman} needs human`)
  if (counts.rejected > 0) parts.push(`${counts.rejected} rejected`)
  if (counts.alreadyFixed > 0) parts.push(`${counts.alreadyFixed} already fixed`)
  return parts
}

function buildVerdict(input: SummaryInput, counts: IssueCounts, total: number): string {
  const breakdown = breakdownParts(counts).join(', ')
  if (counts.open > 0) {
    const suffix = breakdown === '' ? '' : ` (${breakdown})`
    return `Review loop finished: issues remaining — ${counts.open} open${suffix}.`
  }
  if (total === 0) {
    return `Review loop finished: clean — reviewer found no issues in ${plural(input.rounds, 'round')}.`
  }
  return `Review loop finished: done — ${plural(total, 'issue')}: ${breakdown}.`
}

function sumDecisions(metrics: readonly RoundMetric[], key: keyof RoundMetric['decisions']): number {
  return metrics.reduce((s, m) => s + m.decisions[key], 0)
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

function buildTimingLine(metrics: readonly RoundMetric[]): string {
  const phaseMs = aggregatePhaseMs(metrics)
  const totalMs = PHASE_KEYS.reduce((s, k) => s + phaseMs[k], 0)
  const parts = PHASE_KEYS.filter((k) => phaseMs[k] > 0).map((k) => `${k} ${msToSeconds(phaseMs[k])}`)
  const breakdown = parts.length === 0 ? 'no phase timing recorded' : parts.join(', ')
  const usage = aggregateUsage(metrics)
  return `Duration: ${formatDuration(totalMs)} (${breakdown}) · Cost: $${usage.costUsd.toFixed(3)} (in ${usage.inputTokens} / out ${usage.outputTokens} / reasoning ${usage.reasoningTokens})`
}

function buildRoundsLine(input: SummaryInput): string | null {
  if (input.rounds <= 1 && input.options.poolSize <= 1) return null
  const pool = input.options.poolSize > 1 ? ` · Pool: ${input.options.poolSize}` : ''
  return `Rounds: ${input.rounds}${pool}`
}

function buildInspectorLine(metrics: readonly RoundMetric[], options: SummaryOptions): string | null {
  if (!options.inspect) return null
  const runs = metrics.reduce((s, m) => s + m.inspector.runs, 0)
  if (runs === 0) return null
  const rejected = metrics.reduce((s, m) => s + m.inspector.rejected, 0)
  const rate = `${((100 * rejected) / runs).toFixed(1)}%`
  return `Inspector: ${runs} runs, ${rejected} rejected (${rate} reject rate)`
}

function issuesBlock(ledger: IssueLedgerSnapshot): string[] {
  const records = Object.values(ledger.issues)
  if (records.length === 0) return []
  const groups = new Map<IssueGroup, LedgerIssueRecord[]>()
  for (const record of records) {
    const group = groupForStatus(record.status)
    groups.set(group, [...(groups.get(group) ?? []), record])
  }
  const lines = ['Issues:']
  for (const group of GROUP_ORDER) {
    const groupRecords = groups.get(group)
    if (groupRecords === undefined || groupRecords.length === 0) continue
    lines.push(`  ${GROUP_LABEL[group]} (${groupRecords.length}):`)
    for (const record of groupRecords.slice(0, GROUP_CAP)) {
      lines.push(
        `    ${GROUP_MARK[group]} ${formatIssueRef({
          id: record.id,
          severity: record.issue.severity,
          file: record.issue.file,
          line: record.issue.lineStart,
          title: record.issue.title,
        })}`,
      )
    }
    if (groupRecords.length > GROUP_CAP) {
      lines.push(`    …and ${groupRecords.length - GROUP_CAP} more (see ledger.json)`)
    }
  }
  return lines
}

function artifactsBlock(runDir: string): string[] {
  return [`Artifacts (${runDir}):`, `  ${RUN_ARTIFACTS.join(' · ')}`]
}

export function buildSummary(input: SummaryInput): string {
  const total = Object.keys(input.ledger.issues).length
  const counts = countIssues(input.ledger)
  const lines: string[] = [buildVerdict(input, counts, total), buildTimingLine(input.metrics)]

  const roundsLine = buildRoundsLine(input)
  if (roundsLine !== null) lines.push(roundsLine)

  const inspectorLine = buildInspectorLine(input.metrics, input.options)
  if (inspectorLine !== null) lines.push(inspectorLine)

  const issues = issuesBlock(input.ledger)
  if (issues.length > 0) lines.push('', ...issues)

  const burndown = burndownBlock(input.metrics)
  if (burndown !== '') lines.push('', burndown)

  lines.push('', ...artifactsBlock(input.runDir))
  return lines.join('\n')
}

export function buildMetricsJson(
  doneReason: ReviewLoopResult['doneReason'],
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
): MetricsJson {
  const lastMetric = metrics.length > 0 ? metrics[metrics.length - 1] : undefined
  const openFromMetrics = lastMetric === undefined ? 0 : lastMetric.cumulativeOpen
  return {
    doneReason,
    rounds,
    poolSize: options.poolSize,
    burndown: [...metrics],
    usage: aggregateUsage(metrics),
    phaseMs: aggregatePhaseMs(metrics),
    totals: {
      open: openFromMetrics,
      closed,
      rejected: sumDecisions(metrics, 'invalid'),
      alreadyFixed: sumDecisions(metrics, 'already_fixed'),
      needsHuman: sumDecisions(metrics, 'needs_human'),
      reopened: 0,
      inspectorRejected: metrics.reduce((s, m) => s + m.inspector.rejected, 0),
    },
  }
}
