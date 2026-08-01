// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  errorFieldFrom,
  errorMessageFrom,
  FetchError,
  readBody,
  requireOk,
} from '../../../client/shared/fetcher-helpers.js'

function assertIsFetchError(err: unknown): asserts err is FetchError {
  if (!(err instanceof FetchError)) throw err
}

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

  test('requireOk throws a FetchError carrying the HTTP status', () => {
    const res = new Response(null, { status: 404 })
    try {
      requireOk(res, { error: 'missing' })
      throw new Error('expected requireOk to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(FetchError)
      assertIsFetchError(err)
      expect(err.status).toBe(404)
      expect(err.message).toBe('missing')
    }
  })

  test('requireOk FetchError falls back to a status message when no body error', () => {
    const res = new Response(null, { status: 503 })
    try {
      requireOk(res, null)
      throw new Error('expected requireOk to throw')
    } catch (err) {
      assertIsFetchError(err)
      expect(err.status).toBe(503)
      expect(err.message).toBe('request failed with status 503')
    }
  })

  test('errorFieldFrom extracts the field key when present', () => {
    expect(errorFieldFrom({ error: 'unsupported code host', field: 'kind' })).toBe('kind')
  })

  test('errorFieldFrom yields undefined when the body carries no field', () => {
    expect(errorFieldFrom({ error: 'incompatible agent/provider' })).toBeUndefined()
    expect(errorFieldFrom(null)).toBeUndefined()
  })

  test('requireOk throws a FetchError carrying the field key', () => {
    const res = new Response(null, { status: 422 })
    try {
      requireOk(res, { error: 'unsupported code host', field: 'kind' })
      throw new Error('expected requireOk to throw')
    } catch (err) {
      assertIsFetchError(err)
      expect(err.status).toBe(422)
      expect(err.message).toBe('unsupported code host')
      expect(err.field).toBe('kind')
    }
  })

  test('requireOk leaves field undefined for an unattributed error', () => {
    const res = new Response(null, { status: 422 })
    try {
      requireOk(res, { error: 'incompatible agent/provider' })
      throw new Error('expected requireOk to throw')
    } catch (err) {
      assertIsFetchError(err)
      expect(err.field).toBeUndefined()
    }
  })
})
