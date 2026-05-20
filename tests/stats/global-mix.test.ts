// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import {
  attachments,
  authorizedGroups,
  memos,
  recurringTasks,
  scheduledPrompts,
  userIdentityMappings,
  userInstructions,
  users,
} from '../../src/db/schema.js'
import { identityMixGlobal, storageGlobal, surfaceMixGlobal } from '../../src/stats/global-mix.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('storageGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero s3 bytes with no attachments; sqliteBytes via injected sizer', () => {
    const result = storageGlobal({ dbFileSize: () => 12345 })
    expect(result.s3AttachmentBytes).toBe(0)
    expect(result.sqliteBytes).toBe(12345)
  })

  test('sums active attachment sizes into s3AttachmentBytes', () => {
    getDrizzleDb()
      .insert(attachments)
      .values([
        {
          attachmentId: 'a1',
          contextId: 'u1',
          sourceProvider: 't',
          filename: 'a',
          size: 100,
          checksum: 'c1',
          blobKey: 'b1',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          attachmentId: 'a2',
          contextId: 'u2',
          sourceProvider: 't',
          filename: 'b',
          size: 250,
          checksum: 'c2',
          blobKey: 'b2',
          status: 'stored',
          isActive: 1,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          attachmentId: 'a3',
          contextId: 'u3',
          sourceProvider: 't',
          filename: 'c',
          size: 999,
          checksum: 'c3',
          blobKey: 'b3',
          status: 'cleared',
          isActive: 0,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ])
      .run()

    const result = storageGlobal({ dbFileSize: () => 0 })
    expect(result.s3AttachmentBytes).toBe(350)
  })
})

describe('identityMixGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty mix when no identity rows', () => {
    expect(identityMixGlobal()).toEqual({ byProvider: {}, kaneoWorkspaces: 0 })
  })

  test('counts identity mappings per provider and kaneo workspace presence', () => {
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', addedBy: 'admin', kaneoWorkspaceId: 'w1' },
        { platformUserId: 'u2', addedBy: 'admin', kaneoWorkspaceId: 'w2' },
        { platformUserId: 'u3', addedBy: 'admin' },
        { platformUserId: 'u4', addedBy: 'admin', kaneoWorkspaceId: '' },
      ])
      .run()

    getDrizzleDb()
      .insert(userIdentityMappings)
      .values([
        { contextId: 'u1', providerName: 'kaneo', matchedAt: '2026-01-01T00:00:00Z' },
        { contextId: 'u2', providerName: 'kaneo', matchedAt: '2026-01-01T00:00:00Z' },
        { contextId: 'u3', providerName: 'youtrack', matchedAt: '2026-01-01T00:00:00Z' },
      ])
      .run()

    const result = identityMixGlobal()
    expect(result.byProvider).toEqual({ kaneo: 2, youtrack: 1 })
    expect(result.kaneoWorkspaces).toBe(2)
  })
})

describe('surfaceMixGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zeros when nothing seeded', () => {
    expect(surfaceMixGlobal()).toEqual({
      subjectsWithRecurring: 0,
      subjectsWithDeferred: 0,
      subjectsWithMemos: 0,
      subjectsWithInstructions: 0,
    })
  })

  test('counts distinct subjects in each surface table', () => {
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', addedBy: 'admin' },
        { platformUserId: 'u2', addedBy: 'admin' },
      ])
      .run()
    getDrizzleDb()
      .insert(authorizedGroups)
      .values([{ groupId: 'g1', addedBy: 'admin' }])
      .run()

    getDrizzleDb()
      .insert(memos)
      .values([
        { id: 'm1', userId: 'u1', content: 'x', tags: '[]' },
        { id: 'm2', userId: 'u1', content: 'x', tags: '[]' },
        { id: 'm3', userId: 'u2', content: 'x', tags: '[]' },
      ])
      .run()
    getDrizzleDb()
      .insert(recurringTasks)
      .values([{ id: 'r1', userId: 'u1', projectId: 'p', title: 't', enabled: '1' }])
      .run()
    getDrizzleDb()
      .insert(scheduledPrompts)
      .values([
        {
          id: 'sp1',
          createdByUserId: 'u2',
          deliveryContextId: 'u2',
          prompt: 'p',
          fireAt: '2026-01-01T00:00:00Z',
          status: 'active',
        },
      ])
      .run()
    getDrizzleDb()
      .insert(userInstructions)
      .values([
        { id: 'i1', contextId: 'u1', text: 't' },
        { id: 'i2', contextId: 'g1', text: 't' },
      ])
      .run()

    const result = surfaceMixGlobal()
    expect(result.subjectsWithMemos).toBe(2)
    expect(result.subjectsWithRecurring).toBe(1)
    expect(result.subjectsWithDeferred).toBe(1)
    expect(result.subjectsWithInstructions).toBe(2)
  })
})
