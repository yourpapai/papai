// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import packageJson from '../../../package.json' with { type: 'json' }
import { scenario } from '../harness/scenario.js'

const RELEASE_NOTES_PATH = '/settings/api/admin/release-notes'
const VERSION = packageJson.version
const BROADCAST_REQUEST = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'broadcast' }),
} as const

scenario(
  'SCN-announcement-delivery-fanout: eligible release subscribers receive independent best-effort delivery accounting',
  async ({ given, when, then, world }) => {
    const adminUser = given.user('admin')
    const memberUser = given.user('member')
    const sentUser = given.user('sent-user')
    const failedUser = given.user('failed-user')
    const unsubscribedUser = given.user('unsubscribed-user')
    const sentDm = given.dm(sentUser)
    const failedDm = given.dm(failedUser)
    const unsubscribedDm = given.dm(unsubscribedUser)
    const sentGroup = given.group('sent-group')
    const unsubscribedGroup = given.group('unsubscribed-group')

    given.announcementSubscription(sentDm, true)
    given.announcementSubscription(failedDm, true)
    given.announcementSubscription(unsubscribedDm, false)
    given.announcementSubscription(sentGroup, true)
    given.announcementSubscription(unsubscribedGroup, false)
    given.announcementDraft({ version: VERSION, body: 'Release notes for fan-out verification.' })
    given.proactiveDelivery([
      { contextId: sentUser.id, outcomes: ['sent'] },
      { contextId: failedUser.id, outcomes: ['throws', 'sent'] },
      { contextId: sentGroup.id, outcomes: ['sent'] },
    ])
    const adminSession = await given.settingsAdminSession(adminUser, { superAdmin: true })
    const memberSession = await when.settingsSession(memberUser)

    const unauthenticated = await when.request(RELEASE_NOTES_PATH, BROADCAST_REQUEST)
    then.responseStatus(unauthenticated, 401)

    const nonAdmin = await when.settingsRequest(memberSession, RELEASE_NOTES_PATH, BROADCAST_REQUEST)
    then.responseStatus(nonAdmin, 403)

    const csrfRejected = await when.settingsRequest(adminSession, RELEASE_NOTES_PATH, BROADCAST_REQUEST, {
      csrf: false,
    })
    then.responseStatus(csrfRejected, 403)
    then.proactiveAttempts().equal([])

    const firstBroadcast = await when.settingsRequest(adminSession, RELEASE_NOTES_PATH, BROADCAST_REQUEST)
    then.responseStatus(firstBroadcast, 200)
    then.responseJson(await firstBroadcast.json()).equals({
      version: VERSION,
      broadcast: { sent: 2, failed: 1, skipped: 0 },
      counts: { dm: 2, group: 1 },
    })
    then.proactiveAttempts().equal([sentUser.id, failedUser.id, sentGroup.id])

    const sentDmDeliveryId = `${sentUser.platformInstanceId}:${sentUser.id}`
    const failedDmDeliveryId = `${failedUser.platformInstanceId}:${failedUser.id}`
    const sentGroupDeliveryId = world.scopedStorageContextId(sentGroup)
    then.announcementDeliveries(VERSION).equal([
      { contextId: sentDmDeliveryId, contextType: 'dm', status: 'sent' },
      { contextId: failedDmDeliveryId, contextType: 'dm', status: 'failed' },
      { contextId: sentGroupDeliveryId, contextType: 'group', status: 'sent' },
    ])

    const secondBroadcast = await when.settingsRequest(adminSession, RELEASE_NOTES_PATH, BROADCAST_REQUEST)
    then.responseStatus(secondBroadcast, 200)
    then.responseJson(await secondBroadcast.json()).equals({
      version: VERSION,
      broadcast: { sent: 1, failed: 0, skipped: 2 },
      counts: { dm: 2, group: 1 },
    })
    then.proactiveAttempts().equal([sentUser.id, failedUser.id, sentGroup.id, failedUser.id])
    then.announcementDeliveries(VERSION).equal([
      { contextId: sentDmDeliveryId, contextType: 'dm', status: 'sent' },
      { contextId: failedDmDeliveryId, contextType: 'dm', status: 'sent' },
      { contextId: sentGroupDeliveryId, contextType: 'group', status: 'sent' },
    ])
  },
)
