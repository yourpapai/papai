// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CAPS, isValidTurnStatus, parseScope, pickString } from '../../../client/debug/handlers-helpers.js'

describe('parseScope', () => {
  test('parses user scope', () => {
    expect(parseScope({ kind: 'user', userId: 'u1' })).toEqual({ kind: 'user', userId: 'u1' })
  })

  test('parses group scope', () => {
    expect(parseScope({ kind: 'group', groupId: 'g1', threadId: 't1' })).toEqual({
      kind: 'group',
      groupId: 'g1',
      threadId: 't1',
    })
  })

  test('falls back to global for invalid input', () => {
    expect(parseScope(null)).toEqual({ kind: 'global' })
    expect(parseScope({})).toEqual({ kind: 'global' })
    expect(parseScope({ kind: 'something-else' })).toEqual({ kind: 'global' })
  })
})

describe('isValidTurnStatus', () => {
  test('accepts known statuses', () => {
    expect(isValidTurnStatus('ok')).toBe(true)
    expect(isValidTurnStatus('error')).toBe(true)
    expect(isValidTurnStatus('running')).toBe(true)
    expect(isValidTurnStatus('cancelled')).toBe(true)
  })

  test('rejects unknown statuses', () => {
    expect(isValidTurnStatus('weird')).toBe(false)
  })
})

describe('pickString', () => {
  test('pickString returns the string or empty fallback', () => {
    expect(pickString({ a: 'hello' }, 'a')).toBe('hello')
    expect(pickString({ a: 42 }, 'a')).toBe('')
  })
})

describe('CAPS', () => {
  test('exposes well-known cap constants', () => {
    expect(CAPS.LOG).toBe(65535)
    expect(CAPS.NOTIFICATION).toBeGreaterThan(0)
    expect(CAPS.MEMO).toBeGreaterThan(0)
  })
})
