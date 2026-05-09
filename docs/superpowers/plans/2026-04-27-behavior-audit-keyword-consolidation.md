# Behavior Audit Keyword Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a Phase 1b pipeline step between Phase 1 and Phase 2a that uses embedding-based cosine similarity clustering to merge near-duplicate vocabulary slugs and remap all extracted behavior records to canonical slugs.

**Architecture:** Load vocabulary → embed all slug+description strings → union-find clustering → elect canonical per cluster → write updated vocabulary → remap extracted files → reset Phase 2/3 if merges applied. Pure clustering logic lives in `consolidate-keywords-helpers.ts`; I/O and retry live in `consolidate-keywords.ts` and `consolidate-keywords-agent.ts`.

**Tech Stack:** Bun, TypeScript strict, Zod v4, Vercel AI SDK (`embedMany`), `@ai-sdk/openai-compatible`, `bun:test`

---

## File Map

| File                                                                | Action     | Purpose                                                                                                                                 |
| ------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/progress.ts`                                | Modify     | Add `Phase1bProgress`, `emptyPhase1b`, version 4→5, `phase1b` field, `resetPhase1bAndBelow`                                             |
| `scripts/behavior-audit/progress-migrate.ts`                        | Modify     | Add `Phase1bCheckpointSchema`, `ProgressV5Schema`, rename `toVersion4Progress`→`toVersion5Progress`, update `validateOrMigrateProgress` |
| `scripts/behavior-audit/config.ts`                                  | Modify     | Add 6 new embedding/consolidation env vars                                                                                              |
| `scripts/behavior-audit/consolidate-keywords-helpers.ts`            | **Create** | Pure clustering functions: cosine similarity, union-find, cluster building, merge map, remap, vocabulary rebuild                        |
| `scripts/behavior-audit/extracted-store.ts`                         | Modify     | Add `remapKeywordsInExtractedFile`                                                                                                      |
| `scripts/behavior-audit/consolidate-keywords-agent.ts`              | **Create** | `embedSlugBatch`: batched `embedMany` with retry                                                                                        |
| `scripts/behavior-audit/consolidate-keywords.ts`                    | **Create** | `runPhase1b` orchestrator with DI deps                                                                                                  |
| `scripts/behavior-audit/extract.ts`                                 | Modify     | Replace `resetPhase2AndPhase3` with `resetPhase1bAndBelow` in `Phase1Deps`                                                              |
| `scripts/behavior-audit.ts`                                         | Modify     | Wire `runPhase1bIfNeeded` between Phase 1 and Phase 2a                                                                                  |
| `tests/scripts/behavior-audit-integration.helpers.ts`               | Modify     | Add 6 new config fields to `BehaviorAuditTestConfig`, `DEFAULT_CONFIG`, update `createEmptyProgressFixture`                             |
| `tests/scripts/behavior-audit-integration.runtime-helpers.ts`       | Modify     | Add 6 new keys to `behaviorAuditEnvKeys`, `clearBehaviorAuditEnvKey`, `applyBehaviorAuditEnv`                                           |
| `tests/scripts/behavior-audit-integration.support.ts`               | Modify     | Add `ConsolidateKeywordsModuleShape`, `isConsolidateKeywordsModule`, `loadConsolidateKeywordsModule`                                    |
| `tests/scripts/behavior-audit/progress.test.ts`                     | **Create** | Unit tests for Phase1b progress additions                                                                                               |
| `tests/scripts/behavior-audit/progress-migrate.test.ts`             | **Create** | Unit tests for v4→v5 migration                                                                                                          |
| `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts` | **Create** | Unit tests for all pure clustering functions                                                                                            |
| `tests/scripts/behavior-audit/extracted-store-remap.test.ts`        | **Create** | Unit tests for `remapKeywordsInExtractedFile`                                                                                           |
| `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts`   | **Create** | Unit tests for `embedSlugBatch`                                                                                                         |
| `tests/scripts/behavior-audit-phase1b.test.ts`                      | **Create** | Integration tests for `runPhase1b`                                                                                                      |

---

## Task 1: Progress v5 — Phase1bProgress, version bump, migration

**Files:**

- Create: `tests/scripts/behavior-audit/progress.test.ts`
- Create: `tests/scripts/behavior-audit/progress-migrate.test.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Modify: `scripts/behavior-audit/progress-migrate.ts`
- Modify: `tests/scripts/behavior-audit-integration.helpers.ts`

### Critical note

`Progress.version` changing from `4` to `5` is a breaking type change. `progress-migrate.ts` must be updated in the same commit or TypeScript will error. `createEmptyProgressFixture` in test helpers must also be updated in the same commit since it constructs a literal `Progress` object.

- [ ] **Step 1: Write failing progress unit tests**

Create `tests/scripts/behavior-audit/progress.test.ts`:

```typescript
import { expect, test } from 'bun:test'

import {
  createEmptyProgress,
  emptyPhase1b,
  emptyPhase2a,
  emptyPhase2b,
  emptyPhase3,
  resetPhase1bAndBelow,
} from '../../../scripts/behavior-audit/progress.js'

test('emptyPhase1b returns a fresh Phase1bProgress with all-zero stats', () => {
  const p = emptyPhase1b()
  expect(p.status).toBe('not-started')
  expect(p.lastRunAt).toBeNull()
  expect(p.threshold).toBe(0)
  expect(p.stats.slugsBefore).toBe(0)
  expect(p.stats.slugsAfter).toBe(0)
  expect(p.stats.mergesApplied).toBe(0)
  expect(p.stats.behaviorsUpdated).toBe(0)
  expect(p.stats.keywordsRemapped).toBe(0)
})

test('createEmptyProgress returns version 5 progress with phase1b included', () => {
  const p = createEmptyProgress(10)
  expect(p.version).toBe(5)
  expect(p.phase1b).toEqual(emptyPhase1b())
  expect(p.phase1.stats.filesTotal).toBe(10)
})

test('resetPhase1bAndBelow resets phase1b, phase2a, phase2b, and phase3', () => {
  const p = createEmptyProgress(0)
  p.phase1b.status = 'done'
  p.phase2a.status = 'done'
  p.phase2b.status = 'done'
  p.phase3.status = 'done'

  resetPhase1bAndBelow(p)

  expect(p.phase1b).toEqual(emptyPhase1b())
  expect(p.phase2a).toEqual(emptyPhase2a())
  expect(p.phase2b).toEqual(emptyPhase2b())
  expect(p.phase3).toEqual(emptyPhase3())
})

test('resetPhase1bAndBelow does not touch phase1', () => {
  const p = createEmptyProgress(5)
  p.phase1.status = 'done'
  p.phase1.stats.filesDone = 5

  resetPhase1bAndBelow(p)

  expect(p.phase1.status).toBe('done')
  expect(p.phase1.stats.filesDone).toBe(5)
})
```

- [ ] **Step 2: Write failing migration unit tests**

Create `tests/scripts/behavior-audit/progress-migrate.test.ts`:

```typescript
import { expect, test } from 'bun:test'

import { emptyPhase1b } from '../../../scripts/behavior-audit/progress.js'
import { validateOrMigrateProgress } from '../../../scripts/behavior-audit/progress-migrate.js'

const validV4Base = {
  version: 4,
  startedAt: '2026-01-01T00:00:00.000Z',
  phase1: {
    status: 'not-started',
    completedTests: {},
    failedTests: {},
    completedFiles: [],
    stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
  },
  phase2a: {
    status: 'not-started',
    completedBehaviors: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  },
  phase2b: {
    status: 'not-started',
    completedFeatureKeys: {},
    failedFeatureKeys: {},
    stats: { featureKeysTotal: 0, featureKeysDone: 0, featureKeysFailed: 0, behaviorsConsolidated: 0 },
  },
  phase3: {
    status: 'not-started',
    completedConsolidatedIds: {},
    failedConsolidatedIds: {},
    stats: { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 },
  },
}

test('validateOrMigrateProgress returns a valid v5 progress unchanged', () => {
  const v5 = { ...validV4Base, version: 5, phase1b: emptyPhase1b() }
  const result = validateOrMigrateProgress(v5)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress migrates v4 to v5 by injecting emptyPhase1b', () => {
  const result = validateOrMigrateProgress(validV4Base)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.phase1b).toEqual(emptyPhase1b())
  expect(result?.phase1.stats.filesTotal).toBe(0)
  expect(result?.phase2a.status).toBe('not-started')
})

test('validateOrMigrateProgress migrates v4 and preserves existing phase data', () => {
  const v4WithData = {
    ...validV4Base,
    phase1: {
      ...validV4Base.phase1,
      status: 'done',
      stats: { filesTotal: 10, filesDone: 10, testsExtracted: 50, testsFailed: 2 },
    },
    phase2a: {
      ...validV4Base.phase2a,
      status: 'in-progress',
      stats: { behaviorsTotal: 50, behaviorsDone: 20, behaviorsFailed: 1 },
    },
  }
  const result = validateOrMigrateProgress(v4WithData)
  expect(result?.phase1.status).toBe('done')
  expect(result?.phase1.stats.testsExtracted).toBe(50)
  expect(result?.phase2a.status).toBe('in-progress')
  expect(result?.phase2a.stats.behaviorsDone).toBe(20)
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress resets incompatible progress preserving startedAt', () => {
  const incompatible = { startedAt: '2025-12-01T00:00:00.000Z', someGarbage: true }
  const result = validateOrMigrateProgress(incompatible)
  expect(result).not.toBeNull()
  expect(result?.version).toBe(5)
  expect(result?.startedAt).toBe('2025-12-01T00:00:00.000Z')
  expect(result?.phase1.status).toBe('not-started')
  expect(result?.phase1b).toEqual(emptyPhase1b())
})

test('validateOrMigrateProgress returns null for completely unrecognizable input', () => {
  expect(validateOrMigrateProgress(null)).toBeNull()
  expect(validateOrMigrateProgress(42)).toBeNull()
  expect(validateOrMigrateProgress({})).toBeNull()
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun test tests/scripts/behavior-audit/progress.test.ts tests/scripts/behavior-audit/progress-migrate.test.ts
```

