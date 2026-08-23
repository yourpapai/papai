// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { GitHubUserSchema } from './user.js'

/** Label object form returned by single-issue endpoints. */
const GitHubLabelObjectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string().optional(),
})

/**
 * Labels come in two shapes: plain strings from list/search endpoints and
 * objects from single-issue endpoints. Mappers must not assume either.
 */
export const GitHubLabelSchema = z.union([z.string(), GitHubLabelObjectSchema])

const GitHubMilestoneSchema = z.object({
  id: z.number().int(),
  number: z.number().int().optional(),
  title: z.string(),
  state: z.string().optional(),
})

/** GitHub REST issue shape (list and single-issue endpoints). */
export const GitHubIssueSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  title: z.string(),
  // GitHub sends `null` (never omits) when unset.
  body: z.string().nullable(),
  user: GitHubUserSchema.nullable(),
  labels: z.array(GitHubLabelSchema),
  assignees: z.array(GitHubUserSchema),
  state: z.enum(['open', 'closed']),
  state_reason: z.enum(['completed', 'not_planned', 'reopened']).nullable(),
  comments: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
  milestone: GitHubMilestoneSchema.nullable(),
  html_url: z.string(),
  // Present only when the item is a pull request; carried so listings can drop PRs.
  pull_request: z.object({ url: z.string().optional() }).optional(),
})

export type GitHubIssue = z.infer<typeof GitHubIssueSchema>
export type GitHubLabel = z.infer<typeof GitHubLabelSchema>
