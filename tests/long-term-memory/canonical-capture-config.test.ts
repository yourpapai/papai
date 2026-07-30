// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { isCanonicalCaptureEnabled } from '../../src/long-term-memory/canonical-capture-config.js'

describe('isCanonicalCaptureEnabled', () => {
  const original = process.env['MEMORY_CANONICAL_CAPTURE']

  beforeEach(() => {
    delete process.env['MEMORY_CANONICAL_CAPTURE']
  })

  afterEach(() => {
    if (original === undefined) delete process.env['MEMORY_CANONICAL_CAPTURE']
    else process.env['MEMORY_CANONICAL_CAPTURE'] = original
  })

  test('is enabled by default when unset', () => {
    expect(isCanonicalCaptureEnabled()).toBe(true)
  })

  test('is enabled for an empty string', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = ''
    expect(isCanonicalCaptureEnabled()).toBe(true)
  })

  test('is enabled for any value other than the exact string off', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'OFF'
    expect(isCanonicalCaptureEnabled()).toBe(true)
  })

  test('is disabled only for the exact string off', () => {
    process.env['MEMORY_CANONICAL_CAPTURE'] = 'off'
    expect(isCanonicalCaptureEnabled()).toBe(false)
  })
})
