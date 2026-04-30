# Consolidate Behavior-Audit Scripts Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all behavior-audit source and test files that live at the `scripts/` and `tests/scripts/` top level into their proper subdirectory (`scripts/behavior-audit/` and `tests/scripts/behavior-audit/`), eliminating the thin barrel re-export files in the process.

**Architecture:** Two source files with real logic (`behavior-audit.ts` and `behavior-audit-reset.ts`) move into the `behavior-audit/` subdirectory; nine barrel-only files are deleted after their test counterparts are updated to import directly from the underlying modules. Tests that tested the barrels move into `tests/scripts/behavior-audit/`. Two tests that stay at `tests/scripts/` level get single-line import fixes.

**Tech Stack:** Bun, TypeScript (`.js` extension in imports), `knip-bun`, `tsgo`

---

## File map

### New files (content moved from top level)

| New path                          | Moved from                        |
| --------------------------------- | --------------------------------- |
| `scripts/behavior-audit/index.ts` | `scripts/behavior-audit.ts`       |
| `scripts/behavior-audit/reset.ts` | `scripts/behavior-audit-reset.ts` |

### Deleted files

| File                                             | Was                                             |
| ------------------------------------------------ | ----------------------------------------------- |
| `scripts/behavior-audit.ts`                      | source (moved)                                  |
| `scripts/behavior-audit-reset.ts`                | source (moved)                                  |
| `scripts/behavior-audit-classify-agent.ts`       | barrel → `behavior-audit/classify-agent.js`     |
| `scripts/behavior-audit-entrypoint.ts`           | barrel → `behavior-audit.js`                    |
| `scripts/behavior-audit-incremental.ts`          | barrel → `behavior-audit/incremental.js`        |
| `scripts/behavior-audit-interrupted-run.ts`      | barrel → `behavior-audit.js`                    |
| `scripts/behavior-audit-phase1-keywords.ts`      | barrel → `behavior-audit/keyword-vocabulary.js` |
| `scripts/behavior-audit-phase1-selection.ts`     | barrel → `behavior-audit/incremental.js`        |
| `scripts/behavior-audit-phase1-write-failure.ts` | barrel → `behavior-audit/extract.js`            |
| `scripts/behavior-audit-phase2a.ts`              | barrel → `behavior-audit/classify.js`           |
| `scripts/behavior-audit-storage.ts`              | barrel → `behavior-audit/progress.js`           |

### Test files moved to `tests/scripts/behavior-audit/`

| New path                                                       | Moved from                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `tests/scripts/behavior-audit/entrypoint.test.ts`              | `tests/scripts/behavior-audit-entrypoint.test.ts`           |
| `tests/scripts/behavior-audit/interrupted-run.test.ts`         | `tests/scripts/behavior-audit-interrupted-run.test.ts`      |
| `tests/scripts/behavior-audit/incremental-integration.test.ts` | `tests/scripts/behavior-audit-incremental.test.ts`          |
| `tests/scripts/behavior-audit/classify-agent.test.ts`          | `tests/scripts/behavior-audit-classify-agent.test.ts`       |
| `tests/scripts/behavior-audit/storage.test.ts`                 | `tests/scripts/behavior-audit-storage.test.ts`              |
| `tests/scripts/behavior-audit/phase1-keywords.test.ts`         | `tests/scripts/behavior-audit-phase1-keywords.test.ts`      |
| `tests/scripts/behavior-audit/phase1-selection.test.ts`        | `tests/scripts/behavior-audit-phase1-selection.test.ts`     |
| `tests/scripts/behavior-audit/phase1-write-failure.test.ts`    | `tests/scripts/behavior-audit-phase1-write-failure.test.ts` |
| `tests/scripts/behavior-audit/phase2a.test.ts`                 | `tests/scripts/behavior-audit-phase2a.test.ts`              |

### Test files updated in place (not moved)

| File                                                  | Change        |
| ----------------------------------------------------- | ------------- |
| `tests/scripts/behavior-audit-phase3.test.ts`         | 1 import path |
| `tests/scripts/behavior-audit-integration.support.ts` | 1 import path |

### Config files updated

| File           | Change                       |
| -------------- | ---------------------------- |
| `package.json` | `audit:behavior` script path |
| `knip.jsonc`   | entry pattern update         |

---

## Tasks

### Task 1: Create `scripts/behavior-audit/index.ts`

**Files:**

- Create: `scripts/behavior-audit/index.ts`

This is a copy of `scripts/behavior-audit.ts` with every `./behavior-audit/` import prefix stripped to `./` (since the file now lives inside the subdir). The current `behavior-audit.ts` delegates helpers to `entrypoint-helpers.js` and uses a progress reporter; the moved file preserves this structure.

