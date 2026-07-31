-- Model 03: intents and features.
-- Intent classification buckets (unknown / no_action / multi_goal / single),
-- classification coverage (non-unknown / classified) segmented by strategy,
-- per-goal attainment over mature attempts (immature attempts are censored,
-- never counted as failures), fractional goal attribution (each goal in a
-- multi-goal turn earns 1/N of the turn), feature adoption against
-- opportunity denominators, unavailable-opportunity reasons, and
-- exposure-arm D30 retention that is explicitly non-causal and suppressed
-- unless every arm has at least 100 actors.

WITH meta AS (
  SELECT
    created_at_ms AS snapshot_created_at_ms,
    created_at_ms AS snap_end,
    reconciliation_status,
    snapshot_mode
  FROM snapshot_meta
  WHERE singleton_id = 1
),
intent_events AS (
  SELECT
    event_id,
    prop_primary_intent AS primary_intent,
    prop_abstained AS abstained,
    prop_goals_json AS goals_json,
    prop_strategy AS strategy
  FROM curated_events
  WHERE event_name = 'intent_classified'
),
intent_buckets AS (
  SELECT
    CASE
      WHEN primary_intent = 'unknown' OR abstained = 1 THEN 'unknown'
      WHEN primary_intent = 'no_action' THEN 'no_action'
      WHEN goals_json IS NOT NULL AND json_array_length(goals_json) > 1 THEN 'multi_goal'
      ELSE 'classified_single'
    END AS bucket
  FROM intent_events
),
intent_bucket_rows AS (
  SELECT
    bucket,
    COUNT(*) AS intents,
    (SELECT COUNT(*) FROM intent_buckets) AS total_intents
  FROM intent_buckets
  GROUP BY bucket
),
strategy_coverage AS (
  SELECT
    COALESCE(strategy, 'missing_strategy') AS strategy,
    COUNT(*) AS classified,
    SUM(CASE WHEN primary_intent = 'unknown' OR abstained = 1 THEN 0 ELSE 1 END) AS non_unknown
  FROM intent_events
  GROUP BY COALESCE(strategy, 'missing_strategy')
),
goal_turn_sizes AS (
  SELECT turn_key, COUNT(*) AS goals_in_turn
  FROM curated_goal_attempts
  GROUP BY turn_key
),
goal_rows AS (
  SELECT
    attempts.goal,
    SUM(CASE WHEN attempts.mature_at_ms <= meta.snap_end AND attempts.outcome = 'attained' THEN 1 ELSE 0 END) AS attained,
    SUM(CASE WHEN attempts.mature_at_ms <= meta.snap_end THEN 1 ELSE 0 END) AS mature_attempts,
    SUM(CASE WHEN attempts.mature_at_ms > meta.snap_end THEN 1 ELSE 0 END) AS censored_attempts,
    SUM(CASE WHEN attempts.mature_at_ms <= meta.snap_end AND attempts.outcome = 'attained'
      THEN 1.0 / goal_turn_sizes.goals_in_turn ELSE 0 END) AS fractional_attained,
    SUM(CASE WHEN attempts.mature_at_ms <= meta.snap_end
      THEN 1.0 / goal_turn_sizes.goals_in_turn ELSE 0 END) AS fractional_attempts
  FROM curated_goal_attempts AS attempts
  JOIN goal_turn_sizes
    ON goal_turn_sizes.turn_key = attempts.turn_key
  CROSS JOIN meta
  GROUP BY attempts.goal
),
opportunity_actors AS (
  SELECT
    feature,
    COUNT(DISTINCT actor_key) AS opportunity_actors,
    COUNT(DISTINCT CASE WHEN available = 1 THEN actor_key END) AS available_actors
  FROM curated_feature_opportunity_days
  GROUP BY feature
),
adopted_actors AS (
  SELECT
    feature,
    COUNT(DISTINCT actor_key) AS adopted_actors
  FROM curated_feature_use_days
  WHERE adopted = 1
  GROUP BY feature
),
unavailable_reasons AS (
  SELECT
    feature,
    reason,
    COUNT(DISTINCT actor_key) AS actors
  FROM curated_feature_opportunity_days
  WHERE available = 0
  GROUP BY feature, reason
),
actor_d30 AS (
  SELECT
    onboarded.actor_key,
    MAX(CASE
      WHEN EXISTS (
        SELECT 1
        FROM curated_events AS received
        WHERE received.event_name = 'message_received'
          AND received.actor_key = onboarded.actor_key
          AND received.occurred_at_ms >= onboarded.onboard_ms + 30 * 86400000
      )
      THEN 1 ELSE 0 END) AS d30_retained
  FROM (
    SELECT actor_key, MIN(occurred_at_ms) AS onboard_ms
    FROM curated_events
    WHERE event_name = 'onboarding_completed'
      AND prop_result = 'completed'
      AND actor_key IS NOT NULL
    GROUP BY actor_key
  ) AS onboarded
  CROSS JOIN meta
  WHERE onboarded.onboard_ms + 30 * 86400000 <= meta.snap_end
  GROUP BY onboarded.actor_key
),
exposure_arms AS (
  SELECT
    opportunities.feature,
    CASE WHEN adopted.actor_key IS NOT NULL THEN 'used' ELSE 'not_used' END AS arm,
    COUNT(*) AS arm_actors,
    SUM(COALESCE(actor_d30.d30_retained, 0)) AS d30_retained
  FROM (
    SELECT DISTINCT feature, actor_key
    FROM curated_feature_opportunity_days
    WHERE available = 1
  ) AS opportunities
  LEFT JOIN (
    SELECT DISTINCT feature, actor_key
    FROM curated_feature_use_days
    WHERE adopted = 1
  ) AS adopted
    ON adopted.feature = opportunities.feature
    AND adopted.actor_key = opportunities.actor_key
  LEFT JOIN actor_d30
    ON actor_d30.actor_key = opportunities.actor_key
  GROUP BY opportunities.feature, arm
)

