# Design — Widen the mutation gate to the coding-agent workspace

## Context

Three pieces of plumbing define who the gate measures, and today none of them knows `opencode-agent/`:

- **Mutate globs** (`stryker.config.json`) enumerate targets for all-files runs (`test:mutate`, the full-regeneration recipe). They cover `src/providers/**`, `src/tools/**`, `plugins/task-provider-*/**` and a list of individual `src/*.ts` files. No `opencode-agent` entry.
- **The gateable predicate** (`isGateableImplFile`, `.hooks/tdd/test-resolver.mjs:22-34`) is the changed-file gate's sole scoping authority — `test:mutate:changed` and the plan/shard/gate pipeline all select targets through it (`changed-files.ts` `selectChangedMutationTargets` → `shard-plan.ts` `selectTargets`; the paired runner overwrites `mutate` with the target list, so the globs never narrow a changed-file run). It accepts `src/`, `client/`, `plugins/`, `review-loop/src/`, `afk-runner/src/` — not `opencode-agent/src/`. This is the actual blind spot: a workspace-only branch selects zero targets and passes.
- **The mappers** (`suggestTestPath`/`findTestFile`/`resolveImplPath` in the same file, and `samePackageTestDir` in `scripts/mutation/coverage-map.ts`) have no workspace branch either. Worse than unmapped: the generic fallbacks mis-resolve — `suggestTestPath('opencode-agent/src/foo.ts')` falls through to the tail branch and returns `tests/opencode-agent/src/foo.test.ts`, and `samePackageTestDir` returns top-level `tests`, which would drag every top-level test into workspace candidate universes once the predicate lets the files in. The mapper branch is load-bearing, not cosmetic.
- **`scripts/check.sh`** already routes `opencode-agent/src/*` in both staged-mode enumerations (`is_license_header_file`, `is_oxlint_scoped_file` — lines 55 and 68). S6-7's full-mode gap was superseded by root-checks-only full mode and is pinned closed by `tests/scripts/check.test.ts` (no `bun run opencode-agent:*` proxies in any mode).

