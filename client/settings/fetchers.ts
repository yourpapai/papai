// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminGroupsResponseSchema,
  AdminInstancesResponseSchema,
  AdminPluginConfigSnapshotSchema,
  AdminPluginConfigUpdateResultSchema,
  AdminRosterResponseSchema,
  AdminSystemResponseSchema,
  AdminUsersResponseSchema,
  AnnounceResultSchema,
  BootstrapSchema,
  ConfigResponseSchema,
  GroupMembersResponseSchema,
  GroupTaskInstanceResponseSchema,
  IdentityResponseSchema,
  McpResponseSchema,
  PluginApprovalResultSchema,
  PluginsResponseSchema,
  ProviderTypesResponseSchema,
  ProvisionResultSchema,
  ToolsResponseSchema,
  type AdminGroupsResponse,
  type AdminInstancesResponse,
  type AdminPluginConfigSnapshot,
  type AdminPluginConfigUpdateResult,
  type AdminRosterResponse,
  type AdminSystemResponse,
  type AdminUsersResponse,
  type AnnounceResult,
  type BootstrapData,
  type ConfigResponse,
  type GroupMembersResponse,
  type GroupTaskInstanceResponse,
  type IdentityResponse,
  type McpEndpoint,
  type McpResponse,
  type PluginApprovalResult,
  type PluginsResponse,
  type ProviderTypesResponse,
  type ProvisionResult,
  type ToolsResponse,
} from './fetcher-schemas.js'

const CSRF_HEADER = 'X-Settings-CSRF'
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

let csrfToken = ''
export const setCsrfToken = (token: string): void => {
  csrfToken = token
}

type UnauthorizedHandler = () => void
const unauthorizedHandlers = new Set<UnauthorizedHandler>()
export const onUnauthorized = (handler: UnauthorizedHandler): (() => void) => {
  unauthorizedHandlers.add(handler)
  return (): void => {
    unauthorizedHandlers.delete(handler)
  }
}

/** Same-origin fetch with cookie credentials + CSRF on writes; fires 401 handlers. */
async function settingsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (WRITE_METHODS.has(method)) {
    if (csrfToken.length > 0) headers.set(CSRF_HEADER, csrfToken)
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(path, { ...init, headers, credentials: 'include' })
  if (res.status === 401) for (const handler of unauthorizedHandlers) handler()
  return res
}

const ctxQuery = (contextId: string): string => `contextId=${encodeURIComponent(contextId)}`

async function getJson<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const res = await settingsFetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return parse(body)
}

async function writeJson<T>(path: string, method: string, payload: unknown, parse: (body: unknown) => T): Promise<T> {
  const res = await settingsFetch(path, { method, body: JSON.stringify(payload) })
  const body = await readBody(res)
  requireOk(res, body)
  return parse(body)
}

// --- Bootstrap / session ---

export const exchangeCode = async (code: string): Promise<BootstrapData> => {
  // Plain fetch: exchange establishes the session/CSRF and must not trip the 401 handler.
  const res = await fetch('/settings/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    credentials: 'include',
  })
  const body = await readBody(res)
  requireOk(res, body)
  return BootstrapSchema.parse(body)
}

export const fetchBootstrap = (): Promise<BootstrapData> =>
  getJson('/settings/api/bootstrap', (b) => BootstrapSchema.parse(b))

export const logout = async (): Promise<void> => {
  await settingsFetch('/settings/auth/logout', { method: 'POST' })
}

// --- Config ---

export const fetchConfig = (contextId: string): Promise<ConfigResponse> =>
  getJson(`/settings/api/config?${ctxQuery(contextId)}`, (b) => ConfigResponseSchema.parse(b))

export const patchConfig = (input: { key: string; value: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/config', 'PATCH', input, (b) => b)

// --- Tools ---

export const fetchTools = (contextId: string): Promise<ToolsResponse> =>
  getJson(`/settings/api/tools?${ctxQuery(contextId)}`, (b) => ToolsResponseSchema.parse(b))

export const toggleTool = (
  input: { kind: 'domain'; domain: string; contextId: string } | { kind: 'tool'; tool: string; contextId: string },
): Promise<ToolsResponse> => writeJson('/settings/api/tools/toggle', 'POST', input, (b) => ToolsResponseSchema.parse(b))

// --- MCP ---

export const fetchMcp = (contextId: string): Promise<McpResponse> =>
  getJson(`/settings/api/mcp?${ctxQuery(contextId)}`, (b) => McpResponseSchema.parse(b))

export const putMcp = (input: { endpoints: McpEndpoint[]; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/mcp', 'PUT', input, (b) => b)

// --- Plugins ---

export const fetchPlugins = (contextId: string): Promise<PluginsResponse> =>
  getJson(`/settings/api/plugins?${ctxQuery(contextId)}`, (b) => PluginsResponseSchema.parse(b))

export const togglePlugin = (input: { pluginId: string; enabled: boolean; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/plugins/toggle', 'POST', input, (b) => b)

export const patchPluginConfig = (input: {
  pluginId: string
  key: string
  value: string
  contextId: string
}): Promise<unknown> => writeJson('/settings/api/plugins/config', 'PATCH', input, (b) => b)

// --- Identity ---

export const fetchIdentity = (contextId: string): Promise<IdentityResponse> =>
  getJson(`/settings/api/identity?${ctxQuery(contextId)}`, (b) => IdentityResponseSchema.parse(b))

export const putIdentity = (input: {
  providerUserId: string
  providerUserLogin?: string | null
  displayName?: string | null
  contextId: string
}): Promise<unknown> => writeJson('/settings/api/identity', 'PUT', input, (b) => b)

export const deleteIdentity = (contextId: string): Promise<unknown> =>
  settingsFetch(`/settings/api/identity?${ctxQuery(contextId)}`, { method: 'DELETE' }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })

// --- Provision ---

export const provisionKaneo = (contextId: string): Promise<ProvisionResult> =>
  writeJson('/settings/api/provision/kaneo', 'POST', { contextId }, (b) => ProvisionResultSchema.parse(b))

// --- Group ---

export const fetchGroupMembers = (contextId: string): Promise<GroupMembersResponse> =>
  getJson(`/settings/api/group/members?${ctxQuery(contextId)}`, (b) => GroupMembersResponseSchema.parse(b))

export const addGroupMember = (input: { userId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/members', 'POST', input, (b) => b)

export const removeGroupMember = (input: { userId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/members', 'DELETE', input, (b) => b)

export const fetchGroupTaskInstance = (contextId: string): Promise<GroupTaskInstanceResponse> =>
  getJson(`/settings/api/group/task-instance?${ctxQuery(contextId)}`, (b) => GroupTaskInstanceResponseSchema.parse(b))

export const patchGroupTaskInstance = (input: { taskInstanceId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/group/task-instance', 'PATCH', input, (b) => b)

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

export const deleteAdminPlatformInstance = (id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/admin/platform-instances/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    async (res) => {
      const body = await readBody(res)
      requireOk(res, body)
      return body
    },
  )

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

export const fetchAdminUsers = (): Promise<AdminUsersResponse> =>
  getJson('/settings/api/admin/users', (b) => AdminUsersResponseSchema.parse(b))

export const addAdminUser = (input: { userId: string; username?: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/users', 'POST', input, (b) => b)

export const removeAdminUser = (input: { userId: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/users', 'DELETE', input, (b) => b)

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
  writeJson('/settings/api/admin/plugin-config', 'PATCH', input, (b) => AdminPluginConfigUpdateResultSchema.parse(b))
