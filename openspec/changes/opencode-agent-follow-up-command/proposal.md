# `/follow-up` — size-gated maintainer-requested edits on a delivered PR

## Goal

Close the post-delivery seam (live on PR #440): after delivery, a plain maintainer comment on the PR triggers nothing, `/review` is heavy (70m, $0.81), and re-opening the issue thread works only for questions. Add `/follow-up <what to change>`: after the run reached delivery (phase `PR_DELIVERY`/`COMPLETE` with an open PR), the agent assesses the request with a **size gate first**, and either applies it as follow-up commit(s) on the same branch or declines with a ready-to-paste new-issue draft and zero commits. `/review` semantics unchanged; no phase/state-shape change, no `STATE_VERSION` bump.

## Exploration findings (grounding for the design)

- **Plain PR comments are a no-op by construction**: the PR-door resolver (`opencode-agent/src/pr-trigger.ts`) tests the body for a slash command first — a free check — so prose on a PR is dropped before the head lookup; the workflow's `resolve` job mirrors this with the `contains(...)` arm in `.github/workflows/agent-pipeline.yml` (third `if` arm). This baseline is pinned in the repro test, not changed.
- **Command vocabulary** lives in `opencode-agent/src/commands.ts`: `SLASH_COMMANDS`, `COMMAND_SIGNALS`, `COMMAND_APPLIES`. Signal-less commands (`/ask`, `/sync`) bypass the transition table — `accepts()` answers from the `COMMAND_APPLIES` predicate alone — and `acceptedCommands(state)` is the one source both the refusal list (`command-refusals.ts`) and the waiting-comment hint (`run-report.ts` `acceptedLine`) read, so offer and gate cannot drift. The README command table is the only manual copy.
- **Side-operation precedent**: `/sync` (`src/phases/sync.ts`) is a handler that is not a phase — dispatched in `triggers.ts` `sideOperation` before the signal lookup, carried as `sync?: boolean` on `TriggerOutcome` (`trigger-outcome.ts`), consumed by `driveMachine`, replied via `postAnswer` (plain comment, not a record), spend rewritten in place via `state-persist.ts`, and it asks the token ceiling itself. `/follow-up` is this shape with teeth (it spends model turns and writes git).
- **`/fix` precedent for command admission**: `COMMAND_APPLIES['/fix'] = (state) => state.prNumber !== null` plus transition rows; the `opencode-agent-fix-command` change documents the exact seams (vocabulary → predicate → `acceptedCommands` → workflow arm → README).
- **Follow-up commit flow**: `ensureBranch` (drift-guarded, branch `agent/issue-<n>`) → edit → `commitAll` with commit-repair rounds → reconcile before push (`git-reconcile.ts`: merge, never rebase/force — the branch is shared with humans) → push under the agent job's `contents: write`; protected paths are dropped at staging (`stageAllowed`), and CI does not run on the agent's pushes, so "commit checks" means the repo's own check command run locally (the CI-fix path's `AGENT_CHECK_COMMAND` precedent). Untrusted comment text reaches prompts only through the `mintEnvelope` framing (`prompts.ts`).
- **No existing change covers this**: `openspec/changes/` has no follow-up-command entry (checked all 120 folders + grep).

## Intended behaviour change

