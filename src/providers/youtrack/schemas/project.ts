// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/project.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'
import { UserSchema } from './user.js'

export const ProjectSchema = BaseEntitySchema.extend({
  name: z.string(),
  shortName: z.string(),
  description: z.string().nullable().optional(),
  archived: z.boolean().optional(),
  leader: z.lazy(() => UserSchema).optional(),
  createdBy: z.lazy(() => UserSchema).optional(),
  created: TimestampSchema.optional(),
})
