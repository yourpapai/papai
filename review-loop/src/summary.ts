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
import type { ReviewLoopResult } from './loop-controller.js'
import type { PersistedStats, StatsSnapshot } from './run-stats.js'
import { burndownBlock } from './summary-burndown.js'
import {
  buildCheckBehindLine,
  buildExposureLine,
  buildInspectorLine,
  buildKindLine,
  buildTimingLine,
} from './summary-lines.js'
import { aggregatePhaseMs, aggregateUsage, sumDecisions } from './summary-metrics.js'
import type { PhaseMs, RoundMetric, UsageTotals } from './trace-log.js'

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
  runStats?: PersistedStats
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
  wallMs: number
  options: SummaryOptions
  stats?: StatsSnapshot
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
  // First, and in its own sentence, because every other line below describes a
  // run that decided it was finished. This one was stopped with findings it
  // never reached, and a reader who takes the counts for a final verdict draws
  // exactly the wrong conclusion from them.
  if (input.doneReason === 'stopped') {
    const suffix = breakdown === '' ? '' : ` (${breakdown})`
    return `Review loop stopped early: out of time after ${plural(input.rounds, 'round')} — ${counts.open} open${suffix}.`
  }
  if (counts.open > 0) {
    const suffix = breakdown === '' ? '' : ` (${breakdown})`
    return `Review loop finished: issues remaining — ${counts.open} open${suffix}.`
  }
  if (total === 0) {
    return `Review loop finished: clean — reviewer found no issues in ${plural(input.rounds, 'round')}.`
  }
  return `Review loop finished: done — ${plural(total, 'issue')}: ${breakdown}.`
}

function buildRoundsLine(input: SummaryInput): string | null {
  if (input.rounds <= 1 && input.options.poolSize <= 1) return null
  const pool = input.options.poolSize > 1 ? ` · Pool: ${input.options.poolSize}` : ''
  return `Rounds: ${input.rounds}${pool}`
}

function buildStatsLine(stats: StatsSnapshot | undefined): string | null {
  if (stats === undefined) return null
  const t = stats.totals
  const parts: string[] = []
  if (t.toolCalls > 0) parts.push(`tools ${t.toolCalls}`)
  if (t.added > 0 || t.removed > 0) parts.push(`+${t.added}/-${t.removed}`)
  if (t.estimatedCostUsd !== undefined) parts.push(`~$${t.estimatedCostUsd.toFixed(2)} est`)
  if (parts.length === 0) return null
  return `Stats: ${parts.join(' · ')}`
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
  const lines: string[] = [buildVerdict(input, counts, total), buildTimingLine(input.metrics, input.wallMs)]

  const roundsLine = buildRoundsLine(input)
  if (roundsLine !== null) lines.push(roundsLine)

  const inspectorLine = buildInspectorLine(input.metrics, input.options.inspect)
  if (inspectorLine !== null) lines.push(inspectorLine)

  const exposureLine = buildExposureLine(input.metrics)
  if (exposureLine !== null) lines.push(exposureLine)

  const kindLine = buildKindLine(input.metrics)
  if (kindLine !== null) lines.push(kindLine)
  const checkBehindLine = buildCheckBehindLine(input.metrics)
  if (checkBehindLine !== null) lines.push(checkBehindLine)

  const statsLine = buildStatsLine(input.stats)
  if (statsLine !== null) lines.push(statsLine)

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
  runStats?: PersistedStats,
): MetricsJson {
  // noUncheckedIndexedAccess already types this `RoundMetric | undefined`, and
  // metrics[-1] on an empty array is undefined too, so a length guard adds nothing.
  const lastMetric = metrics[metrics.length - 1]
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
    ...(runStats === undefined ? {} : { runStats }),
  }
}
