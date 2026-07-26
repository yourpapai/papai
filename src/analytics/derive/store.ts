// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, gte, isNotNull, isNull, lt, ne, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsCollectionEligibility, analyticsEventCollectionRefs, analyticsEvents } from '../../db/schema.js'
import { unexpiredEventFilter } from '../retention/expiry-guard.js'
import type { ExecutedToolOutcome } from './outcomes.js'
import type { SessionSourceEvent } from './sessionizer.js'

export type Db = ReturnType<typeof defaultGetDrizzleDb>

export type EventRow = typeof analyticsEvents.$inferSelect

export type AffectedPartition = Readonly<{ actorKey: string; conversationKey: string }>

export type PartitionTurnFacts = Readonly<{
  turnKey: string
  actorKey: string
  conversationKey: string
  turnStartMs: number
  turnEndMs: number
  anchorEventId: string
  goals: readonly string[]
  executedOutcomes: readonly ExecutedToolOutcome[]
  clarification: boolean
  durationMs: number | null
  hasRephrase: boolean
  hasClarificationAbandoned: boolean
  hasPermissionIssue: boolean
  hasStop: boolean
  hasDisclosureFallback: boolean
  censorStartMs: number | null
  clarificationSourceEventId: string | null
}>

export const readProps = (row: EventRow): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(row.propsJson)
  if (typeof parsed !== 'object' || parsed === null) return {}
  return Object.fromEntries(Object.entries(parsed))
}

export const partitionFilter = (partition: AffectedPartition): SQL | undefined =>
  and(
    eq(analyticsEvents.actorKey, partition.actorKey),
    ne(analyticsEvents.actorRole, 'guest'),
    or(
      eq(analyticsEvents.threadKey, partition.conversationKey),
      and(isNull(analyticsEvents.threadKey), eq(analyticsEvents.contextKey, partition.conversationKey)),
    ),
  )

export const findAffectedPartitions = (
  db: Db,
  generation: string,
  startMs: number,
  endMs: number,
  nowMs: number,
): readonly AffectedPartition[] => {
  const rows = db
    .select({
      actorKey: analyticsEvents.actorKey,
      threadKey: analyticsEvents.threadKey,
      contextKey: analyticsEvents.contextKey,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.storageGeneration, generation),
        gte(analyticsEvents.occurredAtMs, startMs),
        lt(analyticsEvents.occurredAtMs, endMs),
        isNotNull(analyticsEvents.actorKey),
        ne(analyticsEvents.actorRole, 'guest'),
        unexpiredEventFilter(nowMs),
      ),
    )
    .all()
  const seen = new Map<string, AffectedPartition>()
  for (const row of rows) {
    if (row.actorKey === null) continue
    const conversationKey = row.threadKey ?? row.contextKey
    if (conversationKey === null) continue
    seen.set(`${row.actorKey} ${conversationKey}`, { actorKey: row.actorKey, conversationKey })
  }
  return [...seen.values()].sort(
    (left, right) =>
      left.actorKey.localeCompare(right.actorKey) || left.conversationKey.localeCompare(right.conversationKey),
  )
}

const loadPartitionRows = (
  db: Db,
  generation: string,
  partition: AffectedPartition,
  nowMs: number,
): readonly EventRow[] =>
  db
    .select()
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.storageGeneration, generation), partitionFilter(partition), unexpiredEventFilter(nowMs)),
    )
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .all()

export const loadPartitionEvents = (
  db: Db,
  generation: string,
  partition: AffectedPartition,
  nowMs: number,
): readonly SessionSourceEvent[] =>
  loadPartitionRows(db, generation, partition, nowMs).map((row) => ({
    eventId: row.eventId,
    eventName: row.eventName,
    occurredAtMs: row.occurredAtMs,
    actorKey: row.actorKey,
    contextKey: row.contextKey,
    threadKey: row.threadKey,
    turnKey: row.turnKey,
    actorRole: row.actorRole,
    invocationMode: row.invocationMode,
  }))

const DENIED_PERMISSION_DECISIONS = new Set(['denied', 'ignored', 'prompt_failed'])
const EXECUTED_OUTCOMES = new Set(['semantic_success', 'structured_failure', 'thrown_failure'])
const NON_GOAL_IDS = new Set(['I21', 'I22', 'I23'])

