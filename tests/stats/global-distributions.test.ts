// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments, memos, messageMetadata, recurringTasks, users } from '../../src/db/schema.js'
import { distributionsGlobal } from '../../src/stats/global-distributions.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('distributionsGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zeroed percentiles when no rows exist', () => {
    const result = distributionsGlobal()
    expect(result.memosPerSubject.count).toBe(0)
    expect(result.recurringTasksPerSubject.count).toBe(0)
    expect(result.messageMetadataPerSubject.count).toBe(0)
    expect(result.attachmentBytesPerSubject.count).toBe(0)
  })

  test('computes percentile distributions per subject across four tables', () => {
    const subjects = ['s1', 's2', 's3', 's4', 's5']

    getDrizzleDb()
      .insert(users)
      .values(subjects.map((id) => ({ platformUserId: id, addedBy: 'admin' })))
      .run()

    const memoRows = subjects.flatMap((id, idx) =>
      Array.from({ length: idx + 1 }, (_, k) => ({
        id: `${id}-m-${String(k)}`,
        userId: id,
        content: 'x',
        tags: '[]',
      })),
    )
    getDrizzleDb().insert(memos).values(memoRows).run()

    const recurringRows = subjects.flatMap((id, idx) =>
      Array.from({ length: idx + 1 }, (_, k) => ({
        id: `${id}-r-${String(k)}`,
        userId: id,
        projectId: 'p',
        title: 't',
        enabled: '1',
      })),
    )
    getDrizzleDb().insert(recurringTasks).values(recurringRows).run()

    const messageRows = subjects.flatMap((id, idx) =>
      Array.from({ length: idx + 1 }, (_, k) => ({
        contextId: id,
        messageId: `${id}-msg-${String(k)}`,
        timestamp: 1000 + k,
        expiresAt: 9999,
      })),
    )
    getDrizzleDb().insert(messageMetadata).values(messageRows).run()

    const attachmentRows = subjects.flatMap((id, idx) =>
      Array.from({ length: idx + 1 }, (_, k) => ({
        attachmentId: `${id}-a-${String(k)}`,
        contextId: id,
        sourceProvider: 'telegram',
        filename: 'f.bin',
        size: 100,
        checksum: 'c',
        blobKey: 'b',
        status: 'stored',
        isActive: 1,
        createdAt: '2026-01-01T00:00:00Z',
      })),
    )
    getDrizzleDb().insert(attachments).values(attachmentRows).run()

    const result = distributionsGlobal()
    expect(result.memosPerSubject.count).toBe(5)
    expect(result.memosPerSubject.min).toBe(1)
    expect(result.memosPerSubject.max).toBe(5)
    expect(result.memosPerSubject.mean).toBe(3)

    expect(result.recurringTasksPerSubject.count).toBe(5)
    expect(result.recurringTasksPerSubject.max).toBe(5)

    expect(result.messageMetadataPerSubject.count).toBe(5)
    expect(result.messageMetadataPerSubject.max).toBe(5)

    expect(result.attachmentBytesPerSubject.count).toBe(5)
    expect(result.attachmentBytesPerSubject.min).toBe(100)
    expect(result.attachmentBytesPerSubject.max).toBe(500)
  })
})
