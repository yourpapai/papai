<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# kiss → papai shadow migration

This runbook covers running papai+nerv **alongside** an existing kiss deployment on the same
GitLab repos, comparing outputs, and cutting projects over one at a time. It assumes nerv is
already deployed and the `nerv` plugin is enabled per `docs/deployment/nerv-enablement.md`.

## 1. Run against the same repos kiss serves

Point nerv's `Project.repositories[].projectPath`/`repoUrl` at the exact same GitLab projects
kiss is currently configured for (either by hand, or via the importer in
`tools/import-kiss-projects.ts` — see `docs/superpowers/plans/2026-07-12-migration-p3-papai.md`
Task 3-5). Do **not** disable kiss on these projects yet — both bots run in parallel during the
shadow phase.

## 2. Shadow by assigning the bot to kiss-created MRs

papai's P1 assignee-watch sweep adopts MRs it's assigned to, even ones kiss opened first (see
`docs/superpowers/specs/2026-07-12-migration-p1-assign-the-bot-design.md`). To shadow a specific
kiss-driven MR:

1. Add the papai/nerv bot as an assignee on the MR (in addition to kiss's bot, if kiss also
   assigns itself).
2. The assignee-watch sweep picks it up on its next poll and starts a nerv task against the same
   branch/MR.
3. Let both bots run their review/CI-fix loop independently. **Do not merge** until you've
   compared outputs (see the parity checklist below).

This exercises the exact same code path production traffic will use post-cutover, without
requiring kiss to be turned off first.

## 3. Parity checklist

Before trusting nerv's output on a project, compare it against kiss's on at least 3-5 shadowed
MRs:

- [ ] **Review-fix parity** — same review comments addressed, no regressions introduced that
      kiss's pass didn't also introduce.
- [ ] **CI-fix parity** — nerv's CI-fix loop reaches a green pipeline in a comparable number of
      iterations; no CI jobs left permanently red that kiss would have fixed.
- [ ] **Cost parity** — compare `costBudgetUsd`-bounded spend per task against kiss's
      `maxTaskCost`-bounded spend for equivalent prompts; nerv should not be materially more
      expensive for the same class of task.
- [ ] **Output language/tone parity** — nerv's PR descriptions, commit messages, and chat replies
      read consistently with what users are used to from kiss (no jarring format/tone shift).

Run the checklist per-project, not globally — different repos exercise different agent
behaviors (monorepo vs. single-repo, heavier vs. lighter CI, etc.).

## 4. Per-project cutover

Once a project passes the parity checklist:

1. In the target chat channel/group, run `/nerv bind <projectPath>` (see
   `plugins/nerv/bind-command.ts`) to bind that channel to the nerv project. This sets
   `notifyContextId` so nerv's task notifications land in the right place.
2. Disable kiss on that project (stop assigning its bot to new MRs on this repo, or disable the
   project in kiss's own config — kiss-side operation, outside papai's scope).
3. Announce the cutover in the channel so users know which bot now owns new work on that repo.

Repeat per-project until every kiss-served project has been cut over.

## 5. Rollback

If a cut-over project regresses:

1. Un-assign the papai/nerv bot from new MRs on that repo (or unbind via nerv's project config —
   there is currently no `/nerv unbind` command; clear `notifyContextId` via direct nerv Mongo
   access or a future unbind command).
2. Re-enable kiss on that project.
3. File the regression before retrying cutover — a rollback should always leave a paper trail of
   what broke.

No papai-side code changes are required for rollback; it's purely an assignment/config change on
already-shipped functionality.
