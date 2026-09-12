// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** GitHub label colors are six lowercase hex digits without the leading '#'. */
export const labelColorRegex = /^[0-9a-f]{6}$/u

/** GitHub REST repository-label shape (repo-level label endpoints). */
export const GitHubRepoLabelSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string().regex(labelColorRegex),
  // GitHub sends `null` (never omits) when the description is unset.
  description: z.string().nullable(),
})

export type GitHubRepoLabel = z.infer<typeof GitHubRepoLabelSchema>
