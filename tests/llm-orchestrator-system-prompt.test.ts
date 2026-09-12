// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, test, expect, beforeEach } from 'bun:test'

import { userCachesForTesting } from '../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import { setConfigValue } from '../src/config.js'
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
  const enabledToolNames = new Set(['create_reminder', 'list_reminders', 'get_current_time'])

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

describe('resolveSystemPrompt locale resolution', () => {
  const provider = createMockProvider()
  const enabledToolNames = new Set(['create_reminder', 'list_reminders', 'get_current_time'])

  // A Telegram-style group: thread-scoped storage context, group-shared config context.
  const groupConfigId = toScopedContextId({ platformInstanceId: 'tg', nativeContextId: 'group-1' })
  const threadStorageId = toScopedThreadContextId({
    platformInstanceId: 'tg',
    nativeContextId: 'group-1',
    threadId: 't1',
  })

  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
  })

  test('without an explicit config context, a thread-scoped storage id derives its group config', () => {
    setConfigValue(groupConfigId, 'language', 'ru')

    const prompt = resolveSystemPrompt({
      provider,
      contextId: threadStorageId,
      enabledToolNames,
      disclosure: undefined,
      contextType: 'group',
    })

    expect(prompt).toContain('Отвечай пользователю на русском языке')
  })

  test('a ru config context with an en-language neighbour stays isolated per config context', () => {
    setConfigValue(groupConfigId, 'language', 'ru')

    const prompt = resolveSystemPrompt({
      provider,
      contextId: toScopedThreadContextId({ platformInstanceId: 'tg', nativeContextId: 'group-2', threadId: 't9' }),
      enabledToolNames,
      disclosure: undefined,
      contextType: 'group',
    })

    expect(prompt).toContain('Always write your replies to the user in English')
  })
})
