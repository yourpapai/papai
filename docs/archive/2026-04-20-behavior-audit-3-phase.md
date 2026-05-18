# Behavior Audit — 3-Phase Restructure

> **Superseded:** Do not execute this plan as written. The approved replacement design is `docs/superpowers/specs/2026-04-20-behavior-audit-keyword-batching-design.md`, and a new implementation plan must be used for execution. This file is kept only as historical context for the original domain-grouped 3-phase restructure.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the current 2-phase audit (extract → score) into 3 phases: extract → consolidate/classify → score, so that persona scoring only runs on user-facing, feature-level behaviors rather than on per-test implementation details.

**Architecture:** Phase 1 remains unchanged (per-test LLM behavior extraction, writes structured data to `progress.phase1.extractedBehaviors` and markdown reports to `reports/behaviors/`). Phase 2 (new) reads structured Phase 1 data from progress grouped by domain, calls a consolidation LLM that classifies behaviors as user-facing or internal and merges related edge-case tests into feature-level descriptions with user stories, writes consolidated JSON to `reports/consolidated/<domain>.json`, and tracks provenance via a new consolidated manifest. Phase 3 (was Phase 2) reads user-facing consolidated behaviors, runs persona scoring, and produces stories/reports.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK (`generateText`, `Output.object`), Zod v4, `p-limit`. All scripts live under `scripts/behavior-audit/`. Entry point: `scripts/behavior-audit.ts`.

---

## Context: Current Structure

```
scripts/behavior-audit.ts          ← entry point (calls runPhase1 + runPhase2)
scripts/behavior-audit/
  config.ts                        ← paths, timeouts, constants
  progress.ts                      ← Progress type, load/save helpers
  incremental.ts                   ← IncrementalManifest, fingerprinting, selection
  test-parser.ts                   ← parse .test.ts files
  tools.ts                         ← readFile/grep/listDir tools for LLM
  extract.ts                       ← Phase 1 runner (runPhase1)
  extract-incremental.ts           ← manifest updates for Phase 1
  evaluate.ts                      ← Phase 2 runner (runPhase2)  ← BECOMES Phase 3
  evaluate-agent.ts                ← LLM scoring call             ← UPDATE
  evaluate-reporting.ts            ← recordEval / recordStoredEvaluation / writeReports
  report-writer.ts                 ← writeBehaviorFile / writeStoryFile / writeIndexFile
  domain-map.ts                    ← test path → domain string
  personas.ts                      ← Maria, Dani, Viktor persona text
```

**Key current types** (read these before coding):

- `ExtractedBehavior` in `report-writer.ts`: `{ testName, fullPath, behavior, context }`
- `EvaluatedBehavior` in `report-writer.ts`: `{ testName, behavior, userStory, maria, dani, viktor, flaws, improvements }`
- `EvalResult` in `evaluate-agent.ts`: `{ userStory, maria, dani, viktor, flaws, improvements }`
- `Progress` in `progress.ts`: `{ phase1: Phase1Progress, phase2: Phase2Progress }`
- `Phase2Progress`: `{ status, completedBehaviors, evaluations, failedBehaviors, stats }`
- `IncrementalManifest` in `incremental.ts`: `{ version, tests: Record<testKey, ManifestTestEntry>, phaseVersions }`

---

## File Map

| File                                            | Action | Responsibility change                                                                                                             |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/config.ts`              | Modify | Add `CONSOLIDATED_DIR`, add `PHASE3_TIMEOUT_MS`, keep `PHASE2_TIMEOUT_MS` for consolidation                                       |
| `scripts/behavior-audit/progress.ts`            | Modify | Bump schema version to 2; add `phase2` consolidation shape; rename current `phase2` to `phase3`; Zod-validate on load             |
| `scripts/behavior-audit/consolidate-agent.ts`   | Create | LLM call: per-domain classify + consolidate + user-story generation using `Output.object` with Zod schema                         |
| `scripts/behavior-audit/consolidate.ts`         | Create | Phase 2 runner: group Phase 1 structured data by domain, call agent, write consolidated JSON, update manifest                     |
| `scripts/behavior-audit/evaluate-agent.ts`      | Modify | Remove `userStory` from response schema; use `Output.object` with Zod schema for structured output                                |
| `scripts/behavior-audit/evaluate.ts`            | Modify | Read from `CONSOLIDATED_DIR`; filter to user-facing; use `phase3` progress; rename export to `runPhase3`                          |
| `scripts/behavior-audit/evaluate-reporting.ts`  | Modify | Add `userStory` parameter to `recordEval`; migrate all `phase2` references to `phase3`                                            |
| `scripts/behavior-audit/report-writer.ts`       | Modify | Add `ConsolidatedBehavior` type with full source test keys; add `writeConsolidatedFile`; update `rebuildReportsFromStoredResults` |
| `scripts/behavior-audit/incremental.ts`         | Modify | Add consolidated manifest type (`ConsolidatedManifest`); add phase2/phase3 invalidation logic                                     |
| `scripts/behavior-audit/extract-incremental.ts` | Modify | Reset downstream phase2/phase3 state when Phase 1 fingerprint changes                                                             |
| `scripts/behavior-audit.ts`                     | Modify | Wire 3 phases with downstream invalidation; pass consolidated keys to Phase 3                                                     |

---

## Task 1: Extend config.ts

**Files:**

- Modify: `scripts/behavior-audit/config.ts`

- [ ] **Step 1: Add `CONSOLIDATED_DIR` and `PHASE3_TIMEOUT_MS`, keep `PHASE2_TIMEOUT_MS`**

Replace the contents of `config.ts`:

```typescript
import { resolve } from 'node:path'

export const MODEL = 'Gemma-4-26B-A4B'
export const BASE_URL = 'http://localhost:8000/v1'

export const PROJECT_ROOT = resolve(import.meta.dir, '../..')

export const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
export const BEHAVIORS_DIR = resolve(REPORTS_DIR, 'behaviors')
export const CONSOLIDATED_DIR = resolve(REPORTS_DIR, 'consolidated')
export const STORIES_DIR = resolve(REPORTS_DIR, 'stories')
export const PROGRESS_PATH = resolve(REPORTS_DIR, 'progress.json')
export const INCREMENTAL_MANIFEST_PATH = resolve(REPORTS_DIR, 'incremental-manifest.json')

export const PHASE1_TIMEOUT_MS = 1_200_000
export const PHASE2_TIMEOUT_MS = 300_000
export const PHASE3_TIMEOUT_MS = 600_000
export const MAX_RETRIES = 3
export const RETRY_BACKOFF_MS = [100_000, 300_000, 900_000] as const
export const MAX_STEPS = 20

export const EXCLUDED_PREFIXES = [
  'tests/e2e/',
  'tests/client/',
  'tests/helpers/',
  'tests/scripts/',
  'tests/review-loop/',
  'tests/types/',
] as const
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun typecheck 2>&1 | grep "behavior-audit/config"
```

Expected: no errors for config.ts.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/config.ts
git commit -m "chore(audit): add CONSOLIDATED_DIR + PHASE3_TIMEOUT_MS to config"
```

---

## Task 2: Add ConsolidatedBehavior type and file I/O to report-writer.ts

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts`

- [ ] **Step 1: Add `ConsolidatedBehavior` interface and `writeConsolidatedFile` / `readConsolidatedFile`**

Add the following after the existing `EvaluatedBehavior` interface in `report-writer.ts`:

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
}
```

Note: `sourceTestKeys` stores full test keys (`testFile::fullPath`) for unique traceability and downstream invalidation. `id` is derived from a stable hash of sorted source test keys plus domain.

Add the following functions after `writeBehaviorFile`:

```typescript
export async function writeConsolidatedFile(
  domain: string,
  consolidations: readonly ConsolidatedBehavior[],
): Promise<void> {
  const outPath = join(CONSOLIDATED_DIR, `${domain}.json`)
  await mkdir(dirname(outPath), { recursive: true })
  const sorted = [...consolidations].toSorted((a, b) => a.id.localeCompare(b.id))
  await Bun.write(outPath, JSON.stringify(sorted, null, 2) + '\n')
}

export async function readConsolidatedFile(domain: string): Promise<readonly ConsolidatedBehavior[] | null> {
  const filePath = join(CONSOLIDATED_DIR, `${domain}.json`)
  try {
    const text = await Bun.file(filePath).text()
    const raw: unknown = JSON.parse(text)
    if (!Array.isArray(raw)) return null
    return ConsolidatedBehaviorArraySchema.parse(raw)
  } catch {
    return null
  }
}
```

Add the Zod schema for validating consolidated files on read, after the new type:

```typescript
const ConsolidatedBehaviorSchema = z.object({
  id: z.string(),
  domain: z.string(),
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
})

const ConsolidatedBehaviorArraySchema = z.array(ConsolidatedBehaviorSchema).readonly()
```

Update the config import at the top of `report-writer.ts` to include `CONSOLIDATED_DIR`:

```typescript
import { BEHAVIORS_DIR, CONSOLIDATED_DIR, STORIES_DIR } from './config.js'
```

(Replace the existing `import { BEHAVIORS_DIR, STORIES_DIR } from './config.js'` line.)

Add the `z` import if not already present:

```typescript
import { z } from 'zod'
```

