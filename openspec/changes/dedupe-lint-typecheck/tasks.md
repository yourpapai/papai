# Tasks — dedupe-lint-typecheck

Order is fixed by design.md D4: measure first, branch on evidence, test-first edits only in the chosen branch. Groups 3–5 are mutually exclusive alternatives selected by task 2.4; check only the branch taken and leave the others unchecked.

## 1. Environment and baseline

- [x] 1.1 Run `bun install` (container starts without `node_modules`). Verify: `bun run typecheck` exits 0 on the clean tree.
- [x] 1.2 Record tool versions and machine shape (vCPU count) into design.md `Measured results`. Verify: `bun pm ls | grep -E 'oxlint|tsgolint'` plus `bunx tsgo --version`; values present in design.md.
- [x] 1.3 Time the three configurations (median of 3 runs each): `bun run lint` as configured, `bun run lint` with a scratch config having `typeAware`/`typeCheck` off, `bun run typecheck`. Record into design.md `Measured results`. Verify: all three table cells filled.

## 2. Probe drills (disposable worktree, per design D2 / Hook-interaction)

- [x] 2.1 Create a scratch `git worktree add` checkout so planted errors never touch the main tree's hook pipeline. Verify: `git worktree list` shows it; main tree `git status` clean.
- [x] 2.2 Plant the six probes (design.md D2 table) one class at a time in a scratch `src/` file and record which of (a) lint-as-configured, (b) lint with type-check off, (c) `tsgo` reports each. Verify: all six matrix rows filled in design.md `Measured results`; worktree removed afterwards (`git worktree list` shows only the main tree).
- [x] 2.3 Enumerate `.oxlintignore` vs `tsconfig.json` include/exclude and record any file class one pass checks and the other does not (non-subsumed scope). Verify: finding recorded in design.md `Measured results` (or `no scope differences` noted).
- [ ] 2.4 Decide the branch against design.md D1 bars (R1 / R2 / N) and write `Branch taken` plus rationale into design.md. Verify: `Branch taken` line in design.md names exactly one of R1/R2/N and matches the matrix.

## 3. Branch R1 — drop redundant `typecheck` from full mode and `check:verbose` (only if 2.4 = R1)

- [ ] 3.1 Test-first: update `tests/scripts/check.test.ts` — full-mode log assertions (~line 511) and composition assertions (~line 300) no longer expect `typecheck`, and a new assertion reads `package.json` scripts to pin `check:verbose` composition symmetric with check.sh full mode. Verify: `bun test tests/scripts/check.test.ts` fails red before any implementation edit.
- [ ] 3.2 Remove `typecheck` from the checks array in `scripts/check.sh:335` and from `check:verbose` in `package.json:102`; staged-mode typecheck stays untouched. Verify: `bun test tests/scripts/check.test.ts` passes green.

## 4. Branch R2 — disable lint's type-check pass (only if 2.4 = R2)

- [ ] 4.1 Test-first: add/extend a `tests/scripts/check.test.ts` (or nearest existing lint-config test) assertion pinning `.oxlintrc.json` `options.typeCheck: false` expectation. Verify: `bun test tests/scripts/check.test.ts` fails red before the config edit.
- [ ] 4.2 Set `options.typeCheck` (and `typeAware`) to `false` in `.oxlintrc.json`; no composition change anywhere. Verify: `bun test tests/scripts/check.test.ts` passes green; `bun run lint` exits 0.

## 5. Branch N — findings-only (only if 2.4 = N)

- [ ] 5.1 Change no gate, no test, no config; confirm the matrix and rationale in design.md are complete. Verify: `git diff --stat` over the repo shows only `openspec/changes/dedupe-lint-typecheck/**` and docs files from task 6.1.

## 6. Documentation and final verification (all branches)

- [ ] 6.1 Update `AGENTS.md` (timing table `lint` 35 s / `typecheck` 24 s rows to measured values, and the check-surface description if composition changed) and `docs/architecture/commands.md` to state why the surviving pass(es) exist — so the dual-vs-single question is not re-derived. Verify: `grep -n 'typecheck' AGENTS.md docs/architecture/commands.md` shows entries consistent with the branch taken.
- [ ] 6.2 End-to-end staged-path check on a clean tree. Verify: `./scripts/check.sh --skip-tests` exits 0.
- [ ] 6.3 Full gates. Verify: `bun run test` exits 0, `bun run typecheck` exits 0, `bun run lint` exits 0 (all three run, whatever branch was taken).
