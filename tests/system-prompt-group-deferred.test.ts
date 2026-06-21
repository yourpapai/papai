// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildSystemPrompt } from '../src/system-prompt.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('GROUP_DEFERRED population procedure', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('prompt includes resolve_chat_participant procedure when tool is enabled', () => {
    const provider = createMockProvider()
    const enabled = new Set(['create_deferred_prompt', 'list_deferred_prompts', 'resolve_chat_participant'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    expect(prompt).toContain('resolve_chat_participant')
    expect(prompt).toContain('mention_user_ids')
    expect(prompt).toContain('Resolve all names before creating')
  })

  test('prompt keeps original GROUP_DEFERRED content when resolve_chat_participant absent', () => {
    const provider = createMockProvider()
    const enabled = new Set(['create_deferred_prompt', 'list_deferred_prompts'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    // Original "remind me" line still present
    expect(prompt).toContain('remind me')
    expect(prompt).toContain('mention_user_ids')
  })
})
