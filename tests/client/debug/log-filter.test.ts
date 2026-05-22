// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { filterLogs, filterLogsWithIndex, flattenLogEntry, updateFuseIndex } from '../../../client/debug/log-filter.js'
import type { LogEntry } from '../../../src/debug/schemas.js'

function makeLog(overrides: Record<string, unknown> = {}): LogEntry {
  return { time: 1700000000000, level: 30, msg: 'hello', scope: 'app', ...overrides }
}

describe('flattenLogEntry', () => {
  test('joins msg, scope, and nested values', () => {
    const text = flattenLogEntry(makeLog({ msg: 'starting', scope: 'sched', extra: { reason: 'tick' } }))
    expect(text).toContain('starting')
    expect(text).toContain('sched')
    expect(text).toContain('reason')
    expect(text).toContain('tick')
  })

  test('handles arrays and primitives', () => {
    const text = flattenLogEntry(makeLog({ items: [1, 'two', true] }))
    expect(text).toContain('1')
    expect(text).toContain('two')
    expect(text).toContain('true')
  })
})

describe('filterLogs', () => {
  const logs: LogEntry[] = [
    makeLog({ msg: 'one', level: 20, scope: 'a' }),
    makeLog({ msg: 'two', level: 30, scope: 'b' }),
    makeLog({ msg: 'three', level: 40, scope: 'a', turnId: 't1' }),
  ]

  test('filters by minimum level', () => {
    const result = filterLogs(logs, 30, '', '', null)
    expect(result).toHaveLength(2)
  })

  test('filters by scope', () => {
    const result = filterLogs(logs, 0, 'a', '', null)
    expect(result).toHaveLength(2)
  })

  test('filters by turnId', () => {
    const result = filterLogs(logs, 0, '', '', null, 't1')
    expect(result).toHaveLength(1)
    expect(result[0]?.msg).toBe('three')
  })

  test('returns all when no filters set', () => {
    const result = filterLogs(logs, 0, '', '', null)
    expect(result).toHaveLength(3)
  })

  test('returns entries with originalIndex when using filterLogsWithIndex', () => {
    const result = filterLogsWithIndex(logs, 30, '', '', null)
    expect(result).toHaveLength(2)
    expect(result[0]!).toHaveProperty('entry')
    expect(result[0]!).toHaveProperty('originalIndex')
    expect(result[0]!.originalIndex).toBe(1)
    expect(result[0]!.entry.msg).toBe('two')
    expect(result[1]!.originalIndex).toBe(2)
    expect(result[1]!.entry.msg).toBe('three')
  })
})

describe('updateFuseIndex', () => {
  test('returns a searcher that finds matching logs', () => {
    const fuse = updateFuseIndex([makeLog({ msg: 'database connection failed' }), makeLog({ msg: 'startup complete' })])
    expect(fuse).not.toBeNull()
    const results = fuse!.search('database')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.item.msg).toContain('database')
  })
})
