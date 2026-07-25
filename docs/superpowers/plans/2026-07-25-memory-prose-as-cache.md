<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prose as Cache — Erasure Across Derived Memory: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-25-memory-prose-as-cache-design.md`

**Goal:** Make `forget_memory` erase the fact from every always-on prompt channel — the derived profile and the session summary — not just the canonical `memory_records` row.

**Architecture:** Add one nullable column, `memory_profiles.contaminated_at`. Purging a record synchronously (inside the existing transaction) stamps that column, deletes the scope's `memory_summary` rows, and evicts the corresponding caches. Every read of the profile goes through a single `visibleProfileText()` helper that returns `null` while the flag is set, so contaminated prose can reach neither the prompt nor the extraction LLM. The next background extraction rewrites the profile from the remaining active records, which clears the flag — regeneration is quality restoration, never a safety dependency. Separately, dedup losers are purged instead of archived, so no un-tombstoned twin survives.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM over `bun:sqlite`, Zod v4, `bun:test`.

## Global Constraints

- Runtime is **Bun**. Import paths **must** use the `.js` extension.
- **Never** add a lint-disable or type-ignore comment — the write hook blocks them; fix the underlying issue.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Logging is mandatory and metadata-first (pino): `debug` for entry/internal state, `info` for successful high-value ops, `warn` for degraded handling. **Never log memory content, tokens, or keys** — log scope ids and counts only.
- A `max-lines` / `max-lines-per-function` failure is a design signal: split the file. Do not compress formatting to pass.
- Every new file starts with the four-line BUSL SPDX header used by every other file in `src/`.
- Migration ids are `NNN_snake_case_name` and must match the filename.
- The suppression half must be **synchronous and transactional**; the regeneration half must be **fail-closed** (any failure leaves content suppressed, never exposed).
- `forget_memory` does **not** rewrite `conversation_history`. That boundary is intended and must be asserted by a test, not left implicit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/migrations/072_memory_profile_contaminated_at.ts` (new) | Additive `ALTER TABLE`; no backfill. |
| `src/db/index.ts` (modify) | Register migration 072. |
| `src/db/long-term-memory-schema.ts` (modify) | `contaminatedAt` column on `memoryProfiles`. |
| `src/long-term-memory/types.ts` (modify) | `contaminatedAt` on `MemoryProfile`. |
| `src/long-term-memory/serialization.ts` (modify) | Map the new column in `rowToProfile`. |
| `src/long-term-memory/profile-visibility.ts` (new) | The single gate: `visibleProfileText()`. One responsibility, no DB access. |
| `src/long-term-memory/scope-clear.ts` (modify) | Export `workingMemoryKeyMatch` for reuse by purge. |
| `src/long-term-memory/purge.ts` (new) | Record destruction. `purgeMemoryRecord` (a *forget*: tombstone + contamination + summary deletion + cache eviction) and `deleteMemoryRecord` (housekeeping: row only). Extracted so `store.ts` stays a plain CRUD module. |
| `src/long-term-memory/store.ts` (modify) | Re-export `purgeMemoryRecord` from `./purge.js` (same pattern as the existing `clearMemoryScope` re-export); `saveMemoryProfile` clears the flag; delete `archiveMemoryRecord`. |
| `src/long-term-memory/promotion.ts` (modify) | Dedup losers are deleted, not archived. |
| `src/long-term-memory/runner.ts` (modify) | Feed the extractor the *visible* profile only. |
| `src/conversation.ts` (modify) | Inject the *visible* profile only. |
| `src/tools/memory.ts` (modify) | Bounded-promise copy on `forget_memory`. |
| `tests/db/migrations/072_memory_profile_contaminated_at.test.ts` (new) | Column exists, nullable, defaults to NULL. |
| `tests/long-term-memory/profile-visibility.test.ts` (new) | Gate unit tests. |
| `tests/long-term-memory/purge.test.ts` (new) | Contamination, summary deletion, group threads, cache eviction. |
| `tests/long-term-memory/durable-erasure.golden.test.ts` (modify) | Bilingual end-to-end erasure + the explicit history-unchanged boundary assertion. |

Because `purgeMemoryRecord` is re-exported from `store.ts`, **no existing caller changes**: `src/tools/memory.ts`, `src/debug/settings/memory-routes.ts`, `tests/long-term-memory/store.test.ts` and `tests/long-term-memory/durable-erasure.golden.test.ts` keep importing it from `../long-term-memory/store.js`.

---

## Task 1: Schema — `memory_profiles.contaminated_at`

**Files:**
- Create: `src/db/migrations/072_memory_profile_contaminated_at.ts`
- Create: `tests/db/migrations/072_memory_profile_contaminated_at.test.ts`
- Modify: `src/db/index.ts` (import block near line 84; migrations array near line 190)
- Modify: `src/db/long-term-memory-schema.ts:9-24`
- Modify: `src/long-term-memory/types.ts:34-41`
- Modify: `src/long-term-memory/serialization.ts:48-56`

**Interfaces:**
- Consumes: nothing.
- Produces: `MemoryProfile.contaminatedAt: string | null`; Drizzle column `memoryProfiles.contaminatedAt`; migration `migration072MemoryProfileContaminatedAt`.

- [ ] **Step 1: Write the failing migration test**

Create `tests/db/migrations/072_memory_profile_contaminated_at.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDb } from '../../../src/db/index.js'
import { setupTestDb } from '../../utils/test-helpers.js'

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null }

describe('migration 072: memory_profiles.contaminated_at', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('adds a nullable contaminated_at column with no default', () => {
    const columns = getDb().query('PRAGMA table_info(memory_profiles)').all() as ColumnInfo[]
    const column = columns.find((c) => c.name === 'contaminated_at')
    expect(column).toBeDefined()
    expect(column?.type).toBe('TEXT')
    expect(column?.notnull).toBe(0)
    expect(column?.dflt_value).toBeNull()
  })

  test('existing profile rows read back as not contaminated', () => {
    getDb().run(
      `INSERT INTO memory_profiles (scope_id, scope_type, profile, updated_at)
       VALUES ('u-1', 'personal', 'prose', '2026-07-25T00:00:00.000Z')`,
    )
    const row = getDb()
      .query('SELECT contaminated_at FROM memory_profiles WHERE scope_id = ?')
      .get('u-1') as { contaminated_at: string | null } | null
    expect(row?.contaminated_at).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test tests/db/migrations/072_memory_profile_contaminated_at.test.ts`
