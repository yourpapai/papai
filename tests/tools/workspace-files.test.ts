// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { _createInMemoryBlobStore, _resetBlobStore, _setBlobStore } from '../../src/attachments/blob-store.js'
import { listActiveAttachments } from '../../src/attachments/index.js'
import { persistIncomingAttachments } from '../../src/attachments/ingest.js'
import { makeDeleteFileTool, makeListFilesTool } from '../../src/tools/workspace-files.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'ctx-workspace-files'

describe('workspace file tools', () => {
  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
    _setBlobStore(_createInMemoryBlobStore())

    await persistIncomingAttachments({
      contextId: CTX,
      sourceProvider: 'telegram',
      files: [
        {
          fileId: 'f1',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          size: 100,
          content: Buffer.from('pdf-data'),
        },
        {
          fileId: 'f2',
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 200,
          content: Buffer.from('jpg-data'),
        },
      ],
    })
  })

  afterEach(() => {
    _resetBlobStore()
  })

  describe('list_files', () => {
    test('has correct description', () => {
      const t = makeListFilesTool(CTX)
      expect(t.description).toContain('workspace')
    })

    test('schema accepts no arguments', () => {
      const t = makeListFilesTool(CTX)
      expect(schemaValidates(t, {})).toBe(true)
    })

    test('returns active workspace attachments', async () => {
      const execute = getToolExecutor(makeListFilesTool(CTX))
      const result = await execute({})
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
    })

    test('returns metadata for each file', async () => {
      const execute = getToolExecutor(makeListFilesTool(CTX))
      const result = await execute({})
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            size: 100,
          }),
          expect.objectContaining({
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 200,
          }),
        ]),
      )
    })
  })

  describe('delete_file', () => {
    test('has correct description', () => {
      const t = makeDeleteFileTool(CTX)
      expect(t.description).toContain('workspace')
    })

    test('schema requires fileId and confidence', () => {
      const t = makeDeleteFileTool(CTX)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { fileId: 'att_123' })).toBe(false)
      expect(schemaValidates(t, { fileId: 'att_123', confidence: 1 })).toBe(true)
    })

    test('blocks when confidence is below threshold', async () => {
      const execute = getToolExecutor(makeDeleteFileTool(CTX))
      const result = await execute({ fileId: 'some-id', confidence: 0.5 })
      expect(result).toMatchObject({ status: 'confirmation_required' })
    })

    test('removes file from workspace list when confidence is sufficient', async () => {
      const activeBefore = listActiveAttachments(CTX)
      expect(activeBefore).toHaveLength(2)
      const targetId = activeBefore[0]!.attachmentId

      const execute = getToolExecutor(makeDeleteFileTool(CTX))
      const result = await execute({ fileId: targetId, confidence: 0.9 })

      expect(result).toMatchObject({ status: 'deleted' })
      const activeAfter = listActiveAttachments(CTX)
      expect(activeAfter).toHaveLength(1)
      expect(activeAfter[0]!.attachmentId).toBe(activeBefore[1]!.attachmentId)
    })

    test('returns not_found for unknown fileId', async () => {
      const execute = getToolExecutor(makeDeleteFileTool(CTX))
      const result = await execute({ fileId: 'att_does_not_exist', confidence: 0.9 })
      expect(result).toMatchObject({ status: 'not_found' })
    })
  })
})
