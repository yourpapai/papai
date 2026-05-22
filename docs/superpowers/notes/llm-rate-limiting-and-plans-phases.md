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
- **Touches.** `src/quota/types.ts` (new):
  - `Resource` — `'llm:main' | 'llm:small' | 'llm:embed' | 'tool' |
'web_fetch' | 'attachment'`.
  - `Dimension` — `'requests' | 'input_tokens' | 'output_tokens' |
'cost_usd_micro' | 'storage_bytes'`.
  - `Window` — `'day' | 'week' | 'month'`.
  - `Algorithm` — `'fixed_window' | 'rolling_refill'`.
  - `PlanId`, `SubjectId`, `Limit` (struct including `algorithm` and
    `notifyPct`), `PlanLimitRow`, `PlanRecord`, `ResolvedPlan`,
    `QuotaSnapshot`, `ReserveResult`, `CommitInput`.
  - Const arrays `RESOURCES`, `DIMENSIONS`, `WINDOWS`, `ALGORITHMS`, plus
    the `WINDOW_MS` map. `month` uses the average length
    `2_629_800_000 ms` for rolling-refill rate math even though
    fixed-window calendar buckets are anchored to UTC first-of-month.
- **Touches.** `src/quota/validity.ts` (new):
  - `isValidLimitTriple(resource, dimension, window)` from §4.2 of the
    spec (e.g. rejects `tool × output_tokens`, `attachment × requests`,
    `llm:* × storage_bytes`).
  - `isValidAlgorithmForDimension(dimension, algorithm)` rejects
    `rolling_refill` for stock dimensions (`storage_bytes`).
  - Both functions throw nothing and return boolean.
- **Tests.** `tests/quota/validity.test.ts`: full matrix coverage including
  `attachment × storage_bytes` (allowed), `attachment × requests`
  (rejected), `llm:* × storage_bytes` (rejected),
  `tool × output_tokens` (rejected); algorithm validity for every
  dimension.
- **Exit criteria.** Importable types and validators; no other file imports
  them yet.

### Phase 3 — Window math

- **Goal.** Pure function `bucketFor(window, nowMs)` returning
  `{ windowStart, resetsAt, windowMs }`. Handles `day` as
  `floor(now / 86_400_000) * 86_400_000` UTC, `week` as the start of the
  **ISO-8601 week (UTC Monday 00:00)**, `month` as **UTC calendar month**
  start.
- **Touches.** `src/quota/window.ts` (new).
- **Tests.** `tests/quota/window.test.ts`: day UTC midnight crossing; week
  boundary including Sun→Mon rollover at 23:59:59.999 UTC and ISO year-end
  weeks (e.g. 2026-01-04 is in ISO week 1, 2026-01-05 starts ISO week 2);
  month boundary (Jan→Feb, Feb→Mar leap-year, Dec→Jan year rollover).
  Minute/hour cases are explicitly **not** part of v1 — assert the type
  system rejects `'minute' as Window`.
- **Exit criteria.** All three windows correct across DST-free UTC math.

### Phase 4 — DB migration: tables only

- **Goal.** Land all five tables with indexes. Drizzle schema is added but
  **no runtime code reads or writes them yet**.
- **Touches.**
  - `src/db/migrations/<N>_plans_quotas.ts` (new; N = next number).
  - `src/db/plans-schema.ts` (new, mirrors style of
    `llm-usage-events-schema.ts`).
  - `src/db/schema.ts` (re-export new tables).
- **Schemas (verbatim against §5 of spec).**
  - `plans` + partial unique index `uniq_plans_default`.
  - `plan_limits` — including the new
    `algorithm text NOT NULL DEFAULT 'fixed_window'` and
    `notify_pct int NOT NULL DEFAULT 80` columns.
  - `subject_plan`.
  - `plan_audit`.
  - `quota_counter` — PK is `(subject_id, resource, dimension, window)`
    (no `window_start` in the key, since only the active bucket lives in
    the table). Columns: `algorithm`, `window_start`, `count`, `balance`,
    `notified_threshold_pct`. Plus `idx_quota_counter_gc` on
    `window_start`.
- **Tests.** `tests/db/plans-migration.test.ts`: applies on a fresh
  in-memory DB; asserts every table and index exists; partial unique index
  rejects a second `is_default = 1` row; `quota_counter` PK rejects two
  rows with the same `(subject_id, resource, dimension, window)` even
  across different `window_start` values (proves the new PK shape);
  `plan_limits.algorithm` defaults to `fixed_window` and `notify_pct` to
  `80` on insert without explicit values.
- **Exit criteria.** Migration applies on a fresh DB; `bun typecheck`
  clean; no consumer code yet.

### Phase 5 — Seed migration

- **Goal.** Separate migration that inserts the three seed plans
  (`free`, `team`, `unlimited`) per spec §12.1 and binds `ADMIN_USER_ID`'s
  subject to `unlimited`. Idempotent (`ON CONFLICT DO NOTHING`).
- **Touches.** `src/db/migrations/<N+1>_seed_plans.ts` (new). Reads
  `ADMIN_USER_ID` at migration time and stores it as the `subject_plan`
  row for the admin user.
- **Seeded mix.**
  - `free` mixes algorithms: `llm:main` daily input/output on
    `rolling_refill`, monthly `input_tokens` cap on `fixed_window`,
    `tool.requests.day` on `fixed_window`,
    `attachment.storage_bytes.month` on `fixed_window` (stock dimension),
    `web_fetch.requests.day` on `rolling_refill` with capacity sized so
    the previous `20 / minute` hard cap is the long-run average.
  - `team` is the same shape with higher caps.
  - `unlimited` has zero `plan_limits` rows.
