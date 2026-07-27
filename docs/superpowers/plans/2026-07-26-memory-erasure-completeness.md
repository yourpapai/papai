<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Memory Erasure Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a memory forget destroy every row in the scope carrying the forgotten content, enforce tombstone suppression at the record write boundary rather than at two call sites, and prove unreachability on five independent retrieval channels.

> **Execution status (2026-07-26): Historical — implemented.** The original unchecked step
> boxes are authoring history; the reconciliation table and drift log at the end are
> authoritative. Do not start new work from this plan; use
> `2026-07-26-memory-production-roadmap.md`.

**Architecture:** Two coupled behavior changes plus test completeness. `purgeMemoryRecord` gains a content-hash sweep inside its existing transaction, so a `provisional` twin of the purged fact dies with it. The `isContentTombstoned` checks move out of `capture.ts`/`runner.ts` and into `saveMemoryRecord` and `updateMemoryRecord`, which start returning `null` for suppressed writes. Together these close the re-materialization hole: a tombstoned provisional cannot exist to be promoted, because one created before the forget is swept and one created after is refused at insert.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM over `bun:sqlite`, `bun:test`, Zod v4, pino.

Spec: `docs/superpowers/specs/2026-07-26-memory-erasure-completeness-design.md`

## Global Constraints

- Runtime is **Bun**. Run tests with `bun test <path>`. Never `npm`, `jest`, or `vitest`.
- **Strict TypeScript**; every relative import path ends in `.js`.
- **Never** add a lint-disable or type-ignore comment — a hook blocks the commit. Fix the underlying issue.
- Every source file starts with the four-line BUSL SPDX header (copy it from any neighbouring file); a `license-headers` check runs on commit.
- Logging is mandatory and **metadata-only**: scope ids, record ids, counts, booleans. **Never log memory content, and never log a content hash.**
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- A `max-lines` / `max-lines-per-function` lint failure is a design signal — extract a function, do not compress formatting.
- TDD is enforced by a Write/Edit hook: the failing test must exist and be seen failing before the implementation.
- Commit after each task. Pre-commit runs lint, typecheck, format, and license-header checks on staged files.

## File Structure

| File | Role in this plan |
| --- | --- |
| `src/long-term-memory/purge.ts` | Modify — add the content-hash sweep; report `recordsDeleted`. |
| `src/long-term-memory/store.ts` | Modify — tombstone gate in `saveMemoryRecord` and `updateMemoryRecord`; return type widens to `MemoryRecord \| null`. |
| `src/long-term-memory/embedding-writer.ts` | Modify — propagate the `null`, skip the embedding round-trip. |
| `src/long-term-memory/capture.ts` | Modify — drop the local tombstone filter, derive `suppressed` from returned nulls. |
| `src/long-term-memory/runner.ts` | Modify — drop both local tombstone checks, count nulls as suppressed. |
| `src/tools/memory.ts` | Modify — narrow the now-nullable explicit save. |
| `src/long-term-memory/scope-clear.ts` | Modify — comment stating the `memory_facts` boundary. |
| `tests/long-term-memory/purge.test.ts` | Modify — provisional twin sweep, `memory_facts` left intact. |
| `tests/long-term-memory/store.test.ts` | Modify — write-boundary gate tests. |
| `tests/long-term-memory/embedding-writer.test.ts` | Modify — null narrowing plus a suppression test. |
| `tests/long-term-memory/durable-erasure.golden.test.ts` | Modify — semantic channel, raw FTS probe. |
| `tests/long-term-memory/scope-clear.test.ts` | Modify — `memory_facts` deletion. |

Tasks 1 and 2 are independent of each other. Task 3 depends on Task 2 (the widened return type). Tasks 4 and 5 depend on Tasks 1–3 being green.

---

### Task 1: Content-hash sweep in `purgeMemoryRecord`

A purge currently deletes exactly one id. A `provisional` record carrying the same content survives, and `promotion.ts:114` promotes it back to `active` without consulting the tombstone. This task makes the purge delete every row in the scope whose normalized content hashes the same.

**Files:**

- Modify: `src/long-term-memory/purge.ts:58-106`
- Test: `tests/long-term-memory/purge.test.ts`

**Interfaces:**

