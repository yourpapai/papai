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
import { stageFileMetadata } from '../../src/attachments/staged.js'
import { saveAttachment } from '../../src/attachments/store.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { stagedFiles } from '../../src/db/staged-schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('saveAttachment populates group_context_id', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('stores the thread-stripped parent for a thread context', async () => {
    const thread = toScopedThreadContextId({ platformInstanceId: 'pi', nativeContextId: 'grp', threadId: 't1' })
    const parent = toScopedContextId({ platformInstanceId: 'pi', nativeContextId: 'grp' })
    await saveAttachment({
      contextId: thread,
      sourceProvider: 'telegram',
      filename: 'f.txt',
      status: 'available',
      content: Buffer.from('hello'),
      mimeType: 'text/plain',
      size: 5,
    })
    const row = getDrizzleDb().select().from(attachments).where(eq(attachments.contextId, thread)).get()
    expect(row?.groupContextId).toBe(parent)
  })

  test('stores the context id itself for a non-thread (DM) context', async () => {
    const dmContext = toScopedContextId({ platformInstanceId: 'pi', nativeContextId: 'dm1' })
    await saveAttachment({
      contextId: dmContext,
      sourceProvider: 'telegram',
      filename: 'note.txt',
      status: 'available',
      content: Buffer.from('hi'),
      mimeType: 'text/plain',
      size: 2,
    })
    const row = getDrizzleDb().select().from(attachments).where(eq(attachments.contextId, dmContext)).get()
    expect(row?.groupContextId).toBe(dmContext)
  })
})

describe('stageFileMetadata populates group_context_id', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('stores the thread-stripped parent for a thread context', () => {
    const thread = toScopedThreadContextId({ platformInstanceId: 'pi', nativeContextId: 'grp', threadId: 't2' })
    const parent = toScopedContextId({ platformInstanceId: 'pi', nativeContextId: 'grp' })
    stageFileMetadata({
      contextId: thread,
      messageId: null,
      senderId: 'user-1',
      senderUsername: null,
      filename: 'img.png',
      mimeType: 'image/png',
      size: 100,
      platformFileId: 'pf_t2',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'pi',
      origin: null,
      forwardedFrom: null,
    })
    const row = getDrizzleDb().select().from(stagedFiles).where(eq(stagedFiles.contextId, thread)).get()
    expect(row?.groupContextId).toBe(parent)
  })

  test('stores the context id itself for a non-thread (DM) context', () => {
    const dmContext = toScopedContextId({ platformInstanceId: 'pi', nativeContextId: 'dm2' })
    stageFileMetadata({
      contextId: dmContext,
      messageId: null,
      senderId: 'user-1',
      senderUsername: null,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      size: 50,
      platformFileId: 'pf_dm2',
      sourceProvider: 'telegram',
      sourcePlatformInstanceId: 'pi',
      origin: null,
      forwardedFrom: null,
    })
    const row = getDrizzleDb().select().from(stagedFiles).where(eq(stagedFiles.contextId, dmContext)).get()
    expect(row?.groupContextId).toBe(dmContext)
  })
})
