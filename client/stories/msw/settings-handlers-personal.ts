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

// --- Coding credentials (GET /settings/api/coding-credentials) ---

const codingCredentialsPopulated = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    { key: 'forge_token', label: 'Forge token', required: true, sensitive: true, hasValue: true, value: '****ab12' },
    {
      key: 'instance_url',
      label: 'Instance URL',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'https://gitlab.example.com',
    },
  ],
  allowedAgents: ['claude'],
}

const codingCredentialsEmpty = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['forge_token'],
  fields: [],
}

export const codingCredentialsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredentialsPopulated))],
  empty: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredentialsEmpty))],
  error: [http.get('/settings/api/coding-credentials', boom)],
  loading: [
    http.get('/settings/api/coding-credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingCredentialsEmpty)
    }),
  ],
}

// --- Memory (GET /settings/api/memory) ---

const memoryPopulated = {
  contextId: 'ctx-personal-1',
  scopeType: 'personal',
  enabled: true,
  profile: 'Prefers concise answers.',
  records: [
    {
      id: 'm1',
      kind: 'fact',
      content: 'Works in TypeScript',
      summary: null,
      tags: ['lang'],
      confidence: 0.9,
      status: 'active',
      source: 'chat',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-06-01T00:00:00Z',
    },
  ],
}

const memoryEmpty = {
  contextId: 'ctx-personal-1',
  scopeType: 'personal',
  enabled: false,
  profile: '',
  records: [],
}

export const memoryHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/memory', () => HttpResponse.json(memoryPopulated))],
  empty: [http.get('/settings/api/memory', () => HttpResponse.json(memoryEmpty))],
  error: [http.get('/settings/api/memory', boom)],
  loading: [
    http.get('/settings/api/memory', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(memoryEmpty)
    }),
  ],
}

const memoryEmptyCaptureOn = {
  contextId: 'ctx-personal-1',
  scopeType: 'personal',
  enabled: true,
  profile: '',
  records: [],
}

const memoryProvisional = {
  contextId: 'ctx-group-1',
  scopeType: 'group',
  enabled: true,
  profile: 'Team prefers async standups.',
  records: [
    {
      id: 'm1',
      kind: 'fact',
      content: 'Uses TypeScript across services',
      summary: null,
      tags: ['lang'],
      confidence: 0.9,
      status: 'active',
      source: 'chat',
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
      lastSeenAt: '2026-06-01T00:00:00Z',
    },
    {
      id: 'm2',
      kind: 'preference',
      content: 'Wants deploy notifications posted in the #ops thread',
      summary: null,
      tags: ['ops', 'notifications'],
      confidence: 0.7,
      status: 'provisional',
      source: 'chat',
      createdAt: '2026-06-10T00:00:00Z',
      updatedAt: '2026-06-10T00:00:00Z',
      lastSeenAt: '2026-06-20T00:00:00Z',
    },
  ],
}

export const memoryEmptyCaptureOnHandlers: HttpHandler[] = [
  http.get('/settings/api/memory', () => HttpResponse.json(memoryEmptyCaptureOn)),
]

export const memoryProvisionalHandlers: HttpHandler[] = [
  http.get('/settings/api/memory', () => HttpResponse.json(memoryProvisional)),
]

// --- MCP (GET /settings/api/mcp) ---

const mcpPopulated = {
  contextId: 'ctx-personal-1',
  endpoints: [{ id: 'e1', url: 'https://mcp.example.com/sse', label: 'Example', enabled: true }],
}

const mcpEmpty = {
  contextId: 'ctx-personal-1',
  endpoints: [],
}

export const mcpHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/mcp', () => HttpResponse.json(mcpPopulated))],
  empty: [http.get('/settings/api/mcp', () => HttpResponse.json(mcpEmpty))],
  error: [http.get('/settings/api/mcp', boom)],
  loading: [
    http.get('/settings/api/mcp', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(mcpEmpty)
    }),
  ],
}

// --- Plugins (GET /settings/api/plugins) ---

const pluginsPopulated = {
  contextId: 'ctx-personal-1',
  plugins: [
    {
      id: 'task-provider-kaneo',
      name: 'Kaneo',
      active: true,
      enabled: true,
      eligibility: { eligible: true },
      contextConfig: [],
    },
  ],
}

const pluginsEmpty = {
  contextId: 'ctx-personal-1',
  plugins: [],
}

export const pluginsHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/plugins', () => HttpResponse.json(pluginsPopulated))],
  empty: [http.get('/settings/api/plugins', () => HttpResponse.json(pluginsEmpty))],
  error: [http.get('/settings/api/plugins', boom)],
  loading: [
    http.get('/settings/api/plugins', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(pluginsEmpty)
    }),
  ],
}

// --- Identity (GET /settings/api/identity) ---

const identityPopulated = {
  contextId: 'ctx-personal-1',
  providerName: 'GitHub',
  mapping: {
    providerUserId: '42',
    providerUserLogin: 'alice',
    displayName: 'Alice',
    matchedAt: '2026-05-01T00:00:00Z',
    matchMethod: 'oauth',
    confidence: 1,
  },
}

const identityEmpty = {
  contextId: 'ctx-personal-1',
  providerName: 'GitHub',
  mapping: null,
}

export const identityHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/identity', () => HttpResponse.json(identityPopulated))],
  empty: [http.get('/settings/api/identity', () => HttpResponse.json(identityEmpty))],
  error: [http.get('/settings/api/identity', boom)],
  loading: [
    http.get('/settings/api/identity', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(identityEmpty)
    }),
  ],
}

// Gated: context has no task instance, so identity cannot be mapped (HTTP 422).
export const identityGatedHandlers: HttpHandler[] = [
  http.get('/settings/api/identity', () =>
    HttpResponse.json({ error: 'no task instance configured for this context' }, { status: 422 }),
  ),
]

// Config and release-subscription handlers moved to ./settings-handlers-personal-2.js to keep this file under the line limit.
