<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

## Why

The opencode-agent command vocabulary is signal-only: `/retry`, `/review` and `/continue` parse the maintainer's argument and then discard it, and no command or handler can bring the base branch into a drifted `agent/issue-<n>` branch. A delivered pull request that falls behind `master` shows GitHub's conflict banner, fires no event the pipeline listens to, and the only remedy is a human with a local checkout. A maintainer retrying a failure likewise cannot say *how* — "pull master and resolve conflicts" is thrown away before any prompt is built.

## What Changes

- `/retry <note>` and `/continue <note>` arguments are threaded into the resumed handler's prompt as a maintainer note — enveloped per the untrusted-text rules, framed as guidance: the plan/folder remains truth and `/changes` remains the re-plan channel.
- New `/sync` command: a **non-moving side operation** in the `/ask` shape, accepted in any state whose `prNumber` is set (typed on the pull request, where `commandSurface` already forces commands once one exists). It runs `git merge origin/<base>` into the agent branch. A clean merge pushes with zero model turns; a conflict triggers bounded repair turns in the commit-repair doctrine (the model edits markers, is forbidden git, the pipeline completes the merge and pushes). Failure reports the remedy; phase, `attempts` and all per-PR budgets are untouched, so every existing trigger still works.
- The merge completes through a new dedicated `Git` operation, never `commitAll`: the diff-guard caps and protected-path dropping would misjudge base's own already-reviewed changes (dropping base's `.github/workflows/` edits would silently un-merge them).

## Capabilities

### New Capabilities

- `agent-command-steering`: maintainer steering of the agent through command arguments and the `/sync` base-merge command. Without it, command arguments are silently discarded — a maintainer coaching a retry is ignored — and a PR behind base has no machine remedy: the conflict banner is permanent until a human merges locally.

### Modified Capabilities

None. No existing spec covers the command surface; `agent-commit-identity` covers commit identity only, and the `review-loop-*` / `sdd-*` specs cover other workspaces.

## Impact

- Code: `opencode-agent/src/commands.ts` (vocabulary, `COMMAND_APPLIES` predicate), `triggers.ts` (side-op dispatch beside `/ask`), a new sync handler + repair-prompt module, `git.ts` (merge operation), workflow YAML command arm (checked against `SLASH_COMMANDS` by `workflow.test.ts`), spend recording via `state-persist.ts`.
- Docs: `opencode-agent/README.md`, `opencode-agent/CLAUDE.md`.
- No papai platform/task instances, no config-context scope, no DB rows: this is the standalone opencode-agent workspace. Steering notes are prompt-scoped (never persisted); `/sync` moves no state.
- Budget: repair turns are checked against the per-issue token ceiling before each turn.

## Non-goals

- Automatic base-sync inside `ensureBranch` — declined: unrequested merge commits on every job, and the diff-guard caps would false-fire on base-sized staged sets.
- A plain-comment classifier intent for syncing — declined: parks move by command, not by prose.
- Rebase — declined: merge composes with review-loop's already-merged fixes and matches the request verbatim.
- `/sync` on PR-less states — declined: a FAILED-before-delivery branch is re-entered by `/retry`, which re-runs from it.
- A persisted `syncAttempts` counter — declined: `/sync` is human-initiated like `/ask`, bounded by the token ceiling.
