<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0326: Content-Free Analytics Pipeline — Fail-Closed Normalization, Closed Aggregates, and Evidence-Gated Staged Rollout

## Status

Accepted

## Date

2026-07-24

## Context

papai needed product/UX analytics to answer research questions RQ1–RQ8 (activation, retention, intent mix, reliability, friction, performance) without ever collecting message text, tool payloads, raw identifiers, or mutable settings. The analytics research corpus (`docs/research/analytics-metrics/`) defined strict contracts, a privacy/consent threat model with 17 release-blocking controls, and a 3,228-line implementation plan ("06"). The open architectural question was the **shape of the collection pipeline and the rollout strategy**: how facts get from instrumented boundaries into storage without leaking content, what the default shipping posture is, and how the system earns the right to enable richer lanes.

ADR-0308 already froze the governance model (two local lanes, two external gates, purpose-separated HMAC keys, independent delivery ledger). This ADR records the pipeline architecture and staged-rollout decision that the Stage A implementation plan executed.

Source: plan `docs/superpowers/plans/2026-07-24-analytics-stage-a.md`; execution design `docs/superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md`; evidence `docs/research/analytics-metrics/09-stage-a-evidence.md`.

## Decision Drivers

- **Content-free by construction, not by policy.** Raw content must be structurally unable to reach storage, not merely filtered by convention.
- **The reply hot path must never pay for analytics.** A chat bot's latency and reliability cannot depend on telemetry health.
- **Ship dark.** The first deploy must carry zero collection risk: code present, collection killed, lanes enabled only after evidence.
- **Aggregates are the default product.** Daily counters/histograms answer most questions without any longitudinal identity.
- **Deterministic intent only.** A 23-label taxonomy (`intent.v1`) classified by a deterministic `hybrid_v1` (tool-trace → metadata); no small-model inference on user text.
- **Reversibility without destructive migrations.** Rollback is a runtime kill switch; migrations 072–075 are additive only.
- **Every stage transition is evidence-gated.** Stage B (local aggregate window), C (pseudonymous), and E (external) require recorded, signed evidence, not judgment calls.

## Considered Options

### Option 1 — Typed source facts → fail-closed normalizer → canonical events + closed aggregates, staged rollout (chosen)

Instrumented boundaries emit an in-process-only `AnalyticsSourceFact` discriminated union (never serialized). A single fail-closed normalizer is the only writer of canonical `AnalyticsEventV1` records and closed daily aggregates; any unknown event, property, enum value, or version increments a bounded `normalization_rejected` counter instead of writing. The runtime observer is non-blocking: bounded queues, non-throwing subscriber, mode gate, process-epoch lifecycle (open-before-producers, drain-before-close, stale-open recovery). All lanes sit behind one runtime mode switch (`off | local_aggregate | local_pseudonymous | external_aggregate | external_pseudonymous`), shipping default `local_aggregate`, deploy posture collection-killed until the Stage B window starts. BI reads a curated, byte-scanned, read-only SQLite snapshot mounted by an ad-hoc Metabase container — never the live database. Rollout is staged A→E with executable gates (`tests/analytics/rollout-gates.test.ts`) and a 17-control privacy-contract suite blocking each transition.

- **Pros:** content exclusion is enforced at the type/schema boundary with CI-closure (registry test fails on any unlisted event/prop); aggregate-only default satisfies most RQs with C0 data; hot path isolation is provable (lifecycle-isolation tests); rollback is a config flip; each stage's enablement is auditable and signed.
- **Cons:** heavy up-front machinery (contracts, registry, governance stores, epoch lifecycle) before any metric is visible; every new signal requires registry review; Stage B insight is delayed by a two-consecutive-complete-UTC-week evidence window.

### Option 2 — Forward the existing debug event bus to an external analytics service (rejected)

Pipe `src/debug/event-bus.ts` events to a SaaS/self-hosted tool (e.g. OpenPanel, PostHog).

- **Pros:** minimal instrumentation work; immediate dashboards.
- **Cons:** debug payloads contain generated text, tool results, error strings, names, and URLs — violates the `/stats/*` anonymity contract and the privacy research boundary; third-party egress cannot prove per-actor deletion or caller-controlled idempotency (OpenPanel explicitly fails the sink capability gate); no fail-closed schema boundary.

### Option 3 — Local-only logs/metrics without canonical storage (rejected)

Aggregate counters in logs or Prometheus-style metrics with no canonical event store.

- **Pros:** simplest; no new schema.
- **Cons:** cannot answer session/outcome/intent/friction RQs; no subject-rights (export/withdraw/delete) story; no reconciliation or provenance for backfilled usage; upgrades to richer lanes later would require rebuilding the entire pipeline anyway.

## Decision

Implement Option 1 across 18 tasks (plus orchestrator-only Tasks 0/19), executed subagent-per-task with named gates, one commit per task, and a durable evidence log. Concretely:

