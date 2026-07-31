-- SPDX-License-Identifier: BUSL-1.1
-- Copyright (c) 2026 Dmitriy Lazarev
-- Use of this software is governed by the Business Source License 1.1.
-- See LICENSE in the project root for details.

-- Long-form reliability model:
--   metric rows are date/dimension rates or nearest-rank percentiles;
--   friction_signature rows are mature-session Friction Signature v1 records.
WITH eligible_turns AS (
  SELECT
    event_id,
    actor_key,
    thread_key,
    turn_key,
    session_key,
    occurred_at_ms,
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    CAST(json_extract(props_json, '$.duration_ms') AS REAL) AS turn_duration_ms
  FROM analytics_events
  WHERE event_name = 'turn_completed'
    AND actor_key IS NOT NULL
    AND actor_role IN ('admin', 'member')
    AND invocation_mode = 'normal'
    AND eligibility IN ('allowed', 'operator_basis')
),
latency_samples AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    'queue_delay_ms' AS latency_name,
    CAST(json_extract(props_json, '$.queue_wait_ms') AS REAL) AS sample_value
  FROM analytics_events
  WHERE event_name = 'turn_started'
    AND invocation_mode = 'normal'
    AND eligibility IN ('allowed', 'operator_basis')

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'first_visible_feedback_ms',
    CAST(json_extract(props_json, '$.latency_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'first_visible_feedback'
    AND json_extract(props_json, '$.outcome') = 'success'
    AND json_extract(props_json, '$.capability_supported') = 1
    AND json_extract(props_json, '$.setting_enabled') = 1
    AND json_extract(props_json, '$.latency_ms') IS NOT NULL

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'time_to_first_token_ms',
    CAST(json_extract(props_json, '$.time_to_first_token_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'llm_completed'
    AND json_extract(props_json, '$.time_to_first_token_ms') IS NOT NULL

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'time_to_first_reply_ms',
    CAST(json_extract(props_json, '$.latency_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'reply_sent'
    AND json_extract(props_json, '$.delivery') IN ('success', 'partial')

  UNION ALL

  SELECT
    metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    'turn_duration_ms',
    turn_duration_ms
  FROM eligible_turns

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'tool_duration_ms',
    CAST(json_extract(props_json, '$.duration_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND json_extract(props_json, '$.execution_outcome') <> 'permission_denied'

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'confirmation_latency_ms',
    CAST(json_extract(props_json, '$.decision_latency_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'confirmation_resolved'

  UNION ALL

  SELECT
    date(occurred_at_ms / 1000, 'unixepoch'),
    platform,
    context_type,
    task_provider,
    app_version,
    'live_status_create_latency_ms',
    CAST(json_extract(props_json, '$.latency_from_turn_start_ms') AS REAL)
  FROM analytics_events
  WHERE event_name = 'live_status_lifecycle'
    AND json_extract(props_json, '$.stage') = 'create'
    AND json_extract(props_json, '$.outcome') = 'success'
),
valid_latency_samples AS (
  SELECT *
  FROM latency_samples
  WHERE sample_value IS NOT NULL
    AND sample_value >= 0
),
ranked_latency AS (
  SELECT
    valid_latency_samples.*,
    ROW_NUMBER() OVER (
      PARTITION BY
        metric_date,
        platform,
        context_type,
        task_provider,
        app_version,
        latency_name
      ORDER BY sample_value
    ) AS sample_rank,
    COUNT(*) OVER (
      PARTITION BY
        metric_date,
        platform,
        context_type,
        task_provider,
        app_version,
        latency_name
    ) AS sample_count
  FROM valid_latency_samples
),
percentile_targets AS (
  SELECT 50 AS percentile
  UNION ALL SELECT 75
  UNION ALL SELECT 90
  UNION ALL SELECT 95
  UNION ALL SELECT 99
),
latency_percentile_metrics AS (
  SELECT
    ranked.metric_date,
    ranked.platform,
    ranked.context_type,
    ranked.task_provider,
    ranked.app_version,
    'performance' AS metric_family,
    ranked.latency_name || '_p' || targets.percentile AS metric_name,
    MAX(
      CASE
        WHEN ranked.sample_rank =
          CAST(((ranked.sample_count * targets.percentile) + 99) / 100 AS INTEGER)
          THEN ranked.sample_value
      END
    ) AS metric_value,
    MAX(
      CASE
        WHEN ranked.sample_rank =
          CAST(((ranked.sample_count * targets.percentile) + 99) / 100 AS INTEGER)
          THEN ranked.sample_value
      END
    ) AS numerator,
    MAX(ranked.sample_count) AS denominator,
    'milliseconds' AS unit,
    MAX(ranked.sample_count) AS sample_count
  FROM ranked_latency AS ranked
  CROSS JOIN percentile_targets AS targets
  GROUP BY
    ranked.metric_date,
    ranked.platform,
    ranked.context_type,
    ranked.task_provider,
    ranked.app_version,
    ranked.latency_name,
    targets.percentile
),
first_feedback_coverage AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    SUM(
      json_extract(props_json, '$.outcome') = 'success'
      AND json_extract(props_json, '$.kind') <> 'none'
    ) AS successful_feedback_count,
    COUNT(*) AS supported_turn_count
  FROM analytics_events
  WHERE event_name = 'first_visible_feedback'
    AND json_extract(props_json, '$.capability_supported') = 1
    AND json_extract(props_json, '$.setting_enabled') = 1
  GROUP BY metric_date, platform, context_type, task_provider, app_version
),
live_status_coverage AS (
  SELECT
    date(opportunities.occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    opportunities.platform,
    opportunities.context_type,
    opportunities.task_provider,
    opportunities.app_version,
    SUM(
      EXISTS (
        SELECT 1
        FROM analytics_events AS lifecycle
        WHERE lifecycle.turn_key = opportunities.turn_key
          AND lifecycle.event_name = 'live_status_lifecycle'
          AND json_extract(lifecycle.props_json, '$.stage') = 'create'
          AND json_extract(lifecycle.props_json, '$.outcome') = 'success'
      )
    ) AS successful_create_count,
    COUNT(*) AS eligible_turn_count
  FROM analytics_events AS opportunities
  WHERE opportunities.event_name = 'live_status_opportunity'
    AND json_extract(opportunities.props_json, '$.eligible') = 1
  GROUP BY
    metric_date,
    opportunities.platform,
    opportunities.context_type,
    opportunities.task_provider,
    opportunities.app_version
),
experience_coverage_metrics AS (
  SELECT
    metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    'performance' AS metric_family,
    'first_visible_feedback_coverage' AS metric_name,
    CAST(successful_feedback_count AS REAL) / supported_turn_count AS metric_value,
    CAST(successful_feedback_count AS REAL) AS numerator,
    CAST(supported_turn_count AS REAL) AS denominator,
    'rate_per_supported_turn' AS unit,
    supported_turn_count AS sample_count
  FROM first_feedback_coverage

  UNION ALL

  SELECT
    metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    'performance',
    'live_status_coverage',
    CAST(successful_create_count AS REAL) / eligible_turn_count,
    CAST(successful_create_count AS REAL),
    CAST(eligible_turn_count AS REAL),
    'rate_per_eligible_turn',
    eligible_turn_count
  FROM live_status_coverage
),
performance_metrics AS (
  SELECT * FROM latency_percentile_metrics
  UNION ALL
  SELECT * FROM experience_coverage_metrics
),
llm_starts AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    COUNT(*) AS attempt_count
  FROM analytics_events
  WHERE event_name = 'llm_started'
    AND json_extract(props_json, '$.model_role') = 'main'
  GROUP BY metric_date, platform, context_type, task_provider, app_version
),
llm_failures AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    json_extract(props_json, '$.error_class') AS error_class,
    COUNT(*) AS failure_count
  FROM analytics_events
  WHERE event_name = 'llm_failed'
    AND json_extract(props_json, '$.model_role') = 'main'
  GROUP BY metric_date, platform, context_type, task_provider, app_version, error_class
),
provider_attempts AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    json_extract(props_json, '$.provider') AS provider,
    COUNT(*) AS attempt_count
  FROM analytics_events
  WHERE event_name = 'provider_request_completed'
  GROUP BY metric_date, platform, context_type, task_provider, app_version, provider
),
provider_failures AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    json_extract(props_json, '$.provider') AS provider,
    json_extract(props_json, '$.status_class') AS status_class,
    COUNT(*) AS failure_count
  FROM analytics_events
  WHERE event_name = 'provider_request_completed'
    AND json_extract(props_json, '$.outcome') = 'failure'
  GROUP BY
    metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    provider,
    status_class
),
executed_tool_attempts AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    COUNT(*) AS attempt_count
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND json_extract(props_json, '$.execution_outcome') <> 'permission_denied'
  GROUP BY metric_date, platform, context_type, task_provider, app_version
),
tool_failures AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    json_extract(props_json, '$.execution_outcome') AS failure_kind,
    COUNT(*) AS failure_count
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND json_extract(props_json, '$.execution_outcome')
      IN ('structured_failure', 'thrown_failure')
  GROUP BY metric_date, platform, context_type, task_provider, app_version, failure_kind
),
mcp_attempts AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    COUNT(*) AS attempt_count
  FROM analytics_events
  WHERE event_name = 'mcp_availability'
  GROUP BY metric_date, platform, context_type, task_provider, app_version
),
mcp_failures AS (
  SELECT
    date(occurred_at_ms / 1000, 'unixepoch') AS metric_date,
    platform,
    context_type,
    task_provider,
    app_version,
    json_extract(props_json, '$.outcome') AS failure_kind,
    COUNT(*) AS failure_count
  FROM analytics_events
  WHERE event_name = 'mcp_availability'
    AND json_extract(props_json, '$.outcome') <> 'available'
  GROUP BY metric_date, platform, context_type, task_provider, app_version, failure_kind
),
error_metrics AS (
  SELECT
    failures.metric_date,
    failures.platform,
    failures.context_type,
    failures.task_provider,
    failures.app_version,
    'error' AS metric_family,
    'llm_failed:' || failures.error_class AS metric_name,
    NULL AS metric_provider,
    CAST(failures.failure_count AS REAL) / starts.attempt_count AS metric_value,
    CAST(failures.failure_count AS REAL) AS numerator,
    CAST(starts.attempt_count AS REAL) AS denominator,
    'rate_per_main_model_start' AS unit,
    starts.attempt_count AS sample_count
  FROM llm_failures AS failures
  JOIN llm_starts AS starts
    ON starts.metric_date = failures.metric_date
   AND starts.platform = failures.platform
   AND starts.context_type = failures.context_type
   AND starts.task_provider = failures.task_provider
   AND starts.app_version = failures.app_version

  UNION ALL

  SELECT
    failures.metric_date,
    failures.platform,
    failures.context_type,
    failures.task_provider,
    failures.app_version,
    'error',
    'provider_request_completed:' ||
      CASE failures.status_class
        WHEN '4xx' THEN 'provider_4xx'
        WHEN '5xx' THEN 'provider_5xx'
        ELSE failures.status_class
      END,
    failures.provider,
    CAST(failures.failure_count AS REAL) / attempts.attempt_count,
    CAST(failures.failure_count AS REAL),
    CAST(attempts.attempt_count AS REAL),
    'rate_per_provider_request',
    attempts.attempt_count
  FROM provider_failures AS failures
  JOIN provider_attempts AS attempts
    ON attempts.metric_date = failures.metric_date
   AND attempts.platform = failures.platform
   AND attempts.context_type = failures.context_type
   AND attempts.task_provider = failures.task_provider
   AND attempts.app_version = failures.app_version
   AND attempts.provider = failures.provider

  UNION ALL

  SELECT
    failures.metric_date,
    failures.platform,
    failures.context_type,
    failures.task_provider,
    failures.app_version,
    'error',
    'tool_completed:' || failures.failure_kind,
    NULL,
    CAST(failures.failure_count AS REAL) / attempts.attempt_count,
    CAST(failures.failure_count AS REAL),
    CAST(attempts.attempt_count AS REAL),
    'rate_per_executed_tool',
    attempts.attempt_count
  FROM tool_failures AS failures
  JOIN executed_tool_attempts AS attempts
    ON attempts.metric_date = failures.metric_date
   AND attempts.platform = failures.platform
   AND attempts.context_type = failures.context_type
   AND attempts.task_provider = failures.task_provider
   AND attempts.app_version = failures.app_version

  UNION ALL

  SELECT
    failures.metric_date,
    failures.platform,
    failures.context_type,
    failures.task_provider,
    failures.app_version,
    'error',
    'mcp_availability:' || failures.failure_kind,
    NULL,
    CAST(failures.failure_count AS REAL) / attempts.attempt_count,
    CAST(failures.failure_count AS REAL),
    CAST(attempts.attempt_count AS REAL),
    'rate_per_connection_attempt',
    attempts.attempt_count
  FROM mcp_failures AS failures
  JOIN mcp_attempts AS attempts
    ON attempts.metric_date = failures.metric_date
   AND attempts.platform = failures.platform
   AND attempts.context_type = failures.context_type
   AND attempts.task_provider = failures.task_provider
   AND attempts.app_version = failures.app_version
),
executed_tools AS (
  SELECT
    turn_key,
    occurred_at_ms,
    event_id,
    json_extract(props_json, '$.execution_outcome') AS execution_outcome
  FROM analytics_events
  WHERE event_name = 'tool_completed'
    AND turn_key IS NOT NULL
    AND json_extract(props_json, '$.execution_outcome') <> 'permission_denied'
),
sequenced_tools AS (
  SELECT
    executed_tools.*,
    LAG(execution_outcome) OVER (
      PARTITION BY turn_key
      ORDER BY occurred_at_ms, event_id
    ) AS prior_execution_outcome
  FROM executed_tools
),
turn_tool_rollup AS (
  SELECT
    turn_key,
    COUNT(*) AS executed_tool_count,
    MAX(
      execution_outcome IN ('structured_failure', 'thrown_failure')
      AND prior_execution_outcome IN ('structured_failure', 'thrown_failure')
    ) AS has_failure_chain
  FROM sequenced_tools
  GROUP BY turn_key
),
session_turn_rollup AS (
  SELECT
    session_key,
    MIN(metric_date) AS metric_date,
    MIN(platform) AS platform,
    MIN(context_type) AS context_type,
    MIN(task_provider) AS task_provider,
    MIN(app_version) AS app_version,
    MAX(occurred_at_ms) AS session_ended_at_ms,
    COUNT(DISTINCT turn_key) AS session_turn_count,
    MAX(turn_duration_ms > 30000) AS friction_l
  FROM eligible_turns
  WHERE session_key IS NOT NULL
  GROUP BY session_key
),
session_event_rollup AS (
  SELECT
    session_key,
    MAX(event_name = 'rephrase_detected') AS friction_r,
    MAX(event_name = 'clarification_abandoned') AS friction_c,
    MAX(
      event_name = 'confirmation_resolved'
      AND json_extract(props_json, '$.decision')
        IN ('denied', 'ignored', 'prompt_failed')
    ) AS friction_p,
    MAX(event_name = 'turn_stop_requested') AS friction_s,
    MAX(event_name = 'disclosure_fallback') AS friction_d,
    COUNT(DISTINCT CASE
      WHEN event_name = 'clarification_requested' THEN event_id
    END) AS clarification_opportunities,
    COUNT(DISTINCT CASE
      WHEN event_name = 'confirmation_requested' THEN event_id
    END) AS permission_opportunities
  FROM analytics_events
  WHERE session_key IS NOT NULL
  GROUP BY session_key
),
session_tool_rollup AS (
  SELECT
    turns.session_key,
    MAX(COALESCE(tools.has_failure_chain, 0)) AS friction_f,
    SUM(CASE WHEN tools.executed_tool_count >= 2 THEN 1 ELSE 0 END)
      AS failure_chain_opportunities
  FROM eligible_turns AS turns
  LEFT JOIN turn_tool_rollup AS tools
    ON tools.turn_key = turns.turn_key
  WHERE turns.session_key IS NOT NULL
  GROUP BY turns.session_key
),
data_horizon AS (
  SELECT MAX(occurred_at_ms) AS last_observed_at_ms
  FROM analytics_events
),
session_signatures AS (
  SELECT
    turns.session_key,
    turns.metric_date,
    turns.platform,
    turns.context_type,
    turns.task_provider,
    turns.app_version,
    COALESCE(events.friction_r, 0) AS friction_r,
    COALESCE(events.friction_c, 0) AS friction_c,
    COALESCE(events.friction_p, 0) AS friction_p,
    COALESCE(events.friction_s, 0) AS friction_s,
    COALESCE(turns.friction_l, 0) AS friction_l,
    COALESCE(events.friction_d, 0) AS friction_d,
    COALESCE(tools.friction_f, 0) AS friction_f,
    turns.session_turn_count,
    MAX(turns.session_turn_count - 1, 0) AS rephrase_opportunities,
    COALESCE(events.clarification_opportunities, 0) AS clarification_opportunities,
    COALESCE(events.permission_opportunities, 0) AS permission_opportunities,
    turns.session_turn_count AS stop_opportunities,
    turns.session_turn_count AS long_turn_opportunities,
    turns.session_turn_count AS disclosure_opportunities,
    COALESCE(tools.failure_chain_opportunities, 0) AS failure_chain_opportunities,
    CASE
      WHEN horizon.last_observed_at_ms >= turns.session_ended_at_ms + 86400000
        THEN 1 ELSE 0
    END AS mature_24h
  FROM session_turn_rollup AS turns
  CROSS JOIN data_horizon AS horizon
  LEFT JOIN session_event_rollup AS events
    ON events.session_key = turns.session_key
  LEFT JOIN session_tool_rollup AS tools
    ON tools.session_key = turns.session_key
),
signature_rows AS (
  SELECT
    session_signatures.*,
    friction_r + friction_c + friction_p + friction_s +
      friction_l + friction_d + friction_f AS signature_count
  FROM session_signatures
  WHERE mature_24h = 1
)
SELECT
  'metric' AS row_kind,
  metric_date,
  platform,
  context_type,
  task_provider,
  app_version,
  metric_family,
  metric_name,
  NULL AS metric_provider,
  metric_value,
  numerator,
  denominator,
  unit,
  sample_count,
  NULL AS session_key,
  NULL AS session_turn_count,
  NULL AS friction_r,
  NULL AS friction_c,
  NULL AS friction_p,
  NULL AS friction_s,
  NULL AS friction_l,
  NULL AS friction_d,
  NULL AS friction_f,
  NULL AS friction_signature_count,
  NULL AS friction_signature_100,
  NULL AS rephrase_opportunities,
  NULL AS clarification_opportunities,
  NULL AS permission_opportunities,
  NULL AS stop_opportunities,
  NULL AS long_turn_opportunities,
  NULL AS disclosure_opportunities,
  NULL AS failure_chain_opportunities,
  NULL AS mature_24h,
  NULL AS detector_coverage
FROM performance_metrics
WHERE metric_value IS NOT NULL

UNION ALL

SELECT
  'metric',
  metric_date,
  platform,
  context_type,
  task_provider,
  app_version,
  metric_family,
  metric_name,
  metric_provider,
  metric_value,
  numerator,
  denominator,
  unit,
  sample_count,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM error_metrics
WHERE metric_value IS NOT NULL

UNION ALL

SELECT
  'friction_signature',
  metric_date,
  platform,
  context_type,
  task_provider,
  app_version,
  'friction',
  'friction_signature_v1',
  NULL,
  CAST(signature_count AS REAL),
  CAST(signature_count AS REAL),
  7.0,
  'components',
  session_turn_count,
  session_key,
  session_turn_count,
  friction_r,
  friction_c,
  friction_p,
  friction_s,
  friction_l,
  friction_d,
  friction_f,
  signature_count,
  ROUND(100.0 * signature_count / 7),
  rephrase_opportunities,
  clarification_opportunities,
  permission_opportunities,
  stop_opportunities,
  long_turn_opportunities,
  disclosure_opportunities,
  failure_chain_opportunities,
  mature_24h,
  1
FROM signature_rows
ORDER BY row_kind, metric_date, metric_name, platform, context_type, task_provider;
