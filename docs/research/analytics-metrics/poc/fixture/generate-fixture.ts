// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import {
  generateFixtureEvents,
  propsJson,
  summarizeFixture,
  toSourceOrder,
  validateContentFreeEvents,
  type AnalyticsEvent,
  type FixtureSummary,
} from './fixture-data.js'

const DEFAULT_OUTPUT_PATH = '/private/tmp/papai-analytics-synthetic.sqlite'

const ANALYTICS_EVENTS_SCHEMA = `
  CREATE TABLE analytics_events (
    event_id TEXT PRIMARY KEY,
    schema_name TEXT NOT NULL CHECK (schema_name = 'papai.analytics.event'),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    event_version INTEGER NOT NULL CHECK (event_version = 1),
    occurred_at_ms INTEGER NOT NULL,
    ingested_at_ms INTEGER NOT NULL CHECK (ingested_at_ms >= occurred_at_ms),
    event_name TEXT NOT NULL,
    event_source TEXT NOT NULL CHECK (event_source IN ('live', 'backfill')),
    attribution_quality TEXT NOT NULL
      CHECK (attribution_quality IN ('native', 'backfill_snapshot', 'unknown')),
    app_version TEXT NOT NULL,
    deployment_key TEXT NOT NULL,
    key_version INTEGER NOT NULL CHECK (key_version = 1),
    platform TEXT NOT NULL
      CHECK (platform IN ('telegram', 'mattermost', 'discord', 'kontur-talk')),
    platform_instance_key TEXT NOT NULL,
    actor_key TEXT,
    context_key TEXT,
    thread_key TEXT,
    task_instance_key TEXT,
    context_type TEXT NOT NULL CHECK (context_type IN ('dm', 'group', 'none')),
    actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'member', 'guest', 'system')),
    task_provider TEXT NOT NULL CHECK (task_provider IN ('kaneo', 'youtrack', 'none', 'other')),
    invocation_mode TEXT NOT NULL
      CHECK (invocation_mode IN ('normal', 'command', 'settings', 'proactive', 'scheduler')),
    turn_key TEXT,
    session_key TEXT,
    governance_purpose TEXT NOT NULL CHECK (governance_purpose = 'product_analytics'),
    collection_tier TEXT NOT NULL CHECK (collection_tier IN ('aggregate', 'pseudonymous')),
    policy_version INTEGER NOT NULL CHECK (policy_version = 1),
    eligibility TEXT NOT NULL CHECK (eligibility IN ('allowed', 'operator_basis', 'not_applicable')),
    privacy_max_class TEXT NOT NULL CHECK (privacy_max_class IN ('C0', 'C1', 'C2')),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > occurred_at_ms),
    props_json TEXT NOT NULL CHECK (json_valid(props_json))
  );

  CREATE INDEX analytics_events_occurred_at_idx
    ON analytics_events (occurred_at_ms);
  CREATE INDEX analytics_events_actor_time_idx
    ON analytics_events (actor_key, occurred_at_ms);
  CREATE INDEX analytics_events_thread_time_idx
    ON analytics_events (thread_key, occurred_at_ms);
  CREATE INDEX analytics_events_turn_idx
    ON analytics_events (turn_key);
  CREATE INDEX analytics_events_name_time_idx
    ON analytics_events (event_name, occurred_at_ms);

  CREATE TABLE fixture_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

const INSERT_EVENT_SQL = `
  INSERT OR IGNORE INTO analytics_events (
    event_id,
    schema_name,
    schema_version,
    event_version,
    occurred_at_ms,
    ingested_at_ms,
    event_name,
    event_source,
    attribution_quality,
    app_version,
    deployment_key,
    key_version,
    platform,
    platform_instance_key,
    actor_key,
    context_key,
    thread_key,
    task_instance_key,
    context_type,
    actor_role,
    task_provider,
    invocation_mode,
    turn_key,
    session_key,
    governance_purpose,
    collection_tier,
    policy_version,
    eligibility,
    privacy_max_class,
    expires_at_ms,
    props_json
  ) VALUES (
    $event_id,
    $schema_name,
    $schema_version,
    $event_version,
    $occurred_at_ms,
    $ingested_at_ms,
    $event_name,
    $event_source,
    $attribution_quality,
    $app_version,
    $deployment_key,
    $key_version,
    $platform,
    $platform_instance_key,
    $actor_key,
    $context_key,
    $thread_key,
    $task_instance_key,
    $context_type,
    $actor_role,
    $task_provider,
    $invocation_mode,
    $turn_key,
    $session_key,
    $governance_purpose,
    $collection_tier,
    $policy_version,
    $eligibility,
    $privacy_max_class,
    $expires_at_ms,
    $props_json
  )
