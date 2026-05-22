// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  StagedFileRef,
  StagedFileStatus,
  StageFileParams,
  StagedResolutionError,
} from '../../src/attachments/types.js'

describe('StagedFileRef', () => {
  test('has all required fields', () => {
    const ref: StagedFileRef = {
      stagedId: 'staged-1',
      contextId: 'ctx-1',
      messageId: null,
      senderId: 'user-1',
      senderUsername: null,
      filename: 'test.pdf',
      mimeType: null,
      size: null,
      platformFileId: 'file-123',
      sourceProvider: 'telegram',
      status: 'staged',
      attachmentId: null,
      createdAt: '2025-01-01T00:00:00Z',
      expiresAt: '2025-01-01T01:00:00Z',
    }
    expect(ref.stagedId).toBe('staged-1')
    expect(ref.status).toBe('staged')
  })
})

describe('StagedFileStatus', () => {
  test('accepts all status values', () => {
    const statuses: StagedFileStatus[] = ['staged', 'resolved', 'failed', 'expired']
    expect(statuses).toHaveLength(4)
  })
})

describe('StageFileParams', () => {
  test('has required fields', () => {
    const params: StageFileParams = {
      contextId: 'ctx-1',
      messageId: null,
      senderId: 'user-1',
      senderUsername: null,
      filename: 'doc.pdf',
      mimeType: null,
      size: null,
      platformFileId: 'pf-1',
      sourceProvider: 'telegram',
    }
    expect(params.contextId).toBe('ctx-1')
    expect(params.filename).toBe('doc.pdf')
  })
})

describe('StagedResolutionError', () => {
  test('accepts all discriminated union variants', () => {
    const expired: StagedResolutionError = { status: 'staged_file_expired', message: 'expired' }
    const failed: StagedResolutionError = { status: 'download_failed', message: 'failed' }
    const resolved: StagedResolutionError = { status: 'already_resolved', attachmentId: 'att-1' }
    const notFound: StagedResolutionError = { status: 'not_found', message: 'not found' }
    expect(expired.status).toBe('staged_file_expired')
    expect(failed.status).toBe('download_failed')
    expect(resolved.status).toBe('already_resolved')
    expect(notFound.status).toBe('not_found')
  })
})