Measured workspace facts the design commits to (measured 2026-09-03; the proposal's "~8,897 lines / 59 files" is a stale snapshot from the S6-5 finding):

- 152 product `.ts` files under `opencode-agent/src/` (134 top-level + 18 in `src/phases/`), 25,205 lines total — **151 files / 24,917 lines once the `index.ts` exclusion is applied**; that 151-file set is the measured/gated set every number below commits to.
- Exactly one `index.ts` (the CLI entrypoint) and zero `constants.ts` files today.
- Tests live **flat** in `tests/opencode-agent/`: 70 `.test.ts` files, no mirrored subdirectories — `phases.test.ts` and `implement-steps.test.ts` sit beside top-level tests, unlike the mirrored layouts of `review-loop/` and `afk-runner/`.
- Per-file gate cost model (fitted on 226 measured runs, `shard-weights.ts`): `≈12s + 0.505s/line`. Average workspace file: 165.8 lines → **≈96s/file**, against the ~107s/file global average. Largest workspace files are 300 lines → **≈164s**, far under the 336s global max that floors the makespan.
- The score fingerprint's toolchain hash (`score-fingerprint.ts`) covers `stryker.config.json`, `.hooks/tdd/test-resolver.mjs` and every `scripts/mutation/*.ts` — all edited by this change.
- `pairedRun` measures its file list **sequentially** in one process (`paired-run.ts` `sourceFiles.forEach`); `seedMerge` is per-key max and idempotent, so seeded chunks compose.
- Scope-model / capability-gating impact: none. This is repo CI tooling — no tool surface (nothing enters `tool_prefs`), no persisted state, no storage/config-context/platform-instance/user ids, no DB, no new dependency. The existing stack covers everything; no new module is introduced — the change extends `test-resolver.mjs`, `coverage-map.ts`, `paired-run-cli.ts` (flag parsing) plus `paired-run.ts` (seed wiring in its `main`, which is the only place `runUpdateBaseline` can be reached from the `test:mutate:file` entrypoint), `stryker.config.json` and `check.sh`'s pin tests.

See proposal.md — Why for motivation, and `specs/mutation-gate/spec.md` for the requirements.

## Goals / Non-Goals

**Goals:**

- One widened scope, applied at every surface that derives it: globs, predicate, mappers, and the check.sh agreement pin — so the gate, the TDD hooks, `test:affected`, and the fingerprint all resolve the same workspace pairs.
- Floors for all 151 newly measured files — the 152 source files minus the excluded `index.ts` — committed from one fresh seeding run before the widened scope judges its first change.
- Named, measured numbers for every workspace-scoped decision: seed cost, steady-state PR cost, shard behavior.

**Non-Goals:**

- No widening to `scripts/`, `mutation-improve/`; no `client/` mutate glob (predicate-gateable, deliberately unglobbed — unchanged).
- No ratchet-semantics or shard-sizing constant changes (numbers re-derived below show none is needed).
- No test additions or score improvements demanded of the workspace; floors are recorded as measured.
- No check.sh behavioral change, and no per-workspace check entries reintroduced in any mode.

## Decisions

### D1 — Mutate scope entry follows the per-tree exclusion pattern

Add to `stryker.config.json`'s `mutate`:

```
"opencode-agent/src/**/*.ts",
"!opencode-agent/src/**/index.ts",
"!opencode-agent/src/**/constants.ts",
```

Same shape as every other gated tree (`!src/providers/**/index.ts`, `!plugins/task-provider-*/**/constants.ts`). The `constants.ts` exclusion is added despite zero existing matches so a future constants module inherits the repo-wide convention instead of becoming a measured-by-accident file; the spec's exclusion scenario names both. The entrypoint `opencode-agent/src/index.ts` is excluded like the other barrels — its behavior is the composition of everything below it and its mutants are killed transitively.

Why the glob at all, when the paired runner overwrites `mutate` per target: the glob is what makes `test:mutate` (all-files) and the delete-and-regenerate baseline recipe enumerate the workspace, keeping the two target authorities (globs for full runs, predicate for changed runs) from answering differently. Pinned by extending `tests/scripts/mutation/stryker-config.test.ts`.

*Alternatives:* hot-file scoping (S6-5's fallback list) — declined; see D5. Predicate-only, no glob — rejected: full-scope runs would silently disagree with the gate about what product code is.

### D2 — One shared predicate, widened in place (share, don't split)

Add `opencode-agent/src/` to `isGateableImplFile` as a sixth root. Because `changed-files.ts`, `shard-plan.ts` and the TDD hook checks (`enforce-tdd.mjs`, `tdd-nudge.mjs`, `verify-tests-pass.mjs`, `verify-no-new-surface.mjs`, `snapshot-surface.mjs`) all import this one function, the predicate edit alone routes the workspace through local `test:mutate:changed`, the plan/shard/gate CI dispatch, and the predicate-consuming checks of the Write/Edit TDD hook pipeline. (`verify-test-import.mjs` does not import the predicate — it joins the routing through D3's `resolveImplPath`/`testFileImportsImpl` widening instead, so D2+D3 together cover the whole pipeline.)

*Alternative:* split into a gate-only predicate so the hooks keep ignoring the workspace. Rejected: `scripts/mutation/README.md` states the invariant — "the two surfaces always agree on what 'gateable' means" — and the repo widened both together for `review-loop/` and `afk-runner/`. A split is two answers to one question and a drift waiting to happen. Consequence, accepted: workspace source writes now earn the advisory test-first nudge (suggesting the flat `tests/opencode-agent/` path per D3) and hook checks. One hook surface is **not** advisory: `verify-test-import` keeps its standard blocking semantics for workspace tests — it blocks a test write whose flat-resolved namesake impl exists but is not imported, exactly as it does for every other gated tree. The workspace consequence and its one-line migration are sized in D3; this is intended, not an oversight — the workspace ships pipeline code and inherits the same write-time discipline.

### D3 — Flat mapping convention, matching the workspace's measured test layout

The mappers learn `opencode-agent/src/**/x.ts ↔ tests/opencode-agent/x.test.ts` — the **entire `src/` subtree strips away**, not just the `src/` prefix:

- `suggestTestPath('opencode-agent/src/phases/implement-steps.ts')` → `tests/opencode-agent/implement-steps.test.ts`
- `findTestFile` checks the same flat counterpart (plus `.spec`), then the colocated fallback
- `resolveImplPath('tests/opencode-agent/implement-steps.test.ts')` → the unique existing basename match under the `src/` subtree — `opencode-agent/src/phases/implement-steps.ts` today. Back-resolution **searches the whole `src/` subtree** for the test's basename and returns it only when exactly one match exists on disk; zero matches (e.g. `phases.test.ts`, whose namesake module exists nowhere under `src/`) or several resolve **no** implementation counterpart — never a nonexistent path
- `samePackageTestDir` returns `tests/opencode-agent` for **every** workspace source (branch placed before the `src/` fallback so the current top-level-`tests` misfire disappears)

Rationale: the mapping's job is to resolve pairs that exist, and the workspace's actual layout is flat — 70 of 70 test files, with `src/phases/` tests filed at the top level. A strict mirror (`tests/opencode-agent/phases/…`, the `review-loop`/`afk-runner` shape) would resolve zero existing companions, put every workspace source's same-package candidate set at zero, and have the hook nudge contributors into a directory convention the workspace has never used.

Costs, measured and accepted:

- **Over-broad candidate universes.** Every workspace source's universe includes all 70 workspace tests. This over-invalidates and never under-invalidates — the exact trade the coverage-map design already makes deliberately — and the per-*test* content-keyed coverage cache bounds the work: a batch runs each of ~70 candidate tests once with coverage, then attributes sources from cache.
- **Fingerprint churn.** Editing any one workspace test invalidates all 151 measured workspace fingerprints (the gated set — `index.ts` is excluded and carries none), so the next gated run re-measures the set: ΣW ≈ 14.4k file-seconds ≈ **20–25 min wall** across the capped 12-shard matrix (D6). Accepted; revisit only if the workspace ever adopts a mirrored layout, which is a mapper-only change.
- **Back-resolution is partial by design.** Existence-checked subtree basename search resolves 58 of the 70 workspace tests to a unique namesake impl (57 top-level + `implement-steps` in `src/phases/`; all 58 unique today — no top-level/`phases/` basename collisions); the remaining 12 resolve none (e.g. `phases.test.ts`, a directory-barrel test). This is the flat layout's honest shape and is safe at every consumer: the write hook skips when no counterpart resolves (its existing fail-open, `verify-test-import.mjs` returns null before the import check — the same escape hatch it applies to every gated tree's transitive tests), and measurement-side attribution never relies on the single counterparty — it goes through `testFileImportsImpl`'s content check over the candidate universe, which is how the coverage-map universe has always disambiguated. Where a namesake exists, both surfaces resolve the identical pair, satisfying the spec's same-pair SHALL; where it does not, both resolve none.
- **`verify-test-import`'s block semantics apply to resolved namesakes.** Among the 58 resolvable tests, the hook blocks a write whose namesake impl is not imported. Measured today: 57 of the 58 pass the content check; exactly one blocks — `git-commit.test.ts`, which covers `git-commit.ts` transitively via `phases/triage` and never imports it. The landing change adds that one direct import (tasks item 2), and future transitive-named tests whose namesake exists get the same standard block at write time — the discipline every other gated tree already lives under.

### D4 — Seed mechanics: a scoped run over exactly the new scope, via `--update-baseline` on `test:mutate:file`

The spec requires one seeding run that measures the entire newly added scope fresh, committed before the widened scope gates anything. No existing command does that: `test:mutate:changed --update-baseline` measures only the branch diff (the workspace files are unchanged on master), and `test:mutate --update-baseline` regenerates everything (~421 existing entries plus the new set — ~16+ h single-process, prohibitive). Master's first-touch accumulation is incremental and violates the before-first-gated-change requirement.

So `test:mutate:file` gains `--update-baseline`, mirroring the sibling flag's exact semantics in `changed-files.ts`: reuse disabled (floors come only from that run's fresh measurement), `runUpdateBaseline` seeds `baseline.json` and writes the scores snapshot, exit 0 — seed, not gate, so the threshold verdict is bypassed on this path. No new module — the flag is parsed in `paired-run-cli.ts` beside `--threshold=`, and `paired-run.ts`'s `main` routes a `--update-baseline` run through `runUpdateBaseline` instead of `resolvePairedRunExitCode` (the CLI module exports only parse/resolve helpers, so the seed wiring necessarily lands in `paired-run.ts`, the `test:mutate:file` entrypoint). The seed is then:

```
bun test:mutate:file $(git ls-files ':(glob)opencode-agent/src/**/*.ts' ':(exclude,glob)opencode-agent/src/**/index.ts' ':(exclude,glob)opencode-agent/src/**/constants.ts') --update-baseline
```

Two pathspec properties are load-bearing (verified on git 2.50.1 in-repo):

- The positive pattern needs the `:(glob)` magic: under git's default pathspec matching the pattern requires a subdirectory below `src/`, so the bare form selects only the 18 `src/phases/` files and silently drops the 134 top-level sources (the `:(glob)` form selects all 152, as does the directory pathspec `opencode-agent/src/`).
- The excludes must be tree-scoped **and** globbed: an unanchored wildcard exclude (`:(exclude)**/index.ts`, even `:(exclude,glob)**/index.ts`) zeroes the entire selection to 0 files, while the tree-scoped `:(exclude,glob)opencode-agent/src/**/index.ts` form works. The full command above selects 151 files — the 152 sources minus the one excluded `index.ts`; zero `constants.ts` exist today.
- An empty selection is **rejected loudly** on this entrypoint and the flag path deliberately keeps that: `resolvePairedRunCliUsageExitCode` returns exit 2 for an empty file list and `paired-run.ts`'s `main` exits before `pairedRun` is ever reached. (The silent-green seed — empty `perFile` → `runUpdateBaseline` → exit 0 — exists only in the sibling, `changed-files.ts`, where zero changed targets is a normal green outcome; here an empty selection is always a pathspec bug, so bypassing the guard to mirror the sibling is declined. The loud guard is strictly stronger than a manual count assertion; the recipe's expected-count check — 151 today — stays as a belt-and-braces assertion of *which* files were selected, not of *whether* the run was green.)

