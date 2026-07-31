<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Provider scorecard and proof of concept

**Evaluation date:** 2026-07-23  
**Decision:** Metabase OSS is the default local BI surface. OpenPanel is the
self-hosted product-analytics **PoC candidate**, not yet an approved
pseudonymous sink. Mixpanel is the best evaluated SaaS alternative only after
an operator clears egress, residency, processor, consent, deletion, and
security gates.

## Decision gates

A weighted total does not override a failed architectural gate.

| Path | Hard gate |
|---|---|
| Default local BI | No event egress; reads a local/read-only source; can represent RQ1–RQ8; curated models are usable by a product/UX practitioner |
| Self-hosted product analytics | Ordered funnels, arbitrary-event retention, content-free server ingestion, operator-owned residency, replay correctness, and per-actor deletion across all key versions |
| SaaS product analytics | Product gates plus explicit opt-in, residency selection, processor/DPA and security review, deletion/export procedure, strict egress allowlist |
| Any forwarded sink | Retry/replay correctness through documented destination idempotency or a papai delivery ledger plus reconciliation |

Web-traffic products that cannot express papai's behavioral questions fail the
product gate even if they are simple to operate. SaaS fails the default path
regardless of convenience.

## Weighted scorecard

Scores are 1–5. The total is
`sum(weight × score / 5)`, out of 100.

| Criterion | Weight | A score of 5 means |
|---|---:|---|
| Privacy, deployment, residency (`P`) | 18 | Fully self-hostable, no required egress, operator controls residency |
| RQ1–RQ8 analytical coverage (`A`) | 20 | Can represent all requested scenario, activation, outcome, friction, error, retention, adoption, and performance analyses |
| SQLite/source and ingestion fit (`S`) | 12 | Official direct SQLite or documented historical/batch server import |
| Replay/idempotency correctness (`I`) | 10 | Deterministic direct querying or documented stable event deduplication |
| Product/UX usability (`U`) | 10 | Strong self-service exploration over reviewed models/cohorts |
| Operational burden (`O`) | 12 | Few stateful services and a well-supported deployment |
| License/edition clarity (`L`) | 7 | Clear separate-service license and feature boundary |
| Cost/TCO (`C`) | 6 | Useful free/self-hosted tier and predictable cost |
| Longevity/maintenance (`M`) | 5 | Mature, actively maintained project/vendor |

| Rank | Candidate | Class | P | A | S | I | U | O | L | C | M | Total | Gate/result |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | **Metabase OSS** | BI | 5 | 4.5 | 5 | 5 | 4.5 | 4 | 4.5 | 5 | 5 | **93.9** | **Recommended local BI** |
| 2 | Apache Superset | BI | 5 | 4.5 | 4.5 | 5 | 3.5 | 2.5 | 5 | 5 | 5 | **87.8** | Viable, heavier/steeper |
| 3 | Grafana OSS | BI/ops | 5 | 3.5 | 4 | 5 | 3 | 4.5 | 4.5 | 5 | 5 | **85.7** | Optional operations overlay |
| 4 | Mixpanel | product SaaS | 1.5 | 5 | 5 | 5 | 5 | 5 | 2 | 4 | 5 | **82.0** | Best SaaS if egress is approved |
| 5 | Amplitude | product SaaS | 1.5 | 5 | 5 | 4.5 | 5 | 5 | 2 | 4 | 5 | **81.0** | Strong SaaS; seven-day documented dedupe window |
| 6 | **OpenPanel** | product self-host | 5 | 4.5 | 4 | 2 | 4.5 | 2.5 | 5 | 4.5 | 3.5 | **80.5** | **PoC candidate; pinned-release deletion/idempotency gates failed** |
| 7 | Umami | product-lite/web | 5 | 3 | 3.5 | 2 | 4.5 | 4 | 5 | 5 | 4.5 | **78.5** | Light fallback; narrower retention/cohorts |
| 8 | PostHog | product self-host | 4.5 | 5 | 4 | 2 | 4.5 | 1 | 3 | 3 | 5 | **74.0** | Unsupported and operationally heavy |
| 9 | Matomo On-Premise core | web | 5 | 2.5 | 3.5 | 2 | 4 | 3 | 4 | 3 | 5 | **69.8** | Product analysis requires paid plugins |
| 10 | Plausible CE | web | 5 | 1.5 | 3 | 2 | 4.5 | 2.5 | 5 | 5 | 4.5 | **67.7** | Fails native product-analysis gate |
| 11 | Countly Lite | product-lite | 5 | 3 | 3.5 | 2 | 4 | 2.5 | 2 | 2.5 | 4.5 | **66.7** | License/edition split is a poor fit |

