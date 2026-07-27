-- Model 04: reliability, friction, and performance.
-- Semantic tool outcomes with recovered-vs-first-attempt success split,
-- LLM completion with explicit failures separated from aged-open starts
-- (recently opened calls are censored, not failed), TTFT percentiles that
-- only include calls with an observed first token (missing tokens counted
-- unknown), seven turn friction bits, capability-aware live-status
-- coverage (unsupported opportunities never enter the denominator),
-- turn-duration percentiles, and reply-only failure split.

WITH meta AS (
  SELECT
    created_at_ms AS snapshot_created_at_ms,
    created_at_ms AS snap_end,
    reconciliation_status,
    snapshot_mode
  FROM snapshot_meta
  WHERE singleton_id = 1
),
tool_rollup AS (
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN prop_execution_outcome = 'semantic_success' THEN 1 ELSE 0 END) AS successes,
    SUM(CASE WHEN prop_execution_outcome = 'semantic_success' AND prop_recovered_same_turn = 1 THEN 1 ELSE 0 END) AS recovered_successes,
    SUM(CASE WHEN prop_execution_outcome = 'semantic_success' AND (prop_recovered_same_turn IS NULL OR prop_recovered_same_turn = 0) THEN 1 ELSE 0 END) AS first_attempt_successes,
    SUM(CASE WHEN prop_execution_outcome = 'structured_failure' THEN 1 ELSE 0 END) AS structured_failures,
    SUM(CASE WHEN prop_execution_outcome = 'thrown_failure' THEN 1 ELSE 0 END) AS thrown_failures
  FROM curated_events
  WHERE event_name = 'tool_completed'
),
tool_metrics(metric, numerator) AS (
  SELECT 'tool_semantic_success', successes FROM tool_rollup
  UNION ALL SELECT 'tool_structured_failure', structured_failures FROM tool_rollup
  UNION ALL SELECT 'tool_thrown_failure', thrown_failures FROM tool_rollup
  UNION ALL SELECT 'tool_success_first_attempt', first_attempt_successes FROM tool_rollup
  UNION ALL SELECT 'tool_success_recovered_same_turn', recovered_successes FROM tool_rollup
),
llm_starts AS (
  SELECT event_id, turn_key, occurred_at_ms
  FROM curated_events
  WHERE event_name = 'llm_started'
),
llm_status AS (
  SELECT
    starts.event_id,
    CASE
      WHEN completed.event_id IS NOT NULL THEN 'completed'
      WHEN failed.event_id IS NOT NULL THEN 'failed'
      WHEN starts.occurred_at_ms <= meta.snap_end - 86400000 THEN 'aged_open'
      ELSE 'open_recent'
    END AS status
  FROM llm_starts AS starts
  LEFT JOIN curated_events AS completed
    ON completed.event_name = 'llm_completed'
    AND completed.turn_key = starts.turn_key
  LEFT JOIN curated_events AS failed
    ON failed.event_name = 'llm_failed'
    AND failed.turn_key = starts.turn_key
  CROSS JOIN meta
),
llm_rollup AS (
  SELECT
    COUNT(*) AS started,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS explicit_failures,
    SUM(CASE WHEN status = 'aged_open' THEN 1 ELSE 0 END) AS aged_open,
    SUM(CASE WHEN status = 'open_recent' THEN 1 ELSE 0 END) AS open_recent
  FROM llm_status
),
llm_metrics(metric, numerator) AS (
  SELECT 'llm_completed', completed FROM llm_rollup
  UNION ALL SELECT 'llm_failed_explicit', explicit_failures FROM llm_rollup
  UNION ALL SELECT 'llm_aged_open', aged_open FROM llm_rollup
),
ttft_ranked AS (
  SELECT
    prop_time_to_first_token_ms AS ttft_ms,
    ROW_NUMBER() OVER (ORDER BY prop_time_to_first_token_ms) AS ttft_rank,
    COUNT(*) OVER () AS ttft_count
  FROM curated_events
  WHERE event_name = 'llm_completed'
    AND prop_time_to_first_token_ms IS NOT NULL
),
ttft_percentiles AS (
  SELECT
    MAX(CASE WHEN ttft_rank = CAST((ttft_count * 50 + 99) / 100 AS INTEGER) THEN ttft_ms END) AS p50,
    MAX(CASE WHEN ttft_rank = CAST((ttft_count * 75 + 99) / 100 AS INTEGER) THEN ttft_ms END) AS p75,
    MAX(CASE WHEN ttft_rank = CAST((ttft_count * 90 + 99) / 100 AS INTEGER) THEN ttft_ms END) AS p90,
    MAX(CASE WHEN ttft_rank = CAST((ttft_count * 95 + 99) / 100 AS INTEGER) THEN ttft_ms END) AS p95,
    MAX(CASE WHEN ttft_rank = CAST((ttft_count * 99 + 99) / 100 AS INTEGER) THEN ttft_ms END) AS p99,
    MAX(ttft_count) AS sample_count
  FROM ttft_ranked
),
ttft_missing AS (
  SELECT COUNT(*) AS missing_count
  FROM curated_events
  WHERE event_name = 'llm_completed'
    AND prop_time_to_first_token_ms IS NULL
),
duration_ranked AS (
  SELECT
    prop_duration_ms AS duration_ms,
    ROW_NUMBER() OVER (ORDER BY prop_duration_ms) AS duration_rank,
    COUNT(*) OVER () AS duration_count
  FROM curated_events
  WHERE event_name = 'turn_completed'
    AND prop_duration_ms IS NOT NULL
),
duration_percentiles AS (
  SELECT
    MAX(CASE WHEN duration_rank = CAST((duration_count * 50 + 99) / 100 AS INTEGER) THEN duration_ms END) AS p50,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 75 + 99) / 100 AS INTEGER) THEN duration_ms END) AS p75,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 90 + 99) / 100 AS INTEGER) THEN duration_ms END) AS p90,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 95 + 99) / 100 AS INTEGER) THEN duration_ms END) AS p95,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 99 + 99) / 100 AS INTEGER) THEN duration_ms END) AS p99,
    MAX(duration_count) AS sample_count
  FROM duration_ranked
),
friction_bits(bit, numerator) AS (
  SELECT 'rephrase', SUM(rephrase) FROM curated_turn_friction
  UNION ALL SELECT 'clarification_abandoned', SUM(clarification_abandoned) FROM curated_turn_friction
  UNION ALL SELECT 'permission_issue', SUM(permission_issue) FROM curated_turn_friction
  UNION ALL SELECT 'stop', SUM(stop) FROM curated_turn_friction
  UNION ALL SELECT 'long_turn', SUM(long_turn) FROM curated_turn_friction
  UNION ALL SELECT 'disclosure_fallback', SUM(disclosure_fallback) FROM curated_turn_friction
  UNION ALL SELECT 'failure_chain', SUM(failure_chain) FROM curated_turn_friction
),
friction_total AS (
  SELECT COUNT(*) AS turn_count FROM curated_turn_friction
),
status_opportunities AS (
  SELECT
    event_id,
    turn_key,
    prop_capability_supported AS supported
  FROM curated_events
  WHERE event_name = 'live_status_opportunity'
),
status_rollup AS (
  SELECT
    COUNT(*) AS opportunities,
    SUM(CASE WHEN supported = 1 THEN 1 ELSE 0 END) AS supported_opportunities,
    SUM(CASE WHEN supported = 1 AND shown.turn_key IS NOT NULL THEN 1 ELSE 0 END) AS shown_supported,
    SUM(CASE WHEN supported = 0 OR supported IS NULL THEN 1 ELSE 0 END) AS unsupported_opportunities
  FROM status_opportunities
  LEFT JOIN (
    SELECT DISTINCT turn_key
    FROM curated_events
    WHERE event_name = 'live_status_lifecycle'
  ) AS shown
    ON shown.turn_key = status_opportunities.turn_key
),
status_metrics(metric, numerator, denominator) AS (
  SELECT 'live_status_shown_when_supported', shown_supported, supported_opportunities FROM status_rollup
  UNION ALL SELECT 'live_status_unsupported', unsupported_opportunities, opportunities FROM status_rollup
),
failed_turns AS (
  SELECT turn_key
  FROM curated_events
  WHERE event_name = 'turn_completed'
    AND prop_result = 'failed'
),
reply_rollup AS (
  SELECT
    COUNT(*) AS failed_total,
    SUM(CASE WHEN EXISTS (
      SELECT 1
      FROM curated_events AS replies
      WHERE replies.event_name = 'reply_sent'
        AND replies.turn_key = failed_turns.turn_key
    ) THEN 1 ELSE 0 END) AS failed_with_reply
  FROM failed_turns
),
reply_metrics(metric, numerator) AS (
  SELECT 'turn_failed_reply_only', failed_with_reply FROM reply_rollup
  UNION ALL SELECT 'turn_failed_without_reply', failed_total - failed_with_reply FROM reply_rollup
)