- Consumes: `contentHash(content: string): string` and `tombstoneValues(scope, content, now)` from `src/long-term-memory/tombstone.ts` (both already exist and are exported). `contentHash` folds case and collapses whitespace via `normalizeForHash` before hashing.
- Produces: `purgeMemoryRecord(scope: MemoryScope, recordId: string, now: string): boolean` — signature and return type **unchanged**. Behaviour widens to delete duplicates.

- [ ] **Step 1: Write the failing test**

Append this test to the existing `describe('purgeMemoryRecord — derived-memory contamination', …)` block in `tests/long-term-memory/purge.test.ts`. Add `memoryRecords` to the existing `../../src/db/schema.js` import and `listProvisionalRecords` to the existing `../../src/long-term-memory/store.js` import.

```typescript
  test('sweeps a provisional twin of the purged content, case and spacing insensitive', () => {
    const scope: MemoryScope = { scopeId: 'dm-sweep', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-active', 'User lives in Berlin'))
    saveMemoryRecord({
      ...record(scope, 'mem-provisional', 'user   LIVES in berlin'),
      status: 'provisional',
      source: 'background',
    })

    expect(purgeMemoryRecord(scope, 'mem-active', NOW)).toBe(true)

    // both rows are gone from the canonical table, not merely hidden
    expect(getDrizzleDb().select().from(memoryRecords).all()).toHaveLength(0)
    // ...so the promotion sweep has nothing left to promote back to active
    expect(listProvisionalRecords({ ...scope, limit: 10 })).toHaveLength(0)
  })

  test('leaves records in other scopes alone even when the content matches', () => {
    const mine: MemoryScope = { scopeId: 'dm-mine', scopeType: 'personal' }
    const theirs: MemoryScope = { scopeId: 'grp-theirs', scopeType: 'group' }
    saveMemoryRecord(record(mine, 'mem-mine', 'User lives in Berlin'))
    saveMemoryRecord(record(theirs, 'mem-theirs', 'User lives in Berlin'))

    expect(purgeMemoryRecord(mine, 'mem-mine', NOW)).toBe(true)

    const surviving = getDrizzleDb().select().from(memoryRecords).all()
    expect(surviving.map((row) => row.id)).toEqual(['mem-theirs'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/long-term-memory/purge.test.ts`

Expected: the sweep test FAILS — `expect(received).toHaveLength(0)` receives length `1`, because the provisional twin survives. The cross-scope test PASSES already (it is a regression guard for the sweep you are about to add, and must stay green throughout).

- [ ] **Step 3: Implement the sweep**

In `src/long-term-memory/purge.ts`, add `inArray` to the `drizzle-orm` import and `contentHash` to the `./tombstone.js` import:

```typescript
import { inArray } from 'drizzle-orm'
```

```typescript
import { contentHash, tombstoneValues } from './tombstone.js'
```

Add this pure helper at module level, directly above `purgeMemoryRecord`:

```typescript
/** Ids whose content hashes to `hash`. Pure so the sweep's matching rule stays testable apart from the transaction. */
const idsMatchingHash = (rows: readonly { id: string; content: string }[], hash: string): string[] =>
  rows.filter((row) => contentHash(row.content) === hash).map((row) => row.id)
```

Widen `PurgeOutcome` and `NOT_PURGED` to carry the count:

```typescript
type PurgeOutcome = Readonly<{
  purged: boolean
  recordsDeleted: number
  contaminatedProfile: boolean
  clearedSummaryKeys: readonly string[]
}>

const NOT_PURGED: PurgeOutcome = {
  purged: false,
  recordsDeleted: 0,
  contaminatedProfile: false,
  clearedSummaryKeys: [],
}
```

Replace the delete-by-id block at the top of the transaction (currently `const deleted = tx.delete(memoryRecords)…` through `if (row === undefined) return NOT_PURGED`) with a read, a sweep, and a bulk delete:

```typescript
    const target = tx
      .select({ content: memoryRecords.content })
      .from(memoryRecords)
      .where(recordScopeCondition(scope, recordId))
      .get()
    if (target === undefined) return NOT_PURGED

    // Every row in the scope, all statuses and no validity filter: a purge must reach the
    // provisional and expired rows the read paths hide, or a twin survives to be promoted back.
    const scopeRows = tx
      .select({ id: memoryRecords.id, content: memoryRecords.content })
      .from(memoryRecords)
      .where(and(eq(memoryRecords.scopeId, scope.scopeId), eq(memoryRecords.scopeType, scope.scopeType)))
      .all()

    const doomed = idsMatchingHash(scopeRows, contentHash(target.content))
    const recordsDeleted = tx
      .delete(memoryRecords)
      .where(inArray(memoryRecords.id, doomed))
      .returning({ id: memoryRecords.id })
      .all().length
```

`and` and `eq` are already imported by `record-conditions.ts` but **not** by `purge.ts` — add them to its `drizzle-orm` import alongside `inArray`.

Then update the tombstone insert to use `target.content` instead of `row.content`, and the returned outcome:

```typescript
    tx.insert(memoryTombstones)
      .values(tombstoneValues(scope, target.content, now))
      .onConflictDoNothing()
      .run()
```

```typescript
    return { purged: true, recordsDeleted, contaminatedProfile: contaminated.length > 0, clearedSummaryKeys }
```

Finally add the count to the log call, between `recordId` and `contaminatedProfile`:

```typescript
      recordsDeleted: outcome.recordsDeleted,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/long-term-memory/purge.test.ts`

Expected: PASS, all tests in the file including the pre-existing contamination and summary ones.

- [ ] **Step 5: Run the neighbouring suites for regressions**

Run: `bun test tests/long-term-memory/ tests/tools/memory.test.ts`

Expected: PASS. The dedup path (`deleteMemoryRecord`) is untouched, so `promotion.test.ts` should be unaffected — if it fails, you changed the wrong function.

- [ ] **Step 6: Commit**

```bash
git add src/long-term-memory/purge.ts tests/long-term-memory/purge.test.ts
git commit -m "feat(memory): purge sweeps every row carrying the forgotten content"
```

---

### Task 2: Tombstone gate at the record write boundary

`isContentTombstoned` is checked in `capture.ts:129` and `runner.ts:122,150`. `saveMemoryRecord` is ungated, so any importer, replay, or future writer bypasses the tombstone silently. This task moves the check into the store. Call-site cleanup is Task 3.

**Files:**

- Modify: `src/long-term-memory/store.ts:163-175` (`saveMemoryRecord`), `src/long-term-memory/store.ts:232-251` (`updateMemoryRecord`)
- Modify: `src/tools/memory.ts:98-118`
- Test: `tests/long-term-memory/store.test.ts`

**Interfaces:**

- Consumes: `isContentTombstoned(scope: MemoryScope, content: string): boolean` from `src/long-term-memory/tombstone.ts`.
- Produces:
  - `saveMemoryRecord(input: MemoryRecordInput): MemoryRecord | null` — `null` when `input.source !== 'explicit'` and the content is tombstoned in `{ scopeId: input.scopeId, scopeType: input.scopeType }`.
  - `updateMemoryRecord(scope, recordId, patch, now): MemoryRecord | null` — signature unchanged; `null` now also means "suppressed" in addition to "no such record".

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `tests/long-term-memory/store.test.ts`. That file already imports `saveMemoryRecord`, `listMemoryRecords`, and `purgeMemoryRecord` from `../../src/long-term-memory/store.js`, and defines a local `memoryRecordInput(overrides: Partial<MemoryRecordInput>)` helper (line 37) whose defaults are `scopeType: 'personal'`, `status: 'active'`, `source: 'explicit'`. The only import to add is `updateMemoryRecord`, into that same list.

