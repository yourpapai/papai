// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { and, eq } from 'drizzle-orm'

import { recordGroupObservation } from '../src/bot-group-observation.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider } from '../src/chat/types.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { groupUserObservations, knownGroupContexts } from '../src/db/schema.js'
import type { KnownGroupContext } from '../src/group-settings/types.js'
import { createDmMessage, createGroupMessage, createMockChat, mockLogger, setupTestDb } from './utils/test-helpers.js'

function findKnownGroupContext(provider: string, contextId: string): KnownGroupContext | null {
  const row = getDrizzleDb()
    .select()
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, provider), eq(knownGroupContexts.contextId, contextId)))
    .get()
  if (row === undefined) return null
  return { ...row, source: 'observed' as const }
}

function findGroupUserObservation(
  provider: string,
  contextId: string,
  userId: string,
): { provider: string; contextId: string; userId: string; username: string | null; displayLabel: string } | null {
  const row = getDrizzleDb()
    .select()
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        eq(groupUserObservations.userId, userId),
      ),
    )
    .get()
  return row ?? null
}

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

    const scopedContextId = toScopedContextId({ platformInstanceId: 'mattermost-source', nativeContextId: 'group-1' })
    const knownContext = findKnownGroupContext('mattermost', scopedContextId)
    const userObservation = findGroupUserObservation('mattermost', scopedContextId, 'u1')
    expect(knownContext).not.toBeNull()
    assert.ok(knownContext !== null, 'expected mattermost known group context')
    expect(knownContext.displayName).toBe('Engineering')
    expect(findKnownGroupContext('router', 'group-1')).toBeNull()
    expect(findKnownGroupContext('mattermost', 'group-1')).toBeNull()
    expect(userObservation).not.toBeNull()
    assert.ok(userObservation !== null, 'expected mattermost user observation')
    expect(userObservation.displayLabel).toBe('User One')
  })
})
