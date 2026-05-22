<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5 — Anonymous DB-Wide Statistics — Implementation Plan

**Date:** 2026-05-20
**Status:** Draft
**Branch:** `claude/central-llm-phase-5-anonymous-stats`
**Per-phase design:** [`../specs/2026-05-20-phase-5-anonymous-stats-design.md`](../specs/2026-05-20-phase-5-anonymous-stats-design.md)
**Brainstorm:** [`../notes/2026-05-20-phase-5-anonymous-stats-brainstorm.md`](../notes/2026-05-20-phase-5-anonymous-stats-brainstorm.md)
**Parent roadmap:** [`2026-05-19-central-llm-billing-roadmap.md`](2026-05-19-central-llm-billing-roadmap.md)

## Sequencing principle

The TDD hook gates every `src/` and `client/` edit on a failing test.
Each step splits into:

- **T**: write the failing test(s).
- **I**: write the implementation that turns the test(s) green.
- **R**: refactor only when there's something to refactor.

Steps are ordered so each leaves the tree green between steps. Within
a step the tree may be red, but never between steps.

Phase 5a is read-only — no migrations and no schema changes. Pure
helpers ship first, then per-table queries, then the orchestrator,
then routes, then the dashboard, then docs.

## Step 0 — Pre-flight

- Create + switch to branch `claude/central-llm-phase-5-anonymous-stats`.
- Confirm `bun test`, `bun typecheck`, `bun lint`, `bun format:check`,
  `bun knip` all clean on baseline.
- Confirm Phase 2/3/4 modules exist:
  - `src/usage/{recorder,index,query,types,event-id,tool-call-recorder}.ts`
  - `src/db/{llm-usage-events-schema,tool-call-events-schema,system-config-schema}.ts`
  - `src/debug/{billing,billing-routes,server,admin-llm}.ts`
- Confirm no `src/stats/` directory exists (greenfield).
- No new migration number consumed in 5a. Next migration `039_*` is
  reserved for 5b.

## Step 1 — `src/stats/types.ts`

Pure type-only file. TDD hook still requires a failing test for any
implementation file but `.d.ts`-equivalent type files are typically
covered by the consumers' tests. To keep the hook happy and the type
contract explicit:

**T**: create `tests/stats/types.test.ts` with a single test that
imports each exported interface from `src/stats/types.ts` and
constructs a minimal instance. This fails compilation until the
types exist.

**I**: create `src/stats/types.ts` with the full interface set from
the design's D2:

- `Percentiles`
- `SubjectStats`
- `GlobalStats`
- `GlobalStatsOptions`
- helper sub-types (`MemoStats`, `RecurringStats`, etc.) as needed

No runtime code, no imports beyond types. Re-exported from a future
`src/stats/index.ts`.

## Step 2 — `src/stats/aggregate.ts`

**T**: `tests/stats/aggregate.test.ts`:

- `percentiles([])` returns all zeros, `count: 0`.
- `percentiles([5])` returns `count: 1`, all percentiles = 5.
- `percentiles([1,2,3,4,5,6,7,8,9,10])` returns p50 ≈ 5, p90 ≈ 9,
  p99 ≈ 10, mean = 5.5.
- `percentiles([10,9,8,...,1])` returns the same shape regardless of
  input order (function sorts internally).
- `percentiles([1,1,1,1])` returns all-ones with `count: 4`.

**I**: `src/stats/aggregate.ts` implementing `percentiles(values:
readonly number[]): Percentiles` from the design's D6. Pure function;
no DB or filesystem dependency.

## Step 3 — `src/stats/hashing.ts`

**T**: `tests/stats/hashing.test.ts`:

- Seed `system_config.stats_anonymity_salt` row.
- `keyedHash('foo')` returns 16 hex characters.
- Same input twice returns the same output (determinism).
- Different inputs return different outputs.
- `resetSaltCacheForTests()` + change salt row + next call returns
  a different hash (salt-rotation invalidation).
- First call when no salt row exists creates one and returns a hash;
  the new row is visible in `system_config`.
- Salt value never appears in the hash output (assert the raw salt
  substring is not a prefix or suffix of the hash).

