// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'

import type { HandlerFamily } from './settings-handlers-admin.js'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Admin: release notes (GET /settings/api/admin/release-notes) ---
// ReleaseNotesResponseSchema: { version, body: string|null, broadcastAt: string|null, counts: { dm, group } }

const adminReleaseNotesPopulated = {
  version: '1.2.3',
  body: "## What's new\n- Improved performance\n- Bug fixes",
  broadcastAt: null,
  counts: { dm: 42, group: 5 },
}

export const adminReleaseNotesHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/release-notes', () => HttpResponse.json(adminReleaseNotesPopulated))],
  empty: [
    http.get('/settings/api/admin/release-notes', () =>
      HttpResponse.json({ version: '1.2.3', body: null, broadcastAt: null, counts: { dm: 0, group: 0 } }),
    ),
  ],
  error: [http.get('/settings/api/admin/release-notes', boom)],
  loading: [
    http.get('/settings/api/admin/release-notes', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ version: '1.2.3', body: null, broadcastAt: null, counts: { dm: 0, group: 0 } })
    }),
  ],
}

// --- Admin: coding guardrails (GET /settings/api/admin/coding-guardrails) ---
// AdminCodingGuardrailsResponseSchema: { guardrails: { allowedAgents, whoMayUse, forceSharedKey }, sharedKeySet }

const adminCodingGuardrailsPopulated = {
  guardrails: { allowedAgents: ['claude-code'], whoMayUse: 'members', forceSharedKey: false },
  sharedKeySet: true,
}

export const adminCodingGuardrailsHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/coding-guardrails', () => HttpResponse.json(adminCodingGuardrailsPopulated)),
  ],
  empty: [
    http.get('/settings/api/admin/coding-guardrails', () =>
      HttpResponse.json({
        guardrails: { allowedAgents: [], whoMayUse: 'members', forceSharedKey: false },
        sharedKeySet: false,
      }),
    ),
  ],
  error: [http.get('/settings/api/admin/coding-guardrails', boom)],
  loading: [
    http.get('/settings/api/admin/coding-guardrails', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({
        guardrails: { allowedAgents: [], whoMayUse: 'members', forceSharedKey: false },
        sharedKeySet: false,
      })
    }),
  ],
}

// --- Admin: MCP catalog (GET/POST /settings/api/admin/mcp-catalog) ---
// AdminMcpCatalogResponseSchema: { entries: Array<{ name, upstream_url, header?, default_tool_policy, tool_policy? }> }

const adminMcpCatalogEntry = {
  name: 'Jira',
  upstream_url: 'https://mcp.atlassian.com/v1',
  header: 'Authorization: Bearer xyz',
  default_tool_policy: 'allow' as const,
  tool_policy: { delete_issue: 'deny' as const },
}

const adminMcpCatalogEntryAllowList = {
  name: 'GitHub',
  upstream_url: 'https://mcp.github.com/v1',
  default_tool_policy: 'deny' as const,
  tool_policy: { search: 'allow' as const, get_issue: 'allow' as const },
}

export const adminMcpCatalogHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/mcp-catalog', () =>
      HttpResponse.json({ entries: [adminMcpCatalogEntry, adminMcpCatalogEntryAllowList] }),
    ),
    http.post('/settings/api/admin/mcp-catalog', () =>
      HttpResponse.json({ entries: [adminMcpCatalogEntry, adminMcpCatalogEntryAllowList] }),
    ),
  ],
  empty: [
    http.get('/settings/api/admin/mcp-catalog', () => HttpResponse.json({ entries: [] })),
    http.post('/settings/api/admin/mcp-catalog', () => HttpResponse.json({ entries: [] })),
  ],
  error: [http.get('/settings/api/admin/mcp-catalog', boom)],
  loading: [
    http.get('/settings/api/admin/mcp-catalog', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ entries: [] })
    }),
  ],
}

// --- Admin: MCP plugin servers (GET/POST /settings/api/admin/mcp-plugin-servers) ---
// AdminMcpPluginServersResponseSchema: { available: Array<{ pluginId, name, description, tools }>,
//   configs: Array<{ plugin_id, enabled, default_tool_policy, tool_policy? }> }

const adminMcpPluginServerAvailable = {
  pluginId: 'synthetic-web-search',
  name: 'Synthetic Web Search',
  description: 'Search the web for current information.',
  tools: ['search'],
}

export const adminMcpPluginServersHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/mcp-plugin-servers', () =>
      HttpResponse.json({ available: [adminMcpPluginServerAvailable], configs: [] }),
    ),
    http.post('/settings/api/admin/mcp-plugin-servers', () =>
      HttpResponse.json({
        available: [adminMcpPluginServerAvailable],
        configs: [{ plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'ask' }],
      }),
    ),
  ],
  empty: [
    http.get('/settings/api/admin/mcp-plugin-servers', () => HttpResponse.json({ available: [], configs: [] })),
    http.post('/settings/api/admin/mcp-plugin-servers', () => HttpResponse.json({ available: [], configs: [] })),
  ],
  error: [http.get('/settings/api/admin/mcp-plugin-servers', boom)],
  loading: [
    http.get('/settings/api/admin/mcp-plugin-servers', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ available: [], configs: [] })
    }),
  ],
}

// --- Admin: instances (four GETs in populated/empty) ---
// AdminInstancesResponseSchema: { instances: Array<{ id, type, status, config?, createdAt? }>, unreadable? }
// ProviderTypesResponseSchema: { providerTypes: Array<{ type, displayName, instanceConfigSchema }> }
// error/loading mock only /settings/api/admin/platform-instances

const platformInstancesSample = {
  instances: [
    { id: 'tg-main', type: 'telegram', status: 'active', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'mm-main', type: 'mattermost', status: 'active', createdAt: '2026-02-01T00:00:00Z' },
  ],
}
const taskInstancesSample = {
  instances: [{ id: 'kaneo-main', type: 'kaneo', status: 'active', createdAt: '2026-01-15T00:00:00Z' }],
}
const platformProviderTypesSample = {
  providerTypes: [
    { type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] },
    { type: 'mattermost', displayName: 'Mattermost', instanceConfigSchema: [] },
  ],
}
const taskProviderTypesSample = {
  providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }],
}

export const adminInstancesHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/platform-instances', () => HttpResponse.json(platformInstancesSample)),
    http.get('/settings/api/admin/task-instances', () => HttpResponse.json(taskInstancesSample)),
    http.get('/settings/api/admin/platform-provider-types', () => HttpResponse.json(platformProviderTypesSample)),
    http.get('/settings/api/admin/task-provider-types', () => HttpResponse.json(taskProviderTypesSample)),
  ],
  empty: [
    http.get('/settings/api/admin/platform-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/settings/api/admin/task-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/settings/api/admin/platform-provider-types', () => HttpResponse.json({ providerTypes: [] })),
    http.get('/settings/api/admin/task-provider-types', () => HttpResponse.json({ providerTypes: [] })),
  ],
  error: [http.get('/settings/api/admin/platform-instances', boom)],
  loading: [
    http.get('/settings/api/admin/platform-instances', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ instances: [] })
    }),
  ],
}