*Alternatives:* full regeneration — measured prohibitive; a synthetic `--base` ref that makes the workspace files "changed" — measures far more than the new scope; first-touch accumulation — rejected by the spec.

### D5 — Seed cost is a one-off ≈4 h, chunkable; hot-file fallback declined

Named numbers with their backing:

- ΣW over the new scope — the 151 seeded files (152 sources minus the 288-line excluded `index.ts`, so 24,917 lines): 151 × 12s + 0.505 × 24,917 ≈ **14,395s ≈ 4.0 h** single-process (fitted weight model above), plus coverage-map preparation (~70 distinct candidate tests, one `bun test --coverage` run each, amortized by the 24 h cache).
- Because `pairedRun` is sequential, one command is a ~4 h wall-clock commit — past CI's 90-minute job ceiling. Chunking is safe and requires nothing new: `seedMerge` is per-key max and idempotent, so the list splits into ~4–8 directory- or count-sized chunks (≈30–60 min each) run sequentially or as separate jobs; `--update-baseline` guarantees each chunk's floors are fresh, and equal-or-lower re-measurements across chunk retries leave floors untouched. The scores snapshot is the one **non-composing** artifact: `runUpdateBaseline` rewrites `reports/paired/scores.json` with only that run's `perFile` (unconditional overwrite in `seed-from.ts`), so after N chunks the snapshot holds just the last chunk's files. Floors in `baseline.json` are the record of truth; the snapshot must not be read as the chunk-complete set — it feeds only the fresh-base re-seed replay path.
- **Decision: full-scope seed.** The S6-5 fallback (gating only `orchestrator.ts`, `triggers.ts`, `state-manager.ts`, `token-budget.ts` and the feedback modules) is declined: the cost is a one-off ~4 h of chunkable measurement, not a steady-state increase — steady-state stays bounded by changed files (~96s per touched workspace file). The fallback's saving would be a one-time few hours against a permanent hole in the strongest gate.
- Errored or skipped files during seeding produce no floor (never recorded) and stay retryable per chunk; the seeding pass repeats until every newly covered file is floored — the landing commit waits for a fully floored scope, and only files created in the workspace after seeding are judged by the no-floor rules (measured, never a free pass, per spec).

