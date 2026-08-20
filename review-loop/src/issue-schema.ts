// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Exposure is an *artifact*, not a grade: the reporter cites a caller it
 * actually found — file, line, and the quoted line — or states outright that
 * there is none. A citation can be checked later; a self-assigned rating
 * cannot, and `severity` is the standing proof that ratings inflate.
 *
 * Optional on read throughout: state written before exposure existed parses
 * with it absent, which reads as "unknown" and never counts as divergence.
 */
export const ExposureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('caller'),
    file: z.string().min(1),
    line: z.number().int().positive(),
    quote: z.string().min(1),
  }),
  z.object({ kind: z.literal('none') }),
])

/**
 * What an issue *is*, which is a different question from how bad it is
 * (`severity`) or whether anything reaches it (`exposure`). A `cleanup` says the
 * code is more than it needs to be; a `defect` says it is wrong.
 *
 * Defaulted rather than optional, and the difference from `exposure` is the
 * point: absent exposure is a real third state — nobody answered — whereas a
 * ledger written before cleanups were admitted holds only defects, so the
 * default states a truth instead of papering over a gap.
 */
export const IssueKindSchema = z.enum(['defect', 'cleanup']).default('defect')

export const IssueSpanSchema = z.object({
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  evidence: z.string().min(1),
})

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  kind: IssueKindSchema,
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  suggestedFix: z.string().min(1),
  confidence: z.number().min(0).max(1),
  exposure: ExposureSchema.optional(),
  spans: z.array(IssueSpanSchema).min(1).optional(),
})

export const ReviewerIssuesSchema = z.object({
  issues: z.array(ReviewerIssueSchema),
})

export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human', 'plan_drift']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
})

export const FixerResultSchema = VerifierDecisionSchema.extend({
  fixed: z.boolean(),
  commitSha: z.string().nullable().optional(),
  commitMessage: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  exposure: ExposureSchema.optional(),
})

export const InspectorResultSchema = z.object({
  addresses: z.boolean(),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const AggregatedInspectorResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      addresses: z.boolean(),
      reasoning: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

export const ClusterFixerResultSchema = z.object({
  results: z.array(
    FixerResultSchema.extend({
      id: z.string().min(1),
    }),
  ),
})

export const IssueMatchSchema = z.object({
  newIssueIndex: z.number().int().nonnegative(),
  existingId: z.string().nullable(),
})

export const IssueMatchesSchema = z.object({
  matches: z.array(IssueMatchSchema),
})

export function getIssueSpans(issue: ReviewerIssue): IssueSpan[] {
  if (issue.spans !== undefined && issue.spans.length > 0) return issue.spans
  return [{ file: issue.file, lineStart: issue.lineStart, lineEnd: issue.lineEnd, evidence: issue.evidence }]
}

export type IssueSpan = z.infer<typeof IssueSpanSchema>
export type Exposure = z.infer<typeof ExposureSchema>
export type IssueKind = z.infer<typeof IssueKindSchema>
export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>
export type Verdict = VerifierDecision['verdict']
export type FixerResult = z.infer<typeof FixerResultSchema>
export type InspectorResult = z.infer<typeof InspectorResultSchema>
export type AggregatedInspectorResult = z.infer<typeof AggregatedInspectorResultSchema>
export type ClusterFixerResult = z.infer<typeof ClusterFixerResultSchema>
export type IssueMatch = z.infer<typeof IssueMatchSchema>
export type IssueMatches = z.infer<typeof IssueMatchesSchema>
