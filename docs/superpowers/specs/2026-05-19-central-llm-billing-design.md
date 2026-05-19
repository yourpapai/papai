# Central LLM + Initial Billing Telemetry Design

**Date:** 2026-05-19
**Status:** Draft (initial scope)
**Approach:** Drop BYOK from the user-visible setup; serve LLM calls from one
admin-owned credential set; capture per-call usage rows in SQLite; surface them
through a new dashboard tab.

## Context

Today every user must complete a 5-step LLM wizard (`llm_apikey`,
`llm_baseurl`, `main_model`, `small_model`, `embedding_model`) before the bot
will answer anything. The keys live as per-user rows in the `user_config`
table; `getLlmConfig` reads them through `getCachedConfig` in
`src/llm-orchestrator-config.ts:43`. New users get admin's values copied in
on group provisioning via `copyAdminLlmConfig` (`src/config.ts:73`), but DM
users see the full wizard.

This is friction with no product value: operators of the bot already pay for
the model, so users do not gain anything by typing credentials, and we get
nothing in return — no central view of cost, no per-user attribution, no way
to evaluate pricing because token usage is emitted on the in-process event
bus and then dropped.

The billing research bundle in `docs/research/billing/` enumerates the
packaging and provider decisions that come later. Two findings from that
bundle frame the work below:

- `06-papai-integration-notes.md` §2 calls BYOK out as a packaging fork. Once
  central LLM is the default, the "managed-LLM" branch becomes the only
  branch and the BYOK fork can come back later as an explicit feature.
- `04-metering-and-telemetry.md` §2–§3 prescribes a CloudEvents-shaped
  metering payload and an outbox table inside the same SQLite database. The
  shape we persist now should slot into that outbox later without a rewrite.

## Goals

1. New users send their first message and get an answer with zero setup.
2. Bot admin owns one set of LLM credentials, set once.
3. Every LLM call produces a durable row keyed by billable subject, model,
   tokens, and turn id. Tool calls observed by the same turn id.
4. Debug dashboard gets a Billing tab: subject list with totals, drill-down
   to per-request rows.
5. Shape of stored events is forward-compatible with the metering pipeline
   described in `04-metering-and-telemetry.md` — no rewrite to reach the
   outbox-plus-vendor pattern later.

## Non-goals

- No real pricing, no rating, no invoices, no Stripe or any PSP.
- No quota enforcement, no rate gating, no soft caps. The dashboard is
  read-only.
- No re-introduction of BYOK as a paid SKU; that is a packaging decision
  the billing research has not closed.
- No rewrite of the wizard engine — only the LLM steps move out.
- No cross-platform identity merge. `platform_user_id` stays the subject
  key, same trade-off documented in `06-papai-integration-notes.md` §1.
- No Discord Premium / Telegram Payments work.

## Decisions

### D1. Central credentials live in the `system_config` table, env is bootstrap only

Add a new single-table store:

```sql
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL  -- platform_user_id of bot admin who set it
);
```

Keys, all owned by the bot admin: `llm_apikey`, `llm_baseurl`, `main_model`,
`small_model`, `embedding_model`.

On startup, `src/index.ts` reads optional env vars `LLM_API_KEY`,
`LLM_BASE_URL`, `MAIN_MODEL`, `SMALL_MODEL`, `EMBEDDING_MODEL` and seeds any
missing row in `system_config`. Once seeded, env is ignored: DB is the source
of truth. This matches the existing pattern where `KANEO_CLIENT_URL` is env
but per-user `kaneo_apikey` is DB.

Rationale for a new table rather than reusing `user_config` with a reserved
`platform_user_id`:

- Keeps the `users` foreign key on `user_config` clean (migration 023 added
  FKs there).
- Auditing — `updated_by` records which admin changed credentials when there
  is more than one admin in the future.
- Eliminates ambiguity in `getCachedConfig` callsites: there is no risk of a
  per-user override silently shadowing a central value.

### D2. Resolution order: system_config only, no per-user fallback

`getLlmConfig(contextId)` in `src/llm-orchestrator-config.ts:43` changes to
read from `system_config` only. `readConfig(contextId, 'llm_apikey' | ...)`
in the same file (line 19) stops accepting LLM keys; those keys are removed
from its union type.

