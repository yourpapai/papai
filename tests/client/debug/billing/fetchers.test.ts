// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchBillingDetail, fetchBillingSubjects } from '../../../../client/debug/billing/fetchers.js'
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
