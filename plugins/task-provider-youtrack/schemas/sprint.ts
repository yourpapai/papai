// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const SprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean().optional().default(false),
  goal: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  start: z.number().nullable().optional(),
  finish: z.number().nullable().optional(),
  unresolvedIssuesCount: z.number().optional(),
})

export type YouTrackSprint = z.infer<typeof SprintSchema>
