<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shadow-Funnel Dry-Run and Collection Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the memory-recall shadow-funnel read-out end-to-end against seeded fixture data, and give operators a runbook so enabling collection is a deliberate decision.

**Architecture:** A new `shadow-gate.ts` module holds the two pre-registered preconditions (N = 1000 memory-bearing turns, M ≥ 50 distinct scopes) and renders descriptive markers; the operator script prints those markers inline next to the values they judge. A subprocess integration test seeds a real migrated SQLite file with fixture rows across three reader models, spawns the real CLI against it via `DB_PATH`, and asserts the printed output. A new deployment doc documents the enable/read/stop procedure.

**Tech Stack:** Bun, `bun:test`, `bun:sqlite`, Drizzle ORM, oxlint, oxfmt.

**Spec:** [`docs/superpowers/specs/2026-07-27-shadow-funnel-dry-run-design.md`](../specs/2026-07-27-shadow-funnel-dry-run-design.md)

## Global Constraints

- Runtime is **Bun**. Tests use `bun:test` (`import { describe, expect, test } from 'bun:test'`). No Jest, no Vitest.
- **Strict TypeScript. Import paths always end in `.js`** even when the source file is `.ts`.
- Every new file needs the BUSL-1.1 license header. `.ts` files use the `//` comment form; `.md` files use the `<!-- -->` form. A commit without it fails the pre-commit hook.
- **Never add a lint-disable or type-ignore comment.** Hook policy blocks them.
- `typescript/explicit-function-return-type` is on: **every function needs an explicit return type**, including arrow functions and test helpers.
- `max-lines-per-function` is active under the `pedantic` category for `src/` and `scripts/` (it is turned off only for `tests/**`). Default limit is 50 lines. If a function trips it, **split it** — do not compress formatting.
- **No pre-registered quantity may move.** The frozen numbers are: sample rate `0.1`, `shadow_hit` criterion `shadow_hit_count >= 1`, rank cutoff k = 8, bucket-3 stop threshold `< 5%`, N = 1000, M >= 50. This plan renders two of them; it changes none.
- **Never average or pool across reader models.** Every output is per `reader_model_id`.
- The bucket-3 5% threshold must **not** appear as a constant anywhere in `src/` or `scripts/`.

---

### Task 1: The gate-precondition module

**Files:**

- Create: `src/long-term-memory/shadow-gate.ts`
- Test: `tests/long-term-memory/shadow-gate.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS: number` (= 1000)
  - `SHADOW_GATE_MIN_DISTINCT_SCOPES: number` (= 50)
  - `formatPreconditionMarker(value: number, threshold: number, criterion: string): string`
  - `formatTurnsMarker(memoryBearingTurns: number): string`
  - `formatScopesMarker(distinctScopes: number): string`

- [ ] **Step 1: Write the failing test**

Create `tests/long-term-memory/shadow-gate.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  formatPreconditionMarker,
  formatScopesMarker,
  formatTurnsMarker,
  SHADOW_GATE_MIN_DISTINCT_SCOPES,
  SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS,
} from '../../src/long-term-memory/shadow-gate.js'

describe('shadow gate preconditions', () => {
  // These two numbers are pre-registered (frozen 2026-07-25). A failure here means
  // someone moved a protocol quantity -- that is a goalpost move, not a test to update.
  test('holds the frozen pre-registered thresholds', () => {
    expect(SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS).toBe(1000)
    expect(SHADOW_GATE_MIN_DISTINCT_SCOPES).toBe(50)
  })

  test('formatPreconditionMarker reads "below" under the threshold', () => {
    expect(formatPreconditionMarker(9, 10, 'X >= 10')).toBe('(below the pre-registered X >= 10)')
  })

  test('formatPreconditionMarker reads "meets" at the threshold exactly', () => {
    expect(formatPreconditionMarker(10, 10, 'X >= 10')).toBe('(meets the pre-registered X >= 10)')
  })

  test('formatPreconditionMarker reads "meets" above the threshold', () => {
    expect(formatPreconditionMarker(11, 10, 'X >= 10')).toBe('(meets the pre-registered X >= 10)')
  })

  test('formatTurnsMarker renders N on both sides and at the boundary', () => {
    expect(formatTurnsMarker(999)).toBe('(below the pre-registered N = 1000)')
    expect(formatTurnsMarker(1000)).toBe('(meets the pre-registered N = 1000)')
    expect(formatTurnsMarker(1001)).toBe('(meets the pre-registered N = 1000)')
  })

  test('formatScopesMarker renders M on both sides and at the boundary', () => {
    expect(formatScopesMarker(49)).toBe('(below the pre-registered M >= 50)')
    expect(formatScopesMarker(50)).toBe('(meets the pre-registered M >= 50)')
    expect(formatScopesMarker(51)).toBe('(meets the pre-registered M >= 50)')
  })

  // The markers describe; they never render a verdict. The go/no-go call stays with the
  // operator, read against the threats-to-validity ledger in the design doc.
  test('markers never render verdict words', () => {
    const samples = [formatTurnsMarker(1), formatTurnsMarker(5000), formatScopesMarker(1), formatScopesMarker(500)]
    for (const sample of samples) {
      expect(sample).not.toMatch(/PASS|FAIL|GO|STOP|ESCALATE/i)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/long-term-memory/shadow-gate.test.ts`
