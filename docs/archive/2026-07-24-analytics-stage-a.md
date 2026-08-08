<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage A→B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build papai's content-free analytics system end-to-end (Tasks 1–18 of the research implementation plan) with collection killed, then enable `local_aggregate` for the Stage B evidence window.

**Architecture:** Typed source facts → fail-closed normalizer → canonical events (governance-gated) and closed daily aggregates (default lane) in SQLite; per-sink delivery ledger for any egress; curated read-only snapshot → Metabase. All lanes behind a runtime mode switch; pseudonymous machinery dormant until Stage C.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, SQLite migrations 072–075, pino, p-limit, Svelte (settings UI), Metabase (BI, ad-hoc container).

**Plan-of-record relationship:** [`docs/research/analytics-metrics/06-implementation-plan.md`](../../research/analytics-metrics/06-implementation-plan.md) ("06") is the authoritative, independently reviewed step list — 3,228 lines of per-checkbox TDD steps, exact code, and exact commit commands. This plan is the **execution wrapper**: it fixes task order, files, interfaces, gates, and review focus per task, and the orchestration protocol between tasks. To avoid two diverging copies, task steps are **not** duplicated here; the orchestrator copies 06's task section **verbatim** into each subagent brief. If 06 and this wrapper ever disagree, stop and sync per the spec.

**Execution design:** [`docs/superpowers/specs/2026-07-24-analytics-stage-a-execution-design.md`](../specs/2026-07-24-analytics-stage-a-execution-design.md) ("execution spec").

## Global Constraints

Every task implicitly includes all of the following (exact values from 02/03/06/08 and the execution spec):

- Collection modes: `off | local_aggregate | local_pseudonymous | external_aggregate | external_pseudonymous`; shipping default `local_aggregate`; `external_pseudonymous` always default-off and requires operator switch AND per-actor `allow`.
- Sessionization: partition `(actor_key, thread_key ?? context_key)`; new session when gap **strictly greater than 1,800,000 ms**; Discord `thread_key = null`.
- Pseudonyms: HMAC-SHA-256 over `purpose_domain || 0x00 || length-prefixed UTF-8 components`, 192-bit truncation, base64url; keyrings from `ANALYTICS_HMAC_KEYRING` / `ANALYTICS_GOVERNANCE_HMAC_KEYRING`; **never** reuse `stats_anonymity_salt`; raw identifiers never persist.
- `intent.v1`: 23 immutable labels I01–I23; deterministic `hybrid_v1` (tool-trace → metadata) only; SMALL_MODEL is never imported or invoked.
- Migrations 072–075 are additive only; rollback = runtime kill switch, never destructive migration reversal.
- The 17 release-blocking privacy controls (03 §12) are CI gates; controls 1–9, 14–17 and aggregate parts of 15 also block aggregate publication. C3 canaries across all surfaces.
- Repo conventions: TDD write hooks (failing test first), pino metadata-first logging, no secrets in logs, `p-limit` for bounded concurrency, no lint-disable/type-ignore comments, error extraction via `error instanceof Error ? error.message : String(error)`.
- One commit per task using the exact `git add`/`git commit -m` command in 06's task section; record `git rev-parse HEAD` in the evidence doc after each task commit.
- Rebase onto `origin/master` after Tasks 2, 8, and 13 (completed-task boundaries only).
- Stop-and-report rule: on any plan↔code conflict, the subagent stops and reports; the orchestrator resolves (usually a plan-sync commit) before work continues.
- Public interfaces in 06 §"Public interfaces to hold stable" (`AnalyticsLane`, `AnalyticsSourceContext`, `AnalyticsObserver`, `AnalyticsRequestContext`, `ProviderObservationCallback`, `DeliveryGrantRef`, `CollectionEligibilityRef`, `EligibilityDecision`, `AnalyticsSink`) are frozen; `AnalyticsEventV1`/`AnalyticsAggregateV1` remain exactly 02's contracts.

## Orchestration protocol (applies to every task)

1. Orchestrator writes the brief: 06's task section verbatim + relevant 02/03 excerpts + Global Constraints above + interface-stability list + stop-and-report rule.
2. Fresh subagent executes red→green per checkbox; runs the task's named gate; reports gate output and any deviations.
3. Orchestrator reviews the **full diff against every 06 checkbox**; runs the named gate plus `bun run typecheck` and `bun run lint`; verifies migration ordering when a migration is added.
4. Orchestrator updates `docs/research/analytics-metrics/09-stage-a-evidence.md` (control matrix + gate results), then commits with 06's exact commit command and records the hash.
5. On persistent subagent failure (two rounds without green), the orchestrator takes the task over in-session.

---

### Task 0: Initialize execution evidence (orchestrator-only, no subagent)

**Files:**
- Create: `docs/research/analytics-metrics/09-stage-a-evidence.md`

- [ ] Create the evidence doc with: SPDX header; the 17-control status matrix (all `pending`); a per-task evidence log table (task, named gate result, typecheck/lint result, commit hash); Stage A exit checklist (empty); Stage B window log (empty).
- [ ] Commit: `git add docs/research/analytics-metrics/09-stage-a-evidence.md && git commit -m "docs(research): initialize analytics Stage A evidence log"`

