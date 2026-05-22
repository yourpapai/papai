// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YouTrackAttachmentSchema } from '../../../../src/providers/youtrack/schemas/attachment.js'

describe('YouTrackAttachmentSchema', () => {
  const validAttachment = {
    id: '0-0',
    name: 'document.pdf',
    url: 'https://example.com/file.pdf',
  }

  test('validates attachment with all fields', () => {
    const full = {
      ...validAttachment,
      $type: 'Attachment',
      mimeType: 'application/pdf',
      size: 1024,
      thumbnailURL: 'https://example.com/thumb.png',
      author: { login: 'alice' },
      created: 1700000000000,
    }
    const result = YouTrackAttachmentSchema.parse(full)
    expect(result.id).toBe('0-0')
    expect(result.name).toBe('document.pdf')
    expect(result.mimeType).toBe('application/pdf')
    expect(result.size).toBe(1024)
    expect(result.url).toBe('https://example.com/file.pdf')
    expect(result.thumbnailURL).toBe('https://example.com/thumb.png')
    expect(result.author?.login).toBe('alice')
    expect(result.created).toBe(1700000000000)
  })

  test('validates minimal attachment with id and name', () => {
    const result = YouTrackAttachmentSchema.parse(validAttachment)
    expect(result.id).toBe('0-0')
    expect(result.name).toBe('document.pdf')
    expect(result.url).toBe('https://example.com/file.pdf')
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validAttachment
    expect(() => YouTrackAttachmentSchema.parse(invalid)).toThrow()
  })

  test('missing name rejects', () => {
    const { name: _, ...invalid } = validAttachment
    expect(() => YouTrackAttachmentSchema.parse(invalid)).toThrow()
  })

  test('name as number rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, name: 42 })).toThrow()
  })

  test('url as number rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, url: 123 })).toThrow()
  })

  test('mimeType as number rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, mimeType: 123 })).toThrow()
  })

  test('size as string rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, size: 'big' })).toThrow()
  })

  test('author as string rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, author: 'alice' })).toThrow()
  })

  test('created as string rejects', () => {
    expect(() => YouTrackAttachmentSchema.parse({ ...validAttachment, created: 'yesterday' })).toThrow()
  })

  test('optional fields omitted accepts', () => {
    const result = YouTrackAttachmentSchema.parse(validAttachment)
    expect(result.mimeType).toBeUndefined()
    expect(result.size).toBeUndefined()
    expect(result.thumbnailURL).toBeUndefined()
    expect(result.author).toBeUndefined()
    expect(result.created).toBeUndefined()
  })
})
