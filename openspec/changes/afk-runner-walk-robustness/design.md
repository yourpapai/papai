<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner-walk-robustness

## Context

- F-P3 seam: `afk-runner/src/work/implement.ts:117-124` — `readFile(tasksPath)`
  wrapped as `throw new Error(...)`; the C6 taxonomy (`work/stage-halt.ts`,
  declared in `errors.ts`) names missing-structure preconditions, and
  `runAtomicity` (`atomicity.ts:64-77`) already demonstrates the exact shape:
  `StageHaltError(message, 'resume after decomposition', 'precondition')`. The
  drive bracket catch (`drive/loop.ts`) records `stage_failed{kind}` and
  `failure-budget.ts` escalates `precondition` immediately.
- F-U3 seam: `afk-runner/src/work/run-check.ts:22-29` — `bunRunCheck` calls
  `Bun.spawnSync` with `stdout/stderr: 'pipe'` and no `timeout`; consumers are
  the per-task affected check (`implement.ts` `runAffectedCheck`) and the
  verify boundary's `VERIFY_CHECKS` runs (`work/verify.ts`). C9 live
  evidence: a runner-spawned verify suite hung 6+ hours with an idle child;
  recovery was kill+resume. The agent-spawn side caps wall at 30 minutes —
  that cap does not reach this seam.
- F-P4 seam: `.claude/hooks/pre-bash.mjs` registers exactly two git checks —
  `.hooks/git/checks/block-git-stash.mjs` (`/\bgit\s+stash\b/`) and
  `block-git-checkout-discard.mjs`; textual matching (observed live twice
  this cycle: probe commands merely *quoting* the blocked string were
  refused). C9 live evidence: an implementer reset the branch to baseline,
  created `agent/issue-42`, and deleted the change folder — recovered via
  reflog + `restore --source` (two operator steps). The write guard
  (`write-guard.ts`) checks file writes, never history.
- The runner's own git use (`work/slice-commit.ts` `commitTaskSlice`,
  `run-stop.ts`) bypasses the bash hook by construction (direct `execGit`,
  not a spawned bash command) — unaffected by the widening.

## Goals / Non-Goals

**Goals:** all three seams guarded; tests pin each guard red-first; no
semantic change to routing, budgets, settles, or the walk's green-per-item
check.

**Non-Goals:** as in proposal (EXEC_GIT exit codes, containment, lint, new
failure kinds, runner-side git gating).

## Decisions

**D1 — F-P3: mirror the atomicity shape exactly.** Same message prefix
convention (`implement cannot read <path>: <cause>`), resume hint
`'resume after the change folder is restored'`, kind `'precondition'`. The
catch wraps *any* read failure of tasks.md as a precondition (missing or
unreadable both mean the walk cannot pick its next item — a structural gap,
not a code bug). Alternative considered: only ENOENT → precondition,
other errors stay crash-shaped — rejected: the taxonomy's class is
"structural gaps like a missing tasks.md" and an unreadable file strands the
walk identically.

**D2 — F-U3: cap at the seam, not at callers.** `bunRunCheck` passes
`timeout: EXEC_CHECK_WALL_CAP_MS` (compiled constant, `run-check.ts`, 30
minutes = the spawn-side precedent; the repo's own full suite is ~3–4 min on
CI and the cap must never fire on a legitimate check) to `Bun.spawnSync`; on
timeout the result is non-zero exit with a one-line stderr marker
`check exceeded wall cap (1800000 ms)` so the fix context (verify tail /
task-failed detail) names the cause. Red routing stays exit-code-driven —
a timed-out check is red, honestly. Alternative considered: a bespoke
`CheckResult.timeout` flag consulted by callers — rejected, two call sites
would grow flag-handling for information the marker already carries.

**D3 — F-P4: blunt textual siblings, one per verb, listing flags excepted
where cheap.** New checks in `.hooks/git/checks/`, registered in
`pre-bash.mjs`, matching the house style (word-boundary regex over the
command string): `git reset` (all forms — history moves), `git rm`,
`git switch` (all — it exists only to move), `git checkout` beyond the
already-blocked discard (branch/ref moves join it; the discard check's scope
is subsumed but stays), and `git branch` **creation forms only** —
`git branch` followed by a non-flag token is creation (blocked); forms
starting with a flag (`-a`, `-v`, `--list`, `-d`, `-D`, `-m`, …) stay allowed
so read-only listing and branch deletion survive (deletion of a wrong branch
is recoverable and sometimes the fix). Trade-off recorded: blunt matching
false-positives on commands that merely quote the verbs (observed twice this
cycle) — accepted, the house pattern, and operators rephrase.

**D4 — TDD order and lanes.** `afk-runner/src/**` edits (F-P3, F-U3) are
write-hook governed: red-first in `tests/afk-runner/work/implement.test.ts`
(a stubbed seam asserting `StageHaltError` with kind `precondition`) and
`run-check.test.ts` (a stubbed spawn asserting the timeout flag is passed /
the marker emitted — the spawn is faked at the `RunCheckFn` boundary; the
production wrapper's timeout behavior is asserted through Bun's own
`spawnSync` contract with a short-cap double). `.hooks/**` edits (F-P4) are
not hook-governed: red-first in `tests/opencode-tdd-enforcement.test.ts`
following its existing mock-and-ctx pattern (blocked/refused shapes per new
check, allowed listing shapes).

**D5 — Sizing the cap is a design constant, not config.** No new
`RunnerConfig` key: the five-key surface stays closed (the launch-config
change's contract); a hung check is never legitimate, so the cap needs no
operator tuning. If a future target repo legitimately exceeds 30-minute
checks, the constant moves with evidence — recorded as the wake trigger.
