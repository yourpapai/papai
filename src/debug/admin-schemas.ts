// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const RecentRequestSchema = z.object({
  ts: z.number().int().nonnegative(),
  modelLabel: z.string(),
  role: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  finishStatus: z.string(),
})

export const RecentRequestsResponseSchema = z.object({
  subjectId: z.string(),
  limit: z.number().int().nonnegative(),
  requests: z.array(RecentRequestSchema),
})
