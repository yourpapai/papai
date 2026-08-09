<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent ↔ project-checks loop — efficiency research

**Date:** 2026-08-09
**Type:** Investigation / research only — no `src/`, `tests/`, `scripts/`, or hook changes were made.
**Question:** an agent runs the full suite, then re-runs it repeatedly with different `grep`/`head`/`tail`
pipelines. How can the agent's interaction with the project's checks be made cheaper in wall-clock time
and tokens, and more informative?

## 1. Executive summary

The repeated-run pattern is **not an agent discipline problem — it is the only workflow the repository
currently makes available.** A `bun run test` invocation leaves nothing behind: the results exist only as
one Bash tool result in the transcript, and the moment the agent wants a different slice of it (a different
`grep`, more context lines, the next 20 lines) the only way to get that slice is to pay 6 minutes and run
the suite again. Three separate mechanisms actively push the agent into that loop:

- `scripts/check.sh` writes each check's output to a `mktemp -d` directory it **deletes on exit**
  (`scripts/check.sh:22-23`).
- The Stop hook parses the failing checks and the failing file paths out of that output, **throws the file
  paths away**, and emits the instruction `Fix the failed check(s), then rerun: bun run test`
  (`.hooks/tdd/checks/check-full.mjs:5-16` — `formatCheckResult` never reads the `files` it was given).
- The documented per-edit "targeted test run + coverage regression check"
  (`docs/architecture/commands.md:71`, step 6) **is not wired into any harness**. `verifyTestsPass` exists
  and is tested but no `.claude/`, `.codex/`, or `.opencode/` hook imports it, so nothing gives the agent
  narrow, immediate feedback after an edit — the full suite is the first signal it ever gets.

Separately, the full run is slower and noisier than it needs to be. One test file,
`tests/analytics/privacy-contract.test.ts`, takes **1m50s on its own** (it spawns ~30 nested `bun test`
processes) and therefore sets a hard floor under the whole suite's wall time — no amount of parallelism
gets the suite below it. And on a clean agent container a **green** working tree reports **19 failures, 18
of them purely environmental** (missing `public/` bundles, missing Docker), so the agent's very first
signal is indistinguishable from a real regression.

The highest-value fix is cheap and needs no new test infrastructure: **make every check run leave a
durable, queryable artifact, and give the agent commands to query it instead of re-running.** The second
is **affected-test selection**, which the repo already has all the machinery for — a static reverse-import
graph over the whole repo builds in **under 1 second**, and at depth 2 it selects a median of **0.5 % of
the suite** for a changed source file.

## 2. Measured baseline

All measurements taken on this container: 4 vCPU, 16 GB RAM, Bun 1.3.11, `bun install` from a clean clone,
`BUN_OPTIONS=--smol` set by the harness. The repo's own docs quote ~2.5 min on a 12-core machine, which is
consistent with the 6 min measured here.

| Measurement                                                       | Value                                          |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `bun test --parallel --timeout 15000` (two runs)                   | **6m01s** / **6m12s**                          |
| Suite size                                                         | 12,868 tests across 1,294 files                |
| Console output of a near-green run (19 failures)                   | 509 lines / 25 KB                              |
| — of which `git init` hint noise                                   | **100 lines (20 %)**                           |
| — of which actual failure diagnostics (error+stack+code+`(fail)`)  | ~164 lines (32 %)                              |
| — of which stray test stdout (`[round 1/5] Reviewing…`, HTTP logs) | ~135 lines (27 %)                              |
| JUnit XML for the same run                                         | 3.4 MB / 20,585 lines                          |
| Sum of in-test time across all tests                               | 344 s                                          |
| Slowest single file (`tests/analytics/privacy-contract.test.ts`)   | **110 s alone** — 33 % of all in-test time     |
| Top 20 files' share of in-test time                                | 65 %                                           |
| Files with < 0.1 s of in-test time                                 | 976 of 1,241 (**79 %**)                        |
| Cold cost of the `bunfig.toml` preload for one worker              | ~1.7 s (vs 17 ms with the preload disabled)    |
| 200 representative light test files, `--parallel`                  | 4.4 s                                          |
| Reverse-import graph over 3,124 repo files                         | **< 1 s**                                      |
| Non-test checks: `lint` / `typecheck` / `knip` / `format:check` / `duplicates` | 35 s / 24 s / 4.6 s / 2.9 s / 1.3 s |

### 2.1 Where the six minutes actually goes

The suite is **not** uniformly slow. 79 % of files spend under 100 ms inside test callbacks, and 200
real light files run in 4.4 s. The wall time is set by a small tail:

