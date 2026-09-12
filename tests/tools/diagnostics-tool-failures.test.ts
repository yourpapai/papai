// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { Scope } from '../../src/debug/event-bus.js'
import { RECENT_TOOL_FAILURES_CAPACITY, type ToolFailure } from '../../src/debug/turn-assembly.js'
import {
  makeReadRecentToolFailuresTool,
  type ReadRecentToolFailuresDeps,
} from '../../src/tools/diagnostics-tool-failures.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'

const ADMIN = 'admin-1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const failure = (
  overrides: { id?: string; at?: number; scope?: Scope; data?: Record<string, unknown> } = {},
): ToolFailure => ({
  timestamp: overrides.at ?? 1000,
  scope: overrides.scope ?? { kind: 'user', userId: ADMIN },
  data: {
    turnId: overrides.id ?? 'turn-1',
    toolName: 'create_task',
    durationMs: 90,
    ok: false,
    failureReason: 'provider 500',
    args: { title: 'secret user text' },
    result: { error: 'raw provider body' },
    chatUserId: ADMIN,
    ...overrides.data,
  },
})

const makeDeps = (failures: ToolFailure[]): ReadRecentToolFailuresDeps => ({ failures: () => failures })

const run = (
  chatUserId: string | undefined,
  deps: ReadRecentToolFailuresDeps,
  input: Record<string, unknown> = {},
): Promise<unknown> => getToolExecutor(makeReadRecentToolFailuresTool(chatUserId, deps))(input)

const listed = (result: unknown): Array<Record<string, unknown>> => {
  assert(isRecord(result), 'result must be an object')
  const failures = result['failures']
  assert(Array.isArray(failures), 'failures must be an array')
  return failures.map((f) => {
    assert(isRecord(f), 'failure must be an object')
    return f
  })
}

const listedTurnIds = (result: unknown): unknown[] => listed(result).map((f) => f['turnId'])

describe('read_recent_tool_failures', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('visibility filtering', () => {
    test('excludes entries whose scope fails isVisibleToAdmin', async () => {
      const buffer = [
        failure({ id: 'f-own' }),
        failure({ id: 'f-foreign', scope: { kind: 'user', userId: 'user-2' } }),
        failure({ id: 'f-group', scope: { kind: 'group', groupId: 'g-1' } }),
      ]

      const result = await run(ADMIN, makeDeps(buffer))

      expect(listedTurnIds(result)).toEqual(['f-own'])
    })

    test('keeps globally scoped entries', async () => {
      const global = failure({ id: 'f-global', scope: { kind: 'global' } })

      const result = await run(ADMIN, makeDeps([global]))

      expect(listedTurnIds(result)).toEqual(['f-global'])
    })

    test('a missing chatUserId excludes user-scoped entries (fail closed)', async () => {
      const result = await run(undefined, makeDeps([failure({ id: 'f-own-looking' })]))

      expect(listed(result)).toEqual([])
    })
  })

  describe('egress whitelist', () => {
    test('returns only timestamp, scope, toolName, durationMs, ok, failureReason, turnId', async () => {
      const result = await run(ADMIN, makeDeps([failure({ id: 'f-1' })]))

      const [first] = listed(result)
      assert(first !== undefined, 'expected at least one failure')
      expect(Object.keys(first).sort()).toEqual([
        'durationMs',
        'failureReason',
        'ok',
        'scope',
        'timestamp',
        'toolName',
        'turnId',
      ])
      expect(first['toolName']).toBe('create_task')
      expect(first['durationMs']).toBe(90)
      expect(first['ok']).toBe(false)
      expect(first['failureReason']).toBe('provider 500')
      expect(first['turnId']).toBe('f-1')
      expect(JSON.stringify(result)).not.toContain('secret user text')
      expect(JSON.stringify(result)).not.toContain('raw provider body')
      expect(JSON.stringify(result)).not.toContain('chatUserId')
    })

    test('success-flagged entries keep ok: true and omit an absent failureReason', async () => {
      const okEntry = failure({ data: { ok: true, failureReason: undefined } })

      const [first] = listed(await run(ADMIN, makeDeps([okEntry])))

      assert(first !== undefined)
      expect(first['ok']).toBe(true)
      expect('failureReason' in first).toBe(false)
    })
  })

  describe('limits', () => {
    test('default to the 25 most recent entries', async () => {
      const buffer = Array.from({ length: 30 }, (_, i) => failure({ id: `turn-${i}`, at: i }))

      const result = await run(ADMIN, makeDeps(buffer))

      const ids = listedTurnIds(result)
      expect(ids).toHaveLength(25)
      expect(ids[0]).toBe('turn-5')
      expect(ids[24]).toBe('turn-29')
    })

    test('cap an oversized limit at 1024 without error', async () => {
      const buffer = Array.from({ length: 1030 }, (_, i) => failure({ id: `turn-${i}`, at: i }))

      const result = await run(ADMIN, makeDeps(buffer), { limit: 9999 })

      const ids = listedTurnIds(result)
      expect(ids).toHaveLength(1024)
      expect(ids[0]).toBe('turn-6')
      expect(ids[1023]).toBe('turn-1029')
    })
  })

  describe('volatility stats', () => {
    test('derive count/capacity/oldest/newest from the raw failure buffer', async () => {
      const buffer = [failure({ at: 100 }), failure({ at: 300 })]

      const result = await run(ADMIN, makeDeps(buffer))

      assert(isRecord(result))
      expect(result['stats']).toEqual({
        count: 2,
        capacity: RECENT_TOOL_FAILURES_CAPACITY,
        oldest: 100,
        newest: 300,
      })
    })

    test('an empty buffer returns an empty result with zero-count stats, not an error', async () => {
      const result = await run(ADMIN, makeDeps([]))

      assert(isRecord(result))
      expect(result['failures']).toEqual([])
      expect(result['stats']).toEqual({
        count: 0,
        capacity: RECENT_TOOL_FAILURES_CAPACITY,
        oldest: null,
        newest: null,
      })
    })
  })

  describe('probe degradation', () => {
    test('a throwing failures probe degrades to probe_error', async () => {
      const deps: ReadRecentToolFailuresDeps = {
        failures: () => {
          throw new Error('failures probe boom')
        },
      }

      const result = await run(ADMIN, deps)

      assert(isRecord(result))
      expect(result['failures']).toBe('probe_error')
      expect(result['stats']).toBe('probe_error')
      expect(JSON.stringify(result)).not.toContain('boom')
    })
  })

  describe('immutability', () => {
    test('leaves the failure buffer byte-identical after invocation', async () => {
      const buffer = [failure({ id: 'f-1' }), failure({ id: 'f-2', at: 2000 })]
      const before = JSON.stringify(buffer)

      await run(ADMIN, makeDeps(buffer), { limit: 2 })

      expect(JSON.stringify(buffer)).toBe(before)
    })
  })

  describe('input schema', () => {
    test('accepts the supported limit input', () => {
      const tool = makeReadRecentToolFailuresTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, {})).toBe(true)
      expect(schemaValidates(tool, { limit: 1 })).toBe(true)
      expect(schemaValidates(tool, { limit: 5000 })).toBe(true)
    })

    test('rejects malformed inputs', () => {
      const tool = makeReadRecentToolFailuresTool(ADMIN, makeDeps([]))

      expect(schemaValidates(tool, { limit: 0 })).toBe(false)
      expect(schemaValidates(tool, { limit: -1 })).toBe(false)
      expect(schemaValidates(tool, { limit: 2.5 })).toBe(false)
    })
  })
})
