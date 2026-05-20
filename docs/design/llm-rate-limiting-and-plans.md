<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# LLM Rate Limiting and Plans — High-Level Design Spec

Status: draft
Owner: admin (`ADMIN_USER_ID`)
Last updated: 2026-05-20

## 1. Purpose

Introduce admin-managed **plans** that define multi-dimensional **quotas** for LLM
usage, tool execution, and web fetches. Allow the admin to assign plans to subjects
(users and groups, including thread-scoped group contexts), allow subjects to inspect
their own plan and remaining quota, and enforce limits before each chargeable
operation. Reconcile with actual usage post-hoc using the existing usage event stream.

The design is deliberately additive to today's recording pipeline — `llm_usage_events`
and `tool_call_events` keep being written exactly as they are now. Only a new
enforcement layer and a new admin surface are added.

## 2. Verified context

This spec was grounded in the following code, current as of the date above:

- `src/usage/recorder.ts` + `src/usage/index.ts` — write one row per LLM turn into
  `llm_usage_events`, including `model_role: 'main' | 'small' | 'embedding'`,
  `input_tokens`, `output_tokens`, `tool_call_count`, `chat_user_id`,
  `storage_context_id`, `context_type`.
- `src/usage/query.ts` — `listSubjects(window)`, `summarizeToolCallsBySubject`,
  `getSubjectDetail`.
- `src/web/rate-limit.ts` — `consumeWebFetchQuota(actorId, nowMs)` with atomic
  `UPDATE … WHERE count < LIMIT RETURNING count` against `web_rate_limit`. The actor
  key is `actorUserId ?? storageContextId` (per `src/web/fetch-extract.ts:220`), i.e.
  per-chat-user inside groups when the chat user is known.
- `src/auth.ts#getThreadScopedStorageContextId` — DMs return `userId`; group main
  chats return `groupId`; group threads return `groupId:threadId`. **This is the
  same value used as `storage_context_id` everywhere downstream**, including the
  Billing panel — so a naïve `subject_plan` keyed by `storage_context_id` would
  give each Telegram/Mattermost thread its own plan, which is not the intended
  product behaviour.
- `src/debug/billing.ts`, `src/debug/billing-routes.ts`, `client/debug/billing/*` —
  existing admin Billing panel. All write routes are gated by `DEBUG_TOKEN`.
- `src/debug/stats-routes.ts` + `src/stats/*` — anonymous global/subject stats with
  the strict no-PII contract in `CLAUDE.md`.
- `src/deferred-prompts/proactive-llm.ts` and `proactive-llm-helpers.ts` — proactive
  LLM dispatch runs with a normal `storage_context_id` and the prompt owner's
  `chatUserId`, so it can flow through the same gate.
- `src/embeddings.ts` — embedding calls already record `model_role: 'embedding'` and
  are already a soft-degraded path (memo search falls back to keyword), so they are
  safe to gate.

## 3. Goals and non-goals

### 3.1 Goals (v1)

- Admin can define, edit, delete named **plans**.
- Plans express limits across multiple **dimensions** (requests, input tokens,
  output tokens, tool calls, web fetches, attachment storage bytes) over
  multiple **windows** (day, week, calendar month), using either a fixed-window
  or a rolling-refill (token-bucket) replenishment algorithm chosen per limit.
- Admin can assign a plan to a **subject** (a user, a group, or a thread-scoped
  group context) and override it later, with optional expiry.
- Bot enforces limits **before** an LLM call or tool execution and reconciles with
  actuals afterwards.
- Users can see their plan and their remaining quota via tools (`get_my_plan`,
  `get_my_quota`) and slash commands (`/plan`, `/quota`).
- Subjects receive an in-chat heads-up the first time their usage crosses **80 %**
  of any dimension within the active window, so they can pace themselves before
  hitting the hard cap.
- Deferred prompts (both `scheduled` and `alert` types) always fire on time
  even under quota pressure: the dispatcher proactively degrades to the
  small model once the subject crosses `notify_pct`, falls through to a
  type-specific non-LLM template if every LLM path is exhausted, and never
  defers a fire moment around a quota reset.
- Plan changes are audited.
- All admin write surfaces are `DEBUG_TOKEN`-gated; `/stats/*` is untouched and
  remains anonymous.

### 3.2 Explicit non-goals (v1)

- **Cost-USD dimension and pricing table.** Schema is forward-compatible
  (`dimension = 'cost_usd_micro'`) but no model price table ships in v1.
- **Concurrent-in-flight limit.** Useful, but adds liveness concerns; deferred.
- **Per-chat-user fairness inside a group.** A group plan applies to the whole
  group; one noisy member can spend the group's quota.
- **Horizontal scale.** SQLite atomic `UPDATE … RETURNING` is safe for the single-
  process bot we run today and would need rework for HA.
- **Sliding-window log / approximated sliding window.** v1 ships fixed-window
  and token-bucket (rolling-refill) only — the two algorithms together cover
  the bursty-vs-smooth axis without needing per-request log retention.
- **Sub-day windows.** v1 windows are `day | week | month`. Smaller windows
  (minute / hour) are intentionally dropped: they create noisy edge resets
  for chat-paced workloads and the rolling-refill algorithm covers the
  smoothness use-case far better than a one-minute fixed window did.

## 4. Conceptual model

```text
                        ┌─────────────────┐
                        │      plan       │  free / team / unlimited / custom-N
                        └────────┬────────┘
                                 │ 1:N
                        ┌────────▼────────┐
                        │   plan_limit    │  (resource, dimension, window) → limit
                        └─────────────────┘
                                 ▲
                                 │ resolved per request
┌─────────────────┐   ┌──────────┴──────────┐   ┌────────────────┐
│     subject     │──▶│    plan resolver    │──▶│  quota_counter │
│ (subject_id)    │   │  3-tier fallback    │   │ rolling buckets│
└─────────────────┘   └─────────────────────┘   └────────────────┘
```

