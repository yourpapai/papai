// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IncomingInteraction, IncomingMessage, ResolveUserContext } from '../../src/chat/types.js'

describe('incoming chat platform instance shape', () => {
  test('IncomingMessage carries required platformInstanceId', () => {
    const message: IncomingMessage = {
      user: { id: 'user-1', username: null, isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      isMentioned: false,
      text: 'hello',
      platformInstanceId: 'telegram-default',
    }

    expect(message.platformInstanceId).toBe('telegram-default')
  })

  test('IncomingInteraction carries required platformInstanceId', () => {
    const interaction: IncomingInteraction = {
      kind: 'button',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      contextId: 'user-1',
      contextType: 'dm',
      storageContextId: 'user-1',
      callbackData: 'cfg:setup',
      platformInstanceId: 'mattermost-team',
    }

    expect(interaction.platformInstanceId).toBe('mattermost-team')
  })

  test('ResolveUserContext can carry platformInstanceId for router delegation', () => {
    const context: ResolveUserContext = {
      contextId: 'group-1',
      contextType: 'group',
      platformInstanceId: 'discord-prod',
    }

    expect(context.platformInstanceId).toBe('discord-prod')
  })
})
