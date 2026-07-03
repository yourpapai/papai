// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Admin schemas (lenient: store-shaped rows rendered generically).

import { z } from 'zod'

import { StoredConfigValueSchema } from './fetcher-schemas-shared.js'

export const AdminInstanceRowSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    config: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .loose()
const InstanceDecodeFailureSchema = z.object({ table: z.string(), id: z.string(), type: z.string(), error: z.string() })
export const AdminInstancesResponseSchema = z.object({
  instances: z.array(AdminInstanceRowSchema),
  unreadable: z.array(InstanceDecodeFailureSchema).optional(),
})
export type AdminInstanceDecodeFailure = z.infer<typeof InstanceDecodeFailureSchema>
export type AdminInstanceRow = z.infer<typeof AdminInstanceRowSchema>
export type AdminInstancesResponse = z.infer<typeof AdminInstancesResponseSchema>

export const ProviderTypeFieldSchema = StoredConfigValueSchema.omit({ hasValue: true, value: true }).extend({
  storageKey: z.string().optional(),
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
    added_by: z.string(),
    blocked_at: z.string().nullable().optional(),
  })
  .loose()
export const AdminUsersResponseSchema = z.object({ users: z.array(AdminUserRowSchema) })
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>

export const OpenAccessResponseSchema = z.object({ openDmAccess: z.boolean() }).loose()
export type OpenAccessResponse = z.infer<typeof OpenAccessResponseSchema>

export const AddAdminUserResponseSchema = z.object({ ok: z.boolean(), pending: z.boolean().optional() }).loose()
export type AddAdminUserResponse = z.infer<typeof AddAdminUserResponseSchema>

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
