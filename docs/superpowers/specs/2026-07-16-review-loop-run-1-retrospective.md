<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-Loop — Run 1 Retrospective (Spec-Design Source)

> **Purpose:** Input for the next review-loop improvement iteration. Captures the per-commit
> evaluation of the first real review-loop run, the behavioral patterns observed, and a
> prioritized list of workflow/control changes to turn into a spec + plan.

- **Commit range analyzed:** `be851a71c..ad1c7036683058f18d145d9db09b23d7bf3bc315`
  (35 fix commits + 1 merge, all `review-loop/` self-review)
- **Run:** `2026-07-15T20-35-51-854Z` — 10 rounds, 50 ledger issues, terminated on `max_rounds`
- **Outcome:** 26 closed / 9 rejected / 5 already-fixed / 8 needs_human
- **Wall clock:** ~7h (`02:10` → `09:01` local)
- **Plan reviewed against:** `docs/superpowers/plans/2026-07-15-review-loop-simplification.md`

---

## TL;DR

A _strong_ first run. ~22 of 35 commits are genuine correctness / data-integrity fixes — several
prevent silent commit corruption or lost work. The verifier correctly rejected a false positive by
applying the proposed fix, watching lint fail, and reverting with full reasoning (exactly right).

Weaknesses to address in the next iteration:

1. A cluster of low-value **"plan-conformance" nits** consume fix rounds.
2. **One no-op fix** (`e1b40ad35` — missing `continue` with no behavioral effect).
3. **Two false-premise fixes** (`ac1b51d4a`, `e1b40ad35`) — asserted impact without verifying.
4. Fixes sometimes **introduce secondary bugs** caught only by later rounds (self-correction works,
   but burns rounds).
5. **One incomplete fix** (`fa778fcef` — `reset --hard` without `clean -fd`).

---

## Per-commit assessment

### Tier 1 — High-value correctness / data-integrity (keep, all correct)

