// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { attachments } from '../../src/db/attachments-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachments.groupContextId', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('round-trips group_context_id', () => {
    const db = getDrizzleDb()
    db.insert(attachments)
      .values({
        attachmentId: 'a1',
        contextId: 'g:thread:a',
        groupContextId: 'g',
        sourceProvider: 'telegram',
        filename: 'f.txt',
        checksum: 'c',
        blobKey: 'b',
        status: 'stored',
        createdAt: '2026-06-16T00:00:00.000Z',
      })
      .run()
    const row = db.select().from(attachments).where(eq(attachments.attachmentId, 'a1')).get()
    expect(row?.groupContextId).toBe('g')
  })
})