Expected: FAIL — `emptyPhase1b is not a function` or similar.

- [ ] **Step 4: Update `scripts/behavior-audit/progress.ts`**

Add after the existing `PhaseStatus` / `FailedEntry` block (before `Phase1Progress`):

```typescript
export interface Phase1bProgress {
  status: PhaseStatus
  lastRunAt: string | null
  threshold: number
  stats: {
    slugsBefore: number
    slugsAfter: number
    mergesApplied: number
    behaviorsUpdated: number
    keywordsRemapped: number
  }
}
```

Change the `Progress` interface:

```typescript
export interface Progress {
  version: 5
  startedAt: string
  phase1: Phase1Progress
  phase1b: Phase1bProgress
  phase2a: Phase2aProgress
  phase2b: Phase2bProgress
  phase3: Phase3Progress
}
```

Add `emptyPhase1b` alongside the other `empty*` functions:

```typescript
export function emptyPhase1b(): Phase1bProgress {
  return {
    status: 'not-started',
    lastRunAt: null,
    threshold: 0,
    stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
  }
}
```

Update `createEmptyProgress` to include `phase1b` and change `version` to `5`:

```typescript
export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 5,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase1b: emptyPhase1b(),
    phase2a: emptyPhase2a(),
    phase2b: emptyPhase2b(),
    phase3: emptyPhase3(),
  }
}
```

Add `resetPhase1bAndBelow` alongside `resetPhase2AndPhase3` and `resetPhase3`:

```typescript
export function resetPhase1bAndBelow(progress: Progress): void {
  progress.phase1b = emptyPhase1b()
  progress.phase2a = emptyPhase2a()
  progress.phase2b = emptyPhase2b()
  progress.phase3 = emptyPhase3()
}
```

- [ ] **Step 5: Update `scripts/behavior-audit/progress-migrate.ts`**

Add `Phase1bCheckpointSchema` after the existing `Phase1CheckpointSchema` block:

```typescript
const Phase1bCheckpointSchema = z.strictObject({
  status: z.enum(['not-started', 'in-progress', 'done']),
  lastRunAt: z.string().nullable(),
  threshold: z.number(),
  stats: z.object({
    slugsBefore: z.number(),
    slugsAfter: z.number(),
    mergesApplied: z.number(),
    behaviorsUpdated: z.number(),
    keywordsRemapped: z.number(),
  }),
})
```

Add `ProgressV5Schema` after the existing `ProgressV4Schema`:

```typescript
const ProgressV5Schema = z.strictObject({
  version: z.literal(5),
  startedAt: z.string(),
  phase1: Phase1CheckpointSchema,
  phase1b: Phase1bCheckpointSchema,
  phase2a: Phase2aCheckpointSchema,
  phase2b: Phase2bCheckpointSchema,
  phase3: Phase3CheckpointSchema,
})
```

Rename `toVersion4Progress` to `toVersion5Progress` and update it to version 5 with `phase1b`:

```typescript
function toVersion5Progress(input: {
  readonly startedAt: string
  readonly phase1: Progress['phase1']
  readonly phase1b?: Partial<Progress['phase1b']>
  readonly phase2a?: Partial<Progress['phase2a']>
  readonly phase2b?: Partial<Progress['phase2b']>
  readonly phase3?: Partial<Progress['phase3']>
}): Progress {
  return normalizePhase2aFailedAttempts(
    ProgressV5Schema.parse({
      version: 5,
      startedAt: input.startedAt,
      phase1: input.phase1,
      phase1b: {
        ...emptyPhase1b(),
        ...input.phase1b,
      },
      phase2a: {
        ...emptyPhase2a(),
        ...input.phase2a,
      },
      phase2b: {
        ...emptyPhase2b(),
        ...input.phase2b,
      },
      phase3: {
        ...emptyPhase3(),
        ...input.phase3,
      },
    }),
  )
}
```

Update `createIncompatibleResetProgress` to call `toVersion5Progress`:

```typescript
function createIncompatibleResetProgress(startedAt: string): Progress {
  return toVersion5Progress({
    startedAt,
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal: 0, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
  })
}
```

Update `validateOrMigrateProgress` to try v5 first, then migrate v4:

```typescript
export function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v5Result = ProgressV5Schema.safeParse(raw)
  if (v5Result.success) return v5Result.data

  const v4Result = ProgressV4Schema.safeParse(raw)
  if (v4Result.success) {
    return toVersion5Progress({
      startedAt: v4Result.data.startedAt,
      phase1: v4Result.data.phase1,
      phase2a: v4Result.data.phase2a,
      phase2b: v4Result.data.phase2b,
      phase3: v4Result.data.phase3,
    })
  }

  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw) {
    const startedAt = (raw as Record<string, unknown>)['startedAt']
    if (typeof startedAt === 'string') {
      return createIncompatibleResetProgress(startedAt)
    }
  }

  return null
}
```

Also add import for `emptyPhase1b` in the import from `progress.js`:

```typescript
import { emptyPhase2a, emptyPhase2b, emptyPhase3, emptyPhase1b, type Progress } from './progress.js'
```

- [ ] **Step 6: Update `tests/scripts/behavior-audit-integration.helpers.ts` — createEmptyProgressFixture**

Change the `version: 4` to `version: 5` and add `phase1b`:

```typescript
export function createEmptyProgressFixture(filesTotal: number): Progress {
  return {
    version: 5,
    startedAt: '2026-04-17T12:00:00.000Z',
    phase1: {
      status: 'not-started',
      completedTests: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase1b: {
      status: 'not-started',
      lastRunAt: null,
      threshold: 0,
      stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
    },
    phase2a: {
      status: 'not-started',
      completedBehaviors: {},
      failedBehaviors: {},
      stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
    },
    phase2b: {
      status: 'not-started',
      completedFeatureKeys: {},
      failedFeatureKeys: {},
      stats: {
        featureKeysTotal: 0,
        featureKeysDone: 0,
        featureKeysFailed: 0,
        behaviorsConsolidated: 0,
      },
    },
    phase3: {
      status: 'not-started',
      completedConsolidatedIds: {},
      failedConsolidatedIds: {},
      stats: {
        consolidatedIdsTotal: 0,
        consolidatedIdsDone: 0,
        consolidatedIdsFailed: 0,
      },
    },
  }
}
```

- [ ] **Step 7: Run the progress tests to confirm they pass**

```bash
bun test tests/scripts/behavior-audit/progress.test.ts tests/scripts/behavior-audit/progress-migrate.test.ts
```

Expected: All tests PASS.

- [ ] **Step 8: Run the full test suite to confirm no regressions**

```bash
bun test
```