**I**: `src/stats/hashing.ts` per the design's D5. Use
`node:crypto.createHash('sha256')`, `node:crypto.randomBytes` for
seed, `getDrizzleDb()` for `system_config` access.

## Step 4 — Phase 3 display-name resolver extraction

Refactor that decouples Phase 5 from `src/debug/billing.ts:decorate`.

**T**: `tests/debug/subject-display-name.test.ts`:

- Seed a `users` row with a username; assert
  `resolveDisplayName(id, 'dm')` returns the username.
- Seed a `users` row with `username: null`; assert returns `null`.
- For `contextType: 'group'`, assert returns `null` (5a parity with
  Phase 3).
- For unknown `id`, returns `null`.
- Seed an `llm_usage_events` row with `context_type='dm'`; assert
  `resolveContextTypeFromUsage(id)` returns `'dm'`.
- For id with no row, returns `null`.

**I**: create `src/debug/subject-display-name.ts` exporting both
functions. Update `src/debug/billing.ts:decorate` to call them. No
behavior change to the Billing routes; their existing tests still pass.

## Step 5 — `src/stats/per-table.ts` — per-subject helpers

One commit per logical group of helpers to keep diffs reviewable;
each commit lands its T and I together.

### 5a. memos

**T**: `tests/stats/per-table-memos.test.ts`. Seed two subjects' memos
with known counts/status/tags/content length/embedding presence; call
`memosForSubject(id)`; assert all fields of the per-subject memo
block.

**I**: `memosForSubject(storageContextId)` in `src/stats/per-table.ts`.

### 5b. scheduled_prompts + alert_prompts

**T**: `tests/stats/per-table-prompts.test.ts`. Seed scheduled and
alert prompts; call `scheduledForSubject`, `alertsForSubject`; assert
counts and `byStatus`.

**I**: both helpers in `src/stats/per-table.ts`.

### 5c. recurring_tasks

**T**: `tests/stats/per-table-recurring.test.ts`. Seed recurring tasks
with mixed `enabled`, `project_id`, `rrule`, `next_run`; assert
`recurringForSubject` returns correct totals, distinct projects,
`nextRunWithin7d` count, and the keyed-hash distinct rrule count.

**I**: `recurringForSubject` in `src/stats/per-table.ts`; reuses
`keyedHash` for rrule deduplication.

### 5d. user_instructions

**T**: `tests/stats/per-table-instructions.test.ts`. Seed instructions
with known text lengths; assert `instructionsForSubject` returns
`total` and `textBytesTotal`.

**I**: `instructionsForSubject` in `src/stats/per-table.ts`.

### 5e. attachments

**T**: `tests/stats/per-table-attachments.test.ts`. Seed attachments
with mixed status, source_provider, size, is_active, filename
extension; assert `attachmentsForSubject` returns all fields.

**I**: `attachmentsForSubject` in `src/stats/per-table.ts`. Extension
bucket extracted from `filename` in JS after the SQL fetch — keep the
filename in scope only within the function and never on the response.

### 5f. message_metadata

**T**: `tests/stats/per-table-messages.test.ts`. Seed messages with
known timestamps, author_id values, text lengths; assert counts +
text bytes + authored-by-subject count + oldest/newest timestamps.

**I**: `messageMetadataForSubject` in `src/stats/per-table.ts`.

### 5g. conversation history + memory_summary

**T**: `tests/stats/per-table-conversation.test.ts`. Seed
`conversation_history.messages` JSON array (short and long); assert
`conversationForSubject` returns turn count via
`json_array_length()`. Seed `memory_summary` row; assert
`summaryPresentForSubject(id)` returns true; absent ⇒ false.

**I**: `conversationForSubject` + `summaryPresentForSubject` in
`src/stats/per-table.ts`.

### 5h. user_identity_mappings

**T**: `tests/stats/per-table-identity.test.ts`. Seed mappings for
several providers; assert `identityForSubject` returns
`Record<providerName, count>`.

**I**: `identityForSubject` in `src/stats/per-table.ts`.

### 5i. staged_files

**T**: `tests/stats/per-table-staged.test.ts`. Seed staged files;
assert `stagedForSubject` returns total + byStatus + bytesTotal.

