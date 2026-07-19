// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  suggestedFix: z.string().min(1),
  confidence: z.number().min(0).max(1),
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
})

export const IssueMatchSchema = z.object({
  newIssueIndex: z.number().int().nonnegative(),
  existingId: z.string().nullable(),
})

export const IssueMatchesSchema = z.object({
  matches: z.array(IssueMatchSchema),
})

export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>
export type FixerResult = z.infer<typeof FixerResultSchema>
export type IssueMatch = z.infer<typeof IssueMatchSchema>
export type IssueMatches = z.infer<typeof IssueMatchesSchema>
