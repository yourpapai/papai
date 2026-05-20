// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  fetchAdminLlm,
  fetchBillingDetail,
  fetchBillingSubjects,
  submitAdminLlm,
} from '../../../../client/debug/billing/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const captured: Array<{ url: string; init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }
const fullSubject = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  storageContextId: 'A',
  contextType: 'dm',
  displayName: null,
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 0,
  ...overrides,
})

describe('fetchBillingSubjects', () => {
  test('GETs /billing/subjects with the requested window', async () => {
    installFetch(200, { window: '7d', subjects: [fullSubject()] })
    const result = await fetchBillingSubjects('7d')
    expect(captured[0]?.url).toBe('/billing/subjects?window=7d')
    expect(result.window).toBe('7d')
    expect(result.subjects).toHaveLength(1)
  })

  test('throws on non-2xx responses with the error message', async () => {
    installFetch(400, { error: 'unknown window' })
    await expect(fetchBillingSubjects('30d')).rejects.toThrow('unknown window')
  })
})

describe('fetchBillingDetail', () => {
  test('GETs /billing/subject/<encoded id> with the window', async () => {
    installFetch(200, {
      window: 'all',
      subject: fullSubject({ storageContextId: 'group-9:thread-1', contextType: 'group' }),
      requests: [],
      truncated: false,
    })
    const result = await fetchBillingDetail('group-9:thread-1', 'all')
    expect(captured[0]?.url).toBe(`/billing/subject/${encodeURIComponent('group-9:thread-1')}?window=all`)
    expect(result.subject.storageContextId).toBe('group-9:thread-1')
  })

  test('throws on 404 with the response error message', async () => {
    installFetch(404, { error: 'subject not found' })
    await expect(fetchBillingDetail('missing', '30d')).rejects.toThrow('subject not found')
  })
})

describe('fetchAdminLlm', () => {
  test('GETs /admin/llm', async () => {
    const empty = { value: null, updatedAt: null, updatedBy: null }
    installFetch(200, {
      llm_apikey: empty,
      llm_baseurl: empty,
      main_model: empty,
      small_model: empty,
      embedding_model: empty,
    })
    const snap = await fetchAdminLlm()
    expect(captured[0]?.url).toBe('/admin/llm')
    expect(snap.llm_apikey.value).toBeNull()
  })
})

describe('submitAdminLlm', () => {
  test('POSTs JSON body to /admin/llm', async () => {
    installFetch(200, { ok: true, key: 'main_model', updatedAt: 123 })
    const result = await submitAdminLlm({ key: 'main_model', value: 'gpt-6' })
    expect(captured[0]?.url).toBe('/admin/llm')
    expect(captured[0]?.init.method).toBe('POST')
    expect(captured[0]?.init.body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-6' }))
    expect(result.key).toBe('main_model')
  })

  test('throws on 400 with the server message', async () => {
    installFetch(400, { error: 'value must be a non-empty string' })
    await expect(submitAdminLlm({ key: 'main_model', value: '' })).rejects.toThrow('value must be a non-empty string')
  })

  test('throws on 401 with the server message', async () => {
    installFetch(401, { error: 'credentials API requires DEBUG_TOKEN' })
    await expect(submitAdminLlm({ key: 'main_model', value: 'x' })).rejects.toThrow(
      'credentials API requires DEBUG_TOKEN',
    )
  })
})
