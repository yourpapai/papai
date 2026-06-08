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

export const ConfigFieldSchema = z.object({
  key: z.string(),
  storageKey: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  kind: z.string(),
  hasValue: z.boolean(),
  value: z.string(),
})
export type ConfigField = z.infer<typeof ConfigFieldSchema>

export const ConfigResponseSchema = z.object({ contextId: z.string(), fields: z.array(ConfigFieldSchema) })
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>

// --- BYOK ---

export const ByokFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
})
export const ByokResponseSchema = z.object({
  enabled: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
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
})
export const AdminByokResponseSchema = z.object({ contexts: z.array(AdminByokContextSchema) })
export type AdminByokContext = z.infer<typeof AdminByokContextSchema>
export type AdminByokResponse = z.infer<typeof AdminByokResponseSchema>

// --- Tools ---

export const ToolRiskSchema = z.enum(['read', 'write', 'destructive', 'open-world'])
export type ToolRisk = z.infer<typeof ToolRiskSchema>

export const ToolPermissionSchema = z.enum(['allow', 'ask', 'deny'])
export type ToolPermission = z.infer<typeof ToolPermissionSchema>

export const ToolDomainSummarySchema = z.enum(['allow', 'ask', 'deny', 'partial'])
export type ToolDomainSummary = z.infer<typeof ToolDomainSummarySchema>

export const ToolEntrySchema = z.object({ name: z.string(), permission: ToolPermissionSchema, risk: ToolRiskSchema })
export const ToolDomainSchema = z.object({
  domain: z.string(),
  summary: ToolDomainSummarySchema,
  tools: z.array(ToolEntrySchema),
})
export const ToolsResponseSchema = z.object({ contextId: z.string(), domains: z.array(ToolDomainSchema) })
export type ToolsResponse = z.infer<typeof ToolsResponseSchema>
export type ToolDomainView = z.infer<typeof ToolDomainSchema>
export type ToolEntry = z.infer<typeof ToolEntrySchema>

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

export const PluginConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
})
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

export const ContextTaskInstanceResponseSchema = z.object({
  contextId: z.string(),
  taskInstanceId: z.string().nullable(),
  available: z.array(TaskInstanceOptionSchema),
})
export type ContextTaskInstanceResponse = z.infer<typeof ContextTaskInstanceResponseSchema>

// --- Admin (lenient: store-shaped rows rendered generically) ---

export const AdminInstanceRowSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .loose()
const InstanceDecodeFailureSchema = z.object({
  table: z.string(),
  id: z.string(),
  type: z.string(),
  error: z.string(),
})
export const AdminInstancesResponseSchema = z.object({
  instances: z.array(AdminInstanceRowSchema),
  unreadable: z.array(InstanceDecodeFailureSchema).optional(),
})
export type AdminInstanceDecodeFailure = z.infer<typeof InstanceDecodeFailureSchema>
export type AdminInstanceRow = z.infer<typeof AdminInstanceRowSchema>
export type AdminInstancesResponse = z.infer<typeof AdminInstancesResponseSchema>

export const ProviderTypeFieldSchema = z.object({
  key: z.string(),
  storageKey: z.string().optional(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
})
export const ProviderTypeSchema = z
  .object({
    type: z.string(),
    displayName: z.string(),
    instanceConfigSchema: z.array(ProviderTypeFieldSchema).default([]),
  })
  .loose()
export const ProviderTypesResponseSchema = z.object({ providerTypes: z.array(ProviderTypeSchema) })
export type ProviderType = z.infer<typeof ProviderTypeSchema>
export type ProviderTypesResponse = z.infer<typeof ProviderTypesResponseSchema>

export const AdminLlmKeyStateSchema = z.object({
  value: z.string().nullable(),
  updatedAt: z.number().nullable(),
  updatedBy: z.string().nullable(),
})
export const AdminSystemResponseSchema = z.object({ config: z.record(z.string(), AdminLlmKeyStateSchema) })
export type AdminSystemResponse = z.infer<typeof AdminSystemResponseSchema>

export const AdminUserRowSchema = z
  .object({
    platform_user_id: z.string(),
    platform_instance_id: z.string(),
    username: z.string().nullable().optional(),
  })
  .loose()
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserRowSchema) })
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>

export const AdminGroupRowSchema = z
  .object({ group_id: z.string(), added_by: z.string(), added_at: z.string() })
  .loose()
export const ObservedGroupSchema = z.object({
  contextId: z.string(),
  displayName: z.string(),
  parentName: z.string().nullable().default(null),
})
export const AdminGroupsResponseSchema = z.object({
  groups: z.array(AdminGroupRowSchema),
  observed: z.array(ObservedGroupSchema).default([]),
})
export type ObservedGroup = z.infer<typeof ObservedGroupSchema>
export type AdminGroupRow = z.infer<typeof AdminGroupRowSchema>
export type AdminGroupsResponse = z.infer<typeof AdminGroupsResponseSchema>

export const AdminRosterRowSchema = z
  .object({
    userId: z.string(),
    platformInstanceId: z.string(),
    createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .loose()
export const AdminRosterResponseSchema = z.object({ admins: z.array(AdminRosterRowSchema) })
export type AdminRosterRow = z.infer<typeof AdminRosterRowSchema>
export type AdminRosterResponse = z.infer<typeof AdminRosterResponseSchema>

export const PluginApprovalResultSchema = z.object({ ok: z.boolean(), state: z.string().nullable() })
export type PluginApprovalResult = z.infer<typeof PluginApprovalResultSchema>

export const AnnounceResultSchema = z.object({
  totalUsers: z.number(),
  successCount: z.number(),
  failCount: z.number(),
})
export type AnnounceResult = z.infer<typeof AnnounceResultSchema>
