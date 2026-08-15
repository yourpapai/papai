// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Exposure, ReviewerIssue } from './issue-schema.js'
import {
  emptyDecisions,
  emptyExposureCounts,
  emptySeverityCounts,
  type Decisions,
  type ExposureCounts,
  type ExposureKind,
  type PhaseMs,
  type RoundMetric,
  type Severity,
  type SeverityCounts,
  type TraceLogger,
  type UsageTotals,
} from './trace-log.js'

export interface RoundCollector {
  decisions: Decisions
  reviewerSeverity: SeverityCounts
  fixerSeverity: SeverityCounts
  inspector: { runs: number; rejected: number }
  reviewerExposure: ExposureCounts
  fixerExposure: ExposureCounts
  exposureDivergent: number
  phaseMs: PhaseMs
  usage: UsageTotals
}

export function newCollector(): RoundCollector {
  return {
    decisions: emptyDecisions(),
    reviewerSeverity: emptySeverityCounts(),
    fixerSeverity: emptySeverityCounts(),
    inspector: { runs: 0, rejected: 0 },
    reviewerExposure: emptyExposureCounts(),
    fixerExposure: emptyExposureCounts(),
    exposureDivergent: 0,
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
}

export function tallyDecision(collector: RoundCollector, verdict: string, fixed: boolean): void {
  let bucket: keyof Decisions
  if (verdict === 'valid') {
    bucket = fixed ? 'fixed' : 'needs_human'
  } else if (verdict === 'invalid') {
    bucket = 'invalid'
  } else if (verdict === 'already_fixed') {
    bucket = 'already_fixed'
  } else if (verdict === 'needs_human') {
    bucket = 'needs_human'
  } else if (verdict === 'inspector_rejected') {
    bucket = 'inspector_rejected'
  } else {
    bucket = 'plan_drift'
  }
  collector.decisions[bucket] += 1
}

/** An absent report is `unknown`, never `none`: nobody looked is not nothing found. */
export function exposureKind(exposure: Exposure | undefined): ExposureKind {
  return exposure?.kind ?? 'unknown'
}

/**
 * Records what each reporter said and whether they disagreed. Divergence needs
 * two actual answers — an `unknown` on either side is silence, and silence is
 * not disagreement. Undercounting here is deliberate: this number exists to be
 * trusted by the later decision about whether exposure may ever gate.
 */
export function tallyExposure(collector: RoundCollector, reviewer: ExposureKind, fixer: ExposureKind): void {
  collector.reviewerExposure[reviewer] += 1
  collector.fixerExposure[fixer] += 1
  if (reviewer !== 'unknown' && fixer !== 'unknown' && reviewer !== fixer) {
    collector.exposureDivergent += 1
  }
}

export function tallyFixerSeverity(collector: RoundCollector, severity: Severity | undefined): void {
  if (severity !== undefined) {
    collector.fixerSeverity[severity] += 1
  }
}

export function tallyReviewerIssues(collector: RoundCollector, newIssues: readonly ReviewerIssue[]): void {
  for (const issue of newIssues) {
    collector.reviewerSeverity[issue.severity] += 1
  }
}

export function tallyInspector(collector: RoundCollector, addresses: boolean): void {
  collector.inspector.runs += 1
  if (!addresses) collector.inspector.rejected += 1
}

export function tallyPhaseMs(collector: RoundCollector, phase: keyof PhaseMs, ms: number): void {
  collector.phaseMs[phase] += ms
}

export function tallyUsage(
  collector: RoundCollector,
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; wallMs: number },
): void {
  collector.usage.inputTokens += usage.inputTokens
  collector.usage.outputTokens += usage.outputTokens
  collector.usage.reasoningTokens += usage.reasoningTokens
  collector.usage.costUsd += usage.costUsd
}

export function emitInspectComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  addresses: boolean,
  confidence: number,
  reasoning: string,
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'inspect',
    event: 'inspect_complete',
    issueId,
    addresses,
    confidence,
    reasoning: truncate(reasoning, 200),
  })
}

export function emitRoundStart(
  trace: TraceLogger,
  round: number,
  maxRounds: number,
  maxNoProgressRounds: number,
  checkCommand: string,
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'round',
    event: 'round_start',
    maxRounds,
    maxNoProgressRounds,
    checkCommand,
  })
}

export function emitReviewComplete(trace: TraceLogger, round: number, newIssues: readonly ReviewerIssue[]): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'review',
    event: 'review_complete',
    issueCount: newIssues.length,
    issues: newIssues.map((i) => ({ title: i.title, severity: i.severity, file: i.file, confidence: i.confidence })),
  })
}

export function emitMatchComplete(trace: TraceLogger, round: number, newCount: number, matchedCount: number): void {
  void trace.append({ ts: nowIso(), round, phase: 'match', event: 'match_complete', newCount, matchedCount })
}

/**
 * The four assessments travel as one object rather than four adjacent
 * positional arguments: two severities and two exposures of near-identical
 * type, in a row, is a transposition waiting to happen — and a silent one,
 * since swapping reviewer and fixer still typechecks.
 */
export interface VerifyAssessments {
  reviewerSeverity: Severity
  fixerSeverity: Severity | null
  reviewerExposure: ExposureKind
  fixerExposure: ExposureKind
}

export function emitVerifyComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  verdict: string,
  fixability: string,
  assessments: VerifyAssessments,
  reasoning: string,
  targetFiles: readonly string[],
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'verify',
    event: 'verify_complete',
    issueId,
    verdict,
    fixability,
    ...assessments,
    reasoning,
    targetFiles: [...targetFiles],
  })
}

export function emitBuildComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  passed: boolean,
  attempt: number,
  durationMs: number,
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'build',
    event: 'build_complete',
    issueId,
    passed,
    attempt,
    durationMs,
  })
}

export function emitFixComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  fixed: boolean,
  commitSha: string | null,
  attempt: number,
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'fix',
    event: 'fix_complete',
    issueId,
    fixed,
    commitSha,
    attempt,
  })
}

export function emitRoundSummary(trace: TraceLogger, metric: RoundMetric): void {
  void trace.append({ ts: nowIso(), phase: 'round', event: 'round_summary', ...metric })
}

export function emitLoopEnd(
  trace: TraceLogger,
  round: number,
  doneReason: 'clean' | 'max_rounds' | 'no_progress' | 'stopped',
  metrics: readonly RoundMetric[],
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'loop',
    event: 'loop_end',
    doneReason,
    rounds: round,
    burndown: [...metrics],
  })
}