- [ ] **Step 1: Create the file**

```typescript
// scripts/behavior-audit/index.ts
import { runPhase2a } from './classify.js'
import { PROGRESS_RENDERER } from './config.js'
import { runPhase1b } from './consolidate-keywords.js'
import {
  createRunReporter,
  isTestEnvironment,
  loadOrCreateProgress,
  prepareIncrementalRun,
  requireOpenAiApiKey,
  runPhase2bIfNeeded,
  selectIncrementalRunWork as selectIncrementalRunWorkWithLog,
} from './entrypoint-helpers.js'
import { runPhase3 } from './evaluate.js'
import { runPhase1 } from './extract.js'
import type { IncrementalManifest } from './incremental.js'
import { saveConsolidatedManifest } from './incremental.js'
import {
  createProgressReporter,
  type BehaviorAuditProgressReporter,
  type CreateProgressReporterInput,
} from './progress-reporter.js'
import type { Progress } from './progress.js'
import { rebuildReportsFromStoredResults } from './report-writer.js'
import type { ParsedTestFile } from './test-parser.js'

function defaultRunPhase2bIfNeeded(
  progress: Progress,
  phase2Version: string,
  selectedFeatureKeys: ReadonlySet<string>,
  reporter: BehaviorAuditProgressReporter,
): Promise<import('./incremental.js').ConsolidatedManifest> {
  return runPhase2bIfNeeded({
    progress,
    phase2Version,
    selectedFeatureKeys,
    reporter,
  })
}

async function runPhase1IfNeeded(
  parsedFiles: readonly ParsedTestFile[],
  progress: Progress,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
  reporter: BehaviorAuditProgressReporter,
): Promise<void> {
  if (progress.phase1.status === 'done' && selectedTestKeys.size === 0) {
    console.log('[Phase 1] Already complete, skipping.\n')
    return
  }
  await runPhase1({ testFiles: parsedFiles, progress, selectedTestKeys, manifest }, { reporter })
}

function runPhase1bIfNeeded(progress: Progress): Promise<void> {
  return runPhase1b(progress)
}

function runPhase2aIfNeeded(
  progress: Progress,
  manifest: IncrementalManifest,
  selectedTestKeys: ReadonlySet<string>,
  reporter: BehaviorAuditProgressReporter,
): Promise<ReadonlySet<string>> {
  if (progress.phase2a.status === 'done' && selectedTestKeys.size === 0) {
    return Promise.resolve(new Set())
  }
  return runPhase2a({ progress, selectedTestKeys, manifest }, { reporter })
}

async function runPhase3IfNeeded(
  progress: Progress,
  selectedConsolidatedIds: ReadonlySet<string>,
  selectedFeatureKeys: ReadonlySet<string>,
  consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null,
  reporter: BehaviorAuditProgressReporter,
): Promise<void> {
  if (progress.phase3.status === 'done' && selectedConsolidatedIds.size === 0) {
    console.log('[Phase 3] Already complete.\n')
    return
  }
  await runPhase3({ progress, selectedConsolidatedIds, selectedFeatureKeys, consolidatedManifest }, { reporter })
}

function defaultSelectIncrementalRunWork(input: {
  readonly previousManifest: IncrementalManifest
  readonly updatedManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
}): Promise<{
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly previousConsolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
  readonly selection: import('./incremental.js').IncrementalSelection
}> {
  return selectIncrementalRunWorkWithLog({
    ...input,
    log: console,
  })
}

export interface BehaviorAuditDeps {
  readonly requireOpenAiApiKey: () => void
  readonly prepareIncrementalRun: typeof prepareIncrementalRun
  readonly selectIncrementalRunWork: typeof defaultSelectIncrementalRunWork
  readonly loadOrCreateProgress: typeof loadOrCreateProgress
  readonly createProgressReporter: (input: CreateProgressReporterInput) => BehaviorAuditProgressReporter
  readonly rebuildReportsFromStoredResults: typeof rebuildReportsFromStoredResults
  readonly runPhase1IfNeeded: (
    parsedFiles: readonly ParsedTestFile[],
    progress: Progress,
    selectedTestKeys: ReadonlySet<string>,
    manifest: IncrementalManifest,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<void>
  readonly runPhase1bIfNeeded: typeof runPhase1bIfNeeded
  readonly runPhase2aIfNeeded: (
    progress: Progress,
    manifest: IncrementalManifest,
    selectedTestKeys: ReadonlySet<string>,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<ReadonlySet<string>>
  readonly runPhase2bIfNeeded: (
    progress: Progress,
    phase2Version: string,
    selectedFeatureKeys: ReadonlySet<string>,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<import('./incremental.js').ConsolidatedManifest>
  readonly saveConsolidatedManifest: typeof saveConsolidatedManifest
  readonly runPhase3IfNeeded: (
    progress: Progress,
    selectedConsolidatedIds: ReadonlySet<string>,
    selectedFeatureKeys: ReadonlySet<string>,
    consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null,
    reporter: BehaviorAuditProgressReporter,
  ) => Promise<void>
  readonly stdout: Pick<NodeJS.WriteStream, 'isTTY'>
  readonly isTestEnvironment: boolean
  readonly log: Pick<typeof console, 'log'>
}

const defaultBehaviorAuditDeps: BehaviorAuditDeps = {
  requireOpenAiApiKey,
  prepareIncrementalRun,
  selectIncrementalRunWork: defaultSelectIncrementalRunWork,
  loadOrCreateProgress,
  createProgressReporter,
  rebuildReportsFromStoredResults,
  runPhase1IfNeeded,
  runPhase1bIfNeeded,
  runPhase2aIfNeeded,
  runPhase2bIfNeeded: defaultRunPhase2bIfNeeded,
  saveConsolidatedManifest,
  runPhase3IfNeeded,
  stdout: process.stdout,
  isTestEnvironment: isTestEnvironment(),
  log: console,
}

async function executeSelectedBehaviorAuditWork(input: {
  readonly deps: BehaviorAuditDeps
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly updatedManifest: IncrementalManifest
  readonly previousConsolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
  readonly selection: import('./incremental.js').IncrementalSelection
  readonly progress: Progress
  readonly reporter: BehaviorAuditProgressReporter
}): Promise<void> {
  if (input.selection.reportRebuildOnly) {
    await input.deps.rebuildReportsFromStoredResults({
      consolidatedManifest: input.previousConsolidatedManifest,
    })
    input.deps.log.log('\nBehavior audit complete.')
    return
  }

  await input.deps.runPhase1IfNeeded(
    input.parsedFiles,
    input.progress,
    new Set(input.selection.phase1SelectedTestKeys),
    input.updatedManifest,
    input.reporter,
  )
  await input.deps.runPhase1bIfNeeded(input.progress)
  const dirtyFromPhase2a = await input.deps.runPhase2aIfNeeded(
    input.progress,
    input.updatedManifest,
    new Set(input.selection.phase2aSelectedTestKeys),
    input.reporter,
  )
  const phase2bSelectedKeys = new Set([...input.selection.phase2bSelectedFeatureKeys, ...dirtyFromPhase2a])
  const consolidatedManifest = await input.deps.runPhase2bIfNeeded(
    input.progress,
    input.updatedManifest.phaseVersions.phase2,
    phase2bSelectedKeys,
    input.reporter,
  )
  await input.deps.saveConsolidatedManifest(consolidatedManifest)

  await input.deps.runPhase3IfNeeded(
    input.progress,
    new Set(input.selection.phase3SelectedConsolidatedIds),
    phase2bSelectedKeys,
    consolidatedManifest,
    input.reporter,
  )

  input.deps.log.log('\nBehavior audit complete.')
}

export async function runBehaviorAudit(): Promise<void>
export async function runBehaviorAudit(deps: BehaviorAuditDeps): Promise<void>
export async function runBehaviorAudit(...args: readonly [] | readonly [BehaviorAuditDeps]): Promise<void> {
  const deps = args[0]
  let resolvedDeps: BehaviorAuditDeps
  if (deps === undefined) {
    resolvedDeps = defaultBehaviorAuditDeps
  } else {
    resolvedDeps = deps
  }
  resolvedDeps.requireOpenAiApiKey()
  resolvedDeps.log.log('Behavior Audit — discovering test files...\n')

  const { previousManifest, previousLastStartCommit, updatedManifest } = await resolvedDeps.prepareIncrementalRun()
  const { parsedFiles, previousConsolidatedManifest, selection } = await resolvedDeps.selectIncrementalRunWork({
    previousManifest,
    updatedManifest,
    previousLastStartCommit,
  })

  const progress = await resolvedDeps.loadOrCreateProgress(parsedFiles.length)
  const reporter = createRunReporter({
    createProgressReporter: resolvedDeps.createProgressReporter,
    configuredRenderer: PROGRESS_RENDERER,
    isTTY: resolvedDeps.stdout.isTTY,
    isTestEnvironment: resolvedDeps.isTestEnvironment,
    log: resolvedDeps.log,
  })

  try {
    await executeSelectedBehaviorAuditWork({
      deps: resolvedDeps,
      parsedFiles,
      updatedManifest,
      previousConsolidatedManifest,
      selection,
      progress,
      reporter,
    })
  } finally {
    reporter.end()
  }
}

if (import.meta.main) {
  await runBehaviorAudit().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
```

