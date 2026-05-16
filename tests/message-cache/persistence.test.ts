// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { and, eq, gt } from 'drizzle-orm'

import { messageMetadata } from '../../src/db/schema.js'
import { scheduleMessagePersistence, cleanupExpiredMessages } from '../../src/message-cache/persistence.js'
import type { CachedMessage } from '../../src/message-cache/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('Message Persistence', () => {
  let testDb: Awaited<ReturnType<typeof setupTestDb>>

  function loadMessages(contextId: string): CachedMessage[] {
    const now = Date.now()
    const rows = testDb
      .select()
      .from(messageMetadata)
      .where(and(eq(messageMetadata.contextId, contextId), gt(messageMetadata.expiresAt, now)))
      .all()

    return rows.map((row) => ({
      messageId: row.messageId,
      contextId: row.contextId,
      authorId: row.authorId ?? undefined,
      authorUsername: row.authorUsername ?? undefined,
      text: row.text ?? undefined,
      replyToMessageId: row.replyToMessageId ?? undefined,
      timestamp: row.timestamp,
    }))
  }

  beforeEach(async () => {
    mockLogger()
    testDb = await setupTestDb()
    // Clear table between tests
    testDb.delete(messageMetadata).run()
  })

  test('should persist messages to database via microtask flush', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Hello world',
      timestamp: now,
    })

    // Wait for microtask to flush
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('msg-1')
    expect(messages[0]?.text).toBe('Hello world')
    expect(messages[0]?.authorUsername).toBe('alice')
  })

  test('should batch multiple writes into single flush', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      authorId: 'user-1',
      text: 'First',
      timestamp: now,
    })

    scheduleMessagePersistence({
      messageId: 'msg-2',
      contextId: 'chat-1',
      authorId: 'user-2',
      text: 'Second',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(2)
  })

  test('should upsert on conflict', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'Original',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'Updated',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('Updated')
  })

  test('should load messages filtered by contextId', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: 'msg-1',
      contextId: 'chat-1',
      text: 'In chat 1',
      timestamp: now,
    })

    scheduleMessagePersistence({
      messageId: 'msg-2',
      contextId: 'chat-2',
      text: 'In chat 2',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const chat1Messages = loadMessages('chat-1')
    expect(chat1Messages).toHaveLength(1)
    expect(chat1Messages[0]?.text).toBe('In chat 1')

    const chat2Messages = loadMessages('chat-2')
    expect(chat2Messages).toHaveLength(1)
    expect(chat2Messages[0]?.text).toBe('In chat 2')
  })

  test('should not load expired messages', async () => {
    const expired = Date.now() - ONE_WEEK_MS - 1000

    scheduleMessagePersistence({
      messageId: 'msg-old',
      contextId: 'chat-1',
      text: 'Expired',
      timestamp: expired,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(0)
  })

  test('should cleanup expired messages', async () => {
    const expired = Date.now() - ONE_WEEK_MS - 1000

    scheduleMessagePersistence({
      messageId: 'msg-old',
      contextId: 'chat-1',
      text: 'Expired',
      timestamp: expired,
    })

    scheduleMessagePersistence({
      messageId: 'msg-new',
      contextId: 'chat-1',
      text: 'Fresh',
      timestamp: Date.now(),
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    cleanupExpiredMessages()

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.messageId).toBe('msg-new')
  })

  test('should not collide on same messageId across different contexts', async () => {
    const now = Date.now()

    scheduleMessagePersistence({
      messageId: '1',
      contextId: 'chat-A',
      text: 'From chat A',
      timestamp: now,
    })

    scheduleMessagePersistence({
      messageId: '1',
      contextId: 'chat-B',
      text: 'From chat B',
      timestamp: now,
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const chatA = loadMessages('chat-A')
    const chatB = loadMessages('chat-B')

    expect(chatA).toHaveLength(1)
    expect(chatA[0]?.text).toBe('From chat A')
    expect(chatB).toHaveLength(1)
    expect(chatB[0]?.text).toBe('From chat B')
  })

  test('should convert optional fields to undefined on load', async () => {
    scheduleMessagePersistence({
      messageId: 'msg-minimal',
      contextId: 'chat-1',
      timestamp: Date.now(),
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    const messages = loadMessages('chat-1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.authorId).toBeUndefined()
    expect(messages[0]?.authorUsername).toBeUndefined()
    expect(messages[0]?.text).toBeUndefined()
    expect(messages[0]?.replyToMessageId).toBeUndefined()
  })
})
