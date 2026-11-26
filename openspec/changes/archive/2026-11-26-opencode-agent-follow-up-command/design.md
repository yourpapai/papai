<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev. Use of this software is governed by the Business Source License 1.1. See LICENSE in the project root for details. -->

# Design: `/follow-up` — size-gated maintainer-requested edits on a delivered PR

## Context

See `proposal.md` for motivation and the exploration findings; the behavioral contract is `specs/opencode-agent-commands/spec.md`. The implementation stands on five existing seams, none of which this change alters in shape:

- **Command vocabulary** (`opencode-agent/src/commands.ts`): `SLASH_COMMANDS`, `COMMAND_SIGNALS`, `COMMAND_APPLIES`, and `acceptedCommands` — the one predicate table whose two readers are the wrong-command refusal (`command-refusals.ts`) and the waiting-comment hint (`run-report.ts` `acceptedLine`). Signal-less commands (`/ask`, `/sync`) bypass the transition table.
- **Side-operation dispatch**: `TriggerOutcome.sync?: boolean` (`trigger-outcome.ts`) → `MachineInput.sync` (`phase-context.ts`) → `driveMachine` (`cascade.ts:115`) calling `runSync` ahead of both budget stops. `phases/sync.ts` is the handler shape: `ensureBranch` first, own ceilings asked internally, reply via `postAnswer` with spend folded into the carried state.
- **Surface rule**: `commandSurface` (`feedback-target.ts`) answers 'accepted'/'elsewhere' per origin; `applyTrigger` (`triggers.ts`) refuses issue-typed commands with `commandBelongsOnPr` when it says 'elsewhere'. `postAnswer` posts on the trigger surface, so reply placement follows for free.
- **Commit/push machinery**: `commitAll` (protected paths dropped at staging, diff-guard caps) wrapped by `commit-repair.ts` rounds, `git-reconcile.ts` (merge, never rebase/force) before push, `push()` recording the head the remote accepted.
- **Local checks**: `check-loop.ts`'s `CheckSpec`/`CheckRunner` (`shell.ts` `CommandResult`) — the CI-fix path's way to run named argv locally and judge by exit status.

Constraints that shape the design: the agent's pushes run no CI (the repo's workflow ignores `agent/*` pushes), so "checks" means local execution only; state lives in hidden `AGENT_STATE` blocks (issue thread first, then PR via `readThread`) — no SQLite, no drizzle; untrusted comment text reaches prompts only through `mintEnvelope` framing; the Write/Edit TDD hook gates every file below.

## Goals / Non-Goals

**Goals:**

- `/follow-up` as a non-moving side operation reusing the `/sync` dispatch shape end to end — one new handler, one new notices module, no new persisted state shape.
- Acceptance offered and enforced from one predicate (`COMMAND_APPLIES`), so refusal lists and hints derive; the workflow arm kept honest by the existing differential test.
- Size gate before any write, with the verdict and reason on both reply paths.
- All git work through the machinery the implement and CI-fix paths already use (commit-repair, reconcile, staging guard) — no second commit path.
- Red-first TDD per the proposal's four repro tests; the handler's logic is mutation-gateable under `opencode-agent/src/`.

**Non-Goals:**

- No phase, transition row, `STATE_VERSION` bump or new state field; no per-PR follow-up budget (the token ceiling is the bound, as for `/sync` repair rounds).
- No new config knobs — the size threshold is the model's judgment by design (proposal §6).
- No review-loop re-entry; `/review` semantics untouched.
- No widening of the fork guard, `PROTECTED_PREFIXES`, or any other command's surface rule beyond the one `/follow-up` exception.
- No change to the plain-comment no-op baseline on a delivered PR.
- Not a papai runtime surface: no tool registration, no `tool_prefs` interaction, no chat-platform code. (Capability/tool-prefs gating rule: not applicable — nothing under `src/`, `client/` or `plugins/` changes.)

## Decisions

### D1 — Dispatch is a second side-operation flag, not a signal

`TriggerOutcome` and `MachineInput` gain `followUp?: boolean` beside `sync`; `sideOperation` in `triggers.ts` returns it (before the signal lookup, exactly as `/sync`); `driveMachine` calls `runFollowUp` beside `runSync`, still ahead of both budget stops.

*Alternatives:* a `TransitionSignal` row (rejected: makes it a phase — a state move, a budget question and a presentation row are exactly what the spec forbids); doing the work inside `triggers.ts` (rejected: that layer decides whether and where, handlers do work — the split `phases/` exists for).

