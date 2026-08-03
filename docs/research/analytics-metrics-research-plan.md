<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Deep Research Plan: Product & UX Analytics Coverage for papai

**Date:** 2026-07-19
**Status:** Research plan (no implementation)
**Goal:** Define how to instrument papai end-to-end so we can understand *who
uses it, how they use it, where they succeed, and where they get stuck /
confused / hit errors* — then surface that understanding on dashboards a
product/UX person can actually read.

> This document is a **plan for the research**, not the research itself. It sets
> the questions, the metric taxonomy, the instrumentation strategy (built on
> papai's existing event bus + usage tables), the privacy guardrails, the
> dashboard-provider shortlist to evaluate, and the phased execution with
> deliverables. Nothing here changes runtime behavior.

---

## 1. Why now / motivating scenarios

papai is a natural-language chat bot that manages tasks via LLM tool-calling
across Telegram / Mattermost / Discord / Kontur Talk. Because the interface is
free-form language and the behavior branches on platform, task instance,
context type, scope, permissions, guest mode, BYOK, mid-run steering, etc.
(`docs/architecture/behaviors.md`), we currently have **almost no visibility
into the lived user experience**. We can see LLM cost/usage aggregates, but we
cannot answer product questions like:

1. **Scenario discovery.** What are people actually *trying* to do — create
   tasks, search memos, set recurring reminders, run coding sessions, fetch
   web pages? Which intents dominate, and which are rare-but-sticky?
2. **Onboarding & activation.** From a user's first DM, how long until they
   complete a first *successful* task action? Where do first-time users drop
   off (e.g. never finish `/config`, never assign a task instance)?
3. **Friction & confusion.** Where do users rephrase the same request several
   times in a row? Where does the model ask a clarifying question and the user
   abandons? Where do `ask`-gated tool confirmations get denied or ignored?
4. **Errors.** What fraction of turns end in an LLM error, a tool failure, a
   provider (Kaneo/YouTrack) 4xx/5xx, an unconfigured-context reply, or a
   web-fetch rate-limit block? Which tools fail most, and are failures
   recovered within the same turn?
5. **Engagement & retention.** DAU/WAU/MAU, per-platform and per-context-type
   (DM vs group), day-N retention, session length, turns per session.
6. **Feature adoption.** Who uses recurring tasks, deferred prompts,
   long-term memory, attachments, live status, coding sessions, MCP endpoints?
   Do power features correlate with retention?

The purpose of the research is to turn these questions into a **concrete,
privacy-safe metric catalog + instrumentation + dashboards** that the team can
keep using.

---

## 2. Current state — what we can build on

papai already has the skeleton of an analytics pipeline. The research must
**extend, not reinvent** it.

### 2.1 In-process event bus (`src/debug/event-bus.ts`)

A synchronous pub/sub with three emit helpers (`emitUser`, `emitGroup`,
`emitGlobal`), each event carrying `{ type, timestamp, data, scope, turnId? }`
where `scope` is `user | group | global`. Emitting is **free when there are no
listeners** (`listeners.size === 0` short-circuit), so it is safe to emit
liberally.

Existing event families already emitted across `src/` (non-exhaustive):

| Domain          | Event types (samples)                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| Turn lifecycle  | `turn:start`, `turn:end`, `turn:summary`                                          |
| Messaging       | `message:received`, `message:replied`, `reply:sent`, `typing:start/stop`          |
| LLM             | `llm:start`, `llm:end`, `llm:error`, `llm:full`, `llm:tool_result`               |
| Tools           | `tool:execute_end`, `tool:failure_classified`                                     |
| Auth            | `auth:check`, `auth:group_authorized`, `auth:group_revoked`                       |
| Tool disclosure | `disclosure:search`, `disclosure:load`, `disclosure:fallback`                     |
| Memory          | `memory:*` (capture/promote), `memo:created/searched/archived`                    |
| Scheduling      | `recurring:*`, `deferred:*`, `scheduler:tick/task_executed`, `poller:*`, `notify:*` |
| Identity        | `identity:set`, `identity:cleared`, `group_member:added/removed`                  |
| Cache           | `cache:sync/load/expire`, `msgcache:sweep`, `trim:start/end`                      |

This is a **rich behavioral firehose that is currently only consumed by the
debug SSE stream and the usage recorder** — it is not persisted as product
analytics and not forwarded anywhere.

### 2.2 Usage persistence (`src/usage/`)

A single subscriber (`initUsageRecorder`) listens on the bus and writes two
durable SQLite tables:

- **`llm_usage_events`** — one row per LLM turn/role: `turnId`,
  `storageContextId`, `contextType`, `chatUserId`, `model`, `modelRole`,
  `inputTokens`/`outputTokens`, `stepCount`, `toolCallCount`, `messageCount`,
  `finishReason`, `durationMs`, `responseId`, `error`.
- **`tool_call_events`** — one row per tool execution: `toolName`,
  `toolCallId`, `success`, `durationMs`, `argsBytes`, `resultBytes`, plus a
  post-hoc classification (`errorType`, `errorCode`, `retryable`, `recovered`).

Both use a **deterministic SHA-256 `event_id`** (idempotent inserts — dup
inserts are swallowed), are indexed by subject/chat-user/turn/time, and — most
importantly — **both already carry inert outbox columns**: `forwarded_at`,
`forward_attempts`, `forward_error` (migration `038`). The architecture doc
calls these *"inert outbox columns reserved for a future forwarder."* **This is
the seam the analytics forwarder is meant to plug into.**

### 2.3 Anonymous aggregate surface (`src/stats/`)

`getGlobalStats()` / `getSubjectStats()` power the read-only `/admin#stats`
panel over `/stats/*`. These are governed by a **release-blocking anonymity
contract** (`docs/architecture/overview.md`): only counts, sizes, timestamps,
enum distributions, and *keyed-hashed* high-cardinality identifiers may leave
these routes; message text, memo bodies, names, URLs, tags, project/status
names, and any free-form content must **never** appear. Salt lives in
`system_config.stats_anonymity_salt`.

### 2.4 Surfaces & clients

- `/debug` engineer live-observability (SSE `/events`, gated by `DEBUG_SERVER`).
- `/admin` read-only operator dashboard (Overview, Billing, Stats, Memos,
  Reminders, Identities) — Svelte SPA in `client/admin/`.
- `/settings` config SPA (`client/settings/`).
- `POST /api/notify` proactive-delivery plane (bearer-token auth).

### 2.5 Gaps this research must close

1. **No persisted product/UX event stream.** Behavioral events (`message:*`,
   `turn:*`, `disclosure:*`, scheduler/memory events) evaporate after the SSE
   stream; only LLM + tool rows survive.
2. **No intent/scenario labeling.** We record *that* a turn happened and which
   tools ran, but not *what the user was trying to accomplish*.
3. **No funnel / session / retention modeling.** No notion of a user session,
   activation, or cohort.
4. **No confusion/friction signals.** No repeated-rephrase detection, no
   clarify-then-abandon, no confirmation-denied metric.
5. **No forwarder + no external dashboard.** The outbox columns are inert; there
   is no destination and no BI/product-analytics tool wired up.
6. **No config context for opt-in/consent** governing analytics collection and
   (for SaaS) egress.

---

## 3. Research questions (the deliverable answers these)

Grouped so each maps to a metric family in §4 and a dashboard in §7.

- **RQ1 — Scenarios.** What are the top user intents, at what frequency, per
  platform / context type / task provider? How do intent mixes differ between
  new and returning users?
- **RQ2 — Activation.** What is the first-DM → first-successful-action funnel?
  What are the biggest drop-off steps (`/config` link issued but never opened;
  task instance never assigned; first task action fails)?
- **RQ3 — Success rate.** Per intent and per tool, what is the
  success / failure / recovered-failure / abandoned breakdown?
- **RQ4 — Friction & confusion.** Rate of repeated rephrasings, clarify-then-
  abandon, `/stop` usage, mid-run steering, `ask`-confirmation denials, long
  turns, and disclosure stall-fallbacks.
- **RQ5 — Errors.** Volume and taxonomy of LLM errors, tool failures, provider
  errors, unconfigured-context replies, rate-limit blocks, MCP-server outages.
- **RQ6 — Engagement/retention.** DAU/WAU/MAU, session length, turns/session,
  day-1/7/30 retention, by platform and cohort.
- **RQ7 — Feature adoption.** Adoption + retention correlation for each major
  feature (recurring, deferred, memory, attachments, coding sessions, MCP,
  BYOK, guest mode).
- **RQ8 — Performance-as-UX.** Time-to-first-token, typing-to-reply latency,
  turn duration distributions, live-status coverage — because latency *is* a
  UX metric here.

Each RQ must be answerable **without reading any user content** (see §6).

---

## 4. Metric taxonomy (what to measure)

The catalog is organized as **events → derived sessions → funnels → cohorts**.
Everything below is designed to be computed from metadata only.

### 4.1 Canonical analytics event envelope

Define one normalized envelope the forwarder emits (superset of the current
usage rows), so any downstream tool sees a consistent shape:

```
AnalyticsEvent {
  event_id            // deterministic SHA-256 (idempotent)
  occurred_at         // ms epoch
  event_name          // e.g. "turn_completed", "tool_failed", "intent_detected"
  subject_hash        // keyed-hash of storageContextId (NEVER raw)
  actor_hash          // keyed-hash of chatUserId (NEVER raw)
  platform            // telegram | mattermost | discord | kontur-talk
  context_type        // dm | group
  actor_role          // admin | member | guest
  task_provider       // kaneo | youtrack | none
  turn_id             // correlation key
  session_id          // derived (see 4.3)
  props { … }         // typed, allowlisted, content-free properties only
  app_version         // for release comparisons
}
```

`props` is a **strict allowlist per event_name** (mirrors the live-status
"allowlisted-argument" pattern in `src/live-status/tool-status-labels.ts`) —
no field lands in `props` unless explicitly mapped and proven content-free.

### 4.2 Core event families to instrument

| Family            | Events (examples)                                                             | Answers |
| ----------------- | ---------------------------------------------------------------------------- | ------- |
| **Message/turn**  | `message_received`, `turn_started`, `turn_completed`, `turn_errored`, `reply_sent` | RQ6, RQ8 |
| **Intent**        | `intent_detected` (label + confidence), `intent_multi` (multi-goal turn)      | RQ1     |
| **Tool**          | `tool_called`, `tool_succeeded`, `tool_failed` (+ errorType/code/retryable/recovered) | RQ3, RQ5 |
| **Confirmation**  | `confirmation_requested`, `confirmation_granted`, `confirmation_denied`, `confirmation_ignored` | RQ4 |
| **Steering/stop** | `steer_injected`, `stop_requested`, `stop_forced`                             | RQ4     |
| **Friction**      | `rephrase_detected`, `clarify_requested`, `clarify_abandoned`, `disclosure_fallback` | RQ4     |
| **Provider**      | `provider_call`, `provider_error` (Kaneo/YouTrack, status class only)          | RQ5     |
| **Config/onboard**| `context_seeded`, `config_link_issued`, `task_instance_assigned`, `settings_opened`, `preset_applied` | RQ2 |
| **Feature use**   | `recurring_created`, `deferred_created`, `memo_created/searched`, `attachment_ingested`, `coding_session_started`, `mcp_endpoint_used`, `byok_enabled`, `web_fetched` | RQ7 |
| **Auth**          | `auth_granted`, `auth_denied`, `guest_turn`, `group_authorized`               | RQ2, RQ7 |
| **Errors/infra**  | `llm_error`, `mcp_server_down`, `rate_limit_blocked`, `unconfigured_reply`     | RQ5     |

Most of these map **1:1 or N:1 onto events already on the bus** (§2.1) — the
work is *normalizing + persisting + forwarding*, not emitting from scratch. New
emit sites needed are relatively few (intent, confirmation outcomes, rephrase,
clarify-abandon, unconfigured-reply, provider status class).

### 4.3 Derived: sessions

No native session concept exists. Derive one with an **inactivity-gap
sessionizer** (e.g. 30-min idle gap closes a session), keyed on
`subject_hash + thread`. Session metrics: duration, turn count, tool count,
intent set, ended-in-error flag, ended-in-abandon flag. Sessionization can run
in the forwarder or downstream in the analytics tool (SQL) — the research must
choose based on the selected provider.

### 4.4 Derived: funnels & activation

- **Activation funnel:** `first_dm → config_link_issued → settings_opened →
  task_instance_assigned → first_tool_success`.
- **Task-creation funnel:** `intent(create_task) → tool_called(create_task) →
  tool_succeeded → reply_sent(no error)`.
- **Coding-session funnel:** `list_projects → start_session → session_active →
  review_pr`.
Drop-off at each step, segmentable by platform/cohort.

### 4.5 Derived: confusion / friction score

A composite, per-session **friction score** from: rephrase count,
clarify-abandons, confirmation denials, `/stop` (esp. force-stop), long-turn
count, disclosure fallbacks, and consecutive failed tools. Used to rank the
*worst* sessions for qualitative review (metadata-only; no transcript access).

### 4.6 Intent classification approach (research spike)

Because the interface is natural language, "intent" is the crux of RQ1/RQ4 and
needs a dedicated spike. Candidate strategies to evaluate, cheapest-first:

1. **Tool-trace inference (no LLM).** Map the *sequence of tools invoked* in a
   turn to an intent label (e.g. any `create_task` → "create task"). Zero cost,
   zero content, but misses intents that never reach a tool (the interesting
   failure/confusion cases).
2. **Cheap classifier on metadata.** Use the already-computed
   `finishReason` + tool trace + step count + whether a clarify was asked.
3. **SMALL_MODEL intent tagging.** Reuse the existing SMALL_MODEL role to emit a
   single **enum label** per turn (from a fixed taxonomy) — *label only, never
   the text* — written to `props.intent`. Cost, latency, and privacy tradeoffs
   must be measured; must be opt-in and cache-friendly. This mirrors existing
   SMALL_MODEL uses (compaction summaries, memory extraction).

The spike's output is a **fixed intent taxonomy** (~15–25 labels) + the chosen
labeling method + its measured cost/accuracy.

---

## 5. Instrumentation architecture (proposed design to validate)

The research should validate this shape before any build:

```
bus events (emitUser/Group/Global)
   └─ AnalyticsSubscriber (new, alongside usage recorder)
        ├─ normalize → AnalyticsEvent envelope (allowlisted props only)
        ├─ persist  → analytics_events table (local SoT, idempotent, outbox cols)
        └─ (later) forwarder → external sink (batched, retry, backoff)
                                 ↑ reuses forwarded_at/forward_attempts/forward_error
```

Design principles (each a research check):

- **Local-first, forward-second.** SQLite stays the source of truth; the
  external dashboard is a *consumer*. Matches the existing outbox design and the
  self-hostable ethos. An operator who forwards nothing still gets local
  dashboards.
- **Content-free by construction.** The normalizer is the single choke point;
  the anonymity contract (§6) is enforced there and unit-tested exactly like the
  `/stats/*` anonymity test.
- **Idempotent + replayable.** Deterministic `event_id` + outbox columns let the
  forwarder retry/backfill without dupes (reuse `src/usage/event-id.ts`
  pattern).
- **Zero-overhead when off.** Bus already no-ops with no listeners; the
  subscriber registers only when analytics is enabled. Batched async forward,
  never in the reply hot path.
- **Bounded concurrency** on forward (`p-limit`, per repo convention).
- **Backfill.** Because `llm_usage_events`/`tool_call_events` already exist, we
  can backfill historical LLM/tool analytics from day one.

Open design questions for the research to resolve:

- One wide `analytics_events` table vs. reuse/extend the two existing usage
  tables? (Leaning: new table for behavioral events, keep usage tables as-is and
  forward them too.)
- Forward **raw events** to a product-analytics tool, or **pre-aggregated
  rollups** to a BI tool, or both?
- Where does sessionization/intent live — in-process vs. in the warehouse?
- Consent/opt-in model (see §6.4) and its config key + scope.

---

## 6. Privacy, anonymity & consent (non-negotiable constraints)

This is the highest-risk area and gates everything. papai encrypts instance
config at rest, forbids logging secrets, and enforces a release-blocking
`/stats/*` anonymity contract. Analytics must inherit all of that.

### 6.1 Hard rules (carry over the `/stats/*` contract)

- **Never** emit message text, memo/observation bodies, attachment filenames,
  raw URLs/paths, usernames/display names, workspace/project/status/tag names,
  RRULE text, or any free-form content into an analytics event.
- High-cardinality identifiers (`storageContextId`, `chatUserId`, web-fetch
  hostnames, rrule patterns) are **keyed-hashed** with a salt (reuse
  `stats_anonymity_salt` or a dedicated `analytics_salt`), never raw.
- Web-fetch analytics follow the existing rule: hostname *hashed*, never the URL.
- Allowlist `props` per event; a reconciliation test (like the
  `ENTITY_SCOPES` / `CONTEXT_OWNED_COLUMNS` consistency test) fails CI if any
  event carries an unlisted or free-form field.

### 6.2 Anonymity model choice (research decision)

Decide between **pseudonymous** (keyed-hash lets you follow a stable subject
across sessions → enables retention/cohorts) vs **fully anonymous** (rotating
salt, no cross-session join → strongest privacy, weaker analytics). Likely
answer: pseudonymous with a *non-rotating* `analytics_salt` for local analytics,
and a stricter posture for any external egress. Must be documented and
defensible under the BUSL/self-host model.

### 6.3 Self-hosted vs SaaS egress

papai is self-hostable (multi platform-instance, BYOK, magi). The plan must
distinguish:

- **Local dashboards** (no data leaves the operator's box) — default-on, low
  privacy risk.
- **External forwarding** (SaaS product-analytics/BI) — **default-off**,
  operator-configured endpoint + token (mirror `NOTIFY_TOKEN` / MCP-endpoint
  config patterns), documented in `docs/architecture/environment.md`.

### 6.4 Consent / opt-out

Evaluate a per-context analytics toggle (config-context scoped, like the
AI-output settings) and/or a global operator switch. Guests are already excluded
from memory capture; decide their analytics treatment (likely: counted as
`guest_turn` aggregate only, no subject continuity).

### 6.5 Security review

Any forwarder is an outbound network sink → must pass `bun security` (Semgrep:
unsafe fetch, secret exposure) and a manual review, same bar as `web_fetch`.

---

## 7. Dashboard / analytics providers to evaluate

The user explicitly wants **dashboard providers usable for analysis**. papai's
constraints shape the shortlist: **self-hostable, privacy-first, works with a
SQLite/append-only event source (or a small warehouse), event-based product
analytics *and*/or BI, GDPR-friendly.** Two complementary tool *classes* are in
scope and we will likely recommend **one from each**:

**Class A — Product analytics** (funnels, retention, cohorts, paths, event
explorer): PostHog, OpenPanel, Countly, Matomo, Mixpanel, Amplitude.

**Class B — BI / dashboarding** (SQL over our own tables, flexible custom
charts): Metabase, Grafana, Apache Superset, Redash.

### 7.1 Candidate matrix (to be filled/scored during research)

| Provider          | Class | Self-host | License      | Storage/backend        | Funnels/Retention | SQLite-friendly? | Ops weight | Notes |
| ----------------- | ----- | --------- | ------------ | ---------------------- | ----------------- | ---------------- | ---------- | ----- |
| **PostHog**       | A     | Yes*      | MIT (core)   | ClickHouse+Kafka+PG+Redis | Excellent         | Via ingestion API | **Heavy** (self-host discouraged at scale; ~4vCPU/16GB min) | All-in-one (analytics, flags, replay, error tracking, surveys) but self-host is operationally the heaviest; vendor pushes Cloud |
| **OpenPanel**     | A     | Yes       | AGPL         | ClickHouse+PG+Redis     | Good (funnels, retention, cohorts, profiles) | Via ingestion API | Medium (one-command Compose) | Lighter PostHog alternative; feature parity self-host vs cloud |
| **Matomo**        | A/Web | Yes       | GPL          | MySQL/MariaDB           | Good (GA4-style)  | Import/API        | Medium     | Strong GDPR story; more web-analytics-shaped than product-event |
| **Countly**       | A     | Yes       | AGPL/comm.   | MongoDB                 | Good              | Ingestion API     | Medium     | Product analytics, on-prem heritage |
| **Umami**         | Web   | Yes       | MIT          | PG/MySQL                | Basic (web-first) | Event API         | **Light**  | Privacy-first, cookieless; limited product-analytics depth |
| **Plausible CE**  | Web   | Yes       | AGPL         | ClickHouse+PG           | Basic (web-first) | Event API         | Light      | Simplest privacy web analytics; not event-funnel product analytics |
| **Metabase**      | B     | Yes       | AGPL/OSS     | Reads our DB directly   | Via SQL/models    | **Yes (direct/DuckDB/CH connector)** | Light-Med  | Best fit for "point BI at our own tables"; question/dashboard builder for non-SQL users |
| **Grafana**       | B     | Yes       | AGPL         | Plugins per source      | Via SQL/panels    | Yes (SQLite/CH plugins) | Light-Med  | Great for time-series/ops + errors; less "product analytics" shaped |
| **Apache Superset**| B    | Yes       | Apache-2.0   | Any SQL warehouse       | Via SQL/charts    | Yes (needs a warehouse) | Medium     | Powerful BI; heavier setup |
| **Mixpanel**      | A     | Cloud     | Proprietary  | SaaS                    | Excellent         | Ingestion API     | None (SaaS) | Best-in-class product analytics but data egress → SaaS (weighs against privacy posture) |
| **Amplitude**     | A     | Cloud     | Proprietary  | SaaS                    | Excellent         | Ingestion API     | None (SaaS) | As above |

\* PostHog self-host is supported but the vendor recommends Cloud above
~300k events/month and calls the self-host math rarely worth it.

### 7.2 Selection criteria (weighted scorecard to produce)

Score each candidate 1–5 on: privacy/self-host fit, ability to answer RQ1–RQ8,
SQLite/append-source compatibility, funnel+retention+cohort depth,
usability for a non-engineer PM, operational weight, licensing (BUSL project →
prefer permissive/AGPL-compatible-for-a-separate-service), community/longevity,
and cost.

### 7.3 Likely recommendation shape (hypothesis to test, not a conclusion)

- **Fast path / MVP:** **Metabase** pointed at the local `analytics_events` +
  usage tables (or a DuckDB/ClickHouse mirror). Zero data egress, immediate
  funnels/retention via SQL models, non-engineer-friendly dashboards. Lowest
  risk to prove value.
- **Product-analytics depth:** **PostHog (self-host)** or **OpenPanel** via the
  forwarder for native funnels/retention/paths/cohorts without hand-writing SQL,
  *if* the ops weight is justified — OpenPanel likely wins on footprint.
- **Ops/error monitoring overlay:** **Grafana** on the same tables for
  real-time error/latency/rate-limit dashboards (complements, not replaces, A).
- **SaaS (Mixpanel/Amplitude):** only for a hosted deployment that has cleared
  the egress/consent bar in §6 — otherwise excluded on privacy grounds.

The research must confirm/replace this via §7.2 scoring + a hands-on spike.

---

## 8. Research methodology & phases

Each phase has an explicit deliverable; phases are ordered so early phases
de-risk later ones.

### Phase 0 — Inventory & baseline (read-only)
- Enumerate every current bus event, its `data` payload, and emit site; map each
  to an event in §4.2 and flag payload fields as content-free / needs-scrubbing.
- Snapshot what `llm_usage_events` / `tool_call_events` already answer.
- **Deliverable:** event-inventory table + gap list (which §4 events have no
  source yet).

### Phase 1 — Metric catalog & taxonomy sign-off
- Finalize the event catalog, the `AnalyticsEvent` envelope, the intent
  taxonomy, session/funnel/friction definitions.
- **Deliverable:** `analytics-metric-catalog.md` (the canonical spec).

### Phase 2 — Privacy & consent design
- Anonymity model decision (§6.2), consent/opt-out design, egress policy,
  allowlist-per-event, salt strategy, the CI anonymity test design.
- **Deliverable:** privacy design section + a threat model; sign-off gate before
  any code.

### Phase 3 — Intent-classification spike
- Prototype the three §4.6 strategies on synthetic/opt-in data; measure
  cost/latency/accuracy; pick one.
- **Deliverable:** intent-labeling recommendation + fixed taxonomy.

### Phase 4 — Provider evaluation & PoC
- Score the §7 matrix; stand up a **local Metabase PoC** on real (dev) usage
  tables + a **forwarder PoC** to one product-analytics tool (OpenPanel or
  PostHog) with synthetic events; build the activation funnel + retention +
  top-intents + error-taxonomy dashboards end-to-end.
- **Deliverable:** provider scorecard + working PoC dashboards + screenshots +
  recommendation.

### Phase 5 — Implementation plan
- Turn the validated design into a staged build plan: `AnalyticsSubscriber`,
  `analytics_events` schema + migration, normalizer + allowlist tests, backfill
  job, forwarder (reusing outbox columns), config keys, settings toggle, docs.
- **Deliverable:** implementation plan + rollout/backfill/kill-switch strategy.

### Phase 6 — Validation & iteration
- Define how we know the analytics are *correct* (event counts reconcile with
  usage tables; funnel numbers sanity-checked against known behavior) and a
- cadence for reviewing the "worst friction sessions" (metadata-only) to feed UX
  fixes.
- **Deliverable:** validation checklist + a recurring UX-metrics review ritual.

---

## 9. Risks & open questions

- **Privacy leakage** is the top risk — a single content-bearing field forwarded
  externally is a release-blocking defect. Mitigation: single normalizer choke
  point + allowlist + CI test + default-off egress.
- **Intent labeling cost/latency** — SMALL_MODEL per-turn tagging adds cost and
  a dependency; the spike must prove it's worth it vs. tool-trace inference.
- **Ops weight of product-analytics self-host** (esp. PostHog's
  ClickHouse+Kafka stack) may outweigh value for small operators → the
  local-Metabase fast path exists precisely to hedge this.
- **Group vs. thread vs. user scope** must be respected in analytics exactly as
  `src/chat/context-scope.ts` defines it, or metrics will double-count or
  mis-attribute (e.g. group-shared config vs. thread-isolated conversation).
- **Sessionization gap** parameter (idle timeout) is a modeling choice that
  changes retention/session numbers — must be documented and held stable.
- **Backfill fidelity** — historical rows lack the newer fields (intent,
  friction); dashboards must handle partial history.
- **Multi-instance attribution** — platform instances and task instances must be
  dimensions, not lost, so per-tenant analysis is possible.

## 10. Definition of done for the research

The research is complete when we have: (1) a signed-off metric catalog answering
RQ1–RQ8 with content-free events; (2) a privacy/consent design that upholds the
existing anonymity contract; (3) a chosen intent-labeling method; (4) a scored
provider recommendation with **working PoC dashboards** (a local BI dashboard +
one forwarded product-analytics dashboard); and (5) a concrete, staged
implementation plan that plugs into the existing event bus, usage tables, and
inert outbox columns.

---

## Appendix A — Sources (provider landscape)

Provider facts in §7 were cross-checked against current (2025–2026) sources:

- [PostHog — open-source self-host support & scale guidance](https://posthog.com/docs/self-host/open-source/support)
- [PostHog — best open source analytics tools you can self-host](https://posthog.com/blog/best-open-source-analytics-tools)
- [OpenPanel — self-hosted web analytics comparison (Plausible/Matomo/Umami/OpenPanel)](https://openpanel.dev/articles/self-hosted-web-analytics)
- [OpenPanel — PostHog alternative (fully self-hostable)](https://openpanel.dev/compare/posthog-alternative)
- [Swetrix — best open source website analytics tools](https://swetrix.com/blog/open-source-website-analytics)
- [Mixpanel — the best PostHog alternatives for product analytics](https://mixpanel.com/blog/posthog-alternatives/)

## Appendix B — Key papai code touchpoints

| Concern                      | File(s) |
| ---------------------------- | ------- |
| Event bus (emit/subscribe)   | `src/debug/event-bus.ts` |
| Usage subscriber + recorders | `src/usage/index.ts`, `src/usage/recorder.ts`, `src/usage/tool-call-recorder.ts` |
| Usage tables (+outbox cols)  | `src/db/llm-usage-events-schema.ts`, `src/db/tool-call-events-schema.ts`, migration `038` |
| Deterministic event ids      | `src/usage/event-id.ts` |
| Anonymous aggregates + salt  | `src/stats/`, `src/stats/hashing.ts` |
| Anonymity contract           | `docs/architecture/overview.md` (`/stats/*` section) |
| Scope model (subject keys)   | `src/chat/context-scope.ts` |
| Allowlisted-arg pattern      | `src/live-status/tool-status-labels.ts` |
| Turn/message emit sites      | `src/bot.ts`, `src/message-queue/`, `src/debug/turn-assembly.ts` |
| Proactive egress precedent   | `src/debug/notify-route.ts`, `docs/architecture/environment.md` (`NOTIFY_TOKEN`) |
