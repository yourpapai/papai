// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setConfigValue, setPluginConfig } from '../../src/config.js'
import { setPluginEnabledForContext } from '../../src/plugins/registry.js'
import { applyToolPreferences, makeTools } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'test-tool-prefs-index-user'

const buildDescriptorCacheKeys = (contextId: string, chatUserId: string, username: string): readonly string[] =>
  [
    'provider-backed:no-staged-download',
    'provider-backed:with-staged-download',
    'providerless:no-staged-download',
    'providerless:with-staged-download',
  ].map((prefix) => `${prefix}:${contextId}:${chatUserId}:${username}`)

type CacheInvalidationFixtures = Readonly<{
  parentContextId: string
  threadContextId: string
  parentCacheKeys: readonly string[]
  threadCacheKeys: readonly string[]
  otherCacheKey: string
}>

const getCacheInvalidationFixtures = (): CacheInvalidationFixtures => {
  const parentContextId = toScopedContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
  })
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-1',
  })
  return {
    parentContextId,
    threadContextId,
    parentCacheKeys: buildDescriptorCacheKeys(parentContextId, 'user-1', 'alice'),
    threadCacheKeys: buildDescriptorCacheKeys(threadContextId, 'user-1', 'alice'),
    otherCacheKey: 'provider-backed:no-staged-download:other-context:user-1:alice',
  }
}

const seedParentThreadAndUnrelatedToolCaches = (): CacheInvalidationFixtures => {
  const fixtures = getCacheInvalidationFixtures()
  for (const key of fixtures.parentCacheKeys) setCachedTools(key, { save_memo: {} })
  for (const key of fixtures.threadCacheKeys) setCachedTools(key, { save_memo: {} })
  setCachedTools(fixtures.otherCacheKey, { save_memo: {} })
  return fixtures
}

const expectParentThreadCachesCleared = (
  parentCacheKeys: readonly string[],
  threadCacheKeys: readonly string[],
  otherCacheKey: string,
): void => {
  for (const key of parentCacheKeys) expect(getCachedTools(key)).toBeUndefined()
  for (const key of threadCacheKeys) expect(getCachedTools(key)).toBeUndefined()
  expect(getCachedTools(otherCacheKey)).toEqual({ save_memo: {} })
}

beforeEach(async () => {
  userCachesForTesting.clear()
  mockLogger()
  await setupTestDb()
})

afterEach(() => {
  userCachesForTesting.clear()
})

describe('makeTools', () => {
  test('exposes lookup_group_history only for scoped thread context ids', async () => {
    const provider = createMockProvider()
    const scopedMainContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const scopedThreadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })

    expect(await makeTools(provider, { storageContextId: scopedThreadContextId, chatUserId: 'user-1' })).toHaveProperty(
      'lookup_group_history',
    )
    expect(
      await makeTools(provider, { storageContextId: scopedMainContextId, chatUserId: 'user-1' }),
    ).not.toHaveProperty('lookup_group_history')
  })

  test('zero-arg makeTools does not synthesize an empty-string user owner', async () => {
    const provider = createMockProvider()

    const tools = await makeTools(provider)

    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).not.toContain('create_recurring_task')
    expect(Object.keys(tools)).not.toContain('save_instruction')
  })
})

describe('makeTools preference filtering', () => {
  test('returns the full set when no prefs are configured', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  test('removes a tool whose domain is disabled', async () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('applies parent group tool preferences in thread context', async () => {
    const provider = createMockProvider()
    const parentContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })
    setToolPrefs(parentContextId, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })

    const tools = await makeTools(provider, {
      storageContextId: threadContextId,
      chatUserId: 'user-1',
      contextType: 'group',
    })

    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).not.toContain('search_memos')
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('lookup_group_history')
  })

  test('honors a per-tool override that disables one tool in an enabled domain', async () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })

  test('clears cached parent and thread toolsets when parent preferences change', () => {
    const { parentContextId, parentCacheKeys, threadCacheKeys, otherCacheKey } =
      seedParentThreadAndUnrelatedToolCaches()

    setToolPrefs(parentContextId, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })

    expectParentThreadCachesCleared(parentCacheKeys, threadCacheKeys, otherCacheKey)
  })

  test('clears cached parent and thread toolsets when parent plugin enablement changes', () => {
    const { parentContextId, parentCacheKeys, threadCacheKeys, otherCacheKey } =
      seedParentThreadAndUnrelatedToolCaches()

    setPluginEnabledForContext('hello-world', parentContextId, true)

    expectParentThreadCachesCleared(parentCacheKeys, threadCacheKeys, otherCacheKey)
  })

  test('clears cached parent and thread toolsets when parent plugin config changes', () => {
    const { parentContextId, parentCacheKeys, threadCacheKeys, otherCacheKey } =
      seedParentThreadAndUnrelatedToolCaches()

    setPluginConfig(parentContextId, 'hello-world', 'greeting', 'hi')

    expectParentThreadCachesCleared(parentCacheKeys, threadCacheKeys, otherCacheKey)
  })

  test('clears cached parent and thread toolsets when parent MCP endpoints config changes', () => {
    const { parentContextId, parentCacheKeys, threadCacheKeys, otherCacheKey } =
      seedParentThreadAndUnrelatedToolCaches()

    setConfigValue(parentContextId, 'mcp_endpoints', '[]')

    expectParentThreadCachesCleared(parentCacheKeys, threadCacheKeys, otherCacheKey)
  })
})

function fakeTool(name: string): ToolSet[string] {
  return tool({
    description: `fake ${name}`,
    inputSchema: z.object({ id: z.string() }),
    execute: ({ id }: { id: string }) => Promise.resolve(`${name}:${id}`),
  })
}

describe('applyToolPreferences (ask integration)', () => {
  const contextId = 'ctx-ask-1'

  test('deny removes tool from set', () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    const tools: ToolSet = { create_task: fakeTool('create_task'), list_tasks: fakeTool('list_tasks') }
    const result = applyToolPreferences(tools, contextId, undefined)
    expect(Object.keys(result).toSorted()).toEqual(['list_tasks'])
  })

  test('allow leaves tool unwrapped', () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: {} })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, undefined)
    expect(result['create_task']).toBe(tools['create_task'])
  })

  test('ask wraps execute and extends schema', async () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, () => Promise.resolve('allow' as const))
    const wrapped = result['create_task']
    expect(wrapped).toBeDefined()
    // Schema must be extended: still a ZodObject but with _permission_reason added.
    expect(wrapped!.inputSchema).toBeInstanceOf(z.ZodObject)
    expect(wrapped!.inputSchema).not.toBe(tools['create_task']!.inputSchema)
    // Execute must pass through when permission is granted.
    const executeFn = wrapped!.execute
    expect(executeFn).toBeDefined()
    const out: unknown = await executeFn!({ id: 'X', _permission_reason: 'r' }, { toolCallId: 't1', messages: [] })
    expect(out).toBe('create_task:X')
  })

  test('ask denies when no askPermission provided', async () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, undefined)
    const executeFn = result['create_task']!.execute
    expect(executeFn).toBeDefined()
    const out: unknown = await executeFn!({ id: 'X', _permission_reason: 'r' }, { toolCallId: 't1', messages: [] })
    expect(out).toMatchObject({ status: 'permission_denied' })
  })
})
