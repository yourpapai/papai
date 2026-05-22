<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5 — Anonymous DB-Wide Statistics, Brainstorm

**Date:** 2026-05-20
**Parent roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Phase 3 (merged):** [`../plans/2026-05-19-phase-3-billing-dashboard-plan.md`](../plans/2026-05-19-phase-3-billing-dashboard-plan.md)
**Phase 4 (merged):** [`../plans/2026-05-20-phase-4-tool-call-rows-plan.md`](../plans/2026-05-20-phase-4-tool-call-rows-plan.md)

Open exploration before the per-phase design and plan land. The roadmap
already lays out Phase 5 in detail; this brainstorm verifies the surface
area against the current codebase, resolves the five pre-start open
questions, and surfaces implementation choices the roadmap leaves to the
design call.

## Trigger check

The roadmap puts Phase 5 behind a trigger:

> After phase 3 ships and the Billing tab is in operator hands long
> enough to know which secondary stats they keep asking SQL for.

Phase 3 shipped (`490de03`), Phase 4 shipped immediately after
(`0437f16`). The Billing tab has not soaked with operators. Same R1/R2
reading as Phase 4:

- **R1.** The trigger is informational; the user has explicitly
  decided to start. Brainstorm proceeds.
- **R2.** Without operator-derived "which stats they keep asking SQL
  for" evidence, the metric set is a hypothesis.

