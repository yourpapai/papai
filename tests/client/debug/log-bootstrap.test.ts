// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { collectScopes, parseLogsArray } from '../../../client/debug/log-bootstrap.js'

describe('parseLogsArray', () => {
  test('returns parsed log entries and skips invalid ones', () => {
    const raw = [
      { time: 1700000000000, level: 30, msg: 'one', scope: 'a' },
      { not: 'a log' },
      { time: 1700000001000, level: 40, msg: 'two', scope: 'b' },
    ]
    const result = parseLogsArray(raw)
    expect(result).toHaveLength(2)
    expect(result[0]?.msg).toBe('one')
    expect(result[1]?.msg).toBe('two')
  })
})

describe('collectScopes', () => {
  test('returns set of scopes from logs', () => {
    const raw = [
      { time: 1, level: 30, msg: 'a', scope: 'x' },
      { time: 2, level: 30, msg: 'b', scope: 'y' },
      { time: 3, level: 30, msg: 'c' },
      { time: 4, level: 30, msg: 'd', scope: 'x' },
    ]
    const logs = parseLogsArray(raw)
    const scopes = collectScopes(logs)
    expect(scopes).toBeInstanceOf(Set)
    expect(scopes.has('x')).toBe(true)
    expect(scopes.has('y')).toBe(true)
    expect(scopes.size).toBe(2)
  })
})
