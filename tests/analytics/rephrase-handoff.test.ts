// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../src/analytics/controlled-types.js'
import type { Pseudonym } from '../../src/analytics/controlled-types.js'
import { createRephraseHandoff } from '../../src/analytics/rephrase/handoff.js'
import type { RephraseHandoff } from '../../src/analytics/rephrase/handoff.js'

const T0 = 1_700_000_000_000
const px = (suffix: string): Pseudonym => PseudonymSchema.parse(`v1.${suffix}`)

describe('frozen RephraseHandoff lifecycle seam', () => {
  test('the seam exposes exactly captureText, completeTurn, and withdraw', () => {
    const { handoff } = createRephraseHandoff({ nowMs: () => T0 })
    const surface = Object.keys(handoff).sort()
    expect(surface).toEqual(['captureText', 'completeTurn', 'withdraw'])
    const seam: RephraseHandoff = handoff
    expect(typeof seam.captureText).toBe('function')
    expect(typeof seam.completeTurn).toBe('function')
    expect(typeof seam.withdraw).toBe('function')
  })

  test('each seam method returns void', () => {
    const { handoff } = createRephraseHandoff({ nowMs: () => T0 })
    const captureResult = handoff.captureText({
      actorKey: px('actor'),
      conversationKey: px('conv'),
      turnKey: px('turn'),
      capturedAtMs: T0,
      text: 'a normal analysis message',
    })
    expect(captureResult).toBeUndefined()
    expect(handoff.completeTurn({ turnKey: px('turn'), completedAtMs: T0 + 1, outcome: 'discard' })).toBeUndefined()
    expect(handoff.withdraw({ actorKey: px('actor') })).toBeUndefined()
  })

  test('post-auth capture builds features immediately and returns without retaining the raw string', () => {
    const canary = 'CANARY-post-auth-91c2e7-zephyr-marmoset'
    const { handoff, inspect } = createRephraseHandoff({ nowMs: () => T0 })
    handoff.captureText({
      actorKey: px('actor'),
      conversationKey: px('conv'),
      turnKey: px('turn'),
      capturedAtMs: T0,
      text: canary,
    })
    const snapshot = inspect()
    expect(snapshot.conversations).toHaveLength(1)
    expect(snapshot.conversations[0]?.sets[0]?.shingleCount).toBeGreaterThan(0)
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('zephyr')
    expect(serialized).not.toContain('marmoset')
  })
})
