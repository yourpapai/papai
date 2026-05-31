// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/comment.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { ReactionSchema } from './reaction.js'
import { UserReferenceSchema } from './user.js'

export const CommentSchema = BaseEntitySchema.extend({
  text: z.string(),
  textPreview: z.string().optional(),
  author: z.lazy(() => UserReferenceSchema),
  created: TimestampSchema,
  updated: TimestampSchema.optional(),
  deleted: z.boolean().optional(),
  pinned: z.boolean().optional(),
  reactions: z.array(ReactionSchema).optional(),
})
