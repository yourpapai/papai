<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0120: Central LLM Credentials, Usage Telemetry, Billing Dashboard, Tool-Call Rows, and Anonymous DB-Wide Statistics

## Status

Implemented (with architectural extensions)

## Date

2026-05-19 – 2026-05-20

## Context

papai was originally a bring-your-own-key (BYOK) bot: every new user had to run a
five-step `/setup` wizard that included entering `llm_apikey`, `llm_baseurl`,
`main_model`, `small_model`, and `embedding_model` into their per-user `user_config`
row. This created several compounding problems:

1. **Onboarding friction**: New users could not get a useful response without
   first providing LLM credentials, even on a self-hosted instance where the
   operator had already configured everything centrally.
2. **No operator visibility**: There was no way for a bot admin to see how many
   LLM tokens were being consumed, by whom, and on which models — without
   writing ad-hoc SQL queries.
3. **No admin console**: Credentials could only be changed by editing environment
   variables and restarting the bot; there was no in-process update path.
4. **Opaque usage data**: Tool call rates, retry patterns, and per-surface cost
   amplifiers were completely invisible. Pricing and capacity planning were
   guesswork.
5. **Missing anonymity envelope**: The debug dashboard, while growing, had no
   structural guarantee that content (memo bodies, message text, filenames,
   usernames) was never surfaced — making it unsafe to share screenshots or
   export aggregates.

These problems were interconnected but had different blast radii and release
windows. A phased approach was chosen to isolate risk while building toward a
coherent admin surface.

Design captured in `docs/archive/2026-05-19-central-llm-billing-design.md` and
per-phase specs `docs/archive/2026-05-19-phase-{1..3}-*-design.md`,
`docs/archive/2026-05-20-phase-{4,5}-*-design.md`. Implementation plans in
`docs/archive/2026-05-19-central-llm-billing-roadmap.md` and
`docs/archive/2026-05-19-phase-{1..3}-*-plan.md`,
`docs/archive/2026-05-20-phase-{4,5}-*-plan.md`.

## Decision Drivers

- **Zero-friction onboarding**: Bot admin sets credentials once; users never
  touch LLM config.
- **Operator visibility**: Token counts, model distribution, and per-subject cost
  data available in the dashboard within seconds.
- **Hot credential reload**: Admin updates the API key through the dashboard
  without restarting the bot.
- **Idempotent telemetry**: Usage events survive queue retries and replay without
  double-counting. Deterministic `event_id` is the primary mechanism.
- **Strict anonymity envelope**: Stats routes return counts, sizes, timestamps,
  and keyed-hash distributions only — never message text, filenames, memo bodies,
  or usernames. Any leak is a release-blocking defect.
- **Additive phasing**: Each phase ships a codebase in a shippable state. No
  phase requires the next phase to be useful.

## Considered Options

### Credential management

#### Option 1: Admin sets credentials via chat command (`/admin llm …`)

- **Pros**: No dashboard dependency; works from Telegram or Mattermost DM.
- **Cons**: Credentials transmitted through chat platform logs; incompatible
  with the existing `/setup` privacy model (wizard already deletes sensitive
  messages).

**Rejected.** Credentials in chat messages introduce a secret-leakage vector
and conflict with the sensitive-message-cleanup policy (ADR-0075).

#### Option 2: Env-var seeding into a `system_config` table (chosen for Phase 1)

- **Pros**: Credentials never transit chat; restart-based change is safe for
  initial deployment; table schema admits a dashboard form later.
- **Cons**: Credential change requires env update + restart until Phase 3 lands
  the admin form.

**Chosen.** Simple, low blast radius for Phase 1; Phase 3 adds the hot-reload
path.

#### Option 3: Keep BYOK per-user keys, add an admin broadcast mechanism

- **Pros**: No migration; per-user overrides still possible.
- **Cons**: Maintaining two credential resolution paths increases complexity
  indefinitely; user_config keys are visible to users via `/config`, leaking the
  admin's API key to every user.

**Rejected.** Per-user visibility of a shared API key is a security boundary
violation.

### Usage event identity

#### Option 1: `crypto.randomUUID()` per insertion

- **Pros**: Zero chance of false collisions; no hashing dependency.
- **Cons**: Replayed or retried events insert duplicate rows, producing
  inflated billing counts. Unsafe in a queue-drain path.