const censorStartForEvent = (db: Db, eventId: string): number | null => {
  const row = db
    .select({
      state: analyticsCollectionEligibility.state,
      revokedAt: analyticsCollectionEligibility.revokedAt,
      effectiveAt: analyticsCollectionEligibility.effectiveAt,
    })
    .from(analyticsEventCollectionRefs)
    .innerJoin(
      analyticsCollectionEligibility,
      eq(analyticsEventCollectionRefs.refKey, analyticsCollectionEligibility.refKey),
    )
    .where(eq(analyticsEventCollectionRefs.eventId, eventId))
    .get()
  if (row === undefined || row.state !== 'deny') return null
  return row.revokedAt ?? row.effectiveAt
}

const goalsOf = (rows: readonly EventRow[]): readonly string[] => {
  const intentRow = rows.find((row) => row.eventName === 'intent_classified')
  if (intentRow === undefined) return []
  const goals = readProps(intentRow)['goals']
  if (!Array.isArray(goals)) return []
  return [
    ...new Set(goals.filter((goal): goal is string => typeof goal === 'string' && !NON_GOAL_IDS.has(goal))),
  ].slice(0, 3)
}

const executedOutcomesOf = (rows: readonly EventRow[]): readonly ExecutedToolOutcome[] =>
  rows
    .filter((row) => row.eventName === 'tool_completed')
    .map((row) => readProps(row)['execution_outcome'])
    .filter((outcome): outcome is ExecutedToolOutcome => typeof outcome === 'string' && EXECUTED_OUTCOMES.has(outcome))

const buildTurnFacts = (
  db: Db,
  partition: AffectedPartition,
  turnKey: string,
  rows: readonly EventRow[],
): PartitionTurnFacts | null => {
  const anchor = rows.find((row) => row.eventName === 'turn_completed')
  if (anchor === undefined) return null
  const anchorProps = readProps(anchor)
  const durationMs = typeof anchorProps['duration_ms'] === 'number' ? anchorProps['duration_ms'] : null
  const started = rows.filter((row) => row.eventName === 'turn_started')
  const clarificationRow = rows.find((row) => row.eventName === 'clarification_requested')
  const clarification = anchorProps['clarification'] === true || clarificationRow !== undefined
  return {
    turnKey,
    actorKey: partition.actorKey,
    conversationKey: partition.conversationKey,
    turnStartMs:
      started[0]?.occurredAtMs ?? (durationMs === null ? anchor.occurredAtMs : anchor.occurredAtMs - durationMs),
    turnEndMs: anchor.occurredAtMs,
    anchorEventId: anchor.eventId,
    goals: goalsOf(rows),
    executedOutcomes: executedOutcomesOf(rows),
    clarification,
    durationMs,
    hasRephrase: rows.some((row) => row.eventName === 'rephrase_detected'),
    hasClarificationAbandoned: rows.some((row) => row.eventName === 'clarification_abandoned'),
    hasPermissionIssue: rows.some((row) => {
      if (row.eventName !== 'confirmation_resolved') return false
      const decision = readProps(row)['decision']
      return typeof decision === 'string' && DENIED_PERMISSION_DECISIONS.has(decision)
    }),
    hasStop: rows.some((row) => row.eventName === 'turn_stop_requested'),
    hasDisclosureFallback: rows.some((row) => row.eventName === 'disclosure_fallback'),
    censorStartMs: censorStartForEvent(db, anchor.eventId),
    clarificationSourceEventId: clarificationRow?.eventId ?? null,
  }
}

export const loadTurnFacts = (
  db: Db,
  generation: string,
  partition: AffectedPartition,
  nowMs: number,
): readonly PartitionTurnFacts[] => {
  const rows = loadPartitionRows(db, generation, partition, nowMs).filter((row) => row.turnKey !== null)
  const byTurn = new Map<string, EventRow[]>()
  for (const row of rows) {
    if (row.turnKey === null) continue
    const group = byTurn.get(row.turnKey)
    if (group === undefined) byTurn.set(row.turnKey, [row])
    else group.push(row)
  }
  return [...byTurn.entries()]
    .map(([turnKey, turnRows]) => buildTurnFacts(db, partition, turnKey, turnRows))
    .filter((facts): facts is PartitionTurnFacts => facts !== null)
    .sort((left, right) => left.turnStartMs - right.turnStartMs || left.turnKey.localeCompare(right.turnKey))
}
