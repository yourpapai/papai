// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { ensureAuthenticated } from '../../../client/admin/auth.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

afterEach(() => {
  restoreFetch()
})

describe('ensureAuthenticated', () => {
  test('returns { authenticated: true, adminUserId } on 200', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ adminUserId: 'u1', expiresAt: 9999 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const result = await ensureAuthenticated()
    expect(result).toEqual({ authenticated: true, adminUserId: 'u1' })
  })

  test('returns { authenticated: false } on 401', async () => {
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({}), { status: 401 })))
    const result = await ensureAuthenticated()
    expect(result.authenticated).toBe(false)
  })
})
