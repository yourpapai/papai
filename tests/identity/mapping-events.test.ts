// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { clearIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('identity mapping events', () => {
  const testContextId = 'test-context-123'
  const testProvider = 'youtrack'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('setIdentityMapping emits identity:set event with providerUserId and provider', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    const identityEvent = events.find((e) => e.type === 'identity:set')
    expect(identityEvent).toBeDefined()
    expect(identityEvent?.data['providerUserId']).toBe('yt-123')
    expect(identityEvent?.data['provider']).toBe(testProvider)
  })

  test('clearIdentityMapping emits identity:cleared event', async () => {
    const { subscribe } = await import('../../src/debug/event-bus.js')
    const events: Array<{ type: string; data: Record<string, unknown> }> = []
    subscribe((event) => {
      events.push({ type: event.type, data: event.data })
    })

    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    clearIdentityMapping(testContextId, testProvider)

    const clearedEvent = events.find((e) => e.type === 'identity:cleared')
    expect(clearedEvent).toBeDefined()
    expect(clearedEvent?.data).toEqual({})
  })
})
