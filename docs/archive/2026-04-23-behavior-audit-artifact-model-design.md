# Behavior Audit Artifact Model Redesign

Date: 2026-04-23
Status: Proposed

## Problem

The current `behavior-audit` artifact model is hard to reason about because runtime checkpoint state, durable domain data, indexes, and human-readable reports are mixed together.

Verified current behavior from `scripts/behavior-audit/*.ts` and `tests/scripts/*.test.ts`:

1. `progress.json` stores large domain payloads for multiple phases.
2. Behavior Markdown files under `reports/audit-behavior/behaviors/` also store extracted behavior content.
3. `incremental-manifest.json` overlaps with `progress.json` on per-test identity and lifecycle tracking.
4. `runPhase1()` saves `progress.json` before downstream phase state is reset, so stale Phase 2 or Phase 3 data can be visible at startup.
5. `keyword-vocabulary.json` allows duplicate `slug` values because writes validate shape but not uniqueness.
6. `timesUsed` mixes mutable usage telemetry into a file that otherwise looks like a canonical vocabulary definition.
7. `candidateFeatureKey` is an implementation-oriented name that is not clear in artifacts without code context.

The main issue is not only duplication. The main issue is artifact role confusion.

## Verified Current Behavior

### Phase 1

- `runPhase1()` writes `progress.json` at phase start, after each selected test file batch, and at phase end.
- `markTestDone()` stores full extracted behavior payloads in `progress.phase1.extractedBehaviors`.
- `writeBehaviorFile()` writes per-test-file Markdown reports under `behaviors/<domain>/<file>.md`.
- `updateManifestForExtractedTest()` stores per-test metadata and `extractedBehaviorPath` in `incremental-manifest.json`.

### Phase 2a

- `runPhase2a()` reads selected inputs from `progress.phase1.extractedBehaviors`.
- `markClassificationDone()` stores full classification payloads in `progress.phase2a.classifiedBehaviors`.
- `writeClassifiedFile()` writes per-domain JSON arrays under `classified/<domain>.json`.
- `updateManifestForClassification()` stores `behaviorId`, `candidateFeatureKey`, fingerprints, and timestamps in `incremental-manifest.json`.

### Phase 2b

- `runPhase2b()` reads selected inputs from `progress.phase2a.classifiedBehaviors`.
- `markBatchDone()` stores full consolidations in `progress.phase2b.consolidations`.
- `writeConsolidatedFile()` writes per-feature-key JSON arrays under `consolidated/<feature-key>.json`.
- `consolidated-manifest.json` stores durable feature-level metadata.

### Phase 3

- `runPhase3()` reads consolidated JSON files.
- `markBehaviorDone()` stores full evaluation payloads in `progress.phase3.evaluations`.
- Story Markdown is generated from in-memory evaluation results and stored progress payloads.
- report rebuild mode currently depends on `progress.phase1.extractedBehaviors` and `progress.phase3.evaluations`.

### Vocabulary

- `saveKeywordVocabulary()` only validates schema shape.
- Phase 1 appends new entries without deduplicating by `slug`.
- `recordKeywordUsage()` increments every matching duplicate entry, which preserves and amplifies duplicate slugs.
- `timesUsed` is not used in prompt construction and is not part of rerun-selection logic.

## Goals

1. Make artifact responsibilities obvious from filenames, schemas, and ownership rules.
2. Give each durable domain object one canonical storage format.
3. Reduce payload duplication between checkpoint files and durable artifacts.
4. Make `progress.json` a pure checkpoint file.
5. Make manifest files pure index or rerun-selection files.
6. Eliminate duplicate vocabulary slugs and define vocabulary integrity explicitly.
7. Remove or relocate `timesUsed` so vocabulary artifacts do not mix identity and telemetry.
8. Ensure report rebuild mode works from canonical stored artifacts, not from checkpoint payloads.
9. Prevent stale downstream phase payloads from being persisted before upstream invalidation is applied.

## Non-Goals

1. Replacing the approved Phase 2a and Phase 2b architecture.
2. Changing the LLM prompts beyond field renames required by artifact clarity.
3. Preserving backward compatibility with previous `reports/audit-behavior/*` schemas.
4. Adding a database or external state store.

## Design Principles

1. Canonical data lives in structured JSON files only.
2. Human-readable Markdown is derived output only.
3. Checkpoint state never owns business payloads.
4. Index files store references, fingerprints, timestamps, and IDs, not domain content.
5. Every canonical artifact must answer one question clearly:
   - what object does this file store?
   - who writes it?
   - who reads it?
   - is it authoritative?

## Artifact Taxonomy

### 1. Canonical data artifacts

These files are the durable source of truth.

