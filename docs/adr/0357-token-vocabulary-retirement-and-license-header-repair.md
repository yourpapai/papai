<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0357: Retire Legacy Design-Token Vocabulary and Repair License-Header Stamping

## Status

Accepted

## Date

2026-08-02

## Context

`client/shared/tokens.css:78-86` carried a block of eight legacy design-token aliases (`--fg`, `--fg2`, `--fg3`, `--fg4`, `--fg-hint`, `--surface`, `--raised`, `--hair`), each a pure `var()` alias to exactly one semantic token (`--text`, `--text-muted`, `--text-dim`, `--surface-1`, `--surface-2`, `--border`). The codebase therefore maintained two complete vocabularies for the same colors, with 314 call sites across 75 files using the legacy names. The alias layer also concealed two undefined custom properties that nothing in the toolchain rejected: `var(--fg1)` in `client/settings/sections/ReposSection.svelte:264` and `var(--surface2)` in `client/admin/components/SubjectsTable.svelte:145` and `SubjectDetail.svelte:172,181,240` — declarations that resolved to nothing and silently dropped the styling.

In parallel, `scripts/add-license-headers.ts` required the SPDX line at exactly line 1 (or line 2 past a shebang). Files opening with a leading path comment (e.g. `// src/byok-llm/blob-codec.ts` at line 1, SPDX at line 2) were misread as "no header", so the script prepended a second complete four-line header — a one-shot, permanent corruption invisible to re-running the script (the file then starts with SPDX and is "skipped"). This mattered operationally because `bun run shoot:gen` invokes `bun run license:headers >/dev/null` with output suppressed, so the bug would fire silently inside the token work. The design is in `docs/superpowers/specs/2026-08-02-token-vocabulary-and-license-headers-design.md`; the implementation plan is `docs/superpowers/plans/2026-08-02-token-vocabulary-and-license-headers.md` (which supersedes the spec on task ordering and the `--surface2` count).

## Decision Drivers

- **Close the class, not the instances.** Fixing the two undefined tokens without a guard leaves the door open for the next plausible-by-analogy name; a scanner test that asserts every `var(--x)` in `client/` resolves to a `--x:` declaration in `client/` makes the whole failure class impossible.
- **One vocabulary.** Every legacy alias is a pure alias with one target, so deleting them is provably inert once references are gone — and keeping them preserves the ambiguity that produced `--fg1`/`--surface2`.
- **Literal string replacement, not regex.** The search term includes the closing paren (`var(--fg)`), so it cannot match `var(--fg2)` or `var(--fg-hint)`; a word-boundary regex on `--surface` would match 14 lines already correctly using `--surface-1`/`--surface-2`/`--surface-hover`, corrupting the very tokens the migration moves toward.
- **The visual audit is the test.** The 314 substitutions resolve to byte-identical CSS, so the proof of safety is a pixel-level "exactly zero visual diff" audit against Storybook baselines — a genuine red/green oracle, not a smoke test. Re-baselining after an unverified change is the one unrecoverable error.
- **Repair the header script first.** Task order is load-bearing: `shoot:gen` runs `license:headers` silently, so the duplication bug had to land before the task that regenerates visual specs.
- **Bound the header scan to the leading comment run.** Walking only the leading run of `//` comments and blank lines keeps the search safe: a file may legitimately contain the SPDX text further down (generated templates), and matching that would mangle it.

## Considered Options

### Option 1 — Sequential: fix header script, add guard test + fix undefined tokens, migrate call sites by literal replacement, delete aliases (chosen)

Four tasks in a strict order: (1) bound the license-header scan so `updateExistingHeader` searches the leading comment run via `findHeaderIndex`; (2) add `tests/client/shared/token-references.test.ts` as a guard and fix `--fg1` → `--text` and `--surface2` → `--surface-2`; (3) mechanically rewrite all 314 call sites with a throwaway literal-replacement script; (4) delete the alias block, invert the tokens test, and remove `KV.svelte`'s now-inert `dim` prop (both branches resolved to `var(--text-dim)` after ADR-0356's retune).

