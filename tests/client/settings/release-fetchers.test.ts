// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import {
  fetchGroupReleaseSubscription,
  fetchReleaseSubscription,
  patchGroupReleaseSubscription,
  patchReleaseSubscription,
} from '../../../client/settings/release-fetchers.js'
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
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('release-fetchers', () => {
  test('fetchReleaseSubscription GETs and returns parsed { enabled }', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(json({ enabled: true }))
    })
    const result = await fetchReleaseSubscription()
    expect(seenUrl).toBe('/settings/api/release-subscription')
    expect(result.enabled).toBe(true)
  })

  test('patchReleaseSubscription PATCHes with CSRF header and body', async () => {
    setCsrfToken('csrf-rs')
    let seenUrl = ''
    let seenMethod = ''
    let seenBody = ''
    let seenCsrf = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      seenBody = bodyString(init)
      seenCsrf = csrfHeader(init)
      return Promise.resolve(json({ ok: true }))
    })
    await patchReleaseSubscription({ enabled: false })
    expect(seenUrl).toBe('/settings/api/release-subscription')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toBe(JSON.stringify({ enabled: false }))
    expect(seenCsrf).toBe('csrf-rs')
  })

  test('fetchGroupReleaseSubscription GETs with contextId in query', async () => {
    let seenUrl = ''
    setMockFetch((url) => {
      seenUrl = url
      return Promise.resolve(json({ contextId: 'g:1', enabled: false }))
    })
    const result = await fetchGroupReleaseSubscription('g:1')
    expect(seenUrl).toContain('/settings/api/group/release-subscription')
    expect(seenUrl).toContain('contextId=g%3A1')
    expect(result.contextId).toBe('g:1')
    expect(result.enabled).toBe(false)
  })

  test('patchGroupReleaseSubscription PATCHes with body and CSRF header', async () => {
    setCsrfToken('csrf-grs')
    let seenMethod = ''
    let seenBody = ''
    let seenCsrf = ''
    setMockFetch((_url, init) => {
      seenMethod = methodOf(init)
      seenBody = bodyString(init)
      seenCsrf = csrfHeader(init)
      return Promise.resolve(json({ ok: true }))
    })
    await patchGroupReleaseSubscription({ enabled: true, contextId: 'g:1' })
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toBe(JSON.stringify({ enabled: true, contextId: 'g:1' }))
    expect(seenCsrf).toBe('csrf-grs')
  })
})
