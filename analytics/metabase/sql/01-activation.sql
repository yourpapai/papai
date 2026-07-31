-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Dmitriy Lazarev
-- Use of this software is governed by the Business Source License 1.1.
-- See LICENSE in the project root for details.

-- Activation model over the curated snapshot schema (adapts the reviewed PoC
-- at docs/research/analytics-metrics/poc/metabase/sql/01-activation.sql).
-- Row kinds: 'actor' (one pseudonymous, non-guest actor funnel), 'cohort_rate'
-- (conditional step rates with the full honesty block), and 'cohort_duration'
-- (nearest-rank p50/p90 minutes to activation). Every step is conditional on
-- the previous step: 7-day link/settings/assignment windows, 14-day mutating
-- success window. Rates are suppressed (NULL) below denominator 30.
WITH meta AS (
  SELECT snapshot_created_at_ms, reconciliation_status, snapshot_mode
  FROM (
    SELECT created_at_ms AS snapshot_created_at_ms, reconciliation_status, snapshot_mode
    FROM snapshot_meta
    WHERE singleton_id = 1
  )
),
horizon AS (
  SELECT MAX(occurred_at_ms) AS last_observed_at
  FROM curated_events
),
candidates AS (
  SELECT
    events.actor_key,
    date(MIN(events.occurred_at_ms) / 1000, 'unixepoch') AS candidate_date
  FROM curated_events AS events
  WHERE events.event_name = 'chat_message_accepted'
    AND events.actor_key IS NOT NULL
    AND events.context_type = 'dm'
    AND events.actor_role IN ('admin', 'member')
    AND events.invocation_mode = 'normal'
  GROUP BY events.actor_key
),
authorized_dm_candidates AS (
  SELECT
    messages.actor_key,
    messages.occurred_at_ms,
    messages.event_id,
    messages.platform,
    messages.context_type,
    messages.actor_role,
    messages.app_version,
    ROW_NUMBER() OVER (
      PARTITION BY messages.actor_key
      ORDER BY messages.occurred_at_ms, messages.event_id
    ) AS candidate_rank
  FROM curated_events AS messages
  WHERE messages.event_name = 'chat_message_accepted'
    AND messages.actor_key IS NOT NULL
    AND messages.context_type = 'dm'
    AND messages.actor_role IN ('admin', 'member')
    AND messages.invocation_mode = 'normal'
    AND messages.eligibility IN ('allowed', 'operator_basis')
    AND EXISTS (
      SELECT 1
      FROM curated_events AS authorization
      WHERE authorization.event_name = 'auth_checked'
        AND authorization.actor_key = messages.actor_key
        AND authorization.turn_key = messages.turn_key
        AND authorization.prop_outcome = 'granted'
    )
),
first_dm AS (
  SELECT
    actor_key,
    occurred_at_ms AS first_dm_at,
    date(occurred_at_ms / 1000, 'unixepoch') AS cohort_date,
    platform,
    context_type,
    actor_role,
    app_version
  FROM authorized_dm_candidates
  WHERE candidate_rank = 1
),
funnel AS (
  SELECT
    first_dm.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM curated_events AS events
      WHERE events.actor_key = first_dm.actor_key
        AND events.event_name = 'config_link_issued'
        AND events.prop_result = 'issued'
        AND events.occurred_at_ms > first_dm.first_dm_at
        AND events.occurred_at_ms <= first_dm.first_dm_at + (7 * 86400000)
    ) AS config_link_issued_at,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM curated_events AS events
      WHERE events.actor_key = first_dm.actor_key
        AND events.event_name = 'settings_opened'
        AND events.prop_entry = 'config_link'
        AND events.prop_result = 'success'
        AND events.occurred_at_ms > first_dm.first_dm_at
        AND events.occurred_at_ms <= first_dm.first_dm_at + (7 * 86400000)
    ) AS settings_opened_at,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM curated_events AS events
      WHERE events.actor_key = first_dm.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND events.prop_change = 'first_assignment'
        AND events.occurred_at_ms > first_dm.first_dm_at
        AND events.occurred_at_ms <= first_dm.first_dm_at + (7 * 86400000)
    ) AS task_instance_assigned_at
  FROM first_dm
),
assigned AS (
  SELECT
    funnel.*,
    (
      SELECT events.task_instance_key
      FROM curated_events AS events
      WHERE events.actor_key = funnel.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND events.occurred_at_ms = funnel.task_instance_assigned_at
        AND events.task_instance_key IS NOT NULL
      ORDER BY events.event_id
      LIMIT 1
    ) AS assigned_task_instance_key,
    (
      SELECT events.prop_to_provider
      FROM curated_events AS events
      WHERE events.actor_key = funnel.actor_key
        AND events.event_name = 'task_instance_assigned'
        AND events.occurred_at_ms = funnel.task_instance_assigned_at
        AND events.task_instance_key IS NOT NULL
      ORDER BY events.event_id
      LIMIT 1
    ) AS assigned_task_provider
  FROM funnel
),
completed AS (
  SELECT
    assigned.*,
    (
      SELECT MIN(events.occurred_at_ms)
      FROM curated_events AS events
      WHERE events.actor_key = assigned.actor_key
        AND events.event_name = 'tool_completed'
        AND events.prop_domain = 'task'
        AND events.prop_risk IN ('write', 'destructive')
        AND events.prop_execution_outcome = 'semantic_success'
        AND assigned.assigned_task_instance_key IS NOT NULL
        AND events.task_instance_key = assigned.assigned_task_instance_key
        AND events.task_provider = assigned.assigned_task_provider
        AND events.occurred_at_ms > assigned.task_instance_assigned_at
        AND events.occurred_at_ms <= assigned.first_dm_at + (14 * 86400000)
    ) AS first_mutating_success_at
  FROM assigned
),
flags AS (
  SELECT
    completed.*,
    CASE WHEN config_link_issued_at IS NOT NULL THEN 1 ELSE 0 END AS reached_config_link,
    CASE
      WHEN settings_opened_at IS NOT NULL
       AND settings_opened_at > config_link_issued_at
       AND settings_opened_at <= config_link_issued_at + 86400000
        THEN 1 ELSE 0
    END AS reached_settings_opened,
    CASE
      WHEN task_instance_assigned_at IS NOT NULL
       AND task_instance_assigned_at > settings_opened_at
        THEN 1 ELSE 0
    END AS reached_task_assignment,
    CASE WHEN first_mutating_success_at IS NOT NULL THEN 1 ELSE 0 END AS activation_completed,
    CASE
      WHEN config_link_issued_at IS NULL AND first_dm_at + (7 * 86400000) > horizon.last_observed_at
        THEN 1 ELSE 0
    END AS config_link_censored,
    CASE
      WHEN config_link_issued_at IS NOT NULL
       AND settings_opened_at IS NULL
       AND MIN(config_link_issued_at + 86400000, first_dm_at + (7 * 86400000)) > horizon.last_observed_at
        THEN 1 ELSE 0
    END AS settings_censored,
    CASE
      WHEN settings_opened_at IS NOT NULL
       AND task_instance_assigned_at IS NULL
       AND first_dm_at + (7 * 86400000) > horizon.last_observed_at
        THEN 1 ELSE 0
    END AS assignment_censored,
    CASE
      WHEN task_instance_assigned_at IS NOT NULL
       AND first_mutating_success_at IS NULL
       AND first_dm_at + (14 * 86400000) > horizon.last_observed_at
        THEN 1 ELSE 0
    END AS success_censored
  FROM completed
  CROSS JOIN horizon
),
cohort_coverage AS (
  SELECT
    first_dm.cohort_date,
    COUNT(*) AS eligible_actors,
    COUNT(*) + (
      SELECT COUNT(*)
      FROM candidates
      LEFT JOIN first_dm AS eligible
        ON eligible.actor_key = candidates.actor_key
      WHERE eligible.actor_key IS NULL
        AND candidates.candidate_date = first_dm.cohort_date
    ) AS candidate_actors
  FROM first_dm
  GROUP BY first_dm.cohort_date
),
step_rows AS (
  SELECT 'first_dm' AS step, cohort_date, COUNT(*) AS numerator, COUNT(*) AS denominator,
    SUM(0) AS censored_count
  FROM flags GROUP BY cohort_date
  UNION ALL
  SELECT 'config_link', cohort_date, SUM(reached_config_link), COUNT(*), SUM(config_link_censored)
  FROM flags GROUP BY cohort_date
  UNION ALL
  SELECT 'settings_opened', cohort_date, SUM(reached_settings_opened), SUM(reached_config_link), SUM(settings_censored)
  FROM flags GROUP BY cohort_date
  UNION ALL
  SELECT 'task_assignment', cohort_date, SUM(reached_task_assignment), SUM(reached_settings_opened), SUM(assignment_censored)
  FROM flags GROUP BY cohort_date
  UNION ALL
  SELECT 'first_mutating_success', cohort_date, SUM(activation_completed), SUM(reached_task_assignment), SUM(success_censored)
  FROM flags GROUP BY cohort_date
  UNION ALL
  SELECT 'activation', cohort_date, SUM(activation_completed), COUNT(*), SUM(success_censored)
  FROM flags GROUP BY cohort_date
),
durations AS (
  SELECT
    cohort_date,
    (first_mutating_success_at - first_dm_at) / 60000.0 AS minutes_to_activation,
    ROW_NUMBER() OVER (
      PARTITION BY cohort_date
      ORDER BY (first_mutating_success_at - first_dm_at)
    ) AS duration_rank,
    COUNT(*) OVER (PARTITION BY cohort_date) AS activated_count
  FROM flags
  WHERE activation_completed = 1
)
SELECT
  'actor' AS row_kind,
  'available' AS availability,
  flags.actor_key,
  flags.cohort_date,
  NULL AS step,
  flags.platform,
  flags.context_type,
  flags.actor_role,
  flags.app_version,
  flags.first_dm_at,
  flags.config_link_issued_at,
  flags.settings_opened_at,
  flags.task_instance_assigned_at,
  flags.first_mutating_success_at,
  flags.reached_config_link,
  flags.reached_settings_opened,
  flags.reached_task_assignment,
  flags.activation_completed,
  CASE
    WHEN flags.config_link_issued_at IS NULL THEN 'before_config_link'
    WHEN flags.reached_settings_opened = 0 THEN 'before_settings_opened'
    WHEN flags.reached_task_assignment = 0 THEN 'before_task_assignment'
    WHEN flags.first_mutating_success_at IS NULL THEN 'before_first_mutating_success'
    ELSE 'activated'
  END AS dropoff_step,
  ROUND((flags.first_mutating_success_at - flags.first_dm_at) / 3600000.0, 2) AS hours_to_activation,
  NULL AS rate,
  NULL AS p50_minutes_to_activation,
  NULL AS p90_minutes_to_activation,
  1 AS metric_version,
  flags.cohort_date AS window_start_utc,
  date(horizon.last_observed_at / 1000, 'unixepoch') AS window_end_utc,
  NULL AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  flags.config_link_censored + flags.settings_censored + flags.assignment_censored + flags.success_censored AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  1 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM flags
