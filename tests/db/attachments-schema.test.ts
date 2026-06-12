// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { attachments } from '../../src/db/attachments-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachments schema', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('exposes the attachments table through Drizzle', () => {
    expect(attachments.attachmentId).toBeDefined()
    expect(attachments.contextId).toBeDefined()
    expect(attachments.filename).toBeDefined()
    expect(attachments.status).toBeDefined()
  })

  test('attachments accepts origin and forwarded_from', () => {
    const db = getDrizzleDb()
    const now = new Date().toISOString()
    db.insert(attachments)
      .values({
        attachmentId: 'att_origin_test',
        contextId: 'ctx-origin',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        checksum: 'abc123',
        blobKey: 'blobs/voice.ogg',
        status: 'available',
        createdAt: now,
        origin: 'voice',
        forwardedFrom: 'Alice',
      })
      .run()
    const row = db.select().from(attachments).where(eq(attachments.attachmentId, 'att_origin_test')).get()
    expect(row?.origin).toBe('voice')
    expect(row?.forwardedFrom).toBe('Alice')
  })
})
