import { describe, expect, test } from 'bun:test'

import type { Scope } from '../../src/debug/event-bus.js'
import { applyVisibility, isVisibleToAdmin, type AdminVisibility } from '../../src/debug/state-collector.js'

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
    expect(isVisibleToAdmin(undefined, vis)).toBe(false)
    expect(isVisibleToAdmin(null, vis)).toBe(false)
  })
})

describe('applyVisibility', () => {
  type Entry = { userId: string; name: string } | { groupId: string; name: string }

  const toScope = (e: Entry): Scope => {
    if ('groupId' in e) return { kind: 'group', groupId: e.groupId }
    return { kind: 'user', userId: e.userId }
  }

  test('filters entries by scope', () => {
    const entries: Entry[] = [
      { userId: 'admin-1', name: 'a' },
      { userId: 'other', name: 'b' },
      { groupId: 'group-a', name: 'c' },
    ]
    const vis: AdminVisibility = { adminUserId: 'admin-1', groupIds: new Set(['group-a']) }
    const filtered = applyVisibility(entries, toScope, vis)
    expect(filtered).toHaveLength(2)
    expect(filtered[0]!.name).toBe('a')
    expect(filtered[1]!.name).toBe('c')
  })

  test('returns empty array when no entries match', () => {
    const entries: Entry[] = [{ userId: 'other', name: 'x' }]
    const vis: AdminVisibility = { adminUserId: 'admin-1', groupIds: new Set() }
    const filtered = applyVisibility(entries, toScope, vis)
    expect(filtered).toHaveLength(0)
  })
})
