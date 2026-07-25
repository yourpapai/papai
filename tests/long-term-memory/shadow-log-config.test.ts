// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  isShadowLoggingEnabled,
  shadowSampleRate,
  shouldSampleTurn,
} from '../../src/long-term-memory/shadow-log-config.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ENABLED_KEY = 'MEMORY_SHADOW_LOG_ENABLED'
const RATE_KEY = 'MEMORY_SHADOW_LOG_SAMPLE_RATE'

describe('isShadowLoggingEnabled', () => {
  const originalValue = process.env[ENABLED_KEY]

  afterEach(() => {
    if (originalValue === undefined) Reflect.deleteProperty(process.env, ENABLED_KEY)
    else process.env[ENABLED_KEY] = originalValue
  })

  test('is disabled when the flag is unset', () => {
    Reflect.deleteProperty(process.env, ENABLED_KEY)

    expect(isShadowLoggingEnabled()).toBe(false)
  })

  test('is enabled only for the exact string "true"', () => {
    process.env[ENABLED_KEY] = 'true'

    expect(isShadowLoggingEnabled()).toBe(true)
  })

  test('is disabled for any other value, including truthy-looking ones', () => {
    for (const value of ['1', 'TRUE', 'True', 'yes', '']) {
      process.env[ENABLED_KEY] = value

      expect(isShadowLoggingEnabled()).toBe(false)
    }
  })
})

describe('shadowSampleRate', () => {
  const originalValue = process.env[RATE_KEY]

  afterEach(() => {
    if (originalValue === undefined) Reflect.deleteProperty(process.env, RATE_KEY)
    else process.env[RATE_KEY] = originalValue
  })

  test('defaults to 0.1 when unset', () => {
    Reflect.deleteProperty(process.env, RATE_KEY)

    expect(shadowSampleRate()).toBe(0.1)
  })

  test('reads a valid in-range rate', () => {
    process.env[RATE_KEY] = '0.42'

    expect(shadowSampleRate()).toBe(0.42)
  })

  test('clamps values above 1 down to 1', () => {
    process.env[RATE_KEY] = '2.5'

    expect(shadowSampleRate()).toBe(1)
  })

  test('clamps negative values up to 0', () => {
    process.env[RATE_KEY] = '-1'

    expect(shadowSampleRate()).toBe(0)
  })

  test('falls back to the default for a malformed value', () => {
    process.env[RATE_KEY] = 'not-a-number'

    expect(shadowSampleRate()).toBe(0.1)
  })

  test('falls back to the default for an empty string', () => {
    process.env[RATE_KEY] = ''

    expect(shadowSampleRate()).toBe(0.1)
  })
})

describe('shouldSampleTurn', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('is deterministic across repeated calls for the same (contextId, turnRef, rate)', () => {
    const first = shouldSampleTurn('context-alpha', 'turn-1', 0.5)
    const second = shouldSampleTurn('context-alpha', 'turn-1', 0.5)
    const third = shouldSampleTurn('context-alpha', 'turn-1', 0.5)

    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  test('rate 0 never samples, across many distinct turnRefs', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(shouldSampleTurn('context-x', `turn-${index}`, 0)).toBe(false)
    }
  })

  test('rate 1 always samples, across many distinct turnRefs', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(shouldSampleTurn('context-x', `turn-${index}`, 1)).toBe(true)
    }
  })

  test('sampled fraction over many synthetic turnRefs is within tolerance of the rate', () => {
    const SAMPLE_COUNT = 5000
    const RATE = 0.3
    // Tolerance is +/- 3 percentage points.
    const TOLERANCE = 0.03

    const decisions = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
      shouldSampleTurn('context-stat', `synthetic-turn-${index}`, RATE),
    )
    const sampledCount = decisions.filter(Boolean).length

    const observedFraction = sampledCount / SAMPLE_COUNT
    expect(observedFraction).toBeGreaterThan(RATE - TOLERANCE)
    expect(observedFraction).toBeLessThan(RATE + TOLERANCE)
  })

  test('different contextId or turnRef values are evenly spread, not clustered', () => {
    const SAMPLE_COUNT = 5000
    const RATE = 0.5
    const TOLERANCE = 0.03

    const decisions = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
      shouldSampleTurn(`context-${index}`, 'fixed-turn', RATE),
    )
    const sampledCount = decisions.filter(Boolean).length

    const observedFraction = sampledCount / SAMPLE_COUNT
    expect(observedFraction).toBeGreaterThan(RATE - TOLERANCE)
    expect(observedFraction).toBeLessThan(RATE + TOLERANCE)
  })
})
