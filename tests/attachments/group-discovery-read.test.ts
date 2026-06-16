// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { listActiveAttachments } from '../../src/attachments/workspace.js'
import { attachments } from '../../src/db/attachments-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const seed = (attachmentId: string, contextId: string, groupContextId: string): void => {
  getDrizzleDb()
    .insert(attachments)
    .values({
      attachmentId,
      contextId,
      groupContextId,
      sourceProvider: 'telegram',
      filename: `${attachmentId}.txt`,
      checksum: attachmentId,
      blobKey: attachmentId,
      status: 'stored',
      isActive: 1,
      createdAt: '2026-06-16T00:00:00.000Z',
    })
    .run()
}

describe('listActiveAttachments group discovery', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('without groupContextId, only the exact thread is returned', () => {
    seed('a', 'g:thread:1', 'g')
    seed('b', 'g:thread:2', 'g')
    expect(listActiveAttachments('g:thread:1').map((r) => r.attachmentId)).toEqual(['a'])
  })

  test('with groupContextId, sibling-thread attachments are included', () => {
    seed('a', 'g:thread:1', 'g')
    seed('b', 'g:thread:2', 'g')
    seed('c', 'other', 'other')
    const ids = listActiveAttachments('g:thread:1', { groupContextId: 'g' })
      .map((r) => r.attachmentId)
      .sort()
    expect(ids).toEqual(['a', 'b'])
  })
})