- [ ] **Step 2: Verify the file typechecks**

```bash
bun typecheck
```

Expected: no errors from `scripts/behavior-audit/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/index.ts
git commit -m "refactor: add scripts/behavior-audit/index.ts (new home for orchestrator)"
```

---

### Task 2: Create `scripts/behavior-audit/reset.ts`

**Files:**

- Create: `scripts/behavior-audit/reset.ts`

Copy of `scripts/behavior-audit-reset.ts` with `./behavior-audit/` import prefixes stripped to `./` and the usage message updated.

- [ ] **Step 1: Create the file**

```typescript
// scripts/behavior-audit/reset.ts
import { rm } from 'node:fs/promises'

import {
  AUDIT_BEHAVIOR_DIR,
  CLASSIFIED_DIR,
  CONSOLIDATED_DIR,
  CONSOLIDATED_MANIFEST_PATH,
  EVALUATED_DIR,
  STORIES_DIR,
} from './config.js'
import { loadProgress, saveProgress } from './progress-io.js'
import { resetPhase2AndPhase3, resetPhase3 } from './progress-resets.js'

export type ResetTarget = 'phase2' | 'phase3' | 'all'

export async function resetBehaviorAudit(target: ResetTarget): Promise<void> {
  if (target === 'all') {
    await rm(AUDIT_BEHAVIOR_DIR, { recursive: true, force: true })
    return
  }

  if (target === 'phase2') {
    await rm(CLASSIFIED_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_DIR, { recursive: true, force: true })
    await rm(EVALUATED_DIR, { recursive: true, force: true })
    await rm(STORIES_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_MANIFEST_PATH, { force: true })

    const progress = await loadProgress()
    if (progress !== null) {
      resetPhase2AndPhase3(progress)
      await saveProgress(progress)
    }
    return
  }

  await rm(EVALUATED_DIR, { recursive: true, force: true })
  await rm(STORIES_DIR, { recursive: true, force: true })

  const progress = await loadProgress()
  if (progress !== null) {
    resetPhase3(progress)
    await saveProgress(progress)
  }
}

const target = process.argv[2]

if (target === 'phase2' || target === 'phase3' || target === 'all') {
  await resetBehaviorAudit(target)
} else if (target !== undefined) {
  console.error('Usage: bun scripts/behavior-audit/reset.ts <phase2|phase3|all>')
  process.exit(1)
}
```

