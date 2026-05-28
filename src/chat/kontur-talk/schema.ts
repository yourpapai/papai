// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const KonturTalkForwardFromSchema = z.object({
  user_id: z.string(),
  room_id: z.string(),
})

const KonturTalkMentionsSchema = z.union([z.array(z.string()), z.literal('all'), z.null()])

export const KonturTalkUpdateSchema = z.object({
  event_id: z.string(),
  user_id: z.string(),
  room_id: z.string(),
  room_is_direct: z.boolean(),
  type: z.string(),
  timestamp: z.number(),
  message_type: z.string(),
  body: z.string().optional(),
  formatted_body: z.string().nullable().optional(),
  media_url: z.string().optional(),
  call_room_name: z.string().optional(),
  thread_id: z.string().nullable().optional(),
  reply_id: z.string().nullable().optional(),
  forward_from: KonturTalkForwardFromSchema.nullable().optional(),
  mentions: KonturTalkMentionsSchema.optional(),
})

export type KonturTalkUpdate = z.infer<typeof KonturTalkUpdateSchema>

export const KonturTalkGetUpdatesResponseSchema = z.object({
  updates: z.array(KonturTalkUpdateSchema),
})

export const KonturTalkSendMessageResponseSchema = z.object({
  event_id: z.string(),
})

export const KonturTalkErrorResponseSchema = z.object({
  detail: z.union([
    z.object({
      errcode: z.string(),
      error: z.string(),
    }),
    z.array(
      z.object({
        loc: z.array(z.union([z.string(), z.number()])),
        msg: z.string(),
        type: z.string(),
      }),
    ),
  ]),
})
