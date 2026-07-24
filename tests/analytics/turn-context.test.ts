// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'

const T0 = 1_700_000_000_000
const GRACE_MS = 2 * 60 * 1000
const TTL_MS = 30 * 60 * 1000

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const makeRegistry = (now: { value: number }): ReturnType<typeof createTurnContextRegistry> =>
  createTurnContextRegistry({ nowMs: () => now.value, terminalGraceMs: GRACE_MS, ttlMs: TTL_MS })

describe('authorized turn context registry', () => {
  test('register then resolve returns the authoritative source', () => {
    const now = { value: T0 }
    const registry = makeRegistry(now)
    registry.register({ turnId: 'turn-1', source: memberSource })
    expect(registry.resolve('turn-1')).toEqual(memberSource)
    expect(registry.resolve('turn-unknown')).toBeNull()
  })

  test('complete starts a two-minute terminal grace for late child events', () => {
    const now = { value: T0 }
    const registry = makeRegistry(now)
    registry.register({ turnId: 'turn-1', source: memberSource })
    now.value = T0 + 5 * 60 * 1000
    registry.complete('turn-1')
    now.value = T0 + 5 * 60 * 1000 + GRACE_MS - 1
    expect(registry.resolve('turn-1')).toEqual(memberSource)
    now.value = T0 + 5 * 60 * 1000 + GRACE_MS + 1
    expect(registry.resolve('turn-1')).toBeNull()
  })

  test('an uncompleted entry expires at the hard TTL', () => {
    const now = { value: T0 }
    const registry = makeRegistry(now)
    registry.register({ turnId: 'turn-1', source: memberSource })
    now.value = T0 + TTL_MS - 1
    expect(registry.resolve('turn-1')).toEqual(memberSource)
    now.value = T0 + TTL_MS + 1
    expect(registry.resolve('turn-1')).toBeNull()
  })

  test('clear removes every entry on shutdown', () => {
    const now = { value: T0 }
    const registry = makeRegistry(now)
    registry.register({ turnId: 'turn-1', source: memberSource })
    registry.register({ turnId: 'turn-2', source: memberSource })
    registry.clear()
    expect(registry.resolve('turn-1')).toBeNull()
    expect(registry.resolve('turn-2')).toBeNull()
  })
})
