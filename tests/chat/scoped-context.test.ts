// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'

describe('scoped chat context ids', () => {
  test('includes platform instance and native context', () => {
    expect(toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: '123' })).toBe(
      'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:MTIz',
    )
  })

  test('distinguishes identical native ids on different platform instances', () => {
    const telegram = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'shared' })
    const discord = toScopedContextId({ platformInstanceId: 'discord-default', nativeContextId: 'shared' })

    expect(telegram).not.toBe(discord)
  })

  test('adds thread component only when thread id is present', () => {
    expect(
      toScopedThreadContextId({
        platformInstanceId: 'mattermost-team',
        nativeContextId: 'channel-1',
        threadId: 'root-post',
      }),
    ).toBe('pi:bWF0dGVybW9zdC10ZWFt:ctx:Y2hhbm5lbC0x:thread:cm9vdC1wb3N0')
  })
})
