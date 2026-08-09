<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Agent check-loop — design

## Summary

Turn the repository's check surface from *"run it again to see it differently"* into *"run it once, read it
many times"*, and remove the three structural reasons an agent currently pays 6 minutes per question.

The change is organised as one invariant and six phases:

> **Invariant.** Every check run leaves a durable, machine-readable artifact under `reports/`, and every
> question an agent can ask about a run is answerable from that artifact without re-running anything.

| Phase | What                                                                                      | Blast radius        |
| ----- | ----------------------------------------------------------------------------------------- | ------------------- |
| 0     | `bun run test` becomes a wrapper that persists `reports/test/`; `check.sh` keeps its logs   | build tooling       |
| 1     | Query commands over the artifact (`test:failures`, `test:show`, `test:log`, `test:status`, `test:slowest`) | new scripts |
| 2     | `bun run test:affected` — reverse-import selection, depth 2                                 | new scripts         |
| 3     | Wire the four orphaned TDD hook checks (starting with `verifyTestsPass`)                    | hook configs        |
| 4     | Kill the noise and the 18 environmental false failures                                      | `tests/`            |
| 5     | Suite composition: `privacy-contract` becomes a post-run gate; parallel/serial auto-select  | `tests/`, `check.sh`, CI |
| 6     | Write the workflow down; stop teaching the old one                                          | docs, `pre-bash.mjs` |

Source of the numbers quoted throughout: [`docs/research/2026-08-09-agent-check-loop-efficiency.md`](../../research/2026-08-09-agent-check-loop-efficiency.md).

## Goals

- One full-suite run answers N follow-up questions instead of one.
- The inner loop (edit → verify) costs seconds, not minutes, and the agent knows what it did *not* cover.
- A green working tree reports zero failures on a clean container.
- The wall-clock floor under the default local suite drops from ~110 s (one file) to the real critical path.
- Every behaviour above is the *default*, reachable without the agent remembering a new command.

## Non-goals

- Changing what the suite asserts. No test's meaning changes; `privacy-contract`'s 17 controls stay
  release-blocking, they just stop being proven by re-running work the suite already did.
- Replacing Bun's test runner, adding a watch daemon, or introducing a persistent server the agent talks to.
- Test sharding across CI jobs (`bun test` has no `--shard`).
- Touching the story lane's hermeticity contract (`scripts/story/**`, frozen-tree rules). Phase 4 fixes a
  *test* that forgot to inject a seam; the sandbox contract itself is untouched.
- Coverage/mutation ratchets. Both keep their current gates and floors.

## Design principles

1. **The artifact is the product of a run, not a side effect.** If a run happened, its evidence outlives it.
2. **Identity from JUnit, prose from the log.** Bun's JUnit reporter gives authoritative file/line/name/duration
   but serialises failures as `<failure type="AssertionError" />` with no message. The console log has the
   diagnosis but no structure. Neither alone is enough; the wrapper joins them (§0.3).
3. **Narrowing must announce itself.** Any command that runs a subset prints what it skipped and why, so a
   green subset is never mistaken for a green suite.
4. **Cheap enough to be default.** The staleness fingerprint over 3,362 files costs **115 ms**; the
   reverse-import graph over 3,124 files builds in **under 1 s**. Both are affordable on every invocation.
5. **Fail open on the artifact, fail closed on the gate.** A missing or corrupt report degrades a *query* to
   "run the suite first"; it never lets a *gate* pass.

---

## Phase 0 — the run artifact

### 0.1 `bun run test` becomes the wrapper

```jsonc
"test":        "bun scripts/test/run.ts",          // was: bun test --parallel
"test:serial": "bun scripts/test/run.ts --serial",
"test:raw":    "bun test --parallel",              // documented escape hatch
```

`scripts/test/run.ts`:

1. Runs `scripts/ensure-client-built.ts` (already exists; no-ops when `public/` is present). This closes the
   documented footgun that `bun run test` does not self-build, which is 2 of the 19 clean-container failures.
2. Chooses the execution mode (§5.2) unless `--serial`/`--parallel` is explicit.
3. Spawns `bun test` with `--timeout 15000`, `--reporter=junit --reporter-outfile=reports/test/last-run.junit.xml`,
   and every caller argument passed through verbatim.
4. Tees the child's combined stdout/stderr to `reports/test/last-run.log` **untruncated**, and to the terminal
   only if `--stream` is passed (default: quiet, because the summary supersedes it).
