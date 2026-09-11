## 1. Repro — the refused forward path (red)

- [x] 1.1 Add the failing repro to `tests/opencode-agent/orchestrator.test.ts` (`phase 1 — triage`): seed a parked `INIT_OR_CLARIFY` state (attempts 0, no capture), queue one triage reply (`SPEC_REPLY`), send `/continue`; assert triage re-runs, the run ends `waiting` at `DESIGN_SPEC`, the persisted state advanced (`changeName` set, `### Captured` posted) and no refusal comment was posted. Verify: `bun test tests/opencode-agent/orchestrator.test.ts` — the new test fails (`/continue` refused with a "does not apply" comment)

## 2. Machine tests for the new acceptance set (red)

- [x] 2.1 In `tests/opencode-agent/state-manager.test.ts` add the re-entry tests: `/continue` in `INIT_OR_CLARIFY` leaves phase and `resumeFrom` untouched and clears `attempts`/`lastError` (the `ANSWERED` patch); `/approve` in `INIT_OR_CLARIFY` is the same re-entry through the self-loop (`forwardTransition`). Fix the two assertions the new rows invalidate: the `transition(initialState(1),'APPROVED')` throw (~line 475 — replace with a signal the phase still refuses, e.g. `CHANGES_REQUESTED`) and the `CONTINUE is refused in %s` filter (~line 703 — exclude `INIT_OR_CLARIFY`). Verify: `bun test tests/opencode-agent/state-manager.test.ts` — only the new re-entry tests fail (`InvalidTransitionError`)
- [ ] 2.2 In `tests/opencode-agent/commands.test.ts` pin the derived offer: `acceptedCommands` for `INIT_OR_CLARIFY` is exactly `/approve`, `/ask`, `/cancel`, `/continue`, with `/changes`, `/review`, `/retry`, `/sync` (pre-capture `changeName: null`) and `/fix` absent. Verify: `bun test tests/opencode-agent/commands.test.ts` — the new assertions fail (`/approve`, `/continue` missing from the list)

## 3. State machine — accept the two re-entries

- [ ] 3.1 In `opencode-agent/src/transitions.ts`: widen `canTransition`'s `CONTINUE` branch to accept `INIT_OR_CLARIFY` beside `INCOMPLETE`; split `transition`'s `RETRY`/`CONTINUE` arm — `CONTINUE` out of `INIT_OR_CLARIFY` applies the `ANSWERED` patch (phase stays, `resumeFrom` untouched, `attempts: 0`, `lastError: null`), `INCOMPLETE` keeps `resumeTransition` unchanged; update the doc comments stating the old acceptance set (~lines 154–158). Verify: `bun test tests/opencode-agent/state-manager.test.ts tests/opencode-agent/commands.test.ts` — green; 1.1 green via `bun test tests/opencode-agent/orchestrator.test.ts` (only the two stale `commands and budgets` assertions stay red until 4.1)
- [ ] 3.2 Add the `APPROVED: 'INIT_OR_CLARIFY'` self-loop row with a doc comment naming the `NEEDS_CLARIFICATION` precedent; update the `/continue` doc comment in `opencode-agent/src/commands.ts` (~lines 12–16, comment only — the offer derives). Verify: `bun test tests/opencode-agent/state-manager.test.ts` — both `APPROVED` shapes pinned (forward from `DESIGN_SPEC`, self-loop from `INIT_OR_CLARIFY`)

## 4. Orchestrator expectations and prose

- [ ] 4.1 Update `commands and budgets` in `tests/opencode-agent/orchestrator.test.ts`: seed `PLANNING` for the `/approve`-refused case (reason becomes "not valid in PLANNING"); the `/changes` refusal hint now includes `/approve` and `/continue` and still excludes `/review`. Verify: `bun test tests/opencode-agent/orchestrator.test.ts` — fully green
- [ ] 4.2 Add one line to `TRIAGE_INSTRUCTIONS` in `opencode-agent/src/prompts.ts`: invite plain thread replies; never suggest a slash command a phase may refuse. Verify: `bun test tests/opencode-agent/` and `bun run lint`

## 5. Docs

- [ ] 5.1 Update `opencode-agent/README.md`: the phase table's `INIT_OR_CLARIFY` row, the command table's `/approve` and `/continue` rows (both name the `INIT_OR_CLARIFY` re-entry), and one sentence on the forward path; read the tables against `acceptedCommands` for a parked state so they cannot overpromise. Verify: `bun run format:check`

## 6. Full verification

- [ ] 6.1 Run the mutation ratchet over the touched gateable files: `bun run test:mutate:changed` for `opencode-agent/src/transitions.ts`, `prompts.ts`, `commands.ts` — no record regresses on `scripts/mutation/baseline.json` (transitions.ts floor 0.974, 149 kills)
- [ ] 6.2 Run `bun check:full`; on failure read `reports/checks/<name>.log` rather than re-running
- [ ] 6.3 Final: full `bun run test` (budget ≥ 20 min; on interruption query `bun run test:status`/`test:log` instead of restarting), `bun run typecheck`, `bun run lint`; sweep `docs/architecture/*.md` for stale statements about `/continue`/`/approve` being refused in `INIT_OR_CLARIFY` and update any affected page (expected: none — the command surface is documented only in `opencode-agent/README.md`)
