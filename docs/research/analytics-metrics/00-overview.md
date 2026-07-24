<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Product and UX analytics research — executed report

**Research date:** 2026-07-23  
**Status:** research artifacts complete; formal governance/product sign-off and
the OpenPanel visual criterion remain pending; implementation not started  
**Source plan:** [`../analytics-metrics-research-plan.md`](../analytics-metrics-research-plan.md)  
**Scope:** a content-free product/UX measurement system for papai, including
the current-event audit, canonical metrics, privacy and consent design, intent
classification experiment, provider evaluation, disposable provider PoCs,
implementation sequencing, and the validation ritual.

This folder is the executed research, not a runtime patch. It does not enable
analytics, read an operator database, forward data, or alter papai behavior.
All executable evidence uses deterministic synthetic data.

## Executive decision

Use two independent lanes:

```text
papai event sources
  └─ strict, versioned analytics normalizer
       ├─ local aggregate rollups (shipping default)
       └─ local pseudonymous canonical events (governance-gated)
            ├─ read-only SQLite snapshot → Metabase
            └─ per-sink delivery ledger → product-sink PoC candidate
```

The decisions are:

1. **Do not forward the debug event bus.** It is an observability surface whose
   current payloads include generated text, tool-step detail, raw error strings,
   memo content, search queries, names, URLs, IDs, schedules, and arbitrary log
   records. Analytics uses typed source adapters and fails closed on unknown
   fields.
2. **Make aggregate-local analytics the shipping default.** It contains no
   longitudinal actor, context, thread, turn, or session key. Operators must
   finish governance setup before enabling local pseudonymous analytics.
   Pseudonymous external egress is a separate actor-eligible, default-off mode.
3. **Use purpose-separated HMAC pseudonyms.** Do not reuse
   `stats_anonymity_salt`. Raw actor, context, task-instance, turn, model, tool,
   coding-project, and coding-session identifiers do not enter canonical
   analytics. There is no implicit cross-platform person graph.
4. **Model sessions by actor and conversation partition.** Use
   `(actor_key, thread_key ?? context_key)` so Discord contexts do not collapse
   when exported `thread_key` is null. A gap strictly greater than 30 minutes
   starts a new session. Guests have no actor/session continuity and contribute
   aggregate-only counters.
5. **Use transparent outcome and friction definitions.** Semantic tool success,
   recovery, censoring, and abandonment are distinct terminal states.
   `Friction Signature v1` exposes seven binary components rather than hiding
   judgment in a weighted score.
6. **Adopt `intent.v1`, a fixed 23-label goal taxonomy.** The initial labeling
   path is deterministic tool-trace plus metadata inference with abstention.
   SMALL_MODEL remains off unless a frozen benchmark proves incremental
   accuracy/coverage while satisfying privacy, cost, and asynchronous-latency
   gates.
7. **Use Metabase over a read-only SQLite snapshot for local BI.** Current
   Metabase has an official SQLite driver, so DuckDB or ClickHouse is not an
   MVP prerequisite.
8. **Use OpenPanel as the self-hosted product-analytics PoC candidate, not an
   approved pseudonymous sink.** It provides native funnels and event-based
   retention, but requires PostgreSQL, Redis, ClickHouse, and a papai-owned
   delivery ledger. Its public API documents neither caller-controlled event
   idempotency nor per-actor event erasure. Pseudonymous production egress
   remains blocked until both behaviors are integration-tested and deletion is
   supportable for every actor-key version.
9. **Do not recommend self-hosted PostHog.** Its current official documentation
   calls open-source self-hosting unsupported and assigns upgrades, security,
   and operations to the operator.
10. **Do not reuse the existing single-state outbox columns.** Delivery state
    belongs in `(event_id, sink_version_id)` rows so retry, consent withdrawal,
    immutable payload versions, deletion, credential rotation, and multiple
    destinations remain correct.

## Reading order

| # | Document | What it resolves |
|---:|---|---|
| 01 | [`01-current-event-inventory.md`](./01-current-event-inventory.md) | Every current bus event and durable usage source; unsafe payloads and missing sources |
| 02 | [`02-metric-catalog.md`](./02-metric-catalog.md) | Canonical envelope, strict event registry, identities, sessions, outcomes, funnels, RQ1–RQ8 definitions |
| 03 | [`03-privacy-consent-threat-model.md`](./03-privacy-consent-threat-model.md) | Collection modes, consent/eligibility, HMAC/key lifecycle, retention, DSAR/deletion, threats, release-blocking tests |
| 04 | [`04-intent-labeling-spike.md`](./04-intent-labeling-spike.md) | `intent.v1`, synthetic experiment, measured strategies, thresholds, and labeling decision |
| 05 | [`05-provider-scorecard-and-poc.md`](./05-provider-scorecard-and-poc.md) | Current provider facts, weighted scorecard, architecture choice, rendered visual evidence, and limitations |
| 06 | [`06-implementation-plan.md`](./06-implementation-plan.md) | Test-first staged build plan, rollout, backfill, kill switch, and file-level touchpoints |
| 07 | [`07-validation-and-review-ritual.md`](./07-validation-and-review-ritual.md) | Reconciliation, golden journeys, dashboard correctness, and recurring product/UX review |
| 10 | [`10-references.md`](./10-references.md) | Primary sources and evidence provenance |

