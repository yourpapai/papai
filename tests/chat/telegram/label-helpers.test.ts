// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  formatTelegramUserLabel,
  resolveTelegramGroupLabel,
  resolveTelegramUserLabel,
} from '../../../src/chat/telegram/label-helpers.js'

test('formatTelegramUserLabel formats full name with username', () => {
  expect(formatTelegramUserLabel('John', 'Johnson', 'itsmike')).toBe('John Johnson (@itsmike)')
})

test('formatTelegramUserLabel formats first name only', () => {
  expect(formatTelegramUserLabel('John', undefined, undefined)).toBe('John')
})

test('formatTelegramUserLabel formats username only when name is empty', () => {
  expect(formatTelegramUserLabel('', undefined, 'itsmike')).toBe('@itsmike')
})

test('formatTelegramUserLabel returns null when all fields are empty', () => {
  expect(formatTelegramUserLabel('', undefined, undefined)).toBeNull()
})

test('resolveTelegramGroupLabel returns title from chat', async () => {
  const getChat = (_id: number): Promise<unknown> => Promise.resolve({ type: 'supergroup', title: 'Engineering Chat' })

  const label = await resolveTelegramGroupLabel(getChat, '-1001234567890')
  expect(label).toBe('Engineering Chat')
})

test('resolveTelegramGroupLabel returns null for non-numeric group ID', async () => {
  const getChat = (_id: number): Promise<unknown> => Promise.resolve({})
  const label = await resolveTelegramGroupLabel(getChat, 'not-a-number')
  expect(label).toBeNull()
})

test('resolveTelegramGroupLabel returns null when chat has no title', async () => {
  const getChat = (_id: number): Promise<unknown> => Promise.resolve({ type: 'private' })
  const label = await resolveTelegramGroupLabel(getChat, '-1001234567890')
  expect(label).toBeNull()
})

test('resolveTelegramUserLabel returns null for DM context', async () => {
  const getChatMember = (_cid: number, _uid: number): Promise<unknown> => Promise.resolve({})
  const label = await resolveTelegramUserLabel(getChatMember, '12345', {
    contextId: '12345',
    contextType: 'dm',
  })
  expect(label).toBeNull()
})

test('resolveTelegramUserLabel returns null for non-numeric user ID', async () => {
  const getChatMember = (_cid: number, _uid: number): Promise<unknown> => Promise.resolve({})
  const label = await resolveTelegramUserLabel(getChatMember, 'not-a-number', {
    contextId: '-1001234567890',
    contextType: 'group',
  })
  expect(label).toBeNull()
})