```typescript
describe('tombstone gate at the write boundary', () => {
  const scope = { scopeId: 'dm-gate', scopeType: 'personal' as const }
  const CONTENT = 'User lives in Berlin'
  const NOW = '2026-07-26T00:00:00.000Z'

  beforeEach(async () => {
    await setupTestDb()
    saveMemoryRecord(memoryRecordInput({ id: 'seed', scopeId: scope.scopeId, content: CONTENT }))
    purgeMemoryRecord(scope, 'seed', NOW)
  })

  test('refuses a background save of tombstoned content', () => {
    const saved = saveMemoryRecord(
      memoryRecordInput({ id: 'bg-1', scopeId: scope.scopeId, content: CONTENT, source: 'background' }),
    )
    expect(saved).toBeNull()
    expect(listMemoryRecords({ ...scope, status: 'active' }).map((r) => r.id)).not.toContain('bg-1')
  })

  test('refuses a background save that differs only in case and spacing', () => {
    const saved = saveMemoryRecord(
      memoryRecordInput({ id: 'bg-2', scopeId: scope.scopeId, content: 'user   LIVES in berlin', source: 'background' }),
    )
    expect(saved).toBeNull()
  })

  test('allows an explicit save of tombstoned content as an intentional override', () => {
    const saved = saveMemoryRecord(
      memoryRecordInput({ id: 'ex-1', scopeId: scope.scopeId, content: CONTENT, source: 'explicit' }),
    )
    expect(saved?.id).toBe('ex-1')
  })

  test('does not gate a background save in a different scope', () => {
    const saved = saveMemoryRecord(
      memoryRecordInput({ id: 'other-1', scopeId: 'dm-other', content: CONTENT, source: 'background' }),
    )
    expect(saved?.id).toBe('other-1')
  })

  test('refuses an update that rewrites content to a tombstoned value', () => {
    saveMemoryRecord(
      memoryRecordInput({ id: 'upd-1', scopeId: scope.scopeId, content: 'User likes tea', source: 'background' }),
    )

    expect(updateMemoryRecord(scope, 'upd-1', { content: CONTENT }, NOW)).toBeNull()

    const [row] = listMemoryRecords({ ...scope, status: 'active' }).filter((r) => r.id === 'upd-1')
    expect(row?.content).toBe('User likes tea')
  })

  test('still applies an update that does not touch content', () => {
    saveMemoryRecord(
      memoryRecordInput({ id: 'upd-2', scopeId: scope.scopeId, content: 'User likes tea', source: 'background' }),
    )

    expect(updateMemoryRecord(scope, 'upd-2', { confidence: 0.5 }, NOW)?.confidence).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/long-term-memory/store.test.ts`

Expected: the four suppression tests FAIL (`expect(received).toBeNull()` receives a record object; the update test finds `content` rewritten). The two override/other-scope tests PASS already.

- [ ] **Step 3: Gate `saveMemoryRecord` and `updateMemoryRecord`**

In `src/long-term-memory/store.ts`, add two imports:

```typescript
import { logger } from '../logger.js'
```

```typescript
import { isContentTombstoned } from './tombstone.js'
```

and a module-level logger below the imports, following the repo's convention:

```typescript
const log = logger.child({ scope: 'long-term-memory:store' })
```

Replace `saveMemoryRecord` (line 163) with:

```typescript
/**
 * Writes a record unless its content has been forgotten in this scope.
 *
 * The tombstone check lives here rather than at the capture and extraction call sites so
 * that a write path added later inherits the suppression instead of having to remember it.
 * Explicit saves are never gated: `remember_memory` is a deliberate user override that
 * clears the matching tombstone immediately after.
 *
 * Returns null when the write was suppressed.
 */
export function saveMemoryRecord(input: MemoryRecordInput): MemoryRecord | null {
  const scope: MemoryScope = { scopeId: input.scopeId, scopeType: input.scopeType }
  if (input.source !== 'explicit' && isContentTombstoned(scope, input.content)) {
    log.info(
      { scopeId: input.scopeId, scopeType: input.scopeType, source: input.source },
      'Memory write suppressed by tombstone',
    )
    return null
  }

  const values = inputToRecordValues(input)

  getDrizzleDb()
    .insert(memoryRecords)
    .values(values)
    .onConflictDoUpdate({
      target: memoryRecords.id,
      set: values,
    })
    .run()
  return loadRecord(input.id)
}
```

In `updateMemoryRecord` (line 232), insert the guard as the first statement of the body, above `const rows = …`:

```typescript
  if (patch.content !== undefined && isContentTombstoned(scope, patch.content)) {
    log.info({ scopeId: scope.scopeId, scopeType: scope.scopeType, recordId }, 'Memory update suppressed by tombstone')
    return null
  }
```

- [ ] **Step 4: Narrow the explicit save in the memory tool**