- [ ] **Step 2: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "report-writer"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts
git commit -m "feat(audit): add ConsolidatedBehavior type, Zod-validated file I/O"
```

---

## Task 3: Update progress.ts for 3-phase structure with Zod validation and schema versioning

**Files:**

- Modify: `scripts/behavior-audit/progress.ts`

This is the largest structural change. The `Progress` interface gains a `phase2` consolidation section; the current `phase2` becomes `phase3`. The schema version bumps from 1 to 2. Loading validates with Zod.

- [ ] **Step 1: Rewrite progress.ts**

Replace the full content of `progress.ts` with:

```typescript
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { PROGRESS_PATH } from './config.js'
import type { ConsolidatedBehavior } from './report-writer.js'
import type { EvaluatedBehavior } from './report-writer.js'

type PhaseStatus = 'not-started' | 'in-progress' | 'done'

interface FailedEntry {
  readonly error: string
  readonly attempts: number
  readonly lastAttempt: string
}

interface Phase1Progress {
  status: PhaseStatus
  completedTests: Record<string, Record<string, 'done'>>
  extractedBehaviors: Record<string, EvaluatedBehavior>
  failedTests: Record<string, FailedEntry>
  completedFiles: string[]
  stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
}

interface Phase2Progress {
  status: PhaseStatus
  completedDomains: Record<string, 'done'>
  consolidations: Record<string, readonly ConsolidatedBehavior[]>
  failedDomains: Record<string, FailedEntry>
  stats: { domainsTotal: number; domainsDone: number; domainsFailed: number; behaviorsConsolidated: number }
}

interface Phase3Progress {
  status: PhaseStatus
  completedBehaviors: Record<string, 'done'>
  evaluations: Record<string, EvaluatedBehavior>
  failedBehaviors: Record<string, FailedEntry>
  stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
}

export interface Progress {
  version: 2
  startedAt: string
  phase1: Phase1Progress
  phase2: Phase2Progress
  phase3: Phase3Progress
}

const Phase1StatsSchema = z.object({
  filesTotal: z.number(),
  filesDone: z.number(),
  testsExtracted: z.number(),
  testsFailed: z.number(),
})

const FailedEntrySchema = z.object({
  error: z.string(),
  attempts: z.number(),
  lastAttempt: z.string(),
})

const Phase1ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedTests: z.record(z.string(), z.record(z.string(), z.literal('done'))),
  extractedBehaviors: z.record(z.string(), z.unknown()),
  failedTests: z.record(z.string(), FailedEntrySchema),
  completedFiles: z.array(z.string()),
  stats: Phase1StatsSchema,
})

const Phase2StatsSchema = z.object({
  domainsTotal: z.number(),
  domainsDone: z.number(),
  domainsFailed: z.number(),
  behaviorsConsolidated: z.number(),
})

const Phase2ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedDomains: z.record(z.string(), z.literal('done')),
  consolidations: z.record(z.string(), z.unknown()),
  failedDomains: z.record(z.string(), FailedEntrySchema),
  stats: Phase2StatsSchema,
})

const Phase3StatsSchema = z.object({
  behaviorsTotal: z.number(),
  behaviorsDone: z.number(),
  behaviorsFailed: z.number(),
})

const Phase3ProgressSchema = z.object({
  status: z.enum(['not-started', 'in-progress', 'done']),
  completedBehaviors: z.record(z.string(), z.literal('done')),
  evaluations: z.record(z.string(), z.unknown()),
  failedBehaviors: z.record(z.string(), FailedEntrySchema),
  stats: Phase3StatsSchema,
})

const ProgressV2Schema = z.object({
  version: z.literal(2),
  startedAt: z.string(),
  phase1: Phase1ProgressSchema,
  phase2: Phase2ProgressSchema,
  phase3: Phase3ProgressSchema,
})

function emptyPhase2Stats(): Phase2Progress['stats'] {
  return { domainsTotal: 0, domainsDone: 0, domainsFailed: 0, behaviorsConsolidated: 0 }
}

function emptyPhase3Stats(): Phase3Progress['stats'] {
  return { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 }
}

function emptyPhase2(): Phase2Progress {
  return {
    status: 'not-started',
    completedDomains: {},
    consolidations: {},
    failedDomains: {},
    stats: emptyPhase2Stats(),
  }
}

function emptyPhase3(): Phase3Progress {
  return {
    status: 'not-started',
    completedBehaviors: {},
    evaluations: {},
    failedBehaviors: {},
    stats: emptyPhase3Stats(),
  }
}

function migratePhase3FromLegacy(raw: Record<string, unknown>): Phase3Progress {
  const legacyPhase2 = raw['phase2']
  if (typeof legacyPhase2 === 'object' && legacyPhase2 !== null && 'evaluations' in legacyPhase2) {
    const lp = legacyPhase2 as Record<string, unknown>
    return {
      status: (lp['status'] as PhaseStatus | undefined) ?? 'not-started',
      completedBehaviors: (lp['completedBehaviors'] as Record<string, 'done'> | undefined) ?? {},
      evaluations: (lp['evaluations'] as Record<string, EvaluatedBehavior> | undefined) ?? {},
      failedBehaviors: (lp['failedBehaviors'] as Record<string, FailedEntry> | undefined) ?? {},
      stats: (lp['stats'] as Phase3Progress['stats'] | undefined) ?? emptyPhase3Stats(),
    }
  }
  return emptyPhase3()
}

function migrateV1toV2(raw: unknown): Progress {
  const r = raw as Record<string, unknown>
  const phase1 = r['phase1'] as Phase1Progress
  const extractedBehaviors =
    typeof phase1['extractedBehaviors'] === 'object' && phase1['extractedBehaviors'] !== null
      ? phase1['extractedBehaviors']
      : {}
  return {
    version: 2,
    startedAt: (r['startedAt'] as string) ?? new Date().toISOString(),
    phase1: { ...phase1, extractedBehaviors },
    phase2: emptyPhase2(),
    phase3: migratePhase3FromLegacy(r),
  }
}

function validateOrMigrateProgress(raw: unknown): Progress | null {
  const v2Result = ProgressV2Schema.safeParse(raw)
  if (v2Result.success) return v2Result.data as unknown as Progress

  if (typeof raw === 'object' && raw !== null && 'startedAt' in raw && 'phase1' in raw) {
    return migrateV1toV2(raw)
  }

  return null
}

