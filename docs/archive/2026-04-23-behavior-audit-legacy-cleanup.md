# Behavior-Audit Legacy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead legacy code, eliminate duplicate types, and tighten type safety in the behavior-audit pipeline — all changes the canonical artifact migration left behind.

**Architecture:** Six independent cleanup tasks that each remove or tighten one concern. No cross-task dependencies. Each task is a self-contained commit.

**Tech Stack:** TypeScript, Zod v4, Bun test runner

---

## Context

The canonical artifact model is already in effect. The old hybrid-to-artifact migration plan described a "hybrid state" that no longer exists — `candidateFeatureKey`, `extractedBehaviorPath`, `extractedBehaviorsByKey`, `evaluationsByKey`, `timesUsed`, and `recordKeywordUsage` have all been removed from runtime code. However, residual dead code and type looseness remain:

1. **V1/V2/V3 migration schemas** in `progress-schemas.ts` (262 lines) — all three legacy migrations discard checkpoint data via `createIncompatibleResetProgress()`, so the elaborate Zod schemas serve only as shape-detectors before data is thrown away. A simple version check achieves the same result.
2. **Duplicate type** — `ConsolidatedStoryRecord` in `evaluate-reporting.ts` is structurally identical to `ConsolidatedBehavior` in `report-writer.ts`.
3. **Duplicate fingerprint functions** — `buildPhase2Fingerprint` and `buildPhase2aFingerprint` in `fingerprints.ts` have identical input shapes and implementations.
4. **Dead exports** — `isFileCompleted`, `isFeatureKeyCompleted`, `resetPhase2bAndPhase3`, `findExactKeyword` are exported but never imported externally.
5. **Void-parameter anti-pattern** — `markClassificationDone` accepts `classified: ClassifiedBehavior` only to `void` it; `markBehaviorDone` accepts `evaluation: StoryEvaluation` only to `void` it; `writeReports` receives `consolidatedManifest` only to `void` it. These force unnecessary type imports.
6. **Overly nullable `featureKey`** on `ConsolidatedManifestEntry` — consolidation always produces a concrete `featureKey: string`, but the type still allows `string | null | undefined`.

---

## File Structure

| Action | File                                                    | Responsibility                                                                                                                        |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Delete | `scripts/behavior-audit/progress-schemas.ts`            | Legacy V1/V2/V3 Zod schemas (no longer needed)                                                                                        |
| Modify | `scripts/behavior-audit/progress-migrate.ts`            | Simplify to version-number check                                                                                                      |
| Modify | `scripts/behavior-audit/progress.ts`                    | Remove dead exports, remove void parameters, remove unnecessary type imports, inline `ProgressV4Schema`                               |
| Modify | `scripts/behavior-audit/evaluate-reporting.ts`          | Replace `ConsolidatedStoryRecord` with imported `ConsolidatedBehavior`, remove voided `consolidatedManifest` from `WriteReportsInput` |
| Modify | `scripts/behavior-audit/fingerprints.ts`                | Unify `Phase2FingerprintInput`/`Phase2aFingerprintInput` and `buildPhase2Fingerprint`/`buildPhase2aFingerprint`                       |
| Modify | `scripts/behavior-audit/incremental.ts`                 | Update re-exports for unified fingerprint, narrow `ConsolidatedManifestEntry.featureKey` to `string`                                  |
| Modify | `scripts/behavior-audit/classify-phase2a-helpers.ts`    | Update fingerprint import                                                                                                             |
| Modify | `scripts/behavior-audit/classify.ts`                    | Update fingerprint import                                                                                                             |
| Modify | `scripts/behavior-audit/extract-incremental.ts`         | Update fingerprint import                                                                                                             |
| Modify | `scripts/behavior-audit/keyword-vocabulary.ts`          | Remove dead `findExactKeyword` export                                                                                                 |
| Modify | `scripts/behavior-audit/behavior-audit.ts`              | Update deps interface if void params removed                                                                                          |
| Modify | `tests/scripts/behavior-audit-incremental.test.ts`      | Remove V1/V2/V3 migration test fixtures, update fingerprint test calls                                                                |
| Modify | `tests/scripts/behavior-audit-phase2a.test.ts`          | Remove `attachLegacyExtractedBehaviors` helper                                                                                        |
| Modify | `tests/scripts/behavior-audit-phase1-keywords.test.ts`  | Remove `timesUsed` from fixtures (replace with canonical shape)                                                                       |
| Modify | `tests/scripts/behavior-audit-storage.test.ts`          | Remove V3 fixture                                                                                                                     |
| Modify | `tests/scripts/behavior-audit-phase1-selection.test.ts` | Update `extractedBehaviorPath` assertions                                                                                             |
| Modify | `tests/scripts/behavior-audit-phase2b.test.ts`          | Update if deps interface changes                                                                                                      |

