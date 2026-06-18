// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/user.ts
import { z } from 'zod'

import { BaseEntitySchema, TimestampSchema } from './common.js'

// YouTrack returns requested-but-empty scalar attributes as `null` (not omitted), so
// optional string attributes must also be nullable. See schemas/comment.ts `updated`.
export const UserSchema = BaseEntitySchema.extend({
  login: z.string(),
  fullName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  created: TimestampSchema.nullable().optional(),
  lastAccess: TimestampSchema.nullable().optional(),
})

export const UserReferenceSchema = BaseEntitySchema.extend({
  login: z.string(),
  name: z.string().nullable().optional(),
})
