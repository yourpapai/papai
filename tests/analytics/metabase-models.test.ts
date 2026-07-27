// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createSnapshotSchema, SNAPSHOT_MODEL_VERSIONS } from '../../src/analytics/jobs/snapshot-schema.js'

const DAY = 86_400_000
const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0)
const NOW = T0 + 40 * DAY

const SQL_DIR = join(import.meta.dir, '../../analytics/metabase/sql')

const runModel = (db: Database, file: string): readonly Record<string, unknown>[] => {
  const sql = readFileSync(join(SQL_DIR, file), 'utf8')
  const rows: unknown[] = db.prepare(sql).all()
  return rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
}

const insertMeta = (db: Database, mode: 'pseudonymous' | 'aggregate_only' = 'pseudonymous'): void => {
  db.prepare(
    `INSERT INTO snapshot_meta (
       singleton_id, snapshot_id, created_at_ms, storage_generation, source_high_water,
       source_row_count, curated_row_counts_json, model_versions_json, reconciliation_status, snapshot_mode
     ) VALUES (1, 'snap-fixture', ?, 'gen-1', '1:1', 1, '{}', ?, 'reconciled', ?)`,
  ).run(NOW, JSON.stringify(SNAPSHOT_MODEL_VERSIONS), mode)
}

type EventInput = Readonly<{
  eventId: string
  eventName: string
  occurredAtMs: number
  actorKey?: string | null
  turnKey?: string | null
  sessionKey?: string | null
  conversationKey?: string | null
  taskInstanceKey?: string | null
  platform?: string
  contextType?: string
  actorRole?: string
  taskProvider?: string
  appVersion?: string
  invocationMode?: string
  eligibility?: string
  props?: Readonly<Record<string, string | number | boolean | readonly string[]>>
}>

const PROP_COLUMN_BY_KEY: Readonly<Record<string, string>> = {
  outcome: 'prop_outcome',
  result: 'prop_result',
  entry: 'prop_entry',
  change: 'prop_change',
  to_provider: 'prop_to_provider',
  domain: 'prop_domain',
  risk: 'prop_risk',
  execution_outcome: 'prop_execution_outcome',
  recovered_same_turn: 'prop_recovered_same_turn',
  tool_slug: 'prop_tool_slug',
  primary: 'prop_primary_intent',
  strategy: 'prop_strategy',
  confidence: 'prop_confidence',
  goals: 'prop_goals_json',
  abstained: 'prop_abstained',
  feature: 'prop_feature',
  available: 'prop_available',
  reason: 'prop_reason',
  duration_ms: 'prop_duration_ms',
  queue_wait_ms: 'prop_queue_wait_ms',
  latency_ms: 'prop_latency_ms',
  kind: 'prop_kind',
  capability_supported: 'prop_capability_supported',
  setting_enabled: 'prop_setting_enabled',
  time_to_first_token_ms: 'prop_time_to_first_token_ms',
  model_role: 'prop_model_role',
  error_class: 'prop_error_class',
  delivery: 'prop_delivery',
  decision: 'prop_decision',
  decision_latency_ms: 'prop_decision_latency_ms',
  provider: 'prop_provider',
  status_class: 'prop_status_class',
  stage: 'prop_stage',
  latency_from_turn_start_ms: 'prop_latency_from_turn_start_ms',
  eligible: 'prop_eligible',
  clarification: 'prop_clarification',
}

