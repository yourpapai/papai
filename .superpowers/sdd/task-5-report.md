# Task 5 Report — Isolate Poller Lifecycle From The Global Scheduler

**Status:** Complete. RED observed, GREEN reached, committing on `hermetic-stories-continue`.

## What was delivered

Extracted the poller start/stop/snapshot logic out of `src/deferred-prompts/poller.ts`
into a scheduler-injected factory `createPollerLifecycle(scheduler)` living in
`src/deferred-prompts/poller-lifecycle.ts` (the pre-existing home of
`stopRegisteredPollerTask`). The module-global `isRunning` flag is now a
factory-local closure variable. `poller.ts` keeps its public exports
(`startPollers`, `stopPollers`, `getPollerSnapshot`, `PollerSnapshot`) by
constructing one `defaultPollerLifecycle` from the singleton scheduler and
delegating each call to it. Interval constants (`ALERT_POLL_MS`,
`SCHEDULED_POLL_MS`) and task-name strings moved into `poller-lifecycle.ts`.

## Files

- `src/deferred-prompts/poller-lifecycle.ts` — added `createPollerLifecycle`,
  `PollerLifecycle`, `PollerSnapshot`; kept `stopRegisteredPollerTask`.
- `src/deferred-prompts/poller.ts` — removed inline registration/state; exports
  now delegate to `defaultPollerLifecycle`. Dropped the now-unused
  `pollAlertsOnce` / `MAX_CONCURRENT_USERS` imports.
- `tests/deferred-prompts/poller-lifecycle.test.ts` — new factory-isolation
  test (real `createScheduler`, `createMockChat`, throwing `BuildProviderFn`,
  `afterEach` = `stopPollers()` + `drainAll()`).

## TDD evidence — RED

```
$ bun test tests/deferred-prompts/poller-lifecycle.test.ts
SyntaxError: Export named 'createPollerLifecycle' not found in module
'.../src/deferred-prompts/poller-lifecycle.ts'.
 0 pass
 1 fail
```

Failed for the expected reason (symbol absent), not a typo.

## TDD evidence — GREEN

```
$ bun test tests/deferred-prompts/poller-lifecycle.test.ts
 2 pass
 0 fail
 9 expect() calls
```

## Regression sweep (per brief Step 4 + public-export consumers)

```
$ bun test tests/deferred-prompts/poller-lifecycle.test.ts \
            tests/deferred-prompts tests/utils/scheduler
 359 pass / 0 fail

$ bun test tests/debug/debug-snapshots.test.ts \
            tests/runtime/production-background.test.ts
 16 pass / 0 fail   # getPollerSnapshot / startPollers / stopPollers consumers

$ bun run typecheck  # tsgo --noEmit — clean
$ bun run lint       # oxlint — clean
```

## Tests added

Two tests in `poller-lifecycle.test.ts`:

1. **Brief's exact test** — `startPollers` called twice registers exactly
   once (idempotent via factory-local `isRunning`); after `stopPollers` +
   `drainAll`, both `deferred-scheduled-poll` and `deferred-alert-poll` are
   unregistered. Verifies the supplied (not singleton) scheduler drives
   registration.
2. **Factory-local snapshot state** — locks in the refactor's core property:
   `getPollerSnapshot().scheduledRunning`/`alertsRunning` track the
   lifecycle's own `isRunning`, not a module global. Without this, a
   regression back to module-global state would silently pass test #1.

## Design note / concern — destination file

The brief listed `Modify: src/deferred-prompts/poller.ts` and a literal
`git add` of only `poller.ts` + the new test. The repo's Write/Edit TDD hook
rejects a test file whose name doesn't match the source module it imports —
`poller-lifecycle.test.ts` must import from `src/deferred-prompts/poller-lifecycle.ts`.
Since `poller-lifecycle.ts` already existed (holding `stopRegisteredPollerTask`)
and is the natural module for the factory, the implementation was placed there
and `poller.ts` imports `createPollerLifecycle` from it. This honors the
brief's intent (extract the seam, preserve public exports) and the project's
TDD-hook parity rule, but means `src/deferred-prompts/poller-lifecycle.ts` is
also staged in the commit, expanding the brief's `git add` line by one file.

## Design note — circular import

`poller-lifecycle.ts` imports `pollScheduledOnce` from `poller.ts`, while
`poller.ts` imports `createPollerLifecycle` from `poller-lifecycle.ts`. This
is a soft ESM cycle that resolves cleanly because both cross-references are
function declarations (hoisted live bindings) and are only invoked at runtime
inside closures — never during module evaluation. The pre-existing
`poller.ts -> poller-lifecycle.ts` edge (for `stopRegisteredPollerTask`) is
unchanged in direction; only the reverse edge was added. Verified by the
green test run and by `tsgo --noEmit`.

## Concern — singletons untouched

The singleton `scheduler` in `src/scheduler-instance.ts` and its
`registerDefaultSchedulerTasks` registration are unchanged. The default
lifecycle is constructed against that singleton at `poller.ts` module load,
so existing callers (`runtime/production-background.ts`,
`debug/state-collector.ts`) see identical behavior. No production call site
was migrated to the factory directly — that wiring is left for a later task
per the brief's scope ("Extract … preserving existing public exports").
