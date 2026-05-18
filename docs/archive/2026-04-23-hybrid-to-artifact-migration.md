# Migration Plan: Hybrid State to Canonical Artifact Model

> **Objective:** Eliminate duplication between legacy payload-era exports and canonical JSON artifacts by making the entire behavior-audit pipeline artifact-driven, removing compatibility shims, and converging rebuild/reset flows onto the canonical artifact tree.

---

## 1. Current State (Hybrid)

| Concern        | Legacy (payload-era)                                                         | Canonical (artifact-era)                                                  | Problem                                                                        |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Storage**    | `progress.json` checkpoint payloads                                          | `extracted/`, `classified/`, `consolidated/`, `evaluated/` JSON artifacts | Dual writes; recovery depends on checkpoint state                              |
| **Identity**   | `candidateFeatureKey`, `extractedBehaviorPath` aliases                       | `featureKey`, `extractedArtifactPath` canonical names                     | Schemas and types expose both; consumers inconsistently fall back              |
| **Vocabulary** | `keyword-vocabulary.json` with `timesUsed` telemetry                         | Same file without normalization                                           | Duplicate slugs allowed; mutable counters violate immutable artifact semantics |
| **Rebuild**    | `report-writer.ts` reads `extractedBehaviorsByKey` / `evaluationsByKey` maps | Artifacts exist but are ignored by rebuild path                           | `behaviors/` and `extracted/` contain same content via independent paths       |
| **Reset**      | `resetBehaviorAudit('phase2')` removes checkpoint files only                 | Artifact directories (`evaluated/`, `stories/`) left behind               | Stale artifacts survive reset and corrupt subsequent runs                      |

---

## 2. Target State (Artifact-Driven)

1. **Single source of truth:** Canonical JSON artifacts under `reports/audit-behavior/` are the only durable outputs from Phases 1–3.
2. **Progress is checkpoint-only:** `progress.json` stores run metadata (cursor positions, completeness flags) but **never** stores behavior payload data.
3. **Manifest-only indexing:** All cross-phase lookups use `incremental-manifest.json` and `consolidated-manifest.json` entries keyed by canonical fields (`featureKey`, `extractedArtifactPath`).
4. **Vocabulary is immutable:** `keyword-vocabulary.json` contains unique, normalized slugs; no mutable counters; append-only with deterministic merge rules.
5. **Rebuild is derivative:** Markdown reports in `behaviors/` and stories in `stories/` are regenerated **exclusively** by reading canonical manifests + artifact stores.
6. **Reset is tree-complete:** Resetting a phase removes all artifact directories and manifest files that belong to that phase or downstream phases.

---

## 3. Migration Phases

### Phase A: Remove Legacy Manifest Aliases

**Goal:** Make manifest types and selection surfaces speak only canonical vocabulary.

**Files to modify:**

- `scripts/behavior-audit/incremental.ts`
- `scripts/behavior-audit/incremental-selection.ts`
- `scripts/behavior-audit/consolidate.ts`
- `scripts/behavior-audit/evaluate-phase3-helpers.ts`
- `scripts/behavior-audit/progress.ts`

**Steps:**

1. **Update types and schemas**
   - Remove `candidateFeatureKey` from `ManifestTestEntry`, `ConsolidatedManifestEntry`, and related Zod schemas.
   - Remove `extractedBehaviorPath` alias; keep `extractedArtifactPath` only.
   - Remove backfill logic that populates aliases during parsing.

2. **Rename selection surfaces**
   - Rename `phase2bSelectedCandidateFeatureKeys` → `phase2bSelectedFeatureKeys`.
   - Rename helper variables and internal functions from `candidate*` → `featureKey*`.
   - Update call sites in `scripts/behavior-audit.ts`.

3. **Remove runtime fallbacks**
   - In `consolidate.ts`, read `entry.featureKey` directly; delete fallback branches that check `entry.candidateFeatureKey`.
   - In `evaluate-phase3-helpers.ts`, read `entry.featureKey` directly; delete same fallback.

4. **Rename progress helpers**
   - Rename `markCandidateFeatureDone()` → `markFeatureKeyDone()`.
   - Update all references in checkpoint logic.

5. **Update test fixtures and assertions**
   - Stop writing alias fields in fixture creators.
   - Assert canonical field names only.

**Verification:**

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts \
         ./tests/scripts/behavior-audit-entrypoint.test.ts \
         ./tests/scripts/behavior-audit-phase2b.test.ts \
         ./tests/scripts/behavior-audit-phase3.test.ts
