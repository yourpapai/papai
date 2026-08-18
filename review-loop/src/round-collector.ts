// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentUsage } from './agent-runner.js'
import type { CheckBehind } from './commit-attempt.js'
import type { Exposure, IssueKind, ReviewerIssue } from './issue-schema.js'
import {
  emptyCheckBehindByKind,
  emptyKindCounts,
  emptyDecisions,
  emptyExposureCounts,
  emptySeverityCounts,
  type CheckBehindByKind,
  type KindCounts,
  type Decisions,
  type ExposureCounts,
  type ExposureKind,
  type PhaseMs,
  type Severity,
  type SeverityCounts,
  type UsageTotals,
} from './trace-log.js'

/**
 * The per-round metric accumulator, split from `loop-trace.ts` when that file
 * passed `max-lines`: everything here folds observations into a `RoundCollector`,
 * while the emitters there append trace events. Nothing here touches a logger.
 */

export interface RoundCollector {
  decisions: Decisions
  reviewerSeverity: SeverityCounts
  fixerSeverity: SeverityCounts
  inspector: { runs: number; rejected: number }
  reviewerExposure: ExposureCounts
  fixerExposure: ExposureCounts
  exposureDivergent: number
  reviewerKind: KindCounts
  checkBehind: CheckBehindByKind
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
    reviewerKind: emptyKindCounts(),
    checkBehind: emptyCheckBehindByKind(),
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
    },
  }
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

/**
 * Whether an accepted fix left a runnable check behind. Advisory only: it never
 * blocks a merge, changes a verdict, or touches the retry budget — it exists to
 * say whether the rule the fix prompt states is actually being followed.
 */
export function tallyCheckBehind(collector: RoundCollector, outcome: CheckBehind, kind: IssueKind): void {
  const counts = collector.checkBehind[kind]
  if (outcome === 'with-check') counts.withCheck += 1
  else if (outcome === 'without-check') counts.withoutCheck += 1
  else counts.unmeasured += 1
}

export function tallyFixerSeverity(collector: RoundCollector, severity: Severity | undefined): void {
  if (severity !== undefined) {
    collector.fixerSeverity[severity] += 1
  }
}

export function tallyReviewerIssues(collector: RoundCollector, newIssues: readonly ReviewerIssue[]): void {
  for (const issue of newIssues) {
    collector.reviewerSeverity[issue.severity] += 1
    collector.reviewerKind[issue.kind] += 1
  }
}

export function tallyInspector(collector: RoundCollector, addresses: boolean): void {
  collector.inspector.runs += 1
  if (!addresses) collector.inspector.rejected += 1
}

export function tallyPhaseMs(collector: RoundCollector, phase: keyof PhaseMs, ms: number): void {
  collector.phaseMs[phase] += ms
}

export function tallyUsage(collector: RoundCollector, usage: AgentUsage): void {
  collector.usage.inputTokens += usage.inputTokens
  collector.usage.outputTokens += usage.outputTokens
  collector.usage.reasoningTokens += usage.reasoningTokens
  collector.usage.cachedReadTokens += usage.cachedReadTokens
  collector.usage.cachedWriteTokens += usage.cachedWriteTokens
  collector.usage.costUsd += usage.costUsd
}