```
  110.0s   19 tests  tests/analytics/privacy-contract.test.ts   <- spawns ~30 nested `bun test` runs
   16.6s   55 tests  tests/scripts/test-stories.test.ts
   16.5s   23 tests  tests/review-loop/issue-processor.test.ts
   10.4s    4 tests  docs/research/analytics-metrics/poc/fixture/sql-models.test.ts
    8.5s    4 tests  docs/research/analytics-metrics/poc/fixture/generate-fixture.test.ts
```

`tests/analytics/privacy-contract.test.ts:260-261` spawns `bun test <fixture>` per fixture case. Each of
those nested runs pays the ~1.7 s cold preload cost (`bunfig.toml` preloads `tests/setup.ts` +
`tests/mock-reset.ts`, and `tests/mock-reset.ts` eagerly imports **56 modules** to snapshot them). Timed on
its own that file takes **1m49s** — so while it remains in the default lane, no scheduling change can bring
the suite under ~2 minutes.

Two smaller surprises worth recording, because they contradict assumptions in the repo docs:

- **`--parallel` is not a win on 4 vCPU.** On `tests/review-loop` (git/IO-heavy): serial **27.6 s** vs
  `--parallel` **34.2 s**. On 200 light files the two are a wash (4.7 s vs 4.4 s). The documented "~2.5x
  faster" holds on a 12-core machine, not on a hosted agent container. `scripts/check.sh` already switches
  to serial under `CI=true` for stability reasons; the same reasoning applies to constrained agent boxes.
- **The preload cost is per-worker, not per-file.** 100 trivial files run in 2.0 s with the preload and
  0.13 s without it — the 1.7 s is paid once per worker process, not 1,294 times. It only becomes a real
  cost where processes are spawned per-case, i.e. inside `privacy-contract`.

### 2.2 Environmental failures dominate the first signal

On a clean container with no Docker and no `bun build:client`, a **green tree** reports 19 failures:

| Count  | Failure                                                                       | Cause                       |
| -----: | ----------------------------------------------------------------------------- | --------------------------- |
| 16     | `story runner reports and compatibility` / `story report lifecycle`            | no Docker daemon            |
| 2      | `debug-server`, `debug-smoke`                                                  | `public/` bundles not built |
| 1      | `stats perf bench > … completes under 1000ms`                                  | wall-clock budget under load |

The agent's first full-suite run therefore produces 18–19 red tests that have nothing to do with its
change. Distinguishing them costs at least one more full run.

## 3. Why the agent re-runs — root causes

### R1. No run artifact survives, so re-querying means re-running

`scripts/check.sh:22-23`:

```bash
TMPDIR=$(mktemp -d) || { echo "Failed to create temp dir" >&2; exit 1; }
trap 'rm -rf "$TMPDIR"' EXIT
```

