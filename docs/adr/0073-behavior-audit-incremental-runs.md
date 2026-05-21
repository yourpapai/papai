<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0073: Behavior Audit Incremental Runs

## Status

Accepted

## Date

2026-04-17

## Context

The behavior-audit pipeline (`scripts/behavior-audit.ts`) performs a full analysis of test files by running a three-phase process: Phase 1 extracts behavior specifications from test code, Phase 2 evaluates behavioral compliance using an LLM agent, and Phase 3 generates markdown reports. Each full run is expensive — Phase 1 parses all test files, Phase 2 makes model calls for every test case, and Phase 3 regenerates all outputs.

The existing `reports/progress.json` supports resuming an interrupted run, but it does not support selective rerun based on what has actually changed. Every new run starts from the full test set, making incremental development cycles unnecessarily slow and costly.

We need a mechanism to:

1. Establish an incremental baseline immediately at run start (not only at completion)
2. Detect which tests need reprocessing based on file changes
3. Skip unchanged tests whose audit inputs remain stable across runs
4. Handle interrupted runs gracefully while preserving the baseline for subsequent runs

## Decision Drivers

- **Must capture baseline at run start** — the first full run is expensive; waiting for completion is impractical
- **Must detect drift from test files and mirrored implementation files** — tests validate implementation behavior
- **Must handle phase-level invalidation** — changes to prompts, parsers, or models should invalidate affected phases
- **Must support report-only regeneration** — output format changes should not force model reruns
- **Must handle interrupted runs** — partial completion should still establish a baseline for next run

## Considered Options

### Option 1: Use Bun's built-in watch-mode changed-test detection

- **Pros**: Native integration, no custom code needed
- **Cons**: Bun's watch-mode only works during a live session; it does not provide a persisted changed-since-baseline selector suitable for long-running offline audits
- **Verdict**: Rejected — does not meet our cross-run incremental requirements

### Option 2: Track all files read by the agent during extraction/evaluation

- **Pros**: Maximum precision — any file the agent reads becomes a dependency
- **Cons**: Requires instrumenting all tool calls and treating dynamic agent exploration as durable dependency data; adds significant complexity to the first implementation
- **Verdict**: Rejected — too complex for initial implementation; may revisit later

### Option 3: Manifest-based incremental selection with git integration (chosen)

- **Pros**: Deterministic, easy to reason about, captures baseline at run start, supports cross-run invalidation, handles all required drift scenarios
- **Cons**: Narrower dependency tracking than full agent instrumentation; misses some edge cases where agent reads additional files
- **Verdict**: Accepted — provides the right balance of correctness and simplicity

## Decision

Implement a manifest-based incremental selection system that adds `reports/incremental-manifest.json` as a durable cross-run state file alongside the existing `reports/progress.json`.

### Manifest Schema

```typescript
interface IncrementalManifest {
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

interface ManifestTestEntry {
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
```

### Keying

Each manifest entry is keyed by `<testFile>::<fullTestPath>` to align with Phase 1 extraction, Phase 2 evaluation, and progress-tracking keys.

### Baseline Capture

At run start:

1. Read the previous manifest (if present)
2. Save `previousLastStartCommit` in memory
3. Capture current HEAD via `git rev-parse --verify HEAD`
4. Immediately write manifest with:
   - `lastStartCommit = current HEAD`
   - `lastStartedAt = now`
   - Unchanged test entries until individual items complete

This ensures interrupted runs still establish a baseline for the next execution.

### Changed-File Computation

Compute the changed-file set as the union of:

1. **Committed changes**: `git diff --name-only <previousLastStartCommit>...HEAD`
2. **Staged changes**: `git diff --name-only --cached`
3. **Unstaged changes**: `git diff --name-only`
4. **Untracked files**: `git ls-files --others --exclude-standard`

### Dependency Scope

Track exactly two dependency classes per test entry:

1. The test file itself
2. The mirrored implementation path (replace `tests/` → `src/`, `.test.ts` → `.ts`)

Example: `tests/tools/create-task.test.ts` → `src/tools/create-task.ts`

### Phase Version Hashes

Store version hashes for invalidation at phase scope:

- **Phase 1**: Hash of parser, extractor, tools, config, system prompt, model identifier
- **Phase 2**: Hash of evaluator, agent, personas, config, system prompt, model identifier
- **Reports**: Hash of report-writer code

### Per-Test Fingerprints