5. Builds `reports/test/last-run.json` (§0.2) and prints a **≤ 20-line** summary.
6. Exits with the child's exit code, unchanged.

**Bypass rules.** `--watch` and `--update-snapshots` skip persistence entirely and stream through — they are
interactive modes with no meaningful "last run". Explicit path arguments are recorded in the artifact's
`argv`/`scope` so a later query can say *"this report covers 30 files, not the suite"*.

`bun test` (bare, Bun's builtin) keeps working and stays unwrapped. That is the escape hatch — and the leak
that Phase 6's advisory hook covers.

### 0.2 `reports/test/last-run.json`

```jsonc
{
  "schemaVersion": 1,
  "startedAt": "2026-08-09T06:50:12.004Z",
  "wallMs": 361204,
  "argv": ["--parallel", "--timeout", "15000"],
  "scope": { "kind": "full" },              // or { kind: "paths", paths: [...], selectedBy: "affected@2" }
  "mode": "parallel",                        // parallel | serial
  "fingerprint": "06b27075f65e2ef1",        // §0.4
  "gitSha": "3c61ced…",
  "totals": { "files": 1294, "tests": 12868, "pass": 12847, "fail": 19, "skip": 2, "expects": 76195 },
  "failures": [
    {
      "id": 1,
      "file": "tests/stats/perf.test.ts",
      "line": 102,
      "suite": ["stats perf bench"],
      "name": "getGlobalStats({ noCache: true }) completes under 1000ms with 1k subjects + 100k messages",
      "ms": 3129.08,
      "detail": { "logOffset": 12043, "logLength": 640 }   // byte range into last-run.log
    }
  ],
  "runErrors": [                             // "# Unhandled error between tests" blocks — no testcase exists
    { "file": "tests/bot-message-caching.test.ts", "message": "Cannot find module '@ai-sdk/openai-compatible'" }
  ],
  "slowestFiles": [{ "file": "tests/analytics/privacy-contract.test.ts", "ms": 112040, "tests": 19 }]
}
```

`runErrors` is not decoration, and `totals` deliberately comes from the console summary rather than the JUnit
root. On a clean checkout without `bun install`, a full run produces **1,294 files of unhandled module errors
and zero testcases**, and Bun writes **no JUnit file at all**. Worse, in the mixed case — some files load,
some do not — Bun *does* write JUnit, silently omits the unloadable files, and reports `failures="0"` on a run
that exited 1. A report built from the JUnit root would call that run green. The schema has to represent this
state, and the builder has to take totals from the log, or the query layer lies about it.

### 0.3 Joining JUnit to the log

Three measured facts drive this algorithm; each was verified directly against Bun 1.3.11.

| Fact                                                                                              | Consequence                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A failure serialises as `<failure type="AssertionError" />` — no message, no diff, no stack        | the log is the only source of diagnosis                |
| `type` is `AssertionError` even for a thrown non-assertion `Error`                                 | `type` carries no information; do not classify on it   |
| JUnit `classname` is the describe chain **reversed** and `>` is **double-escaped** (`outer > inner > deep fails` in the console becomes `classname="inner &amp;gt; outer"`) | never key on `classname` verbatim — reverse and decode it, and decode in **one pass over all entities, twice**, not entity-by-entity (a sequential `&lt;`→`&gt;`→`&amp;` decode collapses `&amp;gt;` in one step and destroys the distinction). `name` is escaped only **once** — decoding it twice corrupts any test name containing `&` |
| The double-escape leaves a **literal, unescaped `>` inside the `classname` attribute value** | the obvious `/<testcase[^>]*>/` scan truncates the element mid-attribute and silently drops `time`, `file` and `line`. A quote-aware tag scanner is required — this is the single biggest trap in "a regex scan is fine here" |
| Within one file, console `(fail)` order **equals** JUnit testcase order (verified with sibling describes sharing a leaf name) | positional join *scoped to a file* is sound; global positional order is not |
| **A file that fails to load is omitted from JUnit entirely, and the run still reports `failures="0"`.** A mixed run (one good file, one unloadable) exits 1 and prints `2 pass / 1 fail / 1 error`, while its JUnit says `tests="2" failures="0"`. When *every* file fails to load, **no JUnit file is written at all**. | **JUnit systematically under-reports and can look green on a red run.** `totals` must come from the console summary, never from `<testsuites>`; `runErrors` from the log is the only record of load failures; the reader must tolerate a missing JUnit file. Any gate trusting JUnit alone would pass a broken run. |

Algorithm:

1. Segment `last-run.log` on file-header lines (`^<path>:$`). Normalise header paths (they are relative to
   cwd) and JUnit `file` attributes (relative for in-tree files, absolute for out-of-tree) to repo-relative.
2. Within each file segment, split on `(fail) … [N ms]` markers; a failure's detail block is everything from
   the end of the previous marker to the end of its own marker line.
3. Zip the file's ordered failure blocks against that file's ordered failing `<testcase>` elements.
4. Cross-check: reverse the decoded `classname` segments, append `name`, and compare to the marker's text. On
   mismatch, keep JUnit identity, drop the `detail` range, and record a `joinWarnings` entry — degrade, never
   guess.

Everything about this is version-sensitive. It gets its own contract test (§Testing) that fails loudly if a
Bun upgrade changes the reporter, rather than silently producing empty details.

### 0.4 Staleness fingerprint

`fingerprint` = SHA-256 over `(repo-relative path, size, mtimeMs)` for every file under `src/`, `client/`,
`plugins/`, `tests/`, `scripts/`, plus `bunfig.toml`, `package.json`, `bun.lock`. Measured: **115 ms for 3,362
files** — cheap enough to compute on every write *and* every read.

`gitSha` is recorded alongside but is not the staleness signal: an agent edits without committing, so HEAD is
almost never the discriminator. Every query command compares the current fingerprint to the stored one and
prefixes stale output with a single line. It still answers the question; it just refuses to imply the answer
is current.

That line reads `⚠ source files changed since this run (fingerprint <old> → <new>) — re-run bun run test`.
An earlier draft of this spec had it say *"N files changed"*, which is not implementable and was caught in
review: a fingerprint is a digest over the whole file set, so the count of what moved is not recoverable from
it, and nothing else in `QueryContext` carries that. Reporting a number here would have meant either storing
the full file list in every report or inventing one. The banner says what it knows.

### 0.5 `check.sh` keeps its logs

- Replace the `mktemp -d` + `trap rm -rf` (`scripts/check.sh:22-23`) with `reports/checks/`, cleared at the
  start of a run rather than deleted at the end. Per-check files stay `<check>.log` (with `:` → `_`, the
  existing `safe_name` rule).
- The `test` check invokes the Phase-0 wrapper instead of `bun test` inline, so a `check:full` run produces the
  same `reports/test/` artifact as a direct run and the CI coverage path is unchanged.
- `.hooks/tdd/checks/check-full.mjs` — `formatCheckResult` currently receives `failures[].files` from
  `parseCheckOutput` and never reads them, then instructs `bun run <check>`. It becomes:

  ```
  `bun check:full` failed:
  - typecheck (3 files) — src/foo.ts, src/bar.ts, tests/baz.test.ts
    → reports/checks/typecheck.log
  - test (2 files) — tests/stats/perf.test.ts, tests/debug/server.test.ts
    → bun run test:failures      (report already on disk; do not re-run to look)
  ```

  `.hooks/tests/tdd/checks/check-full.test.ts` pins the current wording and is updated with it.

---

## Phase 1 — the query surface

All commands are **read-only**: they never spawn `bun test`. All are `bun run <script>`; all print the
staleness banner from §0.4 when it applies; all exit non-zero only on "no usable report" (`exit 3`), never on
"the run had failures" — the caller is asking a question, not gating.

| Command                                    | Output                                                                      | Typical size |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------ |
| `bun run test:status`                       | when, mode, scope, totals, wall time, staleness verdict                     | 6 lines      |
| `bun run test:failures [--files]`           | `#id  file:line  suite > name  (ms)`, grouped by file; `--files` = paths only | 1 line/failure |
| `bun run test:show <#id \| file[:line] \| substring>` | the joined detail block(s) for matching failures                   | ~20 lines each |
| `bun run test:log <pattern> [-C n]`         | regex over `last-run.log` with context — the honest replacement for the re-run-and-grep loop | bounded, `--max` default 200 lines |
| `bun run test:slowest [n]`                  | per-file in-test time from the JUnit index                                  | n lines      |

`test:log` matters more than it looks. The reported symptom is an agent re-running the suite to apply a
different filter; `test:log` is that filter applied to the run it already paid for. It is the command Phase 6's
guidance and Phase 6's advisory hook both point at.

`test:show` accepting a bare substring is deliberate: an agent that has just read a failure name should be able
to paste it back without translating it into an id.

---

## Phase 2 — `bun run test:affected`

### 2.1 Selection

Build a reverse-import graph over `src/`, `client/`, `plugins/`, `scripts/`, `tests/` by regex-scanning
relative specifiers and resolving `.js`→`.ts`, bare, and `index.ts` forms (3,124 files, 11,949 edges,
**< 1 s**). Cache it at `reports/test/import-graph.json` keyed by the §0.4 fingerprint.

Changed files come from `git diff --name-only --diff-filter=ACMR <base>...HEAD` unioned with
`git status --porcelain` (uncommitted work is the common case for an agent), mirroring
`selectChangedMutationTargets` in `scripts/mutation/changed-files.ts`.

The selected set is the union of:

- test files reachable from a changed file within **depth 2** of the reverse graph,
- `listCandidateTests()`'s same-package-directory heuristic (`scripts/mutation/coverage-map.ts`), which catches
  transitive coverage through re-exporting barrels,
- any changed file that is itself a test.

Depth 2 is not arbitrary. Measured across all 937 `src/` files:

| Depth        | p25   | p50       | p75    | p90    | 0 hits | < 5 % of suite |
| ------------ | ----- | --------- | ------ | ------ | ------ | -------------- |
| 1            | 0.1 % | 0.1 %     | 0.2 %  | 0.4 %  | **6 %** | 94 %          |
| **2**        | 0.3 % | **0.5 %** | 1.2 %  | 2.7 %  | **0 %** | 94 %          |
| 3            | 0.4 % | 1.2 %     | 3.2 %  | 47.9 % | 0 %     | 80 %          |
| full closure | 3.2 % | 49.0 %    | 49.9 % | 53.4 % | 0 %     | 35 %          |

Depth 1 is empty for 6 % of source files — an inner-loop command that silently runs nothing is worse than
useless. Depth 3 falls off a cliff at p90 (47.9 %) as the hub cluster is reached; the full closure is
meaningless for hub modules (`src/history.ts` and `src/tools/index.ts` each reach ~49 % of the suite through
barrels and the composition root). Depth 2 is the only setting that is both small at the median and never
empty. `--depth=<n>` overrides.

### 2.2 Lanes

Route by `classifyTestLane()` (`scripts/mutation/coverage-runner.ts:18`): `server` files go to the Phase-0
wrapper; `client` files go through the `test:client` preset (`--conditions=browser`, the client preload,
`--path-ignore-patterns ''`); `external` (`tests/e2e/**`, `tests/stories/**`) is excluded and **named in the
output** as skipped.

### 2.3 Safety valve

If any changed file is a global-blast-radius input — `bunfig.toml`, `package.json`, `bun.lock`,
`tests/setup.ts`, `tests/mock-reset.ts`, anything under `tests/utils/` — selection is abandoned and the
command runs the full suite, saying so. These files are in every worker's preload; "affected" means everything.

### 2.4 Honesty banner

Every run prints, before the results:

```
test:affected — 7 of 1391 server test files (depth 2, 3 changed files)
  skipped lanes: e2e, stories
  This is a static-import heuristic: it cannot see mock.module() targets, computed dynamic
  imports, or behaviour reached through DI seams. Green here is not green for the suite.
```

The artifact records `scope.selectedBy: "affected@2"`, so `test:status` repeats the caveat later and no
downstream gate can mistake a subset report for a full one.

---

## Phase 3 — per-edit feedback

`docs/architecture/commands.md:71` documents a 7-step Write/Edit pipeline. Four of those checks exist, are
tested, and are wired into nothing:

| Check                                         | Documented as              | Wired |
| --------------------------------------------- | -------------------------- | ----- |
| `.hooks/tdd/checks/verify-tests-pass.mjs`     | step 6, targeted test run  | no    |
| `.hooks/tdd/checks/snapshot-surface.mjs`      | step 3, API snapshot       | no    |
| `.hooks/tdd/checks/verify-no-new-surface.mjs` | step 7, surface diff       | no    |
| `.hooks/tdd/checks/check-uncommitted.mjs`     | —                          | no    |

**3.1** Wire `verifyTestsPass` into `.claude/hooks/post-tool-use.mjs` and the `.codex`/`.opencode` twins. It
resolves the companion test via `.hooks/tdd/test-resolver.mjs`, runs `bun test <file> --only-failures`, and
caps output at 3,000 chars — a ~2 s red/green signal at the moment of the edit, which is the cheapest possible
way to remove the motive for a mid-loop full run. Its coverage-regression branch is inert today because
nothing writes the session baseline `getSessionBaseline` reads; that stays inert here and is Phase 3.2's
concern, not this one's.

**3.2** Wire `snapshot-surface` (pre) + `verify-no-new-surface` (post) together, or delete steps 3/6/7 from
`docs/architecture/commands.md`. Shipping docs that describe a pipeline that does not exist is its own cost:
an agent reads them and assumes it already has feedback it is not getting.

**3.3** Raise the hook timeouts. `.claude/settings.json` gives PostToolUse **200 ms**; a targeted `bun test`
needs ~3 s cold. Without this, 3.1 silently times out and looks like it works.

---

## Phase 4 — noise and false failures

On a clean container a green tree reports **19 failures, 18 of them environmental**, and 20 % of a near-green
run's output is `git init` boilerplate. Both make the agent's first signal untrustworthy, which is itself a
re-run driver.

| # | Problem                                                                                  | Fix                                                                                                            |
| - | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 | 100 log lines (**20 %**) of `hint: Using 'master' as the name for the initial branch`      | export `GIT_CONFIG_GLOBAL` pointing at a fixture with `init.defaultBranch` in `tests/setup.ts`; one place, covers every suite that shells out to git. (`tests/scripts/behavior-audit/publish-snapshot.test.ts:226` already passes `-q -b` and shows the per-call alternative.) |
| 2 | 16 failures in `tests/scripts/test-stories.test.ts` — real Docker preflight               | These call `runStoryTests` **without** injecting `assertLinuxSandboxBackend`, while sibling tests in the same file do. Inject the stub. This is a forgotten seam, not an environment requirement — no skip, no env gate, and the sandbox contract is untouched. |
| 3 | 2 failures in `tests/debug/*` — `public/` not built                                       | Solved by §0.1 step 1 (`ensure-client-built` in the wrapper). The tests keep their fail-fast message for `bun test` (raw) callers.                              |
| 4 | 1 flaky failure: `tests/stats/perf.test.ts` asserts `elapsed < 1000 ms` under worker load | Wall-clock budgets contradict `tests/CLAUDE.md`'s own "no fixed-wall-clock timing assertions" rule. Gate the budget assertion behind `PAPAI_PERF_BUDGETS=1` (set in CI's serial run) and keep the correctness assertions unconditional. |
| 5 | ~135 lines of deliberate test stdout (`[round 1/5] Reviewing…`, `Switched to a new branch 'main'`, `coverage-map: no covering test found…`, HTTP access logs) | Route through the injected logger these suites already accept, or suppress in `tests/setup.ts` the way `console.log` already is. |

