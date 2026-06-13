// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createInMemoryBlobStoreForTesting,
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
} from '../../src/attachments/blob-store.js'
import { persistIncomingAttachments } from '../../src/attachments/ingest.js'
import { loadAttachmentRecord } from '../../src/attachments/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('persistIncomingAttachments', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
  })

  afterEach(() => {
    resetBlobStoreForTesting()
  })

  test('persists origin and forwardedFrom from IncomingFile', async () => {
    const refs = await persistIncomingAttachments({
      contextId: 'ctx-ingest',
      sourceProvider: 'telegram',
      files: [
        {
          fileId: 'f-voice',
          filename: 'voice.ogg',
          content: Buffer.from('audio'),
          mimeType: 'audio/ogg',
          origin: 'voice',
          forwardedFrom: 'Alice',
        },
      ],
    })
    const stored = await loadAttachmentRecord('ctx-ingest', refs[0]!.attachmentId)
    expect(stored?.origin).toBe('voice')
    expect(stored?.forwardedFrom).toBe('Alice')
  })

  test('omits origin and forwardedFrom when not provided', async () => {
    const refs = await persistIncomingAttachments({
      contextId: 'ctx-ingest-2',
      sourceProvider: 'telegram',
      files: [
        {
          fileId: 'f-plain',
          filename: 'doc.pdf',
          content: Buffer.from('data'),
          mimeType: 'application/pdf',
        },
      ],
    })
    const stored = await loadAttachmentRecord('ctx-ingest-2', refs[0]!.attachmentId)
    expect(stored?.origin).toBeUndefined()
    expect(stored?.forwardedFrom).toBeUndefined()
  })
})
