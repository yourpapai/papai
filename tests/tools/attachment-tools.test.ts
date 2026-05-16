// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { persistIncomingAttachments } from '../../src/attachments/index.js'
import type { IncomingFile } from '../../src/chat/types.js'
import { makeListAttachmentsTool } from '../../src/tools/list-attachments.js'
import { makeRemoveAttachmentTool } from '../../src/tools/remove-attachment.js'
import { makeUploadAttachmentTool } from '../../src/tools/upload-attachment.js'
import { getToolExecutor, mockLogger, schemaValidates, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CTX = 'ctx-attach-test'

function makeIncomingFile(overrides: Partial<IncomingFile> = {}): IncomingFile {
  return {
    fileId: 'file-1',
    filename: 'screenshot.png',
    mimeType: 'image/png',
    size: 1024,
    content: Buffer.from('fake-png'),
    ...overrides,
  }
}

describe('Attachment Tools', () => {
  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  describe('makeListAttachmentsTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeListAttachmentsTool(provider)
      expect(t.description).toContain('List all attachments')
    })

    test('schema requires taskId', () => {
      const provider = createMockProvider()
      const t = makeListAttachmentsTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1' })).toBe(true)
    })

    test('returns attachments from provider', async () => {
      const attachments = [{ id: 'att-1', name: 'file.txt', url: 'https://example.com/file.txt' }]
      const provider = createMockProvider({
        listAttachments: mock(() => Promise.resolve(attachments)),
      })
      const execute = getToolExecutor(makeListAttachmentsTool(provider))
      const result: unknown = await execute({ taskId: 'task-1' })
      expect(result).toEqual(attachments)
    })

    test('calls provider.listAttachments with correct taskId', async () => {
      const listAttachments = mock(() => Promise.resolve([]))
      const provider = createMockProvider({ listAttachments })
      const execute = getToolExecutor(makeListAttachmentsTool(provider))
      await execute({ taskId: 'task-42' })
      expect(listAttachments).toHaveBeenCalledWith('task-42')
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        listAttachments: mock(() => Promise.reject(new Error('network error'))),
      })
      const execute = getToolExecutor(makeListAttachmentsTool(provider))
      await expect(execute({ taskId: 'task-1' })).rejects.toThrow('network error')
    })
  })

  describe('makeUploadAttachmentTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeUploadAttachmentTool(provider, CTX)
      expect(t.description).toContain('Upload a file attachment')
    })

    test('schema requires taskId and attachmentId', () => {
      const provider = createMockProvider()
      const t = makeUploadAttachmentTool(provider, CTX)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1' })).toBe(false)
      expect(schemaValidates(t, { attachmentId: 'att_1' })).toBe(false)
      expect(schemaValidates(t, { taskId: 'task-1', attachmentId: 'att_1' })).toBe(true)
    })

    test('returns attachment_not_found when the attachmentId is missing from the workspace', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
      const result = await execute({ taskId: 'task-1', attachmentId: 'att_missing' })
      expect(result).toMatchObject({ status: 'attachment_not_found' })
    })

    test('uploads file when attachmentId is found in the workspace', async () => {
      const file = makeIncomingFile({ fileId: 'platform-1', filename: 'photo.jpg', mimeType: 'image/jpeg' })
      const refs = await persistIncomingAttachments({
        contextId: CTX,
        sourceProvider: 'telegram',
        files: [file],
      })

      const attachment = { id: 'att-99', name: 'photo.jpg', url: 'https://example.com/photo.jpg' }
      const uploadAttachment = mock(() => Promise.resolve(attachment))
      const provider = createMockProvider({ uploadAttachment })

      const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
      const result: unknown = await execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })

      expect(result).toEqual(attachment)
      expect(uploadAttachment).toHaveBeenCalledWith('task-1', {
        name: 'photo.jpg',
        content: file.content,
        mimeType: 'image/jpeg',
      })
    })

    test('uploads file without mimeType when not present', async () => {
      const file = makeIncomingFile({ fileId: 'platform-1', filename: 'data.csv', mimeType: undefined })
      const refs = await persistIncomingAttachments({
        contextId: CTX,
        sourceProvider: 'telegram',
        files: [file],
      })

      const uploadAttachment = mock(() =>
        Promise.resolve({ id: 'att-1', name: 'data.csv', url: 'https://example.com/data.csv' }),
      )
      const provider = createMockProvider({ uploadAttachment })

      await getToolExecutor(makeUploadAttachmentTool(provider, CTX))({
        taskId: 't1',
        attachmentId: refs[0]!.attachmentId,
      })

      expect(uploadAttachment).toHaveBeenCalledWith('t1', {
        name: 'data.csv',
        content: file.content,
        mimeType: undefined,
      })
    })

    test('propagates provider upload errors', async () => {
      const refs = await persistIncomingAttachments({
        contextId: CTX,
        sourceProvider: 'telegram',
        files: [makeIncomingFile()],
      })
      const provider = createMockProvider({
        uploadAttachment: mock(() => Promise.reject(new Error('upload failed'))),
      })
      const execute = getToolExecutor(makeUploadAttachmentTool(provider, CTX))
      await expect(execute({ taskId: 'task-1', attachmentId: refs[0]!.attachmentId })).rejects.toThrow('upload failed')
    })
  })

  describe('makeRemoveAttachmentTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const t = makeRemoveAttachmentTool(provider)
      expect(t.description).toContain('Remove an attachment')
    })

    test('schema requires taskId, attachmentId, and confidence', () => {
      const provider = createMockProvider()
      const t = makeRemoveAttachmentTool(provider)
      expect(schemaValidates(t, {})).toBe(false)
      expect(schemaValidates(t, { taskId: 't1', attachmentId: 'att-1' })).toBe(false)
      expect(schemaValidates(t, { taskId: 't1', attachmentId: 'att-1', confidence: 0.9 })).toBe(true)
    })

    test('blocks when confidence is below threshold', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeRemoveAttachmentTool(provider))
      const result = await execute({ taskId: 't1', attachmentId: 'att-1', confidence: 0.7 })
      expect(result).toMatchObject({ status: 'confirmation_required' })
    })

    test('deletes attachment when confidence is sufficient', async () => {
      const deleteAttachment = mock(() => Promise.resolve({ id: 'att-1' }))
      const provider = createMockProvider({ deleteAttachment })
      const execute = getToolExecutor(makeRemoveAttachmentTool(provider))
      const result: unknown = await execute({ taskId: 't1', attachmentId: 'att-1', confidence: 0.9 })
      expect(result).toEqual({ id: 'att-1' })
      expect(deleteAttachment).toHaveBeenCalledWith('t1', 'att-1')
    })

    test('uses label in confirmation message', async () => {
      const provider = createMockProvider()
      const execute = getToolExecutor(makeRemoveAttachmentTool(provider))
      const result: unknown = await execute({
        taskId: 't1',
        attachmentId: 'att-1',
        label: 'screenshot.png',
        confidence: 0.5,
      })
      expect(result).toMatchObject({ status: 'confirmation_required' })
      assert(typeof result === 'object')
      assert(result !== null)
      assert('message' in result)
      const message = (result as Record<string, unknown>)['message']
      assert(typeof message === 'string')
      expect(message).toContain('screenshot.png')
    })

    test('propagates provider errors', async () => {
      const provider = createMockProvider({
        deleteAttachment: mock(() => Promise.reject(new Error('forbidden'))),
      })
      const execute = getToolExecutor(makeRemoveAttachmentTool(provider))
      await expect(execute({ taskId: 't1', attachmentId: 'att-1', confidence: 1.0 })).rejects.toThrow('forbidden')
    })
  })
})
