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

// --- Admin: LLM providers (GET/POST/PATCH/DELETE /settings/api/admin/providers) ---

const adminProvidersPopulated = {
  providers: [
    {
      id: 'prov_openai',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o', 'gpt-4o-mini'],
        modelsFetchedAt: 1717000000000,
      },
    },
    {
      id: 'prov_ollama',
      label: 'Local Ollama',
      providerType: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKeyMasked: '****ama',
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    },
  ],
}

export const adminProvidersHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/providers', () => HttpResponse.json(adminProvidersPopulated)),
    http.post('/settings/api/admin/providers', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
    http.patch('/settings/api/admin/providers/:id', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
    http.delete('/settings/api/admin/providers/:id', () => HttpResponse.json({ ok: true })),
  ],
  empty: [
    http.get('/settings/api/admin/providers', () => HttpResponse.json({ providers: [] })),
    http.post('/settings/api/admin/providers', () =>
      HttpResponse.json({ provider: adminProvidersPopulated.providers[0] }),
    ),
  ],
  error: [http.get('/settings/api/admin/providers', boom)],
  loading: [
    http.get('/settings/api/admin/providers', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json({ providers: [] })
    }),
  ],
}

// --- Admin: LLM roles (GET/PUT /settings/api/admin/llm-roles) ---

const adminLlmRolesPopulated = {
  roles: {
    main: { providerId: 'prov_openai', model: 'gpt-4o' },
    small: { providerId: 'prov_openai', model: 'gpt-4o-mini' },
    embedding: null,
  },
}

const adminLlmRolesEmpty = {
  roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
}

export const adminLlmRolesHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/admin/llm-roles', () => HttpResponse.json(adminLlmRolesPopulated)),
    http.put('/settings/api/admin/llm-roles', () => HttpResponse.json({ ok: true })),
  ],
  empty: [http.get('/settings/api/admin/llm-roles', () => HttpResponse.json(adminLlmRolesEmpty))],
  error: [http.get('/settings/api/admin/llm-roles', boom)],
  loading: [
    http.get('/settings/api/admin/llm-roles', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(adminLlmRolesEmpty)
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
