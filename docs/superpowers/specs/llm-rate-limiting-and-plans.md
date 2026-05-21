# LLM Rate Limits and Plans

**Date:** 2026-05-20
**Status:** Draft
**Approach:** Add admin-managed plans and live quota counters beside the existing
usage-recording pipeline. Enforce limits before LLM/tool/web/attachment work,
reconcile afterward with actual usage, and keep `llm_usage_events` and
`tool_call_events` as the durable source of truth.

## Context

Current usage recording already exists in `src/usage/recorder.ts`,
`src/usage/index.ts`, and `src/usage/query.ts`. Web fetches use the existing
SQLite limiter in `src/web/rate-limit.ts`. Thread-scoped storage ids come from
`src/auth.ts`, the current admin billing UI lives in `src/debug/billing*.ts`
and `client/debug/billing/`, deferred prompts already flow through
`src/deferred-prompts/proactive-llm.ts`, and embedding calls already record
usage in `src/embeddings.ts`. This design adds plan resolution and quota
enforcement on top of those modules rather than replacing them.

Full verified-context module references live in [`../notes/llm-rate-limiting-enforcement-details.md`](../notes/llm-rate-limiting-enforcement-details.md).

## Goals

- Let the admin define named plans with multi-dimensional limits.
- Assign plans to users or groups, with a default fallback and optional expiry.
- Enforce limits before chargeable work, then reconcile estimates with actuals.
- Expose plan and remaining quota to users through tools and slash commands.
- Warn subjects when they cross a configurable threshold, default 80%.
- Keep deferred prompts on schedule by degrading delivery instead of slipping
  fire time.
- Audit plan changes and reuse existing `DEBUG_TOKEN`-gated admin surfaces.

## Non-goals

- No pricing table or `cost_usd_micro` enforcement in v1.
- No concurrent in-flight limit.
- No per-member fairness inside a shared group plan.
- No HA / multi-process coordination beyond the current SQLite process model.
- No sliding-window log implementation; only fixed-window and token-bucket
  style refill.
- No sub-day windows; v1 is day, week, and month only.

## Conceptual model

A `plan` owns many `plan_limits`. A subject resolves to one active plan through
`subject_plan` or the global default. Each chargeable operation checks the
resolved plan, updates the relevant `quota_counter` rows atomically, and then
reconciles to actual usage after the fact.

### Subject identity

`subject_id` is intentionally not the raw `storage_context_id`:

| Chat shape      | `storage_context_id` example | `subject_id` |
| --------------- | ---------------------------- | ------------ |
| DM              | `user:42`                    | `user:42`    |
| Group main chat | `group:abc`                  | `group:abc`  |
| Group thread    | `group:abc:thread-7`         | `group:abc`  |

Thread suffixes are stripped before plan lookup so one group shares one plan
across its main chat and threads.

### Resources, dimensions, and windows

| Axis        | Values                                                                                | Notes                                                                                               |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `resource`  | `llm:main`, `llm:small`, `llm:embed`, `tool`, `web_fetch`, `attachment`               | `web_fetch` also spends the generic `tool` counter; `attachment` is stock, not flow                 |
| `dimension` | `requests`, `input_tokens`, `output_tokens`, `storage_bytes`, future `cost_usd_micro` | invalid resource/dimension pairs are rejected by the editor/API                                     |
| `window`    | `day`, `week`, `month`                                                                | fixed-window resets on UTC boundaries; week starts Monday 00:00 UTC; month is calendar month in UTC |
| `algorithm` | `fixed_window`, `rolling_refill`                                                      | `rolling_refill` is a token bucket with lazy refill                                                 |

`fixed_window` is best for calendar-style caps. `rolling_refill` is best for
smoothing bursts without adding per-request log storage.

## Data model

