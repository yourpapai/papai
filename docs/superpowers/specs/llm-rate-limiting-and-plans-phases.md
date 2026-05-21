# LLM Rate Limiting and Plans Phases

**Date:** 2026-05-21
**Status:** Draft
**Companion design:** [`llm-rate-limiting-and-plans.md`](../../design/llm-rate-limiting-and-plans.md)
**Verification baseline:** Run `bun check:full` before marking any phase complete.

## Overview

This document breaks the LLM rate-limiting and plans design into coding-session-sized phases. Order still matters: land the storage and engine work first, then enforcement, then user/admin surfaces, then cleanup.

Session workflow guide, per-phase conventions, and progress tracking live in [`../notes/rate-limiting-phase-conventions.md`](../notes/rate-limiting-phase-conventions.md).

## Phase dependency graph

```text
1 ──┐
    ├── 7 ───────────────── 11 ──┐
2 ──┤                             │
    ├── 8 ─── 9 ─── 10 ────  12 ──┤
3 ──┤                             │
    │                             ├── 14 ── 15 ── 16 ── 17 ── 18 ── 19 ── 21
4 ── 5 ── 6 ──────────────  13 ───┤                            │       │
                                  │                            │       ├── 22 ── 23
                                  │                            │       │
                                  │                            │       └── 24
                                  │                            │
                                  │                            ├── 20  (depends on 19)
                                  │                            │
                                  │                            └── 25  (depends on 11)
                                  │
                                  │                            ├── 48 ── 49  (after 18)
                                  │
                                  ├── 26 ── 28
                                  ├── 27 ── 29
                                  │
                                  ├── 30 ── 31 ── 32 ── 33
                                  ├── 34 ── 35
                                  ├── 36
                                  └── 37
                                  │
                                  ├── 38 ── 39 ── 40 ── 41
                                  │              └── 42 ── 43 ── 44
                                  │              └── 45
                                  │
                                  └── 46 ── 47
```

- Track A (1–13) is sequential and establishes the shared data model, quota math, persistence, and engines.
- Track B (14–25) turns enforcement on; notable follow-ons are 20 after 19, 23 after 22, 24 after the counter primitives, and 25 after the reserve engine.
- Tracks C, D, E, and F can proceed after Track B according to the edges above.
- Track G waits until the web-fetch migration has been stable in production for at least one release window.

## Track A — Storage and pure logic

Foundational schema, types, window math, repositories, and counter engines land here before any runtime enforcement changes.

### Phase 1 — Subject id helper

**Goal:** Add a helper that strips an optional `:threadId` suffix from a `storage_context_id` to produce a `subject_id`. Do not change any call sites yet.
**Touches:** `src/auth.ts`
**Tests:** `tests/auth.test.ts` covering DM, group main, group thread, and last-colon split edge cases.
**Exit criteria:** New helper exported, fully tested, and still unused at runtime.

### Phase 2 — Quota types and constants

**Goal:** Centralize quota enums, type aliases, limit shapes, and validator helpers so later phases can share one import surface. Include the valid resource/dimension/window matrix and algorithm validation rules.
**Touches:** `src/quota/types.ts`, `src/quota/validity.ts`
**Tests:** `tests/quota/validity.test.ts` with full matrix coverage and algorithm checks.
**Exit criteria:** Importable types and validators exist with no runtime consumers yet.

### Phase 3 — Window math

**Goal:** Add pure window-bucketing logic for day, ISO week, and UTC calendar month. Return `windowStart`, `resetsAt`, and `windowMs` for each supported window.
**Touches:** `src/quota/window.ts`
**Tests:** `tests/quota/window.test.ts` for day, week, month, year rollover, and unsupported-window typing.
**Exit criteria:** UTC bucket math is correct across the supported windows.

### Phase 4 — DB migration: tables only

**Goal:** Add the quota and plan tables, indexes, and Drizzle schema without any runtime reads or writes yet. This phase is schema-only.
**Touches:** `src/db/migrations/<N>_plans_quotas.ts`, `src/db/plans-schema.ts`, `src/db/schema.ts`
**Tests:** `tests/db/plans-migration.test.ts` validating tables, indexes, default values, and `quota_counter` key shape.
**Exit criteria:** Migration applies cleanly on a fresh DB and no consumer code exists yet.

