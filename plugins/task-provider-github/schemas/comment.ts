// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { GitHubUserSchema } from './user.js'

/** GitHub REST issue-comment shape (list, create, and update endpoints). */
export const GitHubCommentSchema = z.object({
  id: z.number().int(),
  body: z.string(),
  // GitHub sends `null` when the commenter account is gone (ghost).
  user: GitHubUserSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.string(),
  issue_url: z.string(),
  author_association: z.string(),
})

export type GitHubComment = z.infer<typeof GitHubCommentSchema>