### Task 1: Freeze the architecture, strict contracts, and registry closure

**Steps:** 06 §Task 1 verbatim.
**Files:**
- Create: `src/analytics/contracts.ts`, `src/analytics/registry.ts`, `docs/adr/0308-analytics-governance-and-delivery-lanes.md`
- Modify: `docs/adr/README.md`, `knip.config.ts`
- Test: `tests/analytics/contracts.test.ts`, `tests/analytics/registry-closure.test.ts`

**Interfaces:**
- Consumes: 02's `AnalyticsEventV1`/`AnalyticsAggregateV1` contracts and 32-event registry (normative source).
- Produces: `AnalyticsEventV1`, `AnalyticsAggregateV1`, `EventNameV1`, `PropsByEventName`, branded `Pseudonym`, the immutable registry (event name ↔ props schema ↔ privacy class ↔ aggregate mapping ↔ source family ↔ RQ coverage) — every later task imports these.

**Named gate:** `bun test tests/analytics/contracts.test.ts tests/analytics/registry-closure.test.ts`
**Review focus:** strict `additionalProperties: false` everywhere; registry closure test fails CI on any unlisted event/prop; ADR 0308 matches 00's executive decisions; knip config admits dormant analytics modules.
**Commit:** `feat(analytics): freeze strict event contracts` (exact add list in 06)

### Task 2: Add additive analytics storage and migration registration

**Steps:** 06 §Task 2 verbatim.
**Files:**
- Create: `src/db/analytics-schema.ts`, `src/db/migrations/072_analytics_foundation.ts`, `src/analytics/storage/event-store.ts`, `src/analytics/storage/aggregate-store.ts`, `src/analytics/storage/rejection-store.ts`, `src/analytics/storage/backfill-provenance-store.ts`, `src/analytics/storage/epoch-store.ts`
- Modify: `src/db/schema.ts`, `src/db/index.ts`
- Test: `tests/db/migrations/072_analytics_foundation.test.ts`, `tests/db/migration-registration.test.ts`, `tests/analytics/storage.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts/registry.
- Produces: migration 070 tables (canonical events, daily counters/histograms, process epochs, epoch source counters, aggregate epoch contributions, normalization rejections, backfill runs/event map/contributions); storage store APIs used by Tasks 5, 11–13.

**Named gate:** `bun test tests/db/migrations/072_analytics_foundation.test.ts tests/db/migration-registration.test.ts tests/analytics/storage.test.ts`
**Review focus:** migration registered in order after 068; additive only; deterministic event-id primary key with duplicate-swallow; no outbox reuse of legacy `forwarded_*` columns.
**Milestone:** rebase onto `origin/master` after this task's commit.
**Commit:** `feat(analytics): add canonical and aggregate storage`

### Task 3: Implement purpose-separated keys and identity/scope normalization

**Steps:** 06 §Task 3 verbatim.
**Files:**
- Create: `src/analytics/identity/keyring.ts`, `src/analytics/identity/install-id.ts`, `src/analytics/identity/pseudonym.ts`, `src/analytics/identity/scope.ts`, `src/analytics/config.ts`
- Modify: `.env.example`, `docs/architecture/environment.md`
- Test: `tests/analytics/keyring.test.ts`, `tests/analytics/install-id.test.ts`, `tests/analytics/pseudonym.test.ts`, `tests/analytics/scope.test.ts`

**Interfaces:**
- Consumes: Task 1 branded `Pseudonym`.
- Produces: keyring parsing (no secret logging), install-id get/create, `pseudonym()` HMAC encoding with the frozen test vector `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`, scope normalization producing `actor_key`/`context_key`/`thread_key`/`turn_key`/etc.

**Named gate:** `bun test tests/analytics/keyring.test.ts tests/analytics/install-id.test.ts tests/analytics/pseudonym.test.ts tests/analytics/scope.test.ts`
**Review focus:** frozen HMAC byte/digest vectors pass exactly; cross-instance actor differs, same-instance matches; Discord `thread_key = null`; keys never logged.
**Commit:** `feat(analytics): add purpose-separated identity keys`

### Task 4: Add operational policy, preferences, and the eligibility matrix

**Steps:** 06 §Task 4 verbatim.
**Files:**
- Create: `src/db/analytics-governance-schema.ts`, `src/db/migrations/073_analytics_governance.ts`, `src/analytics/governance/policy-store.ts`, `src/analytics/governance/preference-store.ts`, `src/analytics/governance/collection-store.ts`, `src/analytics/governance/grant-store.ts`, `src/analytics/governance/generation-store.ts`, `src/analytics/governance/eligibility.ts`
- Modify: `src/db/schema.ts`, `src/db/index.ts`
- Test: `tests/db/migrations/073_analytics_governance.test.ts`, `tests/db/migration-registration.test.ts`, `tests/analytics/governance-store.test.ts`, `tests/analytics/collection-store.test.ts`, `tests/analytics/grant-store.test.ts`, `tests/analytics/generation-store.test.ts`, `tests/analytics/eligibility-matrix.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (contracts, storage, pseudonyms).
- Produces: `EligibilityDecision` evaluation (pure mode × basis × preference × role × lane matrix), generation-bearing `CollectionEligibilityRef`/`DeliveryGrantRef` stores, singleton active-generation row, append-only policy audit.

