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

  test('readBody handles non-json input safely', async () => {
    const res = new Response('not a json string')
    expect(await readBody(res)).toBeNull()
  })

  test('requireOk does not throw on ok response', () => {
    const res = new Response(null, { status: 200 })
    expect(() => requireOk(res, null)).not.toThrow()
  })

  test('requireOk throws on non-ok (5xx)', () => {
    const res = new Response(null, { status: 500 })
    expect(() => requireOk(res, { error: 'server error' })).toThrow('server error')
  })

  test('requireOk throws on non-ok (4xx)', () => {
    const res = new Response(null, { status: 400 })
    expect(() => requireOk(res, { error: 'bad request' })).toThrow('bad request')
  })
})
