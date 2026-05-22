<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0109: Behavior Audit — Hybrid State to Canonical Artifact Model

## Status

Implemented (with divergences)

## Date

2026-04-23

## Context

The behavior-audit pipeline accumulated payload-era duplication between `progress.json` checkpoint state and durable artifacts under `reports/audit-behavior/`.

Verified current state before migration:

1. `progress.json` stored extracted payloads in `phase1.extractedBehaviors`, classified payloads in `phase2a.classifiedBehaviors`, consolidated payloads in `phase2b.consolidations`, and evaluation payloads in `phase3.evaluations` — redundant with standalone JSON artifacts.
2. `incremental-manifest.json` carried `candidateFeatureKey` and `extractedBehaviorPath` aliases while also exposing canonical `featureKey` and `extractedArtifactPath`.
3. `keyword-vocabulary.json` allowed duplicate `slug` values and mixed mutable `timesUsed` telemetry into an otherwise canonical vocabulary definition.
4. Report rebuild mode called `rebuildReportsFromStoredResults({ extractedBehaviorsByKey, evaluationsByKey })` from checkpoint payload maps rather than canonical artifact stores.
5. `resetBehaviorAudit('phase2')` removed checkpoint files but left `evaluated/` and `stories/` behind, allowing stale artifacts to leak across runs.
6. `behaviors/` Markdown existed as a separate content store rather than a strictly derivative output from `extracted/` artifacts.

## Decision Drivers

- **Must eliminate dual-write duplication** — canonical JSON is the only durable output
- **Must make progress.json checkpoint-only** — no business payloads in checkpoint state
- **Must normalize keyword vocabulary** — unique slugs, no mutable telemetry
- **Must make reset tree-complete** — downstream artifacts cleaned with phase resets
- **Must make rebuild deterministic** — Markdown regenerates identically from JSON artifacts
- **Should preserve existing test coverage** — 219 behavior-audit tests must continue passing

## Decision

Migrate the behavior-audit pipeline from a hybrid checkpoint/artifact model to a fully canonical artifact model by:

1. Removing all legacy manifest aliases (`candidateFeatureKey`, `extractedBehaviorPath`).
2. Removing payload-era fallbacks from phase loaders — Phases 2a, 2b, and 3 read exclusively from canonical artifacts + manifests.
3. Rewriting report rebuild mode to load from `extracted/`, `consolidated/`, and `evaluated/` JSON artifacts via manifest indexing.
4. Normalizing `keyword-vocabulary.json` to unique slugs with deterministic merge rules and removing `timesUsed`.
5. Updating phase reset to remove all downstream artifact directories (`classified/`, `consolidated/`, `evaluated/`, `stories/`, `consolidated-manifest.json`).

## Considered Options

### Option 1: Keep Hybrid Model with Compatibility Shims (rejected)

- **Pros**: Zero migration cost, backward-compatible progress files.
- **Cons**: Dual writes persist indefinitely; schema confusion grows with each new phase; reset leaks stale state; vocabulary duplicates amplify over time.
- **Verdict**: Rejected — technical debt compounding.

### Option 2: Full Artifact-Driven Pipeline with Incremental Manifest Indexing (adopted)

- **Pros**: Single source of truth per phase; deterministic rebuild; clean reset; vocabulary integrity.
- **Cons**: One-time rename/refactor across scripts and tests; old progress files incompatible.
- **Verdict**: Adopted — aligns with existing artifact paths already created in baseline.

### Option 3: Replace All Artifacts with Database (rejected)

- **Pros**: Centralized state, ACID transactions.
- **Cons**: Adds runtime dependency for a developer/analysis tool; overkill for current scale; no migration value for a tool that already works.
- **Verdict**: Rejected — scoped to file-based developer tool.

## Implementation

### Phase A: Remove Legacy Manifest Aliases

- `scripts/behavior-audit/incremental.ts`: Removed `candidateFeatureKey` and `extractedBehaviorPath` from `ManifestTestEntry` and `ConsolidatedManifestEntry` types/schemas.
- `scripts/behavior-audit/incremental-selection.ts`: Renamed `phase2bSelectedCandidateFeatureKeys` → `phase2bSelectedFeatureKeys`.
- `scripts/behavior-audit/progress.ts`: Renamed `markCandidateFeatureDone()` → `markFeatureKeyDone()`.
- Phase 2b call sites updated to `featureKey`-only naming.

### Phase B: Remove Payload-Era Fallbacks

- `scripts/behavior-audit/classify-phase2a-helpers.ts`: `loadSelectedBehaviors()` loads from `incremental-manifest.json` + `extracted/` artifacts only. `getLegacySelectedBehaviors()` deleted.
- `scripts/behavior-audit/consolidate.ts`: Reads `featureKey` directly from manifest; no alias fallback.
- `scripts/behavior-audit/evaluate-phase3-helpers.ts`: Uses `getFeatureKey(entry)` with no alias fallback.

### Phase C: Rebuild Reports from Canonical Artifacts

