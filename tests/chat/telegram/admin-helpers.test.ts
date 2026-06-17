// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { isTelegramGroupAdmin } from '../../../src/chat/telegram/admin-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('isTelegramGroupAdmin', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns true for creator and administrator statuses', async () => {
    const creator = await isTelegramGroupAdmin(() => Promise.resolve({ status: 'creator' }), '-100', '42')
    const admin = await isTelegramGroupAdmin(() => Promise.resolve({ status: 'administrator' }), '-100', '42')
    expect(creator).toBe(true)
    expect(admin).toBe(true)
  })

  test('returns false for non-admin members', async () => {
    const result = await isTelegramGroupAdmin(() => Promise.resolve({ status: 'member' }), '-100', '42')
    expect(result).toBe(false)
  })

  test('passes numeric chat and user ids to getChatMember', async () => {
    const getChatMember = mock((_chatId: number, _userId: number) => Promise.resolve({ status: 'administrator' }))
    await isTelegramGroupAdmin(getChatMember, '-100', '42')
    expect(getChatMember).toHaveBeenCalledWith(-100, 42)
  })

  test('returns null for non-numeric ids', async () => {
    const result = await isTelegramGroupAdmin(() => Promise.resolve({ status: 'creator' }), 'not-a-number', '42')
    expect(result).toBeNull()
  })

  test('returns null when the lookup throws', async () => {
    const result = await isTelegramGroupAdmin(() => Promise.reject(new Error('not found')), '-100', '42')
    expect(result).toBeNull()
  })
})
