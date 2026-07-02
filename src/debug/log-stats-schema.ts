// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/** Shape of GET /logs/stats — bounds of the in-memory log ring buffer. */
export const LogBufferStatsSchema = z.object({
  count: z.number(),
  capacity: z.number(),
  oldest: z.string().nullable(),
  newest: z.string().nullable(),
  matchingCount: z.number().optional(),
})

export type LogBufferStats = z.infer<typeof LogBufferStatsSchema>

export function safeParseLogBufferStats(data: unknown): LogBufferStats | null {
  const result = LogBufferStatsSchema.safeParse(data)
  return result.success ? result.data : null
}