- [ ] **Step 2: Verify typechecks**

```bash
bun typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/reset.ts
git commit -m "refactor: add scripts/behavior-audit/reset.ts (new home for reset script)"
```

---

### Task 3: Move `behavior-audit-entrypoint.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/entrypoint.test.ts`
- Delete: `tests/scripts/behavior-audit-entrypoint.test.ts`

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit/entrypoint.test.ts
```

- [ ] **Step 2: Update imports in `tests/scripts/behavior-audit/entrypoint.test.ts`**

Replace imports at the top of the file. The current file has these imports:

Old (actual current content):

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit-entrypoint.js'
import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../scripts/behavior-audit/incremental.js'
import {
  resolveProgressRenderer,
  type BehaviorAuditProgressReporter,
} from '../../scripts/behavior-audit/progress-reporter.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile, type ParsedTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createIncrementalManifestFixture,
  createManifestTestEntry,
} from './behavior-audit-integration.helpers.js'
```

New:

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../../scripts/behavior-audit/incremental.js'
import {
  resolveProgressRenderer,
  type BehaviorAuditProgressReporter,
} from '../../../scripts/behavior-audit/progress-reporter.js'
import type { Progress } from '../../../scripts/behavior-audit/progress.js'
import { parseTestFile, type ParsedTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createIncrementalManifestFixture,
  createManifestTestEntry,
} from '../behavior-audit-integration.helpers.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/entrypoint.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file**

```bash
rm tests/scripts/behavior-audit-entrypoint.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add tests/scripts/behavior-audit/entrypoint.test.ts tests/scripts/behavior-audit-entrypoint.test.ts
git commit -m "refactor: move behavior-audit-entrypoint.test.ts into behavior-audit/"
```

---

### Task 4: Move `behavior-audit-interrupted-run.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/interrupted-run.test.ts`
- Delete: `tests/scripts/behavior-audit-interrupted-run.test.ts`

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-interrupted-run.test.ts tests/scripts/behavior-audit/interrupted-run.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit-interrupted-run.js'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, createIncrementalManifestFixture } from './behavior-audit-integration.helpers.js'
```

New:

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import type {
  ConsolidatedManifest,
  IncrementalManifest,
  IncrementalSelection,
} from '../../../scripts/behavior-audit/incremental.js'
import type { Progress } from '../../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, createIncrementalManifestFixture } from '../behavior-audit-integration.helpers.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/interrupted-run.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-interrupted-run.test.ts
git add tests/scripts/behavior-audit/interrupted-run.test.ts tests/scripts/behavior-audit-interrupted-run.test.ts
git commit -m "refactor: move behavior-audit-interrupted-run.test.ts into behavior-audit/"
```

