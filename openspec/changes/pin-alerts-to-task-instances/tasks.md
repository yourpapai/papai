# Tasks: Pin alerts to task instances

Order follows design.md's TDD order of work; every task is test-first (failing test before implementation). Spec contract: `specs/alert-task-instance-pinning/spec.md`.

## 1. DB layer: column, migration, registration

- [x] 1.1 Write failing migration test `tests/db/migrations/081_alert_task_instance_pin.test.ts` (template: the 069 test) covering: column added, idempotent re-run, FK present via `PRAGMA foreign_key_list(alert_prompts)`, legacy rows stay NULL. Verify: `bun run test tests/db/migrations/081_alert_task_instance_pin.test.ts`
- [x] 1.2 Extend `tests/db/migration-registration.test.ts` (081 is now last) and `tests/db/deferred-schema.test.ts` (new column) with failing assertions. Verify: `bun run test tests/db/migration-registration.test.ts tests/db/deferred-schema.test.ts`
- [x] 1.3 Add nullable `taskInstanceId` column (FK → `taskInstances.id`, `onDelete: 'cascade'`) to `alertPrompts` in `src/db/deferred-schema.ts`. Verify: `bun run test tests/db/deferred-schema.test.ts`
- [x] 1.4 Create `src/db/migrations/081_alert_task_instance_pin.ts` (`columnExists` guard + `ALTER TABLE alert_prompts ADD COLUMN task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE`) and register it last in `MIGRATIONS` in `src/db/index.ts`. Verify: `bun run test tests/db`

## 2. Domain type and persistence helpers

- [x] 2.1 Extend `tests/deferred-prompts/alerts.test.ts` with failing tests: `createAlertPrompt` persists the pinned id; `toAlertPrompt` round-trips it (both non-null and NULL); `cancelActiveAlertsPinnedToInstance` sets `status='cancelled'` and honors the optional config-context filter. Verify: `bun run test tests/deferred-prompts/alerts.test.ts`
- [x] 2.2 In `src/deferred-prompts/types.ts` add `taskInstanceId: string | null` to `AlertPrompt`; in `src/deferred-prompts/alerts.ts` map it in `toAlertPrompt`, add the `taskInstanceId?: string | null` parameter to `createAlertPrompt`, and add `cancelActiveAlertsPinnedToInstance(taskInstanceId, configContextId?)` (info log per cancelled alert). Verify: `bun run test tests/deferred-prompts/alerts.test.ts`

## 3. Creation-time pin capture

- [x] 3.1 Add failing test coverage for alert creation pinning: alert created in a context with instance A configured is pinned to A; context with NULL instance stays NULL (derive config context from the built delivery target). Verify: `bun run test tests/deferred-prompts/tool-handlers.test.ts`
- [x] 3.2 In `src/deferred-prompts/tool-handlers.ts` (`createAlert`/`executeCreate`) resolve the delivery target's config context (`getConfigContextIdFromStorageContextId`), read `getContextSettings(configContextId)?.taskInstanceId ?? null`, and pass it to `createAlertPrompt`. Verify: `bun run test tests/deferred-prompts/tool-handlers.test.ts`

## 4. Pinned-instance evaluation in the poller

- [x] 4.1 Extend `tests/deferred-prompts/poller-alerts.test.ts` with failing tests: pinned alert routes to the pinned instance's provider (`buildProviderFn` receives the pinned id, not the context's current one); pinned-to-unresolvable-instance alert is auto-cancelled (`status='cancelled'`, info log) and not evaluated; NULL pin behaves as today (effective instance from context settings). Verify: `bun run test tests/deferred-prompts/poller-alerts.test.ts`
- [x] 4.2 Add `resolveForInstance(contextId, taskInstanceId)` to `TaskProviderResolver` in `src/providers/resolver.ts`: same descriptor/config/validation path as `resolve`, context-scoped fields still from `contextId`; missing/inactive instance ⇒ `null`. Verify: `bun run test tests/providers`
- [x] 4.3 Widen `BuildProviderFn` in `src/deferred-prompts/proactive-llm-helpers.ts` to `(contextId: string, taskInstanceId?: string | null)`. Verify: `bun run typecheck`
- [x] 4.4 In `src/deferred-prompts/poller-alerts.ts` group `pollAlertsOnce` by effective instance (`alert.taskInstanceId ?? getContextSettings(configContextId)?.taskInstanceId ?? null`); `executeAlertsForInstance` calls `buildProviderFn(configContextId, pinnedTaskInstanceId)` and auto-cancels alerts whose non-null pin no longer resolves (info log, skip evaluation). Verify: `bun run test tests/deferred-prompts/poller-alerts.test.ts`
- [x] 4.5 Wire `startPollers`' `buildProviderFn` in `src/runtime/production-background.ts` to pass the pin through to `resolveForInstance`. Verify: `bun run test tests/deferred-prompts/poller-alerts.test.ts && bun run typecheck`

## 5. Cancel paths on instance switch and delete

- [x] 5.1 Extend `tests/debug/settings/context-task-instance-routes.test.ts` with failing tests: switching a context's task instance (old ≠ new) cancels active alerts pinned to the old instance whose delivery target resolves into that config context, while NULL-pinned and other-instance-pinned alerts stay active. Verify: `bun run test tests/debug/settings/context-task-instance-routes.test.ts`
- [ ] 5.2 In `src/debug/settings/context-task-instance-routes.ts` `handlePatch`, when `existing?.taskInstanceId` differs from the new value, call `cancelActiveAlertsPinnedToInstance(oldInstanceId, scope.scope.contextId)` with an info log. Verify: `bun run test tests/debug/settings/context-task-instance-routes.test.ts`
- [ ] 5.3 Add failing delete-path test: deleting a task instance cancels all its pinned active alerts (across all delivery contexts, info log) before the instance row is removed. Verify: `bun run test tests/debug/settings/admin/instances-routes.test.ts`
- [ ] 5.4 In `src/debug/settings/admin/instances-routes.ts` `handleTaskInstanceDelete`, call `cancelActiveAlertsPinnedToInstance(id)` (no context filter) before `deleteTaskInstance(id)`. Verify: `bun run test tests/debug/settings/admin/instances-routes.test.ts`

## 6. Full verification and docs

- [ ] 6.1 Run the full suite: `bun run test` (then `bun run test:failures` if anything fails). Verify: `bun run test`
- [ ] 6.2 Run `bun run typecheck && bun run lint` (no lint-disable/type-ignore; split files if max-lines trips). Verify: `bun run typecheck && bun run lint`
- [ ] 6.3 Update affected docs (`docs/architecture/behaviors.md` alert/task-instance sections, `docs/architecture/tools.md` if alert tool behavior is described) to document pinning, NULL-pin semantics, and the cancel paths. Verify: docs render and match shipped behavior