`src/tools/memory.ts:98` dereferences `record.id`, which no longer type-checks. The `source` there is the literal `'explicit'`, so the gate cannot fire — but the compiler cannot see that, and a type-ignore comment is forbidden. Add an explicit invariant guard immediately after the `saveMemoryRecord({…})` call and before `deleteMatchingTombstone(scope, content)`:

```typescript
      // Unreachable: the gate in saveMemoryRecord never suppresses an explicit save.
      if (record === null) throw new Error('Explicit memory save was unexpectedly suppressed by a tombstone')
```

Leave the existing save-then-`deleteMatchingTombstone` order as it is. It is correct precisely because explicit saves bypass the gate.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/long-term-memory/store.test.ts tests/tools/memory.test.ts`

Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`

Expected: errors **only** in `src/long-term-memory/embedding-writer.ts`, `src/long-term-memory/capture.ts`, `src/long-term-memory/runner.ts`, and `tests/long-term-memory/embedding-writer.test.ts` — those are Task 3's job. If anything else fails to compile, you have found a `saveMemoryRecord` caller this plan missed; fix it by narrowing the null, and note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/long-term-memory/store.ts src/tools/memory.ts tests/long-term-memory/store.test.ts
git commit -m "feat(memory): enforce the tombstone gate at the record write boundary"
```

The tree does not typecheck between this commit and Task 3's. If your workflow forbids that, do Tasks 2 and 3 back to back and commit once.

---

### Task 3: Propagate suppression through the writers and drop the call-site filters

**Files:**

- Modify: `src/long-term-memory/embedding-writer.ts:55-77`
- Modify: `src/long-term-memory/capture.ts:22,128-141`
- Modify: `src/long-term-memory/runner.ts:25,118-157`
- Test: `tests/long-term-memory/embedding-writer.test.ts`

**Interfaces:**

- Consumes: `saveMemoryRecord(input): MemoryRecord | null` and `updateMemoryRecord(…): MemoryRecord | null` from Task 2.
- Produces: `saveMemoryRecordWithEmbedding(input, configContextId, overrides?): Promise<MemoryRecord | null>` — `null` when the underlying save was suppressed, with **no** embedding provider call.

- [ ] **Step 1: Write the failing test**

Add to `tests/long-term-memory/embedding-writer.test.ts`, inside the existing `describe('saveMemoryRecordWithEmbedding', …)`. Add these imports to the file:

```typescript
import { mock } from 'bun:test'

import { purgeMemoryRecord } from '../../src/long-term-memory/purge.js'
import { saveMemoryRecord } from '../../src/long-term-memory/store.js'
```

```typescript
  test('returns null and skips the embedding call when the content is tombstoned', async () => {
    const scope = { scopeId: 'group-1', scopeType: 'group' as const }
    saveMemoryRecord({ ...input(), id: 'seed', source: 'explicit' })
    purgeMemoryRecord(scope, 'seed', '2026-07-26T00:00:00.000Z')

    const getEmbedding = mock(() => Promise.resolve([0.1, 0.2, 0.3]))
    const saved = await saveMemoryRecordWithEmbedding({ ...input(), id: 'bg-1', source: 'background' }, 'cfg-1', {
      getEmbedding,
      resolveEmbeddingModel: () => 'model-a',
    })

    expect(saved).toBeNull()
    expect(getEmbedding).toHaveBeenCalledTimes(0)
  })
```

The file's `input()` helper (line 18) builds a record in `scopeId: 'group-1', scopeType: 'group'` with `source: 'background'` — hence the `scope` literal above, and the `source: 'explicit'` override on the seed so the seed itself can never be gated.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/long-term-memory/embedding-writer.test.ts`

Expected: FAIL — `expect(received).toBeNull()` receives a record, and the embedding spy was called once.

- [ ] **Step 3: Propagate the null in the embedding writer**

In `src/long-term-memory/embedding-writer.ts`, widen the return type and short-circuit:

```typescript
export async function saveMemoryRecordWithEmbedding(
  input: MemoryRecordInput,
  configContextId: string,
  overrides: Partial<EmbeddingWriterDeps> = {},
): Promise<MemoryRecord | null> {
  const deps: EmbeddingWriterDeps = { ...defaultDeps, ...overrides }
  const saved = saveMemoryRecord(input)
  if (saved === null) return null
```