Expected: All tests PASS. (Any existing test that builds a `Progress` fixture directly must pass because only `createEmptyProgressFixture` does so — and it's now updated.)

- [ ] **Step 9: Typecheck**

```bash
bun typecheck
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add scripts/behavior-audit/progress.ts scripts/behavior-audit/progress-migrate.ts \
  tests/scripts/behavior-audit/progress.test.ts \
  tests/scripts/behavior-audit/progress-migrate.test.ts \
  tests/scripts/behavior-audit-integration.helpers.ts
git commit -m "feat(behavior-audit): add Phase1bProgress, migrate Progress to version 5"
```

---

## Task 2: Config — 6 new embedding/consolidation env vars

**Files:**

- Modify: `scripts/behavior-audit/config.ts`
- Modify: `tests/scripts/behavior-audit-integration.helpers.ts`
- Modify: `tests/scripts/behavior-audit-integration.runtime-helpers.ts`
- Modify: `tests/scripts/behavior-audit-config.test.ts`

- [ ] **Step 1: Add failing config tests**

Append to `tests/scripts/behavior-audit-config.test.ts`:

```typescript
test('EMBEDDING_MODEL defaults to empty string when not set', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_MODEL']).toBe('')
})

test('EMBEDDING_BASE_URL defaults to BASE_URL when not set', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'http://myserver:9000/v1'
  delete process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_BASE_URL']).toBe('http://myserver:9000/v1')
})

test('EMBEDDING_BASE_URL can be overridden independently of BASE_URL', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_BASE_URL'] = 'http://main:8000/v1'
  process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL'] = 'http://embed:7000/v1'
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['BASE_URL']).toBe('http://main:8000/v1')
  expect((loadedConfig as Record<string, unknown>)['EMBEDDING_BASE_URL']).toBe('http://embed:7000/v1')
})

test('CONSOLIDATION_THRESHOLD defaults to 0.92', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_THRESHOLD']).toBe(0.92)
})

test('CONSOLIDATION_DRY_RUN defaults to false', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN']
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_DRY_RUN']).toBe(false)
})

test('CONSOLIDATION_DRY_RUN reads env value 1 as true', async () => {
  const loadedConfig: unknown = await import(`../../scripts/behavior-audit/config.js?test=${crypto.randomUUID()}`)
  assert(isReloadableConfigModule(loadedConfig), 'Unexpected config module shape')

  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = '1'
  loadedConfig.reloadBehaviorAuditConfig()

  expect((loadedConfig as Record<string, unknown>)['CONSOLIDATION_DRY_RUN']).toBe(true)
})
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
bun test tests/scripts/behavior-audit-config.test.ts
```

Expected: New tests FAIL — `EMBEDDING_MODEL` is `undefined`.

- [ ] **Step 3: Add 6 new exports to `scripts/behavior-audit/config.ts`**

After the existing `export let EXCLUDED_PREFIXES` line (before `reloadBehaviorAuditConfig`), add:

```typescript
export let EMBEDDING_MODEL = ''
export let EMBEDDING_BASE_URL = BASE_URL
export let CONSOLIDATION_THRESHOLD = 0.92
export let CONSOLIDATION_MIN_CLUSTER_SIZE = 2
export let CONSOLIDATION_DRY_RUN = false
export let CONSOLIDATION_EMBED_BATCH_SIZE = 100
```

Inside `reloadBehaviorAuditConfig()`, add at the end (after the `EXCLUDED_PREFIXES` line). Important: `EMBEDDING_BASE_URL` must come **after** `BASE_URL` is resolved:

```typescript
EMBEDDING_MODEL = resolveStringOverride('BEHAVIOR_AUDIT_EMBEDDING_MODEL', '')
EMBEDDING_BASE_URL = resolveStringOverride('BEHAVIOR_AUDIT_EMBEDDING_BASE_URL', BASE_URL)
CONSOLIDATION_THRESHOLD = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD', 0.92)
CONSOLIDATION_MIN_CLUSTER_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE', 2)
CONSOLIDATION_DRY_RUN = resolveStringOverride('BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN', '0') === '1'
CONSOLIDATION_EMBED_BATCH_SIZE = resolveNumberOverride('BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE', 100)
```

- [ ] **Step 4: Update `tests/scripts/behavior-audit-integration.helpers.ts`**

Add 6 new fields to the `BehaviorAuditTestConfig` interface (after `EXCLUDED_PREFIXES`):

```typescript
  readonly EMBEDDING_MODEL: string
  readonly EMBEDDING_BASE_URL: string
  readonly CONSOLIDATION_THRESHOLD: number
  readonly CONSOLIDATION_MIN_CLUSTER_SIZE: number
  readonly CONSOLIDATION_DRY_RUN: boolean
  readonly CONSOLIDATION_EMBED_BATCH_SIZE: number
```

Add to the `DEFAULT_CONFIG` object (after `EXCLUDED_PREFIXES`) and update the `satisfies Omit<...>` type:

```typescript
  EMBEDDING_MODEL: '',
  EMBEDDING_BASE_URL: 'http://localhost:1234/v1',
  CONSOLIDATION_THRESHOLD: 0.92,
  CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
  CONSOLIDATION_DRY_RUN: false,
  CONSOLIDATION_EMBED_BATCH_SIZE: 100,
```

The `satisfies Omit<BehaviorAuditTestConfig, ...>` clause must remain unchanged — the 6 new fields are NOT omitted (they have defaults in `DEFAULT_CONFIG`).

- [ ] **Step 5: Update `tests/scripts/behavior-audit-integration.runtime-helpers.ts`**

Add 6 new strings to `behaviorAuditEnvKeys` array (after `'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES'`):

```typescript
  'BEHAVIOR_AUDIT_EMBEDDING_MODEL',
  'BEHAVIOR_AUDIT_EMBEDDING_BASE_URL',
  'BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD',
  'BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE',
  'BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN',
  'BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE',
```

Add 6 new cases to the `clearBehaviorAuditEnvKey` switch (at the end, before the closing brace):

```typescript
    case 'BEHAVIOR_AUDIT_EMBEDDING_MODEL':
      delete process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL']
      return
    case 'BEHAVIOR_AUDIT_EMBEDDING_BASE_URL':
      delete process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN']
      return
    case 'BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE':
      delete process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE']
```

Note: the last case has no `return` because it is the final case in the switch (matches the pattern of the existing final case `'BEHAVIOR_AUDIT_EXCLUDED_PREFIXES'`).

Add 6 new lines to `applyBehaviorAuditEnv` (after the `EXCLUDED_PREFIXES` line):

```typescript
process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = config.EMBEDDING_MODEL
process.env['BEHAVIOR_AUDIT_EMBEDDING_BASE_URL'] = config.EMBEDDING_BASE_URL
process.env['BEHAVIOR_AUDIT_CONSOLIDATION_THRESHOLD'] = String(config.CONSOLIDATION_THRESHOLD)
process.env['BEHAVIOR_AUDIT_CONSOLIDATION_MIN_CLUSTER_SIZE'] = String(config.CONSOLIDATION_MIN_CLUSTER_SIZE)
process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = config.CONSOLIDATION_DRY_RUN ? '1' : '0'
process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE'] = String(config.CONSOLIDATION_EMBED_BATCH_SIZE)
```

- [ ] **Step 6: Run config tests to confirm they pass**

```bash
bun test tests/scripts/behavior-audit-config.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Run full test suite**

```bash
bun test && bun typecheck
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/behavior-audit/config.ts \
  tests/scripts/behavior-audit-config.test.ts \
  tests/scripts/behavior-audit-integration.helpers.ts \
  tests/scripts/behavior-audit-integration.runtime-helpers.ts
git commit -m "feat(behavior-audit): add embedding and consolidation config env vars"
```

---

## Task 3: Pure clustering helpers

**Files:**

- Create: `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`
- Create: `scripts/behavior-audit/consolidate-keywords-helpers.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts`:

```typescript
import { expect, test } from 'bun:test'

import {
  buildClusters,
  buildConsolidatedVocabulary,
  buildMergeMap,
  buildUnionFind,
  cosineSimilarity,
  electCanonical,
  find,
  remapKeywords,
  union,
} from '../../../scripts/behavior-audit/consolidate-keywords-helpers.js'
import type { KeywordVocabularyEntry } from '../../../scripts/behavior-audit/keyword-vocabulary.js'

// ── cosineSimilarity ──────────────────────────────────────────────────────────

test('cosineSimilarity of identical vectors is 1', () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
})

test('cosineSimilarity of orthogonal vectors is 0', () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
})

test('cosineSimilarity of known angle', () => {
  const s = 1 / Math.sqrt(2)
  expect(cosineSimilarity([1, 0], [s, s])).toBeCloseTo(s)
})

test('cosineSimilarity with zero vector returns 0', () => {
  expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
})

// ── union-find ────────────────────────────────────────────────────────────────

test('buildUnionFind initialises each element as its own root', () => {
  const uf = buildUnionFind(3)
  expect(find(uf, 0)).toBe(0)
  expect(find(uf, 1)).toBe(1)
  expect(find(uf, 2)).toBe(2)
})

test('union merges two elements into the same component', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  expect(find(uf, 0)).toBe(find(uf, 1))
})

test('union is transitive via union-find', () => {
  const uf = buildUnionFind(3)
  union(uf, 0, 1)
  union(uf, 1, 2)
  expect(find(uf, 0)).toBe(find(uf, 2))
})

// ── buildClusters ─────────────────────────────────────────────────────────────

test('buildClusters returns no clusters when all pairs are below threshold', () => {
  const embeddings = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const clusters = buildClusters(embeddings, 0.99, 2)
  expect(clusters).toHaveLength(0)
})

test('buildClusters returns a cluster when similarity meets threshold', () => {
  // a=[1,0], b=[0.9,0.1] — cosine similarity ≈ 0.994
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(2)
})

test('buildClusters handles transitivity: a~b and b~c should merge all three', () => {
  const s = 1 / Math.sqrt(2)
  const a = [1, 0, 0]
  const b = [s, s, 0]
  const c = [0, 1, 0]
  // cos(a,b) ≈ 0.707, cos(b,c) ≈ 0.707, cos(a,c) = 0
  const clusters = buildClusters([a, b, c], 0.5, 2)
  expect(clusters).toHaveLength(1)
  expect(clusters[0]).toHaveLength(3)
})

test('buildClusters respects minClusterSize', () => {
  // a=[1,0], b=[0.9,0.1] would form a cluster but minClusterSize=3
  const a = [1, 0]
  const mag = Math.sqrt(0.9 * 0.9 + 0.1 * 0.1)
  const b = [0.9 / mag, 0.1 / mag]
  const clusters = buildClusters([a, b], 0.99, 3)
  expect(clusters).toHaveLength(0)
})