export function createEmptyProgress(filesTotal: number): Progress {
  return {
    version: 2,
    startedAt: new Date().toISOString(),
    phase1: {
      status: 'not-started',
      completedTests: {},
      extractedBehaviors: {},
      failedTests: {},
      completedFiles: [],
      stats: { filesTotal, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
    },
    phase2: emptyPhase2(),
    phase3: emptyPhase3(),
  }
}

export async function loadProgress(): Promise<Progress | null> {
  try {
    const text = await Bun.file(PROGRESS_PATH).text()
    return validateOrMigrateProgress(JSON.parse(text))
  } catch {
    return null
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true })
  await Bun.write(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n')
}

// ── Phase 1 helpers (unchanged) ────────────────────────────────────────────

export function isFileCompleted(progress: Progress, filePath: string): boolean {
  return progress.phase1.completedFiles.includes(filePath)
}

function ensureCompletedTestsForFile(progress: Progress, filePath: string): Record<string, 'done'> {
  const existing = progress.phase1.completedTests[filePath]
  if (existing !== undefined) return existing
  const created: Record<string, 'done'> = {}
  progress.phase1.completedTests[filePath] = created
  return created
}

export function markTestDone(progress: Progress, filePath: string, testKey: string, behavior: unknown): void {
  const completedTests = ensureCompletedTestsForFile(progress, filePath)
  progress.phase1.extractedBehaviors[testKey] = behavior
  if (completedTests[testKey] === 'done') return
  completedTests[testKey] = 'done'
  progress.phase1.stats.testsExtracted++
}

export function markTestFailed(progress: Progress, testKey: string, error: string): void {
  const existing = progress.phase1.failedTests[testKey]
  const attempts = existing === undefined ? 0 : existing.attempts
  progress.phase1.failedTests[testKey] = {
    error,
    attempts: attempts + 1,
    lastAttempt: new Date().toISOString(),
  }
  progress.phase1.stats.testsFailed++
}

export function markFileDone(progress: Progress, filePath: string): void {
  if (progress.phase1.completedFiles.includes(filePath)) return
  progress.phase1.completedFiles.push(filePath)
  progress.phase1.stats.filesDone++
}

export function getFailedTestAttempts(progress: Progress, testKey: string): number {
  return progress.phase1.failedTests[testKey]?.attempts ?? 0
}

// ── Phase 2 helpers (consolidation) ───────────────────────────────────────

export function isDomainCompleted(progress: Progress, domain: string): boolean {
  return progress.phase2.completedDomains[domain] === 'done'
}

export function markDomainDone(
  progress: Progress,
  domain: string,
  consolidations: readonly ConsolidatedBehavior[],
): void {
  if (progress.phase2.completedDomains[domain] === 'done') return
  progress.phase2.completedDomains[domain] = 'done'
  progress.phase2.consolidations[domain] = consolidations
  progress.phase2.stats.domainsDone++
  progress.phase2.stats.behaviorsConsolidated += consolidations.length
}

export function markDomainFailed(progress: Progress, domain: string, error: string, attempts: number): void {
  progress.phase2.failedDomains[domain] = { error, attempts, lastAttempt: new Date().toISOString() }
  progress.phase2.stats.domainsFailed++
}

export function getFailedDomainAttempts(progress: Progress, domain: string): number {
  return progress.phase2.failedDomains[domain]?.attempts ?? 0
}

// ── Phase 3 helpers (persona scoring) ────────────────────────────────────

export function isBehaviorCompleted(progress: Progress, key: string): boolean {
  return progress.phase3.completedBehaviors[key] === 'done'
}

export function markBehaviorDone(progress: Progress, key: string, evaluation: EvaluatedBehavior): void {
  if (progress.phase3.completedBehaviors[key] === 'done') return
  progress.phase3.completedBehaviors[key] = 'done'
  progress.phase3.evaluations[key] = evaluation
  progress.phase3.stats.behaviorsDone++
}

export function markBehaviorFailed(progress: Progress, key: string, error: string, attempts: number): void {
  progress.phase3.failedBehaviors[key] = { error, attempts, lastAttempt: new Date().toISOString() }
  progress.phase3.stats.behaviorsFailed++
}

export function getFailedBehaviorAttempts(progress: Progress, key: string): number {
  return progress.phase3.failedBehaviors[key]?.attempts ?? 0
}

// ── Downstream invalidation ───────────────────────────────────────────────

export function resetPhase2AndPhase3(progress: Progress): void {
  progress.phase2 = emptyPhase2()
  progress.phase3 = emptyPhase3()
}

export function resetPhase3(progress: Progress): void {
  progress.phase3 = emptyPhase3()
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "progress"
```

Expected: no errors for progress.ts. There will be compile errors in other files referencing the old `phase2` shape — these are fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/progress.ts
git commit -m "feat(audit): add phase2 consolidation + phase3 scoring, Zod validation, schema v2"
```

---

## Task 4: Update incremental.ts — add consolidated manifest and phase invalidation

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`

The manifest needs to track consolidated behavior provenance so that Phase 3 can be properly selected and report rebuilds can find evaluations by consolidated ID.

- [ ] **Step 1: Add `ConsolidatedManifest` type and helpers**

Add these after the existing `IncrementalSelection` interface (around line 38):

```typescript
export interface ConsolidatedManifestEntry {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly sourceTestKeys: readonly string[]
  readonly isUserFacing: boolean
  readonly phase2Fingerprint: string | null
  readonly lastConsolidatedAt: string | null
}

export interface ConsolidatedManifest {
  readonly version: 1
  readonly entries: Record<string, ConsolidatedManifestEntry>
}
```

Add the Zod schemas for the new types after the existing schemas:

```typescript
const ConsolidatedManifestEntrySchema = z.object({
  consolidatedId: z.string(),
  domain: z.string(),
  featureName: z.string(),
  sourceTestKeys: z.array(z.string()),
  isUserFacing: z.boolean(),
  phase2Fingerprint: z.string().nullable(),
  lastConsolidatedAt: z.string().nullable(),
})

const ConsolidatedManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), ConsolidatedManifestEntrySchema),
})
```

Add a `createEmptyConsolidatedManifest` function after `createEmptyManifest`:

```typescript
export function createEmptyConsolidatedManifest(): ConsolidatedManifest {
  return { version: 1, entries: {} }
}
```

Add load/save helpers for the consolidated manifest. Add the `CONSOLIDATED_MANIFEST_PATH` constant to `config.ts` first (see below), then add these functions:

```typescript
export async function loadConsolidatedManifest(): Promise<ConsolidatedManifest | null> {
  const manifestFile = Bun.file(CONSOLIDATED_MANIFEST_PATH)
  if (!(await manifestFile.exists())) return null
  const text = await manifestFile.text()
  return ConsolidatedManifestSchema.parse(JSON.parse(text))
}