### Phase 5 — Seed migration

**Goal:** Seed `free`, `team`, and `unlimited` plans and bind the admin subject to `unlimited`. Keep the migration idempotent.
**Touches:** `src/db/migrations/<N+1>_seed_plans.ts`
**Tests:** `tests/db/seed-plans-migration.test.ts` covering seeded plans, plan limits, algorithms, notify thresholds, and admin assignment.
**Exit criteria:** Seed data is present and stable after Phase 4.

### Phase 6 — Plan repository (read side)

**Goal:** Add thin DB read helpers for plans, plan limits, and subject overrides. Keep orchestration out of this phase.
**Touches:** `src/quota/plan-repository.ts`
**Tests:** `tests/quota/plan-repository.test.ts` against a migrated and seeded DB.
**Exit criteria:** Read-side repository functions are exported and covered.

### Phase 7 — Plan resolver

**Goal:** Resolve the effective plan for a subject using override-first, default-second lookup. Strip thread suffixes so thread and main-chat subjects share the same plan.
**Touches:** `src/quota/resolve.ts`
**Tests:** `tests/quota/resolve.test.ts` for defaulting, expiry, and thread stripping.
**Exit criteria:** Pure plan resolution works with full branch coverage.

### Phase 8 — Counter primitive: fixed_window increment

**Goal:** Implement an atomic fixed-window increment primitive with insert-on-conflict rollover behavior, threshold bookkeeping reset, and limit enforcement. Keep it race-safe.
**Touches:** `src/quota/counter-fixed.ts`
**Tests:** `tests/quota/counter-fixed.test.ts` for under-limit, boundary, over-limit, rollover, and parallel increments.
**Exit criteria:** Fixed-window increments are race-safe and not yet wired into higher-level flows.

### Phase 9 — Counter primitive: fixed_window refund/clamp

**Goal:** Extend the fixed-window primitive to support negative deltas with `MAX(0, count + delta)` clamping. This is the refund/reconciliation path.
**Touches:** `src/quota/counter-fixed.ts`
**Tests:** `tests/quota/counter-fixed.test.ts` covering refunds, clamping, and zero-idempotence.
**Exit criteria:** Fixed-window counters support signed deltas safely.

### Phase 10 — Counter primitive: rolling_refill reserve + refund

**Goal:** Implement the rolling-refill reserve and refund primitive, including lazy refill math, fractional preservation, and balance clamping. Keep the whole operation atomic.
**Touches:** `src/quota/counter-rolling.ts`
**Tests:** `tests/quota/counter-rolling.test.ts` for refill timing, balance caps, race-safety, and refunds.
**Exit criteria:** Rolling-refill reserve/refund is race-safe and independent from the fixed-window path.

### Phase 11 — `reserveQuota`

**Goal:** Build the public reservation engine that resolves a plan, applies the correct primitive per limited triple, and rolls back earlier increments in the same transaction on breach. Return remaining capacity and retry timing details.
**Touches:** `src/quota/reserve.ts`, `src/quota/index.ts`
**Tests:** `tests/quota/reserve.test.ts` for allowed, denied, mixed-algorithm, and unlimited-plan paths.
**Exit criteria:** Reservation works end-to-end against the migrated and seeded DB.

### Phase 12 — `commitQuota`

**Goal:** Add the public reconciliation engine for signed actual-vs-estimated deltas. Reuse the per-algorithm primitives introduced earlier.
**Touches:** `src/quota/commit.ts`, `src/quota/index.ts`
**Tests:** `tests/quota/commit.test.ts` for over-estimate, under-estimate, error-refund, and clamp behavior.
**Exit criteria:** Quota reconciliation is complete and still not wired into callers.

### Phase 13 — Audit writer

**Goal:** Add an append-only audit writer for plan and assignment changes. Keep it as a small side-effect module with no resolver or engine coupling.
**Touches:** `src/quota/audit.ts`
**Tests:** `tests/quota/audit.test.ts` for every action enum and JSON payload round-trip.
**Exit criteria:** Audit recording is ready for admin and HTTP layers.

## Track B — Enforcement wiring

Turn the engine on incrementally across LLM, tool, web, deferred, embedding, attachment, threshold, and cleanup paths.

