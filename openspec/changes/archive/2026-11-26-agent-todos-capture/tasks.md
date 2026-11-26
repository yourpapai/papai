# agent-todos-capture — Tasks

## 1. review-loop capture seam (TDD)

- [x] 1.1 Failing test in `tests/review-loop/`: the line handler fires `reporter.todos` with normalized `{content, status}` items when the stream carries the pinned opencode `todowrite` envelope (fixture line from `walk-drill-target` transcripts, verbatim); `todoread` emits nothing; an unknown tool emits nothing. Verify: `bun test tests/review-loop/`
- [x] 1.2 Add the optional `todos?(todos)` hook to `ProgressReporter` (`review-loop/src/progress-log.ts`) and route `todowrite`/`TodoWrite` `tool_use` parts to it in `review-loop/src/line-handler.ts` (normalize at the decoder boundary per design D2). Verify: `bun test tests/review-loop/`
- [x] 1.3 Failing test then implementation: claude-route `TodoWrite` normalization to `{content, status}` (fixture per documented input schema, design D2). Verify: `bun test tests/review-loop/`

## 2. afk-runner event type (TDD)

- [x] 2.1 Failing test in `tests/afk-runner/`: `agent_todos` schema validation — append- and read-time acceptance of a stamped `L0 agent_todos {agent, todos}` event in `agent-noise-schemas.ts` + the `event-schemas.ts` union. Verify: `bun test tests/afk-runner/`
- [x] 2.2 Declare `AgentTodosEvent` in `afk-runner/src/agent-noise-schemas.ts`, join the union in `afk-runner/src/event-schemas.ts`. Verify: `bun test tests/afk-runner/`

## 3. reporter mapping, dedup, bounds (TDD)

- [x] 3.1 Failing tests in `tests/afk-runner/`: `createAgentReporter` maps the `todos` hook to an `agent_todos` emission; identical consecutive snapshots emit once; content truncates at 200 chars; lists cap at 20 items (design D4). Verify: `bun test tests/afk-runner/`
- [x] 3.2 Implement the mapping, dedup state (per-reporter closure), and bounds in `afk-runner/src/agent-reporter.ts`; thread the hook from `runAgent` options into `runStageAgent`'s reporter wiring (`afk-runner/src/agent-layer.ts`). Verify: `bun test tests/afk-runner/`

## 4. Fold tolerance pin (TDD)

- [x] 4.1 Failing test: kernel fold accounting counts `agent_todos` as tolerated with a snapshot identical to the same log without it; legacy fold replays it as a strict no-op (design D5). Verify: `bun test tests/afk-runner/kernel/ tests/afk-runner/legacy-fold.test.ts`
- [x] 4.2 Confirm no fold/code change is needed — the test passes against the existing tolerance. If it fails, stop and reconsider the design, do not map the type. Verify: same command

## 5. Full verification and docs

- [x] 5.1 Run full `bun test`, `bun run typecheck`, `bun run lint`; run `bun run test:mutate:changed` over the touched gateable files. Verify: all green
- [x] 5.2 Update `docs/architecture/afk-runner.md`: the noise-schema line in Layout (new `agent_todos` L0 type) and the log-fidelity section's L0 taxonomy mention. Verify: docs read coherently with the spec
- [x] 5.3 Live confirmation pass: run one depth-S run against the repo's own runner (`afk-runner start` on a scratch task), then `rg agent_todos <runDir>/events.ndjson` shows captured snapshots riding real agent sessions. Verify: events present, folds tolerant, `afk-runner status` unchanged in shape
