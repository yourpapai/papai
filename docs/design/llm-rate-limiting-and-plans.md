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
  output tokens, tool calls, web fetches) over multiple **windows** (minute, hour,
  day, calendar month).
- Admin can assign a plan to a **subject** (a user, a group, or a thread-scoped
  group context) and override it later, with optional expiry.
- Bot enforces limits **before** an LLM call or tool execution and reconciles with
  actuals afterwards.
- Users can see their plan and their remaining quota via tools (`get_my_plan`,
  `get_my_quota`) and slash commands (`/plan`, `/quota`).
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
- **Token-bucket smoothing.** v1 uses fixed windows, same idiom as
  `consumeWebFetchQuota`. Token bucket is a future refinement for TPM only.

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

| `resource`  | Meaning                             |
| ----------- | ----------------------------------- |
| `llm:main`  | LLM call using the main model role  |
| `llm:small` | LLM call using the small model role |
| `llm:embed` | Embedding call (memo search, etc.)  |
| `tool`      | One tool invocation (any tool name) |
| `web_fetch` | One `web_fetch` tool execution      |

Notes:

- `web_fetch` is intentionally also a `tool` — the gate increments **both**
  counters in a single tx, so a tight `web_fetch` limit and a looser overall
  `tool` limit can coexist.
- `tool` is **not** a model role; we never put `'tool'` into `llm_usage_events.model_role`.

`dimension` enumerates the unit being counted:

| `dimension`      | Applies to              |
| ---------------- | ----------------------- |
| `requests`       | every resource          |
| `input_tokens`   | `llm:*`                 |
| `output_tokens`  | `llm:main`, `llm:small` |
| `cost_usd_micro` | `llm:*` (future)        |

Invalid combinations (e.g. `output_tokens` on `tool`) are rejected by the plan
editor with a 400.

### 4.3 Windows

| `window` | Length                       | Reset                                |
| -------- | ---------------------------- | ------------------------------------ |
| `minute` | 60 s rolling fixed window    | floor(now / 60 s) × 60 s             |
| `hour`   | 3600 s rolling fixed window  | floor(now / 3600 s) × 3600 s         |
| `day`    | 86400 s rolling fixed window | floor(now / 86400 s) × 86400 s (UTC) |
| `month`  | **Calendar month, UTC**      | UTC first-of-month 00:00             |

Calendar month is documented because users will ask "when does my quota reset".
The window key in `quota_counter.window_start` is the Unix ms of the start
boundary for that bucket.

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
  resource    text NOT NULL    -- 'llm:main' | 'llm:small' | 'llm:embed' | 'tool' | 'web_fetch'
  dimension   text NOT NULL    -- 'requests' | 'input_tokens' | 'output_tokens' | 'cost_usd_micro'
  window      text NOT NULL    -- 'minute' | 'hour' | 'day' | 'month'
  limit_value int  NOT NULL    -- > 0; row absence = "unlimited for this triple"
  PK(plan_id, resource, dimension, window)
```

Row absence means "unlimited"; we never store `NULL` or sentinel `-1`. A plan
with zero `plan_limits` rows is effectively the `unlimited` plan.

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
  subject_id      text NOT NULL
  resource        text NOT NULL
  dimension       text NOT NULL
  window          text NOT NULL
  window_start    int  NOT NULL    -- ms epoch of bucket start
  count           int  NOT NULL    -- monotonically increasing within bucket
  PK(subject_id, resource, dimension, window, window_start)

CREATE INDEX idx_quota_counter_gc ON quota_counter(window_start);
```

The (subject, resource, dimension, window) tuple is the lookup key; the
`window_start` row is the active bucket. Old rows are garbage-collected by an
opportunistic `DELETE WHERE window_start < now - retain_ms` on every Nth write
(N = 1024, mirroring the existing `web_rate_limit` cleanup pattern). Retention
defaults to **2 × monthly window** so subjects can still see "you used X last
month" briefly after rollover.

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
   - Look up the limit from `plan_limits`. If absent → unlimited; skip.
   - Run, in one tx:
     ```sql
     INSERT INTO quota_counter(...) VALUES (..., 0)
       ON CONFLICT DO NOTHING;
     UPDATE quota_counter
       SET count = count + :delta
       WHERE subject_id = :sid AND resource = :res
         AND dimension = :dim AND window = :win
         AND window_start = :ws
         AND count + :delta <= :limit
       RETURNING count;
     ```
   - If the `UPDATE` returns no row, the limit would be breached: roll back any
     dimensions already incremented in this call (the tx handles it) and return
     `{ allowed: false, ... }` with `retryAfterMs = window_start + window_ms - now`.
4. On success, return remaining quota for **every** dimension covered, so the
   caller can surface it to the user / the dashboard.

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

### 7.4 Proactive LLM

`src/deferred-prompts/proactive-llm.ts` already provides
`storage_context_id` and `chatUserId`. The same `reserveQuota` /
`commitQuota` calls are inserted in its dispatch path, so a noisy deferred
prompt cannot bypass the subject's plan.