**Named gate:** `bun test tests/db/migrations/073_analytics_governance.test.ts tests/db/migration-registration.test.ts tests/analytics/governance-store.test.ts tests/analytics/collection-store.test.ts tests/analytics/grant-store.test.ts tests/analytics/generation-store.test.ts tests/analytics/eligibility-matrix.test.ts`
**Review focus:** every mode × basis × preference × role × egress combination has the 03-mandated result; guests never get a longitudinal decision; aggregate lanes always carry `null` refs.
**Commit:** `feat(analytics): enforce governance eligibility`

### Task 5: Build the fail-closed normalizer and non-blocking runtime

**Steps:** 06 §Task 5 verbatim.
**Files:**
- Create: `src/analytics/source-facts.ts`, `src/analytics/normalizer.ts`, `src/analytics/aggregate.ts`, `src/analytics/runtime.ts`, `src/analytics/runtime.testing.ts`, `src/analytics/process-epoch.ts`, `src/analytics/subscriber.ts`, `src/analytics/turn-context.ts`, `src/analytics/governance/collection-serialization.ts`
- Modify: `src/runtime/production-deps.ts`
- Test: `tests/analytics/normalizer.test.ts`, `tests/analytics/aggregate.test.ts`, `tests/analytics/runtime.test.ts`, `tests/analytics/process-epoch.test.ts`, `tests/analytics/collection-writer-race.test.ts`, `tests/analytics/subscriber.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (all foundations).
- Produces: `AnalyticsSourceFact` discriminated union (in-process only, never serialized), fail-closed `normalize()`, closed aggregate increments + daily finalization, `AnalyticsObserver` runtime (mode gate, bounded queues, non-throwing), process-epoch lifecycle (open-before-producers, drain-before-close, stale-open startup recovery), per-ref writer/withdrawal fence.

**Named gate:** `bun test tests/analytics/normalizer.test.ts tests/analytics/aggregate.test.ts tests/analytics/runtime.test.ts tests/analytics/process-epoch.test.ts tests/analytics/collection-writer-race.test.ts tests/analytics/subscriber.test.ts`
**Review focus:** unknown event/property/enum/version → bounded rejection counter only; deny-before-writer inserts nothing, writer-before-deny deleted pre-acknowledgement; subscriber never throws and keeps work off the reply path; **completes privacy controls 1–3, 7, 8 (local parts) — update the control matrix**.
**Commit:** `feat(analytics): add fail-closed local runtime`

### Task 6: Instrument accepted messages, turns, replies, auth, steering, and stop

**Steps:** 06 §Task 6 verbatim.
**Files:**
- Modify: `src/bot.ts`, `src/bot-reply-tracking.ts`, `src/message-queue/types.ts`, `src/message-queue/queue.ts`, `src/message-queue/index.ts`, `src/run-control/steering-prepare-step.ts`, `src/commands/stop.ts`, `src/runtime/production-deps.ts`
- Test: `tests/bot.test.ts`, `tests/bot-reply-tracking.test.ts`, `tests/bot-steering.test.ts`, `tests/message-queue/queue.test.ts`, `tests/message-queue/guest-actor-role.test.ts`, `tests/run-control/steering-prepare-step.test.ts`, `tests/runtime/production-deps-analytics.test.ts`, `tests/analytics/message-turn-integration.test.ts`

**Interfaces:**
- Consumes: Task 5 observer/runtime/turn-context.
- Produces: post-auth `chat_message_accepted`, canonical turn start/terminal with monotonic clocks, adapter-bound reply delivery outcome, steering/stop source facts, authoritative `AnalyticsSourceContext` at the message boundary.

**Named gate:** `bun test tests/bot.test.ts tests/bot-reply-tracking.test.ts tests/bot-steering.test.ts tests/message-queue/queue.test.ts tests/message-queue/guest-actor-role.test.ts tests/run-control/steering-prepare-step.test.ts tests/runtime/production-deps-analytics.test.ts tests/analytics/message-turn-integration.test.ts`
**Review focus:** acceptance emitted only after auth/eligibility (never the pre-auth `message:received`); no reliance on debug-scope ID splitting; one completion semantic (no merged normal/shutdown shapes).
**Commit:** `feat(analytics): observe authorized turn lifecycle`

### Task 7: Instrument LLM, tool, confirmation, disclosure, and performance clocks

**Steps:** 06 §Task 7 verbatim.
**Files:**
- Create: `src/analytics/generated/tool-slugs.ts`, `src/analytics/clarification.ts`, `scripts/generate-analytics-tool-slugs.ts`
- Modify: `src/analytics/subscriber.ts`, `src/llm-orchestrator-events.ts`, `src/llm-orchestrator-logging.ts`, `src/llm-orchestrator-tool-events.ts`, `src/llm-orchestrator-invoke.ts`, `src/tools/permission-gate.ts`, `src/chat/permission-prompt.ts`, `src/chat/interaction-router.ts`, `src/live-status/reporter.ts`, `src/ai-progress-reporter.ts`, `src/llm-orchestrator-send.ts`, `src/reply-typing-heartbeat.ts`
- Test: `tests/llm-orchestrator-events.test.ts`, `tests/llm-orchestrator-logging.test.ts`, `tests/llm-orchestrator-tool-events.test.ts`, `tests/tools/permission-gate.test.ts`, `tests/chat/permission-prompt.test.ts`, `tests/live-status/reporter.test.ts`, `tests/reply-typing-heartbeat.test.ts`, `tests/analytics/llm-tool-integration.test.ts`, `tests/analytics/performance-clocks.test.ts`, `tests/analytics/tool-slug-generation.test.ts`, `tests/analytics/clarification.test.ts`

**Interfaces:**
- Consumes: Tasks 5–6.
- Produces: `llm_started/completed/failed`, one post-classification idempotent `tool:analytics_completed` terminal (semantic success / thrown / structured failure / denial), confirmation lifecycle, disclosure fallback, TTFT/first-visible-feedback clocks, generated first-party tool slugs (dynamic external names never exported).

**Named gate:** `bun test tests/llm-orchestrator-events.test.ts tests/llm-orchestrator-logging.test.ts tests/llm-orchestrator-tool-events.test.ts tests/tools/permission-gate.test.ts tests/chat/permission-prompt.test.ts tests/live-status/reporter.test.ts tests/reply-typing-heartbeat.test.ts tests/analytics/llm-tool-integration.test.ts tests/analytics/performance-clocks.test.ts tests/analytics/tool-slug-generation.test.ts tests/analytics/clarification.test.ts`
**Review focus:** `execute_end`/`llm:tool_result` never inferred as semantic success; `llm:tool_result` and `log:entry` stay categorically excluded; clarification structured signals only — **completes privacy control 6 — update the control matrix**.
**Commit:** `feat(analytics): observe llm tool and feedback outcomes`

### Task 8: Instrument provider, configuration, MCP, and feature boundaries

**Steps:** 06 §Task 8 verbatim.
**Files:**
- Create: `src/analytics/provider-observer.ts`, `src/analytics/provider-request-scope.ts`, `src/analytics/feature-observer.ts`
- Modify: `src/llm-orchestrator.ts`, `src/llm-orchestrator-tools.ts`, `src/llm-orchestrator-invoke.ts`, `src/llm-orchestrator-types.ts`, `src/llm-orchestrator-support.ts`, `src/deferred-prompts/*`, `src/tools/*`, `src/tool-failure.ts`, `src/providers/*`, `src/identity/resolver.ts`, `src/plugins/*`, `src/mcp/*`, `plugins/task-provider-kaneo/*`, `plugins/task-provider-youtrack/*`, `plugins/acp/*`, `src/commands/config.ts`, `src/debug/settings-routes.ts` (+ provision/byok/group routes), `src/debug/transcript-viewer.ts`, `src/instances/context-store.ts`, `src/chat/seed-context-assignment.ts`, `src/runtime/production-deps.ts`, `src/attachments/store.ts`, `src/long-term-memory/*`, `src/web/*` (full list in 06's commit command)
- Test: `tests/analytics/provider-observer.test.ts`, `tests/analytics/provider-request-scope.test.ts`, `tests/analytics/provider-request-scope-setup-paths.test.ts`, `tests/analytics/config-milestones.test.ts`, `tests/analytics/feature-observer.test.ts` + the wide regression suite in 06

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces: `ProviderRequestScope` (AsyncLocalStorage, immutable), explicit `AnalyticsRequestContext` per provider/MCP/magi call, provider status-class facts, config milestones (`config_link_issued`, `settings_opened`, `task_instance_assigned`), capability-aware `feature_opportunity`/`feature_used`, controlled MCP availability outcomes. Operational paths use explicit `NO_ANALYTICS_SCOPE`; absence fails closed.

**Named gate:** `bun test tests/analytics/provider-observer.test.ts tests/analytics/provider-request-scope.test.ts tests/analytics/provider-request-scope-setup-paths.test.ts tests/analytics/config-milestones.test.ts tests/analytics/feature-observer.test.ts` (plus 06's regression suite)
**Review focus:** cached descriptors/shared MCP pool retain per-execution context (no cached-context bleed — privacy control 4, cached-descriptor clause); daily `feature_opportunity` uniqueness per actor/feature/UTC day.
**Milestone:** rebase onto `origin/master` after this task's commit.
**Commit:** `feat(analytics): observe provider and feature boundaries`

### Task 9: Add the independent delivery ledger and sink capability gate

**Steps:** 06 §Task 9 verbatim.
**Files:**
- Create: `src/db/analytics-delivery-schema.ts`, `src/db/migrations/074_analytics_delivery.ts`, `src/analytics/delivery/sink.ts`, `src/analytics/delivery/sink-service.ts`, `src/analytics/delivery/store.ts`
- Modify: `src/db/schema.ts`, `src/db/index.ts`, `src/analytics/governance/grant-store.ts`
- Test: `tests/db/migrations/074_analytics_delivery.test.ts`, `tests/db/migration-registration.test.ts`, `tests/analytics/delivery-store.test.ts`, `tests/analytics/sink-gate.test.ts`, `tests/analytics/sink-lifecycle.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4.
- Produces: per-`(event_id, sink_version_id)` delivery rows with states `pending|leased|sending|delivered|ambiguous|dead|delete_pending|deleted|cancelled`, write-only versioned sink lifecycle (create/verify/rotate/disable, secrets never returned), the sink capability gate (`callerControlledIdempotency` AND `deterministicReconciliation` AND `deleteActor`).

**Named gate:** `bun test tests/db/migrations/074_analytics_delivery.test.ts tests/db/migration-registration.test.ts tests/analytics/delivery-store.test.ts tests/analytics/sink-gate.test.ts tests/analytics/sink-lifecycle.test.ts`
**Review focus:** legacy `forwarded_*` columns untouched; OpenPanel fails the capability gate as documented; ledger-referenced sink versions cannot be deleted — **privacy control 9 (store parts) — update the control matrix**.
**Commit:** `feat(analytics): add independent delivery ledger`

### Task 10: Promote deterministic intent and add transient rephrase detection

**Steps:** 06 §Task 10 verbatim.
**Files:**
- Create: `src/analytics/intent/taxonomy.ts`, `src/analytics/intent/classifier.ts`, `src/analytics/intent/rephrase.ts`, `src/analytics/rephrase/handoff.ts`, `src/analytics/jobs/intent.ts`
- Modify: `src/analytics/subscriber.ts`, `src/analytics/turn-context.ts`, `src/bot.ts`, `src/runtime/production-deps.ts`
- Test: `tests/analytics/intent-classifier.test.ts`, `tests/analytics/intent-derivation.test.ts`, `tests/analytics/rephrase.test.ts`, `tests/analytics/rephrase-handoff.test.ts`, `tests/analytics/intent-persistence-audit.test.ts`, `tests/analytics/subscriber.test.ts`, `tests/bot.test.ts`, `tests/runtime/production-deps-analytics.test.ts`

**Interfaces:**
- Consumes: Tasks 5–8 (tool slugs, turn context, subscriber).
- Produces: `intent.v1` taxonomy + deterministic `hybrid_v1` classifier with abstention, idempotent `intent_classified` derivation (every eligible terminal turn gets exactly one row per `(turn_key, taxonomy_version)`), transient rephrase handoff (raw text discarded in memory; max three TTL feature sets; never persisted). **SMALL_MODEL never imported.**

**Named gate:** `bun test tests/analytics/intent-classifier.test.ts tests/analytics/intent-derivation.test.ts tests/analytics/rephrase.test.ts tests/analytics/rephrase-handoff.test.ts tests/analytics/intent-persistence-audit.test.ts`
**Review focus:** at most three ordered goals, >3 fails closed to `unknown`; rephrase persistence audit proves no text/shingles/hashes/vectors in SQLite/logs/cache — **completes privacy controls 12, 13 — update the control matrix**.
**Commit:** `feat(analytics): add governed deterministic intent`

### Task 11: Materialize sessions, outcomes, feature exposure, and friction

**Steps:** 06 §Task 11 verbatim.
**Files:**
- Create: `src/db/migrations/075_analytics_materializations.ts`, `src/analytics/derive/sessionizer.ts`, `src/analytics/derive/outcomes.ts`, `src/analytics/derive/features.ts`, `src/analytics/derive/friction.ts`, `src/analytics/jobs/derive.ts`
- Modify: `src/db/analytics-schema.ts`, `src/db/index.ts`
- Test: `tests/db/migrations/075_analytics_materializations.test.ts`, `tests/db/migration-registration.test.ts`, `tests/analytics/sessionizer.test.ts`, `tests/analytics/outcomes.test.ts`, `tests/analytics/feature-materialization.test.ts`, `tests/analytics/friction.test.ts`

**Interfaces:**
- Consumes: Tasks 2–10 (canonical store, intent, features).
- Produces: versioned `sessionization.v1` (strict 1,800,000 ms gap; 29:59/30:00/30:00.001 fixtures), `outcome.v1` (eight terminal states incl. `censored`), daily feature exposure/use materialization, `friction.v1` (seven binary components, 0–7).

**Named gate:** `bun test tests/db/migrations/075_analytics_materializations.test.ts tests/db/migration-registration.test.ts tests/analytics/sessionizer.test.ts tests/analytics/outcomes.test.ts tests/analytics/feature-materialization.test.ts tests/analytics/friction.test.ts`
**Review focus:** session boundary fixtures exact; recovered never labeled first-time success; friction count is the plain sum of bits; guests produce no session/outcome/intent rows — **privacy controls 10, 11 (fixtures) — update the control matrix**.
**Commit:** `feat(analytics): materialize sessions outcomes and friction`

### Task 12: Backfill operational usage with provenance and exact reconciliation

**Steps:** 06 §Task 12 verbatim.
**Files:**
- Create: `src/analytics/jobs/backfill.ts`, `src/analytics/jobs/reconcile.ts`, `scripts/analytics-backfill.ts`
- Modify: `src/analytics/storage/epoch-store.ts`
- Test: `tests/analytics/backfill.test.ts`, `tests/analytics/reconciliation.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 11 (storage, normalizer, epoch store).
- Produces: recoverability-matrix normalization of `llm_usage_events`/`tool_call_events` (incl. embedding/distillation direct writers), first-creation provenance maps, resumable high-water marks, CLI (`--dry-run`, `--batch-size`, `--resume`, `--source llm|tool|all`, `--reconcile`), conservation reports with zero unexplained delta on closed epochs.

**Named gate:** `bun test tests/analytics/backfill.test.ts tests/analytics/reconciliation.test.ts`
**Review focus:** rerun changes zero rows; rollback reverses only first-created deltas; crash-gap buckets marked `unreconciled_restart_gap`, never balanced with invented counts — **privacy control 14 — update the control matrix**.
**Commit:** `feat(analytics): add governed usage backfill`

### Task 13: Implement retention, withdrawal, export, deletion, and planned rekey

**Steps:** 06 §Task 13 verbatim.
**Files:**
- Create: `src/analytics/governance/subject-service.ts`, `src/analytics/governance/deletion-target-store.ts`, `src/analytics/governance/grant-serialization.ts`, `src/analytics/governance/snapshot-invalidator.ts`, `src/analytics/jobs/retention.ts`, `src/analytics/jobs/rekey.ts`, `src/analytics/rekey/cutover-fence.ts`, `src/analytics/retention/expiry-guard.ts`, `scripts/analytics-rekey.ts`
- Modify: `src/analytics/governance/generation-store.ts`, `src/analytics/normalizer.ts`, `src/analytics/runtime.ts`, `src/analytics/identity/pseudonym.ts`, governance stores, storage stores, delivery store, jobs (full list in 06)
- Test: `tests/analytics/retention.test.ts`, `tests/analytics/withdrawal-race.test.ts`, `tests/analytics/subject-export.test.ts`, `tests/analytics/deletion.test.ts`, `tests/analytics/rekey.test.ts`, `tests/analytics/rekey-cutover.test.ts`

**Interfaces:**
- Consumes: Tasks 2–12.
- Produces: startup expiry barrier + earliest-deadline purge (`expires_at` as read/send boundary), authenticated subject export/withdraw/delete across all key versions and generations (encrypted deletion target bundles), the durable rekey workflow (`plan|dual_write|copy_parents|copy_children|verify|cutover_fence|swap|snapshot_republish|remote_delete|remote_resend|retire`) with count/hash conservation, `RekeyCutoverFence`, rekey CLI (`plan|apply|verify` — never automatic).

**Named gate:** `bun test tests/analytics/retention.test.ts tests/analytics/withdrawal-race.test.ts tests/analytics/subject-export.test.ts tests/analytics/deletion.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts`
**Review focus:** deny-before-writer/writer-before-deny races exact; delivery settles under restrictive event FK before canonical deletion; rekey conservation `count(active)=count(target-shadow)=count(mappings)` and SHA-256 equality; 90-day subject-rights lookup horizon — **completes privacy controls 8, 16 (local parts), 17 — update the control matrix**.
**Milestone:** rebase onto `origin/master` after this task's commit.
**Commit:** `feat(analytics): enforce lifecycle and subject rights`

### Task 14: Build curated, read-only SQLite snapshots and Metabase models

**Steps:** 06 §Task 14 verbatim.
**Files:**
- Create: `src/analytics/jobs/snapshot.ts`, `src/analytics/governance/snapshot-consumer.ts`, `src/analytics/jobs/friction-sample.ts`, `scripts/analytics-snapshot.ts`, `scripts/analytics-friction-sample.ts`, `analytics/metabase/sql/00-data-health.sql`, `analytics/metabase/sql/01-activation.sql`, `analytics/metabase/sql/02-retention-engagement.sql`, `analytics/metabase/sql/03-intents-features.sql`, `analytics/metabase/sql/04-reliability-friction-performance.sql`, `analytics/metabase/README.md`
- Modify: `src/analytics/jobs/rekey.ts`, `src/analytics/rekey/cutover-fence.ts`, `src/analytics/governance/snapshot-invalidator.ts`, `scripts/analytics-rekey.ts`
- Test: `tests/analytics/snapshot.test.ts`, `tests/analytics/metabase-models.test.ts`, `tests/analytics/friction-sample.test.ts`, `tests/analytics/rekey.test.ts`, `tests/analytics/rekey-cutover.test.ts`

**Interfaces:**
- Consumes: Tasks 2–13 (all stores/materializations).
- Produces: fresh-empty allowlisted snapshot publisher (byte/schema/freelist scan, mode-0600 staging, `finally` cleanup, immutable versions), consumer-coordinated quiesce/close/remount/reopen/verify before old-file unlink, `analytics_snapshot_publications` states, five reviewed SQL models, snapshot CLI, friction-sample CLI (typed timelines only, stratified).

**Named gate:** `bun test tests/analytics/snapshot.test.ts tests/analytics/metabase-models.test.ts tests/analytics/friction-sample.test.ts tests/analytics/rekey.test.ts tests/analytics/rekey-cutover.test.ts`
**Review focus:** snapshot proven byte-free of live-DB pages/C3 canaries/grants/preferences/secrets/props bytes; models show numerator/denominator/censoring/coverage/version/snapshot age — **privacy control 16 (snapshot parts) — update the control matrix**.
**Commit:** `feat(analytics): publish curated metabase snapshot`

### Task 15: Implement external aggregate release and the gated delivery worker

**Steps:** 06 §Task 15 verbatim.
**Files:**
- Create: `src/analytics/delivery/http-policy.ts`, `src/analytics/delivery/worker.ts`, `src/analytics/delivery/aggregate-release.ts`, `src/analytics/delivery/captured-sink.testing.ts`
- Modify: `src/analytics/delivery/sink.ts`, `src/analytics/delivery/store.ts`, `src/analytics/governance/grant-serialization.ts`, `src/analytics/retention/expiry-guard.ts`
- Test: `tests/analytics/http-policy.test.ts`, `tests/analytics/aggregate-release.test.ts`, `tests/analytics/delivery-worker.test.ts`, `tests/analytics/captured-egress.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 13.
- Produces: fixed-HTTPS destination validation (DNS validated, public address pinned in the actual connection with hostname TLS verification, redirects refused, caps/timeouts), bounded grant-serialized delivery worker (`leased → sending` durable before I/O; orphaned `sending` → non-retried `ambiguous`), thresholded aggregate release with frozen UTC-day lattice and deterministic primary/complementary suppression, captured-sink egress proofs.

**Named gate:** `bun test tests/analytics/http-policy.test.ts tests/analytics/aggregate-release.test.ts tests/analytics/delivery-worker.test.ts tests/analytics/captured-egress.test.ts`
**Review focus:** captured request proves no prohibited data leaves; suppression unrecoverable through totals/siblings/cross-filters/restart-gap cells; guest cells suppressed below 10 turns/10 contexts — **completes privacy controls 9, 15 — update the control matrix**.
**Commit:** `feat(analytics): add thresholded aggregate delivery`

### Task 16: Add authenticated governance and analytics settings surfaces

**Steps:** 06 §Task 16 verbatim.
**Files:**
- Create: `src/debug/settings/analytics-routes.ts`, `src/debug/settings/admin/analytics-routes.ts`, `client/settings/fetcher-schemas-analytics.ts`, `client/settings/analytics-fetchers.ts`, `client/settings/sections/AnalyticsPreferencesSection.svelte`, `client/settings/sections/AnalyticsPreferencesSection.stories.svelte`, `client/settings/sections/admin/AdminAnalyticsSection.svelte`, `client/settings/sections/admin/AdminAnalyticsSection.stories.svelte`
- Modify: `src/debug/settings-api-router.ts`, `src/analytics/delivery/sink-service.ts`, `client/settings/SettingsApp.svelte`
- Test: `tests/debug/settings/analytics-routes.test.ts`, `tests/debug/settings/admin/analytics-routes.test.ts`, `tests/client/settings/analytics-fetchers.test.ts`, `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`, `tests/client/settings/sections/admin/AdminAnalyticsSection.test.ts`, `tests/client/settings/SettingsApp.test.ts`, `tests/client/stories/msw/settings-handlers-personal-2.test.ts`, `tests/client/stories/msw/settings-handlers-admin-2.test.ts`, `tests/stories/settings/admin-surfaces.story.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 9, 13, 15 (subject-service, sink-service, policy readiness).
- Produces: authenticated actor routes (notice, `localLongitudinal`/`externalPseudonymous` choices, export, withdrawal, deletion) and admin routes (mode, policy readiness, retention, sink verify/rotate/disable, health, kill switch), strict client fetchers, mounted settings sections with stories.

**Named gate:** `bun test tests/debug/settings/analytics-routes.test.ts tests/debug/settings/admin/analytics-routes.test.ts tests/client/settings/analytics-fetchers.test.ts tests/client/settings/sections/AnalyticsPreferencesSection.test.ts tests/client/settings/sections/admin/AdminAnalyticsSection.test.ts tests/client/settings/SettingsApp.test.ts`
**Review focus:** collection/egress/deletion/key operations authenticated and authorized separately; sink credentials write-only (never returned after write); story contract tests pass.
**Commit:** `feat(settings): add analytics governance controls`

### Task 17: Register bounded jobs and prove lifecycle isolation

**Steps:** 06 §Task 17 verbatim.
**Files:**
- Create: `src/analytics/jobs/register.ts`
- Modify: `src/analytics/jobs/backfill.ts`, `src/analytics/jobs/derive.ts`, `src/analytics/jobs/intent.ts`, `src/analytics/jobs/reconcile.ts`, `src/analytics/jobs/retention.ts`, `src/analytics/jobs/snapshot.ts`, `src/analytics/delivery/worker.ts`, `src/analytics/runtime.ts`, `src/analytics/process-epoch.ts`, `src/analytics/storage/epoch-store.ts`, `src/runtime/production-deps.ts`, `src/runtime/production-background.ts`, `src/scheduler-instance.ts`
- Test: `tests/analytics/job-registration.test.ts`, `tests/analytics/runtime-lifecycle.test.ts`, `tests/debug/event-bus.test.ts`, `tests/runtime/production-background.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 9–15 (all jobs/workers).
- Produces: bounded job registration (deadline/high-water/derive/delivery/snapshot/reconcile) with `p-limit` concurrency, clean shutdown ordering (drain before epoch close), lifecycle isolation proof (analytics failure never breaks bot startup/reply path; kill switch stops subscribers/workers).

**Named gate:** `bun test tests/analytics/job-registration.test.ts tests/analytics/runtime-lifecycle.test.ts tests/debug/event-bus.test.ts tests/runtime/production-background.test.ts`
**Review focus:** zero-listener/no-op behavior preserved when off; no analytics work on the reply hot path; epoch opens before producers and closes only after queues/counters drain.
**Commit:** `feat(analytics): schedule bounded lifecycle jobs`

### Task 18: Update architecture/runbooks and execute release gates

**Steps:** 06 §Task 18 verbatim.
**Files:**
- Create: `docs/operations/analytics-runbook.md`, `docs/operations/analytics-incident-runbook.md`
- Modify: `docs/architecture/behaviors.md`, `docs/architecture/environment.md`, `docs/architecture/overview.md`, `docs/architecture/commands.md`, `README.md`
- Test: `tests/analytics/privacy-contract.test.ts`, `tests/analytics/rollout-gates.test.ts`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: operator runbooks (rollout, rollback, kill switch, incident response with pause triggers from 07), architecture doc updates, the executable privacy-contract suite (17 controls) and rollout-gate tests (refuse Stage B without Stage A evidence, etc.; assert OpenPanel cannot satisfy Stage E).

**Named gate (binding, in order):** `bun build:client` → `bun test tests/analytics tests/settings` → `bun test:client` → `bun run typecheck` → `bun run lint` → `bun security` → `bun run test` → `bun test:stories:contracts` → `bun test:stories`, then `bun run format:check && bun security:ci && bun run knip && bun run duplicates`. No flaky-test retry converts failure to pass.
**Review focus:** all 17 privacy controls green in `privacy-contract.test.ts`; rollout-gate tests enforce stage ordering; runbooks match actual commands/flags.
**Commit:** `docs(analytics): add rollout and incident runbooks`

### Task 19: Stage A exit evidence and PR (orchestrator-only, no subagent)

- [ ] Verify Stage A exit checklist in `09-stage-a-evidence.md`: all 18 task commits recorded with hashes; control matrix all green; synthetic complete process epoch reconciled to zero; snapshot byte verification result; deletion/rekey drill outputs; Task 18 binding commands' outputs pasted.
- [ ] Run the deletion and rekey drills per 06 Stage A exit and record outputs in the evidence doc.
- [ ] Commit evidence doc: `git add docs/research/analytics-metrics/09-stage-a-evidence.md && git commit -m "docs(research): record analytics Stage A exit evidence"`
- [ ] Open the single PR: title `feat(analytics): content-free product analytics (Stage A)`; body = summary + link to `09-stage-a-evidence.md` + Stage A exit checklist + the note that collection ships killed (`local_aggregate` only on deploy).
- [ ] Request the owner's privacy/security signature on the Stage A evidence before merge.

## Stage B handoff (post-merge, operational — not a build task)

1. Deploy to the owner's production instance; verify startup (purge barrier, epoch open, no hot-path work).
2. Start the two-consecutive-complete-UTC-week window; ad-hoc localhost Metabase container against published snapshots (no compose changes).
3. Weekly data-health checks per 07; log results in the evidence doc's Stage B window log.
4. Any `unreconciled_restart_gap` day → suppress that day, restart the window.
5. Exit review → record Stage B evidence with owner sign → Stage C becomes discussable.

## Self-review notes

- **Spec coverage:** execution spec sections 1–5 map to: orchestration protocol (§1), gates/evidence incl. Task 0/19 and control matrix (§2), branch/PR + rebase milestones (§3), Stage B handoff (§4), risks handled via stop-and-report + review-focus bullets (§5). All four decision points are encoded in Global Constraints.
- **Placeholders:** none — every task names exact files, exact test commands, exact commit messages copied from 06.
- **Type consistency:** interface names match 06 §"Public interfaces to hold stable" verbatim; migration numbers 072–075; event/mode/label vocabularies match 02/03/04.
