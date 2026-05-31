// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync } from 'svelte'

import { readCodeFromLocation, start, stripCodeFromUrl } from '../../../client/settings/index.js'
import { settingsSession } from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const bootstrapPayload = {
  csrfToken: 't',
  display: 'a',
  principal: { isBotAdmin: false, isSuperAdmin: false },
  contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  flushSync()
}

function installRoutedFetch(): void {
  setMockFetch((url) => {
    if (url.includes('/settings/auth/exchange') || url.includes('/settings/api/bootstrap')) {
      return Promise.resolve(json(bootstrapPayload))
    }
    if (url.includes('/settings/api/config')) {
      return Promise.resolve(json({ contextId: 'user:1', fields: [] }))
    }
    return Promise.resolve(json(bootstrapPayload))
  })
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  history.replaceState(null, '', '/settings')
})

describe('settings entry', () => {
  test('readCodeFromLocation extracts a non-empty code', () => {
    expect(readCodeFromLocation('?code=ABC')).toBe('ABC')
    expect(readCodeFromLocation('?code=')).toBeNull()
    expect(readCodeFromLocation('')).toBeNull()
  })

  test('stripCodeFromUrl removes the code param', () => {
    history.replaceState(null, '', '/settings?code=ABC&x=1')
    stripCodeFromUrl()
    expect(window.location.search).not.toContain('code=')
    expect(window.location.search).toContain('x=1')
  })

  test('start bootstraps and mounts the app into the target', async () => {
    installRoutedFetch()
    history.replaceState(null, '', '/settings?code=ABC')
    document.body.innerHTML = '<div id="app"></div>'
    const target = document.querySelector<HTMLElement>('#app')!
    await start(target)
    await drain()
    expect(settingsSession.status).toBe('ready')
    expect(window.location.search).not.toContain('code=')
    expect(document.querySelector('#profile')).not.toBeNull()
  })

  test('start with a failing code lands on the gate and strips the code', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'invalid or expired code' }, 401)))
    history.replaceState(null, '', '/settings?code=BAD')
    document.body.innerHTML = '<div id="app"></div>'
    const target = document.querySelector<HTMLElement>('#app')!
    await start(target)
    await drain()
    expect(settingsSession.status).toBe('unauthenticated')
    expect(window.location.search).not.toContain('code=')
    expect(document.body.textContent).toContain('/config')
  })
})
