// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const EXPECTED_EVENT_COLUMNS = [
  'event_id',
  'schema_name',
  'schema_version',
  'event_version',
  'occurred_at_ms',
  'ingested_at_ms',
  'event_name',
  'event_source',
  'attribution_quality',
  'app_version',
  'deployment_key',
  'key_version',
  'platform',
  'platform_instance_key',
  'actor_key',
  'context_key',
  'thread_key',
  'task_instance_key',
  'context_type',
  'actor_role',
  'task_provider',
  'invocation_mode',
  'turn_key',
  'session_key',
  'governance_purpose',
  'collection_tier',
  'policy_version',
  'eligibility',
  'privacy_max_class',
  'expires_at_ms',
  'props_json',
] as const

export const ACTIVATION_COUNTS_SQL = `
  SELECT 'first_dm' AS step, COUNT(DISTINCT actor_key) AS actors
  FROM analytics_events
  WHERE event_name = 'chat_message_accepted'
    AND context_type = 'dm'

  UNION ALL

  SELECT 'config_link_issued' AS step, COUNT(DISTINCT actor_key) AS actors
  FROM analytics_events
  WHERE event_name = 'config_link_issued'
    AND json_extract(props_json, '$.result') = 'issued'

  UNION ALL

  SELECT 'settings_opened' AS step, COUNT(DISTINCT actor_key) AS actors
  FROM analytics_events
  WHERE event_name = 'settings_opened'
    AND json_extract(props_json, '$.entry') = 'config_link'
    AND json_extract(props_json, '$.result') = 'success'

  UNION ALL

  SELECT 'task_instance_assigned' AS step, COUNT(DISTINCT actor_key) AS actors
  FROM analytics_events
  WHERE event_name = 'task_instance_assigned'
    AND json_extract(props_json, '$.change') = 'first_assignment'

  UNION ALL

  SELECT 'first_task_mutating_success' AS step, COUNT(DISTINCT actor_key) AS actors
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND json_extract(props_json, '$.domain') = 'task'
    AND json_extract(props_json, '$.risk') IN ('write', 'destructive')
    AND json_extract(props_json, '$.execution_outcome') = 'semantic_success'
`

export const RETENTION_COUNTS_SQL = `
  WITH cohort AS (
    SELECT
      actor_key,
      MIN(occurred_at_ms) AS cohort_at,
      date(MIN(occurred_at_ms) / 1000, 'unixepoch') AS cohort_date
    FROM analytics_events
    WHERE event_name = 'chat_message_accepted'
      AND actor_key IS NOT NULL
      AND invocation_mode = 'normal'
    GROUP BY actor_key
  ),
  return_days AS (
    SELECT DISTINCT
      cohort.actor_key,
      CAST(
        julianday(date(events.occurred_at_ms / 1000, 'unixepoch')) -
        julianday(cohort.cohort_date)
        AS INTEGER
      ) AS day_number
    FROM cohort
    JOIN analytics_events AS events USING (actor_key)
    WHERE events.event_name = 'chat_message_accepted'
      AND events.invocation_mode = 'normal'
      AND events.occurred_at_ms > cohort.cohort_at
  )
  SELECT
    COUNT(DISTINCT CASE WHEN day_number = 1 THEN actor_key END) AS d1,
    COUNT(DISTINCT CASE WHEN day_number = 7 THEN actor_key END) AS d7,
    COUNT(DISTINCT CASE WHEN day_number = 30 THEN actor_key END) AS d30
  FROM return_days
`

export const ORDERING_RATIO_SQL = `
  WITH ordered AS (
    SELECT
      occurred_at_ms,
      LAG(occurred_at_ms) OVER (ORDER BY rowid) AS previous_occurred_at
    FROM analytics_events
  )
  SELECT
    CAST(SUM(previous_occurred_at > occurred_at_ms) AS REAL) / COUNT(*) AS ratio
  FROM ordered
`

export const GUEST_AGGREGATE_SQL = `
  SELECT
    COUNT(*) AS total,
    SUM(
      actor_key IS NULL
      AND context_key IS NULL
      AND thread_key IS NULL
      AND task_instance_key IS NULL
      AND turn_key IS NULL
      AND session_key IS NULL
      AND collection_tier = 'aggregate'
    ) AS aggregate_only
  FROM analytics_events
  WHERE event_name = 'guest_turn_aggregate'
`

export const CANONICAL_CONTRACT_SQL = `
  SELECT COUNT(*) AS violations
  FROM analytics_events
  WHERE schema_name <> 'papai.analytics.event'
     OR schema_version <> 1
     OR event_version <> 1
     OR event_source NOT IN ('live', 'backfill')
     OR attribution_quality NOT IN ('native', 'backfill_snapshot', 'unknown')
     OR governance_purpose <> 'product_analytics'
     OR policy_version <> 1
     OR privacy_max_class NOT IN ('C0', 'C1', 'C2')
`

export const LEGACY_EVENT_COUNT_SQL = `
  SELECT COUNT(*) AS count
  FROM analytics_events
  WHERE event_name IN (
    'first_dm',
    'first_tool_success',
    'intent_detected',
    'tool_called',
    'tool_succeeded',
    'tool_failed',
    'llm_error',
    'provider_error',
    'mcp_server_down',
    'guest_turn',
    'clarify_abandoned',
    'stop_requested',
    'confirmation_denied',
    'recurring_created',
    'deferred_created',
    'memo_created',
    'attachment_ingested',
    'coding_session_started',
    'mcp_endpoint_used',
    'byok_enabled',
    'web_fetched'
  )
`

export const TTFT_CONTRACT_SQL = `
  SELECT
    SUM(
      event_name = 'turn_completed'
      AND json_type(props_json, '$.time_to_first_token_ms') IS NOT NULL
    ) +
    (
      SUM(
        event_name = 'llm_completed'
        AND json_type(props_json, '$.time_to_first_token_ms') IS NOT NULL
      ) = 0
    ) AS violations
  FROM analytics_events
`

export const REPLACE_MESSAGE_PROPS_SQL = `
  UPDATE analytics_events
  SET props_json = $props_json
  WHERE event_id = (
    SELECT event_id
    FROM analytics_events
    WHERE event_name = 'chat_message_accepted'
    LIMIT 1
  )
`
