## Context

The test wrapper is three modules with a strict DI split: `scripts/test/mode.ts` holds the pure argv/mode logic (`parseWrapperArgs`, `selectMode(explicit, env, cores)`), `scripts/test/run.ts` orchestrates through `RunDeps` (every side effect injected: spawn, artifacts, print, clock), and `scripts/test/run-cli.ts` is the only place real collaborators are wired (`os.availableParallelism()`, fs, `Bun.spawnSync`). Today `selectMode` picks `--parallel` at >=8 cores whenever `CI` is unset, regardless of current load; the child timeout is a fixed `15000` injected before passthrough args (so an explicit `--timeout` still wins); `captureChild` runs the child with `spawnSync`, stdio `[inherit, fd, fd]` on the report log — one shared fd, so the log is byte-complete and correctly interleaved — and mirrors the log only after the child exits, and only when `--stream` is set.

`tests/review-loop/git-identity.test.ts` builds its no-identity state by pointing `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` at `/dev/null` with a fully replaced env — but with `HOME` unset, git falls back to the passwd-database home and auto-detects an identity when `user.useConfigOnly` is unset, so the negative-path `toThrow()` only holds on hosts where auto-detection fails. Motivation and root causes: see `proposal.md`. Behavior contracts: `specs/test-wrapper/spec.md`, `specs/test-hermeticity/spec.md`.

## Goals / Non-Goals

**Goals:**

- Every new decision (load demotion, timeout scaling, stream default) is a pure function or an injected-deps decision, assertable from `tests/scripts/test/` without host setup.
- Zero change to what a run executes or how it is judged: same tests, same coverage floor, child's exit code, same persisted-artifact contract (one additive report field).

**Non-Goals:**

- Chunked worker batching, suite sharding, retries, coverage-floor or test-count changes — the researched options recorded as declined in Decisions below; the proposal's Non-goals stand.
- No new npm dependencies; no changes outside the wrapper, the one flaky test, and docs.

## Decisions

### 1. Load signal: 1-minute loadavg as an injected plain value

`RunDeps` gains `load1: number` (run-cli feeds `os.loadavg()[0]` alongside `os.availableParallelism()`). Demotion threshold is a named constant `LOAD_DEMOTION_RATIO = 0.75`: demote when `load1 >= 0.75 * cores`. Platforms without loadavg (Windows reports `[0, 0, 0]`) fall out naturally — 0 never meets the threshold, i.e. treated as unloaded; no platform sniffing.

Alternatives: `os.cpus()` delta sampling (needs an async warm-up sample and delays the signal by the sample window); parsing `uptime`/external tools (portability); 15-minute average (too slow to protect against a currently-spawning agent fleet).

### 2. One pure plan, not two functions

`selectMode` stays the single entry point but returns an `ExecutionPlan { mode, loadDemoted }` instead of a bare mode. Precedence is unchanged — explicit flag > truthy `CI` > load > core count — and only the load branch sets `loadDemoted`: an explicit `--serial` under load, CI serial, and few-core serial are all *not* demotions (no timeout bump, no marker), matching the spec.

Alternatives: a second `isLoadDemoted()` function (two calls can diverge on inputs — misuse risk); computing the plan in run-cli (the untested wiring layer; `run.test.ts` could not assert it).

### 3. Timeout rides the plan

`childFlagsFor` takes the plan and injects `--timeout 30000` when `loadDemoted`, else the existing `15000`, still before passthrough args so an explicit `--timeout` keeps winning through the existing last-wins mechanism. Constants are named (`CHILD_TIMEOUT_MS`, `CHILD_TIMEOUT_DEMOTE_MS`). Bypass (`--watch`) runs get the same scaling — harmless, and avoids a second flag path.

### 4. Streaming default from injected isTTY; liveness via async spawn + log tail

The effective-stream decision moves inside `runWrapper`: `stream = args.stream || !deps.stdoutIsTTY` (non-bypass runs), with `stdoutIsTTY: boolean` added to `RunDeps`. `RunDeps.spawn` gains an options object — `spawn(argv, { stream })` — so `run.test.ts` can assert the non-TTY default and that streamed and non-streamed runs produce identical artifacts and exit codes.

Liveness requires abandoning `spawnSync` (it blocks until exit; the current `--stream` mirror is post-exit). `captureChild` moves to async `Bun.spawn` with the child stdio **unchanged** (`[inherit, fd, fd]` — keeps the byte-complete, correctly interleaved single-fd capture the design comment exists to guarantee), plus a poll-based tail of the growing log: read from the last offset every ~250 ms and write the new bytes to `process.stderr` while the child runs; stop at exit; final output still read from the file. `SpawnResult` keeps its shape; `spawn` returns a promise and `runWrapper`/`main` become async — the async surface stays minimal (spawn -> runWrapper -> main).

Alternatives: piped stdio (`stdout: 'pipe', stderr: 'pipe'`) tee'd per stream — rejected because splitting the shared fd reorders `console.log` against `(fail)`, the exact regression the current code documents; keeping the post-exit mirror and only flipping the default — rejected, it delivers no liveness, which is the point; spawning `tee` — not available on Windows; `fs.watch` — append events are unreliable cross-platform for this use.

