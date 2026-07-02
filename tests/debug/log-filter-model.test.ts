// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LogEntry } from '../../src/debug/log-buffer.js'
import {
  applyFilter,
  entryMatchesFilter,
  flattenLogEntry,
  matchesScope,
  NONE_TOKEN,
  parseLogFilter,
  type LogFilter,
} from '../../src/debug/log-filter-model.js'

const entry = (o: Partial<LogEntry> = {}): LogEntry => ({
  level: 30,
  time: '2026-07-02T00:00:00.000Z',
  msg: 'hello',
  ...o,
})

const filter = (o: Partial<LogFilter> = {}): LogFilter => ({ include: [], exclude: [], level: 0, ...o })

describe('matchesScope', () => {
  test('exact match', () => {
    expect(matchesScope('chat:telegram', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat:telegram', 'chat:telegram:files')).toBe(false)
  })
  test('bare namespace matches on segment boundary, not substring', () => {
    expect(matchesScope('chat', 'chat')).toBe(true)
    expect(matchesScope('chat', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat', 'chat:telegram:files')).toBe(true)
    expect(matchesScope('chat', 'chatbot')).toBe(false)
  })
  test('wildcard namespace form', () => {
    expect(matchesScope('chat:telegram:*', 'chat:telegram')).toBe(true)
    expect(matchesScope('chat:telegram:*', 'chat:telegram:files')).toBe(true)
    expect(matchesScope('chat:telegram:*', 'chat:mattermost')).toBe(false)
  })
})

describe('entryMatchesFilter', () => {
  test('empty include means all scopes', () => {
    expect(entryMatchesFilter(entry({ scope: 'bot' }), filter())).toBe(true)
  })
  test('include allowlist restricts', () => {
    expect(entryMatchesFilter(entry({ scope: 'bot' }), filter({ include: ['chat'] }))).toBe(false)
    expect(entryMatchesFilter(entry({ scope: 'chat:telegram' }), filter({ include: ['chat'] }))).toBe(true)
  })
  test('exclude wins over include', () => {
    const f = filter({ include: ['chat'], exclude: ['chat:telegram:*'] })
    expect(entryMatchesFilter(entry({ scope: 'chat:mattermost' }), f)).toBe(true)
    expect(entryMatchesFilter(entry({ scope: 'chat:telegram:files' }), f)).toBe(false)
  })
  test('level is a minimum', () => {
    expect(entryMatchesFilter(entry({ level: 20 }), filter({ level: 30 }))).toBe(false)
    expect(entryMatchesFilter(entry({ level: 40 }), filter({ level: 30 }))).toBe(true)
  })
  test('scope-less entries: shown when include empty, gated by NONE_TOKEN otherwise', () => {
    expect(entryMatchesFilter(entry({}), filter())).toBe(true)
    expect(entryMatchesFilter(entry({}), filter({ include: ['chat'] }))).toBe(false)
    expect(entryMatchesFilter(entry({}), filter({ include: [NONE_TOKEN] }))).toBe(true)
    expect(entryMatchesFilter(entry({}), filter({ exclude: [NONE_TOKEN] }))).toBe(false)
  })
  test('turnId exact match', () => {
    expect(entryMatchesFilter(entry({ turnId: 'abc' }), filter({ turnId: 'abc' }))).toBe(true)
    expect(entryMatchesFilter(entry({ turnId: 'abc' }), filter({ turnId: 'xyz' }))).toBe(false)
  })
  test('q substring searches all fields', () => {
    const e = entry({ msg: 'searchTasks', scope: 'bot', userText: 'budget report' })
    expect(entryMatchesFilter(e, filter({ q: 'budget' }))).toBe(true)
    expect(entryMatchesFilter(e, filter({ q: 'BUDGET' }))).toBe(true)
    expect(entryMatchesFilter(e, filter({ q: 'nope' }))).toBe(false)
  })
})

describe('flattenLogEntry', () => {
  test('includes msg, scope, and nested metadata values', () => {
    const text = flattenLogEntry(entry({ msg: 'm', scope: 's', nested: { host: 'example.com' } }))
    expect(text).toContain('m')
    expect(text).toContain('s')
    expect(text).toContain('example.com')
  })
})

describe('applyFilter', () => {
  test('filters a list', () => {
    const list = [entry({ scope: 'a' }), entry({ scope: 'b' })]
    expect(applyFilter(list, filter({ include: ['a'] }))).toHaveLength(1)
  })
})

describe('parseLogFilter', () => {
  test('reads repeated include/exclude, level, turnId, q', () => {
    const p = new URLSearchParams('include=chat&include=tool&exclude=chat:telegram:*&level=30&turnId=t1&q=boom')
    expect(parseLogFilter(p)).toEqual({
      include: ['chat', 'tool'],
      exclude: ['chat:telegram:*'],
      level: 30,
      turnId: 't1',
      q: 'boom',
    })
  })
  test('defaults: empty arrays, level 0, undefined turnId/q; ignores blank/NaN', () => {
    expect(parseLogFilter(new URLSearchParams(''))).toEqual({ include: [], exclude: [], level: 0 })
    expect(parseLogFilter(new URLSearchParams('level=notanumber&q=')).level).toBe(0)
  })
})