**I**: `stagedForSubject` in `src/stats/per-table.ts`.

### 5j. users / group_members / group_user_observations

**T**: `tests/stats/per-table-user-group.test.ts`. Seed a user, a
group with members and observations; assert `userBlockForSubject`
returns the user fields; assert `groupBlockForSubject` returns the
group fields.

**I**: both helpers in `src/stats/per-table.ts`.

### 5k. web_rate_limit

**T**: `tests/stats/per-table-web.test.ts`. Seed `web_rate_limit`
rows for two actors; assert `webFetchesForSubject(actor1)` returns
the summed count.

**I**: `webFetchesForSubject` in `src/stats/per-table.ts`.

### 5l. llm_usage_events + tool_call_events

**T**: `tests/stats/per-table-usage-tools.test.ts`. Seed usage events
and tool-call events for a subject; assert `llmUsageForSubject`
returns row count + token totals; assert `toolCallsForSubject`
returns total/success/failure/topTools/errorTypeCounts.

**I**: both helpers in `src/stats/per-table.ts`.

## Step 6 — `src/stats/per-table.ts` — global helpers

### 6a. subjects + active

**T**: `tests/stats/per-table-global-subjects.test.ts`. Seed users,
authorized_groups with various `added_at` timestamps; seed
`llm_usage_events` and `message_metadata` rows for activity windows;
assert `subjectsGlobal()` returns counts + 30d growth array, and
`activeSubjectCounts()` returns 1d/7d/30d active counts.

**I**: `subjectsGlobal`, `activeSubjectCounts` in
`src/stats/per-table.ts`.

### 6b. distributions

**T**: `tests/stats/per-table-global-distributions.test.ts`. Seed 5
subjects with known memo / recurring / message_metadata / attachment
byte counts each. Assert `distributionsGlobal()` returns the four
`Percentiles` objects matching independently-computed values.

**I**: `distributionsGlobal` in `src/stats/per-table.ts` — runs one
LEFT JOIN per source table, computes percentiles via `aggregate.ts`.

### 6c. storage

**T**: `tests/stats/per-table-global-storage.test.ts`. Seed
attachments with known `size` and `is_active` mix; assert
`storageGlobal()` returns `s3AttachmentBytes` summed correctly. For
`sqliteBytes`, the test stubs the file size to a known value (via a
dependency-injection seam or by writing a tiny file at the DB path
and checking — design call inside the step).

**I**: `storageGlobal` in `src/stats/per-table.ts` reads
`fs.statSync` and sums `attachments.size`.

### 6d. identity mix + surface mix

**T**: `tests/stats/per-table-global-identity-surface.test.ts`. Seed
identity mappings + users with kaneo_workspace_id; seed subjects with
mix of memos / recurring / scheduled / instructions; assert
`identityMixGlobal()` and `surfaceMixGlobal()` return matching counts.

**I**: both helpers in `src/stats/per-table.ts`.

### 6e. web fetches global

**T**: `tests/stats/per-table-global-web.test.ts`. Seed
`web_cache.url` rows across known hosts; assert
`webFetchesGlobal()` returns top 20 by keyed-hashed host with
correct counts. Asserts plain hostnames are NOT in the result
(redaction smoke).

**I**: `webFetchesGlobal` in `src/stats/per-table.ts`. Extracts host
via `new URL(url).host`, applies `keyedHash`, groups, sorts, takes
top 20.

### 6f. tool mix global

**T**: `tests/stats/per-table-global-tool-mix.test.ts`. Seed
`tool_call_events` rows across tools/subjects/success states; assert
`toolMixGlobal()` returns top 20 by count + success rate + error
type counts.

**I**: `toolMixGlobal` in `src/stats/per-table.ts`.

## Step 7 — `src/stats/index.ts` orchestrator

**T**: `tests/stats/index.test.ts`:

- `getSubjectStats(unknownId)` returns `null`.
- `getSubjectStats(seededDmId)` returns a fully populated
  `SubjectStats` whose fields equal the corresponding per-table
  helper outputs (independent calls).
