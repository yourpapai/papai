// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { renderTableContext } from '../../src/chat/context-table-renderer.js'
import { standardContextSnapshot } from './fixtures/context-snapshot.js'

describe('renderTableContext', () => {
  test('returns a formatted result with header, grid, and localized table', () => {
    const result = renderTableContext(standardContextSnapshot)
    assert(result.method === 'formatted')
    expect(result.content).toContain('**Context**')
    expect(result.content).toContain('| Section | Tokens |')
    expect(result.content).toContain('| 🟦 **System prompt**')
    expect(result.content).toContain('6,770 / 128,000')
  })
})