### D6 — Shard sizing: no constant changes (numbers recorded as required)

Workspace-scoped decisions against the fitted/ measured constants (`shard-sizing.ts`):

| Quantity | Value | Backing |
| --- | --- | --- |
| Avg workspace file weight | ≈96s | 165.8 lines avg × 0.505s + 12s; global measured avg ≈107s/file |
| Max workspace file weight | ≈164s (300 lines) | under the 336s global max file that floors the makespan |
| 2–3-file workspace PR | ≈190–290s total | below `DEFAULT_SINGLE_SHARD_THRESHOLD_SECONDS` (330s) → one shard, no matrix spawned |
| Full 151-file measured set (post-seed re-measure) | wants ⌈14,395/300⌉ = 48 shards | budget = `DEFAULT_TARGET_WALL_SECONDS` (360) − `ORCHESTRATION_OVERHEAD_SECONDS` (60) − 0 preparation = 300; capped at `DEFAULT_SHARD_CAP` = 12 (the measured knee) → 14,395/12 ≈ 20 min wall |

Every workspace file falls inside the distribution the constants were fitted on, so `--cap`, `--min-work` and `--target-wall` stay as measured. Re-derivation remains a measurement-triggered act, per the proposal's non-goal.

### D7 — `check.sh`: pin the agreement, change no behavior

