<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

# Tasks: opencode-agent-fix-command

Test-first order per design (Hook/TDD impact statement): the TDD hook does not gate
`opencode-agent/` edits, so the red-before-green discipline is carried by this list —
every section writes or mutates its tests before the implementation that turns them green.
Every task ends with its verification command (red where the task lands a test whose
implementation comes later, green otherwise). Sections land as their own commits.
Spec: `specs/agent-fix-command/spec.md`; how: design D1–D7.

## 1. Command vocabulary and gating (D1, D2)

- [x] 1.1 Test in `tests/opencode-agent/commands.test.ts`: `/fix` parses from a line start with an argument, is ignored inside fences, and `parseSlashCommand` never matches it as a prefix of another command. Verify red: `bun test tests/opencode-agent/commands.test.ts` — the new parse cases fail
- [x] 1.2 Test in `tests/opencode-agent/commands.test.ts`: `acceptedCommands` offers `/fix` exactly in `COMPLETE` and `PR_DELIVERY` when `state.prNumber !== null`, and nowhere else (all other phases, and both phases without a PR, exclude it). Verify red: `bun test tests/opencode-agent/commands.test.ts` — the new gating cases fail
- [x] 1.3 Implement the `/fix` registration in `opencode-agent/src/commands.ts` together with the guardrails pin that must land with it: add `'/fix'` to `SLASH_COMMANDS`, `'/fix': 'CI_FAILED'` to `COMMAND_SIGNALS`, and `'/fix': (state) => state.prNumber !== null` to `COMMAND_APPLIES` — phase admission stays in the transition table via `accepts`; in the same task mutate the "exposes exactly the documented command surface" pinned literal list in `tests/opencode-agent/guardrails.test.ts` to gain `'/fix'`, because that test fails the moment the vocabulary entry lands (the three map entries are one registration — a command in `SLASH_COMMANDS` missing its signal/applies rows is broken or invisible, so they cannot land or verify separately). Verify green: `bun test tests/opencode-agent/commands.test.ts tests/opencode-agent/guardrails.test.ts`
- [x] 1.4 Test in `tests/opencode-agent/triggers.test.ts`: an accepted `/fix` produces the same state move and the same `ciAttempts + 1` as the red-run door (`COMPLETE → CI_FIX`, `PR_DELIVERY → CI_FIX`), pinning D4's "one transition, one increment site" with no new wiring. Verify: `bun test tests/opencode-agent/triggers.test.ts` green
- [x] 1.5 Test in `tests/opencode-agent/feedback-target.test.ts`: `/fix` typed on the issue of a state naming a PR is answered by the existing `commandSurface` refusal naming the pull request, and nothing acts on it (spec: "Typed on the issue once the pull request exists"; no production change expected). Verify: `bun test tests/opencode-agent/feedback-target.test.ts` green
- [x] 1.6 Section gate: `bun test tests/opencode-agent/commands.test.ts tests/opencode-agent/guardrails.test.ts tests/opencode-agent/triggers.test.ts tests/opencode-agent/feedback-target.test.ts`

## 2. Spent-budget refusal (D3)

