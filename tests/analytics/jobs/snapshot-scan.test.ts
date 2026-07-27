// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { copyCuratedRows } from '../../../src/analytics/jobs/snapshot-copy.js'
import {
  collectSnapshotCanaries,
  scanSnapshotOutput,
  SnapshotCanaryError,
} from '../../../src/analytics/jobs/snapshot-scan.js'
import { createSnapshotSchema } from '../../../src/analytics/jobs/snapshot-schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { insertFixtureEvent, NOW, SOURCE_GEN } from '../rekey/fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const CANARIES = {
  props: 'CANARY-props-0123456789abcdef',
  preference: 'CANARY-preference-0123456789',
  grant: 'CANARY-grant-0123456789abcdef',
  deliverySecret: 'CANARY-delivery-secret-0123',
  usage: 'CANARY-usage-native-user-0123',
  conversation: 'CANARY-conversation-content-01',
  memory: 'CANARY-memory-summary-0123456',
  systemConfig: 'CANARY-system-config-01234567',
  settingsAuth: 'CANARY-settings-auth-01234567',
} as const

const seedCanaries = (db: Db): void => {
  db.$client.run(`INSERT INTO analytics_process_epochs (epoch_id, state, started_at_ms) VALUES ('epoch-1', 'open', 0)`)
  insertFixtureEvent(db, {
    eventId: 'ev-canary',
    generation: SOURCE_GEN,
    sourceRefKey: 'src-canary',
    eventName: 'tool_completed',
    occurredAtMs: NOW,
    actorKey: 'v1.p-actor',
    conversationKey: 'v1.p-conversation',
    propsJson: JSON.stringify({ execution_outcome: 'semantic_success', payload: CANARIES.props }),
  })
  db.$client.run(
    `INSERT INTO analytics_preferences (
       governance_actor_key, key_version, local_longitudinal, external_pseudonymous,
       policy_version, source, effective_at, updated_at
     ) VALUES (?, 'v1', 'allow', 'allow', 1, 'settings', 0, 0)`,
    [CANARIES.preference],
  )
  db.$client.run(
    `INSERT INTO analytics_eligibility_grants (grant_key, key_version, state, generation, policy_version, effective_at)
     VALUES (?, 'v1', 'allow', 1, 1, 0)`,
    [CANARIES.grant],
  )
  db.$client.run(
    `INSERT INTO analytics_sinks (
       sink_version_id, logical_sink_id, version, kind, state, payload_schema_version,
       egress_mode, endpoint_ciphertext, secret_ciphertext, config_fingerprint, created_at_ms
     ) VALUES ('sink-1', 'sink', 1, 'webhook', 'enabled', 1, 'pseudonymous', 'endpoint-ciphertext', ?, 'fp', 0)`,
    [CANARIES.deliverySecret],
  )
  db.$client.run(
    `INSERT INTO llm_usage_events (
       event_id, occurred_at, storage_context_id, context_type, chat_user_id, model, model_role, duration_ms
     ) VALUES ('usage-1', ?, 'ctx', 'dm', ?, 'model', 'main', 5)`,
    [NOW, CANARIES.usage],
  )
  db.$client.run(`INSERT INTO conversation_history (user_id, messages) VALUES ('u1', ?)`, [CANARIES.conversation])
  db.$client.run(`INSERT INTO memory_summary (user_id, summary, updated_at) VALUES ('u1', ?, 'now')`, [CANARIES.memory])
  db.$client.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES ('k', ?, 0, 'test')`, [
    CANARIES.systemConfig,
  ])
  db.$client.run(
    `INSERT INTO settings_auth_codes (code_hash, platform_instance_id, platform_user_id, created_at, expires_at)
     VALUES (?, 'pi', 'pu', 0, 1)`,
    [CANARIES.settingsAuth],
  )
}

const buildOutput = (source: Db): Database => {
  const publishDb = new Database(':memory:')
  createSnapshotSchema(publishDb, 'pseudonymous')
  copyCuratedRows(source, publishDb, { generation: SOURCE_GEN, nowMs: NOW + 5000, mode: 'pseudonymous' })
  return publishDb
}

describe('snapshot canary scan', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedCanaries(db)
  })

  test('collects raw-table canaries from every sensitive source', () => {
    const canaries = collectSnapshotCanaries(db)
    for (const value of Object.values(CANARIES)) {
      expect(canaries).toContain(value)
    }
  })

  test('a curated output passes the byte/schema/freelist scan with zero matches', () => {
    const publishDb = buildOutput(db)
    const result = scanSnapshotOutput(publishDb, collectSnapshotCanaries(db))
    expect(result.violations).toBe(0)
    expect(result.canariesChecked).toBeGreaterThanOrEqual(Object.keys(CANARIES).length)
    publishDb.close()
  })

  test('a canary leaked into any output page fails the scan', () => {
    const publishDb = buildOutput(db)
    publishDb.run(`UPDATE curated_events SET actor_key = '${CANARIES.props}' WHERE event_id = 'ev-canary'`)
    expect(() => scanSnapshotOutput(publishDb, collectSnapshotCanaries(db))).toThrow(SnapshotCanaryError)
    publishDb.close()
  })

  test('a non-allowlisted table in the output schema fails the scan', () => {
    const publishDb = buildOutput(db)
    publishDb.run(`CREATE TABLE analytics_preferences (leak TEXT)`)
    expect(() => scanSnapshotOutput(publishDb, collectSnapshotCanaries(db))).toThrow(SnapshotCanaryError)
    publishDb.close()
  })

  test('a freelist page (dropped content) fails the scan', () => {
    const publishDb = buildOutput(db)
    publishDb.run(`CREATE TABLE scratch (pad TEXT)`)
    publishDb.run(`INSERT INTO scratch VALUES ('${CANARIES.props}')`)
    publishDb.run(`DROP TABLE scratch`)
    const freelist = publishDb.query<{ freelist_count: number }, []>(`PRAGMA freelist_count`).get()
    expect(freelist?.freelist_count).toBeGreaterThan(0)
    expect(() => scanSnapshotOutput(publishDb, collectSnapshotCanaries(db))).toThrow(SnapshotCanaryError)
    publishDb.close()
  })
})