### 4.1 Subject identity

A **subject** is the entity whose quota is being spent. Subject id rules are
deliberately decoupled from `storage_context_id` to avoid per-thread plans:

| Chat shape                         | `storage_context_id` example | `subject_id` (this spec)        |
| ---------------------------------- | ---------------------------- | ------------------------------- |
| DM                                 | `user:42`                    | `user:42`                       |
| Group main chat (any platform)     | `group:abc`                  | `group:abc`                     |
| Group thread (Telegram/Mattermost) | `group:abc:thread-7`         | `group:abc` (threadId stripped) |

i.e. `subject_id = stripThreadSuffix(storage_context_id)`. The helper lives next
to `getThreadScopedStorageContextId` in `src/auth.ts` and is the single place
where the mapping is defined.

### 4.2 Resource and dimension axes

`model_role` (`main | small | embedding`) describes which model handled an LLM
turn and **must not** be conflated with non-LLM resources. v1 introduces an
orthogonal `resource` axis:

| `resource`   | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| `llm:main`   | LLM call using the main model role                      |
| `llm:small`  | LLM call using the small model role                     |
| `llm:embed`  | Embedding call (memo search, etc.)                      |
| `tool`       | One tool invocation (any tool name)                     |
| `web_fetch`  | One `web_fetch` tool execution                          |
| `attachment` | Durable file in the attachment workspace (S3-backed)    |

Notes:

- `web_fetch` is intentionally also a `tool` — the gate increments **both**
  counters in a single tx, so a tight `web_fetch` limit and a looser overall
  `tool` limit can coexist.
- `tool` is **not** a model role; we never put `'tool'` into `llm_usage_events.model_role`.
- `attachment` is a **stock** resource (current bytes held) rather than a
  pure flow resource: uploads add to the counter, deletes refund it. See
  §7.7 for the reserve/commit/refund semantics.

`dimension` enumerates the unit being counted:

| `dimension`      | Applies to              | Kind  |
| ---------------- | ----------------------- | ----- |
| `requests`       | every flow resource     | flow  |
| `input_tokens`   | `llm:*`                 | flow  |
| `output_tokens`  | `llm:main`, `llm:small` | flow  |
| `cost_usd_micro` | `llm:*` (future)        | flow  |
| `storage_bytes`  | `attachment`            | stock |

Invalid combinations (e.g. `output_tokens` on `tool`, `storage_bytes` on
`llm:*`, `requests` on `attachment`) are rejected by the plan editor with a
400. "Flow" dimensions count usage that accrues inside a window; "stock"
dimensions count the current outstanding total and are refunded on delete —
the underlying counter machinery is the same, only the lifecycle differs.

### 4.3 Windows

| `window` | Length                  | Reset (fixed_window algorithm)       | Full-refill period (rolling_refill algorithm) |
| -------- | ----------------------- | ------------------------------------ | --------------------------------------------- |
| `day`    | 86 400 s                | floor(now / 86 400 s) × 86 400 s UTC | 86 400 s                                      |
| `week`   | 604 800 s (ISO week)    | UTC Monday 00:00                     | 604 800 s                                     |
| `month`  | **Calendar month, UTC** | UTC first-of-month 00:00             | average month = 2 629 800 s (30.4375 d)       |

Calendar month is documented because users will ask "when does my quota reset".
For `fixed_window`, the window key in `quota_counter.window_start` is the Unix
ms of the start boundary for the bucket. For `rolling_refill`, `window_start`
is reused to mean **last refill timestamp** and the bucket capacity is the
`plan_limits.limit_value`; the refill rate is `limit_value / window_ms`.

`week` resets on Monday 00:00 UTC to match ISO-8601 week boundaries and the
project's existing date-formatting conventions; it is **not** a 7-day rolling
window in `fixed_window` mode (use `rolling_refill` for that shape).

### 4.4 Algorithm: fixed_window vs rolling_refill

Each `plan_limits` row carries an `algorithm` field. The admin picks per
`(resource, dimension, window)` triple how that limit replenishes, so a single
plan can mix bursty and smooth limits — e.g. a generous monthly `input_tokens`
cap on `fixed_window` plus a tighter daily `requests` cap on `rolling_refill`
to keep the bot's pace healthy.

| `algorithm`      | Behaviour                                                                                          | Best for                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `fixed_window`   | Counter accumulates inside the bucket and resets hard at the window boundary. Cheap, predictable.  | Calendar-anchored caps ("X per month"), billing-aligned limits      |
| `rolling_refill` | Token-bucket: capacity = `limit_value`, refill rate = `limit_value / window_ms` accruing linearly. | Smoothing bursty workloads, fair pacing, preventing edge-of-window stampedes |

