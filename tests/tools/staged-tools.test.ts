// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
} from '../../src/attachments/blob-store.js'
import { stageFileMetadata } from '../../src/attachments/staged.js'
import { makeResolveStagedFileTool, makeSearchStagedFilesTool } from '../../src/tools/staged-tools.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'ctx-staged-tools'

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractAttachmentId(value: unknown): string {
  assert(isNonNullObject(value))
  const maybeId = value['attachmentId']
  assert(typeof maybeId === 'string')
  return maybeId
}

describe('staged file tools', () => {
  let downloadCalls: Array<{ platformFileId: string }>

  const mockDownloadFn = (platformFileId: string): Promise<Buffer | null> => {
    downloadCalls.push({ platformFileId })
    if (platformFileId === 'tg_fail') return Promise.resolve(null)
    return Promise.resolve(Buffer.from('resolved-bytes'))
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
    downloadCalls = []

    await stageFileMetadata({
      contextId: CTX,
      messageId: 'msg-1',
      senderId: 'user-1',
      senderUsername: 'alice',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      platformFileId: 'tg_123',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'telegram-a',
    })

    await stageFileMetadata({
      contextId: CTX,
      messageId: 'msg-2',
      senderId: 'user-2',
      senderUsername: 'bob',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      size: 50,
      platformFileId: 'tg_456',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'telegram-a',
    })
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  describe('search_staged_files', () => {
    test('has correct description', () => {
      const t = makeSearchStagedFilesTool(CTX)
      expect(t.description).toContain('staged')
    })

    test('schema requires query', () => {
      const t = makeSearchStagedFilesTool(CTX)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { query: 'alice' })).toBe(true)
    })

    test('returns matching staged files', async () => {
      const execute = getToolExecutor(makeSearchStagedFilesTool(CTX))
      const result = await execute({ query: 'alice' })
      expect(result).toEqual(
        expect.arrayContaining([expect.objectContaining({ senderUsername: 'alice', filename: 'report.pdf' })]),
      )
    })

    test('searches by filename', async () => {
      const execute = getToolExecutor(makeSearchStagedFilesTool(CTX))
      const result = await execute({ query: 'notes' })
      expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ filename: 'notes.txt' })]))
    })
  })

  describe('resolve_staged_file', () => {
    test('resolves a staged file into a workspace attachment', async () => {
      const staged = await stageFileMetadata({
        contextId: CTX,
        messageId: 'msg-resolve',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'resolve-me.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_resolve_ok',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'telegram-a',
      })

      const execute = getToolExecutor(makeResolveStagedFileTool(CTX, mockDownloadFn))
      const result = await execute({ stagedId: staged.stagedId })

      expect(result).toMatchObject({ status: 'resolved', filename: 'resolve-me.pdf' })
      expect(downloadCalls).toHaveLength(1)
    })

    test('returns error for unknown staged ID', async () => {
      const execute = getToolExecutor(makeResolveStagedFileTool(CTX, mockDownloadFn))
      const result = await execute({ stagedId: 'stg_nonexistent' })
      expect(result).toMatchObject({ status: 'not_found' })
    })

    test('returns already_resolved with attachmentId when called twice', async () => {
      const staged = await stageFileMetadata({
        contextId: CTX,
        messageId: 'msg-dup',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'dup.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_dup',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'telegram-a',
      })

      const tool = makeResolveStagedFileTool(CTX, mockDownloadFn)
      const execute = getToolExecutor(tool)

      const first = await execute({ stagedId: staged.stagedId })
      expect(first).toMatchObject({ status: 'resolved', filename: 'dup.pdf' })

      const firstAttachmentId = extractAttachmentId(first)
      expect(firstAttachmentId).toMatch(/^att_[0-9a-f-]+$/u)

      const second = await execute({ stagedId: staged.stagedId })
      expect(second).toEqual({ status: 'already_resolved', attachmentId: firstAttachmentId })
    })
  })
})