Expected: FAIL — module `src/long-term-memory/shadow-gate.js` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/long-term-memory/shadow-gate.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The two **mechanical** preconditions of the pre-registered P1 decision gate, plus the
 * descriptive markers the operator report renders beside the values they judge.
 *
 * Pre-registered on 2026-07-25 and frozen: the gate requires N = 1000 sampled
 * memory-bearing turns across M >= 50 distinct scopes, **per reader model**, before its
 * under-trigger rate may be trusted (see
 * `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`). Both are
 * plain `>=` comparisons, which is why automating them is safe.
 *
 * **The bucket-3 stop threshold (< 5%) is deliberately absent from this module and must
 * not be added.** The spec is explicit that P1 *screens* for the gap while a human
 * *adjudicates* it against the recorded threats to validity. A 5% constant living in code
 * would both hand that judgment to a script and make a later edit indistinguishable from
 * post-hoc goalpost-moving.
 *
 * Markers are descriptive by design -- "meets"/"below", never "PASS"/"FAIL" or any word
 * that reads as a verdict.
 */

/** N -- the pre-registered per-reader-model collection target in memory-bearing turns. */
export const SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS = 1000

/** M -- the pre-registered per-reader-model floor on distinct scopes. */
export const SHADOW_GATE_MIN_DISTINCT_SCOPES = 50

/**
 * Renders a value's standing against a pre-registered threshold. Both gate preconditions
 * are `>=`, so a value exactly equal to its threshold reads `meets`.
 *
 * `criterion` is the human-readable form of the precondition (e.g. `'M >= 50'`), rendered
 * verbatim into the marker.
 */
export function formatPreconditionMarker(value: number, threshold: number, criterion: string): string {
  const standing = value >= threshold ? 'meets' : 'below'
  return `(${standing} the pre-registered ${criterion})`
}

/** Marker for a reader model's memory-bearing turn count against N. */
export function formatTurnsMarker(memoryBearingTurns: number): string {
  return formatPreconditionMarker(
    memoryBearingTurns,
    SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS,
    `N = ${SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS}`,
  )
}

