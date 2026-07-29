// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { MemoryEventSchema } from '../types.js'
import type { ForgetRequest, MemoryEvent, MemoryScope } from '../types.js'
import { eventEpochInterval, relationEpochInterval } from './temporal-graph-domain.js'
import type { GraphTombstone } from './temporal-graph-domain.js'
import { createTemporalGraphDatabase } from './temporal-graph-schema.js'

type EventParams = [
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number | null,
  number,
  string | null,
  string,
  string,
]
type NodeParams = [string, string, string, string, string, string, string, number, number | null, string]
type EdgeParams = [string, string, string, string, string, string, string, number, number | null, string]
type AffectedRow = Readonly<{ event_id: string; evidence_id: string }>
type EventJsonRow = Readonly<{ event_json: string }>
type EntityRow = Readonly<{ source_entity_id: string }>
type EdgeRow = Readonly<{
  relation_id: string
  source_event_id: string
  source_entity_id: string
  target_entity_id: string
  evidence_id: string
}>

export type GraphEdgeStep = Readonly<{
  relationId: string
  sourceEventId: string
  evidenceId: string
  nextEntityId: string
  direction: 'forward' | 'reverse'
}>

export type TemporalGraphStore = Readonly<{
  upsertEvents(events: readonly MemoryEvent[]): void
  sourceEntities(scope: MemoryScope, queryTimeMs: number, sourceEventId: string, limit: number): readonly string[]
  adjacent(scope: MemoryScope, queryTimeMs: number, entityId: string, limit: number): readonly GraphEdgeStep[]
  eventAt(scope: MemoryScope, queryTimeMs: number, eventId: string): MemoryEvent | null
  forget(request: ForgetRequest, tombstones: readonly GraphTombstone[]): readonly string[]
  hasPersistentState(): boolean
  serializedBytes(): number
  close(): void
}>

const eventParams = (event: MemoryEvent): EventParams => {
  const validity = eventEpochInterval(event)
  return [
    event.scope.kind,
    event.scope.id,
    event.eventId,
    event.evidenceId,
    event.language,
    event.type,
    Date.parse(event.eventTime),
    Date.parse(event.ingestTime),
    validity.validFromMs,
    validity.validToMs,
    event.embedding.available ? 1 : 0,
    event.embedding.version,
    event.content,
    JSON.stringify(event),
  ]
}

const compareEdgeStep = (left: GraphEdgeStep, right: GraphEdgeStep): number =>
  left.relationId.localeCompare(right.relationId) ||
  left.sourceEventId.localeCompare(right.sourceEventId) ||
  left.direction.localeCompare(right.direction) ||
  left.nextEntityId.localeCompare(right.nextEntityId)

const INSERT_EVENT_SQL = `INSERT INTO memory_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scope_kind, scope_id, event_id) DO UPDATE SET
    evidence_id = excluded.evidence_id, language = excluded.language,
    event_type = excluded.event_type, event_time_ms = excluded.event_time_ms,
    ingest_time_ms = excluded.ingest_time_ms, valid_from_ms = excluded.valid_from_ms,
    valid_to_ms = excluded.valid_to_ms, embedding_available = excluded.embedding_available,
    embedding_version = excluded.embedding_version, content = excluded.content,
    event_json = excluded.event_json`
const ACTIVE_PREDICATE = 'valid_from_ms <= ? AND (valid_to_ms IS NULL OR ? < valid_to_ms)'
const REMOVE_NODES_SQL = 'DELETE FROM graph_nodes WHERE scope_kind = ? AND scope_id = ? AND source_event_id = ?'
const REMOVE_EDGES_SQL = 'DELETE FROM graph_edges WHERE scope_kind = ? AND scope_id = ? AND source_event_id = ?'