// ── electCanonical ────────────────────────────────────────────────────────────

function makeEntry(slug: string, createdAt = '2026-01-01T00:00:00.000Z'): KeywordVocabularyEntry {
  return { slug, description: 'desc', createdAt, updatedAt: '2026-01-01T00:00:00.000Z' }
}

test('electCanonical selects the shorter slug', () => {
  const entries = [makeEntry('long-slug-name'), makeEntry('short')]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('short')
})

test('electCanonical breaks slug length tie by earliest createdAt', () => {
  const entries = [makeEntry('aaa', '2026-02-01T00:00:00.000Z'), makeEntry('bbb', '2026-01-01T00:00:00.000Z')]
  const canonical = electCanonical(entries)
  expect(canonical.slug).toBe('bbb')
})

// ── buildMergeMap ─────────────────────────────────────────────────────────────

test('buildMergeMap maps non-canonical slugs to canonical slug', () => {
  const vocab = [makeEntry('short'), makeEntry('longer-version'), makeEntry('also-longer')]
  // cluster: indices [0, 1, 2] — 'short' is canonical
  const clusters = [[0, 1, 2]]
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.get('longer-version')).toBe('short')
  expect(mergeMap.get('also-longer')).toBe('short')
  expect(mergeMap.has('short')).toBe(false) // canonical not in map
})

test('buildMergeMap does not include unclustered entries', () => {
  const vocab = [makeEntry('solo'), makeEntry('a'), makeEntry('b')]
  const clusters = [[1, 2]] // indices 1 and 2 are clustered; 0 is solo
  const mergeMap = buildMergeMap(vocab, clusters)
  expect(mergeMap.has('solo')).toBe(false)
  expect(mergeMap.size).toBe(1)
})

// ── remapKeywords ─────────────────────────────────────────────────────────────

test('remapKeywords replaces keywords that appear in mergeMap', () => {
  const mergeMap = new Map([['old-slug', 'new-slug']])
  const result = remapKeywords(['old-slug', 'other'], mergeMap)
  expect(result).toEqual(['new-slug', 'other'])
})

test('remapKeywords deduplicates after remapping', () => {
  const mergeMap = new Map([
    ['alias', 'canonical'],
    ['alias2', 'canonical'],
  ])
  const result = remapKeywords(['alias', 'alias2', 'unrelated'], mergeMap)
  expect(result).toEqual(['canonical', 'unrelated'])
})

test('remapKeywords preserves order (first occurrence wins after dedup)', () => {
  const mergeMap = new Map([['b', 'a']])
  const result = remapKeywords(['a', 'b', 'c'], mergeMap)
  expect(result).toEqual(['a', 'c']) // 'b'→'a' deduped since 'a' already present
})

test('remapKeywords leaves unaffected keywords unchanged', () => {
  const mergeMap = new Map<string, string>()
  const result = remapKeywords(['one', 'two', 'three'], mergeMap)
  expect(result).toEqual(['one', 'two', 'three'])
})

// ── buildConsolidatedVocabulary ───────────────────────────────────────────────

