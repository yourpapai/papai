<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation-Improve Runner — Autonomous Workflow Automation

**Date:** 2026-08-05
**Status:** Design — approved (pending implementation plan)
**Type:** New tooling workspace (test-only + tooling; no papai runtime changes)

## Summary

The `mutation-improve-01..07` branches each followed an identical, stable
procedure to lift one file's mutation score: select a high-ROI file from
`scripts/mutation/baseline.json`, write a design spec, write an implementation
plan, capture the "before" score, add exact-equality characterization tests
task-by-task, verify ≥ 0.95, ratchet the baseline, document equivalent
residuals, and open a PR. Each branch was driven manually by an AI agent.

This spec designs a **single fully-autonomous runner** that automates that
procedure end-to-end, reusing the `review-loop/` workspace's harness primitives
(worktree isolation, `opencode run --auto` agent spawning with file-based JSON
exchange, run-state, config, build-checker, live rendering, trace logging) but
**not** its review/match/fix issue loop. The runner uses **one agent/model** for
two phased invocations per file (select, then improve); it does **not** need the
reviewer/matcher/fixer/inspector roles that review-loop orchestrates.

The runner preserves review-loop's core integrity contract — **the runner
measures, the agent creates** — by owning every score measurement, the baseline
bump, the diff-scope guard, the build gate, the merge, and the summary PR. The
agent cannot fake a score or game the baseline.

## Why this shape

- **Fully autonomous** (chosen) — the procedure is stable; operator kicks off
  `bun run mutation-improve:start -- --count 3` and gets a summary PR. Mirrors
  how `review-loop` runs unattended.
- **Sibling workspace** (chosen) — a new `mutation-improve/` Bun workspace
  mirrors `review-loop/`'s layout and imports the few reusable primitives from
  `../review-loop/src/` via path imports. Clean separation; gets its own TDD
  gate mapped to `tests/mutation-improve/`.
- **Agent selects the file** (chosen) — rather than encoding fragile
  selection heuristics in TypeScript, the select-phase agent reads
  `baseline.json` and applies the same ROI judgment the human branches did
  (reject declarative tables, `Math.random` jitter, passthrough wrappers,
  schemas already at ~1.0). `--count N` runs the pipeline on N files in
  sequence.
