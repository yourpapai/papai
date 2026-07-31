-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Dmitriy Lazarev
-- Use of this software is governed by the Business Source License 1.1.
-- See LICENSE in the project root for details.

-- Model grain: one classified primary intent, completed tool call, or feature
-- use. Intent outcomes are derived from canonical semantic tool outcomes.
WITH data_horizon AS (
  SELECT MAX(occurred_at_ms) AS last_observed_at
  FROM analytics_events
),
cohort_candidates AS (
  SELECT
    events.actor_key,
    date(events.occurred_at_ms / 1000, 'unixepoch') AS cohort_date,
    events.occurred_at_ms,
    events.event_id,
    ROW_NUMBER() OVER (
      PARTITION BY events.actor_key
      ORDER BY events.occurred_at_ms, events.event_id
    ) AS activity_rank
  FROM analytics_events AS events
  WHERE events.event_name = 'chat_message_accepted'
    AND events.actor_key IS NOT NULL
    AND events.actor_role IN ('admin', 'member')
    AND events.invocation_mode = 'normal'
    AND events.eligibility IN ('allowed', 'operator_basis')
),
actor_cohorts AS (
  SELECT actor_key, cohort_date
  FROM cohort_candidates
  WHERE activity_rank = 1
),
retention_flags AS (
  SELECT
    cohorts.actor_key,
    cohorts.cohort_date,
    MAX(
      CAST(
        julianday(date(events.occurred_at_ms / 1000, 'unixepoch')) -
        julianday(cohorts.cohort_date)
        AS INTEGER
      ) = 1
    ) AS d1_retained,
    MAX(
      CAST(
        julianday(date(events.occurred_at_ms / 1000, 'unixepoch')) -
        julianday(cohorts.cohort_date)
        AS INTEGER
      ) = 7
    ) AS d7_retained,
    MAX(
      CAST(
        julianday(date(events.occurred_at_ms / 1000, 'unixepoch')) -
        julianday(cohorts.cohort_date)
        AS INTEGER
      ) = 30
    ) AS d30_retained
  FROM actor_cohorts AS cohorts
  LEFT JOIN analytics_events AS events
    ON events.actor_key = cohorts.actor_key
   AND events.event_name = 'chat_message_accepted'
   AND events.invocation_mode = 'normal'
   AND events.eligibility IN ('allowed', 'operator_basis')
  GROUP BY cohorts.actor_key, cohorts.cohort_date
),
first_semantic_success AS (
  SELECT
    turn_key,
    MIN(occurred_at_ms) AS first_success_at
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND json_extract(props_json, '$.execution_outcome') = 'semantic_success'
  GROUP BY turn_key
),
tool_rollup AS (
  SELECT
    tools.turn_key,
    success.first_success_at,
    SUM(
      json_extract(tools.props_json, '$.execution_outcome')
        IN ('structured_failure', 'thrown_failure')
    ) AS failure_count,
    SUM(
      json_extract(tools.props_json, '$.execution_outcome')
        IN ('structured_failure', 'thrown_failure')
      AND (
        success.first_success_at IS NULL
        OR tools.occurred_at_ms < success.first_success_at
      )
    ) AS failure_before_success_count,
    MAX(
      json_extract(tools.props_json, '$.recovered_same_turn') = 1
    ) AS marked_recovered_same_turn
  FROM analytics_events AS tools
  LEFT JOIN first_semantic_success AS success
    ON success.turn_key = tools.turn_key
  WHERE tools.event_name = 'tool_completed'
  GROUP BY tools.turn_key, success.first_success_at
),
intent_base AS (
  SELECT
    events.*,
    json_extract(events.props_json, '$.primary') AS primary_intent,
    json_extract(events.props_json, '$.strategy') AS classification_strategy,
    json_extract(events.props_json, '$.confidence') AS confidence_bucket,
    json_extract(events.props_json, '$.goals') AS goals_json,
    json_extract(events.props_json, '$.abstained') AS abstained
  FROM analytics_events AS events
  WHERE events.event_name = 'intent_classified'
),
intent_rows AS (
  SELECT
    intents.event_id,
    intents.occurred_at_ms,
    date(intents.occurred_at_ms / 1000, 'unixepoch') AS occurred_date,
    intents.actor_key,
    intents.context_key,
    intents.thread_key,
    intents.platform_instance_key,
    intents.task_instance_key,
    intents.turn_key,
    intents.session_key,
    intents.platform,
    intents.context_type,
    intents.actor_role,
    intents.task_provider,
    intents.app_version,
    'intent' AS usage_kind,
    intents.primary_intent AS usage_name,
    CASE
      WHEN intents.primary_intent = 'no_action' THEN 'not_applicable'
      WHEN intents.primary_intent = 'unknown' OR intents.abstained = 1 THEN 'censored'
      WHEN rollup.first_success_at IS NOT NULL
       AND (
         rollup.failure_before_success_count > 0
         OR rollup.marked_recovered_same_turn = 1
       )
        THEN 'recovered_same_turn'
      WHEN rollup.first_success_at IS NOT NULL THEN 'immediate_success'
      WHEN rollup.failure_count > 0
       AND horizon.last_observed_at >= intents.occurred_at_ms + 86400000
        THEN 'abandoned_after_failure'
      WHEN EXISTS (
        SELECT 1
        FROM analytics_events AS abandoned
        WHERE abandoned.turn_key = intents.turn_key
          AND abandoned.event_name = 'clarification_abandoned'
      )
       AND horizon.last_observed_at >= intents.occurred_at_ms + 86400000
        THEN 'abandoned_after_clarification'
      WHEN horizon.last_observed_at < intents.occurred_at_ms + 86400000
        THEN 'censored'
      ELSE 'unresolved_engaged'
    END AS outcome,
    intents.classification_strategy AS intent_source,
    intents.confidence_bucket,
    intents.goals_json,
    CASE
      WHEN rollup.first_success_at IS NOT NULL
       AND (
         rollup.failure_before_success_count > 0
         OR rollup.marked_recovered_same_turn = 1
       )
        THEN 1
      ELSE 0
    END AS recovered
  FROM intent_base AS intents
  CROSS JOIN data_horizon AS horizon
  LEFT JOIN tool_rollup AS rollup
    ON rollup.turn_key = intents.turn_key
),
tool_rows AS (
  SELECT
    events.event_id,
    events.occurred_at_ms,
    date(events.occurred_at_ms / 1000, 'unixepoch') AS occurred_date,
    events.actor_key,
    events.context_key,
    events.thread_key,
    events.platform_instance_key,
    events.task_instance_key,
    events.turn_key,
    events.session_key,
    events.platform,
    events.context_type,
    events.actor_role,
    events.task_provider,
    events.app_version,
    'tool' AS usage_kind,
    json_extract(events.props_json, '$.tool_slug') AS usage_name,
    CASE
      WHEN json_extract(events.props_json, '$.execution_outcome') = 'semantic_success'
       AND json_extract(events.props_json, '$.recovered_same_turn') = 1
        THEN 'recovered_same_turn'
      ELSE json_extract(events.props_json, '$.execution_outcome')
    END AS outcome,
    NULL AS intent_source,
    NULL AS confidence_bucket,
    NULL AS goals_json,
    CASE
      WHEN json_extract(events.props_json, '$.recovered_same_turn') = 1 THEN 1
      ELSE 0
    END AS recovered
  FROM analytics_events AS events
  WHERE events.event_name = 'tool_completed'
),
feature_rows AS (
  SELECT
    events.event_id,
    events.occurred_at_ms,
    date(events.occurred_at_ms / 1000, 'unixepoch') AS occurred_date,
    events.actor_key,
    events.context_key,
    events.thread_key,
    events.platform_instance_key,
    events.task_instance_key,
    events.turn_key,
    events.session_key,
    events.platform,
    events.context_type,
    events.actor_role,
    events.task_provider,
    events.app_version,
    'feature' AS usage_kind,
    json_extract(events.props_json, '$.feature') AS usage_name,
    json_extract(events.props_json, '$.outcome') AS outcome,
    NULL AS intent_source,
    NULL AS confidence_bucket,
    NULL AS goals_json,
    0 AS recovered
  FROM analytics_events AS events
  WHERE events.event_name = 'feature_used'

  UNION ALL

  SELECT
    events.event_id,
    events.occurred_at_ms,
    date(events.occurred_at_ms / 1000, 'unixepoch') AS occurred_date,
    events.actor_key,
    events.context_key,
    events.thread_key,
    events.platform_instance_key,
    events.task_instance_key,
    events.turn_key,
    events.session_key,
    events.platform,
    events.context_type,
    events.actor_role,
    events.task_provider,
    events.app_version,
    'feature' AS usage_kind,
    json_extract(events.props_json, '$.feature') AS usage_name,
    CASE
      WHEN json_extract(events.props_json, '$.available') = 1 THEN 'available'
      ELSE 'unavailable:' || json_extract(events.props_json, '$.reason')
    END AS outcome,
    NULL AS intent_source,
    NULL AS confidence_bucket,
    NULL AS goals_json,
    0 AS recovered
  FROM analytics_events AS events
  WHERE events.event_name = 'feature_opportunity'
),
usage_rows AS (
  SELECT * FROM intent_rows
  UNION ALL
  SELECT * FROM tool_rows
  UNION ALL
  SELECT * FROM feature_rows
)
SELECT
  usage_rows.*,
  retention_flags.cohort_date,
  CASE WHEN retention_flags.actor_key IS NOT NULL THEN 1 ELSE 0 END AS cohort_actor,
  COALESCE(retention_flags.d1_retained, 0) AS d1_retained,
  COALESCE(retention_flags.d7_retained, 0) AS d7_retained,
  COALESCE(retention_flags.d30_retained, 0) AS d30_retained
FROM usage_rows
LEFT JOIN retention_flags
  ON retention_flags.actor_key = usage_rows.actor_key
WHERE usage_rows.usage_name IS NOT NULL
ORDER BY usage_rows.occurred_at_ms, usage_rows.event_id;
