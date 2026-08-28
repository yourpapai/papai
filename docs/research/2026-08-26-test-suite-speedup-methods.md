<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Test-suite speedup methods — measured survey

**Date:** 2026-08-26
**Type:** Investigation / research only — no repo code changed. Measurements come from the persisted run reports of that day plus throwaway timing scripts run under `/var/folders/.../T/opencode/` (git-recipe timings, `GIT_TRACE2` counts).
**Question:** after `test-consolidation-speed-evidence` measured consolidation's speed ceiling at ~5 s, which *other* methods could speed the suite up, and what is each worth?

## Baseline: where the time actually is

From `reports/test/last-run.junit.xml` (1 553 files, 16 672 cases, 1 077 s serial in-test total):

```
by area (share of 1077 s in-test):        critical path (top files):
  review-loop      341s  31.7%              63s  review-loop/loop-controller
  tests/scripts   137s  12.7%              51s  review-loop/cli
  sdd-runner      134s  12.4%              50s  sdd-runner/orchestrator
  opencode-agent   71s   6.6%              44s  review-loop/issue-processor
  plugins          63s   5.8%              42s  opencode-agent/git
  analytics        53s   4.9%              42s  review-loop/worker-pool
  docs/research    38s   3.5%              33s  scripts/story-manifest
```

Two framing facts:

1. **Contention, not code, dominates parallel wall time.** `worker-pool.test.ts` reports 42 s in-test under a loaded parallel run but 7.6–8.7 s standalone; `loop-controller.test.ts` 63 s vs 13.7 s. In-test serial totals are the stable metric; loaded-host wall numbers are mostly load demotion in disguise.
2. **Case count is not the cost driver.** Consolidation's measured ceiling (midpoint 1.1 s, absolute 5.3 s = 3.8 %) closed that door. The suite's cost is concentrated in **subprocess work inside ~12 files**, not in how many cases exist.

## Method 1 — exclude research PoC fixtures from default discovery

**Finding:** all 16 test files under `docs/` belong to one tree — `docs/research/analytics-metrics/poc/` — and two of them carry 34.2 s of the 37.9 s total:

| file | in-test | cases |
| --- | --- | --- |
| `poc/fixture/generate-fixture.test.ts` | 18.5 s | 4 |
| `poc/fixture/sql-models.test.ts` | 15.7 s | 4 |
| 14 further poc files | ~3.7 s | 45 |

They are self-contained SQLite self-checks (imports: `bun:sqlite`, `node:*`, local poc modules — no `src/` imports), so they contribute nothing to the coverage ratchet's denominator or lcov. Bun's discovery is cwd-wide; these run on every full suite and every CI run only because their filenames contain `.test.`.

**Nuance that keeps the tree alive:** the poc is not dead code. `src/analytics/intent/{classifier,taxonomy}.ts` were ported from it, and `tests/analytics/intent/taxonomy.test.ts` imports `poc/intent/taxonomy.js` — a poc *source* module. That import bypasses test discovery, so excluding the poc's *test files* breaks nothing.

**Mechanics options:**

- **A. `bunfig.toml` `pathIgnorePatterns += "docs/**"`** — one line, but `bunfig.toml` sits on the story-refactor frozen list, so the edit belongs on master between qualifications, not on a qualification branch. Simplest and honest: docs are not product tests.
- **B. Rename the fixtures out of discovery** (e.g. `*.fixture-check.ts`) plus a `test:research` script running them via explicit paths (explicit `bun test ./path` runs any filename — the `.bench.ts` mechanism the benchmark already uses). No bunfig touch; slightly more moving parts.

