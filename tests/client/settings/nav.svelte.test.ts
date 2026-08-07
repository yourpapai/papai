// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  allSectionIds,
  buildNavGroups,
  expandGroupOwning,
  groupHint,
  isGroupCollapsed,
  isNavGroupKey,
  mountedSectionIds,
  toggleGroup,
} from '../../../client/settings/nav.svelte.js'
import { resetNavCollapse } from '../../../client/settings/nav.svelte.testing.js'

const personal = { isBotAdmin: false, isSuperAdmin: false }
const botAdmin = { isBotAdmin: true, isSuperAdmin: false }
const superAdmin = { isBotAdmin: true, isSuperAdmin: true }

afterEach(() => {
  resetNavCollapse()
})

describe('buildNavGroups', () => {
  test('a personal non-admin session gets Personal and Advanced only', () => {
    const groups = buildNavGroups(personal, false)
    expect(groups.map((g) => g.key)).toEqual(['personal', 'advanced'])
    expect(groups.map((g) => g.kicker)).toEqual(['Personal', 'Advanced'])
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['profile', 'task-provider', 'tools', 'analytics'])
    expect(groups[0]!.collapsible).toBe(false)
    expect(groups[0]!.danger).toBe(false)
  })

  test('a group context adds the group-only sections to Personal', () => {
    const groups = buildNavGroups(personal, true)
    expect(groups[0]!.items.map((i) => i.id)).toEqual([
      'profile',
      'task-provider',
      'tools',
      'analytics',
      'members',
      'group-provider',
      'guest-mode',
      'coding-identity',
      'kaneo-access',
    ])
  })

  test('Advanced holds the ten integration sections and is collapsible', () => {
    const advanced = buildNavGroups(personal, false).find((g) => g.key === 'advanced')!
    expect(advanced.kicker).toBe('Advanced')
    expect(advanced.collapsible).toBe(true)
    expect(advanced.danger).toBe(false)
    expect(advanced.items.map((i) => i.id)).toEqual([
      'memory',
      'ai-output',
      'identity',
      'byok',
      'coding-credentials',
      'coding-mcp',
      'code-host',
      'repos',
      'mcp',
      'plugins',
    ])
  })

  test('a bot admin gets the 14 bot-admin entries, collapsible and flagged danger', () => {
    const admin = buildNavGroups(botAdmin, false).find((g) => g.key === 'admin')!
    expect(admin.kicker).toBe('Admin')
    expect(admin.collapsible).toBe(true)
    expect(admin.danger).toBe(true)
    expect(admin.items).toHaveLength(14)
    expect(admin.items.map((i) => i.id)).not.toContain('admins')
  })

  test('a super admin gets the two extra entries appended', () => {
    const admin = buildNavGroups(superAdmin, false).find((g) => g.key === 'admin')!
    expect(admin.items).toHaveLength(16)
    expect(admin.items.map((i) => i.id).slice(-2)).toEqual(['admins', 'plugin-approval'])
  })

  test('the renamed admin duplicates no longer collide with their personal twins', () => {
    const groups = buildNavGroups(superAdmin, false)
    const labels = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(new Set(labels).size).toBe(labels.length)
    const admin = groups.find((g) => g.key === 'admin')!
    expect(admin.items.find((i) => i.id === 'analytics-admin')!.label).toBe('Analytics policy')
    expect(admin.items.find((i) => i.id === 'byok-admin')!.label).toBe('BYOK keys')
  })
})

describe('collapse state', () => {
  test('Advanced and Admin both start collapsed; Personal is never collapsed', () => {
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
    expect(isGroupCollapsed('personal')).toBe(false)
  })

  test('toggleGroup flips one group without touching the other', () => {
    toggleGroup('advanced')
    expect(isGroupCollapsed('advanced')).toBe(false)
    expect(isGroupCollapsed('admin')).toBe(true)
    toggleGroup('advanced')
    expect(isGroupCollapsed('advanced')).toBe(true)
  })

  test('resetNavCollapse restores the defaults', () => {
    toggleGroup('advanced')
    toggleGroup('admin')
    resetNavCollapse()
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
  })

  test('isNavGroupKey accepts the three keys and rejects anything else', () => {
    expect(isNavGroupKey('advanced')).toBe(true)
    expect(isNavGroupKey('admin')).toBe(true)
    expect(isNavGroupKey('personal')).toBe(true)
    expect(isNavGroupKey('Advanced')).toBe(false)
    expect(isNavGroupKey('')).toBe(false)
  })
})

describe('expandGroupOwning', () => {
  test('expands whichever collapsed group owns the id', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('memory', groups)).toBe(true)
    expect(isGroupCollapsed('advanced')).toBe(false)
    expect(isGroupCollapsed('admin')).toBe(true)

    expect(expandGroupOwning('instances', groups)).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(false)
  })

  test('an id in an already-open group is a no-op that reports false', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('profile', groups)).toBe(false)
    expect(isGroupCollapsed('advanced')).toBe(true)
  })

  test('an unknown id changes nothing', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('not-a-section', groups)).toBe(false)
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
  })
})

describe('section id derivation', () => {
  test('allSectionIds spans every group regardless of collapse', () => {
    const groups = buildNavGroups(superAdmin, false)
    const ids = allSectionIds(groups)
    expect(ids).toContain('profile')
    expect(ids).toContain('memory')
    expect(ids).toContain('instances')
    expect(ids).toHaveLength(4 + 10 + 16)
  })

  test('mountedSectionIds omits collapsed groups and grows as they expand', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(mountedSectionIds(groups)).toEqual(['profile', 'task-provider', 'tools', 'analytics'])
    toggleGroup('advanced')
    expect(mountedSectionIds(groups)).toContain('memory')
    expect(mountedSectionIds(groups)).not.toContain('instances')
    toggleGroup('admin')
    expect(mountedSectionIds(groups)).toContain('instances')
  })
})

describe('groupHint', () => {
  test('lists the first three labels and counts the rest', () => {
    const advanced = buildNavGroups(personal, false).find((g) => g.key === 'advanced')!
    expect(groupHint(advanced.items)).toBe('Memory, AI output, Identity + 7 more')
  })

  test('three or fewer items get no overflow count', () => {
    expect(
      groupHint([
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]),
    ).toBe('Alpha, Beta')
  })

  test('an empty group yields an empty hint', () => {
    expect(groupHint([])).toBe('')
  })
})