---

### Task 5: Move `behavior-audit-incremental.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/incremental-integration.test.ts`
- Delete: `tests/scripts/behavior-audit-incremental.test.ts`

The file is renamed to `incremental-integration` to distinguish it from a potential unit test of `incremental.ts` and to reflect that it is an integration-level test combining the incremental module with the orchestrator.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit/incremental-integration.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import type * as IncrementalModule from '../../scripts/behavior-audit-incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit.ts'
import type * as ProgressMigrateModule from '../../scripts/behavior-audit/progress-migrate.js'
import { loadProgressModule } from './behavior-audit-integration.support.js'
```

New:

```typescript
import type * as IncrementalModule from '../../../scripts/behavior-audit/incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import type * as ProgressMigrateModule from '../../../scripts/behavior-audit/progress-migrate.js'
import { loadProgressModule } from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/incremental-integration.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-incremental.test.ts
git add tests/scripts/behavior-audit/incremental-integration.test.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "refactor: move behavior-audit-incremental.test.ts into behavior-audit/"
```

---

### Task 6: Move `behavior-audit-classify-agent.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/classify-agent.test.ts`
- Delete: `tests/scripts/behavior-audit-classify-agent.test.ts`

Note: `ClassifyAgentDeps` was imported from the barrel `behavior-audit-classify-agent.js`, which re-exported it from `classify-agent.js`. After removing the barrel, both types come from `classify-agent.js` directly; the two import lines can be merged.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-classify-agent.test.ts tests/scripts/behavior-audit/classify-agent.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import type { ClassifyAgentDeps } from '../../scripts/behavior-audit-classify-agent.js'
import type { ClassificationResult } from '../../scripts/behavior-audit/classify-agent.js'
import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import { cleanupTempDirs, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule } from './behavior-audit-integration.support.js'
```

New:

```typescript
import type { ClassifyAgentDeps, ClassificationResult } from '../../../scripts/behavior-audit/classify-agent.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import { cleanupTempDirs, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import { loadClassifyAgentModule } from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/classify-agent.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-classify-agent.test.ts
git add tests/scripts/behavior-audit/classify-agent.test.ts tests/scripts/behavior-audit-classify-agent.test.ts
git commit -m "refactor: move behavior-audit-classify-agent.test.ts into behavior-audit/"
```

---

### Task 7: Move `behavior-audit-storage.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/storage.test.ts`
- Delete: `tests/scripts/behavior-audit-storage.test.ts`

`createEmptyProgress` was imported via the `behavior-audit-storage.js` barrel which re-exports from `progress.js`; after removal it imports from `progress.js` directly.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-storage.test.ts tests/scripts/behavior-audit/storage.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import { createEmptyProgress } from '../../scripts/behavior-audit-storage.js'
import type { ConsolidatedManifest } from '../../scripts/behavior-audit/incremental.js'
import { mockAuditBehaviorConfig, mockReportsConfig } from './behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  importWithGuard,
  isResetModule,
  loadEvaluateReportingModule,
  loadClassifiedStoreModule,
  loadProgressModule,
  loadReportWriterModule,
  loadResetModule,
  type ResetModuleShape,
} from './behavior-audit-integration.support.js'
```

New:

```typescript
import { createEmptyProgress } from '../../../scripts/behavior-audit/progress.js'
import type { ConsolidatedManifest } from '../../../scripts/behavior-audit/incremental.js'
import { mockAuditBehaviorConfig, mockReportsConfig } from '../behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from '../behavior-audit-integration.runtime-helpers.js'
import {
  importWithGuard,
  isResetModule,
  loadEvaluateReportingModule,
  loadClassifiedStoreModule,
  loadProgressModule,
  loadReportWriterModule,
  loadResetModule,
  type ResetModuleShape,
} from '../behavior-audit-integration.support.js'
```

The rule: change `../../scripts/behavior-audit/` → `../../../scripts/behavior-audit/` and `../../scripts/behavior-audit-storage.js` → `../../../scripts/behavior-audit/progress.js` and `./behavior-audit-integration` → `../behavior-audit-integration`.

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/storage.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-storage.test.ts
git add tests/scripts/behavior-audit/storage.test.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "refactor: move behavior-audit-storage.test.ts into behavior-audit/"
```

---

