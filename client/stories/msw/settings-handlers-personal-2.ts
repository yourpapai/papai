// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

import { isNamespace } from './namespace.js'
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
      key: 'language',
      label: 'Language',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'en',
      storageKey: 'language',
      kind: 'preference',
      control: 'select',
      options: [
        { value: 'en', label: 'English' },
        { value: 'ru', label: 'Русский' },
      ],
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
// The `servers` vault field is a single sensitive JSON blob (tokens never leave the server); the
// add-row UI is seeded from `selections` (server name + whether a token is stored, no token value).

interface CodingMcpServersField {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  hasValue: boolean
  value: string
}

const codingMcpServersField = (hasValue: boolean): CodingMcpServersField => ({
  key: 'servers',
  label: 'MCP servers',
  required: false,
  sensitive: true,
  hasValue,
  value: hasValue ? '***' : '',
})

const codingMcpCatalog = [
  { name: 'search', upstream_url: 'https://mcp.corp.com/search', default_tool_policy: 'allow' as const },
  { name: 'docs', upstream_url: 'https://mcp.corp.com/docs', default_tool_policy: 'allow' as const },
]

// Operator-exposed internal plugin MCP server: papai mints the token, so the picker offers it
// alongside the external catalog and never shows a credential field for it.
const codingMcpPluginServers = [{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }]

const codingMcpPopulated = {
  namespace: 'mcp',
  configured: true,
  complete: true,
  missing: [],
  fields: [codingMcpServersField(true)],
  catalog: codingMcpCatalog,
  pluginServers: codingMcpPluginServers,
  maxMcpServers: 3,
  selections: [
    { server: 'plugin:synthetic-web-search', hasToken: false },
    { server: 'search', hasToken: true },
  ],
}

const codingMcpEmpty = {
  namespace: 'mcp',
  configured: false,
  complete: true,
  missing: [],
  fields: [codingMcpServersField(false)],
  catalog: codingMcpCatalog,
  pluginServers: [],
  maxMcpServers: 3,
  selections: [],
}

const codingMcpNoCatalog = { ...codingMcpEmpty, catalog: [], pluginServers: [] }

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
  fields: [codingMcpServersField(true)],
  catalog: [],
  pluginServers: codingMcpPluginServers,
  maxMcpServers: 3,
  selections: [{ server: 'plugin:synthetic-web-search', hasToken: false }],
}

export const codingMcpHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpPopulated) : undefined,
    ),
  ],
  empty: [
    http.get('/settings/api/coding-credentials', ({ request }) =>
      isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpEmpty) : undefined,
    ),
  ],
  error: [
    http.get('/settings/api/coding-credentials', ({ request }) => (isNamespace(request, 'mcp') ? boom() : undefined)),
  ],
  loading: [
    http.get('/settings/api/coding-credentials', async ({ request }) => {
      // Guard before the delay: a foreign namespace must fall through immediately.
      if (!isNamespace(request, 'mcp')) return undefined
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingMcpEmpty)
    }),
  ],
}

export const codingMcpNoCatalogHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpNoCatalog) : undefined,
  ),
]

export const codingMcpInternalAvailableHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpInternalAvailable) : undefined,
  ),
]

export const codingMcpInternalSelectedHandlers: HttpHandler[] = [
  http.get('/settings/api/coding-credentials', ({ request }) =>
    isNamespace(request, 'mcp') ? HttpResponse.json(codingMcpInternalSelected) : undefined,
  ),
]

// --- Analytics preferences (GET /settings/api/analytics/preferences) ---
// AnalyticsPreferencesResponseSchema: { notice, preference, explanation, subjectRightsAvailable }

const analyticsPreferencesPopulated = {
  notice: {
    policyVersion: 1,
    noticeVersion: 1,
    purpose: 'product improvement',
    controllerContact: 'privacy@example.com',
    lawfulBasisMode: 'consent',
    policyEffectiveAtMs: null,
  },
  preference: { localLongitudinal: 'unknown', externalPseudonymous: 'unknown', effectiveAtMs: null },
  explanation:
    'Aggregate analytics count events in daily totals that never identify you. ' +
    'Pseudonymous analytics link events to a rotating pseudonym derived from your account.',
  subjectRightsAvailable: true,
}

const analyticsPreferencesAllow = {
  ...analyticsPreferencesPopulated,
  preference: { localLongitudinal: 'allow', externalPseudonymous: 'deny', effectiveAtMs: 1_800_000_000_000 },
}

export const analyticsPreferencesHandlers: HandlerFamily = {
  populated: [http.get('/settings/api/analytics/preferences', () => HttpResponse.json(analyticsPreferencesPopulated))],
  empty: [http.get('/settings/api/analytics/preferences', () => HttpResponse.json(analyticsPreferencesAllow))],
  error: [http.get('/settings/api/analytics/preferences', boom)],
  loading: [
    http.get('/settings/api/analytics/preferences', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(analyticsPreferencesPopulated)
    }),
  ],
}

// Delete returns a queued in_progress status; the section reports it without actor identity.
export const analyticsWithdrawalInProgressHandlers: HttpHandler[] = [
  http.get('/settings/api/analytics/preferences', () => HttpResponse.json(analyticsPreferencesPopulated)),
  http.post('/settings/api/analytics/delete', () =>
    HttpResponse.json({ status: 'in_progress', coverage: 'analytics_only' }),
  ),
]

// The operator has not configured the governance keyring: every subject right 503s, and the
// per-lane hints are replaced by one paragraph. Aggregate collection continues regardless
// (src/analytics/governance/eligibility.ts:136), so the copy must not claim otherwise.
export const analyticsRightsUnavailableHandlers: HttpHandler[] = [
  http.get('/settings/api/analytics/preferences', () =>
    HttpResponse.json({ ...analyticsPreferencesPopulated, subjectRightsAvailable: false }),
  ),
]

// Legitimate interest, past its effective date, with no recorded choice: the local lane is
// collected until denied, while the external lane still stays off until allowed.
export const analyticsLegitimateInterestHandlers: HttpHandler[] = [
  http.get('/settings/api/analytics/preferences', () =>
    HttpResponse.json({
      ...analyticsPreferencesPopulated,
      notice: {
        ...analyticsPreferencesPopulated.notice,
        lawfulBasisMode: 'legitimate_interest',
        policyEffectiveAtMs: 1_700_000_000_000,
      },
    }),
  ),
]