- `reports/audit-behavior/extracted/<domain>/<test-file>.json`
- `reports/audit-behavior/classified/<domain>/<test-file>.json`
- `reports/audit-behavior/consolidated/<featureKey>.json`
- `reports/audit-behavior/evaluated/<featureKey>.json`
- `reports/audit-behavior/keyword-vocabulary.json`

### 2. Checkpoint artifact

- `reports/audit-behavior/progress.json`

This file is current-run checkpoint state only.

### 3. Index artifacts

- `reports/audit-behavior/incremental-manifest.json`
- `reports/audit-behavior/consolidated-manifest.json`

These files exist to support rerun selection, lookup, invalidation, and report rebuild discovery.

### 4. Derived reports

- `reports/audit-behavior/behaviors/<domain>/<test-file>.md`
- `reports/audit-behavior/stories/<domain>.md`
- `reports/audit-behavior/stories/index.md`

These files are human-readable outputs generated from canonical JSON artifacts.

## Canonical Schemas

### Extracted behavior artifact

Each extracted file stores all extracted behaviors for one test file.

```ts
interface ExtractedBehaviorRecord {
  readonly behaviorId: string
  readonly testKey: string
  readonly testFile: string
  readonly domain: string
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
  readonly extractedAt: string
}
```

Storage rule:

- one file per test file
- sorted by `behaviorId`
- authoritative for extracted behavior content

### Classified behavior artifact

Each classified file stores classifications for one test file.

```ts
interface ClassifiedBehaviorRecord {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string | null
  readonly featureLabel: string | null
  readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]
  readonly classificationNotes: string
  readonly classifiedAt: string
}
```

Storage rule:

- one file per test file
- no duplication of extracted `behavior`, `context`, or `keywords`
- authoritative for classification results only

### Consolidated feature artifact

```ts
interface ConsolidatedFeatureRecord {
  readonly consolidatedId: string
  readonly featureKey: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string | null
  readonly context: string
  readonly sourceBehaviorIds: readonly string[]
  readonly sourceTestKeys: readonly string[]
  readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
  readonly consolidatedAt: string
}
```

Storage rule:

- one file per `featureKey`
- sorted by `consolidatedId`
- authoritative for consolidated feature content

### Evaluated feature artifact

```ts
interface EvaluatedFeatureRecord {
  readonly consolidatedId: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly evaluatedAt: string
}
```

Storage rule:

- one file per `featureKey`
- no duplication of consolidated feature prose
- authoritative for evaluation results only

### Keyword vocabulary artifact

```ts
interface KeywordVocabularyEntry {
  readonly slug: string
  readonly description: string
  readonly createdAt: string
  readonly updatedAt: string
}
```

Rules:

1. `slug` must be unique across the file.
2. `timesUsed` is removed from the canonical schema.
3. If keyword usage analytics are needed later, they must be derived from extracted artifacts or stored in a separate metrics file.
4. If slug suffix numbering is still required anywhere in generation logic, numbering starts at `0` and the rule must be deterministic.

## Checkpoint Schema

`progress.json` becomes payload-free checkpoint state.

```ts
interface ProgressV4 {
  readonly version: 4
  readonly startedAt: string
  readonly phase1: {
    status: PhaseStatus
    completedTests: Record<string, 'done'>
    failedTests: Record<string, FailedEntry>
    completedFiles: string[]
    stats: { filesTotal: number; filesDone: number; testsExtracted: number; testsFailed: number }
  }
  readonly phase2a: {
    status: PhaseStatus
    completedBehaviors: Record<string, 'done'>
    failedBehaviors: Record<string, FailedEntry>
    stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
  }
  readonly phase2b: {
    status: PhaseStatus
    completedFeatureKeys: Record<string, 'done'>
    failedFeatureKeys: Record<string, FailedEntry>
    stats: {
      featureKeysTotal: number
      featureKeysDone: number
      featureKeysFailed: number
      featuresConsolidated: number
    }
  }
  readonly phase3: {
    status: PhaseStatus
    completedConsolidatedIds: Record<string, 'done'>
    failedConsolidatedIds: Record<string, FailedEntry>
    stats: { behaviorsTotal: number; behaviorsDone: number; behaviorsFailed: number }
  }
}
```

Explicitly removed from `progress.json`:

- `phase1.extractedBehaviors`
- `phase2a.classifiedBehaviors`
- `phase2b.consolidations`
- `phase3.evaluations`

## Manifest Responsibilities

### incremental-manifest.json

Per-test entry purpose:

- identify a test behavior unit
- track dependency fingerprints
- point to extracted and classified artifacts
- track stable Phase 2a grouping through `featureKey`

```ts
interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2aFingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly behaviorId: string | null
  readonly featureKey: string | null
  readonly extractedArtifactPath: string | null
  readonly classifiedArtifactPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2aCompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}
```

Changes from current design:

