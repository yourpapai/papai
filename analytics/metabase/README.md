# Metabase models for the curated analytics snapshot

These SQL models run against the read-only curated snapshot published by
`scripts/analytics-snapshot.ts`. They never touch the live database: connect
Metabase to the published SQLite file (read-only) and paste each model as a
native SQL question.

## Contract

- Every row carries the honesty block: `metric_version`, `window_start_utc`,
  `window_end_utc`, `numerator`, `denominator`, `unknown_count`,
  `censored_count`, `eligibility_coverage`, `wilson_low`, `wilson_high`,
  `suppressed`, `snapshot_created_at_ms`, `reconciliation_status`.
- No rate is shown below a denominator of 30 (`suppressed = 1`,
  `rate IS NULL`). Wilson bounds use z = 1.96 and are only emitted when the
  rate is shown.
- Exposure-arm comparisons (model 03 `non_causal_d30`) additionally require
  at least 100 actors per arm and are always labeled
  `non_causal_associational`.
- Models 01–04 emit only `unavailable` rows against an `aggregate_only`
  snapshot instead of approximating actor-level metrics. Model 00 stays
  available in both modes and degrades freshness to `unknown_count = 1`.
- Immature or unobservable windows are censored (`censored_count`,
  denominator 0), never reported as zero.

## Models

| File                                      | Covers                                                                                                                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-data-health.sql`                      | snapshot freshness, normalization rejections, restart gaps/late events, censor intervals, storage generation, histogram sample depth, publication suppression                                   |
| `01-activation.sql`                       | first authorized DM cohort funnel (config link → settings → task assignment → first mutating success → activation), cohort rates, p50/p90 minutes-to-activation                                 |
| `02-retention-engagement.sql`             | weekly cohort retention (returned-by D1/D7/D30 from each actor's own onboarding), weekly engagement per platform, activity mix, tenure bands, same-platform pairing, message latency            |
| `03-intents-features.sql`                 | intent classification buckets, mature goal attainment (+ fractional multi-goal attribution), feature adoption vs opportunity denominators, unavailable reasons, non-causal exposure-arm D30     |
| `04-reliability-friction-performance.sql` | semantic tool outcomes (first-attempt vs recovered), LLM explicit vs aged-open failures, TTFT/turn-duration percentiles, seven friction bits, capability-aware live status, reply-only failures |
