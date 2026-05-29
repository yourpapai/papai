// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsTopBar from '../../../../client/settings/components/SettingsTopBar.svelte'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const seed = (): void => {
  settingsSession.status = 'ready'
  settingsSession.display = 'alice'
  settingsSession.contexts = [
    { kind: 'personal', contextId: 'user:1', label: 'Personal' },
    { kind: 'group', contextId: 'group:7', label: 'Team' },
  ]
  settingsSession.activeContextId = 'user:1'
}

const render = (): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsTopBar, { target }), target }
}

afterEach(() => {
  restoreFetch()
})

describe('SettingsTopBar', () => {
  test('renders one option per context and the display name', () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed()
    const { component, target } = render()
    flushSync()
    expect(target.textContent).toContain('alice')
    expect(target.querySelectorAll('option')).toHaveLength(2)
    void unmount(component)
  })

  test('changing the switcher updates the active context', () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed()
    const { component, target } = render()
    flushSync()
    const select = target.querySelector<HTMLSelectElement>('select')!
    select.value = 'group:7'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(settingsSession.activeContextId).toBe('group:7')
    void unmount(component)
  })

  test('sign out posts to the logout endpoint', async () => {
    const calls: string[] = []
    const recordUrl = (url: string): void => {
      calls.push(url)
    }
    setMockFetch((url: string) => {
      recordUrl(url)
      return Promise.resolve(new Response('{}'))
    })
    seed()
    const { component, target } = render()
    flushSync()
    const signOutBtn = Array.from(target.querySelectorAll('button')).find(
      (btn) => btn.textContent?.trim() === 'sign out',
    )!
    signOutBtn.click()
    await Promise.resolve()
    flushSync()
    expect(calls.some((u) => u.includes('/settings/auth/logout'))).toBe(true)
    void unmount(component)
  })
})
