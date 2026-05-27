// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { authorizedGroups, llmUsageEvents, messageMetadata, users } from '../../src/db/schema.js'
import { activeSubjectCounts, subjectsGlobal } from '../../src/stats/global-subjects.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const ONE_DAY = 24 * 60 * 60 * 1000

describe('subjectsGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('returns zero counts and empty growth array when no subjects', () => {
    const result = subjectsGlobal()
    expect(result.dmTotal).toBe(0)
    expect(result.groupTotal).toBe(0)
    expect(result.growthLast30d).toEqual([])
  })

  test('counts users and authorized groups, builds growth points for last 30 days', () => {
    const today = new Date()
    const isoToday = today.toISOString().slice(0, 19).replace('T', ' ')
    const tenDaysAgo = new Date(today.getTime() - 10 * ONE_DAY).toISOString().slice(0, 19).replace('T', ' ')
    const fortyDaysAgo = new Date(today.getTime() - 40 * ONE_DAY).toISOString().slice(0, 19).replace('T', ' ')

    getDrizzleDb()
      .insert(users)
      .values([
        { platformUserId: 'u1', platformInstanceId: 'legacy-single', addedAt: isoToday, addedBy: 'admin' },
        { platformUserId: 'u2', platformInstanceId: 'legacy-single', addedAt: tenDaysAgo, addedBy: 'admin' },
        { platformUserId: 'u3', platformInstanceId: 'legacy-single', addedAt: fortyDaysAgo, addedBy: 'admin' },
      ])
      .run()

    getDrizzleDb()
      .insert(authorizedGroups)
      .values([
        { groupId: 'g1', addedBy: 'admin', addedAt: isoToday },
        { groupId: 'g2', addedBy: 'admin', addedAt: fortyDaysAgo },
      ])
      .run()

    const result = subjectsGlobal()

    expect(result.dmTotal).toBe(3)
    expect(result.groupTotal).toBe(2)

    const totalDmInWindow = result.growthLast30d.reduce((sum, p) => sum + p.dmAdded, 0)
    const totalGroupInWindow = result.growthLast30d.reduce((sum, p) => sum + p.groupAdded, 0)
    expect(totalDmInWindow).toBe(2)
    expect(totalGroupInWindow).toBe(1)
  })
})

describe('activeSubjectCounts', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero counts when no activity', () => {
    expect(activeSubjectCounts(Date.now())).toEqual({
      activeIn1d: 0,
      activeIn7d: 0,
      activeIn30d: 0,
    })
  })

  test('counts distinct subjects active in each window across usage + messages', () => {
    const now = Date.now()
    const within1d = now - 12 * 60 * 60 * 1000
    const within7d = now - 3 * ONE_DAY
    const within30d = now - 20 * ONE_DAY
    const beyond = now - 60 * ONE_DAY

    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'e1',
          occurredAt: within1d,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          durationMs: 1,
        },
        {
          eventId: 'e2',
          occurredAt: within7d,
          storageContextId: 'u2',
          contextType: 'dm',
          chatUserId: 'u2',
          model: 'm',
          modelRole: 'main',
          durationMs: 1,
        },
        {
          eventId: 'e3',
          occurredAt: beyond,
          storageContextId: 'u4',
          contextType: 'dm',
          chatUserId: 'u4',
          model: 'm',
          modelRole: 'main',
          durationMs: 1,
        },
      ])
      .run()

    getDrizzleDb()
      .insert(messageMetadata)
      .values([
        { contextId: 'g1', messageId: 'm1', timestamp: within30d, expiresAt: now + ONE_DAY },
        { contextId: 'u1', messageId: 'm2', timestamp: within1d, expiresAt: now + ONE_DAY },
      ])
      .run()

    const result = activeSubjectCounts(now)
    expect(result.activeIn1d).toBe(1)
    expect(result.activeIn7d).toBe(2)
    expect(result.activeIn30d).toBe(3)
  })
})