Why these two and not three: the most-cited industry survey (Stripe, GitHub,
AWS rate-limit RFCs, Cloudflare's "Counting things in a fast-moving world")
splits production rate-limiters into **fixed-window**, **sliding-window
counter**, **sliding-window log**, **leaky bucket**, and **token bucket**.
Sliding-window counter is essentially a fixed-window with mild smoothing;
sliding-window log requires per-request storage we don't want; leaky bucket
and token bucket are duals. We pick **token bucket** because it lets the
admin express both burst capacity and long-run average in a single setting
(`limit_value` and `window`) without a separate refill-rate column.

Refill is **lazy** — there is no background tick. Every `reserveQuota` call
on a `rolling_refill` row first does:

```text
elapsed_ms      = now - last_refill_at
refilled        = floor(elapsed_ms * limit_value / window_ms)
new_balance     = min(limit_value, balance + refilled)
last_refill_at  = last_refill_at + refilled * window_ms / limit_value
```

then deducts the request's delta from `new_balance`. The fractional remainder
of `elapsed_ms` is preserved by advancing `last_refill_at` by exactly the
amount of refill we accounted for, so no partial tokens are lost over time.

Switching a `plan_limits` row between algorithms drops the existing
`quota_counter` row for that triple in the same migration — we never try to
translate one algorithm's state into the other's, which would mostly mislead
users about how much they have left.

## 5. Data model

All new tables follow the project's Drizzle/SQLite + BUSL-1.1 header conventions.

### 5.1 `plans`

```text
plans
  id              text PK              -- 'free', 'team', 'unlimited', 'custom-…'
  name            text NOT NULL
  description     text
  is_default      int  NOT NULL DEFAULT 0   -- 0 | 1
  created_at      int  NOT NULL
  updated_at      int  NOT NULL

CREATE UNIQUE INDEX uniq_plans_default ON plans(is_default) WHERE is_default = 1;
```

Partial unique index enforces at most one default. The default plan is seeded
on first migration as `free` with permissive limits, and `ADMIN_USER_ID`'s
subject is automatically assigned to a separate seeded `unlimited` plan with no
limits configured.

### 5.2 `plan_limits`

```text
plan_limits
  plan_id     text NOT NULL REFERENCES plans(id) ON DELETE CASCADE
  resource    text NOT NULL    -- 'llm:main' | 'llm:small' | 'llm:embed' | 'tool' | 'web_fetch' | 'attachment'
  dimension   text NOT NULL    -- 'requests' | 'input_tokens' | 'output_tokens' | 'cost_usd_micro' | 'storage_bytes'
  window      text NOT NULL    -- 'day' | 'week' | 'month'
  algorithm   text NOT NULL DEFAULT 'fixed_window'  -- 'fixed_window' | 'rolling_refill'
  limit_value int  NOT NULL    -- > 0; row absence = "unlimited for this triple"
  notify_pct  int  NOT NULL DEFAULT 80  -- threshold % for the early-warning notice; 0 disables
  PK(plan_id, resource, dimension, window)
```

Row absence means "unlimited"; we never store `NULL` or sentinel `-1`. A plan
with zero `plan_limits` rows is effectively the `unlimited` plan. The
`algorithm` column is the admin's choice between fixed-window and
rolling-refill replenishment for that triple (§4.4). `notify_pct` lets the
admin tune the early-warning threshold per limit; the seeded plans use the
global default `QUOTA_NOTIFY_THRESHOLD_PCT` (default `80`).

### 5.3 `subject_plan`

```text
subject_plan
  subject_id      text PK          -- 'user:42' or 'group:abc' (NOT thread-scoped)
  plan_id         text NOT NULL REFERENCES plans(id)
  assigned_by     text NOT NULL    -- admin platform_user_id
  assigned_at     int  NOT NULL
  expires_at      int              -- NULL = no expiry; on expiry, resolver falls back to default
  note            text
```

Absence of a row → default plan. `expires_at` is checked by the resolver, not
by a sweeper, so there is no cron dependency for correctness.

### 5.4 `plan_audit`

```text
plan_audit
  id              integer PK AUTOINCREMENT
  occurred_at     int  NOT NULL
  actor_id        text NOT NULL        -- admin platform_user_id
  subject_id      text                  -- null for global plan edits
  action          text NOT NULL        -- 'plan_create' | 'plan_update' | 'plan_delete'
                                       --   | 'plan_limit_set' | 'plan_limit_delete'
                                       --   | 'subject_assign' | 'subject_unassign' | 'subject_expire'
  plan_id         text
  payload_json    text NOT NULL        -- compact JSON snapshot of new values
```

The payload is intentionally not a structured column so the audit log doesn't
turn into a schema migration target. It is read-only from the dashboard.

### 5.5 `quota_counter`

```text
quota_counter
  subject_id            text NOT NULL
  resource              text NOT NULL
  dimension             text NOT NULL
  window                text NOT NULL
  algorithm             text NOT NULL    -- mirrors plan_limits.algorithm at write time
  window_start          int  NOT NULL    -- fixed_window: bucket-start ms; rolling_refill: last refill ms
  count                 int  NOT NULL    -- fixed_window: usage in this bucket; rolling_refill: 0 (unused)
  balance               int  NOT NULL    -- rolling_refill: tokens remaining; fixed_window: 0 (unused)
  notified_threshold_pct int NOT NULL DEFAULT 0  -- highest % at which the user was already warned for this bucket
  PK(subject_id, resource, dimension, window)

CREATE INDEX idx_quota_counter_gc ON quota_counter(window_start);
```

The (subject, resource, dimension, window) tuple is the lookup key — only the
**active** bucket lives in the table, since both algorithms keep just one row
of state per triple (fixed_window resets the row on bucket rollover;
rolling_refill mutates `window_start`/`balance` in place). Historical "you
used X last month" is sourced from `llm_usage_events` and `tool_call_events`,
not from this table.

Old rows are garbage-collected by an opportunistic
`DELETE WHERE window_start < now - retain_ms` on every Nth write (N = 1024,
mirroring the existing `web_rate_limit` cleanup pattern). Retention defaults
to **2 × monthly window** so a `fixed_window` row from last month survives
long enough for the dashboard to render the rollover transition cleanly.

`notified_threshold_pct` is the highest percentage at which we have already
sent an early-warning notice for the **current** bucket. It is reset to `0`
when the bucket resets (fixed_window) or when `balance` recovers above the
threshold (rolling_refill). See §7.8.

For `attachment.storage_bytes` (a stock dimension), `count` holds the current
outstanding byte total and `window`/`window_start` are formal — uploads
`reserveQuota` with positive deltas, deletes call `commitQuota` with negative
deltas, and the row is never reset on a window boundary.

### 5.6 Untouched tables

- `llm_usage_events`, `tool_call_events` — write path unchanged. They remain
  the source of truth for billing detail and post-hoc analysis.
- `web_rate_limit` — kept for backwards compatibility through one release; new
  code paths read the `web_fetch` limit from the active plan via
  `quota_counter` and the existing table is no longer written. A follow-up
  migration drops it after one release window.

## 6. Plan resolution

```text
resolvePlan(subjectId, now) → Plan
```

Three-tier lookup, evaluated top-down:

1. `subject_plan` row for `subjectId` where `expires_at IS NULL OR expires_at > now`.
2. If `subjectId` looks like `group:*`, then no per-member fallback (groups are
   their own subject). If `subjectId` looks like `user:*`, no group fallback —
   DMs are independent of any group the user happens to be in.
3. The `is_default = 1` row in `plans`.

There is no implicit hierarchy between groups and their members; that is
intentional so the model stays predictable. (A future "organization" tier can
be added on top without changing v1.)

`thread-scoped` ids are stripped to `subject_id` **before** lookup, so
`group:abc:thread-7` and `group:abc` always resolve to the same plan.

## 7. Enforcement

Two top-level helpers live in a new module `src/quota/`:

```ts
reserveQuota(subjectId, resource, estimate, now)
  → { allowed: true, planId, remainingByDimension }
  | { allowed: false, planId, retryAfterMs, breachedDimension, limit, used }

commitQuota(subjectId, resource, actual, now)
  → void   // refund-or-top-up to match actuals
```

### 7.1 Algorithm

1. **Resolve plan** for `subjectId` at `now`.
2. For each `dimension × window` that the resource cares about, compute the
   delta from `estimate` (e.g. `requests = 1`, `input_tokens = tokenEstimate`,
   `output_tokens = outputBudgetReserve`).
3. For each `(dimension, window)`:
   - Look up the limit and `algorithm` from `plan_limits`. If absent →
     unlimited; skip.
   - Branch on `algorithm`:
     - **`fixed_window`** — derive `window_start` from `window` and `now`, then
       run, in one tx:
       ```sql
       INSERT INTO quota_counter(..., algorithm, window_start, count, balance)
         VALUES (..., 'fixed_window', :ws, 0, 0)
         ON CONFLICT(subject_id, resource, dimension, window) DO UPDATE
           SET window_start = excluded.window_start,
               count        = 0,
               balance      = 0,
               notified_threshold_pct = 0
           WHERE quota_counter.window_start < excluded.window_start;
       UPDATE quota_counter
         SET count = count + :delta
         WHERE subject_id = :sid AND resource = :res
           AND dimension = :dim AND window = :win
           AND count + :delta <= :limit
         RETURNING count;
       ```
       If the `UPDATE` returns no row, the limit would be breached: roll back
       any dimensions already incremented in this call (the tx handles it) and
       return `{ allowed: false, ... }` with
       `retryAfterMs = window_start + window_ms - now`.
     - **`rolling_refill`** — load the row (creating it with
       `balance = limit` and `window_start = now` if missing), lazily refill
       inside the same tx using the formula in §4.4, then:
       ```sql
       UPDATE quota_counter
         SET balance        = :new_balance - :delta,
             window_start   = :new_last_refill_at,
             notified_threshold_pct = CASE
               WHEN :new_balance - :delta > :limit - (:limit * notify_pct / 100)
                 THEN 0
                 ELSE notified_threshold_pct
             END
         WHERE subject_id = :sid AND resource = :res
           AND dimension = :dim AND window = :win
           AND :new_balance >= :delta
         RETURNING balance;
       ```
       If the `UPDATE` returns no row, the bucket lacks the requested tokens;
       return `{ allowed: false, ... }` with
       `retryAfterMs = ceil((delta - new_balance) * window_ms / limit_value)` —
       the time it will take the bucket to refill enough for the request.
4. On success, return remaining quota for **every** dimension covered, so the
   caller can surface it to the user / the dashboard. For `fixed_window` the
   remaining value is `limit - count`; for `rolling_refill` it is `balance`
   after the deduction.
5. **Threshold check (§7.8)** — after a successful update, if the post-update
   usage crosses `notify_pct` for the first time inside the current bucket,
   emit a `quota:threshold_crossed` event with the subject, resource,
   dimension, window, percent, and reset time.

### 7.2 Reservation vs reconciliation (LLM)

LLM input tokens are estimable (the prompt is known); **output tokens are
not**. The chosen scheme avoids a separate reservation table:

- **Before** `generateText`: call `reserveQuota('llm:<role>', { requests: 1,
input_tokens: estimatedInput, output_tokens: outputBudget })`.
- **On `llm:end`** (subscriber in `src/usage/index.ts`): call `commitQuota`
  with `{ input_tokens: actualInput - estimatedInput, output_tokens: actualOutput - outputBudget }`.
  The delta can be negative — `commitQuota` clamps `count` at `0` per row to
  keep the counter monotonic.
- **On `llm:error`**: call `commitQuota` with the **negative** estimate to
  refund the reservation. `requests` is **not** refunded — a request was made.

`outputBudget` defaults to the model's `maxOutputTokens` parameter (already
present in the orchestrator config) so that a worst-case completion can still
fit inside the user's quota.