- `getSubjectStats(seededGroupId)` returns shape with `groupBlock`
  present, `userBlock` null.
- `getGlobalStats()` returns shape with all top-level keys present.
- `getGlobalStats({ noCache: true })` recomputes every call;
  `getGlobalStats()` (default) returns the same cached object on
  back-to-back calls within 60s.
- Cache invalidated when the window parameter changes.

**I**: `src/stats/index.ts` implementing both functions per the
design's D1, D7 (subject discrimination via
`resolveContextTypeFromUsage`), D8 (cache).

## Step 8 — `src/debug/stats-routes.ts`

**T**: `tests/debug/server-stats.test.ts`:

- Boot a test server with a known `DEBUG_TOKEN`.
- `GET /stats/global` without token → 401.
- `GET /stats/global` with token → 200 + JSON body matching
  `GlobalStats` shape.
- `GET /stats/subject/<unknown>` → 404.
- `GET /stats/subject/<seeded>` → 200 + `SubjectStats` shape.
- `GET /stats/global?window=7d` → 200 + body with `window: '7d'`.
- Invalid window → 400 with error message (or falls back to 30d
  — choose during implementation, document in code).

**I**: `src/debug/stats-routes.ts` exporting a route registrar that
takes the existing Hono / Bun-server app instance and calls.

Mount it in `src/debug/server.ts` next to the billing route registrar.

## Step 9 — Redaction-style anonymity test

**T+I together (the test IS the implementation contract):**

`tests/stats/redaction.test.ts`. Seeds rows containing distinctive
forbidden substrings into every text column listed below, then calls
both routes and asserts no forbidden substring appears in the
serialized JSON of either response:

| Source                               | Column                                  | Forbidden marker                  |
| ------------------------------------ | --------------------------------------- | --------------------------------- |
| `memos`                              | `content`                               | `FORBIDDEN_MEMO_BODY_XYZ`         |
| `memos`                              | `summary`                               | `FORBIDDEN_MEMO_SUMMARY_XYZ`      |
| `memos`                              | `tags` (JSON)                           | `FORBIDDEN_MEMO_TAG_XYZ`          |
| `message_metadata`                   | `text`                                  | `FORBIDDEN_MESSAGE_TEXT_XYZ`      |
| `message_metadata`                   | `author_username`                       | `FORBIDDEN_AUTHOR_USERNAME_XYZ`   |
| `user_instructions`                  | `text`                                  | `FORBIDDEN_INSTRUCTION_TEXT_XYZ`  |
| `attachments`                        | `filename`                              | `FORBIDDEN_FILENAME_XYZ`          |
| `attachments`                        | `mime_type`                             | `FORBIDDEN_MIME_XYZ`              |
| `users`                              | `username`                              | `FORBIDDEN_USERNAME_XYZ`          |
| `group_user_observations`            | `username` + `display_label`            | `FORBIDDEN_GROUP_OBS_XYZ`         |
| `known_group_contexts`               | `display_name` + `parent_name`          | `FORBIDDEN_GROUP_NAME_XYZ`        |
| `web_cache`                          | `url` + `title` + `summary` + `excerpt` | `FORBIDDEN_WEB_CONTENT_XYZ`       |
| `scheduled_prompts`                  | `prompt`                                | `FORBIDDEN_SCHEDULED_PROMPT_XYZ`  |
| `alert_prompts`                      | `prompt` + `condition`                  | `FORBIDDEN_ALERT_PROMPT_XYZ`      |
| `recurring_tasks`                    | `title` + `description`                 | `FORBIDDEN_RECURRING_XYZ`         |
| `conversation_history`               | `messages` JSON content                 | `FORBIDDEN_CONVERSATION_TEXT_XYZ` |
| `memory_summary`                     | `summary`                               | `FORBIDDEN_SUMMARY_TEXT_XYZ`      |
| `staged_files`                       | `filename`                              | `FORBIDDEN_STAGED_FILENAME_XYZ`   |
| `system_config.stats_anonymity_salt` | `value`                                 | `FORBIDDEN_SALT_XYZ`              |

