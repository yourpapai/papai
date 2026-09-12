// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { RECENT_TURNS_CAPACITY, type Turn } from '../../src/debug/turn-assembly.js'
import { makeReadRecentTurnsTool, type ReadRecentTurnsDeps } from '../../src/tools/diagnostics-turns.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const ADMIN = 'admin-1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  turnId: 'turn-1',
  scope: { kind: 'user', userId: ADMIN },
  startedAt: 1000,
  endedAt: 2500,
  status: 'ok',
  incomingMessageCount: 1,
  toolCalls: [
    { name: 'list_tasks', durationMs: 120, ok: true, failureReason: undefined },
    { name: 'create_task', durationMs: 90, ok: false, failureReason: 'provider 500' },
  ],
  reply: { durationMs: 300 },
  error: undefined,
  ...overrides,
})

const makeDeps = (turns: Turn[], inFlight: Turn[] = []): ReadRecentTurnsDeps => ({
  turns: () => turns,
  findTurnById: (turnId: string) => [...inFlight, ...turns].find((t) => t.turnId === turnId),
})

const run = (
  chatUserId: string | undefined,
  deps: ReadRecentTurnsDeps,
  input: Record<string, unknown> = {},
): Promise<unknown> => getToolExecutor(makeReadRecentTurnsTool(chatUserId, deps))(input)

const listed = (result: unknown): Array<Record<string, unknown>> => {
  assert(isRecord(result), 'result must be an object')
  const turns = result['turns']
  assert(Array.isArray(turns), 'turns must be an array')
  return turns.map((t) => {
    assert(isRecord(t), 'turn must be an object')
    return t
  })
}

const listedIds = (result: unknown): unknown[] => listed(result).map((t) => t['turnId'])