Removed surface (per-user LLM keys):

- `LlmConfigKey` in `src/types/config.ts:15` drops to empty / is removed.
- `getConfigKeysForProvider` in `src/types/config.ts:30` no longer emits LLM
  keys into `CONFIG_KEYS` or `ALL_CONFIG_KEYS`.
- `copyAdminLlmConfig` and `isMissingLlmConfig` in `src/config.ts:69-83` are
  deleted along with `LLM_COPY_KEYS`. Their only callers in
  `src/providers/kaneo/provision.ts:229-243` are removed — group provisioning
  no longer needs to copy keys because all calls read from `system_config`.
- `SENSITIVE_KEYS` in `src/config.ts:13` loses `llm_apikey`. The masking
  helper still applies to `kaneo_apikey` and `youtrack_token`.

Migration 034 drops the LLM rows that already exist in `user_config` so the
table does not carry dead data:

```sql
DELETE FROM user_config
WHERE key IN ('llm_apikey', 'llm_baseurl', 'main_model',
              'small_model', 'embedding_model');
```

### D3. Wizard loses the LLM steps; gains a "central credentials not set" error path

`src/wizard/steps.ts:34-55` defines the wizard step list. The five LLM steps
disappear. The wizard becomes:

1. Task provider key (`kaneo_apikey` or `youtrack_token`) — required.
2. `timezone` — required.

That is roughly 30 seconds of friction instead of two minutes.

`checkRequiredConfig` in `src/llm-orchestrator-config.ts:28` no longer reports
missing LLM keys at the per-context level. It does still need to fail loudly
when `system_config` itself is empty — that is a bot operator problem, not a
user problem. Behavior:

- If `system_config` is missing any of the three required keys (`llm_apikey`,
  `llm_baseurl`, `main_model`), the orchestrator replies with "The bot is not
  fully configured. The bot administrator has been notified." and emits an
  `error` log including the missing keys.
- The bot admin gets a DM from the bot pointing at the dashboard's
  credentials form, or instructions to set env vars and restart. This is a
  rare path; we do not need a polished UI for it in v1.

### D4. Admin sets credentials via debug dashboard form (DM `/admin` deferred)

Phase 1 ships two entry points for the admin:

- **Env-var bootstrap.** Set `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL`,
  `SMALL_MODEL`, `EMBEDDING_MODEL` before first start. Migration 034 seeds
  them. Sufficient for self-hosters.
- **Dashboard credentials form.** Existing dashboard already runs behind
  `DEBUG_TOKEN`; the admin is the only intended viewer. New `POST /admin/llm`
  route writes a single key into `system_config`. `GET /admin/llm` returns
  the current set with the API key masked the same way `maskValue` already
  masks user keys.

A DM `/admin` command is *not* in scope for v1 — it adds new auth surface
(only bot admin) and a new wizard branch. Defer until the dashboard form
shows real friction.

### D5. Per-LLM-call usage row, written from the event bus

New table `llm_usage_events` records one row per `llm:end`:

```sql
CREATE TABLE llm_usage_events (
  event_id TEXT PRIMARY KEY,                -- ULID, idempotency key
  occurred_at INTEGER NOT NULL,             -- ms epoch, == event timestamp
  turn_id TEXT,                             -- nullable, joins to logs
  storage_context_id TEXT NOT NULL,         -- billing subject scope
  context_type TEXT NOT NULL,               -- 'dm' | 'group'
  chat_user_id TEXT NOT NULL,               -- platform_user_id of caller
  model TEXT NOT NULL,                      -- resolved/actualModel
  model_role TEXT NOT NULL,                 -- 'main' | 'small' | 'embedding'
  input_tokens INTEGER,                     -- nullable: provider may omit
  output_tokens INTEGER,
  step_count INTEGER NOT NULL,              -- result.steps.length
  tool_call_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,           -- context size at call time
  finish_reason TEXT,
  duration_ms INTEGER NOT NULL,
  response_id TEXT,
  error TEXT                                -- null on success
);

CREATE INDEX idx_llm_usage_subject ON llm_usage_events(storage_context_id, occurred_at);
CREATE INDEX idx_llm_usage_chat_user ON llm_usage_events(chat_user_id, occurred_at);
CREATE INDEX idx_llm_usage_turn ON llm_usage_events(turn_id);
CREATE INDEX idx_llm_usage_occurred ON llm_usage_events(occurred_at);
```

