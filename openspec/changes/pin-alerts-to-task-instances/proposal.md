# Pin alerts to task instances (Session 1)

## Goal
Pin every alert to the task instance it was created against, so that when a group switches or deletes its task instance, existing alerts are never silently re-pointed at a different tracker's task ids. NULL pins (legacy rows, or contexts with no task instance) preserve today's delivery-context resolution.

## Capability
`alert-task-instance-pinning` — new capability (openspec/specs/ is currently empty). Requirements: (1) each alert records the task instance id it was created against; (2) alert polling builds its task provider from the pinned instance, not the context's current instance; (3) an alert whose pinned instance no longer resolves is auto-cancelled (`status='cancelled'`) with an info log and is never evaluated against a different instance; (4) switching a context's task instance cancels old-instance-pinned alerts delivering into that context; (5) deleting a task instance cancels its pinned alerts before the row goes away (FK cascade remains an integrity net only).

## Files to touch
- `src/db/deferred-schema.ts` — add nullable `taskInstanceId: text('task_instance_id').references(() => taskInstances.id, { onDelete: 'cascade' })` to `alertPrompts` (import `taskInstances` from `./instance-schema.js`, mirroring the `contextSettings` FK pattern).
- `src/db/migrations/081_alert_task_instance_pin.ts` — new migration following `069_alert_matched_task_ids.ts` exactly: `columnExists` guard + `ALTER TABLE alert_prompts ADD COLUMN task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE` (nullable → legacy rows stay NULL). Idempotent.
- `src/db/index.ts` — register `migration081AlertTaskInstancePin` at the end of `MIGRATIONS` (after `migration080ReleaseAnnouncementBodies`).
- `src/deferred-prompts/types.ts` — add `taskInstanceId: string | null` to the `AlertPrompt` domain type.
- `src/deferred-prompts/alerts.ts` — `toAlertPrompt` maps `row.taskInstanceId`; `createAlertPrompt` gains a `taskInstanceId?: string | null` parameter persisted on insert; add a cancel helper, e.g. `cancelActiveAlertsPinnedToInstance(taskInstanceId, configContextId?)` (status→`'cancelled'`, info log per alert; optional delivery-config-context filter for the switch path).
- `src/deferred-prompts/tool-handlers.ts` — in `createAlert`/`executeCreate`, resolve the alert's config context from its delivery target (`getConfigContextIdFromStorageContextId` over the built delivery), read `getContextSettings(configContextId)?.taskInstanceId ?? null`, and plumb it into `createAlertPrompt`. NULL task instance stays NULL.
- `src/deferred-prompts/proactive-llm-helpers.ts` — widen `BuildProviderFn` to `(contextId: string, taskInstanceId?: string | null)` so callers can demand a specific instance.
- `src/providers/resolver.ts` — add `resolveForInstance(contextId, taskInstanceId)` on `TaskProviderResolver`: same descriptor/config/validation path as `resolve` but taking the instance explicitly (context-scoped fields like the YouTrack token still come from `contextId`); missing/inactive instance ⇒ `null`.
- `src/runtime/production-background.ts` — wire `startPollers`'s `buildProviderFn` to pass the pin through to the resolver.
- `src/deferred-prompts/poller-alerts.ts` — `pollAlertsOnce` groups by **effective** instance id: `alert.taskInstanceId ?? getContextSettings(configContextId)?.taskInstanceId ?? null` (NULL ⇒ today's behavior, provider resolution via context). `executeAlertsForInstance` calls `buildProviderFn(configContextId, pinnedTaskInstanceId)`; a non-null pin that no longer resolves (instance deleted) ⇒ auto-cancel the affected alerts with an info log and skip evaluation for them.
- `src/debug/settings/context-task-instance-routes.ts` — in `handlePatch`, when the old `existing?.taskInstanceId` differs from the new one, cancel active alerts pinned to the old instance whose delivery target resolves into `scope.scope.contextId` (info log; they must not silently re-point).
- `src/debug/settings/admin/instances-routes.ts` — in `handleTaskInstanceDelete`, cancel all active alerts pinned to the instance (no context filter) before `deleteTaskInstance(id)`.

## Intended behaviour change
- New alerts store the creating context's current task instance id at creation time.
- Polling routes a pinned alert to the pinned instance's provider even after the context switches; it never evaluates a pinned alert against a different instance.
- Pinned-to-deleted-instance alerts become `cancelled` (either via poller detection or the explicit cancel paths on switch/delete).
- Legacy NULL-pinned alerts behave exactly as today (resolve via delivery context).

## Non-goals
No new condition kinds, no targeted polling, no activity features — later sessions own those.

## Verification (TDD — failing tests first)
- `tests/db/migrations/081_alert_task_instance_pin.test.ts` (template: 069 test): column added, idempotent re-run, FK present via `PRAGMA foreign_key_list(alert_prompts)`, legacy rows stay NULL.
- Extend `tests/db/migration-registration.test.ts` (081 is now the last migration) and `tests/db/deferred-schema.test.ts` (new column).
- `tests/deferred-prompts/alerts.test.ts`: `createAlertPrompt` persists the pinned id; `toAlertPrompt` round-trips it.
- `tests/deferred-prompts/poller-alerts.test.ts`: pinned alert routes to the pinned instance's provider (buildProviderFn receives the pinned id); pinned-to-deleted-instance alert is cancelled, not evaluated; NULL pin behaves as today.
- `tests/debug/settings/context-task-instance-routes.test.ts`: switching instances cancels old-pinned alerts delivered in that context; and a delete-path test cancelling pinned alerts before row deletion.
- Run: `bun run test tests/db tests/deferred-prompts tests/debug/settings/context-task-instance-routes.test.ts`; then `bun run typecheck && bun run lint` (never add lint-disable/type-ignore; split files if max-lines trips).