**Recommendation:** R1, with R2 informing scope. Adopt the roadmap's
metric list as the v1 contract (it is itself derived from the billing
research bundle's cost-amplifier candidates) and treat additions as
follow-on work rather than re-scoping mid-implementation.

## Pre-start open questions — answered

The roadmap lists five questions to resolve before phase 5 starts. The
user has confirmed adoption of the roadmap recommendations verbatim:

1. **Anonymity contract — hostnames.** Keyed hash with a
   per-deployment salt; values deterministic within a deployment, not
   portable across deployments.
2. **Bot-wide view.** Per-subject id is never exposed in the global
   view; only distribution shapes (counts, percentiles, enum
   distributions). No deployment-size threshold needed because there
   are no per-subject identifiers to deanonymize from.
3. **Time series.** Phase 5a uses live queries only. The
   `usage_snapshots` table is deferred to phase 5b and earns its place
   only when live-query latency degrades.
4. **External task counts (Kaneo / YouTrack).** Deferred entirely.
   Live provider calls would turn the stats page into a rate-limit
   surface.
5. **Conversation history.** Turn count and summary count only;
   byte-size of historical text ignored in 5a.

Carried into the design with no further refinement.

## Surface area survey

The roadmap lists 14 source tables and a tool-failures category. Names
in this codebase differ from the roadmap in two places — confirmed below
and corrected in the design.

| Roadmap table             | Real table / source                                    | Existence | Notes                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memos`                   | `memos` (`src/db/schema.ts:175-193`)                   | yes       | columns: `status`, `tags` (JSON), `content`, `embedding` blob, `created_at`, `updated_at`. Bytes via `length(content)` / `length(embedding)`                       |
| `scheduled_prompts`       | `scheduled_prompts` (`src/db/deferred-schema.ts:9-36`) | yes       | has `status`, `delivery_context_id`, `audience`. distinct delivery target count from `delivery_context_id`. roadmap also implies `alert_prompts` parallel — add it |
| `recurring_tasks`         | `recurring_tasks` (`src/db/schema.ts:86-119`)          | yes       | `enabled` is TEXT ('0'/'1'), `project_id`, `rrule`, `next_run`                                                                                                     |
| `instructions`            | `user_instructions` (`src/db/schema.ts:141-152`)       | yes       | column is `text`, not `content`. Use `length(text)` for bytes                                                                                                      |
| `attachments`             | `attachments` (`src/db/schema.ts:275-298`)             | yes       | `status`, `source_provider`, `is_active`, `size`. Manifest bytes ≈ `SUM(size)`                                                                                     |
| `message_metadata`        | `message_metadata` (`src/db/schema.ts:156-173`)        | yes       | `context_id`, `author_id`, `timestamp`, `text`. Hottest table for scans — index considerations                                                                     |
| conversation history      | `conversation_history` + `memory_summary`              | yes       | `conversation_history.messages` is a JSON blob; turn count is array length. `memory_summary` is one row per user; summary present/absent                           |
| `user_identity_mappings`  | `user_identity_mappings` (`src/db/schema.ts:212-228`)  | yes       | per `(context_id, provider_name)`. Count grouped by `provider_name`                                                                                                |
| `staged_files`            | `staged_files` (`src/db/staged-schema.ts:8-31`)        | yes       | `status`, `size`, `context_id`                                                                                                                                     |
| `users`                   | `users` (`src/db/schema.ts:9-17`)                      | yes       | `added_at`, `added_by`, `kaneo_workspace_id`                                                                                                                       |
| `group_members`           | `group_members` (`src/db/schema.ts:59-74`)             | yes       | `(group_id, user_id)` PK, `added_by`                                                                                                                               |
| `group_user_observations` | `group_user_observations` (`src/db/schema.ts:259-273`) | yes       | per-context observation rows; we count only                                                                                                                        |
| `web_fetch_cache`         | `web_cache` (`src/db/web-schema.ts:8-23`)              | yes       | name correction; no `subject` join — see open question A                                                                                                           |
| `llm_usage_events`        | `llm_usage_events` (Phase 2)                           | yes       | already surfaced by Phase 3; included for completeness                                                                                                             |
| tool-failures             | `tool_call_events` (Phase 4) + ring buffer             | yes       | Phase 4 shipped a real durable table; supersedes the ring buffer as a stats source                                                                                 |

Net: no missing tables. Two name corrections (`user_instructions`,
`web_cache`). One opportunistic addition (`alert_prompts` next to
`scheduled_prompts`). Phase 4's `tool_call_events` is a strict upgrade
over the ring buffer for tool-usage breakdowns and powers the Phase 5
tool-mix view directly.

## Open question A — `web_cache` subject attribution

The roadmap's web-fetch row asks for "distinct hosts (hashed), total
fetches per subject if join is feasible, bytes stored".

Reality of `web_cache`:

- Keyed by `url_hash`, not by subject. There is no
  `storage_context_id` column.
- Rate-limit table `web_rate_limit` is keyed by `actor_id` (which is
  the subject) and tracks request counts per window — but holds only
  `(actor_id, window_start, count)`, no URLs.

So we cannot answer "how many fetches did subject X make against
host Y" from `web_cache` alone. Options:

- **A1.** Per-subject: report only what `web_rate_limit` exposes —
  total requests across all windows currently in the table, no host
  breakdown. Bot-wide: distinct hosts (keyed-hash) from `web_cache`,
  `SUM(LENGTH(excerpt))` for stored bytes. Subject ↔ host join is
  marked unknown.
- **A2.** Add a thin per-fetch log going forward (`web_fetches(actor,
url_hash, fetched_at)`) so future stats can join. New table, new
  recorder — out of scope for 5a.
- **A3.** Skip the web-fetch breakdown entirely in 5a.

**Recommendation:** A1. The per-subject "total fetches" comes from
`web_rate_limit` (a sum over rows for that actor); the bot-wide host
breakdown comes from `web_cache.url` with keyed-hashing applied
before exposure. We acknowledge the join is one-sided in the API
shape (a `webFetchHostBreakdown` field appears only in the global
view) and accept it.

## Open question B — Module location and shape

Two locations make sense for the stats module:

- **B1.** New `src/stats/` module (per roadmap sketch).
- **B2.** Extend `src/usage/` with `src/usage/stats.ts` since usage
  already owns `query.ts`.

The roadmap explicitly sketches B1. B2 would muddle a module whose
charter is "record + read LLM/tool usage rows" with a charter of "read
arbitrary domain tables".

**Recommendation:** B1, with the shape from the roadmap:

```
src/stats/
  index.ts          — getSubjectStats(id), getGlobalStats(opts)
  per-table.ts      — one query function per source table
  aggregate.ts      — percentile + bucket helpers
  hashing.ts        — keyed hash for rrule patterns + hostnames
  types.ts          — SubjectStats, GlobalStats, all sub-shapes
```

Routes go in `src/debug/stats-routes.ts` mirroring
`src/debug/billing-routes.ts` (Phase 3). The dashboard server in
`src/debug/server.ts` wires `stats-routes` next to `billing-routes`.

## Open question C — Per-subject scope: which subjects are valid?

Phase 3's `listSubjects()` returns only subjects that have at least
one row in `llm_usage_events`. Phase 5's per-subject view is requested
by `storage_context_id`. Two interpretations:

- **C1.** Phase 5 only answers `getSubjectStats(id)` for subjects
  that already appear in `llm_usage_events`. If a user signed up but
  never made an LLM call, they have zero stats and the dashboard
  doesn't list them.
- **C2.** Phase 5 enumerates subjects from a union of tables
  (`users`, `authorized_groups`, plus any subject that has rows in
  the listed tables) so freshly-onboarded users appear.

**Recommendation:** C1 in 5a. The Stats sub-panel lives inside the
Billing tab, and a subject reaches that panel only by being listed
in Billing first. Decoupling the two would require a new "All
subjects" view which is not in the roadmap. C2 can land later if
operators ask "who signed up but never used the bot".

## Open question D — Subject-type discrimination (DM vs group)

The per-subject view differs between users and groups (roadmap rows
for `users (for subjects that are users)` and
`group_members (for subjects that are groups)`).

Phase 3 stores `context_type` ('dm' / 'group') on
`llm_usage_events` and `tool_call_events`. The most recent
`llm_usage_events` row for a `storage_context_id` carries the type.
For subjects with both types in history (rare; would require id
collision across user and group ids, which is a chat-platform
property — Telegram groups are negative integers, users positive,
so no collision in practice), we accept the most-recent-row label.

**Recommendation:** Read `context_type` from the latest
`llm_usage_events` row for the subject. If the subject has no
row (shouldn't happen given C1 above), `context_type = 'unknown'`
and the user-vs-group sub-blocks are both omitted.

## Open question E — Distribution math

Bot-wide aggregates show distribution percentiles (p50/p90/p99 per
subject) for memo count, recurring task count, message count,
attachment bytes. Two ways:

- **E1.** Compute in JS — load per-subject counts, sort, pick
  positions. Cheap up to ~10k subjects; the deployment scale Phase 5
  targets is well below that.
- **E2.** SQLite percentile via window functions —
  `PERCENTILE_CONT` is not in SQLite; possible via `NTILE` + ranking
  but messy and version-dependent.

**Recommendation:** E1. Simpler, deterministic, easier to test.
Bench the global view against the seeded 1k subjects + 100k messages
fixture; if the percentile pass dominates, revisit.

`src/stats/aggregate.ts` exports `percentiles(values: number[],
ps: readonly number[])` — pure function, easy unit tests.

## Open question F — Hashing: function and salt source

Anonymity contract requires:

- rrule strings (keyed-hash to dedupe for distribution charts without
  exposing the raw value)
- web-fetch hostnames (keyed-hash, per-deployment salt)

Sub-questions:

1. **Hash function.** `crypto.createHash('sha256').update(input + salt).digest('hex').slice(0, 16)`
   — same family as Phase 4's deterministic event id but with a
   secret salt prepended. Truncation to 16 hex chars keeps the
   output compact for distribution buckets while leaving 2⁶⁴
   collision space.
2. **Salt source.** Reuse `system_config` (Phase 1) with a new key
   `stats_anonymity_salt`. Seeded on first run via
   `crypto.randomBytes(16).toString('hex')` if missing. Not exposed
   to any route. Rotating the salt is a manual `UPDATE system_config`
   step and invalidates any stored hash-keyed comparisons — fine for
   this use case because Phase 5 doesn't persist hashes anywhere; it
   computes them on each query.
3. **Where the function lives.** `src/stats/hashing.ts` — pure
   function `keyedHash(value: string): string`. Reads the salt once
   at module init via a getter that hits `system_config`; cached for
   the process lifetime.

**Recommendation:** All three as above. The salt seed migration is
not strictly required — `system_config` already exists; an
in-process upsert on first use suffices. Decide in design whether
to make the seed an explicit migration step (cleaner) or a
lazy-init (lighter).

## Open question G — Forbidden-substring redaction test

Roadmap acceptance criterion:

> No raw text, filename, memo body, message body, observation text,
> or username appears in the response payload for either route —
> covered by a redaction-style test that diffs the response against
> a forbidden substring list.

Practical shape:

- Test fixture seeds rows with **distinctive** strings that would
  appear in content fields: memo body contains
  `FORBIDDEN_MEMO_BODY_XYZ`, `message_metadata.text` contains
  `FORBIDDEN_MESSAGE_TEXT_XYZ`, `user_instructions.text` contains
  `FORBIDDEN_INSTRUCTION_TEXT_XYZ`, `attachments.filename` contains
  `FORBIDDEN_FILENAME_XYZ`, `users.username` contains
  `FORBIDDEN_USERNAME_XYZ`, `group_user_observations.display_label`
  and `username` contain `FORBIDDEN_GROUP_OBS_XYZ`,
  `known_group_contexts.display_name` contains
  `FORBIDDEN_GROUP_NAME_XYZ`, `web_cache.url`/`title`/`excerpt`
  contain `FORBIDDEN_WEB_CONTENT_XYZ`, etc.
- Test calls `getGlobalStats()` and `getSubjectStats(subjectId)`,
  serializes to JSON, then asserts that **none** of the forbidden
  substrings appear in the serialized payload.
- Forbidden list lives next to the test, not in the production
  module — production has no awareness of "what's redacted", only of
  "what's exposed". The test is the contract.

**Recommendation:** Land this exactly as above in
`tests/stats/redaction.test.ts`. Treat any failure as
release-blocking per the roadmap.

Open subquestion: what about `storage_context_id` and
`chat_user_id`? The roadmap says the per-subject view exposes them
(they're already in Phase 3 output) but the global view does not.
The test for `getGlobalStats()` adds those to its forbidden list;
the test for `getSubjectStats()` does not.

## Open question H — Caching strategy

Roadmap mitigation:

> caching the global view for 60s in-process; per-subject views are
> fast enough to compute on click.

Two shapes:

- **H1.** A simple `{ data, cachedAt }` cell in
  `src/stats/index.ts`; `getGlobalStats()` checks freshness, returns
  cached or recomputes. Stale-while-revalidate is overkill for v1.
- **H2.** No cache, measure first, add cache only if latency budget
  breached.

**Recommendation:** H1 with a default 60s TTL, configurable via an
optional parameter for tests (`getGlobalStats({ noCache: true })`).
Cheap insurance; matches the roadmap's mitigation language; testable
with a fixed-clock dependency.

Per-subject views are uncached.

## Open question I — Index audit

Heaviest tables for the queries:

- `memos` (`idx_memos_user_status_created` exists) — counts grouped
  by `user_id`, `status` → covered by the existing index.
- `recurring_tasks` (`idx_recurring_tasks_user`, `..._enabled_next`)
  — both supported.
- `message_metadata` (`(context_id, message_id)` PK,
  `idx_message_metadata_expires_at`, `idx_message_metadata_reply_to`)
  — per-subject counts use `context_id`, supported by PK prefix.
  Bot-wide totals scan the table — at 100k rows on dev hardware
  this is sub-100ms; bench in tests.
- `attachments` (`idx_attachments_context_active`,
  `idx_attachments_context_checksum`) — per-subject bytes by
  `context_id` covered.
- `staged_files` (`idx_staged_context_sender`) — covered.
- `llm_usage_events` (Phase 2 indexes) — covered.
- `tool_call_events` (Phase 4 indexes:
  `(storage_context_id, occurred_at)`, `(tool_name, occurred_at)`)
  — covered for both per-subject tool mix and bot-wide tool mix.
- `web_cache` — no subject index needed (no subject column);
  scanned wholesale for the host distribution.
- `web_rate_limit` (`(actor_id, window_start)` PK) — per-subject
  fetch totals covered by PK prefix.

**Recommendation:** No new indexes in 5a. If the global-view bench
shows a single query dominating (>100ms on the fixture), add the
narrowest covering index in the same phase, gated on the bench
output rather than on speculation.

## Open question J — Window semantics

The per-subject Stats sub-panel sits inside the Billing tab, which
already exposes a window selector (`24h`/`7d`/`30d`/`all`). The
roadmap says the per-subject counts are not windowed by default —
they are point-in-time counts of "how many rows exist for this
subject right now".

- **J1.** All per-subject counts are point-in-time, ignore the
  window selector. Two tables become exceptions:
  `llm_usage_events` and `tool_call_events` are inherently
  time-bounded and already use the Billing window selector.
  `message_metadata` has a `timestamp` column and could optionally
  be windowed — but its "oldest/newest" report is point-in-time by
  definition.
- **J2.** All counts respect the window. Add a `since` clause to
  every query. More consistent UX, more code.

**Recommendation:** J1. The roadmap framing is "structural counts
and sizes per subject" — point-in-time. The Billing tab's window
selector continues to govern only the LLM/tool tables. For
bot-wide aggregates the active-subject counts use 1d/7d/30d
explicitly per roadmap.

## Open question K — Route shape and auth

Phase 3 added two billing routes guarded by `DEBUG_TOKEN`. Phase 5
adds two more:

- `GET /stats/global` — returns `GlobalStats`.
- `GET /stats/subject/:id` — returns `SubjectStats` for the given
  `storage_context_id`.

Both behind the same `DEBUG_TOKEN` guard as Phase 3 routes. No
write surface. No window query parameter on `/stats/subject` (per
open question J); only `/stats/global` accepts an optional window
for the active-subject and growth slices.

URL parameter `id` is url-decoded and passed through as
`storage_context_id`. No validation beyond non-empty string —
unknown ids return an empty stats blob (zero counts), not 404. This
matches Phase 3's `getBillingDetail` returning `null` for unknown
subjects.

**Open subquestion:** if `getSubjectStats(unknown)` returns an
empty blob, can the dashboard distinguish "subject exists but has
no rows" from "subject doesn't exist"? Phase 3 returns `null` to
the route (HTTP 404). For symmetry, Phase 5's route returns 404
when the subject is not in the Phase 3 subject list (per C1) and
otherwise returns the blob.

## Open question L — Tool mix data source

Phase 4 shipped `tool_call_events` with `storage_context_id`,
`tool_name`, `success`, `error_type`. Phase 5 can:

- **L1.** Use `tool_call_events` directly for both per-subject and
  bot-wide tool-mix breakdowns: top N tools by call count, success
  rate, error_type distribution.
- **L2.** Use the older `recentToolFailures` ring buffer in
  `src/debug/turn-assembly.ts` (1024-deep, ephemeral). Mostly
  superseded by L1.
- **L3.** Roll up from `llm_usage_events.tool_call_count` only —
  loses the per-tool name breakdown.

**Recommendation:** L1. Phase 4's table is durable and indexed for
exactly these queries. The roadmap's tool-mix bullet says "refined
if phase 4 ships the per-tool table" — it has.

## Open question M — Dashboard integration

The roadmap is explicit:

- Subject detail in the Billing tab gains a "Stats" sub-panel.
- New top-level "Stats" tab shows the bot-wide view.

Client work mirrors Phase 3's structure:

```
client/debug/stats/
  StatsTab.svelte         — top-level global view
  SubjectStatsPanel.svelte — sub-panel for the Billing subject detail
  fetchers.ts             — typed fetch helpers
```

`client/debug/dashboard-types.ts` gains `globalStats`, `subjectStats`
slots in `DashboardState`. `dashboard.svelte.ts` adds a "Stats" tab
between Billing and the existing tabs (order TBD in design).

**Open subquestion:** does the Stats sub-panel inside Billing share
state with the Stats tab? Recommendation: no — different fetchers,
different cache lifetimes. The sub-panel is per-subject; the tab is
global. Keeping them separate avoids a refresh-storm when switching
subjects.

## Open question N — Test strategy

Three suites:

- `tests/stats/per-table.test.ts` — each per-table query in
  isolation against `setupTestDb()` fixtures. Seeds known counts,
  asserts the helper returns matching counts.
- `tests/stats/redaction.test.ts` — the forbidden-substring test
  from open question G. Seeds rows with distinctive content,
  serializes the API response, asserts no forbidden substring
  appears.
- `tests/stats/aggregate.test.ts` — pure-function tests for
  `percentiles()` and bucket helpers.

Plus route-level integration in
`tests/debug/server-stats.test.ts` mirroring
`tests/debug/server-billing.test.ts` (Phase 3): boots a fake
`DEBUG_TOKEN`-gated server, asserts 401 without token, asserts
200 + payload shape with token.

Client-side: `tests/client/stats/*` mirroring
`tests/client/billing/*`.

DI vs `setupTestDb()`: match Phase 2/3/4 — use `setupTestDb()` and
the migration-chain runner. No DI for the stats module; the
queries take a Drizzle handle from `getDrizzleDb()`.

## Open question O — Performance bench

Roadmap acceptance:

> Global view renders with 1k seeded subjects + 100k seeded
> `message_metadata` rows in under 500ms (in-process, on a dev
> laptop).

Bench shape:

- `tests/stats/perf.test.ts` (or part of the per-table suite) seeds
  the volumes above, calls `getGlobalStats()`, asserts elapsed
  wall-clock time < 500ms with a 2× safety margin (so test failure
  budget is 1000ms in CI). The 500ms target lives in the
  documentation; the test asserts the looser CI bound.

CI runners are slower than a dev laptop; setting the assertion at
1000ms reduces flake. Local hand-bench during development confirms
the 500ms target.

**Recommendation:** Land the bench, asserting <1000ms in CI; comment
references the 500ms dev-laptop target. If CI flakes, raise to 1500ms
and open an issue for "global view perf budget" rather than
suppressing.

## Open question P — Subject-id source for global aggregates

Bot-wide aggregates need a list of "all subjects" to compute
distributions like "p50 memo count across subjects". Sources:

- `users.platform_user_id` (DM subjects)
- `authorized_groups.group_id` (group subjects)
- Union of distinct `storage_context_id` from `llm_usage_events`
  (subjects that have made calls) — already in Phase 3.

Which to use?

- **P1.** Union of `users` ∪ `authorized_groups`. Counts include
  subjects who never used the bot. Distribution skews low (lots of
  zeros).
- **P2.** Use only subjects with at least one `llm_usage_events`
  row. Distribution reflects "active subjects" only.
- **P3.** Both, exposed as separate aggregates.

**Recommendation:** P1. The roadmap's framing ("how heavy is the
median user") wants the full denominator — subjects who registered
but never used the bot are a real signal. The Phase 3 list (active
subjects) is already available in the Billing tab; Phase 5's global
view is the only place where the broader population is visible.

Active-subject counts (1d/7d/30d) are a separate per-roadmap
metric, derived from `llm_usage_events.occurred_at` and
`message_metadata.timestamp`.

## Open question Q — Storage footprint reporting

Roadmap:

> SQLite `page_count * page_size`, plus S3 bucket total bytes from
> the manifest tally.

SQLite size:

- `PRAGMA page_count;` and `PRAGMA page_size;` give the on-disk
  size. Drizzle's raw SQL execution can fetch both. Or `fs.stat()`
  on the DB path — simpler. Use `fs.stat()` because the DB path is
  already known to the bot.

S3 size:

- Sum `attachments.size` for `is_active=1` rows. Matches the
  manifest tally because the manifest IS the `attachments` table.
- Alternative: enumerate S3 keys with the prefix. Cost: an S3 LIST
  call per dashboard open. Rejected — same rate-limit-surface
  concern as external task counts.

**Recommendation:** SQLite size via `fs.stat()`; S3 size via
`SUM(size) WHERE is_active=1`. Both reported as bytes; the
dashboard formats.

## Open question R — Identity-provider mix

> Identity-provider mix: how many subjects have mapped to Kaneo vs
> YouTrack identity.

Source: `user_identity_mappings` grouped by `provider_name`.
`COUNT(DISTINCT context_id) GROUP BY provider_name`. No per-subject
content — provider name is an enum value (`kaneo`, `youtrack`).

Sub-question: is `users.kaneo_workspace_id IS NOT NULL` a
separate signal worth reporting? It indicates "the user was
provisioned a Kaneo workspace", distinct from "has a Kaneo identity
mapping". Recommendation: yes — report both as
`identityMix.kaneoMappings`, `identityMix.kaneoWorkspaces`.

## Open question S — Conversation-history specifics

Per the resolved pre-start question 5: turn count + summary count,
no byte sizes. Implementation:

- Per-subject turn count: `conversation_history.messages` is a JSON
  array; parse and report length. SQLite has `json_array_length()`
  — single SQL call per subject. Bot-wide p50/p90/p99: load array
  lengths for all subjects (or sample), percentile in JS.
- Per-subject summary present: 1 if
  `memory_summary.user_id = subject_id` row exists, else 0. Bot-wide:
  `COUNT(*) FROM memory_summary`.

`json_array_length()` is in SQLite ≥ 3.38 (released 2022); Bun's
bundled SQLite is well past that. Confirmed in design.

**Recommendation:** Use `json_array_length()` for turn count. No
JSON parsing in JS.

## Things explicitly NOT to do in Phase 5

- No content storage in any query result. Bytes-only contract from
  Phase 4 carries forward.
- No live provider calls (Kaneo `count_tasks`, YouTrack
  equivalents). External task counts are deferred.
- No `usage_snapshots` table. 5a is live queries against existing
  tables.
- No CSV/JSON export endpoints. Dashboard rendering is the output.
- No mutation. Phase 5 is read-only.
- No new indexes unless a bench fails (see open question I).
- No removal of `recentToolFailures` ring buffer; Phase 4's table
  is the stats source but the ring buffer continues to serve the
  live debug view.
- No deployment-size threshold for the global view; anonymity is
  enforced by the schema of the response, not by deployment size.
- No content of any kind in hashed form — keyed-hashing applies only
  to rrule strings and hostnames, both non-PII enough that hashing
  is a dedup tool rather than an obfuscation tool.

## Risks identified by the brainstorm

1. **Forbidden-substring test brittleness.** If a future
   contributor adds a query helper that pulls a content column for a
   legitimate reason ("just for debugging"), the test catches it
   only if the seeded fixture exercises that code path. Mitigation:
   the per-table test fixture seeds content into every domain table
   the stats module reads, and the redaction test runs both API
   methods on a deeply-populated fixture.

2. **Global view latency on real-world DBs.** Bench fixture is 1k
   subjects + 100k messages. Production may be smaller (fine) or
   larger (Phase 5b becomes relevant). Mitigation: 60s cache for
   the global view; in-process; per-subject views uncached because
   they're cheap.

3. **Salt rotation invalidates external comparisons.** If anyone
   ever screenshots a hashed hostname distribution and compares
   across deployments, hashes will not match. Documented as
   intentional in CLAUDE.md anonymity section.

4. **JSON-array parsing on `conversation_history.messages` at
   scale.** Even with `json_array_length()`, scanning all rows for
   the global view is O(N rows). Should be fine at 1k subjects;
   benchmarked in open question O's perf test.

5. **Phase 3 display-name resolver coupling.** Phase 5 reuses
   `src/debug/billing.ts:decorate` for the per-subject view to
   surface display names. If that helper changes shape, Phase 5
   breaks. Mitigation: extract the resolver into
   `src/debug/subject-display-name.ts` (small refactor, optional
   in 5a — the design call decides whether to refactor or import as-is).

6. **TDD hook policy.** Same pattern as Phase 2/3/4: every src/
   edit needs a failing test first. Sequencing: pure-function
   tests (`aggregate`, `hashing`) → modules → per-table query
   tests → query modules → redaction test → API module → route
   tests → routes → client tests → client.

7. **`web_cache` global scan.** No subject column; we accept a
   table scan for the host-distribution computation. At 10k cached
   URLs the scan is negligible; document the assumption.

8. **`alert_prompts` parity.** Adding `alert_prompts` to the
   surface set was opportunistic — easy to forget in the design.
   Carry forward to the design's per-table list.

## Forward-compatibility check

- **Phase 5b (`usage_snapshots`).** Drop-in: the snapshot writer
  imports `src/stats/index.ts` and persists daily values. No 5a
  API change required.
- **Future external-task counts.** Adding a per-subject
  `taskCounts: { kaneo?: number; youtrack?: number }` field to
  `SubjectStats` is additive. The 5a contract documents the
  field as optional and never present.
- **Future metering vendor export.** Phase 5 doesn't write data;
  no outbox columns or forwarder concerns.
- **Future per-tool drilldown.** Already powered by Phase 4's
  `tool_call_events` table; further breakdowns (e.g. by error
  code) are additive to the stats module.

## Summary of decisions to lift into the per-phase design

1. **Module location.** `src/stats/` with `index.ts`, `per-table.ts`,
   `aggregate.ts`, `hashing.ts`, `types.ts`. Routes in
   `src/debug/stats-routes.ts`.
2. **Source tables (corrected).** `memos`, `scheduled_prompts`,
   `alert_prompts`, `recurring_tasks`, `user_instructions`
   (column `text`), `attachments`, `message_metadata`,
   `conversation_history` + `memory_summary` (turn count + summary
   count only), `user_identity_mappings`, `staged_files`, `users`,
   `group_members`, `group_user_observations`,
   `known_group_contexts`, `web_cache` (no subject column),
   `web_rate_limit` (per-subject fetch counts), `llm_usage_events`,
   `tool_call_events`. No `instructions` (`user_instructions`); no
   `web_fetch_cache` (`web_cache`).
3. **Subject scope.** Per-subject view served only for subjects
   already in Phase 3's `listSubjects()`. Global view's denominator
   is `users` ∪ `authorized_groups`.
4. **Subject-type discrimination.** From the latest
   `llm_usage_events.context_type` for the subject.
5. **Hashing.** `sha256(salt + value).slice(0, 16)` for rrule
   strings and hostnames. Salt in `system_config.stats_anonymity_salt`,
   seeded on first use.
6. **Caching.** 60s in-process for the global view; uncached for
   per-subject.
7. **Routes.** `GET /stats/global`, `GET /stats/subject/:id`. Both
   behind `DEBUG_TOKEN`. 404 on unknown subject (matches Phase 3).
8. **Tool mix.** Sourced from `tool_call_events` (Phase 4).
9. **Storage footprint.** SQLite via `fs.stat()`; S3 via
   `SUM(attachments.size) WHERE is_active=1`. No live S3 LIST.
10. **Web-fetch attribution.** Per-subject total fetches from
    `web_rate_limit`; bot-wide host distribution (keyed-hashed)
    from `web_cache`. Subject ↔ host join not provided.
11. **Conversation history.** Turn count via
    `json_array_length(messages)`; summary count via row presence
    in `memory_summary`. No byte sizes.
12. **Distributions.** Percentile math in JS via
    `src/stats/aggregate.ts`. No SQL window functions.
13. **No new indexes.** Bench gates any new index work.
14. **Redaction test.** Forbidden-substring contract test against
    a deeply-seeded fixture; both routes covered.
15. **Bench test.** 1k subjects + 100k messages, CI assertion
    <1000ms (dev-laptop target 500ms).
16. **Dashboard.** New top-level "Stats" tab + new sub-panel in the
    Billing subject detail. Separate fetchers, separate state.

## Out of brainstorm (carry to plan, not design)

- Exact test file locations and T-then-I ordering inside the
  implementation steps.
- Commit grouping (likely: types → hashing+aggregate → per-table
  queries → orchestrator → routes → docs → dashboard client).
- Manual smoke checklist (seed a small fixture in a dev DB, open
  the Stats tab, eyeball percentiles + redaction).
- Whether to add a `bun knip` ignore for the new exports if any
  consumer wiring lands deferred (same approach as Phase 2's
  `c0e8960` and Phase 3's `df35a5a`).
- CLAUDE.md "Anonymity contract" subsection wording (or whether to
  land it as `docs/stats.md`).
- Tab ordering in the dashboard (Stats before or after Billing).
