// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SubjectDetail from '../../../../client/admin/components/SubjectDetail.svelte'
import type { BillingDetail, BillingRequestRow, BillingSubject } from '../../../../client/shared/api-types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }

const subject: BillingSubject = {
  storageContextId: 'user-A',
  contextType: 'dm',
  displayName: 'alice',
  totals: { main: emptyTotals, small: emptyTotals, embedding: emptyTotals },
  toolCalls: 0,
  lastActiveAt: 1_700_000_000_000,
}

const makeRequest = (overrides: Partial<BillingRequestRow>): BillingRequestRow => ({
  eventId: 'evt-1',
  occurredAt: 1_700_000_000_000,
  turnId: 'turn-1',
  chatUserId: 'user-A',
  model: 'gpt-5',
  modelRole: 'main',
  inputTokens: 100,
  outputTokens: 200,
  stepCount: 1,
  toolCallCount: 0,
  messageCount: 3,
  durationMs: 1234,
  finishReason: 'stop',
  error: null,
  ...overrides,
})

const emptyRecentRequests = { subjectId: 'user-A', limit: 25, requests: [] }

beforeEach(() => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify(emptyRecentRequests), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

afterEach(() => {
  restoreFetch()
})

const render = (detail: BillingDetail): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(SubjectDetail, { target, props: { detail } })
  return { target, component }
}

describe('admin SubjectDetail', () => {
  test('shows placeholder when there are no requests', () => {
    const { target, component } = render({ subject, requests: [], truncated: false })
    expect(target.textContent).toContain('No requests')
    void unmount(component)
  })

  test('renders one row per request', () => {
    const detail: BillingDetail = {
      subject,
      requests: [makeRequest({}), makeRequest({ eventId: 'evt-2', modelRole: 'small' })],
      truncated: false,
    }
    const { target, component } = render(detail)
    const rows = target.querySelectorAll('[data-testid="request-row"]')
    expect(rows).toHaveLength(2)
    void unmount(component)
  })

  test('clicking a row toggles a JSON detail block', () => {
    const detail: BillingDetail = { subject, requests: [makeRequest({})], truncated: false }
    const { target, component } = render(detail)
    const row = target.querySelector<HTMLElement>('[data-testid="request-row"]')
    expect(row).not.toBeNull()
    row!.click()
    flushSync()
    expect(target.querySelectorAll('[data-testid="request-json"]')).toHaveLength(1)
    void unmount(component)
  })
})
