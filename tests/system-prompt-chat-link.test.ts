// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildProviderlessSystemPrompt } from '../src/system-prompt.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('chat-link system prompt fragment', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('included when fetch_chat_link is enabled', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set(['fetch_chat_link']))
    expect(prompt).toContain('CHAT LINKS')
    expect(prompt).toContain('fetch_chat_link')
  })

  test('absent when fetch_chat_link is not enabled', () => {
    const prompt = buildProviderlessSystemPrompt('ctx-1', new Set<string>())
    expect(prompt).not.toContain('CHAT LINKS')
  })
})