const createEventWriter = (db: Database): ((event: MemoryEvent) => void) => {
  const removeNodes = db.query<never, [string, string, string]>(REMOVE_NODES_SQL)
  const removeEdges = db.query<never, [string, string, string]>(REMOVE_EDGES_SQL)
  const insertEvent = db.query<never, EventParams>(INSERT_EVENT_SQL)
  const insertNode = db.query<never, NodeParams>(
    'INSERT OR REPLACE INTO graph_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertEdge = db.query<never, EdgeParams>(
    'INSERT OR REPLACE INTO graph_edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  return (event) => {
    removeNodes.run(event.scope.kind, event.scope.id, event.eventId)
    removeEdges.run(event.scope.kind, event.scope.id, event.eventId)
    insertEvent.run(...eventParams(event))
    const eventValidity = eventEpochInterval(event)
    event.entities.forEach((entity) => {
      insertNode.run(
        event.scope.kind,
        event.scope.id,
        entity.entityId,
        event.eventId,
        entity.type,
        entity.name,
        JSON.stringify(entity.aliases),
        eventValidity.validFromMs,
        eventValidity.validToMs,
        event.evidenceId,
      )
    })
    event.relations.forEach((relation) => {
      const validity = relationEpochInterval(event, relation)
      if (validity === null) return
      insertEdge.run(
        event.scope.kind,
        event.scope.id,
        relation.relationId,
        event.eventId,
        relation.sourceEntityId,
        relation.targetEntityId,
        relation.type,
        validity.validFromMs,
        validity.validToMs,
        event.evidenceId,
      )
    })
  }
}

const createUpsertEvents = (db: Database): TemporalGraphStore['upsertEvents'] => {
  const writeEvent = createEventWriter(db)
  const writeEvents = db.transaction((events: readonly MemoryEvent[]) => {
    events.forEach(writeEvent)
  })
  return (events) => {
    writeEvents(events)
  }
}

const createSourceEntities = (db: Database): TemporalGraphStore['sourceEntities'] => {
  const sources = db.query<EntityRow, [string, string, string, number, number, number]>(
    `SELECT DISTINCT source_entity_id FROM graph_edges
     WHERE scope_kind = ? AND scope_id = ? AND source_event_id = ? AND ${ACTIVE_PREDICATE}
     ORDER BY source_entity_id LIMIT ?`,
  )
  return (scope, queryTimeMs, sourceEventId, limit) =>
    sources
      .all(scope.kind, scope.id, sourceEventId, queryTimeMs, queryTimeMs, limit)
      .map(({ source_entity_id }) => source_entity_id)
}

const createAdjacent = (db: Database): TemporalGraphStore['adjacent'] => {
  const outgoing = db.query<EdgeRow, [string, string, string, number, number, number]>(
    `SELECT relation_id, source_event_id, source_entity_id, target_entity_id, evidence_id
     FROM graph_edges WHERE scope_kind = ? AND scope_id = ? AND source_entity_id = ?
       AND ${ACTIVE_PREDICATE}
     ORDER BY relation_id, source_event_id, evidence_id, target_entity_id LIMIT ?`,
  )
  const incoming = db.query<EdgeRow, [string, string, string, number, number, number]>(
    `SELECT relation_id, source_event_id, source_entity_id, target_entity_id, evidence_id
     FROM graph_edges WHERE scope_kind = ? AND scope_id = ? AND target_entity_id = ?
       AND ${ACTIVE_PREDICATE}
     ORDER BY relation_id, source_event_id, evidence_id, source_entity_id LIMIT ?`,
  )
  return (scope, queryTimeMs, entityId, limit) => {
    const params = [scope.kind, scope.id, entityId, queryTimeMs, queryTimeMs, limit] as const
    const forward = outgoing.all(...params).map((edge) => ({
      relationId: edge.relation_id,
      sourceEventId: edge.source_event_id,
      evidenceId: edge.evidence_id,
      nextEntityId: edge.target_entity_id,
      direction: 'forward' as const,
    }))
    const reverse = incoming.all(...params).map((edge) => ({
      relationId: edge.relation_id,
      sourceEventId: edge.source_event_id,
      evidenceId: edge.evidence_id,
      nextEntityId: edge.source_entity_id,
      direction: 'reverse' as const,
    }))
    return [...forward, ...reverse].sort(compareEdgeStep).slice(0, limit)
  }
}

