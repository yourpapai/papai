// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** GitHub REST "simple user" shape (users, issue assignees, repo owners). */
export const GitHubUserSchema = z.object({
  login: z.string(),
  id: z.number().int(),
  avatar_url: z.string(),
  html_url: z.string(),
  type: z.string(),
})

export type GitHubUser = z.infer<typeof GitHubUserSchema>
