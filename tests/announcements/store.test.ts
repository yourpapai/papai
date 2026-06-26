// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  countSubscribers,
  getAnnouncementDraft,
  getGroupAnnounceSubscribed,
  getUserAnnounceSubscribed,
  isDelivered,
  listSubscribedUsers,
  markBroadcast,
  recordDelivery,
  setGroupAnnounceSubscribed,
  setUserAnnounceSubscribed,
  updateHumanizedBody,
  upsertAnnouncementDraft,
} from '../../src/announcements/store.js'
import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { users } from '../../src/db/schema.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

// seeded by seedCommonTestPlatformInstances()
const PID = 'telegram-default'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  seedCommonTestPlatformInstances()
  addUser({ userId: 'u1', platformInstanceId: PID, addedBy: 'test' })
  addUser({ userId: 'u2', platformInstanceId: PID, addedBy: 'test' })
  addAuthorizedGroup('g1', 'test')
})

describe('announcement subscription store', () => {
  test('user subscription defaults off and toggles', () => {
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(false)
    setUserAnnounceSubscribed(PID, 'u1', true)
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(true)
    setUserAnnounceSubscribed(PID, 'u1', false)
    expect(getUserAnnounceSubscribed(PID, 'u1')).toBe(false)
  })

  test('group subscription defaults off and toggles', () => {
    expect(getGroupAnnounceSubscribed('g1')).toBe(false)
    setGroupAnnounceSubscribed('g1', true)
    expect(getGroupAnnounceSubscribed('g1')).toBe(true)
  })

  test('listSubscribedUsers excludes blocked + unsubscribed', () => {
    setUserAnnounceSubscribed(PID, 'u1', true)
    setUserAnnounceSubscribed(PID, 'u2', true)
    getDrizzleDb().update(users).set({ blockedAt: '2026-01-01T00:00:00Z' }).where(eq(users.platformUserId, 'u2')).run()
    expect(listSubscribedUsers()).toHaveLength(1)
    const subs = listSubscribedUsers().filter((u) => u.platformUserId === 'u1')
    expect(subs).toEqual([{ platformInstanceId: PID, platformUserId: 'u1' }])
    expect(listSubscribedUsers().some((u) => u.platformUserId === 'u2')).toBe(false)
  })

  test('counts reflect subscribed users + groups', () => {
    setUserAnnounceSubscribed(PID, 'u1', true)
    setGroupAnnounceSubscribed('g1', true)
    expect(countSubscribers()).toEqual({ dm: 1, group: 1 })
  })

  test('draft upsert + humanized update + broadcast mark', () => {
    upsertAnnouncementDraft({ version: '9.9.9', rawBody: 'raw', humanizedBody: 'hi' })
    expect(getAnnouncementDraft('9.9.9')).toMatchObject({
      version: '9.9.9',
      rawBody: 'raw',
      humanizedBody: 'hi',
      broadcastAt: null,
    })
    updateHumanizedBody('9.9.9', 'edited')
    expect(getAnnouncementDraft('9.9.9')?.humanizedBody).toBe('edited')
    markBroadcast('9.9.9', '2026-06-26T00:00:00Z')
    expect(getAnnouncementDraft('9.9.9')?.broadcastAt).toBe('2026-06-26T00:00:00Z')
  })

  test('delivery idempotency: only sent counts as delivered', () => {
    upsertAnnouncementDraft({ version: '9.9.9', rawBody: 'x', humanizedBody: null })
    recordDelivery('9.9.9', 'pi-1:u1', 'dm', 'failed')
    expect(isDelivered('9.9.9', 'pi-1:u1')).toBe(false)
    recordDelivery('9.9.9', 'pi-1:u1', 'dm', 'sent')
    expect(isDelivered('9.9.9', 'pi-1:u1')).toBe(true)
  })
})
