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
})
export type Decisions = z.infer<typeof DecisionsSchema>

export function emptyDecisions(): Decisions {
  return { fixed: 0, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 }
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 }
}

export const RoundMetricSchema = z.object({
  round: z.number().int().positive(),
  newIssues: z.number().int().nonnegative(),
  cumulativeOpen: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
  decisions: DecisionsSchema,
  reviewerSeverity: SeverityCountsSchema,
  fixerSeverity: SeverityCountsSchema,
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