---

### Task 1: Remove Dead Exports

**Files:**

- Modify: `scripts/behavior-audit/progress.ts:133-135, 238-240, 289-292`
- Modify: `scripts/behavior-audit/keyword-vocabulary.ts:105-115`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`, `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing test for dead-export removal**

Add a grep-based assertion in a new test that verifies the dead exports no longer exist:

```typescript
import { execSync } from 'node:child_process'

test('no dead exports remain in progress.ts', () => {
  const grep = (pattern: string, path: string) =>
    execSync(`grep -rn "${pattern}" ${path} --include='*.ts' || true`).toString().trim()
  const progressExports = ['isFileCompleted', 'isFeatureKeyCompleted', 'resetPhase2bAndPhase3']
  for (const name of progressExports) {
    const matches = grep(`export function ${name}`, 'scripts/behavior-audit/progress.ts')
    expect(matches, `dead export ${name} still present`).toBe('')
  }
  const vocabMatches = grep(`export function findExactKeyword`, 'scripts/behavior-audit/keyword-vocabulary.ts')
  expect(vocabMatches, 'dead export findExactKeyword still present').toBe('')
})
```

Run: `bun test ./tests/scripts/behavior-audit-incremental.test.ts -t "no dead exports"`
Expected: FAIL (exports still present)

- [ ] **Step 2: Remove `isFileCompleted` from `progress.ts`**

Delete lines 133-135:

```typescript
export function isFileCompleted(progress: Progress, filePath: string): boolean {
  return progress.phase1.completedFiles.includes(filePath)
}
```

- [ ] **Step 3: Remove `isFeatureKeyCompleted` from `progress.ts`**

Delete lines 238-240:

```typescript
export function isFeatureKeyCompleted(progress: Progress, featureKey: string): boolean {
  return progress.phase2b.completedFeatureKeys[featureKey] === 'done'
}
```

- [ ] **Step 4: Remove `resetPhase2bAndPhase3` from `progress.ts`**

Delete lines 289-292:

```typescript
export function resetPhase2bAndPhase3(progress: Progress): void {
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}
```

- [ ] **Step 5: Remove `findExactKeyword` from `keyword-vocabulary.ts`**

Delete lines 105-115:

```typescript
export function findExactKeyword(
  entries: readonly KeywordVocabularyEntry[],
  slug: string,
): KeywordVocabularyEntry | null {
  const normalizedSlug = normalizeKeywordSlug(slug)
  const found = entries.find((entry) => entry.slug === normalizedSlug)
  if (found === undefined) {
    return null
  }
  return found
}
```

- [ ] **Step 6: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-storage.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/keyword-vocabulary.ts
git commit -m "refactor(behavior-audit): remove dead exports from progress.ts and keyword-vocabulary.ts"
```

---

### Task 2: Remove Void-Parameter Anti-Pattern

**Files:**

- Modify: `scripts/behavior-audit/progress.ts:4,8,173-174,258-259`
- Modify: `scripts/behavior-audit/evaluate-reporting.ts:2,22-23,58`
- Modify: `scripts/behavior-audit/behavior-audit.ts` (deps interface if needed)
- Test: `tests/scripts/behavior-audit-phase2a.test.ts`, `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Remove `classified` parameter from `markClassificationDone` in `progress.ts`**

Current (line 173):

```typescript
export function markClassificationDone(progress: Progress, behaviorId: string, classified: ClassifiedBehavior): void {
  void classified
```

