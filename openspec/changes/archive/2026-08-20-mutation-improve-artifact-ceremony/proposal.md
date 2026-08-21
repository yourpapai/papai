<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Stop the mutation runner mandating two documents nothing reads

## Why

`buildImprovePrompt` (`mutation-improve/src/prompt-templates.ts:111`) makes the IMPROVE
agent write, per improved file, a seven-section `design.md` and a `tasks.md` of
task-per-mutant-class checkboxes, inside an `openspec/changes/mutation-coverage-<date>-<stem>/`
folder. Two of the runner's five mandated steps produce them.

Their content is already held somewhere stronger. The gap analysis restates the Stryker
report the runner measures itself. The accepted-residuals section restates
`residuals: [{loc, why, mutantIds}]`, which the result JSON already carries and which the
runner **set-matches against its own surviving mutant ids** — a declaration that is
verified, unlike the prose beside it. The per-mutant-class task list is walked by nothing:
this runner has no step machinery, and its gates are the diff-guard, the build check and
the measured score.

Their only consumer is `finalize.ts:52`, which renders the two paths as two cells of a
markdown table in the pull-request body. And no `mutation-coverage-*` folder appears
anywhere in this repository's history — see Open Questions in `design.md`, because that is
a signal about what survives rather than proof of what is read.

The runner's own contract is rigorous and mechanical. The documents beside it are ceremony,
and they are paid for in agent turns on every improved file.

## What Changes

- **The mandated `design.md` and `tasks.md` are removed** from the IMPROVE procedure. The
  five-step procedure becomes three: MEASURE, TESTS, RESIDUALS.
- **The residual reasoning stays and gets more room.** It moves entirely into the result
  JSON, which already schemas it and already has a free-text `notes` field. Nothing that is
  verified is lost; only the unverified restatement of it is.
- **`specPath` / `planPath` become optional** in `result-schema.ts` (they are
  `z.string().min(1)` today, and already optional in `run-state.ts`), so a result carrying
  neither is valid rather than a gate failure.
- **The pull-request table reports the residual count and reasoning inline** instead of
  linking two files, so `finalize.ts` still tells a reviewer what was accepted and why.
- **BREAKING for in-flight runs only**: a `--resume-run` of a run started before this
  change carries results whose `specPath`/`planPath` are set; the optional shape reads them
  fine, so this breaks nothing in practice. Called out because `result-schema.ts` is the
  agent contract.

## Capabilities

### New Capabilities

- `mutation-improve-artifact-scope`: what the mutation runner requires an IMPROVE agent to
  produce, and where residual reasoning is recorded.

### Modified Capabilities

None. No existing capability spec under `openspec/specs/` describes the runner's agent
contract.

## Impact

`mutation-improve/src/`: `prompt-templates.ts` (`buildImprovePrompt`, and
`improveChangePaths` which becomes unused), `result-schema.ts`, `finalize.ts`; possibly
`pipeline.ts` and `run-state.ts` where the two paths are threaded through. Tests under
`tests/mutation-improve/`. Docs: `mutation-improve/CLAUDE.md`.

`src/diff-guard.ts` needs no change: it whitelists `tests/` and `openspec/changes/`, so an
agent that writes only under `tests/` still passes.

**Scope impact: none.** Local developer tooling — no platform instance, no task instance,
and no per-user, group-shared or thread-isolated state.

## Non-goals

- **Weakening the residual contract.** The declared `mutantIds` must still exactly equal
  the runner-measured surviving ids — every survivor declared, nothing extra. That check is
  the reason the prose is redundant, not a casualty of removing it.
- **Changing the test-quality rules**: one test per mutant class, exact-equality
  assertions, extend the existing companion file. Those are the runner's real minimality
  contract and they are stricter than anything proposed here.
- **Touching the gates** — diff-guard, build check, measured after-score, the capped path,
  the baseline ratchet, or `epsilon`.
- **Adding the production-code minimality ladder to this agent.** It cannot edit `src/` at
  all; the ladder would be a no-op. That is `agent-minimality-ladder`, which excludes this
  workspace by name.
- **Removing the OpenSpec write permission from the diff-guard.** Keeping `openspec/changes/`
  whitelisted costs nothing and keeps the guard's shape stable.
- Any change to how `select`, the capped registry, or the PR finalisation flow work.
