# Behavior Audit Artifact Model Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining behavior-audit artifact-model redesign work from the live codebase baseline by removing legacy compatibility shims, making rebuild and reset flows artifact-driven, and normalizing keyword vocabulary.

**Architecture:** The current repo already has canonical extracted, classified, consolidated, and evaluated JSON artifacts plus checkpoint-only `progress.json`. The remaining work is cleanup and convergence: remove payload-era aliases and fallbacks, make rebuild-only mode read canonical artifacts directly, and make vocabulary files canonical and unique by `slug`.

**Tech Stack:** TypeScript, Bun, Zod, JSON artifact stores, Bun test

---

## Live Baseline

The following parts of the redesign are already implemented in the current repo and should be treated as baseline, not new work:

- `scripts/behavior-audit/artifact-paths.ts` already exists.
- `scripts/behavior-audit/extracted-store.ts` already exists.
- `scripts/behavior-audit/evaluated-store.ts` already exists.
- `scripts/behavior-audit/config.ts` already exports `EXTRACTED_DIR` and `EVALUATED_DIR`.
- `scripts/behavior-audit/progress.ts` is already on `version: 4` and is checkpoint-only.
- Phase 1 already writes extracted JSON artifacts and derived behavior Markdown.
- Phase 2a already reads extracted artifacts and writes per-test-file classified artifacts.
- Phase 2b already joins extracted and classified artifacts and writes consolidated JSON.
- Phase 3 already writes evaluated JSON artifacts and updates consolidated-manifest evaluation metadata.

This plan only covers the remaining delta from that live baseline.

---

### File Map

**Primary runtime files still expected to change:**

- `scripts/behavior-audit.ts` — rebuild-only mode still uses legacy rebuild inputs
- `scripts/behavior-audit/incremental.ts` — manifest and selection types still expose payload-era aliases
- `scripts/behavior-audit/incremental-selection.ts` — still uses `candidateFeatureKey` naming
- `scripts/behavior-audit/classify-phase2a-helpers.ts` — still has legacy fallback to `progress.phase1.extractedBehaviors`
- `scripts/behavior-audit/consolidate.ts` — still falls back to `candidateFeatureKey`
- `scripts/behavior-audit/evaluate-phase3-helpers.ts` — still falls back to `candidateFeatureKey`
- `scripts/behavior-audit/report-writer.ts` — rebuild path still depends on legacy keyed maps instead of canonical artifact loading
- `scripts/behavior-audit/keyword-vocabulary.ts` — still stores `timesUsed` and allows duplicate slugs
- `scripts/behavior-audit/keyword-resolver-agent.ts` — still returns vocabulary entries with `timesUsed`
- `scripts/behavior-audit/extract.ts` — still appends vocabulary entries without normalization
- `scripts/behavior-audit-reset.ts` — phase reset paths do not yet clean up `evaluated/`

**Primary test and fixture files still expected to change:**

- `tests/scripts/behavior-audit-incremental.test.ts`
- `tests/scripts/behavior-audit-entrypoint.test.ts`
- `tests/scripts/behavior-audit-phase2a.test.ts`
- `tests/scripts/behavior-audit-phase2b.test.ts`
- `tests/scripts/behavior-audit-phase3.test.ts`
- `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- `tests/scripts/behavior-audit-storage.test.ts`
- `tests/scripts/behavior-audit-integration.helpers.ts`
- `tests/scripts/behavior-audit-integration.support.ts`

---

### Task 1: Remove legacy manifest aliases and rename selection surfaces

**Files:**

- Modify: `scripts/behavior-audit/incremental.ts`
- Modify: `scripts/behavior-audit/incremental-selection.ts`
- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate-phase3-helpers.ts`
- Modify: `scripts/behavior-audit/progress.ts`
- Test: `tests/scripts/behavior-audit-incremental.test.ts`
- Test: `tests/scripts/behavior-audit-entrypoint.test.ts`
- Test: `tests/scripts/behavior-audit-phase2b.test.ts`
- Test: `tests/scripts/behavior-audit-phase3.test.ts`
- Test helper: `tests/scripts/behavior-audit-integration.helpers.ts`
- Test helper: `tests/scripts/behavior-audit-integration.support.ts`

- [ ] **Step 1: Write failing tests for feature-key-only manifests and selections**

Update tests to expect:

- `IncrementalSelection` uses `phase2bSelectedFeatureKeys`
- `ManifestTestEntry` no longer exposes `candidateFeatureKey`
- `ManifestTestEntry` no longer exposes `extractedBehaviorPath`
- `ConsolidatedManifestEntry` no longer exposes `candidateFeatureKey`
- entrypoint wiring and test fixtures use `featureKey` only

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-entrypoint.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: FAIL because runtime types and helpers still allow alias fields and old selection names.