---

## Phase 5 — suite composition

### 5.1 `privacy-contract` becomes a post-run gate

`tests/analytics/privacy-contract.test.ts` is **110 s of the suite's 371 s** — 33 % of all in-test time, and a
hard floor no scheduling change can beat. The cause (`:256-273`): for each of the 17 release-blocking controls
it calls `runFixture()`, which does `Bun.spawnSync(['bun','test',<fixture>])`. Across the table that is **57
unique fixture files** re-run in nested processes, each paying the ~1.7 s cold preload.

Every one of those 57 files is already run by the parent suite. The nested spawns re-execute work the run just
did, purely to make the *linkage* between a control and its proof explicit.

Phase 0 makes that linkage cheap and, in fact, **stronger**:

- The `PRIVACY_CONTRACT` table (17 controls → fixtures → proof points) stays exactly where it is and keeps its
  structural tests: 17 rows, non-empty proof points, every fixture path exists on disk. Those are pure
  assertions and stay in the default suite.
- The "every proof fixture passes" assertion moves to `scripts/analytics/privacy-contract-gate.ts`, run as
  `bun run analytics:privacy-contract`. It reads `reports/test/last-run.json`, verifies the report is a
  **full-scope, non-stale** run, and asserts each of the 57 fixtures appears with zero failures.
