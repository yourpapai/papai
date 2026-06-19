// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const MattermostWsEventSchema = z.object({
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
})

export const MattermostPostedDataSchema = z.object({
  post: z.string(),
  sender_name: z.string().optional(),
})

export const MattermostPostSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  channel_id: z.string(),
  message: z.string(),
  user_name: z.string().optional(),
  root_id: z.string().optional(),
  parent_id: z.string().optional(),
  file_ids: z.array(z.string()).optional(),
})

export const MattermostFileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime_type: z.string().optional(),
  size: z.number().optional(),
})

export const UserMeSchema = z.object({ id: z.string(), username: z.string().optional() })
export const ChannelSchema = z.object({ id: z.string() })
export const ChannelInfoSchema = z.object({
  type: z.string(),
  display_name: z.string().optional(),
  name: z.string().optional(),
  team_id: z.string().optional(),
})
export const TeamInfoSchema = z.object({
  display_name: z.string().optional(),
  name: z.string().optional(),
})
export const ChannelMemberSchema = z.object({ roles: z.string() })
export const FileUploadSchema = z.object({ file_infos: z.array(z.object({ id: z.string() })) })

export const MattermostUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  nickname: z.string().optional(),
})

export type MattermostPost = z.infer<typeof MattermostPostSchema>

export const MattermostThreadPostSchema = MattermostPostSchema.extend({
  create_at: z.number(),
})
export type MattermostThreadPost = z.infer<typeof MattermostThreadPostSchema>

export const MattermostPostListSchema = z.object({
  order: z.array(z.string()),
  posts: z.record(z.string(), MattermostThreadPostSchema),
})
export type MattermostPostList = z.infer<typeof MattermostPostListSchema>

export function extractReplyId(parentId: string | undefined, rootId: string | undefined): string | undefined {
  if (parentId !== undefined && parentId !== '') return parentId
  if (rootId !== undefined && rootId !== '') return rootId
  return undefined
}
