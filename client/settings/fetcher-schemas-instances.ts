// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const InstanceDecodeFailureSchema = z.object({
  table: z.enum(['platform_instances', 'task_instances']),
  id: z.string(),
  type: z.string(),
  error: z.string(),
})

const ApplyFailureSchema = z.object({
  id: z.string(),
  action: z.enum(['remove', 'recreate', 'start']),
  error: z.string(),
})

export const ApplyInstancesResultSchema = z.object({
  applied: z.number(),
  started: z.array(z.string()),
  stopped: z.array(z.string()),
  removed: z.array(z.string()),
  removedDetails: z
    .array(z.object({ id: z.string(), desiredStatus: z.enum(['pending', 'stopped']).nullable() }))
    .default([]),
  recreated: z.array(z.string()),
  unchanged: z.array(z.string()),
  failed: z.array(ApplyFailureSchema),
  unreadable: z.array(InstanceDecodeFailureSchema).default([]),
})

export type ApplyInstancesResult = z.infer<typeof ApplyInstancesResultSchema>
