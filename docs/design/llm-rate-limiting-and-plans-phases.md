<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Rate Limiting and Plans — Phase Decomposition

Companion to [`llm-rate-limiting-and-plans.md`](./llm-rate-limiting-and-plans.md).
Each phase below is sized to fit **one coding session** (≈ plan → tests → impl
→ verify → commit, no overflow).

## How to use this document

- **Order matters.** Phases are bottom-up: storage and pure logic first, then
  wiring, then HTTP, then UI, then chat commands, then cleanup. Don't skip
  ahead — later phases assume earlier ones landed and are green.
- **Each phase has a stop line.** The "Exit criteria" section is the only
  thing that ends a phase. If `bun check:full` is red, the phase is not done,
  no matter how complete it feels.
- **One phase per commit / PR.** Keeps reviews tractable and lets the
  review-loop workspace bisect cleanly.
- **TDD is enforced by hooks** on `src/**` and `client/**`. Write the test
  first; the write-policy gate will reject implementation before a failing
  test exists. Phases below already follow that order.
- **Use `using-superpowers`, `writing-plans`, and `verification-before-completion`**
  skills around each phase as the project conventions require.

## Conventions used by every phase

| Field         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| Touches       | Files created or modified. Numbers are illustrative; expect ±1.        |
| Depends on    | Phase numbers that must be merged first.                               |
| Tests         | Test files added (always added before implementation under TDD hooks). |
| Verification  | Exact commands run before declaring the phase done.                    |
| Exit criteria | Observable state when the phase is complete.                           |

Every phase ends with the same verification baseline (omitted from each phase
for brevity, run them anyway):

```bash
bun lint
bun typecheck
bun test            # curated main suite
bun format:check
```

`bun check:full` runs all of the above plus knip + duplicates and is the
required pre-merge gate.

---

## Track A — Storage and pure logic (no behaviour change yet)

### Phase 1 — Subject id helper

- **Goal.** Add a single function that strips the optional `:threadId` suffix
  from a `storage_context_id` to produce a `subject_id`. No call sites are
  changed yet.
- **Touches.** `src/auth.ts` (add `getSubjectId(storageContextId)` alongside
  `getThreadScopedStorageContextId`).
- **Tests.** `tests/auth.test.ts`: DM, group main, group thread, double-colon
  edge cases (`group:a:b:c` stays `group:a` — first colon split? **No** —
  Telegram group ids can themselves contain hyphens but never colons, so the
  helper splits on the **last** colon. Document this explicitly with a test).
- **Verification.** Baseline only.
- **Exit criteria.** New helper exported, fully tested, unused at runtime.

### Phase 2 — Quota types and constants

- **Goal.** Centralise the type and enum surface so later phases can import
  from one module without circular deps.
- **Touches.** `src/quota/types.ts` (new): `Resource`, `Dimension`, `Window`,
  `PlanId`, `SubjectId`, `Limit` (struct), `PlanLimitRow`, `PlanRecord`,
  `ResolvedPlan`, `QuotaSnapshot`, `ReserveResult`, `CommitInput`,
  `RESOURCES`, `DIMENSIONS`, `WINDOWS`, `WINDOW_MS`.
- **Touches.** `src/quota/validity.ts` (new): pure `isValidLimitTriple(resource,
dimension, window)` from §4.2 of the spec; throws nothing, returns boolean.
- **Tests.** `tests/quota/validity.test.ts`: matrix coverage of every
  (resource × dimension) pair.
- **Exit criteria.** Importable types and validators; no other file imports
  them yet.

### Phase 3 — Window math

- **Goal.** Pure function `bucketFor(window, nowMs)` returning
  `{ windowStart, resetsAt }`. Handles minute/hour/day as `floor(now / ms) * ms`
  and `month` as **UTC calendar month** start.
- **Touches.** `src/quota/window.ts` (new).
- **Tests.** `tests/quota/window.test.ts`: minute boundary, hour boundary, day
  UTC midnight crossing, month boundary (Jan→Feb, Feb→Mar leap-year, Dec→Jan
  year rollover).
- **Exit criteria.** All four windows correct across DST-free UTC math.

### Phase 4 — DB migration: tables only

- **Goal.** Land all five tables with indexes. Drizzle schema is added but
  **no runtime code reads or writes them yet**.
