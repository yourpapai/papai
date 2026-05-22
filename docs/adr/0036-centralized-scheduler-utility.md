<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0036: Centralized Scheduler Utility

## Status

Accepted

## Context

The papai codebase had multiple locations using raw `setInterval` for periodic tasks:

1. **User cache cleanup** (`src/cache.ts`) — Every 5 minutes, removes expired user session caches
2. **Message cache sweep** (`src/message-cache/cache.ts`) — Daily, removes messages older than one week
3. **Message cleanup scheduler** (`src/message-cache/persistence.ts`) — Hourly, cleans expired messages from SQLite
4. **Wizard session cleanup** (`src/wizard/state.ts`) — Every 10 minutes, removes stale wizard sessions
5. **Recurring tasks** (`src/scheduler.ts`) — Every 60 seconds, processes recurring task automation
6. **Deferred prompt pollers** (`src/deferred-prompts/poller.ts`) — Multiple intervals for scheduled and alert polling

This scattered approach had several problems:

- **No centralized error handling** — Task failures were not caught or logged consistently
- **No retry logic** — Transient failures would not be retried, potentially missing critical cleanup
- **No graceful shutdown** — Raw `setInterval` timers prevent clean process termination
- **No monitoring/observability** — No way to track task execution metrics or failures
- **No cron support** — Only millisecond intervals supported, limiting scheduling flexibility
- **Code duplication** — Each module implemented its own interval management

## Decision Drivers

- **Error resilience**: Tasks should retry with exponential backoff on transient failures
- **Graceful shutdown**: Application must stop all scheduled tasks cleanly on SIGTERM
- **Observability**: Need visibility into task execution duration, errors, and retry attempts
- **Unified API**: Single interface for all scheduled tasks
- **Cron support**: Support standard cron expressions for flexible scheduling
- **Bun-native**: Leverage Bun's `Bun.cron.parse()` for cron handling

## Considered Options

### Option 1: Use node-cron or similar library

- **Pros**: Mature, widely used, rich feature set
- **Cons**: External dependency, not Bun-native, adds bundle size

### Option 2: Use BullMQ with Redis

- **Pros**: Enterprise-grade job queuing, persistence, distributed support
- **Cons**: Requires Redis infrastructure, overkill for simple periodic tasks

### Option 3: Build custom scheduler using Bun-native features

- **Pros**: Zero external dependencies, optimized for Bun runtime, lightweight, full control over features
- **Cons**: Implementation effort, maintenance responsibility

### Option 4: Continue with raw `setInterval` with wrapper utilities

- **Pros**: Minimal changes, no new abstractions
- **Cons**: Doesn't solve the core problems (retries, observability, graceful shutdown)

## Decision

We will build a custom **Scheduler Utility** using Bun-native features (`Bun.cron.parse()`, `setInterval`, `setTimeout`).

The scheduler will provide:

1. **Factory pattern**: `createScheduler()` returns isolated scheduler instances
2. **Task registration**: Named tasks with interval or cron-based scheduling
3. **Error classification**: `RetryableError`, `FatalError`, `SchedulerError` hierarchy
4. **Exponential backoff**: Configurable retry with jitter
5. **Event system**: `tick`, `error`, `retry`, `fatalError` events for monitoring
6. **Graceful shutdown**: `stopAll()` clears all intervals/timeouts
7. **Singleton instance**: Central scheduler at `src/scheduler-instance.ts` for application-wide tasks

## Rationale

1. **Bun-native optimization**: Using `Bun.cron.parse()` provides fast, native cron parsing
2. **Zero dependencies**: No external libraries to maintain or audit
3. **Tailored feature set**: Exactly the features we need without bloat
4. **TypeScript-first**: Full type safety with custom event handler types
5. **Testability**: Factory pattern enables isolated unit testing
6. **Integration**: Seamless integration with existing pino logging infrastructure

The implementation effort (11 source files, 33 tests) is justified by the long-term maintainability and the specific needs of the papai architecture.

## Consequences

### Positive