```

**Expected:** All PASS with no `candidateFeatureKey` references remaining in runtime or tests.

---

### Phase B: Remove Payload-Era Fallbacks from Phase Loaders

**Goal:** Make Phase 2a, 2b, and 3 loaders read exclusively from canonical artifacts + manifests.

**Files to modify:**

- `scripts/behavior-audit/classify-phase2a-helpers.ts`
- `scripts/behavior-audit/classify.ts`
- `scripts/behavior-audit/consolidate.ts`
- `scripts/behavior-audit/evaluate-phase3-helpers.ts`

**Steps:**

1. **Remove legacy progress fallback in Phase 2a**
   - Delete `getLegacySelectedBehaviors()` from `classify-phase2a-helpers.ts`.
   - Ensure `loadSelectedBehaviors()` loads from:
     - `incremental-manifest.json` entries (by `testKey`)
     - `extracted/` artifacts (by `manifestEntry.testFile`)
     - Record selection by `behaviorId` or `testKey`
   - No dependency on `progress.phase1.extractedBehaviors`.

2. **Keep Phase 2a behavior-id selection canonical**
   - Manifest entry lookup: `manifest.entries.find(e => e.testKey === testKey)`.
   - Extracted file path derived from `manifestEntry.testFile`.
   - Record selection filtered by `behaviorId` or `testKey`.

3. **Remove payload dependency in Phase 2b and 3**
   - Ensure `consolidate.ts` and `evaluate-phase3-helpers.ts` consume only `ConsolidatedManifestEntry` with `featureKey`.
   - Delete any helper that accepts `extractedBehaviorsByKey` as an input map.

**Verification:**

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts \
         ./tests/scripts/behavior-audit-phase2b.test.ts \
         ./tests/scripts/behavior-audit-phase3.test.ts
```

**Expected:** All PASS; no `progress.phase1.extractedBehaviors` references remain.

---

### Phase C: Rebuild Reports from Canonical Artifacts Only

**Goal:** Eliminate the duplication root cause: rebuild flow must read artifacts, not legacy keyed maps.

**Files to modify:**

- `scripts/behavior-audit.ts`
- `scripts/behavior-audit/report-writer.ts`
- `scripts/behavior-audit/evaluate-reporting.ts`

**Steps:**

1. **Replace rebuild-only entrypoint path**
   - When `selection.reportRebuildOnly` is true:
     - Do **not** call `rebuildReportsFromStoredResults({ extractedBehaviorsByKey, evaluationsByKey })`.
     - Instead, call `rebuildReportsFromArtifacts({ manifestPath, consolidatedManifestPath })`.

2. **Rewrite rebuild helpers around canonical stores**
   - `report-writer.ts`:
     - Implement `loadExtractedRecordsPerTestFile(manifestEntries)` → reads `extracted/` JSON.
     - Implement `loadConsolidatedRecordsPerFeatureKey(consolidatedManifest)` → reads `consolidated/` JSON.
     - Implement `loadEvaluatedRecordsPerFeatureKey(consolidatedManifest)` → reads `evaluated/` JSON.
     - Rebuild behavior Markdown, story Markdown, and index Markdown from these loads.

3. **Align story-report aggregation**
   - In `evaluate-reporting.ts`, ensure story aggregation keys match the same `featureKey` and consolidated-id conventions used by the rebuild path.
   - Remove any map-based aggregation that bypasses manifest indexing.

4. **Delete legacy rebuild interfaces**
   - Remove `rebuildReportsFromStoredResults()` and its `extractedBehaviorsByKey` / `evaluationsByKey` parameters from public API.

**Verification:**

```bash
bun test ./tests/scripts/behavior-audit-entrypoint.test.ts \
         ./tests/scripts/behavior-audit-storage.test.ts \
         ./tests/scripts/behavior-audit-phase3.test.ts
```

**Expected:** All PASS; rebuild path no longer accepts legacy keyed maps.

---

### Phase D: Normalize Keyword Vocabulary

**Goal:** Make `keyword-vocabulary.json` an immutable, normalized artifact.

**Files to modify:**

- `scripts/behavior-audit/keyword-vocabulary.ts`
- `scripts/behavior-audit/keyword-resolver-agent.ts`
- `scripts/behavior-audit/extract.ts`

**Steps:**