- `candidateFeatureKey` is renamed to `featureKey`
- `extractedBehaviorPath` is replaced with `extractedArtifactPath`
- classified artifact location becomes explicit
- manifest stores references and fingerprints only

### consolidated-manifest.json

Per-consolidated-entry purpose:

- map `featureKey` to consolidated artifact file
- track feature-level fingerprints
- store source references for invalidation
- track evaluation metadata needed for Phase 3 reruns

```ts
interface ConsolidatedManifestEntry {
  readonly consolidatedId: string
  readonly featureKey: string
  readonly domain: string
  readonly consolidatedArtifactPath: string
  readonly evaluatedArtifactPath: string | null
  readonly featureName: string
  readonly sourceBehaviorIds: readonly string[]
  readonly sourceDomains: readonly string[]
  readonly isUserFacing: boolean
  readonly keywords: readonly string[]
  readonly phase2Fingerprint: string | null
  readonly phase3Fingerprint: string | null
  readonly lastConsolidatedAt: string | null
  readonly lastEvaluatedAt: string | null
}
```

## Report Generation Model

### Behavior Markdown

- built from extracted JSON artifacts only
- no reads from `progress.json`

### Story Markdown

- built by joining consolidated JSON with evaluated JSON
- no reads from `progress.json`

### Report rebuild-only mode

`runBehaviorAudit()` report rebuild mode must load:

- extracted JSON artifacts
- consolidated manifest
- consolidated JSON artifacts
- evaluated JSON artifacts

It must not depend on checkpoint payloads.

## Phase Flow After Redesign

### Phase 1

1. extract one test behavior
2. resolve keywords against unique vocabulary
3. write extracted JSON for the owning test file
4. update manifest entry
5. regenerate behavior Markdown for that test file
6. checkpoint progress without payload duplication

### Phase 2a

1. load extracted JSON records for selected tests
2. classify each behavior
3. write classified JSON for the owning test file
4. update manifest `featureKey` and fingerprints
5. checkpoint progress without classification payloads

### Phase 2b

1. load classified records and join with extracted records by `behaviorId`
2. group by `featureKey`
3. write consolidated JSON by `featureKey`
4. update consolidated manifest
5. checkpoint progress without consolidated payloads

### Phase 3

1. load consolidated JSON by selected `featureKey`
2. evaluate user-facing consolidated entries
3. write evaluated JSON by `featureKey`
4. update consolidated manifest Phase 3 metadata
5. rebuild story Markdown and index
6. checkpoint progress without evaluation payloads

## Startup and Reset Rules

1. If Phase 1 selected work is non-empty, downstream checkpoint phases must be reset before the first `progress.json` save for the run.
2. `resetBehaviorAudit('phase2')` removes classified, consolidated, and evaluated artifacts plus derived story reports, while preserving canonical vocabulary.
3. `resetBehaviorAudit('phase3')` removes evaluated artifacts and derived story reports only.
4. `resetBehaviorAudit('all')` removes the full audit root.

## Compatibility and Migration

This redesign intentionally breaks compatibility with previous generated artifacts.

Migration policy:

1. old `progress.json`, manifest files, extracted/classified/consolidated artifacts are treated as incompatible
2. startup must detect old versions and perform a controlled reset of incompatible generated artifacts
3. `keyword-vocabulary.json` receives special handling:
   - load old entries if possible
   - normalize duplicate slugs deterministically
   - drop `timesUsed`
   - rewrite in the new canonical schema

Deterministic duplicate-slug normalization rule:

1. group by `slug`
2. keep the earliest `createdAt`
3. keep the latest `updatedAt`
4. choose the description from the most recently updated entry
5. write one normalized entry per slug

## Testing Strategy

### Unit tests

- extracted store read and write
- classified store read and write under new per-test-file layout
- evaluated store read and write
- vocabulary uniqueness normalization
- checkpoint schema shape without payload maps
- manifest update logic with `featureKey`

### Integration tests

- Phase 1 writes extracted JSON and derived Markdown without storing extracted payloads in progress
- Phase 2a reads extracted JSON and writes classified JSON without storing classified payloads in progress
- Phase 2b joins extracted and classified stores and writes consolidated JSON
- Phase 3 writes evaluated JSON and rebuilds reports from canonical artifacts
- report rebuild-only mode works with payload-free progress
- startup resets stale downstream checkpoint state before first save when Phase 1 work is selected
- duplicate-slug vocabulary files normalize into a unique canonical vocabulary

## Decision Summary

1. Canonical business data moves into structured JSON artifacts.
2. Markdown is derived only.
3. `progress.json` becomes checkpoint-only.
4. manifests become index-only.
5. `candidateFeatureKey` is renamed to `featureKey`.
6. `timesUsed` is removed from `keyword-vocabulary.json`.
7. duplicate slug values are forbidden and normalized during transition.
