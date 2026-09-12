## Goal

The issue agent's `INIT_OR_CLARIFY` park is a dead end. After a triage turn ends in `clarify` or `answer`, the phase accepts only `/ask` and `/cancel` — while the agent's own replies invite `/continue` (live: issue #435, runs 34487095353 / 34489188396 / 34491614495: the agent said the issue "needs no clarification — reply here (or `/continue`)", then refused `/continue` with "does not apply"). A plain reply does re-run triage (`applyClarifyIntent`), but that forward path is undiscoverable and contradicted by the refusal hint. Give the park a documented, machine-true forward path.

## Root cause

`TRANSITIONS['INIT_OR_CLARIFY']` carries only `NEEDS_CLARIFICATION`/`CAPTURED`; `canTransition` gates `CONTINUE` to `INCOMPLETE` and `RETRY` to `FAILED`. `acceptedCommands()` derives the "What works here" hint from that table, so the hint truthfully lists `/ask`, `/cancel` while the model's prose suggests `/continue`.

## Intended behaviour change

- **`/continue` in `INIT_OR_CLARIFY`: accepted as a non-moving re-entry.** Phase stays, `resumeFrom` untouched, `attempts`/`lastError` cleared (the `ANSWERED` patch), so the cascade re-runs triage with the command visible in the thread — the agent captures and parks at `DESIGN_SPEC`. Everywhere else `CONTINUE` keeps its resume-from-`INCOMPLETE` semantics.
- **`/approve` in `INIT_OR_CLARIFY`: accepted** via a new `APPROVED: 'INIT_OR_CLARIFY'` self-loop — same re-entry, and the one-word confirmation the untrusted-author consent park ("Ready to capture") was missing.
- `/retry` stays refused there (nothing broke; `/continue` or a plain reply re-runs triage).
- Refusal hint and waiting comment now list `/approve`, `/ask`, `/cancel`, `/continue` — still derived from the table, so they cannot drift. `/ask`, `/cancel` semantics unchanged; no persisted-shape change, no `STATE_VERSION` bump; budgets unchanged.
- `TRIAGE_INSTRUCTIONS` gains one line: invite plain thread replies; never suggest a slash command a phase may refuse.

## Files to touch

- `opencode-agent/src/transitions.ts` — `canTransition`, the `CONTINUE` branch in `transition`, the `APPROVED` row, doc comments (lines 154–158 and the `commands.ts` 12–16 counterpart).
- `opencode-agent/src/commands.ts` — `/continue` doc comment only (offer derives automatically).
- `opencode-agent/src/prompts.ts` — one line in `TRIAGE_INSTRUCTIONS`.
- `opencode-agent/README.md` — phase table `INIT_OR_CLARIFY` row, command table `/approve` + `/continue` rows, one sentence on the forward path.
- Tests: `tests/opencode-agent/state-manager.test.ts` (new re-entry tests; fix the two assertions the new rows invalidate: `transition(initialState(1),'APPROVED')` at line 475 and the `CONTINUE is refused in %s` filter at line 703); `tests/opencode-agent/commands.test.ts` (acceptedCommands for `INIT_OR_CLARIFY`); `tests/opencode-agent/orchestrator.test.ts` (repro + updates in `commands and budgets`: seed `PLANNING` for the `/approve`-refused case, hint now includes `/approve`/`/continue` and still excludes `/review`).

## Verification

TDD — repro test first in `orchestrator.test.ts` (`phase 1 — triage`): seeded parked `INIT_OR_CLARIFY` (attempts 0, no capture) → `/continue` → triage re-runs, run ends `waiting` at `DESIGN_SPEC`, persisted state advanced, no refusal comment. It fails before the fix, passes after. Then the opencode-agent suites, full `bun run test`, `bun check:full`, and `test:mutate:changed` for the touched gateable files.

## Non-goals

- Not auto-proceeding when triage believes nothing needs clarifying (the issue's alternative): the park after `clarify`/`answer` is the phase's human gate; auto-proceeding on model prose needs parsing free text and removes the gate.
- No `/retry` in `INIT_OR_CLARIFY`; no new commands, phases or state fields; no pause/resume or budget changes elsewhere; papai runtime untouched (dev tooling only — no platform/task-instance or scope-model impact).

Capabilities: None — skip_specs proposed because this is fix-class work restoring the machine's own invariant (every persisted state has a command-level forward path); the accepted-command list is derived from the transition table and documented in the workspace README, so no capability delta exists for a downstream observer beyond the repaired behaviour. A maintainer can veto at the park.