1. **Remove `timesUsed` from schemas and runtime**
   - Delete `timesUsed` field from vocabulary entry types.
   - Delete `recordKeywordUsage()` or simplify it to a no-op (pending full removal in cleanup).

2. **Add deterministic slug normalization**
   - Implement `normalizeVocabulary(entries): VocabularyEntry[]`:
     - Group by `slug`.
     - For each group, emit one canonical entry with:
       - `createdAt`: earliest in group
       - `updatedAt`: latest in group
       - `description`: description from the most recently updated entry in group
     - Sort output by `slug`.

3. **Normalize vocabulary writes in Phase 1**
   - In `extract.ts`, after collecting resolver entries:
     - Load existing vocabulary.
     - Merge existing + new entries.
     - Run `normalizeVocabulary()`.
     - Write result atomically.
   - Never blindly concatenate arrays.

4. **Update resolver agent return contract**
   - `keyword-resolver-agent.ts` returns entries without `timesUsed`.

**Verification:**

```bash
bun test ./tests/scripts/behavior-audit-phase1-keywords.test.ts \
         ./tests/scripts/behavior-audit-storage.test.ts
```

**Expected:** All PASS; vocabulary fixtures rewritten to canonical shape; no `timesUsed` field.

---

### Phase E: Fix Phase Reset Behavior for Evaluated Artifacts

**Goal:** Reset must fully clean the artifact tree to prevent stale state from leaking across runs.

**Files to modify:**

- `scripts/behavior-audit-reset.ts`

**Steps:**

1. **Update phase 2 reset artifact list**
   - Remove:
     - `CLASSIFIED_DIR`
     - `CONSOLIDATED_DIR`
     - `EVALUATED_DIR`
     - `STORIES_DIR`
     - `CONSOLIDATED_MANIFEST_PATH`
   - Preserve `keyword-vocabulary.json` (it is canonical across phases).

2. **Update phase 3 reset artifact list**
   - Remove:
     - `EVALUATED_DIR`
     - `STORIES_DIR`

3. **Keep checkpoint resets scoped**
   - `resetPhase2AndPhase3()` and `resetPhase3()` still remove checkpoint files, but now also remove the artifact directories listed above.

**Verification:**

```bash
bun test ./tests/scripts/behavior-audit-storage.test.ts
```

**Expected:** All PASS; `evaluated/` and `stories/` cleaned appropriately per phase.

---

### Phase F: Full Verification and Stale Coupling Removal

**Goal:** Confirm the system no longer references legacy aliases, keyed maps, or `timesUsed`.

**Steps:**

1. **Run the full behavior-audit test slice**

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

**Expected:** PASS.

2. **Run repo-wide verification**

```bash
bun test
bun typecheck
bun lint
```

**Expected:** PASS with zero suppressions.

3. **Static search for forbidden patterns** (manual or scripted)
   - `candidateFeatureKey` — must have 0 runtime matches.
   - `extractedBehaviorPath` (except in historical docs) — must have 0 runtime matches.
   - `extractedBehaviorsByKey` — must have 0 matches.
   - `evaluationsByKey` — must have 0 matches.
   - `timesUsed` — must have 0 matches in `scripts/behavior-audit/` or tests.
   - `progress.phase1.extractedBehaviors` — must have 0 matches.

---

## 4. Rollback Considerations

- **Commits:** Each phase (A–E) should be an independent commit so any phase can be reverted without undoing others.
- **Artifact backup:** Before Phase C, back up `reports/audit-behavior/` if you have uncommitted human edits in `behaviors/` Markdown; after Phase C, Markdown is strictly derivative and can be regenerated.
- **Progress compatibility:** `progress.json` version should remain `4` throughout; no schema migration is required because progress already stores only checkpoint metadata.

---

## 5. Success Criteria

- [ ] `reports/audit-behavior/extracted/` and `reports/audit-behavior/behaviors/` no longer diverge; `behaviors/` is regenerated deterministically from `extracted/` + manifests.
- [ ] `grep -r "candidateFeatureKey" scripts/behavior-audit tests/scripts/behavior-audit` returns 0 matches.
- [ ] `grep -r "timesUsed" scripts/behavior-audit/keyword-vocabulary.ts` returns 0 matches.
- [ ] `grep -r "extractedBehaviorsByKey\|evaluationsByKey" scripts/behavior-audit` returns 0 matches.
- [ ] Resetting phase 2 removes `classified/`, `consolidated/`, `evaluated/`, and `stories/`.
- [ ] Full test suite and typecheck pass with no lint-disable or type-ignore additions.

