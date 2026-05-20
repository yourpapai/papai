// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { stagedFiles } from '../../src/db/schema.js'
import { stagedForSubject } from '../../src/stats/per-table-subject.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('stagedForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no staged files', () => {
    expect(stagedForSubject('nobody')).toEqual({ total: 0, byStatus: {}, bytesTotal: 0 })
  })

  test('aggregates total, status mix and total bytes', () => {
    getDrizzleDb()
      .insert(stagedFiles)
      .values([
        {
          stagedId: 's1',
          contextId: 'u1',
          senderId: 'u1',
          filename: 'f.txt',
          platformFileId: 'p1',
          sourceProvider: 'telegram',
          status: 'staged',
          size: 100,
          createdAt: '2026-01-01',
          expiresAt: '2026-01-02',
        },
        {
          stagedId: 's2',
          contextId: 'u1',
          senderId: 'u1',
          filename: 'g.txt',
          platformFileId: 'p2',
          sourceProvider: 'telegram',
          status: 'staged',
          size: 50,
          createdAt: '2026-01-01',
          expiresAt: '2026-01-02',
        },
        {
          stagedId: 's3',
          contextId: 'u1',
          senderId: 'u1',
          filename: 'h.txt',
          platformFileId: 'p3',
          sourceProvider: 'telegram',
          status: 'attached',
          size: null,
          createdAt: '2026-01-01',
          expiresAt: '2026-01-02',
        },
        {
          stagedId: 's4',
          contextId: 'other',
          senderId: 'other',
          filename: 'x.txt',
          platformFileId: 'p4',
          sourceProvider: 'telegram',
          status: 'staged',
          size: 999,
          createdAt: '2026-01-01',
          expiresAt: '2026-01-02',
        },
      ])
      .run()

    const result = stagedForSubject('u1')

    expect(result.total).toBe(3)
    expect(result.byStatus).toEqual({ staged: 2, attached: 1 })
    expect(result.bytesTotal).toBe(150)
  })
})