Expected: FAIL — `expect(column).toBeDefined()` receives `undefined`.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/072_memory_profile_contaminated_at.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:072' })

const up = (db: Database): void => {
  // Nullable, no backfill: NULL means "not contaminated", which is correct for
  // every profile that predates this column — none of them were ever purged.
  db.run(`
    ALTER TABLE memory_profiles
      ADD COLUMN contaminated_at TEXT
  `)
  log.info('migration 072: memory_profiles.contaminated_at column added')
}

export const migration072MemoryProfileContaminatedAt: Migration = {
  id: '072_memory_profile_contaminated_at',
  up,
}

export default migration072MemoryProfileContaminatedAt
```

- [ ] **Step 4: Register it**

In `src/db/index.ts`, add after the line importing `migration071MemoryRecallShadowLog` (line 84):

```ts
import { migration072MemoryProfileContaminatedAt } from './migrations/072_memory_profile_contaminated_at.js'
```

and add after `migration071MemoryRecallShadowLog,` in the migrations array (line 190):

```ts
  migration072MemoryProfileContaminatedAt,
```

- [ ] **Step 5: Add the Drizzle column**

In `src/db/long-term-memory-schema.ts`, inside the `memoryProfiles` column object, add after the `injectRecords` line (line 16):

```ts
    contaminatedAt: text('contaminated_at'),
```

- [ ] **Step 6: Add the field to `MemoryProfile`**

In `src/long-term-memory/types.ts`, change the `MemoryProfile` type to:

```ts
export type MemoryProfile = MemoryScope &
  Readonly<{
    profile: string
    enabled: boolean
    injectRecords: boolean
    /** ISO timestamp of the purge that invalidated this prose, or `null` when the profile is trustworthy. */
    contaminatedAt: string | null
    version: number
    updatedAt: string
  }>
```

- [ ] **Step 7: Map it in `rowToProfile`**

In `src/long-term-memory/serialization.ts`, change `rowToProfile` to:

```ts
export const rowToProfile = (row: MemoryProfileRow): MemoryProfile => ({
  scopeId: row.scopeId,
  scopeType: row.scopeType,
  profile: row.profile,
  enabled: row.enabled,
  injectRecords: row.injectRecords,
  contaminatedAt: row.contaminatedAt,
  version: row.version,
  updatedAt: row.updatedAt,
})
```

- [ ] **Step 8: Run the migration test and the existing memory suites**

Run: `bun test tests/db/migrations/072_memory_profile_contaminated_at.test.ts tests/long-term-memory/`
Expected: PASS (both new tests green; no regressions).

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: no errors. If a test fixture constructs a `MemoryProfile` literal, add `contaminatedAt: null` to it.

- [ ] **Step 10: Commit**

```bash
git add src/db/migrations/072_memory_profile_contaminated_at.ts src/db/index.ts \
        src/db/long-term-memory-schema.ts src/long-term-memory/types.ts \
        src/long-term-memory/serialization.ts \
        tests/db/migrations/072_memory_profile_contaminated_at.test.ts
git commit -m "feat(memory): add memory_profiles.contaminated_at column"
```

---

## Task 2: The visibility gate

A single chokepoint every profile reader must pass through. Keeping it in its own module (rather than a method or an inline check) is deliberate: there are two readers on very different paths — the prompt builder and the extraction runner — and a future third must not be able to read `profile.profile` by accident.

**Files:**
- Create: `src/long-term-memory/profile-visibility.ts`
- Create: `tests/long-term-memory/profile-visibility.test.ts`

**Interfaces:**
- Consumes: `MemoryProfile` from Task 1.
- Produces: `visibleProfileText(profile: MemoryProfile | null): string | null` — used by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/profile-visibility.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { visibleProfileText } from '../../src/long-term-memory/profile-visibility.js'
import type { MemoryProfile } from '../../src/long-term-memory/types.js'

const profile = (overrides: Partial<MemoryProfile> = {}): MemoryProfile => ({
  scopeId: 'u-1',
  scopeType: 'personal',
  profile: 'User lives in Berlin',
  enabled: true,
  injectRecords: false,
  contaminatedAt: null,
  version: 1,
  updatedAt: '2026-07-25T00:00:00.000Z',
  ...overrides,
})

describe('visibleProfileText', () => {
  test('returns the prose when the profile is clean', () => {
    expect(visibleProfileText(profile())).toBe('User lives in Berlin')
  })

  test('returns null when the profile is contaminated', () => {
    expect(visibleProfileText(profile({ contaminatedAt: '2026-07-25T10:00:00.000Z' }))).toBeNull()
  })

  test('returns null for a missing profile', () => {
    expect(visibleProfileText(null)).toBeNull()
  })

  test('returns null for empty prose so callers never emit an empty section', () => {
    expect(visibleProfileText(profile({ profile: '' }))).toBeNull()
    expect(visibleProfileText(profile({ profile: '   ' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test tests/long-term-memory/profile-visibility.test.ts`
Expected: FAIL — cannot resolve `../../src/long-term-memory/profile-visibility.js`.

- [ ] **Step 3: Implement the gate**

Create `src/long-term-memory/profile-visibility.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MemoryProfile } from './types.js'

/**
 * The single gate through which profile prose may leave the store.
 *
 * Profile prose is a cache, not durable truth: it is an unstructured blend of many
 * facts, so an erased fact cannot be surgically removed from it. A purge therefore
 * stamps `contaminatedAt`, and this function withholds the whole profile until a
 * background extraction rewrites it from the surviving records.
 *
 * Fails closed by construction — every non-trustworthy state maps to `null`.
 */
export const visibleProfileText = (profile: MemoryProfile | null): string | null => {
  if (profile === null) return null
  if (profile.contaminatedAt !== null) return null
  const text = profile.profile.trim()
  return text === '' ? null : profile.profile
}
```

