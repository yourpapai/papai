// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

const SCHEMA_STATEMENTS = [
  'PRAGMA foreign_keys = ON',
  'PRAGMA secure_delete = ON',
  `CREATE TABLE memory_events (
    scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, event_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL, language TEXT NOT NULL, event_type TEXT NOT NULL,
    event_time_ms INTEGER NOT NULL, ingest_time_ms INTEGER NOT NULL,
    valid_from_ms INTEGER NOT NULL, valid_to_ms INTEGER,
    embedding_available INTEGER NOT NULL, embedding_version TEXT,
    content TEXT NOT NULL, event_json TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_id, event_id)
  )`,
  `CREATE TABLE graph_nodes (
    scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, entity_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL, valid_from_ms INTEGER NOT NULL, valid_to_ms INTEGER,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_id, entity_id, source_event_id),
    FOREIGN KEY (scope_kind, scope_id, source_event_id)
      REFERENCES memory_events(scope_kind, scope_id, event_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE graph_edges (
    scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, relation_id TEXT NOT NULL,
    source_event_id TEXT NOT NULL, source_entity_id TEXT NOT NULL, target_entity_id TEXT NOT NULL,
    relation_type TEXT NOT NULL, valid_from_ms INTEGER NOT NULL, valid_to_ms INTEGER,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_id, relation_id, source_event_id),
    FOREIGN KEY (scope_kind, scope_id, source_event_id)
      REFERENCES memory_events(scope_kind, scope_id, event_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE graph_tombstones (
    kind TEXT NOT NULL, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
    target_id TEXT NOT NULL, completed_at_ms INTEGER NOT NULL,
    PRIMARY KEY (kind, scope_kind, scope_id, target_id)
  )`,
  'CREATE INDEX memory_events_scope_evidence ON memory_events(scope_kind, scope_id, evidence_id)',
  `CREATE INDEX memory_events_scope_validity
    ON memory_events(scope_kind, scope_id, valid_from_ms, valid_to_ms)`,
  `CREATE INDEX graph_nodes_scope_entity
    ON graph_nodes(scope_kind, scope_id, entity_id, valid_from_ms, valid_to_ms)`,
  `CREATE INDEX graph_nodes_scope_provenance
    ON graph_nodes(scope_kind, scope_id, source_event_id, evidence_id)`,
  `CREATE INDEX graph_edges_scope_forward
    ON graph_edges(scope_kind, scope_id, source_entity_id, valid_from_ms, valid_to_ms)`,
  `CREATE INDEX graph_edges_scope_reverse
    ON graph_edges(scope_kind, scope_id, target_entity_id, valid_from_ms, valid_to_ms)`,
  `CREATE INDEX graph_edges_scope_provenance
    ON graph_edges(scope_kind, scope_id, source_event_id, evidence_id)`,
] as const

export const createTemporalGraphDatabase = (): Database => {
  const db = new Database(':memory:')
  SCHEMA_STATEMENTS.forEach((statement) => {
    db.run(statement)
  })
  return db
}