The staged enumerations already route the workspace (lines 55/68); full mode is root-checks-only by design and pinned. What the spec adds is the standing obligation that the shell check and the gate cannot disagree again. So: a test in `tests/scripts/check.test.ts` (which already parses `check.sh`'s bodies via regex — precedent in the check-surface-composition block) derives **both sides live** rather than asserting a hardcoded list: it imports the widened predicate to enumerate the gateable roots (the established seam — `scripts/mutation/changed-files.ts:9` already imports `isGateableImplFile` from `.hooks/tdd/test-resolver.mjs`), extracts the path-prefix arms of `is_license_header_file` and `is_oxlint_scoped_file` from `check.sh`, and asserts that every gateable root is either routed by **both** staged enumerations or recorded as a named exception. A seventh root added to `isGateableImplFile` without a matching shell arm (and without an exception) then fails the pin — a static list of today's four trees would stay green through exactly the predicate-widened/shell-didn't divergence this pin exists to catch.

Two gateable roots are **not** routed by the staged enumerations today — `plugins/` and `afk-runner/src/` (no arm matches them; staged files there fall to `*) return 1`). The pin records them as keyed exceptions (each asserting: gateable, unrouted, known), so it passes today, yet stops passing the moment either tree gains a shell arm without retiring its exception — or a new gateable root appears with neither an arm nor an exception. That pre-existing divergence is recorded, not repaired, per the non-goals ("no repair of pre-existing divergences elsewhere"; "no check.sh behavioral change"); repairing it is a deliberate, separate change that edits the shell arms and retires the pin's exceptions together.

*Alternative:* re-add `opencode-agent:*` check entries — rejected; superseded by root-checks-only full mode and contradicted by the existing pins. Widening the two staged arms to `plugins/*`/`afk-runner/src/*` to make the pin universal — rejected for the same non-goals: it would silently attach license-header and oxlint checks to two trees this change does not own.

### D8 — One landing commit for the fingerprint-bearing files

`stryker.config.json`, `.hooks/tdd/test-resolver.mjs`, `scripts/mutation/coverage-map.ts` and `scripts/mutation/*.ts` all sit inside the score fingerprint's toolchain hash, so this change invalidates every carried-over score **once**, repo-wide. Landing all fingerprint-bearing edits in a single commit keeps that to exactly one invalidation; carried scores rebuild as branches touch their files, and the master seed job measures fresh regardless, so nothing is weakened — the first PRs after the merge simply re-measure their own targets. The landing commit also carries the seeded `scripts/mutation/baseline.json` (tasks item 4), so the widened scope and its floors go live together and the spec's "floored before the widened scope gates any change" ordering holds by construction.

## Risks / Trade-offs

- [One-time repo-wide score-cache invalidation from the toolchain fingerprint] → D8's single commit; the seed run is fresh anyway (`--update-baseline` disables reuse), and the master seed always measures fresh.
- [Seed run is ~4 h and exceeds a CI job's 90-minute ceiling as one command] → chunked into per-key-max, idempotent pieces (D5); each chunk re-seedable without conflict; floors commit only when the whole newly added scope has floors — a chunk with errored or skipped files is retried until it contributes floors for all its files, and the no-floor rules apply only to files created after seeding (per spec).
- [Flat mapping re-measures the 151-file measured set whenever any workspace test is edited] → ≈20–25 min wall at the 12-shard cap, bounded and honest; revisitable via a mapper-only change if the layout ever mirrors (D3).
- [Over-broad same-package candidate universes slow the plan's coverage-map phase] → per-test content-keyed cache bounds it to ~70 coverage runs per fresh batch; over-invalidation is the designed trade of the candidate universe.
- [TDD hook now fires on workspace writes, changing the edit-loop feel in `opencode-agent/`] → advisory nudges and predicate-consuming checks only, same as `review-loop/` and `afk-runner/` today — with one deliberate exception: `verify-test-import` keeps its standard blocking semantics for workspace tests whose resolved namesake impl exists but is not imported. Measured blast radius today: exactly one test (`git-commit.test.ts`), which gains its direct import in the landing change (tasks item 2); the 12 name-orphan tests stay covered by the hook's existing skip-on-nonexistent escape hatch. No other blocking behavior changes.
- [Low-scoring workspace files seed low floors] → that is the ratchet's contract (regression-only, monotonic upward); the gate gains the ability to catch drops from today's measured level, which is strictly more than the current unmeasured pass.
- [Rollback] → `git revert` of the scope commit restores the zero-target status quo; the seeded `baseline.json` keys become inert dead entries (records are only consulted for files the predicate selects). No record-shape migration is involved, so the ADR-0427 code-and-data pairing rule does not apply; optionally restore the pre-change baseline blob in the same revert for a byte-clean rollback.

## Migration Plan
Test-first order (each item red before green; none of the touched product files are themselves
hook-gated — `.hooks/` and `scripts/` are not gateable roots). tasks.md carries the plan as six
cohesive-seam items, mirrored here:

1. Mutate globs (D1): pin the three new lines red in `tests/scripts/mutation/stryker-config.test.ts`, then edit `stryker.config.json`.
2. Predicate + mappers (D2/D3): red tests in `.hooks/tests/tdd/test-resolver.test.ts` (predicate acceptance/rejection for `opencode-agent/src/`, the three mappers' flat pairs, the workspace in the pinned never-narrow-the-mappers block) and `tests/scripts/mutation/coverage-map.test.ts` (`samePackageTestDir`'s flat branch via `_samePackageTestDirForTest`); then widen `isGateableImplFile` + mappers (hook lane runs via `bun run test:hooks`) and `coverage-map.ts`; plus the one workspace test edit the routing requires — the direct `git-commit.js` import in `tests/opencode-agent/git-commit.test.ts` (D3).
3. `--update-baseline` seed path (D4): red tests for the flag parse in `paired-run-cli.ts` and the seed-not-gate routing + reuse-off + empty-selection exit-2 guard wired in `paired-run.ts`'s `main` against `runUpdateBaseline`; then implement both.
4. Seed `baseline.json` (D5): on the same branch, from the green tree, run the chunked scoped seed and verify every newly covered file has a record. Landing commit: merge the toolchain/scope edits (items 1–3, 5) and the seeded `scripts/mutation/baseline.json` as one commit, so the widened scope never exists on master without its floors — the spec's ordering SHALL holds by construction, and the one fingerprint invalidation D8 pins is that same commit. No separate "scope first, floors later" window exists.
5. Shell-check agreement pin (D7): the pin in `tests/scripts/check.test.ts`, both sides derived live; `check.sh` itself needs no edit.
6. Docs, in the same or a follow-up commit: `docs/architecture/commands.md` (gateable-scope statement), `scripts/mutation/README.md` (ungated list, its "zero targets passes" verdict, seed recipe), root `AGENTS.md`/`CLAUDE.md` Testing Notes, `tests/CLAUDE.md`, `opencode-agent/ROADMAP.md` and the S6-5/S6-7 markers in `opencode-agent/docs/remaining-findings-evaluation.md`.

Rollback: `git revert` of the scope commit (see Risks).

## Open Questions

- Where the ~4 h seed executes — local workstation in background chunks vs. a dedicated CI job with a raised timeout — is an execution detail: the flag, merge semantics and floor guarantees are identical. Decide at implementation time from whoever's machine budget is available.
