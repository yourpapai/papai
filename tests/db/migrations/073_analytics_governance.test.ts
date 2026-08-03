// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import * as analyticsSchema from '../../../src/db/analytics-schema.js'
import { migration072AnalyticsFoundation } from '../../../src/db/migrations/072_analytics_foundation.js'
import { migration073AnalyticsGovernance } from '../../../src/db/migrations/073_analytics_governance.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const GOVERNANCE_TABLES = [
  'analytics_policy',
  'analytics_preferences',
  'analytics_policy_audit',
  'analytics_deletion_requests',
  'analytics_collection_eligibility',
  'analytics_event_collection_refs',
  'analytics_eligibility_grants',
  'analytics_deletion_target_bundles',
  'analytics_active_generation',
  'analytics_rekey_runs',
  'analytics_rekey_mappings',
  'analytics_snapshot_publications',
]

const GOVERNANCE_EXPORT_NAMES = [
  'analyticsPolicy',
  'analyticsPreferences',
  'analyticsPolicyAudit',
  'analyticsDeletionRequests',
  'analyticsCollectionEligibility',
  'analyticsEventCollectionRefs',
  'analyticsEligibilityGrants',
  'analyticsDeletionTargetBundles',
  'analyticsActiveGeneration',
  'analyticsRekeyRuns',
  'analyticsRekeyMappings',
  'analyticsSnapshotPublications',
]

const insertMinimalEvent = (db: Database, eventId: string): void => {
  db.run(
    `INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 1700000000000)`,
  )
  db.run(
    `INSERT INTO analytics_events (
       event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
       schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms,
       source, attribution_quality, app_version, deployment_key, key_version,
       platform, platform_instance_key, context_type, actor_role, task_provider,
       invocation_mode, policy_version, eligibility, max_class, props_json, expires_at_ms
     ) VALUES (
       ?, 'gen-1', 'epoch-1', ?, 'live',
       1, 'turn_started', 1, 1700000000000, 1700000000001,
       'live', 'native', '6.10.0', 'v1.p-deploy', 'v1',
       'telegram', 'v1.p-instance', 'dm', 'admin', 'none',
       'normal', 1, 'allowed', 'C0', '{}', 1700000000002
     )`,
    [eventId, `ref-${eventId}`],
  )
}

