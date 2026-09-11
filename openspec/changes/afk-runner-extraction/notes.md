<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Notes: afk-runner-extraction — the locked execution plan (D7)

The operator plan for the runner-executed extraction. Working notes
accumulate below; each phase's outcome lands here as it completes.

## Run order

| # | Vehicle | Task file | repoRoot | Gate |
|---|---------|-----------|----------|------|
| 1 | runner run (armed, L) | `task-phase-a.md` | papai @ `afk-runner-extract` branch | papai PR suite at merge |
| 2 | operator | design D2 filter-repo | scratch clone → `yourpapai/afk-runner` | task 2.2 checks in run 3 |
| 3 | runner run (armed, M) | `task-phase-c-setup.md` | the new repo | first CI run on its tip |
| 4 | operator | drain gate (task 4.1) | papai master checkout | confirmation recorded below |
| 5 | runner run (armed, M) | `task-phase-c-retire.md` | papai @ the extraction branch | papai PR suite at merge |

Task files live beside this note; the runner copies the given file into its
run dir and drafts its own change (`afk-runner-extract-a` etc. — all match
the D2 `afk-runner*` glob, so run 1's artifacts ride the split).

## Launch shape (runs 1, 3, 5)

```
# per-checkout, untracked by design (.afk-runner/ is git-ignored):
.afk-runner/config.json
{ "repoRoot": "<abs path of the target checkout>",
  "workDir": ".afk-runner",
  "model": "opencode",
  "budget": 10,
  "deadline": 240 }

bun run afk-runner:start -- start <task-file> --depth <L|M> --execute
```

Budget/deadline are the operator's knobs (the n=5 dogfood ran deadline 240;
calibrate after run 1's per-stage accounting). Attend parks with
`resume <runId>`; `stop <runId>` is the calm-stop channel.

## Phase B — the one operator command set (run 2)

```
git clone --no-local <papai> /tmp/afk-runner-split
cd /tmp/afk-runner-split
git filter-repo
  --path afk-runner/ --path tests/afk-runner/ --path sdd-runner/
  --path docs/architecture/afk-runner.md
  --path docs/architecture/afk-runner-mcp-research.md
  --path glob:openspec/changes/afk-runner* --path glob:openspec/changes/sdd-*
  --path openspec/changes/think-half-on-graph --path openspec/changes/gate-as-state
  --path openspec/changes/tail-on-graph --path openspec/changes/agent-failed-recovery
  --path openspec/changes/task
  --path glob:openspec/changes/archive/*afk* --path glob:openspec/changes/archive/*sdd*
  --path glob:openspec/specs/afk-runner-* --path glob:openspec/specs/sdd-*
  --path-rename afk-runner/:./ --path-rename tests/afk-runner/:tests/
git remote add origin git@github.com:yourpapai/afk-runner.git
git push -u origin HEAD
```

The repo `yourpapai/afk-runner` is created empty and private during prep
(done — see below). Papai is untouched by the split; rollback for B is
deleting the new repo.

## Working notes

- 2026-09-09 — prep: branch `afk-runner-extract` at master tip
  (a99e5a396, post-#432) + this change's D6/D7 refresh (b2f8d0cba); three
  task files + this runbook committed; `yourpapai/afk-runner` created
  private and empty. PR #432 merged as 84ebb2c26 — the severance tip is
  master; drain gate (4.1) not yet confirmed.
- 2026-09-10 — drain gate (task 4.1) confirmed: papai store roster all
  terminal (6 runs, none running, all worktree-pinned — exempt by D4); the
  new repo's single `afk-runner-extract-c-setup` run ends in a release
  approve. Run 3 merged into the new repo's master. Run 5 launched from
  `.worktrees/afk-runner-retire` (branch `afk-runner-retire` off
  origin/master 3633da06b).
- 2026-09-11 — run 5 (`afk-runner-extract-c-retire`) parked at escalation
  gate v4 with implementation effectively done; milestones and findings:
  tasks 1–5 committed clean (1.1 resolver mirror, 2.1 deletion + workspace/
  scripts/gitignore, 3.1 baseline purge, 3.2 mutation README, 3.3 knip).
  Tasks 6/7 (4.1 pointer docs, 4.2 command stubs) failed on the
  `test:affected` verify leg, not on their own grep gates — those pass in
  the worktree — but each attempt died on a *different* real-git
  integration test timing out at 15 s (`tests/mutation-improve/integration-git.test.ts`,
  `tests/opencode-agent/git.test.ts`, `tests/opencode-agent/shell.test.ts`);
  re-run file-by-file after the halt, 23/23 green → load flakes under the
  runner's own concurrent load, not regressions. 4 declared failures >
  budget 1 → escalation. Side issue: 3.1's commit shipped a lint red
  (`baseline.test.ts` inlined `?? {}` in a test body —
  no-conditional-in-test); fixed in the worktree by hoisting
  `committedBaselineKeys()` next to the existing `committedBaseline()`
  convention; lint + format + 47/47 file tests green, uncommitted.
  Gate mechanics — final correction after gate-6 (both earlier theories
  wrong; root cause read from the twin source preserved in git history at
  `820f251ac~1:afk-runner/src/work/{implement,tasks-md}.ts`): the walk
  picks `firstOwedItem` — the first **unchecked tasks.md box**, re-parsed
  live every bracket — and a picked item at `attempts >=
  TASK_FIX_ATTEMPTS (2)` throws `StageHaltError` → escalation on every
  re-entry, no spawn, forever, until the box is hand-checked. Approve and
  extend only re-enter the stage; the twin's escalate-retry movers reset
  nothing (the ledger-clearing fresh-bracket re-entry is the new repo's
  C6 D2 fix, `gate-settle.ts`, post-split). extract-a's post-extend
  approve spawned task 3 only because the operator had ALSO hand-re-
  targeted 1.2 — recorded as item 1.2.1 ("hand re-target: the 1.2
  bracket exhausted mid-observation while its work is fully applied");
  that hand re-target, not the gate answer, moved the walk.
  Hand re-target executed for this run: 4.1's box hand-checked
  (operator), 4.2's box checked + record items 4.2.1/4.2.2 appended
  **after 4.2** — item ids are positional (`items.length + 1`), so
  inserting between 4.1 and 4.2 would have re-keyed the fold's task-7
  record onto a record item; after-4.2 keeps ids 6/7 fold-aligned and
  shifts only never-started items. Slices landed per the runner's
  protocol (checked box + applied work per commit, explicit paths, all
  hooks green): `29a25874a` (4.1 pointer docs), `c06875744` (4.2 stubs +
  records), `c43881502` (baseline.test.ts lint fix for 3.1's red).
  The 17 h-parked gate TUI (ttys001) was running from this
  worktree's `afk-runner/src/cli.ts`, deleted by task 2.1 — alive from
  memory only; terminated, gates settled by hand per the file protocol
  (`## Gate response` section at file end; markers also parse mid-file —
  agent-mcp gate-1 carries `APPROVE` at line 5). Resume from the new repo
  is silent on a non-TTY (evidence only in events.ndjson):
  `bun ~/Projects/yourpapai/afk-runner/src/cli.ts resume
  afk-runner-extract-c-retire` run from the worktree. Current state:
  gate-6 carries the staged T1-approve; on resume the walk spawns item
  4.3 (CLAUDE.md rows) — six items remain (4.3–4.6 docs cross-refs,
  5.1 full gate pass, 5.2 census, 5.3 cleanup note) before verify →
  release gate; resume deliberately not yet run — 5.1 is a full-suite
  pass, so it should run on an idle machine. Worktree is clean of the
  slices; only this notes.md edit is uncommitted.
- 2026-09-11 (later) — resume after the 4.1/4.2 hand re-targets worked
  as predicted: the walk spawned 4.3, 4.4 fresh; both flaked their
  affected checks on the same spawn/real-git timing family under loaded
  144–391 s suite runs, but 4.4's slice commit (`e7e877dfe`) swept in
  4.3's already-applied CLAUDE.md edit, so both boxes read checked and
  their verifies pass (`rg -n "afk" CLAUDE.md` — every hit
  new-repo-pointing). The 4.5 bracket exhausted the same way (edit
  applied, `rg -n "afk" docs/architecture/commands.md` empty) → gate-7.
  Hand re-target executed: 4.5 box checked + record item 4.5.1 appended
  after 4.5 (positional ids 10–12 stay fold-aligned), slice landed as
  `f654f2728`; gate-7 carries the staged T1-approve. Remaining walk:
  4.6 (`tests/CLAUDE.md` roots sentence), 5.1 (full gate pass — run on
  an idle machine), 5.2 (widened census), 5.3 (D6 cleanup note), then
  verify → release gate (answer `APPROVE`).