- [ ] **Step 4: Run the test**

Run: `bun test tests/long-term-memory/profile-visibility.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/profile-visibility.ts tests/long-term-memory/profile-visibility.test.ts
git commit -m "feat(memory): add visibleProfileText gate for contaminated profiles"
```

---

## Task 3: Extract `purgeMemoryRecord` into its own module (no behavior change)

Pure move, done separately so the behavior change in Task 4 reviews as a small diff. `store.ts` is already 280 lines of plain CRUD; purge is about to grow cross-table side effects and cache eviction, which does not belong there.

**Files:**
- Create: `src/long-term-memory/purge.ts`
- Modify: `src/long-term-memory/store.ts:231-247` (remove) and the re-export block at `:41-48`
- Modify: `src/long-term-memory/scope-clear.ts:35` (export the helper)

**Interfaces:**
- Consumes: `recordScopeCondition` (`./record-conditions.js`), `tombstoneValues` (`./tombstone.js`).
- Produces: `purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean`, exported from `./purge.js` **and** re-exported from `./store.js` so existing importers are untouched; `workingMemoryKeyMatch(column: SQLiteColumn, scope: MemoryScope): SQL` exported from `./scope-clear.js`.

- [ ] **Step 1: Export the storage-key helper**

In `src/long-term-memory/scope-clear.ts`, change line 35 from `const workingMemoryKeyMatch = ` to an export:

```ts
/** Matches a working-memory key belonging to `scope`: the scope id itself, or one of its `:thread:*` sub-keys. */
export const workingMemoryKeyMatch = (column: SQLiteColumn, scope: MemoryScope): SQL => {
```

Leave the body unchanged.

- [ ] **Step 2: Create the new module with the current implementation verbatim**

Create `src/long-term-memory/purge.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords, memoryTombstones } from '../db/schema.js'
import { recordScopeCondition } from './record-conditions.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

/**
 * Permanently destroys one memory record and tombstones its content so background
 * extraction cannot re-learn it. Returns false when no record matched.
 */
export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  return db.transaction((tx) => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return false
    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, row.content, now))
      .onConflictDoNothing()
      .run()
    return true
  })
}
```

- [ ] **Step 3: Remove the old copy and re-export from `store.ts`**

In `src/long-term-memory/store.ts`, delete the whole `purgeMemoryRecord` function (lines 231-247) and add a re-export next to the existing `clearMemoryScope` re-export (line 48):

```ts
export { clearMemoryScope } from './scope-clear.js'
export { purgeMemoryRecord } from './purge.js'
```

- [ ] **Step 4: Fix the now-unused imports in `store.ts`**

`memoryTombstones` and `tombstoneValues` are no longer used there. Change line 11 to:

```ts
import { memoryProfiles, memoryRecallShadowLog, memoryRecords } from '../db/schema.js'
```

and delete line 15 (`import { tombstoneValues } from './tombstone.js'`).

- [ ] **Step 5: Verify no behavior changed**

Run: `bun test tests/long-term-memory/ && bun run typecheck && bun run lint`
Expected: PASS with zero test changes. `lint` also enforces `import/no-cycle` — a clean run proves the new module introduces no import cycle.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/purge.ts src/long-term-memory/store.ts src/long-term-memory/scope-clear.ts
git commit -m "refactor(memory): extract purgeMemoryRecord into purge.ts"
```

---

## Task 4: Purge contaminates the profile and deletes the scope's summaries

The core of the design. All three DB effects happen in one transaction, so the leak window is zero; cache eviction happens after commit, matching `clearMemoryScope` (`scope-clear.ts:111`).

**Files:**
- Modify: `src/long-term-memory/purge.ts`
- Create: `tests/long-term-memory/purge.test.ts`

**Interfaces:**
- Consumes: `workingMemoryKeyMatch` (Task 3), `evictUser` (`../cache.js`), `profileScopeCondition` (`./record-conditions.js`).
- Produces: unchanged public signature `purgeMemoryRecord(scope, recordId, now): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `tests/long-term-memory/purge.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryProfiles, memorySummary } from '../../src/db/schema.js'
import { loadSummary } from '../../src/memory.js'
import { profileScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import { getMemoryProfile, saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const NOW = '2026-07-25T12:00:00.000Z'

const record = (scope: MemoryScope, id: string, content: string): MemoryRecordInput => ({
  id,
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  kind: 'fact',
  content,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
})

const seedSummary = (key: string, text: string): void => {
  getDrizzleDb()
    .insert(memorySummary)
    .values({ userId: key, summary: text, updatedAt: '2026-07-01T00:00:00.000Z' })
    .run()
}

const summaryRowCount = (key: string): number =>
  getDrizzleDb().select().from(memorySummary).all().filter((row) => row.userId === key).length

describe('purgeMemoryRecord — derived-memory contamination', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('stamps contaminated_at on the scope profile', () => {
    const scope: MemoryScope = { scopeId: 'dm-1', scopeType: 'personal' }
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record(scope, 'mem-1', 'User lives in Berlin'))

    expect(getMemoryProfile(scope)?.contaminatedAt).toBeNull()
    expect(purgeMemoryRecord(scope, 'mem-1', NOW)).toBe(true)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)
  })

  test('does not create a profile row for a scope that has none', () => {
    const scope: MemoryScope = { scopeId: 'dm-2', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-2', 'User lives in Berlin'))

    expect(purgeMemoryRecord(scope, 'mem-2', NOW)).toBe(true)
    expect(getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()).toBeUndefined()
  })

  test('deletes the summary for the scope key and its thread sub-keys', () => {
    const scope: MemoryScope = { scopeId: 'grp-1', scopeType: 'group' }
    seedSummary('grp-1', 'The user lives in Berlin.')
    seedSummary('grp-1:thread:42', 'Berlin came up again in this thread.')
    seedSummary('grp-2', 'A different group entirely.')
    saveMemoryRecord(record(scope, 'mem-3', 'User lives in Berlin'))

    expect(purgeMemoryRecord(scope, 'mem-3', NOW)).toBe(true)

    expect(summaryRowCount('grp-1')).toBe(0)
    expect(summaryRowCount('grp-1:thread:42')).toBe(0)
    // an unrelated scope is untouched
    expect(summaryRowCount('grp-2')).toBe(1)
  })

  test('evicts the summary cache so the next turn cannot serve stale prose', () => {
    const scope: MemoryScope = { scopeId: 'dm-3', scopeType: 'personal' }
    seedSummary('dm-3', 'The user lives in Berlin.')
    saveMemoryRecord(record(scope, 'mem-4', 'User lives in Berlin'))

    // populate the cache from the DB the way a live turn would
    expect(loadSummary('dm-3')).toBe('The user lives in Berlin.')

    expect(purgeMemoryRecord(scope, 'mem-4', NOW)).toBe(true)
    expect(loadSummary('dm-3')).toBeNull()
  })

  test('leaves derived memory alone when no record matched', () => {
    const scope: MemoryScope = { scopeId: 'dm-4', scopeType: 'personal' }
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    seedSummary('dm-4', 'The user lives in Berlin.')

    expect(purgeMemoryRecord(scope, 'no-such-record', NOW)).toBe(false)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBeNull()
    expect(summaryRowCount('dm-4')).toBe(1)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test tests/long-term-memory/purge.test.ts`
