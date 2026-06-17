// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Bootstrap / session ---

export const AvailableContextSchema = z.object({
  kind: z.enum(['personal', 'group']),
  contextId: z.string(),
  label: z.string(),
})
export type AvailableContext = z.infer<typeof AvailableContextSchema>

export const BootstrapSchema = z.object({
  csrfToken: z.string(),
  display: z.string(),
  principal: z.object({ isBotAdmin: z.boolean(), isSuperAdmin: z.boolean() }),
  contexts: z.array(AvailableContextSchema),
})
export type BootstrapData = z.infer<typeof BootstrapSchema>

// --- Config ---

const StoredConfigValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
})
export const ConfigFieldSchema = StoredConfigValueSchema.extend({
  storageKey: z.string(),
  kind: z.string(),
  control: z.enum(['text', 'toggle', 'select']).optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})
export type ConfigField = z.infer<typeof ConfigFieldSchema>

export const ConfigResponseSchema = z.object({ contextId: z.string(), fields: z.array(ConfigFieldSchema) })
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>

// --- BYOK ---

export const ByokFieldSchema = StoredConfigValueSchema
export const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
  fields: z.array(ByokFieldSchema),
})
export type ByokField = z.infer<typeof ByokFieldSchema>
export type ByokResponse = z.infer<typeof ByokResponseSchema>

export const AdminByokContextSchema = z.object({
  contextId: z.string(),
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  updatedAt: z.number(),
  updatedBy: z.string(),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
})
export const AdminByokResponseSchema = z.object({ contexts: z.array(AdminByokContextSchema) })
export type AdminByokContext = z.infer<typeof AdminByokContextSchema>
export type AdminByokResponse = z.infer<typeof AdminByokResponseSchema>

// --- Tools ---

export const ToolRiskSchema = z.enum(['read', 'write', 'destructive', 'open-world'])
export type ToolRisk = z.infer<typeof ToolRiskSchema>

export const ToolPermissionSchema = z.enum(['allow', 'ask', 'deny'])
export type ToolPermission = z.infer<typeof ToolPermissionSchema>

export const ToolPresetSchema = z.enum(['allow-all', 'non-destructive', 'read-only'])
export type ToolPreset = z.infer<typeof ToolPresetSchema>

export const ToolDomainSummarySchema = z.enum(['allow', 'ask', 'deny', 'partial'])
export type ToolDomainSummary = z.infer<typeof ToolDomainSummarySchema>

export const ToolEntrySchema = z.object({ name: z.string(), permission: ToolPermissionSchema, risk: ToolRiskSchema })
export const ToolDomainSchema = z.object({
  domain: z.string(),
  summary: ToolDomainSummarySchema,
  tools: z.array(ToolEntrySchema),
})
export const ToolsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(ToolDomainSchema),
  activePreset: ToolPresetSchema.nullable().default(null),
})
export type ToolsResponse = z.infer<typeof ToolsResponseSchema>
export type ToolDomainView = z.infer<typeof ToolDomainSchema>
export type ToolEntry = z.infer<typeof ToolEntrySchema>

export const MemoryRecordSchema = z.object({
  id: z.string(),
  kind: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  tags: z.array(z.string()),
  confidence: z.number(),
  status: z.string(),
  source: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeenAt: z.string(),
})
export const MemoryResponseSchema = z.object({
  contextId: z.string(),
  scopeType: z.enum(['personal', 'group']),
  enabled: z.boolean(),
  profile: z.string(),
  records: z.array(MemoryRecordSchema),
})
export type MemoryRecordView = z.infer<typeof MemoryRecordSchema>
export type MemoryResponse = z.infer<typeof MemoryResponseSchema>

// --- MCP ---

export const McpEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  label: z.string().optional(),
  enabled: z.boolean(),
  headers: z.record(z.string(), z.string()).optional(),
  toolFilter: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
})
export type McpEndpoint = z.infer<typeof McpEndpointSchema>
export const McpResponseSchema = z.object({ contextId: z.string(), endpoints: z.array(McpEndpointSchema) })
export type McpResponse = z.infer<typeof McpResponseSchema>

// --- Plugins ---

export const PluginEligibilitySchema = z.union([
  z.object({ eligible: z.literal(true) }),
  z.object({ eligible: z.literal(false), reason: z.enum(['inactive', 'disabled']) }),
  z.object({ eligible: z.literal(false), reason: z.literal('config_missing'), missingKeys: z.array(z.string()) }),
  z.object({
    eligible: z.literal(false),
    reason: z.literal('capability_missing'),
    missingCapabilities: z.array(z.string()),
  }),
])
export type PluginEligibility = z.infer<typeof PluginEligibilitySchema>

export const PluginConfigFieldSchema = StoredConfigValueSchema.omit({ value: true })
export const PluginEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  enabled: z.boolean(),
  eligibility: PluginEligibilitySchema,
  contextConfig: z.array(PluginConfigFieldSchema),
})
export type PluginEntry = z.infer<typeof PluginEntrySchema>
export const PluginsResponseSchema = z.object({ contextId: z.string(), plugins: z.array(PluginEntrySchema) })
export type PluginsResponse = z.infer<typeof PluginsResponseSchema>

// --- Identity ---

export const IdentityMappingSchema = z.object({
  providerUserId: z.string().nullable(),
  providerUserLogin: z.string().nullable(),
  displayName: z.string().nullable(),
  matchedAt: z.string(),
  matchMethod: z.string().nullable(),
  confidence: z.number().nullable(),
})
export const IdentityResponseSchema = z.object({
  contextId: z.string(),
  providerName: z.string(),
  mapping: IdentityMappingSchema.nullable(),
})
export type IdentityResponse = z.infer<typeof IdentityResponseSchema>

// --- Provision ---

export const ProvisionResultSchema = z.object({
  status: z.literal('provisioned'),
  contextId: z.string(),
  email: z.string(),
  password: z.string(),
  kaneoUrl: z.string(),
  workspaceId: z.string(),
})
export type ProvisionResult = z.infer<typeof ProvisionResultSchema>

// --- Group ---

export const GroupMemberSchema = z.object({ user_id: z.string(), added_by: z.string(), added_at: z.string() })
export const GroupMembersResponseSchema = z.object({ contextId: z.string(), members: z.array(GroupMemberSchema) })
export type GroupMembersResponse = z.infer<typeof GroupMembersResponseSchema>

export const TaskInstanceOptionSchema = z.object({ id: z.string(), type: z.string(), status: z.string() })
export const GroupTaskInstanceResponseSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(TaskInstanceOptionSchema),
})
export type GroupTaskInstanceResponse = z.infer<typeof GroupTaskInstanceResponseSchema>

// The per-context route returns the same shape as the group route; only the type name is distinct.
export type ContextTaskInstanceResponse = z.infer<typeof GroupTaskInstanceResponseSchema>

export * from './fetcher-schemas-admin.js'
