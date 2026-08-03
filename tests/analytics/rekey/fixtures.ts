// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { sealDeletionTargetsIn } from '../../../src/analytics/governance/deletion-target-store.js'
import type { getTestDb } from '../../utils/test-helpers.js'

export type FixtureDb = ReturnType<typeof getTestDb>

export const NOW = 1700000000000
export const SOURCE_GEN = 'gen-1'
export const TARGET_GEN = 'gen-2'
export const RETIRED_GEN = 'gen-0'

export const GOV_KEY_V1 = Buffer.alloc(32, 7)
export const GOV_KEY_V2 = Buffer.alloc(32, 9)
export const ANALYTICS_KEY_V1 = Buffer.alloc(32, 5)
export const ANALYTICS_KEY_V2 = Buffer.alloc(32, 11)

const insertEvent = (
  db: FixtureDb,
  input: Readonly<{
    eventId: string
    generation: string
    sourceRefKey: string
    eventName: string
    occurredAtMs: number
    keyVersion?: string
    actorKey?: string | null
    contextKey?: string | null
    threadKey?: string | null
    conversationKey?: string | null
    turnKey?: string | null
    sessionKey?: string | null
    taskInstanceKey?: string | null
    deploymentKey?: string
    platformInstanceKey?: string
    propsJson?: string
    expiresAtMs?: number
  }>,
): void => {
  db.$client.run(
    `INSERT INTO analytics_events (
       event_id, storage_generation, process_epoch_id, source_ref_key, source_kind,
       schema_version, event_name, event_version, occurred_at_ms, ingested_at_ms, source,
       attribution_quality, app_version, deployment_key, key_version, platform,
       platform_instance_key, actor_key, context_key, thread_key, conversation_key,
       task_instance_key, context_type, actor_role, task_provider, invocation_mode,
       turn_key, session_key, policy_version, eligibility, max_class, props_json, expires_at_ms
     ) VALUES (?, ?, 'epoch-1', ?, 'live', 1, ?, 1, ?, ?, 'live', 'native', '6.10.0', ?, ?, 'telegram',
               ?, ?, ?, ?, ?, ?, 'dm', 'admin', 'none', 'normal', ?, ?, 1, 'allowed', 'C0', ?, ?)`,
    [
      input.eventId,
      input.generation,
      input.sourceRefKey,
      input.eventName,
      input.occurredAtMs,
      input.occurredAtMs + 1,
      input.deploymentKey ?? 'v1.p-deploy',
      input.keyVersion ?? 'v1',
      input.platformInstanceKey ?? 'v1.p-platform',
      input.actorKey ?? null,
      input.contextKey ?? null,
      input.threadKey ?? null,
      input.conversationKey ?? null,
      input.taskInstanceKey ?? null,
      input.turnKey ?? null,
      input.sessionKey ?? null,
      input.propsJson ?? '{}',
      input.expiresAtMs ?? input.occurredAtMs + 90 * 86_400_000,
    ],
  )
}

export const insertFixtureEvent = insertEvent

/**
 * Seeds the full rekey fixture graph: an active generation (gen-1) with every
 * key domain, sessions/materializations, intent/abandonment state, backfill
 * maps, preferences, collection refs/event associations, delivery
 * grants/rows/receipts, encrypted deletion targets, and deletion/retention
 * state, plus a retired generation (gen-0) row.
 */
