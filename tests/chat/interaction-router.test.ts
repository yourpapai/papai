// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { AuthorizationResult, IncomingInteraction } from '../../src/chat/types.js'
import { createMockReply } from '../utils/test-helpers.js'

const auth = (allowed: boolean): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'tg:u1',
})

const interaction = (callbackData: string): IncomingInteraction => ({
  kind: 'button',
  user: { id: 'u1', username: null, isAdmin: false },
  contextId: 'tg:u1',
  contextType: 'dm',
  platformInstanceId: 'tg',
  storageContextId: 'tg:u1',
  callbackData,
})

describe('routeInteraction (post-retirement)', () => {
  test('rejects an unauthorized interaction', async () => {
    const { reply, getReplies } = createMockReply()
    const handled = await routeInteraction(interaction('anything'), reply, auth(false))
    expect(handled).toBe(true)
    expect(getReplies()[0]).toContain('not authorized')
  })

  test('matches no route for any callback and returns false', async () => {
    const { reply } = createMockReply()
    for (const data of ['cfg:edit:x', 'gsel:foo', 'wizard_confirm', 'plg:enable:p', 'tgl:dom:x', 'whatever']) {
      expect(await routeInteraction(interaction(data), reply, auth(true))).toBe(false)
    }
  })
})