Field-by-field justification anchored to the metering doc:

- `event_id` is the `identifier` in Stripe terms / `id` in CloudEvents terms
  (see `04-metering-and-telemetry.md` §2). ULID generated in-process before
  the row is inserted.
- `storage_context_id` is the "billable subject" key. For DMs that is the
  user id; for groups, the group id (or `groupId:threadId`). Same value
  `bot.ts` passes to the orchestrator as `contextId`.
- `chat_user_id` is preserved separately because in groups the subject is
  the group but cost should still be attributable to the individual who
  triggered the call.
- `model_role` distinguishes main vs small vs embedding for the per-model
  totals in the dashboard.
- `input_tokens` / `output_tokens` are nullable because some
  OpenAI-compatible providers do not return usage; recording `NULL`
  preserves the row for context-size and tool-call counts and keeps the
  audit trail.

The row is written **synchronously inside the event handler** when the
`llm:end` event fires. This is an additional handler subscribed to the
debug event bus, parallel to `state-collector.ts`. Writing in the same
process before the next message means latency cost is bounded; SQLite
inserts at this rate are cheap.

Where to subscribe: a new `src/usage/` module with `recordUsage(event)`
exported. `src/llm-orchestrator-events.ts:153-202` already builds the
`llm:end` payload — the recorder reads from the bus rather than the
orchestrator calling a function directly, so the orchestrator stays
decoupled.

Module sketch:

```
src/usage/
  index.ts          — initUsageRecorder(): subscribes to llm:end + tool events
  recorder.ts       — recordUsage(payload) -> INSERT into llm_usage_events
  query.ts          — listSubjects(), getSubjectDetail(id), getRequestRows(id)
  types.ts          — UsageEvent, SubjectSummary
```

Tool calls do not get their own table in v1 — the per-turn
`tool_call_count` is enough for the dashboard. The tool-failure stream the
debug server already collects (`toolFailures` in `dashboard-types.ts`) is
already keyed by turn id, so the drill-down join is free.

#### Why this is forward-compatible with the outbox pattern

`04-metering-and-telemetry.md` §3 recommends an `outbox` table that a worker
drains into Stripe / OpenMeter. `llm_usage_events` is the outbox-shaped
table, minus a `forwarded` / `committed` flag. When the billing pipeline
arrives:

- add columns: `forwarded_at INTEGER`, `forward_attempts INTEGER DEFAULT 0`,
  `forward_error TEXT`.
- write a worker that selects un-forwarded rows, POSTs CloudEvents to the
  metering target, and sets `forwarded_at`.
- the producer side does not change.

So the v1 table *is* the v2 outbox.

### D6. Dashboard Billing tab

The debug dashboard at `client/debug/` is a Svelte app driven by a single
reactive `DashboardState` (`dashboard.svelte.ts`). Add:

State additions (in `dashboard-types.ts:115-137`):

```ts
billingSubjects: BillingSubject[]      // list view
billingDetail: BillingDetail | null    // drill-down, fetched on open
```

Routes added to `src/debug/server.ts`:

| Route | Returns |
| --- | --- |
| `GET /billing/subjects?window=30d` | Array of `BillingSubject` for the list |
| `GET /billing/subject/:id?window=30d` | `BillingDetail` for one subject |
| `GET /admin/llm` | Current system_config keys with `llm_apikey` masked |
| `POST /admin/llm` | `{ key, value }`; writes to `system_config` |

Shapes:

```ts
interface BillingSubject {
  storageContextId: string
  contextType: 'dm' | 'group'
  displayName: string | null    // username or group title if known
  totals: {
    main:      { inputTokens: number; outputTokens: number; calls: number }
    small:     { inputTokens: number; outputTokens: number; calls: number }
    embedding: { inputTokens: number; outputTokens: number; calls: number }
  }
  toolCalls: number
  lastActiveAt: number
}

interface BillingDetail {
  subject: BillingSubject
  requests: Array<{
    eventId: string
    occurredAt: number
    turnId: string | null
    chatUserId: string
    model: string
    modelRole: 'main' | 'small' | 'embedding'
    inputTokens: number | null
    outputTokens: number | null
    stepCount: number
    toolCallCount: number
    messageCount: number          // context size
    durationMs: number
    finishReason: string | null
    error: string | null
  }>
}
```

