# Tasks — Widen the mutation gate to the coding-agent workspace

Test-first within each item (red before green); none of the touched product files are
themselves hook-gated (`.hooks/` and `scripts/` are not gateable roots). Tasks 1.x–4.x are
the fingerprint-bearing toolchain/scope edits and land together with 5.x's seeded
`scripts/mutation/baseline.json` in one commit (D8), so the widened scope never exists on
master without its floors.

## 1. Mutate globs (D1)

- [x] 1.1 Pin the three new `stryker.config.json` lines red-first in `tests/scripts/mutation/stryker-config.test.ts`: `opencode-agent/src/**/*.ts`, `!opencode-agent/src/**/index.ts`, `!opencode-agent/src/**/constants.ts`. Verify: `bun test tests/scripts/mutation/stryker-config.test.ts` red
- [x] 1.2 Add the three lines to `stryker.config.json`'s `mutate` array, same per-tree exclusion shape as the other gated trees. Verify: `bun test tests/scripts/mutation/stryker-config.test.ts` green

## 2. Gateable predicate + flat mappers (D2/D3)

- [x] 2.1 Red predicate tests in `.hooks/tests/tdd/test-resolver.test.ts`: `isGateableImplFile` accepts `opencode-agent/src/**` product files and rejects workspace `index.ts`, workspace non-source paths (docs/workflow config), and `tests/opencode-agent/**`. Verify: `bun run test:hooks` red on these cases
- [x] 2.2 Red mapper tests in `.hooks/tests/tdd/test-resolver.test.ts`: `suggestTestPath('opencode-agent/src/phases/implement-steps.ts')` → `tests/opencode-agent/implement-steps.test.ts`; `findTestFile` flat-then-colocated order; `resolveImplPath` existence-checked subtree search (`implement-steps.test.ts` resolves `opencode-agent/src/phases/implement-steps.ts`; `phases.test.ts` resolves no counterpart); the workspace added to the pinned never-narrow-the-mappers block. Verify: red
- [x] 2.3 Red test in `tests/scripts/mutation/coverage-map.test.ts`: `samePackageTestDir` → `tests/opencode-agent` for every workspace source, branch placed ahead of the `src/` fallback, via `_samePackageTestDirForTest`. Verify: red
- [x] 2.4 Implement BOTH `.hooks/tdd/test-resolver.mjs` halves in one item — the `opencode-agent/src/` sixth root in `isGateableImplFile` AND the flat-mapping branches for `suggestTestPath`/`findTestFile`/`resolveImplPath` (2.4+2.5 merged: one test file carries both red families, so both must land green together). Verify: `bun run test:hooks` green on the 2.1 and 2.2 cases
- [x] 2.5 (folded into 2.4 — the shared test file makes the halves one green-per-item unit)
- [x] 2.6 Write the red test in `tests/scripts/mutation/coverage-map.test.ts` (`samePackageTestDir` → `tests/opencode-agent` for every workspace source, branch ahead of the `src/` fallback, via `_samePackageTestDirForTest`) AND implement the `tests/opencode-agent` branch in `scripts/mutation/coverage-map.ts`'s `samePackageTestDir` (2.3+2.6 merged — red observed, then green in one item). Verify: `bun test tests/scripts/mutation/coverage-map.test.ts` green
- [x] 2.7 Add the direct `git-commit.js` import to `tests/opencode-agent/git-commit.test.ts` (the one measured `verify-test-import` block, D3). Verify: no-op re-save of that test file passes the `verify-test-import` hook check, and `bun test tests/opencode-agent/git-commit.test.ts` green

## 3. Paired-run `--update-baseline` seed path (D4)