### 7.5 Embeddings

Memo embedding calls record `model_role: 'embedding'`. They go through
`reserveQuota('llm:embed', { requests: 1, input_tokens: est })`. If denied,
`src/memos.ts` already degrades to `keywordSearchMemos`, so the user-visible
effect is a slightly worse memo search rather than a hard failure.

### 7.6 Pre-message short-circuit

`/plan` and `/quota` are handled by the command interception layer in
`src/bot.ts` before the orchestrator runs, so they cost **no quota** to invoke.

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
      { "resource": "llm:main", "dimension": "input_tokens", "window": "day", "limit": 200000 },
      { "resource": "llm:main", "dimension": "output_tokens", "window": "day", "limit": 80000 },
      { "resource": "tool", "dimension": "requests", "window": "day", "limit": 1000 }
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
    "used": 147382,
    "limit": 200000,
    "remaining": 52618,
    "resetsAt": 1763356800000
  }
  ```

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
  `dimension × window` columns), inline validation against the invalid
  combinations table in §4.2.
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

| Plan id     | Default? | Limits                                          |
| ----------- | -------- | ----------------------------------------------- |
| `free`      | yes      | conservative `llm:main` and `tool` daily limits |
| `team`      | no       | higher daily limits, no monthly cap             |
| `unlimited` | no       | no `plan_limits` rows                           |

The `ADMIN_USER_ID` subject is bound to `unlimited` in the same migration.

### 12.2 Environment variables

No new required env vars. Optional:

- `QUOTA_RETENTION_MS` — override for the GC retention (default
  `2 × MONTH_MS`).
- `QUOTA_OUTPUT_BUDGET_FALLBACK` — used when the orchestrator config did not
  pin a `maxOutputTokens` (defaults to `2048`).

### 12.3 Backwards compatibility

- Existing `web_rate_limit` table is read-only after this change ships and is
  dropped in a follow-up migration after one release window. `web_fetch` keeps
  the same behaviour because the `free` plan's `web_fetch.requests.minute`
  limit is seeded to `20` (current hard-coded value).
- `llm_usage_events.forwarded_*` outbox columns are unaffected — the future
  metering forwarder reads them; the new code path does not touch them.

## 13. Testing strategy

Following `tests/CLAUDE.md` and the project's TDD hooks:

- **Unit** — `src/quota/__tests__/`:
  - `resolvePlan` 3-tier lookup, including thread suffix stripping and
    `expires_at` behaviour.
  - `reserveQuota` atomicity (concurrent calls; assert at most `LIMIT`
    succeed).
  - `commitQuota` reconciliation (over- and under-estimate, error refund,
    clamp at 0).
  - Window boundary math (`minute|hour|day` rolling, `month` UTC calendar).
- **Integration** — `tests/quota/`:
  - Orchestrator pre-call gate fires before `generateText` and shapes the
    user-visible reply.
  - Tool wrapper emits `quota_exceeded` structured failure.
  - Proactive LLM honours the same gate.
  - Embedding denial degrades memo search to keyword (assert existing
    behaviour still holds).
- **HTTP** — `tests/debug/`:
  - All admin routes require `DEBUG_TOKEN`.
  - `DELETE /admin/plans/:id` with pinned subjects requires `fallback`.
  - `PUT /admin/subjects/:subjectId/plan` rejects thread-scoped ids.
- **E2E** — none required for v1 (no chat-platform-specific behaviour).

## 14. Phased rollout

| Phase | Deliverable                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Tables + `resolvePlan` + `reserveQuota` / `commitQuota` wired into orchestrator and tool wrapper. Seed `free`/`team`/`unlimited`. No UI yet. |
| 2     | `get_my_plan` / `get_my_quota` tools, `/plan` / `/quota` slash commands.                                                                     |
| 3     | Admin dashboard: Plans panel + extended Subjects table + per-subject Quota card. `/setplan` admin command.                                   |
| 4     | `cost_usd_micro` dimension + model price table + cost meters in the dashboard.                                                               |
| 5     | Drop legacy `web_rate_limit` table once phase 1 has been live for one release.                                                               |

## 15. Open questions

- **Token-bucket smoothing for `input_tokens.minute`** — is the bursty
  fixed-window behaviour acceptable as a v1, or do we need bucket refill for
  the minute window? (Current best-practice survey suggests fixed-window is
  fine until real abuse is observed.)
- **Per-chat-user fairness inside groups** — currently out of scope. If we
  see one member starving a group, the cleanest fix is a secondary counter
  keyed by `(subject_id, chat_user_id, resource)` reusing the same gate.
- **Cost dimension scoping** — for cost, should we expose **billed** cost
  (provider-side, may not be available until later) or **list-price** cost
  (computed from a local model price table)? Recommendation: list-price first
  because it can land without changing the LLM call path.
