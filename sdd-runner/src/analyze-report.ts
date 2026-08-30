// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CorpusReport, RunAnalysis } from './analyze-corpus.js'
import type { R2CauseMix } from './analyze-findings.js'
import type { Metric } from './analyze.js'

/**
 * Report rendering (D4): plain text — no ANSI escapes, analysis output is
 * piped by nature — with a `--json` mode that emits the same structure
 * machine-readably via `JSON.stringify`.
 */

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE

function metricLine<T>(metric: Metric<T>, render: (value: T) => string): string {
  return metric.status === 'known' ? render(metric.value) : `unknown (${metric.reason})`
}

function trajectoryLine(run: RunAnalysis): string {
  return metricLine(run.trajectory, (rounds) =>
    rounds.length === 0
      ? 'no rounds'
      : rounds
          .map(
            (round) =>
              `r${round.round} ${round.verdict} (${round.counts.blocker}b/${round.counts.material}m/${round.counts.nitpick}n)`,
          )
          .join(' · '),
  )
}

function ageWord(ms: number): string {
  if (ms >= MS_PER_DAY) return `${Math.round(ms / MS_PER_DAY)}d`
  if (ms >= MS_PER_MINUTE) return `${Math.round(ms / MS_PER_MINUTE)}m`
  return `${Math.round(ms / 1000)}s`
}

function gatesLine(run: RunAnalysis): string {
  return metricLine(run.gates, (gates): string => {
    const settled = gates.answered.reduce<Record<string, number>>((acc, gate) => {
      acc[gate.settledBy] = (acc[gate.settledBy] ?? 0) + 1
      return acc
    }, {})
    const settledText = Object.entries(settled)
      .map(([by, count]) => `${by} ${count}`)
      .join(', ')
    const never = gates.neverAnswered.map((gate) => `v${gate.version} age ${ageWord(gate.ageMs)}`).join(', ')
    const parts = [`answered ${gates.answered.length} (${settledText})`]
    if (gates.neverAnswered.length > 0) parts.push(`never-answered ${never}`)
    const extendsText = gates.extends.map((ext) => `${ext.origin}${ext.rule === null ? '' : ` ${ext.rule}`}`).join(', ')
    if (gates.extends.length > 0) parts.push(`extends: ${extendsText}`)
    const rules = Object.entries(gates.autoDecisionsByRule)
      .map(([rule, count]) => `${rule} × ${count}`)
      .join(', ')
    if (rules.length > 0) parts.push(`auto rules: ${rules}`)
    return parts.join(' · ')
  })
}

function ratioLine(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`
}

/**
 * The gap causes explain the eligibility→fired split, so only they render;
 * `trajectory-blocked` stays implicit as the ratio's complement (JSON carries
 * it). Fixed cause order, ` ×N` counts, ` · ` separators, omitted when none.
 */
const R2_GAP_CAUSES = ['r2-fired', 'cost-unknown', 'over-ceiling', 'preview'] as const

function r2CauseSuffix(byCause: R2CauseMix): string {
  const parts: string[] = []
  for (const cause of R2_GAP_CAUSES) {
    const count = byCause[cause] ?? 0
    if (count > 0) parts.push(`${cause} ×${count}`)
  }
  return parts.length === 0 ? '' : ` (${parts.join(' · ')})`
}

function runSection(run: RunAnalysis): readonly string[] {
  const identity = [run.changeName ?? 'unnamed', run.status ?? 'no state'].join(' · ')
  const lines = [
    `## run ${run.runId} (${run.workDir}) — ${identity}${run.eraContaminated ? ' [era-contaminated]' : ''}`,
  ]
  lines.push(`  trajectory: ${trajectoryLine(run)}`)
  lines.push(`  gates: ${gatesLine(run)}`)
  lines.push(`  duplicate-id rate: ${metricLine(run.duplicateIdRate, (rate) => rate.toFixed(2))}`)
  lines.push(`  lens overlap: ${metricLine(run.lensOverlapRate, (rate) => rate.toFixed(2))}`)
  lines.push(`  class churn: ${metricLine(run.classChurn, (rate) => rate.toFixed(2))}`)
  lines.push(
    `  resolver mix: ${metricLine(run.resolverActionMix, (mix) =>
      Object.entries(mix)
        .map(([action, count]) => `${action} ${count}`)
        .join(' · '),
    )}`,
  )
  lines.push(`  concern persistence: ${metricLine(run.concernPersistence, (rate) => rate.toFixed(2))}`)
  lines.push(
    `  r2 eligibility: ${metricLine(
      run.r2Eligibility,
      (r2) => `${ratioLine(r2.eligible, r2.gateStates)}${r2CauseSuffix(r2.byCause)}`,
    )}`,
  )
  lines.push(
    `  retries: ${metricLine(
      run.retries,
      (byRole) =>
        Object.entries(byRole)
          .flatMap(([role, counts]) => [
            counts.stall > 0 ? `${role} stall×${counts.stall}` : '',
            counts.validation > 0 ? `${role} validation×${counts.validation}` : '',
          ])
          .filter((part) => part.length > 0)
          .join(' · ') || 'none',
    )}`,
  )
  lines.push(usageLine(run))
  lines.push(...consistencyLines(run))
  return lines
}