CROSS JOIN horizon
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'cohort_rate' AS row_kind,
  'available' AS availability,
  NULL AS actor_key,
  step_rows.cohort_date,
  step_rows.step,
  NULL AS platform,
  NULL AS context_type,
  NULL AS actor_role,
  NULL AS app_version,
  NULL AS first_dm_at,
  NULL AS config_link_issued_at,
  NULL AS settings_opened_at,
  NULL AS task_instance_assigned_at,
  NULL AS first_mutating_success_at,
  NULL AS reached_config_link,
  NULL AS reached_settings_opened,
  NULL AS reached_task_assignment,
  NULL AS activation_completed,
  NULL AS dropoff_step,
  NULL AS hours_to_activation,
  CASE
    WHEN step_rows.denominator >= 30
      THEN ROUND(CAST(step_rows.numerator AS REAL) / step_rows.denominator, 4)
  END AS rate,
  NULL AS p50_minutes_to_activation,
  NULL AS p90_minutes_to_activation,
  1 AS metric_version,
  step_rows.cohort_date AS window_start_utc,
  date(horizon.last_observed_at / 1000, 'unixepoch') AS window_end_utc,
  step_rows.numerator,
  step_rows.denominator,
  CASE WHEN step_rows.step = 'first_dm' THEN cohort_coverage.candidate_actors - cohort_coverage.eligible_actors ELSE 0 END AS unknown_count,
  step_rows.censored_count,
  ROUND(CAST(cohort_coverage.eligible_actors AS REAL) / cohort_coverage.candidate_actors, 4) AS eligibility_coverage,
  CASE
    WHEN step_rows.denominator >= 30 AND step_rows.denominator > 0
      THEN ROUND(
        (CAST(step_rows.numerator AS REAL) / step_rows.denominator + 3.8416 / (2.0 * step_rows.denominator)
         - 1.96 * sqrt(
             CAST(step_rows.numerator AS REAL) / step_rows.denominator
               * (1.0 - CAST(step_rows.numerator AS REAL) / step_rows.denominator) / step_rows.denominator
             + 3.8416 / (4.0 * step_rows.denominator * step_rows.denominator)))
        / (1.0 + 3.8416 / step_rows.denominator)
      , 4)
  END AS wilson_low,
  CASE
    WHEN step_rows.denominator >= 30 AND step_rows.denominator > 0
      THEN ROUND(
        (CAST(step_rows.numerator AS REAL) / step_rows.denominator + 3.8416 / (2.0 * step_rows.denominator)
         + 1.96 * sqrt(
             CAST(step_rows.numerator AS REAL) / step_rows.denominator
               * (1.0 - CAST(step_rows.numerator AS REAL) / step_rows.denominator) / step_rows.denominator
             + 3.8416 / (4.0 * step_rows.denominator * step_rows.denominator)))
        / (1.0 + 3.8416 / step_rows.denominator)
      , 4)
  END AS wilson_high,
  CASE WHEN step_rows.denominator < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM step_rows