### Task 8: Move `behavior-audit-phase1-keywords.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/phase1-keywords.test.ts`
- Delete: `tests/scripts/behavior-audit-phase1-keywords.test.ts`

`normalizeKeywordSlug` was exposed via the `behavior-audit-phase1-keywords.js` barrel which re-exports from `keyword-vocabulary.js`.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit/phase1-keywords.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import { normalizeKeywordSlug } from '../../scripts/behavior-audit-phase1-keywords.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from './behavior-audit-integration.runtime-helpers.js'
import {
  loadExtractModule,
  loadIncrementalModule,
  isExtractModule,
  isIncrementalModule,
  type ExtractModuleShape,
  type IncrementalModuleShape,
} from './behavior-audit-integration.support.js'
```

New:

```typescript
import { normalizeKeywordSlug } from '../../../scripts/behavior-audit/keyword-vocabulary.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'
import {
  restoreBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreOpenAiApiKey,
} from '../behavior-audit-integration.runtime-helpers.js'
import {
  loadExtractModule,
  loadIncrementalModule,
  isExtractModule,
  isIncrementalModule,
  type ExtractModuleShape,
  type IncrementalModuleShape,
} from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/phase1-keywords.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-phase1-keywords.test.ts
git add tests/scripts/behavior-audit/phase1-keywords.test.ts tests/scripts/behavior-audit-phase1-keywords.test.ts
git commit -m "refactor: move behavior-audit-phase1-keywords.test.ts into behavior-audit/"
```

---

### Task 9: Move `behavior-audit-phase1-selection.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/phase1-selection.test.ts`
- Delete: `tests/scripts/behavior-audit-phase1-selection.test.ts`

`createEmptyManifest` was exposed via the `behavior-audit-phase1-selection.js` barrel which re-exports from `incremental.js`.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-phase1-selection.test.ts tests/scripts/behavior-audit/phase1-selection.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import { createEmptyManifest as barrelCreateEmptyManifest } from '../../scripts/behavior-audit-phase1-selection.js'
import type { Phase1Deps } from '../../scripts/behavior-audit/extract.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import {
  createTextProgressReporter,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
  type ProgressOutcome,
} from '../../scripts/behavior-audit/progress-reporter.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
  writeWorkspaceFile,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import {
  createEmptyManifest,
  loadExtractModule,
  loadIncrementalModule,
  isExtractModule,
  isIncrementalModule,
  type ExtractModuleShape,
  type IncrementalModuleShape,
} from './behavior-audit-integration.support.js'
```

New:

```typescript
import { createEmptyManifest as barrelCreateEmptyManifest } from '../../../scripts/behavior-audit/incremental.js'
import type { Phase1Deps } from '../../../scripts/behavior-audit/extract.js'
import type { IncrementalManifest } from '../../../scripts/behavior-audit/incremental.js'
import {
  createTextProgressReporter,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
  type ProgressOutcome,
} from '../../../scripts/behavior-audit/progress-reporter.js'
import type { Progress } from '../../../scripts/behavior-audit/progress.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import {
  createEmptyProgressFixture,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
  writeWorkspaceFile,
} from '../behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import {
  createEmptyManifest,
  loadExtractModule,
  loadIncrementalModule,
  isExtractModule,
  isIncrementalModule,
  type ExtractModuleShape,
  type IncrementalModuleShape,
} from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/phase1-selection.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-phase1-selection.test.ts
git add tests/scripts/behavior-audit/phase1-selection.test.ts tests/scripts/behavior-audit-phase1-selection.test.ts
git commit -m "refactor: move behavior-audit-phase1-selection.test.ts into behavior-audit/"
```

---

### Task 10: Move `behavior-audit-phase1-write-failure.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/phase1-write-failure.test.ts`
- Delete: `tests/scripts/behavior-audit-phase1-write-failure.test.ts`