Executable PoC artifacts live in [`poc/`](./poc/). Generated databases,
credentials, application state, and containers are disposable and are not
committed.

## Research questions to decision surfaces

| Research question | Canonical facts | Derived model | Primary dashboard |
|---|---|---|---|
| RQ1 scenarios | `intent_classified`, eligible turns | intent mix and classifier coverage | Intents and feature adoption |
| RQ2 activation | first authorized DM, config/settings/assignment events, semantic tool success | ordered 7/14-day activation funnel | Activation |
| RQ3 success | semantic tool outcomes, intent goals, replies | Outcome v1 | Intents and feature adoption |
| RQ4 friction | rephrase, clarification, confirmation, stop, steering, latency, disclosure, failure chain | Friction Signature v1 | Reliability, friction, and performance |
| RQ5 errors | bounded LLM/tool/provider/config/rate-limit/MCP classes | rates with correct at-risk denominators | Reliability, friction, and performance |
| RQ6 engagement | eligible actor activity and sessions | DAU/WAU/MAU, exact D1/D7/D30 retention | Engagement and retention |
| RQ7 adoption | capability-aware `feature_used` events | adopter penetration and D30 association | Intents and feature adoption |
| RQ8 performance | monotonic queue/feedback/token/reply/turn/tool/confirmation clocks | percentiles and capability-aware coverage | Reliability, friction, and performance |

## Corrections to the source plan

The plan was a useful hypothesis, but current evidence changes these points:

- Metabase SQLite and ClickHouse are official drivers; DuckDB is a community
  driver. The PoC therefore uses direct SQLite.
- Grafana SQLite support is a community plugin with filesystem/`ATTACH`
  security implications; its ClickHouse integration is official.
- Superset can read SQLite directly and does not strictly require a warehouse.
- PostHog open-source self-hosting is unsupported, not merely “Cloud
  recommended above a volume threshold.”
- OpenPanel is operationally medium-heavy: three stateful stores plus
  application/worker services, not a one-container alternative.
- Umami v3 is PostgreSQL-only and now has funnels, journeys, retention, and
  basic cohorts, although its semantics remain narrower than a product suite.
- Countly Lite has a modified license and gates important product analytics;
  Matomo funnels/cohorts/user-flow are paid plugins; Plausible CE does not
  provide the required native product funnel surface.
- The first provider PoC must be synthetic-only. Using “real dev” data before
  a normalizer, allowlist, governance, and anonymity tests exist would reverse
  the required privacy gate.
- `subject_hash + thread` is not a sufficient session key in a shared group,
  and a nullable thread alone collapses Discord contexts. Sessionization is
  `(actor_key, thread_key ?? context_key)`.
- A single stable pseudonymous default would silently make retention
  collection mandatory. Aggregate-local is the safer default; longitudinal
  analytics is an explicit governed mode.
- Raw `turn_id` cannot be an egress correlation key. Canonical analytics uses
  a purpose-separated `turn_key`.
- The existing inert outbox columns encode one unnamed sink only. They remain
  untouched; a per-sink delivery table is required.

## Method and evidence boundary

- The source audit used the rebuilt structural code index and then read every
  emitter/wrapper branch. An independent review found an additional event
  hidden behind an injected generic emitter: the corrected known minimum is 55
  event names at 77 static production emission sites.
- Metric and privacy definitions were reconciled with papai's current scope
  model, usage schemas, stats anonymity contract, tool outcome behavior, and
  settings architecture.
- Provider claims were rechecked on 2026-07-23 against primary project,
  license, API, deployment, and pricing documentation.
- The intent experiment and provider PoCs use versioned generators, committed
  queries/configuration, exact image digests, and captured results. Metabase's
  four server-rendered dashboard PDFs have committed Poppler-rendered visual
  evidence. OpenPanel's four native report endpoints were executed and
  recorded, but its visual screenshot criterion remains unfulfilled because
  the required in-application browser was unavailable and the pinned service
  has no native PNG/PDF dashboard export.
- No production or operator database, message, memo, attachment name, raw URL,
  task/project name, credential, or raw identifier was used.
- GDPR discussion is a technical privacy-by-design baseline, not legal advice
  or a declaration of lawful basis for every self-hosted operator.

## Decision status

These are research recommendations, not accepted repository ADRs. The repo's
ADR convention records architectural decisions after implementation validates
their exact shape. Implementation should create proposed ADRs only where the
build reveals a significant choice not already resolved by this report.

The privacy design still requires named operator/product/privacy sign-off: no
pseudonymous collection, classifier text processing, real-data validation, or
sink enablement proceeds until its release-blocking contract is implemented
and reviewed.

The implementation plan was independently reviewed after drafting. Its
release-blocking findings—including snapshot byte leakage, consent rechecks,
crash-gap reconciliation, rekeying, rollback provenance, request attribution,
and Discord session partitioning—are incorporated into the binding plan rather
than deferred to implementation.
