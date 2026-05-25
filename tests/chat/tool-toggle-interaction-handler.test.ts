// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
import { handleToolToggleInteraction } from '../../src/chat/tool-toggle-interaction-handler.js'
import type { IncomingInteraction } from '../../src/chat/types.js'
import { getToolPrefs } from '../../src/tools/tool-preferences.js'
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

  it('toggling a domain off persists a disabled domain for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).disabledDomains).toContain('memo')
  })

  it('rejects toggling for a context the user cannot manage', async () => {
    const { reply } = createMockReply()
    const otherCtx = Buffer.from('someone-else').toString('base64url')
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${otherCtx}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs('someone-else').disabledDomains).not.toContain('memo')
  })

  it('toggling a single tool off persists a false override for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).toolOverrides['delete_task']).toBe(false)
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