1. `/follow-up` joins `SLASH_COMMANDS` in `commands.ts` with **no `COMMAND_SIGNALS` entry** (side operation, `/sync` shape).
2. `COMMAND_APPLIES['/follow-up'] = (state) => (state.phase === 'COMPLETE' || state.phase === 'PR_DELIVERY') && state.prNumber !== null` — exactly "delivered, with an open PR" — so `acceptedCommands` offers it there and nowhere else, and every refusal/offer hint derives automatically.
3. **Surface**: accepted on the open PR (primary). Per the issue's explicit wording, also accepted on the originating issue's thread once the PR exists — a deliberate, documented exception carved out of `commandSurface`'s `elsewhere` refusal in `applyTrigger` for `/follow-up` only; the reply posts where it was typed (`postAnswer` posts on the trigger surface). **Assumption**: this reads the issue's parenthetical literally; the strict alternative (issue-typed `/follow-up` gets the standard "belongs on the pull request" pointer) is one line to flip and the maintainer can veto at the park.
4. New handler `runFollowUp` (`src/phases/follow-up.ts`, `runSync`/`answer.ts` shape) dispatched via a `followUp?: boolean` on `TriggerOutcome`, consumed beside the `sync` flag in the orchestrator:
   - **Size gate FIRST, before any write**: one assessment model turn over the enveloped request + branch/change-folder context returns small or too-big with the reason. Small = bounded diff (order of tens of lines), files the change already touched or trivially adjacent, no new capability/scope, no schema/migration/API-surface change. The decision + reason is stated in the reply on **both** paths.
   - **Small**: apply on the same branch (TDD when applicable), run the affected tests plus the repo's check command, `commitAll` (commit-repair rounds apply), reconcile + push, report what was applied (files, checks, commit sha). **Never** re-runs the review loop — that stays `/review`.
   - **Too big**: zero git operations, branch untouched; reply declining with the reason plus a ready-to-paste issue draft (title + scoped description) referencing the PR.
   - An argument-less `/follow-up` is refused with usage, buying no turn. Token ceiling asked before the assessment turn (over budget → notice, no turn); spend recorded in place via `state-persist.ts`; phase, `attempts`, `resumeFrom` and per-PR budgets byte-identical after every outcome (assert the persisted state, not the returned status).
5. `.github/workflows/agent-pipeline.yml` PR-comment arm gains `/follow-up` in the `contains` list — forced red-first by `workflow.test.ts`, which differential-tests the arm against `SLASH_COMMANDS`. `bun workflows:lint` green.
6. Docs: `opencode-agent/README.md` gains the command-table row and a `### /follow-up` section; `opencode-agent/CLAUDE.md` notes the surface exception. The refusal/offer hint and waiting comment keep deriving from `acceptedCommands` — no hardcoded command list anywhere (the #438 pattern). No config knobs: the threshold is the agent's judgment by design.

## Files to touch

`opencode-agent/src/commands.ts`, `opencode-agent/src/triggers.ts`, `opencode-agent/src/trigger-outcome.ts`, the orchestrator's `driveMachine`, new `opencode-agent/src/phases/follow-up.ts` + a notices renderer (`sync-notices.ts` pattern), `opencode-agent/src/refuseUnknown` wording for the undelivered case, `.github/workflows/agent-pipeline.yml`, `opencode-agent/README.md`, `opencode-agent/CLAUDE.md`, and tests under `tests/opencode-agent/`.

## Repro tests first (TDD)

1. Plain comment on a delivered PR → no run, no reply, no API lookup (document the current behavior as the baseline the command sits on top of).
2. `/follow-up` with a small ask → applied as follow-up commit(s) + report (decision+reason, files, checks, sha); persisted state byte-identical.
3. `/follow-up` with a big ask → refusal reply + new-issue draft, zero commits, zero pushes.
4. `acceptedCommands` offers `/follow-up` exactly in `COMPLETE`/`PR_DELIVERY` with a PR named and nowhere else; issue-surface acceptance post-PR + the wrong-place refusal otherwise; guardrail/workflow pins (fork look-alike, arm list).

## Verification

`bun test tests/opencode-agent/` red-first, then full `bun run test`, `bun run typecheck`, `bun run lint`, `bun check:full`, `bun workflows:lint`. The new handler's logic is mutation-gateable (`opencode-agent/src/`), so tests must kill the verdict-branch and zero-commit-guarantee mutants.

## Capabilities

New capability `opencode-agent-commands` (feature-domain: the issue-agent's maintainer command surface): requirements for `/follow-up` acceptance (phase + surface + argument), size-gate-before-write, applied-path reporting, too-big refusal with issue draft and zero commits, and hint derivation from `acceptedCommands`. skip_specs not proposed — this adds a maintainer-visible requirement.
