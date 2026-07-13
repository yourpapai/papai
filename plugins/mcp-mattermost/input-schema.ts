// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const mattermostGetPostSchema = {
  type: 'object',
  properties: { linkOrId: { type: 'string', minLength: 1, description: 'Post permalink or id' } },
  required: ['linkOrId'],
  additionalProperties: false,
} as const

export const mattermostGetThreadSchema = {
  type: 'object',
  properties: {
    linkOrId: { type: 'string', minLength: 1, description: 'Post permalink or id (thread root)' },
  },
  required: ['linkOrId'],
  additionalProperties: false,
} as const

export const mattermostGetChannelPostsSchema = {
  type: 'object',
  properties: {
    channelId: { type: 'string', minLength: 1, description: 'Channel id' },
    since: { type: ['string', 'number'], description: 'ISO date-time string or epoch-ms' },
    page: { type: 'integer', minimum: 0, description: 'Page number (default 0)' },
    perPage: { type: 'integer', minimum: 1, maximum: 200, description: 'Posts per page (default 60, max 200)' },
  },
  required: ['channelId'],
  additionalProperties: false,
} as const

export const mattermostCreatePostSchema = {
  type: 'object',
  properties: {
    channelId: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1, description: 'Message text' },
    rootId: { type: 'string', description: 'Thread root post id' },
    threadLinkOrId: {
      type: 'string',
      description: 'Thread permalink/id used as rootId if rootId absent',
    },
  },
  required: ['channelId', 'message'],
  additionalProperties: false,
} as const

export const mattermostDownloadAttachmentSchema = {
  type: 'object',
  properties: { fileId: { type: 'string', minLength: 1, description: 'File id from a post attachments list' } },
  required: ['fileId'],
  additionalProperties: false,
} as const