- **Touches.**
  - `src/db/migrations/<N>_plans_quotas.ts` (new; N = next number).
  - `src/db/plans-schema.ts` (new, mirrors style of `llm-usage-events-schema.ts`).
  - `src/db/schema.ts` (re-export new tables).
- **Schemas (verbatim against §5 of spec).** `plans`, `plan_limits`,
  `subject_plan`, `plan_audit`, `quota_counter`, plus the partial unique index
  `uniq_plans_default` and the `idx_quota_counter_gc` index.
- **Tests.** `tests/db/plans-migration.test.ts`: applies the migration on a
  fresh in-memory DB, asserts every table exists, every index exists, partial
  unique index rejects a second `is_default = 1` row.
- **Exit criteria.** Migration applies on a fresh DB; `bun typecheck` clean;
  no consumer code yet.

### Phase 5 — Seed migration

- **Goal.** Separate migration that inserts the three seed plans
  (`free`, `team`, `unlimited`) and binds `ADMIN_USER_ID`'s subject to
  `unlimited`. Idempotent (`ON CONFLICT DO NOTHING`).
- **Touches.** `src/db/migrations/<N+1>_seed_plans.ts` (new). Reads
  `ADMIN_USER_ID` at migration time and stores it as the `subject_plan` row
  for the admin user.
- **Tests.** `tests/db/seed-plans-migration.test.ts`: fresh DB → three rows in
  `plans`, expected `plan_limits` triples for `free`/`team`, zero limits for
  `unlimited`, one row in `subject_plan` for the admin.
- **Exit criteria.** Migration runs after Phase 4; admin row visible.

### Phase 6 — Plan repository (read side)

- **Goal.** Thin DB access functions, no orchestration.
- **Touches.** `src/quota/plan-repository.ts` (new): `listPlans()`,
  `getPlan(planId)`, `listPlanLimits(planId)`, `getSubjectPlan(subjectId)`.
- **Tests.** `tests/quota/plan-repository.test.ts`: each function against a
  migrated+seeded DB.
- **Exit criteria.** Functions exported and exercised; no callers yet.

### Phase 7 — Plan resolver

- **Goal.** `resolvePlan(subjectId, nowMs)` implementing §6 (override row →
  default plan). Strips thread suffix using the Phase 1 helper.
- **Touches.** `src/quota/resolve.ts` (new).
- **Tests.** `tests/quota/resolve.test.ts`: 3-tier lookup, `expires_at`
  honoured at `now > expiry`, thread stripping (asserts that
  `group:abc:thread-7` and `group:abc` resolve to the **same** plan).
- **Exit criteria.** Pure function; no side effects; full branch coverage.

### Phase 8 — Counter primitive: increment

- **Goal.** Atomic `tryIncrement(subjectId, resource, dimension, window,
delta, limit, nowMs)` mirroring `consumeWebFetchQuota`'s pattern:
  insert-on-conflict then conditional update with `RETURNING`.
- **Touches.** `src/quota/counter.ts` (new).
- **Tests.** `tests/quota/counter.test.ts`: increment under limit, exceed
  limit, exact-boundary case, two parallel `Promise.all` increments asserting
  total stays ≤ limit (run with `p-limit(8)`).
- **Exit criteria.** Race-safe primitive; no callers yet.

### Phase 9 — Counter primitive: refund/clamp

- **Goal.** `applyDelta(subjectId, resource, dimension, window, delta,
nowMs)` that supports **negative deltas**, clamping `count` at zero. Used
  for `commitQuota` reconciliation.
- **Touches.** Extend `src/quota/counter.ts`.
- **Tests.** Extend `tests/quota/counter.test.ts`: negative delta clamps,
  multiple refunds within one bucket, idempotent at zero.
- **Exit criteria.** Single SQL `UPDATE ... SET count = MAX(0, count + :delta)`
  proven correct.

### Phase 10 — `reserveQuota`

- **Goal.** Public engine: resolve plan, fan out `tryIncrement` over every
  `(dimension, window)` triple in the limits matrix for the resource. On
  first breach, roll back all prior increments **within the same tx**.
- **Touches.** `src/quota/reserve.ts` (new), `src/quota/index.ts` (new,
  re-export façade).
- **Tests.** `tests/quota/reserve.test.ts`:
  - allowed path returns `remainingByDimension` for every limited triple;
  - breached path returns `{ breachedDimension, retryAfterMs }` and **leaves
    `quota_counter` unchanged** for the other dimensions;
  - unlimited plan returns `allowed: true` with no rows touched.