### 7.3 Tools and web fetch

- For every tool execution, the wrapper in `src/tools/` (the same wrapper that
  emits `tool:execute_*`) calls `reserveQuota('tool', { requests: 1 })`.
- `web_fetch` additionally calls `reserveQuota('web_fetch', { requests: 1 })`.
  Both increments happen in one tx; if either breaches, neither is recorded.
- Failures still count (the network was used) — matches today's
  `consumeWebFetchQuota` semantics. Documented as: **the gate counts attempts,
  not successes**.

### 7.4 Proactive LLM and deferred-prompt fallback

`src/deferred-prompts/proactive-llm.ts` already provides
`storage_context_id` and `chatUserId`. The same `reserveQuota` /
`commitQuota` calls are inserted in its dispatch path, so a noisy deferred
prompt cannot bypass the subject's plan.

The product principle for deferred prompts is different from a normal LLM
turn, however. Two non-negotiables shape the design:

- **Fire time is sacred.** A deferred prompt MUST be delivered at its
  scheduled fire moment. The dispatcher never slips a prompt around a
  quota reset — slipping is a slippery slope: a "leave for the airport
  now" trigger that arrives 15 min after the gate closes is worse than
  useless, and once delivery has been delayed there is no principled
  point to stop deferring (the next bucket may also be empty). Always
  fire on time; degrade the content if you must.
