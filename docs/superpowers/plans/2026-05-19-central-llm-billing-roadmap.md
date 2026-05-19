# Central LLM + Billing — Phased Rollout Plan

**Date:** 2026-05-19
**Status:** Draft
**Design reference:** [`../specs/2026-05-19-central-llm-billing-design.md`](../specs/2026-05-19-central-llm-billing-design.md)
**Branch baseline:** `claude/central-llm-billing-design-HTCaV`

## Why phase this work

The design doc covers three distinct concerns wired together: removing BYOK,
recording usage, and surfacing it on the dashboard. They share a goal but
not a blast radius:

- The credential change is user-visible and touches the message hot path.
- The telemetry change is silent and additive.
- The dashboard change is admin-only and isolated.

Shipping them as one branch couples three reviews and three release
windows. Splitting them lets each phase land, soak, and unblock the next.

Each phase runs through the same five-step workflow:

1. **Brainstorm** — short open exploration; alternatives, trade-offs, open
   questions. Output: a brainstorm note in `docs/superpowers/notes/`.
2. **Design** — chosen approach with decisions and non-goals. Output: a
   design doc in `docs/superpowers/specs/` (this rollout already has one
   covering the whole scope; per-phase design docs refine it).
3. **Planning** — sequenced implementation steps with file edits, tests,
   migration ordering, rollback. Output: a plan in
   `docs/superpowers/plans/`.
4. **Implementation** — one feature branch per phase, merged when green.
5. **Review** — security pass, manual smoke, dashboard walkthrough where
   applicable. Output: review comments on the PR.

## Phase 1 — Central LLM credentials, env-only

### Goal

New users can DM the bot and get a useful reply without entering an LLM API
key. Bot admin sets credentials once via environment variables.

### Scope

- Migration 034: create `system_config` table.
- Migration 036: delete the five LLM keys from `user_config`.
- On startup, seed `system_config` from `LLM_API_KEY`, `LLM_BASE_URL`,
  `MAIN_MODEL`, `SMALL_MODEL`, `EMBEDDING_MODEL` when rows are missing.
- `src/llm-orchestrator-config.ts` reads LLM keys from `system_config`
  instead of `user_config`.
- `src/wizard/steps.ts`: remove the five LLM wizard steps.
- `src/types/config.ts`: drop `LlmConfigKey` and the LLM entries in
  `CONFIG_KEYS` / `ALL_CONFIG_KEYS`.
- `src/config.ts`: drop `copyAdminLlmConfig`, `isMissingLlmConfig`,
  `LLM_COPY_KEYS`, `llm_apikey` from `SENSITIVE_KEYS`.
- `src/providers/kaneo/provision.ts`: drop `copyAdminLlmConfig` callsites.
- Orchestrator emits a "bot misconfigured" reply when `system_config` is
  empty, instead of "complete /setup".

### Out of scope for this phase

- No dashboard admin form. Credentials change requires env update + restart.
- No usage telemetry table — phase 2.
- No billing UI — phase 3.

### Risk profile

Highest of the three. Touches the hot path, deletes user data, removes a
wizard branch. Needs careful staging.

### Acceptance

- Fresh-install bot with `LLM_API_KEY` env set answers a first message
  with no `/setup` interaction beyond task provider + timezone.
- Existing users keep working: migration drops their LLM rows; bot now
  reads admin's env-seeded keys.
- All existing tests pass; new tests cover the migration and the new
  resolution path.

### Rollback

- Revert the orchestrator and wizard code changes; the `system_config`
  rows can stay (harmless once unused).
- Migration 036 (the destructive one) is one-way at the data level; a
  rollback restores BYOK as a code surface but the per-user keys users
  previously typed are gone. Mitigate by exporting `user_config` rows to
  a backup file before migration 036 runs.

### Estimated size

~600 lines code + migrations, ~400 lines tests.

---

## Phase 2 — Usage telemetry recording

### Goal

Every `llm:end` event becomes a durable row in `llm_usage_events`. No UI
yet. The bot collects pricing data silently so phase 3 has something to
show.

### Scope

- Migration 035: create `llm_usage_events` table + indexes.
- `src/db/schema.ts`: add Drizzle table.
- `src/usage/` module:
  - `recorder.ts` — `recordUsage(payload)` inserts one row.
  - `index.ts` — `initUsageRecorder()` subscribes to the event bus.
  - `query.ts` — read helpers (used by phase 3 but landed here so the
    public surface is testable end-to-end).
  - `types.ts` — `UsageEvent`, `SubjectSummary`, `RequestRow`.
