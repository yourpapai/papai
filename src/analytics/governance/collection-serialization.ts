// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, inArray, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsBackfillEventMap,
  analyticsCollectionEligibility,
  analyticsEpochSourceCounters,
  analyticsEventCollectionRefs,
  analyticsEvents,
  analyticsProcessEpochs,
} from '../../db/schema.js'
import { logger } from '../../logger.js'
import { utcDayOfMs } from '../aggregate.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import type { EventNameV1 } from '../controlled-types.js'
import { cancelNeverStartedIn, deleteDeliveryRowsForEventsIn, markSendingAmbiguousIn } from '../delivery/settlement.js'
import { insertCanonicalEventRow } from '../storage/event-store.js'
import type { CollectionEligibilityRef } from './eligibility.js'
import { resolveActive, V1_MAX_EVENT_RETENTION_DAYS } from './generation-store.js'

const log = logger.child({ scope: 'analytics:governance:collection-serialization' })

const DAY_MS = 86_400_000

const SOURCE_FAMILIES = [
  'chat',
  'auth',
  'turn',
  'reply',
  'llm',
  'agent_tool',
  'confirmation',
  'steering',
  'stop',
  'clarification',
  'rephrase',
  'disclosure',
  'settings',
  'task',
  'intent',
  'feature',
  'live_status',
  'provider',
  'rate_limit',
  'unconfigured',
  'mcp',
  'guest',
] as const

type SourceFamily = (typeof SOURCE_FAMILIES)[number]

const EVENT_SOURCE_FAMILY = {
  chat_message_accepted: 'chat',
  auth_checked: 'auth',
  turn_started: 'turn',
  turn_completed: 'turn',
  reply_sent: 'reply',
  llm_started: 'llm',
  llm_completed: 'llm',
  llm_failed: 'llm',
  tool_started: 'agent_tool',
  tool_completed: 'agent_tool',
  confirmation_requested: 'confirmation',
  confirmation_resolved: 'confirmation',
  turn_steered: 'steering',
  turn_stop_requested: 'stop',
  clarification_requested: 'clarification',
  clarification_abandoned: 'clarification',
  rephrase_detected: 'rephrase',
  disclosure_fallback: 'disclosure',
  config_link_issued: 'settings',
  settings_opened: 'settings',
  task_instance_assigned: 'task',
  intent_classified: 'intent',
  feature_opportunity: 'feature',
  feature_used: 'feature',
  first_visible_feedback: 'live_status',
  live_status_opportunity: 'live_status',
  live_status_lifecycle: 'live_status',
  provider_request_completed: 'provider',
  rate_limit_blocked: 'rate_limit',
  unconfigured_reply: 'unconfigured',
  mcp_availability: 'mcp',
  guest_turn_aggregate: 'guest',
} satisfies Record<EventNameV1, SourceFamily>

export type CollectionSerializationDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type Tx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : never

export type InsertEligibleCanonicalEventInput = Readonly<{
  event: AnalyticsEventV1
  processEpochId: string
  collectionRef: CollectionEligibilityRef
}>

export type InsertEligibleCanonicalEventResult =
  | Readonly<{ status: 'inserted'; eventId: string }>
  | Readonly<{ status: 'already_present'; eventId: string }>
  | Readonly<{ status: 'not_eligible' }>

export class MissingCollectionRefError extends Error {
  constructor() {
    super('canonical insertion refused: a collection eligibility ref is required')
    this.name = 'MissingCollectionRefError'
  }
}

const recheckAllow = (tx: Tx, ref: CollectionEligibilityRef): boolean => {
  const row = tx
    .select({ refKey: analyticsCollectionEligibility.refKey })
    .from(analyticsCollectionEligibility)
    .where(
      and(
        eq(analyticsCollectionEligibility.refKey, ref.refKey),
        eq(analyticsCollectionEligibility.keyVersion, ref.keyVersion),
        eq(analyticsCollectionEligibility.generation, ref.generation),
        eq(analyticsCollectionEligibility.state, 'allow'),
      ),
    )
    .get()
  return row !== undefined
}

const requireOpenEpochTx = (tx: Tx, epochId: string): void => {
  const row = tx
    .select({ state: analyticsProcessEpochs.state })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.epochId, epochId))
    .get()
  if (row?.state !== 'open') {
    log.warn({ epochId, state: row?.state }, 'canonical insert rejected: epoch not open')
    throw new Error(`Epoch ${epochId} is not open (state=${row?.state ?? 'missing'})`)
  }
}