const insertEvent = (db: Database, input: EventInput): void => {
  const typed: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(input.props ?? {})) {
    const column = PROP_COLUMN_BY_KEY[key]
    if (column === undefined) continue
    if (typeof value === 'string') typed[column] = value
    else if (typeof value === 'number') typed[column] = value
    else if (typeof value === 'boolean') typed[column] = value ? 1 : 0
    else typed[column] = JSON.stringify(value)
  }
  const base: Record<string, string | number | null> = {
    event_id: input.eventId,
    event_name: input.eventName,
    occurred_at_ms: input.occurredAtMs,
    utc_day: new Date(input.occurredAtMs).toISOString().slice(0, 10),
    platform: input.platform ?? 'telegram',
    platform_instance_key: 'v1.p-platform',
    context_type: input.contextType ?? 'dm',
    actor_role: input.actorRole ?? 'admin',
    task_provider: input.taskProvider ?? 'none',
    app_version: input.appVersion ?? '6.10.0',
    invocation_mode: input.invocationMode ?? 'normal',
    eligibility: input.eligibility ?? 'allowed',
    actor_key: input.actorKey ?? null,
    context_key: null,
    thread_key: null,
    conversation_key: input.conversationKey ?? null,
    task_instance_key: input.taskInstanceKey ?? null,
    turn_key: input.turnKey ?? null,
    session_key: input.sessionKey ?? null,
  }
  const row = { ...base, ...typed }
  const columns = Object.keys(row)
  db.prepare(`INSERT INTO curated_events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
    ...columns.map((column) => row[column] ?? null),
  )
}

const insertAuthorizedDm = (
  db: Database,
  actor: string,
  atMs: number,
  input: { authorized?: boolean; eligibility?: string; eventSuffix?: string } = {},
): void => {
  const suffix = input.eventSuffix ?? 'dm'
  insertEvent(db, {
    eventId: `${actor}-${suffix}-${atMs}`,
    eventName: 'chat_message_accepted',
    occurredAtMs: atMs,
    actorKey: actor,
    turnKey: `${actor}-turn-${atMs}`,
    eligibility: input.eligibility ?? 'allowed',
  })
  if (input.authorized !== false) {
    insertEvent(db, {
      eventId: `${actor}-auth-${atMs}`,
      eventName: 'auth_checked',
      occurredAtMs: atMs,
      actorKey: actor,
      turnKey: `${actor}-turn-${atMs}`,
      props: { outcome: 'granted' },
    })
  }
}

const insertFunnelStep = (
  db: Database,
  actor: string,
  eventName: string,
  atMs: number,
  props: Readonly<Record<string, string | number>> = {},
): void => {
  insertEvent(db, {
    eventId: `${actor}-${eventName}-${atMs}`,
    eventName,
    occurredAtMs: atMs,
    actorKey: actor,
    props,
  })
}

const HONESTY_COLUMNS = [
  'metric_version',
  'window_start_utc',
  'window_end_utc',
  'numerator',
  'denominator',
  'unknown_count',
  'censored_count',
  'eligibility_coverage',
  'wilson_low',
  'wilson_high',
  'suppressed',
  'snapshot_created_at_ms',
  'reconciliation_status',
] as const

describe('metabase model: activation', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    createSnapshotSchema(db, 'pseudonymous')
    insertMeta(db)
    // A1: full funnel, activation in 120h
    insertAuthorizedDm(db, 'a1', T0)
    insertFunnelStep(db, 'a1', 'config_link_issued', T0 + DAY, { result: 'issued' })
    insertFunnelStep(db, 'a1', 'settings_opened', T0 + 2 * DAY, { entry: 'config_link', result: 'success' })
    insertEvent(db, {
      eventId: 'a1-assign-key',
      eventName: 'task_instance_assigned',
      occurredAtMs: T0 + 3 * DAY,
      actorKey: 'a1',
      taskInstanceKey: 'task-a1',
      taskProvider: 'kaneo',
      props: { change: 'first_assignment', to_provider: 'kaneo' },
    })
    insertEvent(db, {
      eventId: 'a1-success',
      eventName: 'tool_completed',
      occurredAtMs: T0 + 5 * DAY,
      actorKey: 'a1',
      taskInstanceKey: 'task-a1',
      taskProvider: 'kaneo',
      props: { domain: 'task', risk: 'write', execution_outcome: 'semantic_success' },
    })
    // A8: full funnel, activation in 48h
    insertAuthorizedDm(db, 'a8', T0)
    insertFunnelStep(db, 'a8', 'config_link_issued', T0 + 12 * HOUR, { result: 'issued' })
    insertFunnelStep(db, 'a8', 'settings_opened', T0 + DAY, { entry: 'config_link', result: 'success' })
    insertEvent(db, {
      eventId: 'a8-assign',
      eventName: 'task_instance_assigned',
      occurredAtMs: T0 + 36 * HOUR,
      actorKey: 'a8',
      taskInstanceKey: 'task-a8',
      taskProvider: 'kaneo',
      props: { change: 'first_assignment', to_provider: 'kaneo' },
    })
    insertEvent(db, {
      eventId: 'a8-success',
      eventName: 'tool_completed',
      occurredAtMs: T0 + 2 * DAY,
      actorKey: 'a8',
      taskInstanceKey: 'task-a8',
      taskProvider: 'kaneo',
      props: { domain: 'task', risk: 'write', execution_outcome: 'semantic_success' },
    })
    // A9: full funnel, activation in 240h
    insertAuthorizedDm(db, 'a9', T0)
    insertFunnelStep(db, 'a9', 'config_link_issued', T0 + DAY, { result: 'issued' })
    insertFunnelStep(db, 'a9', 'settings_opened', T0 + 2 * DAY, { entry: 'config_link', result: 'success' })
    insertEvent(db, {
      eventId: 'a9-assign',
      eventName: 'task_instance_assigned',
      occurredAtMs: T0 + 4 * DAY,
      actorKey: 'a9',
      taskInstanceKey: 'task-a9',
      taskProvider: 'kaneo',
      props: { change: 'first_assignment', to_provider: 'kaneo' },
    })
    insertEvent(db, {
      eventId: 'a9-success',
      eventName: 'tool_completed',
      occurredAtMs: T0 + 10 * DAY,
      actorKey: 'a9',
      taskInstanceKey: 'task-a9',
      taskProvider: 'kaneo',
      props: { domain: 'task', risk: 'write', execution_outcome: 'semantic_success' },
    })
    // A2: link then nothing (dropoff before_settings_opened)
    insertAuthorizedDm(db, 'a2', T0)
    insertFunnelStep(db, 'a2', 'config_link_issued', T0 + 2 * DAY, { result: 'issued' })
    // A4: command-only /config (link issued, settings never opened)
    insertAuthorizedDm(db, 'a4', T0)
    insertFunnelStep(db, 'a4', 'config_link_issued', T0 + DAY, { result: 'issued' })
    // A3: link outside the 7-day window (before_config_link)
    insertAuthorizedDm(db, 'a3', T0)
    insertFunnelStep(db, 'a3', 'config_link_issued', T0 + 8 * DAY, { result: 'issued' })
    // A5: mutating success outside the 14-day window
    insertAuthorizedDm(db, 'a5', T0)
    insertFunnelStep(db, 'a5', 'config_link_issued', T0 + DAY, { result: 'issued' })
    insertFunnelStep(db, 'a5', 'settings_opened', T0 + 2 * DAY, { entry: 'config_link', result: 'success' })
    insertEvent(db, {
      eventId: 'a5-assign',
      eventName: 'task_instance_assigned',
      occurredAtMs: T0 + 3 * DAY,
      actorKey: 'a5',
      taskInstanceKey: 'task-a5',
      taskProvider: 'kaneo',
      props: { change: 'first_assignment', to_provider: 'kaneo' },
    })
    insertEvent(db, {
      eventId: 'a5-success',
      eventName: 'tool_completed',
      occurredAtMs: T0 + 16 * DAY,
      actorKey: 'a5',
      taskInstanceKey: 'task-a5',
      taskProvider: 'kaneo',
      props: { domain: 'task', risk: 'write', execution_outcome: 'semantic_success' },
    })
    // A7: unauthorized DM before the first authorized DM
    insertAuthorizedDm(db, 'a7', T0 - DAY, { authorized: false })
    insertAuthorizedDm(db, 'a7', T0)
    insertFunnelStep(db, 'a7', 'config_link_issued', T0 + DAY, { result: 'issued' })
    // A6: recent actor whose 7-day windows are censored
    insertAuthorizedDm(db, 'a6', NOW - DAY)
    // A10: never authorized (coverage denominator only)
    insertAuthorizedDm(db, 'a10', T0, { authorized: false })
  })

  test('activation funnel: first authorized DM, windows, exact denominators, p50/p90, coverage', () => {
    const rows = runModel(db, '01-activation.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
      expect(row['snapshot_created_at_ms']).toBe(NOW)
      expect(row['reconciliation_status']).toBe('reconciled')
      expect(row['metric_version']).toBe(1)
    }
    const actorRows = rows.filter((row) => row['row_kind'] === 'actor')
    const byActor = new Map(actorRows.map((row) => [String(row['actor_key']), row]))
    expect(byActor.get('a7')?.['first_dm_at']).toBe(T0)
    expect(byActor.get('a7')?.['reached_config_link']).toBe(1)
    expect(byActor.get('a1')?.['activation_completed']).toBe(1)
    expect(byActor.get('a1')?.['hours_to_activation']).toBe(120)
    expect(byActor.get('a2')?.['dropoff_step']).toBe('before_settings_opened')
    expect(byActor.get('a4')?.['reached_config_link']).toBe(1)
    expect(byActor.get('a4')?.['reached_settings_opened']).toBe(0)
    expect(byActor.get('a4')?.['dropoff_step']).toBe('before_settings_opened')
    expect(byActor.get('a3')?.['reached_config_link']).toBe(0)
    expect(byActor.get('a3')?.['dropoff_step']).toBe('before_config_link')
    expect(byActor.get('a5')?.['reached_task_assignment']).toBe(1)
    expect(byActor.get('a5')?.['activation_completed']).toBe(0)
    expect(byActor.get('a5')?.['dropoff_step']).toBe('before_first_mutating_success')
    expect(byActor.has('a10')).toBe(false)

    const rateRows = rows.filter((row) => row['row_kind'] === 'cohort_rate')
    const cohort = rateRows.filter((row) => row['cohort_date'] === '2026-01-01')
    const rateBy = new Map(cohort.map((row) => [String(row['step']), row]))
    expect(rateBy.get('first_dm')?.['denominator']).toBe(8)
    expect(rateBy.get('config_link')?.['numerator']).toBe(7)
    expect(rateBy.get('config_link')?.['denominator']).toBe(8)
    expect(rateBy.get('settings_opened')?.['numerator']).toBe(4)
    expect(rateBy.get('settings_opened')?.['denominator']).toBe(7)
    expect(rateBy.get('task_assignment')?.['numerator']).toBe(4)
    expect(rateBy.get('task_assignment')?.['denominator']).toBe(4)
    expect(rateBy.get('first_mutating_success')?.['numerator']).toBe(3)
    expect(rateBy.get('first_mutating_success')?.['denominator']).toBe(4)
    expect(rateBy.get('activation')?.['numerator']).toBe(3)
    expect(rateBy.get('activation')?.['denominator']).toBe(8)
    for (const row of cohort) {
      expect(row['suppressed']).toBe(1)
      expect(row['rate']).toBeNull()
      expect(row['eligibility_coverage']).toBeCloseTo(8 / 9, 4)
    }
    const recentCohort = rateRows.filter((row) => row['cohort_date'] !== '2026-01-01')
    expect(recentCohort.length).toBeGreaterThan(0)
    expect(recentCohort.find((row) => row['step'] === 'config_link')?.['censored_count']).toBe(1)

    const durationRows = rows.filter((row) => row['row_kind'] === 'cohort_duration')
    const duration = durationRows.find((row) => row['cohort_date'] === '2026-01-01')
    expect(duration?.['p50_minutes_to_activation']).toBe(7200)
    expect(duration?.['p90_minutes_to_activation']).toBe(14400)
    expect(duration?.['denominator']).toBe(3)
  })

  test('activation rates at denominator 30 or above are unsuppressed with wilson bounds', () => {
    const wide = new Database(':memory:')
    createSnapshotSchema(wide, 'pseudonymous')
    insertMeta(wide)
    for (let i = 0; i < 40; i += 1) {
      insertAuthorizedDm(wide, `w${i}`, T0)
      insertFunnelStep(wide, `w${i}`, 'config_link_issued', T0 + DAY, { result: 'issued' })
    }
    const rows = runModel(wide, '01-activation.sql')
    const link = rows.filter((row) => row['row_kind'] === 'cohort_rate').find((row) => row['step'] === 'config_link')
    expect(link?.['denominator']).toBe(40)
    expect(link?.['numerator']).toBe(40)
    expect(link?.['suppressed']).toBe(0)
    expect(link?.['rate']).toBe(1)
    expect(Number(link?.['wilson_low'])).toBeGreaterThan(0.9)
    expect(Number(link?.['wilson_low'])).toBeLessThan(1)
    expect(link?.['wilson_high']).toBe(1)
    const firstDm = rows.filter((row) => row['row_kind'] === 'cohort_rate').find((row) => row['step'] === 'first_dm')
    expect(firstDm?.['denominator']).toBe(40)
    expect(firstDm?.['suppressed']).toBe(0)
    wide.close()
  })

  test('aggregate-only snapshots label activation unavailable instead of approximating', () => {
    const aggregateDb = new Database(':memory:')
    createSnapshotSchema(aggregateDb, 'aggregate_only')
    insertMeta(aggregateDb, 'aggregate_only')
    const rows = runModel(aggregateDb, '01-activation.sql')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['row_kind']).toBe('unavailable')
      expect(row['availability']).toBe('unavailable_aggregate_only_snapshot')
      expect(row['suppressed']).toBe(1)
    }
    aggregateDb.close()
  })
})

const insertOnboarded = (db: Database, actor: string, atMs: number, platform = 'telegram'): void => {
  insertEvent(db, {
    eventId: `${actor}-onboarded-${atMs}`,
    eventName: 'onboarding_completed',
    occurredAtMs: atMs,
    actorKey: actor,
    platform,
    props: { result: 'completed' },
  })
}

const insertMsg = (
  db: Database,
  actor: string,
  direction: 'received' | 'sent',
  atMs: number,
  platform = 'telegram',
): void => {
  insertEvent(db, {
    eventId: `${actor}-${direction}-${atMs}`,
    eventName: direction === 'received' ? 'message_received' : 'message_sent',
    occurredAtMs: atMs,
    actorKey: actor,
    platform,
  })
}

const insertSession = (
  db: Database,
  sessionKey: string,
  actor: string,
  startMs: number,
  durationMs: number,
  turnCount: number,
): void => {
  db.prepare(
    `INSERT INTO curated_sessions (
       session_key, actor_key, conversation_key, start_ms, end_ms, duration_ms,
       activity_count, turn_count, sessionization_version
     ) VALUES (?, ?, 'v1.c-conv', ?, ?, ?, ?, ?, 1)`,
  ).run(sessionKey, actor, startMs, startMs + durationMs, durationMs, turnCount + 1, turnCount)
}

describe('metabase model: retention and engagement', () => {
  test('UTC DAU/WAU/MAU, stickiness, and conversation session metrics', () => {
    const engagementDb = new Database(':memory:')
    createSnapshotSchema(engagementDb, 'pseudonymous')
    insertMeta(engagementDb)

    // Snapshot day is 2026-02-10 (NOW).
    insertMsg(engagementDb, 's1', 'received', NOW)
    insertMsg(engagementDb, 's1', 'received', NOW - 3 * DAY)
    insertMsg(engagementDb, 's1', 'received', NOW - 10 * DAY)
    insertMsg(engagementDb, 's2', 'sent', NOW - 2 * DAY)
    insertMsg(engagementDb, 's2', 'received', NOW - 25 * DAY)
    insertMsg(engagementDb, 's3', 'received', NOW - 35 * DAY)

    insertSession(engagementDb, 'sess-1', 's1', NOW - 3 * DAY, 60_000, 2)
    insertSession(engagementDb, 'sess-2', 's1', NOW - DAY, 120_000, 4)
    insertSession(engagementDb, 'sess-3', 's2', NOW - 2 * DAY, 0, 1)

    const rows = runModel(engagementDb, '02-retention-engagement.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
    }

    const utc = rows.filter((row) => row['row_kind'] === 'utc_engagement')
    const utcAt = (metric: string): Record<string, unknown> | undefined => utc.find((row) => row['metric'] === metric)
    expect(utcAt('dau')?.['numerator']).toBe(1)
    expect(utcAt('dau')?.['window_start_utc']).toBe('2026-02-10')
    expect(utcAt('dau')?.['window_end_utc']).toBe('2026-02-10')
    expect(utcAt('wau')?.['numerator']).toBe(2)
    expect(utcAt('wau')?.['window_start_utc']).toBe('2026-02-04')
    expect(utcAt('mau')?.['numerator']).toBe(2)
    expect(utcAt('mau')?.['window_start_utc']).toBe('2026-01-12')

    const stickiness = rows.find((row) => row['metric'] === 'stickiness')
    expect(stickiness?.['numerator']).toBe(1)
    expect(stickiness?.['denominator']).toBe(2)
    expect(stickiness?.['suppressed']).toBe(1)
    expect(stickiness?.['rate']).toBeNull()

    const sessions = rows.find((row) => row['metric'] === 'sessions_per_actor')
    expect(sessions?.['numerator']).toBe(3)
    expect(sessions?.['denominator']).toBe(2)
    expect(sessions?.['suppressed']).toBe(1)
    expect(sessions?.['rate']).toBeNull()

    const turns = rows.find((row) => row['metric'] === 'turns_per_session')
    expect(turns?.['numerator']).toBe(7)
    expect(turns?.['denominator']).toBe(3)

    const duration = rows.find((row) => row['row_kind'] === 'session_duration_seconds')
    expect(duration?.['numerator']).toBe(3)
    expect(duration?.['p50_seconds']).toBe(60)
    expect(duration?.['p75_seconds']).toBe(120)
    expect(duration?.['p90_seconds']).toBe(120)
    expect(duration?.['p95_seconds']).toBe(120)
    expect(duration?.['suppressed']).toBe(1)

    engagementDb.close()
  })

  test('exact returned-by horizons, censoring, weekly engagement, mix, tenure, pairing, latency', () => {
    const engagementDb = new Database(':memory:')
    createSnapshotSchema(engagementDb, 'pseudonymous')
    insertMeta(engagementDb)

    insertOnboarded(engagementDb, 'e1', T0 - 40 * DAY)
    insertMsg(engagementDb, 'e1', 'received', T0 - 40 * DAY)
    insertMsg(engagementDb, 'e1', 'received', T0 - 7 * DAY)
    insertMsg(engagementDb, 'e1', 'received', T0 - 2 * DAY)
    insertMsg(engagementDb, 'e1', 'received', T0)

    insertOnboarded(engagementDb, 'e2', T0 - 40 * DAY)
    insertMsg(engagementDb, 'e2', 'received', T0 - 40 * DAY)
    insertMsg(engagementDb, 'e2', 'received', T0 - 13 * DAY)

    insertOnboarded(engagementDb, 'e3', T0 - DAY)
    insertMsg(engagementDb, 'e3', 'received', T0 - DAY)
    insertMsg(engagementDb, 'e3', 'received', T0)
    insertMsg(engagementDb, 'e3', 'sent', T0)

    insertOnboarded(engagementDb, 'e4', T0 - 40 * DAY, 'mattermost')
    insertMsg(engagementDb, 'e4', 'received', T0 - 5 * DAY, 'mattermost')

    insertOnboarded(engagementDb, 'e5', T0 - 200 * DAY, 'discord')

    insertOnboarded(engagementDb, 'e6', T0 - 20 * DAY)
    insertMsg(engagementDb, 'e6', 'received', T0 - 9 * DAY)

    insertOnboarded(engagementDb, 'e7', T0 - DAY)
    insertMsg(engagementDb, 'e7', 'sent', T0 - DAY)
    insertMsg(engagementDb, 'e7', 'sent', T0 - 4 * 3_600_000)

    insertOnboarded(engagementDb, 'e8', T0 + 15 * DAY)
    insertMsg(engagementDb, 'e8', 'received', T0 + 15 * DAY)
    insertMsg(engagementDb, 'e8', 'received', T0 + 20 * DAY)
    insertMsg(engagementDb, 'e8', 'sent', T0 + 20 * DAY + 3_600_000)

    // E9: onboarded 40 days back, never returned, withdrew before the D30 horizon
    // (withdrawal before N is censoring, not churn).
    insertOnboarded(engagementDb, 'e9', T0 - 40 * DAY)
    engagementDb
      .prepare(
        `INSERT INTO curated_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
         VALUES ('e9', 'withdrawal', ?, NULL, 1)`,
      )
      .run(T0 - 20 * DAY)

    const rows = runModel(engagementDb, '02-retention-engagement.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
    }

    const retention = rows.filter((row) => row['row_kind'] === 'cohort_retention')
    const retentionAt = (week: string, metric: string): Record<string, unknown> | undefined =>
      retention.filter((row) => row['cohort_week'] === week).find((row) => row['metric'] === metric)

    expect(retentionAt('2025-11-17', 'returned_by_d1')?.['numerator']).toBe(3)
    expect(retentionAt('2025-11-17', 'returned_by_d1')?.['denominator']).toBe(4)
    expect(retentionAt('2025-11-17', 'returned_by_d7')?.['numerator']).toBe(3)
    expect(retentionAt('2025-11-17', 'returned_by_d7')?.['denominator']).toBe(4)
    expect(retentionAt('2025-11-17', 'returned_by_d30')?.['numerator']).toBe(2)
    expect(retentionAt('2025-11-17', 'returned_by_d30')?.['denominator']).toBe(3)
    expect(retentionAt('2025-11-17', 'returned_by_d30')?.['censored_count']).toBe(1)

    expect(retentionAt('2025-12-08', 'returned_by_d1')?.['numerator']).toBe(1)
    expect(retentionAt('2025-12-08', 'returned_by_d7')?.['numerator']).toBe(1)
    expect(retentionAt('2025-12-08', 'returned_by_d30')?.['numerator']).toBe(0)
    expect(retentionAt('2025-12-08', 'returned_by_d30')?.['denominator']).toBe(1)

    expect(retentionAt('2025-12-29', 'returned_by_d1')?.['numerator']).toBe(1)
    expect(retentionAt('2025-12-29', 'returned_by_d1')?.['denominator']).toBe(2)
    expect(retentionAt('2025-12-29', 'returned_by_d7')?.['numerator']).toBe(0)
    expect(retentionAt('2025-12-29', 'returned_by_d30')?.['numerator']).toBe(0)

    expect(retentionAt('2025-06-09', 'returned_by_d1')?.['numerator']).toBe(0)
    expect(retentionAt('2025-06-09', 'returned_by_d30')?.['numerator']).toBe(0)

    const censored = retentionAt('2026-01-12', 'returned_by_d30')
    expect(censored?.['denominator']).toBe(0)
    expect(censored?.['censored_count']).toBe(1)
    expect(censored?.['suppressed']).toBe(1)
    expect(censored?.['rate']).toBeNull()
    expect(retentionAt('2026-01-12', 'returned_by_d1')?.['numerator']).toBe(1)
    expect(retentionAt('2026-01-12', 'returned_by_d7')?.['numerator']).toBe(0)

    const weekly = rows.filter((row) => row['row_kind'] === 'weekly_engagement')
    const weeklyAt = (week: string, platform: string): Record<string, unknown> | undefined =>
      weekly.filter((row) => row['iso_week'] === week).find((row) => row['platform'] === platform)
    expect(weeklyAt('2025-11-17', 'telegram')?.['numerator']).toBe(2)
    expect(weeklyAt('2025-12-15', 'telegram')?.['numerator']).toBe(1)
    expect(weeklyAt('2025-12-22', 'telegram')?.['numerator']).toBe(2)
    expect(weeklyAt('2025-12-22', 'mattermost')?.['numerator']).toBe(1)
    expect(weeklyAt('2025-12-29', 'telegram')?.['numerator']).toBe(3)
    expect(weeklyAt('2026-01-12', 'telegram')?.['numerator']).toBe(1)
    expect(weeklyAt('2026-01-19', 'telegram')?.['numerator']).toBe(1)

    const volume = rows.filter((row) => row['row_kind'] === 'weekly_engagement_volume')
    const volumeAt = volume
      .filter((row) => row['iso_week'] === '2025-12-29')
      .find((row) => row['platform'] === 'telegram')
    expect(volumeAt?.['numerator']).toBe(4)
    expect(volumeAt?.['denominator']).toBe(3)

    const mix = rows.find((row) => row['row_kind'] === 'activity_mix')
    expect(mix?.['numerator']).toBe(5)
    expect(mix?.['returning_actors']).toBe(2)
    expect(mix?.['tenure_unknown_actors']).toBe(0)
    expect(mix?.['denominator']).toBe(7)

    const tenure = rows.filter((row) => row['row_kind'] === 'tenure_band')
    const tenureAt = (band: string): Record<string, unknown> | undefined =>
      tenure.find((row) => row['tenure_band'] === band)
    expect(tenureAt('1_2w')?.['numerator']).toBe(1)
    expect(tenureAt('2_4w')?.['numerator']).toBe(2)
    expect(tenureAt('4_12w')?.['numerator']).toBe(5)
    expect(tenureAt('12w_plus')?.['numerator']).toBe(1)

    const pairing = rows.filter((row) => row['row_kind'] === 'cross_platform_actor')
    const tgPairing = pairing.find((row) => row['platform'] === 'telegram')
    expect(tgPairing?.['numerator']).toBe(2)
    expect(tgPairing?.['denominator']).toBe(6)
    const mmPairing = pairing.find((row) => row['platform'] === 'mattermost')
    expect(mmPairing?.['numerator']).toBe(0)
    expect(mmPairing?.['denominator']).toBe(1)

    const latency = rows.find((row) => row['row_kind'] === 'message_latency_seconds')
    expect(latency?.['numerator']).toBe(2)
    expect(latency?.['p50_seconds']).toBe(0)
    expect(latency?.['p90_seconds']).toBe(3600)

    engagementDb.close()
  })

  test('aggregate-only snapshots label retention and engagement unavailable', () => {
    const aggregateDb = new Database(':memory:')
    createSnapshotSchema(aggregateDb, 'aggregate_only')
    insertMeta(aggregateDb, 'aggregate_only')
    const rows = runModel(aggregateDb, '02-retention-engagement.sql')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['row_kind']).toBe('unavailable')
      expect(row['availability']).toBe('unavailable_aggregate_only_snapshot')
    }
    aggregateDb.close()
  })
})

const insertGoalAttempt = (
  db: Database,
  input: {
    attemptKey: string
    turnKey: string
    goal: string
    actor: string
    startMs: number
    matureAtMs: number
    outcome: string
  },
): void => {
  db.prepare(
    `INSERT INTO curated_goal_attempts (
       attempt_key, turn_key, goal, actor_key, conversation_key, start_ms, mature_at_ms, outcome, resolved_at_ms, outcome_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    input.attemptKey,
    input.turnKey,
    input.goal,
    input.actor,
    'v1.c-conv',
    input.startMs,
    input.matureAtMs,
    input.outcome,
    input.startMs,
  )
}

