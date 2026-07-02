// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for src/llm-orchestrator-tools.ts.
 *
 * Uses mock.module() for src/tools/index.js so that buildToolDescriptors can
 * be spied on with a controlled return value; all other collaborators (cache,
 * conversation, validation) use their real implementations
 * against the test DB.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import type { StagedFileDownloadFn } from '../src/attachments/types.js'
import { userCachesForTesting } from '../src/cache.js'
import type { LlmInvocationOptions, InvocationSource } from '../src/llm-orchestrator-tools.js'
import { buildLlmInvocationOpts } from '../src/llm-orchestrator-tools.js'
import { saveMemoryProfile } from '../src/long-term-memory/store.js'
import type { TaskProvider } from '../src/providers/types.js'
import { makeGetCurrentTimeTool } from '../src/tools/get-current-time.js'
import { applyGuestReadOnlyFilter } from '../src/tools/index.js'
import type { MakeToolsOptions } from '../src/tools/types.js'
import { createMockProvider } from './tools/mock-provider.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const NO_STAGED_DOWNLOAD: StagedFileDownloadFn | undefined = undefined as StagedFileDownloadFn | undefined

// ---------------------------------------------------------------------------
// Module-level spy: installed before the module under test is imported so that
// the lazy `import('../src/tools/index.js')` inside the module resolves to the
// mock. Bun's mock.module() is synchronous; the delayed `await import(…)` below
// picks up the registered mock.
// ---------------------------------------------------------------------------
const buildToolDescriptorsSpy = mock(
  (_provider: TaskProvider, _options: MakeToolsOptions): Promise<ToolSet> => Promise.resolve({}),
)
const buildProviderlessToolDescriptorsSpy = mock((_options: MakeToolsOptions): Promise<ToolSet> => Promise.resolve({}))

void mock.module('../src/tools/index.js', () => ({
  buildToolDescriptors: buildToolDescriptorsSpy,
  buildProviderlessToolDescriptors: buildProviderlessToolDescriptorsSpy,
  applyToolPreferences: (tools: ToolSet): ToolSet => tools,
  applyGuestReadOnlyFilter,
}))

// Import module under test AFTER mock registration so it sees the spy.
const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

const CTX_ID = 'ctx-tools-cache-test'
const CONFIG_ID = CTX_ID
const CHAT_USER_ID = 'user-tools-1'
const USERNAME = null

const baseOpts = (
  provider: TaskProvider,
  overrides: Partial<{ contextId: string; configId: string; userText: string }> = {},
): LlmInvocationOptions => ({
  contextId: overrides.contextId ?? CTX_ID,
  configId: overrides.configId ?? CONFIG_ID,
  chatUserId: CHAT_USER_ID,
  username: USERNAME,
  contextType: 'dm' as const,
  provider,
  history: [],
  userText: overrides.userText ?? 'hello',
  stagedDownloadFn: NO_STAGED_DOWNLOAD,
  askPermission: undefined,
})

