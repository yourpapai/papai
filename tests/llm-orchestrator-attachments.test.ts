// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
  createInMemoryBlobStoreForTesting,
} from '../src/attachments/blob-store.js'
import { buildUserTurnMessages } from '../src/llm-orchestrator-attachments.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

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
    test('returns text-only messages when S3 is not configured', async () => {
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage).toEqual({ role: 'user', content: 'Hello' })
      expect(historyMessage).toEqual({ role: 'user', content: 'Hello' })
    })

    test('returns text-only messages with no attachments even when S3 is configured', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage).toEqual({ role: 'user', content: 'Hello' })
      expect(historyMessage).toEqual({ role: 'user', content: 'Hello' })
    })
  })
})
