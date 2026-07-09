// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

import type { HandlerFamily } from './settings-handlers-personal.js'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Config (GET /settings/api/config) ---

const configPopulated = {
  contextId: 'ctx-personal-1',
  fields: [
    {
      key: 'display_name',
      label: 'Display name',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'Alice',
      storageKey: 'display_name',
      kind: 'preference',
      control: 'text',
    },
    {
      key: 'ai_output_detail_level',
      label: 'Output detail level',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'standard',
      storageKey: 'ai_output_detail_level',
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'raw', label: 'Raw' },
      ],
    },
  ],
}

const configEmpty = {
  contextId: 'ctx-personal-1',
  fields: [],
}

export const configHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/config', () => HttpResponse.json(configPopulated))],
  empty: [http.get('/settings/api/config', () => HttpResponse.json(configEmpty))],
  error: [http.get('/settings/api/config', boom)],
  loading: [
    http.get('/settings/api/config', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(configEmpty)
    }),
  ],
}

// --- Release subscription (GET /settings/api/release-subscription) ---

const releaseSubscriptionPopulated = { enabled: true }
const releaseSubscriptionEmpty = { enabled: false }

export const releaseSubscriptionHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionPopulated))],
  empty: [http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionEmpty))],
  error: [http.get('/settings/api/release-subscription', boom)],
  loading: [
    http.get('/settings/api/release-subscription', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(releaseSubscriptionEmpty)
    }),
  ],
}

// Toggle-in-flight: GET resolves (so the toggle renders), PATCH never resolves.
export const releaseSubscriptionMutatingHandlers: HttpHandler[] = [
  http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionEmpty)),
  http.patch('/settings/api/release-subscription', async () => {
    await delay(NEVER_RESOLVE_MS)
    return HttpResponse.json({})
  }),
]

// Toggle failure: GET resolves, PATCH returns 500.
export const releaseSubscriptionMutationErrorHandlers: HttpHandler[] = [
  http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionEmpty)),
  http.patch('/settings/api/release-subscription', boom),
]

// --- Coding MCP servers (GET /settings/api/coding-credentials?namespace=mcp) ---

const codingMcpCatalog = [
  { name: 'search', upstream_url: 'https://mcp.corp.com/search', host: 'mcp.corp.com' },
  { name: 'docs', upstream_url: 'https://mcp.corp.com/docs', host: 'mcp.corp.com' },
]

const codingMcpPopulated = {
  namespace: 'mcp',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'server',
      label: 'MCP server',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'search',
      control: 'select',
    },
    { key: 'upstream_token', label: 'Credential', required: true, sensitive: true, hasValue: true, value: '****ab12' },
  ],
  catalog: codingMcpCatalog,
}

const codingMcpEmpty = {
  namespace: 'mcp',
  configured: false,
  complete: false,
  missing: ['server', 'upstream_token'],
  fields: [
    {
      key: 'server',
      label: 'MCP server',
      required: true,
      sensitive: false,
      hasValue: false,
      value: '',
      control: 'select',
    },
    { key: 'upstream_token', label: 'Credential', required: true, sensitive: true, hasValue: false, value: '' },
  ],
  catalog: codingMcpCatalog,
}

const codingMcpNoCatalog = { ...codingMcpEmpty, catalog: [] }

// Operator-exposed internal plugin MCP server: papai mints the token, so the picker offers it
// alongside (or instead of) the external catalog and hides the credential field once selected.
const codingMcpPluginServers = [{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }]

const codingMcpInternalAvailable = {
  ...codingMcpEmpty,
  catalog: [],
  pluginServers: codingMcpPluginServers,
}

const codingMcpInternalSelected = {
  namespace: 'mcp',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'server',
      label: 'MCP server',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'plugin:synthetic-web-search',
      control: 'select',
    },
    { key: 'upstream_token', label: 'Credential', required: true, sensitive: true, hasValue: false, value: '' },
  ],
  catalog: [],
  pluginServers: codingMcpPluginServers,
}

export const codingMcpHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingMcpPopulated))],
  empty: [http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingMcpEmpty))],
  error: [http.get('/settings/api/coding-credentials', boom)],
  loading: [
    http.get('/settings/api/coding-credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingMcpEmpty)
    }),
  ],
}

export const codingMcpNoCatalogHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingMcpNoCatalog)),
]

export const codingMcpInternalAvailableHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingMcpInternalAvailable)),
]

export const codingMcpInternalSelectedHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingMcpInternalSelected)),
]
