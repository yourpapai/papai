<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# References and evidence provenance

**Research cut-off:** 2026-07-23

Provider, legal, and API behavior can change. These are the primary sources
used for the scorecard and threat model; the pinned PoC image digests and
machine-readable run manifests are the reproducibility authority for observed
behavior.

## papai sources

- [`docs/architecture/behaviors.md`](../../architecture/behaviors.md) — runtime,
  scope, guest, BYOK, steering, live-status, and settings behavior.
- [`docs/architecture/overview.md`](../../architecture/overview.md) — module map,
  settings/debug surfaces, and `/stats/*` anonymity contract.
- [`docs/architecture/environment.md`](../../architecture/environment.md) —
  existing secret/configuration patterns.
- [`docs/architecture/tools.md`](../../architecture/tools.md) — tool permissions,
  confirmation, disclosure, and context gating.
- [`01-current-event-inventory.md`](./01-current-event-inventory.md) — exact
  repository source evidence, including file and symbol references, current at
  the research cut-off.

## Privacy and governance

- [EU General Data Protection Regulation, official text](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)
  — purpose limitation, minimization, storage limitation, security, data
  subject rights, and controller/processor duties.
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
  — consent validity and withdrawal.
- [EDPB Guidelines 4/2019 on data protection by design and by default](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en)
  — default-off egress, minimization, and technical safeguards.

The report is an engineering/privacy design, not legal advice. A production
operator must establish its lawful basis, notices, processor terms, residency,
and jurisdiction-specific obligations.

## Metabase

- [Supported databases](https://www.metabase.com/docs/latest/databases/connecting)
  and [official SQLite connection](https://www.metabase.com/docs/latest/databases/connections/sqlite)
  — self-hosted direct SQLite support and absolute filename configuration.
- [Models](https://www.metabase.com/docs/latest/data-modeling/models) and
  [referencing saved questions/models in SQL](https://www.metabase.com/docs/latest/questions/native-editor/referencing-saved-questions-in-queries)
  — curated model behavior and `{{#card-id}}` references.
- [Questions](https://www.metabase.com/docs/latest/questions/introduction) and
  [SQL editor](https://www.metabase.com/docs/latest/questions/native-editor/writing-sql)
  — saved queries, visualizations, and native SQL limitations.
- [Running Metabase on Docker](https://www.metabase.com/docs/latest/installation-and-operation/running-metabase-on-docker)
  and [moving away from embedded H2](https://www.metabase.com/docs/latest/installation-and-operation/migrating-from-h2)
  — deployment and application-database guidance.
- [Metabase AGPL license](https://github.com/metabase/metabase/blob/master/LICENSE.txt)
  — OSS licensing boundary.
- [PoC manifest](./poc/metabase/evidence/manifest.json),
  [Poppler visual-QA manifest](./poc/metabase/evidence/visual-qa.json), and
  [PoC README](./poc/metabase/README.md) — observed query validation,
  server-rendered PDFs, PDF/PNG hashes, raster inspection, and the
  card-placement race found during visual QA.

## OpenPanel

- [Official repository](https://github.com/Openpanel-dev/openpanel) and
  [self-hosting guide](https://openpanel.dev/docs/self-hosting/self-hosting) —
  AGPL source and supported deployment shape.
- [Environment variables](https://openpanel.dev/docs/self-hosting/environment-variables)
  and [high-volume operation](https://openpanel.dev/docs/self-hosting/high-volume)
  — PostgreSQL, Redis, ClickHouse, queue, and worker requirements.
- [Track API](https://openpanel.dev/docs/api/track) and
  [track endpoint reference](https://openpanel.dev/docs/api-reference/track/track/post)
  — server ingestion shape and authentication.
- [How OpenPanel works](https://openpanel.dev/docs/how-it-works) — server and
  historical-event session limitations.
- [Funnels](https://openpanel.dev/features/funnels),
  [retention](https://openpanel.dev/features/retention), and
  [data visualization](https://openpanel.dev/features/data-visualization) —
  native analytical surface.
- The PoC pinned the official self-host branch at commit
  `127246623581bc0464f016341c4d44303be01eef`; exact image digests and observed
  delivery/export behavior are recorded in
  [`poc/openpanel/`](./poc/openpanel/) rather than inferred from marketing
  pages.

## Other self-hosted candidates

- PostHog:
  [open-source self-host support policy](https://posthog.com/docs/self-host/open-source/support),
  [self-hosting](https://posthog.com/docs/self-host), and
  [capture API](https://posthog.com/docs/api/capture).
- Umami:
  [installation](https://docs.umami.is/docs/install),
  [funnels](https://docs.umami.is/docs/funnel),
  [retention](https://docs.umami.is/docs/retention), and
  [cohorts](https://docs.umami.is/docs/cohorts).
- Matomo:
  [on-premise guide](https://matomo.org/guide/installation-maintenance/matomo-on-premise-self-hosted/),
  [tracking API](https://developer.matomo.org/api-reference/tracking-api),
  [Funnels](https://plugins.matomo.org/Funnels),
  [Cohorts](https://plugins.matomo.org/Cohorts), and
  [Users Flow](https://plugins.matomo.org/UsersFlow).
- Plausible:
  [Community Edition boundary](https://plausible.io/blog/community-edition),
  [self-hosted edition](https://plausible.io/self-hosted-web-analytics), and
  [funnel analysis](https://plausible.io/docs/funnel-analysis).
- Countly:
  [server repository](https://github.com/Countly/countly-server),
  [license](https://github.com/Countly/countly-server/blob/master/LICENSE.md),
  [pricing/edition comparison](https://countly.com/pricing), and
  [cohorts](https://support.count.ly/hc/en-us/articles/4405086657049-Cohorts).
- Grafana:
  [licensing](https://grafana.com/licensing/),
  [installation](https://grafana.com/docs/grafana/latest/setup-grafana/installation/),
  [community SQLite data source](https://grafana.com/grafana/plugins/frser-sqlite-datasource/),
  and [official ClickHouse data source](https://grafana.com/docs/plugins/grafana-clickhouse-datasource/latest/).
- Apache Superset:
  [documentation](https://superset.apache.org/docs/),
  [SQLite support](https://superset.apache.org/docs/databases/supported/sqlite),
  and [repository](https://github.com/apache/superset).

## SaaS candidates and storage alternatives

- Mixpanel:
  [Import Events API](https://docs.mixpanel.com/reference/import-events),
  [EU data residency](https://mixpanel.com/legal/eu-data-residency/), and
  [pricing](https://mixpanel.com/pricing/).
- Amplitude:
  [HTTP V2 ingestion](https://amplitude.com/docs/apis/analytics/http-v2),
  [retention analysis](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-build),
  [cohorts](https://amplitude.com/docs/analytics/define-cohort), and
  [pricing](https://www.amplitude.com/pricing).
- DuckDB:
  [SQLite extension](https://duckdb.org/docs/current/core_extensions/sqlite)
  and [concurrency model](https://duckdb.org/docs/stable/connect/concurrency.html).
- ClickHouse:
  [26.1 deduplication changes](https://clickhouse.com/blog/clickhouse-release-26-01),
  [26.3 LTS changes](https://clickhouse.com/blog/clickhouse-release-26-03), and
  [common deduplication pitfalls](https://clickhouse.com/blog/common-getting-started-issues-with-clickhouse).
