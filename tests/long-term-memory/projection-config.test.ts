// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { isCanonicalProjectionEnabled } from '../../src/long-term-memory/projection-config.js'

const setSwitch = (value: string | undefined): void => {
  if (value === undefined) delete process.env['MEMORY_CANONICAL_PROJECTION']
  else process.env['MEMORY_CANONICAL_PROJECTION'] = value
}

describe('isCanonicalProjectionEnabled', () => {
  afterEach(() => {
    setSwitch(undefined)
  })

  test('projection is on when the variable is unset', () => {
    setSwitch(undefined)
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('the exact string "off" disables it', () => {
    setSwitch('off')
    expect(isCanonicalProjectionEnabled()).toBe(false)
  })

  test('an upper-case OFF does not disable it', () => {
    setSwitch('OFF')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('an empty value does not disable it', () => {
    setSwitch('')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })

  test('any other value leaves it enabled', () => {
    setSwitch('false')
    expect(isCanonicalProjectionEnabled()).toBe(true)
  })
})
