// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { GitHubUserSchema } from './user.js'

/** GitHub REST repository shape (GET /repos/{owner}/{repo}). */
export const GitHubRepoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  full_name: z.string(),
  owner: GitHubUserSchema,
  html_url: z.string(),
  private: z.boolean(),
  // GitHub sends `null` (never omits) when the description is unset.
  description: z.string().nullable(),
})

export type GitHubRepo = z.infer<typeof GitHubRepoSchema>
