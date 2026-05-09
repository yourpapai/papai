import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { groupAdminObservations, groupUserObservations, knownGroupContexts } from '../db/schema.js'
import { logger } from '../logger.js'
import type { KnownGroupContext } from './types.js'

const log = logger.child({ scope: 'group-settings:registry' })

const THROTTLE_MS = 5 * 60 * 1000

function isWithinThrottleWindow(lastSeenAtIso: string): boolean {
  return Date.now() - new Date(lastSeenAtIso).getTime() < THROTTLE_MS
}

type KnownGroupContextRow = typeof knownGroupContexts.$inferSelect

export interface UpsertKnownGroupContextInput {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
}

export interface UpsertGroupAdminObservationInput {
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly isAdmin: boolean
}

export interface UpsertGroupUserObservationInput {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

export interface GroupUserObservation {
  readonly provider: string
  readonly contextId: string
  readonly userId: string
  readonly username: string | null
  readonly displayLabel: string
}

const toKnownGroupContext = (row: KnownGroupContextRow): KnownGroupContext => ({
  contextId: row.contextId,
  provider: row.provider,
  displayName: row.displayName,
  parentName: row.parentName ?? null,
  firstSeenAt: row.firstSeenAt,
  lastSeenAt: row.lastSeenAt,
})

const toGroupUserObservation = (
  row: Pick<
    typeof groupUserObservations.$inferSelect,
    'provider' | 'contextId' | 'userId' | 'username' | 'displayLabel'
  >,
): GroupUserObservation => ({
  provider: row.provider,
  contextId: row.contextId,
  userId: row.userId,
  username: row.username,
  displayLabel: row.displayLabel,
})

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

  const existing = db
    .select({ lastSeenAt: knownGroupContexts.lastSeenAt })
    .from(knownGroupContexts)
    .where(eq(knownGroupContexts.contextId, input.contextId))
    .get()

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
      target: knownGroupContexts.contextId,
      set: {
        provider: input.provider,
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
    { contextId: input.contextId, userId: input.userId, isAdmin: input.isAdmin },
    'upsertGroupAdminObservation called',
  )

  const db = getDrizzleDb()

  const existing = db
    .select({ lastSeenAt: groupAdminObservations.lastSeenAt, isAdmin: groupAdminObservations.isAdmin })
    .from(groupAdminObservations)
    .where(and(eq(groupAdminObservations.contextId, input.contextId), eq(groupAdminObservations.userId, input.userId)))
    .get()

  const adminStatusChanged = existing !== undefined && existing.isAdmin !== input.isAdmin
  if (existing !== undefined && !adminStatusChanged && isWithinThrottleWindow(existing.lastSeenAt)) {
    log.debug({ contextId: input.contextId, userId: input.userId }, 'Skipping admin observation upsert (throttled)')
    return
  }

  const now = new Date().toISOString()

  db.insert(groupAdminObservations)
    .values({
      contextId: input.contextId,
      userId: input.userId,
      username: input.username,
      isAdmin: input.isAdmin,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [groupAdminObservations.contextId, groupAdminObservations.userId],
      set: {
        username: input.username,
        isAdmin: input.isAdmin,
        lastSeenAt: now,
      },
    })
    .run()

  log.info(
    { contextId: input.contextId, userId: input.userId, isAdmin: input.isAdmin },
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
        eq(knownGroupContexts.contextId, groupAdminObservations.contextId),
        eq(groupAdminObservations.userId, userId),
        eq(groupAdminObservations.isAdmin, true),
      ),
    )
    .all()
    .map(toKnownGroupContext)
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName))

  log.debug({ userId, count: groups.length }, 'Listed admin group contexts for user')
  return groups
}