| Table           | Key columns                                                                                                                   | Purpose / notes                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `plans`         | `id` PK, `name`, `description`, `is_default`, timestamps                                                                      | Named plans such as `free`, `team`, `unlimited`; partial unique index enforces at most one default |
| `plan_limits`   | PK `(plan_id, resource, dimension, window)` plus `algorithm`, `limit_value`, `notify_pct`                                     | Per-plan limits; missing row means unlimited for that triple                                       |
| `subject_plan`  | `subject_id` PK, `plan_id`, `assigned_by`, `assigned_at`, `expires_at`, `note`                                                | Explicit subject override; absence falls back to the default plan                                  |
| `plan_audit`    | autoincrement `id`, `occurred_at`, `actor_id`, `subject_id`, `action`, `plan_id`, `payload_json`                              | Append-only audit trail for plan edits and assignments                                             |
| `quota_counter` | PK `(subject_id, resource, dimension, window)` plus `algorithm`, `window_start`, `count`, `balance`, `notified_threshold_pct` | Stores only current quota state for the active bucket or token bucket                              |

### Notes by table

- **`plans`**: migration seeds `free`, `team`, and `unlimited`; admin is bound
  to `unlimited`.
- **`plan_limits`**: `notify_pct` defaults to `80`; absence means unlimited,
  not `NULL` or `-1`.
- **`subject_plan`**: `expires_at` is evaluated during plan resolution, so no
  sweeper is required for correctness.
- **`quota_counter`**:
  - `fixed_window`: `count` is used, `balance` is ignored.
  - `rolling_refill`: `balance` is used, `count` is ignored.
  - `attachment.storage_bytes`: `count` holds outstanding bytes and is adjusted
    up/down as files are added or removed.

Existing `llm_usage_events` and `tool_call_events` stay unchanged and remain
responsible for post-hoc reporting and billing detail.

## Plan resolution

Plan resolution is intentionally simple:

1. Use the active `subject_plan` row for `subject_id` if present and unexpired.
2. Otherwise use the single `plans.is_default = 1` row.
3. There is no implicit inheritance between a group and its members.

That keeps behavior predictable: DMs use user plans, groups use group plans,
and thread-scoped ids resolve to the parent group before lookup.

## Enforcement

New helpers live under `src/quota/`:

```ts
reserveQuota(subjectId, resource, estimate, now)
commitQuota(subjectId, resource, actualDelta, now)
```

### Core algorithm

For each chargeable operation:

1. Resolve the active plan for the subject.
2. Expand the request into per-dimension deltas, for example:
   - LLM: `requests`, estimated `input_tokens`, reserved `output_tokens`
   - tool: `requests`
   - attachment: `storage_bytes`
3. For each limited `(resource, dimension, window)` triple:
   - **fixed window**: derive the current UTC bucket, reset the row if the
     boundary rolled over, then atomically increment only if the new count does
     not exceed the limit.
   - **rolling refill**: lazily refill the token bucket based on elapsed time,
     cap at capacity, then atomically spend tokens only if enough remain.
4. If any dimension breaches, fail the entire reservation and return the
   breached dimension plus a computed retry time.
5. On success, return remaining quota for the affected dimensions and publish a
   threshold event if usage crossed `notify_pct` for the first time in the
   current bucket.

### LLM reservation and reconciliation

LLM requests reserve pessimistically before the call, then reconcile afterward:

- Before `generateText`: reserve `requests = 1`, estimated input tokens, and an
  output budget.
- On success: commit the difference between reserved and actual token usage.
- On error: refund the token reservation, but keep the request count because an
  attempt was made.

This avoids a separate reservation table while still enforcing output-token
headroom up front.

### Tools and web fetch

- Every tool execution reserves `tool.requests = 1`.
- `web_fetch` reserves both `tool.requests = 1` and `web_fetch.requests = 1`
  inside the same transaction.
- Attempts count even when the tool or fetch fails.

### Deferred prompts and proactive delivery

Deferred prompts must **fire on time**. The system never delays a prompt around
quota reset; it degrades delivery instead.

Fallback chain at fire time:

1. Try `llm:main` when the subject is below the warning band.
2. Once the subject has crossed `notify_pct` on `llm:main`, proactively use
   `llm:small` instead to preserve interactive headroom.
3. If `llm:main` is denied, retry with `llm:small`.
4. If both LLM paths are unavailable, send a non-LLM template immediately.

Template path summaries:

