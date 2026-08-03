<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Metabase synthetic dashboard PoC

This PoC proves the local-BI path against a transactionally copied, read-only
SQLite snapshot. It never opens a papai runtime database and uses only the
deterministic `papai-analytics-fixture-v1` data. Every saved model, question,
dashboard, PDF, and rendered visual artifact is marked `SYNTHETIC ONLY`.

## Pinned run

The recorded run used:

- Metabase `v0.63.1.4` (`9bd2d23`);
- image
  `metabase/metabase@sha256:5cc6a7ffe0d566864ebadfcb80a5a88bcb417aa8e6dbb83f8ac141d8fefd682c`;
- a localhost-only binding, `127.0.0.1:4300`;
- SQLite mounted at `/analytics/papai-analytics.sqlite:ro`; and
- reviewed fixture SHA-256
  `cd2701862d5ceb02a130cd26899ecfd710da867d739569ffd980a924fc78cb2e`.

The fixture has 17,183 events, 200 actors, and 50 UTC dates. It contains no
operator, production, conversation, or secret material.

## Reproduce

Generate a fresh fixture outside the repository:

```bash
export PAPAI_ANALYTICS_FIXTURE=/private/tmp/papai-analytics-metabase.sqlite

bun docs/research/analytics-metrics/poc/fixture/generate-fixture.ts \
  --output "$PAPAI_ANALYTICS_FIXTURE"

bun docs/research/analytics-metrics/poc/fixture/self-check.ts \
  --database "$PAPAI_ANALYTICS_FIXTURE" \
  --expected docs/research/analytics-metrics/poc/fixture/expected-summary.json
```

Start the pinned image on localhost:

```bash
docker run --name papai-analytics-metabase \
  -p 127.0.0.1:4300:3000 \
  -v "$PAPAI_ANALYTICS_FIXTURE:/analytics/papai-analytics.sqlite:ro" \
  metabase/metabase@sha256:5cc6a7ffe0d566864ebadfcb80a5a88bcb417aa8e6dbb83f8ac141d8fefd682c
```

Complete Metabase's disposable local setup, disable usage tracking, and add a
SQLite database whose filename is `/analytics/papai-analytics.sqlite`. Record
the database id and obtain a short-lived API session without writing it to the
repository. Then provision the four saved models and dashboards:

```bash
export METABASE_URL=http://127.0.0.1:4300
export METABASE_DATABASE_ID=2
export METABASE_SESSION='<short-lived local session>'

bun docs/research/analytics-metrics/poc/metabase/provision.ts \
  --manifest docs/research/analytics-metrics/poc/metabase/evidence/manifest.json \
  --pdf-dir output/pdf/analytics-metrics/metabase
```

`provision.ts` validates every saved model and dashboard question through
Metabase before asking Metabase's server-side PDF endpoint to render the
dashboard. Credentials are sent only in `X-Metabase-Session` and never appear
in the manifest.

Metabase's automatic dashboard placement is order-sensitive. The provisioner
therefore serializes card creation inside each dashboard while keeping
independent model and dashboard work bounded. A concurrency of two produced
overlapping cards during visual QA; the committed provisioner fixes that
provider-specific behavior.

## Evidence

The machine-readable [manifest](evidence/manifest.json) records saved entity
ids, question row/column counts, PDF sizes, and PDF SHA-256 values. Entity ids
and localhost URLs are run-local; the source SQL and expected result shapes are
the reproducible contract.

| Dashboard | Poppler-rendered PDF evidence | PDF |
| --- | --- | --- |
| Activation | [PNG](evidence/screenshots/activation.png) | [PDF](../../../../../output/pdf/analytics-metrics/metabase/activation.pdf) |
| Retention | [PNG](evidence/screenshots/retention.png) | [PDF](../../../../../output/pdf/analytics-metrics/metabase/retention.pdf) |
| Intents and feature adoption | [PNG](evidence/screenshots/intents.png) | [PDF](../../../../../output/pdf/analytics-metrics/metabase/intents.pdf) |
| Reliability, friction, and performance | [PNG](evidence/screenshots/reliability.png) | [PDF](../../../../../output/pdf/analytics-metrics/metabase/reliability.pdf) |

Reproduce those PNGs from the repository root with Poppler:

```bash
for dashboard in activation retention intents reliability; do
  pdftoppm -png -r 150 -singlefile \
    "output/pdf/analytics-metrics/metabase/${dashboard}.pdf" \
    "docs/research/analytics-metrics/poc/metabase/evidence/screenshots/${dashboard}"
done
```

[`visual-qa.json`](evidence/visual-qa.json) binds each PNG to its source PDF
hash and records the Poppler version, DPI, dimensions, PNG hash, inspection
result, and non-browser limitation.

The latest PDFs are single-page A4 documents. Poppler rendering at 150 DPI
showed no overlap, clipping of data marks, unreadable values, broken glyphs, or
missing synthetic markers. The activation funnel visibly reconciles to
200 → 180 → 160 → 140 → 120; exact-day retention shows 45%, 30%, and 15%,
which correspond to 90, 60, and 30 retained actors out of 200 eligible actors.

## What this proves and does not prove

It proves that Metabase can read the snapshot directly, save all four reviewed
SQL models, build aggregate-only product/UX dashboards, validate their queries,
and render portable evidence without data egress. It also proves that a
dashboard author need not query `props_json` or expose pseudonymous keys.

It does not prove live-writer safety, production performance, real-user rates,
causal relationships, or native browser rendering. Production must publish
transactionally consistent read-only snapshots; attaching Metabase to papai's
live SQLite writer is not an approved design. The interactive browser
connector was unavailable in this environment, so visual verification used
Metabase's own documented server-rendered PDF path plus Poppler, not a claimed
browser walkthrough or native UI screenshot.