- `src/index.ts`: call `initUsageRecorder()` after DB init.
- Cover both main-model and embedding callsites. `src/embeddings.ts:18`
  and `src/web/distill.ts:88` are the embedding entry points; route them
  through a thin wrapper that emits a recorder-shaped event (or extend
  `emitLlmEnd` with a `modelRole` parameter — design call inside the
  phase 2 brainstorm).
- Idempotency: ULID per event, generated in-process. `event_id` is a
  primary key — duplicate inserts fail loudly in tests, never silently.

### Out of scope for this phase

- No HTTP routes — phase 3.
- No dashboard tab — phase 3.
- No tool-call rows; per-request `tool_call_count` is enough.
- No daily roll-ups; raw query works at this volume.

### Risk profile

Low. Additive table, additive module. Recorder failures must not break
the event bus — wrapped in try/catch with log, no rethrow.

### Acceptance

- After a real LLM call, one row appears in `llm_usage_events` with
  populated tokens, model, model role, turn id, both subject ids.
- Failed `llm:end` (error path) still produces a row with `error` set.
- A recorder exception is logged and dropped; other subscribers
  (`state-collector`, telemetry) continue to fire.
- New `tests/usage/*` suite exercises recorder + query in isolation
  using DI; query results match raw SQL on a seeded fixture.

### Rollback

Drop the migration; remove the `initUsageRecorder()` call. Fully
reversible.

### Estimated size

~400 lines code + migration, ~500 lines tests.

---

## Phase 3 — Billing dashboard tab + admin credentials form

### Goal

Bot admin opens the dashboard, sees subjects sorted by tokens, drills
into one, and updates LLM credentials without restarting.

### Scope

- `src/debug/server.ts`: routes
  - `GET /billing/subjects?window=30d`
  - `GET /billing/subject/:id?window=30d`
  - `GET /admin/llm`
  - `POST /admin/llm`
- `src/system-config.ts`: `setSystemConfig(key, value, adminId)` writes
  to the table created in phase 1. Bot admin is authenticated by the
  same `DEBUG_TOKEN` that gates the dashboard.
- Subject display-name resolver: join to `users.username` for DMs, to
  `authorized_groups` / `group_user_observations` for groups, fall back
  to raw id.
- `client/debug/dashboard-types.ts`: add `billingSubjects`,
  `billingDetail` to `DashboardState`.
- `client/debug/dashboard.svelte.ts`: new "Billing" tab.
- New components:
  - `client/debug/billing/SubjectsTable.svelte` — sortable list with
    main / small / embedding columns.
  - `client/debug/billing/SubjectDetail.svelte` — virtualized per-request
    table, expandable rows.
  - `client/debug/billing/CredentialsForm.svelte` — masked display +
    edit-to-replace input per key.
- Window selector: 24h / 7d / 30d / all.

### Out of scope for this phase

- No charts (explicitly "very basic").
- No CSV export.
- No DM `/admin` command — credentials still change via dashboard only.
- No tool-call drill-down beyond the per-turn count.

### Risk profile

Medium. New UI surface; only visible to admin. The credentials form is
the new sensitive surface and needs a security review.

### Acceptance

- Billing tab loads, lists subjects with totals matching a
  hand-rolled SQL aggregate over `llm_usage_events`.
- Clicking a subject shows its request rows; row expansion shows
  per-request JSON.
- Admin pastes a new API key into the form; bot's next LLM call uses it
  without restart.
- Form rejects unauthenticated requests with 401; admin route audit log
  records the change with `updated_by`.

### Rollback

Remove the new routes and the Billing tab; data tables stay.

### Estimated size

~500 lines server code + tests, ~800 lines client code + tests.

---

## Phase 4 (proposed) — Tool-call rows + idempotency hardening

Listed for visibility, not committed.

### Possible scope

- New `tool_call_events` table mirroring `llm_usage_events` shape, keyed
  by `turn_id`.
- Switch `event_id` to a deterministic hash of
  `(responseId, occurredAt, modelRole)` so the recorder is safe outside
  the in-process bus (queue, retry).
- Cross-process outbox columns: `forwarded_at`, `forward_attempts`,
  `forward_error`. No worker yet — just the schema slot.

### Trigger to start

Phase 3 data shows tool-call cost is material, or the billing research
moves toward a metering vendor and the outbox path is needed.

