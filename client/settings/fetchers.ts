// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import { ToolsResponseSchema, type ToolPreset, type ToolsResponse } from './fetcher-schemas-tools.js'
import {
  ByokResponseSchema,
  BootstrapSchema,
  ConfigResponseSchema,
  GroupMembersResponseSchema,
  GroupTaskInstanceResponseSchema,
  IdentityResponseSchema,
  MemoryResponseSchema,
  McpResponseSchema,
  PluginsResponseSchema,
  ProvisionResultSchema,
  type ByokResponse,
  type BootstrapData,
  type ConfigResponse,
  type ContextTaskInstanceResponse,
  type GroupMembersResponse,
  type GroupTaskInstanceResponse,
  type IdentityResponse,
  type MemoryResponse,
  type McpEndpoint,
  type McpResponse,
  type PluginsResponse,
  type ProvisionResult,
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
export async function settingsFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

export async function getJson<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const res = await settingsFetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return parse(body)
}

export async function writeJson<T>(
  path: string,
  method: string,
  payload: unknown,
  parse: (body: unknown) => T,
): Promise<T> {
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

// --- BYOK ---

export const fetchByok = (contextId: string): Promise<ByokResponse> =>
  getJson(`/settings/api/byok?${ctxQuery(contextId)}`, (b) => ByokResponseSchema.parse(b))

export const patchByok = (input: { contextId: string; values: Record<string, string> }): Promise<unknown> =>
  writeJson('/settings/api/byok', 'PATCH', input, (b) => b)

// --- Tools ---

export const fetchTools = (contextId: string): Promise<ToolsResponse> =>
  getJson(`/settings/api/tools?${ctxQuery(contextId)}`, (b) => ToolsResponseSchema.parse(b))

export const setToolPermission = (
  input:
    | { kind: 'domain'; domain: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'tool'; tool: string; permission: 'allow' | 'ask' | 'deny'; contextId: string },
): Promise<ToolsResponse> => writeJson('/settings/api/tools/toggle', 'POST', input, (b) => ToolsResponseSchema.parse(b))

export const applyToolPreset = (input: { preset: ToolPreset; contextId: string }): Promise<ToolsResponse> =>
  writeJson('/settings/api/tools/toggle', 'POST', { kind: 'preset', ...input }, (b) => ToolsResponseSchema.parse(b))

// --- Memory ---

export const fetchMemory = (contextId: string): Promise<MemoryResponse> =>
  getJson(`/settings/api/memory?${ctxQuery(contextId)}`, (b) => MemoryResponseSchema.parse(b))

export const updateMemoryProfile = (input: { contextId: string; profile: string }): Promise<unknown> =>
  writeJson('/settings/api/memory/profile', 'PATCH', input, (b) => b)

export const setMemoryCapture = (input: { contextId: string; enabled: boolean }): Promise<unknown> =>
  writeJson('/settings/api/memory/capture', 'PATCH', input, (b) => b)

export const clearMemory = (input: { contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/memory/clear', 'POST', input, (b) => b)

export const archiveMemoryRecord = (contextId: string, id: string): Promise<unknown> =>
  settingsFetch(`/settings/api/memory/records/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: JSON.stringify({ contextId }),
  }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })

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

export const fetchContextTaskInstance = (contextId: string): Promise<ContextTaskInstanceResponse> =>
  getJson(`/settings/api/context/task-instance?${ctxQuery(contextId)}`, (b) => GroupTaskInstanceResponseSchema.parse(b))

export const patchContextTaskInstance = (input: { taskInstanceId: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/context/task-instance', 'PATCH', input, (b) => b)