const createEventAt = (db: Database): TemporalGraphStore['eventAt'] => {
  const activeEvent = db.query<EventJsonRow, [string, string, string, number, number]>(
    `SELECT event_json FROM memory_events
     WHERE scope_kind = ? AND scope_id = ? AND event_id = ? AND ${ACTIVE_PREDICATE}`,
  )
  return (scope, queryTimeMs, eventId) => {
    const row = activeEvent.get(scope.kind, scope.id, eventId, queryTimeMs, queryTimeMs)
    if (row === null) return null
    const raw: unknown = JSON.parse(row.event_json)
    return MemoryEventSchema.parse(raw)
  }
}

const createAffectedRows = (db: Database): ((request: ForgetRequest) => readonly AffectedRow[]) => {
  const affectedEvidence = db.query<AffectedRow, [string, string, string]>(
    'SELECT event_id, evidence_id FROM memory_events WHERE scope_kind = ? AND scope_id = ? AND evidence_id = ?',
  )
  const affectedSubject = db.query<AffectedRow, [string, string, string]>(
    `SELECT DISTINCT e.event_id, e.evidence_id FROM memory_events e
     JOIN graph_nodes n ON n.scope_kind = e.scope_kind AND n.scope_id = e.scope_id
       AND n.source_event_id = e.event_id
     WHERE e.scope_kind = ? AND e.scope_id = ? AND n.entity_id = ?`,
  )
  const affectedScope = db.query<AffectedRow, [string, string]>(
    'SELECT event_id, evidence_id FROM memory_events WHERE scope_kind = ? AND scope_id = ?',
  )
  return (request) =>
    request.kind === 'scope'
      ? affectedScope.all(request.scope.kind, request.scope.id)
      : request.kind === 'subject'
        ? affectedSubject.all(request.scope.kind, request.scope.id, request.subjectId)
        : request.evidenceIds.flatMap((id) => affectedEvidence.all(request.scope.kind, request.scope.id, id))
}

const createForget = (db: Database): TemporalGraphStore['forget'] => {
  const affectedRows = createAffectedRows(db)
  const deleteEvent = db.query<never, [string, string, string]>(
    'DELETE FROM memory_events WHERE scope_kind = ? AND scope_id = ? AND event_id = ?',
  )
  const insertTombstone = db.query<never, [string, string, string, string, number]>(
    `INSERT OR REPLACE INTO graph_tombstones VALUES (?, ?, ?, ?, ?)`,
  )
  const applyForget = db.transaction((request: ForgetRequest, tombstones: readonly GraphTombstone[]) => {
    const affected = affectedRows(request)
    affected.forEach(({ event_id }) => {
      deleteEvent.run(request.scope.kind, request.scope.id, event_id)
    })
    tombstones.forEach((tombstone) => {
      insertTombstone.run(
        tombstone.kind,
        tombstone.scope.kind,
        tombstone.scope.id,
        tombstone.targetId ?? '',
        Date.parse(tombstone.completedAt),
      )
    })
    return [...new Set(affected.map(({ evidence_id }) => evidence_id))].sort()
  })
  return (request, tombstones) => applyForget(request, tombstones)
}

export const createTemporalGraphStore = (): TemporalGraphStore => {
  const db = createTemporalGraphDatabase()
  const stateCount = db.query<{ count: number }, []>(
    `SELECT (SELECT COUNT(*) FROM memory_events) + (SELECT COUNT(*) FROM graph_tombstones) AS count`,
  )
  return {
    upsertEvents: createUpsertEvents(db),
    sourceEntities: createSourceEntities(db),
    adjacent: createAdjacent(db),
    eventAt: createEventAt(db),
    forget: createForget(db),
    hasPersistentState: () => (stateCount.get()?.count ?? 0) > 0,
    serializedBytes: () => db.serialize().byteLength,
    close: () => {
      db.close(false)
    },
  }
}
