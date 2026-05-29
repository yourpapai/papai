// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { settingsSession } from '../../../client/settings/session.svelte.js'
import SettingsApp from '../../../client/settings/SettingsApp.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  flushSync()
}

const mountApp = (): ReturnType<typeof mount> => {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/settings')
  const target = document.querySelector<HTMLElement>('#root')!
  return mount(SettingsApp, { target })
}

const seed = (overrides: Partial<typeof settingsSession>): void => {
  settingsSession.status = 'ready'
  settingsSession.display = 'alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }]
  settingsSession.activeContextId = 'user:1'
  Object.assign(settingsSession, overrides)
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
})

describe('SettingsApp', () => {
  test('renders the gate message when unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    settingsSession.status = 'unauthenticated'
    const component = mountApp()
    await drain()
    expect(document.body.textContent).toContain('/config')
    expect(document.querySelector('#profile')).toBeNull()
    void unmount(component)
  })

  test('renders the always-on user sections for a personal context', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({})
    const component = mountApp()
    await drain()
    for (const id of ['profile', 'task-provider', 'tools', 'mcp', 'plugins', 'identity']) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }
    expect(document.querySelector('#members')).toBeNull()
    expect(document.querySelector('#instances')).toBeNull()
    void unmount(component)
  })

  test('shows group sections when the active context is a group', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({
      contexts: [
        { kind: 'personal', contextId: 'user:1', label: 'Personal' },
        { kind: 'group', contextId: 'group:7', label: 'Team' },
      ],
      activeContextId: 'group:7',
    })
    const component = mountApp()
    await drain()
    expect(document.querySelector('#members')).not.toBeNull()
    expect(document.querySelector('#group-provider')).not.toBeNull()
    void unmount(component)
  })

  test('shows admin sections for a bot admin and SA-only sections for a super admin', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    const component = mountApp()
    await drain()
    for (const id of ['instances', 'system', 'users', 'groups', 'announce', 'admins', 'plugin-approval']) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }
    void unmount(component)
  })

  test('hides SA-only sections for a non-super bot admin', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: false })
    const component = mountApp()
    await drain()
    expect(document.querySelector('#instances')).not.toBeNull()
    expect(document.querySelector('#admins')).toBeNull()
    expect(document.querySelector('#plugin-approval')).toBeNull()
    void unmount(component)
  })
})
