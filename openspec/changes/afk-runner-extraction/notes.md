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