**Used in Phase 2 initial implementation; replaced in Phase 4.**

#### Option 2: Deterministic SHA-256 hash of identifying fields (chosen for Phase 4)

LLM events: `SHA-256(turnId|responseId|modelRole|occurredAt)`.
Tool-call events: `SHA-256(turnId|toolCallId)`.

- **Pros**: Identical events produce identical ids; duplicate inserts fail at
  the DB primary-key constraint and are logged at `warn` without crashing.
  Queue and retry paths are safe.
- **Cons**: Collisions on identical (turnId, responseId, modelRole, occurredAt)
  tuples are possible in theory but require a bug in the emitter that produces
  two events with the same turn, response, role, and timestamp — which would be
  a real bug worth surfacing.

**Chosen.** Note: `occurredAt` was added as a 4th component in the final
implementation (vs the plan's 3-component sketch) to prevent collisions between
embedding and main-model calls that happen to share the same turn and response id
in providers that return static response ids.

### Stats anonymity mechanism

#### Option 1: No free-form strings in the response schema

Each response field is either a number, an enum literal, a boolean, or an opaque
id already visible in the billing surface.

- **Pros**: Structural guarantee; no runtime filtering needed.
- **Cons**: Bucketing decisions (e.g. extension distribution) must be made
  query-side; some aggregations require knowing the plain value first.

**Partially used**: the schema is number/enum-first; the "opaque id" exception
covers `storageContextId` and `chatUserId` (already exposed by billing).

#### Option 2: Keyed-hash for high-cardinality strings (chosen for hostnames and rrule patterns)

RRULE strings and web-fetch hostnames are structural (not PII) but individually
identifiable in small deployments. SHA-256 over `(value + stats_anonymity_salt)`
gives deterministic deduplication within one deployment while making values
non-portable across deployments.

- **Pros**: Can still chart "how many distinct hosts" or "how many distinct
  recurrence patterns" without exposing the raw strings.
- **Cons**: Salt must be seeded lazily into `system_config` on first access;
  the salt value must itself never appear in the response (covered by the
  forbidden-substring test).

**Chosen** for hostnames (`web_fetch_cache`) and rrule patterns (`recurring_tasks`).

#### Option 3: Forbidden-substring redaction test as a regression guard

A dedicated `tests/stats/redaction.test.ts` seeds distinctive marker strings
into every text column in scope, calls both `/stats/*` routes, and asserts
none of the markers appear anywhere in the serialised JSON response.

**Chosen** as a belt-and-suspenders complement to the structural envelope.

### Client application architecture

#### Option 1: Billing and stats components in `client/debug/billing/` and `client/debug/stats/`

This was the original plan assumption — extend the existing debug app with new
subdirectories.

- **Pros**: Single build entry point; re-uses existing debug app state.
- **Cons**: Conflates engineer-facing debug observability (live event stream,
  log explorer, turn trace) with operator-facing admin surfaces (billing,
  credentials, stats). Permission semantics differ: the debug surface is
  engineer-only; the admin surface is operator-facing.

**Rejected** during Phase 3 implementation.

#### Option 2: Separate `client/admin/` application (chosen)

A distinct `client/admin/` app with its own `AdminApp.svelte` entry, sections
(`BillingSection`, `StatsSection`, `SystemSection`, `OverviewSection`, etc.),
and shared components (`SubjectsTable`, `SubjectDetail`, `CredentialsForm`,
`StatsPanel`, `SubjectStatsPanel`). Served at `/admin` from the same debug
server.

- **Pros**: Clean separation of concerns; admin surface can evolve independently;
  `client/debug/` remains the pure observability surface.
- **Cons**: Second build entry point; some types must be shared via
  `client/shared/api-types.ts`.

**Chosen.** The split aligns with the existing CLAUDE.md description of `/debug`
(engineer/live observability) and `/admin` (operator/configuration and durable
records).

## Decision

Implement a five-phase roadmap:

**Phase 1 — Central LLM credentials (env-only)**

- Migration 034: `system_config(key PK, value, updated_at, updated_by)`.
- Migration 036: delete LLM keys from `user_config` (with JSONL backup).
- `src/system-config.ts`: `getSystemConfig`, `setSystemConfig`,
  `seedSystemConfigFromEnv`, `isSystemConfigComplete`, `missingSystemConfigKeys`.
- On startup, `seedSystemConfigFromEnv()` inserts missing rows from five env vars;
  `src/index.ts` calls it after `initDb()`.
- Orchestrator reads LLM config from `system_config` instead of `user_config`.
  Replies "bot misconfigured" when required keys are missing; notifies admin DM once.
- Wizard LLM steps removed; per-user LLM keys removed from `CONFIG_KEYS` /
  `SENSITIVE_KEYS` / `user_config` schema.

**Phase 2 — Usage telemetry recording**

- Migration 035: `llm_usage_events` with indexes on subject, user, turn, time.
- `src/usage/`: `types.ts`, `recorder.ts` (`recordUsage`), `query.ts`
  (`listSubjects`, `getSubjectDetail`), `index.ts` (`initUsageRecorder`).
- `initUsageRecorder()` subscribes to the event bus; dispatches `llm:end` →
  `recordFromLlmEnd` and `llm:error` → `recordFromLlmError`. Recorder exceptions
  are caught and logged; other subscribers continue to fire.
- `emitLlmEnd` / `emitLlmError` extended with `chatUserId` and `contextType`.
- Embedding callsites (`src/embeddings.ts`) and `src/web/distill.ts` record rows
  with `model_role: 'embedding'` and `model_role: 'small'` respectively.

**Phase 3 — Billing dashboard + admin credentials form**

- `src/debug/billing.ts`: `listBillingSubjects`, `getBillingDetail`, window
  helpers. Display names from `users.username`; null for groups.
- `src/debug/admin-llm.ts`: `getAdminLlmSnapshot` (masked `llm_apikey`),
  `applyAdminLlmUpdate` (Zod-validated, writes via `setSystemConfig`).
- `src/debug/billing-routes.ts`: `GET /billing/subjects`, `GET /billing/subject/:id`,
  `GET /admin/llm`, `POST /admin/llm`.
- `src/debug/subject-display-name.ts`: extracted resolver used by billing and
  stats.
- `client/admin/`: `BillingSection.svelte`, `SystemSection.svelte`,
  `SubjectsTable.svelte`, `SubjectDetail.svelte`, `CredentialsForm.svelte`.
  Served at `/admin`.
- `POST /admin/llm` returns 401 when `DEBUG_TOKEN` is unset; 503 when
  `ADMIN_USER_ID` is unset; 400 on bad key or empty value.

**Phase 4 — Tool-call rows + idempotency hardening**

- Migration 037: `tool_call_events(event_id PK, turn_id, tool_name, tool_call_id,
success, duration_ms, args_bytes, result_bytes, error_type, error_code,
retryable, recovered, forwarded_at, forward_attempts, forward_error, …)`.
- Migration 038: outbox columns (`forwarded_at`, `forward_attempts`,
  `forward_error`) + partial index on `llm_usage_events`.
- `src/usage/event-id.ts`: `toolCallEventId(turnId, toolCallId)` and
  `usageEventId(turnId, responseId, modelRole, occurredAt)` — both SHA-256.
- `src/usage/recorder.ts`: switched from `randomUUID` to `usageEventId`;
  constraint violations logged at `warn`, not thrown.
- `src/usage/tool-call-recorder.ts`: `recordToolCall`, `updateToolCallClassification`
  (with 100ms retry for the classification-before-insert race).
- `src/llm-orchestrator-invoke.ts`: `argsBytes` / `resultBytes` computed and
  emitted on `tool:execute_end`; context fields threaded through.
- `src/usage/query.ts`: `listToolCallsForTurn`, `summarizeToolCallsBySubject`.

**Phase 5 — Anonymous DB-wide statistics**

- `src/stats/types.ts`: `SubjectStats`, `GlobalStats`, `Percentiles`, sub-types.
- `src/stats/aggregate.ts`: `percentiles()` — pure function, input-order invariant.
- `src/stats/hashing.ts`: `keyedHash()` — SHA-256 over `(value + stats_anonymity_salt)`;
  salt auto-seeded into `system_config` on first call.
- `src/stats/per-table*.ts`, `src/stats/global-*.ts`: per-subject and global
  query helpers covering memos, recurring tasks, instructions, attachments,
  message_metadata, conversation history, identity mappings, staged files,
  user/group blocks, web rate-limit, llm_usage_events, tool_call_events.
- `src/stats/index.ts`: `getSubjectStats(id)`, `getGlobalStats(opts)`;
  per-window Map cache with 60s TTL.
- `src/debug/stats-routes.ts`: `GET /stats/global`, `GET /stats/subject/:id`
  — bearer-token gated when `DEBUG_TOKEN` is set.
- `tests/stats/redaction.test.ts`: forbidden-substring contract test across
  every text column in scope.
- `tests/stats/perf.test.ts`: 1k subjects + 100k `message_metadata` rows in
  < 1000ms.
- `client/admin/`: `StatsSection.svelte`, `StatsPanel.svelte`,
  `SubjectStatsPanel.svelte`.

## Rationale

- **Phased delivery** allowed Phase 1 (highest-risk, hot-path credential change)
  to soak before Phase 2 (additive, low-risk recorder) and Phase 3 (new UI
  surface) opened.
- **Event bus subscription** for the recorder keeps the hot path unchanged: the
  orchestrator emits events it already emits; the recorder is a pure subscriber
  with a catch. The bus is a `Set` of functions; if the recorder throws, the
  event is swallowed at the recorder boundary, not the bus.
- **Structural anonymity** (number/enum schema) is the primary protection;
  the **forbidden-substring regression test** is the secondary guard. Neither
  relies on runtime filtering logic that could drift.
- **Per-window cache** for global stats (`Map<StatsWindow, {value, expiresAt}>`)
  is better than the plan's single-slot cache: each window has an independent
  60s TTL, so a 7d view and a 30d view do not evict each other.
- **`client/admin/`** split reflects the access model: engineers use `/debug`
  for live observability; operators use `/admin` for configuration and durable
  records. Keeping them in separate Svelte apps makes the permission semantics
  explicit and the build outputs independently cacheable.

## Consequences

### Positive

- New users receive useful replies with no `/setup` LLM steps.
- Bot admin can update API key from the dashboard; change takes effect on the
  next LLM call without restart.
- Every LLM turn and tool execution produces a durable, idempotent row usable
  for billing research, rate-limit planning, and capacity estimation.
- Anonymous stats routes provide structural metrics on memo usage, recurring
  task density, attachment storage, and active-subject counts — all without
  exposing any user content.
- The forbidden-substring test creates a regression baseline: any future query
  that accidentally returns content fails the test before shipping.

### Negative

- `system_config` rows are seeded from env vars on first boot and are
  **not automatically updated** if the env var changes on a subsequent restart;
  the admin must use the dashboard form or a direct SQL update. This is
  intentional: the form is the authoritative update path post-Phase 3.
- Migration 036 is **destructive**: per-user LLM keys in `user_config` are
  deleted (with a JSONL backup written before deletion). Rollback restores the
  code surface but not the per-user data.
- The `client/admin/` split adds a second Svelte entry point and a
  `client/shared/api-types.ts` shim. New admin surfaces must be added to
  `client/admin/`, not `client/debug/`.
- `POST /admin/llm` returns 401 (not 404) when `DEBUG_TOKEN` is unset —
  it actively refuses writes rather than silently accepting them. This is
  intentional but can surprise operators who expect 404 on an unprotected port.

### Risks

- **Salt-rotation risk**: `stats_anonymity_salt` is seeded once and never
  rotated automatically. Rotating it invalidates all keyed-hash values already
  in the response cache. The salt is documented as deployment-scoped; rotation
  is a deliberate operator action only.
- **Phase 4 `response_id` on tool-call rows is null in v1**: `result.response.id`
  is only available at the end of the LLM turn, after tool-call finish events
  have already fired. Backfilling is a follow-on enhancement; `response_id` is
  nullable by design.
- **Tool-call classification race**: `updateToolCallClassification` can be called
  before the `recordToolCall` INSERT commits (the `tool:failure_classified` event
  fires asynchronously). A 100ms `setTimeout` retry covers the common case; if the
  retry also finds no row, it logs `warn` and drops the classification. The
  INSERT is always attempted first; losing a classification update is preferable
  to losing the event row.

## Implementation Status Detail

### Migrations

| Migration | File                                               | Test                                                      |
| --------- | -------------------------------------------------- | --------------------------------------------------------- |
| 034       | `src/db/migrations/034_system_config.ts`           | `tests/db/migrations/034_system_config.test.ts`           |
| 035       | `src/db/migrations/035_llm_usage_events.ts`        | `tests/db/migrations/035_llm_usage_events.test.ts`        |
| 036       | `src/db/migrations/036_drop_user_llm_config.ts`    | `tests/db/migrations/036_drop_user_llm_config.test.ts`    |
| 037       | `src/db/migrations/037_tool_call_events.ts`        | `tests/db/migrations/037_tool_call_events.test.ts`        |
| 038       | `src/db/migrations/038_llm_usage_events_outbox.ts` | `tests/db/migrations/038_llm_usage_events_outbox.test.ts` |

### Server Modules

| Module                              | Routes / Exports                                                   | Tests                                                                      |
| ----------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `src/system-config.ts`              | `getSystemConfig`, `setSystemConfig`, `seedSystemConfigFromEnv`, … | `tests/system-config.test.ts`                                              |
| `src/usage/recorder.ts`             | `recordUsage`                                                      | `tests/usage/recorder.test.ts`                                             |
| `src/usage/index.ts`                | `initUsageRecorder`                                                | `tests/usage/recorder-integration.test.ts`                                 |
| `src/usage/query.ts`                | `listSubjects`, `getSubjectDetail`, `listToolCallsForTurn`, …      | `tests/usage/query.test.ts`                                                |
| `src/usage/event-id.ts`             | `usageEventId`, `toolCallEventId`                                  | `tests/usage/event-id.test.ts`                                             |
| `src/usage/tool-call-recorder.ts`   | `recordToolCall`, `updateToolCallClassification`                   | `tests/usage/tool-call-recorder.test.ts`                                   |
| `src/debug/billing.ts`              | `listBillingSubjects`, `getBillingDetail`                          | `tests/debug/billing.test.ts`                                              |
| `src/debug/admin-llm.ts`            | `getAdminLlmSnapshot`, `applyAdminLlmUpdate`                       | `tests/debug/admin-llm.test.ts`                                            |
| `src/debug/billing-routes.ts`       | `/billing/subjects`, `/billing/subject/:id`, `/admin/llm`          | `tests/debug/billing-route.test.ts`, `tests/debug/admin-llm-route.test.ts` |
| `src/debug/subject-display-name.ts` | `resolveDisplayName`, `resolveContextTypeFromUsage`                | `tests/debug/subject-display-name.test.ts`                                 |
| `src/debug/stats-routes.ts`         | `/stats/global`, `/stats/subject/:id`                              | `tests/debug/stats-routes.test.ts`, `tests/debug/server-stats.test.ts`     |
| `src/stats/index.ts`                | `getSubjectStats`, `getGlobalStats`                                | `tests/stats/index.test.ts`                                                |
| `src/stats/hashing.ts`              | `keyedHash`                                                        | `tests/stats/hashing.test.ts`                                              |
| `src/stats/aggregate.ts`            | `percentiles`                                                      | `tests/stats/aggregate.test.ts`                                            |
| `src/stats/per-table*.ts`           | Per-subject query helpers                                          | `tests/stats/per-table-*.test.ts`                                          |
| `src/stats/global-*.ts`             | Global query helpers                                               | `tests/stats/global-*.test.ts`                                             |

### Client Modules

| Module                           | Location                                           | Tests                                                  |
| -------------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Billing section + subject detail | `client/admin/sections/BillingSection.svelte`      | `tests/client/admin/billing/`                          |
| Credentials form                 | `client/admin/components/CredentialsForm.svelte`   | `tests/client/admin/billing/`                          |
| Stats section                    | `client/admin/sections/StatsSection.svelte`        | `tests/client/admin/StatsPanel.test.ts`                |
| Subject stats sub-panel          | `client/admin/components/SubjectStatsPanel.svelte` | `tests/client/admin/billing/SubjectStatsPanel.test.ts` |
| Admin fetchers                   | `client/admin/fetchers.ts`                         | `tests/client/admin/fetchers.test.ts`                  |

### Anonymity Contract Tests

- `tests/stats/redaction.test.ts` — forbidden-substring contract (20 marker/column pairs)
- `tests/stats/perf.test.ts` — 1k subjects + 100k `message_metadata` rows < 1000ms

## Notable Deviations from Plan

1. **`usageEventId` takes 4 arguments, not 3.**
   Plan: `(turnId, responseId, modelRole)`. Implementation:
   `(turnId, responseId, modelRole, occurredAt)`. `occurredAt` prevents false PK
   collisions between embedding and main-model events that a provider returns
   with the same static response id.

2. **Client components in `client/admin/`, not `client/debug/billing/`.**
   Plans assumed billing and stats components would extend the debug app.
   Implementation created a separate `client/admin/` application. See
   Considered Options above.

3. **`per-table.ts` split across multiple files.**
   Plan described a single `src/stats/per-table.ts`. Implementation split it
   into `per-table.ts`, `per-table-content.ts`, `per-table-subject.ts`,
   `per-table-usage.ts`, `global-distributions.ts`, `global-llm.ts`,
   `global-mix.ts`, `global-subjects.ts`, `global-web-tools.ts` for better
   separation of concerns.

4. **Migration 039 used for plugins, not stats indexes.**
   Plans reserved 039 as a contingency for stats performance indexes. The
   perf bench passed without additional indexes, so 039 was consumed by the
   plugin system (`039_plugins.ts`). Consistent with the plan's conditional:
   "add missing indexes in 5a only if a required query degrades."

5. **Global stats cache is per-window, not a single slot.**
   Plan described invalidation "when window changes." Implementation uses
   `Map<StatsWindow, {value, expiresAt}>` so each window has an independent
   60s TTL. Better behaviour under concurrent requests with different windows.

6. **`BillingPanel.svelte` renamed to `BillingSection.svelte`.**
   The section naming convention follows the `client/admin/sections/` layout,
   where all top-level admin panels are named `*Section.svelte`.

## Forward Work

- **Phase 5b — `usage_snapshots` table**: A nightly job writing per-subject
  metric snapshots to a `usage_snapshots(snapshot_at, subject_id, metric, value)`
  table would enable growth-over-time charts without re-querying `message_metadata`
  on every dashboard open. Deferred until live-query latency becomes observable.
- **`response_id` backfill on tool-call rows**: Populate `response_id` on
  `tool_call_events` rows at `llm:end` time once a turn's response id is known.
- **Group display-name resolver**: Currently `displayName` is null for groups.
  A future enrichment pass could join `known_group_contexts.display_name`.
- **Metering-vendor forwarder**: The outbox columns (`forwarded_at`,
  `forward_attempts`, `forward_error`) on both event tables are schema slots for
  a future worker that ships rows to a billing vendor. The schema exists; no
  worker has been built.
- **External task counts**: Kaneo / YouTrack row counts are out of scope for
  the stats surface; the closest local proxies are `users.kaneoWorkspaceId`
  presence and task-id references in `message_metadata`.

## Related Decisions

- ADR-0042: Bot Configuration Wizard — wizard steps removed by Phase 1.
- ADR-0057: Incremental Dependency Injection — DI pattern used throughout
  `src/usage/` and `src/stats/` modules.
- ADR-0087: Debug Dashboard Expansion — the admin/debug split this ADR
  documents supersedes the earlier single-app assumption.

## References

- Roadmap: `docs/archive/2026-05-19-central-llm-billing-roadmap.md`
- Design (overall): `docs/archive/2026-05-19-central-llm-billing-design.md`
- Phase 1 design + plan: `docs/archive/2026-05-19-phase-1-central-llm-credentials-design.md`, `docs/archive/2026-05-19-phase-1-central-llm-credentials-plan.md`
- Phase 2 design + plan: `docs/archive/2026-05-19-phase-2-usage-recorder-design.md`, `docs/archive/2026-05-19-phase-2-usage-recorder-plan.md`
- Phase 3 design + plan: `docs/archive/2026-05-19-phase-3-billing-dashboard-design.md`, `docs/archive/2026-05-19-phase-3-billing-dashboard-plan.md`
- Phase 4 design + plan: `docs/archive/2026-05-20-phase-4-tool-call-rows-design.md`, `docs/archive/2026-05-20-phase-4-tool-call-rows-plan.md`
- Phase 5 design + plan: `docs/archive/2026-05-20-phase-5-anonymous-stats-design.md`, `docs/archive/2026-05-20-phase-5-anonymous-stats-plan.md`
