// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const YouTrackWorkItemSchema = BaseEntitySchema.extend({
  date: TimestampSchema,
  duration: z.object({
    minutes: z.number().int().nonnegative(),
    presentation: z.string().optional(),
  }),
  text: z.string().optional(),
  author: BaseEntitySchema.extend({
    login: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  type: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
})

export type YouTrackWorkItem = z.infer<typeof YouTrackWorkItemSchema>