- **Exit criteria.** Engine works against the migrated+seeded DB; no wiring
  into orchestrator yet.

### Phase 11 — `commitQuota`

- **Goal.** Public engine: apply signed deltas to reconcile actuals.
- **Touches.** `src/quota/commit.ts` (new), façade re-export.
- **Tests.** `tests/quota/commit.test.ts`: over-estimate (negative delta on
  `input_tokens`), under-estimate (positive delta on `output_tokens`), error
  refund (negative delta + zero on `requests`), clamp behaviour.
- **Exit criteria.** Reconciliation engine complete; still no callers.

### Phase 12 — Audit writer

- **Goal.** `recordAudit(action, actorId, subjectId?, planId?, payload)`
  inserts one row into `plan_audit`. Pure side-effect; no resolver/engine
  dependency.
- **Touches.** `src/quota/audit.ts` (new).
- **Tests.** `tests/quota/audit.test.ts`: each action enum value, JSON
  payload round-trip.
- **Exit criteria.** Append-only audit primitive ready for use by HTTP/admin
  layers.

---

## Track B — Enforcement wiring (turns the engine on)

### Phase 13 — Orchestrator pre-call gate (main role)

- **Goal.** Insert `reserveQuota('llm:main', { requests: 1, input_tokens:
estimateInput(prompt), output_tokens: outputBudget })` immediately before
  the `generateText` call. On denial, return the structured "quota exhausted"
  reply (see §8 of spec) and **do not** call the model.
- **Touches.** `src/llm-orchestrator-support.ts` (pre-call hook),
  `src/llm-orchestrator-types.ts` (new dep typed via DI).
- **Tests.** `tests/llm-orchestrator/quota-gate.test.ts`: stub the quota
  engine; assert the gate is called with the right args; assert `generateText`
  is not invoked on denial; assert the failure reply contains plan name and
  reset time.
- **Exit criteria.** Main-role gate live; small/embed/tool/web still un-gated.

### Phase 14 — Orchestrator commit hook

- **Goal.** In the existing `llm:end` / `llm:error` subscriber (same module
  that calls `recordUsage`), call `commitQuota` with the actual deltas. On
  error, refund tokens but **not** the request count.
- **Touches.** `src/usage/index.ts` (extend `handleEvent`).
- **Tests.** Extend `tests/usage/index.test.ts`: assert commit is called with
  the right signed deltas for success and error events.
- **Exit criteria.** Counters reconcile to actuals; over-/under-estimates
  visible in the resulting `quota_counter` rows.

### Phase 15 — Small-role gate

- **Goal.** Mirror Phase 13 for the small-role LLM path. Same module hook,
  different `resource` arg.
- **Touches.** `src/llm-orchestrator-support.ts`.
- **Tests.** Add small-role coverage in the existing quota-gate test file.
- **Exit criteria.** Small-role calls denied past their plan limit.

### Phase 16 — Tool wrapper gate

- **Goal.** Increment `tool.requests.*` before every tool execution in the
  tool wrapper used by `src/tools/`. On denial, return the structured failure
  result described in §8 of spec (`{ success: false, error: { code:
'quota_exceeded', ... } }`).
- **Touches.** `src/tools/tool-execution-wrapper.ts` (or the equivalent
  module — locate via `code_symbol` before starting).
- **Tests.** `tests/tools/quota-gate.test.ts`: gate fires, structured failure
  returned, `tool_call_events` still recorded for the attempt.
- **Exit criteria.** Tool calls denied past their plan limit; LLM sees a
  structured error and can apologise.

### Phase 17 — Web-fetch gate

- **Goal.** Have `consumeWebFetchQuota` delegate to the new engine for the
  limit value (read from the active plan via the resolver). The old
  `web_rate_limit` table is **still written** for one release as a safety net
  but is no longer the source of the limit.
- **Touches.** `src/web/rate-limit.ts`, `src/web/fetch-extract.ts` (only the
  injection point if needed).
- **Tests.** Extend `tests/web/rate-limit.test.ts`: plan-driven limit beats
  the hard-coded constant; subject with `unlimited` is never throttled.
- **Exit criteria.** Plan-driven web-fetch limit live; legacy table still
  written for one release window.

### Phase 18 — Proactive LLM gate

- **Goal.** Make `src/deferred-prompts/proactive-llm.ts` pass through the
  same reserve/commit calls as the interactive path.