- **Centralized error handling**: All task errors caught, logged, and retried appropriately
- **Observability**: Event hooks enable monitoring and alerting integration
- **Graceful shutdown**: Clean process termination with `scheduler.stopAll()`
- **Cron support**: Flexible scheduling with standard cron expressions
- **Type safety**: Full TypeScript coverage with strict event typing
- **Test coverage**: 97.35% line coverage for scheduler module
- **Consistent logging**: All tasks use structured pino logging

### Negative

- **Implementation maintenance**: We own the scheduler codebase
- **Learning curve**: Team must understand scheduler API for new tasks
- **Migration effort**: Existing `setInterval` calls needed refactoring

### Mitigations

- Clear JSDoc documentation on all public methods
- Re-export all types and errors from main entry point
- Event handler examples in `src/scheduler-instance.ts`

## Implementation Details

### File Structure

```
src/utils/
├── scheduler.ts                    # Main factory and public API
├── scheduler.types.ts              # TypeScript definitions
├── scheduler.errors.ts             # Error re-exports
├── scheduler.operations.ts         # Task lifecycle operations
├── scheduler.internal.ts           # Execution and scheduling logic
├── scheduler.helpers.ts            # Utilities and defaults
├── scheduler.events.ts             # Event emission handling
├── scheduler-error.base.ts         # SchedulerError base class
├── scheduler-error.retryable.ts    # RetryableError class
├── scheduler-error.fatal.ts        # FatalError class
├── scheduler-error.not-found.ts    # TaskNotFoundError class
└── scheduler-error.exists.ts       # TaskAlreadyExistsError class

src/scheduler-instance.ts           # Central singleton instance
tests/utils/scheduler.test.ts       # Comprehensive test suite
```

### API Overview

```typescript
// Create scheduler instance
const scheduler = createScheduler({
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
})

// Register interval-based task
scheduler.register('cleanup', {
  interval: 5 * 60 * 1000, // 5 minutes
  handler: cleanupExpiredCaches,
  options: { immediate: true },
})

// Register cron-based task
scheduler.register('daily-report', {
  cron: '0 9 * * *', // 9 AM daily
  handler: generateDailyReport,
})

// Event monitoring
scheduler.on('error', ({ name, error, attempt }) => {
  metrics.increment('scheduler.errors', { task: name, attempt })
})

scheduler.on('fatalError', ({ name, error }) => {
  alertOps(`Task ${name} failed permanently: ${error.message}`)
})

// Lifecycle
scheduler.startAll()
scheduler.stopAll()
```

### Error Hierarchy

```
SchedulerError (base)
├── RetryableError      # Task will retry with backoff
├── FatalError          # Task stops immediately
├── TaskNotFoundError   # Task lookup failed
└── TaskAlreadyExistsError  # Duplicate registration
```

### Migrated Tasks

| Task                   | Schedule   | Location                           |
| ---------------------- | ---------- | ---------------------------------- |
| user-cache-cleanup     | 5 minutes  | `src/cache.ts`                     |
| message-cache-sweep    | Daily      | `src/message-cache/cache.ts`       |
| message-cleanup        | Hourly     | `src/message-cache/persistence.ts` |
| wizard-session-cleanup | 10 minutes | `src/wizard/state.ts`              |

## Verification

- ✅ All existing intervals migrated to scheduler
- ✅ Test coverage 97.35% for scheduler module
- ✅ No raw `setInterval` in business logic (UI animations in Telegram adapter remain, which is correct)
- ✅ Process exits gracefully on SIGTERM
- ✅ All 1869 tests pass
- ✅ TypeScript strict mode passes
- ✅ Lint passes (0 warnings, 0 errors)

## Migration Notes

The following raw `setInterval` usages were **intentionally kept** as they are UI animations, not business logic tasks:

1. **`src/chat/telegram/index.ts:274`** — Typing indicator animation (4.5s interval, cleaned up in `finally`)
2. **`src/debug/dashboard/state.ts:43`** — Dashboard uptime ticker (10s interval, client-side UI)

These are appropriate uses of `setInterval` because they:

- Have immediate cleanup via `try/finally`
- Are UI-layer concerns, not business logic
- Have bounded lifetimes tied to specific operations

## References

- Implementation Plan: `docs/plans/done/2025-03-28-scheduler-utility.md`
- Bun Cron API: https://bun.sh/docs/api/cron
- MADR Template: https://adr.github.io/madr/