**Verdict:** ~38 s serial (3.5 %) for a one-line-or-one-script change, near-zero risk. Worth doing first. (Amusingly, it saves ~7× consolidation's entire measured ceiling.)

## Method 2 — accelerate the real-git fixture recipe

**Finding:** 12 test files build real git repositories (`git init` + 2× `git config` + `add` + `commit` per test — the `setupPrimary` recipe, `tests/review-loop/worker-pool.test.ts:21`), totalling **250 s in-test = 23.2 %** of the serial suite. `GIT_TRACE2` measurement of the two heaviest:

| file | wall standalone | git process starts | git process time (Σ `t_abs`) | share |
| --- | --- | --- | --- | --- |
| `worker-pool.test.ts` | 8.7 s | 312 (≈28/test) | 6.0 s | **69 %** |
| `loop-controller.test.ts` | 13.7 s | 407 | 9.1 s | **67 %** |

Recipe timing experiment (30 samples each, quiet host):

| recipe | median | notes |
| --- | --- | --- |
| A: today's (init + 2×config + add + commit) | **246 ms** | 5 spawns, `commit` dominates (fsync) |
| B: build template once, `cpSync` (APFS clonefile) per test | **0.8 ms** | 300×; a fresh repo with history and identity |
| C: A with inline `-c user.email=…` identity | 223 ms | spawn-trimming is *not* the win; the copy is |
| `git worktree add` | 31 ms | stays real (worktree metadata holds absolute paths; a copied worktree is broken) |

Additional free wins visible in the trace: `git maintenance`/auto-gc fired 39–44× *per file* — `gc.auto=0` (set once in the template) deletes those runs; `commit` cost can drop further with `--no-gpg-sign` / fsync relaxation, though the copy alone removes most commits from the fixture path.

**Design sketch (for a future change):** a `tests/review-loop/git-fixture.ts` helper — build the template repo once per worker (the `setupTestDb` snapshot pattern applied to git), clone-copy per test, `gc.auto=0` baked in. Tests keep asserting on real repos; only the *construction* becomes a copy. No production code changes; per-file adoption like the consolidation pilot.

**Extrapolated savings:** git subprocesses ≈ 2/3 of the 250 s ≈ 165 s; the fixture-init share (init/config/add/commit are 4 of the top-5 command counts in both traced files) is roughly 40–50 % of that → **~60–90 s serial (6–8 %)**, concentrated in the longest files, so the parallel critical path improves proportionally more.

**Verdict:** the highest-leverage *safe* change. Same shape as the proven `setupTestDb` 190× snapshot trick; no seams moved, no assertions weakened, per-file evidence-gated rollout possible.

## Method 3 — fake-at-the-seam tiering for git

**Finding — seam inventory:**

| area | seam status |
| --- | --- |
| `opencode-agent` | typed `Git` interface already exists (`opencode-agent/src/git.ts`, `createGit(): Git`); 3 test files construct real ones today — fake injection is incremental |
| `sdd-runner` | already injects a fake `SpawnFn` (its 134 s is *not* subprocess cost — logic/fixture-heavy, different problem) |
| `review-loop` | **no seam** — `execGit`/`runGit` called directly throughout `review-loop/src/worktree.ts`; faking means introducing a GitDeps interface across the workspace plus a fake that models merge/rebase/conflict semantics |

**The structural problem:** in much of review-loop, **git is the subject, not the ambience.** `worktree.test.ts` and the merge/rebase tests in `worker-pool.test.ts` assert real-git behavior (conflict file lists, rebase-abort cleanliness) — a fake deletes the thing under test. Faking only pays where git is ambience (`loop-controller`, `issue-processor`, `cli`), and those files assert through real repo state often enough that per-file eligibility review returns — the same judgment tax that capped consolidation.

**Verdict:** dominated by Method 2 for the next move. Method 2 keeps git real everywhere and takes ~half the same 165 s; the fake seam's marginal gain over that is small in review-loop and already available opportunistically in `opencode-agent` (where the interface exists — extend fake usage file-by-file when tests are touched anyway). A workspace-wide review-loop fake is an architecture change whose payoff does not survive the eligibility filter.

## Ranked summary

| method | serial savings | cost/risk | verdict |
| --- | --- | --- | --- |
| 2. git-fixture template + clone | ~60–90 s (6–8 %) | low — new test helper, no src changes | **do** |
| 1. research-poc exclusion | ~38 s (3.5 %) | trivial — one bunfig line or rename+script | **do first** |
| 4. split mega-files (anti-consolidation) | ~40–60 s *parallel wall* only | medium — hurts serial (more workers) | only if parallel wall matters later |
| 3. fake-git seam | marginal beyond method 2 | high in review-loop (no seam, subject-not-ambience) | decline as a campaign; opportunistic in `opencode-agent` |
| consolidation | ≤5.3 s (0.8–3.8 %) | measured, done | closed for speed |

Methods 1 and 2 together: **~100–130 s of 1 077 s (~10 %) serial**, touching no production code, no gates, no coverage floor.

## Non-starters (previously adjudicated or disproven)

- `--retry` on flakes — masks real flakes; repo stance is no-retry.
- Lowering the coverage floor or deleting tests — quality gates, non-goals.
- CI sharding — CI serial runs aren't the pain point; the loaded shared host is, and that is already handled by the `lighter-unit-tests-under-load` demotion.
- Chunked batching wrapper — declined in `lighter-unit-tests-under-load` (bun test has no `--jobs`); revisit only if file-splitting proves insufficient.

## What each future proposal would need

- **Method 1:** decide bunfig-vs-rename (the bunfig frozen-list sequencing note above), keep a runnable path for the poc self-checks, cite the 37.9 s measurement.
- **Method 2:** the fixture helper design, a pilot file (`worker-pool.test.ts` — biggest git share), before/after in-test numbers from `last-run.junit.xml`, per-file rollout.
- Baseline artifacts for reproduction: `reports/test/last-run.junit.xml`, `reports/test-audit/{benchmark,projection,fragmentation}.json` from change `test-consolidation-speed-evidence`.
