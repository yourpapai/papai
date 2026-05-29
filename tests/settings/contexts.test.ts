// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { KnownGroupContext } from '../../src/group-settings/types.js'
import { listAvailableContexts } from '../../src/settings/contexts.js'
import type { SettingsPrincipal } from '../../src/settings/principal.js'

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

describe('listAvailableContexts', () => {
  test('authorized user gets a personal context first, then groups', () => {
    expect(listAvailableContexts(principal({ manageableGroups: [group] }))).toEqual([
      { kind: 'personal', contextId: 'personal-ctx-1', label: 'Personal' },
      { kind: 'group', contextId: 'group-ctx-1', label: 'Team' },
    ])
  })

  test('unauthorized user gets only managed groups', () => {
    expect(listAvailableContexts(principal({ authorized: false, manageableGroups: [group] }))).toEqual([
      { kind: 'group', contextId: 'group-ctx-1', label: 'Team' },
    ])
  })
})