Expected: FAIL — the contamination test gets `null` instead of the timestamp; the summary tests still find rows.

- [ ] **Step 3: Implement**

Replace the whole body of `src/long-term-memory/purge.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { evictUser } from '../cache.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { memoryProfiles, memoryRecords, memorySummary, memoryTombstones } from '../db/schema.js'
import { logger } from '../logger.js'
import { profileScopeCondition, recordScopeCondition } from './record-conditions.js'
import { workingMemoryKeyMatch } from './scope-clear.js'
import { tombstoneValues } from './tombstone.js'
import type { MemoryScope } from './types.js'

const log = logger.child({ scope: 'long-term-memory:purge' })

type PurgeOutcome = Readonly<{ purged: boolean; contaminatedProfile: boolean; clearedSummaryKeys: readonly string[] }>

const NOT_PURGED: PurgeOutcome = { purged: false, contaminatedProfile: false, clearedSummaryKeys: [] }

/**
 * Permanently destroys one memory record, tombstones its content so background
 * extraction cannot re-learn it, and invalidates the derived prose that may have
 * absorbed the same fact.
 *
 * The profile is unstructured prose: the erased fact cannot be surgically removed
 * from it, so the whole profile is marked contaminated and withheld (see
 * `visibleProfileText`) until a background extraction rewrites it from the surviving
 * records. The rolling summary cannot be regenerated at all — its source messages
 * were consumed by the trim that produced it — so it is deleted outright.
 *
 * All three effects share one transaction, so nothing reaches the model between the
 * record's deletion and the suppression of its derivatives. Cache eviction runs after
 * the commit, mirroring `clearMemoryScope`.
 *
 * Returns false when no record matched, in which case nothing else is touched.
 */
export function purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean {
  const db = getDrizzleDb()
  const outcome = db.transaction((tx): PurgeOutcome => {
    const deleted = tx
      .delete(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .returning({ content: memoryRecords.content })
      .all()
    const row = deleted[0]
    if (row === undefined) return NOT_PURGED

    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, row.content, now))
      .onConflictDoNothing()
      .run()

    const contaminated = tx
      .update(memoryProfiles)
      .set({ contaminatedAt: now })
      .where(profileScopeCondition(scope))
      .returning({ scopeId: memoryProfiles.scopeId })
      .all()

    const clearedSummaryKeys = tx
      .delete(memorySummary)
      .where(workingMemoryKeyMatch(memorySummary.userId, scope))
      .returning({ key: memorySummary.userId })
      .all()
      .map((summaryRow) => summaryRow.key)

    return { purged: true, contaminatedProfile: contaminated.length > 0, clearedSummaryKeys }
  })

  if (!outcome.purged) return false

  for (const key of outcome.clearedSummaryKeys) evictUser(key)

  log.info(
    {
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      recordId,
      contaminatedProfile: outcome.contaminatedProfile,
      clearedSummaryKeys: outcome.clearedSummaryKeys.length,
    },
    'Memory record purged; derived memory invalidated',
  )
  return true
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/long-term-memory/purge.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Check for cycles and regressions**

Run: `bun run lint && bun test tests/long-term-memory/`
Expected: PASS. `import/no-cycle` is clean — `purge.ts` imports `scope-clear.ts` and `cache.ts`, neither of which imports back.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/purge.ts tests/long-term-memory/purge.test.ts
git commit -m "feat(memory): purge contaminates the profile and deletes scope summaries"
```

---

## Task 5: The prompt builder injects only the visible profile

**Files:**
- Modify: `src/conversation.ts:61-84`
- Modify: `tests/conversation.test.ts`

**Interfaces:**
- Consumes: `visibleProfileText` (Task 2), `purgeMemoryRecord` (Task 4).
- Produces: no new exports; `buildMessagesWithMemory` emits no profile prose while the scope is contaminated.

- [ ] **Step 1: Write the failing test**

Append to `tests/conversation.test.ts` (adding any imports it lacks):

