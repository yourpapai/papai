# Tasks: sdd-runner-session-removal

## 1. Removal module

- [ ] 1.1 Write failing tests for the guard+delete module: terminal status
  deletes the run dir; stopped deletes; running refuses with calm-stop
  notice; live owner on any status refuses; guard reads fresh state, not
  caller-supplied rows — `bun test tests/sdd-runner/remove-run.test.ts`
- [ ] 1.2 Implement the removal module (fresh state read, `runHasLiveOwner`,
  `fs.rm` recursive; injectable state reader/liveness/fs seams) —
  `bun test tests/sdd-runner/remove-run.test.ts`

## 2. Screen reducer: delete action and confirmation

- [ ] 2.1 Write failing reducer tests: `(d)` on a deletable row enters a
  confirmation naming changeName + runId; `y` emits the delete action; any
  other key cancels back to the list with cursor preserved; `(d)` on a
  running row is refused with a notice —
  `bun test tests/sdd-runner/tui-session-screen.test.ts`
- [ ] 2.2 Implement the confirm sub-state and its rendering (name, id, hint
  line) — `bun test tests/sdd-runner/tui-session-screen.test.ts`

## 3. Flow wiring

- [ ] 3.1 Write failing tests routing the delete action through the session
  flow seam to the removal module, with success and refusal both rendering
  a notice then re-presenting the refreshed list —
  `bun test tests/sdd-runner/session-flow.test.ts`
- [ ] 3.2 Wire the harness (`index.ts`) and manager loop to the delete
  action; update USAGE key hints —
  `bun test tests/sdd-runner/ && bun run typecheck`

## 4. Gates and docs

- [ ] 4.1 Run the full gate set — `bun run test`, `bun run typecheck`,
  `bun run lint`, `bun security`
- [ ] 4.2 Update `docs/architecture/sdd-pipeline.md` (session screen key
  surface: delete + confirmation + guard) — `bun run lint`
