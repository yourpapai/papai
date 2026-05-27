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
  type: z.string(),
  referencingContextIds: z.array(z.string()).optional(),
  referencingContextCount: z.number().optional(),
})

const ProviderConfigRequirementViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  storageKey: z.string().optional(),
})

export const TaskProviderTypeViewSchema = z.object({
  type: z.string(),
  displayName: z.string(),
  instanceConfigSchema: z.array(ProviderConfigRequirementViewSchema),
  contextConfigSchema: z.array(ProviderConfigRequirementViewSchema),
  capabilities: z.array(z.string()),
  traits: z.array(z.string()),
  source: z.union([z.literal('builtin'), z.object({ plugin: z.string().min(1) })]),
})

export const PlatformProviderTypeViewSchema = z.object({
  type: z.enum(['telegram', 'mattermost', 'discord']),
  displayName: z.string(),
  instanceConfigSchema: z.array(ProviderConfigRequirementViewSchema),
  contextConfigSchema: z.array(ProviderConfigRequirementViewSchema),
  capabilities: z.array(z.string()),
  traits: z.array(z.string()),
  source: z.literal('builtin'),
})

export const AdminInstanceViewSchema = z.object({
  userId: z.string(),
  platformInstanceId: z.string(),
  createdAt: z.string().optional(),
})

export const ApplyInstancesResultSchema = z.object({ applied: z.number() })
