// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const SupervisedRepoSchema = z.object({
  projectPath: z.string(),
  repoUrl: z.string(),
  baseBranch: z.string().optional(),
})
export type SupervisedRepo = z.infer<typeof SupervisedRepoSchema>

export const SupervisedProjectSchema = z
  .object({
    repositories: z.array(SupervisedRepoSchema),
    autoReview: z.boolean().optional(),
    selfReviewEnabled: z.boolean().optional(),
    costBudgetUsd: z.number().nullable().optional(),
  })
  .loose()
export type SupervisedProject = z.infer<typeof SupervisedProjectSchema>

export const SupervisedProjectResponseSchema = z.object({ project: SupervisedProjectSchema.nullable() })
export type SupervisedProjectResponse = z.infer<typeof SupervisedProjectResponseSchema>
