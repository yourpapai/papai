// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test, expect, beforeEach } from 'bun:test'

import { userCachesForTesting } from '../src/cache.js'
import { saveInstruction, buildInstructionsBlock } from '../src/instructions.js'
import { resolveSystemPrompt } from '../src/llm-orchestrator-invoke.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('buildInstructionsBlock', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
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

describe('resolveSystemPrompt context propagation', () => {
  const provider = createMockProvider()
  const enabledToolNames = new Set(['create_deferred_prompt', 'list_deferred_prompts', 'get_current_time'])

  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('includes group reminder guidance when contextType is group', () => {
    const prompt = resolveSystemPrompt({
      provider,
      contextId: 'orch-grp-ctx',
      enabledToolNames,
      disclosure: undefined,
      contextType: 'group',
    })

    expect(prompt).toContain('GROUP REMINDERS')
  })

  test('omits group reminder guidance when contextType is dm', () => {
    const prompt = resolveSystemPrompt({
      provider,
      contextId: 'orch-dm-ctx',
      enabledToolNames,
      disclosure: undefined,
      contextType: 'dm',
    })

    expect(prompt).not.toContain('GROUP REMINDERS')
  })
})