- **Silent loss is forbidden.** If every LLM path is over quota, the
  dispatcher still posts a templated, non-LLM message so the user can
  see *that* the trigger fired, even if not *how* it would normally
  read.

The two prompt families flow through the same chain but pick a
type-specific template at the bottom (see `src/deferred-prompts/types.ts`
— `ScheduledPrompt` covers one-shot `fire_at` and recurring `rrule`
triggers, `AlertPrompt` covers condition-triggered notifications).

**Fallback chain at fire time (executed in order, top to bottom):**

1. **Try `llm:main`.** Default path for subjects below the early-warning
   threshold: reserve and dispatch with the main model, same code path
   as an interactive turn.
2. **Proactive small-model degrade once the subject has crossed
   `notify_pct` (the same threshold §7.8 uses for the early-warning
   notice; default 80 %) on any limited `llm:main.*` triple.** When the
   subject is in that band, the dispatcher rolls back the step-1
   reservation (if it was speculatively taken) and reissues against
   `llm:small`. A deferred prompt is not the right thing to spend the
   user's last 20 % of `llm:main` headroom on — interactive turns are.
   This is a *preemptive* degradation, not a recovery path: it kicks in
   while `llm:main` would still answer.
3. **Hard fallback to `llm:small` on `llm:main` denial.** If step 1 was
   skipped (because step 2 fired preemptively) and `llm:small` is also
   over quota, **or** if step 1 was attempted but `llm:main` was denied
   at the gate, retry the reservation with `llm:small`. Same code path
   as step 2's small-model call, different `delivery_reason` for
   metrics.
4. **Templated delivery (last resort).** Only when both `llm:main` and
   `llm:small` are out of quota (or otherwise unavailable). The
   dispatcher composes a non-LLM message from the stored prompt row
   using the type-specific formatter below. This path costs **zero LLM
   tokens**, is gated by no quota, and cannot itself be rate-limited —
   the alternative is silent loss.

Defer-and-retry is intentionally **not** part of this chain. Slipping
the fire time around a quota reset trades a small content downgrade for
a large UX failure, and there is no good place to stop deferring once
you start. Keep the fire time; degrade the content.

**Per-type templates (last resort, step 4):**

Templates live in `src/deferred-prompts/templated-delivery.ts` next to
each other so wording stays consistent across types. All three render
purely from columns already on the deferred-prompts row plus the
subject's resolved timezone — no LLM call, no tool call.

- **`scheduled` — one-shot (`fire_at`).** "Scheduled prompt fires now:
  *{deliveryBriefOrPrompt}*". When
  `execution_metadata.delivery_brief` is non-empty, prefer it over the
  raw `prompt` field because the creator already framed it for the
  user.
- **`scheduled` — recurring (`rrule`).** "Recurring prompt
  ({humanRruleSummary}) fires now: *{deliveryBriefOrPrompt}*". The
  recurrence summary is produced locally from the stored `rrule` string
  by the same helper used in `list_recurring_tasks` output.
