// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { adminGlobals, refreshGlobals } from '../../../client/admin/global-stats.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

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

  test('refreshGlobals writes data and fetchedAt on success', async () => {
    setMockFetch((url) => {
      expect(url).toContain('/stats/global')
      expect(url).toContain('window=30d')
      return Promise.resolve(
        new Response(JSON.stringify({ subjects: 0, llmCalls: 0, toolCalls: 0, tokens: 0 }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    await refreshGlobals()
    expect(adminGlobals.data).not.toBeNull()
    expect(adminGlobals.fetchedAt).not.toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })

  test('refreshGlobals leaves data null on http error', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    await refreshGlobals()
    expect(adminGlobals.data).toBeNull()
    expect(adminGlobals.loading).toBe(false)
  })
})