The rest of the body is unchanged.

- [ ] **Step 4: Narrow the null in the pre-existing embedding-writer tests**

Two tests dereference `saved.id` (lines 46 and 60 of the current file). The file already imports an `assert` helper — add a narrowing line above each `expect(saved.id)`:

```typescript
    assert(saved !== null, 'expected the record to be saved')
```

- [ ] **Step 5: Drop the filter in `capture.ts`**

Remove the `isContentTombstoned` import (line 22). Replace the block from `const candidates = …` through the `await Promise.all(…)` call with:

```typescript
  const now = deps.now()
  const records = patch.records.map((candidate) =>
    buildRecord({ candidate, scope, storageContextId: input.storageContextId, now, id: deps.randomUUID() }),
  )
  const saved = await Promise.all(
    records.map((record) =>
      saveMemoryRecordWithEmbedding(record, input.configContextId, { getEmbedding: deps.getEmbedding }),
    ),
  )
  const captured = saved.filter((record) => record !== null).length
  const suppressed = saved.length - captured
```

and update the existing log call (line 141) to report the new counter:

```typescript
  log.debug({ contextId: input.storageContextId, captured, suppressed }, 'Memory capture complete')
```

- [ ] **Step 6: Drop both checks in `runner.ts`**

Remove the `isContentTombstoned` import (line 25). In `insertRecords`, delete the `if (isContentTombstoned(...)) return …` line and branch on the returned value instead:

```typescript
      const saved = saveMemoryRecord({
        id: deps.randomUUID(),
        ...scope,
        kind: record.kind,
        content: record.content,
        summary: record.summary,
        tags: record.tags,
        confidence: record.confidence,
        status: 'active',
        source: 'background',
        evidence: record.evidence,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        validFrom: canonicalIsoOrNull(record.validFrom),
        validUntil: canonicalIsoOrNull(record.validUntil),
        expiresAt: canonicalIsoOrNull(record.expiresAt),
      })
      return saved === null ? { ...acc, suppressed: acc.suppressed + 1 } : { ...acc, count: acc.count + 1 }
```

In `applyUpdates`, delete the `if (update.content !== undefined && isContentTombstoned(...)) …` block and branch on the return:

```typescript
      const updated = updateMemoryRecord(scope, update.id, update, now)
      return updated === null ? { ...acc, suppressed: acc.suppressed + 1 } : { ...acc, count: acc.count + 1 }
```

**Behaviour note to carry into the commit message:** `updateMemoryRecord` returns `null` both when the update was suppressed and when the target row does not exist, so the `suppressed` figure in the "Long-term memory extraction complete" log now also counts updates whose target vanished. Both mean "the update did not apply"; the counter is diagnostic only and nothing branches on it.

- [ ] **Step 7: Run the tests**

Run: `bun test tests/long-term-memory/ tests/tools/memory.test.ts tests/conversation.test.ts`

Expected: PASS. `capture.test.ts` and `runner.test.ts` have existing suppression assertions — they should stay green, because the observable behaviour (record not written, `suppressed` counted) is unchanged; only the layer enforcing it moved.

- [ ] **Step 8: Typecheck and lint**

Run: `bun run typecheck && bun run lint`

Expected: clean. A `no-unused-vars` error means a leftover `isContentTombstoned` import.

- [ ] **Step 9: Commit**

```bash
git add src/long-term-memory/embedding-writer.ts src/long-term-memory/capture.ts src/long-term-memory/runner.ts tests/long-term-memory/embedding-writer.test.ts
git commit -m "refactor(memory): drop call-site tombstone filters in favour of the store gate"
```

---

### Task 4: Golden-set channel completeness

The golden set asserts the lexical channel alone and the *fused* recall cascade. A purged row surviving in the dense scan would still be hidden, because lexical's absence carries the fused result. This task adds the dense channel in isolation and a raw FTS probe.

**Files:**

- Modify: `tests/long-term-memory/durable-erasure.golden.test.ts`

**Interfaces:**

