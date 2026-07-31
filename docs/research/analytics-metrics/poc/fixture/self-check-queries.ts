// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const ACTIVATION_QUERY = `
  WITH first_dm AS (
    SELECT messages.actor_key, MIN(messages.occurred_at_ms) AS first_dm_at
    FROM analytics_events AS messages
    JOIN analytics_events AS auth
      ON auth.turn_key = messages.turn_key
     AND auth.event_name = 'auth_checked'
     AND json_extract(auth.props_json, '$.outcome') = 'granted'
    WHERE messages.event_name = 'chat_message_accepted'
      AND messages.context_type = 'dm'
      AND messages.invocation_mode = 'normal'
      AND messages.actor_key IS NOT NULL
    GROUP BY messages.actor_key
  ),
  config AS (
    SELECT first_dm.actor_key, first_dm.first_dm_at, MIN(events.occurred_at_ms) AS config_at
    FROM first_dm
    LEFT JOIN analytics_events AS events
      ON events.actor_key = first_dm.actor_key
     AND events.event_name = 'config_link_issued'
     AND json_extract(events.props_json, '$.result') = 'issued'
     AND events.occurred_at_ms > first_dm.first_dm_at
     AND events.occurred_at_ms <= first_dm.first_dm_at + 604800000
    GROUP BY first_dm.actor_key
  ),
  settings AS (
    SELECT config.*, MIN(events.occurred_at_ms) AS settings_at
    FROM config
    LEFT JOIN analytics_events AS events
      ON events.actor_key = config.actor_key
     AND events.event_name = 'settings_opened'
     AND json_extract(events.props_json, '$.entry') = 'config_link'
     AND json_extract(events.props_json, '$.result') = 'success'
     AND events.occurred_at_ms > config.config_at
     AND events.occurred_at_ms <= config.config_at + 86400000
     AND events.occurred_at_ms <= config.first_dm_at + 604800000
    GROUP BY config.actor_key
  ),
  assignment_time AS (
    SELECT settings.*, MIN(events.occurred_at_ms) AS assignment_at
    FROM settings
    LEFT JOIN analytics_events AS events
      ON events.actor_key = settings.actor_key
     AND events.event_name = 'task_instance_assigned'
     AND json_extract(events.props_json, '$.change') = 'first_assignment'
     AND events.occurred_at_ms > settings.settings_at
     AND events.occurred_at_ms <= settings.first_dm_at + 604800000
    GROUP BY settings.actor_key
  ),
  assignment AS (
    SELECT
      assignment_time.*,
      (
        SELECT events.task_instance_key
        FROM analytics_events AS events
        WHERE events.actor_key = assignment_time.actor_key
          AND events.event_name = 'task_instance_assigned'
          AND events.occurred_at_ms = assignment_time.assignment_at
        ORDER BY events.event_id
        LIMIT 1
      ) AS assigned_task_instance_key,
      (
        SELECT json_extract(events.props_json, '$.to_provider')
        FROM analytics_events AS events
        WHERE events.actor_key = assignment_time.actor_key
          AND events.event_name = 'task_instance_assigned'
          AND events.occurred_at_ms = assignment_time.assignment_at
        ORDER BY events.event_id
        LIMIT 1
      ) AS assigned_task_provider
    FROM assignment_time
  ),
  success AS (
    SELECT assignment.*, MIN(events.occurred_at_ms) AS success_at
    FROM assignment
    LEFT JOIN analytics_events AS events
      ON events.actor_key = assignment.actor_key
     AND events.event_name = 'tool_completed'
     AND json_extract(events.props_json, '$.domain') = 'task'
     AND json_extract(events.props_json, '$.risk') IN ('write', 'destructive')
     AND json_extract(events.props_json, '$.execution_outcome') = 'semantic_success'
     AND assignment.assigned_task_instance_key IS NOT NULL
     AND events.task_instance_key = assignment.assigned_task_instance_key
     AND events.task_provider = assignment.assigned_task_provider
     AND events.occurred_at_ms > assignment.assignment_at
     AND events.occurred_at_ms <= assignment.first_dm_at + 1209600000
    GROUP BY assignment.actor_key
  )
  SELECT 'first_dm' AS step, COUNT(*) AS actors FROM first_dm
  UNION ALL SELECT 'config_link_issued', COUNT(config_at) FROM config
  UNION ALL SELECT 'settings_opened', COUNT(settings_at) FROM settings
  UNION ALL SELECT 'task_instance_assigned', COUNT(assignment_at) FROM assignment
  UNION ALL SELECT 'first_task_mutating_success', COUNT(success_at) FROM success