### Sensitivity

A directional sensitivity check shifting weight toward privacy/local operation
kept Metabase first. A separate product-depth check kept OpenPanel the
highest-ranked self-hosted event product and Mixpanel highest when SaaS was
allowed. These alternative weights are not binding scorecards, so this report
does not present unreproducible decimal totals for them. The hard production
gates remain decisive under every weighting.

## Provider findings

### Metabase OSS

- Current self-hosted Metabase has an **official SQLite driver** accepting an
  absolute filename. SQLite is unavailable in Metabase Cloud, which is
  irrelevant to the local path.
- Product semantics are SQL/model-driven rather than native. Publish reviewed
  activation, retention, intent/adoption, and reliability/friction models,
  then expose those models—not raw JSON—to non-engineer query-builder users.
- Query a transactionally copied, read-only snapshot rather than papai's live
  writer file. Display snapshot time, source row count, and reconciliation
  status on every dashboard.
- A durable deployment must use PostgreSQL/MySQL/MariaDB for the Metabase
  application database. Embedded H2 is limited to this disposable PoC.
- AGPL OSS and commercial code have an explicit edition boundary. Run Metabase
  as a separate service.

### OpenPanel

- OpenPanel is AGPL and says self-hosting has no intentional product feature
  split from Cloud. Native funnels, arbitrary-event retention, behavioral
  cohorts, journeys, profiles, sessions, and dashboards fit RQ2/RQ6/RQ7.
- The supported Compose path includes PostgreSQL, Redis, ClickHouse, API,
  worker, dashboard, and proxy. “Medium” is relative to PostHog; it is not
  operationally light.
- The server track API supports `track`, `identify`, and groups, but the public
  contract reviewed on 2026-07-23 does **not** document a caller-controlled
  event ID or idempotency key. A custom `event_id` property is diagnostic, not
  deduplication.
- The public API documents profile-filtered export and whole-project deletion,
  but no supported operation that erases every event/profile/session derived
  from one supplied `profileId`. Until a pinned integration proves a supported
  per-actor erasure path, OpenPanel cannot receive pseudonymous production
  events under this report's withdrawal/DSAR contract.
- Papai therefore suppresses replay after a known acknowledgement, records
  ambiguous delivery, and reconciles destination counts through a
  `(event_id, sink_id)` delivery ledger.
- OpenPanel's own documentation says server events and events older than 15
  minutes do not create sessions. A historical server import can validate
  event funnels/retention, but it cannot validate papai Sessionization v1 or
  OpenPanel native sessions.
- Self-hosting preserves operator residency but does not remove the need for
  notice, eligibility, retention, deletion, RBAC, and content-free mapping.

### PostHog

PostHog has excellent funnels, retention, paths, and cohorts, but its current
official documentation says open-source self-hosting is **unsupported**:
no version tags, CVE notifications, or instance support; deployments track the
latest code and contain only free-plan features. The documented stack also
includes ClickHouse, Kafka, ZooKeeper, Redis, PostgreSQL, MinIO, and multiple
application services, with a 4-vCPU/16-GB/30-GB minimum-equivalent host.
Product depth does not outweigh this support and operations risk for papai.

### Lightweight and web-oriented candidates

- **Umami v3** is PostgreSQL-only and now includes funnels, journeys,
  retention, goals, and simple cohorts. Its fixed first-visit daily retention
  and basic cohort semantics make it a fallback when OpenPanel's stack is too
  costly, not the full-depth selection.