SELECT
  'intent_classification' AS row_kind,
  'intent_classification' AS metric,
  'available' AS availability,
  intent_bucket_rows.bucket,
  NULL AS goal,
  NULL AS feature,
  NULL AS arm,
  NULL AS suppression_reason,
  CASE
    WHEN intent_bucket_rows.total_intents >= 30
      THEN ROUND(CAST(intent_bucket_rows.intents AS REAL) / intent_bucket_rows.total_intents, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  intent_bucket_rows.intents AS numerator,
  intent_bucket_rows.total_intents AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN intent_bucket_rows.total_intents < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM intent_bucket_rows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'classification_coverage' AS row_kind,
  'classification_coverage' AS metric,
  'available' AS availability,
  strategy_coverage.strategy AS bucket,
  NULL AS goal,
  NULL AS feature,
  NULL AS arm,
  NULL AS suppression_reason,
  CASE
    WHEN strategy_coverage.classified >= 30
      THEN ROUND(CAST(strategy_coverage.non_unknown AS REAL) / strategy_coverage.classified, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  strategy_coverage.non_unknown AS numerator,
  strategy_coverage.classified AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN strategy_coverage.classified < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM strategy_coverage
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'goal_attainment' AS row_kind,
  'goal_attainment' AS metric,
  'available' AS availability,
  NULL AS bucket,
  goal_rows.goal,
  NULL AS feature,
  NULL AS arm,
  NULL AS suppression_reason,
  CASE
    WHEN goal_rows.mature_attempts >= 30
      THEN ROUND(CAST(goal_rows.attained AS REAL) / goal_rows.mature_attempts, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  goal_rows.attained AS numerator,
  goal_rows.mature_attempts AS denominator,
  0 AS unknown_count,
  goal_rows.censored_attempts AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN goal_rows.mature_attempts < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM goal_rows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'goal_attainment' AS row_kind,
  'goal_attainment_fractional' AS metric,
  'available' AS availability,
  NULL AS bucket,
  goal_rows.goal,
  NULL AS feature,
  NULL AS arm,
  NULL AS suppression_reason,
  CASE
    WHEN goal_rows.mature_attempts >= 30 AND goal_rows.fractional_attempts > 0
      THEN ROUND(goal_rows.fractional_attained / goal_rows.fractional_attempts, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  goal_rows.fractional_attained AS numerator,
  goal_rows.fractional_attempts AS denominator,
  0 AS unknown_count,
  goal_rows.censored_attempts AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN goal_rows.mature_attempts < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM goal_rows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'feature_adoption' AS row_kind,
  'feature_adoption' AS metric,
  'available' AS availability,
  NULL AS bucket,
  NULL AS goal,
  opportunity_actors.feature,
  NULL AS arm,
  NULL AS suppression_reason,
  CASE
    WHEN opportunity_actors.available_actors >= 30
      THEN ROUND(CAST(COALESCE(adopted_actors.adopted_actors, 0) AS REAL) / opportunity_actors.available_actors, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  COALESCE(adopted_actors.adopted_actors, 0) AS numerator,
  opportunity_actors.available_actors AS denominator,
  opportunity_actors.opportunity_actors - opportunity_actors.available_actors AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN opportunity_actors.available_actors < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM opportunity_actors
LEFT JOIN adopted_actors
  ON adopted_actors.feature = opportunity_actors.feature
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'feature_unavailable' AS row_kind,
  'feature_opportunity_unavailable' AS metric,
  'available' AS availability,
  NULL AS bucket,
  NULL AS goal,
  unavailable_reasons.feature,
  unavailable_reasons.reason AS arm,
  NULL AS suppression_reason,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  unavailable_reasons.actors AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM unavailable_reasons
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'non_causal_d30' AS row_kind,
  'non_causal_d30_retained' AS metric,
  'non_causal_associational' AS availability,
  NULL AS bucket,
  NULL AS goal,
  exposure_arms.feature,
  exposure_arms.arm,
  CASE WHEN exposure_arms.arm_actors < 100 THEN 'exposure_arm_below_100' END AS suppression_reason,
  CASE
    WHEN exposure_arms.arm_actors >= 100
      THEN ROUND(CAST(exposure_arms.d30_retained AS REAL) / exposure_arms.arm_actors, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  exposure_arms.d30_retained AS numerator,
  exposure_arms.arm_actors AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN exposure_arms.arm_actors < 100 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM exposure_arms
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'unavailable' AS row_kind,
  'intents_features' AS metric,
  'unavailable_aggregate_only_snapshot' AS availability,
  NULL AS bucket,
  NULL AS goal,
  NULL AS feature,
  NULL AS arm,
  NULL AS suppression_reason,
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

ORDER BY row_kind, metric, bucket, goal, feature, arm
