# ADR-0107: Behavior Audit Progress UX Plan — Execution and Architectural Divergence

## Status

Accepted

## Date

2026-05-18

## Context

`docs/superpowers/plans/2026-04-25-behavior-audit-progress-ux.md` was an 11-task implementation plan defining how to add per-item token/TPS/tool stats and phase summary blocks to the behavior-audit `VERBOSE=0` output. The plan prescribed:

1. A new `scripts/behavior-audit/phase-stats.ts` module with `AgentUsage`, `AgentResult<T>`, `PhaseStats` types, accumulation functions, and formatting utilities.
2. Updating all four agent wrappers (`extract-agent.ts`, `keyword-resolver-agent.ts`, `classify-agent.ts`, `consolidate-agent.ts`, `evaluate-agent.ts`) to return `AgentResult<T>` instead of bare results.
3. Updating all phase runners (`extract.ts`, `classify.ts`, `consolidate.ts`, `evaluate.ts`) and the orchestrator (`scripts/behavior-audit.ts`) to unwrap results, accumulate usage into `PhaseStats`, and print enhanced per-item lines plus summary blocks.
4. A flat test layout (`tests/scripts/behavior-audit-*.test.ts`).

When the plan was checked for completion, the codebase had evolved substantially since its authorship. The plan's file paths and some of its intermediate design assumptions no longer matched the actual source tree.

## Decision Drivers

1. **Plan fidelity**: Determine whether the functional goal of the plan (per-item usage stats + phase summaries) was realized, regardless of file-path drift.
2. **Test inventory**: Verify that all tests referenced in the plan exist and pass.
3. **Architectural record**: Capture where the actual implementation diverged from the plan's prescriptive steps.

## Considered Options

### Option 1: Execute the plan literally (rejected)

Rewrite working code to match the plan's exact file paths, intermediate functions (`keyword-resolver-agent.ts`, `resolveKeywords`), and flat test layout.

- **Pros**: Perfect plan compliance.
- **Cons**: Destructive to a cleaner architecture that emerged after the plan was written; would introduce reverted abstractions and duplicate code.
- **Verdict**: Rejected.

### Option 2: Verify functional completeness, document divergence, and archive the plan (chosen)

Run the full test suite, confirm per-item stats and phase summaries are present, then record the architectural differences in an ADR and archive the plan.

- **Pros**: Preserves the working codebase; captures lessons learned; keeps historical plans discoverable without pretending they are active.
- **Cons**: Requires explicit ADR to explain the divergence.
- **Verdict**: Accepted.

## Decision

The functional goals of the 2026-04-25 plan are **fully implemented** in the current codebase. The plan itself is **archived** because its prescriptive file paths and intermediate design assumptions diverged from the evolved architecture. This ADR records exactly where and why.

## Rationale

The core requirement — per-item token, TPS, and tool-call metrics plus aggregate phase summaries at `VERBOSE=0` — was realized through a **reporter event pipeline** rather than direct unwrap-and-print logic in each phase runner. This event-based approach (already documented in ADR-0102) is superior:

- Solves concurrency attribution under `p-limit` without mutexes.
- Decouples phase logic from rendering concerns.
- Supports both deterministic text output and optional interactive renderers.

The plan's intent was preserved; its mechanism was superseded by a better one that emerged during the same development cycle.

## Divergence Details

### 1. Reporter-based output vs. direct `writeStdout`

| Plan Assumption                                                                                                                          | Actual Implementation                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each phase runner unwraps `AgentResult`, accumulates into `PhaseStats`, and calls `formatPerItemSuffix` + `formatPhaseSummary` directly. | Phase runners emit `item-start`/`item-finish`/`artifact-write` events via `BehaviorAuditProgressReporter`. A dedicated text renderer (`progress-reporter-state.ts`) formats lines deterministically. Per-item suffixed stats are still computed (via `formatPerItemSuffix`), but they are emitted as event metadata rather than concatenated to stdout inside the runner. |

**File**: `scripts/behavior-audit/progress-reporter.ts`, `scripts/behavior-audit/progress-reporter-state.ts`, `scripts/behavior-audit/extract-reporting.ts`, `scripts/behavior-audit/classify-reporting.ts`, `scripts/behavior-audit/consolidate-reporting.ts`, `scripts/behavior-audit/evaluate-progress.ts`

