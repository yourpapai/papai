# Tasks: fail-fast-on-provider-stall

Test-first throughout: each task writes its failing test(s), then the
implementation, then runs the verification command. Check off as you go.

## 1. Config knob

- [x] 1.1 Failing tests in `tests/opencode-agent/config-values.test.ts`:
  `AGENT_STALL_TIMEOUT_MS` defaults to 300000; `0` parses as disabled;
  non-numeric refuses config load naming the variable; non-zero below 60000
  refuses config load.
- [x] 1.2 Implement in `opencode-agent/src/config-values.ts` beside
  `AGENT_TIMEOUT_MS`.
- [x] 3rd verify: `bun test tests/opencode-agent/config-values.test.ts && bun run typecheck`
  (range/default in `config-clock-values.ts` beside `TIMEOUT_RANGE`, reader
  `stallTimeoutMs` in `config-values.ts` where `parseBounded` lives, field on
  `PipelineConfig`; config-literal fakes updated)

## 2. Stall clock in the stall record

- [x] 2.1 Failing tests in `tests/opencode-agent/turn-stall.test.ts`: the
  tracker stamps `lastProgressAt` at creation, on every step activity, and on
  every tool-`running` activity; a step clears retry evidence as today.
- [x] 2.2 Implement: extend `TurnStall` in `opencode-agent/src/turn-stall.ts`
  with `lastProgressAt`; stamp in `opencode-agent/src/progress.ts` (the tracker
  holds `now`; `foldStall` stays pure).
- [x] 2.3 Verify: `bun test tests/opencode-agent/turn-stall.test.ts tests/opencode-agent/progress.test.ts`
  (the two old `toEqual` stall assertions in `progress.test.ts` became
  `toMatchObject` — the stamp is a new field, not a change to the evidence)

## 3. `TURN_STALL` classification

- [x] 3.1 Failing tests in `tests/opencode-agent/errors.test.ts`:
  `turnStallError` carries code `TURN_STALL`, the stall window, retry count and
  `ProgressSnapshot`; `isTurnStall` matches it and rejects others; message
  names the stall (not the whole-turn deadline) and invites `/retry`.
- [x] 3.2 Implement `turnStallError` / `isTurnStall` in
  `opencode-agent/src/errors.ts` beside the deadline pair.
- [x] 3.3 Verify: `bun test tests/opencode-agent/errors.test.ts`

## 4. Mid-turn stall watcher

- [x] 4.1 Failing tests (injected schedule + fake tracker, no real time) for
  `runTurn`: fires `turnStallError` when no progress for the window AND retry
  evidence present; does not fire when slow only (no retry evidence); does not
  fire when a step/tool-start landed inside the window; disabled (`0`) never
  fires; passes the rejection through before the `alive()` probe.
- [x] 4.2 Implement: second reader on the heartbeat tick in
  `opencode-agent/src/heartbeat.ts`; watcher + race in
  `opencode-agent/src/turn-run.ts`.
- [x] 4.3 Verify: `bun test tests/opencode-agent/turn-run.test.ts tests/opencode-agent/heartbeat.test.ts`
  (the watcher's schedule rides `TurnBounds.schedule`, handed to the heartbeat
  alongside the reader; `contain.ts` plumbs `stallTimeoutMs` + the run clock)

## 5. Salvage parity, skip the wrap-up ask

- [x] 5.1 Failing tests: `turn-stop` skips the soft ask for `TURN_STALL` (goes
  straight to hard abort + salvage) but keeps it for `TURN_DEADLINE`;
  implement-phase deadline branch sites accept `isTurnStall` alongside
  `isTurnDeadline`.
- [x] 5.2 Implement in `opencode-agent/src/turn-stop.ts` and the branch sites
  under `opencode-agent/src/phases/`.
- [x] 5.3 Verify: `bun test tests/opencode-agent/turn-stop.test.ts tests/opencode-agent/phases.test.ts`
  (the stall leaves by the failure door — rethrown after the salvage, so
  `failRun` parks FAILED with `/retry` as the remedy, not `INCOMPLETE`)

## 6. Provider text into the encrypted transcript

- [x] 6.1 Re-verify the `session.status retry` / `session.error` payload field
  carrying the provider message against the pinned `@opencode-ai/sdk` types;
  re-record fixtures if the shape moved.
  (verified against 1.18.16: retry carries `status.message: string`, error
  carries `error.data.message: string` — the recorded fixtures already match,
  no re-record needed)
- [x] 6.2 Failing tests in `tests/opencode-agent/activity-detail.test.ts`:
  retry-with-message and error-with-message events decode to transcript rows
  (`tool: 'provider'`); the public-log decoder (`activity.ts`) still drops the
  message; a redacted-looking value survives only through the transcript sink.
- [x] 6.3 Implement the decoder in `opencode-agent/src/activity-detail.ts` and
  the feed in `opencode-agent/src/progress.ts`; no schema change to
  `debug-transcript.ts` rows.
- [x] 6.4 Verify: `bun test tests/opencode-agent/activity-detail.test.ts tests/opencode-agent/progress.test.ts tests/opencode-agent/debug-transcript.test.ts`

## 7. Docs and full gates

- [x] 7.1 Update `opencode-agent/CLAUDE.md` local rules (stall bound doctrine,
  transcript widening) and `opencode-agent/README.md` config table with
  `AGENT_STALL_TIMEOUT_MS`.
- [x] 7.2 Full gates: `bun run test`, `bun run typecheck`, `bun run lint`,
  `bun run test:affected` sanity, and `openspec validate --strict` for this
  change.
  (all green: 15,929 pass / 0 fail full suite; typecheck, lint, format:check,
  knip, duplicates and `bun workflows:lint` clean — the knob also rides
  `vars.AGENT_STALL_TIMEOUT_MS` in `agent-pipeline.yml` beside
  `AGENT_TIMEOUT_MS`, which `workflow.test.ts`'s README-knob audit requires;
  max-lines splits landed as three new modules: `turn-errors.ts`,
  `turn-answer.ts`, `progress-lines.ts`)
