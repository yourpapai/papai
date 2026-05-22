// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// Response schema
export const GetProjectResponseSchema = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  slug: z.string(),
  icon: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  createdAt: z.any().optional(),
  isPublic: z.boolean().nullable().optional(),
})
