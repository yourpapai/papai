// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'
import type { ExposureKind, RoundMetric, Severity, TraceLogger } from './trace-log.js'

/**
 * The trace-event emitters, split from the collector half (now
 * `round-collector.ts`) when this file passed `max-lines`. Each emitter is a
 * one-liner at the call site and appends exactly one event.
 */

function nowIso(): string {
  return new Date().toISOString()
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
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