### 5. Disclosure: additive report field, rendered marker

`RunReport` gains `loadDemoted: boolean`; `mode` stays `'serial' | 'parallel'` so existing comparisons keep working; the summary's counts line renders `(serial · load)` when the flag is set. Alternative: overloading the `mode` string — breaks every consumer for zero benefit.

### 6. Hermetic negative git identity

On the negative-path commit, pass `-c user.useConfigOnly=true` (git then deterministically fails with the committer-identity error instead of auto-detecting) and point `HOME` at an empty temp dir in the `identityless` env so no passwd-fallback `~/.gitconfig` can leak in. Keeps the suite's build-up-not-strip-down philosophy; positive path untouched. Alternatives: setting empty `GIT_AUTHOR_*` (not the state under test), skipping the test on hosts with identities (hides exactly the bug class it pins), `useConfigOnly` in the shared fixtures gitconfig (would change semantics for every other suite that shells out to git).

### 7. Module placement; no new modules or dependencies

The work extends the three existing wrapper modules — `mode.ts` (pure plan), `run.ts` (orchestration + stream decision), `run-cli.ts` (real deps: `os.loadavg()`, `process.stdout.isTTY`, async spawn + tail mirror). No existing module covers live mirroring; if `run-cli.ts` trips `max-lines`, extract the tailer into `scripts/test/mirror-log.ts` — that split is the lint limit doing its job as a design signal. No dependencies added: `os.loadavg` and `process.stdout.isTTY` are stdlib; nothing in the installed stack observes host load.

### 8. Options considered and declined/deferred

- **Wrapper-level chunked batching** to cap in-flight workers: `bun test` has no `--jobs`; would require enumerating discovery and merging multiple JUnit outputs. Deferred as the recorded follow-up if demotion proves insufficient.
- **Suite sharding**: same machinery as batching with more moving parts and no agent-visible win.
- **`--retry`**: masks real flakes, contrary to the repo's no-retry stance.
- **Lowering test count or the coverage floor**: the quality gate must not drop (proposal Non-goals).

## Risks / Trade-offs

- [1-min loadavg lags bursty starts: two agents starting simultaneously both go parallel before load registers] → the docs rule 'never two full suites concurrently on one machine' covers the burst; demotion catches the steady state; batching is the recorded follow-up.
- [0.75 threshold false-positives on busy-but-healthy hosts → slower serial runs] → serial is correct-but-slower, never wrong; explicit `--parallel` is the documented escape hatch.
- [30 s timeout lets genuinely slow tests pass under load] → only on demoted runs and still bounded; same tests, same floor — the quality gate is unchanged.
- [Non-TTY default streams full child output into CI logs (CI stdout is not a TTY)] → mirror goes to stderr and the summary contract is unchanged; if log volume becomes a real problem, carve CI out in a follow-up change (that would amend the spec, so it needs evidence first).
- [Async conversion of spawn/runWrapper: unhandled-rejection and exit-code hazards] → async surface kept minimal; `run.test.ts` keeps asserting exit-code passthrough and artifact identity between streamed and non-streamed runs.
- [Tail poll adds latency and a file-read loop] → ~250 ms cadence, stopped at child exit; negligible next to the suite.
- [Windows never demotes (loadavg is 0)] → documented limitation; `--serial` is the manual escape; CI is serial via `CI=true` regardless.

## Migration Plan

Single branch/PR, no deploy. Task order: (1) the hermetic git-identity fix (test-only); (2) `tests/scripts/test/mode.test.ts` red for the plan/demotion/boundary/Windows cases → implement in `mode.ts`; (3) `tests/scripts/test/run.test.ts` red for timeout scaling, summary marker, non-TTY stream default, and async spawn semantics → implement `run.ts` + `run-cli.ts` wiring; (4) docs (`AGENTS.md` run-checks section, `tests/CLAUDE.md`, `docs/architecture/commands.md`); (5) full gates (`bun run test`, typecheck, lint, format). Rollback is a revert: the report's `loadDemoted` field is additive (older readers ignore it), and the next run rewrites the artifacts anyway. No DB, config, or scope-model impact: nothing is keyed by storage/config context, platform instance, or user — dev-machine report files only. No capability/tool-prefs impact: no tool surface is touched.

## Hook/TDD Interactions

The Write/Edit hook pipeline gates `scripts/test/{mode,run,run-cli}.ts`, so every production edit lands only after its failing test exists in `tests/scripts/test/{mode,run}.test.ts` (DI-first suites; no `mock.module` needed — spawn/env/isTTY are already injected). Work test-first in the order above. The git-identity edit is inside a test file: no production pair, hooks do not gate it; where a host with a configured or auto-detectable identity is available, watch the current test fail there first, otherwise rely on the host matrix in the proposal's Verification section.

## Open Questions

- Does CI log volume from the non-TTY streaming default stay acceptable? Answerable after merge from real runs; does not change this design (the carve-out, if ever, is a small follow-up with a spec amendment).
- Tail poll interval (~250 ms) tuning — cosmetic, safe to adjust any time.