- Consumes: `rankRecordsBySimilarity(scope, queryEmbedding, options): readonly MemoryRecord[]` from `src/long-term-memory/semantic-search.ts`. Its `denseConditions` filters on status, validity **and** `embeddingVersion`, so the test must disarm all three or absence proves nothing.

- [ ] **Step 1: Write the failing assertions**

In `tests/long-term-memory/durable-erasure.golden.test.ts`, add these imports:

```typescript
import { sql } from 'drizzle-orm'

import { rankRecordsBySimilarity } from '../../src/long-term-memory/semantic-search.js'
```

Add two helpers below the existing `recallIds` helper:

```typescript
/**
 * The dense channel in isolation. Every filter that could mask a surviving row is disarmed —
 * all statuses, the record's own embedding identity, a zero threshold — so a miss can only
 * mean the row is physically gone, not merely invalid or de-ranked.
 */
const semanticIds = (): readonly string[] =>
  rankRecordsBySimilarity(scope, VEC, {
    statuses: ALL_STATUSES,
    embeddingVersion: VERSION,
    threshold: 0,
    limit: 8,
  }).map((r) => r.id)

/** Probes the FTS5 external-content index directly: its rows survive a canonical delete if a trigger is missing. */
const ftsMatchCount = (term: string): number => {
  const rows = getDrizzleDb().all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM memory_records_fts WHERE memory_records_fts MATCH ${term}`,
  )
  return rows[0]?.n ?? 0
}
```

In the first test (`purged record is unreachable by every channel`), add a sanity assertion beside the existing pre-purge ones:

```typescript
      // sanity: reachable before forget (dense channel alone)
      expect(semanticIds()).toContain(lang.id)
      // sanity: the FTS index holds the row before the forget
      expect(ftsMatchCount(lang.term)).toBe(1)
```

and add the two post-purge assertions after the existing lexical-channel one:

```typescript
      // semantic channel — all filters disarmed, so absence means the row is gone
      expect(semanticIds()).not.toContain(lang.id)
      // raw FTS5 index probe
      expect(ftsMatchCount(lang.term)).toBe(0)
```

- [ ] **Step 2: Run the test to verify the new assertions are meaningful**

Run: `bun test tests/long-term-memory/durable-erasure.golden.test.ts`

Expected: PASS. Unlike the other tasks these assertions document behaviour that already holds — the value is the coverage, so **prove they can fail** before trusting them.

- [ ] **Step 3: Prove the new assertions can fail**

Temporarily edit `src/long-term-memory/purge.ts` and change the sweep's delete to an archive-style no-op by replacing `inArray(memoryRecords.id, doomed)` with `inArray(memoryRecords.id, [])`.

Run: `bun test tests/long-term-memory/durable-erasure.golden.test.ts`

Expected: FAIL on both the semantic assertion and the FTS probe, in both EN and RU. If either still passes, the helper is filtering the row out for the wrong reason — fix the helper, not the assertion.

Revert the edit:

```bash
git checkout src/long-term-memory/purge.ts
```

- [ ] **Step 4: Re-run to confirm green**

Run: `bun test tests/long-term-memory/durable-erasure.golden.test.ts`

Expected: PASS, both languages.

- [ ] **Step 5: Commit**

```bash
git add tests/long-term-memory/durable-erasure.golden.test.ts
git commit -m "test(memory): assert the dense channel and FTS index independently after purge"
```

---

### Task 5: State and pin the `memory_facts` boundary

`memory_facts` reads like a derived projection of memory records. It is the web-fetch title/URL cache keyed by storage user id (`src/db/schema.ts:67`). `clearMemoryScope` wipes it; `purgeMemoryRecord` correctly does not. Nothing says so, so the next reader adds either a wrong assertion or a wrong delete.

**Files:**

- Modify: `src/long-term-memory/scope-clear.ts:79-84`
- Test: `tests/long-term-memory/scope-clear.test.ts`, `tests/long-term-memory/purge.test.ts`

**Interfaces:** none — documentation and coverage only.

- [ ] **Step 1: Write the failing tests**

In `tests/long-term-memory/purge.test.ts`, add `memoryFacts` to the `../../src/db/schema.js` import and append this test to the existing describe block:

```typescript
  test('leaves the web-fetch fact cache alone — it is not derived from memory records', () => {
    const scope: MemoryScope = { scopeId: 'dm-facts', scopeType: 'personal' }
    saveMemoryRecord(record(scope, 'mem-1', 'User lives in Berlin'))
    getDrizzleDb()
      .insert(memoryFacts)
      .values({
        userId: scope.scopeId,
        identifier: 'https://example.com/a',
        title: 'A page the user fetched',
        url: 'https://example.com/a',
        lastSeen: '2026-07-01T00:00:00.000Z',
      })
      .run()

    expect(purgeMemoryRecord(scope, 'mem-1', NOW)).toBe(true)

    expect(getDrizzleDb().select().from(memoryFacts).all()).toHaveLength(1)
  })