- [ ] **Step 2: Remove payload-era aliases from manifest types and schemas**

Update `scripts/behavior-audit/incremental.ts` so:

- `ManifestTestEntry` keeps `featureKey` only
- `ManifestTestEntry` keeps `extractedArtifactPath` only
- `ConsolidatedManifestEntry` keeps `featureKey` only
- schema parsing stops backfilling `candidateFeatureKey` and `extractedBehaviorPath`

- [ ] **Step 3: Rename selection surfaces to feature-key language**

Update `scripts/behavior-audit/incremental.ts`, `incremental-selection.ts`, and `scripts/behavior-audit.ts` so:

- `phase2bSelectedCandidateFeatureKeys` becomes `phase2bSelectedFeatureKeys`
- helper variable names use `featureKey` consistently
- phase 2b call sites use the renamed field and no longer mention candidate naming

- [ ] **Step 4: Remove runtime fallback reads of `candidateFeatureKey`**

Update `scripts/behavior-audit/consolidate.ts` and `scripts/behavior-audit/evaluate-phase3-helpers.ts` so feature-key lookup reads only `entry.featureKey`.

- [ ] **Step 5: Rename remaining progress helper names for clarity**

Update `scripts/behavior-audit/progress.ts` so `markCandidateFeatureDone()` and related local names become `markFeatureKeyDone()` or equivalent feature-key terminology.

- [ ] **Step 6: Update test fixtures and support helpers**

Update test helpers so fixture creators stop writing alias fields and tests assert current canonical names only.

- [ ] **Step 7: Run focused manifest and selection tests**

Run:

```bash
bun test ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-entrypoint.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: PASS with feature-key-only manifests and renamed selection fields.

- [ ] **Step 8: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/incremental.ts scripts/behavior-audit/incremental-selection.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate-phase3-helpers.ts scripts/behavior-audit/progress.ts tests/scripts/behavior-audit-incremental.test.ts tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts tests/scripts/behavior-audit-integration.helpers.ts tests/scripts/behavior-audit-integration.support.ts
git commit -m "refactor(behavior-audit): remove legacy manifest aliases"
```

---

### Task 2: Remove payload-era fallbacks from phase loaders

**Files:**

- Modify: `scripts/behavior-audit/classify-phase2a-helpers.ts`
- Modify: `scripts/behavior-audit/classify.ts`
- Modify: `scripts/behavior-audit/consolidate.ts`
- Modify: `scripts/behavior-audit/evaluate-phase3-helpers.ts`
- Test: `tests/scripts/behavior-audit-phase2a.test.ts`
- Test: `tests/scripts/behavior-audit-phase2b.test.ts`
- Test: `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Write failing tests for artifact-only phase loading**

Update tests to expect:

- Phase 2a no longer falls back to `progress.phase1.extractedBehaviors`
- Phase 2a skips missing canonical extracted artifacts instead of reading payload-era progress state
- Phase 2b and Phase 3 rely on manifest `featureKey` only
- no test fixture needs legacy payload maps to drive classification or evaluation

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: FAIL because `classify-phase2a-helpers.ts` still includes the legacy extracted-behavior fallback.

- [ ] **Step 2: Remove the legacy progress fallback from Phase 2a**

Update `scripts/behavior-audit/classify-phase2a-helpers.ts` so `loadSelectedBehaviors()` loads selected inputs from manifest entries plus extracted artifacts only and deletes `getLegacySelectedBehaviors()`.

- [ ] **Step 3: Keep Phase 2a behavior-id selection canonical**

Ensure the selected extracted record path remains:

- manifest entry lookup by `testKey`
- extracted file lookup by `manifestEntry.testFile`
- record selection by `behaviorId` or `testKey`

without any dependency on payload-heavy checkpoint state.

- [ ] **Step 4: Re-run focused phase-loader tests**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase2a.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: PASS with artifact-only phase loading.

- [ ] **Step 5: Commit**

```bash
git add scripts/behavior-audit/classify-phase2a-helpers.ts scripts/behavior-audit/classify.ts scripts/behavior-audit/consolidate.ts scripts/behavior-audit/evaluate-phase3-helpers.ts tests/scripts/behavior-audit-phase2a.test.ts tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts
git commit -m "refactor(behavior-audit): require canonical artifacts for phase loading"
```

---

### Task 3: Rebuild reports from canonical artifacts only

**Files:**

- Modify: `scripts/behavior-audit.ts`
- Modify: `scripts/behavior-audit/report-writer.ts`
- Modify: `scripts/behavior-audit/evaluate-reporting.ts`
- Test: `tests/scripts/behavior-audit-entrypoint.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`
- Test: `tests/scripts/behavior-audit-phase3.test.ts`

- [ ] **Step 1: Write failing tests for artifact-driven rebuild-only mode**

Update tests to expect:

- rebuild-only mode scans `incremental-manifest.json` for extracted artifact paths
- rebuild-only mode scans `consolidated-manifest.json` for consolidated and evaluated artifact paths
- behavior Markdown rebuild uses extracted JSON artifacts only
- story Markdown and index rebuild use consolidated plus evaluated JSON artifacts only
- rebuild path no longer accepts or depends on payload-era `extractedBehaviorsByKey` or `evaluationsByKey`

Run:

```bash
bun test ./tests/scripts/behavior-audit-entrypoint.test.ts ./tests/scripts/behavior-audit-storage.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: FAIL because `runBehaviorAudit()` still passes legacy rebuild inputs and `report-writer.ts` still expects legacy keyed maps.

