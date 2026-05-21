# LLM Rate Limiting and Plans — Enforcement Details

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
  see _that_ the trigger fired, even if not _how_ it would normally
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
   This is a _preemptive_ degradation, not a recovery path: it kicks in
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
  _{deliveryBriefOrPrompt}_". When
  `execution_metadata.delivery_brief` is non-empty, prefer it over the
  raw `prompt` field because the creator already framed it for the
  user.
- **`scheduled` — recurring (`rrule`).** "Recurring prompt
  ({humanRruleSummary}) fires now: _{deliveryBriefOrPrompt}_". The
  recurrence summary is produced locally from the stored `rrule` string
  by the same helper used in `list_recurring_tasks` output.
- **`alert` — condition triggered.** "Alert condition met
  ({humanConditionSummary}): _{deliveryBriefOrPrompt}_". The condition
  is rendered as a short human-readable clause (e.g. "task _T-42_
  status changed to _Done_") built directly from the stored
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

## 9. User-facing surface (in chat)

### 9.1 Tools

- `get_my_plan` (DM and group; `proactive` mode allowed) →
  ```json
  {
    "planId": "team",
    "planName": "Team",
    "description": "Shared team plan",
    "limits": [
      {
        "resource": "llm:main",
        "dimension": "input_tokens",
        "window": "day",
        "algorithm": "rolling_refill",
        "limit": 200000,
        "notifyPct": 80
      },
      {
        "resource": "llm:main",
        "dimension": "output_tokens",
        "window": "day",
        "algorithm": "rolling_refill",
        "limit": 80000,
        "notifyPct": 80
      },
      {
        "resource": "tool",
        "dimension": "requests",
        "window": "day",
        "algorithm": "fixed_window",
        "limit": 1000,
        "notifyPct": 80
      },
      {
        "resource": "attachment",
        "dimension": "storage_bytes",
        "window": "month",
        "algorithm": "fixed_window",
        "limit": 524288000,
        "notifyPct": 80
      }
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

| Phase | Deliverable                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Tables + `resolvePlan` + `reserveQuota` / `commitQuota` for both `fixed_window` and `rolling_refill` algorithms; wired into orchestrator and tool wrapper. Seed `free`/`team`/`unlimited`. No UI yet.                                                          |
| 2     | `get_my_plan` / `get_my_quota` tools, `/plan` / `/quota` slash commands. 80 % early-warning notice via `quota:threshold_crossed` subscriber.                                                                                                                   |
| 3     | Deferred-prompts fallback chain (proactive small-model degrade at `notify_pct`, hard small-model fallback on `llm:main` denial, per-type templated delivery as last resort; no defer-and-retry) and `attachment.storage_bytes` gate with reconciliation sweep. |
| 4     | Admin dashboard: Plans panel (with algorithm + `notify_pct` editors), extended Subjects table, per-subject Quota card. `/setplan` admin command.                                                                                                               |
| 5     | `cost_usd_micro` dimension + model price table + cost meters in the dashboard.                                                                                                                                                                                 |
| 6     | Drop legacy `web_rate_limit` table once phase 1 has been live for one release.                                                                                                                                                                                 |
