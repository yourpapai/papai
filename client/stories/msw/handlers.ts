// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HttpResponse, delay, http } from 'msw'
import type { HttpHandler } from 'msw'

import type { AdminSystemSummary } from '../../shared/api-types.js'
import {
  makeAdminLlmSnapshot,
  makeBillingDetail,
  makeBillingSubject,
  makeGlobalStats,
  makeSubjectStats,
} from '../fixtures/index.js'

const NEVER_RESOLVE_MS = 60_000

export interface HandlerFamily {
  populated: HttpHandler[]
  empty: HttpHandler[]
  error: HttpHandler[]
  loading: HttpHandler[]
}

const systemSummary: AdminSystemSummary = {
  chatProvider: 'telegram',
  taskProvider: 'kaneo',
  debugServer: true,
  adminUserSet: true,
}

function billingSubjectsBody(subjects: ReturnType<typeof makeBillingSubject>[]): Record<string, unknown> {
  return { window: '30d', subjects }
}

function billingDetailBody(id: string): Record<string, unknown> {
  const detail = makeBillingDetail({ subject: makeBillingSubject({ storageContextId: id }) })
  return { window: '30d', ...detail }
}

export const adminHandlers: HandlerFamily = {
  populated: [
    http.get('/admin/llm', () => HttpResponse.json(makeAdminLlmSnapshot())),
    http.get('/admin/system', () => HttpResponse.json(systemSummary)),
  ],
  empty: [
    http.get('/admin/llm', () =>
      HttpResponse.json(
        makeAdminLlmSnapshot({
          llm_apikey: { value: null, updatedAt: null, updatedBy: null },
          llm_baseurl: { value: null, updatedAt: null, updatedBy: null },
          main_model: { value: null, updatedAt: null, updatedBy: null },
          small_model: { value: null, updatedAt: null, updatedBy: null },
          embedding_model: { value: null, updatedAt: null, updatedBy: null },
        }),
      ),
    ),
    http.get('/admin/system', () =>
      HttpResponse.json({ ...systemSummary, adminUserSet: false } satisfies AdminSystemSummary),
    ),
  ],
  error: [
    http.get('/admin/llm', () => HttpResponse.json({ error: 'denied' }, { status: 401 })),
    http.get('/admin/system', () => HttpResponse.json({ error: 'denied' }, { status: 500 })),
  ],
  loading: [
    http.get('/admin/llm', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(makeAdminLlmSnapshot())
    }),
    http.get('/admin/system', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(systemSummary)
    }),
  ],
}

export const billingHandlers: HandlerFamily = {
  populated: [
    http.get('/billing/subjects', () =>
      HttpResponse.json(
        billingSubjectsBody([
          makeBillingSubject(),
          makeBillingSubject({ storageContextId: 'tg:2', contextType: 'group', displayName: 'team-alpha' }),
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
