// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { readCodeFromLocation, start, stripCodeFromUrl } from '../../../client/settings/index.js'
import { settingsSession } from '../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
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
    setMockFetch(() =>
      Promise.resolve(
        json({
          csrfToken: 't',
          display: 'a',
          principal: { isBotAdmin: false, isSuperAdmin: false },
          contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
        }),
      ),
    )
    history.replaceState(null, '', '/settings?code=ABC')
    document.body.innerHTML = '<div id="app"></div>'
    const target = document.querySelector<HTMLElement>('#app')!
    await start(target)
    await drain()
    expect(settingsSession.status).toBe('ready')
    expect(window.location.search).not.toContain('code=')
    expect(document.querySelector('#profile')).not.toBeNull()
  })
})
