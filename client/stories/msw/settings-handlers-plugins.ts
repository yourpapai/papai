// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Plugins fixtures beyond the four state families in settings-handlers-personal.ts.
// The `settings-plugins-populated` scenario there is shared with
// AdminPluginsApprovalSection, so representative config/ineligible states live here
// as their own scenarios rather than enriching it in place.

import { HttpResponse, http } from 'msw'
import type { HttpHandler } from 'msw'

const CONTEXT_ID = 'ctx-personal-1'

// `value` for a sensitive field arrives already masked by the server
// (src/config.ts maskSensitiveValue → `****xxxx`); the client normalizes the
// asterisks to bullets via maskSecret().
const pluginsConfigurable = {
  contextId: CONTEXT_ID,
  plugins: [
    {
      id: 'task-provider-kaneo',
      name: 'Kaneo',
      active: true,
      enabled: true,
      eligibility: { eligible: true },
      contextConfig: [
        { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****WvfQ' },
        {
          key: 'base_url',
          label: 'Base URL',
          required: false,
          sensitive: false,
          hasValue: true,
          value: 'https://kaneo.example.test',
        },
      ],
    },
    {
      id: 'web-search',
      name: 'Web Search',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['api_key'] },
      contextConfig: [
        { key: 'api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
      ],
    },
  ],
}

const pluginsIneligible = {
  contextId: CONTEXT_ID,
  plugins: [
    {
      id: 'pending-approval',
      name: 'Pending Approval',
      active: false,
      enabled: false,
      eligibility: { eligible: false, reason: 'inactive' },
      contextConfig: [],
    },
    {
      id: 'turned-off',
      name: 'Turned Off',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'disabled' },
      contextConfig: [],
    },
    {
      id: 'needs-capability',
      name: 'Needs Capability',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'capability_missing', missingCapabilities: ['tasks.search'] },
      contextConfig: [],
    },
  ],
}

export const pluginsConfigurableHandlers: HttpHandler[] = [
  http.get('/settings/api/plugins', () => HttpResponse.json(pluginsConfigurable)),
]

export const pluginsIneligibleHandlers: HttpHandler[] = [
  http.get('/settings/api/plugins', () => HttpResponse.json(pluginsIneligible)),
]