- [x] 2.1 Test in `tests/opencode-agent/triggers.test.ts`: `/fix` with `state.ciAttempts >= config.maxCiAttempts` is refused before the signal is applied — persisted state byte-identical (phase, `ciAttempts`, `prNumber`, `ciBudgetReported`), outcome `{ status: 'failed', reported: true }`, notice naming `AGENT_MAX_CI_ATTEMPTS` and the fresh-PR remedy; typed again after a refusal, the notice posts again (no once-per-PR guard); a `/fix` with no PR or in a phase refusing `CI_FAILED` is a wrong-command refusal instead, never a spent one. Verify red: `bun test tests/opencode-agent/triggers.test.ts` — the new refusal case fails
- [x] 2.2 Implement the `CI_SPENT` outcome as one landing: add `CI_SPENT` to `OUTCOME_KEYS` in `opencode-agent/src/outcomes.ts` with the ⛔ glyph — the bound-reached family, not 🚑 `CI_GAVE_UP`; implement `renderFixExhausted(reason, prUrl)` in `opencode-agent/src/budget-notices.ts` beside `renderReviewsExhausted` — names the spent count and ceiling, the raise-`AGENT_MAX_CI_ATTEMPTS`-and-reply-`/fix` remedy, and the fresh CI budget a new pull request earns; deliberately not repeat-guarded (it answers a typed command); and add the `['CI_SPENT', renderFixExhausted('spent', null)]` row to `OUTCOME_COMMENTS` in `tests/opencode-agent/markdown.test.ts` — the table's declared one-entry-per-renderer contract (key, renderer, and contract row cannot land or verify separately: the typed table fails to compile without the renderer and fails the contract without the key). Verify green: `bun test tests/opencode-agent/markdown.test.ts tests/opencode-agent/presentation.test.ts`
- [x] 2.3 Implement `refuseFix` in `opencode-agent/src/command-refusals.ts` (beside `refuseReviews`) and its check in `applyCommand` (`opencode-agent/src/triggers.ts`): after the `commandApplies` check, gated on `signal === 'CI_FAILED' && canTransition(state.phase, signal) && state.ciAttempts >= deps.config.maxCiAttempts` — the exact `REVIEW_REQUESTED` ordering; does not consult `ciBudgetReported` (the refusal and its only call site are one change — each is dead code without the other). Verify green: `bun test tests/opencode-agent/triggers.test.ts` — turns 2.1 green
- [x] 2.4 Section gate: `bun test tests/opencode-agent/triggers.test.ts tests/opencode-agent/markdown.test.ts tests/opencode-agent/presentation.test.ts`

## 3. Command-bought discovery from the head's check runs (D7)

