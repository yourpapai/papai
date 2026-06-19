// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ActivitySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  author: z
    .object({
      id: z.string(),
      login: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      fullName: z.string().nullable().optional(),
    })
    .optional(),
  category: z.object({ id: z.string() }).optional(),
  field: z.object({ name: z.string() }).nullable().optional(),
  targetMember: z.string().nullable().optional(),
  added: z.unknown().optional(),
  removed: z.unknown().optional(),
})

export type YouTrackActivity = z.infer<typeof ActivitySchema>
