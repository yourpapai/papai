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
} from '../src/attachments/blob-store.js'
import { listActiveAttachments, stageFileMetadata } from '../src/attachments/index.js'
import { findStagedFilesByMessageId, resolveStagedFile } from '../src/attachments/staged.js'
import { loadAttachmentRecord } from '../src/attachments/store.js'
import type { StagedFileRef, StageFileParams } from '../src/attachments/types.js'
import { addAuthorizedGroup } from '../src/authorized-groups.js'
import { findVoiceStagedIds, resolveVoiceStagedFiles } from '../src/bot-attachments.js'
import { setupBot } from '../src/bot.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import type { ChatProvider, ReplyFn } from '../src/chat/types.js'
import type { IncomingFile, IncomingFileCandidate, IncomingMessage } from '../src/chat/types.js'
import { mockLogger, setupTestDb, createMockChat, createDmMessage, createGroupMessage } from './utils/test-helpers.js'

const makeFile = (...rest: [] | [Partial<IncomingFile>]): IncomingFile => {
  const overrides = rest.length === 0 ? {} : rest[0]
  return {
    fileId: 'f-1',
    filename: 'report.pdf',
    content: Buffer.from('pdf-data'),
    mimeType: 'application/pdf',
    size: 8,
    ...overrides,
  }
}

const makeCandidate = (...rest: [] | [Partial<IncomingFileCandidate>]): IncomingFileCandidate => {
  const overrides = rest.length === 0 ? {} : rest[0]
  return {
    fileId: 'f-1',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    size: 8,
    ...overrides,
  }
}