JOIN cohort_coverage
  ON cohort_coverage.cohort_date = step_rows.cohort_date
CROSS JOIN horizon
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'cohort_duration' AS row_kind,
  'available' AS availability,
  NULL AS actor_key,
  durations.cohort_date,
  'activation_minutes' AS step,
  NULL AS platform,
  NULL AS context_type,
  NULL AS actor_role,
  NULL AS app_version,
  NULL AS first_dm_at,
  NULL AS config_link_issued_at,
  NULL AS settings_opened_at,
  NULL AS task_instance_assigned_at,
  NULL AS first_mutating_success_at,
  NULL AS reached_config_link,
  NULL AS reached_settings_opened,
  NULL AS reached_task_assignment,
  NULL AS activation_completed,
  NULL AS dropoff_step,
  NULL AS hours_to_activation,
  NULL AS rate,
  MAX(CASE WHEN durations.duration_rank = CAST((durations.activated_count * 50 + 99) / 100 AS INTEGER)
    THEN durations.minutes_to_activation END) AS p50_minutes_to_activation,
  MAX(CASE WHEN durations.duration_rank = CAST((durations.activated_count * 90 + 99) / 100 AS INTEGER)
    THEN durations.minutes_to_activation END) AS p90_minutes_to_activation,
  1 AS metric_version,
  durations.cohort_date AS window_start_utc,
  date(horizon.last_observed_at / 1000, 'unixepoch') AS window_end_utc,
  MAX(durations.activated_count) AS numerator,
  MAX(durations.activated_count) AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN MAX(durations.activated_count) < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM durations
