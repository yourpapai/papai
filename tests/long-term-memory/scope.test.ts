// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { resolveMemoryScope } from '../../src/long-term-memory/scope.js'

describe('resolveMemoryScope', () => {
  test('uses personal scope for DMs', () => {
    expect(resolveMemoryScope({ storageContextId: 'user-1', contextType: 'dm' })).toEqual({
      scopeId: 'user-1',
      scopeType: 'personal',
    })
  })

  test('rolls scoped Telegram or Mattermost thread contexts up to parent group', () => {
    const parent = toScopedContextId({ platformInstanceId: 'telegram-main', nativeContextId: '-1001' })
    const thread = toScopedThreadContextId({
      platformInstanceId: 'telegram-main',
      nativeContextId: '-1001',
      threadId: '42',
    })

    expect(resolveMemoryScope({ storageContextId: thread, contextType: 'group' })).toEqual({
      scopeId: parent,
      scopeType: 'group',
    })
  })

  test('rolls legacy colon thread contexts up to the first segment', () => {
    expect(resolveMemoryScope({ storageContextId: 'group-1:thread-2', contextType: 'group' })).toEqual({
      scopeId: 'group-1',
      scopeType: 'group',
    })
  })

  test('keeps non-thread group contexts as group scope', () => {
    expect(resolveMemoryScope({ storageContextId: 'discord-channel-1', contextType: 'group' })).toEqual({
      scopeId: 'discord-channel-1',
      scopeType: 'group',
    })
  })
})
