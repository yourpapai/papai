// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, http } from 'msw'
import type { HttpHandler } from 'msw'

// --- Task provider, bound state (config + context/task-instance + provision/kaneo) ---
// Covers the three states task-provider-states-unverified names: the bound-instance
// credential list, the Kaneo provision CTA, and the post-provision secret reveal.
//
// Split out of settings-handlers.ts to stay under the max-lines limit.

const taskProviderBoundInstance = {
  contextId: 'ctx-personal-1',
  taskInstanceId: 'inst_abc',
  available: [{ id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' }],
  canProvision: true,
}

const taskProviderBoundConfig = {
  contextId: 'ctx-personal-1',
  fields: [
    {
      key: 'kaneo_apikey',
      label: 'Kaneo API key',
      required: true,
      sensitive: true,
      hasValue: true,
      // Server-shape masked value: maskSensitiveValue() (src/config.ts:144-146) always
      // returns `****` + the last four characters, never an empty string. The previous ''
      // fabricated a state no route can produce.
      value: '****WvfQ',
      storageKey: 'kaneo_apikey',
      kind: 'provider-context',
      control: 'text',
    },
    {
      key: 'kaneo_workspace',
      label: 'Kaneo workspace',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'acme-workspace',
      storageKey: 'kaneo_workspace',
      kind: 'provider-context',
      control: 'text',
    },
  ],
}

// Obvious dummy credentials: Secret renders a masked value, and no real secret
// may ever enter a fixture.
const taskProviderProvisionResult = {
  status: 'provisioned',
  contextId: 'ctx-personal-1',
  email: 'demo-user@example.invalid',
  password: 'example-password-not-real',
  kaneoUrl: 'https://kaneo.example',
  workspaceId: 'ws-demo-1',
}

export const taskProviderBoundHandlers: HttpHandler[] = [
  http.get('/settings/api/config', () => HttpResponse.json(taskProviderBoundConfig)),
  http.get('/settings/api/context/task-instance', () => HttpResponse.json(taskProviderBoundInstance)),
  http.post('/settings/api/provision/kaneo', () => HttpResponse.json(taskProviderProvisionResult)),
]