- **Touches.** `src/deferred-prompts/proactive-llm.ts`,
  `src/deferred-prompts/proactive-llm-helpers.ts`.
- **Tests.** Extend the proactive-LLM tests: deny path skips dispatch,
  allow path proceeds normally.
- **Exit criteria.** A deferred prompt cannot drain a subject past its plan.

### Phase 19 — Embedding gate

- **Goal.** Insert `reserveQuota('llm:embed', ...)` in `src/embeddings.ts`.
  On denial, callers in `src/memos.ts` already degrade to keyword search; this
  phase only asserts the degradation still triggers.
- **Touches.** `src/embeddings.ts`.
- **Tests.** `tests/embeddings/quota-gate.test.ts`: denial returns the
  agreed "skip embeddings" signal; `tests/memos/search.test.ts` extended to
  assert the keyword fallback fires when embeddings are denied.
- **Exit criteria.** Embedding calls gated; memo search degrades gracefully.

### Phase 20 — Garbage collector

- **Goal.** Opportunistic GC of old `quota_counter` rows on every 1024th
  write, parameterised by `QUOTA_RETENTION_MS` env var (default `2 ×
MONTH_MS`). Matches the spec's §5.5.
- **Touches.** `src/quota/counter.ts` (add the modulo trigger),
  `src/quota/gc.ts` (new, pure delete query).
- **Tests.** `tests/quota/gc.test.ts`: GC fires at the right cadence, deletes
  only rows older than retention.
- **Exit criteria.** Old buckets disappear; live buckets never deleted.

---

## Track C — User-facing surface (chat)

### Phase 21 — `get_my_plan` tool

- **Goal.** New tool, registered in the tool builder, available in DM and
  group (`proactive` allowed). Returns the JSON shape from §9.1.
- **Touches.** `src/tools/quota/get-my-plan.ts` (new),
  `src/tools/tools-builder.ts` (register), `src/tools/tool-metadata.ts` (add
  metadata row).
- **Tests.** `tests/tools/get-my-plan.test.ts`: shape, gating, subject-id
  derivation (thread-stripped).
- **Exit criteria.** Tool visible to the model and to the dashboard.

### Phase 22 — `get_my_quota` tool

- **Goal.** Companion tool returning the live snapshot, one entry per
  limited triple, with `resetsAt` from Phase 3 math.
- **Touches.** `src/tools/quota/get-my-quota.ts` (new), tools-builder,
  tool-metadata.
- **Tests.** `tests/tools/get-my-quota.test.ts`: snapshot shape, monotonic
  `remaining`, correct reset for each window.
- **Exit criteria.** Tool visible and stable across the four window types.

### Phase 23 — `/plan` slash command

- **Goal.** Short-circuit handler in `src/bot.ts` and the command registry
  (`src/commands/`). Replies with a single localised line summarising the
  active plan. **Zero LLM cost.**
- **Touches.** `src/commands/plan.ts` (new), `src/commands/index.ts` (register),
  `src/bot.ts` (route).
- **Tests.** `tests/commands/plan.test.ts`: DM, group, group thread (asserts
  the same plan name in main and thread).
- **Exit criteria.** Command works on all three chat providers' capability
  surfaces.

### Phase 24 — `/quota` slash command

- **Goal.** Same shape as Phase 23 but lists every limited triple.
- **Touches.** `src/commands/quota.ts` (new), registry, `src/bot.ts`.
- **Tests.** `tests/commands/quota.test.ts`.
- **Exit criteria.** Command renders correctly with 0, 1, and many limits.

---

## Track D — Admin HTTP API

Each route is its own phase to keep diffs small and reviews honest. All
routes are mounted in `src/debug/server.ts` and gated by `DEBUG_TOKEN`
exactly like `POST /admin/llm` (see `src/debug/billing-routes.ts`).

### Phase 25 — `GET /admin/plans` and `GET /admin/plans/:id`

- **Touches.** `src/debug/plans-routes.ts` (new), `src/debug/server.ts`
  (router).
- **Tests.** `tests/debug/plans-routes.test.ts`: 200 with token, 401 without,
  shape matches §9.1 of spec.
- **Exit criteria.** Read API live and tested.

### Phase 26 — `POST /admin/plans`

- **Goal.** Create a new plan with limits in a single transaction. Validates
  every triple via Phase 2's `isValidLimitTriple`. Writes a `plan_create`
  audit row.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Happy path; 400 on invalid triple; 409 on duplicate id; audit
  row written.