- The gate is added to `check.sh` (after `test`) and to the analytics release-gate sequence in
  `docs/architecture/commands.md`, replacing the current
  `bun test tests/analytics/privacy-contract.test.ts` line.

This is a strengthening, not a weakening: today the contract proves those fixtures pass *in a fresh nested
process*; afterwards it proves they passed *in the very run that gates the release*. It costs milliseconds.
The gate must fail closed on a missing, stale, or subset-scope report — that is the §Principle-5 case, and it
is the one place `test:affected`'s `scope` field is load-bearing.

Expected effect: full local suite ~6 min → **~3–4 min** on 4 vCPU.

### 5.2 Execution mode by core count, not by `CI`

Measured on 4 vCPU: `--parallel` was **slower** than serial on the heavy `tests/review-loop` subset (34.2 s vs
27.6 s) and a wash on 200 light files (4.7 s vs 4.4 s). The documented ~2.5x holds at 12 cores. `check.sh`
already special-cases `CI=true` to serial for stability — the same reasoning applies to any constrained box,
and hosted agent containers are the common case now.

The wrapper picks `--parallel` when `navigator.hardwareConcurrency >= 8` and `CI` is unset, else serial
(`hardwareConcurrency` reports 4 correctly in this container). `--serial`/`--parallel` and `test:serial`
override. The chosen mode is recorded in the artifact and printed in `test:status`, so a timing comparison
between two runs is never accidentally apples-to-oranges.

