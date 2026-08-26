# Tasks — alert task watch

Assumption from design.md's open question: the `fetchWatchedTasks` concurrency constant is 4 (any small fixed bound in 3–5 satisfies the spec; tunable later).

## 1. Schema: `task.id` condition field (tests first)

- [ ] 1.1 Add failing tests to `tests/deferred-prompts/types.test.ts`: `task.id` accepted with `eq` (string and number value); rejected with any other operator (message names field, invalid operator, `eq` as only valid); rejected without a value; composes under nested `and`/`or` with other fields. Verify they fail: `bun test tests/deferred-prompts/types.test.ts`
- [ ] 1.2 Implement in `src/deferred-prompts/types.ts`: add `'task.id'` to `CONDITION_FIELDS`, `FIELD_OPERATORS['task.id'] = ['eq']`; refine condition/cooldown `.describe()` texts so per-task watch is discoverable. Verify: `bun test tests/deferred-prompts/types.test.ts`

## 2. Predicate + watch classification (tests first)

- [ ] 2.1 Add failing tests to `tests/deferred-prompts/alerts.test.ts` `evaluateCondition` block: `task.id eq X` matches exactly the task with `id === X` and no other; `extractWatchedTaskIds` over nested `and`/`or` trees (dedupe, empty for non-watch trees); `isPureWatchCondition` true for any all-`task.id`-eq tree, false when any other leaf/op appears. Verify they fail: `bun test tests/deferred-prompts/alerts.test.ts`
- [ ] 2.2 Implement in `src/deferred-prompts/condition-eval.ts`: `getFieldValue` case `'task.id'` → `task.id`; export `extractWatchedTaskIds(condition): string[]` and `isPureWatchCondition(condition): boolean` (walk and/or tree per design D2). Verify: `bun test tests/deferred-prompts/alerts.test.ts`

## 3. Targeted fetch (tests first)

- [ ] 3.1 Add failing tests to `tests/deferred-prompts/fetch-tasks.test.ts`: `fetchWatchedTasks` calls `provider.getTask` per id with bounded concurrency (p-limit 4, assert no more than 4 in flight); skips ids whose failure classifies as not-found (`task-not-found`/`not-found` provider error codes) with a warn; rejects on any other error. Verify they fail: `bun test tests/deferred-prompts/fetch-tasks.test.ts`
- [ ] 3.2 Implement `fetchWatchedTasks(provider, ids, scope)` in `src/deferred-prompts/fetch-tasks.ts` per design D5 (module-level p-limit constant 4, `runWithProviderRequestScope` wrapper, not-found skip / other-error reject). Verify: `bun test tests/deferred-prompts/fetch-tasks.test.ts`

## 4. Poller: partition + pure-watch firing (tests first)

- [ ] 4.1 Add failing tests to `tests/deferred-prompts/poller-alerts.test.ts` per spec scenarios: pure-watch instance poll never calls `listProjects`/`listTasks`/`searchTasks` and calls `getTask` for the deduped union of watched ids; fires on a snapshot-visible change to the watched task (lightweight and, when present, rich field sets); does NOT fire on the baseline cycle (no stored snapshot) or on unchanged cycles; respects cooldown; a single-task fetch failure aborts the instance cycle (no fire, no state/snapshot update); missing watched task skipped without failing others; mixed instance keeps the whole-list path (enrichment as today) with pure watches still firing; composed `task.id` + field conditions keep matched-set edge semantics and the whole-context no-change early return. Verify they fail: `bun test tests/deferred-prompts/poller-alerts.test.ts`
- [ ] 4.2 Implement in `src/deferred-prompts/poller-alerts.ts` per design D3/D4: instance-level partition in `fetchAlertTasks` (all-pure → `fetchWatchedTasks` union, else whole-list verbatim); per-task snapshot field compare for pure watches in `executeAlertsForContext` (shared helper; baseline, cooldown, missing-task skip, `updateAlertMatchState` + `updateSnapshots` bookkeeping unchanged). Verify: `bun test tests/deferred-prompts/poller-alerts.test.ts`

## 5. Tool descriptions

- [ ] 5.1 Update `src/tools/create-alert.ts` condition/tool descriptions to mention per-task watch; confirm no capability-gating or `tool_prefs` changes (design D6). Verify: `bun test tests/deferred-prompts && bun run typecheck`

## 6. Full verification

- [ ] 6.1 Run the full suite and gates: `bun run test`, then `bun run typecheck && bun run lint`; fix fallout. Update `docs/architecture/*.md` pages only if they describe alert conditions/polling behavior in enough detail to be affected (check `docs/architecture/behaviors.md`, `docs/architecture/tools.md`).
