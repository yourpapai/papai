// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'

import { userCachesForTesting } from '../../src/cache.js'
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

const { buildFullToolSet } = await import('../../src/deferred-prompts/proactive-llm-full.js')

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