test('buildConsolidatedVocabulary removes merged slugs and keeps canonicals', () => {
  const vocab = [
    {
      slug: 'short',
      description: 'short desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      slug: 'long-variant',
      description: 'a longer description for the variant',
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map([['long-variant', 'short']])
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  const entry = result[0]!
  expect(entry.slug).toBe('short')
  // longest description wins
  expect(entry.description).toBe('a longer description for the variant')
  // earliest createdAt preserved
  expect(entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
  // updatedAt = now (was merged)
  expect(entry.updatedAt).toBe(now)
})

test('buildConsolidatedVocabulary leaves unmerged entries unchanged', () => {
  const vocab = [
    {
      slug: 'standalone',
      description: 'desc',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ]
  const mergeMap = new Map<string, string>()
  const now = '2026-04-27T12:00:00.000Z'
  const result = buildConsolidatedVocabulary(vocab, mergeMap, now)

  expect(result).toHaveLength(1)
  expect(result[0]).toEqual(vocab[0])
})

test('buildConsolidatedVocabulary returns entries sorted by slug', () => {
  const vocab = [
    { slug: 'zebra', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { slug: 'alpha', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]
  const result = buildConsolidatedVocabulary(vocab, new Map(), '2026-04-27T00:00:00.000Z')
  expect(result[0]!.slug).toBe('alpha')
  expect(result[1]!.slug).toBe('zebra')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `scripts/behavior-audit/consolidate-keywords-helpers.ts`**

```typescript
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'

export type UnionFind = { parent: Int32Array; rank: Uint8Array }

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0)
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB)
}

export function buildUnionFind(n: number): UnionFind {
  return {
    parent: Int32Array.from({ length: n }, (_, i) => i),
    rank: new Uint8Array(n),
  }
}

export function find(uf: UnionFind, i: number): number {
  if (uf.parent[i] !== i) {
    uf.parent[i] = find(uf, uf.parent[i]!)
  }
  return uf.parent[i]!
}

export function union(uf: UnionFind, i: number, j: number): void {
  const ri = find(uf, i)
  const rj = find(uf, j)
  if (ri === rj) return
  if (uf.rank[ri]! < uf.rank[rj]!) {
    uf.parent[ri] = rj
  } else if (uf.rank[ri]! > uf.rank[rj]!) {
    uf.parent[rj] = ri
  } else {
    uf.parent[rj] = ri
    uf.rank[ri]++
  }
}

export function buildClusters(
  embeddings: readonly (readonly number[])[],
  threshold: number,
  minClusterSize: number,
): readonly (readonly number[])[] {
  const n = embeddings.length
  const uf = buildUnionFind(n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const embI = embeddings[i]
      const embJ = embeddings[j]
      if (embI !== undefined && embJ !== undefined && cosineSimilarity(embI, embJ) >= threshold) {
        union(uf, i, j)
      }
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(uf, i)
    const group = groups.get(root)
    if (group === undefined) {
      groups.set(root, [i])
    } else {
      group.push(i)
    }
  }

  return [...groups.values()].filter((g) => g.length >= minClusterSize).map((g) => [...g])
}

export function electCanonical(cluster: readonly KeywordVocabularyEntry[]): KeywordVocabularyEntry {
  const first = cluster[0]
  if (first === undefined) throw new Error('electCanonical called with empty cluster')
  return cluster.slice(1).reduce<KeywordVocabularyEntry>((best, entry) => {
    if (entry.slug.length < best.slug.length) return entry
    if (entry.slug.length === best.slug.length && entry.createdAt < best.createdAt) return entry
    return best
  }, first)
}

export function buildMergeMap(
  vocabulary: readonly KeywordVocabularyEntry[],
  clusters: readonly (readonly number[])[],
): ReadonlyMap<string, string> {
  const mergeMap = new Map<string, string>()
  for (const clusterIndices of clusters) {
    const clusterEntries = clusterIndices
      .map((i) => vocabulary[i])
      .filter((e): e is KeywordVocabularyEntry => e !== undefined)
    const canonical = electCanonical(clusterEntries)
    for (const entry of clusterEntries) {
      if (entry.slug !== canonical.slug) {
        mergeMap.set(entry.slug, canonical.slug)
      }
    }
  }
  return mergeMap
}

export function remapKeywords(keywords: readonly string[], mergeMap: ReadonlyMap<string, string>): readonly string[] {
  const seen = new Set<string>()
  return keywords
    .map((kw) => mergeMap.get(kw) ?? kw)
    .filter((kw) => {
      if (seen.has(kw)) return false
      seen.add(kw)
      return true
    })
}

export function buildConsolidatedVocabulary(
  vocabulary: readonly KeywordVocabularyEntry[],
  mergeMap: ReadonlyMap<string, string>,
  now: string,
): readonly KeywordVocabularyEntry[] {
  const groups = new Map<string, KeywordVocabularyEntry[]>()
  for (const entry of vocabulary) {
    const canonicalSlug = mergeMap.get(entry.slug) ?? entry.slug
    const existing = groups.get(canonicalSlug)
    if (existing === undefined) {
      groups.set(canonicalSlug, [entry])
    } else {
      existing.push(entry)
    }
  }

  return [...groups.entries()]
    .map(([canonicalSlug, entries]) => {
      const firstEntry = entries[0]!
      if (entries.length === 1) return firstEntry
      const earliestCreatedAt = entries.reduce(
        (min, e) => (e.createdAt < min ? e.createdAt : min),
        firstEntry.createdAt,
      )
      const longestDescription = entries.reduce(
        (best, e) => (e.description.length > best.length ? e.description : best),
        firstEntry.description,
      )
      return {
        slug: canonicalSlug,
        description: longestDescription,
        createdAt: earliestCreatedAt,
        updatedAt: now,
      } satisfies KeywordVocabularyEntry
    })
    .toSorted((a, b) => a.slug.localeCompare(b.slug))
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Typecheck**

```bash
bun typecheck
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-helpers.ts \
  tests/scripts/behavior-audit/consolidate-keywords-helpers.test.ts
git commit -m "feat(behavior-audit): add pure clustering helpers for keyword consolidation"
```

---

## Task 4: `remapKeywordsInExtractedFile`

**Files:**

- Create: `tests/scripts/behavior-audit/extracted-store-remap.test.ts`
- Modify: `scripts/behavior-audit/extracted-store.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/scripts/behavior-audit/extracted-store-remap.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'
import { remapKeywordsInExtractedFile } from '../../../scripts/behavior-audit/extracted-store.js'
import type { ExtractedBehaviorRecord } from '../../../scripts/behavior-audit/extracted-store.js'
import {
  applyBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  restoreBehaviorAuditEnv,
} from '../behavior-audit-integration.runtime-helpers.js'
import { createAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'

function makeRecord(overrides: Partial<ExtractedBehaviorRecord> = {}): ExtractedBehaviorRecord {
  return {
    behaviorId: 'bid-1',
    testKey: 'tests/foo.test.ts::does something',
    testFile: 'tests/foo.test.ts',
    domain: 'foo',
    testName: 'does something',
    fullPath: 'does something',
    behavior: 'When something happens',
    context: 'test context',
    keywords: ['existing-slug', 'another-slug'],
    extractedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function writeExtractedFixture(extractedDir: string, testFile: string, records: ExtractedBehaviorRecord[]): void {
  // Mirror the artifact path: EXTRACTED_DIR/<relative-path-with-slashes-as-dirs>
  const relative = testFile.replace(/\//g, path.sep)
  const artifactPath = path.join(extractedDir, relative.replace(/\.test\.ts$/, '.json'))
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(records, null, 2) + '\n')
}

let tempRoot: string
let extractedDir: string

beforeEach(() => {
  tempRoot = makeTempDir()
  const config = createAuditBehaviorConfig(tempRoot, null)
  extractedDir = config.EXTRACTED_DIR
  applyBehaviorAuditEnv(config)
  reloadBehaviorAuditConfig()
  mkdirSync(extractedDir, { recursive: true })
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('remapKeywordsInExtractedFile returns updated=false when file does not exist', async () => {
  const result = await remapKeywordsInExtractedFile('tests/nonexistent.test.ts', new Map())
  expect(result.updated).toBe(false)
  expect(result.remappedCount).toBe(0)
})

test('remapKeywordsInExtractedFile returns updated=false when no keywords match the merge map', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(extractedDir, testFile, [makeRecord({ keywords: ['a', 'b'] })])

  const mergeMap = new Map([['c', 'd']]) // 'c' not in keywords
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(false)
  expect(result.remappedCount).toBe(0)
})

test('remapKeywordsInExtractedFile remaps keywords and returns updated=true', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(extractedDir, testFile, [makeRecord({ keywords: ['old-slug', 'keep-this'] })])

  const mergeMap = new Map([['old-slug', 'new-slug']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(1)
})

test('remapKeywordsInExtractedFile deduplicates after remapping', async () => {
  const testFile = 'tests/foo.test.ts'
  writeExtractedFixture(extractedDir, testFile, [makeRecord({ keywords: ['canonical', 'alias'] })])

  const mergeMap = new Map([['alias', 'canonical']]) // both become 'canonical'
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(1) // 'alias' was remapped
})

test('remapKeywordsInExtractedFile counts remapped occurrences across all records', async () => {
  const testFile = 'tests/bar.test.ts'
  writeExtractedFixture(extractedDir, testFile, [
    makeRecord({ behaviorId: 'bid-1', keywords: ['old', 'keep'] }),
    makeRecord({ behaviorId: 'bid-2', keywords: ['other', 'old'] }),
  ])

  const mergeMap = new Map([['old', 'canonical']])
  const result = await remapKeywordsInExtractedFile(testFile, mergeMap)

  expect(result.updated).toBe(true)
  expect(result.remappedCount).toBe(2) // 'old' in each of two records
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/scripts/behavior-audit/extracted-store-remap.test.ts
```

Expected: FAIL — `remapKeywordsInExtractedFile is not exported`.

- [ ] **Step 3: Add `remapKeywordsInExtractedFile` to `scripts/behavior-audit/extracted-store.ts`**

Add import at the top:

```typescript
import { remapKeywords } from './consolidate-keywords-helpers.js'
```

Append to the end of the file:

```typescript
export async function remapKeywordsInExtractedFile(
  testFilePath: string,
  mergeMap: ReadonlyMap<string, string>,
): Promise<{ readonly updated: boolean; readonly remappedCount: number }> {
  const records = await readExtractedFile(testFilePath)
  if (records === null) return { updated: false, remappedCount: 0 }

  const remapResults = records.map((record) => {
    const remappedCount = record.keywords.filter((kw) => mergeMap.has(kw)).length
    if (remappedCount === 0) return { record, changed: false, remappedCount: 0 }
    const newKeywords = remapKeywords(record.keywords, mergeMap)
    return { record: { ...record, keywords: newKeywords }, changed: true, remappedCount }
  })

  const totalRemapped = remapResults.reduce((sum, r) => sum + r.remappedCount, 0)
  const anyChanged = remapResults.some((r) => r.changed)

  if (!anyChanged) return { updated: false, remappedCount: 0 }

  await writeExtractedFile(
    testFilePath,
    remapResults.map((r) => r.record),
  )
  return { updated: true, remappedCount: totalRemapped }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/scripts/behavior-audit/extracted-store-remap.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Run full suite**

```bash
bun test && bun typecheck
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/extracted-store.ts \
  tests/scripts/behavior-audit/extracted-store-remap.test.ts
git commit -m "feat(behavior-audit): add remapKeywordsInExtractedFile to extracted-store"
```

---

## Task 5: `embedSlugBatch` agent

**Files:**

- Create: `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts`
- Create: `scripts/behavior-audit/consolidate-keywords-agent.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts`:

```typescript
import { beforeEach, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { reloadBehaviorAuditConfig } from '../../../scripts/behavior-audit/config.js'

// Mock embedMany before importing the agent
type EmbedManyArgs = { model: unknown; values: string[] }
let embedManyImpl = (_args: EmbedManyArgs): Promise<{ embeddings: number[][] }> => Promise.resolve({ embeddings: [] })

void mock.module('ai', () => ({
  embedMany: (args: EmbedManyArgs) => embedManyImpl(args),
}))

const { embedSlugBatch } = await import('../../../scripts/behavior-audit/consolidate-keywords-agent.js')

beforeEach(() => {
  process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = 'test-model'
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_EMBED_BATCH_SIZE'] = '2'
  reloadBehaviorAuditConfig()
})

test('embedSlugBatch calls embedMany once for inputs within batch size', async () => {
  const calls: string[][] = []
  embedManyImpl = async ({ values }: EmbedManyArgs) => {
    calls.push(values)
    return { embeddings: values.map(() => [0.1, 0.2]) }
  }

  const result = await embedSlugBatch(['a: desc a', 'b: desc b'])

  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual(['a: desc a', 'b: desc b'])
  expect(result).toHaveLength(2)
})

test('embedSlugBatch splits large input across multiple batches', async () => {
  const calls: string[][] = []
  embedManyImpl = async ({ values }: EmbedManyArgs) => {
    calls.push(values)
    return { embeddings: values.map(() => [0.1, 0.2]) }
  }

  // batchSize=2, 5 inputs → 3 calls: [2, 2, 1]
  const inputs = ['a', 'b', 'c', 'd', 'e']
  const result = await embedSlugBatch(inputs)

  expect(calls).toHaveLength(3)
  expect(result).toHaveLength(5)
})

test('embedSlugBatch returns embeddings in order matching input', async () => {
  embedManyImpl = async ({ values }: EmbedManyArgs) => ({
    embeddings: values.map((_, i) => [i]),
  })

  // batchSize=2, 4 inputs
  const result = await embedSlugBatch(['a', 'b', 'c', 'd'])

  expect(result[0]).toEqual([0])
  expect(result[1]).toEqual([1])
  expect(result[2]).toEqual([0])
  expect(result[3]).toEqual([1])
})

test('embedSlugBatch throws after exhausting retries', async () => {
  process.env['BEHAVIOR_AUDIT_MAX_RETRIES'] = '2'
  reloadBehaviorAuditConfig()

  embedManyImpl = async () => {
    throw new Error('API unavailable')
  }

  await expect(embedSlugBatch(['a'])).rejects.toThrow('Failed to embed batch')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `scripts/behavior-audit/consolidate-keywords-agent.ts`**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embedMany } from 'ai'

import {
  CONSOLIDATION_EMBED_BATCH_SIZE,
  EMBEDDING_BASE_URL,
  EMBEDDING_MODEL,
  MAX_RETRIES,
  RETRY_BACKOFF_MS,
} from './config.js'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export interface EmbedSlugBatchDeps {
  readonly embedMany: typeof embedMany
}

const defaultEmbedSlugBatchDeps: EmbedSlugBatchDeps = {
  embedMany: (...args) => embedMany(...args),
}

export async function embedSlugBatch(
  slugInputs: readonly string[],
  deps: EmbedSlugBatchDeps = defaultEmbedSlugBatchDeps,
): Promise<readonly (readonly number[])[]> {
  const apiKey = process.env['OPENAI_API_KEY'] ?? 'no-key'
  const provider = createOpenAICompatible({
    name: 'behavior-audit-embed',
    apiKey,
    baseURL: EMBEDDING_BASE_URL,
  })
  const model = provider.embeddingModel(EMBEDDING_MODEL)

  const results: number[][] = []
  for (let offset = 0; offset < slugInputs.length; offset += CONSOLIDATION_EMBED_BATCH_SIZE) {
    const batch = slugInputs.slice(offset, offset + CONSOLIDATION_EMBED_BATCH_SIZE)
    let attempt = 0
    let batchResult: number[][] | null = null

    while (attempt < MAX_RETRIES) {
      if (attempt > 0) {
        const backoff = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]!
        await sleep(backoff)
      }
      try {
        const { embeddings } = await deps.embedMany({ model, values: [...batch] })
        batchResult = embeddings
        break
      } catch (error) {
        console.log(
          `✗ embedSlugBatch attempt ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`,
        )
        attempt++
      }
    }

    if (batchResult === null) {
      throw new Error(`Failed to embed batch at offset ${offset} after ${MAX_RETRIES} attempts`)
    }
    results.push(...batchResult)
  }

  return results
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Typecheck and full suite**

```bash
bun test && bun typecheck
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords-agent.ts \
  tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts
git commit -m "feat(behavior-audit): add embedSlugBatch agent for keyword consolidation"
```

---

## Task 6: `runPhase1b` orchestrator + integration tests

**Files:**

- Modify: `tests/scripts/behavior-audit-integration.support.ts`
- Create: `tests/scripts/behavior-audit-phase1b.test.ts`
- Create: `scripts/behavior-audit/consolidate-keywords.ts`

- [ ] **Step 1: Add `loadConsolidateKeywordsModule` to integration support**

In `tests/scripts/behavior-audit-integration.support.ts`, add the following at the top (imports section):

```typescript
import type * as ConsolidateKeywordsModule from '../../scripts/behavior-audit/consolidate-keywords.js'
```

Add type alias alongside the others:

```typescript
export type ConsolidateKeywordsModuleShape = typeof ConsolidateKeywordsModule
```

Add type guard function (e.g., after `isResetModule`):

```typescript
function isConsolidateKeywordsModule(value: unknown): value is ConsolidateKeywordsModuleShape {
  return isObject(value) && hasFunctionProperty(value, 'runPhase1b')
}
```

Add loader function (at the end of the file):

```typescript
export function loadConsolidateKeywordsModule(tag: string): Promise<ConsolidateKeywordsModuleShape> {
  return importWithGuard(
    `../../scripts/behavior-audit/consolidate-keywords.js?test=${tag}`,
    isConsolidateKeywordsModule,
    'Unexpected consolidate-keywords module shape',
  )
}
```

- [ ] **Step 2: Write failing integration tests**

Create `tests/scripts/behavior-audit-phase1b.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { reloadBehaviorAuditConfig } from '../../scripts/behavior-audit/config.js'
import type { KeywordVocabularyEntry } from '../../scripts/behavior-audit/keyword-vocabulary.js'
import type { Progress } from '../../scripts/behavior-audit/progress.js'
import { createEmptyProgressFixture } from './behavior-audit-integration.helpers.js'
import {
  applyBehaviorAuditEnv,
  cleanupTempDirs,
  makeTempDir,
  restoreBehaviorAuditEnv,
} from './behavior-audit-integration.runtime-helpers.js'
import { createAuditBehaviorConfig } from './behavior-audit-integration.helpers.js'
import { loadConsolidateKeywordsModule } from './behavior-audit-integration.support.js'
import type { ExtractedBehaviorRecord } from '../../scripts/behavior-audit/extracted-store.js'

function makeVocabEntry(slug: string, description = 'desc'): KeywordVocabularyEntry {
  return {
    slug,
    description,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeExtractedRecord(overrides: Partial<ExtractedBehaviorRecord> = {}): ExtractedBehaviorRecord {
  return {
    behaviorId: 'bid-1',
    testKey: 'tests/foo.test.ts::does something',
    testFile: 'tests/foo.test.ts',
    domain: 'foo',
    testName: 'does something',
    fullPath: 'does something',
    behavior: 'When something happens',
    context: 'ctx',
    keywords: ['slug-a', 'slug-b'],
    extractedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProgress(phase1Done: boolean): Progress {
  const p = createEmptyProgressFixture(1)
  if (phase1Done) p.phase1.status = 'done'
  return p
}

function writeVocab(vocabPath: string, entries: KeywordVocabularyEntry[]): void {
  mkdirSync(path.dirname(vocabPath), { recursive: true })
  writeFileSync(vocabPath, JSON.stringify(entries, null, 2) + '\n')
}

function writeExtracted(extractedDir: string, testFile: string, records: ExtractedBehaviorRecord[]): void {
  const artifactPath = path.join(extractedDir, testFile.replace(/\.test\.ts$/, '.json'))
  mkdirSync(path.dirname(artifactPath), { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(records, null, 2) + '\n')
}

function writeManifest(manifestPath: string, testFiles: string[]): void {
  const tests: Record<string, unknown> = {}
  for (const testFile of testFiles) {
    tests[`${testFile}::test`] = {
      testFile,
      testName: 'test',
      dependencyPaths: [],
      phase1Fingerprint: null,
      phase2aFingerprint: null,
      phase2Fingerprint: null,
      behaviorId: null,
      featureKey: null,
      extractedArtifactPath: null,
      classifiedArtifactPath: null,
      domain: 'test',
      lastPhase1CompletedAt: null,
      lastPhase2aCompletedAt: null,
      lastPhase2CompletedAt: null,
    }
  }
  mkdirSync(path.dirname(manifestPath), { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        lastStartCommit: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        phaseVersions: { phase1: '', phase2: '', reports: '' },
        tests,
      },
      null,
      2,
    ) + '\n',
  )
}

let tempRoot: string
const tag = crypto.randomUUID()

beforeEach(() => {
  tempRoot = makeTempDir()
  const config = createAuditBehaviorConfig(tempRoot, {
    EMBEDDING_MODEL: 'test-embed-model',
    CONSOLIDATION_THRESHOLD: 0.95,
    CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
    CONSOLIDATION_DRY_RUN: false,
    CONSOLIDATION_EMBED_BATCH_SIZE: 100,
  })
  applyBehaviorAuditEnv(config)
  reloadBehaviorAuditConfig()
  mkdirSync(config.AUDIT_BEHAVIOR_DIR, { recursive: true })
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('runPhase1b skips when phase 1 is not done', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(false) // phase 1 not done
  const savedProgress: Progress[] = []

  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => [],
    saveKeywordVocabulary: async () => {
      throw new Error('should not write vocab')
    },
    embedSlugBatch: async () => {
      throw new Error('should not embed')
    },
    loadManifest: async () => null,
    remapKeywordsInExtractedFile: async () => ({ updated: false, remappedCount: 0 }),
    saveProgress: async (p) => {
      savedProgress.push(p)
    },
    log: { log: () => {} },
  })

  expect(savedProgress).toHaveLength(0) // progress not saved
  expect(progress.phase1b.status).toBe('not-started') // unchanged
})

test('runPhase1b soft-skips when EMBEDDING_MODEL is empty', async () => {
  process.env['BEHAVIOR_AUDIT_EMBEDDING_MODEL'] = ''
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)

  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => [makeVocabEntry('slug-a')],
    saveKeywordVocabulary: async () => {
      throw new Error('should not write vocab')
    },
    embedSlugBatch: async () => {
      throw new Error('should not embed')
    },
    loadManifest: async () => null,
    remapKeywordsInExtractedFile: async () => ({ updated: false, remappedCount: 0 }),
    saveProgress: async () => {},
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(0)
})

test('runPhase1b applies merges, updates vocabulary, remaps extracted files, resets phase2/3', async () => {
  const config = createAuditBehaviorConfig(tempRoot, {
    EMBEDDING_MODEL: 'test-embed-model',
    CONSOLIDATION_THRESHOLD: 0.95,
    CONSOLIDATION_MIN_CLUSTER_SIZE: 2,
    CONSOLIDATION_DRY_RUN: false,
    CONSOLIDATION_EMBED_BATCH_SIZE: 100,
  })

  // Set up vocab with two entries that will be merged
  const vocab = [makeVocabEntry('short'), makeVocabEntry('longer-alias')]
  writeVocab(config.KEYWORD_VOCABULARY_PATH, vocab)

  // Set up extracted file
  writeExtracted(config.EXTRACTED_DIR, 'tests/foo.test.ts', [
    makeExtractedRecord({ keywords: ['longer-alias', 'other'] }),
  ])

  // Set up manifest
  writeManifest(config.INCREMENTAL_MANIFEST_PATH, ['tests/foo.test.ts'])

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase2a.status = 'done'
  progress.phase2b.status = 'done'
  progress.phase3.status = 'done'

  // The embeddings for 'short' and 'longer-alias' will be very similar (cosine >= 0.95)
  const nearlyIdentical = [1, 0, 0]
  const slightlyDifferentButClose = [0.99, 0.1, 0]
  const mag = Math.sqrt(0.99 * 0.99 + 0.1 * 0.1)
  const normalized = [0.99 / mag, 0.1 / mag, 0]

  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => vocab,
    saveKeywordVocabulary: async () => {},
    embedSlugBatch: async () => [nearlyIdentical, normalized],
    loadManifest: async () => {
      const raw = JSON.parse(await Bun.file(config.INCREMENTAL_MANIFEST_PATH).text())
      return raw as Awaited<ReturnType<(typeof import('../../scripts/behavior-audit/incremental.js'))['loadManifest']>>
    },
    remapKeywordsInExtractedFile: async (_testFile, mergeMap) => {
      expect(mergeMap.has('longer-alias')).toBe(true)
      return { updated: true, remappedCount: 1 }
    },
    saveProgress: async () => {},
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(1)
  expect(progress.phase1b.stats.behaviorsUpdated).toBe(1)
  // Phase 2/3 should be reset
  expect(progress.phase2a.status).toBe('not-started')
  expect(progress.phase2b.status).toBe('not-started')
  expect(progress.phase3.status).toBe('not-started')
})

test('runPhase1b skips when already done and vocabulary size unchanged', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase1b.status = 'done'
  progress.phase1b.stats.slugsBefore = 2

  let embedCalled = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => [makeVocabEntry('a'), makeVocabEntry('b')], // size=2 matches slugsBefore
    saveKeywordVocabulary: async () => {},
    embedSlugBatch: async () => {
      embedCalled = true
      return []
    },
    loadManifest: async () => null,
    remapKeywordsInExtractedFile: async () => ({ updated: false, remappedCount: 0 }),
    saveProgress: async () => {},
    log: { log: () => {} },
  })

  expect(embedCalled).toBe(false)
})

test('runPhase1b skips phase2/3 reset when no merges produced', async () => {
  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  progress.phase2a.status = 'done'
  progress.phase3.status = 'done'

  // Embeddings very dissimilar → no merges
  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => [makeVocabEntry('alpha'), makeVocabEntry('beta')],
    saveKeywordVocabulary: async () => {},
    embedSlugBatch: async () => [
      [1, 0, 0],
      [0, 1, 0],
    ], // orthogonal
    loadManifest: async () => null,
    remapKeywordsInExtractedFile: async () => ({ updated: false, remappedCount: 0 }),
    saveProgress: async () => {},
    log: { log: () => {} },
  })

  expect(progress.phase1b.status).toBe('done')
  expect(progress.phase1b.stats.mergesApplied).toBe(0)
  // Phase 2/3 NOT reset
  expect(progress.phase2a.status).toBe('done')
  expect(progress.phase3.status).toBe('done')
})

test('runPhase1b dry-run does not save vocabulary or progress', async () => {
  process.env['BEHAVIOR_AUDIT_CONSOLIDATION_DRY_RUN'] = '1'
  reloadBehaviorAuditConfig()

  const { runPhase1b } = await loadConsolidateKeywordsModule(tag)
  const progress = makeProgress(true)
  // Even if phase1b is 'done', dry-run always runs
  progress.phase1b.status = 'done'
  progress.phase1b.stats.slugsBefore = 2

  let vocabSaved = false
  let progressSaved = false

  await runPhase1b(progress, {
    loadKeywordVocabulary: async () => [makeVocabEntry('short'), makeVocabEntry('longer-alias')],
    saveKeywordVocabulary: async () => {
      vocabSaved = true
    },
    embedSlugBatch: async () => [
      [1, 0, 0],
      [0.99, 0.1, 0].map((v, _, arr) => v / Math.sqrt(arr.reduce((s, x) => s + x * x, 0))),
    ],
    loadManifest: async () => null,
    remapKeywordsInExtractedFile: async () => ({ updated: false, remappedCount: 0 }),
    saveProgress: async () => {
      progressSaved = true
    },
    log: { log: () => {} },
  })

  expect(vocabSaved).toBe(false)
  expect(progressSaved).toBe(false)
  expect(progress.phase1b.status).toBe('done') // unchanged from before dry-run
})
```

- [ ] **Step 3: Run integration tests to confirm they fail**

```bash
bun test tests/scripts/behavior-audit-phase1b.test.ts
```

Expected: FAIL — `consolidate-keywords.js` not found.

- [ ] **Step 4: Create `scripts/behavior-audit/consolidate-keywords.ts`**

```typescript
import {
  CONSOLIDATION_DRY_RUN,
  CONSOLIDATION_MIN_CLUSTER_SIZE,
  CONSOLIDATION_THRESHOLD,
  EMBEDDING_MODEL,
} from './config.js'
import { buildClusters, buildConsolidatedVocabulary, buildMergeMap } from './consolidate-keywords-helpers.js'
import type { embedSlugBatch as EmbedSlugBatch } from './consolidate-keywords-agent.js'
import { embedSlugBatch } from './consolidate-keywords-agent.js'
import type { remapKeywordsInExtractedFile as RemapFn } from './extracted-store.js'
import { remapKeywordsInExtractedFile } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { loadManifest } from './incremental.js'
import type { KeywordVocabularyEntry } from './keyword-vocabulary.js'
import { loadKeywordVocabulary, saveKeywordVocabulary } from './keyword-vocabulary.js'
import {
  emptyPhase1b,
  emptyPhase2a,
  emptyPhase2b,
  emptyPhase3,
  resetPhase2AndPhase3,
  saveProgress,
  type Progress,
} from './progress.js'

export interface Phase1bDeps {
  readonly loadKeywordVocabulary: typeof loadKeywordVocabulary
  readonly saveKeywordVocabulary: typeof saveKeywordVocabulary
  readonly embedSlugBatch: typeof EmbedSlugBatch
  readonly loadManifest: () => Promise<IncrementalManifest | null>
  readonly remapKeywordsInExtractedFile: typeof RemapFn
  readonly saveProgress: typeof saveProgress
  readonly log: Pick<typeof console, 'log'>
}

const defaultPhase1bDeps: Phase1bDeps = {
  loadKeywordVocabulary,
  saveKeywordVocabulary,
  embedSlugBatch,
  loadManifest,
  remapKeywordsInExtractedFile,
  saveProgress,
  log: console,
}

export async function runPhase1b(progress: Progress, deps: Phase1bDeps = defaultPhase1bDeps): Promise<void> {
  if (progress.phase1.status !== 'done') {
    deps.log.log('[Phase 1b] Phase 1 not complete, skipping.\n')
    return
  }

  const now = new Date().toISOString()

  if (EMBEDDING_MODEL === '') {
    deps.log.log('[Phase 1b] Embedding model not configured, skipping.\n')
    progress.phase1b = {
      status: 'done',
      lastRunAt: now,
      threshold: 0,
      stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
    }
    await deps.saveProgress(progress)
    return
  }

  const vocabulary = await deps.loadKeywordVocabulary()
  if (vocabulary === null) {
    deps.log.log('[Phase 1b] No vocabulary found, skipping.\n')
    progress.phase1b = {
      status: 'done',
      lastRunAt: now,
      threshold: CONSOLIDATION_THRESHOLD,
      stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
    }
    await deps.saveProgress(progress)
    return
  }

  if (
    !CONSOLIDATION_DRY_RUN &&
    progress.phase1b.status === 'done' &&
    vocabulary.length === progress.phase1b.stats.slugsBefore
  ) {
    deps.log.log('[Phase 1b] Already complete, skipping.\n')
    return
  }

  deps.log.log(`[Phase 1b] Embedding ${vocabulary.length} slugs...`)

  if (!CONSOLIDATION_DRY_RUN) {
    progress.phase1b.status = 'in-progress'
    await deps.saveProgress(progress)
  }

  const slugInputs = vocabulary.map((e) => `${e.slug}: ${e.description}`)
  const embeddings = await deps.embedSlugBatch(slugInputs)

  deps.log.log(`[Phase 1b] Clustering at threshold ${CONSOLIDATION_THRESHOLD}...`)
  const clusters = buildClusters(embeddings, CONSOLIDATION_THRESHOLD, CONSOLIDATION_MIN_CLUSTER_SIZE)
  const mergeMap = buildMergeMap(vocabulary, clusters)

  if (CONSOLIDATION_DRY_RUN) {
    deps.log.log(`[Phase 1b DRY RUN] Proposed merges at threshold ${CONSOLIDATION_THRESHOLD}:`)
    for (const [oldSlug, canonicalSlug] of mergeMap.entries()) {
      deps.log.log(`  ${oldSlug.padEnd(30)} → ${canonicalSlug}`)
    }
    deps.log.log(`No files were modified.`)
    return
  }

  if (mergeMap.size === 0) {
    deps.log.log('[Phase 1b] No merges needed.\n')
    progress.phase1b = {
      status: 'done',
      lastRunAt: now,
      threshold: CONSOLIDATION_THRESHOLD,
      stats: {
        slugsBefore: vocabulary.length,
        slugsAfter: vocabulary.length,
        mergesApplied: 0,
        behaviorsUpdated: 0,
        keywordsRemapped: 0,
      },
    }
    await deps.saveProgress(progress)
    return
  }

  const consolidatedVocabulary = buildConsolidatedVocabulary(vocabulary, mergeMap, now)
  await deps.saveKeywordVocabulary(consolidatedVocabulary)

  const manifest = await deps.loadManifest()
  let behaviorsUpdated = 0
  let keywordsRemapped = 0
  if (manifest !== null) {
    const testFiles = [...new Set(Object.values(manifest.tests).map((e) => e.testFile))]
    for (const testFile of testFiles) {
      const result = await deps.remapKeywordsInExtractedFile(testFile, mergeMap)
      if (result.updated) behaviorsUpdated++
      keywordsRemapped += result.remappedCount
    }
  }

  resetPhase2AndPhase3(progress)

  const slugsAfter = consolidatedVocabulary.length
  deps.log.log(`[Phase 1b complete] ${vocabulary.length} → ${slugsAfter} slugs, ${mergeMap.size} merges applied\n`)

  progress.phase1b = {
    status: 'done',
    lastRunAt: now,
    threshold: CONSOLIDATION_THRESHOLD,
    stats: {
      slugsBefore: vocabulary.length,
      slugsAfter,
      mergesApplied: mergeMap.size,
      behaviorsUpdated,
      keywordsRemapped,
    },
  }
  await deps.saveProgress(progress)
}
```

- [ ] **Step 5: Run integration tests**

```bash
bun test tests/scripts/behavior-audit-phase1b.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Run full test suite and typecheck**

```bash
bun test && bun typecheck
```

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/consolidate-keywords.ts \
  tests/scripts/behavior-audit/consolidate-keywords-agent.test.ts \
  tests/scripts/behavior-audit-phase1b.test.ts \
  tests/scripts/behavior-audit-integration.support.ts
git commit -m "feat(behavior-audit): add runPhase1b keyword consolidation orchestrator"
```

---

## Task 7: `extract.ts` — replace `resetPhase2AndPhase3` with `resetPhase1bAndBelow`

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`

When phase 1 re-extracts any test, it must also invalidate phase 1b (so the updated vocabulary gets re-consolidated before phase 2a runs again). `resetPhase1bAndBelow` resets phase1b + phase2a + phase2b + phase3, which is a superset of `resetPhase2AndPhase3`.

- [ ] **Step 1: Update the import in `scripts/behavior-audit/extract.ts`**

In the import from `./progress.js`, replace `resetPhase2AndPhase3` with `resetPhase1bAndBelow`:

```typescript
import {
  type Progress,
  getFailedTestAttempts,
  markTestDone,
  markTestFailed,
  resetPhase1bAndBelow,
  saveProgress,
} from './progress.js'
```

- [ ] **Step 2: Update `Phase1Deps` interface**

Replace:

```typescript
  readonly resetPhase2AndPhase3: typeof resetPhase2AndPhase3
```

With:

```typescript
  readonly resetPhase1bAndBelow: typeof resetPhase1bAndBelow
```

- [ ] **Step 3: Find and update the call site**

Search for `resetPhase2AndPhase3` in `extract.ts` (around line 150–220 where new tests trigger a downstream reset). Replace every call:

```typescript
deps.resetPhase2AndPhase3(progress)
```

With:

```typescript
deps.resetPhase1bAndBelow(progress)
```

- [ ] **Step 4: Update the default deps object**

In the default `Phase1Deps` object (near the bottom of `extract.ts`), update:

```typescript
  resetPhase1bAndBelow,
```

(Remove the `resetPhase2AndPhase3` entry and add `resetPhase1bAndBelow`.)

- [ ] **Step 5: Run tests**

```bash
bun test && bun typecheck
```

Expected: All pass. The existing extract integration tests (`behavior-audit-phase1-keywords.test.ts`, `behavior-audit-phase1-selection.test.ts`, `behavior-audit-phase1-write-failure.test.ts`) must pass with the updated dep name.

> **Note:** If any existing test constructs a `Phase1Deps` object directly with `resetPhase2AndPhase3`, you must update those test objects too. Search for `resetPhase2AndPhase3` in `tests/` and replace with `resetPhase1bAndBelow`.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/extract.ts
git commit -m "feat(behavior-audit): use resetPhase1bAndBelow in Phase1 to invalidate phase1b on re-extract"
```

---

## Task 8: Wire `runPhase1bIfNeeded` into the main runner

**Files:**

- Modify: `scripts/behavior-audit.ts`

- [ ] **Step 1: Add the import**

Add to the imports section:

```typescript
import { runPhase1b } from './behavior-audit/consolidate-keywords.js'
```

- [ ] **Step 2: Add `runPhase1bIfNeeded` function**

Add after `runPhase1IfNeeded`:

```typescript
async function runPhase1bIfNeeded(progress: Progress): Promise<void> {
  await runPhase1b(progress)
}
```

- [ ] **Step 3: Add to `BehaviorAuditDeps` interface**

Add after `runPhase1IfNeeded`:

```typescript
  readonly runPhase1bIfNeeded: typeof runPhase1bIfNeeded
```

- [ ] **Step 4: Add to `defaultBehaviorAuditDeps`**

```typescript
  runPhase1bIfNeeded,
```

- [ ] **Step 5: Wire into `runBehaviorAudit`**

In `runBehaviorAudit`, between the `runPhase1IfNeeded` call and the `runPhase2aIfNeeded` call, add:

```typescript
await deps.runPhase1bIfNeeded(progress)
```

The updated sequence in `runBehaviorAudit`:

```typescript
await deps.runPhase1IfNeeded(parsedFiles, progress, new Set(selection.phase1SelectedTestKeys), updatedManifest)
await deps.runPhase1bIfNeeded(progress)
const dirtyFromPhase2a = await deps.runPhase2aIfNeeded(
  progress,
  updatedManifest,
  new Set(selection.phase2aSelectedTestKeys),
)
```

- [ ] **Step 6: Run tests and typecheck**

```bash
bun test && bun typecheck
```

Expected: All pass. The existing entrypoint integration test (`behavior-audit-entrypoint.test.ts`) constructs `BehaviorAuditDeps` — update it to include `runPhase1bIfNeeded: async () => {}` if needed (search for `runPhase1IfNeeded` in tests and add the adjacent `runPhase1bIfNeeded` dep alongside it).

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit.ts
git commit -m "feat(behavior-audit): wire runPhase1b between phase 1 and phase 2a in main runner"
```

---

## Final verification

- [ ] **Run the complete test suite**

```bash
bun test
```

Expected: All tests pass.

- [ ] **Run typecheck**

```bash
bun typecheck
```

Expected: No errors.

- [ ] **Run lint**

```bash
bun lint
```

Expected: No warnings or errors.

- [ ] **Run format check**

```bash
bun format:check
```

Expected: No formatting issues. If issues exist, run `bun format` and commit.

---

## Spec Coverage Self-Review

| Spec Requirement                                                                            | Covered By                                         |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Phase 1b pipeline step after Phase 1, before Phase 2a                                       | Task 8 (wiring)                                    |
| Embedding-based cosine similarity clustering                                                | Task 3 (`buildClusters`, `cosineSimilarity`)       |
| Union-find for transitive merging                                                           | Task 3 (`buildUnionFind`, `find`, `union`)         |
| Canonical election: shortest slug, tie-break by createdAt                                   | Task 3 (`electCanonical`)                          |
| Longest description for merged entry                                                        | Task 3 (`buildConsolidatedVocabulary`)             |
| `remapKeywords` with deduplication                                                          | Task 3 (`remapKeywords`)                           |
| Remap extracted behavior files                                                              | Task 4 (`remapKeywordsInExtractedFile`)            |
| Vocabulary written atomically (fail-fast before touching behavior files)                    | Task 6 (`saveKeywordVocabulary` before remap loop) |
| Reset Phase 2/3 when merges applied                                                         | Task 6 (`resetPhase2AndPhase3` in `runPhase1b`)    |
| Soft-skip when `EMBEDDING_MODEL` is empty                                                   | Task 6 (guard in `runPhase1b`)                     |
| Dry-run mode (no file writes, prints merge table)                                           | Task 6 (dry-run branch in `runPhase1b`)            |
| Idempotency: skip when done and vocab size unchanged                                        | Task 6 (idempotency check)                         |
| Phase 1 re-extraction invalidates Phase 1b                                                  | Task 7 (`resetPhase1bAndBelow` in `extract.ts`)    |
| Progress version bump 4 → 5                                                                 | Task 1                                             |
| v4 → v5 migration (inject `phase1b`)                                                        | Task 1                                             |
| 6 new config env vars with defaults                                                         | Task 2                                             |
| `EMBEDDING_BASE_URL` defaults to `BASE_URL`                                                 | Task 2                                             |
| `embedMany` batching with retry                                                             | Task 5 (`embedSlugBatch`)                          |
| Stats: `slugsBefore`, `slugsAfter`, `mergesApplied`, `behaviorsUpdated`, `keywordsRemapped` | Task 6 (`progress.phase1b.stats`)                  |
| Log messages for each major step                                                            | Task 6 (`deps.log.log` calls)                      |
| Unit tests for pure clustering helpers                                                      | Task 3                                             |
| Integration tests for `runPhase1b`                                                          | Task 6                                             |