- [ ] **Step 2: Replace the rebuild-only entrypoint path**

Update `scripts/behavior-audit.ts` so `selection.reportRebuildOnly` triggers canonical artifact loading instead of passing empty legacy maps into `rebuildReportsFromStoredResults()`.

- [ ] **Step 3: Rewrite rebuild helpers around canonical artifact stores**

Update `scripts/behavior-audit/report-writer.ts` so rebuild logic:

- loads extracted records per test file using manifest entries
- loads consolidated records per feature key
- loads evaluated records per feature key
- rebuilds behavior Markdown, stories, and index from those canonical artifacts

- [ ] **Step 4: Keep story-report aggregation aligned with canonical feature-key maps**

If needed, tighten `scripts/behavior-audit/evaluate-reporting.ts` so its story aggregation matches the same feature-key and consolidated-id conventions as the rebuild path.

- [ ] **Step 5: Run focused rebuild tests**

Run:

```bash
bun test ./tests/scripts/behavior-audit-entrypoint.test.ts ./tests/scripts/behavior-audit-storage.test.ts ./tests/scripts/behavior-audit-phase3.test.ts
```

Expected: PASS with artifact-driven rebuilds and no checkpoint payload dependency.

- [ ] **Step 6: Commit**

```bash
git add scripts/behavior-audit.ts scripts/behavior-audit/report-writer.ts scripts/behavior-audit/evaluate-reporting.ts tests/scripts/behavior-audit-entrypoint.test.ts tests/scripts/behavior-audit-storage.test.ts tests/scripts/behavior-audit-phase3.test.ts
git commit -m "refactor(behavior-audit): rebuild reports from canonical artifacts"
```

---

### Task 4: Normalize keyword vocabulary and remove `timesUsed`

**Files:**

- Modify: `scripts/behavior-audit/keyword-vocabulary.ts`
- Modify: `scripts/behavior-audit/keyword-resolver-agent.ts`
- Modify: `scripts/behavior-audit/extract.ts`
- Test: `tests/scripts/behavior-audit-phase1-keywords.test.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`
- Test helper: `tests/scripts/behavior-audit-integration.support.ts`

- [ ] **Step 1: Write failing tests for canonical vocabulary normalization**

Update tests to expect:

- vocabulary entries do not contain `timesUsed`
- duplicate slug entries normalize into one canonical entry
- normalization keeps earliest `createdAt`, latest `updatedAt`, and most recently updated description
- Phase 1 does not append a duplicate slug when the resolver returns an already-known slug
- any legacy vocabulary fixture with `timesUsed` is rewritten into canonical shape

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase1-keywords.test.ts ./tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because both runtime code and tests still use `timesUsed`.

- [ ] **Step 2: Remove `timesUsed` from runtime schemas**

Update `scripts/behavior-audit/keyword-vocabulary.ts` and `scripts/behavior-audit/keyword-resolver-agent.ts` so canonical vocabulary entries contain only:

- `slug`
- `description`
- `createdAt`
- `updatedAt`

- [ ] **Step 3: Add deterministic slug normalization**

Implement normalization in `scripts/behavior-audit/keyword-vocabulary.ts` that:

- groups by `slug`
- keeps earliest `createdAt`
- keeps latest `updatedAt`
- keeps the description from the most recently updated entry
- sorts output by `slug`

- [ ] **Step 4: Normalize vocabulary writes in Phase 1**

Update `scripts/behavior-audit/extract.ts` so the next vocabulary file is built by normalizing existing entries plus appended resolver entries instead of blindly concatenating arrays.

