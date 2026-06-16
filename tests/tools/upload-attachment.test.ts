// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
} from '../../src/attachments/blob-store.js'
import { persistIncomingAttachments } from '../../src/attachments/index.js'
import { makeUploadAttachmentTool } from '../../src/tools/upload-attachment.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CTX = 'ctx-upload-attachment'
const GROUP_CTX = 'ctx-upload-group'
const SIBLING_CTX = 'ctx-upload-sibling'

describe('makeUploadAttachmentTool', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('returns attachment_not_found when attachmentId is missing from the exact context', async () => {
    const provider = createMockProvider()
    const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
    const result = await execute({ taskId: 'task-1', attachmentId: 'att_missing' })
    expect(result).toMatchObject({ status: 'attachment_not_found' })
  })

  test('uploads file when attachmentId is found in the exact context', async () => {
    const refs = await persistIncomingAttachments({
      contextId: CTX,
      sourceProvider: 'telegram',
      files: [
        { fileId: 'pf-exact', filename: 'exact.txt', mimeType: 'text/plain', size: 4, content: Buffer.from('data') },
      ],
    })
    const attachment = { id: 'att-exact', name: 'exact.txt', url: 'https://example.com/exact.txt' }
    const uploadAttachment = mock(() => Promise.resolve(attachment))
    const provider = createMockProvider({ uploadAttachment })

    const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
    const result = await execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })
    expect(result).toEqual(attachment)
  })

  test('returns attachment_not_found for sibling-thread attachment without groupContextId', async () => {
    const refs = await persistIncomingAttachments({
      contextId: SIBLING_CTX,
      sourceProvider: 'telegram',
      files: [
        {
          fileId: 'pf-sibling-ug',
          filename: 'sibling-ug.txt',
          mimeType: 'text/plain',
          size: 4,
          content: Buffer.from('data'),
        },
      ],
    })
    // Set group_context_id manually
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    const { attachments } = await import('../../src/db/schema.js')
    const { eq } = await import('drizzle-orm')
    getDrizzleDb()
      .update(attachments)
      .set({ groupContextId: GROUP_CTX })
      .where(eq(attachments.attachmentId, refs[0]!.attachmentId))
      .run()

    const provider = createMockProvider()
    const execute = getToolExecutor(makeUploadAttachmentTool(provider, 'ctx-upload-other'))
    const result = await execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })
    expect(result).toMatchObject({ status: 'attachment_not_found' })
  })

  test('uploads cross-thread file when groupContextId is provided', async () => {
    const refs = await persistIncomingAttachments({
      contextId: SIBLING_CTX,
      sourceProvider: 'telegram',
      files: [
        {
          fileId: 'pf-sibling-cross',
          filename: 'cross.txt',
          mimeType: 'text/plain',
          size: 5,
          content: Buffer.from('cross'),
        },
      ],
    })
    // Set group_context_id manually
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    const { attachments } = await import('../../src/db/schema.js')
    const { eq } = await import('drizzle-orm')
    getDrizzleDb()
      .update(attachments)
      .set({ groupContextId: GROUP_CTX })
      .where(eq(attachments.attachmentId, refs[0]!.attachmentId))
      .run()

    const attachment = { id: 'att-cross-upload', name: 'cross.txt', url: 'https://example.com/cross.txt' }
    const uploadAttachment = mock(() => Promise.resolve(attachment))
    const provider = createMockProvider({ uploadAttachment })

    const execute = getToolExecutor(makeUploadAttachmentTool(provider, 'ctx-upload-other', GROUP_CTX))
    const result = await execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })
    expect(result).toEqual(attachment)
  })
})