const incrementCounterTx = (
  tx: Tx,
  epochId: string,
  utcDay: string,
  sourceFamily: string,
  disposition: string,
): void => {
  tx.insert(analyticsEpochSourceCounters)
    .values({ epochId, utcDay, sourceFamily, disposition, value: 1 })
    .onConflictDoUpdate({
      target: [
        analyticsEpochSourceCounters.epochId,
        analyticsEpochSourceCounters.utcDay,
        analyticsEpochSourceCounters.sourceFamily,
        analyticsEpochSourceCounters.disposition,
      ],
      set: { value: sql`${analyticsEpochSourceCounters.value} + 1` },
    })
    .run()
}

const insertFenced = (
  tx: Tx,
  input: InsertEligibleCanonicalEventInput,
  storageGeneration: string,
): InsertEligibleCanonicalEventResult => {
  const utcDay = utcDayOfMs(input.event.event.occurred_at_ms)
  const family = EVENT_SOURCE_FAMILY[input.event.event.name]
  if (!recheckAllow(tx, input.collectionRef)) {
    incrementCounterTx(tx, input.processEpochId, utcDay, family, 'opportunity')
    incrementCounterTx(tx, input.processEpochId, utcDay, family, 'governance_ineligible')
    return { status: 'not_eligible' }
  }
  const inserted = insertCanonicalEventRow(tx, {
    storageGeneration,
    processEpochId: input.processEpochId,
    sourceRefKey: input.event.event.id,
    sourceKind: 'live',
    expiresAtMs: input.event.event.occurred_at_ms + V1_MAX_EVENT_RETENTION_DAYS * DAY_MS,
    event: input.event,
  })
  if (inserted.status === 'already_present') {
    return { status: 'already_present', eventId: inserted.eventId }
  }
  tx.insert(analyticsEventCollectionRefs)
    .values({
      eventId: inserted.eventId,
      refKey: input.collectionRef.refKey,
      keyVersion: input.collectionRef.keyVersion,
      generation: input.collectionRef.generation,
      createdAt: input.event.event.ingested_at_ms,
    })
    .run()
  incrementCounterTx(tx, input.processEpochId, utcDay, family, 'opportunity')
  incrementCounterTx(tx, input.processEpochId, utcDay, family, 'canonical')
  return { status: 'inserted', eventId: inserted.eventId }
}

export const insertEligibleCanonicalEvent = (
  input: InsertEligibleCanonicalEventInput,
  deps: CollectionSerializationDeps = { getDrizzleDb: defaultGetDrizzleDb },
): InsertEligibleCanonicalEventResult => {
  const ref: CollectionEligibilityRef | null | undefined = input.collectionRef
  if (ref === null || ref === undefined) {
    log.warn({ epochId: input.processEpochId }, 'canonical insert refused: missing collection ref')
    throw new MissingCollectionRefError()
  }
  const db = deps.getDrizzleDb()
  const result = db.transaction((tx) => {
    requireOpenEpochTx(tx, input.processEpochId)
    const storageGeneration = resolveActive({ getDrizzleDb: deps.getDrizzleDb }).generation
    return insertFenced(tx, input, storageGeneration)
  })
  log.debug({ status: result.status }, 'eligible canonical insert resolved')
  return result
}

export const deleteCanonicalEventsForRef = (
  input: Readonly<{ refKey: string }>,
  deps: CollectionSerializationDeps = { getDrizzleDb: defaultGetDrizzleDb },
): Readonly<{ deletedEventIds: readonly string[] }> => {
  const db = deps.getDrizzleDb()
  return db.transaction((tx) => {
    const rows = tx
      .select({ eventId: analyticsEventCollectionRefs.eventId })
      .from(analyticsEventCollectionRefs)
      .where(eq(analyticsEventCollectionRefs.refKey, input.refKey))
      .all()
    const deletedEventIds = rows.map((row) => row.eventId)
    if (deletedEventIds.length > 0) {
      cancelNeverStartedIn(tx, deletedEventIds)
      markSendingAmbiguousIn(tx, deletedEventIds)
      deleteDeliveryRowsForEventsIn(tx, deletedEventIds)
      tx.delete(analyticsBackfillEventMap).where(inArray(analyticsBackfillEventMap.eventId, deletedEventIds)).run()
      tx.delete(analyticsEventCollectionRefs).where(eq(analyticsEventCollectionRefs.refKey, input.refKey)).run()
      tx.delete(analyticsEvents).where(inArray(analyticsEvents.eventId, deletedEventIds)).run()
    }
    log.info({ count: deletedEventIds.length }, 'canonical events withdrawn via collection association')
    return { deletedEventIds }
  })
}
