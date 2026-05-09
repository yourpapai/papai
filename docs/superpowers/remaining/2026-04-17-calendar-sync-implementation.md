# Remaining Work: 2026 04 17 calendar sync implementation

**Status:** not_implemented
**Generated:** 2026-04-29
**Plan:** `docs/superpowers/plans/2026-04-17-calendar-sync-implementation.md`

## Completed

_None identified._

## Remaining

- Task 1: Install dependencies (tsdav, ical.js)
- Task 2: Implement Calendar error types (src/calendar/errors.ts)
- Task 3: Define Calendar types (src/calendar/types.ts)
- Task 4: Implement RRULE parser (src/calendar/rrule-parser.ts)
- Task 5: Implement Event mapper (src/calendar/event-mapper.ts)
- Task 6: Add Config keys for calendar (src/types/config.ts, src/config.ts)
- Task 7: Implement DB schema and migration (src/db/schema.ts, src/db/migrations/024_calendar_sync.ts)
- Task 8: Implement CalDAV client wrapper (src/calendar/caldav-client.ts)
- Task 9: Implement Google and Apple providers (src/calendar/google-provider.ts, src/calendar/apple-provider.ts, src/calendar/google-auth.ts, src/calendar/factory.ts)
- Task 10: Implement Sync state DB operations (src/calendar/sync-state.ts)
- Task 11: Implement Sync engine (src/calendar/sync-engine.ts)
- Task 12: Implement Notification scheduler (src/calendar/notification-scheduler.ts)
- Task 13: Register Calendar scheduler (src/calendar/calendar-scheduler.ts, src/scheduler-instance.ts, src/index.ts)
- Task 14 & 15: Implement Calendar tools (src/tools/connect-calendar.ts, etc.)
- Task 16: Wire tools into tools-builder (src/tools/tools-builder.ts)
- Task 17: Full test suite and lint

## Suggested Next Steps

1. 1. Install required dependencies: `bun add tsdav ical.js`
2. 2. Implement foundational modules: `src/calendar/errors.ts` and `src/calendar/types.ts`
3. 3. Implement DB schema changes and migrations as outlined in Task 7
