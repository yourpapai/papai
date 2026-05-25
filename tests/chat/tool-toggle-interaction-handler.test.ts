// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
import { handleToolToggleInteraction } from '../../src/chat/tool-toggle-interaction-handler.js'
import { getToolPrefs } from '../../src/tools/tool-preferences.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER = 'tgl-user-1'
const CTX = Buffer.from(USER).toString('base64url')

function dmInteraction(callbackData: string) {
  return {
    kind: 'button' as const,
    callbackData,
    contextId: USER,
    contextType: 'dm' as const,
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
    const handled = await handleToolToggleInteraction(dmInteraction('plg:enable:x:y') as never, reply)
    expect(handled).toBe(false)
  })

  it('toggling a domain off persists a disabled domain for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`) as never, reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).disabledDomains).toContain('memo')
  })

  it('rejects toggling for a context the user cannot manage', async () => {
    const { reply } = createMockReply()
    const otherCtx = Buffer.from('someone-else').toString('base64url')
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${otherCtx}`) as never, reply)
    expect(handled).toBe(true)
    expect(getToolPrefs('someone-else').disabledDomains).not.toContain('memo')
  })
})
