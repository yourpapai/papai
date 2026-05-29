// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import {
  activeContext,
  bootstrapSession,
  registerExpiryHandler,
  setActiveContext,
  settingsSession,
} from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const bootstrapPayload = {
  csrfToken: 'tok',
  display: 'alice',
  principal: { isBotAdmin: true, isSuperAdmin: false },
  contexts: [
    { kind: 'personal', contextId: 'user:1', label: 'Personal' },
    { kind: 'group', contextId: 'group:7', label: 'Team' },
  ],
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.display = ''
  setCsrfToken('')
})

describe('session store', () => {
  test('bootstrapSession with no code calls bootstrap and populates state', async () => {
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('ready')
    expect(settingsSession.isBotAdmin).toBe(true)
    expect(settingsSession.activeContextId).toBe('user:1')
    expect(activeContext()?.kind).toBe('personal')
  })

  test('bootstrapSession with a code calls exchange', async () => {
    let calledUrl = ''
    setMockFetch((url) => {
      calledUrl = url
      return Promise.resolve(json(bootstrapPayload))
    })
    await bootstrapSession('CODE')
    expect(calledUrl).toContain('/settings/auth/exchange')
    expect(settingsSession.status).toBe('ready')
  })

  test('setActiveContext only accepts known contexts', async () => {
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    setActiveContext('group:7')
    expect(settingsSession.activeContextId).toBe('group:7')
    setActiveContext('unknown')
    expect(settingsSession.activeContextId).toBe('group:7')
  })

  test('a failed bootstrap marks the session unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('unauthenticated')
  })

  test('a failed exchange (non-empty code + 401) marks the session unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'invalid or expired code' }, 401)))
    await bootstrapSession('SOMECODE')
    expect(settingsSession.status).toBe('unauthenticated')
  })

  test('registerExpiryHandler flips status on a later 401', async () => {
    registerExpiryHandler()
    setMockFetch(() => Promise.resolve(json(bootstrapPayload)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('ready')
    // Trigger a 401 through the shared fetch layer.
    const { fetchConfig } = await import('../../../client/settings/fetchers.js')
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await fetchConfig('user:1').catch(() => undefined)
    expect(settingsSession.status).toBe('unauthenticated')
  })
})
