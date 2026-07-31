<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# OpenPanel synthetic forwarding PoC

This PoC maps the reviewed 17,183-row synthetic canonical fixture into
OpenPanel server events, sends them to a numeric-loopback-only pinned stack, and
tracks delivery in a separate SQLite ledger. It also provisions a
synthetic-only dashboard through the pinned image's internal tRPC API.

The live run delivered all source events to OpenPanel. The local ledger holds
17,182 acknowledged rows and one intentionally simulated ambiguous
acknowledgement. Aggregate ClickHouse reconciliation found all 17,183 unique
diagnostic event IDs, no missing IDs, and no duplicates. Rerunning the same
sink/ledger attempted zero events.

This proves the PoC transport and local replay policy. It does not make
OpenPanel eligible for production pseudonymous analytics.

## Contract

Every outbound request is:

```json
{
  "type": "track",
  "payload": {
    "name": "turn_completed",
    "profileId": "synthetic pseudonym, eligible rows only",
    "properties": {
      "__timestamp": "2026-05-01T10:00:00.000Z",
      "event_id": "diagnostic only",
      "schema_version": 1
    }
  }
}
```

The mapper validates the full canonical row and canonical per-event property
allowlist. It omits `profileId` for every aggregate, guest, and system row.
Aggregate rows carrying any actor/context/thread/task/turn/session continuity
fail closed. Raw identity and content fields are never forwarded.

`event_id` is an ordinary diagnostic property. OpenPanel does not document a
caller-controlled event ID or idempotency key.

## Start the pinned stack

The committed [`stack/compose.yaml`](stack/compose.yaml) pins every image by
registry digest, publishes only `127.0.0.1:4400`, and keeps PostgreSQL, Redis,
and ClickHouse on the private Compose network. Docker with Compose v2,
`openssl`, and `sed` are required.

From the repository root, create the ignored local environment without
printing its cookie secret, validate the resolved Compose model, and start it:

```bash
PAPAI_OPENPANEL_STACK_DIR="$(pwd)/docs/research/analytics-metrics/poc/openpanel/stack"
PAPAI_OPENPANEL_COOKIE_SECRET="$(openssl rand -hex 32)"
sed \
  "s/REPLACE_WITH_64_HEX_RANDOM_VALUE/$PAPAI_OPENPANEL_COOKIE_SECRET/" \
  "$PAPAI_OPENPANEL_STACK_DIR/.env.example" \
  >"$PAPAI_OPENPANEL_STACK_DIR/.env"
unset PAPAI_OPENPANEL_COOKIE_SECRET
chmod 600 "$PAPAI_OPENPANEL_STACK_DIR/.env"

docker compose \
  -f "$PAPAI_OPENPANEL_STACK_DIR/compose.yaml" \
  config --quiet
docker compose \
  -f "$PAPAI_OPENPANEL_STACK_DIR/compose.yaml" \
  pull
docker compose \
  -f "$PAPAI_OPENPANEL_STACK_DIR/compose.yaml" \
  up -d --wait
curl --fail --silent --show-error http://127.0.0.1:4400/api/healthcheck
```

Open `http://127.0.0.1:4400` and create the first local account. The pinned
server permits the first account even though later open registration is
disabled. Create the synthetic project with ID `papai-analytics-poc`. Keep the
resulting Netscape cookie jar outside the repository; the commands below use
`/private/tmp/papai-analytics-research/openpanel.cookies`.

## Delivery ledger

The caller supplies a SQLite file that must differ from the source fixture.
`openpanel_delivery_ledger` is keyed by `(event_id, sink_id)` and stores only:

- `pending`, `delivered`, `ambiguous`, or `dead`;
- bounded per-sink attempt count;
- last attempt/delivery timestamps; and
- a controlled error class.

It stores no request body, response body, credential, profile ID, or raw
exception. Known 200/202 acknowledgements suppress ordinary replay.
Network-unknown and simulated lost acknowledgements become `ambiguous` and are
not automatically retried. Explicit retryable HTTP failures remain pending
until `--max-attempts`, then become dead.

## Run the forwarder

The stack must expose only `127.0.0.1:4400`. The current external ingestion
route is `/api/track`; the proxy strips `/api` before the API container.

Create a disposable write client through authenticated `client.create`.
OpenPanel returns its secret only once. Hold the returned ID in a shell
variable, export the secret only as `OPENPANEL_CLIENT_SECRET`, and remove the
client through `client.remove` after reconciliation. Never print or commit the
create response.

