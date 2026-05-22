<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0108: Behavior Audit JSON Extraction Cleanup

## Status

Implemented (with divergences)

## Context

Commit `ba32218a` (2026-04-25) introduced several structural changes to the behavior-audit pipeline as part of a broader `wrapWithJsonExtraction`/`parseJsonText` tooling migration experiment. While the experiment was abandoned before reaching `master`, the commit temporarily introduced:

1. A misplaced root-level re-export shim at `scripts/behavior-audit-classify-agent.ts`.
2. A `repro-test-tools.ts` script with typecheck errors that later blocked `bun check:verbose`.
3. A relocated test file `tests/scripts/behavior-audit-classify-agent.test.ts` with an import pointing to the shim rather than the canonical module.

The plan `docs/superpowers/plans/2026-04-24-behavior-audit-json-extraction-cleanup.md` was drafted to surgically revert these regressions while preserving the structural improvements made elsewhere.

## Decision

Adopt the cleanup plan as written for Tasks 1, 3, and 4. Record Task 2 as superseded by a later architectural refactoring that removed the target field entirely.

## Decision Drivers

- **Must remove dead/misplaced code** — the root shim and repro script had no production purpose.
- **Must restore canonical import paths** — tests should import from the canonical module, not a shim.
- **Must preserve step-limit guards** — consolidate and evaluate agents need `MAX_STEPS`/`stepCountIs` bounded execution.
- **Must not artificially constrain keywords** — the `candidateKeywords` field was renamed to `keywords` in a subsequent refactoring; imposing an old minimum on a non-existent field would be meaningless.

## Considered Options

### Option A: Revert the entire `ba32218a` commit (rejected)

- **Pros**: Single atomic operation, guaranteed to undo all regressions.
- **Cons**: Would also revert legitimate changes: `knip.jsonc` updates, `package.json` dependency bumps, and the creation of the cleanup plan document itself. Too broad.

### Option B: Surgical per-task cleanup (adopted)

Apply four independent commits, each addressing one regression, with no cross-task dependencies. This matches the plan's architecture.

- **Pros**: Isolated changes, easy to review and revert individually.
- **Cons**: More commits; requires careful tracking.

### Option C: Ignore Task 2 and leave `min(1)` (rejected for Task 2 specifically)

The plan assumed restoring a `min(8)` bound on `candidateKeywords`. However, the field no longer exists (renamed to `keywords` in `f192eabc`). Restoring the old bound is architecturally irrelevant.

## Implementation

### Task 1: Delete root re-export shim

- **Deleted**: `scripts/behavior-audit-classify-agent.ts`
- **Fixed import**: `tests/scripts/behavior-audit/classify-agent.test.ts` line 13 now imports from `../../../scripts/behavior-audit/classify-agent.js`
- **Commits**: `81ab0e21` (delete shim + source files), `3c7f2cf2` (move test into `behavior-audit/` subdir)

### Task 2: Candidate keyword constraint — superseded

The plan asked to restore `candidateKeywords: z.array(z.string()).min(8).max(16)`. This field was renamed to `keywords` with constraint `min(1).max(20)` in commit `f192eabc` ("refactor(behavior-audit): remove resolver agent, simplify keyword extraction to single phase") when the two-phase keyword pipeline (extract + resolve-against-vocabulary) was collapsed into a single phase.

**Rationale for superseding**: `candidateKeywords` no longer exists in the codebase. The current `keywords: min(1).max(20)` reflects the post-refactoring data model. Re-imposing an `8` minimum on a phantom field would be a no-op.

### Task 3: Restore step-limit guard in `consolidate-agent.ts`

| Item                                              | Status                |
| ------------------------------------------------- | --------------------- |
| `stepCountIs` imported from `'ai'`                | ✅ Present (line 7)   |
| `MAX_STEPS` imported from `'./config.js'`         | ✅ Present (line 11)  |
| `maxOutputTokens: 16384` in `verboseGenerateText` | ✅ Present (line 111) |
| `stopWhen: stepCountIs(MAX_STEPS + 1)`            | ✅ Present (line 118) |

### Task 4: Restore step-limit guard in `evaluate-agent.ts`

| Item                                              | Status               |
| ------------------------------------------------- | -------------------- |
| `stepCountIs` imported from `'ai'`                | ✅ Present (line 7)  |
| `MAX_STEPS` imported from `'./config.js'`         | ✅ Present (line 11) |
| `maxOutputTokens: 16384` in `verboseGenerateText` | ✅ Present (line 82) |
| `stopWhen: stepCountIs(MAX_STEPS + 1)`            | ✅ Present (line 88) |

## Consequences

### Positive

- Root-level `scripts/behavior-audit-classify-agent.ts` shim is gone; no ambiguous re-exports.
- Test imports point to canonical modules.
- Consolidate and evaluate agents have bounded execution via `stepCountIs(MAX_STEPS + 1)`.
- `repro-test-tools.ts` (source of later typecheck/knip failures) was removed in `4379e90b`.

### Negative

- No negative consequences.

### Risks

- **Risk**: The `keywords: min(1)` constraint is very permissive compared to the old `candidateKeywords: min(8)`. This is intentional per the single-phase simplification but may allow low-quality extractions.
- **Mitigation**: If keyword quality degrades, tighten the prompt or schema independently.

## Divergences from the Original Plan

| Plan Item | Expected                           | Actual                       | Reason                                                                                                         |
| --------- | ---------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Task 2    | `min(8)` on `candidateKeywords`    | Superseded                   | Field renamed to `keywords` in `f192eabc` (pipeline simplification)                                            |
| Migration | `wrapWithJsonExtraction` on master | Still uses `Output.object()` | Experiment abandoned; agents continue using `Output.object({ schema })` with `supportsStructuredOutputs: true` |

## Verification

- `test ! -f scripts/behavior-audit-classify-agent.ts` → **DELETED**
- `rg "behavior-audit-classify-agent" tests/ scripts/` → **0 matches**
- `bun test tests/scripts/behavior-audit/classify-agent.test.ts tests/scripts/behavior-audit-phase1b.test.ts tests/scripts/behavior-audit-phase2b.test.ts tests/scripts/behavior-audit-phase3.test.ts` → **32 pass, 0 fail**
- `bun typecheck` → **exit 0**
- `bun lint` → **0 warnings, 0 errors**
- `bun format:check` → **All matched files correct**

## References

- Implementation plan: `docs/superpowers/archive/2026-04-24-behavior-audit-json-extraction-cleanup.md`
- Related ADRs:
  - [ADR-0103](0103-behavior-audit-keyword-consolidation.md) — Keyword consolidation pipeline (superseded the two-phase extraction model)
  - [ADR-0107](0107-behavior-audit-progress-ux-plan-execution.md) — Progress UX plan execution
- Key commits:
  - `ba32218a` — Original commit introducing the regressions
  - `f192eabc` — Removed resolver agent, renamed `candidateKeywords` → `keywords`
  - `81ab0e21` — Deleted top-level barrel/shim files
  - `3c7f2cf2` — Moved classify-agent test into `behavior-audit/` subdir
  - `4379e90b` — Removed `repro-test-tools.ts`