- [ ] **Step 5: Remove usage-count behavior**

Delete or simplify `recordKeywordUsage()` so runtime code no longer tries to maintain mutable usage telemetry inside `keyword-vocabulary.json`.

- [ ] **Step 6: Run focused vocabulary tests**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase1-keywords.test.ts ./tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS with unique canonical vocabulary slugs and no `timesUsed` field.

- [ ] **Step 7: Commit**

```bash
git add scripts/behavior-audit/keyword-vocabulary.ts scripts/behavior-audit/keyword-resolver-agent.ts scripts/behavior-audit/extract.ts tests/scripts/behavior-audit-phase1-keywords.test.ts tests/scripts/behavior-audit-storage.test.ts tests/scripts/behavior-audit-integration.support.ts
git commit -m "refactor(behavior-audit): normalize keyword vocabulary"
```

---

### Task 5: Fix phase reset behavior for evaluated artifacts

**Files:**

- Modify: `scripts/behavior-audit-reset.ts`
- Test: `tests/scripts/behavior-audit-storage.test.ts`

- [ ] **Step 1: Write failing reset tests for evaluated artifact cleanup**

Update tests to expect:

- `resetBehaviorAudit('phase2')` removes `classified/`, `consolidated/`, `evaluated/`, and `stories/`
- `resetBehaviorAudit('phase3')` removes `evaluated/` and `stories/` only
- `resetBehaviorAudit('phase2')` still preserves canonical `keyword-vocabulary.json`

Run:

```bash
bun test ./tests/scripts/behavior-audit-storage.test.ts
```

Expected: FAIL because current reset paths do not remove `evaluated/`.

- [ ] **Step 2: Update reset flows for the new artifact tree**

Modify `scripts/behavior-audit-reset.ts` so:

- phase 2 reset removes `CLASSIFIED_DIR`, `CONSOLIDATED_DIR`, `EVALUATED_DIR`, `STORIES_DIR`, and `CONSOLIDATED_MANIFEST_PATH`
- phase 3 reset removes `EVALUATED_DIR` and `STORIES_DIR`
- checkpoint resets still use `resetPhase2AndPhase3()` and `resetPhase3()` only

- [ ] **Step 3: Run reset tests**

Run:

```bash
bun test ./tests/scripts/behavior-audit-storage.test.ts
```

Expected: PASS with evaluated-artifact cleanup in reset flows.

- [ ] **Step 4: Commit**

```bash
git add scripts/behavior-audit-reset.ts tests/scripts/behavior-audit-storage.test.ts
git commit -m "fix(behavior-audit): reset evaluated artifacts with downstream phases"
```

---

### Task 6: Run full verification and clean up stale test coupling

**Files:**

- Modify: any touched test or helper files that still assume alias fields or `timesUsed`

- [ ] **Step 1: Run the full behavior-audit test slice**

Run:

```bash
bun test ./tests/scripts/behavior-audit-phase1-keywords.test.ts ./tests/scripts/behavior-audit-phase1-selection.test.ts ./tests/scripts/behavior-audit-phase2a.test.ts ./tests/scripts/behavior-audit-phase2b.test.ts ./tests/scripts/behavior-audit-phase3.test.ts ./tests/scripts/behavior-audit-incremental.test.ts ./tests/scripts/behavior-audit-storage.test.ts ./tests/scripts/behavior-audit-entrypoint.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo verification commands**

Run:

```bash
bun test
bun typecheck
bun lint
```

Expected: PASS.

- [ ] **Step 3: Commit final cleanup**

```bash
git add scripts/behavior-audit scripts/behavior-audit.ts scripts/behavior-audit-reset.ts tests/scripts docs/superpowers/specs/2026-04-23-behavior-audit-artifact-model-design.md docs/superpowers/plans/2026-04-23-behavior-audit-artifact-model.md
git commit -m "refactor(behavior-audit): finish artifact-model convergence"
```

---

### Spec Coverage Check

- canonical JSON artifacts: already implemented in baseline; remaining convergence covered by Tasks 1, 2, and 3
- payload-free progress: already implemented in baseline; remaining alias cleanup covered by Tasks 1 and 2
- manifest-only indexing: remaining alias and naming cleanup covered by Task 1
- startup stale state reset before first save: already implemented in baseline and retained during Task 2 verification
- vocabulary uniqueness and `timesUsed` removal: covered by Task 4
- rebuild-only mode using canonical artifacts: covered by Task 3
- reset behavior under the new artifact tree: covered by Task 5

No gaps found relative to the live baseline.
