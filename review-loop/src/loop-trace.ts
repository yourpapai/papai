// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'
import {
  emptyDecisions,
  emptySeverityCounts,
  type Decisions,
  type RoundMetric,
  type Severity,
  type SeverityCounts,
  type TraceLogger,
} from './trace-log.js'

export interface RoundCollector {
  decisions: Decisions
  reviewerSeverity: SeverityCounts
  fixerSeverity: SeverityCounts
}

export function newCollector(): RoundCollector {
  return { decisions: emptyDecisions(), reviewerSeverity: emptySeverityCounts(), fixerSeverity: emptySeverityCounts() }
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
  } else {
    bucket = 'plan_drift'
  }
  collector.decisions[bucket] += 1
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

export function emitVerifyComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  verdict: string,
  fixability: string,
  reviewerSeverity: Severity,
  fixerSeverity: Severity | null,
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
    reviewerSeverity,
    fixerSeverity,
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
  doneReason: 'clean' | 'max_rounds' | 'no_progress',
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
