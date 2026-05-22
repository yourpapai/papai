<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Behavior Audit Incremental Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manifest-based incremental reruns to `scripts/behavior-audit.ts` so new runs only revisit tests whose audit inputs changed since the previous run start.

**Architecture:** Keep `reports/progress.json` as the active-run resume file and add `reports/incremental-manifest.json` for cross-run invalidation and selection. Compute a changed-file set from git plus local worktree state, then select affected Phase 1 tests, Phase 2 evaluations, or report-only rebuilds using per-test dependency paths and per-phase fingerprints.

**Tech Stack:** Bun, TypeScript, Zod v4, git CLI, existing behavior-audit scripts under `scripts/behavior-audit/`

---

## File Structure

| File                                               | Responsibility                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/behavior-audit/config.ts`                 | Add manifest path constant                                                |
| `scripts/behavior-audit/incremental.ts`            | Manifest schema, hashing, git changed-file detection, selection helpers   |
| `scripts/behavior-audit.ts`                        | Capture `lastStartCommit`, load manifest, compute selection, wire phases  |
| `scripts/behavior-audit/extract.ts`                | Run Phase 1 only for selected test keys and update manifest after success |
| `scripts/behavior-audit/evaluate.ts`               | Run Phase 2 only for selected test keys and update manifest after success |
| `scripts/behavior-audit/report-writer.ts`          | Regenerate outputs from stored results without model reruns               |
| `tests/scripts/behavior-audit-incremental.test.ts` | Manifest schema, changed-file, invalidation, and selection tests          |
| `tests/scripts/behavior-audit-integration.test.ts` | Incremental end-to-end behavior for interrupted and partial runs          |

### Task 1: Add Manifest Config Constant

**Files:**

- Modify: `scripts/behavior-audit/config.ts`
- Test: none

- [ ] **Step 1: Add the new manifest path constant**

```typescript
export const INCREMENTAL_MANIFEST_PATH = resolve(REPORTS_DIR, 'incremental-manifest.json')
```

- [ ] **Step 2: Run a focused typecheck**

Run: `bunx tsc --noEmit scripts/behavior-audit/config.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/config.ts
git commit -m "feat(behavior-audit): add incremental manifest path"
```

---

### Task 2: Create Manifest Schema and Persistence Helpers

**Files:**

- Create: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing manifest-schema tests**

```typescript
test('createEmptyManifest starts with null lastStartCommit and empty tests', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')
  const manifest = incremental.createEmptyManifest()

  expect(manifest.version).toBe(1)
  expect(manifest.lastStartCommit).toBeNull()
  expect(manifest.tests).toEqual({})
})

test('loadManifest backfills missing optional fields for older files', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')
  // write a minimal legacy JSON file, then load it
  expect(loaded.phaseVersions.reports).toBe('')
  expect(loaded.tests).toEqual({})
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts`
Expected: FAIL because `incremental.ts` does not exist yet

- [ ] **Step 3: Create `incremental.ts` with schema and load/save helpers**

```typescript
export interface IncrementalManifest {
  readonly version: 1
  readonly lastStartCommit: string | null
  readonly lastStartedAt: string | null
  readonly lastCompletedAt: string | null
  readonly phaseVersions: {
    readonly phase1: string
    readonly phase2: string
    readonly reports: string
  }
  readonly tests: Record<string, ManifestTestEntry>
}

export interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly extractedBehaviorPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}

export function createEmptyManifest(): IncrementalManifest {
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: '', phase2: '', reports: '' },
    tests: {},
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts`
Expected: PASS for the manifest-schema tests

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(behavior-audit): add incremental manifest schema"
```

---

