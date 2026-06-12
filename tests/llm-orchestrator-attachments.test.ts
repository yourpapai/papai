// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
  createInMemoryBlobStoreForTesting,
  saveAttachment,
} from '../src/attachments/index.js'
import { setCachedConfig } from '../src/cache.js'
import { buildUserTurnMessages } from '../src/llm-orchestrator-attachments.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Matches `<current_time>YYYY-MM-DD HH:MM (Weekday)</current_time>\nHello`
const TAG_THEN_HELLO = /^<current_time>\d{4}-\d{2}-\d{2} \d{2}:\d{2} \([A-Za-z]+\)<\/current_time>\nHello$/u

describe('llm-orchestrator-attachments', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
    delete process.env['S3_BUCKET']
    delete process.env['S3_ACCESS_KEY_ID']
    delete process.env['S3_SECRET_ACCESS_KEY']
  })

  describe('buildUserTurnMessages', () => {
    test('prepends a current_time tag when S3 is not configured', async () => {
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'user-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage.role).toBe('user')
      expect(modelMessage.content).toMatch(TAG_THEN_HELLO)
      // Same instant => model and history carry the identical tag + text.
      expect(historyMessage.content).toBe(modelMessage.content)
    })

    test('prepends the tag with no attachments even when S3 is configured', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'user-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage.content).toMatch(TAG_THEN_HELLO)
      expect(historyMessage.content).toBe(modelMessage.content)
    })

    test('resolves the timezone from chatUserId', async () => {
      // Asia/Karachi is UTC+5 (no DST); assert the tag shape is well-formed for a configured user.
      setCachedConfig('user-tz', 'timezone', 'Asia/Karachi')
      const utcResult = await buildUserTurnMessages('ctx-1', 'user-utc', 'gpt-4o', 'Hello', [])
      const tzResult = await buildUserTurnMessages('ctx-1', 'user-tz', 'gpt-4o', 'Hello', [])

      expect(utcResult.modelMessage.content).toMatch(TAG_THEN_HELLO)
      // The configured-timezone tag must also match the full pattern (which enforces two-digit HH:MM).
      expect(tzResult.modelMessage.content).toMatch(TAG_THEN_HELLO)

      // The +5h Asia/Karachi offset shifts the hour field, so the two tags can never be identical:
      // a regression that ignored chatUserId and always resolved UTC would make these equal.
      const utcContent = utcResult.modelMessage.content
      const tzContent = tzResult.modelMessage.content
      assert(typeof utcContent === 'string', 'expected string content')
      assert(typeof tzContent === 'string', 'expected string content')
      expect(utcContent).not.toBe(tzContent)
    })

    test('audio attachments never become file parts for multimodal models', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const savedAudio = await saveAttachment({
        contextId: 'ctx-a',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-a', 'u1', 'gpt-4o', 'listen', [savedAudio.attachmentId])
      assert(Array.isArray(modelMessage.content), 'expected multimodal content parts array')
      const parts = modelMessage.content as { type: string }[]
      expect(parts.some((p) => p.type === 'file')).toBe(false)
    })

    test('multimodal text part includes the attachment lines', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const savedImage = await saveAttachment({
        contextId: 'ctx-b',
        sourceProvider: 'telegram',
        filename: 'pic.png',
        status: 'available',
        content: Buffer.from('png'),
        mimeType: 'image/png',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-b', 'u1', 'gpt-4o', 'see', [savedImage.attachmentId])
      assert(Array.isArray(modelMessage.content), 'expected multimodal content parts array')
      const parts = modelMessage.content as { type: string; text?: string }[]
      const textPart = parts.find((p) => p.type === 'text')
      expect(textPart?.text).toContain(`[User attached ${savedImage.attachmentId}: pic.png]`)
    })

    test('text-only and multimodal paths carry identical attachment lines', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-c',
        sourceProvider: 'telegram',
        filename: 'doc.pdf',
        status: 'available',
        content: Buffer.from('pdf'),
        mimeType: 'application/pdf',
      })
      const textOnlyResult = await buildUserTurnMessages('ctx-c', 'u1', 'small-model', 'read', [saved.attachmentId])
      const multi = await buildUserTurnMessages('ctx-c', 'u1', 'gpt-4o', 'read', [saved.attachmentId])
      assert(typeof textOnlyResult.modelMessage.content === 'string', 'expected string content for text-only model')
      assert(Array.isArray(multi.modelMessage.content), 'expected multimodal content parts array')
      const parts = multi.modelMessage.content as { type: string; text?: string }[]
      const textPart = parts.find((p) => p.type === 'text')
      expect(textPart?.text).toBe(textOnlyResult.modelMessage.content)
    })

    test('without active transformer plugins, attachment lines pass through unchanged', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-d',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('a'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })
      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-d', 'u1', 'small-model', 'hi', [
        saved.attachmentId,
      ])
      assert(typeof modelMessage.content === 'string', 'expected string content for text-only model')
      assert(typeof historyMessage.content === 'string', 'expected string content for history message')
      expect(modelMessage.content).toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
      expect(historyMessage.content).toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
    })
  })
})
