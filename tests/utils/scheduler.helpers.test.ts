// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  DEFAULT_OPTIONS,
  DEFAULT_TASK_OPTIONS,
  calculateBackoff,
  getErrorObject,
  getErrorMessage,
  mergeOptions,
  mergeTaskOptions,
} from '../../src/utils/scheduler.helpers.js'

describe('calculateBackoff', () => {
  let originalRandom: () => number = Math.random

  beforeEach(() => {
    originalRandom = Math.random
    Math.random = (): number => 0.5
  })

  afterEach(() => {
    Math.random = originalRandom
  })

  test('computes exponential backoff with deterministic jitter when Math.random is pinned to 0.5', () => {
    expect(calculateBackoff(0, 60000)).toBe(1050)
    expect(calculateBackoff(0, 500)).toBe(525)
    expect(calculateBackoff(5, 60000)).toBe(33600)
  })
})

describe('getErrorMessage', () => {
  test('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom')
  })

  test('returns a string argument unchanged', () => {
    expect(getErrorMessage('some message')).toBe('some message')
  })

  test('returns the fallback message for a non-string, non-Error value', () => {
    expect(getErrorMessage(42)).toBe('Unknown error')
  })
})

describe('getErrorObject', () => {
  test('returns the identical reference for an Error instance', () => {
    const err = new Error('boom')
    expect(getErrorObject(err)).toBe(err)
  })

  test('wraps a string argument in a new Error carrying that message', () => {
    const result = getErrorObject('hello')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('hello')
  })

  test('wraps a non-string, non-Error value in a new Error carrying the fallback message', () => {
    expect(getErrorObject(42).message).toBe('Unknown error')
  })
})

describe('DEFAULT_OPTIONS', () => {
  test('exposes the exact default scheduler options', () => {
    expect(DEFAULT_OPTIONS.unrefByDefault).toBe(true)
    expect(DEFAULT_OPTIONS.defaultRetries).toBe(3)
    expect(DEFAULT_OPTIONS.maxRetryDelay).toBe(60000)
  })
})

describe('DEFAULT_TASK_OPTIONS', () => {
  test('exposes the exact default task options', () => {
    expect(DEFAULT_TASK_OPTIONS.immediate).toBe(false)
    expect(DEFAULT_TASK_OPTIONS.retries).toBe(3)
    expect(DEFAULT_TASK_OPTIONS.unref).toBe(true)
  })
})

describe('mergeOptions', () => {
  test('returns the defaults when no options are given', () => {
    const merged = mergeOptions(undefined)
    expect(merged.unrefByDefault).toBe(true)
    expect(merged.defaultRetries).toBe(3)
    expect(merged.maxRetryDelay).toBe(60000)
  })

  test('overrides individual defaults while keeping the rest', () => {
    const merged = mergeOptions({ defaultRetries: 7 })
    expect(merged.defaultRetries).toBe(7)
    expect(merged.unrefByDefault).toBe(true)
    expect(merged.maxRetryDelay).toBe(60000)
  })
})

describe('mergeTaskOptions', () => {
  test('inherits retries and unref from scheduler defaults', () => {
    const merged = mergeTaskOptions(undefined, DEFAULT_OPTIONS)
    expect(merged.immediate).toBe(false)
    expect(merged.retries).toBe(3)
    expect(merged.unref).toBe(true)
  })

  test('lets explicit task options override scheduler defaults', () => {
    const merged = mergeTaskOptions(
      { immediate: true, retries: 5, unref: false },
      { unrefByDefault: true, defaultRetries: 3, maxRetryDelay: 60000 },
    )
    expect(merged.immediate).toBe(true)
    expect(merged.retries).toBe(5)
    expect(merged.unref).toBe(false)
  })
})
