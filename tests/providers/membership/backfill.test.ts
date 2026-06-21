// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers } from '../../../src/db/schema.js'
import { runMembershipBackfill } from '../../../src/providers/membership/backfill.js'
import type { MemberOutcome } from '../../../src/providers/membership/ensure-member.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('runMembershipBackfill', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('calls ensure for each group member', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([
        { groupId: 'g-1', userId: 'u-1', addedBy: 'admin', addedAt: new Date().toISOString() },
        { groupId: 'g-1', userId: 'u-2', addedBy: 'admin', addedAt: new Date().toISOString() },
      ])
      .run()

    const ensureCalls: string[] = []
    await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: (g, u) => {
        ensureCalls.push(`${g}:${u}`)
        return Promise.resolve('created' as MemberOutcome)
      },
    })

    expect(ensureCalls).toContain('g-1:u-1')
    expect(ensureCalls).toContain('g-1:u-2')
  })

  test('skips placeholder members', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([
        { groupId: 'g-2', userId: 'placeholder-abc', addedBy: 'admin', addedAt: new Date().toISOString() },
        { groupId: 'g-2', userId: 'real-user', addedBy: 'admin', addedAt: new Date().toISOString() },
      ])
      .run()

    const ensureCalls: string[] = []
    await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: (g, u) => {
        ensureCalls.push(`${g}:${u}`)
        return Promise.resolve('created' as MemberOutcome)
      },
    })

    expect(ensureCalls).not.toContain('g-2:placeholder-abc')
    expect(ensureCalls).toContain('g-2:real-user')
  })

  test('is idempotent — returns counts', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([{ groupId: 'g-3', userId: 'u-3', addedBy: 'admin', addedAt: new Date().toISOString() }])
      .run()

    const result = await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: () => Promise.resolve('exists' as MemberOutcome),
    })

    expect(result.total).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.exists).toBe(1)
  })
})
