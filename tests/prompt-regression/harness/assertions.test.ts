// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assertContainsAll, assertContainsNone, normalizePromptText } from './assertions.js'

describe('prompt regression assertions', () => {
  test('normalizePromptText trims trailing spaces and collapses repeated blank lines', () => {
    const input = 'A  \n\n\nB\n'

    expect(normalizePromptText(input)).toBe('A\n\nB')
  })

  test('assertContainsAll reports missing required text', () => {
    expect(() => assertContainsAll('hello world', ['hello', 'missing'])).toThrow('Expected text to contain "missing"')
  })

  test('assertContainsNone reports forbidden text', () => {
    expect(() => assertContainsNone('hello secret world', ['secret'])).toThrow('Expected text not to contain "secret"')
  })
})
