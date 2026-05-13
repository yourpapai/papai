import { describe, expect, test } from 'bun:test'

import {
  buildAttachmentManifest,
  buildHistoryAttachmentLines,
  selectAttachmentsForTurn,
  supportsAttachmentModelInput,
} from '../../src/attachments/resolver.js'
import type { AttachmentRef } from '../../src/attachments/types.js'

const refs: AttachmentRef[] = [
  {
    attachmentId: 'att_123',
    contextId: 'ctx',
    filename: 'design.pdf',
    mimeType: 'application/pdf',
    size: 12,
    status: 'available',
  },
  {
    attachmentId: 'att_456',
    contextId: 'ctx',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 34,
    status: 'available',
  },
]

describe('attachment resolver', () => {
  test('buildAttachmentManifest renders papai attachment ids and metadata', () => {
    expect(buildAttachmentManifest(refs)).toBe(
      '[Available attachments: att_123 design.pdf (application/pdf, 12 bytes); att_456 photo.jpg (image/jpeg, 34 bytes)]',
    )
  })

  test('buildAttachmentManifest returns null for an empty list', () => {
    expect(buildAttachmentManifest([])).toBeNull()
  })

  test('selectAttachmentsForTurn includes new attachments and any old IDs mentioned in the text', () => {
    const selected = selectAttachmentsForTurn({
      text: 'Please compare att_456 with the new upload',
      newAttachmentIds: ['att_123'],
      activeAttachments: refs,
    })
    expect(selected.map((ref) => ref.attachmentId)).toEqual(['att_123', 'att_456'])
  })

  test('selectAttachmentsForTurn returns only new attachments when the text does not reference others', () => {
    const selected = selectAttachmentsForTurn({
      text: 'What is in this file?',
      newAttachmentIds: ['att_456'],
      activeAttachments: refs,
    })
    expect(selected.map((ref) => ref.attachmentId)).toEqual(['att_456'])
  })

  test('supportsAttachmentModelInput recognises common multimodal model name prefixes', () => {
    expect(supportsAttachmentModelInput('gpt-4o-2024-08-06')).toBe(true)
    expect(supportsAttachmentModelInput('claude-sonnet-4-5')).toBe(true)
    expect(supportsAttachmentModelInput('llama-3.1-instruct')).toBe(false)
  })

  test('buildHistoryAttachmentLines emits one [User attached ...] line per ref', () => {
    expect(buildHistoryAttachmentLines(refs)).toEqual([
      '[User attached att_123: design.pdf]',
      '[User attached att_456: photo.jpg]',
    ])
  })
})
