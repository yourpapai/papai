// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  AdminFeatureFlagRowSchema,
  AdminFeatureFlagsSnapshotSchema,
  type AdminFeatureFlagRow,
  type AdminFeatureFlagState,
  type AdminFeatureFlagsSnapshot,
} from '../admin/feature-flags-fetcher-schemas.js'
import type { AdminPluginConfigSnapshot, SubmitAdminPluginConfigResponse } from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminCodingGuardrailsResponseSchema,
  type AdminCodingGuardrailsResponse,
} from './fetcher-schemas-coding-guardrails.js'
import { ApplyInstancesResultSchema, type ApplyInstancesResult } from './fetcher-schemas-instances.js'
import {
  AdminPluginConfigSnapshotSchema,
  SubmitAdminPluginConfigResponseSchema,
} from './fetcher-schemas-plugin-config.js'
import {
  ReleaseBroadcastResultSchema,
  ReleaseNotesResponseSchema,
  type ReleaseBroadcastResult,
  type ReleaseNotesResponse,
} from './fetcher-schemas-release.js'
import { ToolsResponseSchema, type ToolPreset, type ToolsResponse } from './fetcher-schemas-tools.js'
import {
  AddAdminUserResponseSchema,
  AdminByokResponseSchema,
  AdminGroupsResponseSchema,
  AdminInstancesResponseSchema,
  AdminRosterResponseSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  AnnounceResultSchema,
  OpenAccessResponseSchema,
  PluginApprovalResultSchema,
  ProviderTypesResponseSchema,
  type AddAdminUserResponse,
  type AdminByokResponse,
  type AdminGroupsResponse,
  type AdminInstancesResponse,
  type AdminRosterResponse,
  type AdminSystemResponse,
  type AdminUsersResponse,
  type AnnounceResult,
  type OpenAccessResponse,
  type PluginApprovalResult,
  type ProviderTypesResponse,
} from './fetcher-schemas.js'
import { getJson, settingsFetch, writeJson } from './fetchers.js'

type AdminPluginConfigUpdateResult = SubmitAdminPluginConfigResponse

// --- Admin: instances ---

export const fetchAdminPlatformInstances = (): Promise<AdminInstancesResponse> =>
  getJson('/settings/api/admin/platform-instances', (b) => AdminInstancesResponseSchema.parse(b))

export const fetchAdminTaskInstances = (): Promise<AdminInstancesResponse> =>
  getJson('/settings/api/admin/task-instances', (b) => AdminInstancesResponseSchema.parse(b))

export const fetchAdminPlatformProviderTypes = (): Promise<ProviderTypesResponse> =>
  getJson('/settings/api/admin/platform-provider-types', (b) => ProviderTypesResponseSchema.parse(b))

export const fetchAdminTaskProviderTypes = (): Promise<ProviderTypesResponse> =>
  getJson('/settings/api/admin/task-provider-types', (b) => ProviderTypesResponseSchema.parse(b))

export const createAdminPlatformInstance = (input: {
  id: string
  type: string
  config: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/admin/platform-instances', 'POST', input, (b) => b)

export const createAdminTaskInstance = (input: {
  id: string
  type: string
  config: Record<string, string>
}): Promise<unknown> => writeJson('/settings/api/admin/task-instances', 'POST', input, (b) => b)

export const updateAdminPlatformInstance = (
  id: string,
  input: { status?: string; config?: Record<string, string> },
): Promise<unknown> =>
  writeJson(`/settings/api/admin/platform-instances/${encodeURIComponent(id)}`, 'PATCH', input, (b) => b)

export const updateAdminTaskInstance = (
  id: string,
  input: { status?: string; config?: Record<string, string> },
): Promise<unknown> =>
  writeJson(`/settings/api/admin/task-instances/${encodeURIComponent(id)}`, 'PATCH', input, (b) => b)

export const deleteAdminPlatformInstance = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/platform-instances/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    async (res) => {
      const body = await readBody(res)
      requireOk(res, body)
      return body
    },
  )

export const applyAdminPlatformInstances = (): Promise<ApplyInstancesResult> =>
  writeJson('/settings/api/admin/platform-instances/apply', 'POST', {}, (b) => ApplyInstancesResultSchema.parse(b))

export const deleteAdminTaskInstance = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/task-instances/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    async (res) => {
      const body = await readBody(res)
      requireOk(res, body)
      return body
    },
  )

// --- Admin: system / access / roster / plugins / announce ---

export const fetchAdminSystem = (): Promise<AdminSystemResponse> =>
  getJson('/settings/api/admin/system', (b) => AdminSystemResponseSchema.parse(b))

