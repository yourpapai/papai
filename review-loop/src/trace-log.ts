// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile } from 'node:fs/promises'

import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type Severity = z.infer<typeof SeveritySchema>

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
})
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>

export const DecisionsSchema = z.object({
  fixed: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  already_fixed: z.number().int().nonnegative(),
  needs_human: z.number().int().nonnegative(),
  plan_drift: z.number().int().nonnegative(),
  no_commit: z.number().int().nonnegative(),
  inspector_rejected: z.number().int().nonnegative(),
})
export type Decisions = z.infer<typeof DecisionsSchema>

export function emptyDecisions(): Decisions {
  return { fixed: 0, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0, inspector_rejected: 0 }
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 }
}

export const PhaseMsSchema = z.object({
  review: z.number().int().nonnegative(),
  match: z.number().int().nonnegative(),
  verify: z.number().int().nonnegative(),
  build: z.number().int().nonnegative(),
  inspect: z.number().int().nonnegative(),
  fix: z.number().int().nonnegative(),
})
export type PhaseMs = z.infer<typeof PhaseMsSchema>

export const UsageTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
})
export type UsageTotals = z.infer<typeof UsageTotalsSchema>

/**
 * `unknown` is a distinct answer from `none`: it means nobody reported, not
 * that nothing reaches the code. Keeping them apart is what stops an omission
 * from being counted as a finding — or as a disagreement.
 */
export const ExposureKindSchema = z.enum(['caller', 'none', 'unknown'])
export type ExposureKind = z.infer<typeof ExposureKindSchema>

export const ExposureCountsSchema = z.object({
  caller: z.number().int().nonnegative(),
  none: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
})
export type ExposureCounts = z.infer<typeof ExposureCountsSchema>

export function emptyExposureCounts(): ExposureCounts {
  return { caller: 0, none: 0, unknown: 0 }
}

/**
 * `unmeasured` is kept apart from both answers on purpose: a diff we could not
 * read is not a fix that skipped its test, and counting it as one would make
 * the signal accuse the innocent.
 */
export const CheckBehindCountsSchema = z.object({
  withCheck: z.number().int().nonnegative(),
  withoutCheck: z.number().int().nonnegative(),
  unmeasured: z.number().int().nonnegative(),
})
export type CheckBehindCounts = z.infer<typeof CheckBehindCountsSchema>

/**
 * Split by issue kind rather than pooled. A cleanup that deletes code
 * introduces no non-trivial logic, so it leaves no check and is right to — but
 * pooled it would depress the ratio the check-behind rule is actually measured
 * by, making the defect fixers look worse the more cleanups a run admits.
 */
export const CheckBehindByKindSchema = z.object({
  defect: CheckBehindCountsSchema,
  cleanup: CheckBehindCountsSchema,
})
export type CheckBehindByKind = z.infer<typeof CheckBehindByKindSchema>

export const KindCountsSchema = z.object({
  defect: z.number().int().nonnegative(),
  cleanup: z.number().int().nonnegative(),
})
export type KindCounts = z.infer<typeof KindCountsSchema>

export function emptyKindCounts(): KindCounts {
  return { defect: 0, cleanup: 0 }
}

export function emptyCheckBehindCounts(): CheckBehindCounts {
  return { withCheck: 0, withoutCheck: 0, unmeasured: 0 }
}

export function emptyCheckBehindByKind(): CheckBehindByKind {
  return { defect: emptyCheckBehindCounts(), cleanup: emptyCheckBehindCounts() }
}

export const RoundMetricSchema = z.object({
  round: z.number().int().positive(),
  newIssues: z.number().int().nonnegative(),
  cumulativeOpen: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
  decisions: DecisionsSchema,
  reviewerSeverity: SeverityCountsSchema,
  fixerSeverity: SeverityCountsSchema,
  inspector: z.object({ runs: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() }),
  reviewerExposure: ExposureCountsSchema,
  fixerExposure: ExposureCountsSchema,
  exposureDivergent: z.number().int().nonnegative(),
  reviewerKind: KindCountsSchema,
  checkBehind: CheckBehindByKindSchema,
  phaseMs: PhaseMsSchema,
  usage: UsageTotalsSchema,
})
export type RoundMetric = z.infer<typeof RoundMetricSchema>

const base = {
  ts: z.string(),
  round: z.number().int().nonnegative(),
  phase: z.string(),
}

export const TraceEventSchema = z.discriminatedUnion('event', [
  z.object({
    ...base,
    event: z.literal('round_start'),
    maxRounds: z.number().int().positive(),
    maxNoProgressRounds: z.number().int().positive(),
    checkCommand: z.string(),
  }),
  z.object({
    ...base,
    event: z.literal('review_complete'),
    issueCount: z.number().int().nonnegative(),
    issues: z.array(
      z.object({
        title: z.string(),
        severity: SeveritySchema,
        file: z.string(),
        confidence: z.number(),
      }),
    ),
  }),
  z.object({
    ...base,
    event: z.literal('match_complete'),
    newCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    event: z.literal('verify_complete'),
    issueId: z.string(),
    verdict: z.string(),
    fixability: z.string(),
    reviewerSeverity: SeveritySchema.nullable(),
    fixerSeverity: SeveritySchema.nullable(),
    reviewerExposure: ExposureKindSchema,
    fixerExposure: ExposureKindSchema,
    reasoning: z.string(),
    targetFiles: z.array(z.string()),
  }),
  z.object({
    ...base,
    event: z.literal('build_complete'),
    issueId: z.string(),
    passed: z.boolean(),
    attempt: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    event: z.literal('inspect_complete'),
    issueId: z.string(),
    addresses: z.boolean(),
    confidence: z.number(),
    reasoning: z.string(),
  }),
  z.object({
    ...base,
    event: z.literal('fix_complete'),
    issueId: z.string(),
    fixed: z.boolean(),
    commitSha: z.string().nullable(),
    attempt: z.number().int().positive(),
  }),
  RoundMetricSchema.extend({ ...base, event: z.literal('round_summary') }),
  z.object({
    ...base,
    event: z.literal('loop_end'),
    doneReason: z.string(),
    rounds: z.number().int().nonnegative(),
    burndown: z.array(RoundMetricSchema),
  }),
])
export type TraceEvent = z.infer<typeof TraceEventSchema>

export interface TraceLogger {
  append(e: TraceEvent): Promise<void>
}

export function createFileTraceLogger(tracePath: string): TraceLogger {
  return {
    async append(e: TraceEvent): Promise<void> {
      try {
        await appendFile(tracePath, `${JSON.stringify(e)}\n`)
      } catch (error) {
        console.warn(`[review-loop] trace write failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}

export function createCapturingTraceLogger(): { logger: TraceLogger; events: TraceEvent[] } {
  const events: TraceEvent[] = []
  return {
    logger: {
      append(e: TraceEvent): Promise<void> {
        events.push(e)
        return Promise.resolve()
      },
    },
    events,
  }
}
