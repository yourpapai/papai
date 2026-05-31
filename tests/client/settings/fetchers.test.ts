// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  exchangeCode,
  fetchConfig,
  onUnauthorized,
  patchConfig,
  setCsrfToken,
} from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const bodyString = (init: RequestInit): string => JSON.stringify(parseBody(init.body))
const csrfHeader = (init: RequestInit): string => new Headers(init.headers).get('X-Settings-CSRF') ?? ''

describe('fetchers', () => {
  test('exchangeCode posts the code and returns the bootstrap payload', async () => {
    let seenBody = ''
    setMockFetch((_url, init) => {
      seenBody = bodyString(init)
      return Promise.resolve(
        json({ csrfToken: 't', display: 'a', principal: { isBotAdmin: false, isSuperAdmin: false }, contexts: [] }),
      )
    })
    const data = await exchangeCode('CODE123')
    expect(seenBody).toBe(JSON.stringify({ code: 'CODE123' }))
    expect(data.csrfToken).toBe('t')
  })

  test('writes attach the CSRF header from the stored token', async () => {
    setCsrfToken('csrf-xyz')
    let header = ''
    setMockFetch((_url, init) => {
      header = csrfHeader(init)
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    await patchConfig({ key: 'timezone', value: 'UTC', contextId: 'user:1' })
    expect(header).toBe('csrf-xyz')
  })

  test('GET passes contextId in the query string', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(json({ contextId: 'g:1', fields: [] }))
    })
    await fetchConfig('g:1')
    expect(seenUrl).toContain('contextId=g%3A1')
  })

  test('a 401 fires registered unauthorized handlers', async () => {
    let fired = false
    const off = onUnauthorized(() => {
      fired = true
    })
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await expect(fetchConfig('user:1')).rejects.toThrow()
    expect(fired).toBe(true)
    off()
  })
})
