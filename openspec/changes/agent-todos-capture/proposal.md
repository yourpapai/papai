# agent-todos-capture — Proposal

## Why

Stage agents already keep live todo lists (opencode `todowrite`), but the payload is discarded at the line-handler seam: the run log records a bare `tool_use {tool: "todowrite"}` marker with no content. An operator supervising a run can see which agent is running but not what the agent is doing inside it. A live run in `walk-drill-target` proves the data exists end-to-end: `transcripts/implement-t2-r2-a1.jsonl` and `resolver-r1-r1-a1.jsonl` carry full `state.input.todos` arrays — they are simply dropped at `formatToolArg`/`parseSlotLine`.

## What Changes

- review-loop's line handler recognizes todo-tool `tool_use` parts (opencode `todowrite`, claude `TodoWrite`) and forwards the parsed list through a new optional `ProgressReporter.todos?` hook — the same optional-hook pattern as `usage?`.
- afk-runner's `createAgentReporter` maps the hook to a new **L0 `agent_todos {agent, todos[]}`** noise event, appended to `events.ndjson` through the existing emit path.
- Identical consecutive snapshots are not re-emitted (dedup by content); item text is bounded (`sanitizeRowGap`-style truncation).
- The kernel and legacy folds tolerate the new type unchanged (unmapped L0 → `tolerated += 1`).

## Capabilities

### New Capabilities

- `afk-runner-agent-todos`: stage-agent todo capture into the run's event log. Without it the log carries todo markers without content, and every downstream reader (board, `analyze`) sees agent activity at tool granularity but never the agents' own plan/progress. No existing module covers this: the capture seam (line-handler `applyEvent` `tool_use` case, input in hand) and the L0 noise lane (`agent-noise-schemas.ts`) both exist — this change extends them rather than adding a parallel mechanism.

### Modified Capabilities

(none — the kernel's fold tolerance over unmapped event types is generic and already specified; adding one tolerated type changes no requirement)

## Non-goals

- Board/UI display of todos, and the detail-pane live-refresh fix — Change B `agent-todos-board` (declined here, separate capability).
- The fold ever driving on todos — they stay tolerated noise, never machine state.
- Reading todos from `transcripts/*.jsonl` or agent session storage — the reporter seam is the one capture point.
- Any steering/action surface over todos — read-only telemetry.
- `analyze` corpus reports surfacing todo telemetry — future reader, nothing breaks without it.
- Prompt changes to make agents use todos — live evidence shows they already do.

## Impact

- `review-loop/src/line-handler.ts`, `progress-log.ts` (new optional hook; third consumer mutation-improve is unaffected — hook is optional and unobserved there).
- `afk-runner/src/agent-reporter.ts`, `agent-noise-schemas.ts` (new schema in the L0 lane; union grows in `event-schemas.ts`).
- No DB, no chat-platform/task instances, no config-context scope impact — todos are run-scoped files under the runner work dir, keyed by run id; nothing is per-user, group-shared, or thread-isolated.
- Docs: `docs/architecture/afk-runner.md` (noise-schema line + L0 taxonomy mention).