describe('llm-orchestrator-tools / getOrCreateDescriptors cache behaviour', () => {
  let provider: TaskProvider

  beforeEach(async () => {
    // mock-reset's global beforeEach restores the real ../src/tools/index.js, so
    // re-install the spy here (after the restore) for every test in this suite.
    void mock.module('../src/tools/index.js', () => ({
      buildToolDescriptors: buildToolDescriptorsSpy,
      buildProviderlessToolDescriptors: buildProviderlessToolDescriptorsSpy,
      applyToolPreferences: (tools: ToolSet): ToolSet => tools,
      applyGuestReadOnlyFilter,
    }))
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
    buildToolDescriptorsSpy.mockClear()
    buildProviderlessToolDescriptorsSpy.mockClear()

    provider = createMockProvider()
  })

  test('buildToolDescriptors is called on the first invocation', async () => {
    await prepareLlmInvocation(baseOpts(provider))

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(1)
  })

  test('buildToolDescriptors result is reused on the second invocation when descriptors is an empty set', async () => {
    // First call — populates the cache with {}.
    await prepareLlmInvocation(baseOpts(provider))

    // Second call — must reuse the cached empty ToolSet.
    await prepareLlmInvocation(baseOpts(provider, { userText: 'world' }))

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(1)
  })

  test('buildToolDescriptors is called again for a different context even when descriptors is empty', async () => {
    await prepareLlmInvocation(baseOpts(provider))
    await prepareLlmInvocation(baseOpts(provider, { contextId: 'ctx-other', configId: 'ctx-other' }))

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(2)
  })

  test('buildToolDescriptors is called again in DM when username changes for the same context', async () => {
    await prepareLlmInvocation({
      ...baseOpts(provider, { contextId: 'ctx-dm-username', configId: 'ctx-dm-username' }),
      username: 'alice',
    })
    await prepareLlmInvocation({
      ...baseOpts(provider, { contextId: 'ctx-dm-username', configId: 'ctx-dm-username' }),
      username: 'bob',
    })

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(2)
  })

  test('provider-backed and providerless invocations do not share the same cache entry', async () => {
    buildToolDescriptorsSpy.mockResolvedValueOnce({ create_task: makeGetCurrentTimeTool('provider') })
    buildProviderlessToolDescriptorsSpy.mockResolvedValueOnce({ save_memo: makeGetCurrentTimeTool('providerless') })

    const providerBacked = await prepareLlmInvocation(
      baseOpts(provider, { contextId: 'ctx-shared', configId: 'ctx-shared' }),
    )
    const providerless = await prepareLlmInvocation({
      contextId: 'ctx-shared',
      configId: 'ctx-shared',
      chatUserId: CHAT_USER_ID,
      username: USERNAME,
      contextType: 'dm',
      provider: null,
      history: [],
      userText: 'remember this note',
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
      askPermission: undefined,
    })

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(1)
    expect(buildProviderlessToolDescriptorsSpy).toHaveBeenCalledTimes(1)
    expect(providerBacked.enabledToolNames.has('create_task')).toBe(true)
    expect(providerBacked.enabledToolNames.has('save_memo')).toBe(false)
    expect(providerless.enabledToolNames.has('save_memo')).toBe(true)
    expect(providerless.enabledToolNames.has('create_task')).toBe(false)
  })

  test('descriptor cache distinguishes stagedDownloadFn-sensitive tool sets', async () => {
    const stagedDownloadFn: StagedFileDownloadFn = mock(() => Promise.resolve(Buffer.from('file')))
    buildToolDescriptorsSpy
      .mockResolvedValueOnce({ search_staged_files: makeGetCurrentTimeTool('no-download') })
      .mockResolvedValueOnce({
        search_staged_files: makeGetCurrentTimeTool('with-download'),
        resolve_staged_file: makeGetCurrentTimeTool('with-download'),
      })

    const withoutDownload = await prepareLlmInvocation({
      ...baseOpts(provider, { contextId: 'ctx-staged', configId: 'ctx-staged' }),
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
    })
    const withDownload = await prepareLlmInvocation({
      ...baseOpts(provider, { contextId: 'ctx-staged', configId: 'ctx-staged' }),
      stagedDownloadFn,
    })

    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(2)
    expect(withoutDownload.enabledToolNames.has('search_staged_files')).toBe(true)
    expect(withoutDownload.enabledToolNames.has('resolve_staged_file')).toBe(false)
    expect(withDownload.enabledToolNames.has('resolve_staged_file')).toBe(true)
  })
})

describe('llm-orchestrator-tools / prepareLlmInvocation enabledToolNames', () => {
  let provider: TaskProvider

  beforeEach(async () => {
    // mock-reset's global beforeEach restores the real ../src/tools/index.js, so
    // re-install the spy here (after the restore) for every test in this suite.
    void mock.module('../src/tools/index.js', () => ({
      buildToolDescriptors: buildToolDescriptorsSpy,
      buildProviderlessToolDescriptors: buildProviderlessToolDescriptorsSpy,
      applyToolPreferences: (tools: ToolSet): ToolSet => tools,
      applyGuestReadOnlyFilter,
    }))
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
    buildToolDescriptorsSpy.mockClear()
    buildProviderlessToolDescriptorsSpy.mockClear()

    provider = createMockProvider()
  })

  test('returns enabledToolNames from the full tool set without routing', async () => {
    buildToolDescriptorsSpy.mockResolvedValueOnce({
      create_task: makeGetCurrentTimeTool('u'),
      save_memo: makeGetCurrentTimeTool('u'),
    })

    const result = await prepareLlmInvocation({
      contextId: 'ctx-prerouting',
      configId: 'ctx-prerouting',
      chatUserId: 'user-pr',
      username: null,
      contextType: 'dm',
      provider,
      history: [],
      userText: 'remember this note',
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
      askPermission: undefined,
    })

    expect(result.enabledToolNames instanceof Set).toBe(true)
    expect(result.enabledToolNames.has('create_task')).toBe(true)
    expect(result.enabledToolNames.has('save_memo')).toBe(true)
    // Progressive disclosure injects the search_tools/load_tool meta-tools on every turn.
    expect(Object.keys(result.tools).toSorted()).toEqual(['create_task', 'load_tool', 'save_memo', 'search_tools'])
  })

  test('uses providerless descriptors when provider is null', async () => {
    buildProviderlessToolDescriptorsSpy.mockResolvedValueOnce({
      save_memo: makeGetCurrentTimeTool('u'),
      get_current_time: makeGetCurrentTimeTool('u'),
    })

    const result = await prepareLlmInvocation({
      contextId: 'ctx-providerless',
      configId: 'ctx-providerless',
      chatUserId: 'user-pr',
      username: null,
      contextType: 'dm',
      provider: null,
      history: [],
      userText: 'remember this note',
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
      askPermission: undefined,
    })

    expect(buildProviderlessToolDescriptorsSpy).toHaveBeenCalledTimes(1)
    expect(buildToolDescriptorsSpy).toHaveBeenCalledTimes(0)
    expect(result.enabledToolNames.has('save_memo')).toBe(true)
    expect(result.enabledToolNames.has('get_current_time')).toBe(true)
  })

  test('injects group long-term memory using group scope', async () => {
    saveMemoryProfile(
      { scopeId: 'ctx-group-memory', scopeType: 'group' },
      '## Group memory\n- The group ships release notes on Fridays',
      '2026-06-12T00:00:00.000Z',
    )
    saveMemoryProfile(
      { scopeId: 'ctx-group-memory', scopeType: 'personal' },
      '## Personal memory\n- This should not be injected for group turns',
      '2026-06-12T00:00:00.000Z',
    )

    const result = await prepareLlmInvocation({
      contextId: 'ctx-group-memory',
      configId: 'ctx-group-memory',
      chatUserId: 'user-pr',
      username: null,
      contextType: 'group',
      provider,
      history: [{ role: 'user', content: 'What is our release note cadence?' }],
      userText: 'What is our release note cadence?',
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
      askPermission: undefined,
    })

    const systemMessage = result.validatedMessages[0]
    expect(systemMessage?.role).toBe('system')
    expect(systemMessage?.content).toContain('The group ships release notes on Fridays')
    expect(systemMessage?.content).not.toContain('This should not be injected for group turns')
  })
})

