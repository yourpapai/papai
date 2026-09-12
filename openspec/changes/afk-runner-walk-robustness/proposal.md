<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner-walk-robustness

## Why

C9's unguarded-seam findings (F-P3/F-P4/F-U3, dispositioned by the U13 audit
as one change — `afk-runner-u13-audit` design D4): three guards the fixtures
could not see, all live-witnessed on the armed cycles. F-P3: `implement.ts`'s
missing-tasks.md read-catch throws a plain `Error` (crash-shaped, refusal
alarm — the holder died) where the C6 taxonomy names the shape
`StageHaltError{precondition}` (immediate escalation). F-U3: `bunRunCheck`
(`run-check.ts`) runs `Bun.spawnSync` with no timeout — a hung suite check
hung Run U's walk for 6+ hours; the spawn-side 30-minute cap does not reach
this seam. F-P4: the agent git-verb blocklist (`.hooks/git/checks/`) blocks
`stash` and discard-checkout only — a C9 implementer ran `reset`, created a
branch, and deleted the change folder mid-walk (reflog-recoverable, but only
through operator surgery).

## What Changes

- F-P3: the tasks.md read-catch in `runImplementWork` throws
  `StageHaltError('implement cannot read …', 'resume after the change folder
  is restored', 'precondition')` — mirroring `runAtomicity`'s existing shape
  (`atomicity.ts:70-75`); the C6 bracket catch records
  `stage_failed{precondition}` and escalates immediately.
- F-U3: the production `RunCheckFn` gains a compiled wall cap (30 minutes,
  the spawn-side precedent) enforced at the spawn; a timed-out check reports
  non-zero exit with a stderr marker naming the cap, so red routing and fix
  context stay honest.
- F-P4: `.hooks/git/checks/` gains siblings blocking `git reset`, `git rm`,
  `git branch` creation forms, `git switch`, and `git checkout` beyond the
  already-blocked discard — history- and structure-mutating verbs join the
  blocklist; read-only listing flags stay allowed.

## Capabilities

### New Capabilities

- `agent-git-verb-guard`: the bash-hook blocklist contract for spawned-agent
  git verbs. Without it the guard that F-P4 proved too narrow is spec'd
  nowhere — the hook's own doc line is the only record of its shape.

### Modified Capabilities

- `afk-runner-execution`: the walk's structural-precondition halt and the
  check seam's wall cap join the execution contracts. Without the delta the
  spec's walk requirement says nothing about a missing tasks.md (the crash
  F-P3 recorded live) and the verify requirement's "run the gate set" carries
  no bound (the 6-hour hang F-U3 recorded live).

## Impact

- Code: `afk-runner/src/work/implement.ts` (read-catch), `afk-runner/src/work/
  run-check.ts` (cap), `.hooks/git/checks/*.mjs` + `.claude/hooks/pre-bash.mjs`
  (registry). Tests: `tests/afk-runner/work/implement.test.ts`,
  `run-check.test.ts`, `tests/opencode-tdd-enforcement.test.ts` (a different
  lane than the TDD-hook-governed `afk-runner/src/**` — flagged: the hook
  tests mock the check modules, no afk-runner write hooks apply).
- No platform/task instances, no DB, no scope-model state. Docs:
  `docs/architecture/afk-runner.md` (execution section),
  `docs/architecture/commands.md` (write-protections line).

## Non-goals

- Exit-code visibility for `EXEC_GIT` (F-P1's other half) — separate seam,
  still follow-up material.
- Red-work containment, decompose-exit lint (owned by
  `walk-item-green-decomposition`'s Non-goals with triggers).
- Any new failure kind, settle outcome, or budget semantics — C6/C4 stacks
  reused unchanged.
- Gating the *runner's* own git verbs (slice commits, report) — the hook
  governs agent bash commands only; the runner is the trusted party by
  design.