- **Scheduled one-shot:** `Scheduled prompt fires now: {deliveryBriefOrPrompt}`
- **Scheduled recurring:** `Recurring prompt ({humanRruleSummary}) fires now: {deliveryBriefOrPrompt}`
- **Alert:** `Alert condition met ({humanConditionSummary}): {deliveryBriefOrPrompt}`
- All templates append a shared footer that the LLM is over quota right now.

Record per dispatch:

- `delivery_mode`: `llm_main | llm_small | template`
- `delivery_reason`: `normal | proactive_degrade | main_denied | all_denied`

### Embeddings

Embedding calls use `llm:embed` quotas. If denied, memo search falls back to
its existing keyword path instead of hard-failing.

### Attachment storage

Attachment storage is a stock counter, not a time-window flow:

- reserve bytes before upload
- reject the upload if the subject is already full
- commit a negative delta on delete
- periodically reconcile from attachment metadata so drift self-heals

### Early-warning notice

When a successful reservation crosses `notify_pct` (default 80%), emit a single
`quota:threshold_crossed` event for the active bucket. A templated notice is
then sent to:

- the user's DM for `user:*` subjects
- the group main chat for `group:*` subjects

For rolling refill, the warning becomes eligible again only after the bucket
recovers above the threshold.

### Failure surface

When quota is denied:

- the orchestrator returns a structured user-facing quota response
- tool wrappers return `quota_exceeded`
- admin HTTP routes return `429` with `Retry-After`
- `/stats/*` remains outside the quota path

Algorithm SQL snippets and deferred-prompt fallback template wording live in the enforcement details note.

## User and admin surfaces

### User surfaces

- Tools: `get_my_plan`, `get_my_quota`
- Slash commands: `/plan`, `/quota`
- Both commands short-circuit before the orchestrator and do not consume quota.

### Admin surfaces

- Dashboard Plans panel for CRUD on plans and limits
- Billing subject detail for subject-plan assignment and live quota display
- `DEBUG_TOKEN`-gated routes for plans, subject assignment, audit, and per-subject quota
- Admin DM fallback for deployments without `DEBUG_SERVER`, via `/plans` and `/setplan`

Full user-facing tool shapes, chat command details, admin dashboard and HTTP API coverage live in the enforcement details note.

## Decisions

### D1. Subject identity strips thread scope

Quota subjects use thread-stripped ids, so a group shares one plan across its
main chat and threads.

### D2. Plans resolve through explicit assignment or the default plan

`subject_plan` overrides the default plan, can expire, and does not inherit
between groups and members.

### D3. Limits are keyed by resource, dimension, and window

Each triple can choose `fixed_window` or `rolling_refill`. V1 supports only
`day`, `week`, and `month` windows.

### D4. Enforcement is reserve first, reconcile later

The system reserves before work starts and commits actual deltas afterward.
Existing usage-event tables stay unchanged and remain the billing truth.

### D5. Web fetch and attachment accounting stay explicit

`web_fetch` spends both a web-fetch quota and the generic tool quota.
Attachment storage is tracked as outstanding bytes with refunds on delete.

### D6. Deferred prompts degrade instead of slipping schedule

Deferred prompts always fire on time and use `main -> small -> template`
fallback, with proactive small-model degradation after the warning threshold.

### D7. Plan management stays on admin-only surfaces

Dashboard/admin routes remain `DEBUG_TOKEN`-gated, admin commands remain
admin-only, and `/stats/*` stays anonymous and plan-free.

## Open questions

- Do shared group plans eventually need a second fairness layer keyed by
  `(subject_id, chat_user_id, resource)`?
- When `cost_usd_micro` lands, should it reflect billed provider cost or a
  local list-price table?
- Should the default algorithm remain one deployment-wide setting or become a
  per-dimension default map?
- Do multiple warning thresholds such as `50 / 80 / 95` improve UX or just add
  noise?
- For thread-triggered group warnings, is posting to the main group chat always
  the right trade-off versus thread-local delivery?

## Out of scope

- Pricing tables, invoices, PSP integration, or cost-based enforcement
- Concurrent in-flight quotas
- Per-member fairness inside a group plan
- Horizontal scale beyond single-process SQLite semantics
- Sliding-window log or approximate sliding-window algorithms
- Minute/hour windows
- Extending `/stats/*` with plan or quota data