- `scripts/behavior-audit/index.ts`: `reportRebuildOnly` path calls `rebuildReportsFromStoredResults({ consolidatedManifest })`.
- `scripts/behavior-audit/report-writer.ts`: Rebuild loads `consolidated/` and `evaluated/` JSON via `loadConsolidatedArtifacts()` + `loadEvaluatedArtifacts()` — both resolve artifact paths through `consolidated-manifest.json`.
- `scripts/behavior-audit/report-rebuild-helpers.ts`: Implements `collectFeatureArtifactPaths()`, `loadConsolidatedArtifacts()`, `loadEvaluatedArtifacts()`, and `collectStoryEvaluations()`.

### Phase D: Normalize Keyword Vocabulary

- `scripts/behavior-audit/keyword-vocabulary.ts`: Added `normalizeKeywordVocabularyEntries()`:
  - groups by normalized `slug`
  - keeps earliest `createdAt`
  - keeps latest `updatedAt`
  - keeps description from most recently updated entry
  - sorts output by `slug`
- `timesUsed` removed from schema; no `recordKeywordUsage()` equivalent exists.
- `loadKeywordVocabulary()` normalizes on read; `saveKeywordVocabulary()` normalizes on write.

### Phase E: Fix Phase Reset for Evaluated Artifacts

- `scripts/behavior-audit/reset.ts`:
  - phase 2 removes `CLASSIFIED_DIR`, `CONSOLIDATED_DIR`, `EVALUATED_DIR`, `STORIES_DIR`, `CONSOLIDATED_MANIFEST_PATH`
  - phase 3 removes `EVALUATED_DIR`, `STORIES_DIR`
  - `keyword-vocabulary.json` preserved across resets

## Divergences from Original Plan

| Plan Item                     | Expected                                                                 | Actual                                                               | Reason                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `rebuildReportsFromArtifacts` | Rename `rebuildReportsFromStoredResults` → `rebuildReportsFromArtifacts` | Kept original name                                                   | Function already accepts only `{ consolidatedManifest }`; rename would churn 7 call sites across tests without behavioral change |
| `timesUsed` in tests          | 0 matches including tests                                                | 3 matches in legacy fixture at `phase1-keywords.test.ts:282,289,296` | Fixture writes legacy entries with `timesUsed` to verify `loadKeywordVocabulary()` strips/normalizes them correctly on read      |
| `progress.json` version       | Remain `4` throughout                                                    | Changed to `5` in baseline prior to this migration                   | Schema already evolved independently in an earlier commit (`version: 5` with `phase1b` embedding statistics)                     |

## Consequences

### Positive

- Canonical JSON artifacts are the single durable source of truth.
- `progress.json` is checkpoint-only; no payload duplication.
- Report rebuild is deterministic from artifacts.
- Vocabulary deduplication prevents slug proliferation.
- Phase reset fully cleans downstream artifacts.
- 219 behavior-audit tests pass with no legacy alias dependencies.

### Negative

- Old `progress.json` files with payload maps are incompatible; users must run fresh audits or reset before resuming.
- `rebuildReportsFromStoredResults` retains an old name despite only reading artifacts.

### Risks

- **Risk**: Vocabulary normalization chooses description from most recently updated entry, which may not always be the best description.
- **Mitigation**: If this proves problematic, evaluation can be replaced with a user-facing merge strategy or explicit override flag.

## Verification

- `grep -r "candidateFeatureKey" scripts/behavior-audit tests/scripts/behavior-audit` → **0 matches**
- `grep -r "extractedBehaviorPath" scripts/behavior-audit tests/scripts/behavior-audit` → **0 matches**
- `grep -r "extractedBehaviorsByKey\|evaluationsByKey" scripts/behavior-audit tests/scripts/behavior-audit` → **0 matches**
- `grep -r "timesUsed" scripts/behavior-audit/*.ts` → **0 matches**
- `grep -r "progress.phase1.extractedBehaviors" scripts/behavior-audit tests/scripts/behavior-audit` → **0 matches**
- `bun test ./tests/scripts/behavior-audit/` → **219 pass, 0 fail**
- `bun typecheck` → **exit 0**
- `bun lint` → **0 warnings, 0 errors**

## Related Decisions

- [ADR-0077](0077-behavior-audit-implementation.md) — Base behavior-audit pipeline
- [ADR-0073](0073-behavior-audit-incremental-runs.md) — Incremental rerun selection (relies on manifest-only indexing after this migration)
- [ADR-0102](0102-behavior-audit-progress-reporting.md) — Progress reporting events
- [ADR-0108](0108-behavior-audit-json-extraction-cleanup.md) — Prior JSON extraction cleanup

## References

- Design spec: `docs/archive/2026-04-23-behavior-audit-artifact-model-design.md` (moved from `docs/superpowers/specs/`)
- Implementation plan: `docs/archive/2026-04-23-hybrid-to-artifact-migration.md` (moved from `docs/superpowers/plans/`)
- Superseded plan: `docs/archive/2026-04-23-behavior-audit-artifact-model.md` (moved from `docs/superpowers/plans/`)
