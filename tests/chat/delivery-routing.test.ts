// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveDeliveryPlatformInstanceId } from '../../src/chat/delivery-routing.js'
import { dmTarget } from '../../src/chat/types.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDeliveryPlatformInstanceId', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns context_settings platform instance for the delivery context', () => {
    setContextSettings({
      contextId: 'user-1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'telegram-default',
    })

    expect(resolveDeliveryPlatformInstanceId(dmTarget('user-1'))).toBe('telegram-default')
  })

  test('returns null when the delivery context has no assignment', () => {
    expect(resolveDeliveryPlatformInstanceId(dmTarget('missing-user'))).toBeNull()
  })
})
