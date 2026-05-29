// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, test } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { handleToolToggleInteraction } from '../../src/chat/tool-toggle-interaction-handler.js'
import type { IncomingInteraction } from '../../src/chat/types.js'
import { getToolPrefs, resolveToolPermission } from '../../src/tools/tool-preferences.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER = 'tgl-user-1'
const CTX = Buffer.from(USER).toString('base64url')

function dmInteraction(callbackData: string): IncomingInteraction {
  return {
    kind: 'button',
    callbackData,
    contextId: USER,
    contextType: 'dm',
    platformInstanceId: 'telegram-default',
    storageContextId: USER,
    user: { id: USER, username: null, isAdmin: false },
  }
}

describe('handleToolToggleInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
  })

  afterEach(() => {
    userCachesForTesting.delete(USER)
  })

  it('returns false for non-tgl callbacks', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction('plg:enable:x:y'), reply)
    expect(handled).toBe(false)
  })

  it('tapping a domain once cycles it from allow to ask', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).domainDefaults['memo']).toBe('ask')
  })

  it('tapping a domain twice cycles it from allow to ask to deny', async () => {
    const { reply: reply1 } = createMockReply()
    await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`), reply1)
    const { reply: reply2 } = createMockReply()
    await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`), reply2)
    expect(getToolPrefs(USER).domainDefaults['memo']).toBe('deny')
  })

  it('cycling a domain accepts a scoped personal DM target context', async () => {
    const scopedContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER })
    const scopedCtx = Buffer.from(scopedContextId).toString('base64url')
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(
      { ...dmInteraction(`tgl:dom:memo:${scopedCtx}`), storageContextId: scopedContextId },
      reply,
    )

    expect(handled).toBe(true)
    expect(getToolPrefs(scopedContextId).domainDefaults['memo']).toBe('ask')
  })

  it('rejects toggling for a context the user cannot manage', async () => {
    const { reply } = createMockReply()
    const otherCtx = Buffer.from('someone-else').toString('base64url')
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${otherCtx}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs('someone-else').domainDefaults['memo']).not.toBe('deny')
  })

  it('tapping a single tool once cycles it from allow to ask', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).toolOverrides['delete_task']).toBe('ask')
  })

  test('three taps cycle a tool through allow → ask → deny → allow', async () => {
    const prefs0 = getToolPrefs(USER)
    expect(resolveToolPermission(prefs0, 'delete_task')).toBe('allow')

    const { reply: r1 } = createMockReply()
    await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), r1)
    expect(resolveToolPermission(getToolPrefs(USER), 'delete_task')).toBe('ask')

    const { reply: r2 } = createMockReply()
    await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), r2)
    expect(resolveToolPermission(getToolPrefs(USER), 'delete_task')).toBe('deny')

    const { reply: r3 } = createMockReply()
    await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), r3)
    expect(resolveToolPermission(getToolPrefs(USER), 'delete_task')).toBe('allow')
  })

  it('renders the drill view for tgl:open and returns handled', async () => {
    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:open:task:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
  })

  it('renders the domain list for tgl:back and returns handled', async () => {
    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:back:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
  })
})
