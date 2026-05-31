// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { listManageableGroups } from '../../src/group-settings/access.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { addAdmin } from '../../src/instances/admin-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('group settings access', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
  })

  test('lists only groups where the user is a known admin', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertKnownGroupContext({
      contextId: 'group-2',
      provider: 'telegram',
      displayName: 'Security',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-2',
      userId: 'user-1',
      username: 'alice',
      isAdmin: false,
    })
    addAuthorizedGroup('group-1', 'admin-1')
    addAuthorizedGroup('group-2', 'admin-1')

    expect(listManageableGroups('user-1').map((group) => group.contextId)).toEqual(['group-1'])
  })

  test('does not list observed admin groups that are no longer allowlisted', () => {
    upsertKnownGroupContext({
      contextId: 'group-1',
      provider: 'telegram',
      displayName: 'Operations',
      parentName: 'Platform',
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'group-1',
      userId: 'user-1',
      username: 'alice',
      isAdmin: true,
    })

    expect(listManageableGroups('user-1')).toEqual([])
  })

  test('scopes manageable groups by platform instance when native user ids collide', () => {
    const telegramGroupId = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: 'group-1' })
    const discordGroupId = toScopedContextId({ platformInstanceId: 'discord-main', nativeContextId: 'group-2' })
    upsertKnownGroupContext({
      contextId: telegramGroupId,
      provider: 'telegram',
      displayName: 'Telegram Ops',
      parentName: null,
    })
    upsertKnownGroupContext({
      contextId: discordGroupId,
      provider: 'discord',
      displayName: 'Discord Ops',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: telegramGroupId,
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })
    upsertGroupAdminObservation({
      provider: 'discord',
      contextId: discordGroupId,
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })
    addAuthorizedGroup(telegramGroupId, 'admin-1')
    addAuthorizedGroup(discordGroupId, 'admin-1')

    expect(listManageableGroups('same-native-user', 'telegram-main').map((group) => group.contextId)).toEqual([
      telegramGroupId,
    ])
    expect(listManageableGroups('same-native-user', 'discord-main').map((group) => group.contextId)).toEqual([
      discordGroupId,
    ])
    expect(listManageableGroups('same-native-user').map((group) => group.contextId)).toEqual([
      discordGroupId,
      telegramGroupId,
    ])
  })

  test('does not authorize unscoped legacy groups during scoped platform lookup', () => {
    upsertKnownGroupContext({
      contextId: 'legacy-group',
      provider: 'telegram',
      displayName: 'Legacy',
      parentName: null,
    })
    upsertGroupAdminObservation({
      provider: 'telegram',
      contextId: 'legacy-group',
      userId: 'same-native-user',
      username: 'alice',
      isAdmin: true,
    })
    addAuthorizedGroup('legacy-group', 'admin-1')

    expect(listManageableGroups('same-native-user', 'telegram-main')).toEqual([])
    expect(listManageableGroups('same-native-user').map((group) => group.contextId)).toEqual(['legacy-group'])
  })

  test('lists authorized scoped groups for an admin even before group metadata is observed', () => {
    const scopedGroupId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: '-10012345',
    })

    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    addAdmin('admin-1', 'telegram-default')
    addAuthorizedGroup(scopedGroupId, 'admin-1')

    const groups = listManageableGroups('admin-1', 'telegram-default')

    expect(groups).toHaveLength(1)
    expect(groups[0]?.contextId).toBe(scopedGroupId)
    expect(groups[0]?.displayName).toBe('-10012345')
    expect(groups[0]?.parentName).toBeNull()
  })
})
