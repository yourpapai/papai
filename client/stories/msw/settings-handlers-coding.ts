// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'

import { isNamespace } from './namespace.js'
import type { HandlerFamily } from './settings-handlers-personal.js'

const NEVER_RESOLVE_MS = 60_000
const boom = (): HttpResponse<{ error: string }> => HttpResponse.json({ error: 'boom' }, { status: 500 })

// --- Coding credentials (GET /settings/api/coding-credentials) ---
// Three namespaces share this URL: 'agent-provider' and 'forge' here, 'mcp' in
// settings-handlers-personal-2.ts. Every resolver must guard on its own namespace.

const AGENT_OPTIONS = ['claude', 'codex', 'opencode']
const PROVIDER_OPTIONS = ['anthropic', 'openai', 'openai-compatible']
const AUTH_METHOD_OPTIONS = ['api-key', 'oauth-subscription']

type FixtureField = Record<string, unknown>

function credentialField(key: string, label: string, overrides: FixtureField = {}): FixtureField {
  return { key, label, required: false, sensitive: false, hasValue: false, value: '', ...overrides }
}

function agentProviderFields(hasValue: boolean): FixtureField[] {
  return [
    credentialField('agent', 'Coding agent', {
      required: true,
      hasValue,
      value: 'claude',
      control: 'select',
      options: AGENT_OPTIONS,
    }),
    credentialField('provider', 'Model provider', {
      required: true,
      hasValue,
      value: 'anthropic',
      control: 'select',
      options: PROVIDER_OPTIONS,
    }),
    credentialField('auth_method', 'Auth method', {
      hasValue,
      value: 'api-key',
      control: 'select',
      options: AUTH_METHOD_OPTIONS,
    }),
    credentialField('provider_api_key', 'API key', {
      required: true,
      sensitive: true,
      hasValue,
      value: hasValue ? '****ab12' : '',
    }),
    credentialField('provider_base_url', 'Base URL'),
    credentialField('model', 'Model', { hasValue, value: hasValue ? 'claude-sonnet-4' : '', control: 'combobox' }),
  ]
}

const codingCredentialsPopulated = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: agentProviderFields(true),
  allowedAgents: AGENT_OPTIONS,
}

const codingCredentialsEmpty = {
  namespace: 'agent-provider',
  configured: false,
  complete: false,
  missing: ['provider_api_key'],
  fields: agentProviderFields(false),
  allowedAgents: AGENT_OPTIONS,
}

const codingModelsPopulated = {
  ok: true,
  models: [
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
    { value: 'claude-opus-4', label: 'claude-opus-4' },
  ],
}

export const codingCredentialsHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json(codingModelsPopulated)),
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? HttpResponse.json(codingCredentialsPopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json({ ok: false, models: [] })),
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? HttpResponse.json(codingCredentialsEmpty) : undefined,
    ),
  ],
  error: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'agent-provider') ? boom() : undefined,
    ),
  ],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately,
      // not hang for NEVER_RESOLVE_MS.
      if (!isNamespace(request, 'agent-provider')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingCredentialsEmpty)
    }),
  ],
}

// --- Forge (namespace: 'forge') ---
// Mirrors FIELDS_META.forge in src/debug/settings/coding-credentials-fields-meta.ts:63-79.
// The route attaches allowedAgents only for 'agent-provider' and the catalog keys only for
// 'mcp', so a forge body carries neither.

const FORGE_KIND_OPTIONS = ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted']

function forgeFields(hasValue: boolean): FixtureField[] {
  return [
    credentialField('kind', 'Code host', {
      required: true,
      hasValue,
      // A SaaS kind, so instance_url starts hidden and the reveal interaction is observable.
      value: hasValue ? 'github' : '',
      control: 'select',
      options: FORGE_KIND_OPTIONS,
    }),
    credentialField('instance_url', 'Instance URL (enterprise / self-hosted)'),
    credentialField('forge_token', 'Access token', {
      required: true,
      sensitive: true,
      hasValue,
      value: hasValue ? '****cd34' : '',
    }),
  ]
}

const forgePopulated = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: forgeFields(true),
}

// `missing` follows allRequiredFields (src/coding-credentials/store.ts:60): both required fields.
const forgeEmpty = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['kind', 'forge_token'],
  fields: forgeFields(false),
}

export const forgeHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'forge') ? HttpResponse.json(forgePopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'forge') ? HttpResponse.json(forgeEmpty) : undefined,
    ),
  ],
  error: [
    http.get('/settings/api/coding-credentials', ({ request }) => (isNamespace(request, 'forge') ? boom() : undefined)),
  ],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately.
      if (!isNamespace(request, 'forge')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(forgeEmpty)
    }),
  ],
}