### Phase 14 — Orchestrator pre-call gate (main role)

**Goal:** Reserve quota for main-model calls immediately before `generateText`. On denial, return the structured quota-exhausted reply and skip the model call.
**Touches:** `src/llm-orchestrator-support.ts`, `src/llm-orchestrator-types.ts`
**Tests:** `tests/llm-orchestrator/quota-gate.test.ts`
**Exit criteria:** Main-role requests are blocked when over plan limits.

### Phase 15 — Orchestrator commit hook

**Goal:** Reconcile actual token usage from the existing usage event subscriber path. Refund tokens on errors but keep request counts consumed.
**Touches:** `src/usage/index.ts`
**Tests:** `tests/usage/index.test.ts`
**Exit criteria:** Quota counters reflect actual success/error usage after main-role calls.

### Phase 16 — Small-role gate

**Goal:** Mirror the main-role quota gate for small-model calls. Only the resource key changes.
**Touches:** `src/llm-orchestrator-support.ts`
**Tests:** existing quota-gate coverage extended for small-role calls.
**Exit criteria:** Small-model calls are denied once their plan limit is exceeded.

### Phase 17 — Tool wrapper gate

**Goal:** Reserve tool-call quota before every tool execution and return a structured quota error when denied. Keep tool-call telemetry for attempts.
**Touches:** `src/tools/tool-execution-wrapper.ts` or the equivalent wrapper module
**Tests:** `tests/tools/quota-gate.test.ts`
**Exit criteria:** Tool calls respect plan limits and surface a structured failure result.

### Phase 18 — Web-fetch gate

**Goal:** Switch web-fetch quota consumption to the new plan engine while still writing the legacy `web_rate_limit` table for one release window. The plan, not the hard-coded constant, becomes the source of limits.
**Touches:** `src/web/rate-limit.ts`, `src/web/fetch-extract.ts` if wiring is needed
**Tests:** `tests/web/rate-limit.test.ts`
**Exit criteria:** Web-fetch limits are plan-driven with legacy writes still present temporarily.

### Phase 19 — Proactive LLM gate (basic deny)

**Goal:** Apply the same reserve/commit flow to proactive deferred-prompt dispatch, but only deny or allow for now. Do not add fallback behavior in this phase.
**Touches:** `src/deferred-prompts/proactive-llm.ts`, `src/deferred-prompts/proactive-llm-helpers.ts`
**Tests:** existing proactive-LLM tests extended for deny and allow paths.
**Exit criteria:** Deferred prompts cannot exceed quota and simply no-op on denial.

### Phase 20 — Deferred-prompt fallback chain

**Goal:** Add the full fallback order for deferred prompts: main when below threshold, proactive small-model degrade when main is near threshold, small-model fallback on main denial, then templated non-LLM delivery. Record delivery mode and delivery reason for each dispatch.
**Touches:** `src/db/migrations/<M>_deferred_prompt_delivery_mode.ts`, `src/db/deferred-prompts-schema.ts`, `src/deferred-prompts/proactive-llm.ts`, `src/deferred-prompts/templated-delivery.ts`, `src/deferred-prompts/threshold-check.ts`
**Tests:** `tests/deferred-prompts/templated-delivery.test.ts`, `tests/deferred-prompts/threshold-check.test.ts`, `tests/deferred-prompts/fallback-chain.test.ts`
**Exit criteria:** Every deferred prompt fires on time and records the correct branch without any defer-and-retry path.

### Phase 21 — Embedding gate

**Goal:** Add embedding quota reservation and preserve the existing keyword-search fallback when embeddings are denied. This phase is about graceful degradation.
**Touches:** `src/embeddings.ts`
**Tests:** `tests/embeddings/quota-gate.test.ts`, extended `tests/memos/search.test.ts`
**Exit criteria:** Embedding calls are gated and memo search still degrades correctly.

### Phase 22 — Attachment storage gate

**Goal:** Reserve attachment storage before upload completion and refund storage on delete. Abort before any S3 write when quota is exhausted.
**Touches:** `src/attachments/ingest.ts`, `src/attachments/manifest.ts`, `src/attachments/CLAUDE.md`
**Tests:** `tests/attachments/quota-gate.test.ts`, `tests/attachments/delete-refund.test.ts`
**Exit criteria:** Attachment storage usage tracks real outstanding footprint and denied uploads leave no partial state.

