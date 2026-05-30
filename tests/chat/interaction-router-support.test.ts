// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import {
  getValidatedDmCallbackTargetContextId,
  getValidatedDmTargetContextId,
} from '../../src/chat/interaction-router-support.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { createGroupSettingsSession, deleteGroupSettingsSession } from '../../src/group-settings/state.js'
import { addAdmin } from '../../src/instances/admin-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const PLATFORM = 'telegram-default'
const USER = 'user-1'
const scopedGroup = toScopedContextId({ platformInstanceId: PLATFORM, nativeContextId: 'group-1' })

describe('interaction-router-support', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '1'.repeat(64)
    deleteGroupSettingsSession(USER, PLATFORM)
  })

  const setupManagedGroup = (): void => {
    insertPlatformInstance({ id: PLATFORM, type: 'telegram', config: { token: 't' }, status: 'active' })
    addAdmin(USER, PLATFORM)
    addAuthorizedGroup(scopedGroup, USER)
  }

  describe('getValidatedDmTargetContextId', () => {
    test('returns null when no active group settings target', () => {
      expect(getValidatedDmTargetContextId(USER, PLATFORM)).toBeNull()
    })

    test('returns scoped context id when active target matches a manageable group', () => {
      setupManagedGroup()
      createGroupSettingsSession({
        userId: USER,
        command: 'config',
        stage: 'active',
        platformInstanceId: PLATFORM,
        targetContextId: scopedGroup,
      })

      const result = getValidatedDmTargetContextId(USER, PLATFORM)
      expect(result).toBe(scopedGroup)
    })

    test('returns null and clears session when active target no longer manageable', () => {
      createGroupSettingsSession({
        userId: USER,
        command: 'config',
        stage: 'active',
        platformInstanceId: PLATFORM,
        targetContextId: 'unknown-group',
      })

      const result = getValidatedDmTargetContextId(USER, PLATFORM)
      expect(result).toBeNull()
    })
  })

  describe('getValidatedDmCallbackTargetContextId', () => {
    test('returns scoped personal context id for own user target', () => {
      const scopedUser = toScopedContextId({ platformInstanceId: PLATFORM, nativeContextId: USER })
      const result = getValidatedDmCallbackTargetContextId(USER, USER, PLATFORM)
      expect(result).toBe(scopedUser)
    })

    test('returns scoped personal context id for already-scoped own user target', () => {
      const scopedUser = toScopedContextId({ platformInstanceId: PLATFORM, nativeContextId: USER })
      const result = getValidatedDmCallbackTargetContextId(USER, scopedUser, PLATFORM)
      expect(result).toBe(scopedUser)
    })

    test('returns scoped group context id for a manageable group target', () => {
      setupManagedGroup()

      const result = getValidatedDmCallbackTargetContextId(USER, scopedGroup, PLATFORM)
      expect(result).toBe(scopedGroup)
    })

    test('returns null and clears session for unknown target', () => {
      const result = getValidatedDmCallbackTargetContextId(USER, 'unknown-ctx', PLATFORM)
      expect(result).toBeNull()
    })
  })
})