const insertOpportunityDay = (db: Database, actor: string, feature: string, available: boolean, reason = ''): void => {
  db.prepare(
    `INSERT INTO curated_feature_opportunity_days (
       actor_key, feature, utc_day, available, reason, opportunity_event_id, definition_version
     ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(actor, feature, '2026-01-01', available ? 1 : 0, reason, `${actor}-${feature}-opp`)
}

const insertUseDay = (db: Database, actor: string, feature: string, adopted: boolean): void => {
  db.prepare(
    `INSERT INTO curated_feature_use_days (
       actor_key, feature, utc_day, success_count, failure_count, blocked_count, joined_available, adopted, first_use_event_id, definition_version
     ) VALUES (?, ?, ?, 1, 0, 0, 1, ?, ?, 1)`,
  ).run(actor, feature, '2026-01-01', adopted ? 1 : 0, `${actor}-${feature}-use`)
}

describe('metabase model: intents and features', () => {
  test('intent buckets, mature goal attainment, fractional goals, opportunity denominators, non-causal arms', () => {
    const intentsDb = new Database(':memory:')
    createSnapshotSchema(intentsDb, 'pseudonymous')
    insertMeta(intentsDb)

    insertEvent(intentsDb, {
      eventId: 'i1',
      eventName: 'intent_classified',
      occurredAtMs: T0,
      actorKey: 'f1',
      props: { primary: 'task_create', goals: ['G1', 'G2'], strategy: 'tool_trace_v1' },
    })
    insertEvent(intentsDb, {
      eventId: 'i2',
      eventName: 'intent_classified',
      occurredAtMs: T0,
      actorKey: 'f2',
      props: { primary: 'unknown', strategy: 'tool_trace_v1' },
    })
    insertEvent(intentsDb, {
      eventId: 'i3',
      eventName: 'intent_classified',
      occurredAtMs: T0,
      actorKey: 'f3',
      props: { primary: 'no_action', strategy: 'small_model_v1' },
    })
    insertEvent(intentsDb, {
      eventId: 'i4',
      eventName: 'intent_classified',
      occurredAtMs: T0,
      actorKey: 'f1',
      props: { primary: 'task_create', abstained: true, strategy: 'small_model_v1' },
    })
    insertEvent(intentsDb, {
      eventId: 'i5',
      eventName: 'intent_classified',
      occurredAtMs: T0,
      actorKey: 'f2',
      props: { primary: 'query', goals: ['G1'], strategy: 'metadata_v1' },
    })

    insertGoalAttempt(intentsDb, {
      attemptKey: 'att1',
      turnKey: 't1',
      goal: 'G1',
      actor: 'f1',
      startMs: T0,
      matureAtMs: T0 + DAY,
      outcome: 'attained',
    })
    insertGoalAttempt(intentsDb, {
      attemptKey: 'att2',
      turnKey: 't1',
      goal: 'G2',
      actor: 'f1',
      startMs: T0,
      matureAtMs: T0 + DAY,
      outcome: 'abandoned',
    })
    insertGoalAttempt(intentsDb, {
      attemptKey: 'att3',
      turnKey: 't5',
      goal: 'G1',
      actor: 'f2',
      startMs: T0,
      matureAtMs: T0 + DAY,
      outcome: 'attained',
    })
    insertGoalAttempt(intentsDb, {
      attemptKey: 'att4',
      turnKey: 't6',
      goal: 'G3',
      actor: 'f3',
      startMs: NOW,
      matureAtMs: NOW + DAY,
      outcome: 'pending',
    })

    insertOpportunityDay(intentsDb, 'f1', 'memory', true)
    insertOpportunityDay(intentsDb, 'f2', 'memory', true)
    insertOpportunityDay(intentsDb, 'f3', 'memory', true)
    insertOpportunityDay(intentsDb, 'f1', 'mcp', false, 'no_task_instance')
    insertOpportunityDay(intentsDb, 'f4', 'mcp', true)
    insertUseDay(intentsDb, 'f1', 'memory', true)
    insertUseDay(intentsDb, 'f2', 'memory', true)
    insertUseDay(intentsDb, 'f4', 'mcp', true)

    insertOnboarded(intentsDb, 'f1', T0 - 40 * DAY)
    insertOnboarded(intentsDb, 'f2', T0 - 40 * DAY)
    insertOnboarded(intentsDb, 'f3', T0 - 40 * DAY)
    insertMsg(intentsDb, 'f1', 'received', T0)
    insertMsg(intentsDb, 'f3', 'received', T0)

    const rows = runModel(intentsDb, '03-intents-features.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
    }

    const buckets = rows.filter((row) => row['row_kind'] === 'intent_classification')
    const bucketAt = (bucket: string): Record<string, unknown> | undefined =>
      buckets.find((row) => row['bucket'] === bucket)
    expect(bucketAt('unknown')?.['numerator']).toBe(2)
    expect(bucketAt('no_action')?.['numerator']).toBe(1)
    expect(bucketAt('multi_goal')?.['numerator']).toBe(1)
    expect(bucketAt('classified_single')?.['numerator']).toBe(1)
    for (const row of buckets) {
      expect(row['denominator']).toBe(5)
      expect(row['suppressed']).toBe(1)
    }

    const coverage = rows.filter((row) => row['row_kind'] === 'classification_coverage')
    const coverageAt = (strategy: string): Record<string, unknown> | undefined =>
      coverage.find((row) => row['bucket'] === strategy)
    expect(coverageAt('tool_trace_v1')?.['numerator']).toBe(1)
    expect(coverageAt('tool_trace_v1')?.['denominator']).toBe(2)
    expect(coverageAt('small_model_v1')?.['numerator']).toBe(1)
    expect(coverageAt('small_model_v1')?.['denominator']).toBe(2)
    expect(coverageAt('metadata_v1')?.['numerator']).toBe(1)
    expect(coverageAt('metadata_v1')?.['denominator']).toBe(1)
    for (const row of coverage) {
      expect(row['suppressed']).toBe(1)
      expect(row['rate']).toBeNull()
      expect(row['availability']).toBe('available')
    }

    const goals = rows
      .filter((row) => row['row_kind'] === 'goal_attainment')
      .filter((row) => row['metric'] === 'goal_attainment')
    const goalAt = (goal: string): Record<string, unknown> | undefined => goals.find((row) => row['goal'] === goal)
    expect(goalAt('G1')?.['numerator']).toBe(2)
    expect(goalAt('G1')?.['denominator']).toBe(2)
    expect(goalAt('G2')?.['numerator']).toBe(0)
    expect(goalAt('G2')?.['denominator']).toBe(1)
    const g3 = goalAt('G3')
    expect(g3?.['denominator']).toBe(0)
    expect(g3?.['censored_count']).toBe(1)
    expect(g3?.['rate']).toBeNull()

    const fractional = rows.filter((row) => row['metric'] === 'goal_attainment_fractional')
    const fractionalAt = (goal: string): Record<string, unknown> | undefined =>
      fractional.find((row) => row['goal'] === goal)
    expect(fractionalAt('G1')?.['numerator']).toBe(1.5)
    expect(fractionalAt('G1')?.['denominator']).toBe(1.5)
    expect(fractionalAt('G2')?.['numerator']).toBe(0)
    expect(fractionalAt('G2')?.['denominator']).toBe(0.5)

    const adoption = rows.filter((row) => row['row_kind'] === 'feature_adoption')
    const adoptionAt = (feature: string): Record<string, unknown> | undefined =>
      adoption.find((row) => row['feature'] === feature)
    expect(adoptionAt('memory')?.['numerator']).toBe(2)
    expect(adoptionAt('memory')?.['denominator']).toBe(3)
    expect(adoptionAt('mcp')?.['numerator']).toBe(1)
    expect(adoptionAt('mcp')?.['denominator']).toBe(1)
    expect(adoptionAt('mcp')?.['unknown_count']).toBe(1)

    const unavailable = rows.find((row) => row['row_kind'] === 'feature_unavailable')
    expect(unavailable?.['feature']).toBe('mcp')
    expect(unavailable?.['arm']).toBe('no_task_instance')
    expect(unavailable?.['numerator']).toBe(1)

    const arms = rows.filter((row) => row['row_kind'] === 'non_causal_d30')
    const armAt = (arm: string): Record<string, unknown> | undefined =>
      arms.filter((row) => row['feature'] === 'memory').find((row) => row['arm'] === arm)
    const used = armAt('used')
    expect(used?.['numerator']).toBe(1)
    expect(used?.['denominator']).toBe(2)
    expect(used?.['availability']).toBe('non_causal_associational')
    expect(used?.['suppressed']).toBe(1)
    expect(used?.['suppression_reason']).toBe('exposure_arm_below_100')
    expect(used?.['rate']).toBeNull()
    const notUsed = armAt('not_used')
    expect(notUsed?.['numerator']).toBe(1)
    expect(notUsed?.['denominator']).toBe(1)

    intentsDb.close()
  })

  test('aggregate-only snapshots label intents and features unavailable', () => {
    const aggregateDb = new Database(':memory:')
    createSnapshotSchema(aggregateDb, 'aggregate_only')
    insertMeta(aggregateDb, 'aggregate_only')
    const rows = runModel(aggregateDb, '03-intents-features.sql')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['row_kind']).toBe('unavailable')
    }
    aggregateDb.close()
  })
})

const insertFriction = (db: Database, turnKey: string, bits: Readonly<Record<string, number>>): void => {
  db.prepare(
    `INSERT INTO curated_turn_friction (
       turn_key, actor_key, conversation_key, occurred_at_ms, rephrase, clarification_abandoned,
       permission_issue, stop, long_turn, disclosure_fallback, failure_chain, component_count,
       display_score, anchor_event_id, friction_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    turnKey,
    'r1',
    'v1.c-conv',
    T0,
    bits['rephrase'] ?? 0,
    bits['clarification_abandoned'] ?? 0,
    bits['permission_issue'] ?? 0,
    bits['stop'] ?? 0,
    bits['long_turn'] ?? 0,
    bits['disclosure_fallback'] ?? 0,
    bits['failure_chain'] ?? 0,
    Object.values(bits).reduce((sum, bit) => sum + bit, 0),
    Object.values(bits).reduce((sum, bit) => sum + bit, 0),
    `${turnKey}-anchor`,
  )
}

describe('metabase model: reliability, friction, and performance', () => {
  test('semantic tool outcomes, llm explicit vs aged-open, friction bits, live status, percentiles, reply failures', () => {
    const reliabilityDb = new Database(':memory:')
    createSnapshotSchema(reliabilityDb, 'pseudonymous')
    insertMeta(reliabilityDb)

    const tool = (id: string, outcome: string, props: Readonly<Record<string, boolean>> = {}): void =>
      insertEvent(reliabilityDb, {
        eventId: id,
        eventName: 'tool_completed',
        occurredAtMs: T0,
        turnKey: id,
        props: { execution_outcome: outcome, ...props },
      })
    tool('tool1', 'semantic_success', { recovered_same_turn: false })
    tool('tool2', 'semantic_success', { recovered_same_turn: true })
    tool('tool3', 'semantic_success', { recovered_same_turn: false })
    tool('tool4', 'structured_failure')
    tool('tool5', 'thrown_failure')

    const llm = (turnKey: string, startedAtMs: number): void => {
      insertEvent(reliabilityDb, {
        eventId: `${turnKey}-start`,
        eventName: 'llm_started',
        occurredAtMs: startedAtMs,
        turnKey,
      })
    }
    const llmEnd = (
      turnKey: string,
      startedAtMs: number,
      name: 'llm_completed' | 'llm_failed',
      props: Readonly<Record<string, number>> = {},
    ): void => {
      insertEvent(reliabilityDb, {
        eventId: `${turnKey}-end`,
        eventName: name,
        occurredAtMs: startedAtMs + 100,
        turnKey,
        props,
      })
    }
    llm('l1', T0)
    llmEnd('l1', T0, 'llm_completed', { time_to_first_token_ms: 500 })
    llm('l2', T0)
    llmEnd('l2', T0, 'llm_completed')
    llm('l3', T0)
    llmEnd('l3', T0, 'llm_failed')
    llm('l4', NOW - 2 * DAY)
    llm('l5', NOW - 3_600_000)

    for (let i = 1; i <= 10; i += 1) {
      insertEvent(reliabilityDb, {
        eventId: `d${i}`,
        eventName: 'turn_completed',
        occurredAtMs: T0 + i,
        turnKey: `d${i}`,
        props: { result: 'completed', duration_ms: i * 100 },
      })
    }

    const failedTurn = (turnKey: string): void => {
      insertEvent(reliabilityDb, {
        eventId: `${turnKey}-completed`,
        eventName: 'turn_completed',
        occurredAtMs: T0,
        turnKey,
        props: { result: 'failed' },
      })
    }
    const replyFor = (turnKey: string): void => {
      insertEvent(reliabilityDb, { eventId: `${turnKey}-reply`, eventName: 'reply_sent', occurredAtMs: T0, turnKey })
    }
    failedTurn('fa1')
    replyFor('fa1')
    failedTurn('fa2')
    failedTurn('fa3')

    insertFriction(reliabilityDb, 'tf1', { rephrase: 1 })
    insertFriction(reliabilityDb, 'tf2', { clarification_abandoned: 1, failure_chain: 1 })
    insertFriction(reliabilityDb, 'tf3', { permission_issue: 1, stop: 1, long_turn: 1, disclosure_fallback: 1 })
    insertFriction(reliabilityDb, 'tf4', {})

    const statusOpp = (turnKey: string, supported: boolean): void => {
      insertEvent(reliabilityDb, {
        eventId: `${turnKey}-opp`,
        eventName: 'live_status_opportunity',
        occurredAtMs: T0,
        turnKey,
        props: { capability_supported: supported },
      })
    }
    const statusShown = (turnKey: string): void => {
      insertEvent(reliabilityDb, {
        eventId: `${turnKey}-shown`,
        eventName: 'live_status_lifecycle',
        occurredAtMs: T0 + 1,
        turnKey,
      })
    }
    statusOpp('ls1', true)
    statusShown('ls1')
    statusOpp('ls2', true)
    statusOpp('ls3', false)

    const rows = runModel(reliabilityDb, '04-reliability-friction-performance.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
    }

    const tools = rows.filter((row) => row['row_kind'] === 'tool_outcome')
    const toolAt = (metric: string): Record<string, unknown> | undefined =>
      tools.find((row) => row['metric'] === metric)
    expect(toolAt('tool_semantic_success')?.['numerator']).toBe(3)
    expect(toolAt('tool_structured_failure')?.['numerator']).toBe(1)
    expect(toolAt('tool_thrown_failure')?.['numerator']).toBe(1)
    expect(toolAt('tool_success_first_attempt')?.['numerator']).toBe(2)
    expect(toolAt('tool_success_recovered_same_turn')?.['numerator']).toBe(1)
    for (const row of tools) {
      expect(row['denominator']).toBe(5)
    }

    const llmRows = rows.filter((row) => row['row_kind'] === 'llm_outcome')
    const llmAt = (metric: string): Record<string, unknown> | undefined =>
      llmRows.find((row) => row['metric'] === metric)
    expect(llmAt('llm_completed')?.['numerator']).toBe(2)
    expect(llmAt('llm_failed_explicit')?.['numerator']).toBe(1)
    expect(llmAt('llm_aged_open')?.['numerator']).toBe(1)
    for (const row of llmRows) {
      expect(row['denominator']).toBe(4)
      expect(row['censored_count']).toBe(1)
    }

    const ttft = rows.find((row) => row['row_kind'] === 'llm_ttft')
    expect(ttft?.['p50']).toBe(500)
    expect(ttft?.['p99']).toBe(500)
    expect(ttft?.['numerator']).toBe(1)
    expect(ttft?.['unknown_count']).toBe(1)

    const duration = rows.find((row) => row['row_kind'] === 'turn_duration')
    expect(duration?.['p50']).toBe(500)
    expect(duration?.['p75']).toBe(800)
    expect(duration?.['p90']).toBe(900)
    expect(duration?.['p95']).toBe(1000)
    expect(duration?.['p99']).toBe(1000)
    expect(duration?.['numerator']).toBe(10)

    const friction = rows.filter((row) => row['row_kind'] === 'turn_friction')
    const frictionAt = (bit: string): Record<string, unknown> | undefined =>
      friction.find((row) => row['friction_bit'] === bit)
    expect(frictionAt('rephrase')?.['numerator']).toBe(1)
    expect(frictionAt('clarification_abandoned')?.['numerator']).toBe(1)
    expect(frictionAt('permission_issue')?.['numerator']).toBe(1)
    expect(frictionAt('stop')?.['numerator']).toBe(1)
    expect(frictionAt('long_turn')?.['numerator']).toBe(1)
    expect(frictionAt('disclosure_fallback')?.['numerator']).toBe(1)
    expect(frictionAt('failure_chain')?.['numerator']).toBe(1)
    for (const row of friction) {
      expect(row['denominator']).toBe(4)
    }

    const status = rows.filter((row) => row['row_kind'] === 'live_status')
    const statusAt = (metric: string): Record<string, unknown> | undefined =>
      status.find((row) => row['metric'] === metric)
    expect(statusAt('live_status_shown_when_supported')?.['numerator']).toBe(1)
    expect(statusAt('live_status_shown_when_supported')?.['denominator']).toBe(2)
    expect(statusAt('live_status_unsupported')?.['numerator']).toBe(1)
    expect(statusAt('live_status_unsupported')?.['denominator']).toBe(3)

    const replies = rows.filter((row) => row['row_kind'] === 'reply_failure')
    const replyAt = (metric: string): Record<string, unknown> | undefined =>
      replies.find((row) => row['metric'] === metric)
    expect(replyAt('turn_failed_reply_only')?.['numerator']).toBe(1)
    expect(replyAt('turn_failed_without_reply')?.['numerator']).toBe(2)
    for (const row of replies) {
      expect(row['denominator']).toBe(3)
    }

    reliabilityDb.close()
  })

  test('aggregate-only snapshots label reliability unavailable', () => {
    const aggregateDb = new Database(':memory:')
    createSnapshotSchema(aggregateDb, 'aggregate_only')
    insertMeta(aggregateDb, 'aggregate_only')
    const rows = runModel(aggregateDb, '04-reliability-friction-performance.sql')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['row_kind']).toBe('unavailable')
    }
    aggregateDb.close()
  })
})

