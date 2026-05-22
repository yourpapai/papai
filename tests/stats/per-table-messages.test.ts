// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { messageMetadata } from '../../src/db/schema.js'
import { messageMetadataForSubject } from '../../src/stats/per-table-content.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('messageMetadataForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no messages', () => {
    expect(messageMetadataForSubject('nobody')).toEqual({
      total: 0,
      authoredBySubject: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      textBytesTotal: 0,
    })
  })

  test('aggregates total, authored-by-subject count, oldest/newest, text bytes', () => {
    getDrizzleDb()
      .insert(messageMetadata)
      .values([
        {
          contextId: 'u1',
          messageId: '1',
          authorId: 'u1',
          text: 'hello',
          timestamp: 1000,
          expiresAt: 9000,
        },
        {
          contextId: 'u1',
          messageId: '2',
          authorId: 'someone-else',
          text: 'world!',
          timestamp: 2000,
          expiresAt: 9000,
        },
        {
          contextId: 'u1',
          messageId: '3',
          authorId: 'u1',
          text: null,
          timestamp: 3000,
          expiresAt: 9000,
        },
        {
          contextId: 'other',
          messageId: '4',
          authorId: 'other',
          text: 'leak',
          timestamp: 9999,
          expiresAt: 9999,
        },
      ])
      .run()

    const result = messageMetadataForSubject('u1')

    expect(result.total).toBe(3)
    expect(result.authoredBySubject).toBe(2)
    expect(result.oldestTimestamp).toBe(1000)
    expect(result.newestTimestamp).toBe(3000)
    expect(result.textBytesTotal).toBe(5 + 6)
  })
})
