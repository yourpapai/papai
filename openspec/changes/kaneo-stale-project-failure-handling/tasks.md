## 1. Kaneo classification

- [x] 1.1 Add failing tests to `tests/plugins/task-provider-kaneo/` for `classifyKaneoError`: a `KaneoApiError` with status 400 and the workspace-marker body (string and JSON body shapes) classifies as `project-not-found` with `context.projectId`; a 400 with any other body stays `validationFailed`; 404/401/403/429 classifications are unchanged; `column-resource` list/create and `task-resource` createTask pass the project id context through. Verify: `bun test tests/plugins/task-provider-kaneo/`
- [x] 1.2 Implement the marker classification and context pass-through in `plugins/task-provider-kaneo/classify-error.ts`, `column-resource.ts`, and `task-resource.ts` per design D1. Verify: `bun test tests/plugins/task-provider-kaneo/`
- [x] 1.3 Add an e2e case to `tests/e2e/error-handling.test.ts` pinning the pinned-image behavior: `createTask` against a syntactically valid but nonexistent project id surfaces a `project-not-found` classification (not generic 400). Verify: `bun test tests/e2e/error-handling.test.ts` (requires Docker; CI covers it otherwise)

## 2. Failed-execution recording

- [x] 2.1 Add failing tests for `recordFailedExecution` (new) in the recurring store suite: sets `last_run` and advances `next_run` per the template's rrule; writes no occurrence row; a later `computeMissedDates`/resume does not recreate the failed attempt; null-rrule templates keep `next_run` null. Verify: `bun test tests/recurring*.test.ts tests/scheduler-recurring.test.ts`
- [x] 2.2 Implement `recordFailedExecution` in `src/recurring.ts` reusing the `markExecuted` next-run computation per design D3. Verify: `bun test tests/recurring*.test.ts tests/scheduler-recurring.test.ts`

## 3. Scheduler permanent-failure handling

- [x] 3.1 Add failing tests to `tests/scheduler.test.ts`: on a provider error whose `classifyError` yields `project-not-found`, the scheduler calls `recordFailedExecution` (template leaves the due set until its next occurrence), sends the owner failure DM via the existing route, and no occurrence is recorded; transient errors keep retry-next-tick with untouched run state; notification send failure does not block the schedule advance; unrouteable owner logs a warn and still advances. Verify: `bun test tests/scheduler.test.ts`
- [x] 3.2 Implement the failure branch in `src/scheduler.ts` (`provider.classifyError` check, design D2) and `notifyRecurringFailure` in `src/scheduler-recurring.ts` (design D4). Verify: `bun test tests/scheduler.test.ts tests/scheduler-recurring.test.ts tests/scheduler-integration.test.ts`

## 4. Docs and full gates

- [ ] 4.1 Update `docs/architecture/behaviors.md` recurring bullet: permanent (project-not-found) failures consume the scheduled attempt and notify the owner; transient failures retry next tick. Verify: `openspec validate kaneo-stale-project-failure-handling --strict`
- [ ] 4.2 Run the full gates and fix anything they surface: `bun run test`, `bun run typecheck`, `bun run lint`.
