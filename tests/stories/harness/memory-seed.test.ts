// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { listMemoryRecords } from '../../../src/long-term-memory/store.js'
import { getMemo } from '../../../src/memos.js'
import { executeScenario, FIXED_SWEEP_NOW } from './scenario.js'

const IDLE_MS = 600_000

describe('memory seed helpers and sweep primitives', () => {
  test('given.memo persists a real memo retrievable via the memos store', async () => {
    await executeScenario('given.memo seeds a real memo', ({ given }) => {
      const alice = given.user('alice')
      const memo = given.memo({ userId: alice.id, content: 'Loves TypeScript', tags: ['preference'] })

      const stored = getMemo(alice.id, memo.id)
      expect(stored?.content).toBe('Loves TypeScript')
      expect(stored?.tags).toEqual(['preference'])
    })
  })

  test('given.memoryRecord persists a real memory record at the given scope', async () => {
    await executeScenario('given.memoryRecord seeds a real record', ({ given }) => {
      const scope = { scopeId: 'scenario-scope-a', scopeType: 'group' as const }
      const record = given.memoryRecord({ scope, kind: 'fact', content: 'The team ships on Fridays' })

      const found = listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, status: record.status })
      const stored = found.find((row) => row.id === record.id)
      expect(stored?.content).toBe('The team ships on Fridays')
    })
  })

  test('when.captureSweep runs the real capture pipeline for a genuinely dirty group thread', async () => {
    await executeScenario('when.captureSweep captures a dirty group thread', async ({ given, when, world }) => {
      const alice = given.user('alice')
      const group = given.group('capture-group')
      given.member(group, alice)
      const thread = given.thread(group, 'capture-thread')

      const lastActivityAt = new Date(new Date(FIXED_SWEEP_NOW).getTime() - IDLE_MS - 60_000).toISOString()
      given.dirtyContext(thread, {
        messages: [{ role: 'user', content: 'We always ship on Fridays.' }],
        lastActivityAt,
      })

      await when.captureSweep({ records: [{ kind: 'fact', content: 'The team ships every Friday.' }] })

      const scopeId = world.groupScopeId(group)
      const captured = listMemoryRecords({ scopeId, scopeType: 'group', status: 'provisional' })
      expect(captured.some((row) => row.content === 'The team ships every Friday.')).toBe(true)
    })
  })

  test('when.captureSweep does not capture a context that is not yet idle', async () => {
    await executeScenario('when.captureSweep skips a fresh group thread', async ({ given, when, world }) => {
      const alice = given.user('alice')
      const group = given.group('fresh-capture-group')
      given.member(group, alice)
      const thread = given.thread(group, 'fresh-capture-thread')

      const lastActivityAt = new Date(new Date(FIXED_SWEEP_NOW).getTime() - 1_000).toISOString()
      given.dirtyContext(thread, {
        messages: [{ role: 'user', content: 'Just said something.' }],
        lastActivityAt,
      })

      await when.captureSweep({ records: [{ kind: 'fact', content: 'Should not be captured.' }] })

      const scopeId = world.groupScopeId(group)
      const captured = listMemoryRecords({ scopeId, scopeType: 'group', status: 'provisional' })
      expect(captured.some((row) => row.content === 'Should not be captured.')).toBe(false)
    })
  })

  test('when.promotionSweep promotes a provisional record seen across three distinct threads', async () => {
    await executeScenario(
      'when.promotionSweep promotes a durable cross-thread fact',
      async ({ given, when, world }) => {
        const group = given.group('promotion-group')
        const scopeId = world.groupScopeId(group)
        const content = 'The bot ships on Fridays.'

        for (const threadContextId of ['promotion-thread-1', 'promotion-thread-2', 'promotion-thread-3']) {
          given.memoryRecord({
            scope: { scopeId, scopeType: 'group' },
            kind: 'fact',
            content,
            threadContextId,
            evidence: { threads: [threadContextId] },
          })
        }

        await when.promotionSweep({ confirmDurable: () => Promise.resolve(true) })

        const active = listMemoryRecords({ scopeId, scopeType: 'group', status: 'active' })
        expect(active.some((row) => row.content === content)).toBe(true)
      },
    )
  })

  test('when.promotionSweep does not promote a record seen in fewer than three threads', async () => {
    await executeScenario(
      'when.promotionSweep withholds an under-corroborated fact',
      async ({ given, when, world }) => {
        const group = given.group('under-promotion-group')
        const scopeId = world.groupScopeId(group)
        const content = 'The bot only ships on Mondays.'

        for (const threadContextId of ['under-promotion-thread-1', 'under-promotion-thread-2']) {
          given.memoryRecord({
            scope: { scopeId, scopeType: 'group' },
            kind: 'fact',
            content,
            threadContextId,
            evidence: { threads: [threadContextId] },
          })
        }

        await when.promotionSweep({ confirmDurable: () => Promise.resolve(true) })

        const active = listMemoryRecords({ scopeId, scopeType: 'group', status: 'active' })
        const provisional = listMemoryRecords({ scopeId, scopeType: 'group', status: 'provisional' })
        expect(active.some((row) => row.content === content)).toBe(false)
        expect(provisional.filter((row) => row.content === content)).toHaveLength(2)
      },
    )
  })
})