`displayName` is best-effort: join to `users.username` when subject is a DM,
or to `authorized_groups`/`group_user_observations` (already used by the
group selector) for a group title. If unknown, return null; the UI shows the
raw id.

UI:

- New "Billing" tab in the dashboard nav, alongside Logs / Turns / Memos /
  Recurring.
- Top half: subjects table, sortable by total tokens. Columns: subject,
  type, main in/out, small in/out, calls, last active.
- Bottom half: when a row is clicked, fetch `/billing/subject/:id` and show
  a virtualized table of requests, one row per `llm_usage_events` row.
- Each request row expands to show the JSON payload (model, finish reason,
  step count, tool call count, message count, duration).
- Window selector: 24h / 7d / 30d / all. Default 30d.
- A small "LLM credentials" form sits at the top of the tab and posts to
  `POST /admin/llm`. The API key is shown masked; clicking "edit" reveals a
  blank input so a paste replaces the value.

No charts in v1 — the user explicitly asked for "very basic". Tables only.

### D7. Logging and PII rules

`06-papai-integration-notes.md` §10 calls out that billing fields are
sensitive. v1 is internal-only and already gated by `DEBUG_TOKEN`, but:

- Never log `llm_apikey` content. The dashboard form posts it, the route
  writes it, the recorder never reads it.
- Log `event_id`, `storage_context_id`, `chat_user_id`, `model`, token
  counts. Do not log `generatedText`, which is on the event bus but is
  not persisted in `llm_usage_events`.
- The recorder catches and logs its own errors; it must never throw out
  into the event bus subscriber chain because that would block other
  subscribers (state collector, telemetry).

## Migration order

1. **034_system_config** — create `system_config` table, optionally seed
   from env vars.
2. **035_llm_usage_events** — create `llm_usage_events` plus indexes.
3. **036_drop_user_llm_config** — `DELETE FROM user_config WHERE key IN
   (...)`. Schema change only after step 1 proves out in staging.

Steps 1 and 2 are additive and reversible. Step 3 is irreversible by data
but reversible by code revert (admin re-runs `/setup` per-user, BYOK back).

## Code changes summary

| File | Change |
| --- | --- |
| `src/db/migrations/034_system_config.ts` | New: create table, optional env seeding |
| `src/db/migrations/035_llm_usage_events.ts` | New: create table + indexes |
| `src/db/migrations/036_drop_user_llm_config.ts` | New: delete LLM rows from `user_config` |
| `src/db/schema.ts` | Add `systemConfig`, `llmUsageEvents` Drizzle tables |
| `src/system-config.ts` | New: `getSystemConfig(key)`, `setSystemConfig(key, value, adminId)` |
| `src/llm-orchestrator-config.ts:19-47` | Read LLM keys from `system_config`, not `user_config` |
| `src/llm-orchestrator-config.ts:28` | `checkRequiredConfig` no longer returns LLM keys |
| `src/llm-orchestrator.ts:99-110` | New "bot misconfigured" reply when system_config is empty |
| `src/types/config.ts:15` | Remove `LlmConfigKey`; remove LLM keys from `ALL_CONFIG_KEYS` and `CONFIG_KEYS` |
| `src/config.ts:13,57-83` | Remove `llm_apikey` from `SENSITIVE_KEYS`; delete `LLM_COPY_KEYS`, `copyAdminLlmConfig`, `isMissingLlmConfig` |
| `src/wizard/steps.ts:34-55` | Remove the five LLM steps |
| `src/providers/kaneo/provision.ts:229-243` | Remove `copyAdminLlmConfig` calls |
| `src/usage/index.ts` | New: subscribe to `llm:end`, call recorder |
| `src/usage/recorder.ts` | New: insert into `llm_usage_events` |
| `src/usage/query.ts` | New: aggregation queries for dashboard |
| `src/index.ts` | Call `initUsageRecorder()` after DB init; seed `system_config` from env |
| `src/debug/server.ts:182-200` | Route `/billing/subjects`, `/billing/subject/:id`, `/admin/llm` (GET, POST) |
| `client/debug/dashboard-types.ts:115-137` | Add `billingSubjects`, `billingDetail` to `DashboardState` |
| `client/debug/dashboard.svelte.ts` | New Billing tab component + nav entry |
| `client/debug/billing/SubjectsTable.svelte` | New |
| `client/debug/billing/SubjectDetail.svelte` | New |
| `client/debug/billing/CredentialsForm.svelte` | New |

