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
} from '../src/attachments/blob-store.js'
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
  })
})
