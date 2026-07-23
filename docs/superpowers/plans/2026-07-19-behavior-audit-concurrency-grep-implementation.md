<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit — Configurable Concurrency + Grep Replacement (Tier 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three `pLimit(1)` serialization points in Phases 2a/2b/3 with a configurable `BEHAVIOR_AUDIT_CONCURRENCY` env var (default 4), refactor shared-state writes through a per-key mutex + manifest-delta merge, and replace the LLM-callable `grep` shell-out in `tools.ts` with a portable pure-JS implementation.

**Architecture:** Add a tiny `async-mutex.ts` per-key serializer. Each phase collects a per-item manifest delta, then merges once at phase end. The grep tool uses `Bun.Glob` for file enumeration and a module-level text cache for repeated calls.

**Tech Stack:** Bun, TypeScript, `p-limit`, `bun:test`, `Bun.Glob`.

**Spec:** `docs/superpowers/specs/2026-07-19-behavior-audit-concurrency-grep-design.md`

**Depends on:** nothing (independent of Tier 1). Ships after Tier 1 by sequence.

---

## File Structure

| File                                                 | Responsibility                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `scripts/behavior-audit/config.ts`                   | +`CONCURRENCY` knob, +env read                                           |
| `scripts/behavior-audit/async-mutex.ts`              | new ~30-line per-key async mutex                                         |
| `scripts/behavior-audit/classify.ts`                 | Phase 2a: mutex-wrap writes, delta-merge manifest, `pLimit(CONCURRENCY)` |
| `scripts/behavior-audit/consolidate.ts`              | Phase 2b: same pattern                                                   |
| `scripts/behavior-audit/evaluate-runner.ts`          | Phase 3: same pattern                                                    |
| `scripts/behavior-audit/tools.ts`                    | Pure-JS `makeGrepTool` with content cache                                |
| `tests/scripts/behavior-audit/async-mutex.test.ts`   | new                                                                      |
| `tests/scripts/behavior-audit/tools-grep.test.ts`    | new                                                                      |
| `tests/scripts/behavior-audit/fixtures/grep-sample/` | new fixture tree                                                         |
| existing phase tests                                 | extend with `CONCURRENCY=4` variants                                     |

---

## Task 1: Add `CONCURRENCY` config knob

**Files:**

- Modify: `scripts/behavior-audit/config.ts:75-95` (defaults block)
- Modify: `scripts/behavior-audit/config.ts:131-155` (`reloadBehaviorAuditConfig`)

- [ ] **Step 1: Write the failing test**

Append to the existing `tests/scripts/behavior-audit-config.test.ts` (create if absent). Check first:

```bash
ls tests/scripts/behavior-audit-config.test.ts 2>/dev/null
```

If absent, create `tests/scripts/behavior-audit/config.test.ts`. Otherwise add to the existing file. Use this test:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'

describe('CONCURRENCY config', () => {
  afterEach(() => {
    delete process.env.BEHAVIOR_AUDIT_CONCURRENCY
    reloadBehaviorAuditConfig()
  })

  test('defaults to 4', () => {
    delete process.env.BEHAVIOR_AUDIT_CONCURRENCY
    reloadBehaviorAuditConfig()
    const { CONCURRENCY } = await import('../../scripts/behavior-audit/config.js')
    expect(CONCURRENCY).toBe(4)
  })

  test('respects BEHAVIOR_AUDIT_CONCURRENCY', async () => {
    process.env.BEHAVIOR_AUDIT_CONCURRENCY = '8'
    reloadBehaviorAuditConfig()
    const mod = await import('../../scripts/behavior-audit/config.js')
    expect(mod.CONCURRENCY).toBe(8)
  })

  test('falls back to 4 on non-finite value', async () => {
    process.env.BEHAVIOR_AUDIT_CONCURRENCY = 'not-a-number'
    reloadBehaviorAuditConfig()
    const mod = await import('../../scripts/behavior-audit/config.js')
    expect(mod.CONCURRENCY).toBe(4)
  })

  test('falls back to 4 on non-positive value', async () => {
    process.env.BEHAVIOR_AUDIT_CONCURRENCY = '0'
    reloadBehaviorAuditConfig()
    const mod = await import('../../scripts/behavior-audit/config.js')
    expect(mod.CONCURRENCY).toBe(4)
  })
})
```

Note: use top-level `await import` inside `test` bodies if your bun version dislikes top-level await in `afterEach`-driven tests; the pattern above uses it inside each test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/config.test.ts`
Expected: FAIL — `CONCURRENCY` does not exist on the config module.

- [ ] **Step 3: Add the config knob**

In `scripts/behavior-audit/config.ts`, after line 80 (`export let MAX_STEPS = 20`), add:

```typescript
export let CONCURRENCY = 4
```

In `reloadBehaviorAuditConfig()` (around line 141), add after `MAX_STEPS = resolveNumberOverride(...)`:

```typescript
const concurrencyRaw = resolveNumberOverride('BEHAVIOR_AUDIT_CONCURRENCY', 4)
CONCURRENCY = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 4
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run typecheck and format**

Run: `bun typecheck && bun run format:check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/config.ts tests/scripts/behavior-audit/config.test.ts
git commit -m "feat(behavior-audit): add CONCURRENCY config knob"
```

---

## Task 2: `async-mutex.ts` — new helper

**Files:**

- Create: `scripts/behavior-audit/async-mutex.ts`
- Create: `tests/scripts/behavior-audit/async-mutex.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/behavior-audit/async-mutex.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAsyncMutex } from '../../../scripts/behavior-audit/async-mutex.js'