- **Tests.** `tests/db/seed-plans-migration.test.ts`: three rows in
  `plans`; expected `plan_limits` triples per plan with the right
  `algorithm` and `notify_pct = 80` on each; zero limits for `unlimited`;
  one row in `subject_plan` for the admin.
- **Exit criteria.** Migration runs after Phase 4; admin row visible.

### Phase 6 — Plan repository (read side)

- **Goal.** Thin DB access functions, no orchestration.
- **Touches.** `src/quota/plan-repository.ts` (new): `listPlans()`,
  `getPlan(planId)`, `listPlanLimits(planId)`, `getSubjectPlan(subjectId)`.
- **Tests.** `tests/quota/plan-repository.test.ts`: each function against
  a migrated+seeded DB; asserts the new `algorithm` and `notifyPct` fields
  survive the round-trip.
- **Exit criteria.** Functions exported and exercised; no callers yet.

### Phase 7 — Plan resolver

- **Goal.** `resolvePlan(subjectId, nowMs)` implementing §6 (override row →
  default plan). Strips thread suffix using the Phase 1 helper.
- **Touches.** `src/quota/resolve.ts` (new).
- **Tests.** `tests/quota/resolve.test.ts`: 3-tier lookup, `expires_at`
  honoured at `now > expiry`, thread stripping (asserts that
  `group:abc:thread-7` and `group:abc` resolve to the **same** plan).
- **Exit criteria.** Pure function; no side effects; full branch coverage.

### Phase 8 — Counter primitive: fixed_window increment

- **Goal.** Atomic
  `tryIncrementFixedWindow(subjectId, resource, dimension, window, delta,
limit, nowMs, notifyPct)` implementing the `fixed_window` branch of §7.1:
  insert-on-conflict with bucket rollover via
  `ON CONFLICT … DO UPDATE … WHERE quota_counter.window_start <
excluded.window_start` resetting `count`, `balance`, and
  `notified_threshold_pct` to `0`, then a conditional
  `UPDATE … WHERE count + :delta <= :limit RETURNING count`.
- **Touches.** `src/quota/counter-fixed.ts` (new).
- **Tests.** `tests/quota/counter-fixed.test.ts`: increment under limit;
  exceed limit; exact-boundary case; two parallel `Promise.all`
  increments asserting total stays ≤ limit (run with `p-limit(8)`);
  bucket rollover resets `count` **and** `notified_threshold_pct`.
- **Exit criteria.** Race-safe primitive; no callers yet.

### Phase 9 — Counter primitive: fixed_window refund/clamp

- **Goal.**
  `applyDeltaFixedWindow(subjectId, resource, dimension, window, delta,
nowMs)` supporting **negative deltas** with
  `count = MAX(0, count + :delta)` clamp. Used both for `commitQuota`
  reconciliation and for the `attachment.storage_bytes` refund path.
- **Touches.** Extend `src/quota/counter-fixed.ts`.
- **Tests.** Extend `tests/quota/counter-fixed.test.ts`: negative delta
  clamps; multiple refunds within one bucket; idempotent at zero.
- **Exit criteria.** Single SQL clamp proven correct.

### Phase 10 — Counter primitive: rolling_refill reserve + refund

- **Goal.** Atomic
  `tryReserveRolling(subjectId, resource, dimension, window, delta, limit,
nowMs, notifyPct)` implementing §4.4 / §7.1's `rolling_refill` branch:
  insert default row if missing (`balance = limit`, `window_start = nowMs`),
  lazily refill inside the same tx using
  `refilled = floor(elapsed_ms * limit / window_ms)`, advance
  `window_start` by exactly `refilled * window_ms / limit` so fractional
  tokens are preserved, then conditional
  `UPDATE … SET balance = :new_balance - :delta … WHERE :new_balance >=
:delta RETURNING balance`. A negative `delta` (refund) computes
  `new_balance = min(limit, balance + refilled - delta)` and unconditionally
  succeeds (clamped at `limit`).
- **Touches.** `src/quota/counter-rolling.ts` (new).
- **Tests.** `tests/quota/counter-rolling.test.ts`: refill across short
  (<1 token worth of elapsed_ms) and long elapsed_ms; cap at `limit`;
  fractional-token preservation over many small reserves never loses
  tokens to rounding; default row created on first call; race-safety via
  parallel reserves under `p-limit(8)`; refund (negative delta) never
  exceeds `limit`.
- **Exit criteria.** Rolling-refill primitive race-safe; fixed-window
  primitive untouched.

### Phase 11 — `reserveQuota`

- **Goal.** Public engine: resolve plan, fan out the right primitive
  (`tryIncrementFixedWindow` for `algorithm = 'fixed_window'`,
  `tryReserveRolling` for `'rolling_refill'`) over every `(dimension,
window)` triple in the limits matrix for the resource. On first breach,
  roll back all prior increments **within the same tx**.
- **Touches.** `src/quota/reserve.ts` (new), `src/quota/index.ts` (new,
  re-export façade).
- **Tests.** `tests/quota/reserve.test.ts`:
  - allowed path returns `remainingByDimension` for every limited triple
    (`limit - count` for fixed_window, `balance` for rolling_refill);
  - breached path returns `{ breachedDimension, retryAfterMs }` with
    `retryAfterMs` computed correctly for both algorithms (window-end for
    fixed, `ceil((delta - balance) * window_ms / limit)` for rolling) and
    **leaves `quota_counter` unchanged** for the other dimensions;
  - mixed-algorithm plan (one rolling and one fixed row on the same
    resource) works end-to-end;
  - unlimited plan returns `allowed: true` with no rows touched.
