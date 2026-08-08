<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0365: Tool-Status-Labels Mutation Coverage — Test-Only Characterization via Exact-Equality Assertions and a Table-Driven Registry Pin

## Status

Accepted

## Date

2026-08-04

## Context

`src/live-status/tool-status-labels.ts` renders the live-status line the user sees while a tool runs (`formatToolStatus`, plus helpers `sanitizeArg`, `getStringField`, `hostOf`, `asRecord`, `humanizeToolName`, and a 32-entry `REGISTRY` of per-tool emoji/label/quote/arg extractors). Its ratcheted mutation floor in `scripts/mutation/baseline.json` was **0.46** — 54% of mutants survived. The surviving-mutant gap analysis (classes A–I in the design spec) showed the cause was not missing coverage of logic but **loose assertions**: tests used `startsWith`/`endsWith`/`toContain` partial matchers and pinned only a handful of REGISTRY entries, so constant, boundary, operator, and object-literal mutants slipped through. An intermediate run after the first test pass landed at only **0.586**, revealing that 68 of 77 survivors were REGISTRY object-literal mutants — pinning ~6 of 32 entries was not enough.

The design spec (`docs/superpowers/specs/2026-08-04-mutation-coverage-tool-status-labels-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-mutation-coverage-tool-status-labels.md`) define the fix; this ADR records the decisions. Verified result: score **0.4619 → 0.9714** (target ≥ 0.95 met) with 6 accepted equivalent residuals.

## Decision Drivers

- **Test-only; never touch `src/`.** The implementation under test was already correct — the defect was in assertion strength. All work lands in `tests/live-status/tool-status-labels.test.ts`; `git diff origin/master -- src/` must stay empty.
- **Exact equality is the only lever.** Every new assertion uses `toBe(...)` on the full rendered string. Partial matchers (`startsWith`, `endsWith`, `toContain`) re-open the exact leak being closed.
- **Boundary inputs kill constant/operator mutants.** The 40/41-char argument pair pins `MAX_ARG_LENGTH = 40` and `>` vs `>=`; port-preserving URLs pin `.host` vs `.hostname`; array/null/number inputs pin all three `asRecord` guards; multi-`__` names pin `lastIndexOf` vs `indexOf`.
- **Pin the whole table, not a sample.** Stryker mutates every REGISTRY cell (emoji/label `StringLiteral`, `quote` `Boolean`, `arg` `ArrowFunction`, key-removal `ObjectLiteral`), so only a table-driven test covering all 32 entries closes the class — verified empirically when the partial pin scored 0.586.
- **Hand-written expected values.** Table expectations are literals written by hand, never derived from the source REGISTRY — a derived table would be tautological and kill nothing.
- **Equivalent residuals are recorded, not suppressed.** Surviving mutants proven equivalent (identical observable output for every reachable input) are documented in the spec as accepted residuals; no Stryker-ignore comments (hook policy blocks them anyway).
- **Emoji are significant bytes.** `🗑️`/`✏️`/`⚙️` carry variation selectors and must be copied verbatim from the source, never re-typed.

## Considered Options

### Option 1 — Exact-equality characterization tests + table-driven REGISTRY pin (chosen)

Replace the one loose truncation test with three exact-equality tests (collapse/truncate, 40-char boundary, 41-char boundary); add precision tests for `getStringField` precedence/skip rules, `hostOf` port preservation, `asRecord` rejection guards, no-arg REGISTRY entries, and `humanizeToolName` edge cases; then add a single table-driven `describe` block asserting the exact rendered output of all 32 REGISTRY entries, plus three missed helper mutants (L31 `trim()`, L92 `^`-anchor, L93 `+`-quantifier). Verification gate is the mutation score via `bun test:mutate:file`, not a red→green transition.

- **Pros:** kills every surviving mutant class without touching production code; characterization tests pass immediately against correct code, so each commit is independently green; the table-driven form scales linearly with registry growth and doubles as executable documentation of every status line users see; boundary pairs (40/41, port/no-port, array/null/number) kill entire operator-mutant families with two-line tests.
- **Cons:** exact-equality tests are brittle to intentional label/emoji copy edits — any wording change requires updating the table row; the final suite grew the file substantially (66+ cases) for a ~100-line source module; discovering the REGISTRY-mutant under-pinning required one full extra mutation run (0.586) before the table-driven amendment.

### Option 2 — Weaken the assertion rule where literals are awkward (rejected)

Allow `toContain`/regex matchers for long or volatile strings (e.g. the truncated-argument case) and only exact-match short labels.

- **Pros:** smaller, more readable tests; less churn on copy edits.
- **Cons:** partial matchers are precisely what produced the 0.46 floor — a `startsWith` assertion cannot kill ellipsis-char, slice-endpoint, or trim mutants; any exception re-opens the leak the plan exists to close.

