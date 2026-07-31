// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

export const createPolicyTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_policy (
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
      local_mode TEXT NOT NULL DEFAULT 'local_aggregate'
        CHECK(local_mode IN ('off','local_aggregate','local_pseudonymous')),
      external_aggregate_enabled INTEGER NOT NULL DEFAULT 0 CHECK(external_aggregate_enabled IN (0,1)),
      external_pseudonymous_enabled INTEGER NOT NULL DEFAULT 0 CHECK(external_pseudonymous_enabled IN (0,1)),
      policy_version INTEGER,
      notice_version INTEGER,
      controller_contact TEXT,
      purpose TEXT,
      lawful_basis_mode TEXT CHECK(lawful_basis_mode IS NULL OR lawful_basis_mode IN ('consent','legitimate_interest')),
      retained_event_horizon_days INTEGER
        CHECK(retained_event_horizon_days IS NULL OR retained_event_horizon_days BETWEEN 1 AND 90),
      subject_rights_lookup_horizon_days INTEGER NOT NULL DEFAULT 90
        CHECK(subject_rights_lookup_horizon_days = 90),
      review_date_ms INTEGER,
      acknowledged_at_ms INTEGER,
      policy_effective_at_ms INTEGER,
      config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version > 0),
      updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0)
    )
  `)
}

export const createPreferencesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_preferences (
      governance_actor_key TEXT PRIMARY KEY,
      key_version TEXT NOT NULL,
      local_longitudinal TEXT NOT NULL DEFAULT 'unknown'
        CHECK(local_longitudinal IN ('unknown','allow','deny')),
      external_pseudonymous TEXT NOT NULL DEFAULT 'unknown'
        CHECK(external_pseudonymous IN ('unknown','allow','deny')),
      policy_version INTEGER NOT NULL CHECK(policy_version > 0),
      source TEXT NOT NULL CHECK(source IN ('settings','authenticated_request','operator_migration')),
      effective_at INTEGER NOT NULL CHECK(effective_at >= 0),
      updated_at INTEGER NOT NULL CHECK(updated_at >= 0)
    )
  `)
}

export const createPolicyAuditTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_policy_audit (
      audit_id TEXT PRIMARY KEY,
      governance_actor_key TEXT NOT NULL,
      action TEXT NOT NULL
        CHECK(action IN ('allow','deny','withdraw','delete_requested','delete_completed')),
      policy_version INTEGER NOT NULL CHECK(policy_version > 0),
      occurred_at INTEGER NOT NULL CHECK(occurred_at >= 0),
      result TEXT NOT NULL CHECK(result IN ('applied','rejected','failed')),
      failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN ('validation','conflict','storage','internal'))
    )
  `)
}

export const createDeletionRequestsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_deletion_requests (
      request_id TEXT PRIMARY KEY,
      governance_actor_key TEXT NOT NULL,
      key_version TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('requested','in_progress','completed','failed')),
      policy_version INTEGER NOT NULL CHECK(policy_version > 0),
      requested_at_ms INTEGER NOT NULL CHECK(requested_at_ms >= 0),
      completed_at_ms INTEGER CHECK(completed_at_ms IS NULL OR completed_at_ms >= 0)
    )
  `)
}

export const createCollectionEligibilityTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_collection_eligibility (
      ref_key TEXT PRIMARY KEY,
      key_version TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('allow','deny')),
      generation INTEGER NOT NULL CHECK(generation > 0),
      policy_version INTEGER NOT NULL CHECK(policy_version > 0),
      effective_at INTEGER NOT NULL CHECK(effective_at >= 0),
      revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at >= 0)
    )
  `)
}

export const createEventCollectionRefsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_event_collection_refs (
      event_id TEXT PRIMARY KEY
        REFERENCES analytics_events(event_id) ON DELETE CASCADE,
      ref_key TEXT NOT NULL,
      key_version TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK(generation > 0),
      created_at INTEGER NOT NULL CHECK(created_at >= 0)
    )
  `)
}

export const createEligibilityGrantsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_eligibility_grants (
      grant_key TEXT PRIMARY KEY,
      key_version TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('allow','deny')),
      generation INTEGER NOT NULL CHECK(generation > 0),
      policy_version INTEGER NOT NULL CHECK(policy_version > 0),
      effective_at INTEGER NOT NULL CHECK(effective_at >= 0),
      revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at >= 0)
    )
  `)
}

export const createDeletionTargetBundlesTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_deletion_target_bundles (
      request_id TEXT PRIMARY KEY
        REFERENCES analytics_deletion_requests(request_id) ON DELETE RESTRICT,
      target_ciphertext TEXT NOT NULL,
      target_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      destroyed_at INTEGER CHECK(destroyed_at IS NULL OR destroyed_at >= 0)
    )
  `)
}