describe('migration 073_analytics_governance', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration072AnalyticsFoundation.up(db)
    migration073AnalyticsGovernance.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('exports a migration with the expected id', () => {
    expect(migration073AnalyticsGovernance.id).toBe('073_analytics_governance')
    expect(typeof migration073AnalyticsGovernance.up).toBe('function')
  })

  test('creates every governance table', () => {
    const tables = getTableNames(db)
    for (const table of GOVERNANCE_TABLES) {
      expect(tables).toContain(table)
    }
  })

  test('policy singleton defaults to local_aggregate with external lanes disabled and incomplete governance', () => {
    const row = db.query<Record<string, unknown>, []>('SELECT * FROM analytics_policy').get()
    expect(row).toMatchObject({
      singleton_id: 1,
      local_mode: 'local_aggregate',
      external_aggregate_enabled: 0,
      external_pseudonymous_enabled: 0,
      policy_version: null,
      notice_version: null,
      controller_contact: null,
      purpose: null,
      lawful_basis_mode: null,
      subject_rights_lookup_horizon_days: 90,
      config_version: 1,
    })
    expect(() => db.run(`INSERT INTO analytics_policy (singleton_id, updated_at_ms) VALUES (2, 1)`)).toThrow()
  })

  test('subject_rights_lookup_horizon_days is pinned at exactly 90', () => {
    expect(() =>
      db.run('UPDATE analytics_policy SET subject_rights_lookup_horizon_days = 89 WHERE singleton_id = 1'),
    ).toThrow()
    expect(() =>
      db.run('UPDATE analytics_policy SET subject_rights_lookup_horizon_days = 91 WHERE singleton_id = 1'),
    ).toThrow()
  })

  test('retained event horizon is capped at the v1 90-day maximum', () => {
    db.run('UPDATE analytics_policy SET retained_event_horizon_days = 45 WHERE singleton_id = 1')
    db.run('UPDATE analytics_policy SET retained_event_horizon_days = 90 WHERE singleton_id = 1')
    expect(() =>
      db.run('UPDATE analytics_policy SET retained_event_horizon_days = 91 WHERE singleton_id = 1'),
    ).toThrow()
    expect(() => db.run('UPDATE analytics_policy SET retained_event_horizon_days = 0 WHERE singleton_id = 1')).toThrow()
  })

  test('policy local mode is a closed value', () => {
    expect(() => db.run(`UPDATE analytics_policy SET local_mode = 'everything' WHERE singleton_id = 1`)).toThrow()
    db.run(`UPDATE analytics_policy SET local_mode = 'local_pseudonymous' WHERE singleton_id = 1`)
  })

  test('preferences store one current row keyed by governance actor key with closed values', () => {
    db.run(
      `INSERT INTO analytics_preferences (
         governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
         policy_version, source, effective_at, updated_at
       ) VALUES ('v1.g-actor', 'v1', 'allow', 'unknown', 1, 'settings', 1700000000000, 1700000000000)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_preferences (
           governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
           policy_version, source, effective_at, updated_at
         ) VALUES ('v1.g-actor', 'v1', 'deny', 'unknown', 1, 'settings', 1, 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_preferences (
           governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
           policy_version, source, effective_at, updated_at
         ) VALUES ('v1.g-other', 'v1', 'maybe', 'unknown', 1, 'settings', 1, 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_preferences (
           governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
           policy_version, source, effective_at, updated_at
         ) VALUES ('v1.g-third', 'v1', 'allow', 'unknown', 1, 'chat', 1, 1)`,
      ),
    ).toThrow()
  })

  test('policy audit is append-only with closed action and result values', () => {
    db.run(
      `INSERT INTO analytics_policy_audit (
         audit_id, governance_actor_key, action, policy_version, occurred_at, result, failure_class
       ) VALUES ('audit-1', 'v1.g-actor', 'allow', 1, 1700000000000, 'applied', NULL)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_policy_audit (
           audit_id, governance_actor_key, action, policy_version, occurred_at, result, failure_class
         ) VALUES ('audit-2', 'v1.g-actor', 'observe', 1, 1, 'applied', NULL)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_policy_audit (
           audit_id, governance_actor_key, action, policy_version, occurred_at, result, failure_class
         ) VALUES ('audit-3', 'v1.g-actor', 'deny', 1, 1, 'maybe', NULL)`,
      ),
    ).toThrow()
  })

  test('deletion target bundles require an existing deletion request and hold only encrypted fields', () => {
    const columns = db.query<{ name: string }, []>(`PRAGMA table_info(analytics_deletion_target_bundles)`).all()
    expect(columns.map((c) => c.name)).toEqual([
      'request_id',
      'target_ciphertext',
      'target_hash',
      'created_at',
      'destroyed_at',
    ])
    expect(() =>
      db.run(
        `INSERT INTO analytics_deletion_target_bundles (request_id, target_ciphertext, target_hash, created_at)
         VALUES ('missing-request', 'ct', 'hash', 1)`,
      ),
    ).toThrow()
    db.run(
      `INSERT INTO analytics_deletion_requests (
         request_id, governance_actor_key, key_version, state, policy_version, requested_at_ms
       ) VALUES ('req-1', 'v1.g-actor', 'v1', 'requested', 1, 1700000000000)`,
    )
    db.run(
      `INSERT INTO analytics_deletion_target_bundles (request_id, target_ciphertext, target_hash, created_at)
       VALUES ('req-1', 'sealed-ciphertext', 'sha256-hash', 1700000000000)`,
    )
  })

  test('deletion requests use a closed state machine', () => {
    expect(() =>
      db.run(
        `INSERT INTO analytics_deletion_requests (
           request_id, governance_actor_key, key_version, state, policy_version, requested_at_ms
         ) VALUES ('req-x', 'v1.g-actor', 'v1', 'vanished', 1, 1)`,
      ),
    ).toThrow()
  })

  test('collection eligibility uses closed state and the event association references canonical events', () => {
    expect(() =>
      db.run(
        `INSERT INTO analytics_collection_eligibility (
           ref_key, key_version, state, generation, policy_version, effective_at
         ) VALUES ('v1.c-ref', 'v1', 'pending', 1, 1, 1)`,
      ),
    ).toThrow()
    expect(() =>
      db.run(
        `INSERT INTO analytics_event_collection_refs (event_id, ref_key, key_version, generation, created_at)
         VALUES ('no-such-event', 'v1.c-ref', 'v1', 1, 1)`,
      ),
    ).toThrow()

    insertMinimalEvent(db, 'event-1')
    db.run(
      `INSERT INTO analytics_collection_eligibility (
         ref_key, key_version, state, generation, policy_version, effective_at
       ) VALUES ('v1.c-ref', 'v1', 'allow', 1, 1, 1700000000000)`,
    )
    db.run(
      `INSERT INTO analytics_event_collection_refs (event_id, ref_key, key_version, generation, created_at)
       VALUES ('event-1', 'v1.c-ref', 'v1', 1, 1700000000001)`,
    )
  })

  test('eligibility grants use closed state values', () => {
    db.run(
      `INSERT INTO analytics_eligibility_grants (
         grant_key, key_version, state, generation, policy_version, effective_at
       ) VALUES ('v1.d-grant', 'v1', 'allow', 1, 1, 1700000000000)`,
    )
    expect(() =>
      db.run(
        `INSERT INTO analytics_eligibility_grants (
           grant_key, key_version, state, generation, policy_version, effective_at
         ) VALUES ('v1.d-other', 'v1', 'maybe', 1, 1, 1)`,
      ),
    ).toThrow()
  })

  test('exactly one active generation row exists; a second row and deletion fail; atomic update succeeds', () => {
    const initial = db
      .query<{ active_generation: string; updated_at_ms: number }, []>('SELECT * FROM analytics_active_generation')
      .get()
    expect(initial).not.toBeNull()

    expect(() =>
      db.run(
        `INSERT INTO analytics_active_generation (singleton_id, active_generation, updated_at_ms) VALUES (2, 'gen-2', 1)`,
      ),
    ).toThrow()
    expect(() => db.run('DELETE FROM analytics_active_generation WHERE singleton_id = 1')).toThrow()

    db.run(
      `UPDATE analytics_active_generation SET active_generation = 'gen-2', updated_at_ms = 1700000000999 WHERE singleton_id = 1`,
    )
    const updated = db
      .query<{ active_generation: string; updated_at_ms: number }, []>('SELECT * FROM analytics_active_generation')
      .get()
    expect(updated?.active_generation).toBe('gen-2')
    expect(updated?.updated_at_ms).toBe(1700000000999)
    const count = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM analytics_active_generation').get()
    expect(count?.n).toBe(1)
  })

  test('rekey runs use closed statuses and permit at most one nonterminal run', () => {
    const insertRun = (runId: string, status: string): void => {
      db.run(
        `INSERT INTO analytics_rekey_runs (
           run_id, source_generation, target_generation, from_versions, to_versions,
           source_high_water, phase, plan_hash, status, created_at, updated_at
         ) VALUES (?, 'gen-1', 'gen-2', '["v1"]', '["v2"]', 'hw-1', 'plan', 'plan-hash', ?, 1, 1)`,
        [runId, status],
      )
    }
    insertRun('run-1', 'planned')
    expect(() => insertRun('run-2', 'running')).toThrow()
    expect(() => insertRun('run-3', 'paused')).toThrow()

    db.run(`UPDATE analytics_rekey_runs SET status = 'completed' WHERE run_id = 'run-1'`)
    insertRun('run-2', 'planned')

    expect(() =>
      db.run(
        `INSERT INTO analytics_rekey_runs (
           run_id, source_generation, target_generation, from_versions, to_versions,
           source_high_water, phase, plan_hash, status, created_at, updated_at
         ) VALUES ('run-bad', 'gen-1', 'gen-2', '[]', '[]', 'hw', 'plan', 'h', 'exploded', 1, 1)`,
      ),
    ).toThrow()
  })

  test('rekey runs reject equal source and target generations and keep swap fields nullable until swap', () => {
    expect(() =>
      db.run(
        `INSERT INTO analytics_rekey_runs (
           run_id, source_generation, target_generation, from_versions, to_versions,
           source_high_water, phase, plan_hash, status, created_at, updated_at
         ) VALUES ('run-eq', 'gen-1', 'gen-1', '["v1"]', '["v1"]', 'hw', 'plan', 'h', 'planned', 1, 1)`,
      ),
    ).toThrow()
    db.run(
      `INSERT INTO analytics_rekey_runs (
         run_id, source_generation, target_generation, from_versions, to_versions,
         source_high_water, phase, plan_hash, status, created_at, updated_at
       ) VALUES ('run-ok', 'gen-1', 'gen-2', '["v1"]', '["v2"]', 'hw', 'plan', 'h', 'planned', 1, 1)`,
    )
    const row = db
      .query<
        {
          swap_completed_at_ms: number | null
          retire_not_before_ms: number | null
        },
        []
      >(`SELECT swap_completed_at_ms, retire_not_before_ms FROM analytics_rekey_runs WHERE run_id = 'run-ok'`)
      .get()
    expect(row?.swap_completed_at_ms).toBeNull()
    expect(row?.retire_not_before_ms).toBeNull()
  })

  test('rekey mappings cover the complete domain registry and reject unknown domains', () => {
    db.run(
      `INSERT INTO analytics_rekey_runs (
         run_id, source_generation, target_generation, from_versions, to_versions,
         source_high_water, phase, plan_hash, status, created_at, updated_at
       ) VALUES ('run-1', 'gen-1', 'gen-2', '["v1"]', '["v2"]', 'hw', 'plan', 'h', 'planned', 1, 1)`,
    )
    const insertMapping = (domain: string): void => {
      db.run(
        `INSERT INTO analytics_rekey_mappings (run_id, domain, old_key_hash, mapping_ciphertext, mapping_hash, state)
         VALUES ('run-1', ?, ?, 'ct', 'mh', 'mapped')`,
        [domain, `hash-${domain}`],
      )
    }
    for (const domain of [
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
    ]) {
      insertMapping(domain)
    }
    expect(() => insertMapping('native-user-id:v1')).toThrow()
  })

  test('snapshot publications are generation-bearing with one staged and one published row at most', () => {
    expect(() =>
      db.run(
        `INSERT INTO analytics_snapshot_publications (snapshot_id, path_hash, source_high_water, state)
         VALUES ('snap-null', 'ph', 'hw', 'staged')`,
      ),
    ).toThrow()

    const insertPublication = (snapshotId: string, state: string, generation: string): void => {
      db.run(
        `INSERT INTO analytics_snapshot_publications (
           snapshot_id, storage_generation, path_hash, source_high_water, state
         ) VALUES (?, ?, 'ph', 'hw', ?)`,
        [snapshotId, generation, state],
      )
    }
    insertPublication('snap-staged', 'staged', 'gen-1')
    expect(() => insertPublication('snap-staged-2', 'staged', 'gen-1')).toThrow()

    insertPublication('snap-published', 'published', 'gen-1')
    expect(() => insertPublication('snap-published-2', 'published', 'gen-1')).toThrow()

    insertPublication('snap-old', 'invalidated', 'gen-0')
    insertPublication('snap-old-2', 'invalidated', 'gen-0')

    expect(() => insertPublication('snap-bad', 'serving', 'gen-1')).toThrow()
  })

  test('preference, audit, and governance tables are unreachable through the canonical analytics schema exports', () => {
    const exported = Object.keys(analyticsSchema)
    for (const name of GOVERNANCE_EXPORT_NAMES) {
      expect(exported).not.toContain(name)
    }
  })
})
