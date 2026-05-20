# Phase 5 — Anonymous DB-Wide Statistics — Design Refinement

**Date:** 2026-05-20
**Status:** Draft, refining parent spec for Phase 5 scope
**Parent design:** [`2026-05-19-central-llm-billing-design.md`](./2026-05-19-central-llm-billing-design.md)
**Roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Brainstorm:** [`../notes/2026-05-20-phase-5-anonymous-stats-brainstorm.md`](../notes/2026-05-20-phase-5-anonymous-stats-brainstorm.md)
**Branch:** `claude/central-llm-phase-5-anonymous-stats`

## Purpose of this document

The parent design covers all five phases at a high level. This file
narrows its decisions to Phase 5a and lifts the brainstorm's
resolutions. Where this file and the parent disagree, this file wins
for Phase 5 only.

## Phase 5 in one paragraph

Add a read-only `src/stats/` module that exposes two functions —
`getSubjectStats(storageContextId)` and `getGlobalStats({ window })` —
backed by live queries against existing tables. Surface both through
new `/stats/subject/:id` and `/stats/global` routes behind the same
`DEBUG_TOKEN` guard as Phase 3. Add a "Stats" sub-panel inside the
existing Billing subject detail and a new top-level "Stats" tab in the
debug dashboard. Anonymity is enforced by the response schema: counts,
sizes, timestamps, enum distributions, and (only in per-subject view)
the same opaque ids Phase 3 already exposes — never content,
filenames, usernames, message text, memo bodies, or observation text.
A redaction-style test diffs the API responses against a forbidden
substring list seeded into every domain table. No new migrations in
5a; the `usage_snapshots` time-series table is deferred to a future
5b.

## Decisions for Phase 5a

### D1. Module layout and public surface

New module `src/stats/`:

```text
src/stats/
  index.ts         — getSubjectStats(id), getGlobalStats(opts)
  per-table.ts     — one query function per source table
  aggregate.ts     — percentiles(), bucket helpers
  hashing.ts       — keyedHash(value)
  types.ts         — SubjectStats, GlobalStats, all sub-shapes
```

Public exports from `src/stats/index.ts`:

```ts
export const getSubjectStats = (storageContextId: string): SubjectStats | null => {
  /* ... */
}

export interface GlobalStatsOptions {
  window?: '1d' | '7d' | '30d' | 'all'
  noCache?: boolean // bypass the 60s in-process cache, for tests
}

export const getGlobalStats = (opts?: GlobalStatsOptions): GlobalStats => {
  /* ... */
}
```

Routes live in `src/debug/stats-routes.ts`, mirroring
`src/debug/billing-routes.ts`:

- `GET /stats/global?window=30d` → `GlobalStats`
- `GET /stats/subject/:id` → `SubjectStats` (404 when the subject is
  not in Phase 3's `listSubjects()`)

Both routes are mounted in `src/debug/server.ts` behind the existing
`DEBUG_TOKEN` middleware that already guards `/billing` and `/admin`.

### D2. Response shapes

```ts
// src/stats/types.ts

export interface SubjectStats {
  storageContextId: string
  chatUserId: string | null
  contextType: 'dm' | 'group' | 'unknown'
  displayName: string | null
  memos: {
    total: number
    byStatus: Record<string, number> // 'active' / 'archived' / 'promoted' etc.
    tagCardinality: { distinct: number; meanPerMemo: number }
    contentBytesTotal: number
    embeddingBytesTotal: number
    withEmbedding: number
    oldestCreatedAt: number | null // epoch ms
    newestCreatedAt: number | null
  }
  scheduledPrompts: {
    total: number
    byStatus: Record<string, number>
    distinctDeliveryTargets: number
  }
  alertPrompts: {
    total: number
    byStatus: Record<string, number>
  }
  recurringTasks: {
    total: number
    enabled: number
    disabled: number
    distinctProjects: number
    nextRunWithin7d: number
    distinctRrulePatterns: number // keyed-hash count
  }
  userInstructions: {
    total: number
    textBytesTotal: number
  }
  attachments: {
    total: number
    byStatus: Record<string, number>
    bySourceProvider: Record<string, number>
    storedBytesTotal: number
    active: number
    byExtension: Record<string, number> // 'jpg', 'pdf', ... lowercased
  }
  messageMetadata: {
    total: number
    authoredBySubject: number // author_id === chat_user_id
    oldestTimestamp: number | null
    newestTimestamp: number | null
    textBytesTotal: number
  }
  conversationHistory: {
    turnCount: number
    summaryPresent: boolean
  }
  userIdentityMappings: Record<string, number> // provider_name -> count
  stagedFiles: {
    total: number
    byStatus: Record<string, number>
    bytesTotal: number
  }
  userBlock: {
    addedAt: string | null
    addedByPresent: boolean
    kaneoWorkspacePresent: boolean
  } | null // present when contextType === 'dm'
  groupBlock: {
    memberCount: number
    distinctAddedBy: number
    observationCount: number
  } | null // present when contextType === 'group'
  webFetches: {
    totalRequests: number // SUM(count) from web_rate_limit by actor_id
    // host breakdown lives only in the global view per anonymity contract
  }
  llmUsage: {
    rowCount: number
    inputTokensTotal: number
    outputTokensTotal: number
  }
  toolCalls: {
    total: number
    success: number
    failure: number
    topTools: Array<{ toolName: string; count: number }> // top 10
    errorTypeCounts: Record<string, number>
  }
}

export interface GlobalStats {
  generatedAt: number
  window: '1d' | '7d' | '30d' | 'all'
  subjects: {
    dmTotal: number
    groupTotal: number
    growthLast30d: Array<{ date: string; dmAdded: number; groupAdded: number }>
  }
  active: {
    activeIn1d: number
    activeIn7d: number
    activeIn30d: number
  }
  distributions: {
    memosPerSubject: Percentiles
    recurringTasksPerSubject: Percentiles
    messageMetadataPerSubject: Percentiles
    attachmentBytesPerSubject: Percentiles
  }
  storage: {
    sqliteBytes: number
    s3AttachmentBytes: number
  }
  identityMix: {
    byProvider: Record<string, number>
    kaneoWorkspaces: number
  }
  surfaceMix: {
    subjectsWithRecurring: number
    subjectsWithDeferred: number
    subjectsWithMemos: number
    subjectsWithInstructions: number
  }
  webFetches: {
    topHosts: Array<{ hostHash: string; count: number }> // top 20, keyed-hash
  }
  toolMix: {
    topTools: Array<{ toolName: string; count: number; successRate: number }> // top 20
    errorTypeCounts: Record<string, number>
  }
}

export interface Percentiles {
  count: number
  min: number
  p50: number
  p90: number
  p99: number
  max: number
  mean: number
}
```

The global view never includes a `storageContextId` or `chatUserId`.
Hosts are keyed-hashed. The forbidden-substring test enforces both.

### D3. Source-table query map

Per-table query helpers in `src/stats/per-table.ts` — one pure function
per table, each taking a Drizzle handle plus subject id (per-subject
helpers) or no id (global helpers). All read-only.

| Source table              | Per-subject helper                | Global helper                         | Anonymity notes                                                                 |
| ------------------------- | --------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `memos`                   | `memosForSubject(id)`             | `memosDistribution()`                 | bytes via `length(content)`, never content. tags `json_each` for cardinality    |
| `scheduled_prompts`       | `scheduledForSubject(id)`         | `scheduledTotals()`                   | count distinct `delivery_context_id`, never the prompt text                     |
| `alert_prompts`           | `alertsForSubject(id)`            | `alertsTotals()`                      | count only, never `condition`                                                   |
| `recurring_tasks`         | `recurringForSubject(id)`         | `recurringTotals()` + distribution    | distinct rrule via `keyedHash(rrule)`                                           |
| `user_instructions`       | `instructionsForSubject(id)`      | `instructionsTotals()`                | bytes via `length(text)`, never `text`                                          |
| `attachments`             | `attachmentsForSubject(id)`       | `attachmentsTotals()`                 | bytes via `SUM(size)`, never `filename`. extension bucketed from filename lower |
| `message_metadata`        | `messageMetadataForSubject(id)`   | `messageMetadataTotals() + distrib`   | `length(text)` for bytes, never `text`/`author_username`                        |
| `conversation_history`    | `conversationForSubject(id)`      | (covered by `memory_summary` global)  | `json_array_length(messages)`, no `messages` text                               |
| `memory_summary`          | `summaryPresentForSubject(id)`    | `summaryTotals()`                     | row presence only, never `summary` text                                         |
| `user_identity_mappings`  | `identityForSubject(id)`          | `identityTotals()`                    | `provider_name` enum and `kaneo_workspace_id IS NOT NULL` from `users`          |
| `staged_files`            | `stagedForSubject(id)`            | `stagedTotals()`                      | `SUM(size)`, never `filename`                                                   |
| `users`                   | `userBlockForSubject(id)`         | (covered by subjects.dmTotal)         | `added_at`, `added_by IS NOT NULL`, `kaneo_workspace_id IS NOT NULL`            |
| `authorized_groups`       | (no per-subject role)             | (covered by subjects.groupTotal)      | `added_at` for growth                                                           |
| `group_members`           | `groupBlockForSubject(id)`        | (none global)                         | counts only, never `user_id` values                                             |
| `group_user_observations` | `groupObservationsForSubject(id)` | (none global)                         | count only, never `username` / `display_label`                                  |
| `web_cache`               | (no subject column)               | `webHostsDistribution()`              | host extracted from `url`, `keyedHash(host)`, never raw url/title/excerpt       |
| `web_rate_limit`          | `webFetchesForSubject(id)`        | (none global; covered by `web_cache`) | `SUM(count)` only                                                               |
| `llm_usage_events`        | `llmUsageForSubject(id)`          | `activeSubjectCounts()`               | aggregates only                                                                 |
| `tool_call_events`        | `toolCallsForSubject(id)`         | `toolMixGlobal()`                     | tool names exposed (already enum); error types exposed (already enum)           |

All helpers live in `src/stats/per-table.ts` and re-export from
`src/stats/index.ts` as a flat namespace for testing.

### D4. Anonymity envelope

- **Per-subject response.** Exposes the subject's own `storage_context_id`
  and `chat_user_id` (the caller already supplied the former and Phase
  3 already exposes both). No other subjects' ids. No content,
  filenames, usernames, message text, memo bodies, observation text,
  rrule strings (only their keyed-hash count), or web-cache strings.
- **Global response.** No `storage_context_id` or `chat_user_id` of
  any kind. Host breakdown uses `keyedHash(host)`. Provider names
  remain plain (`kaneo`, `youtrack`); tool names remain plain (they
  are an enum-like set defined in code).

A `tests/stats/redaction.test.ts` suite enforces both envelopes by
seeding distinctive substrings into every text column the queries
touch and asserting the serialized JSON of each response contains
none of them.

### D5. Hashing — keyed SHA-256

```ts
// src/stats/hashing.ts
import { createHash } from 'node:crypto'

let cachedSalt: string | null = null

const loadSalt = (): string => {
  if (cachedSalt !== null) return cachedSalt
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, 'stats_anonymity_salt'))
    .get()
  if (row) {
    cachedSalt = row.value
    return cachedSalt
  }
  const newSalt = randomBytes(16).toString('hex')
  getDrizzleDb()
    .insert(systemConfig)
    .values({
      key: 'stats_anonymity_salt',
      value: newSalt,
      updatedAt: Date.now(),
      updatedBy: 'system:stats',
    })
    .run()
  cachedSalt = newSalt
  return cachedSalt
}

export const keyedHash = (value: string): string => {
  const salt = loadSalt()
  return createHash('sha256')
    .update(salt + ':' + value)
    .digest('hex')
    .slice(0, 16)
}

export const resetSaltCacheForTests = (): void => {
  cachedSalt = null
}
```

Salt is lazy-initialized on first call. Tests reset the cache via the
exported helper. The salt is never returned by any route or read by
any caller other than `keyedHash`.

Output is 16 hex characters (64 bits) — sufficient for deduplication
across hundreds of thousands of distinct values without practical
collisions (~10⁻¹⁴ at 10⁶ values).

### D6. Distribution math

```ts
// src/stats/aggregate.ts

export const percentiles = (values: readonly number[]): Percentiles => {
  if (values.length === 0) {
    return { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const pick = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: pick(50),
    p90: pick(90),
    p99: pick(99),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  }
}
```

Pure function, no DB dependency. Unit-tested with known inputs.

### D7. Subject discrimination and display name

For each `storage_context_id` reaching `getSubjectStats`:

1. `context_type` derived from the most recent `llm_usage_events` row
   for that subject. If no row exists, return `null` (404 from the
   route).
2. `display_name` resolved via Phase 3's existing logic:
   - DM: `users.username` for the matching `platform_user_id`.
   - Group: not resolved in 5a (matches Phase 3); the field reports
     `null`.
3. `chat_user_id` taken from the most recent `llm_usage_events` row.

To keep this dry and avoid Phase-3-internal coupling, Phase 5 extracts
the Phase 3 resolver from `src/debug/billing.ts:decorate` into a new
`src/debug/subject-display-name.ts` exporting
`resolveDisplayName(storageContextId, contextType): string | null` and
`resolveContextTypeFromUsage(storageContextId): 'dm' | 'group' | null`.
Phase 3's `decorate` is updated to call it. This is the only Phase-3
file touched by Phase 5.

### D8. Caching

`getGlobalStats()` caches its result in-process for 60 seconds:

```ts
let cached: { data: GlobalStats; at: number; window: GlobalStatsOptions['window'] } | null = null

export const getGlobalStats = (opts?: GlobalStatsOptions): GlobalStats => {
  const window = opts?.window ?? '30d'
  const ttlMs = 60_000
  if (!opts?.noCache && cached && cached.window === window && Date.now() - cached.at < ttlMs) {
    return cached.data
  }
  const data = computeGlobalStats(window)
  cached = { data, at: Date.now(), window }
  return data
}
```

Per-subject results are uncached (cheap to recompute on click).

### D9. Window semantics

- **Per-subject endpoint:** all counts are point-in-time. No window
  query parameter accepted; the URL ignores `?window=` if present.
- **Global endpoint:** the `window` parameter selects the active-
  subject slice (`activeIn1d/7d/30d` is always computed regardless;
  `window` selects which value appears as the highlighted figure in
  the dashboard) and the growth-chart range. Distributions and
  totals are point-in-time and ignore the window.

### D10. Conversation history

```sql
SELECT json_array_length(messages) AS turn_count
FROM conversation_history
WHERE user_id = ?;
```

`json_array_length()` is a builtin in SQLite ≥ 3.38; Bun's bundled
SQLite is current. A unit test asserts the function returns expected
values for short and long arrays.

Summary presence is a single-row existence check on `memory_summary`.

### D11. Storage footprint

```ts
import { stat } from 'node:fs/promises'

const sqliteBytes = (await stat(getDbPath())).size

const s3AttachmentBytes =
  getDrizzleDb()
    .select({ total: sql<number>`COALESCE(SUM(size), 0)` })
    .from(attachments)
    .where(eq(attachments.isActive, 1))
    .get()?.total ?? 0
```

No live S3 LIST. The DB path comes from the existing exported helper
in `src/db/index.ts` (or the central config). If the path lookup is
unavailable in some environment, the field is reported as `null` and
the dashboard renders "unknown".

### D12. Subject-id source for distributions

The denominator for "p50 memos per subject" is the union of
`users.platform_user_id` and `authorized_groups.group_id`. Each
subject's count is fetched once via a single SQL query that groups by
subject id and reports zero for subjects with no rows:

```sql
SELECT u.platform_user_id AS subject_id, COALESCE(m.cnt, 0) AS cnt
FROM users u
LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM memos GROUP BY user_id) m
  ON m.user_id = u.platform_user_id
UNION ALL
SELECT g.group_id, COALESCE(m.cnt, 0)
FROM authorized_groups g
LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM memos GROUP BY user_id) m
  ON m.user_id = g.group_id;
```

Percentiles computed in JS via `aggregate.ts:percentiles()`.

### D13. Active-subject counts

Active in 1d / 7d / 30d uses `llm_usage_events.occurred_at` and
`message_metadata.timestamp` as activity proxies. A subject is "active
in window W" if either table has a row for `storage_context_id` with
timestamp ≥ `now - W`. Distinct count via UNION over the two sources.

### D14. Web-fetch reporting

- **Per-subject:** `SUM(count)` from `web_rate_limit` for
  `actor_id = storage_context_id`. No host breakdown per subject
  (no join key).
- **Global:** scan `web_cache.url`, extract host via
  `new URL(url).host`, `keyedHash(host)`, group by hash, take top 20
  by count.

### D15. Tool mix

- **Per-subject:** group `tool_call_events` rows by `tool_name` for
  the subject, return top 10 by count plus error-type counts.
- **Global:** group all `tool_call_events` rows by `tool_name`,
  return top 20 with success rate; group by `error_type` ignoring
  NULL, return totals.

### D16. Identity-provider mix

- **Per-subject:** `user_identity_mappings` rows for the subject,
  grouped by `provider_name`.
- **Global:** distinct `context_id` count grouped by `provider_name`,
  plus `COUNT(*) FROM users WHERE kaneo_workspace_id IS NOT NULL`.

### D17. Test strategy

Three new test files under `tests/stats/`:

- `aggregate.test.ts` — pure `percentiles()` cases (empty, single,
  uniform, ascending, descending, with duplicates).
- `hashing.test.ts` — `keyedHash()` determinism, salt cache behavior,
  output length, salt-rotation invalidation.
- `per-table.test.ts` — each per-table query helper against a seeded
  `setupTestDb()` fixture.
- `redaction.test.ts` — forbidden-substring contract; seeds
  distinctive strings into every content field; serializes
  `getGlobalStats()` and `getSubjectStats(seededSubject)`; asserts
  none of the substrings appear in either payload.
- `perf.test.ts` — 1k subjects + 100k `message_metadata` rows fixture;
  asserts `getGlobalStats()` returns in <1000ms (CI safety margin);
  comment references the 500ms dev-laptop target.

Plus `tests/debug/server-stats.test.ts` mirroring
`server-billing.test.ts`: 401 without token, 200 + payload shape with
token, 404 for unknown subject.

Client-side mirror under `tests/client/stats/` for the new
fetchers/components.

All suites follow the Phase-2/3/4 pattern: `setupTestDb()` + migration
chain runner; no DI for the stats module.

### D18. Dashboard integration

```text
client/debug/stats/
  StatsTab.svelte           — top-level global view
  SubjectStatsPanel.svelte  — sub-panel within Billing subject detail
  fetchers.ts               — typed fetchers (getStatsGlobal, getStatsSubject)
```

`client/debug/dashboard-types.ts` gains:

- `globalStats: GlobalStats | null`
- `subjectStats: SubjectStats | null`
- `statsWindow: '1d' | '7d' | '30d' | 'all'`

`client/debug/dashboard.svelte.ts` adds a "Stats" tab adjacent to
"Billing" (order: Billing → Stats → others). Inside the Billing
subject detail, a "Stats" expander mounts `SubjectStatsPanel` on
demand; the fetcher fires only when the user opens it.

### D19. No migrations in 5a

5a is read-only against existing tables. No `usage_snapshots`, no new
indexes (gated on the perf bench), no schema change. The next
migration (`039_*`) is reserved for 5b when/if it lands.

The lazy-init of `stats_anonymity_salt` in `system_config` is an
INSERT into an existing table, not a schema change.

### D20. No backfill, no external calls

- No backfill of historical stats. The dashboard renders live counts.
- No external provider calls (Kaneo, YouTrack, S3 LIST). Storage and
  task counts use only local-DB-resident data.

## Non-goals (Phase 5a)

- No `usage_snapshots` time-series table. Deferred to 5b.
- No CSV/JSON export endpoints. Dashboard rendering is the output.
- No external task counts (Kaneo / YouTrack `count_tasks`).
- No live S3 LIST for storage size.
- No mutation. Read-only across the board.
- No new SQLite indexes unless the perf bench demands one.
- No removal or change to the `recentToolFailures` ring buffer.
- No deployment-size threshold for the global view; the response
  schema enforces anonymity.
- No content of any kind in responses, hashed or otherwise — keyed
  hashing applies only to rrule strings and hostnames as a dedup
  tool.
- No display-name resolution for groups (5a matches Phase 3).
- No charts beyond the 30d growth chart.

## Acceptance contract (Phase 5a)

The Phase 5a PR is shippable when all of these hold:

1. **Module ships.** `src/stats/` exists with the layout in D1; both
   public functions return well-typed shapes.
2. **Routes wired.** `GET /stats/global` and `GET /stats/subject/:id`
   respond behind `DEBUG_TOKEN`; 401 without token, 404 on unknown
   subject, 200 + payload otherwise.
3. **Anonymity enforced.** `tests/stats/redaction.test.ts` passes;
   no forbidden substring appears in either route's payload on a
   deeply-seeded fixture.
4. **Per-subject counts correct.** Seeded fixture with known counts;
   `getSubjectStats()` returns counts that match hand-rolled SQL
   aggregates row-for-row.
5. **Global counts correct.** Seeded fixture; `getGlobalStats()`
   distributions match independently-computed percentiles.
6. **Bench within budget.** `tests/stats/perf.test.ts` runs the
   global query against 1k subjects + 100k messages in <1000ms in
   CI.
7. **Dashboard renders.** Stats tab and Stats sub-panel mount
   without console errors against a seeded DB; manually opening the
   tab shows distributions and the host breakdown with hashed
   values.
8. **`bun typecheck / lint / format / test / knip`** all clean (knip
   exception via comment for any deferred client wiring, per Phase 2
   pattern).
9. **`bun security`** clean. New routes are read-only and behind the
   existing `DEBUG_TOKEN` guard.
10. **Manual smoke.** Seed a dev DB with a few subjects + memos +
    recurring tasks; open the dashboard; verify the Stats tab shows
    realistic numbers and no PII leaks visually.

## Rollback

- Remove `src/debug/stats-routes.ts` registration in
  `src/debug/server.ts`. Routes vanish; dashboard tabs render zero
  state.
- Delete `src/stats/` and `tests/stats/` — no other module depends.
- Revert the `src/debug/billing.ts` refactor that extracted
  `subject-display-name.ts` (optional; the refactor stands on its
  own merits).
- Delete the `stats_anonymity_salt` row from `system_config` if a
  fresh start is desired; harmless if left.

No schema migrations to roll back.

## Forward-compatibility check

- **Phase 5b (`usage_snapshots`).** Drop-in: the snapshot writer
  imports `src/stats/index.ts` and persists daily values from
  `getGlobalStats()` and `getSubjectStats()`. No API change required.
- **Future external-task counts.** Adding `externalTasks: { kaneo?:
number; youtrack?: number }` to `SubjectStats` is additive. The 5a
  contract documents the field as absent.
- **Future metering vendor.** Phase 5 doesn't write data; no outbox
  concerns.
- **Future group display-name resolver.** Adding it changes the
  `displayName` field for groups from `null` to a string. No shape
  break.

## Security review checkpoints

- Run `bun security` after the stats module lands. New routes are
  read-only.
- The redaction-style test is the explicit anonymity-contract check.
  Treat any forbidden-substring leak as a release-blocking defect.
- The `stats_anonymity_salt` value never appears in any route
  response. A second redaction test asserts the salt is not present
  in either route's payload.
- The `DEBUG_TOKEN` middleware is reused, not re-implemented; same
  guarantees as Phase 3.

## Documentation updates

- `CLAUDE.md` gains a short "Anonymity contract" subsection under the
  existing Architecture / debug-server notes: what `/stats/*`
  exposes (counts, sizes, timestamps, enum distributions, hashed
  hostnames) and what it never exposes (content of any kind).
- `CLAUDE.md` dashboard-overview update: list the new Stats tab next
  to Billing.
- No user-facing chat-surface doc changes.

## Open follow-ups for later phases

- **Phase 5b — `usage_snapshots`.** Nightly job persists global
  values + per-subject deltas for time-series charts.
- **Group display-name resolver.** Resolves group ids to titles via
  `known_group_contexts` or live provider lookup; useful in both
  Billing and Stats.
- **External task counts.** Deferred Kaneo/YouTrack `count_tasks`
  with strict rate limiting.
- **CSV / JSON export.** Endpoint that returns the same payloads as
  downloadable files; trivial follow-on once routes exist.
- **Per-tool drill-down.** Click a tool name in the Stats tab to see
  its error-type distribution over time.
- **`recentToolFailures` retirement.** Once the Stats tab covers the
  same shape, the ring buffer can shrink or retire.