SELECT
  'tool_outcome' AS row_kind,
  tool_metrics.metric,
  'available' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  CASE
    WHEN tool_rollup.total >= 30
      THEN ROUND(CAST(tool_metrics.numerator AS REAL) / tool_rollup.total, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  tool_metrics.numerator,
  tool_rollup.total AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN tool_rollup.total < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM tool_metrics
CROSS JOIN tool_rollup
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'llm_outcome' AS row_kind,
  llm_metrics.metric,
  'available' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  CASE
    WHEN llm_rollup.started - llm_rollup.open_recent >= 30
      THEN ROUND(CAST(llm_metrics.numerator AS REAL) / (llm_rollup.started - llm_rollup.open_recent), 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  llm_metrics.numerator,
  llm_rollup.started - llm_rollup.open_recent AS denominator,
  0 AS unknown_count,
  llm_rollup.open_recent AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN llm_rollup.started - llm_rollup.open_recent < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM llm_metrics
CROSS JOIN llm_rollup
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'llm_ttft' AS row_kind,
  'time_to_first_token_ms' AS metric,
  'available' AS availability,
  NULL AS friction_bit,
  ttft_percentiles.p50,
  ttft_percentiles.p75,
  ttft_percentiles.p90,
  ttft_percentiles.p95,
  ttft_percentiles.p99,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  ttft_percentiles.sample_count AS numerator,
  ttft_percentiles.sample_count AS denominator,
  ttft_missing.missing_count AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN ttft_percentiles.sample_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM ttft_percentiles
CROSS JOIN ttft_missing
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'turn_duration' AS row_kind,
  'turn_duration_ms' AS metric,
  'available' AS availability,
  NULL AS friction_bit,
  duration_percentiles.p50,
  duration_percentiles.p75,
  duration_percentiles.p90,
  duration_percentiles.p95,
  duration_percentiles.p99,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  duration_percentiles.sample_count AS numerator,
  duration_percentiles.sample_count AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN duration_percentiles.sample_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM duration_percentiles
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'turn_friction' AS row_kind,
  'turn_friction_bit' AS metric,
  'available' AS availability,
  friction_bits.bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  CASE
    WHEN friction_total.turn_count >= 30
      THEN ROUND(CAST(friction_bits.numerator AS REAL) / friction_total.turn_count, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  friction_bits.numerator,
  friction_total.turn_count AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN friction_total.turn_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM friction_bits
CROSS JOIN friction_total
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'live_status' AS row_kind,
  status_metrics.metric,
  'available' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  CASE
    WHEN status_metrics.denominator >= 30
      THEN ROUND(CAST(status_metrics.numerator AS REAL) / status_metrics.denominator, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  status_metrics.numerator,
  status_metrics.denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN status_metrics.denominator < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM status_metrics
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'reply_failure' AS row_kind,
  reply_metrics.metric,
  'available' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  CASE
    WHEN reply_rollup.failed_total >= 30
      THEN ROUND(CAST(reply_metrics.numerator AS REAL) / reply_rollup.failed_total, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  reply_metrics.numerator,
  reply_rollup.failed_total AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN reply_rollup.failed_total < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM reply_metrics
CROSS JOIN reply_rollup
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'unavailable' AS row_kind,
  'reliability_friction_performance' AS metric,
  'unavailable_aggregate_only_snapshot' AS availability,
  NULL AS friction_bit,
  NULL AS p50,
  NULL AS p75,
  NULL AS p90,
  NULL AS p95,
  NULL AS p99,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  NULL AS window_end_utc,
  0 AS numerator,
  0 AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  1 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM meta
WHERE meta.snapshot_mode = 'aggregate_only'

ORDER BY row_kind, metric, friction_bit