- **Exit criteria.** Engine works against the migrated+seeded DB; no
  wiring into orchestrator yet.

### Phase 12 — `commitQuota`

- **Goal.** Public engine: apply signed deltas to reconcile actuals,
  dispatching to the per-algorithm primitives used by `reserveQuota`.
- **Touches.** `src/quota/commit.ts` (new), façade re-export.
- **Tests.** `tests/quota/commit.test.ts`: over-estimate (negative delta
  on `input_tokens`), under-estimate (positive delta on `output_tokens`),
  error refund (negative delta + zero on `requests`), clamp behaviour for
  both algorithms.
- **Exit criteria.** Reconciliation engine complete; still no callers.

### Phase 13 — Audit writer

- **Goal.** `recordAudit(action, actorId, subjectId?, planId?, payload)`
  inserts one row into `plan_audit`. Pure side-effect; no resolver/engine
  dependency.
- **Touches.** `src/quota/audit.ts` (new).
- **Tests.** `tests/quota/audit.test.ts`: each action enum value, JSON
  payload round-trip.
- **Exit criteria.** Append-only audit primitive ready for use by HTTP /
  admin layers.

---

## Track B — Enforcement wiring (turns the engine on)

### Phase 14 — Orchestrator pre-call gate (main role)

- **Goal.** Insert `reserveQuota('llm:main', { requests: 1, input_tokens:
estimateInput(prompt), output_tokens: outputBudget })` immediately before
  the `generateText` call. On denial, return the structured "quota
  exhausted" reply (see §8 of spec) and **do not** call the model.
- **Touches.** `src/llm-orchestrator-support.ts` (pre-call hook),
  `src/llm-orchestrator-types.ts` (new dep typed via DI).
- **Tests.** `tests/llm-orchestrator/quota-gate.test.ts`: stub the quota
  engine; assert the gate is called with the right args; assert
  `generateText` is not invoked on denial; assert the failure reply
  contains plan name and reset time.
- **Exit criteria.** Main-role gate live; small / embed / tool / web /
  attachment still un-gated.

### Phase 15 — Orchestrator commit hook

- **Goal.** In the existing `llm:end` / `llm:error` subscriber (same
  module that calls `recordUsage`), call `commitQuota` with the actual
  deltas. On error, refund tokens but **not** the request count.
- **Touches.** `src/usage/index.ts` (extend `handleEvent`).
- **Tests.** Extend `tests/usage/index.test.ts`: assert commit is called
  with the right signed deltas for success and error events.
- **Exit criteria.** Counters reconcile to actuals; over- / under-estimates
  visible in the resulting `quota_counter` rows.

### Phase 16 — Small-role gate

- **Goal.** Mirror Phase 14 for the small-role LLM path. Same module hook,
  different `resource` arg.
- **Touches.** `src/llm-orchestrator-support.ts`.
- **Tests.** Add small-role coverage in the existing quota-gate test file.
- **Exit criteria.** Small-role calls denied past their plan limit.

### Phase 17 — Tool wrapper gate

- **Goal.** Increment `tool.requests.*` before every tool execution in the
  tool wrapper used by `src/tools/`. On denial, return the structured
  failure result described in §8 of spec (`{ success: false, error: {
code: 'quota_exceeded', ... } }`).
- **Touches.** `src/tools/tool-execution-wrapper.ts` (or the equivalent
  module — locate via `code_symbol` before starting).
- **Tests.** `tests/tools/quota-gate.test.ts`: gate fires; structured
  failure returned; `tool_call_events` still recorded for the attempt.
- **Exit criteria.** Tool calls denied past their plan limit; LLM sees a
  structured error and can apologise.

### Phase 18 — Web-fetch gate

- **Goal.** Have `consumeWebFetchQuota` delegate to the new engine for the
  limit value (read from the active plan via the resolver). The old
  `web_rate_limit` table is **still written** for one release as a safety
  net but is no longer the source of the limit.
- **Touches.** `src/web/rate-limit.ts`, `src/web/fetch-extract.ts` (only
  the injection point if needed).
- **Tests.** Extend `tests/web/rate-limit.test.ts`: plan-driven limit
  beats the hard-coded constant; subject with `unlimited` is never
  throttled; rolling-refill bucket allows bursts up to capacity while
  preserving the long-run average.
- **Exit criteria.** Plan-driven web-fetch limit live; legacy table still
  written for one release window.

### Phase 19 — Proactive LLM gate (basic deny)

- **Goal.** Make `src/deferred-prompts/proactive-llm.ts` pass through the
  same reserve / commit calls as the interactive path **without** any
  fallback behaviour yet — denial simply aborts the dispatch and the next
  scheduler tick retries. This phase exists separately from Phase 20 so
  the gate can be verified in isolation; Phase 20 layers the UX fallback
  chain on top.
- **Touches.** `src/deferred-prompts/proactive-llm.ts`,
  `src/deferred-prompts/proactive-llm-helpers.ts`.
- **Tests.** Extend the proactive-LLM tests: deny path skips dispatch;
  allow path proceeds normally.
- **Exit criteria.** A deferred prompt cannot drain a subject past its
  plan; deferred dispatch is observably no-op'd on denial.

### Phase 20 — Deferred-prompt fallback chain

