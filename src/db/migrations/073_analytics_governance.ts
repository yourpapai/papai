// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'
import {
  createActiveGenerationTable,
  createCollectionEligibilityTable,
  createDeletionRequestsTable,
  createDeletionTargetBundlesTable,
  createEligibilityGrantsTable,
  createEventCollectionRefsTable,
  createPolicyAuditTable,
  createPolicyTable,
  createPreferencesTable,
  createRekeyMappingsTable,
  createRekeyRunsTable,
  createSnapshotPublicationsTable,
} from './073_analytics_governance_tables.js'

export const INITIAL_ANALYTICS_GENERATION = 'gen-1'

const createSingletonGuards = (db: Database): void => {
  db.run(`
    CREATE TRIGGER analytics_active_generation_no_delete
    BEFORE DELETE ON analytics_active_generation
    BEGIN
      SELECT RAISE(ABORT, 'analytics_active_generation singleton cannot be deleted');
    END
  `)
}

const createNonterminalRunIndex = (db: Database): void => {
  db.run(`
    CREATE UNIQUE INDEX idx_analytics_rekey_runs_single_nonterminal
      ON analytics_rekey_runs((1))
      WHERE status IN ('planned','running','paused')
  `)
}

const createSnapshotPublicationIndexes = (db: Database): void => {
  db.run(`
    CREATE UNIQUE INDEX idx_analytics_snapshot_publications_single_staged
      ON analytics_snapshot_publications((1))
      WHERE state = 'staged'
  `)
  db.run(`
    CREATE UNIQUE INDEX idx_analytics_snapshot_publications_single_published
      ON analytics_snapshot_publications((1))
      WHERE state = 'published'
  `)
}

const insertDefaultPolicyRow = (db: Database): void => {
  db.run(
    `INSERT INTO analytics_policy (
       singleton_id, local_mode, external_aggregate_enabled, external_pseudonymous_enabled,
       subject_rights_lookup_horizon_days, config_version, updated_at_ms
     ) VALUES (1, 'local_aggregate', 0, 0, 90, 1, 0)`,
  )
}

const insertInitialActiveGeneration = (db: Database): void => {
  db.run(
    `INSERT INTO analytics_active_generation (singleton_id, active_generation, updated_at_ms)
     VALUES (1, ?, 0)`,
    [INITIAL_ANALYTICS_GENERATION],
  )
}

const up = (db: Database): void => {
  createPolicyTable(db)
  createPreferencesTable(db)
  createPolicyAuditTable(db)
  createDeletionRequestsTable(db)
  createCollectionEligibilityTable(db)
  createEventCollectionRefsTable(db)
  createEligibilityGrantsTable(db)
  createDeletionTargetBundlesTable(db)
  createActiveGenerationTable(db)
  createRekeyRunsTable(db)
  createRekeyMappingsTable(db)
  createSnapshotPublicationsTable(db)
  createSingletonGuards(db)
  createNonterminalRunIndex(db)
  createSnapshotPublicationIndexes(db)
  insertDefaultPolicyRow(db)
  insertInitialActiveGeneration(db)
}

export const migration073AnalyticsGovernance: Migration = {
  id: '073_analytics_governance',
  up,
}

export default migration073AnalyticsGovernance
