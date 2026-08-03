-- Model 00: data health.
-- Snapshot freshness against the last observed event, normalization
-- rejections, restart gaps and late events from daily counters, censor
-- intervals, the storage generation being served, query-timing sample
-- depth from histograms, and publication suppression where contributor
-- counts fall below the disclosure threshold. This model reads the
-- aggregate tables and therefore stays available in aggregate-only
-- snapshots; actor-level freshness degrades to unknown there.

WITH meta AS (
  SELECT
    created_at_ms AS snapshot_created_at_ms,
    created_at_ms AS snap_end,
    storage_generation,
    reconciliation_status,
    snapshot_mode
  FROM snapshot_meta
  WHERE singleton_id = 1
),
last_event AS (
  SELECT MAX(occurred_at_ms) AS last_observed_at
  FROM curated_events
),
rejection_rollup AS (
  SELECT
    source_event_type,
    reason,
    SUM(count) AS rejections,
    MIN(utc_day) AS first_day,
    MAX(utc_day) AS last_day
  FROM analytics_normalization_rejections
  GROUP BY source_event_type, reason
),
gap_rollup AS (
  SELECT
    SUM(restart_gap_detected) AS restart_gaps,
    SUM(late_event_count) AS late_events,
    COUNT(*) AS counter_rows
  FROM analytics_daily_counters
),
censor_rollup AS (
  SELECT
    kind,
    COUNT(*) AS intervals
  FROM curated_censor_intervals
  GROUP BY kind
),
timing_rollup AS (
  SELECT
    metric,
    SUM(sample_count) AS samples
  FROM analytics_daily_histograms
  GROUP BY metric
),
publication_rollup AS (
  SELECT
    SUM(CASE WHEN contributor_count IS NOT NULL AND threshold IS NOT NULL AND contributor_count < threshold THEN 1 ELSE 0 END) AS suppressed_rows,
    SUM(CASE WHEN contributor_count IS NOT NULL AND threshold IS NOT NULL AND contributor_count >= threshold THEN 1 ELSE 0 END) AS published_rows
  FROM analytics_daily_counters
)

SELECT
  'snapshot_freshness' AS row_kind,
  'snapshot_age_ms' AS metric,
  'available' AS availability,
  NULL AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  date(COALESCE(last_event.last_observed_at, meta.snap_end) / 1000, 'unixepoch') AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  CASE WHEN last_event.last_observed_at IS NOT NULL
    THEN meta.snap_end - last_event.last_observed_at END AS numerator,
  NULL AS denominator,
  CASE WHEN last_event.last_observed_at IS NULL THEN 1 ELSE 0 END AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM meta
CROSS JOIN last_event

UNION ALL

SELECT
  'normalization_rejection' AS row_kind,
  'normalization_rejections' AS metric,
  'available' AS availability,
  rejection_rollup.source_event_type || ':' || rejection_rollup.reason AS dimension,
  rejection_rollup.last_day AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  rejection_rollup.first_day AS window_start_utc,
  rejection_rollup.last_day AS window_end_utc,
  rejection_rollup.rejections AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM rejection_rollup
CROSS JOIN meta

UNION ALL

SELECT
  'restart_gap' AS row_kind,
  'restart_gap_detected' AS metric,
  'available' AS availability,
  NULL AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  gap_rollup.restart_gaps AS numerator,
  gap_rollup.counter_rows AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM gap_rollup
CROSS JOIN meta

UNION ALL

SELECT
  'restart_gap' AS row_kind,
  'late_events' AS metric,
  'available' AS availability,
  NULL AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  gap_rollup.late_events AS numerator,
  gap_rollup.counter_rows AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM gap_rollup
CROSS JOIN meta

UNION ALL

SELECT
  'censor_interval' AS row_kind,
  'censor_intervals' AS metric,
  'available' AS availability,
  censor_rollup.kind AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  censor_rollup.intervals AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM censor_rollup
CROSS JOIN meta

UNION ALL

SELECT
  'storage' AS row_kind,
  'storage_generation' AS metric,
  'available' AS availability,
  meta.storage_generation AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  1 AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM meta

UNION ALL

SELECT
  'query_timing' AS row_kind,
  'histogram_samples' AS metric,
  'available' AS availability,
  timing_rollup.metric AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  timing_rollup.samples AS numerator,
  NULL AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM timing_rollup
CROSS JOIN meta

UNION ALL

SELECT
  'publication_suppression' AS row_kind,
  'publication_suppressed' AS metric,
  'available' AS availability,
  NULL AS dimension,
  NULL AS utc_day,
  NULL AS rate,
  1 AS metric_version,
  NULL AS window_start_utc,
  date(meta.snap_end / 1000, 'unixepoch') AS window_end_utc,
  publication_rollup.suppressed_rows AS numerator,
  publication_rollup.suppressed_rows + publication_rollup.published_rows AS denominator,
  0 AS unknown_count,
  0 AS censored_count,
  NULL AS eligibility_coverage,
  NULL AS wilson_low,
  NULL AS wilson_high,
  0 AS suppressed,
  meta.snapshot_created_at_ms,
  meta.reconciliation_status
FROM publication_rollup
CROSS JOIN meta

ORDER BY row_kind, metric, dimension
