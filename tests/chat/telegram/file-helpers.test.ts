// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { extractFileCandidatesFromContext, extractFilesFromContext } from '../../../src/chat/telegram/file-helpers.js'

describe('extractFileCandidatesFromContext', () => {
  test('returns empty array when no files are present', () => {
    const result = extractFileCandidatesFromContext({})
    expect(result).toEqual([])
  })

  test('extracts document candidate metadata without downloading', () => {
    const result = extractFileCandidatesFromContext({
      message: {
        document: {
          file_id: 'doc123',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
          file_size: 1024,
        },
      },
    })
    expect(result).toEqual([{ fileId: 'doc123', filename: 'report.pdf', mimeType: 'application/pdf', size: 1024 }])
  })

  test('extracts photo candidate with default filename', () => {
    const result = extractFileCandidatesFromContext({
      message: {
        photo: [
          { file_id: 'small', file_size: 100 },
          { file_id: 'large', file_size: 500 },
        ],
      },
    })
    expect(result).toEqual([{ fileId: 'large', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 500 }])
  })

  test('returns only fileId and filename when optional fields are missing', () => {
    const result = extractFileCandidatesFromContext({
      message: { document: { file_id: 'doc456' } },
    })
    expect(result).toEqual([{ fileId: 'doc456', filename: 'document' }])
  })
})

describe('extractFilesFromContext', () => {
  test('downloads and returns files with content', async () => {
    const content = Buffer.from('file-content')
    const fetcher = (_fileId: string): Promise<Buffer> => Promise.resolve(content)
    const result = await extractFilesFromContext(
      {
        message: {
          document: { file_id: 'f1', file_name: 'a.txt', mime_type: 'text/plain', file_size: 12 },
        },
      },
      fetcher,
    )
    expect(result).toEqual([{ fileId: 'f1', filename: 'a.txt', mimeType: 'text/plain', size: 12, content }])
  })

  test('skips files when fetcher returns null', async () => {
    const fetcher = (_fileId: string): Promise<null> => Promise.resolve(null)
    const result = await extractFilesFromContext(
      { message: { document: { file_id: 'f1', file_name: 'a.txt' } } },
      fetcher,
    )
    expect(result).toEqual([])
  })
})
