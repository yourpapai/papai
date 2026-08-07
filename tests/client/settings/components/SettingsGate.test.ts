// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsGate from '../../../../client/settings/components/SettingsGate.svelte'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const mountGate = (): ReturnType<typeof mount> => {
  document.body.innerHTML = '<div id="root"></div>'
  return mount(SettingsGate, { target: document.querySelector<HTMLElement>('#root')! })
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  settingsSession.failureMessage = ''
  document.body.innerHTML = ''
})

describe('SettingsGate', () => {
  test('announces the loading wait to assistive tech', () => {
    settingsSession.status = 'loading'
    const c = mountGate()
    flushSync()
    const status = document.querySelector('[data-testid="gate-loading"]')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Loading')
    void unmount(c)
  })

  test('unauthenticated points at /config and offers no retry', () => {
    settingsSession.status = 'unauthenticated'
    const c = mountGate()
    flushSync()
    expect(document.body.textContent).toContain('/config')
    expect(document.querySelector('[data-testid="gate-retry"]')).toBeNull()
    void unmount(c)
  })

  test('failed shows the reason and a retry action', () => {
    settingsSession.status = 'failed'
    settingsSession.failureMessage = 'database unavailable'
    const c = mountGate()
    flushSync()
    expect(document.body.textContent).toContain('database unavailable')
    expect(document.querySelector('[data-testid="gate-retry"]')).not.toBeNull()
    void unmount(c)
  })

  test('retry re-runs the bootstrap and reaches ready', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            csrfToken: 't',
            display: 'a',
            principal: { isBotAdmin: false, isSuperAdmin: false },
            contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    settingsSession.status = 'failed'
    settingsSession.failureMessage = 'boom'
    const c = mountGate()
    flushSync()
    document.querySelector<HTMLButtonElement>('[data-testid="gate-retry"]')!.click()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    flushSync()
    expect(settingsSession.status as string).toBe('ready')
    void unmount(c)
  })

  test('every gate state carries the brand chrome', () => {
    for (const status of ['loading', 'unauthenticated', 'failed'] as const) {
      settingsSession.status = status
      const c = mountGate()
      flushSync()
      expect(document.querySelector('.settings-gate__brand')).not.toBeNull()
      void unmount(c)
    }
  })
})