---

## 6. Post-Migration

Once this plan is complete, the architecture can be simplified further:

- `report-writer.ts` can be split into pure renderers (`behavior-renderer.ts`, `story-renderer.ts`, `index-renderer.ts`) that accept artifact streams.
- `progress.json` can be narrowed to a smaller cursor schema because it no longer carries payload references.
- `behaviors/` and `stories/` can be optionally `.gitignore`-d if they are always rebuilt in CI.

---

## Appendix: Post-Migration Artifact Reference

These examples show the actual data in canonical artifacts and derived Markdown after migration. Not code — artifact contents.

### Extracted Artifact (`extracted/{testKey}.json`)

```json
{
  "version": 4,
  "metadata": {
    "sourceTestFile": "tests/core/task-manager.test.ts",
    "extractedAt": "2026-04-23T14:00:00Z"
  },
  "records": [
    {
      "behaviorId": "beh-001-task-create-priority",
      "testKey": "tests/core/task-manager.test.ts",
      "title": "Task manager should create a task with priority",
      "description": "When an authorized user submits a createTask call with a priority field, the task is persisted with the provided priority value and a createdAt timestamp.",
      "keywords": ["create-task", "priority", "authorization"],
      "testLocation": {
        "filePath": "tests/core/task-manager.test.ts",
        "lineStart": 45,
        "lineEnd": 62
      }
    }
  ]
}
```

**Key:** `featureKey` does not exist here. Identity is `testKey` + `behaviorId`. `featureKey` is assigned at manifest level.

---

### Incremental Manifest (`incremental-manifest.json`)

```json
{
  "version": 4,
  "entries": [
    {
      "testKey": "tests/core/task-manager.test.ts",
      "testFile": "tests/core/task-manager.test.ts",
      "featureKey": "task-manager",
      "extractedArtifactPath": "extracted/tests-core-task-manager.test.ts.json",
      "behaviorIds": ["beh-001-task-create-priority"]
    }
  ]
}
```

**Key:** `featureKey` is canonical here (no `candidateFeatureKey` alias). All cross-phase lookups go through this manifest.

---

### Consolidated Artifact (`consolidated/{featureKey}.json`)

```json
{
  "version": 4,
  "metadata": { "featureKey": "task-manager" },
  "consolidatedId": "cons-task-manager-001",
  "title": "Task Manager",
  "description": "Core task management behaviors covering creation and authorization.",
  "behaviors": [
    {
      "behaviorId": "beh-001-task-create-priority",
      "title": "Task manager should create a task with priority",
      "description": "When an authorized user submits a createTask call...",
      "keywords": ["create-task", "priority", "authorization"],
      "testLocation": { "filePath": "tests/core/task-manager.test.ts", "lineStart": 45, "lineEnd": 62 },
      "classification": { "category": "task-lifecycle", "subcategory": "creation", "confidence": 0.97 }
    }
  ]
}
```

**Key:** single canonical feature definition. References `behaviorId` from extracted artifact; no duplication of strings.

---

### Keyword Vocabulary (`keyword-vocabulary.json`)

```json
[
  {
    "slug": "authorization",
    "description": "Tests covering identity verification and access control.",
    "createdAt": "2026-04-23T14:00:00Z",
    "updatedAt": "2026-04-23T14:00:00Z"
  }
]
```

**Key:** no `timesUsed`; sorted by `slug`; deterministic merge (earliest `createdAt`, latest `updatedAt`, latest description).

---

### Derived Markdown (rebuilt from artifacts only)

#### `behaviors/task-manager.md` (from `extracted/`)

```markdown
# Task Manager — Behaviors

## beh-001-task-create-priority

**Task manager should create a task with priority**

When an authorized user submits a createTask call with a priority field...

**Keywords:** create-task, priority, authorization

**Test Location:** `tests/core/task-manager.test.ts:45–62`
```

#### `stories/task-manager.md` (from `consolidated/` + `evaluated/`)

```markdown
# Story: Task Manager

**Feature Key:** `task-manager`

## Narrative

Core task management behaviors covering creation and authorization.

## Behaviors

- **beh-001-task-create-priority** — category: task-lifecycle/creation (confidence 0.97)

## Evaluation

| Metric  | Score |
| ------- | ----- |
| Overall | 0.93  |
```

**Key:** both Markdown files are strictly derivative. Delete them, run `reportRebuildOnly`, they regenerate identically from canonical JSON.