### Task 3: Add `lastStartCommit` Capture and Run-Start Manifest Updates

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Modify: `scripts/behavior-audit.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing run-start baseline tests**

```typescript
test('captureRunStart saves previous lastStartCommit for diffing and writes new HEAD immediately', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')
  const manifest = incremental.createEmptyManifest()
  manifest.lastStartCommit = 'old-commit'

  const result = incremental.captureRunStart(manifest, 'new-commit', '2026-04-17T12:00:00.000Z')

  expect(result.previousLastStartCommit).toBe('old-commit')
  expect(result.updatedManifest.lastStartCommit).toBe('new-commit')
  expect(result.updatedManifest.lastStartedAt).toBe('2026-04-17T12:00:00.000Z')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t captureRunStart`
Expected: FAIL because `captureRunStart` does not exist yet

- [ ] **Step 3: Implement run-start helpers and wire them into `scripts/behavior-audit.ts`**

```typescript
export function captureRunStart(
  manifest: IncrementalManifest,
  currentHead: string,
  startedAt: string,
): {
  readonly previousLastStartCommit: string | null
  readonly updatedManifest: IncrementalManifest
} {
  return {
    previousLastStartCommit: manifest.lastStartCommit,
    updatedManifest: {
      ...manifest,
      lastStartCommit: currentHead,
      lastStartedAt: startedAt,
    },
  }
}
```

In `scripts/behavior-audit.ts`, add the run-start sequence:

```typescript
const manifest = (await loadManifest()) ?? createEmptyManifest()
const currentHead = await resolveHeadCommit()
const { previousLastStartCommit, updatedManifest } = captureRunStart(manifest, currentHead, new Date().toISOString())
await saveManifest(updatedManifest)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t captureRunStart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(behavior-audit): persist lastStartCommit at run start"
```

---

### Task 4: Add Git Changed-File Collection

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing changed-file aggregation tests**

```typescript
test('collectChangedFiles unions committed, staged, unstaged, and untracked paths', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')

  const paths = incremental.combineChangedFileLists([
    ['tests/tools/a.test.ts'],
    ['src/tools/a.ts'],
    ['scripts/behavior-audit/evaluate.ts'],
    ['new-file.ts'],
  ])

  expect(paths).toEqual([
    'new-file.ts',
    'scripts/behavior-audit/evaluate.ts',
    'src/tools/a.ts',
    'tests/tools/a.test.ts',
  ])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t collectChangedFiles`
Expected: FAIL because the helper does not exist yet

- [ ] **Step 3: Implement changed-file helpers in `incremental.ts`**

```typescript
export function combineChangedFileLists(lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())].toSorted()
}