- **Matomo core** has strong privacy/on-premise heritage, but funnels, cohorts,
  and user flow are paid plugins.
- **Plausible CE** is a capable privacy web-traffic product; funnels/user
  journeys are not a Community Edition product-analysis surface.
- **Countly Lite** uses a modified license/edition split and gates key
  behavioral analysis.

### BI alternatives

- **Grafana** is a useful RQ5/RQ8 overlay. Its SQLite data source is a
  community plugin with filesystem and `ATTACH` risks; ClickHouse is official.
  Product funnels/cohorts remain hand-authored and less approachable than
  curated Metabase models.
- **Superset** officially supports SQLite, contrary to the original “needs a
  warehouse” note. It is powerful but adds a steeper administration/modeling
  surface and commonly adds metadata DB, Redis, and Celery for production
  features.

### SaaS

- **Mixpanel** has the strongest evaluated replay contract. Its import API
  requires `$insert_id`, documents duplicate identity, accepts historical
  batches, and is safe to retry. Partial failures require per-record state.
- **Amplitude** recommends `insert_id` but documents duplicate suppression only
  for the same insert/device identity during a seven-day window.
- Both are proprietary processors and external egress. Neither is default
  eligible. A future SaaS experiment must set IP collection off where
  supported and clear the privacy/security gates in
  [`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md).

## Storage-layer choice

### MVP

```text
papai SQLite (authoritative event IDs)
  └─ transactionally copied read-only snapshot
       └─ Metabase official SQLite driver

canonical event outbox (optional and default-off)
  └─ bounded forwarder + per-sink ledger
            └─ self-hosted OpenPanel PoC
```

DuckDB adds refresh, schema, freshness, and reconciliation work while Metabase
already reads SQLite officially. Introduce it later only for Parquet export,
expensive offline marts, multi-file joins, or a BI consumer that cannot safely
read SQLite.

ClickHouse is justified only after two consecutive review periods show that
an indexed/read-only SQLite snapshot misses a defined p95 dashboard SLO,
snapshot work affects papai, or model/replay time exceeds its recovery SLO.
Try indexes, scheduled snapshots, reduced scan windows, and materialized
rollups before adding a distributed serving store.

## PoC boundary and source

The provider PoCs use the same deterministic 50-day synthetic fixture:

- exactly 200 fake actors across four platforms, DMs/groups, both task
  providers, and `none`;
- controlled activation drop-off, exact D1/D7/D30 fixtures, success/failure/
  recovery, feature adoption, error clusters, latency, and friction;
- deterministic primary-key event IDs, duplicate insert attempts, and
  out-of-order source order;
- no real database, actor, content, raw identifier, token, endpoint credential,
  URL, filename, project/task name, or provider object name.

The generator, assertions, and reviewed SQL are in
[`poc/fixture/`](./poc/fixture/) and
[`poc/metabase/sql/`](./poc/metabase/sql/).

## Metabase PoC

The executable setup uses Metabase **v0.63.1.4** from:

`metabase/metabase@sha256:5cc6a7ffe0d566864ebadfcb80a5a88bcb417aa8e6dbb83f8ac141d8fefd682c`

It binds to localhost only, mounts the generated SQLite database read-only, and
stores disposable Metabase application state outside the repository.

Four dashboards are built from reviewed SQL/models:

1. **Activation:** first DM → config link → settings open → first task
   assignment → first task-provider mutating semantic success within 14 days;
   conversion and time-to-step.
2. **Engagement and retention:** DAU/WAU/MAU, sessions, exact D1/D7/D30
   retention, and new/returning intent mix.
3. **Intents and feature adoption:** top goals, actor penetration, outcomes,
   tool success/recovery, and capability-aware feature adoption.
4. **Reliability, friction, and performance:** controlled error taxonomy,
   recovery, seven friction components, and latency percentiles.

The recorded run validated all four saved models, nine dashboard cards, and
four server-rendered dashboards against a 17,183-event read-only snapshot.
The activation funnel is exactly 200 → 180 → 160 → 140 → 120 actors.
Exact-day retention is D1 = 90/200 (45%), D7 = 60/200 (30%), and
D30 = 30/200 (15%).

Metabase's native PDF renderer produced four single-page A4 documents. Poppler
rendering at 150 DPI found no overlapping cards, clipped data marks, broken
glyphs, unreadable values, or missing `SYNTHETIC ONLY` markers. The committed
evidence is:

| Dashboard | Poppler-rendered PDF evidence | Server-rendered PDF |
|---|---|---|
| Activation | [PNG](./poc/metabase/evidence/screenshots/activation.png) | [PDF](../../../output/pdf/analytics-metrics/metabase/activation.pdf) |
| Engagement and retention | [PNG](./poc/metabase/evidence/screenshots/retention.png) | [PDF](../../../output/pdf/analytics-metrics/metabase/retention.pdf) |
| Intents and feature adoption | [PNG](./poc/metabase/evidence/screenshots/intents.png) | [PDF](../../../output/pdf/analytics-metrics/metabase/intents.pdf) |
| Reliability, friction, and performance | [PNG](./poc/metabase/evidence/screenshots/reliability.png) | [PDF](../../../output/pdf/analytics-metrics/metabase/reliability.pdf) |

The exact model/card result shapes, run-local IDs, PDF sizes, and PDF hashes
are in the [Metabase manifest](./poc/metabase/evidence/manifest.json).
[Visual QA evidence](./poc/metabase/evidence/visual-qa.json) records the
Poppler version, rasterization settings, PNG dimensions/hashes, source PDF
hashes, inspection result, and non-browser limitation. The
[Metabase PoC README](./poc/metabase/README.md) is the reproduction record.

## OpenPanel PoC

The OpenPanel PoC is disposable, localhost/private-network only, and uses
official stable self-hosting images pinned by digest. The forwarder maps the
same synthetic source into server-side requests with:

- stable fake profile IDs;
- original synthetic occurrence time;
- event and property controlled enums;
- `event_id` as a visible diagnostic property;
- a separate delivery table keyed by `(sink_id, event_id)`;
- acknowledgement, attempts, bounded error class, and ambiguous-delivery
  state.

The live run intentionally simulated one lost acknowledgement. The local
ledger suppresses replay for both acknowledged and ambiguous events because
OpenPanel has no documented caller-controlled idempotency key; ambiguous rows
require explicit operator resolution. Historical server events are expected
not to create native OpenPanel sessions; papai's own session key remains an
event property and Metabase remains authoritative for Sessionization v1.
Native dashboards cover the product questions they can express. Where native
percentiles, session semantics, deletion, or domain error definitions are
weaker than SQL, the gap is recorded rather than changing the canonical model.

The localhost run used the official self-host source at commit
`127246623581bc0464f016341c4d44303be01eef` and seven digest-pinned services.
It mapped all 17,183 fixture events: 16,981 profile events and 202 anonymous
aggregate events. The first run recorded 17,182 delivered rows and one
intentionally ambiguous acknowledgement; the identical rerun enqueued and
attempted zero rows.

Aggregate ClickHouse reconciliation found 17,183 rows, 17,183 unique
diagnostic `event_id` values, zero missing source IDs, and zero duplicate
diagnostic IDs. That destination evidence also shows why queue acknowledgement
alone was insufficient:

- protected `event.events` pagination returned only 16,573 rows, 610 short,
  because its timestamp-only cursor skips tied timestamps at page boundaries;
- one profile-filtered export returned 20 records while its metadata claimed
  88 records and one page;
- `DELETE /api/profile` returned 404, and the pinned profile router exposed no
  complete per-profile erasure operation; and
- the historical server-event activation funnel collapsed to one native
  session with every step at 100%, so it cannot represent papai's activation
  or Sessionization v1.

The four service-native report endpoints did execute: activation funnel,
47-row retention cohort, 23 intent series, and six controlled error series.
The pinned release coerced a legacy `6m` report range to `30d`, so the recorded
reports use `12m`. Provisioning also relies on an internal, version-specific
tRPC API.

Run evidence is in the
[OpenPanel evidence index](./poc/openpanel/evidence/README.md), with
[forwarder results](./poc/openpanel/evidence/live-forwarder-initial.json),
[replay results](./poc/openpanel/evidence/live-forwarder-rerun.json),
[remote reconciliation](./poc/openpanel/evidence/remote-reconciliation.json),
and the [native dashboard manifest](./poc/openpanel/evidence/dashboard-manifest.json).
No OpenPanel screenshot is claimed: the in-application browser was unavailable
and the pinned service exposes no native dashboard PNG/PDF export.

## Acceptance criteria

- Source row count equals unique `event_id`.
- Duplicate source inserts do not add canonical rows.
- Reviewed Metabase totals exactly reconcile to the snapshot under documented
  inclusion rules.
- Hand-calculated D1/D7/D30 actors match modeled output.
- Every funnel declares identity, ordering, denominator, and conversion
  window.
- OpenPanel ordinary retry is suppressed by the local ledger; ambiguous
  acknowledgement behavior is measured rather than hidden.
- Profile-filtered export and attempted deletion behavior are tested. If a
  supported per-actor deletion mechanism is absent, the production
  pseudonymous-sink gate is explicitly failed.
- No prohibited field or value appears in SQLite, captured requests,
  destination property dictionaries, logs, or screenshots.
- Services bind only to localhost/private task networks and use only synthetic
  credentials.
- Four Metabase server-rendered dashboard PDFs are rasterized and visually
  inspected; every artifact contains a visible synthetic-data marker. These
  are not claimed as browser/native UI screenshots. OpenPanel's separate
  screenshot criterion is explicitly recorded as unfulfilled.
- Image digests, fixture hash, row counts, query results, and known limitations
  are recorded.

## Acceptance outcome

| Criterion | Outcome | Evidence |
|---|---|---|
| Source uniqueness and duplicate handling | **Pass** | 17,183 rows and unique IDs; 325/325 deliberate duplicate inserts ignored |
| Source-order robustness | **Pass** | 1,224 out-of-order adjacent rows (7.1233%); reviewed models order by occurrence time and ID |
| Metabase model reconciliation | **Pass** | Four SQL models and nine cards validated; manifest captures result shapes |
| Hand-calculated activation and retention | **Pass** | 200 → 180 → 160 → 140 → 120; D1/D7/D30 = 90/60/30 |
| Metabase rendered-output inspection | **Pass** | Four Poppler-rendered PDF evidence PNGs and four single-page PDFs, all visibly synthetic |
| OpenPanel complete ingestion | **Pass for this synthetic run** | ClickHouse aggregate: 17,183/17,183 IDs, zero missing or duplicate |
| OpenPanel ordinary replay suppression | **Pass locally** | Same ledger/sink rerun attempted zero events |
| OpenPanel destination idempotency | **Fail / undocumented** | Diagnostic property is not a destination idempotency key |
| OpenPanel deterministic supported export | **Fail** | Event pagination short by 610; profile export returned 20 while claiming 88 |
| OpenPanel complete per-profile erasure | **Fail** | Delete probe 404; no complete supported route found |
| OpenPanel native session fidelity | **Fail** | Historical server funnel reported one native session and 100% at all steps |
| OpenPanel native screenshot | **Unfulfilled** | Browser unavailable; pinned service has no PNG/PDF dashboard export |
| Production pseudonymous OpenPanel gate | **Fail / remains closed** | Idempotency, deterministic export, erasure, and session requirements unmet |

The reviewed fixture SHA-256 is
`cd2701862d5ceb02a130cd26899ecfd710da867d739569ffd980a924fc78cb2e`.
Exact OpenPanel image digests, dashboard/report identities, and chart types are
in the [dashboard manifest](./poc/openpanel/evidence/dashboard-manifest.json);
the separate
[dashboard-query evidence](./poc/openpanel/evidence/dashboard-query-evidence.json)
records the observed result shapes. All run-local services bound to localhost
and all captured artifacts are synthetic-only and credential-free.