`_impl` was imported via the barrel `behavior-audit-phase1-write-failure.js` which re-exports from `extract.js`.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-phase1-write-failure.test.ts tests/scripts/behavior-audit/phase1-write-failure.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import * as _impl from '../../scripts/behavior-audit-phase1-write-failure.js'
import {
  createTextProgressReporter,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
} from '../../scripts/behavior-audit/progress-reporter.js'
import { parseTestFile } from '../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { isObject, loadExtractModule, loadIncrementalModule } from './behavior-audit-integration.support.js'
```

New:

```typescript
import * as _impl from '../../../scripts/behavior-audit/extract.js'
import {
  createTextProgressReporter,
  type BehaviorAuditProgressReporter,
  type ProgressEvent,
} from '../../../scripts/behavior-audit/progress-reporter.js'
import { parseTestFile } from '../../../scripts/behavior-audit/test-parser.js'
import { createEmptyProgressFixture, mockAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import { isObject, loadExtractModule, loadIncrementalModule } from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/phase1-write-failure.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-phase1-write-failure.test.ts
git add tests/scripts/behavior-audit/phase1-write-failure.test.ts tests/scripts/behavior-audit-phase1-write-failure.test.ts
git commit -m "refactor: move behavior-audit-phase1-write-failure.test.ts into behavior-audit/"
```

---

### Task 11: Move `behavior-audit-phase2a.test.ts`

**Files:**

- Create: `tests/scripts/behavior-audit/phase2a.test.ts`
- Delete: `tests/scripts/behavior-audit-phase2a.test.ts`

`Phase2aDeps` was exposed via the `behavior-audit-phase2a.js` barrel which re-exports from `classify.js`.

- [ ] **Step 1: Copy the file**

```bash
cp tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit/phase2a.test.ts
```

- [ ] **Step 2: Update imports**

Old (actual current content):

```typescript
import type { Phase2aDeps } from '../../scripts/behavior-audit-phase2a.js'
import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { ExtractedBehaviorRecord } from '../../scripts/behavior-audit/extracted-store.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import {
  createAuditBehaviorPaths,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import {
  getManifestEntry,
  importWithGuard,
  isClassifyModule,
  loadClassifiedStoreModule,
  loadIncrementalModule,
  loadProgressModule,
  readSavedManifest,
} from './behavior-audit-integration.support.js'
```

New:

```typescript
import type { Phase2aDeps } from '../../../scripts/behavior-audit/classify.js'
import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import type { ExtractedBehaviorRecord } from '../../../scripts/behavior-audit/extracted-store.js'
import type { IncrementalManifest } from '../../../scripts/behavior-audit/incremental.js'
import {
  createAuditBehaviorPaths,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
} from '../behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from '../behavior-audit-integration.runtime-helpers.js'
import {
  getManifestEntry,
  importWithGuard,
  isClassifyModule,
  loadClassifiedStoreModule,
  loadIncrementalModule,
  loadProgressModule,
  readSavedManifest,
} from '../behavior-audit-integration.support.js'
```

- [ ] **Step 3: Run the moved test**

```bash
bun test tests/scripts/behavior-audit/phase2a.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Delete the old file and commit**

```bash
rm tests/scripts/behavior-audit-phase2a.test.ts
git add tests/scripts/behavior-audit/phase2a.test.ts tests/scripts/behavior-audit-phase2a.test.ts
git commit -m "refactor: move behavior-audit-phase2a.test.ts into behavior-audit/"
```

---

### Task 12: Update two test files in place

**Files:**

- Modify: `tests/scripts/behavior-audit-phase3.test.ts` — 1 import path
- Modify: `tests/scripts/behavior-audit-integration.support.ts` — 1 import path

- [ ] **Step 1: Update `behavior-audit-phase3.test.ts` line 7**

Old:

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit.ts'
```

New:

```typescript
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../scripts/behavior-audit/index.js'
```

- [ ] **Step 2: Update `behavior-audit-integration.support.ts` line 1**

Old:

```typescript
import type * as ResetModule from '../../scripts/behavior-audit-reset.js'
```

New:

```typescript
import type * as ResetModule from '../../scripts/behavior-audit/reset.js'
```

- [ ] **Step 3: Run both tests**

```bash
bun test tests/scripts/behavior-audit-phase3.test.ts
```

Expected: all tests pass. (`behavior-audit-integration.support.ts` is a helper, not a test file itself — it is covered by the suites that import it.)

- [ ] **Step 4: Commit**

```bash
git add tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-integration.support.ts
git commit -m "refactor: update in-place test imports to new behavior-audit module paths"
```

---

### Task 13: Delete old source files

**Files:**

- Delete: `scripts/behavior-audit.ts`
- Delete: `scripts/behavior-audit-reset.ts`
- Delete: `scripts/behavior-audit-classify-agent.ts`
- Delete: `scripts/behavior-audit-entrypoint.ts`
- Delete: `scripts/behavior-audit-incremental.ts`
- Delete: `scripts/behavior-audit-interrupted-run.ts`
- Delete: `scripts/behavior-audit-phase1-keywords.ts`
- Delete: `scripts/behavior-audit-phase1-selection.ts`
- Delete: `scripts/behavior-audit-phase1-write-failure.ts`
- Delete: `scripts/behavior-audit-phase2a.ts`
- Delete: `scripts/behavior-audit-storage.ts`

- [ ] **Step 1: Delete all 11 files**

```bash
rm scripts/behavior-audit.ts \
   scripts/behavior-audit-reset.ts \
   scripts/behavior-audit-classify-agent.ts \
   scripts/behavior-audit-entrypoint.ts \
   scripts/behavior-audit-incremental.ts \
   scripts/behavior-audit-interrupted-run.ts \
   scripts/behavior-audit-phase1-keywords.ts \
   scripts/behavior-audit-phase1-selection.ts \
   scripts/behavior-audit-phase1-write-failure.ts \
   scripts/behavior-audit-phase2a.ts \
   scripts/behavior-audit-storage.ts
```

- [ ] **Step 2: Run full test suite to confirm nothing broke**

```bash
bun test tests/scripts/
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add -u scripts/
git commit -m "refactor: delete top-level behavior-audit barrel and source files (moved into behavior-audit/)"
```

---

### Task 14: Update `package.json` and `knip.jsonc`

**Files:**

- Modify: `package.json` — `audit:behavior` script
- Modify: `knip.jsonc` — entry patterns

- [ ] **Step 1: Update `package.json`**

Old:

```json
"audit:behavior": "bun scripts/behavior-audit.ts",
```

New:

```json
"audit:behavior": "bun scripts/behavior-audit/index.ts",
```

- [ ] **Step 2: Update `knip.jsonc` entry section**

Old entry lines:

```jsonc
"scripts/behavior-audit*.ts!",
"tests/scripts/behavior-audit*.ts!",
"tests/scripts/behavior-audit/**/*.ts!",
```

New (replace those three lines with):

```jsonc
"scripts/behavior-audit/reset.ts!",
"tests/scripts/behavior-audit*.ts!",
"tests/scripts/behavior-audit/**/*.ts!",
```

Explanation:

- `scripts/behavior-audit*.ts!` is removed — no top-level `scripts/behavior-audit*.ts` files exist anymore.
- `scripts/behavior-audit/index.ts` becomes an auto-detected entry via the `audit:behavior` package.json script (knip picks up script file references); no explicit entry needed.
- `scripts/behavior-audit/reset.ts` has no package.json script reference, so it needs an explicit entry to avoid being flagged as an unused file.
- The `tests/scripts/behavior-audit*.ts!` pattern still covers the remaining top-level test files (`behavior-audit-phase1b.test.ts`, `behavior-audit-phase2b.test.ts`, `behavior-audit-phase3.test.ts`, `behavior-audit-config.test.ts`, and the integration helpers).
- `tests/scripts/behavior-audit/**/*.ts!` already existed and covers the moved test files.
- The existing `"scripts/behavior-audit/**/*.ts!"` in the `project` section remains unchanged.

- [ ] **Step 3: Commit**

```bash
git add package.json knip.jsonc
git commit -m "refactor: update package.json and knip.jsonc for consolidated behavior-audit layout"
```

---

### Task 15: Final verification

- [ ] **Step 1: Run full test suite**

```bash
bun test tests/scripts/
```

Expected: all tests pass, no failures, no import errors.

- [ ] **Step 2: Run typecheck**

```bash
bun typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run knip**

```bash
bun knip
```

Expected: zero errors. In particular:

- No "unlisted files" for the new `scripts/behavior-audit/index.ts` or `reset.ts`
- No "unused exports" for the moved modules
- The deleted barrel files are no longer referenced anywhere

- [ ] **Step 4: Run lint**

```bash
bun lint
```

Expected: zero errors.

- [ ] **Step 5: Final commit (if any stragglers)**

If any minor fixes were needed in steps 1-4, commit them:

```bash
git add -A
git commit -m "fix: post-consolidation cleanup"
```

---

## Self-review

**Spec coverage:**

- All 11 top-level `scripts/behavior-audit*.ts` files are removed ✓
- 2 files with real logic moved to subdirectory ✓
- 9 test files moved to `tests/scripts/behavior-audit/` ✓
- 2 in-place test files updated ✓
- `package.json` updated ✓
- `knip.jsonc` updated ✓

**Placeholder scan:** No TBD, TODO, or vague steps — each step shows exact content or exact commands.

**Type consistency:** All renamed imports use the same identifiers (`runBehaviorAudit`, `BehaviorAuditDeps`, `Phase2aDeps`, etc.) as the originals.

**Verified against current codebase (2026-04-28):**

- Task 1: `index.ts` now mirrors current `behavior-audit.ts` (reporter-aware, delegates to `entrypoint-helpers.js`) instead of the stale inline-helper version
- Task 2: `reset.ts` imports from `./progress-resets.js` matching the current source (which re-exports via `progress.js` but the direct import is clearer)
- Tasks 3–11: All "Old" import blocks match actual current file content, including additional imports for `progress-reporter.js`, `config.js`, and full support-module named imports
- Task 14: `knip.jsonc` update accounts for the existing `scripts/behavior-audit/**/*.ts!` in the `project` section