const insertCounter = (
  db: Database,
  input: {
    utcDay: string
    metric: string
    value: number
    restartGap?: number
    lateEvents?: number
    contributorCount?: number
    threshold?: number
  },
): void => {
  db.prepare(
    `INSERT INTO analytics_daily_counters (
       utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version,
       metric, value, finalized, partial_day, restart_gap_detected, late_event_count,
       reconciliation_status, disclosure_scope, contributor_basis, contributor_count, threshold
     ) VALUES (?, 1, 'telegram', 'dm', 'admin', 'none', '6.10.0', ?, ?, 1, 0, ?, ?, 'reconciled', 'public', 'actors', ?, ?)`,
  ).run(
    input.utcDay,
    input.metric,
    input.value,
    input.restartGap ?? 0,
    input.lateEvents ?? 0,
    input.contributorCount ?? null,
    input.threshold ?? null,
  )
}

describe('metabase model: data health', () => {
  test('freshness, rejections, restart gaps, censoring, storage, timing, publication suppression', () => {
    const healthDb = new Database(':memory:')
    createSnapshotSchema(healthDb, 'pseudonymous')
    insertMeta(healthDb)

    insertEvent(healthDb, {
      eventId: 'h1',
      eventName: 'message_received',
      occurredAtMs: NOW - 3_600_000,
      actorKey: 'h1',
    })

    healthDb
      .prepare(
        `INSERT INTO analytics_normalization_rejections (utc_day, source_event_type, reason, count)
       VALUES ('2026-02-09', 'tool_completed', 'missing_outcome', 7)`,
      )
      .run()
    healthDb
      .prepare(
        `INSERT INTO analytics_normalization_rejections (utc_day, source_event_type, reason, count)
       VALUES ('2026-02-10', 'tool_completed', 'missing_outcome', 3)`,
      )
      .run()

    insertCounter(healthDb, {
      utcDay: '2026-02-09',
      metric: 'turn_completed',
      value: 10,
      restartGap: 1,
      lateEvents: 3,
      contributorCount: 2,
      threshold: 5,
    })
    insertCounter(healthDb, {
      utcDay: '2026-02-10',
      metric: 'turn_completed',
      value: 12,
      restartGap: 0,
      lateEvents: 0,
      contributorCount: 10,
      threshold: 5,
    })

    healthDb
      .prepare(
        `INSERT INTO analytics_daily_histograms (
         utc_day, definition_version, platform, context_type, actor_role, task_provider, app_version,
         metric, fixed_buckets_json, counts_json, sum, sample_count, finalized, partial_day,
         restart_gap_detected, late_event_count, reconciliation_status, disclosure_scope,
         contributor_basis, contributor_count, threshold
       ) VALUES ('2026-02-10', 1, 'telegram', 'dm', 'admin', 'none', '6.10.0', 'tool_duration_ms', '[]', '[]', 5000, 5, 1, 0, 0, 0, 'reconciled', 'public', 'actors', 10, 5)`,
      )
      .run()

    healthDb
      .prepare(
        `INSERT INTO curated_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
       VALUES ('h2', 'withdrawal', 1, NULL, 1)`,
      )
      .run()
    healthDb
      .prepare(
        `INSERT INTO curated_censor_intervals (actor_key, kind, start_ms, end_ms, censor_version)
       VALUES ('h3', 'deletion_pending', 1, 2, 1)`,
      )
      .run()

    const rows = runModel(healthDb, '00-data-health.sql')
    for (const row of rows) {
      for (const column of HONESTY_COLUMNS) {
        expect(row).toHaveProperty(column)
      }
    }

    const freshness = rows.find((row) => row['row_kind'] === 'snapshot_freshness')
    expect(freshness?.['numerator']).toBe(3_600_000)
    expect(freshness?.['unknown_count']).toBe(0)

    const rejection = rows.find((row) => row['row_kind'] === 'normalization_rejection')
    expect(rejection?.['dimension']).toBe('tool_completed:missing_outcome')
    expect(rejection?.['numerator']).toBe(10)

    const gaps = rows.find((row) => row['metric'] === 'restart_gap_detected')
    expect(gaps?.['numerator']).toBe(1)
    expect(gaps?.['denominator']).toBe(2)
    const late = rows.find((row) => row['metric'] === 'late_events')
    expect(late?.['numerator']).toBe(3)

    const censors = rows.filter((row) => row['row_kind'] === 'censor_interval')
    const censorAt = (kind: string): Record<string, unknown> | undefined =>
      censors.find((row) => row['dimension'] === kind)
    expect(censorAt('withdrawal')?.['numerator']).toBe(1)
    expect(censorAt('deletion_pending')?.['numerator']).toBe(1)

    const storage = rows.find((row) => row['row_kind'] === 'storage')
    expect(storage?.['dimension']).toBe('gen-1')

    const timing = rows.find((row) => row['row_kind'] === 'query_timing')
    expect(timing?.['dimension']).toBe('tool_duration_ms')
    expect(timing?.['numerator']).toBe(5)

    const suppression = rows.find((row) => row['row_kind'] === 'publication_suppression')
    expect(suppression?.['numerator']).toBe(1)
    expect(suppression?.['denominator']).toBe(2)

    healthDb.close()
  })

  test('data health stays available in aggregate-only snapshots with freshness unknown', () => {
    const aggregateDb = new Database(':memory:')
    createSnapshotSchema(aggregateDb, 'aggregate_only')
    insertMeta(aggregateDb, 'aggregate_only')
    insertCounter(aggregateDb, {
      utcDay: '2026-02-10',
      metric: 'turn_completed',
      value: 12,
      contributorCount: 10,
      threshold: 5,
    })
    const rows = runModel(aggregateDb, '00-data-health.sql')
    const availability = rows.map((row) => row['availability'])
    expect(availability).not.toContain('unavailable_aggregate_only_snapshot')
    const freshness = rows.find((row) => row['row_kind'] === 'snapshot_freshness')
    expect(freshness?.['numerator']).toBeNull()
    expect(freshness?.['unknown_count']).toBe(1)
    const suppression = rows.find((row) => row['row_kind'] === 'publication_suppression')
    expect(suppression?.['numerator']).toBe(0)
    expect(suppression?.['denominator']).toBe(1)
    aggregateDb.close()
  })
})

