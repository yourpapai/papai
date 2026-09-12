// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { LogEntry } from '../../src/debug/log-buffer.js'
import { makeReadRecentLogsTool, type ReadRecentLogsDeps } from '../../src/tools/diagnostics-logs.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const ADMIN = 'admin-1'
const OWN_TURN = 'turn-own'

type ScopeCount = { scope: string; count: number }
type BufferStats = { count: number; capacity: number; oldest: string | null; newest: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const timeAt = (i: number): string => new Date(Date.UTC(2026, 7, 23) + i * 1000).toISOString()

const entry = (i: number, extra: Record<string, unknown> = {}): LogEntry =>
  Object.assign({ level: 30, time: timeAt(i), msg: `entry ${i}` }, extra)

const makeDeps = (
  entries: LogEntry[],
  overrides: { stats?: BufferStats; scopes?: ScopeCount[]; ownTurns?: ReadonlySet<string> } = {},
): ReadRecentLogsDeps => ({
  entries: () => entries,
  stats: () =>
    overrides.stats ?? {
      count: entries.length,
      capacity: 65535,
      oldest: entries[0]?.time ?? null,
      newest: entries[entries.length - 1]?.time ?? null,
    },
  distinctScopes: () => overrides.scopes ?? [],
  ownTurnIds: () => overrides.ownTurns ?? new Set([OWN_TURN]),
})

const run = (
  chatUserId: string | undefined,
  deps: ReadRecentLogsDeps,
  input: Record<string, unknown> = {},
): Promise<unknown> => getToolExecutor(makeReadRecentLogsTool(chatUserId, deps))(input)

const listedMsgs = (result: unknown): string[] => {
  assert(isRecord(result), 'result must be an object')
  const listed = result['entries']
  assert(Array.isArray(listed), 'entries must be an array')
  return listed.map((e) => {
    assert(isRecord(e), 'entry must be an object')
    return String(e['msg'])
  })
}

describe('read_recent_logs', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('attribution shaping', () => {
    test('returns own entries verbatim on an explicit chatUserId match', async () => {
      const own = entry(0, {
        scope: 'chat:turn',
        msg: 'own explicit entry',
        chatUserId: ADMIN,
        userName: 'Alice',
        durationMs: 5,
        ok: true,
      })

      const result = await run(ADMIN, makeDeps([own]))

      assert(isRecord(result))
      expect(result['entries']).toEqual([own])
    })

    test('returns own entries verbatim when turnId attribution resolves through ownTurnIds', async () => {
      const ownViaTurn = entry(1, {
        msg: 'own via turn',
        turnId: OWN_TURN,
        promptText: 'the admin typed this',
        tokens: 42,
      })

      const result = await run(ADMIN, makeDeps([ownViaTurn]))

      assert(isRecord(result))
      expect(result['entries']).toEqual([ownViaTurn])
    })

    test('shapes foreign entries to structural plus numeric/boolean fields only', async () => {
      const foreign = entry(2, {
        scope: 'chat:turn',
        msg: 'turn tool completed',
        turnId: 'turn-foreign',
        chatUserId: 'user-2',
        attempts: 2,
        cached: false,
        apiKey: 'sk-foreign-leak',
      })

      const result = await run(ADMIN, makeDeps([foreign]))

      assert(isRecord(result))
      expect(result['entries']).toEqual([
        {
          level: 30,
          time: timeAt(2),
          scope: 'chat:turn',
          msg: 'turn tool completed',
          turnId: 'turn-foreign',
          attempts: 2,
          cached: false,
        },
      ])
      expect(JSON.stringify(result)).not.toContain('sk-foreign-leak')
      expect(JSON.stringify(result)).not.toContain('user-2')
    })

    test('shapes unattributed entries exactly like foreign ones', async () => {
      const unattributed = entry(3, {
        scope: 'scheduler',
        msg: 'scheduler tick',
        pendingCount: 7,
        note: 'free text dropped',
      })

      const result = await run(ADMIN, makeDeps([unattributed]))

      assert(isRecord(result))
      expect(result['entries']).toEqual([
        { level: 30, time: timeAt(3), scope: 'scheduler', msg: 'scheduler tick', pendingCount: 7 },
      ])
    })

    test('resolves ownTurnIds exactly once per call with the chat principal', async () => {
      let calls = 0
      let seenPrincipal: string | undefined
      const deps: ReadRecentLogsDeps = {
        entries: () => [
          entry(0, { chatUserId: ADMIN, msg: 'own explicit' }),
          entry(1, { chatUserId: 'user-2', msg: 'foreign' }),
          entry(2, { turnId: OWN_TURN, msg: 'own via turn' }),
        ],
        stats: () => ({ count: 3, capacity: 100, oldest: null, newest: null }),
        distinctScopes: () => [],
        ownTurnIds: (adminUserId: string | undefined) => {
          calls++
          seenPrincipal = adminUserId
          return new Set([OWN_TURN])
        },
      }

      await run(ADMIN, deps)

      expect(calls).toBe(1)
      expect(seenPrincipal).toBe(ADMIN)
    })

    test('a missing chatUserId principal shapes everything (fail closed)', async () => {
      const ownLooking = entry(0, { chatUserId: ADMIN, msg: 'would be own', secret: 'leak' })

      const result = await run(undefined, makeDeps([ownLooking]))

      assert(isRecord(result))
      expect(result['entries']).toEqual([{ level: 30, time: timeAt(0), msg: 'would be own' }])
    })
  })

  describe('shape-then-filter ordering', () => {
    test('a msg filter cannot match content that shaping strips from foreign entries', async () => {
      const foreign = entry(2, {
        scope: 'chat:turn',
        msg: 'turn tool completed',
        chatUserId: 'user-2',
        payloadText: 'CLASSIFIED-ORACLE',
        attempts: 2,
      })

      const byStripped = await run(ADMIN, makeDeps([foreign]), { msg: 'CLASSIFIED-ORACLE' })
      expect(listedMsgs(byStripped)).toEqual([])
      expect(JSON.stringify(byStripped)).not.toContain('CLASSIFIED-ORACLE')

      const byStructural = await run(ADMIN, makeDeps([foreign]), { msg: 'turn tool completed' })
      expect(listedMsgs(byStructural)).toEqual(['turn tool completed'])
    })
  })

  describe('filters', () => {
    test('level filter keeps entries at or above the minimum level', async () => {
      const buffer = [entry(0, { level: 20 }), entry(1, { level: 30 }), entry(2, { level: 40 })]

      const result = await run(ADMIN, makeDeps(buffer), { level: 30 })

      expect(listedMsgs(result)).toEqual(['entry 1', 'entry 2'])
    })

    test('scope filter matches as a namespace include pattern', async () => {
      const buffer = [entry(0, { scope: 'chat:turn' }), entry(1, { scope: 'scheduler' }), entry(2)]

      const result = await run(ADMIN, makeDeps(buffer), { scope: 'chat' })

      expect(listedMsgs(result)).toEqual(['entry 0'])
    })

    test('turn_id filter keeps only entries carrying that turn id', async () => {
      const buffer = [entry(0, { turnId: OWN_TURN }), entry(1, { turnId: 'turn-other' }), entry(2)]

      const result = await run(ADMIN, makeDeps(buffer), { turn_id: OWN_TURN })

      expect(listedMsgs(result)).toEqual(['entry 0'])
    })
  })

  describe('limits', () => {
    test('defaults to the 50 most recent entries', async () => {
      const buffer = Array.from({ length: 60 }, (_, i) => entry(i))

      const result = await run(ADMIN, makeDeps(buffer))

      const msgs = listedMsgs(result)
      expect(msgs).toHaveLength(50)
      expect(msgs[0]).toBe('entry 10')
      expect(msgs[49]).toBe('entry 59')
    })

    test('caps an oversized limit at 200 without error', async () => {
      const buffer = Array.from({ length: 250 }, (_, i) => entry(i))

      const result = await run(ADMIN, makeDeps(buffer), { limit: 999 })

      const msgs = listedMsgs(result)
      expect(msgs).toHaveLength(200)
      expect(msgs[0]).toBe('entry 50')
      expect(msgs[199]).toBe('entry 249')
    })
  })

  describe('distinct scopes', () => {
    test('distinct_scopes returns scope/count pairs instead of entries', async () => {
      const scopes = [
        { scope: 'chat:turn', count: 2 },
        { scope: 'scheduler', count: 5 },
      ]

      const result = await run(ADMIN, makeDeps([entry(0)], { scopes }), { distinct_scopes: true })

      assert(isRecord(result))
      expect(result['scopes']).toEqual(scopes)
      expect(result).not.toHaveProperty('entries')
      expect(Object.keys(result).sort()).toEqual(['history_starts_at_process_start', 'scopes', 'stats'])
    })
  })

  describe('volatility stats', () => {
    test('carries buffer stats and the process-start marker on entry results', async () => {
      const stats: BufferStats = {
        count: 7,
        capacity: 65535,
        oldest: '2026-08-23T00:00:00.000Z',
        newest: '2026-08-23T00:09:59.000Z',
      }

      const result = await run(ADMIN, makeDeps([entry(0, { chatUserId: ADMIN })], { stats }))

      assert(isRecord(result))
      expect(result['stats']).toEqual(stats)
      expect(result['history_starts_at_process_start']).toBe(true)
      expect(Object.keys(result).sort()).toEqual(['entries', 'history_starts_at_process_start', 'stats'])
    })

    test('an empty buffer returns an empty result with zero-count stats, not an error', async () => {
      const stats: BufferStats = { count: 0, capacity: 65535, oldest: null, newest: null }

      const result = await run(ADMIN, makeDeps([], { stats }))

      assert(isRecord(result))
      expect(result['entries']).toEqual([])
      expect(result['stats']).toEqual(stats)
      expect(result['history_starts_at_process_start']).toBe(true)
    })
  })

  describe('probe degradation', () => {
    test('a throwing entries probe degrades to probe_error while other fields survive', async () => {
      const deps: ReadRecentLogsDeps = {
        entries: () => {
          throw new Error('entries probe boom')
        },
        stats: () => ({ count: 1, capacity: 10, oldest: null, newest: null }),
        distinctScopes: () => [],
        ownTurnIds: () => new Set([OWN_TURN]),
      }

      const result = await run(ADMIN, deps)

      assert(isRecord(result))
      expect(result['entries']).toBe('probe_error')
      expect(result['stats']).toEqual({ count: 1, capacity: 10, oldest: null, newest: null })
      expect(result['history_starts_at_process_start']).toBe(true)
      expect(JSON.stringify(result)).not.toContain('boom')
    })

    test('a throwing distinctScopes probe degrades to probe_error in distinct mode', async () => {
      const deps: ReadRecentLogsDeps = {
        entries: () => [],
        stats: () => ({ count: 0, capacity: 10, oldest: null, newest: null }),
        distinctScopes: () => {
          throw new Error('scopes probe boom')
        },
        ownTurnIds: () => new Set([OWN_TURN]),
      }

      const result = await run(ADMIN, deps, { distinct_scopes: true })

      assert(isRecord(result))
      expect(result['scopes']).toBe('probe_error')
    })
  })

  describe('immutability', () => {
    test('leaves the entries buffer byte-identical after a filtered invocation', async () => {
      const buffer = [
        entry(0, { scope: 'chat:turn', chatUserId: ADMIN, extraText: 'own text' }),
        entry(1, { scope: 'chat:turn', chatUserId: 'user-2', secret: 'leak', attempts: 1 }),
        entry(2, { scope: 'scheduler', turnId: OWN_TURN }),
      ]
      const before = JSON.stringify(buffer)

      await run(ADMIN, makeDeps(buffer), { level: 30, scope: 'chat', limit: 2 })

      expect(JSON.stringify(buffer)).toBe(before)
    })
  })

  describe('input schema', () => {
    test('accepts the supported filter, limit, and distinct_scopes inputs', () => {
      const tool = makeReadRecentLogsTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, {})).toBe(true)
      expect(schemaValidates(tool, { level: 30 })).toBe(true)
      expect(schemaValidates(tool, { scope: 'chat' })).toBe(true)
      expect(schemaValidates(tool, { msg: 'anything' })).toBe(true)
      expect(schemaValidates(tool, { turn_id: OWN_TURN })).toBe(true)
      expect(schemaValidates(tool, { limit: 1 })).toBe(true)
      expect(schemaValidates(tool, { limit: 500 })).toBe(true)
      expect(schemaValidates(tool, { distinct_scopes: true })).toBe(true)
    })

    test('rejects malformed inputs', () => {
      const tool = makeReadRecentLogsTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, { level: 'info' })).toBe(false)
      expect(schemaValidates(tool, { scope: 42 })).toBe(false)
      expect(schemaValidates(tool, { limit: 0 })).toBe(false)
      expect(schemaValidates(tool, { limit: -1 })).toBe(false)
      expect(schemaValidates(tool, { limit: 2.5 })).toBe(false)
      expect(schemaValidates(tool, { distinct_scopes: 'yes' })).toBe(false)
    })
  })
})
