# Design — dedupe-lint-typecheck

## Context

Two project-wide TypeScript-checking passes run side by side:

- `bun run lint` — `oxlint --config .oxlintrc.json --ignore-path .oxlintignore .`, with `.oxlintrc.json` `options.typeAware: true, typeCheck: true` (`.oxlintrc.json:11-14`), powered by the `oxlint-tsgolint` devDependency, which runs a TypeScript checker to serve type-aware rules.
- `bun run typecheck` — `tsgo --noEmit` over the root `tsconfig.json` (strict, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`).

They are composed together in exactly two places:

- `scripts/check.sh` **full mode** — the checks array (`scripts/check.sh:335`) runs `lint` and `typecheck` as parallel `bun run "$check"` jobs. CI reaches precisely this path (`bun check:full` at `.github/workflows/ci.yml:144`), so a change here propagates to CI with **no workflow edit**.
- `package.json` `check:verbose` — `bun run --parallel lint typecheck format:check knip test duplicates` (`package.json:102`). Local convenience surface only; its composition already differs from full mode (no `license-headers`, no `test:client`), so the invariant that matters is that the lint/typecheck pairing stays symmetric across both surfaces.

In `scripts/check.sh` **staged mode** the two are not redundant: oxlint runs on staged files only (`scripts/check.sh:200`) while `bun run typecheck` is project-wide (`scripts/check.sh:209`), so a staged edit that breaks an unstaged file's types is caught only by the typecheck leg. Staged mode is load-bearing as-is and is out of scope.

Constraints: this container has no `node_modules`, and the issue author could not verify the redundancy either. The change is therefore **verification-first** — nothing is removed on config-reading alone. Motivation and scope: see `proposal.md`.

## Goals / Non-Goals

**Goals:**

- Empirically establish, via a recorded probe matrix and timings, which pass subsumes which.
- Remove a pass only where the survivor demonstrably reports every probe class on the same (project-wide) file scope.
- Leave a written rationale in `AGENTS.md` / `docs/architecture/commands.md` so the dual-vs-single question is never re-derived from scratch.

**Non-Goals (design-level):**

- No change to staged mode, the `--skip-tests` filter, the mutation ratchet, coverage lanes, or CI workflow files.
- No lint-rule policy changes — the `.oxlintrc.json` `rules` block is untouched; only the `options.typeCheck` flag is even a candidate, and only under one outcome branch.
- No new tooling: no replacement linter/checker, no committed probe harness.

## Decisions

### D1 — Pre-branched decision tree, not a blind removal

The outcome is selected by evidence against fixed branches; the branches (not the measurements) are the design:

- **R1 — drop `typecheck` from full mode and `check:verbose`**: only if lint's configured pass reports every probe class that `tsgo` reports, over an equivalent file scope.
- **R2 — disable lint's `typeCheck` option**: only if no rule enabled by the current config is type-aware-dependent AND `tsgo` reports everything lint's checker pass reports. A single type-aware-rule probe that only fires with the checker on kills this branch.
- **N — findings-only (expected default)**: neither bar met; no gate changes; the matrix and rationale are written into this file and the docs.

Alternative rejected: reading the configs and assuming substitutability. Config presence (`typeCheck: true`) does not establish diagnostic equivalence — that assumption is exactly what issue #360 could not verify.

### D2 — A probe matrix defines equivalence

Plant each probe in a scratch `src/` file and record which of three configurations fails: (a) `bun run lint` as configured, (b) `bun run lint` with `typeAware`/`typeCheck` off via a scratch config, (c) `bun run typecheck`.

| # | Probe                                        | Diagnostic class                            |
| - | -------------------------------------------- | ------------------------------------------- |
| 1 | `const n: number = 'probe'`                  | compile-time type error                     |
| 2 | unused local binding                         | `noUnusedLocals`                            |
| 3 | unused function parameter                    | `noUnusedParameters`                        |
| 4 | index-signature property access               | `noPropertyAccessFromIndexSignature`        |
| 5 | `await` on a non-thenable value               | type-aware lint rule (`typescript/await-thenable`) — proves whether lint's checker pass has unique value |
| 6 | unguarded optional-property access            | strict-null-checks diagnostic               |

Equivalence additionally requires **file-scope equivalence**: enumerate `.oxlintignore` entries against `tsconfig.json` include/exclude and treat any file class one pass checks and the other does not as non-subsumed. A survivor can only be judged on the scope it actually checks.

### D3 — `tsgo --noEmit` stays authoritative in any removal outcome

`tsgo` is the actual compiler and owns the project's `tsconfig` semantics (`noUnusedLocals` and friends are its contract); oxlint's checker exists to serve rules, not to be the type gate. So the preferred removal direction is R1 only if fully proven, never `make oxlint the single type gate` on partial evidence. Alternative considered — dropping `tsgo` and leaning on tsgolint — rejected as the default because compiler-option diagnostics are not a documented contract of the lint path; that is precisely what the probes must establish before it could even be entertained.

### D4 — Edit surface and TDD order

1. `bun install` (the container starts without `node_modules`).
2. Run the D2 probe drills and D5 timings; record them under `Measured results` below.
3. Branch:
   - **R1**: update `tests/scripts/check.test.ts` first — the full-mode log assertions (`lint.log` / `typecheck.log`, around line 511) and the composition assertions (around line 300) — plus add an assertion that reads `package.json` scripts and pins the `check:verbose` composition, so the two surfaces cannot drift. Watch it go red. Then edit `scripts/check.sh:335` and `package.json:102`; watch it go green.
   - **R2**: same test-first order; the edit is `.oxlintrc.json` `options.typeCheck` instead of the check composition.
   - **N**: no test change; docs edits only.
4. Update `AGENTS.md` (timing table `lint` 35 s / `typecheck` 24 s rows) and `docs/architecture/commands.md` to match the outcome.
5. Full `bun run test`, `bun run typecheck`, `bun run lint` green; `./scripts/check.sh --skip-tests` clean end-to-end.

### D5 — Measurement protocol

Medians of three timed runs per configuration; record `oxlint`, `oxlint-tsgolint`, and `tsgo` versions plus machine shape (vCPU count) alongside. Note honestly that both passes run **in parallel** today, so the win is CPU headroom and contention stability on the 4-vCPU CI runner at least as much as wall-clock latency; report per-check wall time and do not promise latency improvements.

### D6 — Nothing new is introduced

- **Dependencies**: none. Existing devDeps (`oxlint`, `oxlint-tsgolint`, `tsgo`) cover the whole experiment; nothing in the AI SDK / Grammy / discord.js / Zod / drizzle stack is relevant to a lint/type-check composition question.
- **Modules**: none. No existing script covers the probe drill, but a committed probe harness would outlive a one-shot measurement — the drill is throwaway shell work in a scratch worktree, and its durable output is the table below plus the docs rationale. Smallest thing that works.
- **Capability / `tool_prefs` gating**: no impact — no chat-facing tool surface is added, changed, or removed; this is dev-tooling composition only.
- **Scope model**: no impact — no persisted state of any kind is introduced, so no storage-context, config-context, platform-instance, or user id keys anything.
- **DB**: no schema change, no drizzle migration, no backfill.

### Hook / TDD interaction

- The Write/Edit hook pipeline runs `check.sh --staged`, whose typecheck leg is project-wide over the **working tree**. A probe file carrying a planted error would therefore fail every gated write afterwards. All drills run in a disposable `git worktree add` checkout (or a create-run-delete single command) that is removed before any gated edit in the main tree.
- Files the Write/Edit hooks gate in this change: `tests/scripts/check.test.ts` (test-first, per D4), then `scripts/check.sh` / `package.json` / `.oxlintrc.json`, then the docs. The findings-only branch still requires a green tree because the hooks run regardless.

## Risks / Trade-offs

- [Removal on incomplete evidence weakens a gate] → the bar is the full D2 matrix on intersecting file scope; any unmatched probe class forces the findings-only branch.
- [File-scope mismatch hidden by ignore files] → D2 requires enumerating `.oxlintignore` vs `tsconfig` include/exclude; non-intersecting scope counts as non-subsumed.
- [Tool-version drift invalidates recorded equivalence] → versions are recorded with the matrix; re-run the drill on major bumps of oxlint / oxlint-tsgolint / tsgo before trusting the dedup.
- [Parallel fan-out masks the savings and oversells the change] → D5 reporting discipline: per-check timings, contention framing, no latency promises.
- [`check:verbose` drifts from `check.sh` full mode] → composition pinned test-first in `tests/scripts/check.test.ts` (removal branches).
- [Probe left on disk trips hooks or CI] → worktree protocol in `Hook / TDD interaction`.

## Migration Plan

Single PR, ordered as D4: measurements → tests (red) → composition/config edit (green) → docs and timing table. Rollback is `git revert` of the composition commit — there is no state or data to migrate. The staged pre-commit path is untouched, so commit-time gating is identical before and after. No `.github/workflows` edits are needed: CI funnels through `bun check:full`, which inherits the change.

## Measured results (record at apply time)

| Configuration                          | Wall time (median of 3) |
| -------------------------------------- | ----------------------- |
| `bun run lint` (as configured)         | 19.1 s (runs: 20.4 / 18.5 / 19.1) |
| `bun run lint` (`typeAware`/`typeCheck` off) | 0.44 s (runs: 0.45 / 0.42 / 0.44) |
| `bun run typecheck`                    | 10.6 s (runs: 11.0 / 10.6 / 10.6) |

Timing notes: the no-`typeCheck` leg was timed with `./node_modules/.bin/oxlint` using the exact `lint` script args plus a repo-root scratch config identical to `.oxlintrc.json` except the two flags (`bun run lint` cannot take an out-of-tree config); the `bun run` wrapper overhead is negligible against these magnitudes. oxlint resolves `ignorePatterns`/`overrides` relative to the config file's location, so the scratch config had to live in the repo root. The type-check pass inside lint costs ~18.7 s of its 19.1 s — more than the whole dedicated `tsgo` pass (10.6 s).

| Probe | lint (a) | lint no-typeCheck (b) | typecheck (c) |
| ----- | -------- | --------------------- | ------------- |
| 1 — compile-time type error (`const n: number = "probe"`) | yes — `typescript(TS2322)` via tsgolint | no | yes — `TS2322` |
| 2 — unused local binding | yes — `eslint(no-unused-vars)` **and** `typescript(TS6133)` | yes — `eslint(no-unused-vars)` | yes — `TS6133` |
| 3 — unused function parameter | yes — `eslint(no-unused-vars)` **and** `typescript(TS6133)` | yes — `eslint(no-unused-vars)` | yes — `TS6133` |
| 4 — index-signature property access | yes — `typescript(TS4111)` (+ `TS2322` from `noUncheckedIndexedAccess`) | no | yes — `TS4111` (+ `TS2322`) |
| 5 — `await` on non-thenable | yes — `typescript(await-thenable)` rule | no | no (tsgo allows `await` on non-thenable) |
| 6 — unguarded optional-property access | yes — `typescript(TS18048)` via tsgolint | no | yes — `TS18048` |

Probe-matrix reading: lint as configured (a) reported every diagnostic class that `tsgo` (c) reported — same TS codes, served by tsgolint — plus one class `tsgo` does not report (probe 5, `await-thenable`). The no-typeCheck leg (b) caught only the syntax-level `no-unused-vars` class; every compiler-dependent class (1, 4, 5, 6) vanished, so disabling `typeCheck` would orphan probe 5 entirely — R2's bar ("no type-aware-dependent rule fires") is failed by probe 5 alone. R1 additionally requires file-scope subsumption (2.3) before it can be taken.

Tool versions: `oxlint@1.78.0`, `oxlint-tsgolint@0.22.1` (via `bun pm ls`), `tsgo` `7.0.0-dev.20260707.2` (`bunx tsgo --version`), Bun `1.4.0`. Machine shape: 4 vCPU.

**Branch taken: _pending_ (R1 / R2 / N)** — decided by the matrix against D1's bars.
