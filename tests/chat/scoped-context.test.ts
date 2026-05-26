// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  getNativeContextId,
  isScopedContextId,
  toScopedContextId,
  toScopedThreadContextId,
  toStorageContextId,
} from '../../src/chat/scoped-context.js'

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

  test('detects scoped context ids', () => {
    expect(isScopedContextId('pi:dGVsZWdyYW0:ctx:MTIz')).toBe(true)
    expect(isScopedContextId('group-123')).toBe(false)
  })

  test('rejects malformed scoped-looking context ids', () => {
    expect(isScopedContextId('pi:not-valid:ctx:')).toBe(false)
    expect(isScopedContextId('pi:abc:ctx:def')).toBe(false)
    expect(isScopedContextId('pi:dGVsZWdyYW0:ctx:')).toBe(false)
    expect(isScopedContextId('pi::ctx:MTIz')).toBe(false)
  })

  test('converts native ids to storage ids exactly once', () => {
    const scoped = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-123' })

    expect(toStorageContextId('telegram-default', 'group-123')).toBe(scoped)
    expect(toStorageContextId('telegram-default', scoped)).toBe(scoped)
  })

  test('does not pass through malformed scoped-looking ids as storage ids', () => {
    expect(toStorageContextId('telegram-default', 'pi:abc:ctx:def')).toBe(
      'pi:dGVsZWdyYW0tZGVmYXVsdA:ctx:cGk6YWJjOmN0eDpkZWY',
    )
  })

  test('returns native ids from scoped ids', () => {
    const scoped = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group:123' })

    expect(getNativeContextId(scoped)).toBe('group:123')
    expect(getNativeContextId('group-123')).toBe('group-123')
  })

  test('returns original input for invalid scoped-looking ids', () => {
    expect(getNativeContextId('pi:not-base64:ctx:also-not-base64')).toBe('pi:not-base64:ctx:also-not-base64')
    expect(getNativeContextId('pi:abc:ctx:def')).toBe('pi:abc:ctx:def')
  })
})