### 2. `keyword-resolver-agent.ts` eliminated

| Plan Assumption                                                                            | Actual Implementation                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 3: Update `scripts/behavior-audit/keyword-resolver-agent.ts` to return `AgentResult`. | **File does not exist.** Keyword resolution was inlined into extraction. Extracted keywords are normalized directly by `extract-phase1-single-test.ts` and stored in the vocabulary without a separate resolver agent. This eliminated an unnecessary network round-trip and simplified the pipeline. |

**Consequence**: Task 3 in the plan is moot. The corresponding `AgentResult` wrapping for keyword resolution is unnecessary.

### 3. `resolveKeywords` eliminated

| Plan Assumption                                                                                                       | Actual Implementation                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 4: `scripts/behavior-audit/extract-phase1-helpers.ts` — `resolveKeywords` returns `{ keywords, usage } \| null`. | **Function does not exist.** Keyword normalization is performed synchronously by `extract-phase1-single-test.ts` using `normalizeKeyword` from `keyword-vocabulary.ts`. No async resolution step exists. |

### 4. Test file reorganization

| Plan Assumption                                                                                                              | Actual Implementation                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flat layout: `tests/scripts/behavior-audit-phase-stats.test.ts`, `tests/scripts/behavior-audit-classify-agent.test.ts`, etc. | **Nested layout**: `tests/scripts/behavior-audit/phase-stats.test.ts`, `tests/scripts/behavior-audit/classify-agent.test.ts`, `tests/scripts/behavior-audit/phase1-keywords.test.ts`, `tests/scripts/behavior-audit/phase1-write-failure.test.ts`, `tests/scripts/behavior-audit/phase2a.test.ts`, `tests/scripts/behavior-audit/entrypoint.test.ts`, plus 17 additional files. |

**Consequence**: The plan's 6 test files were moved into a `behavior-audit/` subdirectory. 17 additional test files were added for new subsystems (progress reporter, incremental manifest, clustering profiles, embedding cache, etc.).

### 5. `emptyAgentUsage` kept private

| Plan Assumption                                                                                                   | Actual Implementation                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emptyAgentUsage` is exported as a public constant from `phase-stats.ts` (referenced in the plan's test snippet). | **Not exported.** A test explicitly asserts `module does not expose emptyAgentUsage as part of the public API`. Callers use `createPhaseStats()` to obtain a zeroed state. |

**File**: `tests/scripts/behavior-audit/phase-stats.test.ts`

### 6. Entrypoint renamed

| Plan Assumption                                    | Actual Implementation                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Modify `scripts/behavior-audit.ts` (orchestrator). | **File renamed** to `scripts/behavior-audit/index.ts` to match the module's directory convention. Logic is structurally equivalent. |

### 7. Architecture additions not contemplated by the plan

The following subsystems were introduced after the plan was written and rely on the same `AgentUsage`/`AgentResult<T>` / `PhaseStats` foundations:

- **Evidence system**: `extract-evidence.ts`, `extract-phase1-evidence.ts` — captures per-behavior evidence for trust scoring.
- **Trust/verification**: `extract-trust-types.ts`, `extract-verifier.ts` — validates extraction quality.
- **Phase 1b keyword consolidation**: `consolidate-keywords*.ts` — clustering-based deduplication using embeddings.
- **Phase runner split**: `extract-phase1-runner.ts`, `extract-phase1-single-test.ts`, `evaluate-runner.ts` — isolated runner logic from orchestration.

These additions do not conflict with the plan's goals but demonstrate the codebase evolved beyond the plan's scope.

## Verification Results

All verification commands were run on the codebase before this ADR was written:

| Command                                              | Result                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `bun test tests/scripts/behavior-audit/**/*.test.ts` | **219 pass, 0 fail** across 23 files                               |
| `bun test tests/scripts/behavior-audit-*.test.ts`    | **38 pass, 0 fail** across 4 files (legacy flat paths, still pass) |
| `bun test` (full suite, 392 files)                   | **4316 pass, 0 fail**                                              |
| `bun typecheck`                                      | **Clean** (tsgo --noEmit, 0 errors)                                |
| `bun lint` (oxlint)                                  | **0 warnings, 0 errors**                                           |
| `bun format:check` (oxfmt)                           | **All matched files correct**                                      |

## Files Added/Modified vs. Plan

### Files created per plan intent

| File                                                  | Purpose                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/behavior-audit/phase-stats.ts`               | Types, accumulation, formatting. **Exists.** Exports `AgentUsage`, `AgentResult<T>`, `PhaseStats`, `addAgentUsage`, `createPhaseStats`, `recordItemDone`, `recordItemFailed`, `recordItemSkipped`, `formatPerItemSuffix`, `formatPhaseSummary`. |
| `tests/scripts/behavior-audit/phase-stats.test.ts`    | Tests for types, accumulation, formatting. **Exists (moved to subdirectory).**                                                                                                                                                                  |
| `tests/scripts/behavior-audit/classify-agent.test.ts` | Tests for `AgentResult` wrapper in classify agent. **Exists (moved to subdirectory).**                                                                                                                                                          |

