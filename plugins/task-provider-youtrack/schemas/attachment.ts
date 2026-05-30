// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const YouTrackAttachmentSchema = BaseEntitySchema.extend({
  name: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
  url: z.string().optional(),
  thumbnailURL: z.string().optional(),
  author: z
    .object({
      login: z.string().optional(),
    })
    .optional(),
  created: TimestampSchema.optional(),
})