`

type CliParseResult = Readonly<{ ok: true; outputPath: string }> | Readonly<{ ok: false; message: string }>
type SqlBindings = Record<string, string | bigint | Uint8Array | number | boolean | null>

function parseOutputPath(args: readonly string[]): CliParseResult {
  if (args.length === 0) return { ok: true, outputPath: DEFAULT_OUTPUT_PATH }
  if (args.length === 2 && args[0] === '--output' && args[1] !== undefined && args[1].length > 0) {
    return { ok: true, outputPath: args[1] }
  }
  return { ok: false, message: 'Usage: bun generate-fixture.ts [--output /path/to/analytics.sqlite]' }
}

const eventBindings = (event: AnalyticsEvent): SqlBindings => ({
  event_id: event.eventId,
  schema_name: event.schemaName,
  schema_version: event.schemaVersion,
  event_version: event.eventVersion,
  occurred_at_ms: event.occurredAtMs,
  ingested_at_ms: event.ingestedAtMs,
  event_name: event.eventName,
  event_source: event.eventSource,
  attribution_quality: event.attributionQuality,
  app_version: event.appVersion,
  deployment_key: event.deploymentKey,
  key_version: event.keyVersion,
  platform: event.platform,
  platform_instance_key: event.platformInstanceKey,
  actor_key: event.actorKey,
  context_key: event.contextKey,
  thread_key: event.threadKey,
  task_instance_key: event.taskInstanceKey,
  context_type: event.contextType,
  actor_role: event.actorRole,
  task_provider: event.taskProvider,
  invocation_mode: event.invocationMode,
  turn_key: event.turnKey,
  session_key: event.sessionKey,
  governance_purpose: event.governancePurpose,
  collection_tier: event.collectionTier,
  policy_version: event.policyVersion,
  eligibility: event.eligibility,
  privacy_max_class: event.privacyMaxClass,
  expires_at_ms: event.expiresAtMs,
  props_json: propsJson(event),
})

function persistFixture(database: Database, events: readonly AnalyticsEvent[]): FixtureSummary {
  database.run(ANALYTICS_EVENTS_SCHEMA)
  using insertEventStatement = database.query<never, SqlBindings>(INSERT_EVENT_SQL)
  const insertEvent = (event: AnalyticsEvent): number => insertEventStatement.run(eventBindings(event)).changes
  database.transaction((batch: readonly AnalyticsEvent[]) => {
    batch.forEach((event) => {
      insertEvent(event)
    })
  })(events)

  const duplicateEvents = events.filter((_, index) => index % 53 === 0)
  const duplicateChanges = duplicateEvents.reduce((sum, event) => sum + insertEvent(event), 0)
  const summary = summarizeFixture(events, duplicateEvents.length, duplicateEvents.length - duplicateChanges)
  const metadata = {
    seed: summary.seed,
    event_count: summary.eventCount,
    actor_count: summary.actorCount,
    active_date_count: summary.activeDateCount,
    duplicate_attempts: summary.duplicateAttempts,
    duplicate_rows_ignored: summary.duplicateRowsIgnored,
    out_of_order_rows: summary.outOfOrderRows,
    out_of_order_ratio: summary.outOfOrderRatio,
    first_occurred_at_ms: summary.firstOccurredAtMs,
    last_occurred_at_ms: summary.lastOccurredAtMs,
  } as const
  using insertMetadataStatement = database.query<never, SqlBindings>(
    'INSERT INTO fixture_metadata (key, value) VALUES ($key, $value)',
  )
  database.transaction((entries: readonly (readonly [string, string])[]) => {
    entries.forEach(([key, value]) => {
      insertMetadataStatement.run({ key, value })
    })
  })(Object.entries(metadata).map(([key, value]) => [key, String(value)] as const))
  return summary
}

async function main(): Promise<number> {
  const parsed = parseOutputPath(Bun.argv.slice(2))
  if (!parsed.ok) {
    console.error(parsed.message)
    return 1
  }
  if (await Bun.file(parsed.outputPath).exists()) {
    console.error(`Refusing to overwrite existing output: ${parsed.outputPath}`)
    return 1
  }

  const events = toSourceOrder(generateFixtureEvents())
  const validation = validateContentFreeEvents(events)
  if (!validation.ok) {
    console.error(`Fixture preflight rejected ${validation.violations.length} violation(s):`)
    validation.violations.slice(0, 20).forEach((violation) => {
      console.error(`- ${violation}`)
    })
    return 1
  }

  using database = new Database(parsed.outputPath, { create: true, strict: true })
  const summary = persistFixture(database, events)
  console.log(JSON.stringify({ outputPath: parsed.outputPath, ...summary }))
  return 0
}

process.exitCode = await main()
