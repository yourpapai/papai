// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { adminGlobals, refreshGlobals } from '../../../client/admin/global-stats.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const responseBody = {
  generatedAt: 1_700_000_000_000,
  window: '30d',
  subjects: {
    dmTotal: 18,
    groupTotal: 14,
    growthLast30d: [
      { date: '2026-04-22', dmAdded: 1, groupAdded: 0 },
      { date: '2026-04-23', dmAdded: 0, groupAdded: 2 },
    ],
  },
  active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
  storage: { sqliteBytes: 12_345_678, s3AttachmentBytes: 9_876_543 },
  surfaceMix: {
    subjectsWithRecurring: 6,
    subjectsWithDeferred: 4,
    subjectsWithMemos: 12,
    subjectsWithInstructions: 2,
  },
  toolMix: {
    topTools: [
      { toolName: 'create_task', count: 412, successRate: 0.97 },
      { toolName: 'search_tasks', count: 308, successRate: 0.94 },
    ],
    errorTypeCounts: { schema_validation: 3, provider_4xx: 7 },
  },
}

describe('global-stats', () => {
  beforeEach(() => {
    adminGlobals.window = '30d'
    adminGlobals.loading = false
    adminGlobals.data = null
    adminGlobals.fetchedAt = null
  })

  afterEach(() => {
    restoreFetch()
  })

  test('refreshGlobals writes nested data and fetchedAt on success', async () => {
    setMockFetch((url) => {
      expect(url).toContain('/stats/global')
      expect(url).toContain('window=30d')
      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    await refreshGlobals()
    expect(adminGlobals.data).not.toBeNull()
    expect(adminGlobals.data?.subjects?.dmTotal).toBe(18)
    expect(adminGlobals.data?.subjects?.groupTotal).toBe(14)
    expect(adminGlobals.data?.toolMix?.topTools[0]?.toolName).toBe('create_task')
    expect(adminGlobals.fetchedAt).not.toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })

  test('refreshGlobals leaves data null on http error', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    await refreshGlobals()
    expect(adminGlobals.data).toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })

  test('refreshGlobals sends window=1d when adminGlobals.window is 1d', async () => {
    adminGlobals.window = '1d'
    setMockFetch((url) => {
      expect(url).toContain('window=1d')
      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    await refreshGlobals()
    expect(adminGlobals.data).not.toBeNull()
  })
})
