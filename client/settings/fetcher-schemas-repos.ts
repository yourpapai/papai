// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Repos ---

export const RepoRecordSchema = z.object({
  repoId: z.string(),
  name: z.string(),
  repoUrl: z.string(),
  baseBranch: z.string(),
  permissionPreset: z.string(),
  additionalEgressDomains: z.array(z.string()).default([]),
})
export type RepoRecord = z.infer<typeof RepoRecordSchema>
export const ReposResponseSchema = z.object({ repos: z.array(RepoRecordSchema) })
export type ReposResponse = z.infer<typeof ReposResponseSchema>