| Commit      | Fix                                                 | Notes                                                                                                                                                                     |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a94604882` | restore `--auto` flag on `opencode run`             | **Critical** — without it agents can't write files in prod. Real blocker.                                                                                                 |
| `74fe5682f` | per-run worktree path (`worktrees/<runId>`)         | Fixes stale-branch merge crash + enables concurrency.                                                                                                                     |
| `3c7e91fc3` | build-checker reports real exit code (not always 1) | Correct.                                                                                                                                                                  |
| `e236b56ce` | signal-killed process ≠ exit 0                      | Real bug; `code ?? 0` treated SIGKILL as success.                                                                                                                         |
| `9f25036da` | save ledger after _each_ issue                      | Genuinely crash-resilient (the tool's stated contract).                                                                                                                   |
| `fa778fcef` | `reset --hard` on non-fix verdicts                  | **⚠ incomplete** — no `git clean -fd`, so untracked fixer scratch files still leak into the next `git add -A` (the issue even suggested it). Retry path has the same gap. |
| `9605c2247` | auto-commit uncommitted fixer changes               | Good, but its `headSha !== baselineSha` guard later caused a drop bug → see `1325092ef`.                                                                                  |
| `cd9332be2` | validate retry verdict (not build-pass alone)       | Correct + good test.                                                                                                                                                      |
| `3c6564b55` | subprocess timeouts (agent + build)                 | Comprehensive, well-tested. Minor: SIGTERM with no SIGKILL escalation.                                                                                                    |
| `ebbad5efd` | `planPath` absolute resolve                         | Real bug for relative paths under worktree cwd.                                                                                                                           |
| `a92f29e61` | `checkCommand` in fix prompt (was hardcoded)        | Correct.                                                                                                                                                                  |
| `c9cd520ce` | UUID suffix on `runId`                              | Prevents collision on rapid runs.                                                                                                                                         |
| `d610cbc39` | `realSpawn` preserves spawn-error details           | Correct.                                                                                                                                                                  |
| `473887d6a` | honor `repoRoot` from config                        | Correct (config contract).                                                                                                                                                |
| `869a13d32` | final build gate before merge                       | Correct (partly refactored by later rounds).                                                                                                                              |
| `222614f2d` | resume: detect dirty worktree + `--reset-worktree`  | Good defensive recovery.                                                                                                                                                  |
| `8873cb99f` | keep `targetFiles` on needs_human-after-retry       | Correct.                                                                                                                                                                  |
| `2877f4a23` | `checkCommand` in retry prompt                      | Correct (parity with fix path).                                                                                                                                           |
| `018068132` | matcher sees terminal records (no dup ledger rows)  | Correct, prevents unbounded ledger growth.                                                                                                                                |
| `bdcefb08e` | skip matcher LLM call on 0 new issues               | Saves a wasted call per converging round.                                                                                                                                 |
| `f16d81708` | summary counts open/non-terminal statuses           | Was hiding unresolved issues on `max_rounds`.                                                                                                                             |
| `3e6597e39` | write `summary.txt` _after_ final build             | Ordering fix — no longer lies "clean" when merge is skipped.                                                                                                              |

### Tier 2 — Hygiene (correct, low impact)

| Commit      | Fix                                                 | Notes                                                                                                                                                                                                |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1325092ef` | remove `ensureFixerChangesCommitted` baseline-guard | Fixes the drop-bug `9605c2247` introduced; `status.length===0` already guards empty commits.                                                                                                         |
| `c541c3151` | store `VerifierDecision`, not full `FixerResult`    | Right shape; near-zero runtime impact (Zod strips extras on load).                                                                                                                                   |
| `5045dc28e` | drop dead `cwd`/`command` from `BuildCheckDeps`     | Clean.                                                                                                                                                                                               |
| `bea9517b5` | drop dead `ProgressLog` interface                   | Clean.                                                                                                                                                                                               |
| `ac1b51d4a` | `unlink` agent JSON after copy                      | **False premise**: `.review-loop/` is already gitignored at repo root (`.gitignore:61`, inherited by worktrees), so `git add -A` can't commit it. Harmless hygiene; reviewer didn't check gitignore. |

### Tier 3 — Plan-conformance nits (low value)

| Commit      | Fix                                     | Notes                                                                                                                                        |
| ----------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `271d767cf` | add `repoRoot` to `config.example.json` | Trivial; `repoRoot` is legitimately optional.                                                                                                |
| `ed350c953` | test for sync `worktreeExists`          | Test-only; the divergence was harmless.                                                                                                      |
| `a44ea54cb` | **edit the plan/spec** to match code    | Defensible (the code _is_ better than the plan), but the fixer resolved a "divergence" issue by rewriting the source-of-truth doc — a smell. |

### Tier 4 — Unnecessary

