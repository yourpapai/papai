<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# OpenPanel synthetic forwarder design

## Scope

This disposable PoC forwards only the reviewed synthetic canonical fixture to
an OpenPanel service bound to localhost. It does not read papai runtime data,
accept an arbitrary destination, or establish that OpenPanel is eligible for
production pseudonymous analytics.

## Mapping boundary

The mapper validates the complete canonical row before producing an OpenPanel
request. The request shape is:

```json
{
  "type": "track",
  "payload": {
    "name": "turn_completed",
    "profileId": "syn_...",
    "properties": {
      "__timestamp": "2026-05-01T00:00:00.000Z",
      "event_id": "...",
      "schema_version": 1
    }
  }
}
```

`profileId` is present only for pseudonymous `admin` and `member` rows with a
valid synthetic actor pseudonym. Aggregate, guest, and system rows have no
profile ID. Properties comprise a fixed envelope allowlist and the canonical
per-event allowlist; unknown, nested, content-like, or missing values fail
closed. Raw actor, context, thread, task-instance, deployment, and platform
instance keys are not forwarded.

`event_id` is diagnostic only. OpenPanel's public contract does not document a
caller-controlled idempotency key. `session_key` is an ordinary papai event
property and does not imply OpenPanel native-session fidelity. Historical
server events are suitable for event analysis, not for validating native
sessions.

## Delivery state

A separate SQLite database owns one row per `(event_id, sink_id)` with states
`pending`, `delivered`, `ambiguous`, and `dead`. Attempts are incremented for
that exact sink immediately before a send. A known 2xx acknowledgement becomes
`delivered`; ordinary reruns select only `pending`, so delivered rows are not
replayed.

An unknown network outcome, or the explicit post-ack simulation, becomes
`ambiguous`. Ambiguous rows are terminal for automatic processing and remain
visible for reconciliation. Explicit retryable HTTP responses stay pending
until the bounded attempt limit, then become dead. Permanent HTTP failures
become dead immediately. The ledger stores no request body, response body,
credential, profile ID, or raw exception text.

## Transport and evidence

The transport accepts only numeric loopback URLs: `http://127.0.0.1` or
`http://[::1]`. It refuses resolver-dependent hostnames and URL credentials,
and posts to `/api/track` without redirects. Every request has a bounded abort timeout. The client ID and secret
are added only as authentication headers; the secret is read from
`OPENPANEL_CLIENT_SECRET`.

Evidence is aggregate JSON: fixture hash, source/mapping counts, ledger state
counts, attempts, status-class counts, service-native query counts when
available, and explicit limitations. It contains no credential, request body,
response body, profile ID, or event-level record.

The live PoC found that the protected `event.events` cursor is timestamp-only.
It returned 16,573 of 17,183 rows because tied timestamps at page boundaries
were skipped. Aggregate ClickHouse reconciliation found all 17,183 unique
diagnostic event IDs with no missing or duplicate rows. The protected event
export therefore fails the deterministic-reconciliation capability even
though aggregate backend evidence confirms complete ingestion.

The profile-filtered export also failed completeness: one synthetic profile
returned 20 records while response metadata claimed 88 records and one page.
`DELETE /api/profile` returned 404, and the pinned profile router exposes no
complete per-profile erasure operation. These observed results keep the
pseudonymous production gate failed.
