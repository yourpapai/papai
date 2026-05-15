import { describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import { isVisibleToAdmin, type AdminVisibility } from '../../src/debug/state-collector.js'

describe('isVisibleToAdmin', () => {
  const vis: AdminVisibility = {
    adminUserId: 'admin-1',
    groupIds: new Set(['group-a', 'group-b']),
  }

  test('global events are visible', () => {
    const scope: Scope = { kind: 'global' }
    expect(isVisibleToAdmin(scope, vis)).toBe(true)
  })

  test('user events for admin are visible', () => {
    const scope: Scope = { kind: 'user', userId: 'admin-1' }
    expect(isVisibleToAdmin(scope, vis)).toBe(true)
  })

  test('user events for non-admin are NOT visible', () => {
    const scope: Scope = { kind: 'user', userId: 'other-user' }
    expect(isVisibleToAdmin(scope, vis)).toBe(false)
  })

  test('group events for admin-member groups are visible', () => {
    const scope: Scope = { kind: 'group', groupId: 'group-a' }
    expect(isVisibleToAdmin(scope, vis)).toBe(true)
  })

  test('group events for non-member groups are NOT visible', () => {
    const scope: Scope = { kind: 'group', groupId: 'group-z' }
    expect(isVisibleToAdmin(scope, vis)).toBe(false)
  })

  test('unscoped events are denied (default-deny)', () => {
    expect(isVisibleToAdmin(undefined as unknown as Scope, vis)).toBe(false)
    expect(isVisibleToAdmin(null as unknown as Scope, vis)).toBe(false)
  })
})