Change to:

```typescript
export function markClassificationDone(progress: Progress, behaviorId: string): void {
```

- [ ] **Step 2: Remove `ClassifiedBehavior` import from `progress.ts`**

Current (line 4):

```typescript
import type { ClassifiedBehavior } from './classified-store.js'
```

Delete this line.

- [ ] **Step 3: Remove `evaluation` parameter from `markBehaviorDone` in `progress.ts`**

Current (line 258):

```typescript
export function markBehaviorDone(progress: Progress, key: string, evaluation: StoryEvaluation): void {
  void evaluation
```

Change to:

```typescript
export function markBehaviorDone(progress: Progress, key: string): void {
```

- [ ] **Step 4: Remove `StoryEvaluation` import from `progress.ts`**

Current (line 8):

```typescript
import type { StoryEvaluation } from './report-writer.js'
```

Delete this line.

- [ ] **Step 5: Update callers of `markClassificationDone` and `markBehaviorDone`**

Remove the third argument from all call sites:

- `scripts/behavior-audit/classify.ts:82` — remove the `classified` argument from `deps.markClassificationDone(progress, behaviorId, classified)`
- `scripts/behavior-audit/evaluate.ts:108` — remove the evaluation object argument from `input.deps.markBehaviorDone(input.progress, input.behavior.consolidatedId, { ... })`
- `tests/scripts/behavior-audit-storage.test.ts:1211` — remove the evaluation object argument from `progressModule.markBehaviorDone(progress, 'task-creation::feature', { ... })`
- Update deps interface in `classify.ts:38` (`readonly markClassificationDone: typeof markClassificationDone`) — no change needed since it uses `typeof`
- Update deps interface in `evaluate.ts:45` (`readonly markBehaviorDone: typeof markBehaviorDone`) — no change needed since it uses `typeof`

- [ ] **Step 6: Remove `consolidatedManifest` from `WriteReportsInput` in `evaluate-reporting.ts`**

Current (lines 22-27):

```typescript
interface WriteReportsInput {
  readonly consolidatedManifest: ConsolidatedManifest
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedStoryRecord[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
  readonly progress: Progress
}
```

Change to:

```typescript
interface WriteReportsInput {
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedStoryRecord[]>
  readonly evaluatedByFeatureKey: ReadonlyMap<string, readonly EvaluatedFeatureRecord[]>
  readonly progress: Progress
}
```

Also delete the `void input.consolidatedManifest` on line 58.

- [ ] **Step 7: Remove `ConsolidatedManifest` import from `evaluate-reporting.ts`**

Current (line 2):

```typescript
import type { ConsolidatedManifest } from './incremental.js'
```

Delete this line.

- [ ] **Step 8: Update callers of `writeReports` to remove `consolidatedManifest` argument**

Remove the `consolidatedManifest` property from the input object at all call sites:

- `scripts/behavior-audit/evaluate.ts:193-197` — remove `consolidatedManifest: updatedManifest` from the input object
- `tests/scripts/behavior-audit-phase3.test.ts:605-625` — remove `consolidatedManifest: { version: 1, entries: {} }` from the input object
- `tests/scripts/behavior-audit-storage.test.ts:1230-1247` — remove `consolidatedManifest: { version: 1, entries: {} }` from the input object

- [ ] **Step 9: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-phase2a.test.ts ./tests/scripts/behavior-audit-phase3.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/evaluate-reporting.ts scripts/behavior-audit/classify.ts scripts/behavior-audit/evaluate.ts tests/
git commit -m "refactor(behavior-audit): remove void-parameter anti-pattern from progress and reporting"
```

---

### Task 3: Replace Duplicate `ConsolidatedStoryRecord` with Canonical `ConsolidatedBehavior`

**Files:**

- Modify: `scripts/behavior-audit/evaluate-reporting.ts:1,7,9-20,24`
- Test: `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Replace local type with canonical import**

In `evaluate-reporting.ts`, add `ConsolidatedBehavior` to the existing `report-writer.js` import on line 7:

Current:

```typescript
import { writeIndexFile, writeStoryFile, type StoryEvaluation } from './report-writer.js'
```

Change to:

```typescript
import { writeIndexFile, writeStoryFile, type ConsolidatedBehavior, type StoryEvaluation } from './report-writer.js'
```

- [ ] **Step 2: Delete the `ConsolidatedStoryRecord` type definition**

Delete lines 9-20:

```typescript
type ConsolidatedStoryRecord = {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
}
```

- [ ] **Step 3: Replace `ConsolidatedStoryRecord` with `ConsolidatedBehavior` in `WriteReportsInput`**

Current (line 24):

```typescript
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedStoryRecord[]>
```

Change to:

```typescript
  readonly consolidatedByFeatureKey: ReadonlyMap<string, readonly ConsolidatedBehavior[]>
```

- [ ] **Step 4: Update callers if needed**

Search for any external callers that pass `ConsolidatedStoryRecord`-typed values to `writeReports` and confirm they already produce `ConsolidatedBehavior`-compatible objects (they should, since the types are structurally identical).

- [ ] **Step 5: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-phase3.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/evaluate-reporting.ts
git commit -m "refactor(behavior-audit): replace duplicate ConsolidatedStoryRecord with canonical ConsolidatedBehavior"
```

---

### Task 4: Unify Duplicate Fingerprint Functions

**Files:**

- Modify: `scripts/behavior-audit/fingerprints.ts:11-25,39-44`
- Modify: `scripts/behavior-audit/incremental.ts:9-10`
- Modify: `scripts/behavior-audit/extract-incremental.ts:9,93`
- Modify: `scripts/behavior-audit/classify-phase2a-helpers.ts:4,97`
- Modify: `scripts/behavior-audit/classify.ts:21,115`
- Test: `tests/scripts/behavior-audit-incremental.test.ts:581-598,962-979`
- Test: `tests/scripts/behavior-audit-phase2a.test.ts:288`

- [ ] **Step 1: Merge `Phase2FingerprintInput` and `Phase2aFingerprintInput` in `fingerprints.ts`**

Current (lines 11-25):

```typescript
interface Phase2FingerprintInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}

interface Phase2aFingerprintInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}
```

Replace both with a single interface:

```typescript
interface Phase2FingerprintInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}
```

- [ ] **Step 2: Merge `buildPhase2Fingerprint` and `buildPhase2aFingerprint` into one**

Current (lines 39-44):

```typescript
export function buildPhase2Fingerprint(input: Phase2FingerprintInput): string {
  return sha256Json(input)
}

export function buildPhase2aFingerprint(input: Phase2aFingerprintInput): string {
  return sha256Json(input)
}
```

Replace with single function:

```typescript
export function buildPhase2Fingerprint(input: Phase2FingerprintInput): string {
  return sha256Json(input)
}
```

- [ ] **Step 3: Update `incremental.ts` re-exports**

Current (lines 9-10):

```typescript
  buildPhase2Fingerprint,
  buildPhase2aFingerprint,
```

Change to:

```typescript
  buildPhase2Fingerprint,