```ts
import { buildMessagesWithMemory } from '../src/conversation.js'
import { purgeMemoryRecord } from '../src/long-term-memory/purge.js'
import { saveMemoryProfile, saveMemoryRecord } from '../src/long-term-memory/store.js'
import type { MemoryRecordInput } from '../src/long-term-memory/types.js'
import { setupTestDb } from './utils/test-helpers.js'

describe('buildMessagesWithMemory — contaminated profile', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  const seedRecord = (): MemoryRecordInput => ({
    id: 'mem-1',
    scopeId: 'dm-9',
    scopeType: 'personal',
    kind: 'fact',
    content: 'User lives in Berlin',
    summary: null,
    tags: [],
    confidence: 1,
    status: 'active',
    source: 'explicit',
    evidence: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-01T00:00:00.000Z',
  })

  test('omits profile prose after a purge, with no worker run', () => {
    saveMemoryProfile({ scopeId: 'dm-9', scopeType: 'personal' }, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(seedRecord())

    const before = buildMessagesWithMemory('dm-9', [], 'dm')
    expect(before.memoryMsg?.content ?? '').toContain('Berlin')

    purgeMemoryRecord({ scopeId: 'dm-9', scopeType: 'personal' }, 'mem-1', '2026-07-25T12:00:00.000Z')

    const after = buildMessagesWithMemory('dm-9', [], 'dm')
    expect(after.memoryMsg?.content ?? '').not.toContain('Berlin')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun test tests/conversation.test.ts`
Expected: FAIL on the final assertion — the contaminated prose is still injected.

- [ ] **Step 3: Route the read through the gate**

In `src/conversation.ts`, add to the import block (after the `buildLongTermMemoryContextMessage` import):

```ts
import { visibleProfileText } from './long-term-memory/profile-visibility.js'
```

and change line 70 from `const profile = memoryProfile?.profile ?? null` to:

```ts
  const profile = visibleProfileText(memoryProfile)
```

- [ ] **Step 4: Run the test**

Run: `bun test tests/conversation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts tests/conversation.test.ts
git commit -m "feat(memory): stop injecting contaminated profile prose into prompts"
```

---

## Task 6: The extractor never sees contaminated prose; a rewrite clears the flag

This is the regeneration half. There is no new worker: the existing background extraction already rewrites the profile from the scope's remaining active records, so making `saveMemoryProfile` clear the flag is the whole restoration path.

The other half of this task is the more important one. `performExtraction` currently feeds the old profile back into the extraction prompt, so if it passed the contaminated prose the LLM would copy the erased fact straight into the replacement — the flag would clear and the fact would be durable again.

**Files:**
- Modify: `src/long-term-memory/runner.ts:180,197`
- Modify: `src/long-term-memory/store.ts:97-111` (`saveMemoryProfile`)
- Create: `tests/long-term-memory/profile-regeneration.test.ts`

**Interfaces:**
- Consumes: `visibleProfileText` (Task 2), `RunMemoryExtractionDeps` / `ExtractMemoryPatchRunInput` (existing, `runner.ts:39,47`).
- Produces: `saveMemoryProfile` now resets `contaminatedAt` to `null` on both insert and update.

- [ ] **Step 1: Write the failing tests**

Create `tests/long-term-memory/profile-regeneration.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import {
  runMemoryExtractionInBackground,
  type ExtractMemoryPatchRunInput,
  type RunMemoryExtractionDeps,
} from '../../src/long-term-memory/runner.js'
import { getMemoryProfile, saveMemoryProfile, saveMemoryRecord } from '../../src/long-term-memory/store.js'
import type { MemoryPatch } from '../../src/long-term-memory/extractor.js'
import type { MemoryRecordInput, MemoryScope } from '../../src/long-term-memory/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

const scope: MemoryScope = { scopeId: 'dm-reg', scopeType: 'personal' }
const NOW = '2026-07-25T12:00:00.000Z'

const record = (id: string, content: string): MemoryRecordInput => ({
  id,
  scopeId: scope.scopeId,
  scopeType: scope.scopeType,
  kind: 'fact',
  content,
  summary: null,
  tags: [],
  confidence: 1,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  lastSeenAt: '2026-07-01T00:00:00.000Z',
})

const emptyPatch: MemoryPatch = { profile: null, records: [], updates: [] }

const makeDeps = (
  overrides: Partial<RunMemoryExtractionDeps> & { onCall?: (input: ExtractMemoryPatchRunInput) => void } = {},
): Partial<RunMemoryExtractionDeps> => ({
  extractMemoryPatch: (input) => {
    overrides.onCall?.(input)
    return Promise.resolve(emptyPatch)
  },
  now: () => NOW,
  ...overrides,
})

describe('profile regeneration after contamination', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('the extractor is handed null instead of contaminated prose', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    purgeMemoryRecord(scope, 'mem-1', NOW)

    const seen: (string | null)[] = []
    await runMemoryExtractionInBackground({
      storageContextId: scope.scopeId,
      configContextId: 'cfg-1',
      contextType: 'dm',
      history: [],
      deps: makeDeps({ onCall: (input) => seen.push(input.profile) }),
    })

    expect(seen).toEqual([null])
  })

  test('writing a new profile clears the contamination flag', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    saveMemoryRecord(record('mem-2', 'User prefers dark mode'))
    purgeMemoryRecord(scope, 'mem-1', NOW)
    expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)

    await runMemoryExtractionInBackground({
      storageContextId: scope.scopeId,
      configContextId: 'cfg-1',
      contextType: 'dm',
      history: [],
      deps: makeDeps({
        extractMemoryPatch: () => Promise.resolve({ ...emptyPatch, profile: 'User prefers dark mode' }),
      }),
    })

    const profile = getMemoryProfile(scope)
    expect(profile?.contaminatedAt).toBeNull()
    expect(profile?.profile).toBe('User prefers dark mode')
  })

  test('fails closed: a throwing extractor leaves the profile suppressed', async () => {
    saveMemoryProfile(scope, 'User lives in Berlin', '2026-07-01T00:00:00.000Z')
    saveMemoryRecord(record('mem-1', 'User lives in Berlin'))
    purgeMemoryRecord(scope, 'mem-1', NOW)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runMemoryExtractionInBackground({
        storageContextId: scope.scopeId,
        configContextId: 'cfg-1',
        contextType: 'dm',
        history: [],
        deps: makeDeps({ extractMemoryPatch: () => Promise.reject(new Error('LLM unavailable')) }),
      })
      expect(getMemoryProfile(scope)?.contaminatedAt).toBe(NOW)
    }
  })
})
```