- [x] 3.1 Test in `tests/opencode-agent/adapters.test.ts`: `listCheckRunsForRef` paginates `checks.listForRef` for the ref, narrows rows through a zod schema (unparseable rows skipped, absent conclusion stays `null`), and passes the output-summary text through `clean` at the boundary like every free-text read. Verify red: `bun test tests/opencode-agent/adapters.test.ts` — the new member's cases fail
- [x] 3.2 Implement the `listCheckRunsForRef(ref)` member on `ActionsApi` in `opencode-agent/src/github-actions.ts` (interface, row schema, `createActionsEndpoints` wiring — one member's three facets, not separately verifiable) returning check runs with name, conclusion and output summary. Verify green: `bun test tests/opencode-agent/adapters.test.ts`
- [x] 3.3 Test in `tests/opencode-agent/ci-fix-red-run.test.ts`: a command-bought round (`trigger.kind === 'pull-request'`, no `runId`) calls `listCheckRunsForRef` with the branch the handler already resolves (`branchNameFor(state.issueId)`), keeps check runs whose conclusion is `failure` or `timed_out`, drops `cancelled`/`skipped`/`stale`/`neutral`/`action_required`/`success`, maps survivors into the existing `FailedJob` shape (name from the check run, log from the output summary tail-clipped by the `red-run.ts` budget, `failedSteps` empty), and runs the ordinary diagnosis/repair path on them. Verify red: `bun test tests/opencode-agent/ci-fix-red-run.test.ts` — the new mapping cases fail (the file compiles because 3.2 landed)
- [x] 3.4 Test in `tests/opencode-agent/ci-fix-red-run.test.ts`: a refused head-check read on a command-bought round degrades to the `readError` path (needs-human round naming the error, no crash), and a head with no failed check run renders the undiagnosed round with nothing pushed — the step that keeps 1.4 honest, since a state move that repairs nothing would otherwise pass. Verify red: `bun test tests/opencode-agent/ci-fix-red-run.test.ts` — the new degradation cases fail
- [x] 3.5 Implement the discovery branch in `discoverFailures` (`opencode-agent/src/phases/ci-fix.ts`): a trigger that is not the red run reads the head's check runs through the new member inside the existing `try`/`catch`; the `kind === 'ci'` path is untouched. Verify green: `bun test tests/opencode-agent/ci-fix-red-run.test.ts` — turns 3.3 and 3.4 green
- [x] 3.6 Section gate: `bun test tests/opencode-agent/adapters.test.ts tests/opencode-agent/ci-fix-red-run.test.ts`

## 4. Door-aware report wording (D7)

- [x] 4.1 Test in `tests/opencode-agent/ci-fix-red-run.test.ts`: for `trigger.kind !== 'ci'` the renderer's two zero-failure lines say no failed check run could be found on the head (never "the run is red", never "the run could not be read") and its two read-error lines name the head's check runs (never "the red run"); for `kind === 'ci'` all four lines keep today's red-run wording. Verify red: `bun test tests/opencode-agent/ci-fix-red-run.test.ts` — the new wording cases fail
- [x] 4.2 Implement in `opencode-agent/src/phases/ci-report.ts`: key the zero-failure and read-error branches of `failureLines` and `verdictLine` on `trigger.kind`, following the existing `redRunUrl` precedent — wording only, report shape untouched. Verify: `bun test tests/opencode-agent/ci-fix-red-run.test.ts` green

## 5. Workflow: pull-request arm and `checks: read` grant (D5)

- [ ] 5.1 Edit `.github/workflows/agent-pipeline.yml` as one landing — the arm, its permission grant, and the comment that documents the grant verify only together. Red-first: run `bun test tests/opencode-agent/workflow.test.ts` and confirm it fails on the arm-vs-`SLASH_COMMANDS` lockstep check (the vocabulary entry from 1.3 made the hand-maintained `contains` list stale). Then add `contains(github.event.comment.body, '/fix')` to the third arm's command group, add `checks: read` beside `actions: read` in the workflow-level `permissions:` block, and widen that block's "What a CI-fix round reads" comment to name the head's failed check runs (the Checks-API read the grant pays for). Verify green: `bun test tests/opencode-agent/workflow.test.ts && bun workflows:lint`

## 6. Guardrail pin: the command rides the pull-request door (D6)

- [ ] 6.1 Test in `tests/opencode-agent/pr-trigger.test.ts`: an open pull request from a foreign repository whose branch merely looks like `agent/issue-<n>` carrying a `/fix` comment keeps the existing `PR_FOREIGN_REPOSITORY` refusal — no model turn, no CI-fix attempt spent — and a `/fix` on the agent's own open pull request boots a job exactly as `/review` and `/sync` do (spec: "The command rides the pull-request door's existing guardrails"; no production change expected). Verify: `bun test tests/opencode-agent/pr-trigger.test.ts` green
- [ ] 6.2 Section gate: `bun test tests/opencode-agent/pr-trigger.test.ts tests/opencode-agent/guardrails.test.ts`

## 7. Documentation the change makes stale (D5)

- [ ] 7.1 Update `opencode-agent/CLAUDE.md`: the command-surface doctrine gains `/fix`, and the CI-fix doctrine bullet ("`handleCiFix` reads the run it was asked to repair: `listRunJobs`/`jobLog`") learns the command-bought half — head check runs via `listCheckRunsForRef` under `checks: read`. Verify: `grep -n "listCheckRunsForRef" opencode-agent/CLAUDE.md && grep -n "'/fix'" opencode-agent/CLAUDE.md && bun run format:check`
- [ ] 7.2 Update `opencode-agent/README.md`: the command table gains the `/fix` row with its valid-in states, the phases table's `CI_FIX` trigger names the second door, and the budget section's once-per-PR silence passage learns the repeating typed refusal beside it. Verify: `grep -n "'/fix'" opencode-agent/README.md && bun run format:check`

## 8. Full verification

- [ ] 8.1 Run the whole workspace suite green: `bun test tests/opencode-agent/`
- [ ] 8.2 Run the repo checks the change can reach: `bun run typecheck && bun run lint && bun workflows:lint`
- [ ] 8.3 Reconcile `openspec/changes/opencode-agent-fix-command/` artifacts with the implementation before archive (spec scenarios ↔ sections 1–6, design D1–D7 ↔ tasks) and confirm every spec scenario has a pinning test. Verify: `openspec validate opencode-agent-fix-command --strict`