export async function saveConsolidatedManifest(manifest: ConsolidatedManifest): Promise<void> {
  const parsed = ConsolidatedManifestSchema.parse(manifest)
  const manifestDir = dirname(CONSOLIDATED_MANIFEST_PATH)
  const tempPath = join(
    manifestDir,
    `.${basename(CONSOLIDATED_MANIFEST_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  await mkdir(manifestDir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(parsed, null, 2) + '\n')
  await rename(tempPath, CONSOLIDATED_MANIFEST_PATH)
}

export function buildPhase2ConsolidationFingerprint(input: {
  readonly sourceTestKeys: readonly string[]
  readonly behaviors: readonly string[]
  readonly phaseVersion: string
}): string {
  return sha256Json(input)
}
```

Update the `IncrementalSelection` interface to add Phase 3 keys:

```typescript
export interface IncrementalSelection {
  readonly phase1SelectedTestKeys: readonly string[]
  readonly phase2SelectedTestKeys: readonly string[]
  readonly phase3SelectedConsolidatedIds: readonly string[]
  readonly reportRebuildOnly: boolean
}
```

Update the `selectIncrementalWork` function return values to include `phase3SelectedConsolidatedIds`. In `selectIncrementalWork`, add a `phase3Version` check and derive Phase 3 keys from the consolidated manifest:

Add to `SelectIncrementalWorkInput`:

```typescript
interface SelectIncrementalWorkInput {
  readonly changedFiles: readonly string[]
  readonly previousManifest: IncrementalManifest
  readonly currentPhaseVersions: IncrementalManifest['phaseVersions']
  readonly discoveredTestKeys: readonly string[]
  readonly previousConsolidatedManifest: ConsolidatedManifest | null
}
```

At the end of `selectIncrementalWork`, before the return, add:

```typescript
const consolidatedManifest = input.previousConsolidatedManifest
const phase3SelectedConsolidatedIds: string[] = []

if (phase1SelectedTestKeys.length > 0 && consolidatedManifest !== null) {
  const phase1Set = new Set(phase1SelectedTestKeys)
  for (const [id, entry] of Object.entries(consolidatedManifest.entries)) {
    if (entry.sourceTestKeys.some((tk) => phase1Set.has(tk))) {
      phase3SelectedConsolidatedIds.push(id)
    }
  }
}

if (phase2VersionChanged && consolidatedManifest !== null) {
  for (const [id] of Object.entries(consolidatedManifest.entries)) {
    if (!phase3SelectedConsolidatedIds.includes(id)) {
      phase3SelectedConsolidatedIds.push(id)
    }
  }
}

return {
  phase1SelectedTestKeys,
  phase2SelectedTestKeys,
  phase3SelectedConsolidatedIds,
  reportRebuildOnly:
    reportVersionChanged &&
    phase1SelectedTestKeys.length === 0 &&
    phase2SelectedTestKeys.length === 0 &&
    phase3SelectedConsolidatedIds.length === 0,
}
```

Remove the old return statement and replace with the one above.

Add the `CONSOLIDATED_MANIFEST_PATH` import:

```typescript
import { CONSOLIDATED_MANIFEST_PATH, INCREMENTAL_MANIFEST_PATH, PROJECT_ROOT } from './config.js'
```

- [ ] **Step 2: Add `CONSOLIDATED_MANIFEST_PATH` to config.ts**

Add after `INCREMENTAL_MANIFEST_PATH` in `config.ts`:

```typescript
export const CONSOLIDATED_MANIFEST_PATH = resolve(REPORTS_DIR, 'consolidated-manifest.json')
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "incremental\|config"
```

Expected: no errors for incremental.ts or config.ts.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/config.ts scripts/behavior-audit/incremental.ts
git commit -m "feat(audit): add ConsolidatedManifest, Phase 3 selection, downstream invalidation"
```

---

## Task 5: Create consolidate-agent.ts with structured output

**Files:**

- Create: `scripts/behavior-audit/consolidate-agent.ts`

- [ ] **Step 1: Create the file**

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, Output, stepCountIs } from 'ai'
import { z } from 'zod'

import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE2_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
import { makeAuditTools } from './tools.js'

function getEnvOrFallback(name: string, fallback: string): string {
  const value = process.env[name]
  if (value === undefined) return fallback
  return value
}

const apiKey = getEnvOrFallback('OPENAI_API_KEY', 'no-key')
const provider = createOpenAICompatible({ name: 'behavior-audit-consolidate', apiKey, baseURL: BASE_URL })
const model = provider(MODEL)

const SYSTEM_PROMPT = `You are a senior software analyst reviewing extracted test behaviors from a Telegram/Discord/Mattermost chat bot called "papai". Your job is to consolidate per-test behaviors into feature-level descriptions.

For the list of behaviors you receive (all from the same domain), you must:

1. CLASSIFY each behavior as either:
   - "user_facing": the behavior describes something a user can discover, trigger, or observe as a real product feature
   - "internal": the behavior describes implementation details, internal routing, string parsing edge cases, data format correctness, or pure utility function behavior

2. CONSOLIDATE related behaviors. Multiple tests that cover the same feature from different angles (happy path, error cases, edge cases, boundary conditions) should be merged into a single feature-level entry. A single consolidated entry can reference many source tests.

3. For each consolidated behavior, produce:
   - featureName: a short (3-6 word) name for the feature
   - isUserFacing: true or false
   - behavior: a single plain-language description starting with "When..." that covers the full feature (not just one test case)
   - userStory: "As a [user type], I want [action] so that [benefit]." — required only when isUserFacing=true, null otherwise
   - context: one paragraph describing the implementation chain (relevant functions, DB tables, key logic)
   - sourceTestKeys: array of original test keys that were merged into this entry (pass through exactly as provided)

You have tools to read source files, search the codebase, find files, and list directories. Use them to understand the implementation if needed.`

const ConsolidationItemSchema = z.object({
  featureName: z.string(),
  isUserFacing: z.boolean(),
  behavior: z.string(),
  userStory: z.string().nullable(),
  context: z.string(),
  sourceTestKeys: z.array(z.string()),
})

const ConsolidationResultSchema = z.object({
  consolidations: z.array(ConsolidationItemSchema),
})

type ConsolidationResult = z.infer<typeof ConsolidationResultSchema>

export interface ConsolidateBehaviorInput {
  readonly testKey: string
  readonly behavior: string
  readonly context: string
}

function buildPrompt(domain: string, behaviors: readonly ConsolidateBehaviorInput[]): string {
  const behaviorList = behaviors
    .map((b, i) => `${i + 1}. TestKey: "${b.testKey}"\n   Behavior: ${b.behavior}\n   Context: ${b.context}`)
    .join('\n\n')
  return `Domain: ${domain}\n\nExtracted behaviors:\n\n${behaviorList}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function consolidateSingle(prompt: string, attempt: number): Promise<ConsolidationResult | null> {
  const timeout = attempt > 0 ? PHASE2_TIMEOUT_MS * 2 : PHASE2_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      output: Output.object({ schema: ConsolidationResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return null
    }
    console.log(`✓ (${elapsed}s)`)
    return result.output
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ error: ${err instanceof Error ? err.message : String(err)} (${elapsed}s)`)
    return null
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function consolidateWithRetry(
  domain: string,
  behaviors: readonly ConsolidateBehaviorInput[],
  attemptOffset: number,
): Promise<readonly { readonly id: string; readonly item: ConsolidationResult['consolidations'][number] }[] | null> {
  const prompt = buildPrompt(domain, behaviors)

  for (let attempt = attemptOffset; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!
      console.log(`  retry ${attempt}/${MAX_RETRIES - 1}, waiting ${backoff / 1000}s...`)
      await sleep(backoff)
    }
    const result = await consolidateSingle(prompt, attempt)
    if (result !== null) {
      return result.consolidations.map((item) => ({
        id: `${domain}::${slugify(item.featureName)}`,
        item,
      }))
    }
  }
  return null
}
```

Key differences from the original plan:

- Uses `Output.object({ schema })` for schema-validated structured output instead of regex JSON parsing
- `stopWhen` is set to `MAX_STEPS + 1` to account for the extra structured-output step
- `sourceTestKeys` (not `sourceTests`) carries full test keys for traceability
- IDs are returned alongside raw items so the caller can construct `ConsolidatedBehavior` with provenance

- [ ] **Step 2: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "consolidate-agent"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/consolidate-agent.ts
git commit -m "feat(audit): add consolidation LLM agent with structured output (Phase 2)"
```

---

## Task 6: Create consolidate.ts (Phase 2 runner)

**Files:**

- Create: `scripts/behavior-audit/consolidate.ts`

Phase 2 reads structured data from `progress.phase1.extractedBehaviors` (not markdown files), groups by domain, calls the consolidation agent, writes consolidated JSON, and updates the consolidated manifest.

- [ ] **Step 1: Create the file**

```typescript
import pLimit from 'p-limit'

import { MAX_RETRIES } from './config.js'
import type { ConsolidateBehaviorInput } from './consolidate-agent.js'
import { consolidateWithRetry } from './consolidate-agent.js'
import type { ConsolidatedManifest } from './incremental.js'
import { buildPhase2ConsolidationFingerprint } from './incremental.js'
import { getDomain } from './domain-map.js'
import type { Progress } from './progress.js'
import {
  getFailedDomainAttempts,
  isDomainCompleted,
  markDomainDone,
  markDomainFailed,
  resetPhase3,
  saveProgress,
} from './progress.js'
import type { ConsolidatedBehavior, ExtractedBehavior } from './report-writer.js'
import { writeConsolidatedFile } from './report-writer.js'

interface DomainGroup {
  readonly domain: string
  readonly inputs: readonly ConsolidateBehaviorInput[]
}

function groupByDomain(extractedBehaviors: Readonly<Record<string, ExtractedBehavior>>): readonly DomainGroup[] {
  const map = new Map<string, ConsolidateBehaviorInput[]>()
  for (const [testKey, behavior] of Object.entries(extractedBehaviors)) {
    const domain = getDomain(behavior.fullPath)
    let group = map.get(domain)
    if (group === undefined) {
      group = []
      map.set(domain, group)
    }
    group.push({ testKey, behavior: behavior.behavior, context: behavior.context })
  }
  return [...map.entries()].map(([domain, inputs]) => ({ domain, inputs }))
}

async function consolidateDomain(
  group: DomainGroup,
  idx: number,
  total: number,
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
): Promise<ConsolidatedManifest> {
  const { domain, inputs } = group

  if (isDomainCompleted(progress, domain)) {
    console.log(`[Phase 2] [${idx}/${total}] ${domain} — skipped (already done)`)
    return consolidatedManifest
  }

  const failedAttempts = getFailedDomainAttempts(progress, domain)
  if (failedAttempts >= MAX_RETRIES) {
    console.log(`[Phase 2] [${idx}/${total}] ${domain} — skipped (max retries exceeded)`)
    return consolidatedManifest
  }

  console.log(`[Phase 2] [${idx}/${total}] ${domain} (${inputs.length} behaviors)...`)

  const result = await consolidateWithRetry(domain, inputs, failedAttempts)

  if (result === null) {
    markDomainFailed(progress, domain, 'consolidation failed after retries', failedAttempts + 1)
    await saveProgress(progress)
    return consolidatedManifest
  }

  const behaviors: string[] = inputs.map((i) => i.behavior)
  const fingerprint = buildPhase2ConsolidationFingerprint({
    sourceTestKeys: inputs.map((i) => i.testKey),
    behaviors,
    phaseVersion: phase2Version,
  })

  const consolidations: ConsolidatedBehavior[] = result.map(({ id, item }) => ({
    id,
    domain,
    featureName: item.featureName,
    isUserFacing: item.isUserFacing,
    behavior: item.behavior,
    userStory: item.userStory ?? null,
    context: item.context,
    sourceTestKeys: item.sourceTestKeys,
  }))

  await writeConsolidatedFile(domain, consolidations)
  markDomainDone(progress, domain, consolidations)

  const updatedEntries = { ...consolidatedManifest.entries }
  for (const cb of consolidations) {
    updatedEntries[cb.id] = {
      consolidatedId: cb.id,
      domain: cb.domain,
      featureName: cb.featureName,
      sourceTestKeys: cb.sourceTestKeys,
      isUserFacing: cb.isUserFacing,
      phase2Fingerprint: fingerprint,
      lastConsolidatedAt: new Date().toISOString(),
    }
  }

  const userFacingCount = consolidations.filter((b) => b.isUserFacing).length
  console.log(
    `[Phase 2] [${idx}/${total}] ${domain} — done (${consolidations.length} consolidated, ${userFacingCount} user-facing)`,
  )

  return { ...consolidatedManifest, entries: updatedEntries }
}

export async function runPhase2(
  progress: Progress,
  consolidatedManifest: ConsolidatedManifest,
  phase2Version: string,
): Promise<ConsolidatedManifest> {
  console.log('\n[Phase 2] Grouping extracted behaviors by domain...')
  const groups = groupByDomain(progress.phase1.extractedBehaviors)
  progress.phase2.status = 'in-progress'
  progress.phase2.stats.domainsTotal = groups.length

  resetPhase3(progress)
  await saveProgress(progress)

  console.log(`[Phase 2] Consolidating ${groups.length} domains...\n`)

  const limit = pLimit(1)
  let currentManifest = consolidatedManifest
  await Promise.all(
    groups.map((group, i) =>
      limit(async () => {
        currentManifest = await consolidateDomain(group, i + 1, groups.length, progress, currentManifest, phase2Version)
      }),
    ),
  )

  progress.phase2.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 2 complete] ${progress.phase2.stats.domainsDone} domains consolidated, ${progress.phase2.stats.domainsFailed} failed`,
  )
  return currentManifest
}
```

Key differences from the original plan:

- Reads from `progress.phase1.extractedBehaviors` (structured data) instead of re-parsing markdown
- Calls `resetPhase3(progress)` before running to invalidate downstream state
- Updates the consolidated manifest with fingerprints and provenance
- Accepts `phase2Version` for fingerprint stability

- [ ] **Step 2: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "consolidate\."
```

Expected: no errors for consolidate.ts.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/consolidate.ts
git commit -m "feat(audit): add Phase 2 consolidation runner with structured input"
```

---

## Task 7: Update evaluate-agent.ts — remove userStory, use structured output

**Files:**

- Modify: `scripts/behavior-audit/evaluate-agent.ts`

Phase 3 receives the user story pre-built from Phase 2. The agent only produces persona scores, flaws, and improvements.

- [ ] **Step 1: Update SYSTEM_PROMPT**

Replace the `SYSTEM_PROMPT` constant in `evaluate-agent.ts`:

```typescript
const SYSTEM_PROMPT = `You are evaluating a single feature of a Telegram chat bot from the perspective of three non-technical personas. You have tools to read source files, search the codebase, find files, and list directories. Use them to look at actual bot responses, error messages, system prompts, and command help text to judge the real UX.

The user story for this feature has already been written. Your job is to evaluate the UX quality only.

For each persona, evaluate:
- discover (1-5): Would they find and trigger this feature naturally?
- use (1-5): Could they use it successfully without help?
- retain (1-5): Would they keep using it after the first time?

Respond with ONLY a JSON object:
{
  "maria": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "dani": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "viktor": { "discover": N, "use": N, "retain": N, "notes": "..." },
  "flaws": ["flaw 1", "flaw 2"],
  "improvements": ["improvement 1", "improvement 2"]
}`
```

- [ ] **Step 2: Replace EvalResult and validation with Zod schema + Output.object**

Replace the `EvalResult` interface, `isPersonaScore`, `isStringArray`, `isValidEval`, and `parseJsonResponse` functions with:

```typescript
const PersonaScoreSchema = z.object({
  discover: z.number().min(1).max(5),
  use: z.number().min(1).max(5),
  retain: z.number().min(1).max(5),
  notes: z.string(),
})

const EvalResultSchema = z.object({
  maria: PersonaScoreSchema,
  dani: PersonaScoreSchema,
  viktor: PersonaScoreSchema,
  flaws: z.array(z.string()),
  improvements: z.array(z.string()),
})

export type EvalResult = z.infer<typeof EvalResultSchema>
```

Add `Output` to the ai import:

```typescript
import { generateText, Output, stepCountIs } from 'ai'
```

Add `z` import:

```typescript
import { z } from 'zod'
```

- [ ] **Step 3: Update evaluateSingle to use Output.object**

Replace the `evaluateSingle` function:

```typescript
async function evaluateSingle(prompt: string, attempt: number): Promise<EvalResult | null> {
  const timeout = attempt > 0 ? PHASE3_TIMEOUT_MS * 2 : PHASE3_TIMEOUT_MS
  const tools = makeAuditTools()
  const start = Date.now()
  try {
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      tools,
      output: Output.object({ schema: EvalResultSchema }),
      stopWhen: stepCountIs(MAX_STEPS + 1),
      abortSignal: AbortSignal.timeout(timeout),
    })
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (result.output === null) {
      console.log(`✗ null output (${elapsed}s)`)
      return null
    }
    console.log(`✓ (${elapsed}s)`)
    return result.output
  } catch (error) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`✗ ${error instanceof Error ? error.message : String(error)} (${elapsed}s)`)
    return null
  }
}
```

Update the config import to use `PHASE3_TIMEOUT_MS`:

```typescript
import { BASE_URL, MAX_RETRIES, MAX_STEPS, MODEL, PHASE3_TIMEOUT_MS, RETRY_BACKOFF_MS } from './config.js'
```

- [ ] **Step 4: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "evaluate-agent"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/evaluate-agent.ts
git commit -m "feat(audit): remove userStory from Phase 3 agent, use structured output with Zod"
```

---

## Task 8: Update evaluate-reporting.ts — add userStory parameter, migrate to phase3

**Files:**

- Modify: `scripts/behavior-audit/evaluate-reporting.ts`

- [ ] **Step 1: Update recordEval signature and body**

Replace the `recordEval` function:

```typescript
export function recordEval(
  evalResult: EvalResult,
  input: {
    readonly domain: string
    readonly featureName: string
    readonly behavior: string
    readonly userStory: string
  },
  evaluationsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  const evaluated: EvaluatedBehavior = {
    testName: input.featureName,
    behavior: input.behavior,
    userStory: input.userStory,
    maria: evalResult.maria,
    dani: evalResult.dani,
    viktor: evalResult.viktor,
    flaws: evalResult.flaws,
    improvements: evalResult.improvements,
  }
  evaluationsByDomain.set(input.domain, [...getExistingEvaluations(evaluationsByDomain, input.domain), evaluated])
  for (const flaw of evalResult.flaws) incrementCount(flawFreq, flaw)
  for (const improvement of evalResult.improvements) incrementCount(impFreq, improvement)
}
```

- [ ] **Step 2: Update writeReports to use phase3**

Replace the `writeReports` function:

```typescript
export async function writeReports(
  evaluationsByDomain: ReadonlyMap<string, EvaluatedBehavior[]>,
  flawFreq: ReadonlyMap<string, number>,
  impFreq: ReadonlyMap<string, number>,
  progress: Progress,
): Promise<void> {
  await Promise.all(
    [...evaluationsByDomain.entries()].map(([domain, evaluations]) => writeStoryFile(domain, evaluations)),
  )
  const summaries = [...evaluationsByDomain.entries()].map(([domain, evaluations]) => buildSummary(domain, evaluations))
  const failedItems = Object.entries(progress.phase3.failedBehaviors).map(([key, entry]) => ({
    testFile: key.split('::')[0] ?? 'unknown',
    testName: key.split('::').slice(1).join('::'),
    error: entry.error,
    attempts: entry.attempts,
  }))
  await writeIndexFile(
    summaries,
    progress.phase3.stats.behaviorsDone,
    progress.phase3.stats.behaviorsFailed,
    flawFreq,
    impFreq,
    failedItems,
  )
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "evaluate-reporting"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/evaluate-reporting.ts
git commit -m "feat(audit): migrate evaluate-reporting to phase3, add userStory to recordEval"
```

---

## Task 9: Rewrite evaluate.ts as Phase 3 runner

**Files:**

- Modify: `scripts/behavior-audit/evaluate.ts`

Phase 3 reads from `CONSOLIDATED_DIR`, filters to user-facing behaviors, uses `progress.phase3`, and accepts consolidated IDs for selection.

- [ ] **Step 1: Replace types and imports**

Replace the top of `evaluate.ts` (imports through `ParsedBehavior`):

```typescript
import { join } from 'node:path'

import pLimit from 'p-limit'

import { CONSOLIDATED_DIR, MAX_RETRIES } from './config.js'
import { evaluateWithRetry } from './evaluate-agent.js'
import { recordEval, recordStoredEvaluation, writeReports } from './evaluate-reporting.js'
import type { Progress } from './progress.js'
import {
  getFailedBehaviorAttempts,
  isBehaviorCompleted,
  markBehaviorDone,
  markBehaviorFailed,
  saveProgress,
} from './progress.js'
import type { ConsolidatedBehavior, EvaluatedBehavior } from './report-writer.js'
import { readConsolidatedFile } from './report-writer.js'
import { ALL_PERSONAS } from './personas.js'

interface Phase3RunInput {
  readonly progress: Progress
  readonly selectedConsolidatedIds: ReadonlySet<string>
}

interface ParsedConsolidatedBehavior {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly behavior: string
  readonly userStory: string
  readonly context: string
}
```

- [ ] **Step 2: Replace parseBehaviorFiles with parseConsolidatedFiles**

Remove `readMatchedGroup`, `parseSingleFile`, `parseBehaviorFiles`. Add:

```typescript
async function parseConsolidatedFiles(domains: readonly string[]): Promise<readonly ParsedConsolidatedBehavior[]> {
  const behaviors: ParsedConsolidatedBehavior[] = []
  for (const domain of domains) {
    const consolidated = await readConsolidatedFile(domain)
    if (consolidated === null) continue
    for (const item of consolidated) {
      if (!item.isUserFacing || item.userStory === null) continue
      behaviors.push({
        consolidatedId: item.id,
        domain: item.domain,
        featureName: item.featureName,
        behavior: item.behavior,
        userStory: item.userStory,
        context: item.context,
      })
    }
  }
  return behaviors
}
```

- [ ] **Step 3: Replace buildPrompt**

Replace the `buildPrompt` function:

```typescript
function buildPrompt(b: ParsedConsolidatedBehavior): string {
  return `${ALL_PERSONAS}\n\n---\n\n**Domain:** ${b.domain}\n**Feature:** ${b.featureName}\n**User Story:** ${b.userStory}\n\n**Behavior:** ${b.behavior}\n\n**Context:** ${b.context}`
}
```

- [ ] **Step 4: Update reuseStoredEvaluation to use phase3**

Replace the `reuseStoredEvaluation` function:

```typescript
function reuseStoredEvaluation(
  key: string,
  domain: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
): void {
  const existing = progress.phase3.evaluations[key]
  if (existing !== undefined) {
    recordStoredEvaluation(existing, domain, evalsByDomain, flawFreq, impFreq)
  }
}
```

- [ ] **Step 5: Update shouldSkipBehavior to use selectedConsolidatedIds**

Replace the `shouldSkipBehavior` function:

```typescript
function shouldSkipBehavior(
  key: string,
  idx: number,
  total: number,
  domain: string,
  featureName: string,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selectedConsolidatedIds: ReadonlySet<string>,
): boolean {
  if (!selectedConsolidatedIds.has(key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq)
    return true
  }
  if (isBehaviorCompleted(progress, key)) {
    reuseStoredEvaluation(key, domain, progress, evalsByDomain, flawFreq, impFreq)
    console.log(`  [${idx}/${total}] ${domain} :: "${featureName}" (skipped)`)
    return true
  }
  if (getFailedBehaviorAttempts(progress, key) >= MAX_RETRIES) {
    console.log(`  [${idx}/${total}] ${domain} :: "${featureName}" (max retries)`)
    return true
  }
  return false
}
```

- [ ] **Step 6: Update evaluateSelectedBehavior**

Replace the `evaluateSelectedBehavior` function:

```typescript
async function evaluateSelectedBehavior(input: {
  readonly behavior: ParsedConsolidatedBehavior
  readonly key: string
  readonly idx: number
  readonly total: number
  readonly progress: Progress
  readonly evalsByDomain: Map<string, EvaluatedBehavior[]>
  readonly flawFreq: Map<string, number>
  readonly impFreq: Map<string, number>
}): Promise<void> {
  process.stdout.write(`  [${input.idx}/${input.total}] ${input.behavior.domain} :: "${input.behavior.featureName}" `)
  const result = await evaluateWithRetry(buildPrompt(input.behavior))
  if (result === null) {
    markBehaviorFailed(input.progress, input.key, 'evaluation failed after retries', 1)
    return
  }
  recordEval(
    result,
    {
      domain: input.behavior.domain,
      featureName: input.behavior.featureName,
      behavior: input.behavior.behavior,
      userStory: input.behavior.userStory,
    },
    input.evalsByDomain,
    input.flawFreq,
    input.impFreq,
  )
  markBehaviorDone(input.progress, input.key, {
    testName: input.behavior.featureName,
    behavior: input.behavior.behavior,
    userStory: input.behavior.userStory,
    maria: result.maria,
    dani: result.dani,
    viktor: result.viktor,
    flaws: result.flaws,
    improvements: result.improvements,
  })
  await saveProgress(input.progress)
}
```

- [ ] **Step 7: Update processSingleBehavior**

Replace the `processSingleBehavior` function:

```typescript
function processSingleBehavior(
  b: ParsedConsolidatedBehavior,
  idx: number,
  total: number,
  progress: Progress,
  evalsByDomain: Map<string, EvaluatedBehavior[]>,
  flawFreq: Map<string, number>,
  impFreq: Map<string, number>,
  selectedConsolidatedIds: ReadonlySet<string>,
): Promise<void> {
  const key = b.consolidatedId
  if (
    shouldSkipBehavior(
      key,
      idx,
      total,
      b.domain,
      b.featureName,
      progress,
      evalsByDomain,
      flawFreq,
      impFreq,
      selectedConsolidatedIds,
    )
  ) {
    return Promise.resolve()
  }
  return evaluateSelectedBehavior({
    behavior: b,
    key,
    idx,
    total,
    progress,
    evalsByDomain,
    flawFreq,
    impFreq,
  })
}
```

- [ ] **Step 8: Rename runPhase2 to runPhase3 and update body**

Replace the exported `runPhase2` function and the `Phase2RunInput` interface:

```typescript
export async function runPhase3({ progress, selectedConsolidatedIds }: Phase3RunInput): Promise<void> {
  console.log('\n[Phase 3] Reading consolidated behavior files...')
  const domains = Object.keys(progress.phase2.completedDomains)
  const allBehaviors = await parseConsolidatedFiles(domains)
  progress.phase3.status = 'in-progress'
  progress.phase3.stats.behaviorsTotal = allBehaviors.length
  await saveProgress(progress)
  console.log(`[Phase 3] Scoring ${allBehaviors.length} user-facing behaviors...\n`)

  const evalsByDomain = new Map<string, EvaluatedBehavior[]>()
  const flawFreq = new Map<string, number>()
  const impFreq = new Map<string, number>()
  const limit = pLimit(1)

  await Promise.all(
    allBehaviors.map((b, i) =>
      limit(() =>
        processSingleBehavior(
          b,
          i + 1,
          allBehaviors.length,
          progress,
          evalsByDomain,
          flawFreq,
          impFreq,
          selectedConsolidatedIds,
        ),
      ),
    ),
  )

  await writeReports(evalsByDomain, flawFreq, impFreq, progress)
  progress.phase3.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 3 complete] ${progress.phase3.stats.behaviorsDone} evaluated, ${progress.phase3.stats.behaviorsFailed} failed`,
  )
  console.log('→ reports/stories/index.md written')
}
```

- [ ] **Step 9: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "evaluate\."
```

Expected: no errors for evaluate.ts.

- [ ] **Step 10: Commit**

```bash
git add scripts/behavior-audit/evaluate.ts
git commit -m "feat(audit): rewrite evaluate.ts as Phase 3 runner, reading consolidated files"
```

---

## Task 10: Update report-writer.ts — rebuildReportsFromStoredResults

**Files:**

- Modify: `scripts/behavior-audit/report-writer.ts`

The `rebuildReportsFromStoredResults` function currently groups evaluations by iterating `manifest.tests` keyed by test key. In the 3-phase world, Phase 3 evaluations are keyed by consolidated ID. The rebuild needs to support both the old test-keyed and new consolidated-ID-keyed evaluations.

- [ ] **Step 1: Update RebuildReportsInput to accept consolidated manifest**

Replace the `RebuildReportsInput` interface:

```typescript
interface RebuildReportsInput {
  readonly manifest: IncrementalManifest
  readonly extractedBehaviorsByKey: Readonly<Record<string, ExtractedBehavior>>
  readonly evaluationsByKey: Readonly<Record<string, EvaluatedBehavior>>
  readonly consolidatedManifest: import('./incremental.js').ConsolidatedManifest | null
}
```

- [ ] **Step 2: Update rebuildReportsFromStoredResults**

Replace the `rebuildReportsFromStoredResults` function:

```typescript
export async function rebuildReportsFromStoredResults({
  manifest,
  extractedBehaviorsByKey,
  evaluationsByKey,
  consolidatedManifest,
}: RebuildReportsInput): Promise<void> {
  const extractedByFile = groupExtractedBehaviorsByFile(manifest, extractedBehaviorsByKey)
  await writeRebuiltBehaviorFiles(extractedByFile)

  const evaluationsByDomain: Record<string, EvaluatedBehavior[]> = {}

  if (consolidatedManifest !== null) {
    for (const [consolidatedId, entry] of Object.entries(consolidatedManifest.entries)) {
      const evaluation = evaluationsByKey[consolidatedId]
      if (evaluation === undefined) continue
      const existing = evaluationsByDomain[entry.domain]
      if (existing === undefined) {
        evaluationsByDomain[entry.domain] = [evaluation]
      } else {
        existing.push(evaluation)
      }
    }
  } else {
    const legacyGrouped = groupEvaluationsByDomain(manifest, evaluationsByKey)
    for (const [domain, evals] of Object.entries(legacyGrouped)) {
      evaluationsByDomain[domain] = evals as EvaluatedBehavior[]
    }
  }

  await writeRebuiltStoryFiles(evaluationsByDomain)

  const summaries = Object.entries(evaluationsByDomain)
    .map(([domain, evaluations]) => buildSummary(domain, evaluations))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))

  const flawFrequency = countFrequency(Object.values(evaluationsByKey).flatMap((evaluation) => evaluation.flaws))
  const improvementFrequency = countFrequency(
    Object.values(evaluationsByKey).flatMap((evaluation) => evaluation.improvements),
  )

  await writeIndexFile(summaries, Object.keys(evaluationsByKey).length, 0, flawFrequency, improvementFrequency, [])
}
```

- [ ] **Step 3: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "report-writer"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit/report-writer.ts
git commit -m "feat(audit): update rebuildReports to support consolidated manifest grouping"
```

---

## Task 11: Update extract-incremental.ts — reset downstream on Phase 1 changes

**Files:**

- Modify: `scripts/behavior-audit/extract-incremental.ts`

When Phase 1 fingerprint changes for a test, the Phase 2 consolidation that consumed that test's behavior is stale. Reset downstream state.

- [ ] **Step 1: Add downstream reset logic**

The `updateManifestForExtractedTest` function already detects when `phase1Fingerprint` changes and nulls out `phase2Fingerprint`. Add a return flag so the caller can reset downstream progress. Replace the function:

```typescript
export async function updateManifestForExtractedTest(input: {
  readonly manifest: IncrementalManifest
  readonly testFile: ParsedTestFile
  readonly testCase: TestCase
  readonly extractedBehavior: ExtractedBehavior
}): Promise<{ readonly manifest: IncrementalManifest; readonly phase1Changed: boolean }> {
  const testKey = `${input.testFile.filePath}::${input.testCase.fullPath}`
  const testFileHash = hashText(await Bun.file(join(PROJECT_ROOT, input.testFile.filePath)).text())
  const mirroredPath = deriveImplPath(input.testFile.filePath)
  const mirroredSourceHash = await loadMirroredSourceHash(input.testFile.filePath)
  const dependencyPaths =
    mirroredSourceHash === null ? [input.testFile.filePath] : [input.testFile.filePath, mirroredPath]
  const extractedBehaviorPath = `reports/behaviors/${getDomain(input.testFile.filePath)}/${input.testFile.filePath.split('/').pop()!.replace('.test.ts', '.test.behaviors.md')}`
  const previousEntry = input.manifest.tests[testKey]
  const phase1Fingerprint = buildPhase1Fingerprint({
    testKey,
    testFileHash,
    testSource: input.testCase.source,
    mirroredSourceHash,
    phaseVersion: input.manifest.phaseVersions.phase1,
  })
  const phase1Changed = previousEntry === undefined || previousEntry.phase1Fingerprint !== phase1Fingerprint
  const phase2Fingerprint = phase1Changed ? null : previousEntry!.phase2Fingerprint
  const lastPhase2CompletedAt = phase2Fingerprint === null ? null : previousEntry!.lastPhase2CompletedAt

  return {
    manifest: {
      ...input.manifest,
      tests: {
        ...input.manifest.tests,
        [testKey]: {
          testFile: input.testFile.filePath,
          testName: input.testCase.fullPath,
          dependencyPaths,
          phase1Fingerprint,
          phase2Fingerprint,
          extractedBehaviorPath,
          domain: getDomain(input.testFile.filePath),
          lastPhase1CompletedAt: new Date().toISOString(),
          lastPhase2CompletedAt,
        },
      },
    },
    phase1Changed,
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "extract-incremental"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/behavior-audit/extract-incremental.ts
git commit -m "feat(audit): return phase1Changed flag for downstream invalidation"
```

---

## Task 12: Update extract.ts — propagate phase1Changed to caller

**Files:**

- Modify: `scripts/behavior-audit/extract.ts`

The `processSingleTestCase` function must propagate the `phase1Changed` flag so the runner can reset downstream state when any extraction changes.

- [ ] **Step 1: Update processSingleTestCase return type and body**

In `processSingleTestCase`, update the call to `updateManifestForExtractedTest` and the return type:

```typescript
async function processSingleTestCase(
  testCase: TestCase,
  testFile: ParsedTestFile,
  testFilePath: string,
  displayIndex: number,
  totalTests: number,
  progress: Progress,
  manifest: IncrementalManifest,
): Promise<{
  readonly behavior: ExtractedBehavior
  readonly manifest: IncrementalManifest
  readonly phase1Changed: boolean
} | null> {
  const testKey = `${testFilePath}::${testCase.fullPath}`
  const existing = progress.phase1.extractedBehaviors[testKey]
  if (existing !== undefined) {
    return { behavior: existing as ExtractedBehavior, manifest, phase1Changed: false }
  }
  if (getFailedTestAttempts(progress, testKey) >= MAX_RETRIES) {
    console.log(`  [${displayIndex}/${totalTests}] "${testCase.name}" (skipped, max retries reached)`)
    return null
  }
  process.stdout.write(`  [${displayIndex}/${totalTests}] "${testCase.name}" `)
  const extracted = await retryExtraction(testCase, testFilePath, 0)
  if (extracted === null) {
    markTestFailed(progress, testKey, 'extraction failed')
    return null
  }
  const behavior: ExtractedBehavior = {
    testName: testCase.name,
    fullPath: testCase.fullPath,
    behavior: extracted.behavior,
    context: extracted.context,
  }
  markTestDone(progress, testFilePath, testKey, behavior)
  const { manifest: updatedManifest, phase1Changed } = await updateManifestForExtractedTest({
    manifest,
    testFile,
    testCase,
    extractedBehavior: behavior,
  })
  await saveManifest(updatedManifest)
  return { behavior, manifest: updatedManifest, phase1Changed }
}
```

- [ ] **Step 2: Update runSelectedExtractions to propagate phase1Changed**

Replace `runSelectedExtractions`:

```typescript
async function runSelectedExtractions(input: {
  readonly selectedTests: readonly TestCase[]
  readonly testFile: ParsedTestFile
  readonly progress: Progress
  readonly manifest: IncrementalManifest
}): Promise<{
  readonly results: readonly ({
    readonly behavior: ExtractedBehavior
    readonly manifest: IncrementalManifest
    readonly phase1Changed: boolean
  } | null)[]
  readonly manifest: IncrementalManifest
  readonly anyPhase1Changed: boolean
}> {
  let currentManifest = input.manifest
  let anyPhase1Changed = false
  const limit = pLimit(1)
  const results = await Promise.all(
    input.selectedTests.map((testCase, index) =>
      limit(async () => {
        const result = await processSingleTestCase(
          testCase,
          input.testFile,
          input.testFile.filePath,
          index + 1,
          input.selectedTests.length,
          input.progress,
          currentManifest,
        )
        if (result !== null) {
          currentManifest = result.manifest
          if (result.phase1Changed) anyPhase1Changed = true
        }
        return result
      }),
    ),
  )
  return { results, manifest: currentManifest, anyPhase1Changed }
}
```

- [ ] **Step 3: Update processTestFile to propagate the flag**

Replace `processTestFile`:

```typescript
async function processTestFile(
  testFile: ParsedTestFile,
  progress: Progress,
  fileIndex: number,
  totalFiles: number,
  selectedTestKeys: ReadonlySet<string>,
  manifest: IncrementalManifest,
): Promise<{ readonly manifest: IncrementalManifest; readonly anyPhase1Changed: boolean }> {
  if (progress.phase1.completedFiles.includes(testFile.filePath)) {
    console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath} (skipped, already done)`)
    return { manifest, anyPhase1Changed: false }
  }
  console.log(`[Phase 1] ${fileIndex}/${totalFiles} — ${testFile.filePath}`)
  const selectedTests = getSelectedTests(testFile, selectedTestKeys)
  const extractionResult = await runSelectedExtractions({
    selectedTests,
    testFile,
    progress,
    manifest,
  })
  const valid = collectValidBehaviors(extractionResult.results)
  if (valid.length > 0) {
    await writeBehaviorFile(testFile.filePath, valid)
    console.log(`  → wrote ${valid.length} behaviors`)
  }
  markFileDone(progress, testFile.filePath)
  await saveProgress(progress)
  return { manifest: extractionResult.manifest, anyPhase1Changed: extractionResult.anyPhase1Changed }
}
```

- [ ] **Step 4: Update runPhase1 to reset downstream and propagate**

Replace `runPhase1`:

```typescript
export async function runPhase1({ testFiles, progress, selectedTestKeys, manifest }: Phase1RunInput): Promise<void> {
  progress.phase1.status = 'in-progress'
  await saveProgress(progress)
  const limit = pLimit(1)
  let currentManifest = manifest
  let anyPhase1Changed = false
  await Promise.all(
    testFiles.map((f, i) =>
      limit(async () => {
        const result = await processTestFile(f, progress, i + 1, testFiles.length, selectedTestKeys, currentManifest)
        currentManifest = result.manifest
        if (result.anyPhase1Changed) anyPhase1Changed = true
      }),
    ),
  )
  if (anyPhase1Changed) {
    resetPhase2AndPhase3(progress)
  }
  progress.phase1.status = 'done'
  await saveProgress(progress)
  console.log(
    `\n[Phase 1 complete] ${progress.phase1.stats.filesDone} files, ${progress.phase1.stats.testsExtracted} behaviors extracted, ${progress.phase1.stats.testsFailed} failed`,
  )
}
```

Add the new import:

```typescript
import { resetPhase2AndPhase3 } from './progress.js'
```

- [ ] **Step 5: Verify typecheck**

```bash
bun typecheck 2>&1 | grep "extract\."
```

Expected: no errors for extract.ts.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit/extract.ts
git commit -m "feat(audit): propagate phase1Changed flag, reset downstream on Phase 1 changes"
```