- **Local sequential merge + one summary PR** (chosen) — each iteration
  merges into `base` in-sequence (review-loop's `mergeWorktree`), so iteration
  `i+1`'s worktree sees iteration `i`'s baseline bump. After all iterations,
  one GitHub PR covers the batch. Avoids per-iteration PR conflicts entirely.

## Non-goals

- No changes to papai runtime code under `src/`, `client/`, or `plugins/`.
- No new mutation-testing infrastructure — reuses `scripts/mutation/`'s paired
  runner (`bun test:mutate:file`) and `baseline.json` as-is.
- No parallelism — a single linear pipeline (no worker pool). review-loop's
  `worker-pool.ts` exists only to fix issues concurrently, which this runner
  does not do.
- No re-implementation of review-loop's loop. The `loop-controller`,
  `issue-ledger`, `issue-matcher`, `issue-processor*`, `issue-schema`,
  `issue-inspector`, `commit-attempt`, and `summary-burndown` modules are
  explicitly **not** reused.
- No automatic inflation of `--count` or speculative retries beyond
  `runAgent`'s built-in once-retry.

## Workspace layout & reuse

A new sibling Bun workspace `mutation-improve/`, mirroring `review-loop/`'s
layout:

```
mutation-improve/
  package.json          # name: "mutation-improve", private, type: module; deps: zod
  tsconfig.json         # extends repo TS config, includes src
  config.example.json   # documented config shape
  src/
    cli.ts              # arg parsing, orchestrates the run
    config.ts           # Zod schema + loader (mirrors review-loop/config.ts)
    run-state.ts        # per-run + per-iteration persisted state
    selection-schema.ts # Zod schema for selection.json (agent → runner)
    result-schema.ts    # Zod schema for result.json (agent → runner)
    score-reader.ts     # parses reports/paired/*.json → per-file score
    baseline.ts         # reads/writes scripts/mutation/baseline.json
    diff-guard.ts       # git diff --name-only scope check
    pipeline.ts         # the per-file select→improve→verify→ratchet→merge machine
    prompt-templates.ts # select + improve prompts (the workflow procedure)
    finalize.ts         # open summary gh PR after N iterations
tests/mutation-improve/ # TDD gate maps here (per repo convention)
```

**Reused from `../review-loop/src/` via path imports** (harness primitives,
unchanged):

- `agent-runner.ts` → `runAgent`, `agentWritePath`, `SpawnFn`, `AgentRunError`
- `spawn.ts` → `realSpawn`
- `build-checker.ts` → `createShellExec`, `runBuildCheck`
- `worktree.ts` → `createWorktree` / `mergeWorktree` / `removeWorktree` /
  `resetWorktree` / `detectGitRoot` / `cleanWorkerWorktrees`
- `line-handler.ts`, `progress-log.ts`, `live-renderer.ts`, `trace-log.ts` →
  reused verbatim for live progress and `trace.jsonl`.

**One backward-compatible change to a shared file:** `worktree.ts` hardcodes
the branch prefix as `review-loop/${runId}` inside `createWorktree` and
`removeWorktree`. The reuse strategy parametrizes this with a `branchPrefix`
argument (default `"review-loop"` so review-loop's own calls are unchanged);
the new caller passes `"mutation-improve"`. This avoids duplicating ~180 lines
of git plumbing and keeps a single source of truth for merge/conflict
recovery.

## Per-file pipeline (the state machine)

For each of `--count N` iterations, the runner drives this linear state
machine. The runner owns measurement and integrity; the agent owns judgment and
creation. Both invocations use the **same** agent/model.

```
ITERATION i  (i = 1..N)

  runner: createWorktree(base)   ← worktree off the configured base branch;
                                    after iteration 1 merges, iteration 2's
                                    worktree is created from the updated base,
                                    so it sees iteration 1's baseline bump.

  ① SELECT  (agent invocation #1)
     prompt: read baseline.json, pick best-ROI file NOT in the done-set,
             applying the rejection rules (declarative/schema tables already
             ≥ 0.9, Math.random jitter, 1-passthrough wrappers, files whose
             companion test cannot exercise behaviour).
     agent writes: <runDir>/iter/i/selection.json
        { file, beforeScore, rationale, runnerUps: [{file, score, why}] }
     runner validates: file exists, is in baseline.json, is not in the
                       done-set, beforeScore ≈ baseline.json[file] (sanity).
     → doneSet.add(file)

  ② CAPTURE BEFORE  (runner, optional sanity)
     run `bun test:mutate:file <file>` in the worktree
     parse reports/paired/<file>.json → beforeScore
     if beforeScore ≥ threshold: nothing to improve, skip iteration

  ③ IMPROVE  (agent invocation #2)
     prompt: write spec → docs/superpowers/specs/<date>-mutation-coverage-
             <stem>-design.md; write plan → docs/superpowers/plans/<date>-
             mutation-coverage-<stem>.md; add exact-equality tests to the
             companion test file (extend existing describe); MUST NOT edit
             src/; MUST NOT edit baseline.json; target ≥ threshold; document
             equivalent residuals.
     agent writes: <runDir>/iter/i/result.json
        { specPath, planPath, testPaths: [...],
          residuals: [{ loc, why }], notes }

  ④a DIFF-GUARD  (runner, hard gate)
     git diff --name-only in the worktree
     allowed scope: { tests/**, docs/superpowers/** }
     (baseline.json is NOT yet touched — the runner owns it; see ⑥)
     FAIL iteration if any src/ or out-of-scope file changed.

  ④b BUILD GREEN  (runner, hard gate)
     run `bun check:full` in the worktree via review-loop's runBuildCheck
     (typecheck + lint + format). The runner measures; it does not trust the
     agent to have run it.
     FAIL iteration → write build-check.log.

  ⑤ VERIFY  (runner, hard gate — the integrity hinge)
     run `bun test:mutate:file <file>` in the worktree (the runner measures;
     it does NOT trust the agent's reported score).
     parse → afterScore
     PASS if: afterScore ≥ threshold
          OR (afterScore ≥ threshold − epsilon
              AND result.json.residuals justifies the gap with
              equivalent-mutant reasoning)
     FAIL → resetWorktree, record failure to iter/i/failure.json,
            DO NOT merge, DO NOT ratchet, continue to iteration i+1.

  ⑥ RATCHET  (runner, owns baseline.json)
     scripts/mutation/baseline.json[file] = afterScore
        (the runner's measured score, not the agent's)
     git add + commit:
        "chore(mutation): ratchet <file> baseline to <score>"

  ⑦ MERGE  (runner)
     mergeWorktree(base, mutation-improve/<runId>-iter<i>) → base
     on conflict: abort merge, record, DO NOT continue chaining
     (review-loop pattern). Run ends with recovery instructions.

  ⑧ removeWorktree; loop to iteration i+1.

After iteration N (or on terminal merge-conflict failure):

  ⑨ FINALIZE  — if ≥ 1 iteration merged:
     push base; open ONE summary gh PR covering all merged file commits.
```

### Integrity properties

- **⑤ measures independently of ③** — the agent never reports its own score;
  the runner re-runs Stryker and reads the JSON report. A misbehaving agent
  cannot ratchet the baseline wrong.
- **⑥ baseline bump is runner-owned** — the agent is forbidden from editing
  `baseline.json` (enforced by ④a's diff-guard before ⑥ ever runs), so the
  recorded floor always equals the runner's measured score.
- **④b build gate is runner-run** — consistent with review-loop's
  `finalizeRun` running `runBuildCheck` itself rather than trusting the agent.

## Agent ↔ runner contracts

The two file-based handshakes are the only coupling between agent and runner.
Both are Zod-validated on read (mirrors review-loop's `ReviewerIssuesSchema`
consumption).

### `selection.json` (select-phase output)

```ts
{
  file: string            // repo-relative, e.g. "src/live-status/tool-status-labels.ts"
  beforeScore: number     // agent's read of baseline.json[file]; sanity-checked
                          //   ≈ runner's own read of baseline.json
  rationale: string       // 1-3 sentences: why this file (pure, headroom,
                          //   existing companion test, killable mutants)
  runnerUps: [            // 2-3 rejected candidates; preserves the human
                          //   "selection table" artifact
    { file: string, score: number, why: string }
  ]
}
```

### `result.json` (improve-phase output)

```ts
{
  specPath: string        // docs/superpowers/specs/<date>-mutation-coverage-<stem>-design.md
  planPath: string        // docs/superpowers/plans/<date>-mutation-coverage-<stem>.md
  testPaths: string[]     // tests/… files the agent added/extended
  residuals: [            // equivalent mutants the agent accepts; consumed by
                          //   gate ⑤ as the below-threshold qualifier
    { loc: string, why: string }   // loc: "src/foo.ts L21 Array.isArray guard";
                                   // why: equivalent-mutant reasoning
  ]
  notes: string           // freeform surprises (e.g. "pre-existing bug in X")
}
```

The runner never acts on agent-reported **scores**: `beforeScore` is only a
sanity cross-check against the runner's `baseline.json` read (mismatch → warn,
proceed with the runner's value). `residuals` is the only agent-reported field
that influences a gate, and only as a qualifier on a *measured* below-threshold
score.

### Prompts (`prompt-templates.ts`)

- **`buildSelectPrompt(doneSet, baselineSummary)`** — instructs: read
  `scripts/mutation/baseline.json`; pick the highest-ROI file where
  ROI = reliable score gain per test effort; reject files matching the
  patterns the human branches rejected (declarative/schema tables already
  ≥ 0.9, pure `Math.random` jitter, single-statement passthrough wrappers,
  files whose companion test cannot exercise behaviour); exclude the
  done-set; write `selection.json` at the absolute scratch path provided.
  The rejection heuristics are enumerated in the prompt text, distilled from
  the seven branches' "Why this file" tables, so the agent applies the same
  judgment a human would.

- **`buildImprovePrompt(file, beforeScore, threshold)`** — instructs the agent
  to execute, verbatim, the procedure every branch followed:
  1. **Spec** → `docs/superpowers/specs/<date>-mutation-coverage-<stem>-design.md`
     using the section template (Summary / Why this file / Non-goals / Gap
     analysis (surviving mutant classes table) / Design — tests to add
     (one-to-one onto gap classes) / Verification / Accepted residuals). The
     agent MUST first run `bun test:mutate:file <file>` to enumerate the
     actual surviving mutants and ground the gap analysis in the real report,
     not speculation.
  2. **Plan** → `docs/superpowers/plans/<date>-mutation-coverage-<stem>.md`
     with task-per-mutant-class checkbox structure and global constraints
     (test-only; exact-`toBe`-equality discipline; no `src/` edits; SPDX
     license headers; emoji copied verbatim from source).
  3. **Tests** → extend the existing companion `describe` block; every
     assertion exact `toBe(...)`; one test per mutant class.
  4. **Residuals** → enumerate equivalent mutants that survive and cannot be
     killed, with per-loc reasoning → `result.json.residuals`.

  Hard constraints stated in the prompt: MUST NOT edit anything under `src/`
  (the runner's diff-guard rejects the iteration); MUST NOT edit
  `scripts/mutation/baseline.json` (runner-owned); MUST run
  `bun test tests/<companion>` green before finishing; write `result.json`.

Both prompts reuse review-loop's `runAgent` machinery (absolute scratch path
via `agentWritePath`, `--format json` usage streaming, retry-once-on-failure,
timeout → `AgentRunError`).

## Gates, failure modes & resume

Hard gates the runner enforces (all measured, none agent-reported). An
iteration **fails closed**: reset its worktree, record the failure to
`<runDir>/iter/i/failure.json`, do not merge, do not ratchet, then continue to
`i+1`. Only a merge conflict aborts the whole run (the base cannot be chained
past a broken state).

| # | Gate | What | On fail |
|---|---|---|---|
| ① | selection validates | `file` exists, in baseline.json, not in done-set, `beforeScore` ≈ baseline entry | skip iteration (re-run select once) |
| ④a | diff-scope | `git diff --name-only` ⊆ { `tests/**`, `docs/superpowers/**` } — `src/` and `baseline.json` untouched by agent | fail iteration |
| ④b | build green | runner runs `bun check:full` in worktree via `runBuildCheck` | fail iteration; write `build-check.log` |
| ⑤ | mutation score | runner-run `bun test:mutate:file <file>`: `afterScore ≥ threshold`, OR `≥ threshold − ε` with justified `result.json.residuals` | fail iteration |
| ⑦ | merge clean | `mergeWorktree` conflict-free (review-loop pattern; auto-aborts on conflict) | **abort run** with recovery instructions |

Defaults: `threshold = 0.95` (the target every historical branch used),
`epsilon = 0.02` (the residual-floor tolerance the branches effectively
allowed — e.g. tool-status-labels settled at 0.9714; some files plateau lower).
Both configurable.

**Agent-invocation failures** (non-zero exit, timeout, missing or malformed
JSON scratch file) flow through review-loop's existing `runAgent`
retry-once-then-`AgentRunError`. An `AgentRunError` in select fails the
iteration; in improve it fails the iteration (the worktree's tests/spec/plan
are discarded by reset). Agent usage (tokens/cost/wall) is tallied per
iteration into `trace.jsonl`.

**Resume (`--resume-run <runId>`)** mirrors review-loop: reload `state.json`,
skip already-merged iterations, continue from the first non-terminal
iteration. Persisted per-run state:

```ts
{
  runId: string,
  repoRoot: string,
  base: string,
  threshold: number,
  count: number,
  currentIteration: number,
  doneSet: string[],                          // files already improved (select exclusion)
  merged: [{ file, beforeScore, afterScore, iter }],   // → summary PR body
  failed: [{ iter, file, gate, reason }],              // → summary PR body + exit code
  status: 'running' | 'completed' | 'aborted'
}
```

**Finalize (⑨)** runs only if `merged.length > 0`: push `base` to
`<upstream>` (e.g. `git push origin <base>`), then
`gh pr create --base <base> --title "mutation-improve: <file1>, <file2>, …" --body <summary table>`
(`--base` takes the branch name, e.g. `master`; `<upstream>` is the remote
pushed to).
The summary body is auto-generated: one row per iteration
(`file | before → after | spec link | plan link | residuals count | ✓/✗`). If
`failed.length > 0` the PR body includes a "Failed iterations" section and the
process exits **1** (so CI/operator sees the partial failure), but successful
merges are still PR'd. `gh` absence or failure warns and writes the push plus
a ready-to-paste `gh` command to `<runDir>/finalize.log`; the merges already
happened locally, so nothing is lost.

## Config & CLI

`config.example.json` (mirrors review-loop's shape; loaded by `config.ts` via
Zod):

```jsonc
{
  "repoRoot": ".",
  "workDir": ".mutation-improve",
  "base": "master",
  "upstream": "origin",
  "count": 1,
  "threshold": 0.95,
  "epsilon": 0.02,
  "agentTimeoutMs": 1800000,
  "buildTimeoutMs": 600000,
  "checkCommand": "bun check:full",
  "mutateFileCommand": "bun test:mutate:file",
  "agent": {
    "model": "opencode/claude-sonnet-4-6",
    "extraArgs": [],
    "timeoutMs": 1800000
  },
  "prBranchPrefix": "mutation-improve"
}
```

CLI (`src/cli.ts`, mirrors review-loop's `parseCliArgs`):

```
bun run mutation-improve:start -- --config <path> [--count N] [--threshold T]
                                     [--base <branch>] [--resume-run <id>]
                                     [--reset-worktree] [--no-pr]
```

- `--count` / `--threshold` / `--base` override config (CLI wins).
- `--no-pr` skips finalize ⑨ (just merges locally; operator pushes manually) —
  useful for local dry-runs.
- `package.json` scripts (run from repo root, exactly like review-loop):
  `mutation-improve:test` (`bun test tests/mutation-improve`), `:typecheck`,
  `:lint`, `:format:check`, `:start` (`bun run mutation-improve/src/cli.ts`).

## Score reading

`score-reader.ts`: the paired runner writes `reports/paired/scores.json`
(aggregate) and `reports/paired/<escaped-file>.json` (per-file Stryker report).
The reader parses the per-file report's `mutationScore`; if the report is
missing or malformed it falls back to re-running
`bun test:mutate:file <file> --threshold=0` (never trusts a missing artifact).
This module is the single place that interprets Stryker output, so it is
heavily unit-tested against fixture reports.

## Testing strategy

`tests/mutation-improve/`, TDD-gated like `tests/review-loop/`.

The runner is a deterministic state machine around nondeterministic externals
(agent subprocess, git, Stryker). All externals are injected (`SpawnFn`,
`execGit`, `runBuildCheck`, the score-reader, `mergeWorktree`) so tests are
hermetic — no real `opencode` / `git` / Stryker in the suite, mirroring how
review-loop's tests inject `spawn`.

- `pipeline.test.ts` — the spine. Drives the state machine through: happy path
  (select → improve → verify pass → ratchet → merge); each gate failing
  (selection invalid, diff-scope violation, build red, score below threshold,
  score below with unjustified residuals, score below with *justified*
  residuals → passes); merge conflict aborts run; `--count 3` chains
  (iteration 2's worktree sees iteration 1's baseline bump via a merged
  doneSet and an updated `baseline.json` fixture); resume skips merged
  iterations.
- `selection-schema.test.ts` / `result-schema.test.ts` — `schemaValidates()`
  round-trips (reuse `tests/utils/test-helpers.ts`).
- `score-reader.test.ts` — parses real-shape Stryker JSON fixtures (one
  passing, one missing `mutationScore`, one malformed → triggers fallback
  re-run).
- `baseline.test.ts` — bump writes measured score, preserves all other
  entries, sorts keys for a stable diff.
- `diff-guard.test.ts` — allows `tests/` + `docs/superpowers/`, rejects `src/`
  and `baseline.json`.
- `config.test.ts` — defaults, CLI-override precedence, `--no-pr`.

## Risk & notes

- **Worktree branch-prefix parametrization** is the only change to a shared
  file (`review-loop/src/worktree.ts`). It is additive with a safe default;
  review-loop's existing calls are unchanged and its tests stay green.
- **The improve-phase prompt is large** (spec + plan + tests + residuals).
  review-loop's experience is that single-shot mega-prompts are less reliable
  than phased ones — which is exactly why this design splits select from
  improve. If improve proves unreliable in practice, the natural fallback
  (future work, not in scope) is to split it further into spec→plan→tests.
- **The `epsilon` residual-escape at ⑤** is the one place an agent-reported
  field (`result.json.residuals`) influences a gate. It is bounded
  (`threshold − ε`, not unbounded) and the residuals are auditable in the PR.
  The alternative — requiring `≥ threshold` unconditionally — would reject
  files with genuine equivalent-mutant floors (which the historical branches
  accepted, e.g. six equivalent residuals in tool-status-labels).
- **TDD write hooks** apply inside the worktree (it is a real checkout). The
  workflow is test-only (edits `tests/`), so the `src/` red-green gate does
  not fire; the runner's own diff-guard (④a) enforces test-only independently.
