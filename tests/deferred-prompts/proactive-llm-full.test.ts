// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setConfig } from '../../src/config.js'
import { saveMemoryProfile } from '../../src/long-term-memory/store.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()

const buildMcpToolSetSpy = mock((_contextId: string): Promise<ToolSet> => Promise.resolve({}))

void mock.module('../../src/mcp/user-endpoints.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
}))

void mock.module('../../src/mcp/index.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
  buildPluginMcpToolSet: mock(
    (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
  ),
  mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
  convertMcpToolsToToolSet: mock(() => ({})),
}))

const { buildFullMessages, buildFullToolSet } = await import('../../src/deferred-prompts/proactive-llm-full.js')

const includesMessageText = (messages: readonly { content: unknown }[], text: string): boolean =>
  messages.some((message) => typeof message.content === 'string' && message.content.includes(text))

beforeEach(async () => {
  void mock.module('../../src/mcp/user-endpoints.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
  }))
  void mock.module('../../src/mcp/index.js', () => ({
    buildMcpToolSet: buildMcpToolSetSpy,
    buildPluginMcpToolSet: mock(
      (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
    ),
    mcpPool: { getOrCreateFromPlugin: mock(() => Promise.resolve({ hash: 'h', client: {} })) },
    convertMcpToolsToToolSet: mock(() => ({})),
  }))
  await setupTestDb()
  userCachesForTesting.clear()
  buildMcpToolSetSpy.mockClear()
  buildMcpToolSetSpy.mockResolvedValue({})
})

describe('buildFullToolSet async', () => {
  test('returns a Promise', () => {
    const provider = createMockProvider()
    const result = buildFullToolSet(provider, 'user-1', 'ctx-1', 'dm', 'test prompt')
    expect(result).toBeInstanceOf(Promise)
  })

  test('resolves to a tools object with enabledToolNames', async () => {
    const provider = createMockProvider()
    const result = await buildFullToolSet(provider, 'user-1', 'ctx-1', 'dm', 'test prompt')
    expect(result.tools).toBeDefined()
    expect(result.enabledToolNames).toBeInstanceOf(Set)
    expect(Object.keys(result.tools).length).toBeGreaterThan(0)
  })

  test('keeps the full proactive tool set for reminder prompts', async () => {
    const provider = createMockProvider()
    const neutral = await buildFullToolSet(provider, 'user-1', 'ctx-1', 'dm', 'test prompt')
    const reminder = await buildFullToolSet(provider, 'user-1', 'ctx-1', 'dm', 'remind me tomorrow')

    expect(Object.keys(reminder.tools).toSorted()).toEqual(Object.keys(neutral.tools).toSorted())
    expect(reminder.enabledToolNames).toEqual(neutral.enabledToolNames)
  })
})

describe('buildFullMessages', () => {
  test('uses group long-term memory for group thread contexts', () => {
    saveMemoryProfile(
      { scopeId: 'group-1', scopeType: 'group' },
      '## Group memory\n- Group release notes ship on Fridays',
      '2026-06-12T00:00:00.000Z',
    )
    saveMemoryProfile(
      { scopeId: 'group-1:thread-2', scopeType: 'personal' },
      '## Personal memory\n- This personal thread memory should not be injected',
      '2026-06-12T00:00:00.000Z',
    )

    const { messages } = buildFullMessages(
      'user-1',
      'group-1:thread-2',
      'scheduled',
      'Summarize releases',
      undefined,
      { mode: 'full', delivery_brief: 'Release digest', context_snapshot: null },
      'group',
    )

    expect(includesMessageText(messages, 'Group release notes ship on Fridays')).toBe(true)
    expect(includesMessageText(messages, 'This personal thread memory should not be injected')).toBe(false)
  })

  test('strips a thread-scoped owner id so the proactive trigger uses the main group timezone', () => {
    const scopedMainGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-9' })
    const threadOwnerId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-9',
      threadId: '42',
    })
    // Timezone is stored under the thread-stripped main group config context.
    setConfig(scopedMainGroupId, 'timezone', 'Europe/Berlin')

    // A thread-scoped owner id must still resolve the main group timezone.
    const { messages } = buildFullMessages(
      threadOwnerId,
      threadOwnerId,
      'scheduled',
      'Summarize releases',
      undefined,
      { mode: 'full', delivery_brief: 'Release digest', context_snapshot: null },
      'group',
    )

    // A regression that read the timezone under the raw thread-scoped owner id would fall back to UTC.
    expect(includesMessageText(messages, '(Europe/Berlin)')).toBe(true)
    expect(includesMessageText(messages, '(UTC)')).toBe(false)
  })
})