### Files modified per plan intent

| File                                          | Status                                                 |
| --------------------------------------------- | ------------------------------------------------------ |
| `scripts/behavior-audit/extract-agent.ts`     | ✅ Returns `AgentResult<ExtractionResult> \| null`     |
| `scripts/behavior-audit/classify-agent.ts`    | ✅ Returns `AgentResult<ClassificationResult> \| null` |
| `scripts/behavior-audit/consolidate-agent.ts` | ✅ Returns `AgentResult<...> \| null`                  |
| `scripts/behavior-audit/evaluate-agent.ts`    | ✅ Returns `AgentResult<EvalResult> \| null`           |
| `scripts/behavior-audit/extract.ts`           | ✅ Creates `PhaseStats`, records per-item usage        |
| `scripts/behavior-audit/classify.ts`          | ✅ Creates `PhaseStats`, records per-item usage        |
| `scripts/behavior-audit/consolidate.ts`       | ✅ Creates `PhaseStats`, records per-item usage        |
| `scripts/behavior-audit/evaluate.ts`          | ✅ Creates `PhaseStats`, records per-item usage        |
| `scripts/behavior-audit/index.ts`             | ✅ Orchestrates reporter injection across phases       |

### Files referenced by plan but eliminated

| File                                                                   | Status            | Rationale                                  |
| ---------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| `scripts/behavior-audit/keyword-resolver-agent.ts`                     | ❌ **Eliminated** | Keyword resolution inlined into extraction |
| `scripts/behavior-audit/extract-phase1-helpers.ts` — `resolveKeywords` | ❌ **Eliminated** | No async resolution step exists            |

## Consequences

### Positive

- The functional goal — per-item usage stats and phase summaries — is realized and tested.
- The codebase uses a cleaner event pipeline (ADR-0102) instead of ad hoc stdout formatting in each runner.
- 23 test files covering behavior-audit, with zero failures.
- Historical plan is archived with full traceability to its ADR.

### Negative

- Anyone discovering the 2026-04-25 plan must also read ADR-0107 to understand why file paths differ.
- `docs/superpowers/remaining/2026-04-25-behavior-audit-progress-ux.md` will become stale; it should also be archived or deleted.

### Risks

- **Stale plan reference in docs**: Future readers might find the archived plan and assume the code should match it literally.
  - Mitigation: Plan header links to this ADR; archive location is `docs/archive/`.

## Related Decisions

- **ADR-0102** — Behavior Audit Progress Reporting with Structured Events: the event-based pipeline that superseded the plan's direct formatting approach.
- **ADR-0077** — Behavior Audit Test-Driven UX Evaluation: established the behavior-audit phase runner pattern.
- **ADR-0073** — Behavior Audit Incremental Runs: established the checkpoint system that the progress reporter observes.
- **ADR-0097** — Pi Migration Partial Implementation: the project context under which this work was completed.
- **ADR-0103** — Behavior Audit Keyword Consolidation: the Phase 1b clustering subsystem that was added after the plan.

## References

- Archived plan: `docs/archive/2026-04-25-behavior-audit-progress-ux.md`
- Remaining tracker (to be archived): `docs/superpowers/remaining/2026-04-25-behavior-audit-progress-ux.md`
- Current source:
  - `scripts/behavior-audit/phase-stats.ts`
  - `scripts/behavior-audit/progress-reporter.ts`
  - `scripts/behavior-audit/progress-reporter-state.ts`
  - `tests/scripts/behavior-audit/phase-stats.test.ts`
  - `tests/scripts/behavior-audit/progress-reporter.test.ts`
