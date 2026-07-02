// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for the who-may-use gate in src/llm-orchestrator-tools.ts.
 *
 * Uses the DI-first pattern via PrepareLlmInvocationDeps so that
 * applyWhoMayUseFilter can be tested directly (unit) and via
 * prepareLlmInvocation (integration).
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { userCachesForTesting } from '../src/cache.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import { setCodingGuardrails } from '../src/coding-credentials/guardrails.js'
import {
  applyWhoMayUseFilter,
  prepareLlmInvocation,
  type LlmInvocationOptions,
  type PrepareLlmInvocationDeps,
} from '../src/llm-orchestrator-tools.js'
import type { CompactionContext } from '../src/tools/compaction/types.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stub = (): ToolSet[string] =>
  tool({ description: '', inputSchema: z.object({}), execute: () => Promise.resolve(null) })

/** A PrepareLlmInvocationDeps that returns a fixed tool set and is otherwise pass-through. */
const makeDeps = (toolSet: ToolSet): PrepareLlmInvocationDeps => ({
  buildToolDescriptors: (): Promise<ToolSet> => Promise.resolve(toolSet),
  buildProviderlessToolDescriptors: (): Promise<ToolSet> => Promise.resolve(toolSet),
  applyResultCompaction: (tools: ToolSet, _ctx: CompactionContext): ToolSet => tools,
})

/** A full tool set with action + read-only acp tools plus a non-acp tool. */
const acpToolSet = (): ToolSet => ({
  plugin_acp__start_session: stub(),
  plugin_acp__review_pr: stub(),
  plugin_acp__finish_session: stub(),
  plugin_acp__cancel_session: stub(),
  plugin_acp__answer_permission: stub(),
  plugin_acp__list_sessions: stub(),
  plugin_acp__session_status: stub(),
  list_tasks: stub(),
})

// ---------------------------------------------------------------------------
// Unit tests for applyWhoMayUseFilter
// ---------------------------------------------------------------------------

describe('applyWhoMayUseFilter (unit)', () => {
  test('whoMayUse=members returns reference-identical tools', () => {
    const tools = acpToolSet()
    const result = applyWhoMayUseFilter(tools, 'members', 'any-user')
    // reference-identical: the default path must be a zero-cost pass-through
    expect(result).toBe(tools)
  })

  test('allowed user keeps all tools including action tools', () => {
    const tools = acpToolSet()
    const result = applyWhoMayUseFilter(tools, ['allowed-user'], 'allowed-user')
    expect(Object.keys(result).sort()).toEqual(Object.keys(tools).sort())
  })

  test('non-allowed user loses action tools but keeps read-only acp tools and non-acp tools', () => {
    const tools = acpToolSet()
    const result = applyWhoMayUseFilter(tools, ['allowed-user'], 'other-user')
    const names = Object.keys(result).sort()
    // Action tools must be gone
    expect(names).not.toContain('plugin_acp__start_session')
    expect(names).not.toContain('plugin_acp__review_pr')
    expect(names).not.toContain('plugin_acp__finish_session')
    expect(names).not.toContain('plugin_acp__cancel_session')
    expect(names).not.toContain('plugin_acp__answer_permission')
    // Read-only acp tools and other tools must remain
    expect(names).toContain('plugin_acp__list_sessions')
    expect(names).toContain('plugin_acp__session_status')
    expect(names).toContain('list_tasks')
  })

  test('non-allowed user loses continue_session but keeps list_sessions', () => {
    const tools: ToolSet = {
      plugin_acp__continue_session: stub(),
      plugin_acp__list_sessions: stub(),
    }
    const result = applyWhoMayUseFilter(tools, ['allowed-user'], 'other-user')
    const names = Object.keys(result)
    expect(names).not.toContain('plugin_acp__continue_session')
    expect(names).toContain('plugin_acp__list_sessions')
  })

  test('empty allowlist blocks everyone', () => {
    const tools = acpToolSet()
    const result = applyWhoMayUseFilter(tools, [], 'any-user')
    expect(Object.keys(result)).not.toContain('plugin_acp__start_session')
    expect(Object.keys(result)).toContain('plugin_acp__list_sessions')
  })

  test('tools without acp action keys are unchanged when user is excluded', () => {
    const tools: ToolSet = { list_tasks: stub(), save_memo: stub() }
    const result = applyWhoMayUseFilter(tools, ['other'], 'excluded-user')
    expect(Object.keys(result).sort()).toEqual(['list_tasks', 'save_memo'])
  })
})