- **Exit criteria.** Plan creation gated by `DEBUG_TOKEN`; audit verifiable.

### Phase 27 — `PUT /admin/plans/:id`

- **Goal.** Update name/description/limits. Limits replace atomically (delete
  - insert in one tx). `plan_update` audit row.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Partial updates, full limits replacement, audit row.
- **Exit criteria.** Updates atomic; no half-applied limits possible.

### Phase 28 — `DELETE /admin/plans/:id`

- **Goal.** Delete a plan. If subjects are pinned to it, require
  `?fallback=<planId>` query param and reassign pinned subjects to the
  fallback in the same transaction. Default plan cannot be deleted.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** No-subjects case, with-subjects requires fallback (409 without),
  default-plan rejected (400), audit row for each affected subject.
- **Exit criteria.** Safe deletion; admin always has an escape hatch.

### Phase 29 — `PUT /admin/subjects/:subjectId/plan`

- **Goal.** Assign or override a plan for a subject. Body:
  `{ planId, expiresAt?, note? }`. Reject thread-scoped ids (409, see §10.2
  of spec). `subject_assign` audit row.
- **Touches.** `src/debug/billing-routes.ts` (or a new
  `src/debug/subjects-routes.ts` if billing-routes is getting large; decide at
  the start of this phase).
- **Tests.** Happy path, expiry round-trip, thread-id rejection, audit row.
- **Exit criteria.** Per-subject overrides usable via API.

### Phase 30 — `DELETE /admin/subjects/:subjectId/plan`

- **Goal.** Remove an override, falling back to the default plan. Writes a
  `subject_unassign` audit row.
- **Touches.** Same module as Phase 29.
- **Tests.** Removes the row; idempotent; audit row.
- **Exit criteria.** Override removal works; default plan applies afterwards.

### Phase 31 — `GET /billing/subject/:subjectId/quota`

- **Goal.** Snapshot of live `quota_counter` rows for the subject, joined
  with the active plan's limits to render `{ used, limit, remaining,
