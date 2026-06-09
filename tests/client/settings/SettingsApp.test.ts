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
  settingsSession.display = ''
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
})

describe('SettingsApp', () => {
  test('renders the loading gate when status is loading', async () => {
    settingsSession.status = 'loading'
    const component = mountApp()
    await drain()
    expect(document.body.textContent).toContain('Loading…')
    expect(document.querySelector('#profile')).toBeNull()
    void unmount(component)
  })

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
    for (const id of ['profile', 'task-provider', 'tools', 'ai-output', 'byok', 'mcp', 'plugins', 'identity']) {
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
    for (const id of [
      'instances',
      'system',
      'byok-admin',
      'plugin-config',
      'users',
      'groups',
      'announce',
      'admins',
      'plugin-approval',
    ]) {
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
    expect(document.querySelector('#byok-admin')).not.toBeNull()
    expect(document.querySelector('#plugin-config')).not.toBeNull()
    expect(document.querySelector('#admins')).toBeNull()
    expect(document.querySelector('#plugin-approval')).toBeNull()
    void unmount(component)
  })

  test('renders three group kickers for an admin session', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    const component = mountApp()
    await drain()
    const sidebar = document.querySelector<HTMLElement>('.settings-sidebar')!
    const kickers = Array.from(sidebar.querySelectorAll<HTMLElement>('.settings-sidebar__kicker'))
    expect(kickers).toHaveLength(3)
    expect(kickers[0]!.textContent).toContain('Personal')
    expect(kickers[1]!.textContent).toContain('Integrations')
    expect(kickers[2]!.textContent).toContain('Admin')
    void unmount(component)
  })

  test('non-admin session omits the Admin group', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: false, isSuperAdmin: false })
    const component = mountApp()
    await drain()
    const sidebar = document.querySelector<HTMLElement>('.settings-sidebar')!
    const kickers = Array.from(sidebar.querySelectorAll<HTMLElement>('.settings-sidebar__kicker'))
    expect(kickers).toHaveLength(2)
    expect(kickers[0]!.textContent).toContain('Personal')
    expect(kickers[1]!.textContent).toContain('Integrations')
    void unmount(component)
  })

  test('personal and integrations sections carry group eyebrows in their headers', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: false, isSuperAdmin: false })
    const component = mountApp()
    await drain()
    const target = document.querySelector<HTMLElement>('#root')!
    const eyebrowText = Array.from(target.querySelectorAll('.ui-page-header .ui-caption'))
      .map((e) => e.textContent)
      .join(' ')
    expect(eyebrowText).toContain('Personal')
    expect(eyebrowText).toContain('Integrations')
    void unmount(component)
  })
})
