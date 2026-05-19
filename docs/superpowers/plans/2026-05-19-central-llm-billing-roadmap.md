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

## Cross-phase concerns

### Branch strategy
One branch per phase, off `main`. Naming:
- `claude/central-llm-phase-1-env-credentials`
- `claude/central-llm-phase-2-usage-recorder`
- `claude/central-llm-phase-3-billing-dashboard`

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

### Security review checkpoints
- Phase 1: `bun security` after wizard changes (prompt injection surface
  for the new misconfigured-bot reply).
- Phase 3: dedicated `/security-review` of the credentials form route.
  Token in the request body must be redacted from access logs.

### Documentation updates
- Phase 1: `CLAUDE.md` env-var section gains `LLM_API_KEY`,
  `LLM_BASE_URL`, `MAIN_MODEL`, `SMALL_MODEL`, `EMBEDDING_MODEL` as
  required at startup. `llm_apikey` and friends leave the runtime config
  key list.
- Phase 2: no doc change; module is internal.
- Phase 3: dashboard guide (if one exists) gets a Billing section.

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
                                                                  ...
```

No phase opens its plan stage until the prior phase has merged. Each
phase brings the codebase to a shippable state on its own.
