# agent-todos-board — Tasks

## 1. Todos projection (TDD)

- [x] 1.1 Failing tests in `tests/afk-runner/serve/run-detail.test.ts`: `buildRunDetail` projects `todos` from a log's `agent_todos` events — last snapshot per agent wins, agents ordered by most-recent snapshot seq (descending), each entry `{agent, updatedAt, items: [{content, status}]}` with `updatedAt` = the snapshot's stamped `ts` (design D1); a log with no `agent_todos` events yields `todos: []` with the detail otherwise identical (spec: no-telemetry scenario). Verify: `bun test tests/afk-runner/serve/`
- [x] 1.2 Implement the backwards scan in `afk-runner/src/serve/run-detail.ts` (stop once every seen label has a snapshot and no new labels appear above), populating `RunDetailView.todos`. Verify: `bun test tests/afk-runner/serve/`

## 2. Feed filter (TDD)

- [x] 2.1 Failing test in `tests/afk-runner/serve/run-detail.test.ts`: `recentEventsOf` excludes `agent_todos` and fills before it cuts — a tail dominated by todo events still yields `RECENT_EVENT_LIMIT` non-todo entries reaching past the exclusions (filter-then-slice, design D2); `tool_use`/`step_finish`/`spawned` keep their current feed treatment. Verify: `bun test tests/afk-runner/serve/`
- [x] 2.2 Implement the exclusion in `recentEventsOf` before the bound is applied. Verify: `bun test tests/afk-runner/serve/`

## 3. Board page: panel + live detail

- [x] 3.1 `afk-runner/src/serve/static/index.html`: render the agent todos panel from the detail's `todos` — caption names the source ("agent todos (agent-emitted)"), agent label sub-headings ordered as delivered, items as checkbox-glyph lines (`✓ / → / ·` for completed / in-progress / pending), muted relative age from `updatedAt` (design D4/D6); no panel node at all when `todos` is empty (design D5, spec: no-telemetry + no-panel scenarios). Verify: serving a fixture work dir renders the panel; `bun test tests/afk-runner/serve/`
- [x] 3.2 `afk-runner/src/serve/static/index.html`: live detail — the SSE `snapshot` handler re-fetches the selected run's detail through the existing `openDetail(selectedRun)` path, throttled to one in-flight fetch with a trailing edge (a snapshot during a fetch marks dirty and refetches once after; design D3). Verify: serve a fixture work dir, open a detail, append an `agent_todos` event to its log, observe the panel update within one sweep without user action; `bun test tests/afk-runner/serve/`

## 4. Full verification and docs

- [x] 4.1 Run full `bun test`, `bun run typecheck`, `bun run lint`; run `bun run test:mutate:changed` over `afk-runner/src/serve/run-detail.ts` (the only gateable file; `static/index.html` is not mutation-gateable). Verify: all green
- [x] 4.2 Update `docs/architecture/afk-runner.md` web-board section: the agent todos panel, the live detail re-fetch, and the feed exclusion. Verify: docs read coherently with the spec
- [x] 4.3 Live confirmation pass: serve a work dir holding a run with real `agent_todos` events (e.g. the retained `task-scratch-2` run, six snapshots from two drafters), open the detail — panel shows each agent's last snapshot with a visible age, the feed excludes todo events, and the corpus is byte-unchanged across several open sweeps (spec: read-only scenario). Verify: `afk-runner status` unchanged in shape; no board writes