Every check's stdout/stderr is captured per check, printed once if it failed, and then deleted. `bun run
test` likewise streams to the terminal and keeps nothing. The only persisted test artifacts in the repo are
the story lane's (`reports/stories/{manifest.json,junit.xml}`, `scripts/story/reports.ts`) and coverage
lcov. The default suite has no equivalent.

Consequence: the run's output lives only inside one Bash tool result. Agent harnesses truncate long tool
output, so the agent pipes to `head`/`tail`/`grep` to keep it under the limit — and each *different* filter
is a fresh 6-minute run. This is precisely the reported symptom.

### R2. The Stop hook tells the agent to re-run, and discards evidence it already has

`.hooks/tdd/checks/check-full.mjs:5-16`:

```js
export function formatCheckResult(failures) {
  const checks = failures.map(({ check }) => `- ${check}`)
  const reruns = failures.map(({ check }) => `bun run ${check}`)
  return [
    '`bun check:full` failed with the following failed checks:',
    ...checks, '',
    'Fix the failed check(s), then rerun:',
    ...reruns,
  ].join('\n')
}
```

`parseCheckOutput` (`.hooks/tdd/checks/parse-check-output.mjs`) already extracts, per failed check, the set
of `src/`/`tests/`/`client/` paths named in the output. `formatCheckResult` receives that as `failures[].files`
and **never reads it** — and the behaviour is pinned by `.hooks/tests/tdd/checks/check-full.test.ts`. The
agent is handed a check name and an instruction to run it again. For `lint`/`typecheck` that is a ~30 s
penalty; the same shape applied to `test` is a 6-minute one.

### R3. There is no "affected tests" entry point

`package.json` offers the full suite, lane presets (`test:client`, `test:e2e`, `test:stories`, `test:smoke`,
`test:platform`), and mutation lanes. Nothing maps *"I changed `src/foo.ts`"* to *"run these test files"*.
An agent that wants a narrow run has to hand-assemble paths, and `docs/superpowers/plans/` shows it doing
exactly that — one plan lists 21 directories on a single `bun test` line.

The mapping logic exists twice already:

- `.hooks/tdd/test-resolver.mjs` — `findTestFile()` / `suggestTestPath()`, the companion-file mapping for
  `src/`, `client/`, `plugins/`, `review-loop/src/`.
- `scripts/mutation/coverage-map.ts` — `listCandidateTests()`, a *static* union of "tests that textually
  import this source" and "tests in the same package directory", plus `classifyTestLane()`
  (`scripts/mutation/coverage-runner.ts:18`) to exclude the e2e/story lanes.

Neither is exposed as a command.

### R4. The documented per-edit targeted run is not wired

`docs/architecture/commands.md:71` documents a 7-step Write/Edit pipeline. The actual wiring in
`.claude/settings.json` is 4 steps: `enforceWritePolicy` + `enforceTdd` (pre), `trackTestWrite` +
`verifyTestImport` (post). Four implemented, tested checks are **orphaned** — no harness config references
them:

| Check                                       | Documented as              | Wired? |
| ------------------------------------------- | -------------------------- | ------ |
| `.hooks/tdd/checks/verify-tests-pass.mjs`   | step 6 (targeted test run) | **no** |
| `.hooks/tdd/checks/snapshot-surface.mjs`    | step 3 (API snapshot)      | **no** |
| `.hooks/tdd/checks/verify-no-new-surface.mjs` | step 7 (surface diff)    | **no** |
| `.hooks/tdd/checks/check-uncommitted.mjs`   | —                          | **no** |

`verifyTestsPass` already does the right thing: resolve the companion test, run `bun test <file>
--only-failures`, and return the output capped at 3,000 chars (`.hooks/tdd/test-runner.mjs:5`). Wiring it
would give the agent a sub-2-second red/green signal on every edit, which is the cheapest possible way to
remove the motive for a mid-loop full run.

### R5. The output is mostly noise, so filtering *looks* mandatory

Of the 509-line near-green log: 100 lines are `git init` hints (tests calling `git init` without `-b`; only
`tests/scripts/behavior-audit/publish-snapshot.test.ts:226` passes `-q -b`), ~19 lines are repeated Docker
availability warnings, and dozens more are deliberate test stdout that escapes the `tests/setup.ts` console
suppression (`[round 1/5] Reviewing…`, `Switched to a new branch 'main'`, `coverage-map: no covering test
found for src/foo.ts`, `GET /repos/... - 403`). Only about a third of the output is failure diagnostics. A
fully green run would be almost entirely noise plus a 5-line summary.

Note also that the `(fail)` marker line comes *after* its error block, so `grep '(fail)'` yields names
without reasons and `grep -B15 '(fail)'` is needed for context — a structural reason agents make a second
pass with different flags.

### R6. JUnit exists but is not sufficient on its own

`bun test --reporter=junit --reporter-outfile=…` works alongside `--parallel` and yields per-test file,
line, name and duration. Two limits matter:

- **Failures carry no message.** A failing case serialises as `<failure type="AssertionError" />` — no
  expected/received, no stack. Verified directly. So JUnit is a good *index* but cannot replace the console
  log as the *detail* source.
- **Size.** 3.4 MB / 20,585 lines for a full run — unreadable directly, fine behind a query tool.
- Per-file wall time is not reported (the file-level `<testsuite time>` is `0`); only per-test callback
  time is, which is why §2.1 reports "in-test time" rather than wall time per file.

### R7. The repo's own plans teach the wasteful idiom

`docs/superpowers/plans/` contains 20 instances of `bun test … 2>&1 | tail -N` / `| head -N` / `| grep …`,
three of which pipe the **full** suite. An agent reading a plan is being instructed to burn 6 minutes per
filter. There is one precedent going the other way:
`review-loop/src/prompt-templates.ts:19` gives reviewers an explicit *verification budget* forbidding test
suites, builds, typechecks and `bun check:full` — evidence that the cost is already recognised in one
corner of the repo.

## 4. Recommendations

Ranked by (impact ÷ effort). Every one reuses machinery that already exists.

### P0-1 — Persist every run; add a query surface instead of a re-run

Make `bun run test` (via a thin `scripts/test/run.ts` wrapper) always write to gitignored `reports/test/`:

- `last-run.log` — full console output, untruncated;
- `last-run.junit.xml` — `--reporter=junit` index;
- `last-run.json` — `{ startedAt, argv, wallMs, totals, failures: [{ file, line, suite, name, ms }] }`,
  built by joining the JUnit index (identity) with the console log (diagnostics), which is exactly the
  split forced by R6.

…and print a **≤ 20-line summary** to stdout: totals, wall time, and the failing `file:line — test name`
list. Then add read-only query commands that never re-run:

| Command                    | Answers                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `bun t:failures`           | failing tests, grouped by file, with `file:line`               |
| `bun t:show <file\|#n>`    | the full diagnostic block for one failure                      |
| `bun t:log <pattern>`      | `grep` over the persisted log, with context                    |
| `bun t:slowest [n]`        | per-file in-test time, from the JUnit index                    |
| `bun t:status`             | when the last run happened, against which `git` SHA, and whether the tree has changed since |