export const REKEY_MAPPING_DOMAIN_VALUES = [
  'event-source-ref:v1',
  'deployment:v1',
  'platform-instance:v1',
  'actor:v1',
  'context:v1',
  'conversation:v1',
  'thread:v1',
  'turn:v1',
  'llm-attempt:v1',
  'task-instance:v1',
  'model:v1',
  'tool:v1',
  'coding-project:v1',
  'coding-session:v1',
  'session:v1',
  'materialization:v1',
  'governance-actor:v1',
  'collection-eligibility:v1',
  'delivery-grant:v1',
] as const

const REKEY_PHASES = [
  'plan',
  'dual_write',
  'copy_parents',
  'copy_children',
  'verify',
  'cutover',
  'swap',
  'snapshot_republish',
  'remote',
  'retire',
] as const

const REKEY_SUBPHASES = [
  'dual_write.identity',
  'dual_write.governance',
  'copy_parents.events_sources',
  'copy_children.materializations_backfill',
  'copy_children.preferences_collection_grants',
  'copy_children.delivery_deletion',
  'verify.local_graph',
  'cutover.fence_drain_delta',
  'cutover.snapshot_quiesced',
  'swap.active_generation',
  'snapshot_republish.quiesce_build_switch',
  'remote_delete',
  'remote_resend',
  'retire.waiting_horizon',
] as const

const sqlList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(',')

export const createRekeyRunsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_rekey_runs (
      run_id TEXT PRIMARY KEY,
      source_generation TEXT NOT NULL,
      target_generation TEXT NOT NULL,
      from_versions TEXT NOT NULL CHECK(json_valid(from_versions)),
      to_versions TEXT NOT NULL CHECK(json_valid(to_versions)),
      source_high_water TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN (${sqlList(REKEY_PHASES)})),
      subphase TEXT CHECK(subphase IS NULL OR subphase IN (${sqlList(REKEY_SUBPHASES)})),
      plan_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('planned','running','paused','completed','aborted')),
      mapped_count INTEGER NOT NULL DEFAULT 0 CHECK(mapped_count >= 0),
      copied_count INTEGER NOT NULL DEFAULT 0 CHECK(copied_count >= 0),
      verified_count INTEGER NOT NULL DEFAULT 0 CHECK(verified_count >= 0),
      swap_completed_at_ms INTEGER CHECK(swap_completed_at_ms IS NULL OR swap_completed_at_ms >= 0),
      retire_not_before_ms INTEGER CHECK(retire_not_before_ms IS NULL OR retire_not_before_ms >= 0),
      created_at INTEGER NOT NULL CHECK(created_at >= 0),
      updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
      CHECK(source_generation <> target_generation)
    )
  `)
}

export const createRekeyMappingsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_rekey_mappings (
      run_id TEXT NOT NULL
        REFERENCES analytics_rekey_runs(run_id) ON DELETE RESTRICT,
      domain TEXT NOT NULL CHECK(domain IN (${sqlList(REKEY_MAPPING_DOMAIN_VALUES)})),
      old_key_hash TEXT NOT NULL,
      mapping_ciphertext TEXT NOT NULL,
      mapping_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('mapped','copied','verified','destroyed')),
      PRIMARY KEY(run_id, domain, old_key_hash)
    )
  `)
}

export const createSnapshotPublicationsTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_snapshot_publications (
      snapshot_id TEXT PRIMARY KEY,
      storage_generation TEXT NOT NULL,
      transition_run_id TEXT
        REFERENCES analytics_rekey_runs(run_id) ON DELETE RESTRICT,
      path_hash TEXT NOT NULL,
      source_high_water TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('staged','published','invalidated')),
      published_at INTEGER CHECK(published_at IS NULL OR published_at >= 0),
      invalidated_at INTEGER CHECK(invalidated_at IS NULL OR invalidated_at >= 0)
    )
  `)
}

export const createActiveGenerationTable = (db: Database): void => {
  db.run(`
    CREATE TABLE analytics_active_generation (
      singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
      active_generation TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0)
    )
  `)
}
