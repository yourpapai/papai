# Alert task watch — `task.id` condition + targeted polling

## Goal

Let a user say "notify me when issue #42 changes" as an alert: add a `task.id` condition field (operator `eq` only) to the alert condition schema, give pure per-task watches change-triggered firing semantics, and stop pulling the whole task instance every poll cycle when only per-task watches are active.

## Capability

- `task-watch-alerts` (new; no existing spec under `openspec/specs/` covers the alert system). Without it, the LLM cannot express a single-task watch through `create_alert`, and even a hand-crafted approximation (`and(task.id eq, status changed_to)`) can only fire on that one predicate — never on "any visible change" — while every poll cycle still fetches the entire instance's task list. Extends the existing alert condition/evaluation modules (`src/deferred-prompts/types.ts`, `condition-eval.ts`, `fetch-tasks.ts`, `poller-alerts.ts`) rather than adding a parallel mechanism; no new tool — the surface is the existing `create_alert` input schema.

## Files to touch

- `src/deferred-prompts/types.ts` — add `'task.id'` to `CONDITION_FIELDS`; `FIELD_OPERATORS['task.id'] = ['eq']`; refine condition/cooldown descriptions so per-task watch is discoverable by the LLM.
- `src/deferred-prompts/condition-eval.ts` — `getFieldValue` handles `'task.id'` → `task.id` (plain `eq` predicate); add exported `extractWatchedTaskIds(condition): string[]` (walk and/or tree, collect `task.id` eq leaf values) and `isPureWatchCondition(condition): boolean` (every leaf in the tree is `field='task.id'`, `op='eq'`).
- `src/deferred-prompts/fetch-tasks.ts` — add `fetchWatchedTasks(provider, ids, scope)` calling `provider.getTask` per id under a small fixed p-limit concurrency constant; errors propagate (reject); runs inside `runWithProviderRequestScope`.
- `src/deferred-prompts/poller-alerts.ts` — partition + firing semantics (below).
- `src/tools/create-alert.ts` — update `condition`/tool descriptions to mention per-task watch.
- Tests (failing first): `tests/deferred-prompts/types.test.ts` (task.id accepted with eq, rejected with other ops; composes inside and/or), `tests/deferred-prompts/alerts.test.ts` `evaluateCondition` block (task.id predicate; `extractWatchedTaskIds` on nested trees), `tests/deferred-prompts/fetch-tasks.test.ts` (fetchWatchedTasks calls getTask per id, bounded concurrency, errors propagate), `tests/deferred-prompts/poller-alerts.test.ts` (behaviors below).

## Behaviour change

1. **Schema**: `task.id` leaves validate with `eq` only; `superRefine` operator/value errors carry the existing message shape. Composes under `and`/`or` via the existing `z.lazy` union.
2. **Predicate**: `evaluateCondition` with a `task.id eq X` leaf is true exactly for the task whose `id === X`.
3. **Pure-watch firing** — an alert whose condition tree contains ONLY `task.id eq` leaves (any and/or shape):
   - Fires when a watched task's snapshot-visible fields change vs the previous cycle, reusing the change-gate field set (`LIGHTWEIGHT_SNAPSHOT_FIELDS`, or `RICH_SNAPSHOT_FIELDS` when enrichment applies — pure watches never require enrichment themselves).
   - The first cycle after creation (no stored snapshot for the watched task) establishes the baseline without firing.
   - Cooldown (`lastTriggeredAt`/`cooldownMinutes`, default 60) still gates fires — via the existing eligibility path.
   - Design note: per-watched-task field comparison against `snapshots.get(`${task.id}:${field}`)`, NOT the whole-context `hasTaskChanges` gate — with a targeted fetch the fetched-id set is smaller than the stored snapshot set, so the set-size check in `hasTaskChanges` would always report "changed" and break the semantics. Watched tasks not found by `getTask` are skipped (logged warn), not fatal to the group.
   - On fire, `updateAlertMatchState` runs as today (lastTriggeredAt + matchedTaskIds bookkeeping = watched ids present in the fetched set); snapshots update from whatever was fetched, as today.
4. **Composed conditions unchanged**: any tree mixing `task.id` with other fields keeps today's matched-set edge semantics verbatim — `task.id` merely narrows which tasks can match. No regression to the existing change-gate early return for those groups.
5. **Targeted polling**: fetch is instance-scoped (`fetchAlertTasks` spans all routable context groups of an instance poll). Partition at that level: if EVERY alert across every routable context group is a pure watch, skip `fetchAllTasks` (no `listProjects`/`listTasks`/`searchTasks`) and `fetchWatchedTasks` the union of watched ids; otherwise keep the whole-list path (enrichment as today), and pure-watch alerts inside a mixed instance evaluate their watch semantics against the watched tasks drawn from the full list. Instance pinning (`task_instance_id`, `pinnedBuildProviderFn`) is untouched — the targeted fetch runs on the same pinned provider.

## Non-goals

- No activity/`getTaskHistory` features, no migrations, no changes to alert instance pinning, no new tool, no changes to scheduled-prompt behavior.

## Verification

TDD failing-test-first per the house rules; then `bun run test tests/deferred-prompts`, followed by `bun run typecheck && bun run lint` (and the full suite before finishing, per repo policy). Poller tests must assert: pure-watch instance never calls `listProjects`/`listTasks`/`searchTasks`; fires on a snapshot-visible change to the watched task; does NOT fire on the baseline cycle or unchanged cycles; respects cooldown; mixed group keeps the whole-list path; composed condition still uses matched-set edge semantics.