### Phase 23 — Attachment reconciliation sweep

**Goal:** Add a periodic sweep that recomputes attachment storage usage from metadata and corrects any counter drift. This is the self-healing pass.
**Touches:** `src/quota/attachment-reconcile.ts`, scheduler wiring in `src/index.ts` or equivalent
**Tests:** `tests/quota/attachment-reconcile.test.ts`
**Exit criteria:** Attachment storage drift is corrected on the next scheduled sweep.

### Phase 24 — Threshold notice (80%)

**Goal:** Emit a one-time-per-bucket threshold-crossed event and deliver a templated heads-up on the subject's primary chat surface. Re-arm on bucket reset or threshold recovery as appropriate.
**Touches:** `src/quota/counter-fixed.ts`, `src/quota/counter-rolling.ts`, `src/quota/notice.ts`, `src/quota/notice-template.ts`, `src/index.ts`
**Tests:** `tests/quota/notice-template.test.ts`, `tests/quota/threshold-emit.test.ts`, `tests/quota/notice-subscriber.test.ts`
**Exit criteria:** Subjects receive one threshold notice per active bucket, with no duplicates and no notice when disabled.

### Phase 25 — Garbage collector

**Goal:** Add opportunistic cleanup of expired `quota_counter` rows, skipping stock dimensions such as attachment storage. Trigger it on every 1024th write.
**Touches:** `src/quota/counter-fixed.ts`, `src/quota/counter-rolling.ts`, `src/quota/gc.ts`
**Tests:** `tests/quota/gc.test.ts`
**Exit criteria:** Old non-stock counter rows are removed without touching live or stock buckets.

## Track C — User-facing chat surface

Expose plan and quota information through tools and slash commands after enforcement is in place.

### Phase 26 — `get_my_plan` tool

**Goal:** Add a tool that returns the active plan and its limit rows, including algorithm and notify-threshold details. Make it available in DM, group, and proactive contexts.
**Touches:** `src/tools/quota/get-my-plan.ts`, `src/tools/tools-builder.ts`, `src/tools/tool-metadata.ts`
**Tests:** `tests/tools/get-my-plan.test.ts`
**Exit criteria:** The model and dashboard can query the active plan through the new tool.

### Phase 27 — `get_my_quota` tool

**Goal:** Add a companion tool that returns live quota snapshots per limited triple, including remaining capacity, reset timing, and refill rate where applicable. Omit reset times for stock dimensions.
**Touches:** `src/tools/quota/get-my-quota.ts`, `src/tools/tools-builder.ts`, `src/tools/tool-metadata.ts`
**Tests:** `tests/tools/get-my-quota.test.ts`
**Exit criteria:** Live quota snapshots are available through a stable tool contract.

### Phase 28 — `/plan` slash command

**Goal:** Add a zero-LLM slash command that replies with a one-line summary of the active plan. Support DM, group, and thread contexts.
**Touches:** `src/commands/plan.ts`, `src/commands/index.ts`, `src/bot.ts`
**Tests:** `tests/commands/plan.test.ts`
**Exit criteria:** `/plan` works across supported chat-provider command surfaces.

### Phase 29 — `/quota` slash command

**Goal:** Add a zero-LLM slash command that renders every limited triple in a user-friendly format. Show rolling-refill rows differently from fixed resets and omit reset text for stock rows.
**Touches:** `src/commands/quota.ts`, `src/commands/index.ts`, `src/bot.ts`
**Tests:** `tests/commands/quota.test.ts`
**Exit criteria:** `/quota` renders mixed plans correctly across supported contexts.

## Track D — Admin HTTP API

Land admin-facing read and write routes in small, reviewable phases behind the existing `DEBUG_TOKEN` gate.

### Phase 30 — `GET /admin/plans` and `GET /admin/plans/:id`

**Goal:** Add read routes for plans and single-plan detail. Return the plan shape used elsewhere, including algorithm and notify-threshold fields.
**Touches:** `src/debug/plans-routes.ts`, `src/debug/server.ts`
**Tests:** `tests/debug/plans-routes.test.ts`
**Exit criteria:** Plan read APIs are live and gated.

