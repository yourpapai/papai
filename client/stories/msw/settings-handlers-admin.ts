// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

// --- Admin: BYOK overview (GET /settings/api/admin/byok) ---

const adminByokPopulated = {
  contexts: [
    { contextId: 'tg:1', enabled: true, complete: true, missing: [], updatedAt: 1717000000000, updatedBy: 'alice' },
    {
      contextId: 'tg:2',
      enabled: true,
      complete: false,
      missing: ['ANTHROPIC_API_KEY'],
      updatedAt: 1717000000000,
      updatedBy: 'bob',
    },
  ],
}

export const adminByokHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/byok', () => HttpResponse.json(adminByokPopulated))],
  empty: [http.get('/settings/api/admin/byok', () => HttpResponse.json({ contexts: [] }))],
  error: [http.get('/settings/api/admin/byok', boom)],
  loading: [
    http.get('/settings/api/admin/byok', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ contexts: [] })
    }),
  ],
}

// --- Admin: system config (GET /settings/api/admin/system) ---
// AdminSystemResponseSchema: { config: Record<string, { value: string|null, updatedAt: number|null, updatedBy: string|null }> }

const adminSystemPopulated = {
  config: {
    LLM_BASE_URL: { value: 'https://api.anthropic.com', updatedAt: 1717000000000, updatedBy: 'admin' },
    ANTHROPIC_API_KEY: { value: '****abc', updatedAt: 1717000000000, updatedBy: 'admin' },
  },
}

export const adminSystemHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/system', () => HttpResponse.json(adminSystemPopulated))],
  empty: [http.get('/settings/api/admin/system', () => HttpResponse.json({ config: {} }))],
  error: [http.get('/settings/api/admin/system', boom)],
  loading: [
    http.get('/settings/api/admin/system', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ config: {} })
    }),
  ],
}

// --- Admin: groups (GET /settings/api/admin/groups) ---
// AdminGroupsResponseSchema: { groups: Array<{ group_id, added_by, added_at }>, observed: Array<{ contextId, displayName, parentName }> }

const adminGroupsPopulated = {
  groups: [{ group_id: 'tg:-1001234567890', added_by: 'admin', added_at: '2026-01-01T00:00:00Z' }],
  observed: [{ contextId: 'tg:-1001234567890', displayName: 'Dev Team', parentName: null }],
}

export const adminGroupsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/groups', () => HttpResponse.json(adminGroupsPopulated))],
  empty: [http.get('/settings/api/admin/groups', () => HttpResponse.json({ groups: [], observed: [] }))],
  error: [http.get('/settings/api/admin/groups', boom)],
  loading: [
    http.get('/settings/api/admin/groups', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ groups: [], observed: [] })
    }),
  ],
}

// --- Admin: admins roster (GET /settings/api/admin/admins) ---
// AdminRosterResponseSchema: { admins: Array<{ userId, platformInstanceId, createdAt? }> }

const adminAdminsPopulated = {
  admins: [
    { userId: '123456789', platformInstanceId: 'tg-main', createdAt: '2026-01-01T00:00:00Z' },
    { userId: '987654321', platformInstanceId: 'mm-main', createdAt: '2026-02-15T00:00:00Z' },
  ],
}

export const adminAdminsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/admins', () => HttpResponse.json(adminAdminsPopulated))],
  empty: [http.get('/settings/api/admin/admins', () => HttpResponse.json({ admins: [] }))],
  error: [http.get('/settings/api/admin/admins', boom)],
  loading: [
    http.get('/settings/api/admin/admins', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ admins: [] })
    }),
  ],
}

// --- Admin: plugin config (GET /settings/api/admin/plugin-config) ---
// AdminPluginConfigSnapshotSchema: { plugins: Array<{ pluginId, keys: Array<{ key, label, value, sensitive, required }> }> }

const adminPluginConfigPopulated = {
  plugins: [
    {
      pluginId: 'acp',
      keys: [
        { key: 'ACP_URL', label: 'ACP Base URL', value: 'https://magi.example.com', sensitive: false, required: true },
        { key: 'ACP_SECRET', label: 'ACP Secret', value: null, sensitive: true, required: true },
      ],
    },
  ],
}

export const adminPluginConfigHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/plugin-config', () => HttpResponse.json(adminPluginConfigPopulated))],
  empty: [http.get('/settings/api/admin/plugin-config', () => HttpResponse.json({ plugins: [] }))],
  error: [http.get('/settings/api/admin/plugin-config', boom)],
  loading: [
    http.get('/settings/api/admin/plugin-config', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ plugins: [] })
    }),
  ],
}

// --- Admin: module sections (GET /settings/api/admin/module-sections) ---
// ModuleSectionsResponseSchema: { sections: Array<{ id, label, fields: Array<{ key, label, value, sensitive, required }> }> }

const adminModuleSectionsPopulated = {
  sections: [
    {
      id: 'acp',
      label: 'Coding sessions (magi)',
      fields: [
        {
          key: 'magi_base_url',
          label: 'Magi Base URL',
          value: 'https://magi.example.com',
          sensitive: false,
          required: true,
        },
        { key: 'magi_token', label: 'Magi Token', value: '****abcd', sensitive: true, required: true },
      ],
    },
  ],
}

export const adminModuleSectionsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/module-sections', () => HttpResponse.json(adminModuleSectionsPopulated))],
  empty: [http.get('/settings/api/admin/module-sections', () => HttpResponse.json({ sections: [] }))],
  error: [http.get('/settings/api/admin/module-sections', boom)],
  loading: [
    http.get('/settings/api/admin/module-sections', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ sections: [] })
    }),
  ],
}

// --- Admin: tool defaults (GET /settings/api/admin/tool-defaults) ---
// ToolsResponseSchema: { contextId, domains: Array<{ domain, summary, tools: Array<{ name, permission, risk }> }>, activePreset, hasStoredDefaults }

const adminToolDefaultsPopulated = {
  contextId: '__defaults__',
  domains: [
    {
      domain: 'files',
      summary: 'allow',
      tools: [{ name: 'read_file', permission: 'allow', risk: 'read' }],
    },
  ],
  activePreset: null,
  hasStoredDefaults: false,
}

export const adminToolDefaultsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/admin/tool-defaults', () => HttpResponse.json(adminToolDefaultsPopulated))],
  empty: [
    http.get('/settings/api/admin/tool-defaults', () =>
      HttpResponse.json({ contextId: '__defaults__', domains: [], activePreset: null, hasStoredDefaults: false }),
    ),
  ],
  error: [http.get('/settings/api/admin/tool-defaults', boom)],
  loading: [
    http.get('/settings/api/admin/tool-defaults', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ contextId: '__defaults__', domains: [], activePreset: null, hasStoredDefaults: false })
    }),
  ],
}
