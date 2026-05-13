import { beforeEach, describe, expect, test } from 'bun:test'

import {
  findStagedFilesByMessageId,
  purgeExpiredStagedFiles,
  searchStagedFiles,
  stageFileMetadata,
} from '../../src/attachments/staged.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

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

      expect(ref.stagedId).toMatch(/^stg_[0-9a-f-]+$/)
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

  describe('purgeExpiredStagedFiles', () => {
    test('removes entries past their expires_at', async () => {
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
  })
})
