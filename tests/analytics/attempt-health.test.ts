// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { deriveAttemptHealth } from '../../src/analytics/attempt-health.js'

const T0 = 1_700_000_000_000
const TIMEOUT = 5 * 60 * 1000

describe('deriveAttemptHealth', () => {
  test('a terminated attempt is closed regardless of age', () => {
    const health = deriveAttemptHealth(
      [{ rawAttemptId: 'a', startedAtMs: T0 - 10 * 60 * 1000, terminalAtMs: T0 }],
      T0 + 60 * 60 * 1000,
      TIMEOUT,
    )
    expect(health).toEqual([{ rawAttemptId: 'a', status: 'closed' }])
  })

  test('an unterminated attempt inside the timeout is open', () => {
    const health = deriveAttemptHealth([{ rawAttemptId: 'a', startedAtMs: T0, terminalAtMs: null }], T0 + 1000, TIMEOUT)
    expect(health).toEqual([{ rawAttemptId: 'a', status: 'open' }])
  })

  test('an unterminated attempt past the timeout is aged_open, never a provider failure', () => {
    const health = deriveAttemptHealth(
      [{ rawAttemptId: 'a', startedAtMs: T0, terminalAtMs: null }],
      T0 + TIMEOUT + 1,
      TIMEOUT,
    )
    expect(health).toEqual([{ rawAttemptId: 'a', status: 'aged_open' }])
    expect(health[0]!.status).not.toBe('provider_failure')
  })

  test('an unterminated attempt exactly at the timeout boundary is still open', () => {
    const health = deriveAttemptHealth(
      [{ rawAttemptId: 'a', startedAtMs: T0, terminalAtMs: null }],
      T0 + TIMEOUT,
      TIMEOUT,
    )
    expect(health).toEqual([{ rawAttemptId: 'a', status: 'open' }])
  })
})