### D2 — Acceptance is a `COMMAND_APPLIES` predicate; the undelivered refusal is a `refuseUnknown` wording

`COMMAND_APPLIES['/follow-up'] = (state) => (state.phase === 'COMPLETE' || state.phase === 'PR_DELIVERY') && state.prNumber !== null`, with **no** `COMMAND_SIGNALS` entry. A `/follow-up` outside the predicate falls through `sideOperation` (returns `null`) to the signal lookup and `refuseUnknown`, which gains a `/follow-up` case wording the delivered-PR requirement — the same special case `/sync` already has for its pre-capture refusal. `acceptedCommands`, the refusal list and the waiting-comment hint all derive from that one predicate with no further code.

*Alternatives:* keying on `prNumber` alone (rejected: `/fix`'s predicate is deliberately phase-scoped and a cancelled `COMPLETE` names no PR — the transition table cannot decide this one); a signal plus a synthetic row (rejected: see D1).

### D3 — The surface exception lives inside `commandSurface`, not at the call site

`commandSurface` gains the command as a parameter and returns 'accepted' for `/follow-up` on the issue while a pull request is open — the one deliberate, pinned exception (this is the proposal's recorded assumption; the strict alternative is a one-line flip here). `applyTrigger` keeps calling it unchanged, so the surface rule stays one function with one answer; every other command's 'elsewhere' behavior is untouched. Acceptance itself still comes from `COMMAND_APPLIES` — the exception is about *where*, never *whether*.

*Alternatives:* branching in `applyTrigger` before the `commandSurface` check (rejected: a second spelling of the surface rule, free to drift from the module whose reason to exist is being that answer).

### D4 — The size gate is one `plan`-profile `promptForJson` turn

Before it: `ensureBranch` (standard drift guard — **no** `allowDependencyDrift`; a drifted branch refuses naming `/sync` as the remedy, carrying `attempts` rather than spending one, the `isRetryFutile` doctrine), the argument-present check, and the token ceiling (`totalTokens` + `withinBudget`, the `applyIntent` rule — never pay a turn to learn a refusal). The assessment turn runs on the read-only `plan` profile (`LLM_MODEL_LIGHT`) and answers through `promptForJson` (the `ci-diagnosis.ts` precedent) with a zod verdict `{ size: 'small' | 'too-big', reason }`. Its context is the enveloped request plus the change folder's digest and the branch's diff stat against base, so "files the change already touched" is a fact it reads, not a memory.

*Alternatives:* a `build`-profile turn (rejected: the verdict must not be able to edit); asking for prose and parsing it (rejected: `promptForJson` exists for exactly this); making the gate a pipeline-side line-count cap (rejected: the spec makes the judgment the model's, with the reason mandatory — a numeric cap would second-guess nothing and refuse everything over N).

### D5 — The apply turn is one `build`-profile turn; the pipeline owns git

A small verdict starts one `build`-profile turn with instructions composed in the follow-up module carrying, verbatim: `PROTECTED_PATHS_RULE` and `MINIMALITY_RULE` (pinned by `instructions.test.ts`-style assertions against the constants), a test-first requirement where the repository's practice asks one, and a forbidden-git rule in the `SYNC_FORBIDDEN_GIT_RULE` shape — the pipeline alone commits, reconciles and pushes. The request rides `MAINTAINER_NOTE_FRAMING`-style enveloped framing with the handler's nonce (one `mintEnvelope` per handler, shared by system and user prompts).

*Alternatives:* walking plan steps (`plan-steps.ts`) (rejected: the gate has already bounded the change; step machinery is for a plan, and a second walk of it here re-derives the implement phase); letting the model commit (rejected: violates the staging-guard and commit-repair doctrine every other path obeys).

### D6 — Checks are re-run by the pipeline, not trusted from the model

The apply turn's structured reply names the test commands it ran; the pipeline re-runs them plus `AGENT_CHECK_COMMAND` (default `bun check:full`) as `CheckSpec` argv through the `check-loop.ts` runner seam, judging by exit status only. Red checks → no commit of record, no push, remote branch left as found, failure reported with what ran (spec: "Checks red, nothing pushed"). Green → `commitAll` wrapped in commit-repair rounds (pre-commit hook rejections are the repairable class; a `GitError` only), then `git-reconcile` merge, then push. Dropped protected paths ride `CommitOutcome` into the reply.

*Alternatives:* trusting the model's green (rejected outright — run 31779566286's green was scoped to a job that ran none of the checks); a `check-loop` repair ladder (rejected: that is the CI-fix phase's shape, and the spec fixes red as "nothing pushed", not "repair until green" — bounded repair stays where the commit hook can still reject).

### D7 — Replies come from a `follow-up-notices.ts` beside `sync-notices.ts`

One module renders every outcome: usage refusal, over-budget notice, small-applied report (decision + reason, files, checks, sha), too-big decline with the issue draft, checks-red failure, hard failure. The handler's single exit folds spend into the carried state and posts via `postAnswer` on the trigger surface — which is why the issue-surface exception needs no posting logic of its own. Run status: `completed` for applied and for declined (a deliberate outcome, nothing broke — `failed` would paint the job red for correct behavior; `skipped` would understate a turn that paid and posted), `failed` for checks-red and broken runs, refusals before dispatch staying `skipped`/`reported` as `refuseCommand` does.

*Alternatives:* reusing `budget-notices.ts` (rejected: these are command outcomes, not ceilings, except the one over-budget notice which renders in the `renderSyncOverBudget` shape); rendering inline in the handler (rejected: the `sync.ts`/`sync-notices.ts` seam exists because the wording changes more often than the logic).

### D8 — The workflow arm is fixed by the differential test, red-first

Adding `/follow-up` to `SLASH_COMMANDS` makes `tests/opencode-agent/workflow.test.ts` fail against `.github/workflows/agent-pipeline.yml`'s PR-comment `contains` list until the arm gains it. No other workflow edit is needed; the fork guard and resolve outputs are untouched. (`bun workflows:lint` gates the file; this pipeline must never write under `.github/workflows/` itself — the arm edit lands as part of the normal PR.)

## Risks / Trade-offs

- [Size judgment is subjective and can drift between runs] → the verdict reason is mandatory and restated on both paths; tests pin both branches and the zero-commit guarantee (mutation gate kills the verdict-branch mutants); no knob is offered, so drift is visible in the reply rather than hidden in a config default.
- [Issue-surface acceptance weakens the surface doctrine] → one exception inside `commandSurface`, pinned by test and documented in `opencode-agent/CLAUDE.md` + README; every other command's refusal is asserted unchanged.
- [A follow-up lands while a maintainer edits the same branch] → reconcile-before-push merges the remote branch (never rebase/force); checks run on the merged tree before the push; a conflict aborts and reports as a failed run with the branch as found.
- [Green locally while CI would be red] → inherent: the agent's pushes run no CI, so the proof offered is the repo's own check command plus the affected tests, named in the reply; `/fix` remains the door when real CI disagrees.
- [Assessment turn paid for a request the ceiling cannot act on] → the ceiling is asked before the turn; the over-budget notice buys nothing.
- [File growth pushes `commands.ts`/`triggers.ts` past `max-lines`] → new logic lives in the new modules; only one predicate line, one `sideOperation` branch and one `refuseUnknown` wording enter the existing files.

## Migration Plan

No persisted shape changes, so there is nothing to migrate and rollback is `git revert` — the state-byte-identical contract means even mid-flight issues are unaffected. Land in the repro-test order so every step is red-first: ① baseline + vocabulary/predicate/`acceptedCommands` tests (`commands.ts`, `triggers.ts`), ② the workflow arm (the differential test forces it), ③ the `commandSurface` exception, ④ the handler + notices + framing pins, ⑤ README/`CLAUDE.md`. The command only reaches users once the arm lands on the default branch, since Actions runs the default branch's workflow — the code and the arm ship in one PR by construction.

Files the TDD hook will gate: `opencode-agent/src/commands.ts`, `triggers.ts`, `trigger-outcome.ts`, `phase-context.ts`, `feedback-target.ts`, `phases/follow-up.ts` (new), `follow-up-notices.ts` (new), `prompts.ts`, `.github/workflows/agent-pipeline.yml`, `opencode-agent/README.md`, `opencode-agent/CLAUDE.md`, and `tests/opencode-agent/follow-up.test.ts` (new) plus the existing suites it extends (`workflow.test.ts`, `instructions.test.ts`, the triggers/commands tests).

No new dependencies — Bun, Zod and the existing injected seams cover everything; no DB or drizzle migration — the only persisted figure that moves is `tokensSpent`, rewritten in place in the existing `AGENT_STATE` block keyed by the issue conversation the restore scan already walks.

## Open Questions

None. The proposal's one recorded assumption (issue-surface acceptance) is a decision this design commits to with the one-line flip point named in D3; everything else the specs fix.
