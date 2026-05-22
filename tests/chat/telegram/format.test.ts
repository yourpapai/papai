// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatLlmOutput } from '../../../src/chat/telegram/format.js'

describe('formatLlmOutput - preprocessTables', () => {
  test('table preserves surrounding paragraph separation', () => {
    const result = formatLlmOutput(
      'Before.\n\n| Issue | Link |\n|-------|------|\n| ABC-123 | [ABC-123](https://linear.app/1) |\n\nAfter.',
    )
    expect(result.text).toBe('Before.\n\nIssue | Link\nABC-123 | ABC-123\n\nAfter.')
  })

  test('multiple tables with text between', () => {
    const result = formatLlmOutput(
      '| A | B |\n|---|---|\n| [x](https://a.com) | y |\n\nBetween.\n\n| C | D |\n|---|---|\n| z | [w](https://b.com) |',
    )
    expect(result.text).toBe('A | B\nx | y\n\nBetween.\n\nC | D\nz | w')
  })
})