---

## Task 13: Wire all 3 phases in behavior-audit.ts entry point

**Files:**

- Modify: `scripts/behavior-audit.ts`

- [ ] **Step 1: Update imports**

```typescript
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { EXCLUDED_PREFIXES, PROJECT_ROOT } from './behavior-audit/config.js'
import { runPhase2 } from './behavior-audit/consolidate.js'
import { runPhase3 } from './behavior-audit/evaluate.js'
import { runPhase1 } from './behavior-audit/extract.js'
import {
  captureRunStart,
  collectChangedFiles,
  createEmptyConsolidatedManifest,
  createEmptyManifest,
  loadConsolidatedManifest,
  loadManifest,
  saveConsolidatedManifest,
  saveManifest,
  selectIncrementalWork,
} from './behavior-audit/incremental.js'
import type { Progress } from './behavior-audit/progress.js'
import { createEmptyProgress, loadProgress, saveProgress } from './behavior-audit/progress.js'
import { rebuildReportsFromStoredResults } from './behavior-audit/report-writer.js'
import type { ParsedTestFile } from './behavior-audit/test-parser.js'
import { parseTestFile } from './behavior-audit/test-parser.js'
```

- [ ] **Step 2: Update runPhase2IfNeeded (consolidation)**

Replace the existing `runPhase2IfNeeded` function:

```typescript
async function runPhase2IfNeeded(
  progress: Progress,
  phase2Version: string,
): Promise<import('./behavior-audit/incremental.js').ConsolidatedManifest> {
  if (progress.phase2.status === 'done') {
    const existing = await loadConsolidatedManifest()
    if (existing !== null) {
      console.log('[Phase 2] Already complete, skipping.\n')
      return existing
    }
  }

  const existingManifest = await loadConsolidatedManifest()
  const consolidatedManifest = existingManifest ?? createEmptyConsolidatedManifest()
  return runPhase2(progress, consolidatedManifest, phase2Version)
}
```

- [ ] **Step 3: Update runPhase3IfNeeded**

Replace the existing `runPhase3IfNeeded` function:

```typescript
async function runPhase3IfNeeded(progress: Progress, selectedConsolidatedIds: ReadonlySet<string>): Promise<void> {
  if (progress.phase3.status === 'done') {
    console.log('[Phase 3] Already complete.\n')
    return
  }
  await runPhase3({ progress, selectedConsolidatedIds })
}
```

- [ ] **Step 4: Update main() to wire all 3 phases**

Replace the `main()` function:

```typescript
async function main(): Promise<void> {
  console.log('Behavior Audit — discovering test files...\n')

  const previousManifest = resolveRunStartManifest(await loadManifest())
  const currentHead = await resolveHeadCommit()
  const { previousLastStartCommit, updatedManifest } = captureRunStart(
    previousManifest,
    currentHead,
    new Date().toISOString(),
  )
  await saveManifest(updatedManifest)

  const testFilePaths = await discoverTestFiles()
  console.log(`Found ${testFilePaths.length} test files (after exclusions)\n`)
  const parsedFiles = await parseDiscoveredTestFiles(testFilePaths)
  const discoveredTestKeys = getDiscoveredTestKeys(parsedFiles)
  const changedFiles = await collectChangedFiles(previousLastStartCommit)

  const previousConsolidatedManifest = await loadConsolidatedManifest()
  const selection = selectIncrementalWork({
    changedFiles,
    previousManifest,
    currentPhaseVersions: previousManifest.phaseVersions,
    discoveredTestKeys,
    previousConsolidatedManifest,
  })

  const progress = await loadOrCreateProgress(testFilePaths.length)

  if (selection.reportRebuildOnly) {
    await rebuildReportsFromStoredResults({
      manifest: updatedManifest,
      extractedBehaviorsByKey: progress.phase1.extractedBehaviors,
      evaluationsByKey: progress.phase3.evaluations,
      consolidatedManifest: previousConsolidatedManifest,
    })
    console.log('\nBehavior audit complete.')
    return
  }

  if (progress.phase1.status === 'not-started' || progress.phase1.status === 'in-progress') {
    await runPhase1IfNeeded(parsedFiles, progress, new Set(selection.phase1SelectedTestKeys), updatedManifest)
  } else {
    console.log('[Phase 1] Already complete, skipping.\n')
  }

  const phase2Version = updatedManifest.phaseVersions.phase2
  const consolidatedManifest = await runPhase2IfNeeded(progress, phase2Version)
  await saveConsolidatedManifest(consolidatedManifest)

  await runPhase3IfNeeded(progress, new Set(selection.phase3SelectedConsolidatedIds))

  console.log('\nBehavior audit complete.')
}
```