| Commit      | Fix                                     | Notes                                                                                                                                                                                               |
| ----------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e1b40ad35` | add `continue` to `--resume-run` branch | **No-op.** With or without `continue`, the manual `index += 1` + for-header increment both advance past the value identically; no later branch matched `--resume-run`. Style-only, framed as a bug. |

### Out-of-scope but legitimate enablers

| Commit      | Fix                                                     | Notes                                                                                                                                    |
| ----------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `d58b09ceb` | re-apply 15s test timeout via CLI in `scripts/check.sh` | Papai build-infra, not review-loop logic — unblocked the loop's own flaky `check:full`. Good (didn't get stuck on a pre-existing flake). |
| `3434fb48b` | stabilize `warnIfLegacyDebugToken` mock                 | Same — papai test flake fix.                                                                                                             |

---

## Notable deep-dives

### The recursion-vs-forloop issue was correctly REJECTED

`result.json` shows the verifier was asked to convert `processNextIssue` recursion into a `for…of
await`. It applied the fix, saw `eslint(no-await-in-loop)` fail, reverted, and returned `invalid`
with reasoning citing the project rule + the crash-resilience test that mandates per-issue
persistence. **This is the single best signal from the run** — the fixer is principled and
context-aware, not a yes-machine. This behavior should be made the _explicit standard_.

### Self-correction churn (feature, not bug — but it costs rounds)

- `9605c2247` added a baseline-guard → `1325092ef` removed it (it dropped retry changes).
- `cd9332be2` pushed `cwd`/`command` into `runBuildCheck` calls → `5045dc28e` removed them as dead code.

The multi-round design catches these regressions, but each fix rarely surveyed _all_ call sites of
the helper it touched.

### False-premise / over-eager fixes

`ac1b51d4a` and `e1b40ad35` — the reviewer asserted impact without verifying (gitignore status,
actual control flow).

---

## Overall feedback for future runs

1. **Signal quality is high.** ~22/35 are real bugs including subtle data-integrity issues a human
   review would also want. The plan-vs-code framing pays off for correctness, not just style.
2. **The verifier is the strongest link.** Its apply→lint→revert→reject behavior should be made the
   _explicit standard_, not left to chance.
3. **Plan-conformance is a noisy second axis.** ~4 commits and several rounds were consumed on
   `repoRoot`-in-example, sync-vs-async test signatures, and editing the plan to match code.
4. **Convergence is weak.** The run hit `max_rounds` partly on nits/duplicates; 10 rounds over 7h is
   expensive for the residual value of the last few rounds.
5. **Commit hygiene is excellent** — descriptive bodies, titles mirror issue titles (good
   `ledger ↔ commit` traceability), tests co-located.

---

## Suggested changes for the next spec/plan (prioritized)

### A. Reviewer / triage

1. **Split issue categories** — tag each issue `bug` / `plan-divergence` / `style`. Gate
   `plan-divergence` and `style` behind a higher bar (or a separate low-priority pass) so they stop
   consuming fix rounds.
2. **Require "verified impact"** — before raising an issue, the reviewer must check the relevant
   guard (e.g. `.gitignore` for "will be committed by `git add -A`"; a control-flow trace for
   "missing `continue`"). Cuts `ac1b51d4a` / `e1b40ad35`-class noise.
3. **Severity-gated early stop** — terminate when remaining open issues are all `low` /
   plan-conformance _and_ the last ≥2 rounds produced only such issues.

### B. Fixer

4. **"All call sites" rule** — when editing a shared helper (`ensureFixerChangesCommitted`,
   `runBuildCheck` shape), require the fixer to enumerate call sites in its reasoning; reduces the
   `9605c2247` → `1325092ef` churn.
5. **Pair every `reset --hard` with `clean -fd`** (revert-on-non-fix + retry-failure paths) — closes
   the `fa778fcef` incompleteness.
6. **Make plan/spec edits a distinct verdict** (e.g. `plan_drift`) requiring human-visible rationale,
   never a silent `fix(review-loop)` commit — prevents the source-of-truth from drifting to match
   code (`a44ea54cb`).

### C. Loop control / cost

7. **Bound the matcher context** to non-terminal + recently-seen records as the ledger grows
   (prompt-size + cost); `018068132` already fixed correctness, now bound size.
8. **Skip the reviewer re-run** when the prior round made zero progress _and_ no code changed.
9. **Emit `needs_human.md`** per unresolved issue (targetFiles + reasoning) for fast human triage —
   the 8 needs_human cases are currently buried in `ledger.json`.

### D. Hardening (minor)

10. **SIGKILL escalation** after a grace period on timeout (a stubborn child won't hang the loop).
11. **Rename/re-split `progress-log.test.ts`** (it's really a loop-controller integration suite) so
    future reviewers cite the right file.

---

## Suggested spec scope for the next iteration

Items **1, 2, 3** (reviewer triage + early stop), **5** (`clean -fd`), and **6** (`plan_drift`
verdict) are the highest leverage and map cleanly onto prompt + control-flow changes in
`review-loop/src/prompt-templates.ts` and `review-loop/src/loop-controller.ts`. Items **4** and **7**
are prompt-discipline changes. Items **8–11** are smaller follow-ups.