export const seedRekeySourceGraph = (db: FixtureDb): void => {
  db.$client.run(`INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 0)`)

  insertEvent(db, {
    eventId: 'ev-1',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-1',
    eventName: 'llm_completed',
    occurredAtMs: NOW,
    actorKey: 'v1.p-actor',
    contextKey: 'v1.p-context',
    threadKey: 'v1.p-thread',
    conversationKey: 'v1.p-conversation',
    turnKey: 'v1.p-turn',
    sessionKey: 'v1.p-session',
    taskInstanceKey: 'v1.p-task',
    propsJson: JSON.stringify({ attempt_key: 'v1.p-attempt', model_key: 'v1.p-model' }),
  })
  insertEvent(db, {
    eventId: 'ev-2',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-2',
    eventName: 'tool_completed',
    occurredAtMs: NOW + 1000,
    actorKey: 'v1.p-actor',
    contextKey: 'v1.p-context',
    conversationKey: 'v1.p-conversation',
    turnKey: 'v1.p-turn',
    sessionKey: 'v1.p-session',
    propsJson: JSON.stringify({ tool_key: 'v1.p-tool' }),
  })
  insertEvent(db, {
    eventId: 'ev-extra',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-extra',
    eventName: 'chat_message_accepted',
    occurredAtMs: NOW + 2000,
    actorKey: 'v1.p-actor',
    contextKey: 'v1.p-context',
    threadKey: 'v1.p-thread-2',
    conversationKey: 'v1.p-conversation',
  })
  insertEvent(db, {
    eventId: 'ev-retired',
    generation: RETIRED_GEN,
    sourceRefKey: 'src-retired',
    eventName: 'llm_completed',
    occurredAtMs: NOW - 10_000,
    keyVersion: 'v1',
    actorKey: 'v1.p-legacy-actor',
    conversationKey: 'v1.p-legacy-conversation',
  })

  db.$client.run(
    `INSERT INTO analytics_collection_eligibility (ref_key, key_version, state, generation, policy_version, effective_at)
     VALUES ('v1.p-colref', 'v1', 'allow', 1, 1, 0)`,
  )
  db.$client.run(
    `INSERT INTO analytics_event_collection_refs (event_id, ref_key, key_version, generation, created_at)
     VALUES ('ev-1', 'v1.p-colref', 'v1', 1, 0), ('ev-2', 'v1.p-colref', 'v1', 1, 0), ('ev-extra', 'v1.p-colref', 'v1', 1, 0)`,
  )

  db.$client.run(
    `INSERT INTO analytics_sessions (
       session_key, storage_generation, actor_key, conversation_key, start_ms, end_ms,
       duration_ms, activity_count, turn_count, first_event_id, last_event_id, sessionization_version
     ) VALUES ('v1.p-session', 'gen-1', 'v1.p-actor', 'v1.p-conversation', ?, ?, 2000, 2, 1, 'ev-1', 'ev-2', 1)`,
    [NOW, NOW + 2000],
  )
  db.$client.run(
    `INSERT INTO analytics_session_events (session_key, event_id, occurred_at_ms, extends_session, sessionization_version)
     VALUES ('v1.p-session', 'ev-1', ?, 0, 1), ('v1.p-session', 'ev-2', ?, 1, 1)`,
    [NOW, NOW + 1000],
  )
  db.$client.run(
    `INSERT INTO analytics_goal_attempts (
       attempt_key, storage_generation, turn_key, goal, actor_key, conversation_key,
       start_ms, mature_at_ms, outcome, resolved_at_ms, anchor_event_id, outcome_version
     ) VALUES ('v1.p-goal-attempt', 'gen-1', 'v1.p-turn', 'task_done', 'v1.p-actor', 'v1.p-conversation',
               ?, ?, 'immediate_success', ?, 'ev-1', 1)`,
    [NOW, NOW + 5000, NOW + 500],
  )
  db.$client.run(
    `INSERT INTO analytics_turn_friction (
       turn_key, storage_generation, actor_key, conversation_key, occurred_at_ms,
       rephrase, clarification_abandoned, permission_issue, stop, long_turn, disclosure_fallback,
       failure_chain, component_count, display_score, anchor_event_id, friction_version
     ) VALUES ('v1.p-turn', 'gen-1', 'v1.p-actor', 'v1.p-conversation', ?, 0, 1, 0, 0, 0, 0, 0, 1, 10, 'ev-1', 1)`,
    [NOW],
  )
  db.$client.run(
    `INSERT INTO analytics_feature_opportunity_days (
       actor_key, feature, utc_day, storage_generation, available, reason, opportunity_event_id, definition_version
     ) VALUES ('v1.p-actor', 'feature-x', '2023-11-14', 'gen-1', 1, 'eligible', 'ev-2', 1)`,
  )
  db.$client.run(
    `INSERT INTO analytics_feature_use_days (
       actor_key, feature, utc_day, storage_generation, success_count, failure_count, blocked_count,
       joined_available, adopted, first_use_event_id, definition_version
     ) VALUES ('v1.p-actor', 'feature-x', '2023-11-14', 'gen-1', 1, 0, 0, 1, 1, 'ev-2', 1)`,
  )
  db.$client.run(
    `INSERT INTO analytics_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
     VALUES ('v1.p-actor', 'withdrawal', ?, NULL, 1)`,
    [NOW + 3000],
  )

  db.$client.run(
    `INSERT INTO analytics_backfill_runs (run_id, source_table, high_water_row_key, policy_cutoff_ms, status, started_at_ms)
     VALUES ('bf-1', 'llm_usage_events', 'row-2', 0, 'completed', 0)`,
  )
  db.$client.run(
    `INSERT INTO analytics_backfill_event_map (run_id, event_id, source_ref_key) VALUES ('bf-1', 'ev-2', 'src-2')`,
  )

  db.$client.run(
    `INSERT INTO analytics_preferences (
       governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
       policy_version, source, effective_at, updated_at
     ) VALUES ('v1.p-gov-actor', 'v1', 'allow', 'allow', 1, 'settings', 0, 0)`,
  )
  db.$client.run(
    `INSERT INTO analytics_eligibility_grants (grant_key, key_version, state, generation, policy_version, effective_at)
     VALUES ('v1.p-grant', 'v1', 'allow', 1, 1, 0)`,
  )

  db.$client.run(
    `INSERT INTO analytics_sinks (
       sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
       egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
     ) VALUES ('sink-1', 'sink', 1, 'webhook', 'enabled', 1, 'pseudonymous', 'ec', 'sc', 'fp', 0)`,
  )
  db.$client.run(
    `INSERT INTO analytics_deliveries (
       event_id, sink_version_id, grant_key, grant_key_version, grant_generation, state,
       attempts, next_attempt_at_ms, delivered_at_ms, remote_receipt_hash, payload_schema_version
     ) VALUES ('ev-1', 'sink-1', 'v1.p-grant', 'v1', 1, 'delivered', 1, 0, ?, 'rh-1', 1)`,
    [NOW + 500],
  )
  db.$client.run(
    `INSERT INTO analytics_deliveries (
       event_id, sink_version_id, grant_key, grant_key_version, grant_generation, state,
       attempts, next_attempt_at_ms, payload_schema_version
     ) VALUES ('ev-2', 'sink-1', 'v1.p-grant', 'v1', 1, 'pending', 0, 0, 1)`,
  )

  db.$client.run(
    `INSERT INTO analytics_deletion_requests (request_id, governance_actor_key, key_version, state, policy_version, requested_at_ms)
     VALUES ('del-1', 'v1.p-gov-actor', 'v1', 'requested', 1, 0)`,
  )
  db.transaction((tx) => {
    sealDeletionTargetsIn(tx, {
      requestId: 'del-1',
      encryptionKey: GOV_KEY_V1,
      nowMs: 0,
      targets: {
        analyticsActorKeys: ['v1.p-actor'],
        governanceActorKeys: ['v1.p-gov-actor'],
        collectionRefKeys: ['v1.p-colref'],
        grantKeys: ['v1.p-grant'],
      },
    })
  })
  db.$client.run(
    `INSERT INTO analytics_delivery_deletion_receipts (
       deletion_request_id, sink_version_id, state, remote_receipt_hash, requested_at_ms
     ) VALUES ('del-1', 'sink-1', 'reconciled', 'rrh-1', 0)`,
  )
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex')

export const countRows = (db: FixtureDb, sql: string, params: (string | number)[] = []): number => {
  const row = db.$client.query<{ n: number }, (string | number)[]>(sql).get(...params)
  return row?.n ?? 0
}