CROSS JOIN horizon
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'
GROUP BY durations.cohort_date

UNION ALL

SELECT
  'unavailable' AS row_kind,
  'unavailable_aggregate_only_snapshot' AS availability,
  NULL AS actor_key,
  NULL AS cohort_date,
  'activation' AS step,
  NULL AS platform,
  NULL AS context_type,
  NULL AS actor_role,
  NULL AS app_version,
  NULL AS first_dm_at,
  NULL AS config_link_issued_at,
  NULL AS settings_opened_at,
  NULL AS task_instance_assigned_at,
  NULL AS first_mutating_success_at,
  NULL AS reached_config_link,
  NULL AS reached_settings_opened,
  NULL AS reached_task_assignment,
  NULL AS activation_completed,
  NULL AS dropoff_step,
  NULL AS hours_to_activation,
  NULL AS rate,
  NULL AS p50_minutes_to_activation,
  NULL AS p90_minutes_to_activation,
  1 AS metric_version,
  NULL AS window_start_utc,
  NULL AS window_end_utc,
  NULL AS numerator,
  NULL AS denominator,
  NULL AS unknown_count,
  NULL AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  1 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM meta
WHERE meta.snapshot_mode = 'aggregate_only'
ORDER BY row_kind, cohort_date, step, actor_key;
