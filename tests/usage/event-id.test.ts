// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toolCallEventId, usageEventId } from '../../src/usage/event-id.js'

describe('toolCallEventId', () => {
  test('returns a 64-character hex string', () => {
    const id = toolCallEventId('turn-abc', 'call-1')

    expect(id).toMatch(/^[0-9a-f]{64}$/u)
  })

  test('is stable for the same inputs', () => {
    const a = toolCallEventId('turn-abc', 'call-1')
    const b = toolCallEventId('turn-abc', 'call-1')

    expect(a).toBe(b)
  })

  test('differs when turnId changes', () => {
    const a = toolCallEventId('turn-abc', 'call-1')
    const b = toolCallEventId('turn-xyz', 'call-1')

    expect(a).not.toBe(b)
  })

  test('differs when toolCallId changes', () => {
    const a = toolCallEventId('turn-abc', 'call-1')
    const b = toolCallEventId('turn-abc', 'call-2')

    expect(a).not.toBe(b)
  })
})

describe('usageEventId', () => {
  test('returns a 64-character hex string', () => {
    const id = usageEventId('turn-abc', 'resp-1', 'main')

    expect(id).toMatch(/^[0-9a-f]{64}$/u)
  })

  test('is stable for the same inputs', () => {
    const a = usageEventId('turn-abc', 'resp-1', 'main')
    const b = usageEventId('turn-abc', 'resp-1', 'main')

    expect(a).toBe(b)
  })

  test('differs when modelRole changes', () => {
    const main = usageEventId('turn-abc', 'resp-1', 'main')
    const small = usageEventId('turn-abc', 'resp-1', 'small')

    expect(main).not.toBe(small)
  })

  test('differs when turnId changes', () => {
    const a = usageEventId('turn-1', 'resp-1', 'main')
    const b = usageEventId('turn-2', 'resp-1', 'main')

    expect(a).not.toBe(b)
  })

  test('differs when responseId changes', () => {
    const a = usageEventId('turn-1', 'resp-a', 'main')
    const b = usageEventId('turn-1', 'resp-b', 'main')

    expect(a).not.toBe(b)
  })

  test('accepts null turnId and remains stable', () => {
    const a = usageEventId(null, 'resp-1', 'main')
    const b = usageEventId(null, 'resp-1', 'main')

    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/u)
  })

  test('accepts null responseId and remains stable', () => {
    const a = usageEventId('turn-1', null, 'main')
    const b = usageEventId('turn-1', null, 'main')

    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/u)
  })

  test('does not throw when both turnId and responseId are null', () => {
    expect(() => usageEventId(null, null, 'main')).not.toThrow()
  })

  test('null turn + null response collides only across the same modelRole', () => {
    // Documenting the deterministic-id contract: with both ids missing,
    // only modelRole distinguishes calls. The recorder is responsible
    // for rejecting this case.
    const a = usageEventId(null, null, 'main')
    const b = usageEventId(null, null, 'main')
    const c = usageEventId(null, null, 'small')

    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
