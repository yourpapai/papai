# Fix: make unit tests usable under heavy local load (issue #314)

## Problem

On a dev machine shared by multiple coding agents, `bun run test` (and `test:raw`) exceeds 10–15 min agent shell timeouts with **zero output** (output is captured to the log file and only mirrored at the end), so agents blind-restart the full suite, compounding the load into a death spiral. Two root causes plus one concrete flake:

1. `selectMode` (`scripts/test/mode.ts:91`) picks `--parallel` (one worker process per file, ~1306 files) whenever `cores >= 8` and not CI — regardless of current system load. N agents × 1300 workers thrash the machine.
2. The per-test timeout is a fixed 15 s; under worker starvation, normally-sub-second tests stretch past it (the exact failure class `scripts/check.sh:385` documents for CI).
3. `tests/review-loop/git-identity.test.ts:51` flaked on a loaded Mac: the `expect(...).toThrow()` "no identity" commit **succeeded** because git fell back to auto-detecting an identity from the OS username/hostname (allowed when `user.useConfigOnly` is unset; with `env` fully replaced, `HOME` is unset and git falls back to the passwd-database home). The test's premise only holds on hosts where auto-detection fails (GitHub runners), not on developer laptops.

## Goal

Keep the full-suite quality gate unchanged (same tests, same coverage floor) while making wrapper-driven runs survive a loaded shared machine, and stop agent-driven full-suite restart loops.

## Changes

### 1. Deterministic negative git identity
- `tests/review-loop/git-identity.test.ts`: make the "no identity" state hermetic instead of host-dependent — pass `-c user.useConfigOnly=true` on the negative-path commit (git then always fails with "Committer identity unknown" instead of auto-detecting) and set `HOME` to an empty temp dir in the `identityless` env so no passwd-fallback config can leak in. Positive path (`applyCommitIdentity` stamps env vars) unchanged.

### 2. Load-aware execution plan in the wrapper
- `scripts/test/mode.ts` / `scripts/test/run.ts` / `scripts/test/run-cli.ts`:
  - Extend mode selection with a load signal (pure function, loadavg passed in via `RunDeps`; `run-cli.ts` feeds `os.loadavg()` alongside `os.availableParallelism()`). Demote to `serial` when the 1-min load average is already ≥ ~0.75 × cores (machine saturated by other agents). Precedence unchanged: explicit `--serial`/`--parallel` > `CI` > load > core count. Windows (`loadavg` = [0,0,0]) is treated as unloaded.
  - Scale the child `--timeout` with the demotion: 15000 ms normally, 30000 ms when the run was demoted for load (explicit `--timeout` on the command line still wins, as today).
  - Mark the demotion in the summary line (mode is already printed; e.g. `(serial · load)`) so agents see why serial was chosen.
- Update wrapper unit tests: `tests/scripts/test/mode.test.ts`, `tests/scripts/test/run.test.ts` (new cases: loaded machine → serial + 30000 timeout; explicit `--parallel` on loaded machine → parallel; load boundary; exit-code/artifact behavior unchanged).

### 3. Stream child output by default when stdout is not a TTY
- `scripts/test/run-cli.ts` / `scripts/test/run.ts` / `mode.ts`: `captureChild` already mirrors the child's output when `--stream` is set; make streaming default **on** when the wrapper's stdout is not a TTY (agents/pipes), off for interactive terminals unless `--stream`. `isTTY` injected via deps for testability. Agents then see live progress instead of a silent 10-minute hang, and a shell-timeout kill leaves a partially readable log.

### 4. Agent-facing guidance docs
- `AGENTS.md` ("Running and inspecting checks"), `tests/CLAUDE.md`, and `docs/architecture/commands.md` (bun script semantics) — add explicit rules for coding agents running tests on a shared/loaded host:
  - In the edit loop use `bun run test:affected [--base=REF]`, never the full suite; run the full suite once before finishing.
  - Never run two full suites concurrently on one machine; when the host is shared, `bun run test:serial` (or rely on the new auto-demotion) and budget a ≥ 20 min shell timeout for a full run.
  - If a shell timeout kills a run, do not blind-restart: `bun run test:status` / `test:log` first — the persisted report may already answer.
  - A load-induced flake is not a regression: re-run only the failing file(s) (`bun run test <paths>`) before concluding; the wrapper's `--serial` exists for isolation-sensitive debugging.

### 5. Design notes and non-goals
- Record the researched options in the change's `design.md`: (a) adopted — load demotion, timeout scaling, non-TTY streaming, docs; (b) declined/deferred — wrapper-level chunked batching to cap in-flight workers (bun test has no `--jobs`; would require enumerating discovery + merging multiple junit outputs — a follow-up if demotion proves insufficient), suite sharding, `--retry` (rejected: masks real flakes, contrary to the repo's no-retry stance), lowering test count or the coverage floor (quality must not drop).
- Non-goals: no changes to `scripts/coverage/floor.json`, the story-lane guards, `tests/stories/**`, or existing timing-assertion style beyond the git-identity fix.

## Files to touch

- `tests/review-loop/git-identity.test.ts`
- `scripts/test/mode.ts`, `scripts/test/run.ts`, `scripts/test/run-cli.ts`
- `tests/scripts/test/mode.test.ts`, `tests/scripts/test/run.test.ts`
- `AGENTS.md`, `tests/CLAUDE.md`, `docs/architecture/commands.md`

## Verification

- `bun test tests/review-loop/git-identity.test.ts` passes both with a configured global git identity and without; `CI=true bun test tests/review-loop/git-identity.test.ts` (the reporter's reproduction) passes.
- Wrapper unit tests cover load demotion, timeout scaling, and the non-TTY stream default; `bun test tests/scripts/test/` green.
- Full `bun run test` green on an idle machine; summary shows the selected mode; `bun run test:status` still answers from the persisted report; piped (non-TTY) run shows live output.
- `bun run check` (lint, typecheck, format) green.
