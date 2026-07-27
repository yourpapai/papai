-- Model 02: retention and engagement.
-- Weekly cohort retention (returned-by D1/D7/D30 measured from each actor's own
-- onboarding timestamp, never from the cohort window start), UTC DAU/WAU/MAU
-- with stickiness, conversation-session volume/duration/turns from
-- sessionization.v1, weekly engagement per platform, new/returning weekly
-- activity mix via consecutive-week streaks, tenure bands from cohort age,
-- same-platform send/receive pairing, and send-after-receive latency
-- percentiles. Horizons not yet observable at the snapshot cut are censored
-- (denominator 0, censored_count > 0) instead of being misreported as zero
-- retention, and a withdrawal starting on or before a horizon is censoring,
-- never churn.

WITH RECURSIVE meta AS (
  SELECT
    created_at_ms AS snapshot_created_at_ms,
    reconciliation_status,
    snapshot_mode
  FROM snapshot_meta
  WHERE singleton_id = 1
),
snap AS (
  SELECT created_at_ms AS snap_end
  FROM snapshot_meta
  WHERE singleton_id = 1
),
onboarded AS (
  SELECT
    actor_key,
    MIN(occurred_at_ms) AS onboard_ms
  FROM curated_events
  WHERE event_name = 'onboarding_completed'
    AND prop_result = 'completed'
    AND actor_key IS NOT NULL
  GROUP BY actor_key
),
actor_cohort AS (
  SELECT
    actor_key,
    onboard_ms,
    date(onboard_ms / 1000, 'unixepoch', 'weekday 1', '-7 days') AS cohort_week
  FROM onboarded
),
msg AS (
  SELECT
    actor_key,
    platform,
    event_name,
    occurred_at_ms,
    date(occurred_at_ms / 1000, 'unixepoch', 'weekday 1', '-7 days') AS iso_week
  FROM curated_events
  WHERE event_name IN ('message_received', 'message_sent')
    AND actor_key IS NOT NULL
),
withdrawn AS (
  SELECT
    actor_key,
    MIN(start_ms) AS withdrawn_ms
  FROM curated_censor_intervals
  WHERE kind = 'withdrawal'
  GROUP BY actor_key
),
horizons AS (
  SELECT 1 AS horizon_days
  UNION ALL SELECT 7
  UNION ALL SELECT 30
),
retention AS (
  SELECT
    actor_cohort.cohort_week,
    horizons.horizon_days,
    COUNT(*) AS cohort_size,
    SUM(CASE
      WHEN actor_cohort.onboard_ms + horizons.horizon_days * 86400000 <= snap.snap_end
        AND NOT EXISTS (
          SELECT 1
          FROM withdrawn
          WHERE withdrawn.actor_key = actor_cohort.actor_key
            AND withdrawn.withdrawn_ms <= actor_cohort.onboard_ms + horizons.horizon_days * 86400000
        )
        THEN 1 ELSE 0 END) AS eligible,
    SUM(CASE
      WHEN actor_cohort.onboard_ms + horizons.horizon_days * 86400000 <= snap.snap_end
        AND NOT EXISTS (
          SELECT 1
          FROM withdrawn
          WHERE withdrawn.actor_key = actor_cohort.actor_key
            AND withdrawn.withdrawn_ms <= actor_cohort.onboard_ms + horizons.horizon_days * 86400000
        )
        AND EXISTS (
          SELECT 1
          FROM msg
          WHERE msg.actor_key = actor_cohort.actor_key
            AND msg.event_name = 'message_received'
            AND msg.occurred_at_ms >= actor_cohort.onboard_ms + horizons.horizon_days * 86400000
        )
        THEN 1 ELSE 0 END) AS returned
  FROM actor_cohort
  CROSS JOIN horizons
  CROSS JOIN snap
  GROUP BY actor_cohort.cohort_week, horizons.horizon_days
),
utc_windows AS (
  SELECT
    date(snap.snap_end / 1000, 'unixepoch') AS utc_day,
    (SELECT COUNT(DISTINCT exact_day.actor_key)
     FROM msg AS exact_day
     WHERE date(exact_day.occurred_at_ms / 1000, 'unixepoch') = date(snap.snap_end / 1000, 'unixepoch')) AS dau,
    (SELECT COUNT(DISTINCT rolling_week.actor_key)
     FROM msg AS rolling_week
     WHERE date(rolling_week.occurred_at_ms / 1000, 'unixepoch')
       BETWEEN date(snap.snap_end / 1000, 'unixepoch', '-6 days') AND date(snap.snap_end / 1000, 'unixepoch')) AS wau,
    (SELECT COUNT(DISTINCT rolling_month.actor_key)
     FROM msg AS rolling_month
     WHERE date(rolling_month.occurred_at_ms / 1000, 'unixepoch')
       BETWEEN date(snap.snap_end / 1000, 'unixepoch', '-29 days') AND date(snap.snap_end / 1000, 'unixepoch')) AS mau
  FROM snap
),
session_stats AS (
  SELECT
    COUNT(*) AS session_count,
    COUNT(DISTINCT actor_key) AS session_actors,
    SUM(turn_count) AS total_turns
  FROM curated_sessions
),
session_durations AS (
  SELECT
    duration_ms / 1000.0 AS duration_seconds,
    ROW_NUMBER() OVER (ORDER BY duration_ms) AS duration_rank,
    COUNT(*) OVER () AS duration_count
  FROM curated_sessions
),
session_duration_percentiles AS (
  SELECT
    MAX(CASE WHEN duration_rank = CAST((duration_count * 50 + 99) / 100 AS INTEGER)
      THEN duration_seconds END) AS p50_seconds,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 75 + 99) / 100 AS INTEGER)
      THEN duration_seconds END) AS p75_seconds,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 90 + 99) / 100 AS INTEGER)
      THEN duration_seconds END) AS p90_seconds,
    MAX(CASE WHEN duration_rank = CAST((duration_count * 95 + 99) / 100 AS INTEGER)
      THEN duration_seconds END) AS p95_seconds,
    MAX(duration_count) AS duration_count
  FROM session_durations
),
weekly_engagement AS (
  SELECT
    iso_week,
    platform,
    COUNT(DISTINCT actor_key) AS unique_active_actors,
    SUM(CASE WHEN event_name = 'message_received' THEN 1 ELSE 0 END) AS msg_received_rows,
    SUM(CASE WHEN event_name = 'message_sent' THEN 1 ELSE 0 END) AS msg_sent_rows
  FROM msg
  GROUP BY iso_week, platform
),
last_week AS (
  SELECT actor_key, MAX(iso_week) AS wk
  FROM msg
  GROUP BY actor_key
),
streak_walk(actor_key, wk) AS (
  SELECT actor_key, wk FROM last_week
  UNION ALL
  SELECT
    streak_walk.actor_key,
    date(streak_walk.wk, '-7 days')
  FROM streak_walk
  WHERE EXISTS (
    SELECT 1
    FROM msg
    WHERE msg.actor_key = streak_walk.actor_key
      AND msg.iso_week = date(streak_walk.wk, '-7 days')
  )
),
streaks AS (
  SELECT actor_key, COUNT(*) AS week_streak
  FROM streak_walk
  GROUP BY actor_key
),
activity_mix AS (
  SELECT
    SUM(CASE WHEN onboarded.actor_key IS NOT NULL AND streaks.week_streak = 1 THEN 1 ELSE 0 END) AS new_actors,
    SUM(CASE WHEN onboarded.actor_key IS NOT NULL AND streaks.week_streak >= 2 THEN 1 ELSE 0 END) AS returning_actors,
    SUM(CASE WHEN onboarded.actor_key IS NULL THEN 1 ELSE 0 END) AS tenure_unknown_actors,
    COUNT(*) AS total_actors
  FROM streaks
  LEFT JOIN onboarded
    ON onboarded.actor_key = streaks.actor_key
),
max_week AS (
  SELECT MAX(iso_week) AS wk FROM msg
),
tenure AS (
  SELECT
    actor_cohort.actor_key,
    CAST((julianday(max_week.wk) - julianday(actor_cohort.cohort_week)) / 7 AS INTEGER) AS weeks_since_onboard
  FROM actor_cohort
  CROSS JOIN max_week
),
tenure_bands AS (
  SELECT
    CASE
      WHEN weeks_since_onboard < 1 THEN '<1w'
      WHEN weeks_since_onboard < 2 THEN '1_2w'
      WHEN weeks_since_onboard < 4 THEN '2_4w'
      WHEN weeks_since_onboard < 12 THEN '4_12w'
      ELSE '12w_plus'
    END AS tenure_band,
    COUNT(*) AS actors
  FROM tenure
  GROUP BY 1
),
tenure_total AS (
  SELECT COUNT(*) AS total_actors FROM tenure
),
platform_dirs AS (
  SELECT
    actor_key,
    platform,
    MAX(CASE WHEN event_name = 'message_received' THEN 1 ELSE 0 END) AS has_received,
    MAX(CASE WHEN event_name = 'message_sent' THEN 1 ELSE 0 END) AS has_sent
  FROM msg
  GROUP BY actor_key, platform
),
pairing AS (
  SELECT
    platform,
    SUM(CASE WHEN has_received = 1 AND has_sent = 1 THEN 1 ELSE 0 END) AS paired_actors,
    COUNT(*) AS active_actors
  FROM platform_dirs
  GROUP BY platform
),
latencies AS (
  SELECT
    sent.actor_key,
    sent.occurred_at_ms - MAX(received.occurred_at_ms) AS latency_ms
  FROM msg AS sent
  JOIN msg AS received
    ON received.actor_key = sent.actor_key
    AND received.platform = sent.platform
    AND received.event_name = 'message_received'
    AND received.occurred_at_ms <= sent.occurred_at_ms
    AND sent.occurred_at_ms - received.occurred_at_ms <= 604800000
  WHERE sent.event_name = 'message_sent'
  GROUP BY sent.actor_key, sent.occurred_at_ms
),
latency_ranked AS (
  SELECT
    latency_ms / 1000.0 AS latency_seconds,
    ROW_NUMBER() OVER (ORDER BY latency_ms) AS latency_rank,
    COUNT(*) OVER () AS latency_count
  FROM latencies
),
latency_percentiles AS (
  SELECT
    MAX(CASE WHEN latency_rank = CAST((latency_count * 50 + 99) / 100 AS INTEGER)
      THEN latency_seconds END) AS p50_seconds,
    MAX(CASE WHEN latency_rank = CAST((latency_count * 90 + 99) / 100 AS INTEGER)
      THEN latency_seconds END) AS p90_seconds,
    MAX(latency_count) AS latency_count
  FROM latency_ranked
)

