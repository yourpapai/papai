// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test, expect, beforeEach } from 'bun:test'

import { _userCaches } from '../src/cache.js'
import { saveInstruction, buildInstructionsBlock } from '../src/instructions.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('buildInstructionsBlock', () => {
  beforeEach(async () => {
    mockLogger()
    _userCaches.clear()
    await setupTestDb()
  })

  test('includes custom instructions block when instructions exist', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    saveInstruction('ctx-1', 'Use high priority by default')
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toContain('=== Custom instructions ===')
    expect(block).toContain('- Always reply in Spanish')
    expect(block).toContain('- Use high priority by default')
  })

  test('returns empty string when no instructions', () => {
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toBe('')
  })

  test('formats instructions as bullet list', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const block = buildInstructionsBlock('ctx-1')
    expect(block).toStartWith('=== Custom instructions ===\n- Always reply in Spanish')
  })
})