```

- [ ] **Step 4: Update `classify-phase2a-helpers.ts`**

Current (line 4):

```typescript
import { buildPhase2aFingerprint, type IncrementalManifest } from './incremental.js'
```

Change to:

```typescript
import { buildPhase2Fingerprint, type IncrementalManifest } from './incremental.js'
```

Current (line 97):

```typescript
  const nextFingerprint = buildPhase2aFingerprint({
```

Change to:

```typescript
  const nextFingerprint = buildPhase2Fingerprint({
```

- [ ] **Step 5: Update `classify.ts`**

Current (line 21):

```typescript
import { buildPhase2aFingerprint, saveManifest } from './incremental.js'
```

Change to:

```typescript
import { buildPhase2Fingerprint, saveManifest } from './incremental.js'
```

Current (line 115):

```typescript
    phase2aFingerprint: buildPhase2aFingerprint({
```

Change to:

```typescript
    phase2aFingerprint: buildPhase2Fingerprint({
```

- [ ] **Step 6: Update `extract-incremental.ts`**

No change needed — it already imports `buildPhase2Fingerprint` (line 9) and calls it (line 93).

- [ ] **Step 7: Update test files**

In `tests/scripts/behavior-audit-incremental.test.ts`, replace all `buildPhase2Fingerprint` calls that were already using the correct name (they are) — no change needed since `buildPhase2Fingerprint` still exists.

In `tests/scripts/behavior-audit-phase2a.test.ts` (line 288):

```typescript
          phase2aFingerprint: incremental.buildPhase2aFingerprint({
```

Change to:

```typescript
          phase2aFingerprint: incremental.buildPhase2Fingerprint({
```

- [ ] **Step 8: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-phase2a.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/behavior-audit/fingerprints.ts scripts/behavior-audit/incremental.ts scripts/behavior-audit/classify-phase2a-helpers.ts scripts/behavior-audit/classify.ts tests/scripts/behavior-audit-phase2a.test.ts
git commit -m "refactor(behavior-audit): unify duplicate buildPhase2Fingerprint and buildPhase2aFingerprint"
```

---

### Task 5: Simplify Legacy Migration and Delete `progress-schemas.ts`

**Files:**

- Delete: `scripts/behavior-audit/progress-schemas.ts`
- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`
- Test: `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- Test: `tests/scripts/behavior-audit-phase1-selection.test.ts`

- [ ] **Step 1: Move `ProgressV4Schema` into `progress-migrate.ts`**

In `progress-migrate.ts`, add the V4 schema inline. The V4 schema from `progress-schemas.ts` (lines 93-242) uses `Phase1CheckpointSchema`, `Phase2aCheckpointSchema`, `Phase2bCheckpointSchema`, and `Phase3CheckpointSchema` — all defined in `progress-schemas.ts`. Move all four checkpoint schemas and the `FailedEntrySchema` (line 87-91) into `progress-migrate.ts` along with `ProgressV4Schema`.

Add to top of `progress-migrate.ts`:

```typescript
import { z } from 'zod'

const FailedEntrySchema = z.object({
  error: z.string(),
  attempts: z.number(),
  lastAttempt: z.string(),
})

const Phase1CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: z.object({
    filesTotal: z.number(),
    filesDone: z.number(),
    testsExtracted: z.number(),
    testsFailed: z.number(),
  }),
})

const Phase2aCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    behaviorsTotal: z.number(),
    behaviorsDone: z.number(),
    behaviorsFailed: z.number(),
  }),
})

const Phase2bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedFeatureKeys: z.record(z.string(), z.literal('done')),
  failedFeatureKeys: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    featureKeysTotal: z.number(),
    featureKeysDone: z.number(),
    featureKeysFailed: z.number(),
    behaviorsConsolidated: z.number(),
  }),
})

const Phase3CheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedConsolidatedIds: z.record(z.string(), z.literal('done')),
  failedConsolidatedIds: z.record(z.string(), FailedEntrySchema),
  stats: z.object({
    consolidatedIdsTotal: z.number(),
    consolidatedIdsDone: z.number(),
    consolidatedIdsFailed: z.number(),
  }),
})

const ProgressV4Schema = z.strictObject({
  version: z.literal(4),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})
```

- [ ] **Step 2: Replace legacy migration cascade with version-number check**

In `progress-migrate.ts`, replace the entire `validateOrMigrateProgress` function and the three `migrateV*` functions with:

```typescript
export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v4Result = ProgressV4Schema.safeParse(raw)
  if (v4Result.success) return v4Result.data

  if (
    typeof raw === 'object' &&
    raw !== null &&
    'startedAt' in raw &&
    typeof (raw as { startedAt: unknown }).startedAt === 'string'
  ) {
    return createIncompatibleResetProgress((raw as { startedAt: string }).startedAt)
  }

  return null
}
```

Remove the `migrateV1toV2`, `migrateV2toV3`, `migrateV3toV4` functions and the import from `progress-schemas.ts` (line 2).

The `toVersion4Progress` and `createIncompatibleResetProgress` functions remain — the latter is called for any non-V4 progress file.

The `normalizePhase2aFailedAttempts` function remains — it is still called by `toVersion4Progress`.

- [ ] **Step 3: Delete `progress-schemas.ts`**

Delete the entire file `scripts/behavior-audit/progress-schemas.ts`.

- [ ] **Step 4: Remove V1/V2/V3 migration tests from `behavior-audit-incremental.test.ts`**

`validateOrMigrateProgress` is loaded via `loadProgressMigrateModule()` (line 64). Remove the following 7 test cases that test V1/V2/V3 migration behavior:

1. Line 983: `validateOrMigrateProgress upgrades version 2 progress into checkpoint-only version 4 state`
2. Line 1034: `validateOrMigrateProgress normalizes payload-heavy version 3 files into checkpoint-only version 4 progress`
3. Line 1143: `validateOrMigrateProgress treats populated legacy version 2 consolidations as incompatible and keeps only safe phase1 checkpoints`
4. Line 1207: `validateOrMigrateProgress resets pre-versioned payload-heavy phase1 state to a clean checkpoint-only baseline`
5. Line 1247: `validateOrMigrateProgress treats populated legacy pre-versioned phase1 state as incompatible and resets it`
6. Line 1279: `validateOrMigrateProgress resets legacy pre-versioned phase1 state when startedAt is missing`
7. Line 1332: `validateOrMigrateProgress resets payload-heavy version 3 phase2a failure state to checkpoint-only defaults`

Also remove any V1/V2/V3 fixture builder functions (e.g., the V1 fixture factory at line 1286, V2/V3 fixture data) that are only used by the deleted tests.

Also remove the `extractedBehaviors` shape assertion in line 1023 test `createEmptyProgress returns checkpoint-only version 4 progress`: `expect(progress.phase1).not.toHaveProperty('extractedBehaviors')` — this is trivially true for V4 and adds no regression value.

Replace with a single test:

```typescript
test('validateOrMigrateProgress resets non-V4 progress to fresh V4', async () => {
  const { validateOrMigrateProgress } = await loadProgressMigrateModule()
  const result = validateOrMigrateProgress({ startedAt: '2025-01-01T00:00:00Z', phase1: {} })
  expect(result).not.toBeNull()
  expect(result!.version).toBe(4)
  expect(result!.phase1.status).toBe('not-started')
})
```

- [ ] **Step 5: Remove `extractedBehaviors` from V3 fixture in `behavior-audit-storage.test.ts`**

In `tests/scripts/behavior-audit-storage.test.ts` line 843, find the V3 fixture containing `extractedBehaviors: {}` and remove or update the test that uses it. If the test was specifically testing V3→V4 migration via `loadProgress`, replace with the simplified migration behavior.

- [ ] **Step 6: Remove `extractedBehaviors` assertions in `behavior-audit-phase1-keywords.test.ts` and `behavior-audit-phase1-selection.test.ts`**

In `behavior-audit-phase1-keywords.test.ts` line 143: `expect(progress.phase1).not.toHaveProperty('extractedBehaviors')` — this assertion is now trivially true since V4 never has this field. Remove it.

In `behavior-audit-phase1-selection.test.ts` lines 153, 196: Remove the `not.toHaveProperty('extractedBehaviors')` and `not.toHaveProperty('extractedBehaviorPath')` assertions for the same reason.

- [ ] **Step 7: Remove `attachLegacyExtractedBehaviors` from `behavior-audit-phase2a.test.ts`**

In `tests/scripts/behavior-audit-phase2a.test.ts` lines 158-168, the `attachLegacyExtractedBehaviors` helper injects legacy `extractedBehaviors` into a V4 progress object. It is used by the test at line 805: `runPhase2a skips missing canonical extracted artifacts instead of falling back to legacy phase1 payloads`.

Since the runtime code no longer reads `progress.phase1.extractedBehaviors`, this test verifies behavior that cannot regress (there is no fallback code to regress to). Remove:

- The `attachLegacyExtractedBehaviors` helper function (lines 158-168)
- The test at line 805 that uses it

- [ ] **Step 8: Update `timesUsed` fixtures in `behavior-audit-phase1-keywords.test.ts`**

In `tests/scripts/behavior-audit-phase1-keywords.test.ts` lines 314, 321, 328, the test creates vocabulary fixture entries with `timesUsed: 2`, `timesUsed: 1`, `timesUsed: 5`. These test that `loadKeywordVocabulary` + normalization strips unknown fields. Since the current Zod schema already rejects unknown fields (or strips them during parse), the `timesUsed` keys in fixtures are valid backward-compat tests. However, verify the assertion on line 780 (`not.toContain('"timesUsed"')`) still passes after the fixture change. If the Zod schema uses `.strictObject()` or `.passthrough()`, the `timesUsed` fields will be stripped; if not, they will survive. Confirm the behavior and adjust fixtures accordingly:

- If Zod strips unknown keys: The `timesUsed` fields in fixtures are valid backward-compat test inputs. Keep them as-is — they test that legacy data is normalized.
- If Zod preserves unknown keys: Remove `timesUsed` from fixtures since the test would be asserting something false.

- [ ] **Step 9: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-storage.test.ts ./tests/scripts/behavior-audit-phase1-keywords.test.ts ./tests/scripts/behavior-audit-phase1-selection.test.ts ./tests/scripts/behavior-audit-phase2a.test.ts`
Expected: PASS

- [ ] **Step 10: Run typecheck**

Run: `bun typecheck`
Expected: PASS (no references to deleted `progress-schemas.ts`)

- [ ] **Step 11: Commit**

```bash
git add -A scripts/behavior-audit/progress-schemas.ts scripts/behavior-audit/progress-migrate.ts scripts/behavior-audit/progress.ts tests/
git commit -m "refactor(behavior-audit): simplify legacy migration, delete progress-schemas.ts"
```

---

### Task 6: Narrow `ConsolidatedManifestEntry.featureKey` to Required `string`

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts:67,123`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Update `ConsolidatedManifestEntry` interface**

In `incremental.ts`, change the `ConsolidatedManifestEntry` interface (line 67):

Current:

```typescript
  readonly featureKey?: string | null
```

Change to:

```typescript
  readonly featureKey: string
```

- [ ] **Step 2: Update `ConsolidatedManifestEntrySchema`**

In `incremental.ts`, change the Zod schema (line 123):

Current:

```typescript
  featureKey: z.string().nullable().optional(),
```

Change to:

```typescript
  featureKey: z.string(),
```

- [ ] **Step 3: Update consolidation code that creates `ConsolidatedManifestEntry`**

In `consolidate.ts`, the `runPhase2b` function creates `ConsolidatedManifestEntry` objects. Since all entries that reach consolidation already have non-null `featureKey` (filtered at line 64), no logic change is needed — just confirm TypeScript compiles. The `featureKey` field in the entry constructor must already be a string.

- [ ] **Step 4: Remove null-coalescing fallbacks on consolidated entries**

Since `featureKey` is now `string` (not nullable) on `ConsolidatedManifestEntry`, remove the `?? null` fallbacks at these specific locations:

- `scripts/behavior-audit/evaluate-phase3-helpers.ts:44` — change `return entry.featureKey ?? null` to `return entry.featureKey`
- `scripts/behavior-audit/report-rebuild-helpers.ts:110` — change `const featureKey = entry.featureKey ?? null` to `const featureKey = entry.featureKey`

Keep `?? null` fallbacks on `ManifestTestEntry` access (where `featureKey` is legitimately nullable):

- `scripts/behavior-audit/consolidate.ts:51` — stays (reads from `ManifestTestEntry`)
- `scripts/behavior-audit/classify.ts:177` — stays (reads from `ManifestTestEntry`)
- `scripts/behavior-audit/incremental-selection.ts:39` — stays (reads from `ManifestTestEntry`)

- [ ] **Step 5: Update test fixtures that create `ConsolidatedManifestEntry` objects**

Search test files for `ConsolidatedManifestEntry` fixture creators. Change any fixture that sets `featureKey: null` or omits `featureKey` to set a concrete string value like `featureKey: 'test-feature'`.

Specific fixtures to update:

- `tests/scripts/behavior-audit-integration.helpers.ts:347` — the `createConsolidatedManifestEntry` helper defaults `featureKey: null`. Change the default to a required parameter (no default) or `featureKey: 'test-feature'`.
- `tests/scripts/behavior-audit-phase3.test.ts:537` — has `featureKey: 'group-targeting' as string | null`. Remove the `as string | null` cast (just `featureKey: 'group-targeting'`).

- [ ] **Step 6: Run tests**

Run: `bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts`
Expected: PASS

- [ ] **Step 7: Run typecheck**

Run: `bun typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/behavior-audit/incremental.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate-phase3-helpers.ts tests/
git commit -m "refactor(behavior-audit): narrow ConsolidatedManifestEntry.featureKey to required string"
```

---

### Task 7: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full behavior-audit test slice**

```bash
bun test ./tests/scripts/behavior-audit-phase1-keywords.test.ts \
         ./tests/scripts/behavior-audit-phase1-selection.test.ts \
         ./tests/scripts/behavior-audit-phase2a.test.ts \
         ./tests/scripts/behavior-audit-phase2b.test.ts \
         ./tests/scripts/behavior-audit-phase3.test.ts \
         ./tests/scripts/behavior-audit-incremental.test.ts \
         ./tests/scripts/behavior-audit-storage.test.ts \
         ./tests/scripts/behavior-audit-entrypoint.test.ts
```

Expected: PASS

- [ ] **Step 2: Run repo-wide verification**

```bash
bun typecheck
bun lint
bun format:check
```

Expected: PASS with zero suppressions.

- [ ] **Step 3: Static search for removed patterns**

```bash
rg "candidateFeatureKey" scripts/behavior-audit/ tests/scripts/behavior-audit* --type ts
rg "extractedBehaviorPath" scripts/behavior-audit/ tests/scripts/behavior-audit* --type ts
rg "extractedBehaviorsByKey|evaluationsByKey" scripts/behavior-audit/ tests/scripts/behavior-audit* --type ts
rg "timesUsed" scripts/behavior-audit/ --type ts
rg "progress\.phase1\.extractedBehaviors" scripts/behavior-audit/ --type ts
rg "buildPhase2aFingerprint" scripts/behavior-audit/ tests/scripts/behavior-audit* --type ts
rg "ConsolidatedStoryRecord" scripts/behavior-audit/ --type ts
rg "findExactKeyword" scripts/behavior-audit/ tests/ --type ts
```

Expected: 0 matches for all patterns.

- [ ] **Step 4: Verify `progress-schemas.ts` is deleted**

```bash
test ! -f scripts/behavior-audit/progress-schemas.ts && echo "DELETED" || echo "STILL EXISTS"
```

Expected: DELETED

---

## Rollback Considerations

- Each task is an independent commit. Any single task can be reverted with `git revert <sha>` without affecting others.
- Task 5 (simplify migration) is the only potentially disruptive change. If a V1/V2/V3 `progress.json` is encountered after the simplification, the behavior is identical (full reset to V4) — the only difference is that the version-number check is less strict about validating the legacy blob's shape before discarding it. If strict shape-validation-before-discard is desired, keep `progress-schemas.ts` but this adds ~200 lines of code that validates data only to throw it away.

## Success Criteria

- [ ] `progress-schemas.ts` is deleted
- [ ] `ConsolidatedStoryRecord` type no longer exists (replaced by `ConsolidatedBehavior`)
- [ ] `buildPhase2aFingerprint` no longer exists (unified into `buildPhase2Fingerprint`)
- [ ] `isFileCompleted`, `isFeatureKeyCompleted`, `resetPhase2bAndPhase3`, `findExactKeyword` no longer exported
- [ ] `markClassificationDone` and `markBehaviorDone` no longer accept void parameters
- [ ] `ConsolidatedManifestEntry.featureKey` is `string` (not `string | null | undefined`)
- [ ] All tests pass, typecheck passes, lint passes with zero suppressions
- [ ] No `timesUsed` in `scripts/behavior-audit/keyword-vocabulary.ts`
- [ ] No `buildPhase2aFingerprint` references in runtime code
