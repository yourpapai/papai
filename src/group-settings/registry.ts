// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import { isWithinThrottleWindow, toGroupUserObservation, toKnownGroupContext } from './registry-helpers.js'
import type {
  GroupUserObservation,
  UpsertGroupAdminObservationInput,
  UpsertGroupUserObservationInput,
  UpsertKnownGroupContextInput,
} from './registry-types.js'
import type { KnownGroupContext } from './types.js'

export type {
  GroupUserObservation,
  UpsertGroupAdminObservationInput,
  UpsertGroupUserObservationInput,
  UpsertKnownGroupContextInput,
} from './registry-types.js'

const log = logger.child({ scope: 'group-settings:registry' })

const findExistingGroupUserObservation = (
  input: UpsertGroupUserObservationInput,
): Pick<typeof groupUserObservations.$inferSelect, 'lastSeenAt'> | undefined =>
  getDrizzleDb()
    .select({ lastSeenAt: groupUserObservations.lastSeenAt })
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, input.provider),
        eq(groupUserObservations.contextId, input.contextId),
        eq(groupUserObservations.userId, input.userId),
      ),
    )
    .get()

const findExistingKnownGroupContext = (
  input: UpsertKnownGroupContextInput,
): Pick<typeof knownGroupContexts.$inferSelect, 'lastSeenAt'> | undefined =>
  getDrizzleDb()
    .select({ lastSeenAt: knownGroupContexts.lastSeenAt })
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, input.provider), eq(knownGroupContexts.contextId, input.contextId)))
    .get()

const findExistingGroupAdminObservation = (
  input: UpsertGroupAdminObservationInput,
): Pick<typeof groupAdminObservations.$inferSelect, 'lastSeenAt' | 'isAdmin'> | undefined =>
  getDrizzleDb()
    .select({
      lastSeenAt: groupAdminObservations.lastSeenAt,
      isAdmin: groupAdminObservations.isAdmin,
    })
    .from(groupAdminObservations)
    .where(
      and(
        eq(groupAdminObservations.provider, input.provider),
        eq(groupAdminObservations.contextId, input.contextId),
        eq(groupAdminObservations.userId, input.userId),
      ),
    )
    .get()

const upsertGroupUserObservationRow = (input: UpsertGroupUserObservationInput, now: string): void => {
  getDrizzleDb()
    .insert(groupUserObservations)
    .values({
      provider: input.provider,
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      displayLabel: input.displayLabel,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupUserObservations.provider, groupUserObservations.contextId, groupUserObservations.userId],
      set: {
        username: input.username,
        displayLabel: input.displayLabel,
        lastSeenAt: now,
      },
    })
    .run()
}

const upsertGroupAdminObservationRow = (input: UpsertGroupAdminObservationInput, now: string): void => {
  getDrizzleDb()
    .insert(groupAdminObservations)
    .values({
      provider: input.provider,
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      isAdmin: input.isAdmin,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupAdminObservations.provider, groupAdminObservations.contextId, groupAdminObservations.userId],
      set: { username: input.username, isAdmin: input.isAdmin, lastSeenAt: now },
    })
    .run()
}

export function findKnownGroupContext(provider: string, contextId: string): KnownGroupContext | null {
  const row = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .where(and(eq(knownGroupContexts.provider, provider), eq(knownGroupContexts.contextId, contextId)))
    .get()

  return row === undefined ? null : toKnownGroupContext(row)
}

export function upsertKnownGroupContext(input: UpsertKnownGroupContextInput): void {
  log.debug({ contextId: input.contextId, provider: input.provider }, 'upsertKnownGroupContext called')

  const db = getDrizzleDb()
  const existing = findExistingKnownGroupContext(input)

  if (existing !== undefined && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug({ contextId: input.contextId }, 'Skipping group context upsert (throttled)')
    return
  }

  const now = new Date().toISOString()

  db.insert(knownGroupContexts)
    .values({
      contextId: input.contextId,
      provider: input.provider,
      displayName: input.displayName,
      parentName: input.parentName,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [knownGroupContexts.provider, knownGroupContexts.contextId],
      set: {
        displayName: input.displayName,
        parentName: input.parentName,
        lastSeenAt: now,
      },
    })
    .run()

  log.info({ contextId: input.contextId, provider: input.provider }, 'Known group context upserted')
}

export function upsertGroupAdminObservation(input: UpsertGroupAdminObservationInput): void {
  log.debug(
    { provider: input.provider, contextId: input.contextId, userId: input.userId },
    'upsertGroupAdminObservation called',
  )

  const existing = findExistingGroupAdminObservation(input)

  const adminStatusChanged = existing !== undefined && existing.isAdmin !== input.isAdmin
  if (existing !== undefined && !adminStatusChanged && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug(
      { provider: input.provider, contextId: input.contextId, userId: input.userId },
      'Skipping admin observation upsert (throttled)',
    )
    return
  }

  const now = new Date().toISOString()
  upsertGroupAdminObservationRow(input, now)
  log.info(
    {
      provider: input.provider,
      contextId: input.contextId,
      userId: input.userId,
      isAdmin: input.isAdmin,
    },
    'Group admin observation upserted',
  )
}

export function upsertGroupUserObservation(input: UpsertGroupUserObservationInput): void {
  log.debug(
    { provider: input.provider, contextId: input.contextId, userId: input.userId },
    'upsertGroupUserObservation called',
  )

  const existing = findExistingGroupUserObservation(input)

  if (existing !== undefined && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug(
      { provider: input.provider, contextId: input.contextId, userId: input.userId },
      'Skipping group user observation upsert (throttled)',
    )
    return
  }

  const now = new Date().toISOString()

  upsertGroupUserObservationRow(input, now)

  log.info(
    { provider: input.provider, contextId: input.contextId, userId: input.userId },
    'Group user observation upserted',
  )
}

export function findGroupUserObservation(
  provider: string,
  contextId: string,
  userId: string,
): GroupUserObservation | null {
  const row = getDrizzleDb()
    .select({
      provider: groupUserObservations.provider,
      contextId: groupUserObservations.contextId,
      userId: groupUserObservations.userId,
      username: groupUserObservations.username,
      displayLabel: groupUserObservations.displayLabel,
    })
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        eq(groupUserObservations.userId, userId),
      ),
    )
    .get()

  return row === undefined ? null : toGroupUserObservation(row)
}

export function listAdminGroupContextsForUser(userId: string): KnownGroupContext[] {
  log.debug({ userId }, 'listAdminGroupContextsForUser called')

  const groups = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      provider: knownGroupContexts.provider,
      displayName: knownGroupContexts.displayName,
      parentName: knownGroupContexts.parentName,
      firstSeenAt: knownGroupContexts.firstSeenAt,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .innerJoin(
      groupAdminObservations,
      and(
        eq(knownGroupContexts.provider, groupAdminObservations.provider),
        eq(knownGroupContexts.contextId, groupAdminObservations.contextId),
        eq(groupAdminObservations.userId, userId),
        eq(groupAdminObservations.isAdmin, true),
      ),
    )
    .all()
    .map((row) => toKnownGroupContext(row))
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ userId, count: groups.length }, 'Listed admin group contexts for user')
  return groups
}
