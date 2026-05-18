# Behavior Audit Phase 2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the behavior-audit pipeline so Phase 2 classifies extracted behaviors one-by-one before consolidating them into scoring-ready user stories, with all audit-behavior artifacts stored under `reports/audit-behavior/`.

**Architecture:** Keep Phase 1 extraction and Phase 3 scoring objectives intact, but split current Phase 2 into an explicit `phase2a` classification stage and a `phase2b` consolidation stage. Persist a new classified-behavior layer, extend manifests and progress tracking so reruns invalidate only changed behaviors and affected candidate features, and preserve internal behaviors as supporting references attached to user-facing stories.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK (`generateText`, `Output.object`), Zod v4, p-limit, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-04-21-behavior-audit-phase2-redesign-design.md`.

**Historical context only:** `docs/superpowers/plans/2026-04-20-behavior-audit-keyword-batching-implementation.md` is superseded for Phase 2 behavior grouping; do not execute it as the source of truth for this redesign.

---

## File Structure

### New files

- `scripts/behavior-audit/classified-store.ts` — owns the `ClassifiedBehavior` type, Zod schema, and JSON read/write helpers for `reports/audit-behavior/classified/*.json`.
- `scripts/behavior-audit/classify-agent.ts` — the structured Phase 2a LLM call that classifies a single extracted behavior into `user-facing`, `internal`, or `ambiguous` and proposes a candidate feature key.
- `scripts/behavior-audit/classify.ts` — orchestrates Phase 2a classification, persists classified behavior files, updates progress, and returns dirty candidate feature keys for Phase 2b.

### Modified files

- `scripts/behavior-audit/config.ts` — add `AUDIT_BEHAVIOR_DIR` and move all audit artifact paths under it.
- `scripts/behavior-audit/report-writer.ts` — extend `ConsolidatedBehavior` for `sourceBehaviorIds` and `supportingInternalRefs`, update report rebuild helpers, and keep behavior/consolidated/story writes aligned with the new root.
- `scripts/behavior-audit/progress.ts` — introduce explicit `phase2a` and `phase2b` progress sections, with helpers for classification and consolidation tracking.
- `scripts/behavior-audit/progress-migrate.ts` — migrate old progress files into the new shape by preserving Phase 1 data and resetting downstream stages.
- `scripts/behavior-audit/incremental.ts` — add per-test classification metadata, source behavior IDs in consolidated manifest entries, and new fingerprint helpers.
- `scripts/behavior-audit/incremental-selection.ts` — return `phase2aSelectedTestKeys`, `phase2bSelectedCandidateFeatureKeys`, and `phase3SelectedConsolidatedIds`.
- `scripts/behavior-audit/extract.ts` — keep Phase 1 behavior extraction, but write behavior markdown to the new root and preserve stable behavior IDs for Phase 2a.
- `scripts/behavior-audit/consolidate-agent.ts` — change the prompt contract from keyword-batch merging to candidate-feature consolidation with supporting internal references.
- `scripts/behavior-audit/consolidate.ts` — make current consolidation logic consume classified behaviors grouped by `candidateFeatureKey` instead of extracted behaviors grouped by keywords.
- `scripts/behavior-audit/evaluate.ts` — consume the revised consolidated shape and ignore internal-only candidate features.
- `scripts/behavior-audit.ts` — run `phase1 -> phase2a -> phase2b -> phase3`, save manifests, and propagate dirty candidate feature keys.
- `scripts/behavior-audit-reset.ts` — clear the new `classified/` subtree during Phase 2 resets while preserving `keyword-vocabulary.json` unless target is `all`.
- `tests/scripts/behavior-audit-integration.test.ts` — cover new root paths, Phase 2a classification, Phase 2b supporting references, and end-to-end flow.
- `tests/scripts/behavior-audit-incremental.test.ts` — cover manifest schema changes, incremental selection changes, and rerun stability.

---

## Decisions Locked Before Implementation

1. All audit-behavior artifacts live under `reports/audit-behavior/`.
2. `phase2a` classifies one extracted behavior at a time and is the source of truth for feature assignment.
3. `phase2b` consolidates by `candidateFeatureKey`, not by keyword buckets.
4. Internal behaviors are preserved and may appear as `supportingInternalRefs`; they do not become scored user stories.
5. `behaviorId` is derived from `testKey` and must stay stable across wording-only reruns.
6. `candidateFeatureKey` reuse is preferred over creating new keys when semantics match.
7. Incremental invalidation follows changed behaviors and changed candidate features, not batch membership.

---

### Task 1: Move audit artifacts under `reports/audit-behavior/`

**Files:**

- Modify: `scripts/behavior-audit/config.ts`
- Modify: `scripts/behavior-audit-reset.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Write the failing reset-path regression test**

Add this test to `tests/scripts/behavior-audit-integration.test.ts` near the other Phase 1/Phase 2 behavior-audit integration tests:

```typescript
test('resetBehaviorAudit phase2 clears audit-behavior phase2 outputs but preserves keyword vocabulary', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const consolidatedDir = path.join(auditRoot, 'consolidated')
  const classifiedDir = path.join(auditRoot, 'classified')
  const storiesDir = path.join(auditRoot, 'stories')
  const vocabularyPath = path.join(auditRoot, 'keyword-vocabulary.json')
  const progressPath = path.join(auditRoot, 'progress.json')

  mkdirSync(consolidatedDir, { recursive: true })
  mkdirSync(classifiedDir, { recursive: true })
  mkdirSync(storiesDir, { recursive: true })

  await Bun.write(path.join(consolidatedDir, 'group-routing.json'), '[]\n')
  await Bun.write(path.join(classifiedDir, 'tools.json'), '[]\n')
  await Bun.write(path.join(storiesDir, 'tools.md'), '# tools\n')
  await Bun.write(vocabularyPath, '[]\n')
  await Bun.write(
    progressPath,
    JSON.stringify({
      version: 3,
      startedAt: '2026-04-21T12:00:00.000Z',
      phase1: {
        status: 'done',
        completedTests: {},
        extractedBehaviors: {},
        failedTests: {},
        completedFiles: [],
        stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
      },
      phase2a: {
        status: 'done',
        completedBehaviors: {},
        classifiedBehaviors: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
      phase2b: {
        status: 'done',
        completedCandidateFeatures: {},
        consolidations: {},
        failedCandidateFeatures: {},
        stats: {
          candidateFeaturesTotal: 0,
          candidateFeaturesDone: 0,
          candidateFeaturesFailed: 0,
          behaviorsConsolidated: 0,
        },
      },
      phase3: {
        status: 'done',
        completedBehaviors: {},
        evaluations: {},
        failedBehaviors: {},
        stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
      },
    }) + '\n',
  )

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: classifiedDir,
    CONSOLIDATED_DIR: consolidatedDir,
    STORIES_DIR: storiesDir,
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: path.join(auditRoot, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: vocabularyPath,
  }))

  const mod = await import(`../../scripts/behavior-audit-reset.ts?test=${crypto.randomUUID()}`)
  await mod.resetBehaviorAudit('phase2')

  expect(await Bun.file(vocabularyPath).exists()).toBe(true)
  expect(await Bun.file(path.join(consolidatedDir, 'group-routing.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(classifiedDir, 'tools.json')).exists()).toBe(false)
  expect(await Bun.file(path.join(storiesDir, 'tools.md')).exists()).toBe(false)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "resetBehaviorAudit phase2 clears audit-behavior phase2 outputs but preserves keyword vocabulary"
```

Expected: FAIL because `config.ts` does not define `AUDIT_BEHAVIOR_DIR` or `CLASSIFIED_DIR`, and `behavior-audit-reset.ts` does not remove the new `classified/` subtree.

- [ ] **Step 3: Add the new artifact-root constants and reset behavior**

Update `scripts/behavior-audit/config.ts` to use a dedicated audit root:

```typescript
export const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
export const AUDIT_BEHAVIOR_DIR = resolve(REPORTS_DIR, 'audit-behavior')

export const BEHAVIORS_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'behaviors')
export const CLASSIFIED_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'classified')
export const CONSOLIDATED_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'consolidated')
export const STORIES_DIR = resolve(AUDIT_BEHAVIOR_DIR, 'stories')
export const PROGRESS_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'progress.json')
export const INCREMENTAL_MANIFEST_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'incremental-manifest.json')
export const CONSOLIDATED_MANIFEST_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'consolidated-manifest.json')
export const KEYWORD_VOCABULARY_PATH = resolve(AUDIT_BEHAVIOR_DIR, 'keyword-vocabulary.json')
```

Update `scripts/behavior-audit-reset.ts` so Phase 2 resets clear classified outputs but preserve the vocabulary file:

```typescript
import { rm } from 'node:fs/promises'

import {
  AUDIT_BEHAVIOR_DIR,
  CLASSIFIED_DIR,
  CONSOLIDATED_DIR,
  CONSOLIDATED_MANIFEST_PATH,
  STORIES_DIR,
} from './behavior-audit/config.js'
import { loadProgress, resetPhase2AndPhase3, resetPhase3, saveProgress } from './behavior-audit/progress.js'

export type ResetTarget = 'phase2' | 'phase3' | 'all'

export async function resetBehaviorAudit(target: ResetTarget): Promise<void> {
  if (target === 'all') {
    await rm(AUDIT_BEHAVIOR_DIR, { recursive: true, force: true })
    return
  }

  if (target === 'phase2') {
    await rm(CLASSIFIED_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_DIR, { recursive: true, force: true })
    await rm(STORIES_DIR, { recursive: true, force: true })
    await rm(CONSOLIDATED_MANIFEST_PATH, { force: true })

    const progress = await loadProgress()
    if (progress !== null) {
      resetPhase2AndPhase3(progress)
      await saveProgress(progress)
    }
    return
  }

  await rm(STORIES_DIR, { recursive: true, force: true })

  const progress = await loadProgress()
  if (progress !== null) {
    resetPhase3(progress)
    await saveProgress(progress)
  }
}
```

- [ ] **Step 4: Run the focused test again and then typecheck**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "resetBehaviorAudit phase2 clears audit-behavior phase2 outputs but preserves keyword vocabulary"
bun typecheck
```

Expected: the focused test passes; `bun typecheck` may still fail later on missing `CLASSIFIED_DIR` imports in untouched files, but there should be no syntax errors in the modified files.

- [ ] **Step 5: Commit the artifact-root move scaffold**

```bash
git add scripts/behavior-audit/config.ts scripts/behavior-audit-reset.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): move audit artifacts under dedicated root"
```

---

### Task 2: Add classified-behavior storage and consolidated supporting-reference shape

**Files:**

- Create: `scripts/behavior-audit/classified-store.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing classified-store round-trip test**

Add this test to `tests/scripts/behavior-audit-integration.test.ts`:

```typescript
test('classified-store round-trips sorted classified behaviors under audit root', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    PROJECT_ROOT: root,
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: path.join(auditRoot, 'classified'),
    CONSOLIDATED_DIR: path.join(auditRoot, 'consolidated'),
    STORIES_DIR: path.join(auditRoot, 'stories'),
    PROGRESS_PATH: path.join(auditRoot, 'progress.json'),
    INCREMENTAL_MANIFEST_PATH: path.join(auditRoot, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(auditRoot, 'keyword-vocabulary.json'),
  }))

  const store = await import(`../../scripts/behavior-audit/classified-store.js?test=${crypto.randomUUID()}`)
  await store.writeClassifiedFile('tools', [
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > beta',
      testKey: 'tests/tools/sample.test.ts::suite > beta',
      domain: 'tools',
      behavior: 'When beta runs, the bot saves a task.',
      context: 'Calls create_task.',
      keywords: ['task-create'],
      visibility: 'user-facing',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'beta',
    },
    {
      behaviorId: 'tests/tools/sample.test.ts::suite > alpha',
      testKey: 'tests/tools/sample.test.ts::suite > alpha',
      domain: 'tools',
      behavior: 'When alpha runs, the bot validates input.',
      context: 'Runs guard checks.',
      keywords: ['task-creation'],
      visibility: 'internal',
      candidateFeatureKey: 'task-creation',
      candidateFeatureLabel: 'Task creation',
      supportingBehaviorRefs: [],
      relatedBehaviorHints: [],
      classificationNotes: 'alpha',
    },
  ])

  const loaded = await store.readClassifiedFile('tools')
  expect(loaded?.map((item) => item.behaviorId)).toEqual([
    'tests/tools/sample.test.ts::suite > alpha',
    'tests/tools/sample.test.ts::suite > beta',
  ])
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "classified-store round-trips sorted classified behaviors under audit root"
```

Expected: FAIL because `classified-store.ts` does not exist.

- [ ] **Step 3: Create `classified-store.ts` and extend `ConsolidatedBehavior`**

Create `scripts/behavior-audit/classified-store.ts`:

```typescript
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { CLASSIFIED_DIR } from './config.js'

export interface ClassifiedBehavior {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly candidateFeatureKey: string | null
  readonly candidateFeatureLabel: string | null
  readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]
  readonly classificationNotes: string
}

const RelatedBehaviorHintSchema = z.object({
  testKey: z.string(),
  relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
  reason: z.string(),
})

const SupportingBehaviorRefSchema = z.object({
  behaviorId: z.string(),
  reason: z.string(),
})

const ClassifiedBehaviorSchema = z.object({
  behaviorId: z.string(),
  testKey: z.string(),
  domain: z.string(),
  behavior: z.string(),
  context: z.string(),
  keywords: z.array(z.string()).readonly(),
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  candidateFeatureKey: z.string().nullable(),
  candidateFeatureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(SupportingBehaviorRefSchema).readonly(),
  relatedBehaviorHints: z.array(RelatedBehaviorHintSchema).readonly(),
  classificationNotes: z.string(),
})

const ClassifiedBehaviorArraySchema = z.array(ClassifiedBehaviorSchema).readonly()

export async function writeClassifiedFile(domain: string, behaviors: readonly ClassifiedBehavior[]): Promise<void> {
  const outPath = join(CLASSIFIED_DIR, `${domain}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...behaviors].toSorted((a, b) => a.behaviorId.localeCompare(b.behaviorId))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readClassifiedFile(domain: string): Promise<readonly ClassifiedBehavior[] | null> {
  const filePath = join(CLASSIFIED_DIR, `${domain}.json`)
  try {
    const raw: unknown = JSON.parse(await Bun.file(filePath).text())
    return ClassifiedBehaviorArraySchema.parse(raw)
  } catch {
    return null
  }
}
```

Extend `scripts/behavior-audit/report-writer.ts` so consolidated outputs can carry supporting references:

```typescript
export interface ConsolidatedBehavior {
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

const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
  sourceBehaviorIds: z.array(z.string()),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() })),
})
```

- [ ] **Step 4: Run the focused test and a writer-type smoke test**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "classified-store round-trips sorted classified behaviors under audit root"
bun typecheck
```

Expected: the focused test passes; `bun typecheck` may still fail in `progress.ts`, `consolidate.ts`, and `evaluate.ts` until their types are updated in later tasks.

- [ ] **Step 5: Commit the classified-store scaffold**

```bash
git add scripts/behavior-audit/classified-store.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): add classified behavior storage"
```

---

### Task 3: Introduce explicit `phase2a` and `phase2b` progress with migration

**Files:**

- Modify: `scripts/behavior-audit/progress.ts`
- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Add the failing progress-migration test**

Add this test to `tests/scripts/behavior-audit-incremental.test.ts`:

```typescript
test('validateOrMigrateProgress upgrades version 2 progress into version 3 with reset phase2a and phase2b', async () => {
  const mod = await import(`../../scripts/behavior-audit/progress-migrate.js?test=${crypto.randomUUID()}`)

  const migrated = mod.validateOrMigrateProgress({
    version: 2,
    startedAt: '2026-04-21T12:00:00.000Z',
    phase1: {
      status: 'done',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal: 1, filesDone: 1, testsExtracted: 1, testsFailed: 0 },
    },
    phase2: {
      status: 'done',
      completedBatches: {},
      consolidations: {},
      failedBatches: {},
      stats: { batchesTotal: 0, batchesDone: 0, batchesFailed: 0, behaviorsConsolidated: 0 },
    },
    phase3: {
      status: 'done',
      completedBehaviors: {},
      evaluations: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
  })

  expect(migrated?.version).toBe(3)
  expect(migrated?.phase1.status).toBe('done')
  expect(migrated?.phase2a.status).toBe('not-started')
  expect(migrated?.phase2b.status).toBe('not-started')
  expect(migrated?.phase3.status).toBe('not-started')
})
```

- [ ] **Step 2: Run the focused incremental test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "validateOrMigrateProgress upgrades version 2 progress into version 3 with reset phase2a and phase2b"
```

Expected: FAIL because `Progress` is still version 2 and has no `phase2a` or `phase2b`.

- [ ] **Step 3: Update progress and migration code**

Replace the progress shape in `scripts/behavior-audit/progress.ts` with explicit `phase2a` and `phase2b` sections:

```typescript
export interface Phase2aProgress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  classifiedBehaviors: Record<string, import('./classified-store.js').ClassifiedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Phase2bProgress {
  status: PhaseStatus
  completedCandidateFeatures: Record<string, 'done'>
  consolidations: Record<string, readonly ConsolidatedBehavior[]>
  failedCandidateFeatures: Record<string, FailedEntry>
  stats: {
    candidateFeaturesTotal: number
    candidateFeaturesDone: number
    candidateFeaturesFailed: number
    behaviorsConsolidated: number
  }
}

export interface Progress {
  version: 3
  startedAt: string
  phase1: Phase1Progress
  phase2a: Phase2aProgress
  phase2b: Phase2bProgress
  phase3: Phase3Progress
}
```

Add helpers used later by the runner and reset flow:

```typescript
export function markClassificationDone(
  progress: Progress,
  behaviorId: string,
  classified: import('./classified-store.js').ClassifiedBehavior,
): void {
  if (progress.phase2a.completedBehaviors[behaviorId] === 'done') {
    progress.phase2a.classifiedBehaviors[behaviorId] = classified
    return
  }
  progress.phase2a.completedBehaviors[behaviorId] = 'done'
  progress.phase2a.classifiedBehaviors[behaviorId] = classified
  progress.phase2a.stats.behaviorsDone++
}

export function markCandidateFeatureDone(
  progress: Progress,
  candidateFeatureKey: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  if (progress.phase2b.completedCandidateFeatures[candidateFeatureKey] === 'done') return
  progress.phase2b.completedCandidateFeatures[candidateFeatureKey] = 'done'
  progress.phase2b.consolidations[candidateFeatureKey] = consolidations
  progress.phase2b.stats.candidateFeaturesDone++
  progress.phase2b.stats.behaviorsConsolidated += consolidations.length
}

export function resetPhase2AndPhase3(progress: Progress): void {
  progress.phase2a = emptyPhase2a()
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}

export function resetPhase2bAndPhase3(progress: Progress): void {
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}
```

Update `scripts/behavior-audit/progress-migrate.ts` so version 2 files are upgraded to version 3 by preserving Phase 1 and resetting downstream stages:

```typescript
const ProgressV3Schema = z.object({
  version: z.literal(3),
  startedAt: z.string(),
  phase1: Phase1ProgressSchema,
  phase2a: Phase2aProgressSchema,
  phase2b: Phase2bProgressSchema,
  phase3: Phase3ProgressSchema,
})

function migrateV2toV3(raw: unknown): Progress {
  const parsed = ProgressV2Schema.parse(raw)
  return ProgressV3Schema.parse({
    version: 3,
    startedAt: parsed.startedAt,
    phase1: parsed.phase1,
    phase2a: emptyPhase2a(),
    phase2b: emptyPhase2b(),
    phase3: emptyPhase3(),
  })
}

export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v3Result = ProgressV3Schema.safeParse(raw)
  if (v3Result.success) return ProgressV3Schema.parse(v3Result.data)

  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return migrateV2toV3(v2Result.data)

  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }
  return null
}
```

- [ ] **Step 4: Run the focused migration test and the existing incremental suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "validateOrMigrateProgress upgrades version 2 progress into version 3 with reset phase2a and phase2b"
bun test ./tests/scripts/behavior-audit-incremental.test.ts
```

Expected: the new migration test passes; the broader suite will still fail in entrypoint tests until `scripts/behavior-audit.ts` is updated later, but the migration test must be green.

- [ ] **Step 5: Commit the progress schema upgrade**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/progress-migrate.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(audit): add explicit phase2a and phase2b progress"
```

---

### Task 4: Implement Phase 2a classification agent and runner

**Files:**

- Create: `scripts/behavior-audit/classify-agent.ts`
- Create: `scripts/behavior-audit/classify.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing Phase 2a integration test**

Add this test to `tests/scripts/behavior-audit-integration.test.ts`:

```typescript
test('runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const progressPath = path.join(auditRoot, 'progress.json')
  const manifestPath = path.join(auditRoot, 'incremental-manifest.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: path.join(auditRoot, 'classified'),
    CONSOLIDATED_DIR: path.join(auditRoot, 'consolidated'),
    STORIES_DIR: path.join(auditRoot, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: manifestPath,
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(auditRoot, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  void mock.module('../../scripts/behavior-audit/classify-agent.js', () => ({
    classifyBehaviorWithRetry: (): Promise<
      import('../../scripts/behavior-audit/classify-agent.js').ClassificationResult
    > =>
      Promise.resolve({
        visibility: 'user-facing',
        candidateFeatureKey: 'task-creation',
        candidateFeatureLabel: 'Task creation',
        supportingBehaviorRefs: [],
        relatedBehaviorHints: [],
        classificationNotes: 'Matches task creation flow.',
      }),
  }))

  const classify = await import(`../../scripts/behavior-audit/classify.js?test=${crypto.randomUUID()}`)
  const progressModule = await import(`../../scripts/behavior-audit/progress.js?test=${crypto.randomUUID()}`)
  const incremental = await import(`../../scripts/behavior-audit/incremental.js?test=${crypto.randomUUID()}`)

  const progress = progressModule.createEmptyProgress(1)
  progress.phase1.extractedBehaviors['tests/tools/sample.test.ts::suite > case'] = {
    testName: 'case',
    fullPath: 'suite > case',
    behavior: 'When the user creates a task, the bot saves it.',
    context: 'Calls create_task and returns the new task.',
    keywords: ['task-create'],
  }

  const dirty = await classify.runPhase2a({
    progress,
    selectedTestKeys: new Set(['tests/tools/sample.test.ts::suite > case']),
    manifest: incremental.createEmptyManifest(),
  })

  expect([...dirty]).toEqual(['task-creation'])
  expect(progress.phase2a.classifiedBehaviors['tests/tools/sample.test.ts::suite > case']?.candidateFeatureKey).toBe(
    'task-creation',
  )
  expect(await Bun.file(path.join(auditRoot, 'classified', 'tools.json')).exists()).toBe(true)
})
```

- [ ] **Step 2: Run the focused Phase 2a test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys"
```

Expected: FAIL because `classify.ts` and `classify-agent.ts` do not exist.

- [ ] **Step 3: Create the classification agent and runner**

Create `scripts/behavior-audit/classify-agent.ts`:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'

const ClassificationResultSchema = z.object({
  visibility: z.enum(['user-facing', 'internal', 'ambiguous']),
  candidateFeatureKey: z.string().nullable(),
  candidateFeatureLabel: z.string().nullable(),
  supportingBehaviorRefs: z.array(z.object({ behaviorId: z.string(), reason: z.string() })),
  relatedBehaviorHints: z.array(
    z.object({
      testKey: z.string(),
      relation: z.enum(['same-feature', 'supporting-detail', 'possibly-related']),
      reason: z.string(),
    }),
  ),
  classificationNotes: z.string(),
})

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>

function getEnvOrFallback(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({
  name: 'behavior-audit-classify',
  apiKey,
  baseURL: BASE_URL,
  supportsStructuredOutputs: true,
})
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are classifying one extracted behavior from a test suite into a stable feature-assignment record.

Return structured output with:
- visibility: user-facing, internal, or ambiguous
- candidateFeatureKey: canonical stable feature key when applicable
- candidateFeatureLabel: short human-readable feature label when applicable
- supportingBehaviorRefs: internal supporting behavior references by behaviorId
- relatedBehaviorHints: nearby behaviors that are same-feature, supporting-detail, or possibly-related
- classificationNotes: concise reasoning for maintainers

Prefer reusing an existing candidateFeatureKey when semantically compatible. Preserve ambiguity instead of forcing a merge.`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function classifySingle(prompt: string, attempt: number): Promise<ClassificationResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      output: Output.object({ schema: ClassificationResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    return result.output
  } catch {
    return null
  }
}

export async function classifyBehaviorWithRetry(
  prompt: string,
  attemptOffset: number,
): Promise<ClassificationResult | null> {
  for (let attempt = attemptOffset; attempt < MAX_RETRIES; attempt++) {
    if (attempt > attemptOffset) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
      await sleep(backoff)
    }
    const result = await classifySingle(prompt, attempt)
    if (result !== null) return result
  }
  return null
}
```

Create `scripts/behavior-audit/classify.ts`:

```typescript
import pLimit from 'p-limit'

import { classifyBehaviorWithRetry } from './classify-agent.js'
import type { ClassifiedBehavior } from './classified-store.js'
import { readClassifiedFile, writeClassifiedFile } from './classified-store.js'
import { MAX_RETRIES } from './config.js'
import type { IncrementalManifest } from './incremental.js'
import { getDomain } from './domain-map.js'
import type { Progress } from './progress.js'
import {
  getFailedClassificationAttempts,
  markClassificationDone,
  markClassificationFailed,
  saveProgress,
} from './progress.js'

interface Phase2aRunInput {
  readonly progress: Progress
  readonly selectedTestKeys: ReadonlySet<string>
  readonly manifest: IncrementalManifest
}

function buildBehaviorId(testKey: string): string {
  return testKey
}

function buildPrompt(testKey: string, behavior: import('./report-writer.js').ExtractedBehavior): string {
  const testFile = testKey.split('::')[0] ?? ''
  return [
    `Test key: ${testKey}`,
    `Domain: ${getDomain(testFile)}`,
    `Behavior: ${behavior.behavior}`,
    `Context: ${behavior.context}`,
    `Keywords: ${behavior.keywords.join(', ')}`,
  ].join('\n')
}

export async function runPhase2a({ progress, selectedTestKeys }: Phase2aRunInput): Promise<ReadonlySet<string>> {
  progress.phase2a.status = 'in-progress'
  const dirtyCandidateFeatureKeys = new Set<string>()
  const byDomain = new Map<string, ClassifiedBehavior[]>()
  const limit = pLimit(1)

  await Promise.all(
    Object.entries(progress.phase1.extractedBehaviors)
      .filter(([testKey]) => selectedTestKeys.size === 0 || selectedTestKeys.has(testKey))
      .map(([testKey, behavior]) =>
        limit(async () => {
          const behaviorId = buildBehaviorId(testKey)
          if (getFailedClassificationAttempts(progress, behaviorId) >= MAX_RETRIES) return
          const result = await classifyBehaviorWithRetry(buildPrompt(testKey, behavior), 0)
          if (result === null) {
            markClassificationFailed(progress, behaviorId, 'classification failed after retries')
            return
          }
          if (result.candidateFeatureKey !== null) dirtyCandidateFeatureKeys.add(result.candidateFeatureKey)
          const domain = getDomain(testKey.split('::')[0] ?? '')
          const classified: ClassifiedBehavior = {
            behaviorId,
            testKey,
            domain,
            behavior: behavior.behavior,
            context: behavior.context,
            keywords: behavior.keywords,
            visibility: result.visibility,
            candidateFeatureKey: result.candidateFeatureKey,
            candidateFeatureLabel: result.candidateFeatureLabel,
            supportingBehaviorRefs: result.supportingBehaviorRefs,
            relatedBehaviorHints: result.relatedBehaviorHints,
            classificationNotes: result.classificationNotes,
          }
          markClassificationDone(progress, behaviorId, classified)
          byDomain.set(domain, [...(byDomain.get(domain) ?? []), classified])
        }),
      ),
  )

  await Promise.all(
    [...byDomain.entries()].map(async ([domain, fresh]) => {
      const existing = (await readClassifiedFile(domain)) ?? []
      const untouched = existing.filter((item) => !fresh.some((next) => next.behaviorId === item.behaviorId))
      await writeClassifiedFile(domain, [...untouched, ...fresh])
    }),
  )

  progress.phase2a.status = 'done'
  await saveProgress(progress)
  return dirtyCandidateFeatureKeys
}
```

- [ ] **Step 4: Run the focused Phase 2a test and then the full integration suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2a classifies selected extracted behaviors and returns dirty candidate feature keys"
bun test ./tests/scripts/behavior-audit-integration.test.ts
```

Expected: the new Phase 2a test passes; the broader suite may still fail in Phase 2b or entrypoint tests until later tasks, but no failures should come from missing Phase 2a modules.

- [ ] **Step 5: Commit Phase 2a classification**

```bash
git add scripts/behavior-audit/classify-agent.ts scripts/behavior-audit/classify.ts scripts/behavior-audit/progress.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): add phase2a behavior classification"
```

---

### Task 5: Extend manifests and incremental selection for classification-driven invalidation

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Modify: `scripts/behavior-audit/incremental-selection.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`

- [ ] **Step 1: Add the failing incremental-selection test for candidate feature invalidation**

Add this test to `tests/scripts/behavior-audit-incremental.test.ts`:

```typescript
test('selectIncrementalWork selects affected candidate features when phase2a metadata changed', async () => {
  const incremental = await loadIncrementalModule()

  const selection = incremental.selectIncrementalWork({
    changedFiles: ['src/tools/create-task.ts'],
    previousManifest: {
      version: 2,
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
          phase2aFingerprint: 'fp2a',
          phase2Fingerprint: 'fp2b',
          behaviorId: 'tests/tools/create-task.test.ts::suite > case',
          candidateFeatureKey: 'task-creation',
          extractedBehaviorPath: 'reports/audit-behavior/behaviors/tools/create-task.test.behaviors.md',
          domain: 'tools',
          lastPhase1CompletedAt: 'x',
          lastPhase2aCompletedAt: 'y',
          lastPhase2CompletedAt: 'z',
        },
      },
    },
    currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
    discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
    previousConsolidatedManifest: {
      version: 1,
      entries: {
        'task-creation::task-creation': {
          consolidatedId: 'task-creation::task-creation',
          domain: 'tools',
          featureName: 'Task creation',
          sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
          sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          candidateFeatureKey: 'task-creation',
          keywords: ['task-create'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'fp',
          lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
        },
      },
    },
  })

  expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
  expect(selection.phase2bSelectedCandidateFeatureKeys).toEqual(['task-creation'])
  expect(selection.phase3SelectedConsolidatedIds).toEqual(['task-creation::task-creation'])
})
```

- [ ] **Step 2: Run the focused incremental-selection test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "selectIncrementalWork selects affected candidate features when phase2a metadata changed"
```

Expected: FAIL because `IncrementalSelection` and `ManifestTestEntry` do not contain the new fields yet.

- [ ] **Step 3: Add manifest fields and selection logic**

Update `scripts/behavior-audit/incremental.ts`:

```typescript
export interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2aFingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly behaviorId: string | null
  readonly candidateFeatureKey: string | null
  readonly extractedBehaviorPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2aCompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}

export interface IncrementalSelection {
  readonly phase1SelectedTestKeys: readonly string[]
  readonly phase2aSelectedTestKeys: readonly string[]
  readonly phase2bSelectedCandidateFeatureKeys: readonly string[]
  readonly phase3SelectedConsolidatedIds: readonly string[]
  readonly reportRebuildOnly: boolean
}

export interface ConsolidatedManifestEntry {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalBehaviorIds: readonly string[]
  readonly isUserFacing: boolean
  readonly candidateFeatureKey: string | null
  readonly keywords: readonly string[]
  readonly sourceDomains: readonly string[]
  readonly phase2Fingerprint: string | null
  readonly lastConsolidatedAt: string | null
}
```

Add a dedicated classification fingerprint helper:

```typescript
export function buildPhase2aFingerprint(input: {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly phaseVersion: string
}): string {
  return sha256Json(input)
}
```

Update `scripts/behavior-audit/incremental-selection.ts` so changed tests map to changed candidate features and then to changed consolidated IDs:

```typescript
function computePhase2bKeys(phase2aKeys: readonly string[], manifest: IncrementalManifest): readonly string[] {
  return toSortedUnique(
    phase2aKeys
      .map((testKey) => manifest.tests[testKey]?.candidateFeatureKey ?? null)
      .filter((value): value is string => value !== null),
  )
}

function computePhase3IdsFromCandidateFeatures(
  candidateFeatureKeys: readonly string[],
  manifest: ConsolidatedManifest | null,
): readonly string[] {
  if (manifest === null) return []
  const selected = new Set(candidateFeatureKeys)
  return Object.values(manifest.entries)
    .filter((entry) => entry.candidateFeatureKey !== null && selected.has(entry.candidateFeatureKey))
    .map((entry) => entry.consolidatedId)
    .toSorted()
}

export function selectIncrementalWork(input: SelectIncrementalWorkInput): IncrementalSelection {
  const discoveredSet = new Set(input.discoveredTestKeys)
  const changedFilesSet = new Set(input.changedFiles)
  const entries = Object.entries(input.previousManifest.tests).filter(([key]) => discoveredSet.has(key))
  const phase1Keys = toSortedUnique(
    entries.filter(([, entry]) => entry.dependencyPaths.some((path) => changedFilesSet.has(path))).map(([key]) => key),
  )
  const phase2aKeys = phase1Keys
  const phase2bKeys = computePhase2bKeys(phase2aKeys, input.previousManifest)
  const phase3Ids = computePhase3IdsFromCandidateFeatures(phase2bKeys, input.previousConsolidatedManifest)

  return {
    phase1SelectedTestKeys: phase1Keys,
    phase2aSelectedTestKeys: phase2aKeys,
    phase2bSelectedCandidateFeatureKeys: phase2bKeys,
    phase3SelectedConsolidatedIds: phase3Ids,
    reportRebuildOnly:
      phase1Keys.length === 0 && phase2aKeys.length === 0 && phase2bKeys.length === 0 && phase3Ids.length === 0,
  }
}
```

- [ ] **Step 4: Run the focused test and the full incremental suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "selectIncrementalWork selects affected candidate features when phase2a metadata changed"
bun test ./tests/scripts/behavior-audit-incremental.test.ts
```

Expected: the new selection test passes; the broader suite may still fail in startup wiring tests until `scripts/behavior-audit.ts` is updated in Task 7.

- [ ] **Step 5: Commit manifest and selection changes**

```bash
git add scripts/behavior-audit/incremental.ts scripts/behavior-audit/incremental-selection.ts tests/scripts/behavior-audit-incremental.test.ts
git commit -m "feat(audit): add classification-driven incremental selection"
```

---

### Task 6: Refactor Phase 2b consolidation and Phase 3 scoring to consume classified behaviors

**Files:**

- Modify: `scripts/behavior-audit/consolidate-agent.ts`
- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Test: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing consolidation-with-supporting-refs test**

Add this test to `tests/scripts/behavior-audit-integration.test.ts`:

```typescript
test('runPhase2b consolidates user-facing candidate features and preserves supporting internal refs', async () => {
  const root = makeTempDir()
  const auditRoot = path.join(root, 'reports', 'audit-behavior')
  const progressPath = path.join(auditRoot, 'progress.json')

  void mock.module('../../scripts/behavior-audit/config.js', () => ({
    MODEL: 'qwen3-30b-a3b',
    BASE_URL: 'http://localhost:1234/v1',
    PROJECT_ROOT: root,
    REPORTS_DIR: path.join(root, 'reports'),
    AUDIT_BEHAVIOR_DIR: auditRoot,
    BEHAVIORS_DIR: path.join(auditRoot, 'behaviors'),
    CLASSIFIED_DIR: path.join(auditRoot, 'classified'),
    CONSOLIDATED_DIR: path.join(auditRoot, 'consolidated'),
    STORIES_DIR: path.join(auditRoot, 'stories'),
    PROGRESS_PATH: progressPath,
    INCREMENTAL_MANIFEST_PATH: path.join(auditRoot, 'incremental-manifest.json'),
    CONSOLIDATED_MANIFEST_PATH: path.join(auditRoot, 'consolidated-manifest.json'),
    KEYWORD_VOCABULARY_PATH: path.join(auditRoot, 'keyword-vocabulary.json'),
    PHASE1_TIMEOUT_MS: 1_200_000,
    PHASE2_TIMEOUT_MS: 300_000,
    PHASE3_TIMEOUT_MS: 600_000,
    MAX_RETRIES: 3,
    RETRY_BACKOFF_MS: [0, 0, 0] as const,
    MAX_STEPS: 20,
    EXCLUDED_PREFIXES: [] as const,
  }))

  void mock.module('../../scripts/behavior-audit/consolidate-agent.js', () => ({
    consolidateWithRetry: (): Promise<
      readonly {
        readonly id: string
        readonly item: {
          readonly featureName: string
          readonly isUserFacing: boolean
          readonly behavior: string
          readonly userStory: string | null
          readonly context: string
          readonly sourceBehaviorIds: readonly string[]
          readonly sourceTestKeys: readonly string[]
          readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
        }
      }[]
    > =>
      Promise.resolve([
        {
          id: 'task-creation::task-creation',
          item: {
            featureName: 'Task creation',
            isUserFacing: true,
            behavior: 'When a user asks to create a task, the bot saves it and confirms success.',
            userStory: 'As a user, I want to create a task in chat so I can track work quickly.',
            context: 'Calls create_task and formats the confirmation.',
            sourceBehaviorIds: [
              'tests/tools/create-task.test.ts::suite > create task',
              'tests/tools/create-task.test.ts::suite > validate input',
            ],
            sourceTestKeys: [
              'tests/tools/create-task.test.ts::suite > create task',
              'tests/tools/create-task.test.ts::suite > validate input',
            ],
            supportingInternalRefs: [
              {
                behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
                summary: 'Validation guards prevent malformed task creation inputs.',
              },
            ],
          },
        },
      ]),
  }))

  const consolidate = await import(`../../scripts/behavior-audit/consolidate.js?test=${crypto.randomUUID()}`)
  const progressModule = await import(`../../scripts/behavior-audit/progress.js?test=${crypto.randomUUID()}`)
  const incremental = await import(`../../scripts/behavior-audit/incremental.js?test=${crypto.randomUUID()}`)

  const progress = progressModule.createEmptyProgress(1)
  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > create task'] = {
    behaviorId: 'tests/tools/create-task.test.ts::suite > create task',
    testKey: 'tests/tools/create-task.test.ts::suite > create task',
    domain: 'tools',
    behavior: 'When a user asks to create a task, the bot saves it.',
    context: 'Calls create_task.',
    keywords: ['task-create'],
    visibility: 'user-facing',
    candidateFeatureKey: 'task-creation',
    candidateFeatureLabel: 'Task creation',
    supportingBehaviorRefs: [],
    relatedBehaviorHints: [],
    classificationNotes: 'User-facing task creation.',
  }
  progress.phase2a.classifiedBehaviors['tests/tools/create-task.test.ts::suite > validate input'] = {
    behaviorId: 'tests/tools/create-task.test.ts::suite > validate input',
    testKey: 'tests/tools/create-task.test.ts::suite > validate input',
    domain: 'tools',
    behavior: 'When input is malformed, the bot blocks task creation.',
    context: 'Runs validation guards.',
    keywords: ['task-create'],
    visibility: 'internal',
    candidateFeatureKey: 'task-creation',
    candidateFeatureLabel: 'Task creation',
    supportingBehaviorRefs: [],
    relatedBehaviorHints: [],
    classificationNotes: 'Supporting validation behavior.',
  }

  const manifest = await consolidate.runPhase2b(
    progress,
    incremental.createEmptyConsolidatedManifest(),
    'phase2-v2',
    new Set(['task-creation']),
  )

  const entry = manifest.entries['task-creation::task-creation']
  expect(entry?.candidateFeatureKey).toBe('task-creation')
  expect(entry?.sourceBehaviorIds).toEqual([
    'tests/tools/create-task.test.ts::suite > create task',
    'tests/tools/create-task.test.ts::suite > validate input',
  ])

  const fileText = await Bun.file(path.join(auditRoot, 'consolidated', 'task-creation.json')).text()
  expect(fileText).toContain('supportingInternalRefs')
})
```

- [ ] **Step 2: Run the focused consolidation test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2b consolidates user-facing candidate features and preserves supporting internal refs"
```

Expected: FAIL because `consolidate.ts` still expects extracted behaviors grouped by keyword and `ConsolidatedBehavior` does not have the new fields.

- [ ] **Step 3: Refactor Phase 2b and Phase 3 around classified behaviors**

Update `scripts/behavior-audit/consolidate-agent.ts` so the result schema carries behavior IDs and supporting refs:

```typescript
const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceBehaviorIds: z.array(z.string()),
  sourceTestKeys: z.array(z.string()),
  supportingInternalRefs: z.array(z.object({ behaviorId: z.string(), summary: z.string() })),
})

export interface ConsolidateBehaviorInput {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly candidateFeatureKey: string
  readonly candidateFeatureLabel: string | null
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}
```

Refactor `scripts/behavior-audit/consolidate.ts` into a true Phase 2b runner:

```typescript
function groupByCandidateFeature(
  classified: Readonly<Record<string, import('./classified-store.js').ClassifiedBehavior>>,
  selectedCandidateFeatureKeys: ReadonlySet<string>,
): ReadonlyMap<string, readonly ConsolidateBehaviorInput[]> {
  const grouped = new Map<string, ConsolidateBehaviorInput[]>()
  for (const item of Object.values(classified)) {
    if (item.candidateFeatureKey === null) continue
    if (selectedCandidateFeatureKeys.size > 0 && !selectedCandidateFeatureKeys.has(item.candidateFeatureKey)) continue
    grouped.set(item.candidateFeatureKey, [
      ...(grouped.get(item.candidateFeatureKey) ?? []),
      {
        behaviorId: item.behaviorId,
        testKey: item.testKey,
        domain: item.domain,
        visibility: item.visibility,
        candidateFeatureKey: item.candidateFeatureKey,
        candidateFeatureLabel: item.candidateFeatureLabel,
        behavior: item.behavior,
        context: item.context,
        keywords: item.keywords,
      },
    ])
  }
  return grouped
}

export async function runPhase2b(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
  selectedCandidateFeatureKeys: ReadonlySet<string>,
): Promise<ConsolidatedManifest> {
  const groups = [
    ...groupByCandidateFeature(progress.phase2a.classifiedBehaviors, selectedCandidateFeatureKeys).entries(),
  ]
  progress.phase2b.status = 'in-progress'
  progress.phase2b.stats.candidateFeaturesTotal = groups.length

  let currentManifest = consolidatedManifest
  for (const [candidateFeatureKey, inputs] of groups) {
    const result = await consolidateWithRetry(
      candidateFeatureKey,
      inputs,
      getFailedConsolidationAttempts(progress, candidateFeatureKey),
    )
    if (result === null) {
      markConsolidationFailed(progress, candidateFeatureKey, 'consolidation failed after retries')
      continue
    }

    const consolidations: ConsolidatedBehavior[] = result.map(({ id, item }) => ({
      id,
      domain: [...new Set(inputs.map((input) => input.domain))].length === 1 ? inputs[0]!.domain : 'cross-domain',
      featureName: item.featureName,
      isUserFacing: item.isUserFacing,
      behavior: item.behavior,
      userStory: item.userStory,
      context: item.context,
      sourceTestKeys: item.sourceTestKeys,
      sourceBehaviorIds: item.sourceBehaviorIds,
      supportingInternalRefs: item.supportingInternalRefs,
    }))

    await writeConsolidatedFile(candidateFeatureKey, consolidations)
    markCandidateFeatureDone(progress, candidateFeatureKey, consolidations)
    for (const consolidated of consolidations) {
      currentManifest = {
        ...currentManifest,
        entries: {
          ...currentManifest.entries,
          [consolidated.id]: {
            consolidatedId: consolidated.id,
            domain: consolidated.domain,
            featureName: consolidated.featureName,
            sourceTestKeys: consolidated.sourceTestKeys,
            sourceBehaviorIds: consolidated.sourceBehaviorIds,
            supportingInternalBehaviorIds: consolidated.supportingInternalRefs.map((item) => item.behaviorId),
            isUserFacing: consolidated.isUserFacing,
            candidateFeatureKey,
            keywords: [...new Set(inputs.flatMap((input) => input.keywords))].toSorted(),
            sourceDomains: [...new Set(inputs.map((input) => input.domain))].toSorted(),
            phase2Fingerprint: buildPhase2ConsolidationFingerprint({
              candidateFeatureKey,
              sourceBehaviorIds: consolidated.sourceBehaviorIds,
              behaviors: inputs.map((input) => input.behavior),
              phaseVersion: phase2Version,
            }),
            lastConsolidatedAt: new Date().toISOString(),
          },
        },
      }
    }
  }

  progress.phase2b.status = 'done'
  await saveProgress(progress)
  return currentManifest
}
```

Update `scripts/behavior-audit/evaluate.ts` to load consolidated files by `candidateFeatureKey` and score only user-facing outputs:

```typescript
function getConsolidatedFileKeysFromManifestEntries(
  entries: Readonly<Record<string, import('./incremental.js').ConsolidatedManifestEntry>>,
): readonly string[] {
  return [...new Set(Object.values(entries).map((entry) => entry.candidateFeatureKey ?? entry.domain))].toSorted()
}
```

- [ ] **Step 4: Run the focused consolidation test and then the integration suite**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts --test-name-pattern "runPhase2b consolidates user-facing candidate features and preserves supporting internal refs"
bun test ./tests/scripts/behavior-audit-integration.test.ts
```

Expected: the new consolidation test passes; some entrypoint tests may still fail until Task 7 wires the top-level runner.

- [ ] **Step 5: Commit Phase 2b consolidation changes**

```bash
git add scripts/behavior-audit/consolidate-agent.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): consolidate classified behaviors into user stories"
```

---

### Task 7: Wire the entrypoint, report rebuild flow, and full incremental stability regression tests

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `tests/scripts/behavior-audit-incremental.test.ts`
- Modify: `tests/scripts/behavior-audit-integration.test.ts`

- [ ] **Step 1: Add the failing startup-rerun stability test**

Add this test to `tests/scripts/behavior-audit-incremental.test.ts`:

```typescript
test('startup passes changed tests through phase2a and phase2b without touching unrelated candidate features', async () => {
  await initializeGitRepo(root)

  const calls: { readonly phase2a: readonly string[]; readonly phase2b: readonly string[] }[] = []

  void mock.module('../../scripts/behavior-audit/classify.js', () => ({
    runPhase2a: async (_input: { readonly selectedTestKeys: ReadonlySet<string> }): Promise<ReadonlySet<string>> => {
      calls.push({ phase2a: [..._input.selectedTestKeys].toSorted(), phase2b: [] })
      return new Set(['task-creation'])
    },
  }))

  void mock.module('../../scripts/behavior-audit/consolidate.js', () => ({
    runPhase2b: async (
      _progress: unknown,
      _manifest: IncrementalModule.ConsolidatedManifest,
      _phaseVersion: string,
      selectedCandidateFeatureKeys: ReadonlySet<string>,
    ): Promise<IncrementalModule.ConsolidatedManifest> => {
      const last = calls[calls.length - 1]
      if (last === undefined) {
        throw new Error('Expected phase2a call before phase2b')
      }
      calls[calls.length - 1] = {
        phase2a: last.phase2a,
        phase2b: [...selectedCandidateFeatureKeys].toSorted(),
      }
      return { version: 1, entries: {} }
    },
  }))

  await loadBehaviorAuditEntryPoint(crypto.randomUUID())

  expect(calls).toEqual([
    {
      phase2a: ['tests/tools/sample.test.ts::sample'],
      phase2b: ['task-creation'],
    },
  ])
})
```

- [ ] **Step 2: Run the focused startup test to verify it fails**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts --test-name-pattern "startup passes changed tests through phase2a and phase2b without touching unrelated candidate features"
```

Expected: FAIL because the entrypoint still imports and runs `runPhase2`, not `runPhase2a` plus `runPhase2b`.

- [ ] **Step 3: Update the entrypoint and report rebuild flow**

Refactor `scripts/behavior-audit.ts` to run the new stage order:

```typescript
import { runPhase2a } from './behavior-audit/classify.js'
import { runPhase2b } from './behavior-audit/consolidate.js'

async function runPhase2aIfNeeded(
  progress: Progress,
  manifest: IncrementalManifest,
  selectedTestKeys: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  if (progress.phase2a.status === 'done' && selectedTestKeys.size === 0) {
    return new Set()
  }
  return runPhase2a({ progress, selectedTestKeys, manifest })
}

async function runPhase2bIfNeeded(
  progress: Progress,
  phase2Version: string,
  selectedCandidateFeatureKeys: ReadonlySet<string>,
): Promise<import('./behavior-audit/incremental.js').ConsolidatedManifest> {
  const existingManifest = (await loadConsolidatedManifest()) ?? createEmptyConsolidatedManifest()
  return runPhase2b(progress, existingManifest, phase2Version, selectedCandidateFeatureKeys)
}

async function main(): Promise<void> {
  requireOpenAiApiKey()
  console.log('Behavior Audit — discovering test files...\n')

  const { previousManifest, previousLastStartCommit, updatedManifest } = await prepareIncrementalRun()
  const { parsedFiles, previousConsolidatedManifest, selection } = await selectIncrementalRunWork({
    previousManifest,
    previousLastStartCommit,
  })

  const progress = await loadOrCreateProgress(parsedFiles.length)
  await runPhase1IfNeeded(parsedFiles, progress, new Set(selection.phase1SelectedTestKeys), updatedManifest)
  const dirtyFromPhase2a = await runPhase2aIfNeeded(
    progress,
    updatedManifest,
    new Set(selection.phase2aSelectedTestKeys),
  )
  const phase2bSelectedKeys = new Set([...selection.phase2bSelectedCandidateFeatureKeys, ...dirtyFromPhase2a])
  const consolidatedManifest = await runPhase2bIfNeeded(
    progress,
    updatedManifest.phaseVersions.phase2,
    phase2bSelectedKeys,
  )
  await saveConsolidatedManifest(consolidatedManifest)
  await runPhase3IfNeeded(progress, new Set(selection.phase3SelectedConsolidatedIds), consolidatedManifest)
}
```

Update `scripts/behavior-audit/report-writer.ts` rebuild logic so it reads consolidated entries by `sourceBehaviorIds` and new root paths only:

```typescript
if (consolidatedManifest !== null) {
  for (const [consolidatedId, entry] of Object.entries(consolidatedManifest.entries)) {
    const evaluation = evaluationsByKey[consolidatedId]
    if (evaluation !== undefined) {
      ;(evaluationsByDomain[entry.domain] ??= []).push(evaluation)
    }
  }
}
```

- [ ] **Step 4: Run the full audit-behavior test suite and core verification commands**

Run:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts
bun test ./tests/scripts/behavior-audit-incremental.test.ts
bun typecheck
bun format:check
```

Expected: all targeted behavior-audit tests pass, `bun typecheck` passes, and `bun format:check` passes without changes.

- [ ] **Step 5: Commit the full Phase 2 redesign wiring**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/report-writer.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-integration.test.ts
git commit -m "feat(audit): wire phase2 classification and consolidation flow"
```

---

## Post-Plan Verification Checklist

- [ ] `reports/audit-behavior/` is the only root used by behavior-audit runtime artifacts.
- [ ] `phase2a` persists classified records and returns dirty candidate feature keys.
- [ ] `phase2b` consumes classified records grouped by `candidateFeatureKey`.
- [ ] Consolidated outputs preserve `sourceBehaviorIds` and `supportingInternalRefs`.
- [ ] Incremental selection targets changed tests, affected candidate features, and downstream consolidated IDs.
- [ ] Internal-only behaviors never reach Phase 3 scoring.
- [ ] `behavior-audit-reset.ts phase2` clears classified, consolidated, and story artifacts while preserving `keyword-vocabulary.json`.

## Final Verification Commands

Run these after Task 7 before opening a PR:

```bash
bun test ./tests/scripts/behavior-audit-integration.test.ts
bun test ./tests/scripts/behavior-audit-incremental.test.ts
bun typecheck
bun format:check
```
