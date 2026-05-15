// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/user.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

export const UserSchema = BaseEntitySchema.extend({
  login: z.string(),
  fullName: z.string().optional(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
  created: TimestampSchema.optional(),
  lastAccess: TimestampSchema.optional(),
})

export const UserReferenceSchema = BaseEntitySchema.extend({
  login: z.string(),
  name: z.string().optional(),
})