describe('read_recent_turns', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('listings', () => {
    test('exclude turns whose scope fails isVisibleToAdmin', async () => {
      const buffer = [
        turn({ turnId: 'turn-own' }),
        turn({ turnId: 'turn-foreign', scope: { kind: 'user', userId: 'user-2' } }),
        turn({ turnId: 'turn-group', scope: { kind: 'group', groupId: 'g-1' } }),
        turn({ turnId: 'turn-global', scope: { kind: 'global' } }),
      ]

      const result = await run(ADMIN, makeDeps(buffer))

      expect(listedIds(result)).toEqual(['turn-own', 'turn-global'])
    })

    test('apply the status filter over visible turns', async () => {
      const buffer = [
        turn({ turnId: 't-ok', status: 'ok' }),
        turn({ turnId: 't-error', status: 'error', error: 'llm failed' }),
        turn({ turnId: 't-cancelled', status: 'cancelled' }),
      ]

      const result = await run(ADMIN, makeDeps(buffer), { status: 'error' })

      expect(listedIds(result)).toEqual(['t-error'])
    })

    test('a missing chatUserId excludes user-scoped turns (fail closed)', async () => {
      const buffer = [turn({ turnId: 't-own-looking' }), turn({ turnId: 't-global', scope: { kind: 'global' } })]

      const result = await run(undefined, makeDeps(buffer))

      expect(listedIds(result)).toEqual(['t-global'])
    })

    test('default to the 25 most recent turns', async () => {
      const buffer = Array.from({ length: 30 }, (_, i) => turn({ turnId: `t-${i}`, startedAt: i }))

      const result = await run(ADMIN, makeDeps(buffer))

      const ids = listedIds(result)
      expect(ids).toHaveLength(25)
      expect(ids[0]).toBe('t-5')
      expect(ids[24]).toBe('t-29')
    })

    test('cap an oversized limit at 512 without error', async () => {
      const buffer = Array.from({ length: 520 }, (_, i) => turn({ turnId: `t-${i}`, startedAt: i }))

      const result = await run(ADMIN, makeDeps(buffer), { limit: 999 })

      const ids = listedIds(result)
      expect(ids).toHaveLength(512)
      expect(ids[0]).toBe('t-8')
      expect(ids[511]).toBe('t-519')
    })
  })

  describe('single-turn fetch', () => {
    test('returns the anonymous payload for an own turn', async () => {
      const own = turn({
        turnId: 'turn-own',
        startedAt: 1000,
        endedAt: 2500,
        status: 'error',
        error: 'provider 500 after retries',
      })

      const result = await run(ADMIN, makeDeps([own]), { turn_id: 'turn-own' })

      assert(isRecord(result))
      expect(result['status']).toBe('ok')
      expect(result['turn']).toEqual(own)
      expect(result['stats']).toEqual({
        count: 1,
        capacity: RECENT_TURNS_CAPACITY,
        oldest: 1000,
        newest: 1000,
      })
    })

    test('foreign, invisible, and unknown turn ids return indistinguishable not_found', async () => {
      const buffer = [
        turn({ turnId: 'turn-foreign', scope: { kind: 'user', userId: 'user-2' } }),
        turn({ turnId: 'turn-group', scope: { kind: 'group', groupId: 'g-1' } }),
      ]

      const foreign = await run(ADMIN, makeDeps(buffer), { turn_id: 'turn-foreign' })
      const invisible = await run(ADMIN, makeDeps(buffer), { turn_id: 'turn-group' })
      const unknown = await run(ADMIN, makeDeps(buffer), { turn_id: 'turn-nope' })

      expect(foreign).toEqual(invisible)
      expect(invisible).toEqual(unknown)
      assert(isRecord(foreign))
      expect(foreign['status']).toBe('not_found')
      expect(foreign).not.toHaveProperty('turn')
    })

    test('in-flight running turns are observable via the fetch path', async () => {
      const running = turn({ turnId: 't-running', status: 'running', endedAt: undefined, reply: undefined })

      const result = await run(ADMIN, makeDeps([turn({ turnId: 't-done' })], [running]), { turn_id: 't-running' })

      assert(isRecord(result))
      expect(result['status']).toBe('ok')
      assert(isRecord(result['turn']))
      expect(result['turn']['status']).toBe('running')
      expect(result['turn']['endedAt']).toBeUndefined()
    })
  })

  describe('volatility stats', () => {
    test('derive count/capacity/oldest/newest from the raw turn buffer', async () => {
      const buffer = [turn({ turnId: 'a', startedAt: 100 }), turn({ turnId: 'b', startedAt: 300 })]

      const result = await run(ADMIN, makeDeps(buffer))

      assert(isRecord(result))
      expect(result['stats']).toEqual({ count: 2, capacity: RECENT_TURNS_CAPACITY, oldest: 100, newest: 300 })
    })

    test('an empty buffer returns an empty result with zero-count stats, not an error', async () => {
      const result = await run(ADMIN, makeDeps([]))

      assert(isRecord(result))
      expect(result['turns']).toEqual([])
      expect(result['stats']).toEqual({ count: 0, capacity: RECENT_TURNS_CAPACITY, oldest: null, newest: null })
    })
  })

  describe('probe degradation', () => {
    test('a throwing turns probe degrades to probe_error', async () => {
      const deps: ReadRecentTurnsDeps = {
        turns: () => {
          throw new Error('turns probe boom')
        },
        findTurnById: () => undefined,
      }

      const result = await run(ADMIN, deps)

      assert(isRecord(result))
      expect(result['turns']).toBe('probe_error')
      expect(result['stats']).toBe('probe_error')
      expect(JSON.stringify(result)).not.toContain('boom')
    })

    test('a throwing findTurnById probe degrades to a probe_error fetch status', async () => {
      const deps: ReadRecentTurnsDeps = {
        turns: () => [turn({ turnId: 't-1' })],
        findTurnById: () => {
          throw new Error('fetch probe boom')
        },
      }

      const result = await run(ADMIN, deps, { turn_id: 't-1' })

      assert(isRecord(result))
      expect(result['status']).toBe('probe_error')
      expect(JSON.stringify(result)).not.toContain('boom')
    })
  })

  describe('immutability', () => {
    test('leaves the turn buffer byte-identical after a listing and a fetch', async () => {
      const buffer = [
        turn({ turnId: 't-own', error: 'kept error' }),
        turn({ turnId: 't-foreign', scope: { kind: 'user', userId: 'user-2' } }),
      ]
      const before = JSON.stringify(buffer)

      await run(ADMIN, makeDeps(buffer), { status: 'ok', limit: 2 })
      await run(ADMIN, makeDeps(buffer), { turn_id: 't-own' })

      expect(JSON.stringify(buffer)).toBe(before)
    })
  })

  describe('input schema', () => {
    test('accepts the supported filter, fetch, and limit inputs', () => {
      const tool = makeReadRecentTurnsTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, {})).toBe(true)
      expect(schemaValidates(tool, { status: 'running' })).toBe(true)
      expect(schemaValidates(tool, { status: 'error' })).toBe(true)
      expect(schemaValidates(tool, { turn_id: 'turn-1' })).toBe(true)
      expect(schemaValidates(tool, { limit: 1 })).toBe(true)
      expect(schemaValidates(tool, { limit: 999 })).toBe(true)
    })

    test('rejects malformed inputs', () => {
      const tool = makeReadRecentTurnsTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, { status: 'paused' })).toBe(false)
      expect(schemaValidates(tool, { turn_id: '' })).toBe(false)
      expect(schemaValidates(tool, { turn_id: 42 })).toBe(false)
      expect(schemaValidates(tool, { limit: 0 })).toBe(false)
      expect(schemaValidates(tool, { limit: -1 })).toBe(false)
      expect(schemaValidates(tool, { limit: 2.5 })).toBe(false)
    })
  })
})