/** Marker for a reader model's distinct-scope count (M) against the scope floor. */
export function formatScopesMarker(distinctScopes: number): string {
  return formatPreconditionMarker(
    distinctScopes,
    SHADOW_GATE_MIN_DISTINCT_SCOPES,
    `M >= ${SHADOW_GATE_MIN_DISTINCT_SCOPES}`,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/long-term-memory/shadow-gate.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: both clean. If `knip` later flags `formatPreconditionMarker` as an unused export, do **not** delete it — it is the unit under test; add it to `knip.config.ts` ignores instead.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/shadow-gate.ts tests/long-term-memory/shadow-gate.test.ts
git commit -m "feat(memory): add pre-registered shadow-gate precondition markers"
```

---

### Task 2: File-backed migrated database helper

**Files:**

- Modify: `tests/utils/test-helpers.ts` (add an exported function near the existing `buildMigratedSnapshot` at line 117)
- Test: `tests/utils/migrated-db-file.test.ts`

**Interfaces:**

- Consumes: the existing private `buildMigratedSnapshot(migrations)` and the `MIGRATIONS` constant already imported in `test-helpers.ts`.
- Produces: `createMigratedDbFile(path: string): Promise<void>`

**Why:** `setupTestDb()` installs an **in-memory** database. A spawned subprocess cannot see it — the CLI in Task 3 opens whatever `DB_PATH` points at. `buildMigratedSnapshot` already returns a standalone serialized SQLite image, so writing those bytes to disk yields a valid, fully-migrated database file.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/migrated-db-file.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMigratedDbFile } from './test-helpers.js'

describe('createMigratedDbFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrated-db-file-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('writes an on-disk database another connection can open and read', async () => {
    const dbPath = join(dir, 'test.db')

    await createMigratedDbFile(dbPath)

    // A fresh connection stands in for the subprocess that will open this file via DB_PATH.
    const sqlite = new Database(dbPath)
    const tables = sqlite
      .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
      .all()
      .map((tableRow) => tableRow.name)
    sqlite.close()

    expect(tables).toContain('memory_recall_shadow_log')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/utils/migrated-db-file.test.ts`
Expected: FAIL — `createMigratedDbFile` is not exported from `test-helpers.js`.

- [ ] **Step 3: Write the implementation**

In `tests/utils/test-helpers.ts`, immediately after the `buildMigratedSnapshot` function (which ends at line 131) and before `setupMigratedTestDb`, insert:

```typescript
/**
 * Writes a fully-migrated SQLite database **file** at `path`.
 *
 * `setupTestDb()` installs an in-memory database, which a spawned subprocess cannot see.
 * Use this when a test must hand a real on-disk database to a child process -- e.g. an
 * operator script spawned with `DB_PATH` pointed at it.
 */
export async function createMigratedDbFile(path: string): Promise<void> {
  const snapshot = await buildMigratedSnapshot(MIGRATIONS)
  await Bun.write(path, snapshot)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/utils/migrated-db-file.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Confirm no existing helper consumer broke**

Run: `bun test tests/long-term-memory/`
Expected: PASS. `test-helpers.ts` is a widely shared module; this proves the insertion did not disturb it.

- [ ] **Step 6: Commit**

```bash
git add tests/utils/test-helpers.ts tests/utils/migrated-db-file.test.ts
git commit -m "test: add createMigratedDbFile for subprocess-visible test databases"
```

---

### Task 3: The dry-run — fixture, CLI test, and precondition markers

**Files:**

- Create: `tests/long-term-memory/shadow-funnel-fixture.ts`
- Create: `tests/long-term-memory/shadow-funnel-cli.test.ts`
- Modify: `scripts/memory-shadow-funnel.ts` (whole-file rewrite shown in Step 5)

**Interfaces:**

- Consumes: `createMigratedDbFile` (Task 2); `formatTurnsMarker` / `formatScopesMarker` (Task 1); the existing `insertShadowLogRow(row: ShadowLogRow): void` from `src/long-term-memory/store.js`; the existing `setTestDrizzleDb` / `restoreDrizzle` from `tests/utils/test-helpers.js`.
- Produces: `seedShadowFunnelFixture(): void` — inserts the full fixture through whatever database the Drizzle singleton currently points at.

**The fixture** — three reader models, 248 rows. Every branch of the read-out appears in one run:

| model     | scopes (M) | memory-bearing turns | shadow hits | under-trigger | rate   | overlap-when-pulled | over-pull |
| --------- | ---------- | -------------------- | ----------- | ------------- | ------ | ------------------- | --------- |
| `model-a` | 55         | 110                  | 44          | 4             | 3.64%  | 30                  | 10        |
| `model-b` | 52         | 104                  | 38          | 13            | 12.50% | 20                  | 5         |
| `model-c` | 12         | 24                   | 12          | 6             | 25.00% | 4                   | 2         |

Two traps are deliberate:

- **Zero-record scopes.** `model-a` gets 10 extra rows on 5 further scopes that only ever produced `activeRecordCount = 0` turns. They must not appear in M (which stays 55) or in the turn count (which stays 110). The SQL guards this with a `case when` inside `count(distinct ...)`; untested against the CLI, that guard is just a comment.
- **Shared scope hashes.** `model-c` reuses `model-a`'s scope hashes. A globally-distinct scope count — the natural shape of a pooling bug — would print 107 instead of the correct per-model 55/52/12.

- [ ] **Step 1: Write the fixture builder**

Create `tests/long-term-memory/shadow-funnel-fixture.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Fixture for the shadow-funnel CLI dry-run. Seeds rows through the real
 * `insertShadowLogRow` writer -- not raw SQL -- so a column the writer sets wrongly
 * surfaces in the dry-run rather than in production.
 *
 * Expected aggregates are hardcoded in the test, not recomputed from this builder:
 * deriving them here would re-run the arithmetic under test and assert it equals itself.
 */

import type { ShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import { insertShadowLogRow } from '../../src/long-term-memory/store.js'

type TurnCategory = 'under-trigger' | 'pulled-overlap' | 'over-pull' | 'quiet'

type ModelFixture = Readonly<{
  readerModelId: string
  /** Scope hashes are `${scopePrefix}${index padded to 2}`. */
  scopePrefix: string
  scopeCount: number
  turnsPerScope: number
  underTrigger: number
  pulledOverlap: number
  overPull: number
}>

const MODEL_FIXTURES: readonly ModelFixture[] = [
  {
    readerModelId: 'model-a',
    scopePrefix: 'scope-a-',
    scopeCount: 55,
    turnsPerScope: 2,
    underTrigger: 4,
    pulledOverlap: 30,
    overPull: 10,
  },
  {
    readerModelId: 'model-b',
    scopePrefix: 'scope-b-',
    scopeCount: 52,
    turnsPerScope: 2,
    underTrigger: 13,
    pulledOverlap: 20,
    overPull: 5,
  },
  // Reuses model-a's scope prefix on purpose: a globally-distinct scope count would
  // print 107 rather than the correct per-model 55 / 52 / 12.
  {
    readerModelId: 'model-c',
    scopePrefix: 'scope-a-',
    scopeCount: 12,
    turnsPerScope: 2,
    underTrigger: 6,
    pulledOverlap: 4,
    overPull: 2,
  },
]

/** Scopes that only ever produced zero-active-record turns. Must not inflate M. */
const ZERO_RECORD_SCOPE_COUNT = 5
const ZERO_RECORD_TURNS_PER_SCOPE = 2

function scopeHashFor(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(2, '0')}`
}

function categoriesFor(fixture: ModelFixture): readonly TurnCategory[] {
  const total = fixture.scopeCount * fixture.turnsPerScope
  const quiet = total - fixture.underTrigger - fixture.pulledOverlap - fixture.overPull
  return [
    ...Array.from({ length: fixture.underTrigger }, (): TurnCategory => 'under-trigger'),
    ...Array.from({ length: fixture.pulledOverlap }, (): TurnCategory => 'pulled-overlap'),
    ...Array.from({ length: fixture.overPull }, (): TurnCategory => 'over-pull'),
    ...Array.from({ length: quiet }, (): TurnCategory => 'quiet'),
  ]
}

type CategoryFields = Pick<
  ShadowLogRow,
  | 'activeRecordCount'
  | 'shadowHitCount'
  | 'modelPulled'
  | 'pullCount'
  | 'pullQueryHash'
  | 'pullResultCount'
  | 'shadowPullOverlap'
>

function rowForCategory(category: TurnCategory): CategoryFields {
  switch (category) {
    case 'under-trigger':
      // The P1 headline bucket: the shadow surfaced something, the model never looked.
      return {
        activeRecordCount: 3,
        shadowHitCount: 1,
        modelPulled: false,
        pullCount: 0,
        pullQueryHash: null,
        pullResultCount: 0,
        shadowPullOverlap: 0,
      }
    case 'pulled-overlap':
      return {
        activeRecordCount: 3,
        shadowHitCount: 2,
        modelPulled: true,
        pullCount: 1,
        pullQueryHash: 'hash-pull',
        pullResultCount: 2,
        shadowPullOverlap: 1,
      }
    case 'over-pull':
      return {
        activeRecordCount: 3,
        shadowHitCount: 1,
        modelPulled: true,
        pullCount: 1,
        pullQueryHash: 'hash-pull',
        pullResultCount: 1,
        shadowPullOverlap: 0,
      }
    case 'quiet':
      // Memory-bearing, but the shadow surfaced nothing: counts toward N and M only.
      return {
        activeRecordCount: 2,
        shadowHitCount: 0,
        modelPulled: false,
        pullCount: 0,
        pullQueryHash: null,
        pullResultCount: 0,
        shadowPullOverlap: 0,
      }
  }
}

function baseRow(readerModelId: string, scopeHash: string, turnRef: string): ShadowLogRow {
  return {
    scopeHash,
    contextHash: `hash-context-${scopeHash}`,
    turnRef,
    readerModelId,
    activeRecordCount: 0,
    shadowQueryHash: 'hash-query',
    shadowQueryLenBucket: 'medium',
    shadowHitCount: 0,
    shadowTopScore: null,
    shadowTopProvenance: null,
    shadowTopRecordHash: null,
    modelPulled: false,
    pullCount: 0,
    pullQueryHash: null,
    pullResultCount: 0,
    shadowPullOverlap: 0,
    skippedReason: null,
  }
}

/** Top-hit fields are set only when the shadow actually hit, mirroring the real writer. */
function topHitFields(
  fields: CategoryFields,
): Pick<ShadowLogRow, 'shadowTopScore' | 'shadowTopProvenance' | 'shadowTopRecordHash'> {
  if (fields.shadowHitCount === 0) {
    return { shadowTopScore: null, shadowTopProvenance: null, shadowTopRecordHash: null }
  }
  return { shadowTopScore: 0.5, shadowTopProvenance: 'current', shadowTopRecordHash: 'hash-record' }
}

function seedModel(fixture: ModelFixture): void {
  const categories = categoriesFor(fixture)
  categories.forEach((category, turnIndex) => {
    const scopeHash = scopeHashFor(fixture.scopePrefix, Math.floor(turnIndex / fixture.turnsPerScope))
    const turnRef = `${fixture.readerModelId}-turn-${turnIndex}`
    const fields = rowForCategory(category)
    insertShadowLogRow({
      ...baseRow(fixture.readerModelId, scopeHash, turnRef),
      ...fields,
      ...topHitFields(fields),
    })
  })
}

function seedZeroRecordScopes(readerModelId: string): void {
  for (let scopeIndex = 0; scopeIndex < ZERO_RECORD_SCOPE_COUNT; scopeIndex++) {
    for (let turnIndex = 0; turnIndex < ZERO_RECORD_TURNS_PER_SCOPE; turnIndex++) {
      const scopeHash = `${readerModelId}-zero-${scopeIndex}`
      insertShadowLogRow({
        ...baseRow(readerModelId, scopeHash, `${scopeHash}-turn-${turnIndex}`),
        skippedReason: 'no-active-records',
      })
    }
  }
}

/** Seeds the full fixture into whatever database the Drizzle singleton points at. */
export function seedShadowFunnelFixture(): void {
  for (const fixture of MODEL_FIXTURES) {
    seedModel(fixture)
  }
  seedZeroRecordScopes('model-a')
}
```

- [ ] **Step 2: Write the failing CLI test**

Create `tests/long-term-memory/shadow-funnel-cli.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as schema from '../../src/db/schema.js'
import { createMigratedDbFile, restoreDrizzle, setTestDrizzleDb } from '../utils/test-helpers.js'
import { seedShadowFunnelFixture } from './shadow-funnel-fixture.js'

describe('memory:shadow-funnel CLI dry-run', () => {
  let dir: string
  let dbPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shadow-funnel-cli-'))
    dbPath = join(dir, 'funnel.db')
    await createMigratedDbFile(dbPath)

    // Point the singleton at the on-disk file so the real writer seeds it, then close and
    // release it -- the spawned CLI opens the same path itself.
    const sqlite = new Database(dbPath)
    sqlite.run('PRAGMA foreign_keys=ON')
    setTestDrizzleDb(drizzle(sqlite, { schema }))
    seedShadowFunnelFixture()
    sqlite.close()
    restoreDrizzle()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function runFunnel(args: readonly string[] = []): Promise<string> {
    const proc = Bun.spawn(['bun', 'run', 'scripts/memory-shadow-funnel.ts', ...args], {
      env: { ...process.env, DB_PATH: dbPath },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) throw new Error(`funnel script exited ${exitCode}: ${stderr}`)
    return stdout
  }

  test('prints one block per reader model, ascending, with no pooled figures', async () => {
    const out = await runFunnel()

    expect(out.match(/reader_model_id: /g)).toHaveLength(3)
    expect(out.indexOf('model-a')).toBeLessThan(out.indexOf('model-b'))
    expect(out.indexOf('model-b')).toBeLessThan(out.indexOf('model-c'))

    // A pooled distinct-scope count would be 107 (model-c shares model-a's scopes) and a
    // pooled turn count would be 238. Neither may ever appear.
    expect(out).not.toContain('107')
    expect(out).not.toContain('238')
    expect(out.toLowerCase()).not.toContain('all models')
    expect(out.toLowerCase()).not.toContain('total')
  })

  test('reports model-a exactly: preconditions met on M, short on N, below-5% rate', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-a')
    expect(out).toContain('  memory-bearing turns:      110 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 44')
    expect(out).toContain('  under-trigger turns:       4')
    expect(out).toContain('  under-trigger rate:        3.64%')
    expect(out).toContain('  overlap-when-pulled turns: 30')
    expect(out).toContain('  over-pull turns:           10')
    // 55, not 60: the 5 zero-active-record scopes must not inflate M.
    expect(out).toContain('  distinct scopes (M):       55 (meets the pre-registered M >= 50)')
  })

  test('reports model-b exactly: preconditions met on M, rate at/above 5%', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-b')
    expect(out).toContain('  memory-bearing turns:      104 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 38')
    expect(out).toContain('  under-trigger turns:       13')
    expect(out).toContain('  under-trigger rate:        12.50%')
    expect(out).toContain('  overlap-when-pulled turns: 20')
    expect(out).toContain('  over-pull turns:           5')
    expect(out).toContain('  distinct scopes (M):       52 (meets the pre-registered M >= 50)')
  })

  test('reports model-c exactly: M short, so its high rate is not yet trustworthy', async () => {
    const out = await runFunnel()

    expect(out).toContain('reader_model_id: model-c')
    expect(out).toContain('  memory-bearing turns:      24 (below the pre-registered N = 1000)')
    expect(out).toContain('  shadow_hit turns (rank>=1): 12')
    expect(out).toContain('  under-trigger turns:       6')
    expect(out).toContain('  under-trigger rate:        25.00%')
    expect(out).toContain('  overlap-when-pulled turns: 4')
    expect(out).toContain('  over-pull turns:           2')
    expect(out).toContain('  distinct scopes (M):       12 (below the pre-registered M >= 50)')
  })

  test('leaves the under-trigger rate unmarked -- the 5% branch is the operator call', async () => {
    const out = await runFunnel()

    expect(out).not.toContain('5%)')
    expect(out).not.toMatch(/under-trigger rate:.*pre-registered/)
  })

  test('prints the three gate footnotes verbatim', async () => {
    const out = await runFunnel()

    expect(out).toContain(
      'Note: shadow_hit is a rank cutoff (top-k position within the shadow cascade), not a relevance-score' +
        ' threshold -- see the doc comment on ShadowRecallHit.score in src/long-term-memory/shadow-recall.ts.',
    )
    expect(out).toContain(
      'Note: over-pull turns (shadow_pull_overlap = 0) is NOT a pre-registered or spec-numeric threshold',
    )
    expect(out).toContain(
      'Note: distinct scopes (M) IS part of the frozen go/no-go gate -- the gate requires N = 1000 sampled',
    )
  })

  test('--reader-model-id narrows to a single block', async () => {
    const out = await runFunnel(['--reader-model-id', 'model-b'])

    expect(out.match(/reader_model_id: /g)).toHaveLength(1)
    expect(out).toContain('reader_model_id: model-b')
    expect(out).not.toContain('model-a')
    expect(out).not.toContain('model-c')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/shadow-funnel-cli.test.ts`
Expected: FAIL. The grouping, value, and footnote tests pass (the aggregation is already correct — that is the point of a guard test), but the three marker assertions fail: output reads `memory-bearing turns:      110` with no marker appended.

If instead a value assertion fails, stop and fix the fixture arithmetic before touching the script — a wrong fixture invalidates every later assertion.

- [ ] **Step 4: Rewrite the script with markers**

Replace the body of `scripts/memory-shadow-funnel.ts` below the header comment. `printFunnel` is split into three functions — `max-lines-per-function` (limit 50) applies to `scripts/`, and the single function would otherwise be close to it:

```typescript
import { computeShadowFunnel } from '../src/long-term-memory/shadow-funnel.js'
import type { ShadowFunnelEntry } from '../src/long-term-memory/shadow-funnel.js'
import { formatScopesMarker, formatTurnsMarker } from '../src/long-term-memory/shadow-gate.js'

function parseReaderModelId(argv: readonly string[]): string | undefined {
  const flagIndex = argv.indexOf('--reader-model-id')
  if (flagIndex === -1) return undefined
  return argv[flagIndex + 1]
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`
}

function printEntry(entry: ShadowFunnelEntry): void {
  console.log(`reader_model_id: ${entry.readerModelId}`)
  console.log(`  memory-bearing turns:      ${entry.memoryBearingTurns} ${formatTurnsMarker(entry.memoryBearingTurns)}`)
  console.log(`  shadow_hit turns (rank>=1): ${entry.shadowHitTurns}`)
  console.log(`  under-trigger turns:       ${entry.underTriggerTurns}`)
  // Deliberately unmarked: the bucket-3 5% branch is the operator's call.
  console.log(`  under-trigger rate:        ${formatRate(entry.underTriggerRate)}`)
  console.log(`  overlap-when-pulled turns: ${entry.overlapWhenPulled}`)
  console.log(`  over-pull turns:           ${entry.overPullTurns}`)
  console.log(`  distinct scopes (M):       ${entry.distinctScopes} ${formatScopesMarker(entry.distinctScopes)}`)
  console.log('')
}

function printFootnotes(): void {
  console.log(
    'Note: shadow_hit is a rank cutoff (top-k position within the shadow cascade), not a relevance-score' +
      ' threshold -- see the doc comment on ShadowRecallHit.score in src/long-term-memory/shadow-recall.ts.',
  )
  console.log(
    'Note: over-pull turns (shadow_pull_overlap = 0) is NOT a pre-registered or spec-numeric threshold -- the' +
      ' design doc only describes this companion signal qualitatively ("low overlap"). It is this repo\'s own' +
      ' operationalization and sits outside the frozen go/no-go gate.',
  )
  console.log(
    'Note: distinct scopes (M) IS part of the frozen go/no-go gate -- the gate requires N = 1000 sampled' +
      ' memory-bearing turns across M >= 50 distinct scopes, per reader model, before trusting the' +
      ' under-trigger rate above. Both preconditions are marked inline above. The under-trigger rate itself' +
      ' is deliberately unmarked: the < 5% stop branch is the operator\'s call, read against the' +
      ' threats-to-validity ledger in the design doc. M counts only scopes that produced at least one' +
      ' memory-bearing turn.',
  )
}

function printFunnel(): void {
  const readerModelId = parseReaderModelId(process.argv.slice(2))
  const entries = computeShadowFunnel(readerModelId === undefined ? {} : { readerModelId })

  if (entries.length === 0) {
    console.log('No shadow-log rows found (shadow logging may be disabled, or no turns sampled yet).')
    return
  }

  console.log('Memory-recall shadow under-trigger funnel (per reader model -- never averaged across models)\n')

  for (const entry of entries) {
    printEntry(entry)
  }

  printFootnotes()
}

printFunnel()
```

Also update the file's top doc comment: after the "never a pooled cross-model average" sentence, add:

```
 * Each reader model's memory-bearing turn count and distinct-scope count (M) are printed
 * with their standing against the pre-registered gate preconditions (N = 1000, M >= 50,
 * `src/long-term-memory/shadow-gate.ts`). The under-trigger rate is deliberately left
 * unmarked -- the < 5% stop branch is a human judgment, not a computed verdict.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/long-term-memory/shadow-funnel-cli.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Read the report by hand**

Assertions confirm the values; they cannot confirm the wording reads sensibly to an operator. Dump the fixture database and look at the real output:

```bash
bun test tests/long-term-memory/shadow-funnel-cli.test.ts --reporter=verbose 2>&1 | head -20
bun run memory:shadow-funnel
```

The second command runs against the repo's local `papai.db`, which is migrated but holds no shadow rows — expect the "No shadow-log rows found" line, confirming the empty-state path still reads sensibly. Do **not** point `DB_PATH` at a fresh empty file for this: an unmigrated database has no `memory_recall_shadow_log` table and the query throws rather than printing the empty-state line. Then read the three per-model blocks from a fixture run and confirm: markers sit beside the values they judge, `model-c`'s `below` marker makes clear its 25% rate is not yet actionable, and the reworded M footnote no longer tells the operator to compare by eye.

- [ ] **Step 7: Run the whole memory suite plus lint and typecheck**

Run: `bun test tests/long-term-memory/ && bun run lint && bun run typecheck`
Expected: all pass. The pre-existing `shadow-funnel.test.ts` must still pass untouched — `shadow-funnel.ts` was not modified.

- [ ] **Step 8: Commit**

```bash
git add tests/long-term-memory/shadow-funnel-fixture.ts tests/long-term-memory/shadow-funnel-cli.test.ts scripts/memory-shadow-funnel.ts
git commit -m "feat(memory): render gate preconditions in the funnel report, guarded by a CLI dry-run"
```

---

### Task 4: Operator runbook

**Files:**

- Create: `docs/deployment/memory-shadow-logging.md`
- Modify: `docs/architecture/environment.md:22` (append a link to the runbook)

**Interfaces:**

- Consumes: the marker output shipped in Task 3.
- Produces: nothing code-facing.

- [ ] **Step 1: Write the runbook**

Create `docs/deployment/memory-shadow-logging.md`:

````markdown
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory-recall shadow logging — operator runbook

## What enabling means

`MEMORY_SHADOW_LOG_ENABLED` is not a feature toggle. Setting it starts **collecting data
against a study protocol that was pre-registered on 2026-07-25 and is frozen**
([design doc](../superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md)).

The study measures one thing: when a user's stored memory *would* have been relevant to a
turn, does the model actually go looking for it? On a sampled fraction of turns it runs a
shadow memory search alongside the real turn, records what that search would have found,
and records whether the model itself pulled memory. The gap between the two is the
**under-trigger rate**, and a pre-registered rule decides what happens next.

Enabling is a **per-deployment opt-in**. The deployment that turns it on is the one running
the study and reporting its result.

## What gets recorded

Hashes, counts, and enum buckets only — no query text, no memory content, no record bodies.
The schema is `memory_recall_shadow_log`
(`src/db/long-term-memory-schema.ts`); a schema test asserts the row carries nothing
free-form.

**Cost note.** The shadow search reuses an unindexed O(N) scan. Sampling and the
zero-active-record precondition bound it, but deployments with large memory scopes should
watch load after enabling.

## How to enable

```bash
MEMORY_SHADOW_LOG_ENABLED=true
```

**The value must be exactly `true`.** `1`, `TRUE`, `True`, and `yes` all leave the study
**disabled**, and nothing is logged to tell you so (`isShadowLoggingEnabled`,
`src/long-term-memory/shadow-log-config.ts`).

So the step after enabling is verifying rows actually arrive:

```bash
sqlite3 "$DB_PATH" 'select count(*) from memory_recall_shadow_log'
```

Expect a non-zero count after enough traffic to clear the sample rate. A count stuck at
zero means either the variable is not exactly `true`, or no sampled turn has had active
memory records yet.

## Sample rate

`MEMORY_SHADOW_LOG_SAMPLE_RATE` defaults to `0.1` — and `0.1` is also the **pre-registered
rate**. The shipped default and the frozen protocol are the same number by design, so the
correct action is to leave this variable unset.

Overriding it is a **departure from the pre-registered protocol**. A deployment that does so
must record the departure explicitly alongside any funnel result it reports.

Sampling is deterministic — derived from a keyed hash of `(storage-context-id, turn-ordinal)`,
not `Math.random` — so the same turn always makes the same in/out decision across restarts.

## Reading the funnel

```bash
bun run memory:shadow-funnel                          # all reader models
bun run memory:shadow-funnel --reader-model-id <id>   # one model
```

Output is **one block per reader model, never pooled**. Pull propensity is model-dependent,
so a cross-model average would look authoritative while hiding the exact variance the
decision depends on.

```
reader_model_id: model-x
  memory-bearing turns:      1024 (meets the pre-registered N = 1000)
  shadow_hit turns (rank>=1): 402
  under-trigger turns:       71
  under-trigger rate:        6.93%
  overlap-when-pulled turns: 240
  over-pull turns:           62
  distinct scopes (M):       58 (meets the pre-registered M >= 50)
```

- **memory-bearing turns** — sampled turns where the scope had at least one active record.
  The denominator, and the **N** of the gate. Marked against N = 1000.
- **shadow_hit turns** — turns where the shadow surfaced anything within the cascade's own
  top-8 window. A rank cutoff, not a relevance score.
- **under-trigger turns / rate** — the shadow had something and the model never looked.
  **This rate is the headline.** Deliberately left unmarked; see the stop conditions below.
- **overlap-when-pulled** — the model pulled and found some of what the shadow found. High
  overlap means the records are genuinely valuable.
- **over-pull turns** — the model pulled and found none of what the shadow found. A
  companion signal only; **not part of the gate**.
- **distinct scopes (M)** — distinct scopes among memory-bearing turns, so no single chatty
  user or group decides the outcome. Marked against M >= 50. Scopes that only ever produced
  zero-record turns are excluded.

## Stop conditions

> These restate the frozen protocol. **The design doc is authoritative** — if this section
> and the design doc ever disagree, the design doc is right and this page is what needs
> fixing. Do not edit the numbers here.

**Collect until**, per reader model: **N = 1000** sampled memory-bearing turns across
**M >= 50** distinct scopes. Both are rendered inline in the report. Until both read
`meets`, the under-trigger rate for that model is not yet trustworthy and no branch below
applies to it.

**Then, on the under-trigger rate:**

- **Below 5%** — the model's own pulling covers the ground. Shelve `deriveInjectionQuery`;
  **do not build P2 or Tier 3.** Tier 2 stands.
- **At or above 5%**, *and* the overlap signal shows those records are the ones the model
  values when it does look — a real gap of valuable records exists. Build the abstention
  harness (P2) to test whether auto-injecting them is *safe* before any Tier 3 ship.

**The gate is a screen, not a proof, and the call is yours to make.** The report renders the
two mechanical preconditions but never the 5% branch, because reading that branch requires
the recorded threats to validity: the raw-turn shadow query pushes the measured rate **down**,
while the loose hit criterion and the "profile already answered it" confound push it **up**.
The net bias is indeterminate. Read the threats-to-validity section of the design doc before
acting on either branch.

## When to turn it off

This is a study instrument, not permanent telemetry. Once the reader models you care about
have reached N and M and you have recorded their rates, unset
`MEMORY_SHADOW_LOG_ENABLED` and reclaim the sampling cost.
````

- [ ] **Step 2: Link the runbook from the environment doc**

In `docs/architecture/environment.md`, at the end of the shadow-logging paragraph (line 22), append:

```markdown
Operator procedure for enabling collection, reading the funnel, and the pre-registered stop conditions: [`docs/deployment/memory-shadow-logging.md`](../deployment/memory-shadow-logging.md).
```

- [ ] **Step 3: Verify the doc's claims against the code**

Run each command the runbook tells an operator to run and confirm it behaves as documented:

```bash
grep -n "MEMORY_SHADOW_LOG_ENABLED" src/long-term-memory/shadow-log-config.ts
bun run memory:shadow-funnel
```

Expected: the config file confirms the exact-`'true'` comparison; the funnel prints the
"No shadow-log rows found" line against the local database. Confirm the sample output block
in the runbook matches the real format from Task 3, including marker wording.

- [ ] **Step 4: Commit**

```bash
git add docs/deployment/memory-shadow-logging.md docs/architecture/environment.md
git commit -m "docs(memory): add the shadow-logging collection runbook"
```

---

## Self-review notes

Spec coverage: section 1 → Task 1 + Task 3 Step 4; section 2 → Task 2 + Task 3; section 3 →
Task 4; testing section → Task 1 Step 1, Task 3 Steps 2 and 6.

Deliberately deferred to implementation: nothing. The `overlapWhenPulled` / `overPullTurns`
counts the spec left open are pinned in the Task 3 fixture table.
