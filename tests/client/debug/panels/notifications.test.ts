// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { describe, expect, test } from 'bun:test'

import { renderNotifications } from '../../../../client/debug/panels/notifications.js'
import type { Notification } from '../../../../src/debug/schemas.js'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    timestamp: 1700000000000,
    type: 'reply:sent',
    scope: { kind: 'user', userId: 'u1' },
    data: {},
    ...overrides,
  }
}

describe('renderNotifications', () => {
  test('returns placeholder when notifications array is empty', () => {
    const html = renderNotifications([], 'all')
    expect(html).toContain('placeholder')
    expect(html).toContain('No notifications')
  })

  test('renders a reply:sent notification', () => {
    const n = makeNotification({ type: 'reply:sent', data: { text: 'Hello world' } })
    const html = renderNotifications([n], 'all')
    expect(html).toContain('notification-row')
    expect(html).toContain('reply:sent')
    expect(html).toContain('Hello world')
  })

  test('renders a typing:start notification', () => {
    const n = makeNotification({ type: 'typing:start' })
    const html = renderNotifications([n], 'all')
    expect(html).toContain('typing:start')
  })

  test('renders a typing:stop notification', () => {
    const n = makeNotification({ type: 'typing:stop' })
    const html = renderNotifications([n], 'all')
    expect(html).toContain('typing:stop')
  })

  test('renders a notify:scheduler_fired notification', () => {
    const n = makeNotification({ type: 'notify:scheduler_fired', data: { taskId: 't1' } })
    const html = renderNotifications([n], 'all')
    expect(html).toContain('notify:scheduler_fired')
  })

  test('renders timestamp', () => {
    const n = makeNotification({ timestamp: 1700000000000 })
    const html = renderNotifications([n], 'all')
    expect(html).toContain('notification-time')
  })

  test('filters by context when activeContext is not all', () => {
    const n1 = makeNotification({ type: 'reply:sent', scope: { kind: 'user', userId: 'u1' } })
    const n2 = makeNotification({ type: 'typing:start', scope: { kind: 'group', groupId: 'g1' } })
    const html = renderNotifications([n1, n2], 'dm')
    expect(html).toContain('reply:sent')
    expect(html).not.toContain('typing:start')
  })

  test('truncates long reply text', () => {
    const longText = 'a'.repeat(200)
    const n = makeNotification({ type: 'reply:sent', data: { text: longText } })
    const html = renderNotifications([n], 'all')
    expect(html.length).toBeLessThan(longText.length + 500)
    expect(html).toContain('...')
  })

  test('escapes HTML in notification data', () => {
    const n = makeNotification({ type: 'reply:sent', data: { text: '<script>alert(1)</script>' } })
    const html = renderNotifications([n], 'all')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
