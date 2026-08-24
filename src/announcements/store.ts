// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, ne } from 'drizzle-orm'
import { z } from 'zod'

import { getDrizzleDb } from '../db/drizzle.js'
import { announcementDeliveries, authorizedGroups, users, versionAnnouncements } from '../db/schema.js'
import { SUPPORTED_LOCALES, type Locale } from '../i18n/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'announcements:store' })

export const humanizedBodiesSchema = z.partialRecord(z.enum(SUPPORTED_LOCALES), z.string())

export type HumanizedBodies = Partial<Record<Locale, string>>

const SUPPORTED_LOCALE_KEYS = new Set<string>(SUPPORTED_LOCALES)

/** Drop keys outside SUPPORTED_LOCALES: unknown locales are stripped, not fatal (zod records reject them). */
function stripUnknownLocales(input: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => SUPPORTED_LOCALE_KEYS.has(key)))
}

export type SubscribedUser = { platformInstanceId: string; platformUserId: string }
export type SubscribedGroup = { groupId: string }
export type SubscriberCounts = { dm: number; group: number }
export type AnnouncementDraft = {
  version: string
  rawBody: string | null
  humanizedBody: string | null
  humanizedBodies: HumanizedBodies
  broadcastAt: string | null
}

/** Parse the stored `humanized_bodies` JSON; unparseable or invalid content reads back as empty. */
function parseHumanizedBodies(json: string | null): HumanizedBodies {
  if (json === null) return {}
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return {}
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const result = humanizedBodiesSchema.safeParse(stripUnknownLocales(raw))
  return result.success ? result.data : {}
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
  // Upsert, not update: operators authorized via the admin store may have no `users`
  // row, and a bare UPDATE would silently no-op, dropping the subscription.
  getDrizzleDb()
    .insert(users)
    .values({ platformUserId, platformInstanceId, addedBy: 'announce-subscription', announceSubscribed: enabled })
    .onConflictDoUpdate({
      target: [users.platformInstanceId, users.platformUserId],
      set: { announceSubscribed: enabled },
    })
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
      humanizedBodies: versionAnnouncements.humanizedBodies,
      broadcastAt: versionAnnouncements.broadcastAt,
    })
    .from(versionAnnouncements)
    .where(eq(versionAnnouncements.version, version))
    .get()
  if (row === undefined) return null
  const humanizedBodies = parseHumanizedBodies(row.humanizedBodies)
  // Legacy coalescing, applied once at the single read point: a pre-080 row's
  // `humanized_body` is the en body; a stored JSON map entry always wins.
  if (humanizedBodies.en === undefined && row.humanizedBody !== null) {
    humanizedBodies.en = row.humanizedBody
  }
  return {
    version: row.version,
    rawBody: row.rawBody,
    humanizedBody: row.humanizedBody,
    humanizedBodies,
    broadcastAt: row.broadcastAt,
  }
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

/**
 * Read-modify-write merge of per-locale bodies into `humanized_bodies` (single-process
 * synchronous SQLite; no lost-update window). Every `en` write mirrors into the legacy
 * `humanized_body` column. Unknown locales are stripped by the schema.
 */
export function updateHumanizedBodies(version: string, bodies: HumanizedBodies): void {
  const incoming = humanizedBodiesSchema.parse(stripUnknownLocales(bodies))
  const existing = getDrizzleDb()
    .select({ humanizedBodies: versionAnnouncements.humanizedBodies })
    .from(versionAnnouncements)
    .where(eq(versionAnnouncements.version, version))
    .get()
  const merged: HumanizedBodies = { ...parseHumanizedBodies(existing?.humanizedBodies ?? null), ...incoming }
  const set: { humanizedBodies: string; humanizedBody?: string } = {
    humanizedBodies: JSON.stringify(merged),
  }
  if (incoming.en !== undefined) set.humanizedBody = incoming.en
  getDrizzleDb()
    .insert(versionAnnouncements)
    .values({ version, announcedAt: new Date().toISOString(), ...set })
    .onConflictDoUpdate({ target: versionAnnouncements.version, set })
    .run()
  log.info({ version, locales: Object.keys(incoming) }, 'announcement humanized bodies updated')
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
      setWhere: ne(announcementDeliveries.status, 'sent'),
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