The forbidden list lives next to the test. Each forbidden substring
also gets a corresponding "should appear" anti-test: seed a row with
the marker, fetch the route, assert the JSON does NOT contain it.
Per-route assertions:

- `getGlobalStats()` payload: assert none of the markers AND none of
  the seeded `storageContextId`/`chatUserId` values appear.
- `getSubjectStats(seededSubject)` payload: assert none of the
  markers appear (the seeded subject's own id IS expected and is
  exempted from the per-subject test's forbidden list).

Treat any failure as release-blocking per the roadmap.

## Step 10 — Perf bench

**T**: `tests/stats/perf.test.ts` (or section in the existing
`tests/stats/index.test.ts`):

- Seeds 1000 subjects (mix of `users` + `authorized_groups`).
- Seeds 100,000 `message_metadata` rows distributed across subjects.
- Seeds 10,000 `memos` rows.
- Seeds 5000 `tool_call_events` rows.
- Calls `getGlobalStats({ noCache: true })`.
- Asserts elapsed wall-clock time < 1000ms.
- Comment in the test references the 500ms dev-laptop target.

**I**: if the bench fails on first run, add the narrowest covering
index needed in a new migration `039_stats_indexes.ts`. If the bench
passes without changes, no index migration.

## Step 11 — Client types and fetchers

**T**: `tests/client/stats/fetchers.test.ts`:

- `getStatsGlobal()` calls `/stats/global` with token; returns
  parsed `GlobalStats`.
- `getStatsSubject(id)` calls `/stats/subject/:id`; returns parsed
  `SubjectStats`.
- Both surface errors with structured messages on non-2xx.

**I**: `client/debug/stats/fetchers.ts` modeled on
`client/debug/billing/fetchers.ts`. Update
`client/debug/dashboard-types.ts` to add `globalStats`,
`subjectStats`, `statsWindow`.

## Step 12 — Client components

### 12a. `SubjectStatsPanel.svelte`

**T**: `tests/client/stats/SubjectStatsPanel.test.ts`:

- Mounts the component with a mock subject id; loading state shows
  a placeholder.
- Resolves to data; verifies the rendered DOM contains memo total,
  recurring total, attachment bytes formatted, conversation turn
  count, etc.
- Loading-error path renders an error message.

**I**: `client/debug/stats/SubjectStatsPanel.svelte` — a single
collapsible panel mounted on demand inside the Billing subject
detail. Uses `fetchers.getStatsSubject`. Numbers formatted via the
existing client byte/number helpers (or new ones if needed —
co-located with `client/debug/billing/`).

### 12b. `StatsTab.svelte`

**T**: `tests/client/stats/StatsTab.test.ts`:

- Mount the tab, verify it renders subject counts, growth chart
  data, percentile distributions, identity mix, surface mix, web
  host breakdown, tool mix.
- Window selector changes refetch the global view.

**I**: `client/debug/stats/StatsTab.svelte`. Reuses dashboard layout
helpers; growth chart can be a simple inline bar chart (Svelte
template) — no chart-lib dependency.

### 12c. Tab wiring

**T**: extend `tests/client/dashboard/dashboard.test.ts` (or the
component-level test) to assert a "Stats" tab is present and
clickable next to "Billing".

**I**: `client/debug/dashboard.svelte.ts` adds the Stats tab between
Billing and the next existing tab; `client/debug/dashboard-types.ts`
already extended in step 11.

Bundle the Billing-subject-detail extension: import
`SubjectStatsPanel` and render it inside the existing detail expander.

## Step 13 — Knip + lint hygiene

- Run `bun knip`. If any new exports show as unused (likely none
  given the client wires them), add an in-file ignore comment
  following the Phase 2 / Phase 3 pattern in
  `client/debug/billing/fetchers.ts`.
- Run `bun lint:agent-strict -- src/stats client/debug/stats`
  before declaring done.

## Step 14 — Documentation updates

**Files touched:**

- `CLAUDE.md`:
  - Add `src/stats/` to the Main Modules list under "Architecture".
  - Add a short "Anonymity contract" subsection under the debug-server
    section: what `/stats/*` exposes (counts, sizes, timestamps,
    enum distributions, keyed-hashed hostnames) and what it never
    exposes (content, filenames, usernames, message text, memo
    bodies, observation text, raw URLs, etc.).
  - Note the new `stats_anonymity_salt` row in `system_config`.

- No other doc changes; the bot's chat surface is unchanged.

## Step 15 — Final verification

```bash
bun typecheck
bun lint
bun format:check
bun knip
bun test
bun test:client
bun security
bun check:full
```

All must pass.

Manual smoke checklist (run by the implementer before requesting
review):

1. Seed a dev DB with 2–3 DM subjects + 1 group, a handful of memos,
   recurring tasks, attachments, and a few LLM turns.
2. Start `bun start:debug`.
3. Open the dashboard. Click "Stats". Verify subject counts, growth
   chart, distributions, identity mix render.
4. Open the Billing tab → click a subject → expand the "Stats"
   sub-panel. Verify per-subject numbers.
5. Visually scan both views: no usernames, no memo bodies, no
   message text, no filenames present.
6. `curl -H "Authorization: Bearer $DEBUG_TOKEN" http://localhost:$DEBUG_PORT/stats/global | jq .`
   — sanity-check the JSON.

## Acceptance checklist (from the design)

- [ ] `src/stats/` module ships with layout from D1.
- [ ] `/stats/global` + `/stats/subject/:id` wired behind
      `DEBUG_TOKEN`.
- [ ] `tests/stats/redaction.test.ts` passes on a deeply-seeded
      fixture.
- [ ] Per-subject counts match hand-rolled SQL aggregates row-for-row.
- [ ] Global distributions match independently-computed percentiles.
- [ ] `tests/stats/perf.test.ts` <1000ms on 1k + 100k fixture.
- [ ] Stats tab + sub-panel render without console errors.
- [ ] `bun typecheck / lint / format / test / knip / security` all
      clean.
- [ ] Manual smoke walks both views and confirms no PII leaks.

## Commit plan

Suggested commit sequence (each must leave the tree green):

1. `feat(stats): types + aggregate helpers (Phase 5)` — D1 types,
   `aggregate.ts`, tests.
2. `feat(stats): keyed-hash with system_config salt (Phase 5)` —
   `hashing.ts`, tests.
3. `refactor(billing): extract display-name resolver` — Phase 3
   decoration moved to `src/debug/subject-display-name.ts`; Billing
   tests still pass.
4. `feat(stats): per-subject query helpers (Phase 5)` — all 5a–5l
   helpers from step 5, plus their tests.
5. `feat(stats): global query helpers (Phase 5)` — all 6a–6f
   helpers from step 6, plus their tests.
6. `feat(stats): orchestrator + 60s global-view cache (Phase 5)` —
   `src/stats/index.ts`, tests.
7. `feat(stats): /stats routes behind DEBUG_TOKEN (Phase 5)` —
   `stats-routes.ts`, server wiring, tests.
8. `test(stats): forbidden-substring anonymity contract (Phase 5)` —
   `redaction.test.ts`.
9. `test(stats): 1k subjects + 100k messages perf bench (Phase 5)` —
   `perf.test.ts`, optional `039_stats_indexes.ts` migration if
   needed.
10. `feat(stats): client fetchers + types (Phase 5)` — client side
    plumbing.
11. `feat(stats): SubjectStatsPanel + StatsTab + dashboard wiring
(Phase 5)` — components + tab registration.
12. `docs(stats): CLAUDE.md anonymity contract + module listing
(Phase 5)` — doc updates.
13. `chore(stats): knip ignore for deferred exports (Phase 5)` —
    only if knip flags anything.

## Rollback

Per the design's Rollback section:

- Remove route registration in `src/debug/server.ts`.
- Delete `src/stats/` and `tests/stats/`.
- Revert `src/debug/billing.ts` refactor (optional).
- Delete `system_config.stats_anonymity_salt` row (optional).

No schema migrations to roll back.

## Out of plan (carry to follow-on phases)

- Phase 5b — `usage_snapshots` table + nightly job.
- Group display-name resolver.
- External task counts (Kaneo / YouTrack).
- CSV / JSON export.
- Per-tool drill-down panels.
- `recentToolFailures` retirement.