`bun t:status` matters: it lets the agent (and a hook) tell "the artifact is still valid" from "you have
edited since, re-run". This turns the N-greps-N-runs pattern into **one run + N cheap reads**, and it is
the single change that most directly addresses the reported symptom.

Effort: small (one script + a JUnit/console joiner). Risk: none — additive, `reports/` is already
gitignored.

### P0-2 — Stop the check pipeline from discarding evidence

1. In `scripts/check.sh`, write per-check output to `reports/checks/<check>.log` instead of a `mktemp -d`
   that is trapped for deletion. Keep the current stdout behaviour verbatim; just also leave the file.
2. In `.hooks/tdd/checks/check-full.mjs`, change `formatCheckResult` to (a) list the `files` it already
   parsed, and (b) point at `reports/checks/<check>.log` **instead of** telling the agent to re-run.
   `.hooks/tests/tdd/checks/check-full.test.ts` pins the current text and must be updated with it.

This is a handful of lines and removes an explicit, repo-authored instruction to re-run.

### P1-1 — `bun t:affected` — run only what a change can reach

A static reverse-import graph over `src/`, `client/`, `plugins/`, `scripts/`, `tests/` (3,124 files, 11,949
resolved relative-import edges) **builds in under 1 second**. Selecting the test files that transitively
import a changed file gives, across all 937 `src/` files:

| Depth                            | p25   | p50       | p75   | p90   | files with 0 hits | files under 5 % of suite |
| -------------------------------- | ----- | --------- | ----- | ----- | ----------------- | ------------------------ |
| 1 (tests importing it directly)  | 0.1 % | **0.1 %** | 0.2 % | 0.4 % | 6 %               | 94 %                     |
| **2 (recommended default)**      | 0.3 % | **0.5 %** | 1.2 % | 2.7 % | **0 %**           | 94 %                     |
| 3                                | 0.4 % | 1.2 %     | 3.2 % | 47.9 % | 0 %              | 80 %                     |
| full closure                     | 3.2 % | 49.0 %    | 49.9 % | 53.4 % | 0 %              | 35 %                     |

Depth 2 is the sweet spot: a median of ~7 files (≈ 0.5 % of the suite, a few seconds), and unlike depth 1
it is **never empty**. The full closure is useless for hub modules — `src/history.ts` and `src/tools/index.ts`
each reach ~49 % of the suite — because barrels and the runtime composition root make almost everything
reachable from almost everything.

Implementation notes: reuse `classifyTestLane()` to drop the `tests/e2e/**` and `tests/stories/**` lanes and
to route `tests/client/**` through the `test:client` preset; reuse `listCandidateTests()`'s same-package-directory
union as a safety net for barrel re-exports. Cache the graph in `reports/test/import-graph.json` keyed by a
hash of the file list + mtimes.

**This is a narrowing heuristic, not a proof.** It cannot see `mock.module()` targets, dynamic
`await import()` with computed specifiers, or behaviour reached through the DI seams. It belongs in the
inner loop; the full suite still gates the commit. Say so in the command's own output so the agent does not
mistake a green affected-run for a green suite.

### P1-2 — Wire the orphaned per-edit checks (or delete the claim)

Add `verifyTestsPass` to `.claude/hooks/post-tool-use.mjs` (and the `.codex`/`.opencode` twins). Cost is one
companion test file (~2 s); benefit is that the agent learns it broke something *at the edit*, not 6 minutes
later. If the intent was to drop these checks, remove step 3/6/7 from `docs/architecture/commands.md:71` —
right now the docs describe a pipeline that does not exist.

### P1-3 — Cut the noise floor

- Route test `git init` through a helper that passes `-q -b master`, or export
  `GIT_CONFIG_GLOBAL` with `init.defaultBranch` in `tests/setup.ts`. Removes **20 %** of the log.
