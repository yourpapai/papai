// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
} from '../../src/attachments/blob-store.js'
import { resolveStagedFile, stageFileMetadata } from '../../src/attachments/staged.js'
import { loadAttachmentRecord, saveAttachment } from '../../src/attachments/store.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { stagedFiles } from '../../src/db/staged-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Use proper scoped IDs so groupContextId is auto-populated via getConfigContextIdFromStorageContextId
const PLATFORM = 'pi'
const GROUP = 'grp-action'
const THREAD_1 = toScopedThreadContextId({ platformInstanceId: PLATFORM, nativeContextId: GROUP, threadId: 't1' })
const THREAD_2 = toScopedThreadContextId({ platformInstanceId: PLATFORM, nativeContextId: GROUP, threadId: 't2' })
const PARENT = toScopedContextId({ platformInstanceId: PLATFORM, nativeContextId: GROUP })
const OTHER_GROUP = 'other-grp'

describe('loadAttachmentRecord group-action widening', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('without groupContextId, only returns attachment from exact thread', async () => {
    const ref = await saveAttachment({
      contextId: THREAD_1,
      sourceProvider: 'telegram',
      filename: 'file-in-thread1.txt',
      status: 'available',
      content: Buffer.from('data'),
      mimeType: 'text/plain',
      size: 4,
    })

    const found = await loadAttachmentRecord(THREAD_1, ref.attachmentId)
    const notFound = await loadAttachmentRecord(THREAD_2, ref.attachmentId)

    expect(found).not.toBeNull()
    expect(notFound).toBeNull()
  })

  test('with groupContextId, resolves attachment seeded in sibling thread', async () => {
    const ref = await saveAttachment({
      contextId: THREAD_1,
      sourceProvider: 'telegram',
      filename: 'cross-thread-file.txt',
      status: 'available',
      content: Buffer.from('cross'),
      mimeType: 'text/plain',
      size: 5,
    })

    // Lookup from thread 2 without groupContextId should fail
    const withoutGroup = await loadAttachmentRecord(THREAD_2, ref.attachmentId)
    expect(withoutGroup).toBeNull()

    // Lookup from thread 2 with groupContextId (the shared parent) should succeed
    const withGroup = await loadAttachmentRecord(THREAD_2, ref.attachmentId, { groupContextId: PARENT })
    expect(withGroup).not.toBeNull()
    expect(withGroup!.filename).toBe('cross-thread-file.txt')
  })

  test('groupContextId does not cross group boundaries', async () => {
    const ref = await saveAttachment({
      contextId: THREAD_1,
      sourceProvider: 'telegram',
      filename: 'group-a-file.txt',
      status: 'available',
      content: Buffer.from('group-a'),
      mimeType: 'text/plain',
      size: 7,
    })

    // A different group's groupContextId should not find the file
    const wrongGroup = await loadAttachmentRecord(THREAD_2, ref.attachmentId, { groupContextId: OTHER_GROUP })
    expect(wrongGroup).toBeNull()
  })
})

describe('resolveStagedFile group-action widening', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('without groupContextId, not_found when stagedId is from sibling thread', async () => {
    const staged = stageFileMetadata({
      contextId: THREAD_1,
      messageId: 'msg-1',
      senderId: 'user-1',
      senderUsername: 'alice',
      filename: 'thread1-file.txt',
      mimeType: 'text/plain',
      size: 10,
      platformFileId: 'pf-thread1-action',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: PLATFORM,
      origin: null,
      forwardedFrom: null,
    })

    const result = await resolveStagedFile(staged.stagedId, THREAD_2, () => Promise.resolve(Buffer.from('bytes')))
    expect(result).toMatchObject({ status: 'not_found' })
  })

  test('with groupContextId, resolves staged file seeded in sibling thread', async () => {
    const staged = stageFileMetadata({
      contextId: THREAD_1,
      messageId: 'msg-1',
      senderId: 'user-1',
      senderUsername: 'alice',
      filename: 'cross-thread-staged.txt',
      mimeType: 'text/plain',
      size: 10,
      platformFileId: 'pf-cross-staged',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: PLATFORM,
      origin: null,
      forwardedFrom: null,
    })

    const result = await resolveStagedFile(staged.stagedId, THREAD_2, () => Promise.resolve(Buffer.from('bytes')), {
      groupContextId: PARENT,
    })
    expect(result).toMatchObject({ status: 'available', filename: 'cross-thread-staged.txt' })
  })

  test('groupContextId does not cross group boundaries for staged files', async () => {
    const staged = stageFileMetadata({
      contextId: THREAD_1,
      messageId: 'msg-1',
      senderId: 'user-1',
      senderUsername: 'alice',
      filename: 'group-a-staged.txt',
      mimeType: 'text/plain',
      size: 10,
      platformFileId: 'pf-group-a-staged',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: PLATFORM,
      origin: null,
      forwardedFrom: null,
    })

    // A different group's groupContextId should not find the staged file
    const result = await resolveStagedFile(staged.stagedId, THREAD_2, () => Promise.resolve(Buffer.from('bytes')), {
      groupContextId: OTHER_GROUP,
    })
    expect(result).toMatchObject({ status: 'not_found' })
  })
})

// Verify that the group_context_id column is actually populated correctly by the save/stage functions
// so that the widened WHERE clause can match it
describe('group_context_id column population sanity check', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('saveAttachment populates group_context_id as the thread-stripped parent for a thread context', async () => {
    const ref = await saveAttachment({
      contextId: THREAD_1,
      sourceProvider: 'telegram',
      filename: 'gci-check.txt',
      status: 'available',
      content: Buffer.from('ok'),
      mimeType: 'text/plain',
      size: 2,
    })
    const row = getDrizzleDb().select().from(attachments).where(eq(attachments.attachmentId, ref.attachmentId)).get()
    expect(row?.groupContextId).toBe(PARENT)
  })

  test('stageFileMetadata populates group_context_id as the thread-stripped parent for a thread context', () => {
    const staged = stageFileMetadata({
      contextId: THREAD_1,
      messageId: null,
      senderId: 'u1',
      senderUsername: null,
      filename: 'gci-staged.txt',
      mimeType: 'text/plain',
      size: 2,
      platformFileId: 'pf-gci-staged',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: PLATFORM,
      origin: null,
      forwardedFrom: null,
    })
    const row = getDrizzleDb().select().from(stagedFiles).where(eq(stagedFiles.stagedId, staged.stagedId)).get()
    expect(row?.groupContextId).toBe(PARENT)
  })
})