`MemoryPatch` is `{ profile: string | null; records: [...]; updates: [...] }` (`extractor.ts:56-62`), so `emptyPatch` above is complete.

Note the deps shape: supplying `extractMemoryPatch` without `buildModel` makes `shouldResolveModel` return `false` (`runner.ts:158`), so the runner skips LLM-config resolution entirely and no `resolveConfig`/`buildModel` stubs are needed.

- [ ] **Step 2: Run and confirm they fail**

Run: `bun test tests/long-term-memory/profile-regeneration.test.ts`
Expected: FAIL — test 1 sees `'User lives in Berlin'` instead of `null`; test 2 still reports the flag set.

- [ ] **Step 3: Feed the extractor only the visible profile**

In `src/long-term-memory/runner.ts`, add to the import block:

```ts
import { visibleProfileText } from './profile-visibility.js'
```

and in `performExtraction` change the `profile` argument (line 197) from `profile: profile?.profile ?? null` to:

```ts
    // Never feed contaminated prose back into extraction: the LLM would copy the
    // erased fact into the replacement profile and make it durable again.
    profile: visibleProfileText(profile),
```

Leave the `profile?.enabled === false` capture check above it unchanged — that reads a flag, not prose.

- [ ] **Step 4: Clear the flag when a new profile is written**

In `src/long-term-memory/store.ts`, change `saveMemoryProfile` to:

```ts
export function saveMemoryProfile(scope: MemoryScope, profile: string, now: string): MemoryProfile {
  getDrizzleDb()
    .insert(memoryProfiles)
    .values({
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      profile,
      enabled: true,
      contaminatedAt: null,
      version: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memoryProfiles.scopeType, memoryProfiles.scopeId],
      set: {
        profile,
        // The replacement was written without the contaminated prose in scope, so it
        // is trustworthy again.
        contaminatedAt: null,
        version: sql`${memoryProfiles.version} + 1`,
        updatedAt: now,
      },
    })
    .run()
  return loadProfile(scope)
}
```

Do **not** add `contaminatedAt` to `setMemoryCaptureEnabled` or `setMemoryRecordInjectionEnabled` — toggling a flag must not un-suppress contaminated prose.

- [ ] **Step 5: Run the tests**

Run: `bun test tests/long-term-memory/profile-regeneration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole memory suite**

Run: `bun test tests/long-term-memory/ tests/conversation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/runner.ts src/long-term-memory/store.ts \
        tests/long-term-memory/profile-regeneration.test.ts
git commit -m "feat(memory): regenerate profile from records and clear contamination"
```

---

## Task 7: Dedup destroys losers instead of archiving them

Required for the correctness of Task 6, not tidiness: rebuilding the profile from "remaining active records" is only sound if no archived twin is still sitting in the table holding the erased fact. Near-duplicate content hashes differently, so the tombstone from purging the survivor never matches the twins.

**Correction to the spec.** Spec §3 says `archiveDuplicates` should call `purgeMemoryRecord`. That is wrong, for two reasons discovered while writing this plan:

1. A dedup loser's content is (by definition of the cluster) the *same fact the survivor keeps*. Tombstoning it would suppress re-capture of a fact the user never forgot — and with an exact-duplicate cluster the hash is literally identical to the surviving record's.
2. After Task 4, `purgeMemoryRecord` also deletes the scope's rolling summary and contaminates its profile. Dedup is a routine background housekeeping event; running it must not wipe a group's session summary.

Dedup is a delete, not a forget. So this task adds a plain `deleteMemoryRecord` (row + FTS + embedding, no tombstone, no derived-memory invalidation) and uses that. The spec's actual requirement — no full un-erasable copy survives a dedup — is met either way, and is met *better* this way, because the twin is gone before the survivor is ever forgotten.

**Files:**
- Modify: `src/long-term-memory/purge.ts` (add `deleteMemoryRecord`)
- Modify: `src/long-term-memory/promotion.ts:13,73-77,114`
- Modify: `src/long-term-memory/store.ts:221-229` (delete `archiveMemoryRecord`)
- Modify: `tests/long-term-memory/store.test.ts:22,182,225` (drop the deleted helper's tests)
- Modify: `tests/long-term-memory/promotion.test.ts` (add the new cases)

**Interfaces:**
- Consumes: `recordScopeCondition` (existing).
- Produces: `deleteMemoryRecord(scope: MemoryScope, recordId: string): boolean` from `./purge.js`. `archiveMemoryRecord` no longer exists. No dedup path writes `status: 'archived'` any more; the enum value stays because `runMemoryMaintenance` still writes it on expiry (`maintenance.ts:51`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/long-term-memory/promotion.test.ts`, inside the existing `describe('evaluatePromotion')` block. It reuses that file's existing `prov()` and `load()` helpers verbatim:

```ts
  test('dedup losers are destroyed, not archived', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))

    const promoted = await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })
    expect(promoted).toBe(true)

    const rows = getDrizzleDb().select().from(memoryRecords).all()
    expect(rows.map((r) => r.id)).toEqual(['m1'])
    expect(rows.some((r) => r.status === 'archived')).toBe(false)
  })

  test('dedup does not tombstone the fact the survivor still holds', async () => {
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))

    await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })

    expect(isContentTombstoned({ scopeId: 'g', scopeType: 'group' }, 'Deploys on Fridays.')).toBe(false)
  })

  test('dedup does not wipe the scope summary', async () => {
    getDrizzleDb()
      .insert(memorySummary)
      .values({ userId: 'g', summary: 'Ongoing session context.', updatedAt: '2026-06-11T00:00:00.000Z' })
      .run()
    saveMemoryRecord(prov('m1', 't-a'))
    saveMemoryRecord(prov('m2', 't-b'))
    saveMemoryRecord(prov('m3', 't-c'))

    await evaluatePromotion({ scopeId: 'g', scopeType: 'group' }, load('m1'), {
      confirmDurable: () => Promise.resolve(true),
      now: () => '2026-06-16T00:00:00.000Z',
    })

    expect(getDrizzleDb().select().from(memorySummary).all()).toHaveLength(1)
  })
```

