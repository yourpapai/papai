-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Dmitriy Lazarev
-- Use of this software is governed by the Business Source License 1.1.
-- See LICENSE in the project root for details.

-- Model grains:
--   engagement: UTC activity date plus approved low-cardinality dimensions;
--   retention: first eligible activity cohort plus the same dimensions.
-- D1/D7/D30 are exact UTC calendar-day returns, not "returned by" measures.
WITH eligible_activity AS MATERIALIZED (
  SELECT
    events.event_id,
    events.actor_key,
    events.thread_key,
    events.turn_key,
    events.session_key,
    events.occurred_at_ms,
    date(events.occurred_at_ms / 1000, 'unixepoch') AS activity_date,
    events.platform,
    events.context_type,
    events.task_provider,
    events.app_version
  FROM analytics_events AS events
  WHERE events.event_name = 'chat_message_accepted'
    AND events.actor_key IS NOT NULL
    AND events.actor_role IN ('admin', 'member')
    AND events.invocation_mode = 'normal'
    AND events.eligibility IN ('allowed', 'operator_basis')
    AND EXISTS (
      SELECT 1
      FROM analytics_events AS authorization
      WHERE authorization.event_name = 'auth_checked'
        AND authorization.actor_key = events.actor_key
        AND authorization.turn_key = events.turn_key
        AND json_extract(authorization.props_json, '$.outcome') = 'granted'
    )
),
data_horizon AS (
  SELECT MAX(activity_date) AS last_observed_date
  FROM eligible_activity
),
daily_dimensions AS (
  SELECT DISTINCT
    activity_date,
    platform,
    context_type,
    task_provider,
    app_version
  FROM eligible_activity
),
activity_sessions AS MATERIALIZED (
  SELECT DISTINCT
    session_key,
    activity_date,
    platform,
    context_type,
    task_provider,
    app_version
  FROM eligible_activity
  WHERE session_key IS NOT NULL
),
session_spans AS MATERIALIZED (
  SELECT
    sessions.session_key,
    sessions.activity_date,
    sessions.platform,
    sessions.context_type,
    sessions.task_provider,
    sessions.app_version,
    MAX(events.occurred_at_ms) - MIN(events.occurred_at_ms) AS session_duration_ms
  FROM activity_sessions AS sessions
  JOIN analytics_events AS events
    ON events.session_key = sessions.session_key
  GROUP BY
    sessions.session_key,
    sessions.activity_date,
    sessions.platform,
    sessions.context_type,
    sessions.task_provider,
    sessions.app_version
),
completed_turns AS MATERIALIZED (
  SELECT
    actor_key,
    turn_key,
    session_key,
    date(occurred_at_ms / 1000, 'unixepoch') AS activity_date,
    platform,
    context_type,
    task_provider,
    app_version
  FROM analytics_events
  WHERE event_name = 'turn_completed'
    AND actor_key IS NOT NULL
    AND actor_role IN ('admin', 'member')
    AND invocation_mode = 'normal'
    AND eligibility IN ('allowed', 'operator_basis')
),
cohort_candidates AS (
  SELECT
    activity.*,
    ROW_NUMBER() OVER (
      PARTITION BY activity.actor_key
      ORDER BY activity.occurred_at_ms, activity.event_id
    ) AS activity_rank
  FROM eligible_activity AS activity
),
actor_cohorts AS MATERIALIZED (
  SELECT
    actor_key,
    activity_date AS cohort_date,
    occurred_at_ms AS cohort_started_at,
    platform,
    context_type,
    task_provider,
    app_version
  FROM cohort_candidates
  WHERE activity_rank = 1
),
intent_activity AS MATERIALIZED (
  SELECT
    date(intents.occurred_at_ms / 1000, 'unixepoch') AS activity_date,
    intents.platform,
    intents.context_type,
    intents.task_provider,
    intents.app_version,
    CASE
      WHEN date(intents.occurred_at_ms / 1000, 'unixepoch') = cohorts.cohort_date
        THEN 'new'
      ELSE 'returning'
    END AS actor_phase
  FROM analytics_events AS intents
  JOIN actor_cohorts AS cohorts
    ON cohorts.actor_key = intents.actor_key
  WHERE intents.event_name = 'intent_classified'
    AND intents.invocation_mode = 'normal'
    AND intents.eligibility IN ('allowed', 'operator_basis')
),
daily_engagement AS (
  SELECT
    dimensions.activity_date,
    dimensions.platform,
    dimensions.context_type,
    dimensions.task_provider,
    dimensions.app_version,
    (
      SELECT COUNT(DISTINCT exact_day.actor_key)
      FROM eligible_activity AS exact_day
      WHERE exact_day.activity_date = dimensions.activity_date
        AND exact_day.platform = dimensions.platform
        AND exact_day.context_type = dimensions.context_type
        AND exact_day.task_provider = dimensions.task_provider
        AND exact_day.app_version = dimensions.app_version
    ) AS dau,
    (
      SELECT COUNT(DISTINCT rolling_week.actor_key)
      FROM eligible_activity AS rolling_week
      WHERE rolling_week.activity_date
        BETWEEN date(dimensions.activity_date, '-6 days') AND dimensions.activity_date
        AND rolling_week.platform = dimensions.platform
        AND rolling_week.context_type = dimensions.context_type
        AND rolling_week.task_provider = dimensions.task_provider
        AND rolling_week.app_version = dimensions.app_version
    ) AS wau,
    (
      SELECT COUNT(DISTINCT rolling_month.actor_key)
      FROM eligible_activity AS rolling_month
      WHERE rolling_month.activity_date
        BETWEEN date(dimensions.activity_date, '-29 days') AND dimensions.activity_date
        AND rolling_month.platform = dimensions.platform
        AND rolling_month.context_type = dimensions.context_type
        AND rolling_month.task_provider = dimensions.task_provider
        AND rolling_month.app_version = dimensions.app_version
    ) AS mau,
    (
      SELECT COUNT(DISTINCT exact_day.thread_key)
      FROM eligible_activity AS exact_day
      WHERE exact_day.activity_date = dimensions.activity_date
        AND exact_day.platform = dimensions.platform
        AND exact_day.context_type = dimensions.context_type
        AND exact_day.task_provider = dimensions.task_provider
        AND exact_day.app_version = dimensions.app_version
    ) AS active_context_count,
    (
      SELECT COUNT(DISTINCT exact_day.session_key)
      FROM eligible_activity AS exact_day
      WHERE exact_day.activity_date = dimensions.activity_date
        AND exact_day.platform = dimensions.platform
        AND exact_day.context_type = dimensions.context_type
        AND exact_day.task_provider = dimensions.task_provider
        AND exact_day.app_version = dimensions.app_version
    ) AS session_count,
    (
      SELECT COUNT(DISTINCT exact_day.turn_key)
      FROM completed_turns AS exact_day
      WHERE exact_day.activity_date = dimensions.activity_date
        AND exact_day.platform = dimensions.platform
        AND exact_day.context_type = dimensions.context_type
        AND exact_day.task_provider = dimensions.task_provider
        AND exact_day.app_version = dimensions.app_version
    ) AS turn_count,
    (
      SELECT COUNT(*)
      FROM eligible_activity AS exact_day
      WHERE exact_day.activity_date = dimensions.activity_date
        AND exact_day.platform = dimensions.platform
        AND exact_day.context_type = dimensions.context_type
        AND exact_day.task_provider = dimensions.task_provider
        AND exact_day.app_version = dimensions.app_version
    ) AS message_count,
    (
      SELECT AVG(spans.session_duration_ms)
      FROM session_spans AS spans
      WHERE spans.activity_date = dimensions.activity_date
        AND spans.platform = dimensions.platform
        AND spans.context_type = dimensions.context_type
        AND spans.task_provider = dimensions.task_provider
        AND spans.app_version = dimensions.app_version
    ) AS avg_session_duration_ms,
    (
      SELECT COUNT(*)
      FROM intent_activity AS intents
      WHERE intents.activity_date = dimensions.activity_date
        AND intents.platform = dimensions.platform
        AND intents.context_type = dimensions.context_type
        AND intents.task_provider = dimensions.task_provider
        AND intents.app_version = dimensions.app_version
        AND intents.actor_phase = 'new'
    ) AS new_intent_count,
    (
      SELECT COUNT(*)
      FROM intent_activity AS intents
      WHERE intents.activity_date = dimensions.activity_date
        AND intents.platform = dimensions.platform
        AND intents.context_type = dimensions.context_type
        AND intents.task_provider = dimensions.task_provider
        AND intents.app_version = dimensions.app_version
        AND intents.actor_phase = 'returning'
    ) AS returning_intent_count
  FROM daily_dimensions AS dimensions
),
return_days AS (
  SELECT DISTINCT
    cohorts.actor_key,
    CAST(
      julianday(activity.activity_date) - julianday(cohorts.cohort_date)
      AS INTEGER
    ) AS day_number
  FROM actor_cohorts AS cohorts
  JOIN eligible_activity AS activity
    ON activity.actor_key = cohorts.actor_key
   AND activity.platform = cohorts.platform
   AND activity.occurred_at_ms > cohorts.cohort_started_at
),
retention_flags AS (
  SELECT
    cohorts.actor_key,
    cohorts.cohort_date,
    cohorts.platform,
    cohorts.context_type,
    cohorts.task_provider,
    cohorts.app_version,
    CASE
      WHEN julianday(horizon.last_observed_date) - julianday(cohorts.cohort_date) >= 1
        THEN 1 ELSE 0
    END AS observable_d1,
    CASE
      WHEN julianday(horizon.last_observed_date) - julianday(cohorts.cohort_date) >= 7
        THEN 1 ELSE 0
    END AS observable_d7,
    CASE
      WHEN julianday(horizon.last_observed_date) - julianday(cohorts.cohort_date) >= 30
        THEN 1 ELSE 0
    END AS observable_d30,
    COALESCE(MAX(return_days.day_number = 1), 0) AS d1_retained,
    COALESCE(MAX(return_days.day_number = 7), 0) AS d7_retained,
    COALESCE(MAX(return_days.day_number = 30), 0) AS d30_retained
  FROM actor_cohorts AS cohorts
  CROSS JOIN data_horizon AS horizon
  LEFT JOIN return_days
    ON return_days.actor_key = cohorts.actor_key
  GROUP BY
    cohorts.actor_key,
    cohorts.cohort_date,
    cohorts.platform,
    cohorts.context_type,
    cohorts.task_provider,
    cohorts.app_version,
    horizon.last_observed_date
),
cohort_retention AS (
  SELECT
    cohort_date,
    platform,
    context_type,
    task_provider,
    app_version,
    COUNT(*) AS cohort_actors,
    SUM(observable_d1) AS d1_eligible_actors,
    SUM(observable_d7) AS d7_eligible_actors,
    SUM(observable_d30) AS d30_eligible_actors,
    SUM(CASE WHEN observable_d1 = 1 THEN d1_retained ELSE 0 END) AS d1_retained_actors,
    SUM(CASE WHEN observable_d7 = 1 THEN d7_retained ELSE 0 END) AS d7_retained_actors,
    SUM(CASE WHEN observable_d30 = 1 THEN d30_retained ELSE 0 END) AS d30_retained_actors
  FROM retention_flags
  GROUP BY cohort_date, platform, context_type, task_provider, app_version
)
SELECT
  'engagement' AS row_kind,
  activity_date AS metric_date,
  NULL AS cohort_date,
  platform,
  context_type,
  task_provider,
  app_version,
  dau,
  wau,
  mau,
  ROUND(CAST(dau AS REAL) / NULLIF(mau, 0), 4) AS stickiness,
  active_context_count,
  session_count,
  turn_count,
  message_count,
  ROUND(CAST(turn_count AS REAL) / NULLIF(session_count, 0), 3) AS turns_per_session,
  ROUND(avg_session_duration_ms, 2) AS avg_session_duration_ms,
  new_intent_count,
  returning_intent_count,
  NULL AS cohort_actors,
  NULL AS d1_eligible_actors,
  NULL AS d7_eligible_actors,
  NULL AS d30_eligible_actors,
  NULL AS d1_retained_actors,
  NULL AS d7_retained_actors,
  NULL AS d30_retained_actors,
  NULL AS d1_retention_rate,
  NULL AS d7_retention_rate,
  NULL AS d30_retention_rate
