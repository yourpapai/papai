# Tasks

## 1. Red: delivery, budget, and prompt tests

- [x] 1.1 Extend `createRecordingSteering` in `tests/utils/test-helpers.ts` to record each `steer` call's options alongside the text (keep the existing `steered: string[]` API), then verify `bun test tests/run-control/steering.test.ts tests/bot-steering.test.ts tests/message-edit/handle.test.ts` still passes.
- [x] 1.2 Add the interrupt-option matrix
 to `tests/run-control/steering.test.ts`: under budget calls `steer(text, { interrupt: true })`; at the cap calls `steer(text)` with no options; `stopRequested` calls with no options; a delivered interrupt leaves no leftover and a not-delivered one leaves the text; verify `bun test tests/run-control/steering.test.ts` fails because the options are not passed yet.
- [x] 1.3 Add `tests/run-control/registry.test.ts` cases proving `begin` initializes `interruptsRequested` to 0, a new run resets it, and two storage contexts count independently; verify `bun test tests/run-control/registry.test.ts` fails because the field does not exist.
- [x] 1.4 Add `tests/bot-steering.test.ts` cases proving a plain mid-run message requests an interrupt, the ack and `turn_steered` fact are unchanged, the fourth message in one run falls back to plain steering, and no new turn is enqueued; verify `bun test tests/bot-steering.test.ts` fails.
- [x] 1.5 Add `tests/message-edit/handle.test.ts` cases proving a W1 edit requests an interrupt, and that the cap and `stopRequested` fall back to plain steering; verify `bun test tests/message-edit/handle.test.ts` fails.
- [x] 1.6 Add `tests/system-prompt.test.ts` assertions that the en and ru steering sections state the after-task rule (finish the current task first, never drop the request) and no longer describe delivery only as a between-steps event; verify `bun test tests/system-prompt.test.ts` fails.

## 2. Green: run-control, call sites, and prompt

- [x] 2.1 Add `interruptsRequested: number` to `RunControl` in `src/run-control/types.ts` and initialize it to 0 in `RunRegistry.begin` (`src/run-control/registry.ts`); verify `bun test tests/run-control/registry.test.ts` and `bun run typecheck` pass.
- [x] 2.2 Export `MAX_INTERRUPTS_PER_RUN = 3` from `src/run-control/steering.ts`; make `requestSteer` pass `{ interrupt: true }` while `!run.stopRequested && run.interruptsRequested < MAX_INTERRUPTS_PER_RUN`, incrementing the count, and plain `steer(text)` otherwise; emit one debug record on fallback with `contextId`, `turnId`, and the count only; verify `bun test tests/run-control/steering.test.ts tests/bot-steering.test.ts tests/message-edit/handle.test.ts tests/run-control/registry.test.ts` and `bun run typecheck` pass.
- [x] 2.3 Update the steering section in `src/i18n/locales/en-system-prompt.ts` and `src/i18n/locales/ru-system-prompt.ts` for mid-run delivery while the model is working, plus the after-task sequencing rule; verify `bun test tests/system-prompt.test.ts tests/commands/locale.test.ts` passes.
- [x] 2.4 Document the interrupt-first delivery, the three-per-run bound, the billing/usage caveat, and the after-task-as-steering rule in `docs/architecture/behaviors.md` (`behavior:mid-run-control`) and `docs/architecture/overview.md`; verify `rg -n "next tool-step boundary|queue\\(\\)|/interrupt|/after" docs/architecture/behaviors.md docs/architecture/overview.md` shows no stale command or queue claims and `bun run format:check` passes.

## 3. Full gate

- [ ] 3.1 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run test:stories`, and `bun run test:mutate:changed --base=HEAD~1`; verify all exit 0, and confirm the architecture pages from 2.4 are in the same commit as the behavior.

## Workflow follow-up

- Archive only after review approval and a green full gate; the spec delta uses a RENAMED + MODIFIED pair for the delivery requirement, which `openspec archive` applies correctly.
- Separate follow-up: persist delivered steering text in history (`collectTurnMessages` currently ignores `experimental_steeringMessages`), taking care not to duplicate W1 edit corrections.
- Separate follow-up: reset or reword the live-status message if a cancelled step's status lingers during the redo.
- Tune `MAX_INTERRUPTS_PER_RUN` from observed billing and latency; the constant is deliberately fixed for v1.
