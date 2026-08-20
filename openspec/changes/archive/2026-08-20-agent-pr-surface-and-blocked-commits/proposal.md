<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: A blocked commit is reported, and the pull request is the surface

## Why

CI-fix attempts 2 and 3 on PR #272 each diagnosed the same failure, wrote
`.github/workflows/agent-pipeline.yml`, had it dropped by `stageAllowed`,
pushed nothing, and reported **"Pushed a fix: no — nothing changed"** beside
"Local checks: ✅ green". CI stayed red on the identical failure, which
re-entered `CI_FIX`, until `ciAttempts` was spent — ~137k tokens for two false
reports and no diff (runs 31771925219, 31779566286).

The guardrail is right; its silence is not. `stageAllowed` reports the drop at
`warn` into a log nobody reads, `commitAll` discards the `dropped` list, and
`null` means both "clean tree" and "everything I wrote was refused". The model
is never told, so it re-derives the same blocked fix next round.

Run 31779566286's transcript shows the workflow file was the **only** edit of
the whole run, and the diagnosis was right: the `test` check needs
`bun run build:client` (the `public/` bundles are gitignored, so a fresh
checkout has none) and a `docker pull` of the story-sandbox image — setup
`ci.yml` does and `agent-pipeline.yml` does not. The branch was never fixable
by this agent, and no round can discover that.

It also explains the report's other half: "Local checks: ✅ green" was true only
because the repair turn hand-ran that setup **in its own job** before re-running
the tests. The verdict described the runner it had just mutated, not the branch.

Compounding both: that report goes to the **issue** while the maintainer is
reading the **pull request**.

## What Changes

- `CI_FIX_INSTRUCTIONS` and `plan-draft`'s two instruction blocks state the
  `.github/workflows/` rule that only `IMPLEMENT_INSTRUCTIONS` carries today.
  `CI_FIX` is the phase most likely to want a workflow edit, and is the one
  running blind.
- `commitAll` reports what it dropped instead of discarding it, so a refused
  change set is distinguishable from a clean tree. The drop is fed back into
  the round's session — the model learns its edit was blocked while it can
  still act — and rides out into the report.
- The CI-fix report tells the truth: names the blocked file, says the fix
  exists but cannot be pushed, and states what a maintainer must apply by
  hand. It no longer claims "nothing changed" when something did, and it no
  longer reports a green verdict as a fact about the branch when nothing was
  pushed — the checks ran against a job the repair turn could mutate.
- **BREAKING (surface):** once `prNumber` exists, **every** comment goes to the
  pull request — reports and failure notices included, not just the live status
  comment and labels. The state record and the conversation window the model
  reads follow it, so `findLatestState` and `renderThread` keep one source of
  truth rather than gaining a second.
- The review-loop push path gets the same guardrail. Its fixes are commits made
  in its own worktree and pushed by branch, bypassing `stageAllowed` entirely,
  so a workflow edit there fails the **push** outright instead of being dropped.

A round whose only output was dropped still spends its `ciAttempt`: it cost
tokens, and the budget exists to stop a branch bouncing off CI forever.

## Capabilities

### New Capabilities

None — a dev-workflow change confined to `opencode-agent/`, which nothing under
`src/` imports and which never runs in the papai container. No platform
instance, task instance, or config-context scope is touched, and no papai
runtime behavior changes. `skip_specs: true`, matching
`opencode-agent-openspec-compliance`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- Granting the App `workflows: write`. Widening `PROTECTED_PREFIXES` stays a
  privilege decision — an agent that can rewrite `agent-pipeline.yml` can
  rewrite the permissions that bound it.
- Refunding the `ciAttempt` a blocked round spends, or short-circuiting the
  next `CI_FIX` entry after a drop.
- Moving `AGENT_STATE` itself onto the pull request.
- Isolating `runCheckLoop` from side effects the repair turn performs on its
  own runner. Reporting the verdict honestly is in scope; making it
  uncontaminated is a separate change.
- Adding the missing `build:client` / `docker pull` setup to
  `agent-pipeline.yml`, or otherwise unblocking PR #272. That edit is exactly
  what this pipeline may not commit, and a maintainer must apply it by hand.

## Impact

`opencode-agent/src/`: `git-commit.ts`, `protected-paths.ts`, `phases/ci-fix.ts`,
`phases/plan-draft.ts`, `phases/review.ts`, `phases/review-push.ts`,
`run-report.ts`, `feedback-target.ts`, `state-persist.ts`, `state-manager.ts`,
`prompts.ts` (thread rendering), and every renderer posting through
`postAndAppend`. Tests in `tests/opencode-agent/`. Docs:
`opencode-agent/CLAUDE.md` (two local rules restated) and `README.md`.
