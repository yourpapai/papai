// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { attachments } from '../../src/db/schema.js'
import { attachmentsForSubject } from '../../src/stats/per-table-content.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('attachmentsForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no attachments', () => {
    expect(attachmentsForSubject('nobody')).toEqual({
      total: 0,
      byStatus: {},
      bySourceProvider: {},
      storedBytesTotal: 0,
      active: 0,
      byExtension: {},
    })
  })

  test('aggregates counts, status/provider mix, bytes, active, extension mix', () => {
    getDrizzleDb()
      .insert(attachments)
      .values([
        {
          attachmentId: 'a1',
          contextId: 'u1',
          sourceProvider: 'telegram',
          filename: 'photo.JPG',
          size: 1000,
          checksum: 'c1',
          blobKey: 'b1',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          attachmentId: 'a2',
          contextId: 'u1',
          sourceProvider: 'telegram',
          filename: 'doc.pdf',
          size: 500,
          checksum: 'c2',
          blobKey: 'b2',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-02T00:00:00Z',
        },
        {
          attachmentId: 'a3',
          contextId: 'u1',
          sourceProvider: 'mattermost',
          filename: 'archive.tar.gz',
          size: 200,
          checksum: 'c3',
          blobKey: 'b3',
          status: 'cleared',
          isActive: 0,
          createdAt: '2026-01-03T00:00:00Z',
        },
        {
          attachmentId: 'a4',
          contextId: 'u1',
          sourceProvider: 'telegram',
          filename: 'no_extension',
          size: null,
          checksum: 'c4',
          blobKey: 'b4',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-04T00:00:00Z',
        },
        {
          attachmentId: 'a5',
          contextId: 'other',
          sourceProvider: 'telegram',
          filename: 'leak.txt',
          size: 9999,
          checksum: 'c5',
          blobKey: 'b5',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-05T00:00:00Z',
        },
      ])
      .run()

    const result = attachmentsForSubject('u1')

    expect(result.total).toBe(4)
    expect(result.byStatus).toEqual({ stored: 3, cleared: 1 })
    expect(result.bySourceProvider).toEqual({ telegram: 3, mattermost: 1 })
    expect(result.storedBytesTotal).toBe(1000 + 500 + 200)
    expect(result.active).toBe(3)
    expect(result.byExtension['jpg']).toBe(1)
    expect(result.byExtension['pdf']).toBe(1)
    expect(result.byExtension['gz']).toBe(1)
    expect(result.byExtension['(none)']).toBe(1)
  })
})