```

In `tests/long-term-memory/scope-clear.test.ts`, add `memoryFacts` to its `../../src/db/schema.js` import (it currently imports `conversationHistory` and `memoryTombstones`) and append this test to the existing `describe('scope-clear', …)` block. `clearMemoryScope` and `getDrizzleDb` are already imported there:

```typescript
  test('deletes the web-fetch fact cache for the scope and its thread keys', () => {
    const scope = { scopeId: 'grp-1', scopeType: 'group' as const }
    for (const userId of ['grp-1', 'grp-1:thread:t1', 'grp-other']) {
      getDrizzleDb()
        .insert(memoryFacts)
        .values({
          userId,
          identifier: 'https://example.com/a',
          title: 'A page',
          url: 'https://example.com/a',
          lastSeen: '2026-07-01T00:00:00.000Z',
        })
        .run()
    }

    clearMemoryScope(scope)

    expect(getDrizzleDb().select().from(memoryFacts).all().map((row) => row.userId)).toEqual(['grp-other'])
  })
```

- [ ] **Step 2: Run the tests**

Run: `bun test tests/long-term-memory/purge.test.ts tests/long-term-memory/scope-clear.test.ts`

Expected: PASS. Both pin behaviour that already holds; the purge test is the one that would have caught a well-meaning "purge should clear facts too" change.

- [ ] **Step 3: State the boundary in code**

In `src/long-term-memory/scope-clear.ts`, add a comment directly above the `memoryFacts` delete inside `deleteWorkingMemory`:

```typescript
  // `memory_facts` is the web-fetch title/URL cache keyed by storage user id, not a projection of
  // memory records. A scope clear removes it because it is keyed to the scope; a single-record purge
  // deliberately does not, because no row here derives from the purged record.
```

- [ ] **Step 4: Run the full memory suite**

Run: `bun test tests/long-term-memory/ tests/tools/memory.test.ts tests/conversation.test.ts tests/db/`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/long-term-memory/scope-clear.ts tests/long-term-memory/purge.test.ts tests/long-term-memory/scope-clear.test.ts
git commit -m "test(memory): pin the memory_facts erasure boundary"
```

---

## Final verification

- [ ] **Run the full check pipeline**

Run: `bun run check`

Expected: lint, typecheck, format, and the full test suite pass.

- [ ] **Confirm the five channels are covered**

Open `tests/long-term-memory/durable-erasure.golden.test.ts` and confirm the post-purge block asserts, for both EN and RU: lexical (`searchLexical`), semantic (`semanticIds`), `listMemoryRecords` across every status, profile prose (`visibleProfileText` → `null`, in the second test), and the rolling summary (`memory_summary` empty, in the second test) — plus the two raw probes, the canonical row and `ftsMatchCount`.

## Execution Reconciliation — 2026-07-26

| Tasks | Status | Code evidence |
| --- | --- | --- |
| 1–5 | Complete in code | Content-hash sweep, write-boundary tombstone gate, writer propagation, five-channel golden assertions, and the explicit `memory_facts` boundary; commits `a9f11d9` through `db306d2`. |

## Drift Log

| Date | Category | Item | Decision |
| --- | --- | --- |
| 2026-07-26 | In-plan, stale task state | Tasks 1–5 had landed commits but every step box remained unchecked. | Recorded completion above; retained original boxes as authoring history. |
| 2026-07-26 | In-plan, boundary clarification | “Every channel” could be misread to include the legacy `memory_facts` task-result cache. | Task 5 and its test make the deliberate single-record-purge boundary explicit; user-facing copy must not overclaim. |
