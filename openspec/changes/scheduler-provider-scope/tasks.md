## 1. Scheduler scope builder (factory)

- [x] 1.1 Add failing tests to `tests/analytics/provider-scope-factory.test.ts` for `buildSchedulerProviderRequestScope`: full attribution (scheduler invocation mode, system actor role, owner as chat user, dm context type, storage/config context ids, task instance/provider from context settings, `scheduler:` source-event prefix); `NO_ANALYTICS_SCOPE` when the owner route is unresolvable or the platform instance is unknown; `resolveSchedulerProviderRequestScope` returns the sentinel when no analytics runtime is active. Verify: `bun test tests/analytics/provider-scope-factory.test.ts`
- [x] 1.2 Implement `buildSchedulerProviderRequestScope` + `resolveSchedulerProviderRequestScope` in `src/analytics/provider-scope-factory.ts` per design D1 (reuse the recurring notification route derivation; never throw). Verify: `bun test tests/analytics/provider-scope-factory.test.ts`

## 2. Scheduler wiring

- [x] 2.1 Add failing tests to `tests/scheduler.test.ts`: `executeRecurringTask` runs provider resolution, `createTask`, and finalization inside one per-task scope from `deps.resolveScope` (default resolver used when not injected); execution still succeeds when the resolver returns `NO_ANALYTICS_SCOPE`; attribution asserted per task for a multi-owner tick. Verify: `bun test tests/scheduler.test.ts`
- [x] 2.2 Wire the optional `resolveScope` into `SchedulerDeps` and wrap the execution body in `runWithProviderRequestScope` in `src/scheduler.ts` per design D2/D3; leave `createMissedTasks` unchanged. Verify: `bun test tests/scheduler.test.ts tests/scheduler-recurring.test.ts tests/scheduler-integration.test.ts`

## 3. Regression proof

- [ ] 3.1 Add a regression test reproducing the production failure shape: with a scope-requiring provider (fail-closed client seam) and the default wiring, a due recurring task creates its instance with no `provider_scope_missing` failure; detached-past-execution I/O still fails closed. Verify: `bun test tests/scheduler.test.ts`

## 4. Docs and full gates

- [ ] 4.1 Update `docs/architecture/behaviors.md` (recurring task execution now runs under a per-task scheduler provider request scope) and `docs/operations/analytics-runbook.md` (scheduler invocation-mode facts now appear in provider-request data). Verify: `openspec validate scheduler-provider-scope --strict`
- [ ] 4.2 Run the full gates and fix anything they surface: `bun run test`, `bun run typecheck`, `bun run lint`.