FROM daily_engagement

UNION ALL

SELECT
  'retention' AS row_kind,
  cohort_date AS metric_date,
  cohort_date,
  platform,
  context_type,
  task_provider,
  app_version,
  NULL AS dau,
  NULL AS wau,
  NULL AS mau,
  NULL AS stickiness,
  NULL AS active_context_count,
  NULL AS session_count,
  NULL AS turn_count,
  NULL AS message_count,
  NULL AS turns_per_session,
  NULL AS avg_session_duration_ms,
  NULL AS new_intent_count,
  NULL AS returning_intent_count,
  cohort_actors,
  d1_eligible_actors,
  d7_eligible_actors,
  d30_eligible_actors,
  d1_retained_actors,
  d7_retained_actors,
  d30_retained_actors,
  ROUND(CAST(d1_retained_actors AS REAL) / NULLIF(d1_eligible_actors, 0), 4) AS d1_retention_rate,
  ROUND(CAST(d7_retained_actors AS REAL) / NULLIF(d7_eligible_actors, 0), 4) AS d7_retention_rate,
  ROUND(CAST(d30_retained_actors AS REAL) / NULLIF(d30_eligible_actors, 0), 4) AS d30_retention_rate
FROM cohort_retention
ORDER BY row_kind, metric_date, platform, context_type, task_provider;