### 5.3 `opencode-agent` check command

`opencode-agent/src/config.ts:262` defaults `AGENT_CHECK_COMMAND` to
`bun run lint && bun run typecheck && bun test` — chained with `&&`, so a lint failure hides the typecheck and
test results and costs an extra round; and bare `bun test` bypasses the wrapper. Default becomes
`bun check:full`, which runs all checks concurrently and now leaves `reports/checks/` and `reports/test/`
behind for the agent to query. `check-loop.ts`'s existing narrow-to-failed-checks behaviour is unchanged and
composes with it.

---

## Phase 6 — guidance

**6.1** A "Running and inspecting checks" section in `CLAUDE.md` (with the detail in `tests/CLAUDE.md`): run
once → read the artifact → never re-run to re-filter; `test:affected` in the loop, full suite before commit;
plus the measured cost table so an agent can budget (`lint` 35 s, `typecheck` 24 s, `knip` 4.6 s,
`format:check` 2.9 s, `duplicates` 1.3 s, full suite ~6 min at 4 vCPU).

**6.2** Purge the 20 `bun test … 2>&1 | tail -N` / `| head -N` / `| grep …` occurrences from
`docs/superpowers/plans/` — three of which pipe the **full** suite. A plan that teaches the idiom recreates the
problem on every future read.