Tests (under `tests/`):

- `tests/db/migrations/034-system-config.test.ts` — table created, env seed.
- `tests/db/migrations/035-llm-usage-events.test.ts` — indexes present.
- `tests/system-config.test.ts` — get/set, masking on `llm_apikey`.
- `tests/llm-orchestrator-config.test.ts` — extend existing suite for the
  new resolution order; assert wizard-required keys no longer include LLM.
- `tests/usage/recorder.test.ts` — `llm:end` event with usage produces one
  row; missing token usage produces row with NULL tokens; idempotency by
  `event_id` is preserved on retry.
- `tests/usage/query.test.ts` — aggregates per subject and per model role.
- `tests/debug/server-billing.test.ts` — `/billing/subjects` returns the
  expected shape; `/admin/llm` write is admin-gated by `DEBUG_TOKEN`.
- `tests/client/billing.test.ts` — subjects render; clicking opens detail
  fetch.

E2E (`tests/e2e/`) — out of scope for v1; the existing Kaneo E2E does not
exercise the dashboard.

## Open questions for the next session

1. **Group vs user attribution on the invoice side.** v1 stores both
   `storage_context_id` and `chat_user_id` so we can roll up either way.
   Packaging picks the unit later.
2. **Embedding usage rows.** `src/embeddings.ts:18` and `src/web/distill.ts:88`
   also build OpenAI-compatible clients. v1 should route them through the
   same `system_config` keys; whether each embedding call should produce a
   `model_role='embedding'` row is a judgment call — recommendation is
   yes, because embeddings on bulk imports are exactly the kind of cost
   spike the billing research flagged.
3. **Tool-call cost rows.** Skipped in v1, but
   `04-metering-and-telemetry.md` §1 lists tool calls as a candidate
   billable unit. A `tool_call_events` table mirroring `llm_usage_events`
   is a small follow-up that gives us the per-tool cost mix.
4. **Aggregation roll-ups.** Querying `llm_usage_events` raw works at the
   current message volume. At some scale we will want a nightly job that
   writes daily roll-ups into `llm_usage_daily`. Not needed before the
   table has months of data.
5. **Idempotency across restarts.** `event_id` is a process-local ULID. If
   `recordUsage` ever runs outside the in-process handler (queue, retry),
   we want the id to be derived deterministically — e.g.
   `hash(responseId, occurredAt)`. v1 does not need this because the
   recorder runs synchronously on the bus.
6. **Cross-platform identity merge.** Still out of scope. When in scope,
   `llm_usage_events.chat_user_id` joins to whatever identity table
   replaces `users.platform_user_id`.

## Out of scope, for reference

- Stripe / Paddle / Polar integration (see `03-payment-providers.md`).
- Quota enforcement, free-tier caps, dunning (see
  `05-compliance-and-tax.md` §refunds + `06-papai-integration-notes.md` §3).
- Customer-facing self-serve portal — Stripe Customer Portal when billing
  ships, not a homegrown UI.
- OpenTelemetry mirroring of usage metrics — already covered by the
  approved telemetry design (`2026-04-26-telemetry-metrics-design.md`);
  usage rows are the source of truth, OTel mirrors aggregates.

## Reading order for the implementor

1. This document.
2. `docs/research/billing/06-papai-integration-notes.md` for the
   integration-point map.
3. `docs/research/billing/04-metering-and-telemetry.md` §1–§4 for the
   event shape that `llm_usage_events` follows.
4. `src/llm-orchestrator-events.ts:153-202` to confirm the event payload
   the recorder reads.
5. Then start at migration 034.
