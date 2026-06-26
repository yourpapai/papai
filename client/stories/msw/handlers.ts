// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

import {
  makeBillingDetail,
  makeBillingSubject,
  makeGlobalStats,
  makeIdentityMappingsSample,
  makeSubjectStats,
} from '../fixtures/index.js'

const NEVER_RESOLVE_MS = 60_000

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

function billingSubjectsBody(subjects: ReturnType<typeof makeBillingSubject>[]): Record<string, unknown> {
  return { window: '30d', subjects }
}

function billingDetailBody(id: string): Record<string, unknown> {
  const detail = makeBillingDetail({ subject: makeBillingSubject({ storageContextId: id }) })
  return { window: '30d', ...detail }
}

export const billingHandlers: HandlerFamily = {
  populated: [
    http.get('/billing/subjects', () =>
      HttpResponse.json(
        billingSubjectsBody([
          makeBillingSubject(),
          makeBillingSubject({
            storageContextId: 'tg:2',
            contextType: 'group',
            displayName: 'team-alpha',
          }),
        ]),
      ),
    ),
    http.get('/billing/subject/:id', ({ params }) => HttpResponse.json(billingDetailBody(String(params['id'])))),
  ],
  empty: [
    http.get('/billing/subjects', () => HttpResponse.json(billingSubjectsBody([]))),
    http.get('/billing/subject/:id', ({ params }) => HttpResponse.json(billingDetailBody(String(params['id'])))),
  ],
  error: [
    http.get('/billing/subjects', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/billing/subject/:id', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/billing/subjects', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(billingSubjectsBody([]))
    }),
  ],
}

export const statsHandlers: HandlerFamily = {
  populated: [
    http.get('/stats/global', () => HttpResponse.json(makeGlobalStats())),
    http.get('/stats/subject/:id', ({ params }) =>
      HttpResponse.json(makeSubjectStats({ storageContextId: String(params['id']) })),
    ),
  ],
  empty: [
    http.get('/stats/global', () =>
      HttpResponse.json(makeGlobalStats({ subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] } })),
    ),
    http.get('/stats/subject/:id', ({ params }) =>
      HttpResponse.json(makeSubjectStats({ storageContextId: String(params['id']) })),
    ),
  ],
  error: [
    http.get('/stats/global', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/stats/subject/:id', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/stats/global', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(makeGlobalStats())
    }),
  ],
}

const pluginConfigSnapshot = {
  plugins: [
    {
      pluginId: 'task-provider-kaneo',
      keys: [
        { key: 'credential', label: 'Credential', value: '****', sensitive: true, required: true },
        { key: 'workspaceId', label: 'Workspace ID', value: 'ws_4f2a', sensitive: false, required: true },
      ],
    },
    {
      pluginId: 'task-provider-youtrack',
      keys: [{ key: 'token', label: 'API token', value: null, sensitive: true, required: true }],
    },
    {
      pluginId: 'hello-world',
      keys: [],
    },
  ],
}

export const pluginConfigHandlers: HandlerFamily = {
  populated: [
    http.get('/admin/plugin-config', () => HttpResponse.json(pluginConfigSnapshot)),
    http.post('/admin/plugin-config', () =>
      HttpResponse.json({ ok: true, pluginId: 'task-provider-kaneo', key: 'credential', updatedAt: 1717000000000 }),
    ),
  ],
  empty: [
    http.get('/admin/plugin-config', () => HttpResponse.json({ plugins: [] })),
    http.post('/admin/plugin-config', () => HttpResponse.json({ ok: true, pluginId: '', key: '', updatedAt: 0 })),
  ],
  error: [
    http.get('/admin/plugin-config', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.post('/admin/plugin-config', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/admin/plugin-config', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(pluginConfigSnapshot)
    }),
  ],
}

const platformInstancesSnapshot = {
  instances: [
    {
      id: 'pi-telegram-main',
      type: 'telegram' as const,
      config: { bot_token: '****' },
      status: 'active' as const,
      createdAt: '2026-04-01T00:00:00.000Z',
    },
  ],
}

const taskInstancesSnapshot = {
  instances: [
    {
      id: 'ti-kaneo-main',
      type: 'task-provider-kaneo',
      config: { client_url: 'https://kaneo.local' },
      status: 'active' as const,
      createdAt: '2026-04-01T00:00:00.000Z',
      referencingContextCount: 7,
      unresolvedReason: null,
    },
  ],
}

const adminsSnapshot = {
  admins: [{ userId: 'u_admin1', platformInstanceId: 'pi-telegram-main', createdAt: '2026-04-01T00:00:00.000Z' }],
}

const platformProviderTypes = {
  types: [
    {
      type: 'telegram' as const,
      displayName: 'Telegram',
      instanceConfigSchema: [{ key: 'bot_token', label: 'Bot token', required: true, sensitive: true }],
      contextConfigSchema: [],
      capabilities: ['groupMessages'],
      traits: { observedGroupMessages: 'all' as const, maxMessageLength: 4096 },
      source: 'builtin' as const,
    },
  ],
}

const taskProviderTypes = {
  types: [
    {
      type: 'task-provider-kaneo',
      displayName: 'Kaneo',
      instanceConfigSchema: [{ key: 'client_url', label: 'Client URL', required: true, sensitive: false }],
      contextConfigSchema: [{ key: 'credential', label: 'Credential', required: true, sensitive: true }],
      capabilities: ['createTask', 'listTasks'],
      traits: [],
      source: { plugin: 'task-provider-kaneo' },
    },
  ],
}

const identityMappingsRoute = '/admin/identity/mappings' as const

export const identityMappingsHandlers: HandlerFamily = {
  populated: [http.get(identityMappingsRoute, () => HttpResponse.json(makeIdentityMappingsSample()))],
  empty: [http.get(identityMappingsRoute, () => HttpResponse.json([]))],
  error: [http.get(identityMappingsRoute, () => HttpResponse.json({ error: 'boom' }, { status: 500 }))],
  loading: [
    http.get(identityMappingsRoute, async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(makeIdentityMappingsSample())
    }),
  ],
}

export const instancesHandlers: HandlerFamily = {
  populated: [
    http.get('/api/platform-instances', () => HttpResponse.json(platformInstancesSnapshot)),
    http.get('/api/task-instances', () => HttpResponse.json(taskInstancesSnapshot)),
    http.get('/api/admins', () => HttpResponse.json(adminsSnapshot)),
    http.get('/api/platform-provider-types', () => HttpResponse.json(platformProviderTypes)),
    http.get('/api/task-provider-types', () => HttpResponse.json(taskProviderTypes)),
    http.post('/api/platform-instances', () => HttpResponse.json({ ok: true }, { status: 201 })),
    http.post('/api/task-instances', () => HttpResponse.json({ ok: true }, { status: 201 })),
    http.post('/api/platform-instances/apply', () =>
      HttpResponse.json({
        applied: 0,
        started: [],
        stopped: [],
        removed: [],
        recreated: [],
        unchanged: [],
        failed: [],
      }),
    ),
  ],
  empty: [
    http.get('/api/platform-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/api/task-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/api/admins', () => HttpResponse.json({ admins: [] })),
    http.get('/api/platform-provider-types', () => HttpResponse.json({ types: [] })),
    http.get('/api/task-provider-types', () => HttpResponse.json({ types: [] })),
  ],
  error: [
    http.get('/api/platform-instances', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/task-instances', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/admins', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/platform-provider-types', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/task-provider-types', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/api/platform-instances', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(platformInstancesSnapshot)
    }),
  ],
}