`

export const RETENTION_QUERY = `
  WITH cohort AS (
    SELECT actor_key, MIN(occurred_at_ms) AS cohort_at,
      date(MIN(occurred_at_ms) / 1000, 'unixepoch') AS cohort_date
    FROM analytics_events
    WHERE event_name = 'chat_message_accepted'
      AND actor_key IS NOT NULL
      AND invocation_mode = 'normal'
    GROUP BY actor_key
  ),
  return_days AS (
    SELECT DISTINCT cohort.actor_key,
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

export const ENVELOPE_VIOLATIONS_QUERY = `
  SELECT COUNT(*) AS value
  FROM analytics_events
  WHERE schema_name <> 'papai.analytics.event'
     OR schema_version <> 1
     OR event_version <> 1
     OR event_source NOT IN ('live', 'backfill')
     OR attribution_quality NOT IN ('native', 'backfill_snapshot', 'unknown')
     OR governance_purpose <> 'product_analytics'
     OR policy_version <> 1
     OR privacy_max_class NOT IN ('C0', 'C1', 'C2')
     OR ingested_at_ms < occurred_at_ms
     OR expires_at_ms <= occurred_at_ms
`

export const GUEST_VIOLATIONS_QUERY = `
  SELECT COUNT(*) AS value
  FROM analytics_events
  WHERE event_name = 'guest_turn_aggregate'
    AND (
      actor_key IS NOT NULL OR context_key IS NOT NULL OR thread_key IS NOT NULL
      OR task_instance_key IS NOT NULL OR turn_key IS NOT NULL OR session_key IS NOT NULL
      OR collection_tier <> 'aggregate' OR privacy_max_class <> 'C0'
    )
`

export const TTFT_VIOLATIONS_QUERY = `
  SELECT
    SUM(event_name = 'turn_completed' AND json_type(props_json, '$.time_to_first_token_ms') IS NOT NULL) +
    (SUM(event_name = 'llm_completed' AND json_type(props_json, '$.time_to_first_token_ms') IS NOT NULL) = 0)
    AS value
  FROM analytics_events
`

export const IDENTITY_VIOLATIONS_QUERY = `
  SELECT COUNT(*) AS value
  FROM analytics_events
  WHERE length(event_id) <> 64
     OR event_id GLOB '*[^0-9a-f]*'
     OR length(deployment_key) <> 36
     OR substr(deployment_key, 1, 4) <> 'syn_'
     OR substr(deployment_key, 5) GLOB '*[^0-9a-f]*'
     OR length(platform_instance_key) <> 36
     OR substr(platform_instance_key, 1, 4) <> 'syn_'
     OR substr(platform_instance_key, 5) GLOB '*[^0-9a-f]*'
     OR (
       actor_key IS NOT NULL AND (
         length(actor_key) <> 36 OR substr(actor_key, 1, 4) <> 'syn_'
         OR substr(actor_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
     OR (
       context_key IS NOT NULL AND (
         length(context_key) <> 36 OR substr(context_key, 1, 4) <> 'syn_'
         OR substr(context_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
     OR (
       thread_key IS NOT NULL AND (
         length(thread_key) <> 36 OR substr(thread_key, 1, 4) <> 'syn_'
         OR substr(thread_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
     OR (
       task_instance_key IS NOT NULL AND (
         length(task_instance_key) <> 36 OR substr(task_instance_key, 1, 4) <> 'syn_'
         OR substr(task_instance_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
     OR (
       turn_key IS NOT NULL AND (
         length(turn_key) <> 36 OR substr(turn_key, 1, 4) <> 'syn_'
         OR substr(turn_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
     OR (
       session_key IS NOT NULL AND (
         length(session_key) <> 36 OR substr(session_key, 1, 4) <> 'syn_'
         OR substr(session_key, 5) GLOB '*[^0-9a-f]*'
       )
     )
`