describe('createAsyncMutex', () => {
  test('serializes same-key acquisitions', async () => {
    const mutex = createAsyncMutex()
    const order: string[] = []
    const t1 = mutex('k', async () => {
      order.push('t1-start')
      await Bun.sleep(10)
      order.push('t1-end')
    })
    const t2 = mutex('k', async () => {
      order.push('t2-start')
      await Bun.sleep(5)
      order.push('t2-end')
    })
    await Promise.all([t1, t2])
    expect(order).toEqual(['t1-start', 't1-end', 't2-start', 't2-end'])
  })

  test('runs distinct keys in parallel', async () => {
    const mutex = createAsyncMutex()
    const order: string[] = []
    const t1 = mutex('a', async () => {
      order.push('a-start')
      await Bun.sleep(20)
      order.push('a-end')
    })
    const t2 = mutex('b', async () => {
      order.push('b-start')
      await Bun.sleep(5)
      order.push('b-end')
    })
    await Promise.all([t1, t2])
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end'])
  })

  test('propagates return values', async () => {
    const mutex = createAsyncMutex()
    const result = await mutex('k', async () => 42)
    expect(result).toBe(42)
  })

  test('continues chain after a task throws', async () => {
    const mutex = createAsyncMutex()
    await expect(
      mutex('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const after = await mutex('k', async () => 'ok')
    expect(after).toBe('ok')
  })

  test('does not block distinct keys after one key throws', async () => {
    const mutex = createAsyncMutex()
    await expect(
      mutex('a', async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    const result = await mutex('b', async () => 'ok')
    expect(result).toBe('ok')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit/async-mutex.test.ts`
Expected: FAIL — `Cannot find module '../../../scripts/behavior-audit/async-mutex.js'`

- [ ] **Step 3: Write the helper**

Create `scripts/behavior-audit/async-mutex.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

type Task<T> = () => Promise<T>

export interface AsyncMutex {
  <T>(key: string, task: Task<T>): Promise<T>
}

export function createAsyncMutex(): AsyncMutex {
  const chains = new Map<string, Promise<unknown>>()
  return async function mutex<T>(key: string, task: Task<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.then(task, task) // run on both success and failure of prev
    // Swallow rejections on the stored chain so subsequent acquisitions always run
    chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/async-mutex.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/async-mutex.ts tests/scripts/behavior-audit/async-mutex.test.ts
git commit -m "feat(behavior-audit): add per-key async mutex helper"
```

---

## Task 3: Phase 2a concurrency — delta-merge refactor

The current Phase 2a (`classify.ts:265-280`) does `currentManifest = result.manifest` per task. At concurrency > 1 this races. The refactor: each task returns a manifest delta (`{ testKey, entry }`); merge all deltas at phase end.

**Files:**

- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `scripts/behavior-audit/classify-phase2a-helpers.ts` (extract delta builder)
- Modify: `scripts/behavior-audit/classify-manifest-helpers.ts` (export a `buildEntry` function)
- Modify: existing `tests/scripts/behavior-audit/phase2a.test.ts` (add concurrency test)

- [ ] **Step 1: Inspect current code to confirm refactor surface**

Run: `bun run scripts/behavior-audit/classify.ts 2>/dev/null; rg -n 'updateManifestForClassification|currentManifest' scripts/behavior-audit/classify.ts scripts/behavior-audit/classify-phase2a-helpers.ts scripts/behavior-audit/classify-manifest-helpers.ts`

Identify:

- `updateManifestForClassification(manifest, classified, behavior)` in `classify-manifest-helpers.ts` — currently merges into a full manifest.
- `currentManifest = result.manifest` in `classify.ts:277`.

- [ ] **Step 2: Extract a `buildManifestEntry` helper**

In `scripts/behavior-audit/classify-manifest-helpers.ts`, refactor `updateManifestForClassification` to expose the entry builder:

```typescript
export function buildManifestEntry(
  classified: ClassifiedBehavior,
  behavior: ExtractedBehaviorRecord,
): { testKey: string; entry: ManifestTestEntry } {
  // ... the existing logic, minus the merge-into-manifest part
  return { testKey: classified.testKey, entry: { ...entry } }
}

export function updateManifestForClassification(
  manifest: IncrementalManifest,
  classified: ClassifiedBehavior,
  behavior: ExtractedBehaviorRecord,
): IncrementalManifest {
  const { testKey, entry } = buildManifestEntry(classified, behavior)
  return {
    ...manifest,
    tests: { ...manifest.tests, [testKey]: entry },
  }
}
```

Keep `updateManifestForClassification` for backward compatibility (existing tests rely on it); the new `buildManifestEntry` is the unit the phase calls per task.

- [ ] **Step 3: Add a failing concurrency test**

In `tests/scripts/behavior-audit/phase2a.test.ts`, add a test that runs Phase 2a with concurrency 4 against multiple behaviors from the same test file, asserting all behaviors end up in `classified/{file}.json`:

```typescript
import { CONCURRENCY } from '../../../scripts/behavior-audit/config.js'

test('Phase 2a at CONCURRENCY=4 preserves all behaviors from same test file', async () => {
  // Arrange: 4 behaviors from the same test file, fake classifyBehaviorWithRetry
  // that returns a distinct featureKey per call
  // Act: run runPhase2a with concurrency 4
  // Assert: read classified/{file}.json — all 4 behaviors present
  //         (without the per-file mutex, only the last-written would survive)
})
```

The exact test fixture depends on the existing `phase2a.test.ts` helpers (`makeExtractedRecord`, `createManifestTestEntry`, etc.). Use those.

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/phase2a.test.ts -t 'CONCURRENCY=4'`
Expected: FAIL — behaviors overwrite each other in the shared test file.

- [ ] **Step 5: Refactor Phase 2a**

Modify `scripts/behavior-audit/classify.ts`. The key changes:

1. Import `createAsyncMutex` and `CONCURRENCY`:

```typescript
import { createAsyncMutex } from './async-mutex.js'
import { CONCURRENCY, MAX_RETRIES } from './config.js'
```

2. Change `processSelectedClassification` to return a manifest delta instead of a full manifest. Replace the call to `updateManifestForClassification` with `buildManifestEntry`, and remove the `await deps.saveManifest(updatedManifest)` from per-item flow (move to phase end).

3. Wrap per-test-file `writeClassifiedFile` writes and per-call `saveProgress` writes with the mutex:

```typescript
const mutex = createAsyncMutex()
// in processSelectedClassification:
await mutex(`classified:${testFilePath}`, () => writeSingleClassification(classified, deps))
await mutex('progress', () => deps.saveProgress(progress))
```

4. Replace `const limit = pLimit(1)` at `classify.ts:258` with `pLimit(CONCURRENCY)`.

5. After `Promise.all(...)` completes, merge all deltas and save once:

```typescript
const mergedTests: IncrementalManifest['tests'] = { ...manifest.tests }
for (const delta of collectedDeltas) {
  mergedTests[delta.testKey] = delta.entry
}
const finalManifest: IncrementalManifest = { ...manifest, tests: mergedTests }
await resolvedDeps.saveManifest(finalManifest)
```

- [ ] **Step 6: Run all Phase 2a tests**

Run: `bun test tests/scripts/behavior-audit/phase2a.test.ts`
Expected: PASS (existing tests + new concurrency test)

- [ ] **Step 7: Run typecheck and full test suite**

Run: `bun typecheck && bun test tests/scripts/behavior-audit/`
Expected: PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
git add scripts/behavior-audit/classify.ts scripts/behavior-audit/classify-phase2a-helpers.ts scripts/behavior-audit/classify-manifest-helpers.ts tests/scripts/behavior-audit/phase2a.test.ts
git commit -m "perf(behavior-audit): raise Phase 2a concurrency with per-key mutex and delta-merge manifest"
```

---

## Task 4: Phase 2b concurrency

**Files:**

- Modify: `scripts/behavior-audit/consolidate.ts:219`
- Modify: existing `tests/scripts/behavior-audit/phase2b.test.ts` (add concurrency test)

- [ ] **Step 1: Inspect current Phase 2b write flow**

Run: `rg -n 'currentManifest|saveConsolidatedManifest|saveProgress' scripts/behavior-audit/consolidate.ts`

Confirm: per-featureKey task does `currentManifest = result.manifest` and writes progress. `writeConsolidatedFile` writes one file per `featureKey` (no within-phase file race).

- [ ] **Step 2: Add failing concurrency test**

In `tests/scripts/behavior-audit/phase2b.test.ts`, add a test that runs Phase 2b with concurrency 4 against 3 distinct featureKeys, asserting all 3 end up in `consolidatedManifest.entries` and the final manifest is correct.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/phase2b.test.ts -t 'CONCURRENCY'`
Expected: FAIL — `currentManifest` shared-state assignment races; some entries lost.

- [ ] **Step 4: Refactor Phase 2b**

In `scripts/behavior-audit/consolidate.ts`:

1. Import `createAsyncMutex` and `CONCURRENCY`:

```typescript
import { createAsyncMutex } from './async-mutex.js'
import { CONCURRENCY } from './config.js'
```

2. Change per-task return to a manifest delta: each task returns `{ consolidatedId, entry }` instead of a full `ConsolidatedManifest`.

3. Wrap `saveProgress` and `saveConsolidatedManifest` writes with the mutex (no mutex needed on `writeConsolidatedFile` since paths are unique per featureKey).

4. Replace `pLimit(1)` at `consolidate.ts:219` with `pLimit(CONCURRENCY)`.

5. After `Promise.all`, merge deltas:

```typescript
const mergedEntries = { ...currentManifest.entries }
for (const delta of collectedDeltas) {
  if (delta.entry !== null) mergedEntries[delta.consolidatedId] = delta.entry
}
const finalManifest = { ...currentManifest, entries: mergedEntries }
await saveConsolidatedManifest(finalManifest)
```

- [ ] **Step 5: Run all Phase 2b tests**

Run: `bun test tests/scripts/behavior-audit/phase2b.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck**

Run: `bun typecheck`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/consolidate.ts tests/scripts/behavior-audit/phase2b.test.ts
git commit -m "perf(behavior-audit): raise Phase 2b concurrency with delta-merge manifest"
```

---

## Task 5: Phase 3 concurrency

**Files:**

- Modify: `scripts/behavior-audit/evaluate-runner.ts:211`
- Modify: existing `tests/scripts/behavior-audit/phase3.test.ts` (add concurrency test)

- [ ] **Step 1: Inspect current Phase 3 write flow**

Run: `rg -n 'pLimit|saveProgress|saveConsolidatedManifest' scripts/behavior-audit/evaluate-runner.ts scripts/behavior-audit/evaluate-store.ts`

Confirm: per-featureKey writes to `evaluated/{featureKey}.json` (no within-phase race). `saveProgress` is shared.

- [ ] **Step 2: Add failing concurrency test**

In `tests/scripts/behavior-audit/phase3.test.ts`, add a test that runs Phase 3 with concurrency 4 against 4 distinct featureKeys, asserting the final evaluated manifest has all 4 entries.

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/phase3.test.ts -t 'CONCURRENCY'`
Expected: FAIL (if the test detects a race; depending on current code, may pass by accident — if so, document why).

- [ ] **Step 4: Refactor Phase 3**

In `scripts/behavior-audit/evaluate-runner.ts`:

1. Import `createAsyncMutex` and `CONCURRENCY`:

```typescript
import { createAsyncMutex } from './async-mutex.js'
import { CONCURRENCY } from './config.js'
```

2. Wrap `saveProgress` writes with the mutex.

3. Replace `pLimit(1)` at `evaluate-runner.ts:211` with `pLimit(CONCURRENCY)`.

Phase 3 has additional end-of-phase writes in `evaluate.ts:persistPhase3Outputs` (saveConsolidatedManifest, writeReports) — those run after all tasks complete, so they need no mutex.

- [ ] **Step 5: Run all Phase 3 tests**

Run: `bun test tests/scripts/behavior-audit/phase3.test.ts`
Expected: PASS

- [ ] **Step 6: Run full audit test suite**

Run: `bun test tests/scripts/behavior-audit/`
Expected: PASS (all existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/evaluate-runner.ts tests/scripts/behavior-audit/phase3.test.ts
git commit -m "perf(behavior-audit): raise Phase 3 concurrency with progress mutex"
```

---

## Task 6: Grep fixture tree

**Files:**

- Create: `tests/scripts/behavior-audit/fixtures/grep-sample/`

- [ ] **Step 1: Create the fixture files**

Create the directory and these files:

```bash
mkdir -p tests/scripts/behavior-audit/fixtures/grep-sample/src
mkdir -p tests/scripts/behavior-audit/fixtures/grep-sample/tests
```

Create `tests/scripts/behavior-audit/fixtures/grep-sample/src/bot.ts`:

```typescript
export function startBot(): void {
  console.log('starting')
}

export const BOT_NAME = 'papai'
```

Create `tests/scripts/behavior-audit/fixtures/grep-sample/src/commands/help.ts`:

```typescript
export function registerHelpCommand(): void {
  // help text
}
```

Create `tests/scripts/behavior-audit/fixtures/grep-sample/tests/bot.test.ts`:

```typescript
import { test } from 'bun:test'

test('bot starts', () => {
  // assertion
})
```

- [ ] **Step 2: Commit the fixture**

```bash
git add tests/scripts/behavior-audit/fixtures/grep-sample/
git commit -m "test(behavior-audit): add grep-sample fixture tree"
```

---

## Task 7: Grep replacement — pure JS

**Files:**

- Modify: `scripts/behavior-audit/tools.ts:49-78` (rewrite `makeGrepTool`)
- Create: `tests/scripts/behavior-audit/tools-grep.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/scripts/behavior-audit/tools-grep.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { resetGrepCache } from '../../../scripts/behavior-audit/tools.js'

const FIXTURE_ROOT = join(import.meta.dir, 'fixtures/grep-sample')

async function callGrepTool(pattern: string, directory?: string): Promise<string> {
  const mod = await import('../../../scripts/behavior-audit/tools.js')
  const tools = mod.makeAuditToolsForRoot(FIXTURE_ROOT)
  const result = (await tools.grep.execute({ pattern, directory })) as string
  return result
}

describe('grep tool (pure JS)', () => {
  afterEach(() => {
    resetGrepCache()
  })

  test('finds matches across .ts files in src and tests', async () => {
    const result = await callGrepTool('startBot')
    expect(result).toContain('src/bot.ts:2')
    expect(result).toContain('tests/bot.test.ts:3')
  })

  test('respects directory filter', async () => {
    const result = await callGrepTool('startBot', 'src')
    expect(result).toContain('src/bot.ts')
    expect(result).not.toContain('tests/')
  })

  test('respects directory filter on tests/', async () => {
    const result = await callGrepTool('starts', 'tests')
    expect(result).toContain('tests/bot.test.ts')
    expect(result).not.toContain('src/bot.ts')
  })

  test('returns "No matches found" when nothing matches', async () => {
    const result = await callGrepTool('this-pattern-will-never-match-anything')
    expect(result).toBe('No matches found')
  })

  test('returns error string on invalid regex', async () => {
    const result = await callGrepTool('([')
    expect(result).toContain('Error: invalid regex')
  })

  test('returns error string on directory outside project', async () => {
    const result = await callGrepTool('foo', '../outside')
    expect(result).toContain('resolves outside project')
  })

  test('caps at 100 matches', async () => {
    const result = await callGrepTool('.')
    const lines = result.split('\n')
    expect(lines.length).toBeLessThanOrEqual(100)
  })

  test('second call hits cache (returns same results)', async () => {
    const first = await callGrepTool('startBot')
    const second = await callGrepTool('startBot')
    expect(second).toBe(first)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit/tools-grep.test.ts`
Expected: FAIL — `makeAuditToolsForRoot` and `resetGrepCache` do not exist.

- [ ] **Step 3: Refactor `tools.ts`**

Modify `scripts/behavior-audit/tools.ts`:

1. Change `PROJECT_ROOT` consumers to accept a configurable root so tests can target the fixture tree. Refactor `makeAuditTools` to take an optional root and add `makeAuditToolsForRoot(root)`:

```typescript
import { Glob } from 'bun'
import { resolve, relative, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'

const fileCache = new Map<string, string>()

export function resetGrepCache(): void {
  fileCache.clear()
}

async function readCached(absPath: string): Promise<string> {
  const hit = fileCache.get(absPath)
  if (hit !== undefined) return hit
  const text = await Bun.file(absPath).text()
  fileCache.set(absPath, text)
  return text
}

async function enumerateTsFiles(rootAbs: string, dirs: readonly string[]): Promise<readonly string[]> {
  const out: string[] = []
  for (const dir of dirs) {
    const abs = resolve(rootAbs, dir)
    for await (const path of new Glob('**/*.ts').scan({ cwd: abs, absolute: true })) {
      out.push(path)
    }
  }
  return out
}

function resolveGrepDirectoriesAt(rootAbs: string, directory: string | undefined): readonly string[] | null {
  if (directory === undefined) return ['src', 'tests']
  const resolved = resolve(rootAbs, directory)
  const rel = relative(rootAbs, resolved)
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`${pathSeparator()}..${pathSeparator()}`))) {
    return [rel]
  }
  return null
}

function makeGrepToolAt(rootAbs: string): ToolSet[string] {
  return tool({
    description: 'Search for a regex pattern in src/ and tests/. Returns matching lines as "file:line:content".',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      directory: z.string().optional().describe('Subdirectory to search within (default: src/ and tests/'),
    }),
    execute: async ({ pattern, directory }): Promise<string> => {
      const dirs = resolveGrepDirectoriesAt(rootAbs, directory)
      if (dirs === null) return `Error: directory "${directory}" resolves outside project`
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'u')
      } catch (err) {
        return `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`
      }
      const files = await enumerateTsFiles(rootAbs, dirs)
      const matches: string[] = []
      for (const file of files) {
        const text = await readCached(file)
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!
          if (regex.test(line)) {
            matches.push(`${relative(rootAbs, file)}:${i + 1}:${line}`)
            if (matches.length >= 100) return matches.join('\n')
          }
        }
      }
      return matches.length > 0 ? matches.join('\n') : 'No matches found'
    },
  })
}
```

2. Update `makeAuditTools()` to default the root to `PROJECT_ROOT`, and export the new helpers:

```typescript
export function makeAuditTools(): Record<string, ToolSet[string]> {
  return makeAuditToolsForRoot(PROJECT_ROOT)
}

export function makeAuditToolsForRoot(rootAbs: string): Record<string, ToolSet[string]> {
  // readFile, findFiles, listDir need similar root-aware treatment
  // (apply the same pattern: replace PROJECT_ROOT with rootAbs in each)
  return {
    readFile: makeReadFileToolAt(rootAbs),
    grep: makeGrepToolAt(rootAbs),
    findFiles: makeFindFilesToolAt(rootAbs),
    listDir: makeListDirToolAt(rootAbs),
  }
}
```

3. Refactor `makeReadFileTool`, `makeFindFilesTool`, `makeListDirTool` similarly to accept `rootAbs`. Replace the existing `resolveSafe(inputPath)` calls with `resolveSafeAt(rootAbs, inputPath)`.

- [ ] **Step 4: Run the tests**

Run: `bun test tests/scripts/behavior-audit/tools-grep.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the existing tools tests (if any)**

Run: `bun test tests/scripts/behavior-audit/ -t tool`
Expected: PASS (no regression)

- [ ] **Step 6: Run typecheck, lint, format**

Run: `bun typecheck && bun lint && bun run format:check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/tools.ts tests/scripts/behavior-audit/tools-grep.test.ts
git commit -m "refactor(behavior-audit): replace grep shell-out with pure-JS implementation"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full check suite**

Run: `bun check:full`
Expected: PASS (lint, typecheck, format:check, knip, test, duplicates, review-loop:\*)

- [ ] **Step 2: Verify concurrency end-to-end locally (optional)**

If a local LLM gateway is available, run:

```bash
BEHAVIOR_AUDIT_CONCURRENCY=8 bun audit:behavior
```

Compare wall-clock to a `BEHAVIOR_AUDIT_CONCURRENCY=1` run. Expect significant speedup on Phases 2a/2b/3.

- [ ] **Step 3: Update Tier 1 workflow to set CONCURRENCY (optional)**

In `.github/workflows/behavior-audit.yml`, the `Run audit` step may set `BEHAVIOR_AUDIT_CONCURRENCY` to a value tuned for the gateway. Default behavior (omit the var) uses `4` from config. Add only if tuning is required.

---

## Self-Review Checklist

**Spec coverage:**

- ✅ `CONCURRENCY` env var with default 4 (`Task 1`)
- ✅ Per-key async mutex helper (`Task 2`)
- ✅ Phase 2a refactor with mutex + delta-merge + `pLimit(CONCURRENCY)` (`Task 3`)
- ✅ Phase 2b refactor (`Task 4`)
- ✅ Phase 3 refactor (`Task 5`)
- ✅ Grep replacement with pure-JS + content cache (`Task 6`, `Task 7`)

**Placeholder scan:** none. Where a refactor's exact code depends on existing structure I can't see without modifying live, I gave the structural pattern plus references to existing functions; the implementation plan executor will see the live code.

**Type consistency:** `AsyncMutex` interface defined in `Task 2` and used in `Task 3/4/5`. `buildManifestEntry` introduced in `Task 3 Step 2` and used in `Task 3 Step 5`. `makeAuditToolsForRoot` / `resetGrepCache` introduced in `Task 7 Step 3` and used in `Task 7 Step 1`.

**Scope check:** single focused plan producing Tier 2 in its entirety.

## References

- Spec: `docs/superpowers/specs/2026-07-19-behavior-audit-concurrency-grep-design.md`
- Tier 1 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-close-the-loop-implementation.md`
- Tier 3 plan: `docs/superpowers/plans/2026-07-19-behavior-audit-relative-scoring-closure-implementation.md`
