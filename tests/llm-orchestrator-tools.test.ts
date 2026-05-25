// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for src/llm-orchestrator-tools.ts.
 *
 * Uses mock.module() for src/tools/index.js so that makeTools can be spied
 * on with a controlled return value; all other collaborators (cache, conversation,
 * validation, tool-router) use their real implementations against the test DB.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'

import type { StagedFileDownloadFn } from '../src/attachments/types.js'
import { userCachesForTesting } from '../src/cache.js'
import type { TaskProvider } from '../src/providers/types.js'
import { makeGetCurrentTimeTool } from '../src/tools/get-current-time.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const NO_STAGED_DOWNLOAD: StagedFileDownloadFn | undefined = undefined as StagedFileDownloadFn | undefined

// ---------------------------------------------------------------------------
// Module-level spy: installed before the module under test is imported so that
// the lazy `import('../src/tools/index.js')` inside the module resolves to the
// mock. Bun's mock.module() is synchronous; the delayed `await import(…)` below
// picks up the registered mock.
// ---------------------------------------------------------------------------
const makeToolsSpy = mock((_provider: TaskProvider): ToolSet => ({}))

void mock.module('../src/tools/index.js', () => ({
  makeTools: makeToolsSpy,
}))

// Import module under test AFTER mock registration so it sees the spy.
const { prepareLlmInvocation } = await import('../src/llm-orchestrator-tools.js')

const CTX_ID = 'ctx-tools-cache-test'
const CONFIG_ID = CTX_ID
const CHAT_USER_ID = 'user-tools-1'
const USERNAME = null

describe('llm-orchestrator-tools / getOrCreateTools cache behaviour', () => {
  let provider: TaskProvider

  beforeEach(async () => {
    // mock-reset's global beforeEach restores the real ../src/tools/index.js, so
    // re-install the spy here (after the restore) for every test in this suite.
    void mock.module('../src/tools/index.js', () => ({ makeTools: makeToolsSpy }))
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
    makeToolsSpy.mockClear()

    provider = createMockProvider()
  })

  test('makeTools is called on the first invocation', () => {
    prepareLlmInvocation(CTX_ID, CONFIG_ID, CHAT_USER_ID, USERNAME, 'dm', provider, [], 'hello', NO_STAGED_DOWNLOAD)

    expect(makeToolsSpy).toHaveBeenCalledTimes(1)
  })

  test('makeTools result is reused on the second invocation when tools is an empty set', () => {
    // First call — populates the cache with {}.
    prepareLlmInvocation(CTX_ID, CONFIG_ID, CHAT_USER_ID, USERNAME, 'dm', provider, [], 'hello', NO_STAGED_DOWNLOAD)

    // Second call — must reuse the cached empty ToolSet.
    prepareLlmInvocation(CTX_ID, CONFIG_ID, CHAT_USER_ID, USERNAME, 'dm', provider, [], 'world', NO_STAGED_DOWNLOAD)

    expect(makeToolsSpy).toHaveBeenCalledTimes(1)
  })

  test('makeTools is called again for a different context even when tools is empty', () => {
    prepareLlmInvocation(CTX_ID, CONFIG_ID, CHAT_USER_ID, USERNAME, 'dm', provider, [], 'hello', NO_STAGED_DOWNLOAD)
    prepareLlmInvocation(
      'ctx-other',
      'ctx-other',
      CHAT_USER_ID,
      USERNAME,
      'dm',
      provider,
      [],
      'hello',
      NO_STAGED_DOWNLOAD,
    )

    expect(makeToolsSpy).toHaveBeenCalledTimes(2)
  })
})

describe('llm-orchestrator-tools / prepareLlmInvocation enabledToolNames', () => {
  let provider: TaskProvider

  beforeEach(async () => {
    // mock-reset's global beforeEach restores the real ../src/tools/index.js, so
    // re-install the spy here (after the restore) for every test in this suite.
    void mock.module('../src/tools/index.js', () => ({ makeTools: makeToolsSpy }))
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
    makeToolsSpy.mockClear()

    provider = createMockProvider()
  })

  test('returns enabledToolNames derived from makeTools result before routing', () => {
    // Use a memo-intent message: 'remember this note' matches MEMO_RE → intent='memo',
    // confidence=0.85 > HIGH_CONFIDENCE=0.65 → routing narrows to MEMO_DOMAINS
    // (memo/time/web). create_task (domain: task) is dropped; save_memo (domain: memo)
    // is kept. This proves enabledToolNames is sourced from the pre-routing full set.
    //
    // Tool factory values are placeholders — only the KEYS matter for enabledToolNames;
    // a real factory is used to satisfy the no-unsafe-type-assertion lint rule.
    makeToolsSpy.mockReturnValueOnce({
      // domain: task — dropped by memo routing
      create_task: makeGetCurrentTimeTool('u'),
      // domain: memo — kept by memo routing
      save_memo: makeGetCurrentTimeTool('u'),
    })

    const result = prepareLlmInvocation(
      'ctx-prerouting',
      'ctx-prerouting',
      'user-pr',
      null,
      'dm',
      provider,
      [],
      'remember this note',
      NO_STAGED_DOWNLOAD,
    )

    // Pre-routing origin: both keys are present in enabledToolNames even though
    // routing drops create_task.
    expect(result.enabledToolNames instanceof Set).toBe(true)
    expect(result.enabledToolNames.has('create_task')).toBe(true)
    expect(result.enabledToolNames.has('save_memo')).toBe(true)

    // Contrast: routing actually narrowed the set — create_task is absent from
    // routingResult.tools, confirming the two sets are genuinely different.
    expect(Object.keys(result.routingResult.tools)).not.toContain('create_task')
    expect(Object.keys(result.routingResult.tools)).toContain('save_memo')
  })
})