- **Contracts and closure:** `src/analytics/contracts.ts` + `registry.ts` freeze `AnalyticsEventV1`/`AnalyticsAggregateV1`, the 32-event registry, branded `Pseudonym`, and strict `additionalProperties: false` schemas; a registry-closure test fails CI on drift.
- **Pipeline:** typed source facts at authorized boundaries → fail-closed `normalize()` → canonical event store + closed daily aggregate increments with deterministic event IDs and duplicate-swallow.
- **Runtime isolation:** `AnalyticsObserver` with bounded queues and non-throwing subscriber; process epochs guarantee no torn windows; analytics failure can never break bot startup or the reply path.
- **Mode switch:** five modes behind runtime config; `external_pseudonymous` additionally requires operator switch AND per-actor `allow`; aggregate lanes always carry `null` governance refs.
- **Derivations:** versioned `sessionization.v1` (strict 1,800,000 ms gap), `outcome.v1` (eight terminal states incl. `censored`), `friction.v1` (seven binary components), deterministic `intent.v1` with transient in-memory rephrase detection (raw text discarded at the boundary, never persisted).
- **Lifecycle:** retention/expiry barriers, authenticated subject export/withdraw/delete, and a durable multi-phase rekey workflow with count/hash conservation.
- **Egress:** thresholded aggregate release over a frozen UTC-day lattice with deterministic primary/complementary suppression, delivered by a grant-serialized worker through a DNS-pinned HTTPS-only transport; captured-sink tests prove no prohibited data leaves.
- **BI:** curated read-only snapshots (byte/schema/freelist scanned, immutable versions) consumed by Metabase after coordinated quiesce/remount/verify; five reviewed SQL models.
- **Rollout:** Stage A ships with collection killed; Stage B enables `local_aggregate` for a two-week evidence window with weekly data-health checks and owner sign-off; later stages remain gated.

## Consequences

### Positive

- Privacy posture is structural: the normalizer cannot write what the registry does not admit, and the 17-control contract suite runs in CI.
- Default deploy collects nothing; the first enabled lane stores only C0 aggregates with zero pseudonyms.
- Bot reliability is decoupled from analytics: kill switch stops subscribers/workers; zero-listener mode is a no-op.
- Subject rights, retention, rekey, and backfill reconciliation are first-class, so later lanes inherit a compliant substrate.
- Rollout decisions are auditable: every task commit, gate result, and drill output is recorded in `09-stage-a-evidence.md` with owner signature.

### Negative

- Significant dormant complexity ships before the first dashboard: pseudonymous machinery, delivery ledger, and rekey exist but stay inactive through Stage B.
- Adding any new telemetry signal requires contract + registry + test changes; ad-hoc instrumentation is impossible by design.
- The external-aggregate lattice is intentionally restrictive (no custom ranges, drill-through, or multi-dimensional cells); richer analysis must stay local.
- Additive-only migrations leave tables in place on rollback, requiring a future reviewed cleanup migration.

### Risks

- Dormant code paths could rot before Stage C/E activation. Mitigation: the privacy-contract and rollout-gate suites exercise gated lanes in tests, and the runbook's stage-entry checklists force re-verification at each transition.
- Sessionization/intent versioning means derived rows must be rebuilt on version bumps. Mitigation: derivations are versioned (`sessionization.v1`, `intent.v1`) and idempotent per `(turn_key, taxonomy_version)`.

## Implementation Notes

- All 18 build tasks landed with green named gates; per-task commit hashes, gate outputs, the all-green 17-control matrix, reconciliation/snapshot/deletion/rekey drill outputs, and the owner privacy/security signature (2026-07-29) are recorded in `docs/research/analytics-metrics/09-stage-a-evidence.md`.
- Analytics migrations were renumbered to 072–075 during execution per 06's renumber rule (master added intervening migrations); three milestone rebases onto `origin/master` are logged in the evidence doc.
- Binding release gates (build, full test suites, typecheck, lint, security, stories, knip, duplicates) all pass; one local parallel-run flake was reproduced as environmental and recorded.

## Related Decisions

- ADR-0308: Analytics Governance and Delivery Lanes — the frozen governance/egress model this pipeline implements.
- ADR-0120: Central LLM Credentials, Usage Telemetry, and Anonymous Statistics — operational usage rows remain distinct from canonical analytics; backfill normalizes them with provenance.

## References

- Plan: `docs/superpowers/plans/2026-07-24-analytics-stage-a.md`
- Execution design: `docs/superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md`
- Implementation plan of record: `docs/research/analytics-metrics/06-implementation-plan.md`
- Evidence: `docs/research/analytics-metrics/09-stage-a-evidence.md`
- Runbooks: `docs/operations/analytics-runbook.md`, `docs/operations/analytics-incident-runbook.md`
