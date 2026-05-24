// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { recordGroupObservation } from '../src/bot-group-observation.js'
import type { ChatProvider } from '../src/chat/types.js'
import { findGroupUserObservation, findKnownGroupContext } from '../src/group-settings/registry.js'
import { createDmMessage, createGroupMessage, createMockChat, mockLogger, setupTestDb } from './utils/test-helpers.js'

function createRouterLikeChat(sourceProvider: ChatProvider): ChatProvider {
  return {
    ...createMockChat(),
    name: 'router',
    getInstance: (id: string) => (id === 'mattermost-source' ? { provider: sourceProvider } : null),
  } as ChatProvider
}

describe('bot-group-observation', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('skips non-group messages', () => {
    const chat = createMockChat()
    const msg = createDmMessage('u1', 'hello')
    expect(() => recordGroupObservation(chat, msg)).not.toThrow()
  })

  test('records source instance provider for router-delivered group messages', () => {
    const sourceProvider = { ...createMockChat(), name: 'mattermost' }
    const chat = createRouterLikeChat(sourceProvider)
    const msg = {
      ...createGroupMessage('u1', '/config', true, 'group-1'),
      platformInstanceId: 'mattermost-source',
      contextName: 'Engineering',
      user: { id: 'u1', username: 'user1', isAdmin: true, displayLabel: 'User One' },
    }

    recordGroupObservation(chat, msg)

    const knownContext = findKnownGroupContext('mattermost', 'group-1')
    const userObservation = findGroupUserObservation('mattermost', 'group-1', 'u1')
    expect(knownContext).not.toBeNull()
    assert.ok(knownContext !== null, 'expected mattermost known group context')
    expect(knownContext.displayName).toBe('Engineering')
    expect(findKnownGroupContext('router', 'group-1')).toBeNull()
    expect(userObservation).not.toBeNull()
    assert.ok(userObservation !== null, 'expected mattermost user observation')
    expect(userObservation.displayLabel).toBe('User One')
  })
})