- [ ] **Step 5: Run full typecheck**

```bash
bun typecheck 2>&1
```

Expected: 0 errors across all behavior-audit files.

- [ ] **Step 6: Run lint**

```bash
bun lint scripts/behavior-audit.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/consolidate-agent.ts scripts/behavior-audit/config.ts scripts/behavior-audit/progress.ts scripts/behavior-audit/evaluate.ts scripts/behavior-audit/evaluate-agent.ts scripts/behavior-audit/evaluate-reporting.ts scripts/behavior-audit/report-writer.ts scripts/behavior-audit/incremental.ts scripts/behavior-audit/extract.ts scripts/behavior-audit/extract-incremental.ts
```

Expected: no lint errors. Fix any flagged issues before committing.

- [ ] **Step 7: Final commit**

```bash
git add scripts/behavior-audit.ts
git commit -m "feat(audit): wire 3-phase audit — extract → consolidate → score with invalidation"
```

---

## Task 14: Add smoke-test reset helper

**Files:**

- Create: `scripts/behavior-audit-reset.ts`

This replaces the manual `progress.json` editing described in the original plan's verification section.

- [ ] **Step 1: Create the reset helper**

```typescript
const RESET_TARGET = process.argv[2]

if (RESET_TARGET !== 'phase2' && RESET_TARGET !== 'phase3' && RESET_TARGET !== 'all') {
  console.log('Usage: bun scripts/behavior-audit-reset.ts <phase2|phase3|all>')
  console.log('  phase2  — reset Phase 2 (consolidation) and Phase 3')
  console.log('  phase3  — reset Phase 3 (scoring) only')
  console.log('  all     — delete all progress and manifests')
  process.exit(1)
}

async function resetPhase2(): Promise<void> {
  const { resolve } = await import('node:path')
  const { rm } = await import('node:fs/promises')
  const PROJECT_ROOT = resolve(import.meta.dir, '..')
  const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')
  const CONSOLIDATED_DIR = resolve(REPORTS_DIR, 'consolidated')

  await rm(CONSOLIDATED_DIR, { recursive: true, force: true })
  console.log('Deleted reports/consolidated/')

  const progress = await loadAndMutateProgress(PROJECT_ROOT, (p) => {
    p.phase2 = createEmptyPhase2()
    p.phase3 = createEmptyPhase3()
  })
  if (progress !== null) console.log('Reset phase2 + phase3 in progress.json')
}

async function resetPhase3(): Promise<void> {
  const progress = await loadAndMutateProgress(import.meta.dir, (p) => {
    p.phase3 = createEmptyPhase3()
  })
  if (progress !== null) console.log('Reset phase3 in progress.json')
}

async function resetAll(): Promise<void> {
  const { resolve } = await import('node:path')
  const { rm } = await import('node:fs/promises')
  const PROJECT_ROOT = resolve(import.meta.dir, '..')
  const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports')

  await rm(REPORTS_DIR, { recursive: true, force: true })
  console.log('Deleted reports/')
}

async function loadAndMutateProgress(
  projectRoot: string,
  mutator: (p: Record<string, unknown>) => void,
): Promise<unknown | null> {
  const { resolve } = await import('node:path')
  const PROGRESS_PATH = resolve(projectRoot, 'reports/progress.json')
  try {
    const text = await Bun.file(PROGRESS_PATH).text()
    const raw = JSON.parse(text)
    mutator(raw as Record<string, unknown>)
    await Bun.write(PROGRESS_PATH, JSON.stringify(raw, null, 2) + '\n')
    return raw
  } catch {
    console.log('No progress.json found')
    return null
  }
}

function createEmptyPhase2(): Record<string, unknown> {
  return {
    status: 'not-started',
    completedDomains: {},
    consolidations: {},
    failedDomains: {},
    stats: { domainsTotal: 0, domainsDone: 0, domainsFailed: 0, behaviorsConsolidated: 0 },
  }
}

function createEmptyPhase3(): Record<string, unknown> {
  return {
    status: 'not-started',
    completedBehaviors: {},
    evaluations: {},
    failedBehaviors: {},
    stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
  }
}

if (RESET_TARGET === 'phase2') {
  await resetPhase2()
} else if (RESET_TARGET === 'phase3') {
  await resetPhase3()
} else {
  await resetAll()
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/behavior-audit-reset.ts
git commit -m "chore(audit): add reset helper for smoke-testing individual phases"
```