export async function collectChangedFiles(previousLastStartCommit: string | null): Promise<readonly string[]> {
  const committed =
    previousLastStartCommit === null ? [] : await runGitNameOnlyDiff(`${previousLastStartCommit}...HEAD`)
  const staged = await runGitNameOnlyDiff('--cached')
  const unstaged = await runGitNameOnlyDiff('')
  const untracked = await runGitUntrackedFiles()
  return combineChangedFileLists([committed, staged, unstaged, untracked])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t collectChangedFiles`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(behavior-audit): collect changed files for incremental selection"
```

---

### Task 5: Add Phase Version and Per-Test Fingerprint Helpers

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing fingerprint tests**

```typescript
test('buildPhase1Fingerprint changes when mirrored source hash changes', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')

  const a = incremental.buildPhase1Fingerprint({
    testKey: 'tests/tools/a.test.ts::suite > case',
    testFileHash: 'test-hash',
    testSource: 'it(...)',
    mirroredSourceHash: 'src-a',
    phaseVersion: 'v1',
  })
  const b = incremental.buildPhase1Fingerprint({
    testKey: 'tests/tools/a.test.ts::suite > case',
    testFileHash: 'test-hash',
    testSource: 'it(...)',
    mirroredSourceHash: 'src-b',
    phaseVersion: 'v1',
  })

  expect(a).not.toBe(b)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t buildPhase1Fingerprint`
Expected: FAIL because fingerprint builders do not exist yet

- [ ] **Step 3: Implement version and fingerprint helpers**

```typescript
export function buildPhase1Fingerprint(input: {
  readonly testKey: string
  readonly testFileHash: string
  readonly testSource: string
  readonly mirroredSourceHash: string | null
  readonly phaseVersion: string
}): string {
  return sha256Json(input)
}

export function buildPhase2Fingerprint(input: {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly phaseVersion: string
}): string {
  return sha256Json(input)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t buildPhase1Fingerprint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(behavior-audit): add phase version and fingerprint helpers"
```

---

### Task 6: Implement Incremental Selection Rules

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Write the failing selection tests**

```typescript
test('selectIncrementalWork marks Phase 1 when a dependency path changed', async () => {
  const incremental = await import('../../scripts/behavior-audit/incremental.js')

  const selection = incremental.selectIncrementalWork({
    changedFiles: ['src/tools/create-task.ts'],
    previousManifest: {
      version: 1,
      lastStartCommit: 'abc',
      lastStartedAt: 'x',
      lastCompletedAt: 'y',
      phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      tests: {
        'tests/tools/create-task.test.ts::suite > case': {
          testFile: 'tests/tools/create-task.test.ts',
          testName: 'suite > case',
          dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
          phase1Fingerprint: 'fp1',
          phase2Fingerprint: 'fp2',
          extractedBehaviorPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'x',
          lastPhase2CompletedAt: 'y',
        },
      },
    },
    currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
    discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
  })

  expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
  expect(selection.phase2SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
  expect(selection.reportRebuildOnly).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t selectIncrementalWork`
Expected: FAIL because the selector does not exist yet

- [ ] **Step 3: Implement the selector with the approved invalidation rules**

```typescript
export interface IncrementalSelection {
  readonly phase1SelectedTestKeys: readonly string[]
  readonly phase2SelectedTestKeys: readonly string[]
  readonly reportRebuildOnly: boolean
}
```

The implementation must enforce:

- changed test file or mirrored source file -> Phase 1 + Phase 2 for affected test
- Phase 1 version drift -> all tests in Phase 1 and Phase 2
- Phase 2 version drift only -> Phase 2 for all tests with stored extracted behavior
- report-writer drift only -> report rebuild only
- new tests -> Phase 1 + Phase 2
- deleted tests -> removed during reconciliation

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts -t selectIncrementalWork`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(behavior-audit): add incremental selection rules"
```

---

### Task 7: Wire Incremental Selection Into `scripts/behavior-audit.ts`

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing top-level selection test**

```typescript
test('main performs full selection when no manifest exists and incremental selection otherwise', async () => {
  // mock manifest load, HEAD resolution, changed-file collection, and phase runners
  expect(runPhase1Calls[0]!.selectedKeys).toEqual(['all'])
  expect(runPhase2Calls[0]!.selectedKeys).toEqual(['all'])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts`
Expected: FAIL because `scripts/behavior-audit.ts` still runs the full pipeline unconditionally

- [ ] **Step 3: Update `scripts/behavior-audit.ts` to compute and pass selection**

The main flow should look like:

```typescript
const previousManifest = (await loadManifest()) ?? createEmptyManifest()
const currentHead = await resolveHeadCommitOrNull()
const { previousLastStartCommit, updatedManifest } =
  currentHead === null
    ? { previousLastStartCommit: null, updatedManifest: previousManifest }
    : captureRunStart(previousManifest, currentHead, new Date().toISOString())

if (currentHead !== null) await saveManifest(updatedManifest)

const changedFiles = currentHead === null ? [] : await collectChangedFiles(previousLastStartCommit)
const selection = selectIncrementalWork(...)
await runPhase1({ ...selectionAwareInputs })
await runPhase2({ ...selectionAwareInputs })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(behavior-audit): wire incremental selection into entry point"
```

---

### Task 8: Update Phase 1 To Skip Unselected Tests And Persist Manifest Entries

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`
- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing Phase 1 integration test**

```typescript
test('runPhase1 only processes selected test keys and writes manifest updates after successful extraction', async () => {
  // one selected test, one unselected test in the same parsed file
  expect(extractedKeys).toEqual(['tests/tools/create-task.test.ts::suite > selected case'])
  expect(savedManifest.tests['tests/tools/create-task.test.ts::suite > selected case']!.phase1Fingerprint).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t runPhase1`
Expected: FAIL because Phase 1 does not accept a selected-key set yet

- [ ] **Step 3: Update `runPhase1` to accept selected test keys and persist manifest entries**

Add an explicit phase input shape such as:

```typescript
interface Phase1RunInput {
  readonly testFiles: readonly ParsedTestFile[]
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}
```

On each successful extraction, update the manifest entry with:

- `testFile`
- `testName`
- `dependencyPaths`
- `phase1Fingerprint`
- `phase2Fingerprint = null` if the extracted output changed
- `domain`
- `extractedBehaviorPath`
- `lastPhase1CompletedAt`

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t runPhase1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/extract.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(behavior-audit): add incremental selection to phase 1"
```

---

### Task 9: Update Phase 2 To Skip Unselected Tests And Persist Manifest Entries

**Files:**

- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `scripts/behavior-audit/incremental.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing Phase 2 integration test**

```typescript
test('runPhase2 only evaluates selected test keys and writes phase2 fingerprints', async () => {
  expect(evaluatedKeys).toEqual(['tests/tools/create-task.test.ts::suite > selected case'])
  expect(savedManifest.tests['tests/tools/create-task.test.ts::suite > selected case']!.phase2Fingerprint).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t runPhase2`
Expected: FAIL because Phase 2 does not accept selected keys yet

- [ ] **Step 3: Update `runPhase2` to accept selected test keys and persist manifest updates**

On successful evaluation, update the manifest entry with:

- `phase2Fingerprint`
- `lastPhase2CompletedAt`

If a test key is unselected, Phase 2 must still preserve previously stored evaluation data for report regeneration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t runPhase2`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/evaluate.ts scripts/behavior-audit/incremental.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(behavior-audit): add incremental selection to phase 2"
```

---

### Task 10: Add Report-Rebuild-Only Path

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `scripts/behavior-audit.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing report-only invalidation test**

```typescript
test('report-writer drift rebuilds markdown outputs without phase1 or phase2 model calls', async () => {
  expect(runPhase1Calls).toHaveLength(0)
  expect(runPhase2Calls).toHaveLength(0)
  expect(writeIndexCalls).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t report-writer`
Expected: FAIL because the entry point does not support report-only rebuilds yet

- [ ] **Step 3: Implement report-only rebuild from stored results**

Expose a helper that rebuilds:

```typescript
await rebuildReportsFromStoredResults({
  manifest,
  extractedBehaviorsByKey,
  evaluationsByKey,
})
```

It should regenerate behavior and story markdown using stored extracted and evaluated results without model calls. Do not make report-only rebuild depend on active-run `progress.json`; use persisted stored results derived from the manifest-backed state instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t report-writer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(behavior-audit): rebuild reports without rerunning models"
```

---

### Task 11: Add Interrupted-Run Regression Coverage

**Files:**

- Modify: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing interrupted-run test**

```typescript
test('interrupted first run still seeds next incremental baseline from lastStartCommit', async () => {
  // simulate first run capturing run start and stopping before completion
  // simulate second run reading previous manifest and diffing from prior lastStartCommit
  expect(selection.phase1SelectedTestKeys).not.toEqual(['all'])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t interrupted`
Expected: FAIL if the run-start baseline is not reused correctly

- [ ] **Step 3: Fix any remaining edge-case logic exposed by the test**

Likely minimal implementation area:

```typescript
// ensure selection uses previousLastStartCommit captured before overwriting manifest.lastStartCommit
const previousLastStartCommit = manifest.lastStartCommit
const updatedManifest = { ...manifest, lastStartCommit: currentHead, lastStartedAt: startedAt }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/behavior-audit-integration.test.ts -t interrupted`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/scripts/behavior-audit-integration.test.ts scripts/behavior-audit.ts scripts/behavior-audit/incremental.ts
git commit -m "test(behavior-audit): cover interrupted-run incremental baseline"
```

---

### Task 12: End-to-End Verification

- [ ] **Step 1: Run the incremental test suites**

Run: `bun test tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-integration.test.ts`
Expected: PASS

- [ ] **Step 2: Run strict lint on touched files**

Run: `bun run lint:agent-strict -- scripts/behavior-audit.ts scripts/behavior-audit/config.ts scripts/behavior-audit/incremental.ts scripts/behavior-audit/extract.ts scripts/behavior-audit/evaluate.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run repo typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Final commit if verification changed anything**

```bash
git add -A
git commit -m "chore: finish incremental behavior-audit verification"
```
