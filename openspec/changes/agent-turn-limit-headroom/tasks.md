# Tasks: agent-turn-limit-headroom

Test-first order per design.md Migration Plan; every implementation task is driven by the failing test written before it.

## 1. Turn-limit tracker module (test-first)

- [x] 1.1 Write failing tracker tests in `tests/run-control/turn-limit.test.ts`: `maxSteps` is forwarded to the injected predicate, the predicate's verdict passes through unchanged, `hit` latches true the first time the condition returns true, and `hit` stays false while verdicts are false. Verify: `bun test tests/run-control/turn-limit.test.ts` (red)
- [ ] 1.2 Implement `src/run-control/turn-limit.ts`: export `TURN_LIMIT_STOP_REASON = 'turn_limit'` and `createTurnLimitTracker(stepCountIs, maxSteps)` returning `{ condition, hit }` where `condition` calls the injected predicate and latches `hit` on its first true verdict. Verify: `bun test tests/run-control/turn-limit.test.ts` (green)

## 2. Budget constant raise (test-first)

- [ ] 2.1 Update `tests/run-control/invoke-wiring.test.ts` to import `AGENT_MAX_STEPS` from `src/llm-orchestrator-invoke.js` and assert `stepCountArgs` equals `[AGENT_MAX_STEPS]` instead of the literal `[50]` in both the no-run and active-run cases. Verify: `bun test tests/run-control/invoke-wiring.test.ts` (red)
- [ ] 2.2 Export `AGENT_MAX_STEPS` from `src/llm-orchestrator-invoke.ts` and raise it to 125 (the call site already consumes the constant, so no enforcement change). Verify: `bun test tests/run-control/invoke-wiring.test.ts` (green)

## 3. Cap-out marker and warn (test-first)

- [ ] 3.1 Add failing integration tests in `tests/llm-orchestrator-invoke.test.ts`: a real AI SDK loop whose mock model returns tool-calls for `AGENT_MAX_STEPS` steps must produce an `llm:end` event carrying `stopReason: 'turn_limit'` and `steps === AGENT_MAX_STEPS`, plus a structured warn naming `contextId`, `turnId`, and `steps` (identifiers only); a turn finishing naturally (`stop`) must carry no `stopReason` field and emit no warn. Verify: `bun test tests/llm-orchestrator-invoke.test.ts` (red)
- [ ] 3.2 Add optional `stopReason?: 'turn_limit'` to the `emitLlmEnd` analytics param in `src/llm-orchestrator-events.ts`, spread into event data only when present (no analytics schema or fact changes). Verify: `bun test tests/analytics/llm-tool-integration.test.ts` (green; marker assertions still red)
- [ ] 3.3 Wire the tracker in `src/llm-orchestrator-invoke.ts`: build it in `callGenerateText`, use `tracker.condition` in both `stopWhen` branches, return `{ result, turnLimitHit }`; in `invokeModel` emit one pino warn `{ contextId, turnId, steps }` on hit and pass `stopReason: 'turn_limit'` to `emitLlmEnd`. Verify: `bun test tests/llm-orchestrator-invoke.test.ts tests/run-control/invoke-wiring.test.ts` (green)

## 4. Behavior preservation

- [ ] 4.1 Confirm cap-out still ends in the existing truncated-verdict flow with no new user-visible surface (no user-facing text or error change), across the verified-completion, run-control, and orchestrator lanes the change can reach. Verify: `bun run test:affected`

## 5. Docs and full gates

- [ ] 5.1 Document the 125-step default and the `stopReason: 'turn_limit'` marker in `docs/architecture/behaviors.md` next to the verified-completion/truncation section. Verify: `bun run format:check`
- [ ] 5.2 Full verification: `bun run test` (with coverage ratchet), `bun run typecheck`, `bun run lint`, and `bun check:full` all green; state the old → new budget (50 → 125) explicitly in the MR description. Verify: `bun check:full`
