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
  type InMemoryBlobStore,
} from '../../src/attachments/blob-store.js'
import { loadAttachmentRecord, saveAttachment } from '../../src/attachments/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachment store', () => {
  let blobs: InMemoryBlobStore

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    blobs = createInMemoryBlobStoreForTesting()
    setBlobStoreForTesting(blobs)
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('persists metadata in SQLite and bytes in the configured blob store', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-store',
      sourceProvider: 'telegram',
      sourceMessageId: 'm-1',
      sourceFileId: 'f-1',
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      status: 'available',
      content: Buffer.from('data'),
    })

    expect(ref.attachmentId.startsWith('att_')).toBe(true)
    expect(ref.filename).toBe('report.pdf')

    const record = await loadAttachmentRecord('ctx-store', ref.attachmentId)

    expect(record).not.toBeNull()
    assert(record !== null)
    expect(record.filename).toBe('report.pdf')
    expect(record.content.toString('utf8')).toBe('data')
    expect(record.checksum).toBeDefined()
    expect(record.blobKey).toContain(ref.attachmentId)
    expect(blobs.has(record.blobKey)).toBe(true)
  })

  test('returns null for unknown attachment ids', async () => {
    const record = await loadAttachmentRecord('ctx-store', 'att_does_not_exist')
    expect(record).toBeNull()
  })

  test('returns null for cleared attachments', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-store',
      sourceProvider: 'telegram',
      filename: 'x.txt',
      mimeType: 'text/plain',
      size: 1,
      status: 'available',
      content: Buffer.from('x'),
    })

    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    const { attachments } = await import('../../src/db/schema.js')
    const { eq } = await import('drizzle-orm')

    getDrizzleDb()
      .update(attachments)
      .set({ clearedAt: new Date().toISOString(), isActive: 0 })
      .where(eq(attachments.attachmentId, ref.attachmentId))
      .run()

    expect(await loadAttachmentRecord('ctx-store', ref.attachmentId)).toBeNull()
  })

  test('persists and round-trips origin and forwardedFrom', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-origin',
      sourceProvider: 'telegram',
      filename: 'voice.ogg',
      status: 'available',
      content: Buffer.from('audio'),
      mimeType: 'audio/ogg',
      origin: 'voice',
      forwardedFrom: 'Alice',
    })
    const stored = await loadAttachmentRecord('ctx-origin', ref.attachmentId)
    expect(stored?.origin).toBe('voice')
    expect(stored?.forwardedFrom).toBe('Alice')
  })

  test('persists and round-trips origin file', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-origin',
      sourceProvider: 'telegram',
      filename: 'doc.pdf',
      status: 'available',
      content: Buffer.from('pdf'),
      mimeType: 'application/pdf',
      origin: 'file',
    })
    const stored = await loadAttachmentRecord('ctx-origin', ref.attachmentId)
    expect(stored?.origin).toBe('file')
  })

  test('origin and forwardedFrom are absent when not provided', async () => {
    const ref = await saveAttachment({
      contextId: 'ctx-origin',
      sourceProvider: 'telegram',
      filename: 'doc.pdf',
      status: 'available',
      content: Buffer.from('pdf'),
    })
    const stored = await loadAttachmentRecord('ctx-origin', ref.attachmentId)
    expect(stored?.origin).toBeUndefined()
    expect(stored?.forwardedFrom).toBeUndefined()
  })
})