Add these imports at the top of the file:

```ts
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { memoryRecords, memorySummary } from '../../src/db/schema.js'
import { isContentTombstoned } from '../../src/long-term-memory/tombstone.js'
```

- [ ] **Step 2: Run and confirm the first one fails**

Run: `bun test tests/long-term-memory/promotion.test.ts`
Expected: the first new test FAILS — `rows.map(...)` is `['m1', 'm2', 'm3']` with `m2`/`m3` at `status: 'archived'`. The other two pass already; they are regression guards proving the fix in Step 3 does not overreach into tombstoning or summary deletion.

- [ ] **Step 3: Add a delete that is not a forget**

Append to `src/long-term-memory/purge.ts`:

```ts
/**
 * Destroys one memory record without any of the forget semantics: no tombstone, no
 * profile contamination, no summary deletion. The FTS entry and embedding go with the
 * row.
 *
 * This is for housekeeping that removes a redundant *copy* while the fact itself stays
 * remembered — dedup, chiefly. Writing a tombstone here would suppress re-capture of a
 * fact the user never asked to forget, and invalidating derived prose would wipe a live
 * session summary on every background promotion. Use `purgeMemoryRecord` when the user
 * actually asked to forget something.
 */
export function deleteMemoryRecord(scope: MemoryScope, recordId: string): boolean {
  const rows = getDrizzleDb()
    .delete(memoryRecords)
    .where(recordScopeCondition(scope, recordId))
    .returning({ id: memoryRecords.id })
    .all()
  return rows.length > 0
}
```

- [ ] **Step 4: Use it for dedup**

In `src/long-term-memory/promotion.ts`, remove `archiveMemoryRecord` from the `./store.js` import block (line 13), add:

```ts
import { deleteMemoryRecord } from './purge.js'
```

and change `archiveDuplicates` (lines 73-77) to:

```ts
/**
 * Destroys the losers of a dedup cluster. They are deleted rather than archived: an
 * archived twin keeps a full copy of the fact, and because its content is only a
 * *near*-duplicate, the tombstone written when the survivor is later forgotten does not
 * match it — so archiving leaves a copy that `forget_memory` can never reach.
 */
const deleteDuplicates = (scope: MemoryScope, cluster: readonly MemoryRecord[], keepId: string): void => {
  for (const member of cluster) {
    if (member.id !== keepId) deleteMemoryRecord(scope, member.id)
  }
}
```

Then change the call site at line 114 from `archiveDuplicates(scope, cluster, candidate.id, now)` to:

```ts
  deleteDuplicates(scope, cluster, candidate.id)
```

(`now` is still used by `promoteProvisionalToActive` on the line above, so it does not become unused.)

- [ ] **Step 5: Delete the now-dead helper**

In `src/long-term-memory/store.ts`, delete the whole `archiveMemoryRecord` function (lines 221-229). The dedup path was its only production caller — `runMemoryMaintenance` does its own inline status updates (`maintenance.ts:51,64`) — so leaving it would trip `knip` and would leave an archive-instead-of-delete helper available for a future caller to reintroduce this exact defect.

`recordScopeCondition` is still used by `updateMemoryRecord`, so leave its import in place.

- [ ] **Step 6: Delete its tests**

In `tests/long-term-memory/store.test.ts`, remove `archiveMemoryRecord` from the import list (line 22) and delete the two assertions/tests referencing it (around lines 182 and 225). If a whole `describe('archiveMemoryRecord')` block exists, delete the block.

- [ ] **Step 7: Run the tests and the dead-code check**

Run: `bun test tests/long-term-memory/ && bun run typecheck && bun run knip`
Expected: PASS; `knip` reports no unused export for `archiveMemoryRecord` because it is gone.

- [ ] **Step 8: Commit**

```bash
git add src/long-term-memory/purge.ts src/long-term-memory/promotion.ts src/long-term-memory/store.ts \
        tests/long-term-memory/promotion.test.ts tests/long-term-memory/store.test.ts
git commit -m "fix(memory): delete dedup losers instead of archiving copies"
```

---

## Task 8: State the bounded promise in the tool surface

The current copy says the memory "will not be re-learned" and the gate says "irreversible", but neither states what `forget_memory` does *not* do. The design's §4 boundary — recent conversation is not rewritten — has to be visible to both the model and the user, or the promise is broadly implied and quietly broken.

**Files:**
- Modify: `src/tools/memory.ts:183-196`
- Modify: `tests/tools/memory.test.ts`

**Interfaces:**
- Consumes: `checkConfidence` (existing, `./confirmation-gate.js`).
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/memory.test.ts` (follow the file's existing pattern for building the tool and reading its description — `getToolExecutor()` from `tests/utils/test-helpers.ts` is the house helper):

```ts
test('forget_memory states what it erases and what it does not', () => {
  const forget = makeForgetMemoryTool({ storageContextId: 'dm-1', contextType: 'dm' })
  const description = forget.description ?? ''
  expect(description).toContain('profile')
  expect(description).toContain('summary')
  expect(description).toContain('does not edit')
})