### Option 3 — Refactor production code for testability or suppress residual mutants (rejected)

Change `src/live-status/tool-status-labels.ts` (e.g. export helpers for direct unit tests, restructure the registry) or add Stryker-ignore comments for equivalent mutants.

- **Pros:** direct helper tests would be simpler; suppressed mutants would show a clean 1.0.
- **Cons:** the module is correct — production churn purely for tests violates the test-only constraint and risks behavioral regression; Stryker-ignore comments are blocked by hook policy and would hide genuinely equivalent mutants instead of documenting them; helper internals are adequately reachable through the public `formatToolStatus` contract.

## Decision

Adopt Option 1. All changes are confined to `tests/live-status/tool-status-labels.test.ts`: boundary/exact-equality tests for `sanitizeArg` truncation (40/41), `getStringField` first-key-wins and skip rules, `hostOf` port preservation, `asRecord` non-record rejection, no-arg tool rendering, `humanizeToolName` hyphen/case/multi-`__`/prefix-strip behavior, plus a table-driven block pinning all 32 REGISTRY entries' exact rendered output. The acceptance gate is mutation score ≥ 0.95 measured by `bun test:mutate:file`; the four confirmed-equivalent surviving mutants (L21 `Array.isArray` guard, L39 `hostOf` early return, L93 `.trim()`, L103 omission-check guards) are recorded as accepted residuals. `scripts/mutation/baseline.json` is not hand-edited on the PR — CI's master `mutation-baseline` job re-seeds the floor via `seedMerge` after merge.

## Consequences

### Positive

- Mutation score raised from **0.4619 to 0.9714**, clearing the ≥ 0.95 target; the PR ratchet now blocks regression on every REGISTRY cell, boundary constant, and operator in the file.
- Every user-visible live-status string is pinned byte-for-byte — the test table is executable documentation of the status-line vocabulary, including emoji variation selectors.
- The 0.586 intermediate result validated the empirical loop: measure, read the Stryker report by survivor class, target the dominant class (REGISTRY object literals), re-measure — rather than guessing which tests to add.
- No production diff: zero risk of behavioral change shipped with the test strengthening.

### Negative

- Copy edits to any label/emoji now require a matching test-table edit — intentional wording changes have a two-file touch cost.
- The test file is large relative to the module it covers; future registry additions must extend the table (one row) or the floor will catch the new mutants as no-coverage/survived.
- The accepted-residual knowledge lives in the spec text, not adjacent to the code — a future reader of the Stryker report must cross-reference the spec to know the 6 survivors are intentional.

### Risks

- A contributor adding a REGISTRY entry without a table row ships an unpinned entry. Mitigation: the ratcheted 0.9714 floor fails the PR until the row is added.
- Emoji re-typed instead of copied could silently drop variation selectors. Mitigation: exact-equality assertions fail on the byte difference; the plan documents the copy-verbatim rule.

## Implementation Notes

- Commits (test-only, one per task): truncation boundary (`c99e735f3`), `getStringField` precedence (`fd84dc8d7`), `hostOf`/`asRecord` (`f8a80f0b9`), no-arg/registry samples (`981ef1da3`), `humanizeToolName` edges (`665c486d7`), full REGISTRY table + missed helpers (`43612ed80`), plus a follow-up pinning `search_tasks` text-key and `create_project` title-key fallbacks (`c469f79c8`).
- Final suite: `describe('formatToolStatus')` precision tests + `describe('REGISTRY entries render their exact emoji, label, and arg form')` (34 table rows) + pre-existing reminder/alert block; all assertions `toBe` on full strings.
- Task ordering quirk: the plan's Task 7 (table-driven amendment) was added after Task 6's first verification run landed at 0.586 — the amendment, not the original Tasks 1–5, is what carried the score over the gate.
- Verified per spec status line: score 0.4619 → 0.9714; 6 accepted equivalent residuals; `git diff origin/master -- src/` empty.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change ratchets under; baseline.json left untouched on the PR per that contract.
- ADR-0354: History Mutation Coverage — the sibling test-only mutant-killing ADR establishing the exact-equality-over-partial-matcher philosophy.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — same accepted-residual discipline applied to plugin files.

## References

- Spec: `docs/superpowers/specs/2026-08-04-mutation-coverage-tool-status-labels-design.md` (Status: Verified — score 0.4619 → 0.9714)
- Plan: `docs/superpowers/plans/2026-08-04-mutation-coverage-tool-status-labels.md`
- Tests: `tests/live-status/tool-status-labels.test.ts`; source under test: `src/live-status/tool-status-labels.ts`
