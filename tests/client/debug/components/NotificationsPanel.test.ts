// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import NotificationsPanel from '../../../../client/debug/components/NotificationsPanel.svelte'
import type { Notification } from '../../../../client/debug/dashboard-types.js'

function freshState(notifications: Notification[] = []): { notifications: Notification[]; scopeFilter: 'all' } {
  return { notifications, scopeFilter: 'all' as const }
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    timestamp: 1700000000000,
    type: 'proactive_suggestion',
    scope: { kind: 'user', userId: 'u1' },
    data: { text: 'Hello world' },
    ...overrides,
  }
}

describe('NotificationsPanel', () => {
  test('renders within a Panel and shows EmptyState when there are no notifications', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dashboard = { notifications: [], scopeFilter: 'all' as const }
    const c = mount(NotificationsPanel, { target, props: { dashboard } })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).not.toBeNull()
    void unmount(c)
  })

  test('renders notification rows when notifications exist', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const n = makeNotification({ type: 'reply:sent', data: { text: 'Hello!' } })
    const dashboard = freshState([n])
    const c = mount(NotificationsPanel, { target, props: { dashboard } })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).toBeNull()
    expect(target.querySelector('.notification-row')).not.toBeNull()
    expect(target.textContent).toContain('reply:sent')
    expect(target.textContent).toContain('Hello!')
    void unmount(c)
  })

  test('renders JsonCell for non-reply notifications with data', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const n = makeNotification({ type: 'proactive_suggestion', data: { key: 'value' } })
    const dashboard = freshState([n])
    const c = mount(NotificationsPanel, { target, props: { dashboard } })
    expect(target.querySelector('.ui-jsoncell')).not.toBeNull()
    void unmount(c)
  })

  test('filters notifications by scope', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dmNotification = makeNotification({ scope: { kind: 'user', userId: 'u1' } })
    const groupNotification = makeNotification({ scope: { kind: 'group', groupId: 'g1' } })
    const dashboard = { notifications: [dmNotification, groupNotification], scopeFilter: 'dm' as const }
    const c = mount(NotificationsPanel, { target, props: { dashboard } })
    const rows = target.querySelectorAll('.notification-row')
    expect(rows.length).toBe(1)
    void unmount(c)
  })

  test('does not show text span for typing:start notifications', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const n = makeNotification({ type: 'typing:start', data: {} })
    const dashboard = freshState([n])
    const c = mount(NotificationsPanel, { target, props: { dashboard } })
    expect(target.querySelector('.notification-text')).toBeNull()
    expect(target.querySelector('.ui-jsoncell')).toBeNull()
    void unmount(c)
  })
})