---

## Phase 5 — Anonymous DB-wide statistics

### Goal

Bot admin can see structural counts and sizes for every domain table in
the bot's SQLite database, per billing subject and bot-wide, without
exposing any content. The dataset answers questions the billing research
flags as inputs to pricing: how heavy is the median user, what's the
right cap on memos or recurring tasks per tier, which surfaces are
amplifiers vs niche. Aligns with
`docs/research/billing/06-papai-integration-notes.md` §3 (cost-amplifier
surfaces) and `04-metering-and-telemetry.md` §1 (candidate billable
units).

### Anonymity contract

Counts, sizes, timestamps, and enum distributions only. Never content,
never usernames, never message text, never memo bodies, never
attachment filenames. The only identifiers in the output are
`storage_context_id` and `chat_user_id`, both already opaque platform
ids — which the dashboard already exposes. A second "global stats" view
suppresses even those, returning only aggregates and distributions
suitable for screenshotting or sharing.

### Scope

#### Per-subject counts (extend the phase 3 subject detail)

For each `storage_context_id`, count rows in:

| Table                                          | Metrics                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memos`                                        | total, by `status` (active / archived / promoted), by `tags` cardinality, total `content` bytes, total `embedding` bytes, oldest / newest `created_at`, count with `embedding IS NOT NULL` |
| `scheduled_prompts`                            | total, pending / fired / cancelled, distinct delivery targets (no target identifiers, just count)                                                                                          |
| `recurring_tasks`                              | total, enabled / disabled, distinct `projectId` count, count with `nextRun` in the next 7d, distinct `rrule` patterns (hashed)                                                             |
| `instructions`                                 | total, total `content` bytes                                                                                                                                                               |
| `attachments`                                  | total, by `status`, by `sourceProvider`, total stored bytes (from manifest), count with `isActive=1`, count by `extension` bucket                                                          |
| `message_metadata`                             | total, by `contextType` derived from id shape, count with `author_id=chat_user_id`, oldest / newest `timestamp`, total `text` bytes (size only)                                            |
| conversation history                           | turn count per subject, summary count, total summarized bytes                                                                                                                              |
| `user_identity_mappings`                       | count per provider name                                                                                                                                                                    |
| `staged_files`                                 | count, by `status`, total bytes                                                                                                                                                            |
| `users` (for subjects that are users)          | `addedAt`, `addedBy` presence, `kaneoWorkspaceId` presence                                                                                                                                 |
| `group_members` (for subjects that are groups) | member count, distinct `addedBy` count                                                                                                                                                     |
| `group_user_observations`                      | observation count per group; **counts only**, never observation text                                                                                                                       |
| `web_fetch_cache`                              | distinct hosts (hashed), total fetches per subject if join is feasible, bytes stored                                                                                                       |
| `llm_usage_events`                             | already in phase 3; included here for completeness                                                                                                                                         |
| tool-failures (already in dashboard)           | count per subject, per `errorType` distribution                                                                                                                                            |

#### Bot-wide aggregates (new "Stats" tab)

- Total subjects (DM users, groups), with growth chart over the last 30d
  from `users.addedAt` and `authorized_groups.addedAt`.
- Per-table totals + distribution percentiles (p50/p90/p99 per subject)
  for memo count, recurring task count, message count, attachment bytes.
- Active-subject counts at 1d / 7d / 30d windows derived from
  `llm_usage_events.occurred_at` (phase 2) and
  `message_metadata.timestamp`.
- Storage footprint: SQLite `page_count * page_size`, plus S3 bucket
  total bytes from the manifest tally.
- Identity-provider mix: how many subjects have mapped to Kaneo vs
  YouTrack identity.
- Recurring vs deferred mix: how many subjects use each surface.
- Web fetch volume by hashed host (top 20 by count, hosts hashed).
- Tool usage mix: rolled up from `llm_usage_events.tool_call_count`,
  refined if phase 4 ships the per-tool table.

External tasks (Kaneo / YouTrack) are out of scope — the bot doesn't
own that data. The closest local proxies are `users.kaneoWorkspaceId`
presence and any task-id references stored in `message_metadata`; we
report those without leaving the local DB.

#### Optional time series — migration 037 (deferred decision)

A `usage_snapshots(snapshot_at INTEGER, subject_id TEXT, metric TEXT,
value INTEGER)` table written by a nightly job lets the dashboard chart
growth. Recommendation: **defer to phase 5b**. The phase 5a slice
queries live tables on demand. Add the snapshot table only once the
queries are too slow to run on every dashboard open — typically when
`memos` or `message_metadata` cross a few hundred thousand rows.

#### Module sketch

```
src/stats/
  index.ts           — public API: getSubjectStats(id), getGlobalStats()
  per-table.ts       — one query function per source table
  aggregate.ts       — distribution math (percentiles), bucketing helpers
  hashing.ts         — keyed hash for rrule patterns + hostnames
  types.ts           — SubjectStats, GlobalStats