**6.3** Extend `.claude/hooks/pre-bash.mjs` with an **advisory** (never a deny) when a full-suite invocation is
piped into `head`/`tail`/`grep`: *"`bun run test` persists to `reports/test/` — use `bun run test:log <pattern>`
to re-filter without re-running."* Precedent for the posture already exists in
`review-loop/src/prompt-templates.ts:19`, which gives reviewers an explicit verification budget forbidding test
suites and `bun check:full`.

---

## Command surface after this work

| Command                       | Runs tests? | Purpose                                                |
| ----------------------------- | ----------- | ------------------------------------------------------ |
| `bun run test`                | yes         | full suite; persists `reports/test/`; ≤ 20-line summary |
| `bun run test:affected`       | yes         | depth-2 selection over changed files                    |
| `bun run test:serial`         | yes         | forced serial, for isolation debugging                  |
| `bun run test:raw`            | yes         | unwrapped `bun test --parallel`, no artifact            |
| `bun run test:status`         | **no**      | what the last run was, and whether it is still valid    |
| `bun run test:failures`       | **no**      | failing tests with `file:line`                          |
| `bun run test:show <sel>`     | **no**      | full diagnostic for one failure                         |
| `bun run test:log <pattern>`  | **no**      | filter the persisted log                                |
| `bun run test:slowest [n]`    | **no**      | per-file in-test time                                   |
| `bun run analytics:privacy-contract` | **no** | 17-control gate over the last full run                 |

Unchanged: `test:client`, `test:e2e`, `test:stories*`, `test:smoke`, `test:platform`, `test:coverage`,
`test:mutate*`, `check`, `check:full`.

---

## Testing strategy

New code lives in `scripts/test/**` with companions under `tests/scripts/test/**`, DI-first per
`tests/CLAUDE.md`.

