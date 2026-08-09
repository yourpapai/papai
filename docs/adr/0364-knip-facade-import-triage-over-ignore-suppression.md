<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0364: Replace knip Facade ignoreIssues with Codemod-Driven Import-Structure Triage

## Status

Accepted

## Date

2026-08-08

## Context

The upgrade to knip 6.28 (commit `2c8e04b9b`) surfaced ~180 unused-export/type findings across 40 re-export facade modules (`src/attachments/index.ts`, `src/mcp/index.ts`, `client/debug/dashboard-types.ts`, etc.). Facades exist deliberately in this codebase: modules expose a curated public surface via a barrel-style re-export file, and consumers are expected to import through it. Knip, however, cannot always trace whether a re-exported binding is "used" — it flags bindings whose only consumers import them from the concrete source module rather than the facade, bindings consumed only by tests, and genuinely dead bindings alike.

Rather than fix the import structure, the dependency-bump commit suppressed the findings by adding 39 facade entries to `ignoreIssues` in `knip.config.ts`. This created a standing rule violation (knip's own guidance treats `ignoreIssues` as a last resort), masked real structural drift (dead re-exports accumulating in facades, production code bypassing facades to import concrete internals, tests pinning a facade surface that production never uses), and made the config a growing list of unexplained exceptions.

The design spec (`docs/superpowers/specs/2026-08-04-knip-facade-import-triage-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-knip-facade-import-triage.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Code structure must satisfy knip, not config.** The refactor's success criterion is `bun run knip` exiting 0 with the 34 resolvable ignore entries deleted — proof that the import graph itself is clean, so the findings cannot silently regress behind an ignore.
- **Behavior-preserving refactor.** No production-logic changes and no new tests; the existing 11k-test serial suite is the safety net. Frozen files (0Q qualification freeze: `tests/stories/**`, `tests/utils/test-helpers.ts`, etc.) must never be edited — bindings they consume via a facade keep their facade export and their ignore entry.
- **Ground truth comes from knip, not from grep.** A self-derived flagged set misclassifies bindings knip never flagged (locally-referenced type re-exports, used-in-file semantics). The triage dataset must be produced by running knip itself with the pre-ignore config recovered from git history.
- **Facade direction is one-way.** Production imports flow toward facades (consolidating the public surface); test imports flow toward concrete modules (tests may pin internals); dead bindings are pruned. A facade never gains an ignore to hide a fixable structural problem.
- **Cycles are a stop condition, not a surprise.** Repointing a runtime (non-type) import to a facade can create an import cycle; these must be detected up front and fall back to pruning the binding instead.
- **Disposable tooling, deterministic commits.** The codemod is never committed; the landed result is four reviewable commits (C pruning → B test repointing → A production repointing → config cleanup), each gated on typecheck + lint + knip + tests.

## Considered Options

### Option 1 — Knip-report-driven disposable codemod with A/B/C triage (chosen)

A single uncommitted Bun codemod (`scripts/knip-facade-triage/`) runs knip with the pre-ignore config swapped in from git history, parses the Unused exports/types report to obtain the authoritative flagged set, scans the tree for consumers (named / namespace / dynamic imports), and classifies each of the 162 in-scope bindings:

- **Class A (70):** production consumers import the symbol from the concrete module → repoint those imports to the facade (with a runtime-graph reachability check; a would-be cycle converts the binding to Class B treatment).
- **Class B (46):** only tests consume the symbol via the facade → repoint test imports to the concrete module, prune the facade binding.
- **Class C (46):** zero consumers → prune the dead binding.

Four frozen-kept bindings (`SessionRecord`, `pollAlertsOnce`, `recentLlm`, `pendingTraces`) and two whole-facade exclusions (`src/providers/public-types.ts` published surface, `src/coding-sessions/session-record.ts` compat boundary) retain justified ignore entries. Contract tests pinning the facade surface get three targeted trims. A cascade rule handles upstream re-export layers orphaned by pruning, applied in the same commit — never by adding an ignore.

- **Pros:** classification is grounded in knip's own report (no reproducibility gap); mechanical per-symbol edits are deterministic and diff-reviewable; the four-commit strategy isolates each class behind its own verification gate; tooling leaves no committed residue; the config end state (5–6 documented entries) is self-justifying.
- **Cons:** the codemod is a ~700-line one-off that must stay typecheck-clean while present (split into modules under `scripts/knip-facade-triage/` to satisfy max-lines); a live knip run inside the codemod makes Task 1 sensitive to branch drift (mitigated by hard invariants: 166 flagged bindings in scope, exactly 4 frozen-kept, A+B+C = 162 — any mismatch halts execution).

### Option 2 — Hand-triage per facade (rejected)

Classify and edit each facade's bindings manually in dependency order, as the spec's original execution model described.

- **Pros:** no tooling to write; each facade is reviewed in isolation.
- **Cons:** ~162 bindings across 40 facades is error-prone by hand; manual classification reintroduces the grep-vs-knip ground-truth gap (the preliminary hand-derived table had known errors — e.g. `ChatProviderConfigField` classified B with zero consumers); per-facade gating multiplies verification runs (~40 gates instead of 4) without adding safety, since the codemod's per-symbol edits plus diff review preserve the same isolation inside a per-class batch.

### Option 3 — Keep the ignore entries and document them (rejected)

Accept the 39 `ignoreIssues` entries as permanent, adding comments explaining each.

- **Pros:** zero refactor risk; no churn.
- **Cons:** leaves dead re-export bindings in facades forever, lets production code keep bypassing facades (eroding the public-surface convention), and lets tests keep pinning a facade surface production doesn't use — the config becomes a permission slip for structural drift, and every future knip upgrade re-litigates the list.

## Decision

Adopt Option 1. Build the disposable knip-report-driven codemod, derive the authoritative A=70/B=46/C=46 triage from a live knip run against the pre-ignore config, apply the edits in four gated commits (C pruning, B test repointing, A production repointing, knip.config cleanup), delete the codemod, and land a final config with only the justified entries: the two declared compatibility boundaries, the three frozen-file-consumed bindings, the published `papai/plugin-types` surface, and the BYOK drift-guard types in `client/shared/api-types.ts` (a 6th entry added during execution when the `AdminLlmSnapshot` cascade surfaced).

## Consequences

### Positive

- `knip.config.ts` dropped 34 facade ignore entries (32 removed, 2 reverted to pre-bump scope); `bun run knip` passes on code structure alone, so the standing rule ("when knip flags a facade binding, fix the import structure, never add an ignore") is now enforced by a clean report rather than discipline.
- 46 dead facade re-export bindings were pruned, shrinking every facade's surface to what is actually consumed; orphaned upstream re-export layers (e.g. `client/shared/api-types.ts` types consumed only by `client/debug/dashboard-types.ts`) were cascade-pruned in the same commits.
- Production imports now flow through module facades (70 bindings repointed), consolidating the public-surface convention; test-only imports flow to concrete modules (46 bindings), so facades no longer carry surface area that exists only for tests.
- The four-commit history (`8af63c882`, `d5ce3efde`, `34318a4e4`, `7d4d76d3a`) isolates each triage class behind its own typecheck/lint/knip/test gate, making the refactor bisectable.
- The retained ignore entries are each documented with a specific justification (compat boundary, frozen file, published package export, drift-guard types) instead of an unexplained suppression.

### Negative

- ~120 test files and ~127 production import sites were touched in one branch — a large diff whose reviewability depends entirely on the mechanical, import-only nature of the edits and the per-commit gates.
- The codemod's knip-from-git-history mechanism couples Task 1 to a specific commit (`2c8e04b9b^`); a rebase requires rediscovering the pre-ignore config commit (documented in the plan).
- Contract tests pinning pruned facade bindings were trimmed (three edits), slightly narrowing the facade-surface contract the tests enforce — accepted because production never consumed those bindings through the facade.

### Risks

- A future facade binding that knip flags again must be triaged by hand using the same class rules; the codemod is gone. Mitigation: the standing rule in `knip.config.ts` (lines 11+) records the policy, and the classification rules are preserved in the spec.
- Import cycles introduced by future facade edits are no longer guarded by the codemod's reachability check. Mitigation: knip plus the serial test suite catch cycle fallout; the class-A cycle-fallback rule is documented in the spec.

## Implementation Notes

- The codemod was split into focused modules under `scripts/knip-facade-triage/` (main + types/scope/parse/analyze/edit/cycle/apply) to satisfy `max-lines: 300` / `max-lines-per-function: 50`, verified by identical `analyze` output, and deleted in Task 5 per plan.
- Hard invariants gated execution: 166 knip-flagged bindings in scope, exactly 4 frozen-kept, A+B+C = 162; any mismatch was a stop condition.
- The 6th kept entry (`client/shared/api-types.ts: ['types']`) was added during execution when the Task 5 cascade surfaced the BYOK `AdminLlmSnapshot`/`AdminLlmKeyState` drift-guard types; the dead `makeAdminLlmSnapshot` fixture factory was deleted in the same commit.

## Implementation Status

Implemented. All four commits landed on `dependabot/bun/bun-dependencies-aec7b819e5` and are ancestors of the current tree: `8af63c882` (C pruning), `d5ce3efde` (B test repointing), `34318a4e4` (A production repointing), `7d4d76d3a` (config cleanup). The codemod directory is deleted; `knip.config.ts` holds exactly the six documented entries (knip.config.ts:248-263); the standing rule for facade re-exports is recorded in the config header and in commit `73b7f928f`.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — sibling "structure over suppression" enforcement gate in the same tooling-hygiene program.

## References

- Spec: `docs/superpowers/specs/2026-08-04-knip-facade-import-triage-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-knip-facade-import-triage.md`
- Config end state: `knip.config.ts` (ignoreIssues block, lines 248-263)
- Trigger commit: `2c8e04b9b` (knip 6.28 upgrade that added the suppressions)