// ---------------------------------------------------------------------------
// Integration tests via prepareLlmInvocation
// ---------------------------------------------------------------------------

/**
 * Build a valid scoped context ID on platformInstanceId 'pi-1'.
 * parseScopedContextId must successfully extract 'pi-1' from this.
 */
const PI = 'pi-1'
const GROUP_CTX = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'group-ctx' })

describe('buildFullToolSet / who-may-use filter (integration)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
  })

  const baseOpts = (chatUserId: string): LlmInvocationOptions => ({
    contextId: GROUP_CTX,
    configId: GROUP_CTX,
    chatUserId,
    username: null,
    contextType: 'group',
    provider: null,
    history: [],
    userText: 'start a session',
    stagedDownloadFn: undefined,
    askPermission: undefined,
  })

  test('whoMayUse=members (default) → allowed-user keeps all acp action tools (reference-identical path)', async () => {
    const toolSet = acpToolSet()
    const result = await prepareLlmInvocation(baseOpts('allowed-user'), makeDeps(toolSet))
    expect(result.enabledToolNames.has('plugin_acp__start_session')).toBe(true)
    expect(result.enabledToolNames.has('plugin_acp__review_pr')).toBe(true)
    expect(result.enabledToolNames.has('plugin_acp__list_sessions')).toBe(true)
  })

  test('whoMayUse=[allowed-user] → allowed-user keeps acp action tools', async () => {
    setCodingGuardrails(PI, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: ['allowed-user'],
      forceSharedKey: false,
    })
    const toolSet = acpToolSet()
    const result = await prepareLlmInvocation(baseOpts('allowed-user'), makeDeps(toolSet))
    expect(result.enabledToolNames.has('plugin_acp__start_session')).toBe(true)
    expect(result.enabledToolNames.has('plugin_acp__review_pr')).toBe(true)
  })

  test('whoMayUse=[allowed-user] → other-user loses acp action tools but keeps list_sessions', async () => {
    setCodingGuardrails(PI, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: ['allowed-user'],
      forceSharedKey: false,
    })
    const toolSet = acpToolSet()
    const result = await prepareLlmInvocation(baseOpts('other-user'), makeDeps(toolSet))
    expect(result.enabledToolNames.has('plugin_acp__start_session')).toBe(false)
    expect(result.enabledToolNames.has('plugin_acp__review_pr')).toBe(false)
    expect(result.enabledToolNames.has('plugin_acp__finish_session')).toBe(false)
    expect(result.enabledToolNames.has('plugin_acp__cancel_session')).toBe(false)
    expect(result.enabledToolNames.has('plugin_acp__answer_permission')).toBe(false)
    expect(result.enabledToolNames.has('plugin_acp__list_sessions')).toBe(true)
    expect(result.enabledToolNames.has('list_tasks')).toBe(true)
  })

  test('whoMayUse=members → both users keep all tools (reference-identical, not re-filtered)', async () => {
    setCodingGuardrails(PI, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: 'members',
      forceSharedKey: false,
    })
    const toolSet = acpToolSet()
    const resultAllowed = await prepareLlmInvocation(baseOpts('allowed-user'), makeDeps(toolSet))
    const resultOther = await prepareLlmInvocation(
      {
        ...baseOpts('other-user'),
        contextId: toScopedContextId({ platformInstanceId: PI, nativeContextId: 'group-ctx-2' }),
        configId: toScopedContextId({ platformInstanceId: PI, nativeContextId: 'group-ctx-2' }),
      },
      makeDeps(toolSet),
    )
    expect(resultAllowed.enabledToolNames.has('plugin_acp__start_session')).toBe(true)
    expect(resultOther.enabledToolNames.has('plugin_acp__start_session')).toBe(true)
  })

  test('contextId with no parseable platformInstanceId → no gating (prefTools unchanged)', async () => {
    const toolSet = acpToolSet()
    const result = await prepareLlmInvocation(
      { ...baseOpts('user-x'), contextId: 'unscoped-ctx', configId: 'unscoped-ctx' },
      makeDeps(toolSet),
    )
    expect(result.enabledToolNames.has('plugin_acp__start_session')).toBe(true)
  })
})