```bash
export PAPAI_ANALYTICS_FIXTURE=/private/tmp/papai-analytics-canonical-reviewed.sqlite
export PAPAI_OPENPANEL_LEDGER=/private/tmp/papai-openpanel-delivery.sqlite
export PAPAI_OPENPANEL_CLIENT_ID='<one-time write client id>'
export OPENPANEL_CLIENT_SECRET='<one-time write client secret>'

bun docs/research/analytics-metrics/poc/openpanel/cli.ts \
  --source "$PAPAI_ANALYTICS_FIXTURE" \
  --ledger "$PAPAI_OPENPANEL_LEDGER" \
  --client-id "$PAPAI_OPENPANEL_CLIENT_ID" \
  --sink-id openpanel-local-full-v1 \
  --concurrency 12 \
  --max-attempts 3 \
  --timeout-ms 10000 \
  --simulate-ambiguous-successes 1 \
  --evidence /absolute/path/to/live-forwarder-initial.json
```

Run the same command again with the same ledger and sink ID, changing only the
evidence path. The expected rerun has `attempted: 0` and `enqueued: 0`.

The client ID and secret are present only in the two OpenPanel authentication
headers. The URL, request body, console output, ledger, and evidence omit both
credentials. Each request has a bounded abort timeout and refuses redirects.
The transport rejects `localhost` and other resolver-dependent names; use the
numeric loopback URL exactly as shown.

## Provision the dashboard

The provisioner reads a Netscape cookie jar, extracts only the `session`
cookie, and sends it only in the protected tRPC `Cookie` header. It creates or
updates one exact-name dashboard and four reports, uses `p-limit(2)` for report
mutations, creates a public synthetic-only share, and verifies dashboard,
report-list, and share queries before writing a manifest.

```bash
bun docs/research/analytics-metrics/poc/openpanel/dashboard-cli.ts \
  --cookie-jar /private/tmp/papai-analytics-research/openpanel.cookies \
  --project-id papai-analytics-poc \
  --evidence /absolute/path/to/dashboard-manifest.json
```

The reports are:

1. activation funnel — a 14-day OpenPanel-native approximation;
2. event retention — explicitly not papai Sessionization v1;
3. top classified intents by controlled `primary`; and
4. LLM/tool/provider/MCP controlled error facts.

The pinned image incorrectly coerced a legacy `6m` saved-report range to
`30d`, so the reproducible specifications use `12m` to cover the May–June
fixture. The internal tRPC contract can drift across image updates.

## Live evidence

Committed-safe files are under [`evidence/`](evidence/):

- source and ledger: 17,183 total, 17,182 delivered, one ambiguous, zero
  pending/dead, 17,183 attempts;
- rerun: zero attempts and zero enqueues;
- ClickHouse: 17,183 rows and 17,183 unique diagnostic event IDs;
- protected `event.events`: only 16,573 rows over 336 pages, 610 short;
- one-profile export: 20 records despite metadata claiming 88 and one page;
- profile delete probe: HTTP 404, with no complete per-profile erasure route;
- exact dashboard `[SYNTHETIC ONLY] papai analytics PoC`: four reports and a
  public numeric-loopback share; and
- service-native report queries: retention 47 cohort rows, intents 23 series,
  and errors six series.

The `event.events` cursor contains only `created_at`, so rows sharing a
timestamp at 50-row page boundaries are skipped. It is not a deterministic
reconciliation API. Backend aggregate comparison was required to establish
that ingestion was complete.

Historical server events older than 15 minutes do not create OpenPanel native
sessions. The live native funnel consequently collapsed to one session and
100% at every step. That is evidence that the native funnel cannot represent
the reviewed papai activation or sessionization models.

No screenshot is present. The browser connector was unavailable and the
pinned OpenPanel image exposes no native dashboard PNG/PDF export.

## Re-run deterministic reconciliation

The following commands recompute source/ledger counts and compare the complete
set of diagnostic event IDs directly with ClickHouse. The temporary directory
is removed on exit and no event-level rows are committed.