---

## Verification

After all tasks complete, run a smoke test against already-extracted core domain behaviors:

```bash
# Verify Phase 1 output is still intact
ls reports/behaviors/core/

# Reset Phase 2+3 to force re-consolidation from Phase 1 output
bun scripts/behavior-audit-reset.ts phase2

# Run the audit
bun audit:behavior
```

Expected output sequence:

```
[Phase 1] Already complete, skipping.

[Phase 2] Grouping extracted behaviors by domain...
[Phase 2] Consolidating N domains...

[Phase 2] [1/N] domain-name (M behaviors)...
[Phase 2] [1/N] domain-name — done (X consolidated, Y user-facing)

[Phase 2 complete] N domains consolidated, 0 failed

[Phase 3] Reading consolidated behavior files...
[Phase 3] Scoring Y user-facing behaviors...
...
[Phase 3 complete] Y evaluated, 0 failed
→ reports/stories/index.md written

Behavior audit complete.
```

Verify output files exist:

```bash
ls reports/consolidated/core.json
ls reports/stories/core.md
ls reports/stories/index.md
ls reports/consolidated-manifest.json
```

Verify `core.json` contains both user-facing and internal entries:

```bash
rg '"isUserFacing"' reports/consolidated/core.json | sort | uniq -c
```

Expected: some `false` entries (internal) and some `true` entries (user-facing), with user-facing count less than the raw test count.

Verify the consolidated manifest has proper source test keys:

```bash
rg '"sourceTestKeys"' reports/consolidated-manifest.json | head -5
```

Expected: arrays of full `testFile::fullPath` keys.

---

## Known Constraints

- The consolidation agent sends all behaviors for a domain in a single LLM call. For large domains (`tools`, `commands`) this may exceed context window limits. If it does, split the domain's behavior list into batches of ~20 behaviors before calling the agent, then merge results.
- `progress.json` from an existing run (before this restructure) will be automatically migrated by `migrateV1toV2()` in `progress.ts`: the old `phase2.evaluations` becomes `phase3.evaluations`, and phase2 starts fresh as consolidation.
- The `@ai-sdk/openai-compatible` provider may not support structured output (`Output.object`) with all local models. If `Output.object` fails at runtime with the configured `Gemma-4-26B-A4B` model, fall back to the regex-based JSON parsing approach (keep `parseJsonResponse` as a commented fallback in both agents).
- Phase 3 incremental selection depends on a valid consolidated manifest. On the first run after the restructure, all user-facing behaviors will be selected for scoring. Subsequent runs will use incremental selection based on which source tests changed.