describe('buildFullToolSet / guest actorRole branch', () => {
  // Minimal tool stub — only the key (name) drives risk classification.
  const stub = (): ToolSet[string] =>
    tool({ description: '', inputSchema: z.object({}), execute: () => Promise.resolve(null) })

  let provider: TaskProvider

  beforeEach(async () => {
    void mock.module('../src/tools/index.js', () => ({
      buildToolDescriptors: buildToolDescriptorsSpy,
      buildProviderlessToolDescriptors: buildProviderlessToolDescriptorsSpy,
      // applyToolPreferences is a pass-through — guest path must not reach it
      applyToolPreferences: (_tools: ToolSet): ToolSet => {
        throw new Error('applyToolPreferences must not be called for a guest actor')
      },
      applyGuestReadOnlyFilter,
    }))
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
    buildToolDescriptorsSpy.mockClear()
    buildProviderlessToolDescriptorsSpy.mockClear()

    provider = createMockProvider()
  })

  test('guest actorRole yields read-only tool set and bypasses applyToolPreferences', async () => {
    // Mixed descriptor set: one read, one write, one open-world.
    buildToolDescriptorsSpy.mockResolvedValueOnce({
      list_tasks: stub(),
      create_task: stub(),
      web_fetch: stub(),
    })

    const result = await prepareLlmInvocation({
      contextId: 'ctx-guest-branch',
      configId: 'ctx-guest-branch',
      chatUserId: 'guest-user-1',
      username: null,
      contextType: 'group',
      provider,
      history: [],
      userText: 'what tasks are there?',
      stagedDownloadFn: NO_STAGED_DOWNLOAD,
      askPermission: undefined,
      actorRole: 'guest',
    })

    // Only the read-risk tool survives the guest filter; disclosure meta-tools are then
    // injected on top (bounded to the already-filtered surface — load_tool cannot reach
    // create_task/web_fetch since they are no longer registered in the session).
    expect(Object.keys(result.tools).sort()).toEqual(['list_tasks', 'load_tool', 'search_tools'])
    expect(result.enabledToolNames.has('list_tasks')).toBe(true)
    expect(result.enabledToolNames.has('create_task')).toBe(false)
    expect(result.enabledToolNames.has('web_fetch')).toBe(false)
  })
})

describe('buildLlmInvocationOpts / actorRole threading', () => {
  const makeSource = (overrides: Partial<InvocationSource> = {}): InvocationSource => ({
    reply: createMockReply().reply,
    contextId: 'ctx-actor-test',
    chatUserId: 'user-1',
    username: null,
    contextType: 'dm',
    history: [],
    userText: 'hello',
    ...overrides,
  })

  test('copies actorRole guest from InvocationSource into LlmInvocationOptions', () => {
    const src = makeSource({ actorRole: 'guest' })
    const opts = buildLlmInvocationOpts(src, 'cfg-1', null, undefined)
    expect(opts.actorRole).toBe('guest')
  })

  test('copies actorRole member from InvocationSource into LlmInvocationOptions', () => {
    const src = makeSource({ actorRole: 'member' })
    const opts = buildLlmInvocationOpts(src, 'cfg-1', null, undefined)
    expect(opts.actorRole).toBe('member')
  })

  test('actorRole is undefined in LlmInvocationOptions when not set on InvocationSource', () => {
    const src = makeSource()
    const opts = buildLlmInvocationOpts(src, 'cfg-1', null, undefined)
    expect(opts.actorRole).toBeUndefined()
  })
})