### Phase 31 — `POST /admin/plans`

**Goal:** Add transactional plan creation with limit validation, default algorithm/notify-threshold handling, and audit logging. Reject invalid resource/dimension/window or algorithm combinations.
**Touches:** `src/debug/plans-routes.ts`
**Tests:** happy path, validation failures, duplicate-plan conflict, and audit-row coverage in `tests/debug/plans-routes.test.ts`
**Exit criteria:** Admins can create plans safely through the HTTP API.

### Phase 32 — `PUT /admin/plans/:id`

**Goal:** Add atomic plan updates for metadata and full limit replacement. Drop affected counter rows in the same transaction when an algorithm changes.
**Touches:** `src/debug/plans-routes.ts`
**Tests:** partial update, full replacement, algorithm-switch reset, and audit coverage in `tests/debug/plans-routes.test.ts`
**Exit criteria:** Plan updates are atomic and leave no stale counter state behind.

### Phase 33 — `DELETE /admin/plans/:id`

**Goal:** Add safe plan deletion with fallback reassignment when pinned subjects still reference the plan. Prevent deletion of the default plan.
**Touches:** `src/debug/plans-routes.ts`
**Tests:** no-subject delete, required fallback, default-plan rejection, and audit coverage in `tests/debug/plans-routes.test.ts`
**Exit criteria:** Plans can be deleted without orphaning subjects or removing the default plan.

### Phase 34 — `PUT /admin/subjects/:subjectId/plan`

**Goal:** Add per-subject plan assignment and override expiry support. Reject thread-scoped subject ids.
**Touches:** `src/debug/billing-routes.ts` or `src/debug/subjects-routes.ts`
**Tests:** happy path, expiry round-trip, thread-id rejection, and audit coverage.
**Exit criteria:** Subject overrides are writable through the admin API.

### Phase 35 — `DELETE /admin/subjects/:subjectId/plan`

**Goal:** Remove a subject override so the default plan applies again. Keep the route idempotent and audited.
**Touches:** same module as Phase 34
**Tests:** row removal, idempotence, and audit coverage.
**Exit criteria:** Subject overrides can be removed cleanly.

### Phase 36 — `GET /billing/subject/:subjectId/quota`

**Goal:** Add a subject quota snapshot route that joins active plan limits with live counter state for dashboard display. Include threshold and refill metadata.
**Touches:** `src/debug/billing-routes.ts`, `src/debug/billing.ts`
**Tests:** limited/unlimited mixes, empty counters, mixed algorithms, threshold state, and stock-row formatting coverage.
**Exit criteria:** Dashboard-ready per-subject quota detail is available.

### Phase 37 — `GET /admin/plans/audit`

**Goal:** Add paginated read access to plan-audit rows with subject and time filtering. Keep the API small and read-only.
**Touches:** `src/debug/plans-routes.ts`
**Tests:** pagination, subject filtering, and since filtering.
**Exit criteria:** Admins can inspect quota-plan history over HTTP.

## Track E — Admin dashboard UI

Mirror the admin API in the Svelte debug dashboard with typed fetchers, plan management, subject views, and optional audit UI.

### Phase 38 — Plans fetchers + types

**Goal:** Add dashboard-side types and fetch helpers for every new plans and quota route. Include algorithm and rolling-refill-specific fields in shared types.
**Touches:** `client/debug/plans/fetchers.ts`, `client/debug/dashboard-types.ts`
**Tests:** `tests/client/plans-fetchers.test.ts`
**Exit criteria:** The frontend has typed fetch helpers for the full plans/quota API surface.

### Phase 39 — `PlansPanel.svelte`

**Goal:** Add the plans list tab with key metadata columns and refresh behavior. Defer create/edit interactions to the next phase.
**Touches:** `client/debug/plans/PlansPanel.svelte`, `client/debug/App.svelte`, `client/debug/dashboard.svelte.ts`
**Tests:** `tests/client/PlansPanel.test.ts`
**Exit criteria:** The dashboard shows a working plans table.

### Phase 40 — `PlanEditor.svelte` create flow