describe('metabase model: snapshot boundary scan', () => {
  const FORBIDDEN_TOKENS = [
    'props_json',
    'analytics_events',
    'analytics_active_generation',
    'analytics_collection_eligibility',
    'analytics_deletion_requests',
    'analytics_deletion_target_bundles',
    'analytics_eligibility_grants',
    'analytics_event_collection_refs',
    'analytics_policy',
    'analytics_preferences',
    'analytics_rekey_runs',
    'analytics_snapshot_publications',
    'analytics_backfill_runs',
    'analytics_process_epochs',
    'analytics_aggregate_releases',
    'conversation_history',
    'chat_id',
    'user_id',
    'channel_id',
    'message_id',
    'thread_id',
  ]

  const MODEL_FILES = [
    '00-data-health.sql',
    '01-activation.sql',
    '02-retention-engagement.sql',
    '03-intents-features.sql',
    '04-reliability-friction-performance.sql',
  ]

  test('models never touch raw props, governance tables, or native platform ids', () => {
    for (const file of MODEL_FILES) {
      const sql = readFileSync(join(SQL_DIR, file), 'utf8').toLowerCase()
      for (const token of FORBIDDEN_TOKENS) {
        expect(sql.includes(token), `${file} must not reference ${token}`).toBe(false)
      }
    }
  })

  test('every model row carries the honesty block and snapshot provenance', () => {
    for (const file of MODEL_FILES) {
      const sql = readFileSync(join(SQL_DIR, file), 'utf8')
      for (const column of HONESTY_COLUMNS) {
        expect(sql.includes(column), `${file} must emit ${column}`).toBe(true)
      }
    }
  })
})
