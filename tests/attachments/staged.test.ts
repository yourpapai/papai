// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  resolveStagedFile,
  searchStagedFiles,
  stageFileMetadata as rawStageFileMetadata,
} from '../../src/attachments/staged.js'
import type { StageFileParams, StagedFileRef } from '../../src/attachments/types.js'
import { toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const stageFileMetadata = (
  params: Omit<StageFileParams, 'sourcePlatformInstanceId'> &
    Partial<Pick<StageFileParams, 'sourcePlatformInstanceId'>>,
): StagedFileRef => rawStageFileMetadata({ sourcePlatformInstanceId: 'telegram-default', ...params })

describe('staged file cache', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('stageFileMetadata', () => {
    test('stores metadata and returns a StagedFileRef', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_file_123',
        sourceProvider: 'telegram',
      })

      expect(ref.stagedId.startsWith('stg_')).toBe(true)
      expect(ref.contextId).toBe('ctx-1')
      expect(ref.filename).toBe('report.pdf')
      expect(ref.status).toBe('staged')
      expect(ref.platformFileId).toBe('tg_file_123')
      expect(ref.messageId).toBe('msg-1')
    })

    test('generates id with stg_ prefix', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: null,
        senderId: 'user-1',
        senderUsername: null,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 500,
        platformFileId: 'tg_456',
        sourceProvider: 'telegram',
      })

      expect(ref.stagedId).toMatch(/^stg_[0-9a-f-]+$/u)
    })

    test('updates existing entry when same platformFileId + contextId pair appears', async () => {
      const ref1 = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-old',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_dup',
        sourceProvider: 'telegram',
      })

      const ref2 = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-new',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_dup',
        sourceProvider: 'telegram',
      })

      expect(ref1.stagedId).toBe(ref2.stagedId)
      expect(ref2.messageId).toBe('msg-new')
    })
  })

  describe('searchStagedFiles', () => {
    test('finds staged files by sender username', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-2',
        senderId: 'user-2',
        senderUsername: 'bob',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
        platformFileId: 'tg_2',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(1)
      expect(results[0]!.senderUsername).toBe('alice')
    })

    test('finds staged files by filename substring', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'quarterly_report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'report')
      expect(results).toHaveLength(1)
      expect(results[0]!.filename).toBe('quarterly_report.pdf')
    })

    test('scopes results to contextId', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-2',
        messageId: 'msg-2',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1b',
        sourceProvider: 'telegram',
      })

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(1)
      expect(results[0]!.contextId).toBe('ctx-1')
    })

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await stageFileMetadata({
          contextId: 'ctx-1',
          messageId: `msg-${i}`,
          senderId: 'user-1',
          senderUsername: 'alice',
          filename: `file_${i}.pdf`,
          mimeType: 'application/pdf',
          size: 100,
          platformFileId: `tg_${i}`,
          sourceProvider: 'telegram',
        })
      }

      const results = searchStagedFiles('ctx-1', 'alice', 2)
      expect(results).toHaveLength(2)
    })

    test('treats LIKE wildcard characters as literals', async () => {
      // Base entries without wildcards in searched fields
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-2',
        senderId: 'user-2',
        senderUsername: 'bob',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
        platformFileId: 'tg_2',
        sourceProvider: 'telegram',
      })

      // Queries with bare wildcards should return nothing when no field contains them
      expect(searchStagedFiles('ctx-1', '%')).toHaveLength(0)
      expect(searchStagedFiles('ctx-1', '_')).toHaveLength(0)

      // Entries that DO contain wildcard characters in searched fields
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-3',
        senderId: 'user-3',
        senderUsername: 'a%lice',
        filename: 'data_.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_3',
        sourceProvider: 'telegram',
      })

      const patternResults = searchStagedFiles('ctx-1', 'a%lic')
      expect(patternResults).toHaveLength(1)
      expect(patternResults[0]!.senderUsername).toBe('a%lice')

      const underscoreResults = searchStagedFiles('ctx-1', 'ata_.pd')
      expect(underscoreResults).toHaveLength(1)
      expect(underscoreResults[0]!.filename).toBe('data_.pdf')
    })

    test('only returns staged status entries', async () => {
      const ref = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb().update(stagedFiles).set({ status: 'resolved' }).where(eq(stagedFiles.stagedId, ref.stagedId)).run()

      const results = searchStagedFiles('ctx-1', 'alice')
      expect(results).toHaveLength(0)
    })
  })

  describe('findStagedFilesByMessageId', () => {
    test('finds staged files by message ID within a context', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-target',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        platformFileId: 'tg_1',
        sourceProvider: 'telegram',
      })

      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-other',
        senderId: 'user-2',
        senderUsername: 'bob',
        filename: 'notes.txt',
        mimeType: 'text/plain',
        size: 50,
        platformFileId: 'tg_2',
        sourceProvider: 'telegram',
      })

      const results = findStagedFilesByMessageId('ctx-1', 'msg-target')
      expect(results).toHaveLength(1)
      expect(results[0]!.filename).toBe('report.pdf')
    })

    test('returns empty array for unknown message ID', () => {
      const results = findStagedFilesByMessageId('ctx-1', 'msg-nonexistent')
      expect(results).toHaveLength(0)
    })
  })

  describe('resolveStagedFile', () => {
    test('returns not_found for unknown stagedId', async () => {
      const result = await resolveStagedFile('stg_nonexistent', 'ctx-1', () => Promise.resolve(null))
      expect(result).toMatchObject({ status: 'not_found' })
    })

    test('returns not_found when stagedId exists in a different context', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-a',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_ctx_a',
        sourceProvider: 'telegram',
      })

      const result = await resolveStagedFile(staged.stagedId, 'ctx-b', () => Promise.resolve(null))
      expect(result).toMatchObject({
        status: 'not_found',
        message: expect.stringContaining('ctx-b') as unknown,
      })
    })

    test('returns already_resolved when file was previously resolved', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_resolved',
        sourceProvider: 'telegram',
      })

      // First resolve succeeds
      const first = await resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.resolve(Buffer.from('bytes')))
      expect(first).toMatchObject({
        status: 'available',
        filename: 'report.pdf',
        contextId: 'ctx-1',
      })
      expect((first as Record<string, unknown>)['attachmentId']).toMatch(/^att_[0-9a-f-]+$/u)

      // Second resolve returns already_resolved
      const second = await resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.resolve(Buffer.from('bytes')))
      expect(second).toMatchObject({ status: 'already_resolved' })
      expect((second as Record<string, unknown>)['attachmentId']).toBe(
        (first as Record<string, unknown>)['attachmentId'],
      )
    })

    test('returns download_failed when downloadFn returns null', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'missing.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_missing',
        sourceProvider: 'telegram',
      })

      const result = await resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.resolve(null))
      expect(result).toMatchObject({
        status: 'download_failed',
        message: expect.stringContaining('Unable to fetch') as unknown,
      })
    })

    test('returns download_failed for previously failed status', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'failed.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_failed',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb().update(sf).set({ status: 'failed' }).where(eq(sf.stagedId, staged.stagedId)).run()

      const result = await resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.resolve(Buffer.from('bytes')))
      expect(result).toMatchObject({
        status: 'download_failed',
        message: expect.stringContaining('re-send') as unknown,
      })
    })

    test('returns staged_file_expired when expiresAt is in the past', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'expired.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_expired',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb()
        .update(sf)
        .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .where(eq(sf.stagedId, staged.stagedId))
        .run()

      const result = await resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.resolve(Buffer.from('bytes')))
      expect(result).toMatchObject({
        status: 'staged_file_expired',
        message: expect.stringContaining('expired') as unknown,
      })
    })

    test('propagates exceptions thrown by downloadFn', async () => {
      const staged = await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'boom.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_boom',
        sourceProvider: 'telegram',
      })

      await expect(
        resolveStagedFile(staged.stagedId, 'ctx-1', () => Promise.reject(new Error('network timeout'))),
      ).rejects.toThrow('network timeout')
    })

    test('derives and backfills legacy empty source instance from scoped thread context', async () => {
      const scopedContextId = toScopedThreadContextId({
        platformInstanceId: 'telegram-a',
        nativeContextId: 'group-1',
        threadId: 'thread-1',
      })
      const staged = await stageFileMetadata({
        contextId: scopedContextId,
        messageId: 'msg-legacy-scoped',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'legacy.txt',
        mimeType: 'text/plain',
        size: 4,
        platformFileId: 'file-legacy-scoped',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'will-be-cleared',
      })
      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb().update(sf).set({ sourcePlatformInstanceId: '' }).where(eq(sf.stagedId, staged.stagedId)).run()
      const calls: Array<{ fileId: string; sourceProvider: string; sourcePlatformInstanceId: string }> = []

      const result = await resolveStagedFile(
        staged.stagedId,
        scopedContextId,
        (fileId, sourceProvider, sourcePlatformInstanceId) => {
          calls.push({ fileId, sourceProvider, sourcePlatformInstanceId })
          return Promise.resolve(Buffer.from('test'))
        },
      )

      const row = getDrizzleDb().select().from(sf).where(eq(sf.stagedId, staged.stagedId)).get()
      assert.ok(row !== undefined, 'expected staged row to remain after scoped legacy resolution')
      expect(result).toMatchObject({ status: 'available', filename: 'legacy.txt' })
      expect(calls).toEqual([
        { fileId: 'file-legacy-scoped', sourceProvider: 'telegram', sourcePlatformInstanceId: 'telegram-a' },
      ])
      expect(row.sourcePlatformInstanceId).toBe('telegram-a')
    })

    test('keeps raw legacy empty source instance ambiguous and safe', async () => {
      const staged = await stageFileMetadata({
        contextId: 'raw-group-1',
        messageId: 'msg-legacy-raw',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'legacy-raw.txt',
        mimeType: 'text/plain',
        size: 4,
        platformFileId: 'file-legacy-raw',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'will-be-cleared',
      })
      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      getDrizzleDb().update(sf).set({ sourcePlatformInstanceId: '' }).where(eq(sf.stagedId, staged.stagedId)).run()
      const calls: string[] = []

      const result = await resolveStagedFile(
        staged.stagedId,
        'raw-group-1',
        (_fileId, _sourceProvider, sourcePlatformInstanceId) => {
          calls.push(sourcePlatformInstanceId)
          return Promise.resolve(null)
        },
      )

      const row = getDrizzleDb().select().from(sf).where(eq(sf.stagedId, staged.stagedId)).get()
      assert.ok(row !== undefined, 'expected staged row to remain after raw legacy resolution')
      expect(result).toMatchObject({ status: 'download_failed' })
      expect(calls).toEqual([''])
      expect(row.sourcePlatformInstanceId).toBe('')
    })
  })

  describe('purgeExpiredStagedFiles', () => {
    test('removes entries with status=expired', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'old.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_old',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')

      getDrizzleDb().update(sf).set({ status: 'expired' }).where(eq(sf.platformFileId, 'tg_old')).run()

      expect(() => purgeExpiredStagedFiles()).not.toThrow()
    })

    test('removes entries past their expires_at time', async () => {
      await stageFileMetadata({
        contextId: 'ctx-1',
        messageId: 'msg-1',
        senderId: 'user-1',
        senderUsername: 'alice',
        filename: 'timedout.pdf',
        mimeType: 'application/pdf',
        size: 100,
        platformFileId: 'tg_timedout',
        sourceProvider: 'telegram',
      })

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { stagedFiles: sf } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')

      // Set expires_at to the past without changing status
      getDrizzleDb()
        .update(sf)
        .set({ expiresAt: new Date(Date.now() - 3600_000).toISOString() })
        .where(eq(sf.platformFileId, 'tg_timedout'))
        .run()

      purgeExpiredStagedFiles()

      const remaining = getDrizzleDb().select().from(sf).where(eq(sf.platformFileId, 'tg_timedout')).get()
      expect(remaining).toBeUndefined()
    })
  })

  test('passes source platform instance id to staged downloader', async () => {
    const staged = await stageFileMetadata({
      contextId: 'ctx-1',
      messageId: 'msg-1',
      senderId: 'sender-1',
      senderUsername: 'alice',
      filename: 'note.txt',
      mimeType: 'text/plain',
      size: 4,
      platformFileId: 'file-1',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'telegram-a',
    })
    const calls: Array<{ fileId: string; sourceProvider: string; sourcePlatformInstanceId: string }> = []

    await resolveStagedFile(staged.stagedId, 'ctx-1', (fileId, sourceProvider, sourcePlatformInstanceId) => {
      calls.push({ fileId, sourceProvider, sourcePlatformInstanceId })
      return Promise.resolve(Buffer.from('test'))
    })

    expect(calls).toEqual([{ fileId: 'file-1', sourceProvider: 'telegram', sourcePlatformInstanceId: 'telegram-a' }])
  })
})