function createRouterLikeChat(sourceProvider: ChatProvider): {
  chat: ChatProvider
  getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null
} {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null
  return {
    chat: {
      ...createMockChat({
        onMessageHandler: (handler): void => {
          messageHandler = handler
        },
      }),
      name: 'router',
      getInstance: (id: string) => (id === 'mattermost-source' ? { provider: sourceProvider } : null),
    } as ChatProvider,
    getMessageHandler: () => messageHandler,
  }
}

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

    test('uses source instance provider when ingesting router-delivered files', async () => {
      const { ingestDmAttachments } = await import('../src/bot-attachments.js')
      const sourceProvider = { ...createMockChat(), name: 'mattermost' }
      const { chat } = createRouterLikeChat(sourceProvider)
      const msg: IncomingMessage = {
        ...createDmMessage('dm-user'),
        platformInstanceId: 'mattermost-source',
        files: [makeFile()],
      }

      const result = await ingestDmAttachments({ chat, msg, storageContextId: 'dm-user', files: msg.files! })
      const stored = await loadAttachmentRecord('dm-user', result.newAttachmentIds[0]!)

      expect(stored).not.toBeNull()
      assert.ok(stored !== null, 'expected stored attachment')
      expect(stored.sourceProvider).toBe('mattermost')
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

    test('stages candidates with source platform instance id', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const stagedParams: StageFileParams[] = []
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        platformInstanceId: 'telegram-a',
        messageId: 'msg-source-instance',
        fileCandidates: [makeCandidate({ fileId: 'f-source' })],
      }

      stageGroupFileCandidates(
        { storageContextId: 'group-1', msg, sourceProvider: 'telegram' },
        {
          stageFileMetadataFn: (params) => {
            stagedParams.push(params)
            return {
              stagedId: 'stg_1',
              contextId: params.contextId,
              messageId: params.messageId,
              senderId: params.senderId,
              senderUsername: params.senderUsername,
              filename: params.filename,
              mimeType: params.mimeType,
              size: params.size,
              platformFileId: params.platformFileId,
              sourceProvider: params.sourceProvider,
              sourcePlatformInstanceId: params.sourcePlatformInstanceId,
              status: 'staged',
              attachmentId: null,
              createdAt: 'now',
              expiresAt: 'later',
              origin: null,
              forwardedFrom: null,
            }
          },
        },
      )

      expect(stagedParams.map((params) => params.sourcePlatformInstanceId)).toEqual(['telegram-a'])
    })

    test('uses source instance provider when staging router-delivered candidates', async () => {
      const sourceProvider = { ...createMockChat(), name: 'mattermost' }
      const { chat, getMessageHandler } = createRouterLikeChat(sourceProvider)
      setupBot(chat, 'admin-user', {
        processMessage: () => Promise.resolve(),
        enqueueMessage: () => {},
      })
      const handler = getMessageHandler()
      assert.ok(handler !== null, 'message handler was not registered')
      addAuthorizedGroup('group-1', 'admin-user')
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', '@bot remember this', true, 'group-1'),
        platformInstanceId: 'mattermost-source',
        messageId: 'msg-router',
        fileCandidates: [makeCandidate({ fileId: 'mm_platform_123' })],
      }

      await handler(msg, { text: async () => {}, formatted: async () => {}, buttons: async () => {}, typing: () => {} })

      const scopedGroupId = toScopedContextId({ platformInstanceId: 'mattermost-source', nativeContextId: 'group-1' })
      const staged = findStagedFilesByMessageId(scopedGroupId, 'msg-router')
      expect(staged[0]).not.toBeUndefined()
      assert.ok(staged[0] !== undefined, 'expected staged attachment')
      expect(staged[0].sourceProvider).toBe('mattermost')
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

  describe('origin and forwardedFrom propagation', () => {
    test('DM ingest persists origin and forwardedFrom from IncomingFile', async () => {
      const { resolveMessageAttachments } = await import('../src/bot-attachments.js')
      const chat = createMockChat()
      const msg: IncomingMessage = {
        ...createDmMessage('ctx-dm'),
        files: [
          makeFile({
            fileId: 'f1',
            filename: 'voice.ogg',
            content: Buffer.from('audio'),
            mimeType: 'audio/ogg',
            origin: 'voice',
            forwardedFrom: 'Alice',
          }),
        ],
      }

      const result = await resolveMessageAttachments(chat, msg, 'ctx-dm')
      const stored = await loadAttachmentRecord('ctx-dm', result.newAttachmentIds[0]!)
      expect(stored?.origin).toBe('voice')
      expect(stored?.forwardedFrom).toBe('Alice')
    })

    test('group staging passes candidate origin and forwardedFrom to stageFileMetadata', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const staged: StageFileParams[] = []
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-origin-test',
        fileCandidates: [
          makeCandidate({
            fileId: 'pf1',
            filename: 'voice.ogg',
            mimeType: 'audio/ogg',
            origin: 'voice',
            forwardedFrom: 'Alice',
          }),
        ],
      }

      stageGroupFileCandidates(
        { storageContextId: 'ctx-g', msg, sourceProvider: 'telegram' },
        {
          stageFileMetadataFn: (params) => {
            staged.push(params)
            return {
              stagedId: 'stg_origin',
              contextId: params.contextId,
              messageId: params.messageId,
              senderId: params.senderId,
              senderUsername: params.senderUsername,
              filename: params.filename,
              mimeType: params.mimeType,
              size: params.size,
              platformFileId: params.platformFileId,
              sourceProvider: params.sourceProvider,
              sourcePlatformInstanceId: params.sourcePlatformInstanceId,
              status: 'staged',
              attachmentId: null,
              createdAt: 'now',
              expiresAt: 'later',
              origin: params.origin,
              forwardedFrom: params.forwardedFrom,
            }
          },
        },
      )

      expect(staged[0]?.origin).toBe('voice')
      expect(staged[0]?.forwardedFrom).toBe('Alice')
    })

    test('group staging produces origin: null, forwardedFrom: null for candidate without those fields', async () => {
      const { stageGroupFileCandidates } = await import('../src/bot-attachments.js')
      const staged: StageFileParams[] = []
      const msg: IncomingMessage = {
        ...createGroupMessage('group-user', 'hello'),
        messageId: 'msg-no-origin',
        fileCandidates: [makeCandidate({ fileId: 'pf-plain' })],
      }

      stageGroupFileCandidates(
        { storageContextId: 'ctx-g2', msg, sourceProvider: 'telegram' },
        {
          stageFileMetadataFn: (params) => {
            staged.push(params)
            return {
              stagedId: 'stg_plain',
              contextId: params.contextId,
              messageId: params.messageId,
              senderId: params.senderId,
              senderUsername: params.senderUsername,
              filename: params.filename,
              mimeType: params.mimeType,
              size: params.size,
              platformFileId: params.platformFileId,
              sourceProvider: params.sourceProvider,
              sourcePlatformInstanceId: params.sourcePlatformInstanceId,
              status: 'staged',
              attachmentId: null,
              createdAt: 'now',
              expiresAt: 'later',
              origin: params.origin,
              forwardedFrom: params.forwardedFrom,
            }
          },
        },
      )

      expect(staged[0]?.origin).toBeNull()
      expect(staged[0]?.forwardedFrom).toBeNull()
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
      await ingestDmAttachments({
        chat,
        msg: dmMsg,
        storageContextId: 'group-1',
        files: dmMsg.files!,
      })

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

  describe('findVoiceStagedIds', () => {
    test('returns stagedIds only for voice-origin rows matching the messageId', () => {
      const voiceRef = stageFileMetadata({
        contextId: 'ctx-fv',
        messageId: 'msg-fv',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-fv-voice',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      stageFileMetadata({
        contextId: 'ctx-fv',
        messageId: 'msg-fv',
        senderId: 'u1',
        senderUsername: null,
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 4,
        platformFileId: 'pf-fv-doc',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: null,
        forwardedFrom: null,
      })
      const ids = findVoiceStagedIds('ctx-fv', 'msg-fv')
      expect(ids).toEqual([voiceRef.stagedId])
    })

    test('returns [] when messageId is undefined', () => {
      expect(findVoiceStagedIds('ctx-fv', undefined)).toEqual([])
    })

    test('returns [] when S3 is not configured', () => {
      const saved = { ...process.env }
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']
      try {
        expect(findVoiceStagedIds('ctx-fv', 'msg-fv')).toEqual([])
      } finally {
        Object.assign(process.env, saved)
      }
    })
  })

  describe('resolveVoiceStagedFiles', () => {
    test('resolves only voice-origin staged files given their staged ids', async () => {
      const voiceRef = stageFileMetadata({
        contextId: 'ctx-g',
        messageId: 'm-9',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-v',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      stageFileMetadata({
        contextId: 'ctx-g',
        messageId: 'm-9',
        senderId: 'u1',
        senderUsername: null,
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 4,
        platformFileId: 'pf-d',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: null,
        forwardedFrom: null,
      })
      const stagedIds = findVoiceStagedIds('ctx-g', 'm-9')
      expect(stagedIds).toEqual([voiceRef.stagedId])
      const ids = await resolveVoiceStagedFiles('ctx-g', stagedIds, () => Promise.resolve(Buffer.from('audio')))
      expect(ids).toHaveLength(1)
      const stored = await loadAttachmentRecord('ctx-g', ids[0]!)
      expect(stored?.origin).toBe('voice')
      expect(stored?.filename).toBe('voice.ogg')
    })

    test('returns empty for empty stagedIds or no downloadFn', async () => {
      expect(await resolveVoiceStagedFiles('ctx-g', [], () => Promise.resolve(null))).toEqual([])
      expect(await resolveVoiceStagedFiles('ctx-g', ['stg_x'], undefined)).toEqual([])
    })

    test('tolerates a failing download (returns null)', async () => {
      const ref = stageFileMetadata({
        contextId: 'ctx-g2',
        messageId: 'm-1',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-x',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      const ids = await resolveVoiceStagedFiles('ctx-g2', [ref.stagedId], () => Promise.resolve(null))
      expect(ids).toEqual([])
    })

    test('does not propagate a thrown error from downloadFn — returns []', async () => {
      const ref = stageFileMetadata({
        contextId: 'ctx-throw',
        messageId: 'm-throw',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-throw',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      const throwingDownload = (): Promise<Buffer | null> => {
        throw new Error('Network failure')
      }
      const ids = await resolveVoiceStagedFiles('ctx-throw', [ref.stagedId], throwingDownload)
      expect(ids).toEqual([])
    })

    test('skips the failed id and still resolves the rest', async () => {
      const badRef = stageFileMetadata({
        contextId: 'ctx-multi',
        messageId: 'm-multi',
        senderId: 'u1',
        senderUsername: null,
        filename: 'bad.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-bad',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      const goodRef = stageFileMetadata({
        contextId: 'ctx-multi',
        messageId: 'm-multi',
        senderId: 'u1',
        senderUsername: null,
        filename: 'good.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-good',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      const behaviors: Array<() => Promise<Buffer | null>> = [
        (): never => {
          throw new Error('first throws')
        },
        (): Promise<Buffer> => Promise.resolve(Buffer.from('audio')),
      ]
      let callIdx = 0
      const downloadFn = (): Promise<Buffer | null> => behaviors[callIdx++]!()
      const ids = await resolveVoiceStagedFiles('ctx-multi', [badRef.stagedId, goodRef.stagedId], downloadFn)
      expect(ids).toHaveLength(1)
      const stored = await loadAttachmentRecord('ctx-multi', ids[0]!)
      expect(stored?.filename).toBe('good.ogg')
    })

    test('duplicate staged ids in input → downloadFn called once, one attachment id returned', async () => {
      const ref = stageFileMetadata({
        contextId: 'ctx-dedup',
        messageId: 'm-dedup',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-dedup',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      let downloadCount = 0
      const downloadFn = (): Promise<Buffer | null> => {
        downloadCount++
        return Promise.resolve(Buffer.from('audio'))
      }
      // Pass the same stagedId twice (simulating two coalesced messages for same file)
      const ids = await resolveVoiceStagedFiles('ctx-dedup', [ref.stagedId, ref.stagedId], downloadFn)
      expect(downloadCount).toBe(1)
      expect(ids).toHaveLength(1)
    })

    test('TOCTOU: already-resolved staged id returns the prior attachment id', async () => {
      const ref = stageFileMetadata({
        contextId: 'ctx-toctou',
        messageId: 'm-toctou',
        senderId: 'u1',
        senderUsername: null,
        filename: 'voice.ogg',
        mimeType: 'audio/ogg',
        size: 4,
        platformFileId: 'pf-toctou',
        sourceProvider: 'telegram',
        sourcePlatformInstanceId: 'pi',
        origin: 'voice',
        forwardedFrom: null,
      })
      // Resolve the staged file directly so status becomes 'resolved'
      const resolveResult = await resolveStagedFile(ref.stagedId, 'ctx-toctou', () =>
        Promise.resolve(Buffer.from('audio')),
      )
      assert.ok('attachmentId' in resolveResult, 'expected AttachmentRef from direct resolution')
      assert.ok(resolveResult.attachmentId !== null)
      const priorAttachmentId = resolveResult.attachmentId

      // Now call resolveVoiceStagedFiles with the staged id explicitly
      const ids = await resolveVoiceStagedFiles('ctx-toctou', [ref.stagedId], () => Promise.resolve(Buffer.from('b')))
      expect(ids).toEqual([priorAttachmentId])
    })
  })
})
