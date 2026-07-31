<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# OpenPanel PoC evidence

This directory contains committed-safe aggregate evidence from the localhost
synthetic PoC. It must not contain credentials, cookie jars, request or
response bodies, profile IDs, event-level rows, or raw service logs.

- `live-forwarder-initial.json` records the full 17,183-event attempt with one
  simulated lost acknowledgement.
- `live-forwarder-rerun.json` proves the same ledger/sink rerun attempted zero
  delivered or ambiguous rows.
- `remote-reconciliation.json` compares the canonical source, ledger,
  protected event-list API, and aggregate ClickHouse result.
- `dashboard-manifest.json` records the protected-tRPC dashboard/report/share
  IDs, chart types, pinned image digests, and interpretation limits.
- `dashboard-query-evidence.json` records service-native result shapes and
  layouts from the four live report queries.

`verify-evidence.sh` validates these committed summaries against the reviewed
source/ledger and against each other; it is offline and does not regenerate
the protected API, profile, erasure, or chart-query observations. The pinned
manual probe protocol is documented in the parent README.

The destination contains all 17,183 unique diagnostic event IDs. The protected
`event.events` pagination returned only 16,573 because its cursor contains only
`created_at`; tied timestamps at 50-row boundaries skip rows. That API is
therefore not a deterministic reconciliation surface for this fixture.

The public synthetic-only dashboard route was HTTP 200 and returned four
reports. No screenshot is included: no browser session was available and this
OpenPanel image exposes no native dashboard PNG/PDF export. Its historical
server-event funnel reported one native session and 100% at every step, which
demonstrates that it cannot validate papai Sessionization v1 or the reviewed
activation model.

A one-profile export returned 20 events while its own metadata claimed 88
events and one page. `DELETE /api/profile` returned 404, and the pinned profile
router exposes update/increment/decrement but no complete per-profile erasure.
Both deterministic reconciliation and actor erasure therefore remain failed
production gates.
