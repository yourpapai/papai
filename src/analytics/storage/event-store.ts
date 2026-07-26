// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { and, asc, eq, inArray, lte } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsBackfillEventMap, analyticsEvents } from '../../db/schema.js'
import type { AnalyticsEventRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import { unexpiredEventFilter } from '../retention/expiry-guard.js'
import { requireOpenEpoch } from './epoch-store.js'

const log = logger.child({ scope: 'analytics:storage:event-store' })

export type EventStoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export type InsertCanonicalEventInput = Readonly<{
  storageGeneration: string
  processEpochId: string
  sourceRefKey: string
  sourceKind: string
  expiresAtMs: number
  event: AnalyticsEventV1
}>

export type InsertCanonicalEventResult = Readonly<{
  status: 'created' | 'already_present'
  eventId: string
  processEpochId: string
}>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

const derivePhysicalEventId = (input: {
  storageGeneration: string
  sourceKind: string
  sourceRefKey: string
  eventName: string
}): string => {
  const payload = `${input.storageGeneration}|${input.sourceKind}|${input.sourceRefKey}|${input.eventName}`
  return createHash('sha256').update(payload).digest('hex')
}

const buildEventRow = (input: InsertCanonicalEventInput): typeof analyticsEvents.$inferInsert => {
  const event = input.event
  return {
    eventId: derivePhysicalEventId({
      storageGeneration: input.storageGeneration,
      sourceKind: input.sourceKind,
      sourceRefKey: input.sourceRefKey,
      eventName: event.event.name,
    }),
    storageGeneration: input.storageGeneration,
    processEpochId: input.processEpochId,
    sourceRefKey: input.sourceRefKey,
    sourceKind: input.sourceKind,
    schemaVersion: event.schema.version,
    eventName: event.event.name,
    eventVersion: event.event.version,
    occurredAtMs: event.event.occurred_at_ms,
    ingestedAtMs: event.event.ingested_at_ms,
    source: event.event.source,
    attributionQuality: event.event.attribution_quality,
    appVersion: event.app.version,
    deploymentKey: event.app.deployment_key,
    keyVersion: event.identity.key_version,
    platform: event.identity.platform,
    platformInstanceKey: event.identity.platform_instance_key,
    actorKey: event.identity.actor_key,
    contextKey: event.identity.context_key,
    threadKey: event.identity.thread_key,
    conversationKey: event.correlation.conversation_key,
    taskInstanceKey: event.identity.task_instance_key,
    contextType: event.context.context_type,
    actorRole: event.context.actor_role,
    taskProvider: event.context.task_provider,
    invocationMode: event.context.invocation_mode,
    turnKey: event.correlation.turn_key,
    sessionKey: event.correlation.session_key,
    policyVersion: event.governance.policy_version,
    eligibility: event.governance.eligibility,
    maxClass: event.privacy.max_class,
    propsJson: JSON.stringify(event.props),
    expiresAtMs: input.expiresAtMs,
  }
}

const findEventRow = (db: Db | Tx, input: InsertCanonicalEventInput): InsertCanonicalEventResult | undefined => {
  const row = db
    .select({ eventId: analyticsEvents.eventId, processEpochId: analyticsEvents.processEpochId })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.storageGeneration, input.storageGeneration),
        eq(analyticsEvents.sourceKind, input.sourceKind),
        eq(analyticsEvents.sourceRefKey, input.sourceRefKey),
        eq(analyticsEvents.eventName, input.event.event.name),
      ),
    )
    .get()
  if (row === undefined) return undefined
  return { status: 'already_present', eventId: row.eventId, processEpochId: row.processEpochId }
}

const insertEvent = (db: Db | Tx, input: InsertCanonicalEventInput): void => {
  db.insert(analyticsEvents).values(buildEventRow(input)).run()
}

export const insertCanonicalEventRow = (db: Db | Tx, input: InsertCanonicalEventInput): InsertCanonicalEventResult => {
  const existing = findEventRow(db, input)
  if (existing !== undefined) return existing
  insertEvent(db, input)
  const result = findEventRow(db, input)
  if (result === undefined) {
    throw new Error('Failed to read event row after insert')
  }
  return { status: 'created', eventId: result.eventId, processEpochId: result.processEpochId }
}

