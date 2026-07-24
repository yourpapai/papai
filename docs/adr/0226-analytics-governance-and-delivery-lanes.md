<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0226: Analytics Governance and Delivery Lanes

## Status

Accepted

## Date

2026-07-24

## Context

papai needs privacy-preserving product/UX analytics that can answer RQ1–RQ8
without smuggling raw identifiers, message text, tool payloads, or mutable
settings into canonical facts. The debug event bus (`src/debug/event-bus.ts`)
remains a diagnostic surface: its payloads include generated text, raw tool
results, error strings, memo content, names, URLs, and arbitrary log records.
Using it as an analytics source would violate the existing `/stats/*` anonymity
contract and the stricter longitudinal-analytics boundary defined in the privacy
research.

The analytics research produced an executive decision (see
[`docs/research/analytics-metrics/00-overview.md`](../../docs/research/analytics-metrics/00-overview.md))
with two local lanes, two external gates, purpose-separated HMAC pseudonyms, a
separate delivery ledger, read-only Metabase snapshots, and an explicit failure
mode for OpenPanel-style pseudonymous egress. This ADR records the architectural
commitment so later stages import a frozen governance model rather than
renegotiating it per implementation file.

## Decision

Adopt a two-lane, two-gate analytics architecture with strict contracts,
purpose-separated HMAC keys, and additive rollback.

1. **Do not forward the debug event bus.** A typed source adapter selects and
   transforms debug events field-by-field into strict `AnalyticsEventV1` or
   `AnalyticsAggregateV1` facts. Adapters never spread `DebugEvent` or
   `event.data`; unknown fields, events, enums, versions, or strings fail closed
   and increment a bounded `normalization_rejected` counter.

2. **Two local lanes.**
   - `local_aggregate` is the shipping default. It writes only C0 daily counters
     and fixed histograms with no actor, context, thread, turn, or session
     pseudonyms.
   - `local_pseudonymous` is governance-gated. It writes eligible C0–C2
     canonical events only after the operator has configured policy, notice,
     controller contact, purpose, lawful basis, retention, review date, and
     acknowledgement, and the analytics HMAC keyring is available.

3. **Two external gates.**
   - `external_aggregate` releases only thresholded, one-way-dimension daily
     cells from the local aggregate store. Actor-sensitive cells require an
     eligible contributor count of at least 10 and a complete epoch; any
     `unreconciled_restart_gap` cell is suppressed.
   - `external_pseudonymous` is always off by default. It requires the operator
     switch, a reviewed sink, and an actor-level `allow`; the sink must prove
     caller-controlled idempotency, deterministic reconciliation, and complete
     per-actor deletion before enablement.

4. **Event-bus adapter boundary.** Source adapters live at authorized boundaries
   (message acceptance, turn terminal, LLM/tool terminal, settings mutation,
   provider/MCP callback). They emit a typed `AnalyticsSourceFact`, not the
   canonical payload, so the normalizer owns schema version and privacy-class
   assignment. The normalizer is the only writer of `AnalyticsEventV1` and
   `AnalyticsAggregateV1` records.

5. **Dedicated HMAC keys.** Analytics uses its own encrypted keyring
   (`ANALYTICS_HMAC_KEYRING`); governance uses a separate operational keyring
   (`ANALYTICS_GOVERNANCE_HMAC_KEYRING`). Neither reuses `stats_anonymity_salt`.
   Each identity purpose (actor, context, thread, turn, attempt, model, tool,
   coding project/session, deployment, task instance, collection eligibility,
   delivery grant) has a fixed domain string and length-prefixed component
   encoding.

6. **Separate delivery ledger.** Delivery state lives in
   `(event_id, sink_version_id)` rows with independent per-sink-version config,
   lease/send transitions, deletion receipts, and aggregate-release ledger. The
   legacy single-state outbox columns remain inert; analytics does not write to
   them.

7. **Metabase snapshot for local BI.** The canonical pseudonymous store is
   snapshotted to a fresh, read-only SQLite file per generation. Metabase mounts
   the snapshot only after quiescing, closing, remounting, and verifying the new
   snapshot ID and zero old contribution. The aggregate store is queryable
   directly but publication still follows the external-aggregate gate.

8. **OpenPanel failed pseudonymous gate.** OpenPanel is evaluated only as a
   self-hosted PoC candidate. Its public API documents neither
   caller-controlled event idempotency nor per-actor erasure, so pseudonymous
   production egress to it remains blocked until both capabilities are
   integration-tested and deletion is supportable for every retained actor-key
   version.

9. **Additive migration rollback posture.** Analytics migrations are additive
   and registered after the current migration baseline. Runtime rollback means
   setting the `off` kill switch, stopping subscribers and workers, cancelling
   pending delivery, and leaving new tables dormant until a separately reviewed
   cleanup migration is safe. No destructive rollback of applied schema changes
   is performed at runtime.

## Consequences

### Positive

- The default shipping mode (`local_aggregate`) collects only low-cardinality C0
  facts and never stores longitudinal pseudonyms, minimizing privacy risk out of
  the box.
- Pseudonymous analytics is an explicit, gated mode with operator and actor
  consent prerequisites, satisfying the research privacy posture.
- Purpose-separated HMAC keys prevent the stats salt from becoming a shared
  linkage secret across observability, analytics, and governance stores.
- A separate delivery ledger makes multi-sink, consent-withdrawal, deletion,
  credential rotation, and payload versioning tractable without conflating them
  with the canonical event store.
- Metabase snapshots enforce read-only local BI and simplify subject-rights
  deletion by rebuilding from a transactionally consistent canonical source.

### Negative / Risks

- Every new debug signal must pass through a typed adapter and a closed registry
  review; ad-hoc telemetry cannot be added in a single file.
- Governance setup is required before `local_pseudonymous` or any external
  egress is useful, which may delay dashboard depth for operators who skip setup.
- The aggregate release lattice is restrictive: no custom ranges, rolling
  windows, drill-through, or multi-dimensional external cells. Dashboards that
  need richer segmentation must remain local or qualify through the
  longitudinal lane.
- OpenPanel pseudonymous delivery is intentionally blocked until deletion and
  idempotency gates pass; operators cannot enable it simply by configuring an
  endpoint.
- Additive rollback leaves tables dormant rather than removing them, requiring a
  future cleanup migration once the feature is stable.

## Related Decisions

- ADR-0120: Central LLM Credentials, Usage Telemetry, Billing Dashboard, and
  Anonymous DB-Wide Statistics (operational usage rows remain distinct from
  canonical analytics).
- ADR-0225: Hermetic Story Execution — Docker-Only OS Sandbox (Tier 0 contracts
  and stories must remain compatible with the analytics runtime).

## References

- `docs/research/analytics-metrics/00-overview.md`
- `docs/research/analytics-metrics/02-metric-catalog.md`
- `docs/research/analytics-metrics/03-privacy-consent-threat-model.md`
- `docs/research/analytics-metrics/06-implementation-plan.md`
