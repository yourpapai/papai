#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo '{"code":"USAGE_SOURCE_AND_LEDGER_REQUIRED","status":"error"}' >&2
  exit 2
fi

source_db=$1
ledger_db=$2
case "$source_db:$ledger_db" in
  /*:/*) ;;
  *)
    echo '{"code":"ABSOLUTE_PATHS_REQUIRED","status":"error"}' >&2
    exit 2
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
evidence_dir="$script_dir/evidence"
sink_id=openpanel-local-full-v1

source_rows=$(sqlite3 -readonly "$source_db" 'SELECT COUNT(*) FROM analytics_events;')
source_unique=$(sqlite3 -readonly "$source_db" 'SELECT COUNT(DISTINCT event_id) FROM analytics_events;')
source_hash=$(shasum -a 256 "$source_db" | awk '{print $1}')
ledger_values=$(sqlite3 -readonly "$ledger_db" "
  SELECT
    COUNT(*),
    COALESCE(SUM(state = 'delivered'), 0),
    COALESCE(SUM(state = 'ambiguous'), 0),
    COALESCE(SUM(state = 'pending'), 0),
    COALESCE(SUM(state = 'dead'), 0),
    COALESCE(SUM(attempts), 0)
  FROM openpanel_delivery_ledger
  WHERE sink_id = '$sink_id';
")

old_ifs=$IFS
IFS='|'
set -- $ledger_values
IFS=$old_ifs
ledger_total=$1
ledger_delivered=$2
ledger_ambiguous=$3
ledger_pending=$4
ledger_dead=$5
ledger_attempts=$6

jq -e \
  --arg source_hash "$source_hash" \
  --argjson source_rows "$source_rows" \
  --argjson ledger_total "$ledger_total" \
  --argjson ledger_delivered "$ledger_delivered" \
  --argjson ledger_ambiguous "$ledger_ambiguous" \
  --argjson ledger_pending "$ledger_pending" \
  --argjson ledger_dead "$ledger_dead" \
  --argjson ledger_attempts "$ledger_attempts" \
  '
    .schema == "papai.openpanel.poc.run.v1" and
    .synthetic_only == true and
    .source.fixture_sha256 == $source_hash and
    .source.source_events == $source_rows and
    .source.selected_events == $source_rows and
    .delivery.ledger.total == $ledger_total and
    .delivery.ledger.delivered == $ledger_delivered and
    .delivery.ledger.ambiguous == $ledger_ambiguous and
    .delivery.ledger.pending == $ledger_pending and
    .delivery.ledger.dead == $ledger_dead and
    .delivery.ledger.attempts == $ledger_attempts and
    .delivery.ledger.total ==
      (.delivery.ledger.delivered + .delivery.ledger.ambiguous +
       .delivery.ledger.pending + .delivery.ledger.dead)
  ' "$evidence_dir/live-forwarder-initial.json" >/dev/null

jq -e \
  --argjson source_rows "$source_rows" \
  --argjson source_unique "$source_unique" \
  --argjson ledger_total "$ledger_total" \
  --argjson ledger_delivered "$ledger_delivered" \
  --argjson ledger_ambiguous "$ledger_ambiguous" \
  --argjson ledger_pending "$ledger_pending" \
  --argjson ledger_dead "$ledger_dead" \
  --argjson ledger_attempts "$ledger_attempts" \
  '
    .schema == "papai.openpanel.poc.reconciliation.v1" and
    .synthetic_only == true and
    .source.event_rows == $source_rows and
    .source.unique_event_ids == $source_unique and
    .delivery_ledger.total == $ledger_total and
    .delivery_ledger.delivered == $ledger_delivered and
    .delivery_ledger.ambiguous == $ledger_ambiguous and
    .delivery_ledger.pending == $ledger_pending and
    .delivery_ledger.dead == $ledger_dead and
    .delivery_ledger.attempts == $ledger_attempts and
    .protected_event_events_api.rows_returned +
      .protected_event_events_api.shortfall_vs_source == $source_rows and
    .clickhouse_aggregate.event_rows == $source_rows and
    .clickhouse_aggregate.unique_diagnostic_event_ids == $source_unique and
    .clickhouse_aggregate.source_event_ids_missing == 0 and
    .clickhouse_aggregate.duplicate_diagnostic_event_id_rows == 0 and
    .clickhouse_aggregate.matches_source == true
  ' "$evidence_dir/remote-reconciliation.json" >/dev/null

jq -e '
  .schema == "papai.openpanel.poc.run.v1" and
  .synthetic_only == true and
  .delivery.this_run.attempted == 0 and
  .delivery.this_run.enqueued == 0
' "$evidence_dir/live-forwarder-rerun.json" >/dev/null

jq -e \
  --slurpfile query "$evidence_dir/dashboard-query-evidence.json" \
  '
    .schema == "papai.openpanel.poc.dashboard.v1" and
    .synthetic_only == true and
    .dashboard.id == $query[0].evaluated_dashboard.id and
    .dashboard.name == $query[0].evaluated_dashboard.name and
    .share.id == $query[0].share.id and
    .share.url == $query[0].share.url and
    .verification.report_count == 4 and
    all(
      .dashboard.reports[];
      . as $manifest_report |
      any(
        $query[0].evaluated_dashboard.reports[];
        .id == $manifest_report.id and
        .name == $manifest_report.name and
        .chart_type == $manifest_report.chart_type
      )
    )
  ' "$evidence_dir/dashboard-manifest.json" >/dev/null

if grep -E -r \
  'sec_[0-9a-f]{20}|syn_[0-9a-f]{32}|openpanel-client-secret|session=' \
  "$evidence_dir"/*.json >/dev/null; then
  echo '{"code":"EVIDENCE_CONTAINS_PROHIBITED_VALUE","status":"error"}' >&2
  exit 1
fi

echo '{"schema":"papai.openpanel.poc.evidence-verification.v1","status":"ok","synthetic_only":true}'
