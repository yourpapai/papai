// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const CreateLabelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.unknown().optional(),
  taskId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
})

export type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