```

Server routes (phase 5a):

- `GET /stats/subject/:id` — per-subject stats blob.
- `GET /stats/global` — bot-wide aggregates.

Dashboard:

- Subject detail in the Billing tab gains a "Stats" sub-panel.
- New top-level "Stats" tab shows the bot-wide view.

### Out of scope for this phase

- No content, ever — even hashed. Hashing applies to rrule strings and
  hostnames, both already non-PII-ish, only to dedupe for distribution
  charts without exposing the raw value.
- No mutation: this phase is read-only against the existing tables.
- No external provider calls (no live Kaneo `count_tasks`); we count
  what the bot stored locally and label external-task counts as
  unknown.
- No CSV / JSON export to disk in v1; the dashboard rendering is the
  output. Export is straightforward to add later from the same API.
- No time series; reconsider in 5b.

### Risk profile

Low. Read-only queries against existing tables, no schema change in
5a. Main risk is query cost on large tables (`message_metadata`,
`memos`) — mitigated by:

- index check during planning; add missing indexes in 5a only if a
  required query degrades.
- caching the global view for 60s in-process; per-subject views are
  fast enough to compute on click.

### Acceptance

- `/stats/global` returns shapes documented in `types.ts` and matches
  hand-rolled SQL aggregates on a seeded fixture.
- `/stats/subject/:id` returns counts that sum to the totals in the
  global view, modulo the time window.
- No raw text, filename, memo body, message body, observation text, or
  username appears in the response payload for either route — covered
  by a redaction-style test that diffs the response against a forbidden
  substring list.
- Global view renders with 1k seeded subjects + 100k seeded
  `message_metadata` rows in under 500ms (in-process, on a dev laptop).

### Rollback

Remove routes and the new tab. No data to roll back; queries are
read-only.

### Estimated size

~600 lines server code + tests (mostly tests, the queries are short),
~700 lines client code + tests for the Stats tab and sub-panel.

### Open questions to resolve before phase 5 starts

- Anonymity contract — is hashing hostnames in the web-fetch breakdown
  acceptable, or do we omit them entirely? Recommendation: keyed hash
  with a per-deployment salt, so values are deterministic in a single
  deployment but not portable across deployments.
- Bot-wide view — show only when the deployment has more than N subjects
  (to avoid trivial deanonymization in tiny deployments)? Recommendation:
  hide the per-subject id from global view always; show distribution
  shapes only.
- Time series — phase 5a (live queries) or jump straight to 5b
  (`usage_snapshots`)? Recommendation: 5a first; the snapshot table
  earns its place once we see live-query latency, not before.
- External task counts (Kaneo / YouTrack) — defer entirely, or call the
  provider tool's `count_tasks` per subject lazily on dashboard open?
  Recommendation: defer. Live provider calls turn a stats page into a
  rate-limit risk surface.
- Conversation history — currently stored as turns plus summaries; what
  exactly do we count? Recommendation: turn count and summary count
  only; ignore byte-size of historical text in 5a.

### Trigger to start

After phase 3 ships and the Billing tab is in operator hands long
enough to know which secondary stats they keep asking SQL for.

---

## Cross-phase concerns

### Branch strategy

One branch per phase, off `main`. Naming:

- `claude/central-llm-phase-1-env-credentials`
- `claude/central-llm-phase-2-usage-recorder`
- `claude/central-llm-phase-3-billing-dashboard`
- `claude/central-llm-phase-5-anonymous-stats` (phase 4 named when scoped)

Each phase merges before the next opens. The design doc and this plan
land first (current branch).

### Migration ordering

Phase 1: 034, 036. Phase 2: 035. The numeric gap is intentional — 035
lands second but ordering by phase is the user-facing contract.

If phase 1 ships first and phase 2 is delayed, the table count is
consistent: `system_config` exists, `llm_usage_events` does not. No
runtime check assumes 035's presence.

### Test strategy per phase

- Phase 1: extend `tests/llm-orchestrator-config.test.ts`,
  `tests/wizard/steps.test.ts`, new `tests/db/migrations/034-*` and
  `036-*`. Manual smoke: fresh container with env vars only.
- Phase 2: `tests/usage/*` from scratch, isolated with DI. Manual smoke:
  one real conversation, eyeball the row.
- Phase 3: `tests/debug/server-billing.test.ts`,
  `tests/client/billing/*`. Manual smoke: dashboard walkthrough with two
  seeded subjects.
- Phase 5: `tests/stats/*` from scratch — per-table query tests against
  seeded fixtures, redaction test that scans the response payload for
  any forbidden substring (memo bodies, usernames, message text,
  filenames). Manual smoke: seed 1k subjects + 100k messages, open the
  global Stats tab, confirm latency budget.

### Security review checkpoints

- Phase 1: `bun security` after wizard changes (prompt injection surface
  for the new misconfigured-bot reply).
- Phase 3: dedicated `/security-review` of the credentials form route.
  Token in the request body must be redacted from access logs.
- Phase 5: dedicated `/security-review` of the anonymity contract.
  Reviewer's checklist: every query returns counts/sizes/timestamps
  only; every string field in the response is either an opaque id, an
  enum, a keyed-hash, or a number-as-string; the forbidden-substring
  test exists and passes. Treat any leak of content as a release-
  blocking defect.

### Documentation updates

- Phase 1: `CLAUDE.md` env-var section gains `LLM_API_KEY`,
  `LLM_BASE_URL`, `MAIN_MODEL`, `SMALL_MODEL`, `EMBEDDING_MODEL` as
  required at startup. `llm_apikey` and friends leave the runtime config
  key list.
- Phase 2: no doc change; module is internal.
- Phase 3: dashboard guide (if one exists) gets a Billing section.
- Phase 5: dashboard guide gets a Stats section, plus an "Anonymity
  contract" subsection in `CLAUDE.md` (or a sibling `docs/stats.md`)
  spelling out which fields are exposed and which are forbidden, so
  future contributors don't widen the surface accidentally.

### Open questions to resolve before each phase starts

Phase 1:

- Do we hard-fail on missing env vars at startup, or boot and reply
  "bot misconfigured" until the admin sets them via dashboard
  (which phase 1 does not have)? Recommendation: hard-fail in phase 1
  because there is no other way to set them yet; relax to soft-fail
  when phase 3 lands the admin form.
- Should we keep `copyAdminLlmConfig` as dead code through phase 1 and
  remove in phase 2, or remove immediately? Recommendation: remove
  immediately, smaller diff is easier to review.

Phase 2:

- One emit point or three? Main, small, and embedding use the same OpenAI
  client and could share an emitter; separate emitters might be cleaner
  per modelRole. Decide in phase 2 brainstorm.
- Where does embedding token count come from when the call is made by
  `web/distill.ts`? May be unsupported by the provider — store NULL.

Phase 3:

- `displayName` is best-effort. If a group has no recorded title in
  `group_user_observations`, do we hit the chat provider live for the
  name, or show the raw id? Recommendation: raw id only in v1; the live
  lookup belongs in a future enrichment pass.
- Window selector default: 30d feels right, but 7d makes the table
  smaller for ops eyeballing. Pick when the UI lands.

## Sequence diagram (rollout view)

```
              Phase 1 (env credentials)
   |---------------------------------------------|
              brainstorm → design → plan → impl → review → ship
                                                     |
                                                     v
                                  Phase 2 (usage recorder)
                          |--------------------------------|
                            brainstorm → design → plan → impl → review → ship
                                                            |
                                                            v
                                          Phase 3 (billing tab + admin form)
                                  |---------------------------------------|
                                    brainstorm → design → plan → impl → review → ship
                                                                          |
                                                                          v
                                                            Phase 4 (proposed)
                                                                  |
                                                                  v
                                                Phase 5 (anonymous DB stats)
                                          |---------------------------------------|
                                            brainstorm → design → plan → impl → review → ship
```

Phase 5 does not depend on phase 4 — it can land directly after phase 3.
The diagram shows it after 4 only because 4's tool-call rows would feed
phase 5's tool-usage breakdown if available.

No phase opens its plan stage until the prior phase has merged. Each
phase brings the codebase to a shippable state on its own.
