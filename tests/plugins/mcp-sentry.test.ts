// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { sanitizeObject } from '../../plugins/mcp-sentry/format.js'

describe('mcp-sentry sanitizeObject', () => {
  test('masks secret-ish keys, leaves others', () => {
    const input = { token: 'abc', name: 'Bob', inner: { password: 'p', ok: 1 } }
    expect(sanitizeObject(input)).toEqual({
      token: '[REDACTED]',
      name: 'Bob',
      inner: { password: '[REDACTED]', ok: 1 },
    })
  })

  test('does not mask a key literally named "key"', () => {
    expect(sanitizeObject({ key: 'keep-me', apikey: 'x' })).toEqual({ key: 'keep-me', apikey: '[REDACTED]' })
  })

  test('leaves falsy secret values as-is', () => {
    expect(sanitizeObject({ token: '', secret: 0 })).toEqual({ token: '', secret: 0 })
  })

  test('recurses through arrays', () => {
    expect(sanitizeObject([{ token: 'a' }, { name: 'b' }])).toEqual([{ token: '[REDACTED]' }, { name: 'b' }])
  })

  test('passes primitives through', () => {
    expect(sanitizeObject('hello')).toBe('hello')
    expect(sanitizeObject(42)).toBe(42)
    expect(sanitizeObject(null)).toBe(null)
  })
})