resetsAt }` per triple. Used by the dashboard Subject Detail card.
- **Touches.** `src/debug/billing-routes.ts`, `src/debug/billing.ts` (read
  helper).
- **Tests.** Mixed limited/unlimited triples, empty counters, near-zero
  remaining.
- **Exit criteria.** Dashboard-ready endpoint live.

### Phase 32 — `GET /admin/plans/audit`

- **Goal.** Paginated read of `plan_audit`. Query params: `subjectId?`,
  `since?`, `limit` (default 100, max 500).
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Pagination boundary, subject filter, since filter.
- **Exit criteria.** Auditable history visible to admin.

---

## Track E — Admin dashboard UI

The dashboard is Svelte 5 with runes. Each phase mirrors the existing layout
under `client/debug/billing/` and uses the same fetcher pattern.

### Phase 33 — Plans fetchers + types

- **Goal.** Type and HTTP-fetch wrappers for every Track D route, plus
  shared types added to `client/debug/dashboard-types.ts`.
- **Touches.** `client/debug/plans/fetchers.ts` (new),
  `client/debug/dashboard-types.ts`.
- **Tests.** `tests/client/plans-fetchers.test.ts` (happy-dom) using
  `setMockFetch`.
- **Exit criteria.** Frontend can talk to every plans/quota endpoint.

### Phase 34 — `PlansPanel.svelte`

- **Goal.** List view: id, name, description, is_default, pinned-subject
  count, created/updated timestamps. "New plan" button (modal in next phase).
- **Touches.** `client/debug/plans/PlansPanel.svelte` (new),
  `client/debug/App.svelte` (add tab), `client/debug/dashboard.svelte.ts`
  (state slice).
- **Tests.** `tests/client/PlansPanel.test.ts` against the fetcher mock.
- **Exit criteria.** Tab visible, table renders, refresh works.

### Phase 35 — `PlanEditor.svelte` create flow

- **Goal.** Modal-form to create a plan, including the limits matrix
  (`resource` rows × `dimension × window` columns). Inline validation against
  `isValidLimitTriple`. Calls `POST /admin/plans`.
- **Touches.** `client/debug/plans/PlanEditor.svelte` (new),
  `client/debug/components/Modal.svelte` (reuse).
- **Tests.** `tests/client/PlanEditor-create.test.ts`.
- **Exit criteria.** Admin can create a plan end-to-end through the UI.

### Phase 36 — `PlanEditor.svelte` edit + delete flow

- **Goal.** Reuse the same editor for `PUT`; add a delete button with the
  fallback-plan picker required by Phase 28.
- **Touches.** Same component.
- **Tests.** `tests/client/PlanEditor-edit-delete.test.ts`.
- **Exit criteria.** Full CRUD reachable from the UI.

### Phase 37 — Subjects table: Plan column

- **Goal.** Extend `client/debug/billing/SubjectsTable.svelte` with a
  **Plan** column rendered as an inline `<select>`. On change call
  `PUT /admin/subjects/:id/plan` optimistically; rollback on error.
- **Touches.** `SubjectsTable.svelte`, `fetchers.ts`.
- **Tests.** Existing component test extended.
- **Exit criteria.** Plan reassignment one click from Billing.

### Phase 38 — Subjects table: Quota column

- **Goal.** Add a compact bar showing the most-constraining live dimension
  (e.g. `73 % llm:main input_tokens day`). Fetched in bulk via a new
  optional `?withQuota=true` query param on `/billing/subjects`.
- **Touches.** `SubjectsTable.svelte`, `src/debug/billing-routes.ts`,
  `src/debug/billing.ts`.
- **Tests.** Client component test + route test for the new flag.
- **Exit criteria.** Quota visible at a glance per subject.

### Phase 39 — Subject Detail: Quota card

- **Goal.** Extend `client/debug/billing/SubjectDetail.svelte` with a card
  showing every triple's meter + the active plan. "Override plan…" opens a
  modal with `planId` + optional `expiresAt`.
- **Touches.** `SubjectDetail.svelte`, new
  `client/debug/billing/SubjectQuotaCard.svelte`,
  `client/debug/billing/OverridePlanModal.svelte`.
- **Tests.** Component tests for each new file.
- **Exit criteria.** Admin sees full per-subject picture in one view.

### Phase 40 — Audit log viewer (optional, can land later)

- **Goal.** Tab under Plans showing the last N audit rows with subject filter.
- **Touches.** `client/debug/plans/PlanAuditPanel.svelte` (new).
- **Tests.** Component test against fetcher mock.
- **Exit criteria.** Plan changes auditable from the UI.

---

## Track F — Admin DM commands (no `DEBUG_SERVER` deployments)

### Phase 41 — `/plans` admin command

- **Goal.** Admin DM command listing configured plans (read-only).
- **Touches.** `src/commands/admin.ts`.
- **Tests.** `tests/commands/admin-plans.test.ts`.
- **Exit criteria.** Admin can list plans without a dashboard.

### Phase 42 — `/setplan` admin command

- **Goal.** `/setplan <subject> <planId> [until=<ISO>]`. Resolves `<subject>`
  via the existing identity utilities (`@username` / user id / `group:<id>`).
  Writes a `subject_assign` audit row.
- **Touches.** `src/commands/admin.ts`.
- **Tests.** `tests/commands/admin-setplan.test.ts`: by-username, by-id,
  by-group-id, invalid input, expiry round-trip.
- **Exit criteria.** Admin can re-plan any subject from a Telegram DM.

---

## Track G — Cleanup (only after one release window)

### Phase 43 — Stop writing to `web_rate_limit`

- **Goal.** Once Phase 17 has been live for one release, remove the legacy
  write path. The table still exists.
- **Touches.** `src/web/rate-limit.ts`.
- **Tests.** Existing tests updated; assert no inserts to `web_rate_limit`.
- **Exit criteria.** Legacy writes gone; reads (if any) gone.

### Phase 44 — Drop `web_rate_limit` migration

- **Goal.** Drop the table after one further release window.
- **Touches.** `src/db/migrations/<M>_drop_web_rate_limit.ts` (new),
  `src/db/web-schema.ts` (remove export), `src/db/schema.ts`.
- **Tests.** Migration test asserts the table is gone.
- **Exit criteria.** Legacy table removed.

---

## Phase dependency graph (summary)

```text
1 ──┐
    ├── 7 ─────────────── 10 ──┐
2 ──┤                          │
    ├── 8 ─── 9 ────────── 11 ─┤
3 ──┤                          │
    │                          ├── 13 ─── 14 ─── 15 ─── 16 ─── 17 ─── 18 ─── 19 ─── 20
