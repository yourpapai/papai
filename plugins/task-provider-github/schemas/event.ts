// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { GitHubUserSchema } from './user.js'

/** GitHub REST issue-event shape (`/repos/{owner}/{repo}/issues/{n}/events`). */
export const GitHubIssueEventSchema = z.object({
  id: z.number().int(),
  event: z.string(),
  created_at: z.string(),
  // Ghost users arrive as `null`, never omitted.
  actor: GitHubUserSchema.nullable(),
  // Present only on `assigned`/`unassigned` events; nullable, not just optional.
  assignee: GitHubUserSchema.nullable().optional(),
  // Present only on `labeled`/`unlabeled` events; nullable, not just optional.
  label: z.object({ name: z.string() }).nullable().optional(),
})

export type GitHubIssueEvent = z.infer<typeof GitHubIssueEventSchema>
