// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { DebugEvent } from '../../src/debug/event-bus.js'
import { resetTurnBuffers } from '../../src/debug/turn-assembly.testing.js'
import {
  clientVisibility,
  isOwnLogEntry,
  isVisibleToAdmin,
  ownTurnIdsForAdmin,
  type AdminVisibility,
} from '../../src/debug/visibility.js'

beforeEach(() => {
  resetTurnBuffers()
})

describe('isVisibleToAdmin', () => {
  const vis: AdminVisibility = { adminUserId: 'a1', groupIds: new Set(['g1']) }

  test('rejects null, undefined and non-string scope kinds', () => {
    expect(isVisibleToAdmin(null, vis)).toBe(false)
    expect(isVisibleToAdmin(undefined, vis)).toBe(false)
    expect(isVisibleToAdmin({} as { kind?: string }, vis)).toBe(false)
  })

  test('global scope is visible to every admin', () => {
    expect(isVisibleToAdmin({ kind: 'global' }, vis)).toBe(true)
  })

  test('user scope is visible only to the owning admin', () => {
    expect(isVisibleToAdmin({ kind: 'user', userId: 'a1' }, vis)).toBe(true)
    expect(isVisibleToAdmin({ kind: 'user', userId: 'a2' }, vis)).toBe(false)
  })

  test('group scope requires a known groupId', () => {
    expect(isVisibleToAdmin({ kind: 'group', groupId: 'g1' }, vis)).toBe(true)
    expect(isVisibleToAdmin({ kind: 'group', groupId: 'g2' }, vis)).toBe(false)
    expect(isVisibleToAdmin({ kind: 'group' }, vis)).toBe(false)
  })

  test('unknown kinds are invisible', () => {
    expect(isVisibleToAdmin({ kind: 'other' }, vis)).toBe(false)
  })
})

describe('clientVisibility', () => {
  test('maps an unbound admin to the empty id with no groups', () => {
    expect(clientVisibility(undefined)).toEqual({ adminUserId: '', groupIds: new Set() })
  })

  test('keeps the bound admin id with no groups', () => {
    expect(clientVisibility('a1').adminUserId).toBe('a1')
  })
})

const turnStart = (userId: string, turnId: string): DebugEvent => ({
  type: 'turn:start',
  timestamp: 1,
  scope: { kind: 'user', userId },
  data: { turnId, incomingMessageCount: 1 },
})

const turnEnd = (userId: string, turnId: string): DebugEvent => ({
  type: 'turn:end',
  timestamp: 2,
  scope: { kind: 'user', userId },
  data: { turnId, status: 'ok' },
})

describe('ownTurnIdsForAdmin', () => {
  test('returns an empty set for an unbound admin', () => {
    expect(ownTurnIdsForAdmin(undefined).size).toBe(0)
  })

  test('collects own in-flight and finalized turns, skips foreign ones', async () => {
    const { handleTurnAssembly } = await import('../../src/debug/turn-assembly.js')
    handleTurnAssembly(turnStart('a1', 't-inflight'), () => {})
    handleTurnAssembly(turnStart('a2', 't-foreign-inflight'), () => {})
    handleTurnAssembly(turnStart('a1', 't-recent'), () => {})
    handleTurnAssembly(turnEnd('a1', 't-recent'), () => {})

    const own = ownTurnIdsForAdmin('a1')
    expect(own.has('t-inflight')).toBe(true)
    expect(own.has('t-recent')).toBe(true)
    expect(own.has('t-foreign-inflight')).toBe(false)
  })
})

describe('isOwnLogEntry', () => {
  test('nothing is own when no admin is bound', () => {
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', chatUserId: 'a1' }, undefined)).toBe(false)
  })

  test('explicit chatUserId decides attribution when present', async () => {
    const { handleTurnAssembly } = await import('../../src/debug/turn-assembly.js')
    handleTurnAssembly(turnStart('a1', 't-turn'), () => {})

    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', chatUserId: 'a1' }, 'a1')).toBe(true)
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', chatUserId: 'a1' }, 'a2')).toBe(false)
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', chatUserId: 'a1', turnId: 't-turn' }, 'a2')).toBe(false)
  })

  test('turnId resolves via the pre-resolved attribution set when provided', () => {
    const own = new Set(['t-own'])
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: 't-own' }, 'a1', own)).toBe(true)
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: 't-other' }, 'a1', own)).toBe(false)
  })

  test('turnId falls back to a findTurnById lookup for visible turns', async () => {
    const { handleTurnAssembly } = await import('../../src/debug/turn-assembly.js')
    handleTurnAssembly(turnStart('a1', 't-own'), () => {})
    handleTurnAssembly(turnStart('a2', 't-foreign'), () => {})

    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: 't-own' }, 'a1')).toBe(true)
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: 't-foreign' }, 'a1')).toBe(false)
  })

  test('unknown or empty turnIds are not own', () => {
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: 't-nope' }, 'a1')).toBe(false)
    expect(isOwnLogEntry({ level: 30, time: 't', msg: 'm', turnId: '' }, 'a1')).toBe(false)
  })
})
