// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { KnownGroupContext } from '../../src/group-settings/types.js'
import type { SettingsPrincipal } from '../../src/settings/principal.js'
import { requireScope } from '../../src/settings/scope-guard.js'

const group: KnownGroupContext = {
  contextId: 'group-ctx-1',
  provider: 'telegram',
  displayName: 'Team',
  parentName: null,
  firstSeenAt: 't',
  lastSeenAt: 't',
}

function principal(overrides: Partial<SettingsPrincipal>): SettingsPrincipal {
  return {
    platformInstanceId: 'pi-1',
    platformUserId: 'u-1',
    isBotAdmin: false,
    isSuperAdmin: false,
    authorized: true,
    personalConfigContextId: 'personal-ctx-1',
    manageableGroups: [],
    ...overrides,
  }
}

describe('requireScope', () => {
  test('personal: authorized user resolves to own config context', () => {
    const result = requireScope(principal({}), { action: 'write', target: { kind: 'personal' } })
    expect(result).toEqual({ ok: true, contextId: 'personal-ctx-1' })
  })

  test('personal: unauthorized user is denied', () => {
    const result = requireScope(principal({ authorized: false }), { action: 'read', target: { kind: 'personal' } })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('group: denied for a non-managing regular user', () => {
    const result = requireScope(principal({}), { action: 'write', target: { kind: 'group', contextId: 'group-ctx-1' } })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('group: allowed for a managing group admin', () => {
    const result = requireScope(principal({ manageableGroups: [group] }), {
      action: 'write',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: true, contextId: 'group-ctx-1' })
  })

  test('group: bot admin can manage a group that IS in their manageableGroups', () => {
    const result = requireScope(principal({ isBotAdmin: true, manageableGroups: [group] }), {
      action: 'write',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: true, contextId: 'group-ctx-1' })
  })

  test('group: bot admin is denied access to a contextId not in their manageableGroups', () => {
    // Bug: isBotAdmin bypass currently allows this — it must be denied.
    const result = requireScope(principal({ isBotAdmin: true, manageableGroups: [] }), {
      action: 'write',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test("group: bot admin is denied access to another user's personal config context via the group branch", () => {
    // A foreign personal config contextId is not in manageableGroups. The bot-admin bypass
    // must not allow reaching it. This is the core authorization gap being fixed.
    const foreignPersonalCtx = 'personal-ctx-of-another-user'
    const result = requireScope(principal({ isBotAdmin: true, manageableGroups: [] }), {
      action: 'write',
      target: { kind: 'group', contextId: foreignPersonalCtx },
    })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('group: regular user is denied access to a group not in their manageableGroups', () => {
    const result = requireScope(principal({ isBotAdmin: false, manageableGroups: [] }), {
      action: 'read',
      target: { kind: 'group', contextId: 'group-ctx-1' },
    })
    expect(result).toEqual({ ok: false, status: 403 })
  })

  test('admin: denied for a non-admin', () => {
    expect(requireScope(principal({}), { action: 'write', target: { kind: 'admin' } })).toEqual({
      ok: false,
      status: 403,
    })
  })

  test('admin: allowed for a bot admin', () => {
    expect(requireScope(principal({ isBotAdmin: true }), { action: 'write', target: { kind: 'admin' } })).toEqual({
      ok: true,
      contextId: '__system__',
    })
  })

  test('admin: super-admin-only sub-action denies a non-super bot admin', () => {
    expect(
      requireScope(principal({ isBotAdmin: true }), {
        action: 'write',
        target: { kind: 'admin', requireSuperAdmin: true },
      }),
    ).toEqual({ ok: false, status: 403 })
  })

  test('group: the reserved system sentinel is denied even for a bot admin', () => {
    expect(
      requireScope(principal({ isBotAdmin: true }), {
        action: 'write',
        target: { kind: 'group', contextId: '__system__' },
      }),
    ).toEqual({ ok: false, status: 403 })
  })

  test('admin: super-admin-only sub-action allowed for a super admin', () => {
    expect(
      requireScope(principal({ isBotAdmin: true, isSuperAdmin: true }), {
        action: 'write',
        target: { kind: 'admin', requireSuperAdmin: true },
      }),
    ).toEqual({ ok: true, contextId: '__system__' })
  })
})
