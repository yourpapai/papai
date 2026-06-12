// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const SavedQuerySchema = z.object({
  id: z.string(),
  name: z.string(),
  query: z.string().nullable().optional(),
})

export type YouTrackSavedQuery = z.infer<typeof SavedQuerySchema>