**Goal:** Add the create-plan modal with a limits matrix, algorithm selector, notify-threshold input, and inline validation. Submit to `POST /admin/plans`.
**Touches:** `client/debug/plans/PlanEditor.svelte`, shared modal components as needed
**Tests:** `tests/client/PlanEditor-create.test.ts`
**Exit criteria:** Admins can create a plan end-to-end from the dashboard.

### Phase 41 — `PlanEditor.svelte` edit + delete flow

**Goal:** Extend the editor for update and delete flows, including fallback-plan selection and warnings for algorithm changes that reset counters. Reuse the create editor.
**Touches:** `client/debug/plans/PlanEditor.svelte`
**Tests:** `tests/client/PlanEditor-edit-delete.test.ts`
**Exit criteria:** Full plan CRUD is reachable from the dashboard UI.

### Phase 42 — Subjects table: Plan column

**Goal:** Add an inline plan selector to the billing subjects table with optimistic updates and rollback on error. This enables quick reassignment from the existing billing surface.
**Touches:** `client/debug/billing/SubjectsTable.svelte`, related fetcher wiring
**Tests:** existing subjects-table tests extended for reassignment behavior.
**Exit criteria:** Admins can change a subject's plan from the billing table.

### Phase 43 — Subjects table: Quota column

**Goal:** Add a compact quota summary showing the most constraining live dimension for each subject. Fetch bulk quota info through an optional route flag.
**Touches:** `client/debug/billing/SubjectsTable.svelte`, `src/debug/billing-routes.ts`, `src/debug/billing.ts`
**Tests:** client component coverage plus route coverage for `?withQuota=true`.
**Exit criteria:** Per-subject quota pressure is visible at a glance.

### Phase 44 — Subject Detail: Quota card

**Goal:** Add a detailed quota card with active plan, per-triple meters, algorithm badges, threshold state, and plan-override modal entry points. Handle both fixed-window and rolling-refill rows cleanly.
**Touches:** `client/debug/billing/SubjectDetail.svelte`, `client/debug/billing/SubjectQuotaCard.svelte`, `client/debug/billing/OverridePlanModal.svelte`
**Tests:** component tests for each new file, including both algorithms and stock-dimension rendering.
**Exit criteria:** Admins can inspect and override a subject's quota state from one view.

### Phase 45 — Audit log viewer

**Goal:** Add an optional dashboard tab for recent plan-audit rows with subject filtering. This can land after the core plan-management UI.
**Touches:** `client/debug/plans/PlanAuditPanel.svelte`
**Tests:** component test using mocked fetchers.
**Exit criteria:** Plan-change history is visible in the dashboard.

## Track F — Admin DM commands

Provide minimal admin control for deployments that do not expose the debug dashboard.

### Phase 46 — `/plans` admin command

**Goal:** Add a read-only admin DM command that lists configured plans. Keep it simple and dashboard-independent.
**Touches:** `src/commands/admin.ts`
**Tests:** `tests/commands/admin-plans.test.ts`
**Exit criteria:** Admins can list plans from chat without the dashboard.

### Phase 47 — `/setplan` admin command

**Goal:** Add an admin DM command to assign a plan to a user or group, with optional expiry support. Reuse the project's existing subject-resolution utilities.
**Touches:** `src/commands/admin.ts`
**Tests:** `tests/commands/admin-setplan.test.ts`
**Exit criteria:** Admins can override a subject's plan from chat.

## Track G — Cleanup

Remove the temporary web-fetch compatibility path only after the new quota-driven behavior has proven stable in production.

### Phase 48 — Stop writing to `web_rate_limit`

**Goal:** Remove the temporary legacy write path introduced as a safety net in Phase 18. Leave the table in place for one more release window.
**Touches:** `src/web/rate-limit.ts`
**Tests:** updated web rate-limit coverage asserting no legacy inserts occur.
**Exit criteria:** Legacy `web_rate_limit` writes are gone.

### Phase 49 — Drop `web_rate_limit` migration

**Goal:** Remove the obsolete legacy table after the additional release window. Clean up schema exports accordingly.
**Touches:** `src/db/migrations/<M>_drop_web_rate_limit.ts`, `src/db/web-schema.ts`, `src/db/schema.ts`
**Tests:** migration test asserting the table is removed.
**Exit criteria:** The legacy web-rate-limit table is fully deleted.