- **Pros:** the guard test is red before Task 2 and green after, proving the scan works; the migration is order-independent and prefix-safe; alias deletion is provably inert because zero references remain; the pixel audit partitions expected change (Task 2's three components) from forbidden change (Tasks 3–4); `shoot:gen` is safe to run because Task 1 landed first.
- **Cons:** four commits where one might do; the 75-file diff in Task 3 is reviewable only by checking the substitution rule and the audit result, not by reading every line; the `--fg1` → `--text` fix is an inference about original intent (flagged to the reviewer) since nothing records what the author meant.

### Option 2 — Keep the aliases permanently

Leave the alias block as a compatibility layer for debug/admin SPAs.

- **Pros:** no 75-file migration diff.
- **Cons:** two vocabularies persist indefinitely; the ambiguity that produced `--fg1`/`--surface2` remains; the block's own comment ("debug/admin SPAs reference these names") was already stale. Rejected.

### Option 3 — Regex-based migration with word boundaries

Rewrite call sites with a single regex pass instead of literal paren-inclusive replacement.

- **Pros:** shorter script.
- **Cons:** `--fg` is a prefix of `--fg1`–`--fg-hint` and `--surface` is a prefix of `--surface-1`/`--surface-2`/`--surface-hover`; word-boundary matching corrupts already-correct semantic usages. Rejected — the prefix hazard was measured, not hypothetical.

## Decision

Option 1 shipped, verified present in the tree:

1. `scripts/add-license-headers.ts:154` adds `findHeaderIndex`, and `updateExistingHeader` (line 180) uses it with a `preamble` slice that carries shebang, path comment, both, or nothing; regression tests live in `tests/scripts/license-setup.test.ts:120,152` (`LICENSE_HEADER_YEAR` pinned so the suite does not rot in January).
2. `tests/client/shared/token-references.test.ts` scans all of `client/` for declarations and references and asserts every reference resolves, with a non-vacuity test (declaration floor + reference-count floor) so a silently empty glob cannot pass green.
3. All 314 legacy-alias references across 75 files migrated to the semantic vocabulary; zero `var(--fg|--fg2|--fg3|--fg4|--fg-hint|--surface|--raised|--hair)` references remain in `client/`.
4. The alias block is deleted from `client/shared/tokens.css`; `tests/client/shared/tokens.test.ts:49` now asserts the aliases are absent (trailing colons on `--surface:`/`--fg:` prevent matching `--surface-1:`/`--fg-hint:`), and the mis-grouped `--s4` moved to the layout-token test; `KV.svelte`'s `dim` prop and its `Dim` story are removed and the visual spec regenerated.

## Consequences

### Positive

- `client/` has a single token vocabulary; the guard test makes undefined token references fail at unit-test speed in the standard client lane, closing the `--fg1`/`--surface2` failure class.
- The two broken declarations now resolve: the repository name in `ReposSection` renders in the brightest foreground, and the badges/pills/code blocks in the two admin components gained their intended `--surface-2` background — verified as real pixel diffs before re-baselining only those three components.
- `bun run license:headers` is idempotent on a clean tree (`0 stamped`); `bun run shoot:gen` no longer silently stamps unrelated files.
- The audit-first discipline (re-baseline only where a step says so) keeps the screenshot suite meaningful: 449 passed / 5 known clock-story flakes as the floor, dropping to 448/5 by design when the `Dim` story was deleted.

### Negative

- The `--fg1` → `--text` fix encodes an inference about intent; if the original author meant something else, the pixel diff is permanent (mitigated by reviewer flag and the fact that `--fg` aliases `--text`, making it the only sensible reading).
- The guard test's CSS scanning is lexical (declaration/reference regexes over `.css`/`.svelte`/`.ts`); unusual formatting that defeats the patterns would need test updates, and the declaration/reference floors in the non-vacuity test must be lowered deliberately if the token count shrinks.
- Anyone maintaining a branch that still uses legacy alias names will face a mechanical rename conflict on rebase.

## References

- Plan: `docs/superpowers/plans/2026-08-02-token-vocabulary-and-license-headers.md`
- Design spec: `docs/superpowers/specs/2026-08-02-token-vocabulary-and-license-headers-design.md`
- Guard test: `tests/client/shared/token-references.test.ts`
- Header fix: `scripts/add-license-headers.ts:154`, `tests/scripts/license-setup.test.ts:120`
- Tokens: `client/shared/tokens.css`
- Related: ADR-0356 (dim-text contrast retune — the follow-up that made `KV.svelte`'s `dim` prop inert, removed here), ADR-0344 (control-height token scale with test-enforced WCAG floor)
