// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { knownGroupContexts, users } from '../../src/db/schema.js'
import {
  resolveDmDisplayNames,
  resolveGroupDisplayNames,
  resolveSubjectDisplayNames,
} from '../../src/debug/subject-display-name.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

describe('resolveDmDisplayNames', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns empty map when no DM subjects are passed', () => {
    const result = resolveDmDisplayNames([])

    expect(result.size).toBe(0)
  })

  test('returns empty map when only group subjects are passed', () => {
    const result = resolveDmDisplayNames([{ storageContextId: 'group:123', contextType: 'group' }])

    expect(result.size).toBe(0)
  })

  test('resolves DM display names from users.username', () => {
    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', platformInstanceId: 'legacy-single', username: 'alice', addedBy: 'test' },
        { platformUserId: 'u2', platformInstanceId: 'legacy-single', username: 'bob', addedBy: 'test' },
      ])
      .run()

    const result = resolveDmDisplayNames([
      { storageContextId: 'u1', contextType: 'dm' },
      { storageContextId: 'u2', contextType: 'dm' },
    ])

    expect(result.get('u1')).toBe('alice')
    expect(result.get('u2')).toBe('bob')
  })

  test('returns null for DM subjects with no users row', () => {
    const result = resolveDmDisplayNames([{ storageContextId: 'unknown', contextType: 'dm' }])

    expect(result.size).toBe(0)
  })

  test('ignores group subjects when DM subjects are mixed in', () => {
    getDrizzleDb()
      .insert(users)
      .values([{ platformUserId: 'u1', platformInstanceId: 'legacy-single', username: 'alice', addedBy: 'test' }])
      .run()

    const result = resolveDmDisplayNames([
      { storageContextId: 'u1', contextType: 'dm' },
      { storageContextId: 'group:42', contextType: 'group' },
    ])

    expect(result.get('u1')).toBe('alice')
    expect(result.has('group:42')).toBe(false)
  })
})

const insertKnownGroup = (provider: string, contextId: string, displayName: string, lastSeenAt: string): void => {
  getDrizzleDb()
    .insert(knownGroupContexts)
    .values({ provider, contextId, displayName, firstSeenAt: lastSeenAt, lastSeenAt })
    .run()
}

describe('resolveGroupDisplayNames', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns empty map when no group subjects are passed', () => {
    expect(resolveGroupDisplayNames([]).size).toBe(0)
  })

  test('returns empty map when only DM subjects are passed', () => {
    const result = resolveGroupDisplayNames([{ storageContextId: 'u1', contextType: 'dm' }])
    expect(result.size).toBe(0)
  })

  test('resolves group display names from known_group_contexts.displayName', () => {
    insertKnownGroup('telegram', 'group-42', 'Engineering', '2026-01-01T00:00:00Z')
    insertKnownGroup('telegram', 'group-99', 'Operations', '2026-01-02T00:00:00Z')

    const result = resolveGroupDisplayNames([
      { storageContextId: 'group-42', contextType: 'group' },
      { storageContextId: 'group-99', contextType: 'group' },
    ])

    expect(result.get('group-42')).toBe('Engineering')
    expect(result.get('group-99')).toBe('Operations')
  })

  test('strips thread suffix when contextId carries a thread fragment', () => {
    insertKnownGroup('telegram', 'group-42', 'Engineering', '2026-01-01T00:00:00Z')

    const result = resolveGroupDisplayNames([{ storageContextId: 'group-42:thread-7', contextType: 'group' }])

    expect(result.get('group-42:thread-7')).toBe('Engineering')
  })

  test('returns no entry when no matching known_group_contexts row exists', () => {
    const result = resolveGroupDisplayNames([{ storageContextId: 'group-missing', contextType: 'group' }])
    expect(result.size).toBe(0)
  })

  test('prefers the most recently seen row when the same contextId exists across providers', () => {
    insertKnownGroup('mattermost', 'group-42', 'Old Name', '2026-01-01T00:00:00Z')
    insertKnownGroup('telegram', 'group-42', 'Current Name', '2026-02-01T00:00:00Z')

    const result = resolveGroupDisplayNames([{ storageContextId: 'group-42', contextType: 'group' }])
    expect(result.get('group-42')).toBe('Current Name')
  })
})

describe('resolveSubjectDisplayNames', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns DM and group names in one map', () => {
    getDrizzleDb()
      .insert(users)
      .values([{ platformUserId: 'u1', platformInstanceId: 'legacy-single', username: 'alice', addedBy: 'test' }])
      .run()
    insertKnownGroup('telegram', 'group-7', 'Eng', '2026-01-01T00:00:00Z')

    const result = resolveSubjectDisplayNames([
      { storageContextId: 'u1', contextType: 'dm' },
      { storageContextId: 'group-7', contextType: 'group' },
      { storageContextId: 'missing', contextType: 'dm' },
    ])

    expect(result.get('u1')).toBe('alice')
    expect(result.get('group-7')).toBe('Eng')
    expect(result.has('missing')).toBe(false)
  })
})