- [x] 3.1 (folded into 3.3 — test+impl one item)
- [x] 3.2 (folded into 3.4 — test+impl one item)
- [x] 3.3 Write the red tests in `tests/scripts/mutation/paired-run-cli.test.ts` (`--update-baseline` parses alongside `--threshold=`) AND parse the flag in `scripts/mutation/paired-run-cli.ts` beside `--threshold=` (3.1+3.3 merged — red observed, then green). Verify: `bun test tests/scripts/mutation/paired-run-cli.test.ts` green
- [x] 3.4 Write the red tests in `tests/scripts/mutation/paired-run.test.ts` (an `--update-baseline` run routes through `runUpdateBaseline` in `paired-run.ts`'s `main`, not `resolvePairedRunExitCode`; reuse disabled; exit-0 seed semantics; empty-selection exit-2 usage guard preserved) AND route the seed in `main` through `runUpdateBaseline` (3.2+3.4 merged — red observed, then green). Verify: `bun test tests/scripts/mutation/paired-run.test.ts` green

## 4. Shell-check agreement pin (D7 — no `check.sh` edit)

- [x] 4.1 Write the pin in `tests/scripts/check.test.ts` deriving both sides live: enumerate gateable roots via the widened `isGateableImplFile`, extract the path-prefix arms of `is_license_header_file`/`is_oxlint_scoped_file` from `scripts/check.sh`, and assert every gateable root is routed by both staged enumerations or recorded as a keyed exception (`plugins/`, `afk-runner/src/`). Verify: `bun test tests/scripts/check.test.ts` green
- [x] 4.2 Prove the pin bites: with a temporary synthetic seventh root added to the predicate (not committed), the pin fails without a matching shell arm. Verify: temporary red observed, then reverted

## 5. Seed floors + single landing commit (D5/D8)

- [x] 5.1 From the green tree (groups 1–4 done), run the D4 scoped seed in chunks (local or CI — execution detail per D5; each chunk ≈30–60 min, `seedMerge` per-key max and idempotent): `bun test:mutate:file $(git ls-files ':(glob)opencode-agent/src/**/*.ts' ':(exclude,glob)opencode-agent/src/**/index.ts' ':(exclude,glob)opencode-agent/src/**/constants.ts') --update-baseline`; retry errored/skipped chunks until all 151 newly covered files have fresh-measured floors, noting `reports/paired/scores.json` holds only the last chunk (expected non-composing snapshot). Verify: `node -e "const b=require('./scripts/mutation/baseline.json');const n=Object.keys(b).filter(k=>k.startsWith('opencode-agent/')).length;console.log(n);if(n!==151)process.exit(1)"` prints `151`
- [x] 5.2 Land the toolchain/scope edits (tasks 1–4) plus the seeded `scripts/mutation/baseline.json` as ONE commit — the widened scope never exists on master without its floors and the toolchain hash invalidates exactly once (D8). Verify: `bun check:full && bun run test` green before committing; `git log -1 --stat` shows the scope edits plus `baseline.json` in a single commit
- [x] 5.3 Confirm the spec's ordering SHALL on the landed commit: with a synthetic `opencode-agent/src/**` edit, `bun run test:mutate:changed --base=HEAD~1` selects the touched files, not zero targets. Verify: selection non-empty, then revert the synthetic edit. Rollback path: `git revert` of the scope commit (design Risks)

## 6. Documentation

- [x] 6.1 `docs/architecture/commands.md`: gateable-scope statement includes `opencode-agent/src/`. Verify: `grep -n "opencode-agent/src" docs/architecture/commands.md`
- [x] 6.2 `scripts/mutation/README.md`: ungated list, "zero targets passes" verdict wording, and the scoped seed recipe (D4 command + chunking note). Verify: `grep -n "opencode-agent" scripts/mutation/README.md && grep -n "zero targets" scripts/mutation/README.md`
- [x] 6.3 Root `CLAUDE.md` (with `AGENTS.md` as its symlink) and `tests/CLAUDE.md` Testing Notes updated. Verify: `grep -n "opencode-agent/src" CLAUDE.md tests/CLAUDE.md`
- [x] 6.4 `opencode-agent/ROADMAP.md` updated with the mutation-gate widening. Verify: `grep -in "mutation" opencode-agent/ROADMAP.md`
- [x] 6.5 Retire the S6-5/S6-7 markers in `opencode-agent/docs/remaining-findings-evaluation.md`. Verify: `! grep -n "S6-5\|S6-7" opencode-agent/docs/remaining-findings-evaluation.md`
- [x] 6.6 (Hand re-target of 1.1 after the kill-drill exhausted its attempts — the operator's designed escape at the escalation gate.) Pin the three new `stryker.config.json` lines red-first in `tests/scripts/mutation/stryker-config.test.ts`: `opencode-agent/src/**/*.ts`, `!opencode-agent/src/**/index.ts`, `!opencode-agent/src/**/constants.ts`. Verify: `bun test tests/scripts/mutation/stryker-config.test.ts` red before the lines land, green after
- [x] 6.7 (Hand re-target of 2.4 after its attempts burned.) Implement BOTH halves of the hooks TDD resolver for the coding-agent workspace: the opencode-agent/src sixth root in isGateableImplFile, and the flat-mapping branches for suggestTestPath, findTestFile, and resolveImplPath in .hooks/tdd/test-resolver.mjs. Known failing diagnostic from the prior attempts: suggestTestPath of opencode-agent/src/phases/implement-steps.ts expects tests/opencode-agent/implement-steps.test.ts but receives tests — the workspace arm is not reached ahead of the generic fallback; check where the workspace root plugs into each mapper, cover the findTestFile flat-then-colocated order, and the existence-checked resolveImplPath subtree search. Verify: bun run test:hooks green on the 2.1 and 2.2 cases
