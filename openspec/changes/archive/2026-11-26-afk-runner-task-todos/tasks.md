# afk-runner-task-todos — Tasks

## 1. Kernel fold: task records carry text; `todos_missing` is tolerated

- [x] 1.1 Failing test: folding a `task started` event with `detail` stamps `TaskRecord.text`, and `done`/`failed` preserve it through the rebuilt record (text survives finish); then implement — `toKernelEvent` maps the detail onto the kernel `task.started` event, `startTask` stamps it, `finishTask` carries `prior?.text` forward, `TaskRecord` grows the optional field. Verify: `bun test tests/afk-runner/kernel-fold.test.ts` (or the suite housing task-event folds)
- [x] 1.2 Failing test: a log carrying `todos_missing {agent}` events folds with the events counted tolerated and the snapshot identical to the log without them; then implement — the L0 schema in `agent-noise-schemas.ts`, unioned into the event union. Verify: `bun test tests/afk-runner/agent-noise-schemas.test.ts tests/afk-runner/kernel-fold.test.ts`

## 2. Implement work module: started detail + the mandate line

- [x] 2.1 Failing test: `task started` carries the item's text collapsed to one line and truncated at 200 chars (long-line and multiline cases); then implement the append-site detail in `work/implement.ts`. Verify: `bun test tests/afk-runner/implement.test.ts`
- [x] 2.2 Failing test (fake-pipeline prompt capture): fresh and fix prompts carry the todo-tool mandate line, continuation-shaped rebuilds of the base prompt keep it; then implement — the line joins `spawnPromptOf`'s shared guard array. Verify: `bun test tests/afk-runner/implement.test.ts`

## 3. Reporter flag and the mark emission matrix

- [x] 3.1 Failing test: `createAgentReporter().sawTodos()` is false until the todos hook fires and true after any emission; then implement the flag on the reporter closure. Verify: `bun test tests/afk-runner/agent-reporter.test.ts`
- [x] 3.2 Failing test matrix: implementer + zero snapshots on the success path → one `todos_missing` before settle-out; implementer + snapshots → none; non-implementer role → none; validation-failed attempt → none; killed attempt → none; then implement the role-gated emission in `agent-layer.ts`'s success path. Verify: `bun test tests/afk-runner/agent-layer.test.ts`

## 4. Memo projection carries task text additively

- [x] 4.1 Failing test: a parking run's memo tasks projection carries each item's `text` beside status/attempts, and a memo without text fields still validates (pre-change shape); then implement the optional record field in `run-state.ts` (`memo-project` passes records wholesale). Verify: `bun test tests/afk-runner/memo-project.test.ts`

## 5. Board surfaces: walk text, feed detail, missingTodos

- [x] 5.1 Failing test: `buildRunDetail` walk entries carry `text` (null when absent), task feed lines append bounded detail (started text; failed tail), and `missingTodos` lists deduped labels from `todos_missing` events; then implement in `serve/run-detail.ts`. Verify: `bun test tests/afk-runner/run-detail.test.ts`
- [x] 5.2 Render in `serve/static/index.html`: walk rows `id · text`, todos panel no-todos note for `missingTodos` labels; manual board check over a fixture run with and without text-bearing events. Verify: `bun run afk-runner:serve` smoke over a fixture + `bun test tests/afk-runner/`

## 6. Full verification and docs

- [x] 6.1 Run `bun test`, `bun run typecheck`, `bun run lint`; update `docs/architecture/afk-runner.md` (execution-half walk line: started detail, mandate + mark; board section: walk text + panel note) and this change's artifacts if reality forced a delta. Verify: all four green
