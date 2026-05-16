// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/providers/youtrack/schemas/common.ts
import { z } from 'zod'

export const BaseEntitySchema = z.object({
  id: z.string(),
  $type: z.string().optional(),
})

export const TimestampSchema = z.number().int().min(0)