- **Phase 1 fingerprint**: Hash of test key, test file content, test source, mirrored source hash, phase version
- **Phase 2 fingerprint**: Hash of test key, extracted behavior text, context text, phase version

### Selection Algorithm

For each manifest test entry:

- **Direct dependency drift** (changed test file or mirrored source): Select for Phase 1 + Phase 2
- **Phase 1 version drift**: Select all tests for Phase 1 (invalidates Phase 2 downstream)
- **Phase 2 version drift only**: Select all tests with stored extracted behaviors for Phase 2 only
- **Report-writer drift only**: Regenerate reports without model reruns
- **New tests**: Select for Phase 1 + Phase 2
- **Deleted tests**: Remove from manifest during reconciliation

Materialize three sets:

1. `phase1SelectedTestKeys`
2. `phase2SelectedTestKeys`
3. `reportRebuildOnly`

### Failure Semantics

- **Interrupted run**: `progress.json` handles active-run resume; `incremental-manifest.json` retains `lastStartCommit` for cross-run selection; completed entries remain valid
- **Partial success**: Completed manifest entries stay updated; failed items remain candidates for next run
- **Missing git state**: Log warning, fall back to full-run selection, do not write bogus `lastStartCommit`

## Rationale

The manifest-based approach provides deterministic, auditable incremental behavior without the complexity of full agent instrumentation. By capturing `lastStartCommit` at run start rather than completion, we establish a practical baseline immediately — critical because the first full run is too expensive to wait for.

Using git for changed-file detection leverages existing tooling rather than building custom file-watching infrastructure. The narrow dependency scope (test file + mirrored implementation) captures the most important drift while keeping the implementation simple and predictable.

Separating `progress.json` (active-run resume) from `incremental-manifest.json` (cross-run selection) preserves clarity — each file has a single responsibility without conflicting semantics.

## Consequences

### Positive

- Repeated runs only process changed tests and affected phases
- Significant reduction in model call costs for incremental development
- Deterministic selection based on git state and fingerprints
- Interrupted runs still establish baseline for next execution
- Report-only regeneration decouples output format changes from model reruns

### Negative

- Narrow dependency tracking may miss some edge cases where agent reads additional files
- Git dependency means non-git workflows (rare) fall back to full runs
- Additional state file (`incremental-manifest.json`) to manage and version
- Slightly increased complexity in the main audit script for selection logic

### Risks

- **Stale results from undetected dependencies**: If the agent reads files beyond the test and mirrored source, incremental runs may miss changes. Mitigation: Document limitation; consider expanding dependency tracking in future iterations.
- **Manifest schema evolution**: Future changes require migration logic. Mitigation: Version field in schema; start with version 1.
- **Git state complications**: Shallow clones or detached HEAD may produce unexpected results. Mitigation: Graceful fallback to full-run selection.

## Implementation Notes

### Files created

- `scripts/behavior-audit/incremental.ts` — manifest schema, hashing, git integration, selection logic
- `tests/scripts/behavior-audit-incremental.test.ts` — manifest, invalidation, and selection tests
- `tests/scripts/behavior-audit-integration.test.ts` — incremental end-to-end behavior tests

### Files modified

- `scripts/behavior-audit/config.ts` — add `INCREMENTAL_MANIFEST_PATH` constant
- `scripts/behavior-audit.ts` — wire run-start baseline capture and incremental selection
- `scripts/behavior-audit/extract.ts` — accept selected test keys, persist manifest updates
- `scripts/behavior-audit/evaluate.ts` — accept selected test keys, persist manifest updates
- `scripts/behavior-audit/report-writer.ts` — support report regeneration from stored results

### Pipeline changes

```
scripts/behavior-audit.ts
  ├── discover test files
  ├── load incremental manifest (new)
  ├── capture current HEAD as lastStartCommit (new)
  ├── compute changed files since previous lastStartCommit (new)
  ├── choose affected Phase 1 / Phase 2 items (new)
  ├── load or initialize progress.json (existing)
  ├── run Phase 1 on selected tests/files (updated)
  ├── run Phase 2 on selected behaviors (updated)
  └── update manifest entries as items complete (new)
```

## Related Decisions

- **ADR-0054** (Mock Isolation Guardrails) — established test isolation patterns that this audit system verifies
- **ADR-0057** (Dependency Injection Test Refactor) — test structure that the audit pipeline processes

## References

- Design: `docs/superpowers/specs/2026-04-17-behavior-audit-incremental-design.md`
- Plan: `docs/superpowers/plans/2026-04-17-behavior-audit-incremental-implementation.md`
