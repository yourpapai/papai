// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { errorMessageFrom, readBody, requireOk } from '../../../client/shared/fetcher-helpers.js'

describe('fetcher-helpers', () => {
  test('errorMessageFrom extracts error string', () => {
    expect(errorMessageFrom({ error: 'failed' }, 'fallback')).toBe('failed')
    expect(errorMessageFrom({}, 'fallback')).toBe('fallback')
  })

  test('readBody extracts json', async () => {
    const res = new Response(JSON.stringify({ ok: true }))
    expect(await readBody(res)).toEqual({ ok: true })
  })

  test('requireOk throws on non-ok', () => {
    const res = new Response(null, { status: 500 })
    expect(() => requireOk(res, { error: 'server error' })).toThrow('server error')
  })
})
