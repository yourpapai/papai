// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const YouTrackAttachmentSchema = BaseEntitySchema.extend({
  name: z.string(),
  mimeType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  thumbnailURL: z.string().nullable().optional(),
  author: z
    .object({
      login: z.string().nullable().optional(),
    })
    .optional(),
  created: TimestampSchema.nullable().optional(),
})