```bash
PAPAI_OPENPANEL_SOURCE=/absolute/path/to/analytics.sqlite
PAPAI_OPENPANEL_LEDGER=/absolute/path/to/papai-openpanel-delivery.sqlite
PAPAI_OPENPANEL_STACK_DIR="$(pwd)/docs/research/analytics-metrics/poc/openpanel/stack"
PAPAI_OPENPANEL_RECON_DIR="$(mktemp -d /private/tmp/papai-openpanel-recon.XXXXXX)"
trap 'rm -rf "$PAPAI_OPENPANEL_RECON_DIR"' EXIT

sqlite3 -readonly "$PAPAI_OPENPANEL_SOURCE" \
  'SELECT event_id FROM analytics_events ORDER BY event_id;' \
  >"$PAPAI_OPENPANEL_RECON_DIR/source.ids"
sqlite3 -readonly "$PAPAI_OPENPANEL_LEDGER" \
  "SELECT state, COUNT(*) AS rows, SUM(attempts) AS attempts
   FROM openpanel_delivery_ledger
   WHERE sink_id = 'openpanel-local-full-v1'
   GROUP BY state
   ORDER BY state;"
docker compose \
  -f "$PAPAI_OPENPANEL_STACK_DIR/compose.yaml" \
  exec -T op-ch clickhouse-client --database openpanel --query \
  "SELECT properties['event_id'] FROM events
   WHERE project_id = 'papai-analytics-poc'
   ORDER BY properties['event_id']
   FORMAT TabSeparatedRaw" \
  >"$PAPAI_OPENPANEL_RECON_DIR/remote.ids"

wc -l \
  "$PAPAI_OPENPANEL_RECON_DIR/source.ids" \
  "$PAPAI_OPENPANEL_RECON_DIR/remote.ids"
comm -23 \
  "$PAPAI_OPENPANEL_RECON_DIR/source.ids" \
  "$PAPAI_OPENPANEL_RECON_DIR/remote.ids" | wc -l
comm -13 \
  "$PAPAI_OPENPANEL_RECON_DIR/source.ids" \
  "$PAPAI_OPENPANEL_RECON_DIR/remote.ids" | wc -l
docker compose \
  -f "$PAPAI_OPENPANEL_STACK_DIR/compose.yaml" \
  exec -T op-ch clickhouse-client --database openpanel --query \
  "SELECT count() AS event_rows,
          uniqExact(properties['event_id']) AS unique_event_ids,
          count() - uniqExact(properties['event_id']) AS duplicate_rows
   FROM events
   WHERE project_id = 'papai-analytics-poc'
   FORMAT JSONEachRow"
```

Expected results for the reviewed run are 17,183 lines in each file, zero
missing, zero unexpected, 17,183 aggregate rows, 17,183 unique IDs, and zero
duplicates. The ledger query reports one ambiguous row with one attempt and
17,182 delivered rows with 17,182 attempts. This backend comparison is the
deterministic remote reconciliation. It does not imply destination
idempotency.

The remaining protected-API and chart observations are a pinned-image probe
protocol, not an automated evidence regenerator. To repeat the protected API
limitation, call `event.events` through
[`trpc.ts`](trpc.ts) with `{projectId, cursor}` until `meta.next` is null,
using the previous `meta.next` as the next cursor. Use a 50-row page, count
only returned rows, and never persist event bodies. The pinned router's cursor
contains only `created_at`; the reviewed run returned 16,573 rows over 336
pages. For the profile-export probe, create a disposable `read` or `root`
client, call `GET /api/export/events?projectId=papai-analytics-poc&limit=1000`
with one in-memory synthetic `profileId`, record only `meta` and returned
counts, and remove the client. The observed 20/88 mismatch and
`DELETE /api/profile` HTTP 404 are negative capability evidence, not supported
reconciliation or erasure mechanisms.

Dashboard provisioning is regenerated by the command above. Re-query each
manifest report through `chart.funnel`, `chart.cohort`, or `chart.aggregate`
according to its chart type; record only result shapes/counts as in
`dashboard-query-evidence.json`. Verify the public route with:

```bash
PAPAI_OPENPANEL_SHARE_URL="$(
  jq -r '.share.url' \
    docs/research/analytics-metrics/poc/openpanel/evidence/dashboard-manifest.json
)"
curl --fail --silent --show-error \
  --output /dev/null \
  "$PAPAI_OPENPANEL_SHARE_URL"
```

The committed protected-API, profile, erasure, and chart-query JSON records the
reviewed run. No committed command automatically regenerates those two
aggregate evidence files; repeating the protocol therefore requires a new
manual review before replacing them.

## Verify committed evidence

`verify-evidence.sh` is deliberately offline. It reconciles the committed run
and remote-observation summaries with the supplied source/ledger, validates
cross-file dashboard identities, and scans the JSON for prohibited values. It
does not contact Docker or OpenPanel and must not be described as a live probe.

```bash
bun test docs/research/analytics-metrics/poc/openpanel/*.test.ts
bun run typecheck
bunx oxlint --config .oxlintrc.json \
  docs/research/analytics-metrics/poc/openpanel
bunx oxfmt --check docs/research/analytics-metrics/poc/openpanel
sh docs/research/analytics-metrics/poc/openpanel/verify-evidence.sh \
  /absolute/path/to/analytics.sqlite \
  /absolute/path/to/papai-openpanel-delivery.sqlite
```

## Production gate

The production pseudonymous sink gate remains failed:

- no caller-controlled destination idempotency;
- incomplete timestamp-cursor event export;
- incomplete profile-filtered export;
- no supported complete per-profile erasure;
- server/historical event sessions do not match papai Sessionization v1; and
- dashboard/report provisioning relies on an internal version-specific API.

The PoC is synthetic-only and numeric-loopback-only. It must not be adapted to real
papai events without a separately approved capability, privacy, deletion,
retention, and threat-model review.
