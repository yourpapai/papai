// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const InstanceConfigViewSchema = z.record(z.string(), z.string())

const InstanceStatusViewSchema = z.enum(['pending', 'active', 'stopped'])

const InstanceViewBaseSchema = z.object({
  id: z.string(),
  config: InstanceConfigViewSchema,
  status: InstanceStatusViewSchema,
  createdAt: z.string(),
})

export const PlatformInstanceViewSchema = InstanceViewBaseSchema.extend({
  type: z.enum(['telegram', 'mattermost', 'discord']),
})

export const TaskInstanceViewSchema = InstanceViewBaseSchema.extend({
  type: z.enum(['kaneo', 'youtrack']),
  referencingContextIds: z.array(z.string()).optional(),
  referencingContextCount: z.number().optional(),
})

export const AdminInstanceViewSchema = z.object({
  userId: z.string(),
  platformInstanceId: z.string(),
  createdAt: z.string().optional(),
})

export const ApplyInstancesResultSchema = z.object({ applied: z.number() })