- **`alert` — condition triggered.** "Alert condition met
  ({humanConditionSummary}): *{deliveryBriefOrPrompt}*". The condition
  is rendered as a short human-readable clause (e.g. "task *T-42*
  status changed to *Done*") built directly from the stored
  `AlertCondition` tree.

All three templates end with the same short footer noting that the LLM
is over quota right now and that interactive replies are still accepted
as soon as the bucket refills. The footer string is a single constant
in the same module.

**Metrics.** Two columns are recorded on the deferred-prompts row per
dispatch:

- `delivery_mode: 'llm_main' | 'llm_small' | 'template'` — which
  renderer produced the message that left the bot.
- `delivery_reason: 'normal' | 'proactive_degrade' | 'main_denied' |
  'all_denied'` — which branch of the chain triggered.

Together they let the admin tune `notify_pct` and seeded plan limits if
proactive degrades or template fallbacks start dominating.

`commitQuota` is **not** called for the templated path — no LLM call
was made, no tokens were spent. The `requests` counter for `llm:main`
is also not consumed when step 2 fires preemptively (no `llm:main`
reservation is held in that case), so the user keeps the same headroom
for their next interactive message.

### 7.5 Embeddings

Memo embedding calls record `model_role: 'embedding'`. They go through
`reserveQuota('llm:embed', { requests: 1, input_tokens: est })`. If denied,
`src/memos.ts` already degrades to `keywordSearchMemos`, so the user-visible
effect is a slightly worse memo search rather than a hard failure.

### 7.6 Pre-message short-circuit

`/plan` and `/quota` are handled by the command interception layer in
`src/bot.ts` before the orchestrator runs, so they cost **no quota** to invoke.

### 7.7 Attachment storage (stock dimension)

Attachments are different from every other gated resource: usage doesn't
"happen at a moment in time", it **persists** until the file is removed
from the workspace. The `attachment.storage_bytes` limit therefore models
the subject's current outstanding bytes, not a per-window flow.

Lifecycle in `src/attachments/`:

- **On ingest** (`ingestAttachment` / S3 upload completion):
  `reserveQuota('attachment', { storage_bytes: size })`. If denied, the
  upload is aborted before any S3 write — the file is not silently
  half-stored. The user-visible error is "you're out of attachment
  storage on plan _{planName}_; delete older files or ask the admin for
  a higher cap".
- **On delete** (manifest purge, tool-driven removal, or admin override):
  `commitQuota('attachment', { storage_bytes: -size })`. `commitQuota`
  clamps `count` at `0` so an accounting drift can never make the
  counter go negative.
- **On reconciliation** (manifest GC sweep): an opportunistic background
  task in `src/attachments/` recomputes the true sum of
  `attachment_metadata.size_bytes` per subject and `UPSERT`s the
  `quota_counter.count` so the gate self-heals after any drift.

Stock dimensions ignore `algorithm` (there is no "refill") and ignore
`window` (`window` is recorded as `'month'` purely so the row shape stays
uniform; the bucket never resets). The plan editor enforces these
constraints — `storage_bytes` on anything but `attachment`, or `requests`
on `attachment`, is rejected.

### 7.8 Early-warning threshold notice (80 %)

A hard cap that the user only learns about at the moment they hit it is a
bad experience. Every plan limit therefore carries a `notify_pct`
threshold (default `80 %`, configurable per row); when usage crosses it
inside the current bucket we send the subject a one-time heads-up.

**Trigger.** After a successful `reserveQuota` update, compute
`pct = round(100 * used / limit)` (for `rolling_refill`,
`used = limit - balance`). If `pct >= notify_pct` and
`pct > quota_counter.notified_threshold_pct`, set
`notified_threshold_pct = notify_pct` in the same row and publish a
`quota:threshold_crossed` event on the in-process event bus.

**Delivery.** A new subscriber in `src/quota/notice.ts` consumes the
event and dispatches a templated, non-LLM message to the subject via
the active `ChatProvider`:

> Heads up: you've used **{pct} %** of your **{planName}** plan's
> `{resource}.{dimension}` for this {window}
> ({used} / {limit}). Your quota resets {resetHuman}.

The notice is sent to the **subject's primary chat surface**:

- For a `user:` subject — DM to the chat user.
- For a `group:` subject — the group's main chat (not a thread), so the
  warning is visible to everyone who can spend the quota. If the
  subject is a group and the platform does not support out-of-band
  delivery (e.g. silent posts), we suppress the notice when the
  triggering message arrives inside a thread and instead piggyback on
  the next group-main-chat reply.

**De-duplication.** The `notified_threshold_pct` column ensures we
never re-notify for the same `notify_pct` inside the same bucket:

- `fixed_window` — column is reset to `0` together with `count` when the
  bucket rolls over (see the `ON CONFLICT … DO UPDATE` clause in §7.1).
- `rolling_refill` — column is reset to `0` once `balance` recovers
  above the threshold (`limit - notify_pct * limit / 100`), so a user
  whose bucket refills past 80 % free will be warned again the next
  time they cross down through the 80 %-used mark. This avoids a single
  noisy day permanently silencing the warning.

**Why one threshold, not many.** A v1 single-threshold model
(`notify_pct`) is enough to prove the design. The schema (`int` column,
not a bitmask of multiple thresholds) deliberately keeps the door open
for multi-threshold (`50 / 80 / 95`) in v2 without a migration — we just
store the highest already-notified percentage.

**Why not also email / push.** The bot only knows the subject through
the chat platform. Surfacing this notice through the same chat surface
that the user is already talking to keeps the design boundary clean and
avoids a notification-channel registry in v1.

## 8. Failure surface

When `reserveQuota` returns `allowed: false`:

- **LLM gate** (in the orchestrator): the orchestrator returns a structured
  reply containing plan name, breached dimension, current usage, limit, and
  reset time. The user-visible string is templated by the existing reply
  builder so it inherits locale formatting.
- **Tool gate** (in the tool wrapper): the wrapper returns a structured
  failure result matching the conventions in `src/tools/CLAUDE.md`
  (`{ success: false, error: { code: 'quota_exceeded', ... } }`). The LLM can
  then decide to apologise gracefully or retry without that tool.
- **HTTP surfaces** (debug server admin routes): respond `429` with
  `Retry-After` and `X-RateLimit-Remaining-<dimension>` headers, mirroring
  industry convention. (User-facing chat never sees HTTP codes.)

No `429` is ever emitted from `/stats/*` — that surface does not call any
quota-aware path.

## 9. User-facing surface (in chat)

### 9.1 Tools

- `get_my_plan` (DM and group; `proactive` mode allowed) →
  ```json
  {
    "planId": "team",
    "planName": "Team",
    "description": "Shared team plan",
    "limits": [
      { "resource": "llm:main", "dimension": "input_tokens", "window": "day", "algorithm": "rolling_refill", "limit": 200000, "notifyPct": 80 },
      { "resource": "llm:main", "dimension": "output_tokens", "window": "day", "algorithm": "rolling_refill", "limit": 80000, "notifyPct": 80 },
      { "resource": "tool", "dimension": "requests", "window": "day", "algorithm": "fixed_window", "limit": 1000, "notifyPct": 80 },
      { "resource": "attachment", "dimension": "storage_bytes", "window": "month", "algorithm": "fixed_window", "limit": 524288000, "notifyPct": 80 }
    ]
  }
  ```
- `get_my_quota` (same gating) → for every `(resource, dimension, window)` that
  the plan limits:
  ```json
  {
    "resource": "llm:main",
    "dimension": "input_tokens",
    "window": "day",
    "algorithm": "rolling_refill",
    "used": 147382,
    "limit": 200000,
    "remaining": 52618,
    "resetsAt": 1763356800000,
    "refillRatePerSecond": 2.31
  }
  ```

  `resetsAt` is the next full-bucket boundary for `fixed_window`, or the
  projected refill-to-full time for `rolling_refill`. `refillRatePerSecond`
  is only emitted for `rolling_refill`. For `attachment.storage_bytes`,
  `resetsAt` is omitted (stock dimension).

Both tools live in `src/tools/quota/`. They follow the existing capability
gating in `src/tools/CLAUDE.md` (they are always available; no provider
capability is required).

### 9.2 Slash commands

- `/plan` — short human summary of the active plan (resolved via §6).
- `/quota` — one-line-per-limit breakdown with reset times.

Both short-circuit the orchestrator (no LLM tokens spent).

## 10. Admin surface

### 10.1 Dashboard

Two new sub-panels under the existing `client/debug/` dashboard, beside
`billing/` and `stats/`:

```text
client/debug/plans/
  PlansPanel.svelte          # list + create
  PlanEditor.svelte          # name, description, limits matrix
  fetchers.ts                # /admin/plans CRUD calls
client/debug/billing/SubjectsTable.svelte    # extended
client/debug/billing/SubjectDetail.svelte    # extended
```

Extensions to **Billing → Subjects** table:

- New column **Plan** with inline `<select>` to reassign (optimistic UI, retry
  on conflict).
- New column **Quota** showing the **most-constraining** active dimension
  (e.g. `73 % llm:main input_tokens day`). Computed client-side from the
  detail payload.
- Row-click `SubjectDetail.svelte` adds a **Quota** card: per
  `(resource, dimension, window)` meter, plus the active plan and an "Override
  plan…" action that pops a modal with an optional `expires_at`.

New **Plans** panel:

- Table of plans with `id`, `name`, `description`, `is_default`, count of
  pinned subjects, `created_at`, `updated_at`.
- "New plan" opens `PlanEditor.svelte` with a limits matrix (`resource` rows ×
  `dimension × window` columns). Each cell exposes a `limit_value`, an
  `algorithm` selector (`fixed_window` / `rolling_refill`, defaulting to
  `fixed_window` for stock dimensions and the per-deployment default for
  flow dimensions), and an optional `notify_pct` override (default
  inherited from `QUOTA_NOTIFY_THRESHOLD_PCT`). Inline validation rejects
  the invalid combinations from §4.2.
- "Delete plan" requires choosing a **fallback plan** if any subjects are
  pinned; the server performs the reassignment in the same transaction.

### 10.2 HTTP API

All routes mounted in `src/debug/server.ts`, gated by `DEBUG_TOKEN` exactly
like `POST /admin/llm`. Read routes also require `DEBUG_TOKEN` so the
dashboard's existing single-token model is preserved.

```text
GET    /admin/plans
POST   /admin/plans                       { id, name, description, limits[] }
GET    /admin/plans/:id
PUT    /admin/plans/:id                   { name?, description?, limits? }
DELETE /admin/plans/:id?fallback=<planId> # required if any subject is pinned
PUT    /admin/subjects/:subjectId/plan    { planId, expiresAt?, note? }
DELETE /admin/subjects/:subjectId/plan    # revert to default plan
GET    /admin/plans/audit?subjectId=&since=&limit=

GET    /billing/subject/:subjectId/quota  # live quota_counter snapshot
```

`PUT /admin/subjects/:subjectId/plan` returns `409` if the subject id is
thread-scoped — the resolver strips threads, so the API rejects the bad shape
explicitly rather than silently rewriting the input.

### 10.3 Admin command (no DEBUG_SERVER)

For deployments running with `DEBUG_SERVER=false`, the admin can still manage
plans via DM. Two commands are added to `src/commands/admin.ts`:

- `/setplan <subject> <planId> [until=<ISO date>]`
- `/plans` — list configured plans

Both are gated on `isPlatformAdmin` (existing predicate in `src/auth.ts`).

## 11. Stats and anonymity

`/stats/*` is **not** extended with plan or quota information. Plan names are
admin-free-form and per-subject usage is PII-adjacent; both belong on the
billing surface, which is `DEBUG_TOKEN`-gated. The anonymity contract in
`CLAUDE.md` is preserved verbatim.

## 12. Configuration and migration

### 12.1 Seed

Migration N (next number after the latest in `src/db/migrations/`) creates the
five new tables and seeds three plans:

| Plan id     | Default? | Limits                                                                                                                                                                       |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `free`      | yes      | conservative `llm:main` daily limit (`rolling_refill`), monthly `input_tokens` cap (`fixed_window`), `tool.requests.day` (`fixed_window`), `attachment.storage_bytes.month` (`fixed_window`, stock), `web_fetch.requests.day` seeded so the previous per-minute behaviour is the long-run average |
| `team`      | no       | higher daily and monthly caps on `llm:main`/`llm:small`, generous attachment storage, `tool.requests.week` (`rolling_refill`)                                                |
| `unlimited` | no       | no `plan_limits` rows                                                                                                                                                        |

The `ADMIN_USER_ID` subject is bound to `unlimited` in the same migration.

### 12.2 Environment variables

No new required env vars. Optional:

- `QUOTA_RETENTION_MS` — override for the GC retention (default
  `2 × MONTH_MS`).
- `QUOTA_OUTPUT_BUDGET_FALLBACK` — used when the orchestrator config did not
  pin a `maxOutputTokens` (defaults to `2048`).
- `QUOTA_DEFAULT_ALGORITHM` — `fixed_window` (default) or `rolling_refill`,
  applied to limit rows whose `algorithm` was not set explicitly at create
  time. Stock dimensions (`storage_bytes`) ignore this and always behave as
  `fixed_window`-with-no-reset.
- `QUOTA_NOTIFY_THRESHOLD_PCT` — global default for `plan_limits.notify_pct`
  on newly created rows (default `80`; set to `0` to disable the early
  warning by default). The deferred-prompts dispatcher reads the same
  threshold to decide when to proactively degrade to `llm:small` (§7.4
  step 2).

### 12.3 Backwards compatibility

- Existing `web_rate_limit` table is read-only after this change ships and is
  dropped in a follow-up migration after one release window. `web_fetch` keeps
  the same effective ceiling because the `free` plan's
  `web_fetch.requests.day` is seeded on `rolling_refill` with a capacity that
  matches the previous `20 / minute` long-run average; bursts up to the
  capacity are still allowed, which is strictly more permissive than today.
- `llm_usage_events.forwarded_*` outbox columns are unaffected — the future
  metering forwarder reads them; the new code path does not touch them.
- The existing `minute` / `hour` literals never appeared on disk (they were
  only consumed by the old `consumeWebFetchQuota` constants), so dropping
  them from the `window` enum is a code-only change with no migration cost.

## 13. Testing strategy

Following `tests/CLAUDE.md` and the project's TDD hooks:

- **Unit** — `src/quota/__tests__/`:
  - `resolvePlan` 3-tier lookup, including thread suffix stripping and
    `expires_at` behaviour.
  - `reserveQuota` atomicity (concurrent calls; assert at most `LIMIT`
    succeed) under both `fixed_window` and `rolling_refill` algorithms.
  - `commitQuota` reconciliation (over- and under-estimate, error refund,
    clamp at 0).
  - Window boundary math: `day` UTC midnight, `week` UTC Monday 00:00,
    `month` UTC calendar.
  - `rolling_refill` lazy-refill formula: refill across short and long
    `elapsed_ms`, fractional-token preservation via `last_refill_at`
    advancement, cap at `limit_value`.
  - Algorithm switch on a `plan_limits` row drops the matching
    `quota_counter` row in the same tx.
  - Threshold notification: `notified_threshold_pct` advances exactly once
    per bucket for `fixed_window`; resets when `balance` climbs back above
    the threshold for `rolling_refill`.
  - Stock dimension: `attachment.storage_bytes` upload + delete round-trip
    leaves `count` unchanged; clamp at 0 on accounting drift; reconciliation
    sweep recomputes from `attachment_metadata`.
- **Integration** — `tests/quota/`:
  - Orchestrator pre-call gate fires before `generateText` and shapes the
    user-visible reply.
  - Tool wrapper emits `quota_exceeded` structured failure.
  - Proactive LLM honours the same gate.
  - Deferred-prompt fallback chain: subject below threshold → `llm:main`;
    subject at ≥`notify_pct` → preemptive `llm:small` (`delivery_reason
    = 'proactive_degrade'`); `llm:main` denied at the gate → `llm:small`
    retry (`delivery_reason = 'main_denied'`); both denied → templated
    delivery (`delivery_reason = 'all_denied'`). Assert the fire time
    is honoured in every case (no defer-and-retry path exists), the
    templated branch is never blocked by quota, per-type templates
    (`scheduled` one-shot, `scheduled` recurring, `alert`) render
    correctly, and `delivery_mode` + `delivery_reason` are recorded.
  - Embedding denial degrades memo search to keyword (assert existing
    behaviour still holds).
  - Attachment ingest abort: `reserveQuota` denial prevents S3 write.
  - Threshold-crossing notice: first message after crossing 80 % posts a
    single notice to the subject's primary chat surface and does not
    repeat within the same bucket.
- **HTTP** — `tests/debug/`:
  - All admin routes require `DEBUG_TOKEN`.
  - `DELETE /admin/plans/:id` with pinned subjects requires `fallback`.
  - `PUT /admin/subjects/:subjectId/plan` rejects thread-scoped ids.
  - `POST /admin/plans` rejects invalid `(resource, dimension, window)`
    combinations and rejects `algorithm = 'rolling_refill'` on stock
    dimensions.
- **E2E** — none required for v1 (no chat-platform-specific behaviour).

## 14. Phased rollout

| Phase | Deliverable                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Tables + `resolvePlan` + `reserveQuota` / `commitQuota` for both `fixed_window` and `rolling_refill` algorithms; wired into orchestrator and tool wrapper. Seed `free`/`team`/`unlimited`. No UI yet.                                                        |
| 2     | `get_my_plan` / `get_my_quota` tools, `/plan` / `/quota` slash commands. 80 % early-warning notice via `quota:threshold_crossed` subscriber.                                                                                                                 |
| 3     | Deferred-prompts fallback chain (proactive small-model degrade at `notify_pct`, hard small-model fallback on `llm:main` denial, per-type templated delivery as last resort; no defer-and-retry) and `attachment.storage_bytes` gate with reconciliation sweep. |
| 4     | Admin dashboard: Plans panel (with algorithm + `notify_pct` editors), extended Subjects table, per-subject Quota card. `/setplan` admin command.                                                                                                             |
| 5     | `cost_usd_micro` dimension + model price table + cost meters in the dashboard.                                                                                                                                                                               |
| 6     | Drop legacy `web_rate_limit` table once phase 1 has been live for one release.                                                                                                                                                                               |

## 15. Open questions

- **Per-chat-user fairness inside groups** — currently out of scope. If we
  see one member starving a group, the cleanest fix is a secondary counter
  keyed by `(subject_id, chat_user_id, resource)` reusing the same gate.
  Combined with the deferred-prompts fallback (§7.4), this would also let
  us preserve "your personal deferred prompts still fire" even when the
  group's shared LLM quota is exhausted by another member.
- **Cost dimension scoping** — for cost, should we expose **billed** cost
  (provider-side, may not be available until later) or **list-price** cost
  (computed from a local model price table)? Recommendation: list-price first
  because it can land without changing the LLM call path.
- **Default algorithm per dimension** — `QUOTA_DEFAULT_ALGORITHM` is a
  single global. Should the default be expressed as a small per-dimension
  table (e.g. `requests → rolling_refill`, `input_tokens → fixed_window`)
  to better match each dimension's typical workload shape?
- **Multi-threshold early warnings (50 / 80 / 95)** — the schema supports
  it; the question is whether more pings ahead of the cap improve UX or
  become noise. Defer until we have real usage from v1.
- **Notice surface for thread-scoped groups** — when the 80 % notice
  fires inside a Telegram/Mattermost thread, should we post to the
  group's main chat (visible to all members who share the cap) or in the
  thread that triggered it (closer to the actor but invisible to other
  consumers)? Currently §7.8 picks main-chat for visibility; revisit if
  groups complain about cross-thread noise.