SELECT
  'cohort_retention' AS row_kind,
  'returned_by_d' || retention.horizon_days AS metric,
  'available' AS availability,
  NULL AS platform,
  retention.cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN retention.eligible >= 30
      THEN ROUND(CAST(retention.returned AS REAL) / retention.eligible, 4)
  END AS rate,
  1 AS metric_version,
  retention.cohort_week AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  retention.returned AS numerator,
  retention.eligible AS denominator,
  0 AS unknown_count,
  retention.cohort_size - retention.eligible AS censored_count,
  NULL AS eligibility_coverage,
  CASE
    WHEN retention.eligible >= 30
      THEN ROUND(
        (CAST(retention.returned AS REAL) / retention.eligible + 3.8416 / (2.0 * retention.eligible)
         - 1.96 * sqrt(
             CAST(retention.returned AS REAL) / retention.eligible
               * (1.0 - CAST(retention.returned AS REAL) / retention.eligible) / retention.eligible
             + 3.8416 / (4.0 * retention.eligible * retention.eligible)))
        / (1.0 + 3.8416 / retention.eligible)
      , 4)
  END AS wilson_low,
  CASE
    WHEN retention.eligible >= 30
      THEN ROUND(
        (CAST(retention.returned AS REAL) / retention.eligible + 3.8416 / (2.0 * retention.eligible)
         + 1.96 * sqrt(
             CAST(retention.returned AS REAL) / retention.eligible
               * (1.0 - CAST(retention.returned AS REAL) / retention.eligible) / retention.eligible
             + 3.8416 / (4.0 * retention.eligible * retention.eligible)))
        / (1.0 + 3.8416 / retention.eligible)
      , 4)
  END AS wilson_high,
  CASE WHEN retention.eligible < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM retention
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'utc_engagement' AS row_kind,
  'dau' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  utc_windows.utc_day AS window_start_utc,
  utc_windows.utc_day AS window_end_utc,
  utc_windows.dau AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM utc_windows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'utc_engagement' AS row_kind,
  'wau' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  date(utc_windows.utc_day, '-6 days') AS window_start_utc,
  utc_windows.utc_day AS window_end_utc,
  utc_windows.wau AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM utc_windows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'utc_engagement' AS row_kind,
  'mau' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  date(utc_windows.utc_day, '-29 days') AS window_start_utc,
  utc_windows.utc_day AS window_end_utc,
  utc_windows.mau AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM utc_windows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'utc_engagement' AS row_kind,
  'stickiness' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN utc_windows.mau >= 30
      THEN ROUND(CAST(utc_windows.dau AS REAL) / utc_windows.mau, 4)
  END AS rate,
  1 AS metric_version,
  date(utc_windows.utc_day, '-29 days') AS window_start_utc,
  utc_windows.utc_day AS window_end_utc,
  utc_windows.dau AS numerator,
  utc_windows.mau AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN utc_windows.mau < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM utc_windows
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'conversation_sessions' AS row_kind,
  'sessions_per_actor' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN session_stats.session_actors >= 30
      THEN ROUND(CAST(session_stats.session_count AS REAL) / session_stats.session_actors, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  session_stats.session_count AS numerator,
  session_stats.session_actors AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN session_stats.session_actors < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM session_stats
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'conversation_sessions' AS row_kind,
  'turns_per_session' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN session_stats.session_count >= 30
      THEN ROUND(CAST(session_stats.total_turns AS REAL) / session_stats.session_count, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  COALESCE(session_stats.total_turns, 0) AS numerator,
  session_stats.session_count AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN session_stats.session_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM session_stats
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'session_duration_seconds' AS row_kind,
  'session_duration' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  session_duration_percentiles.p50_seconds,
  session_duration_percentiles.p75_seconds,
  session_duration_percentiles.p90_seconds,
  session_duration_percentiles.p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  session_duration_percentiles.duration_count AS numerator,
  session_duration_percentiles.duration_count AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN session_duration_percentiles.duration_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM session_duration_percentiles
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'
  AND session_duration_percentiles.duration_count > 0

UNION ALL

SELECT
  'weekly_engagement' AS row_kind,
  'weekly_engagement' AS metric,
  'available' AS availability,
  weekly_engagement.platform,
  NULL AS cohort_week,
  weekly_engagement.iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  weekly_engagement.iso_week AS window_start_utc,
  date(weekly_engagement.iso_week, '+6 days') AS window_end_utc,
  weekly_engagement.unique_active_actors AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM weekly_engagement
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'weekly_engagement_volume' AS row_kind,
  'weekly_engagement' AS metric,
  'available' AS availability,
  weekly_engagement.platform,
  NULL AS cohort_week,
  weekly_engagement.iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  weekly_engagement.iso_week AS window_start_utc,
  date(weekly_engagement.iso_week, '+6 days') AS window_end_utc,
  weekly_engagement.msg_received_rows AS numerator,
  weekly_engagement.msg_sent_rows AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM weekly_engagement
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'activity_mix' AS row_kind,
  'weekly_activity_mix' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  activity_mix.returning_actors,
  activity_mix.tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN activity_mix.total_actors >= 30
      THEN ROUND(CAST(activity_mix.new_actors AS REAL) / activity_mix.total_actors, 4)
  END AS rate,
  1 AS metric_version,
  date(snap.snap_end / 1000, 'unixepoch', 'weekday 1', '-7 days') AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  activity_mix.new_actors AS numerator,
  activity_mix.total_actors AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN activity_mix.total_actors < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM activity_mix
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'tenure_band' AS row_kind,
  'weeks_since_onboard' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  tenure_bands.tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN tenure_total.total_actors >= 30
      THEN ROUND(CAST(tenure_bands.actors AS REAL) / tenure_total.total_actors, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  tenure_bands.actors AS numerator,
  tenure_total.total_actors AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM tenure_bands
CROSS JOIN tenure_total
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'cross_platform_actor' AS row_kind,
  'same_platform_send_receive_pairing' AS metric,
  'available' AS availability,
  pairing.platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
  CASE
    WHEN pairing.active_actors >= 30
      THEN ROUND(CAST(pairing.paired_actors AS REAL) / pairing.active_actors, 4)
  END AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  pairing.paired_actors AS numerator,
  pairing.active_actors AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN pairing.active_actors < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM pairing
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'message_latency_seconds' AS row_kind,
  'message_latency' AS metric,
  'available' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  latency_percentiles.p50_seconds,
  NULL AS p75_seconds,
  latency_percentiles.p90_seconds,
  NULL AS p95_seconds,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(snap.snap_end / 1000, 'unixepoch') AS window_end_utc,
  latency_percentiles.latency_count AS numerator,
  latency_percentiles.latency_count AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  CASE WHEN latency_percentiles.latency_count < 30 THEN 1 ELSE 0 END AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM latency_percentiles
CROSS JOIN snap
CROSS JOIN meta
WHERE meta.snapshot_mode = 'pseudonymous'

UNION ALL

SELECT
  'unavailable' AS row_kind,
  'retention_engagement' AS metric,
  'unavailable_aggregate_only_snapshot' AS availability,
  NULL AS platform,
  NULL AS cohort_week,
  NULL AS iso_week,
  NULL AS tenure_band,
  NULL AS week_streak,
  NULL AS returning_actors,
  NULL AS tenure_unknown_actors,
  NULL AS p50_seconds,
  NULL AS p75_seconds,
  NULL AS p90_seconds,
  NULL AS p95_seconds,
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

ORDER BY row_kind, metric, cohort_week, iso_week, platform, tenure_band