const insertBackfillMap = (db: Db, input: { runId: string; eventId: string; sourceRefKey: string }): void => {
  db.insert(analyticsBackfillEventMap)
    .values({
      runId: input.runId,
      eventId: input.eventId,
      sourceRefKey: input.sourceRefKey,
    })
    .run()
}

export const insertCanonicalEvent = (
  input: InsertCanonicalEventInput,
  deps: EventStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): InsertCanonicalEventResult => {
  requireOpenEpoch({ epochId: input.processEpochId }, { getDrizzleDb: deps.getDrizzleDb })
  const db = deps.getDrizzleDb()

  const existing = findEventRow(db, input)
  if (existing !== undefined) {
    log.debug({ eventId: existing.eventId }, 'canonical event already present')
    return existing
  }

  insertEvent(db, input)

  const result = findEventRow(db, input)
  if (result === undefined) {
    throw new Error('Failed to read event row after insert')
  }

  log.debug({ eventId: result.eventId }, 'canonical event stored')
  return { status: 'created', eventId: result.eventId, processEpochId: result.processEpochId }
}

export const loadUnexpiredEventRow = (
  input: Readonly<{ eventId: string; nowMs: number }>,
  deps: EventStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsEventRow | null => {
  const row = deps
    .getDrizzleDb()
    .select()
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventId, input.eventId), unexpiredEventFilter(input.nowMs)))
    .get()
  return row ?? null
}

export const listUnexpiredEventsByActor = (
  input: Readonly<{ actorKeys: readonly string[]; nowMs: number }>,
  deps: EventStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsEventRow[] => {
  if (input.actorKeys.length === 0) return []
  return deps
    .getDrizzleDb()
    .select()
    .from(analyticsEvents)
    .where(and(inArray(analyticsEvents.actorKey, [...input.actorKeys]), unexpiredEventFilter(input.nowMs)))
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .all()
}

export const listSnapshotSourceEvents = (
  input: Readonly<{ storageGeneration: string; nowMs: number }>,
  deps: EventStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): AnalyticsEventRow[] =>
  deps
    .getDrizzleDb()
    .select()
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.storageGeneration, input.storageGeneration), unexpiredEventFilter(input.nowMs)))
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .all()

export const listExpiredEventIds = (tx: Db | Tx, nowMs: number): readonly string[] =>
  tx
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(lte(analyticsEvents.expiresAtMs, nowMs))
    .all()
    .map((row) => row.eventId)

export const deleteEventRowsIn = (tx: Tx, eventIds: readonly string[]): number => {
  if (eventIds.length === 0) return 0
  const filter = inArray(analyticsEvents.eventId, [...eventIds])
  const count = tx.select({ eventId: analyticsEvents.eventId }).from(analyticsEvents).where(filter).all().length
  if (count === 0) return 0
  tx.delete(analyticsEvents).where(filter).run()
  log.info({ count }, 'canonical event rows removed')
  return count
}

export const insertCanonicalEventForBackfill = (
  input: InsertCanonicalEventInput & { runId: string },
  deps: EventStoreDeps = { getDrizzleDb: defaultGetDrizzleDb },
): InsertCanonicalEventResult => {
  requireOpenEpoch({ epochId: input.processEpochId }, { getDrizzleDb: deps.getDrizzleDb })
  const db = deps.getDrizzleDb()
  const sqlite = db.$client

  sqlite.run('BEGIN')
  try {
    const existing = findEventRow(db, input)
    if (existing !== undefined) {
      sqlite.run('COMMIT')
      log.debug({ eventId: existing.eventId, runId: input.runId }, 'canonical backfill event already present')
      return existing
    }

    insertEvent(db, input)

    const result = findEventRow(db, input)
    if (result === undefined) {
      throw new Error('Failed to read event row after insert')
    }

    insertBackfillMap(db, {
      runId: input.runId,
      eventId: result.eventId,
      sourceRefKey: input.sourceRefKey,
    })

    sqlite.run('COMMIT')
    log.debug({ eventId: result.eventId, runId: input.runId }, 'canonical backfill event stored')
    return { status: 'created', eventId: result.eventId, processEpochId: result.processEpochId }
  } catch (error) {
    sqlite.run('ROLLBACK')
    throw error
  }
}