export const submitAdminSystem = (input: { key: string; value: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/system', 'POST', input, (b) => b)

export const fetchAdminByok = (): Promise<AdminByokResponse> =>
  getJson('/settings/api/admin/byok', (b) => AdminByokResponseSchema.parse(b))

export const fetchAdminUsers = (): Promise<AdminUsersResponse> =>
  getJson('/settings/api/admin/users', (b) => AdminUsersResponseSchema.parse(b))

export const addAdminUser = (input: { userId: string; username?: string }): Promise<AddAdminUserResponse> =>
  writeJson('/settings/api/admin/users', 'POST', input, (b) => AddAdminUserResponseSchema.parse(b))

export const removeAdminUser = (input: { userId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/users', 'DELETE', input, (b) => b)

export const fetchOpenAccess = (): Promise<OpenAccessResponse> =>
  getJson('/settings/api/admin/open-access', (b) => OpenAccessResponseSchema.parse(b))

export const patchOpenAccess = (input: { enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/admin/open-access', 'POST', input, (b) => b)

export const setUserBlocked = (input: { userId: string; blocked: boolean }): Promise<unknown> =>
  writeJson('/settings/api/admin/users/block', 'POST', input, (b) => b)

export const fetchAdminGroups = (): Promise<AdminGroupsResponse> =>
  getJson('/settings/api/admin/groups', (b) => AdminGroupsResponseSchema.parse(b))

export const addAdminGroup = (input: { groupId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/groups', 'POST', input, (b) => b)

export const removeAdminGroup = (input: { groupId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/groups', 'DELETE', input, (b) => b)

export const fetchAdminRoster = (): Promise<AdminRosterResponse> =>
  getJson('/settings/api/admin/admins', (b) => AdminRosterResponseSchema.parse(b))

export const addRosterAdmin = (input: { userId: string; platformInstanceId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/admins', 'POST', input, (b) => b)

export const removeRosterAdmin = (input: { userId: string; platformInstanceId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/admins', 'DELETE', input, (b) => b)

export const setPluginApproval = (input: {
  pluginId: string
  action: 'approve' | 'reject'
}): Promise<PluginApprovalResult> =>
  writeJson('/settings/api/admin/plugin-approval', 'POST', input, (b) => PluginApprovalResultSchema.parse(b))

export const sendAnnounce = (input: { message: string }): Promise<AnnounceResult> =>
  writeJson('/settings/api/admin/announce', 'POST', input, (b) => AnnounceResultSchema.parse(b))

export const fetchAdminPluginConfig = (): Promise<AdminPluginConfigSnapshot> =>
  getJson('/settings/api/admin/plugin-config', (b) => AdminPluginConfigSnapshotSchema.parse(b))

export const patchAdminPluginConfig = (input: {
  pluginId: string
  key: string
  value: string
}): Promise<AdminPluginConfigUpdateResult> =>
  writeJson('/settings/api/admin/plugin-config', 'PATCH', input, (b) => SubmitAdminPluginConfigResponseSchema.parse(b))

export const unsetAdminPluginConfig = (input: { pluginId: string; key: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/plugin-config', 'PATCH', { action: 'unset', ...input }, (b) => b)

// --- Admin: feature flags ---

export const fetchAdminFeatureFlags = (): Promise<AdminFeatureFlagsSnapshot> =>
  getJson('/settings/api/admin/feature-flags', (b) => AdminFeatureFlagsSnapshotSchema.parse(b))

export const saveAdminFeatureFlags = (input: {
  contextId: string
  flags: AdminFeatureFlagState
}): Promise<AdminFeatureFlagRow> =>
  writeJson('/settings/api/admin/feature-flags', 'PATCH', input, (b) => AdminFeatureFlagRowSchema.parse(b))

// Admin tool defaults: POST for all toggle kinds (domain/tool/preset), mirroring the user-facing /tools route.

export const fetchToolDefaults = (): Promise<ToolsResponse> =>
  getJson('/settings/api/admin/tool-defaults', (b) => ToolsResponseSchema.parse(b))

export const setToolDefault = (
  input:
    | { kind: 'domain'; domain: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'tool'; tool: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'group'; domain: string; group: string; permission: 'allow' | 'ask' | 'deny'; contextId: string },
): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', input, (b) => ToolsResponseSchema.parse(b))

export const applyToolDefaultPreset = (input: { preset: ToolPreset }): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', { kind: 'preset', preset: input.preset }, (b) =>
    ToolsResponseSchema.parse(b),
  )

export const unsetToolDefaults = (): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', { kind: 'unset' }, (b) => ToolsResponseSchema.parse(b))

// --- Admin: release notes ---

export const fetchReleaseNotes = (): Promise<ReleaseNotesResponse> =>
  getJson('/settings/api/admin/release-notes', (b) => ReleaseNotesResponseSchema.parse(b))

export const regenerateReleaseNotes = (): Promise<ReleaseNotesResponse> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'regenerate' }, (b) =>
    ReleaseNotesResponseSchema.parse(b),
  )

export const saveReleaseNotes = (body: string): Promise<ReleaseNotesResponse> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'save', body }, (b) =>
    ReleaseNotesResponseSchema.parse(b),
  )

export const broadcastReleaseNotes = (): Promise<ReleaseBroadcastResult> =>
  writeJson('/settings/api/admin/release-notes', 'POST', { action: 'broadcast' }, (b) =>
    ReleaseBroadcastResultSchema.parse(b),
  )

// --- Admin: coding guardrails ---

export const fetchAdminCodingGuardrails = (): Promise<AdminCodingGuardrailsResponse> =>
  getJson('/settings/api/admin/coding-guardrails', (b) => AdminCodingGuardrailsResponseSchema.parse(b))

export const postAdminCodingGuardrails = (body: unknown): Promise<AdminCodingGuardrailsResponse> =>
  writeJson('/settings/api/admin/coding-guardrails', 'POST', body, (b) => AdminCodingGuardrailsResponseSchema.parse(b))