test('the confirmation message names the boundary', async () => {
  const forget = makeForgetMemoryTool({ storageContextId: 'dm-1', contextType: 'dm' })
  const result = await getToolExecutor(forget)({ memory_id: 'mem-1', confidence: 0.2 })
  expect(result).toMatchObject({ status: 'confirmation_required' })
  expect((result as { message: string }).message).toContain('recent chat messages are not edited')
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `bun test tests/tools/memory.test.ts`
Expected: FAIL — the description lacks "profile"; the message lacks the boundary clause.

- [ ] **Step 3: Update the copy**

In `src/tools/memory.ts`, change the `description` in `makeForgetMemoryTool` (line 184) to:

```ts
    description:
      'Permanently delete one long-term memory in the current user or group scope, by memory ID or keyword query. ' +
      'This is irreversible: the memory is erased from long-term storage, its search indexes, the derived user ' +
      'profile, and the running session summary, and it will not be re-learned. It does not edit the recent ' +
      'conversation itself — tell the user to clear the conversation if they also want the original messages gone.',
```

and change the `checkConfidence` call (line 192) to:

```ts
      const gate = checkConfidence(
        confidence,
        'Permanently delete this memory (recent chat messages are not edited)',
      )
```

- [ ] **Step 4: Run the test**

Run: `bun test tests/tools/memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/memory.ts tests/tools/memory.test.ts
git commit -m "docs(memory): state forget_memory's bounded promise in tool copy"
```

---

## Task 9: Bilingual golden set + docs + full gate

The golden set is the artifact that proves the promise end-to-end in both EN and RU, including the boundary the design deliberately does *not* cross.

**Files:**
- Modify: `tests/long-term-memory/durable-erasure.golden.test.ts`
- Modify: `docs/architecture/tools.md` (memory bridge section)

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: the shipped regression suite for Defect 5 slice 2.

- [ ] **Step 1: Extend the golden test**

In `tests/long-term-memory/durable-erasure.golden.test.ts`, add these imports:

```ts
import { conversationHistory, memoryProfiles, memorySummary } from '../../src/db/schema.js'
import { profileScopeCondition } from '../../src/long-term-memory/record-conditions.js'
import { visibleProfileText } from '../../src/long-term-memory/profile-visibility.js'
import { getMemoryProfile, saveMemoryProfile } from '../../src/long-term-memory/store.js'
import { rowToProfile } from '../../src/long-term-memory/serialization.js'
```

and add this block inside the existing `for (const lang of [...])` loop, after the existing test:

```ts
    test(`${lang.name}: purge erases derived prose but leaves the conversation intact`, () => {
      const key = scope.scopeId
      saveMemoryProfile(scope, lang.content, '2026-07-01T00:00:00.000Z')
      getDrizzleDb()
        .insert(memorySummary)
        .values({ userId: key, summary: lang.content, updatedAt: '2026-07-01T00:00:00.000Z' })
        .run()
      getDrizzleDb()
        .insert(conversationHistory)
        .values({ userId: key, messages: JSON.stringify([{ role: 'user', content: lang.content }]) })
        .run()
      saveMemoryRecord(record({ id: lang.id, content: lang.content }))

      // sanity: the profile is visible before the forget
      expect(visibleProfileText(getMemoryProfile(scope))).toBe(lang.content)

      expect(purgeMemoryRecord(scope, lang.id, '2026-07-25T12:00:00.000Z')).toBe(true)

      // profile prose is withheld from every reader
      expect(visibleProfileText(getMemoryProfile(scope))).toBeNull()
      // ...and the raw row still exists but is flagged, so a rewrite can restore quality
      const profileRow = getDrizzleDb().select().from(memoryProfiles).where(profileScopeCondition(scope)).get()
      if (profileRow === undefined) throw new Error('profile row missing after purge')
      expect(rowToProfile(profileRow).contaminatedAt).toBe('2026-07-25T12:00:00.000Z')

      // the rolling summary is gone outright — it cannot be regenerated
      expect(getDrizzleDb().select().from(memorySummary).all().filter((r) => r.userId === key)).toHaveLength(0)

      // BOUNDARY (intended, see spec section 4): what the user actually said is untouched.
      const history = getDrizzleDb()
        .select()
        .from(conversationHistory)
        .where(eq(conversationHistory.userId, key))
        .get()
      expect(history?.messages).toContain(lang.content)
    })
```

(`conversation_history` has exactly two columns, `user_id` and `messages` — `src/db/schema.ts:58-61`.)

- [ ] **Step 2: Run it and confirm both languages pass**

Run: `bun test tests/long-term-memory/durable-erasure.golden.test.ts`
Expected: PASS — 4 tests (EN + RU × 2 cases).

- [ ] **Step 3: Confirm the suite is genuinely red without the fix**

Run:

```bash
git stash push src/long-term-memory/purge.ts
bun test tests/long-term-memory/durable-erasure.golden.test.ts
git stash pop
```

Expected: the new tests FAIL while stashed (profile still visible, summary row still present), then PASS after the pop. This proves the golden set tests the fix rather than the fixture.

- [ ] **Step 4: Document the tiering**

In `docs/architecture/tools.md`, in the memory-bridge section, add:

```markdown
**Erasure tiering (prose as cache).** `memory_records` is the only durable memory
truth — atomic, addressable, individually erasable. Everything derived from it is a
cache: `memory_profiles.profile` is suppressed on purge via `contaminated_at` and
rewritten by the next background extraction; `memory_summary` is deleted on purge
because its source messages no longer exist to regenerate it. Suppression is
synchronous and transactional, so there is no leak window; regeneration is
asynchronous and fail-closed, so a failed rewrite leaves the profile hidden rather
than exposed. Read profile prose only through `visibleProfileText()`.

`forget_memory` does not rewrite `conversation_history` — the original messages age
out of the 100-message window normally. Clearing the conversation is the complete
option.
```

- [ ] **Step 5: Run the full gate**

Run: `bun run check`
Expected: PASS — typecheck, lint, format, and the full test suite. Fix anything red before committing; do not add suppression comments.

- [ ] **Step 6: Commit**

```bash
git add tests/long-term-memory/durable-erasure.golden.test.ts docs/architecture/tools.md
git commit -m "test(memory): bilingual golden set for derived-memory erasure"
```

---

## Done when

- `bun run check` is green.
- Purging a record leaves no copy of its content reachable through records, indexes, profile prose, or the session summary — proven in EN and RU.
- The profile stays hidden if regeneration never runs or throws.
- No dedup path produces an archived duplicate; `archiveMemoryRecord` no longer exists.
- The conversation-history boundary is asserted by a test, not assumed.
