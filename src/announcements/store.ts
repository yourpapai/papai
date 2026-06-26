// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { announcementDeliveries, authorizedGroups, users, versionAnnouncements } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:store' })

export type SubscribedUser = { platformInstanceId: string; platformUserId: string }
export type SubscribedGroup = { groupId: string }
export type SubscriberCounts = { dm: number; group: number }
export type AnnouncementDraft = {
  version: string
  rawBody: string | null
  humanizedBody: string | null
  broadcastAt: string | null
}

export function getUserAnnounceSubscribed(platformInstanceId: string, platformUserId: string): boolean {
  const row = getDrizzleDb()
    .select({ announceSubscribed: users.announceSubscribed })
    .from(users)
    .where(and(eq(users.platformInstanceId, platformInstanceId), eq(users.platformUserId, platformUserId)))
    .get()
  return row?.announceSubscribed === true
}

export function setUserAnnounceSubscribed(platformInstanceId: string, platformUserId: string, enabled: boolean): void {
  getDrizzleDb()
    .update(users)
    .set({ announceSubscribed: enabled })
    .where(and(eq(users.platformInstanceId, platformInstanceId), eq(users.platformUserId, platformUserId)))
    .run()
  log.info({ platformInstanceId, enabled }, 'user announce subscription updated')
}

export function getGroupAnnounceSubscribed(groupId: string): boolean {
  const row = getDrizzleDb()
    .select({ announceSubscribed: authorizedGroups.announceSubscribed })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()
  return row?.announceSubscribed === true
}

export function setGroupAnnounceSubscribed(groupId: string, enabled: boolean): void {
  getDrizzleDb()
    .update(authorizedGroups)
    .set({ announceSubscribed: enabled })
    .where(eq(authorizedGroups.groupId, groupId))
    .run()
  log.info({ groupId, enabled }, 'group announce subscription updated')
}

export function listSubscribedUsers(): SubscribedUser[] {
  return getDrizzleDb()
    .select({ platformInstanceId: users.platformInstanceId, platformUserId: users.platformUserId })
    .from(users)
    .where(and(eq(users.announceSubscribed, true), isNull(users.blockedAt)))
    .all()
    .filter((u) => !u.platformUserId.startsWith('placeholder-'))
}

export function listSubscribedGroups(): SubscribedGroup[] {
  return getDrizzleDb()
    .select({ groupId: authorizedGroups.groupId })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.announceSubscribed, true))
    .all()
}

export function countSubscribers(): SubscriberCounts {
  return { dm: listSubscribedUsers().length, group: listSubscribedGroups().length }
}

export function getAnnouncementDraft(version: string): AnnouncementDraft | null {
  const row = getDrizzleDb()
    .select({
      version: versionAnnouncements.version,
      rawBody: versionAnnouncements.rawBody,
      humanizedBody: versionAnnouncements.humanizedBody,
      broadcastAt: versionAnnouncements.broadcastAt,
    })
    .from(versionAnnouncements)
    .where(eq(versionAnnouncements.version, version))
    .get()
  return row ?? null
}

/** Insert the draft row once (dedup anchor). No-op if the version row already exists. */
export function upsertAnnouncementDraft(input: {
  version: string
  rawBody: string
  humanizedBody: string | null
}): void {
  getDrizzleDb()
    .insert(versionAnnouncements)
    .values({
      version: input.version,
      announcedAt: new Date().toISOString(),
      rawBody: input.rawBody,
      humanizedBody: input.humanizedBody,
    })
    .onConflictDoNothing()
    .run()
  log.info({ version: input.version }, 'announcement draft upserted')
}

export function updateHumanizedBody(version: string, body: string): void {
  getDrizzleDb()
    .update(versionAnnouncements)
    .set({ humanizedBody: body })
    .where(eq(versionAnnouncements.version, version))
    .run()
  log.info({ version }, 'announcement humanized body updated')
}

export function markBroadcast(version: string, atIso: string): void {
  getDrizzleDb()
    .update(versionAnnouncements)
    .set({ broadcastAt: atIso })
    .where(eq(versionAnnouncements.version, version))
    .run()
  log.info({ version }, 'announcement broadcast marked')
}

export function recordDelivery(
  version: string,
  contextId: string,
  contextType: 'dm' | 'group',
  status: 'sent' | 'failed',
): void {
  const deliveredAt = new Date().toISOString()
  getDrizzleDb()
    .insert(announcementDeliveries)
    .values({ version, contextId, contextType, status, deliveredAt })
    .onConflictDoUpdate({
      target: [announcementDeliveries.version, announcementDeliveries.contextId],
      set: { status, deliveredAt },
    })
    .run()
  log.info({ version, contextId, status }, 'announcement delivery recorded')
}

export function isDelivered(version: string, contextId: string): boolean {
  const row = getDrizzleDb()
    .select({ status: announcementDeliveries.status })
    .from(announcementDeliveries)
    .where(and(eq(announcementDeliveries.version, version), eq(announcementDeliveries.contextId, contextId)))
    .get()
  return row?.status === 'sent'
}