- Silence the repeated Docker-availability warning when the story sandbox is not required.
- Suppress deliberate progress stdout from `review-loop`/`mutation-improve` suites under test, the way
  `tests/setup.ts` already suppresses `console.log`.

### P2-1 — Take `privacy-contract` off the critical path

`tests/analytics/privacy-contract.test.ts` is 110 s of the suite's ~371 s wall time and a hard floor under
any scheduling improvement. Options, in preference order: (a) have its nested cases share one `bun test`
invocation instead of ~30, (b) move it to its own lane invoked by CI and by the analytics release gate
(which already names it explicitly in `docs/architecture/commands.md`) rather than by `bun run test`.
Either way the contract keeps running in CI — this is about the *default local lane* the agent uses.
Expect the full local suite to drop to roughly 3–4 minutes on this box.

### P2-2 — Make environmental failures skip, not fail

`tests/debug/*` and the story-sandbox suites should `test.skip` with an actionable reason when `public/` is
unbuilt or Docker is absent, unless `CI=true` or `PAPAI_REQUIRE_STORY_SANDBOX=1` (which CI already sets).
Today they turn a green tree red 18 times on a clean agent container, and the agent cannot distinguish that
from its own regression without another run.

### P2-3 — Write the workflow down, and stop teaching the old one

Add a short "Running and inspecting checks" section to `CLAUDE.md` / `tests/CLAUDE.md`: run once, read the
artifact, never re-run to re-filter; use `t:affected` in the loop and the full suite before commit; the
cost table from §2 so the agent can budget. Then purge the 20 `2>&1 | tail -N` occurrences from
`docs/superpowers/plans/`, and consider a `pre-bash.mjs` warning (not a block) when a full-suite invocation
is piped into `head`/`tail`/`grep`.

### P3 — Revisit `--parallel` as the local default

On 4 vCPU, `--parallel` was **slower** than serial on the heavy `tests/review-loop` subset (34.2 s vs
27.6 s) and equal on light files. `scripts/check.sh` already special-cases `CI=true` to serial. Consider
selecting the mode from `navigator.hardwareConcurrency`/`os.cpus().length` rather than from `CI`, so
constrained agent containers get the faster path automatically. Note `opencode-agent`'s default
`AGENT_CHECK_COMMAND` (`opencode-agent/src/config.ts:262`) is `bun run lint && bun run typecheck && bun test`
— chained with `&&`, so a lint failure hides the typecheck and test results and costs an extra round;
`bun check:full` runs them concurrently and reports all three at once.

## 5. Expected effect

| Change                                        | Effect                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| P0-1 persisted run + query commands            | N filters over one run instead of N runs. At the observed 3–4 filters per investigation: **~18 min → ~6 min**, and each query returns tens of lines instead of a truncated 25 KB dump |
| P0-2 check logs + no "rerun" instruction       | removes one 30 s–6 min re-run per Stop-hook block                              |
| P1-1 `t:affected` (depth 2)                    | inner-loop verification at a median **0.5 %** of the suite — seconds, not minutes |
| P1-2 wire `verifyTestsPass`                    | red/green at edit time (~2 s), removing the motive for mid-loop full runs      |
| P1-3 noise reduction                           | ~20–60 % fewer output lines per run                                            |
| P2-1 `privacy-contract` off the default lane   | full local suite ~6 min → ~3–4 min on 4 vCPU                                    |
| P2-2 environmental skips                       | removes 18 false failures from every clean-container run                        |

## 6. Caveats and open questions

- All timings are from one 4-vCPU container with `--smol`. Absolute numbers on a 12-core dev machine will
  be ~2.5x smaller; the *ratios* and the structural findings (single-file floor, noise share, selection
  percentiles) are machine-independent.
- The affected-test percentiles come from a prototype import-graph resolver that handles relative
  `.js`→`.ts` specifiers, directory `index.ts`, and `require`/dynamic-`import` with literal specifiers.
  It does not resolve path aliases (the repo does not appear to use any) and cannot see `mock.module()`
  edges. A production implementation should reuse `listCandidateTests()`'s same-package union to cover the
  gap, and should be validated by checking that the selected set is a superset of the failures a full run
  finds on a sample of real commits.
- `bun test` has no `--shard` flag, so splitting the suite across CI jobs is not available without a
  custom splitter over the file list.
- Not investigated: whether a long-lived `bun test --watch` process could serve as a warm query target for
  the agent. It would avoid the cold-start cost entirely but needs a control channel the agent can drive.