| Area                     | Coverage                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| JUnit↔log join (§0.3)    | **Contract test against recorded Bun output**: reversed+double-escaped `classname`, sibling describes sharing a leaf name, out-of-tree absolute `file`, a file with unhandled errors and no testcases, and a run with zero failures. This is the version-sensitive seam — it must fail loudly on a Bun upgrade, not degrade silently. |
| Wrapper (§0.1)           | argv pass-through, exit-code fidelity, `--watch`/`--update-snapshots` bypass, `ensure-client-built` invoked once, mode selection at 4 vs 12 cores (injected `hardwareConcurrency`). |
| Fingerprint (§0.4)       | stable across a no-op re-scan; changes on content, rename, and delete; queries emit the stale banner exactly once.            |
| Query commands           | golden-output tests over a fixture `reports/test/`; `exit 3` on missing/corrupt report; every command asserted **not** to spawn `bun`. |
| `test:affected`          | depth-2 selection on a synthetic graph; the six global-blast-radius inputs each trigger full-suite fallback; lane routing; banner content. Plus a **soundness sample**: on N recorded real commits, assert the selected set contains every file that actually failed in the corresponding full run. |
| `check.sh` (§0.5)        | extends the existing fake-`bun`-on-`PATH` harness in `tests/scripts/check.test.ts`; asserts `reports/checks/<check>.log` exists after a failing check. |
| `formatCheckResult`      | updated assertions in `.hooks/tests/tdd/checks/check-full.test.ts`; the parsed `files` now appear in the output.              |
| Privacy-contract gate    | 17 rows / fixtures-exist stay as unit tests; the gate gets its own tests for green, for a missing fixture, and for the three fail-closed cases (missing report, stale fingerprint, subset scope). |

Mutation: `scripts/**` is outside the ratchet's gateable roots, so no baseline entries are created; the gate
script is the exception worth a companion-quality review because it is release-blocking.

---

## Migration & compatibility

- `reports/` is already gitignored — no `.gitignore` change.
- CI is unaffected by §0.1: no workflow calls `bun run test` (the `check` job calls `bun check:full`, which
  invokes the suite inline; §0.5 routes that through the wrapper, and the existing
  `bun test --coverage` + `coverage:ratchet` path under `CI=true` is preserved verbatim).
- `.hooks/docs/map-files-to-analytics.mjs:103` embeds a verification command string; re-check after Phase 5.1.
- Phases are independently shippable and ordered by dependency: **0 → 1 → {2, 3, 4} → 5 → 6**. Phase 5.1
  depends on Phase 0's artifact and must not land before it.

## Risks

| Risk                                                                     | Mitigation                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bun changes its console or JUnit format and the join silently empties     | the §0.3 contract test asserts the parse on recorded fixtures; `joinWarnings` surfaces degradation in `test:status` rather than hiding it |
| An agent trusts a green `test:affected` as a green suite                  | §2.4 banner + `scope` in the artifact + the privacy-contract gate refusing subset-scope reports    |
| Moving the privacy-contract assertion is read as weakening a privacy gate | it strengthens it (proof from the gating run, not a re-run); the 17-row table, fixture-existence checks, and release-blocking status are unchanged; the gate fails closed |
| Stale artifacts mislead                                                   | 115 ms fingerprint checked on **every** read, banner on every stale answer, hard failure in the gate |
| Wiring `verifyTestsPass` slows every edit                                 | ~2 s targeted run; the coverage branch stays inert; hook timeout raised deliberately (§3.3) rather than left to silently expire |
| Phase 4 noise suppression hides a real diagnostic                         | suppress at the source (git config, logger injection), never by filtering the wrapper's captured log — `last-run.log` stays byte-complete |

## Open questions

1. **Report retention.** One `last-run.*` triple, or the last N keyed by fingerprint so an agent can diff two
   runs? N > 1 makes "did my change fix it?" answerable without a third run. Proposed: keep `last-run.*` plus
   `previous-run.*`, nothing more.
2. **`test:affected` in `check.sh`?** Tempting for a fast pre-commit gate, but the coverage ratchet and the
   privacy-contract gate both need full-scope runs. Proposed: no — `check:full` stays full.
3. **Warm-runner idea.** A long-lived `bun test --watch` the agent queries would remove cold-start entirely but
   needs a control channel; deliberately out of scope here and worth its own spike.
4. **Bun version pin.** The join contract is tested against 1.3.11 locally and 1.3.13 in CI. Should the
   wrapper assert a known-good reporter version range and warn outside it?