4 ── 5 ── 6 ──────────────  12 ┘                │       │       │
                                                │       │       └── 43 ── 44
                                                │       └── (no dependents)
                                                │
                                                ├── 21 ── 23
                                                └── 22 ── 24
                                                │
                                                ├── 25 ── 26 ── 27 ── 28
                                                ├── 29 ── 30
                                                ├── 31
                                                └── 32
                                                │
                                                ├── 33 ── 34 ── 35 ── 36
                                                │            └── 37 ── 38 ── 39
                                                │            └── 40
                                                │
                                                └── 41 ── 42
```

Track A (1–12) is strictly sequential. Track B (13–20) is sequential within
itself but each phase is independently reviewable. Tracks C, D, E, F can
proceed in parallel after Track B lands, with the dependency edges shown.
Track G waits for production telemetry to confirm Phase 17 has not regressed
web-fetch behaviour.

## Per-phase session checklist

Use this as the checklist for any individual phase. The list is short on
purpose — the project's hooks and skills enforce the rest.

1. Read the spec section the phase implements. If unclear, open a question
   in chat **before** writing code.
2. Load the relevant superpower skills (`using-superpowers`,
   `test-driven-development`, `writing-plans`).
3. Write the failing test(s) listed under **Tests**. Run them, see them red.
4. Implement the smallest change that turns them green.
5. Run the baseline verification (`bun lint`, `bun typecheck`, `bun test`,
   `bun format:check`).
6. Run `bun check:full` before declaring done.
7. Commit on the same branch with a message matching the project's commit
   conventions (see `git log --oneline -20`).
8. Tick off the phase in this file's progress table below.

## Progress

> Update this table on merge of each phase.

| #   | Phase                                         | Status |
| --- | --------------------------------------------- | ------ |
| 1   | Subject id helper                             | todo   |
| 2   | Quota types and constants                     | todo   |
| 3   | Window math                                   | todo   |
| 4   | DB migration: tables only                     | todo   |
| 5   | Seed migration                                | todo   |
| 6   | Plan repository (read side)                   | todo   |
| 7   | Plan resolver                                 | todo   |
| 8   | Counter primitive: increment                  | todo   |
| 9   | Counter primitive: refund/clamp               | todo   |
| 10  | `reserveQuota`                                | todo   |
| 11  | `commitQuota`                                 | todo   |
| 12  | Audit writer                                  | todo   |
| 13  | Orchestrator pre-call gate (main role)        | todo   |
| 14  | Orchestrator commit hook                      | todo   |
| 15  | Small-role gate                               | todo   |
| 16  | Tool wrapper gate                             | todo   |
| 17  | Web-fetch gate                                | todo   |
| 18  | Proactive LLM gate                            | todo   |
| 19  | Embedding gate                                | todo   |
| 20  | Garbage collector                             | todo   |
| 21  | `get_my_plan` tool                            | todo   |
| 22  | `get_my_quota` tool                           | todo   |
| 23  | `/plan` slash command                         | todo   |
| 24  | `/quota` slash command                        | todo   |
| 25  | `GET /admin/plans` and `GET /admin/plans/:id` | todo   |
| 26  | `POST /admin/plans`                           | todo   |
| 27  | `PUT /admin/plans/:id`                        | todo   |
| 28  | `DELETE /admin/plans/:id`                     | todo   |
| 29  | `PUT /admin/subjects/:subjectId/plan`         | todo   |
| 30  | `DELETE /admin/subjects/:subjectId/plan`      | todo   |
| 31  | `GET /billing/subject/:subjectId/quota`       | todo   |
| 32  | `GET /admin/plans/audit`                      | todo   |
| 33  | Plans fetchers + types                        | todo   |
| 34  | `PlansPanel.svelte`                           | todo   |
| 35  | `PlanEditor.svelte` create flow               | todo   |
| 36  | `PlanEditor.svelte` edit + delete flow        | todo   |
| 37  | Subjects table: Plan column                   | todo   |
| 38  | Subjects table: Quota column                  | todo   |
| 39  | Subject Detail: Quota card                    | todo   |
| 40  | Audit log viewer                              | todo   |
| 41  | `/plans` admin command                        | todo   |
| 42  | `/setplan` admin command                      | todo   |
| 43  | Stop writing to `web_rate_limit`              | todo   |
| 44  | Drop `web_rate_limit` migration               | todo   |