function usageLine(run: RunAnalysis): string {
  const roles = Object.entries(run.usage.byRole)
  const total = roles.reduce((acc, [, usage]) => acc + usage.costUsd, 0)
  const detail = roles.map(([role, usage]) => `${role} $${usage.costUsd.toFixed(2)}`).join(' · ')
  const known = run.usage.costKnown ? 'cost known' : 'cost unknown'
  return `  usage: ${detail.length === 0 ? 'none' : detail} — $${total.toFixed(2)} (${known})`
}

function consistencyLines(run: RunAnalysis): readonly string[] {
  const audit = run.consistency
  const flags: string[] = []
  if (audit.answeredWithoutPresented.length > 0) {
    flags.push(`answered-without-presented [${audit.answeredWithoutPresented.join(', ')}]`)
  }
  if (audit.completedAfterUnsupersededAbort) flags.push('completed after unsuperseded abort')
  if (audit.bakResidue) flags.push('.bak residue')
  if (audit.gateFilesWithoutAnsweredEvent.length > 0) {
    flags.push(`gate files without answered events [${audit.gateFilesWithoutAnsweredEvent.join(', ')}]`)
  }
  if (flags.length === 0) return ['  consistency: clean']
  return ['  consistency:', ...flags.map((flag) => `    · ${flag}`)]
}

function corpusSection(report: CorpusReport): readonly string[] {
  const aggregates = report.aggregates
  const lines = ['## corpus']
  const excluded =
    aggregates.eraContaminated.length === 0
      ? ''
      : ` (excluded era-contaminated: ${aggregates.eraContaminated.join(', ')})`
  lines.push(`  runs aggregated: ${aggregates.runsAggregated}${excluded}`)
  const rules = Object.entries(aggregates.autoDecisionsByRule)
    .map(([rule, count]) => `${rule} × ${count}`)
    .join(' · ')
  if (rules.length > 0) lines.push(`  auto decisions by rule: ${rules}`)
  lines.push(`  duplicate resolution entries: ${aggregates.duplicateResolutionEntries}`)
  lines.push(
    `  r2 eligible: ${
      aggregates.r2Eligibility === null
        ? 'unknown'
        : `${ratioLine(aggregates.r2Eligibility.eligible, aggregates.r2Eligibility.gateStates)}${r2CauseSuffix(
            aggregates.r2Eligibility.byCause,
          )}`
    } cap-hit states`,
  )
  lines.push(`  gates never answered: ${aggregates.gatesNeverAnswered}`)
  return lines
}

function groundTruthSection(report: CorpusReport): readonly string[] {
  const lines: string[] = []
  const stranded = report.groundTruth.filter((change) => change.strandedComplete)
  const merged = report.groundTruth.filter((change) => change.mergedUnimplemented)
  lines.push('## stranded-complete')
  if (stranded.length === 0) lines.push('  none')
  for (const change of stranded) {
    lines.push(
      `  ${change.changeName} — ${change.tasksDone}/${change.tasksTotal} tasks, ${change.commits} commits, not on a main ref`,
    )
  }
  lines.push('## merged-unimplemented')
  if (merged.length === 0) lines.push('  none')
  for (const change of merged) {
    lines.push(`  ${change.changeName} — ${change.tasksDone}/${change.tasksTotal} tasks, on a main ref`)
  }
  return lines
}

export function renderCorpusReport(report: CorpusReport): string {
  const lines: string[] = [
    'sdd-runner corpus analysis',
    `generated: ${report.generatedAt}`,
    `workdirs: ${report.workdirs.join(', ')}`,
    `runs: ${report.runs.length}`,
    '',
  ]
  for (const run of report.runs) {
    lines.push(...runSection(run), '')
  }
  lines.push(...corpusSection(report), '', ...groundTruthSection(report))
  return lines.join('\n')
}

export function renderCorpusJson(report: CorpusReport): string {
  return JSON.stringify(report, null, 2)
}
