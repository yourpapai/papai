// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
} from '../src/attachments/blob-store.js'
import { listActiveAttachments } from '../src/attachments/index.js'
import { findStagedFilesByMessageId } from '../src/attachments/staged.js'
import type { StagedFileRef, StageFileParams } from '../src/attachments/types.js'
import type { IncomingFile, IncomingFileCandidate, IncomingMessage } from '../src/chat/types.js'
import { mockLogger, setupTestDb, createMockChat, createDmMessage, createGroupMessage } from './utils/test-helpers.js'

const makeFile = (overrides: Partial<IncomingFile> = {}): IncomingFile => ({
  fileId: 'f-1',
  filename: 'report.pdf',
  content: Buffer.from('pdf-data'),
  mimeType: 'application/pdf',
  size: 8,
  ...overrides,
})

const makeCandidate = (overrides: Partial<IncomingFileCandidate> = {}): IncomingFileCandidate => ({
  fileId: 'f-1',
  filename: 'report.pdf',
  mimeType: 'application/pdf',
  size: 8,
  ...overrides,
})

describe('bot-attachments', () => {
  let blobs: ReturnType<typeof createInMemoryBlobStoreForTesting>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = createInMemoryBlobStoreForTesting()
    setBlobStoreForTesting(blobs)
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  describe('DM context', () => {
    test('uploads files directly to workspace', async () => {
      const { ingestDmAttachments } = await import('../src/bot-attachments.js')
      const chat = createMockChat()
      const msg: IncomingMessage = {
        ...createDmMessage('dm-user'),
        files: [makeFile()],
      }

      const result = await ingestDmAttachments({
        chat,
        msg,
        storageContextId: 'dm-user',
        files: msg.files!,
      })

      expect(result.newAttachmentIds).toHaveLength(1)
      expect(result.newAttachmentIds[0]!.startsWith('att_')).toBe(true)
      expect(listActiveAttachments('dm-user')).toHaveLength(1)
    })
  })

  describe('group context — stageGroupFileCandidates', () => {
    test('stages metadata only, does not upload to workspace', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const storageContextId = 'group-1'
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-42',
        fileCandidates: [makeCandidate({ fileId: 'tg_platform_123' })],
      }

      await stageGroupFileCandidates({
        storageContextId,
        msg,
        sourceProvider: 'telegram',
      })

      expect(listActiveAttachments(storageContextId)).toHaveLength(0)
      const staged = findStagedFilesByMessageId(storageContextId, 'msg-42')
      expect(staged).toHaveLength(1)
      expect(staged[0]!.platformFileId).toBe('tg_platform_123')
      expect(staged[0]!.filename).toBe('report.pdf')
      expect(staged[0]!.status).toBe('staged')
    })

    test('uses thread-scoped storageContextId for lookup', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const threadScopedId = 'group-1:thread-42'
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-thread',
        fileCandidates: [makeCandidate({ fileId: 'tg_threaded' })],
      }

      await stageGroupFileCandidates({
        storageContextId: threadScopedId,
        msg,
        sourceProvider: 'telegram',
      })

      const staged = findStagedFilesByMessageId(threadScopedId, 'msg-thread')
      expect(staged).toHaveLength(1)
      expect(staged[0]!.contextId).toBe('group-1:thread-42')
    })

    test('stages multiple files from a single message', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-multi',
        fileCandidates: [
          makeCandidate({ fileId: 'f-1', filename: 'a.pdf' }),
          makeCandidate({ fileId: 'f-2', filename: 'b.jpg' }),
        ],
      }

      await stageGroupFileCandidates({
        storageContextId: 'group-1',
        msg,
        sourceProvider: 'telegram',
      })

      const staged = findStagedFilesByMessageId('group-1', 'msg-multi')
      expect(staged).toHaveLength(2)
    })

    test('continues staging remaining candidates when one throws', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const { stageFileMetadata: realStageFileMetadata } = await import('../src/attachments/staged.js')

      const behaviors: Array<(params: StageFileParams) => StagedFileRef> = [
        () => {
          throw new Error('Simulated DB error')
        },
        (params) => realStageFileMetadata(params),
      ]
      let callIdx = 0
      const mockFn = (params: StageFileParams): StagedFileRef => behaviors[callIdx++]!(params)

      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-partial',
        fileCandidates: [
          makeCandidate({ fileId: 'f-bad', filename: 'bad.pdf' }),
          makeCandidate({ fileId: 'f-good', filename: 'good.jpg' }),
        ],
      }

      stageGroupFileCandidates(
        {
          storageContextId: 'group-1',
          msg,
          sourceProvider: 'telegram',
        },
        { stageFileMetadataFn: mockFn },
      )

      const staged = findStagedFilesByMessageId('group-1', 'msg-partial')
      expect(staged).toHaveLength(1)
      expect(staged[0]!.platformFileId).toBe('f-good')
      expect(staged[0]!.filename).toBe('good.jpg')
    })
  })

  describe('resolveMessageAttachments', () => {
    test('ingests DM files when present', async () => {
      const { resolveMessageAttachments } = await import('../src/bot-attachments.js')
      const chat = createMockChat()
      const msg: IncomingMessage = {
        ...createDmMessage('dm-user'),
        files: [makeFile()],
      }

      const result = await resolveMessageAttachments(chat, msg, 'dm-user')
      expect(result.newAttachmentIds).toHaveLength(1)
    })

    test('returns empty newAttachmentIds for DM without files', async () => {
      const { resolveMessageAttachments } = await import('../src/bot-attachments.js')
      const chat = createMockChat()
      const msg = createDmMessage('dm-user')

      const result = await resolveMessageAttachments(chat, msg, 'dm-user')
      expect(result.newAttachmentIds).toHaveLength(0)
    })

    test('returns active attachments for group context', async () => {
      // Seed an attachment in the workspace for the group context
      const { ingestDmAttachments, resolveMessageAttachments } = await import('../src/bot-attachments.js')
      const chat = createMockChat()
      const dmMsg: IncomingMessage = {
        ...createDmMessage('group-user'),
        files: [makeFile({ filename: 'existing.pdf' })],
      }
      await ingestDmAttachments({ chat, msg: dmMsg, storageContextId: 'group-1', files: dmMsg.files! })

      const groupMsg = createGroupMessage('group-user', 'hello')
      const result = await resolveMessageAttachments(chat, groupMsg, 'group-1')
      expect(result.newAttachmentIds).toHaveLength(0)
      expect(result.activeAttachments).toHaveLength(1)
      expect(result.activeAttachments[0]!.filename).toBe('existing.pdf')
    })

    test('returns empty arrays when S3 is not configured', async () => {
      const { resolveMessageAttachments } = await import('../src/bot-attachments.js')

      // Temporarily clear S3 env vars
      const saved = { ...process.env }
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']

      try {
        const chat = createMockChat()
        const msg = createDmMessage('dm-user')
        const result = await resolveMessageAttachments(chat, msg, 'dm-user')
        expect(result.newAttachmentIds).toHaveLength(0)
        expect(result.activeAttachments).toHaveLength(0)
      } finally {
        Object.assign(process.env, saved)
      }
    })
  })
})