- **Goal.** Implement the §7.4 fallback chain in the deferred-prompt
  dispatcher so the fire moment is always honoured and quota exhaustion
  never silently drops a prompt. The chain, executed in order at fire
  time:
  1. **Try `llm:main`** for subjects whose `llm:main.*` usage is below
     `notify_pct` on every limited triple.
  2. **Proactive `llm:small` degrade** for subjects who have already
     crossed `notify_pct` on any `llm:main.*` triple — the dispatcher
     skips `llm:main` reservation entirely and reserves on `llm:small`
     instead, saving the user's last 20 % of main-model headroom for
     interactive turns.
  3. **Hard fallback to `llm:small`** if step 1 was attempted and denied
     at the gate.
  4. **Templated non-LLM delivery** as the last resort, only when both
     `llm:main` and `llm:small` are exhausted.

  Defer-and-retry is **not** implemented — the design forbids slipping
  the fire moment around a quota reset. Record two columns per dispatch
  for metrics:
  - `delivery_mode: 'llm_main' | 'llm_small' | 'template'`.
  - `delivery_reason: 'normal' | 'proactive_degrade' | 'main_denied' |
'all_denied'`.

- **Touches.**
  - `src/db/migrations/<M>_deferred_prompt_delivery_mode.ts` (new) —
    adds `delivery_mode text NOT NULL DEFAULT 'llm_main'` and
    `delivery_reason text NOT NULL DEFAULT 'normal'` to the
    `deferred_prompts` table.
  - `src/db/deferred-prompts-schema.ts` — export the new columns.
  - `src/deferred-prompts/proactive-llm.ts` — wire the chain; consult
    the threshold via a new helper (or reuse §7.8's check) before
    deciding whether to take the proactive degrade branch.
  - `src/deferred-prompts/templated-delivery.ts` (new) — three pure
    formatters plus a shared footer constant:
    `formatScheduledOneShot(prompt, executionMetadata, timezone)` for
    `ScheduledPrompt` rows whose `rrule` is `null`;
    `formatScheduledRecurring(prompt, executionMetadata, timezone,
humanRruleSummary)` for `ScheduledPrompt` rows with an `rrule`;
    `formatAlert(prompt, executionMetadata, condition)` for
    `AlertPrompt` rows (the condition clause is built from the stored
    `AlertCondition` tree without any LLM call). All three prefer
    `execution_metadata.delivery_brief` over the raw `prompt` field
    when non-empty.
  - `src/deferred-prompts/threshold-check.ts` (new, or extend an
    existing helper) — `isMainAtOrAboveNotifyPct(subjectId, nowMs)`
    returns true if any limited `llm:main.*` triple is at ≥`notify_pct`
    in its active bucket; pure read from `quota_counter` + `plan_limits`.

- **Tests.**
  - `tests/deferred-prompts/templated-delivery.test.ts` — formatter
    shape for all three template variants; `delivery_brief` overrides
    `prompt` when non-empty; condition clause renders correctly for
    each `FIELD_OPERATORS` combination; shared footer present on every
    variant.
  - `tests/deferred-prompts/threshold-check.test.ts` —
    `isMainAtOrAboveNotifyPct` true on fixed_window crossing, true on
    rolling_refill crossing, false for unlimited plans, false when
    only `llm:small` is over threshold.
  - `tests/deferred-prompts/fallback-chain.test.ts` — exercises every
    branch. **Normal:** subject below threshold + main allowed →
    `delivery_mode = 'llm_main'`, `delivery_reason = 'normal'`.
    **Proactive degrade:** subject ≥`notify_pct` on main + small allowed
    → `delivery_mode = 'llm_small'`, `delivery_reason =
'proactive_degrade'`; assert no `llm:main` reservation was held.
    **Main denied:** subject below threshold but `llm:main` denied at
    the gate (race between threshold check and reservation) →
    `delivery_mode = 'llm_small'`, `delivery_reason = 'main_denied'`.
    **All denied:** both `llm:main` and `llm:small` denied →
    `delivery_mode = 'template'`, `delivery_reason = 'all_denied'`;
    the templated path is delivered regardless of quota. **Per-type
    template coverage:** all three prompt types (`scheduled` one-shot,
    `scheduled` recurring, `alert`) take the templated path correctly
    when quota-exhausted. **No-defer guarantee:** assert the dispatcher
    never reschedules a fire moment — no defer-and-retry timer is set
    on any path.

- **Exit criteria.** Every deferred prompt fires at its scheduled time
  regardless of quota state, with the right model / template chosen per
  the chain above, and the `delivery_mode` + `delivery_reason` columns
  reflect which branch was taken. No code path in the dispatcher
  reschedules a fire moment.

### Phase 21 — Embedding gate

- **Goal.** Insert `reserveQuota('llm:embed', ...)` in
  `src/embeddings.ts`. On denial, callers in `src/memos.ts` already
  degrade to keyword search; this phase only asserts the degradation
  still triggers.
- **Touches.** `src/embeddings.ts`.
- **Tests.** `tests/embeddings/quota-gate.test.ts`: denial returns the
  agreed "skip embeddings" signal; `tests/memos/search.test.ts` extended
  to assert the keyword fallback fires when embeddings are denied.
- **Exit criteria.** Embedding calls gated; memo search degrades
  gracefully.

### Phase 22 — Attachment storage gate

- **Goal.** Insert `reserveQuota('attachment', { storage_bytes: size })`
  before S3 upload completion in the attachment ingest path (§7.7). On
  denial, abort the upload **before** any S3 write so no partial files
  exist; the user-visible error is "you're out of attachment storage on
  plan _{planName}_; delete older files or ask the admin for a higher
  cap". On delete, call
  `commitQuota('attachment', { storage_bytes: -size })`.
- **Touches.** `src/attachments/ingest.ts` (locate via `code_symbol`
  before starting; module name approximate),
  `src/attachments/manifest.ts` (or whichever module drives the delete
  code path), `src/attachments/CLAUDE.md` (note the new invariant).
- **Tests.**
  - `tests/attachments/quota-gate.test.ts` — reserve denies path
    (no S3 write, no `attachment_metadata` row); allow path proceeds
    normally.
  - `tests/attachments/delete-refund.test.ts` — delete decrements the
    counter and clamps at 0 under accounting drift.
- **Exit criteria.** Subject's `attachment.storage_bytes` counter tracks
  the real outstanding footprint; ingest aborts cleanly when out of
  quota.

### Phase 23 — Attachment reconciliation sweep

- **Goal.** Opportunistic background sweep that recomputes
  `quota_counter.count` for `attachment.storage_bytes` per subject from
  `SUM(attachment_metadata.size_bytes)` and `UPSERT`s the canonical
  value, self-healing any accounting drift caused by missed delete
  events or crashes between S3 and metadata writes.
- **Touches.** `src/quota/attachment-reconcile.ts` (new); scheduler entry
  to register it (mirror existing scheduled jobs in `src/index.ts` or
  wherever periodic jobs are wired). Default cadence: every 1 h.
- **Tests.** `tests/quota/attachment-reconcile.test.ts`: introduce a
  positive **and** a negative drift; run the sweep; assert the counter is
  corrected; assert the sweep never produces negative `count`.
- **Exit criteria.** Counter drift visibly self-heals on the next sweep.

### Phase 24 — Threshold notice (80 %)

- **Goal.** Implement §7.8. Counter primitives emit
  `quota:threshold_crossed` on the in-process event bus when post-update
  usage crosses `notify_pct` for the first time in the active bucket;
  subscriber in `src/quota/notice.ts` dispatches a templated non-LLM
  heads-up via the subject's primary chat surface.
  `notified_threshold_pct` is set inside the same tx that detected the
  crossing, so the notice is guaranteed to fire at most once per bucket.
  Reset semantics:
  - `fixed_window` — column resets to `0` together with `count` on bucket
    rollover (already handled by the Phase 8 `ON CONFLICT … DO UPDATE`).
  - `rolling_refill` — column resets to `0` whenever `balance` climbs
    back above the threshold (`limit - notify_pct * limit / 100`).
- **Touches.**
  - `src/quota/counter-fixed.ts` and `src/quota/counter-rolling.ts` —
    emit the event after a successful update if the crossing condition
    is met.
  - `src/quota/notice.ts` (new) — subscriber that resolves the subject's
    primary chat surface (DM for `user:`, group-main-chat for `group:`,
    suppress inside threads per §7.8 and coalesce to the next main-chat
    reply) and posts the formatted message.
  - `src/quota/notice-template.ts` (new) — pure formatter.
  - `src/index.ts` — register the subscriber at startup.
- **Tests.**
  - `tests/quota/notice-template.test.ts` — formatter shape.
  - `tests/quota/threshold-emit.test.ts` — both primitives emit exactly
    once per bucket; rollover re-arms (fixed); recovery above threshold
    re-arms (rolling); `notify_pct = 0` disables emission.
  - `tests/quota/notice-subscriber.test.ts` — routes to DM for user
    subjects; routes to group main chat for group subjects; thread-scoped
    triggers are coalesced to the next main-chat reply (asserts via a
    stub `ChatProvider`).
- **Exit criteria.** A subject crossing 80 % of any limit receives one
  notice on their primary chat surface; no repeats inside the same
  bucket; no notice when the admin sets `notify_pct = 0`.

### Phase 25 — Garbage collector

- **Goal.** Opportunistic GC of old `quota_counter` rows on every 1024th
  write, parameterised by `QUOTA_RETENTION_MS` env var (default
  `2 × MONTH_MS`). Matches the spec's §5.5. Stock-dimension rows
  (`attachment.storage_bytes`) are exempt — their `window_start` never
  rolls.
- **Touches.** `src/quota/counter-fixed.ts` and
  `src/quota/counter-rolling.ts` (add the modulo trigger),
  `src/quota/gc.ts` (new, pure delete query that excludes
  `dimension = 'storage_bytes'`).
- **Tests.** `tests/quota/gc.test.ts`: GC fires at the right cadence;
  deletes only rows older than retention; never deletes stock rows.
- **Exit criteria.** Old buckets disappear; live and stock buckets never
  deleted.

---

## Track C — User-facing surface (chat)

### Phase 26 — `get_my_plan` tool

- **Goal.** New tool, registered in the tool builder, available in DM and
  group (`proactive` allowed). Returns the JSON shape from §9.1,
  including `algorithm` and `notifyPct` per limit row.
- **Touches.** `src/tools/quota/get-my-plan.ts` (new),
  `src/tools/tools-builder.ts` (register), `src/tools/tool-metadata.ts`
  (add metadata row).
- **Tests.** `tests/tools/get-my-plan.test.ts`: shape includes algorithm
  and notifyPct; gating; subject-id derivation (thread-stripped).
- **Exit criteria.** Tool visible to the model and to the dashboard.

### Phase 27 — `get_my_quota` tool

- **Goal.** Companion tool returning the live snapshot, one entry per
  limited triple, with `algorithm`, `used`, `limit`, `remaining`,
  `resetsAt` from Phase 3 math (omitted for stock dimensions), and
  `refillRatePerSecond` for `rolling_refill` entries.
- **Touches.** `src/tools/quota/get-my-quota.ts` (new), tools-builder,
  tool-metadata.
- **Tests.** `tests/tools/get-my-quota.test.ts`: snapshot shape;
  monotonic `remaining` across both algorithms; correct reset for each
  window; `refillRatePerSecond` present only for rolling rows; no
  `resetsAt` for `attachment.storage_bytes`.
- **Exit criteria.** Tool visible and stable across the three window
  types and both algorithms.

### Phase 28 — `/plan` slash command

- **Goal.** Short-circuit handler in `src/bot.ts` and the command
  registry (`src/commands/`). Replies with a single localised line
  summarising the active plan. **Zero LLM cost.**
- **Touches.** `src/commands/plan.ts` (new), `src/commands/index.ts`
  (register), `src/bot.ts` (route).
- **Tests.** `tests/commands/plan.test.ts`: DM, group, group thread
  (asserts the same plan name in main and thread).
- **Exit criteria.** Command works on all three chat providers'
  capability surfaces.

### Phase 29 — `/quota` slash command

- **Goal.** Same shape as Phase 28 but lists every limited triple.
  Render resets as human-friendly strings; for `rolling_refill` rows the
  line reads "≈ X / Y, refills fully in Z" rather than a hard reset
  time. Stock-dimension rows render without a reset clause.
- **Touches.** `src/commands/quota.ts` (new), registry, `src/bot.ts`.
- **Tests.** `tests/commands/quota.test.ts`: 0 / 1 / many limits;
  mixed algorithms; stock-dimension row formatted without a reset time.
- **Exit criteria.** Command renders correctly across plan shapes.

---

## Track D — Admin HTTP API

Each route is its own phase to keep diffs small and reviews honest. All
routes are mounted in `src/debug/server.ts` and gated by `DEBUG_TOKEN`
exactly like `POST /admin/llm` (see `src/debug/billing-routes.ts`).

### Phase 30 — `GET /admin/plans` and `GET /admin/plans/:id`

- **Touches.** `src/debug/plans-routes.ts` (new), `src/debug/server.ts`
  (router).
- **Tests.** `tests/debug/plans-routes.test.ts`: 200 with token, 401
  without, shape matches §9.1 of spec (algorithm + notifyPct present).
- **Exit criteria.** Read API live and tested.

### Phase 31 — `POST /admin/plans`

- **Goal.** Create a new plan with limits in a single transaction.
  Validates every triple via Phase 2's `isValidLimitTriple` **and** every
  `(dimension, algorithm)` pair via `isValidAlgorithmForDimension`;
  defaults `algorithm` and `notify_pct` from
  `QUOTA_DEFAULT_ALGORITHM` / `QUOTA_NOTIFY_THRESHOLD_PCT` if absent.
  Writes a `plan_create` audit row.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Happy path; 400 on invalid triple; 400 on
  `rolling_refill` + `storage_bytes`; 409 on duplicate id; audit row
  written including the algorithm / notify_pct payload.
- **Exit criteria.** Plan creation gated by `DEBUG_TOKEN`; audit
  verifiable.

### Phase 32 — `PUT /admin/plans/:id`

- **Goal.** Update name / description / limits. Limits replace atomically
  (delete + insert in one tx). When a row's `algorithm` switches, the
  matching `quota_counter` row is **dropped** in the same tx (per design
  §4.4 — we never translate one algorithm's state into the other's).
  Writes a `plan_update` audit row.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Partial updates; full limits replacement; algorithm switch
  drops the counter row; audit row.
- **Exit criteria.** Updates atomic; no half-applied limits possible; no
  stale counter survives an algorithm switch.

### Phase 33 — `DELETE /admin/plans/:id`

- **Goal.** Delete a plan. If subjects are pinned to it, require
  `?fallback=<planId>` query param and reassign pinned subjects to the
  fallback in the same transaction. Default plan cannot be deleted.
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** No-subjects case; with-subjects requires fallback (409
  without); default-plan rejected (400); audit row for each affected
  subject.
- **Exit criteria.** Safe deletion; admin always has an escape hatch.

### Phase 34 — `PUT /admin/subjects/:subjectId/plan`

- **Goal.** Assign or override a plan for a subject. Body:
  `{ planId, expiresAt?, note? }`. Reject thread-scoped ids (409, see
  §10.2 of spec). Writes a `subject_assign` audit row.
- **Touches.** `src/debug/billing-routes.ts` (or a new
  `src/debug/subjects-routes.ts` if billing-routes is getting large;
  decide at the start of this phase).
- **Tests.** Happy path; expiry round-trip; thread-id rejection; audit
  row.
- **Exit criteria.** Per-subject overrides usable via API.

### Phase 35 — `DELETE /admin/subjects/:subjectId/plan`

- **Goal.** Remove an override, falling back to the default plan. Writes
  a `subject_unassign` audit row.
- **Touches.** Same module as Phase 34.
- **Tests.** Removes the row; idempotent; audit row.
- **Exit criteria.** Override removal works; default plan applies
  afterwards.

### Phase 36 — `GET /billing/subject/:subjectId/quota`

- **Goal.** Snapshot of live `quota_counter` rows for the subject,
  joined with the active plan's limits to render
  `{ used, limit, remaining, resetsAt, algorithm, notifyPct,
notifiedThresholdPct, refillRatePerSecond? }` per triple. Used by the
  dashboard Subject Detail card.
- **Touches.** `src/debug/billing-routes.ts`, `src/debug/billing.ts`
  (read helper).
- **Tests.** Mixed limited / unlimited triples; empty counters; near-zero
  remaining; mixed-algorithm rows; threshold already notified vs not;
  stock-dimension row has no `resetsAt`.
- **Exit criteria.** Dashboard-ready endpoint live.

### Phase 37 — `GET /admin/plans/audit`

- **Goal.** Paginated read of `plan_audit`. Query params: `subjectId?`,
  `since?`, `limit` (default 100, max 500).
- **Touches.** `src/debug/plans-routes.ts`.
- **Tests.** Pagination boundary; subject filter; since filter.
- **Exit criteria.** Auditable history visible to admin.

---

## Track E — Admin dashboard UI

The dashboard is Svelte 5 with runes. Each phase mirrors the existing
layout under `client/debug/billing/` and uses the same fetcher pattern.

### Phase 38 — Plans fetchers + types

- **Goal.** Type and HTTP-fetch wrappers for every Track D route, plus
  shared types added to `client/debug/dashboard-types.ts` (including
  `Algorithm`, `notifyPct`, and the rolling-refill-specific fields).
- **Touches.** `client/debug/plans/fetchers.ts` (new),
  `client/debug/dashboard-types.ts`.
- **Tests.** `tests/client/plans-fetchers.test.ts` (happy-dom) using
  `setMockFetch`.
- **Exit criteria.** Frontend can talk to every plans / quota endpoint.

### Phase 39 — `PlansPanel.svelte`

- **Goal.** List view: id, name, description, is_default,
  pinned-subject count, created / updated timestamps. "New plan" button
  (modal in next phase).
- **Touches.** `client/debug/plans/PlansPanel.svelte` (new),
  `client/debug/App.svelte` (add tab),
  `client/debug/dashboard.svelte.ts` (state slice).
- **Tests.** `tests/client/PlansPanel.test.ts` against the fetcher mock.
- **Exit criteria.** Tab visible; table renders; refresh works.

### Phase 40 — `PlanEditor.svelte` create flow

- **Goal.** Modal-form to create a plan, including the limits matrix
  (`resource` rows × `dimension × window` columns). Each cell exposes
  `limit_value`, an `algorithm` selector (`fixed_window` /
  `rolling_refill`, defaulting per design §10.1) and an optional
  `notify_pct` override (inherits `QUOTA_NOTIFY_THRESHOLD_PCT` when
  empty). Inline validation against `isValidLimitTriple` **and**
  `isValidAlgorithmForDimension`. Calls `POST /admin/plans`.
- **Touches.** `client/debug/plans/PlanEditor.svelte` (new),
  `client/debug/components/Modal.svelte` (reuse).
- **Tests.** `tests/client/PlanEditor-create.test.ts`: happy path; cell
  validation; algorithm selector hidden / forced to `fixed_window` for
  stock dimensions; submit payload includes algorithm + notify_pct.
- **Exit criteria.** Admin can create a plan end-to-end through the UI.

### Phase 41 — `PlanEditor.svelte` edit + delete flow

- **Goal.** Reuse the same editor for `PUT`; add a delete button with
  the fallback-plan picker required by Phase 33. Surface a warning when
  an algorithm change will drop the active `quota_counter` row for that
  triple.
- **Touches.** Same component.
- **Tests.** `tests/client/PlanEditor-edit-delete.test.ts`: edit happy
  path; algorithm-switch warning; delete with / without fallback.
- **Exit criteria.** Full CRUD reachable from the UI.

### Phase 42 — Subjects table: Plan column

- **Goal.** Extend `client/debug/billing/SubjectsTable.svelte` with a
  **Plan** column rendered as an inline `<select>`. On change call
  `PUT /admin/subjects/:id/plan` optimistically; rollback on error.
- **Touches.** `SubjectsTable.svelte`, `fetchers.ts`.
- **Tests.** Existing component test extended.
- **Exit criteria.** Plan reassignment one click from Billing.

### Phase 43 — Subjects table: Quota column

- **Goal.** Add a compact bar showing the most-constraining live
  dimension (e.g. `73 % llm:main input_tokens day`). Fetched in bulk via
  a new optional `?withQuota=true` query param on `/billing/subjects`.
- **Touches.** `SubjectsTable.svelte`, `src/debug/billing-routes.ts`,
  `src/debug/billing.ts`.
- **Tests.** Client component test + route test for the new flag.
- **Exit criteria.** Quota visible at a glance per subject.

### Phase 44 — Subject Detail: Quota card

- **Goal.** Extend `client/debug/billing/SubjectDetail.svelte` with a
  card showing every triple's meter, the active plan, an **algorithm
  badge** per row, and the current `notified_threshold_pct` state.
  "Override plan…" opens a modal with `planId` + optional `expiresAt`.
- **Touches.** `SubjectDetail.svelte`, new
  `client/debug/billing/SubjectQuotaCard.svelte`,
  `client/debug/billing/OverridePlanModal.svelte`.
- **Tests.** Component tests for each new file; meter renders correctly
  for both algorithms; threshold badge visible after a crossing;
  stock-dimension row formatted without a reset clause.
- **Exit criteria.** Admin sees full per-subject picture in one view.

### Phase 45 — Audit log viewer (optional, can land later)

- **Goal.** Tab under Plans showing the last N audit rows with subject
  filter.
- **Touches.** `client/debug/plans/PlanAuditPanel.svelte` (new).
- **Tests.** Component test against fetcher mock.
- **Exit criteria.** Plan changes auditable from the UI.

---

## Track F — Admin DM commands (no `DEBUG_SERVER` deployments)

### Phase 46 — `/plans` admin command

- **Goal.** Admin DM command listing configured plans (read-only).
- **Touches.** `src/commands/admin.ts`.
- **Tests.** `tests/commands/admin-plans.test.ts`.
- **Exit criteria.** Admin can list plans without a dashboard.

### Phase 47 — `/setplan` admin command

- **Goal.** `/setplan <subject> <planId> [until=<ISO>]`. Resolves
  `<subject>` via the existing identity utilities (`@username` / user id
  / `group:<id>`). Writes a `subject_assign` audit row.
- **Touches.** `src/commands/admin.ts`.
- **Tests.** `tests/commands/admin-setplan.test.ts`: by-username,
  by-id, by-group-id, invalid input, expiry round-trip.
- **Exit criteria.** Admin can re-plan any subject from a Telegram DM.

---

## Track G — Cleanup (only after one release window)

### Phase 48 — Stop writing to `web_rate_limit`

- **Goal.** Once Phase 18 has been live for one release, remove the
  legacy write path. The table still exists.
- **Touches.** `src/web/rate-limit.ts`.
- **Tests.** Existing tests updated; assert no inserts to
  `web_rate_limit`.
- **Exit criteria.** Legacy writes gone; reads (if any) gone.

### Phase 49 — Drop `web_rate_limit` migration

- **Goal.** Drop the table after one further release window.
- **Touches.** `src/db/migrations/<M>_drop_web_rate_limit.ts` (new),
  `src/db/web-schema.ts` (remove export), `src/db/schema.ts`.
- **Tests.** Migration test asserts the table is gone.
- **Exit criteria.** Legacy table removed.

---

## Phase dependency graph (summary)

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

Track A (1–13) is strictly sequential. Track B (14–25) is sequential
within itself but each phase is independently reviewable — note that
Phase 20 (deferred-prompt fallback) layers on Phase 19, Phase 23
(attachment reconcile) layers on Phase 22, and Phase 24 (threshold
notice) depends on the counter primitives being emit-aware (Phases 8 and
10). Tracks C, D, E, F can proceed in parallel after Track B lands, with
the dependency edges shown. Track G waits for production telemetry to
confirm Phase 18 has not regressed web-fetch behaviour.

## Per-phase session checklist

Use this as the checklist for any individual phase. The list is short on
purpose — the project's hooks and skills enforce the rest.

1. Read the spec section the phase implements. If unclear, open a
   question in chat **before** writing code.
2. Load the relevant superpower skills (`using-superpowers`,
   `test-driven-development`, `writing-plans`).
3. Write the failing test(s) listed under **Tests**. Run them, see them
   red.
4. Implement the smallest change that turns them green.
5. Run the baseline verification (`bun lint`, `bun typecheck`,
   `bun test`, `bun format:check`).
6. Run `bun check:full` before declaring done.
7. Commit on the same branch with a message matching the project's
   commit conventions (see `git log --oneline -20`).
8. Tick off the phase in this file's progress table below.

## Progress

> Update this table on merge of each phase.

| #   | Phase                                            | Status |
| --- | ------------------------------------------------ | ------ |
| 1   | Subject id helper                                | todo   |
| 2   | Quota types and constants                        | todo   |
| 3   | Window math                                      | todo   |
| 4   | DB migration: tables only                        | todo   |
| 5   | Seed migration                                   | todo   |
| 6   | Plan repository (read side)                      | todo   |
| 7   | Plan resolver                                    | todo   |
| 8   | Counter primitive: fixed_window increment        | todo   |
| 9   | Counter primitive: fixed_window refund/clamp     | todo   |
| 10  | Counter primitive: rolling_refill reserve+refund | todo   |
| 11  | `reserveQuota`                                   | todo   |
| 12  | `commitQuota`                                    | todo   |
| 13  | Audit writer                                     | todo   |
| 14  | Orchestrator pre-call gate (main role)           | todo   |
| 15  | Orchestrator commit hook                         | todo   |
| 16  | Small-role gate                                  | todo   |
| 17  | Tool wrapper gate                                | todo   |
| 18  | Web-fetch gate                                   | todo   |
| 19  | Proactive LLM gate (basic deny)                  | todo   |
| 20  | Deferred-prompt fallback chain                   | todo   |
| 21  | Embedding gate                                   | todo   |
| 22  | Attachment storage gate                          | todo   |
| 23  | Attachment reconciliation sweep                  | todo   |
| 24  | Threshold notice (80 %)                          | todo   |
| 25  | Garbage collector                                | todo   |
| 26  | `get_my_plan` tool                               | todo   |
| 27  | `get_my_quota` tool                              | todo   |
| 28  | `/plan` slash command                            | todo   |
| 29  | `/quota` slash command                           | todo   |
| 30  | `GET /admin/plans` and `GET /admin/plans/:id`    | todo   |
| 31  | `POST /admin/plans`                              | todo   |
| 32  | `PUT /admin/plans/:id`                           | todo   |
| 33  | `DELETE /admin/plans/:id`                        | todo   |
| 34  | `PUT /admin/subjects/:subjectId/plan`            | todo   |
| 35  | `DELETE /admin/subjects/:subjectId/plan`         | todo   |
| 36  | `GET /billing/subject/:subjectId/quota`          | todo   |
| 37  | `GET /admin/plans/audit`                         | todo   |
| 38  | Plans fetchers + types                           | todo   |
| 39  | `PlansPanel.svelte`                              | todo   |
| 40  | `PlanEditor.svelte` create flow                  | todo   |
| 41  | `PlanEditor.svelte` edit + delete flow           | todo   |
| 42  | Subjects table: Plan column                      | todo   |
| 43  | Subjects table: Quota column                     | todo   |
| 44  | Subject Detail: Quota card                       | todo   |
| 45  | Audit log viewer                                 | todo   |
| 46  | `/plans` admin command                           | todo   |
| 47  | `/setplan` admin command                         | todo   |
| 48  | Stop writing to `web_rate_limit`                 | todo   |
| 49  | Drop `web_rate_limit` migration                  | todo   |
