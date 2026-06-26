// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult } from '../../src/chat/authorization-types.js'
import { maybeSeedContextAssignment } from '../../src/chat/seed-context-assignment.js'
import { getContextSettings } from '../../src/instances/context-store.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const baseAuth = (overrides: Partial<AuthorizationResult>): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'ctx-1',
  configContextId: 'ctx-1',
  ...overrides,
})

describe('maybeSeedContextAssignment', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('seeds a platform-only row at the config context', () => {
    maybeSeedContextAssignment(baseAuth({ configContextId: 'ctx-1' }), 'tg-default')
    expect(getContextSettings('ctx-1')).toEqual({
      contextId: 'ctx-1',
      taskInstanceId: null,
      platformInstanceId: 'tg-default',
    })
  })

  test('does not seed for a guest', () => {
    maybeSeedContextAssignment(baseAuth({ configContextId: 'ctx-1', isGuest: true }), 'tg-default')
    expect(getContextSettings('ctx-1')).toBeNull()
  })

  test('does not seed when the config context id is absent', () => {
    maybeSeedContextAssignment(baseAuth({ configContextId: undefined }), 'tg-default')
    expect(getContextSettings('ctx-1')).toBeNull()
  })
})
