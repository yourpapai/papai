// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const TRANSCRIPT_EVENT_TYPES = [
  'prompt',
  'update',
  'permission_request',
  'permission_decision',
  'result',
] as const

export const TranscriptEventSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  type: z.enum(TRANSCRIPT_EVENT_TYPES),
  payload: z.unknown(),
})
export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>

export const HistoryResponseSchema = z.object({
  events: z.array(TranscriptEventSchema),
  nextCursor: z.number().nullable(),
  recording: z.literal('disabled').optional(),
})
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>
