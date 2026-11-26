## Why

Every task-provider HTTP call is fail-closed on a provider request scope (`requireProviderRequestScope` in `src/analytics/provider-request-scope.ts`); the scope-plumbing commit (`3cd31fe74`) wired every provider-I/O invocation path — LLM tools, deferred prompts, alerts, identity, membership — except the recurring-task scheduler. Since then, every due recurring task dies at its first provider I/O with the controlled `provider_scope_missing` failure (the production log's "provider request scope is missing, malformed, or closed"), so recurring task instances are never created for any provider.

## What Changes

- New scheduler scope builder in `src/analytics/provider-scope-factory.ts` (extends the existing factory that already covers `proactive`/`settings`/`command`): builds one immutable actor scope per due recurring task with `invocationMode: 'scheduler'`, `actorRole: 'system'`, and the recurring task owner as `chatUserId`; identity fields derive from the owner's storage-context id via the same route parsing `scheduler-recurring.ts` already uses.
- `src/scheduler.ts` `executeRecurringTask` runs provider resolution, `createTask`, and finalization (label application) inside `runWithProviderRequestScope` with that scope; when analytics is off or the owner's platform route is unresolvable, the builder returns the explicit `NO_ANALYTICS_SCOPE` sentinel — execution never fails for scope reasons.
- Scope resolution is injectable through `SchedulerDeps` (DI, matching the `resolveScope` pattern in `poller-alerts.ts`).

## Capabilities

### New Capabilities

- `recurring-task-provider-scope`: the recurring-task scheduler executes task-provider I/O inside a valid provider request scope attributed to scheduler invocation; analytics observes those requests, or execution proceeds unobserved via the explicit sentinel when analytics/identity is unresolvable.

  Without it: recurring task instances are never created (fail-closed I/O rejects before any request), and scheduler-driven provider usage stays invisible to analytics.

### Modified Capabilities

None — no existing spec under `openspec/specs/` covers the scheduler; the analytics schema already reserves `invocation_mode='scheduler'` and `actor_role='system'` (`src/analytics/contracts.ts`), so no analytics contract changes.

## Impact

- Code: `src/analytics/provider-scope-factory.ts` (new builder + `resolveSchedulerProviderRequestScope` runtime wrapper), `src/scheduler.ts` (wiring, DI), `src/scheduler-recurring.ts` (route derivation reuse), tests under `tests/analytics/` and `tests/`.
- Providers/platforms: provider-agnostic — fixes Kaneo, YouTrack, and contributed providers (e.g. GitHub) alike; applies to all platform instances, since recurring tasks execute per owner storage-context id.
- Scope model: no new persisted state; recurring tasks remain group-shared durable assets keyed by config context, execution remains per-user. No config-context layout change.
- Analytics: scheduler provider-request facts begin flowing with `invocation_mode='scheduler'`; the sessionizer already excludes non-`normal`/`command` modes from activity sessions, so session semantics are unchanged.
- Docs: `docs/architecture/behaviors.md` (recurring task execution), `docs/operations/analytics-runbook.md` (new invocation mode appearing in data).

## Non-goals

- Re-attributing `createMissedTasks`: its sole caller (`resume_recurring_task` tool) already executes inside the tool actor scope via `wrapToolExecution`; wrapping it in a scheduler scope would misattribute a user-initiated call. Declined.
- Wrapping chat notification (`notifyUser`) — chat provider I/O is not scope-gated.
- Backfilling recurring occurrences missed while the scheduler was broken — operational data repair, separate concern.
- Changing eligibility, aggregation, or retention semantics for scheduler-mode analytics events beyond the already-shipped schema.
