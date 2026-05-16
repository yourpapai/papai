// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test, mock } from 'bun:test'

import { buildSystemPrompt } from '../src/system-prompt.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('buildSystemPrompt', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('does not include current date and time in prompt (to preserve KV cache)', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).not.toContain('Current date and time:')
  })

  test('is static between calls (no dynamic content)', () => {
    const prompt1 = buildSystemPrompt(provider, 'user-1')
    // Small delay to ensure any dynamic content would differ
    const start = Date.now()
    while (Date.now() - start < 10) {
      // Busy wait for 10ms
    }
    const prompt2 = buildSystemPrompt(provider, 'user-1')
    expect(prompt1).toBe(prompt2)
  })

  test('includes web_fetch guidance for public URLs', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')

    expect(prompt).toContain('web_fetch')
    expect(prompt).toContain('public URL')
    expect(prompt).toContain('memo')
    expect(prompt).toContain('task')
  })
})
