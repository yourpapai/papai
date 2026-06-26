// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatParticipantResolver } from '../../src/chat/participants/roster.js'
import { makeResolveChatParticipantTool } from '../../src/tools/resolve-chat-participant.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { getToolExecutor, schemaValidates } from '../utils/test-helpers.js'

const CONTEXT_ID = 'ctx-group-1'

function makeResolver(
  candidates: Array<{
    userId: string
    displayName: string
    username: string | null
    score: number
  }>,
): ChatParticipantResolver {
  return (_contextId, _query, _limit) => Promise.resolve(candidates)
}

describe('makeResolveChatParticipantTool', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('schema validates with required query field', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool, { query: 'alice' })).toBe(true)
  })

  test('schema validates with optional limit', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool, { query: 'bob', limit: 3 })).toBe(true)
  })

  test('schema rejects missing query', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool, {})).toBe(false)
  })

  test('schema rejects empty string query', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool, { query: '' })).toBe(false)
  })

  test('schema rejects whitespace-only query', () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    expect(schemaValidates(tool, { query: '   ' })).toBe(false)
  })

  test('returns ranked candidates from resolver', async () => {
    const candidate = {
      userId: 'u1',
      displayName: 'Alice Smith',
      username: 'alice',
      score: 3,
    }
    const tool = makeResolveChatParticipantTool(makeResolver([candidate]), CONTEXT_ID)
    const execute = getToolExecutor(tool)

    const result = await execute({ query: 'alice' })
    expect(result).toEqual([candidate])
  })

  test('returns empty array when resolver returns []', async () => {
    const tool = makeResolveChatParticipantTool(makeResolver([]), CONTEXT_ID)
    const execute = getToolExecutor(tool)

    const result = await execute({ query: 'nobody' })
    expect(result).toEqual([])
  })

  test('passes limit to resolver', async () => {
    let receivedLimit: number | undefined
    const resolver: ChatParticipantResolver = (_ctx, _q, limit) => {
      receivedLimit = limit
      return Promise.resolve([])
    }
    const tool = makeResolveChatParticipantTool(resolver, CONTEXT_ID)
    const execute = getToolExecutor(tool)

    await execute({ query: 'alice', limit: 2 })
    expect(receivedLimit).toBe(2)
  })

  test('passes contextId to resolver', async () => {
    let receivedContextId: string | undefined
    const resolver: ChatParticipantResolver = (ctx, _q, _limit) => {
      receivedContextId = ctx
      return Promise.resolve([])
    }
    const tool = makeResolveChatParticipantTool(resolver, CONTEXT_ID)
    const execute = getToolExecutor(tool)

    await execute({ query: 'alice' })
    expect(receivedContextId).toBe(CONTEXT_ID)
  })
})

describe('tool gating via buildTools', () => {
  // buildTools reads per-context tool prefs from the DB; install a migrated test DB so the
  // gating assertions don't depend on global DB state left by a prior test (CI has no dev
  // papai.db to fall back to, so the read throws "no such table: user_config" without this).
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('tool is absent when chatParticipantResolver is undefined', async () => {
    // buildTools with no chatParticipantResolver → no resolve_chat_participant
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'group', null, undefined, undefined)
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('tool is absent in dm context even when resolver is provided', async () => {
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'dm', null, undefined, fakeResolver)
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('tool is present in group context when resolver is provided', async () => {
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = buildTools(createMockProvider(), 'u1', 'ctx1', 'normal', 'group', null, undefined, fakeResolver)
    expect(tools['resolve_chat_participant']).toBeDefined()
  })

  test('tool is absent when contextId is undefined even with resolver and group context', async () => {
    const { buildTools } = await import('../../src/tools/tools-builder.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = buildTools(createMockProvider(), 'u1', undefined, 'normal', 'group', null, undefined, fakeResolver)
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })
})
