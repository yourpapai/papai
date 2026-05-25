<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional recurring task sync and event notifications for Google Calendar and Apple Calendar via tsdav (CalDAV).

**Architecture:** A new `src/calendar/` module implements a `CalendarProvider` interface with Google (OAuth) and Apple (Basic auth) adapters over tsdav's CalDAV client. A sync engine detects changes on both sides using ETags/hashes, links recurring events to papai recurring tasks via explicit DB rows, and resolves conflicts by asking the user. Two new scheduler tasks poll for sync and notifications.

**Tech Stack:** tsdav (CalDAV), ical.js (iCalendar parsing), existing SQLite/Drizzle, existing scheduler, existing ChatProvider.sendMessage

**Design spec:** `docs/superpowers/specs/2026-04-17-calendar-sync-design.md`

---

## File Structure

### New files

| File                                             | Responsibility                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/calendar/types.ts`                          | CalendarProvider interface, CalendarEvent, CalendarInfo, TimeRange, SyncState types   |
| `src/calendar/factory.ts`                        | `buildCalendarProvider(userId)` factory                                               |
| `src/calendar/caldav-client.ts`                  | tsdav DAVClient wrapper (connect, disconnect, listCalendars, CRUD events)             |
| `src/calendar/google-auth.ts`                    | Google OAuth 2.0 flow (local HTTP callback server, PKCE, token exchange)              |
| `src/calendar/google-provider.ts`                | Google Calendar provider (extends CaldavClient with OAuth auth)                       |
| `src/calendar/apple-provider.ts`                 | Apple Calendar provider (extends CaldavClient with Basic auth)                        |
| `src/calendar/rrule-parser.ts`                   | RRULE string ↔ cron expression conversion                                             |
| `src/calendar/event-mapper.ts`                   | iCalendar VEVENT ↔ papai CalendarEvent domain type mapping                            |
| `src/calendar/sync-engine.ts`                    | Bidirectional sync logic (detect changes, apply, conflict detection)                  |
| `src/calendar/sync-state.ts`                     | Sync state DB operations (connections, links, reminders tables)                       |
| `src/calendar/notification-scheduler.ts`         | Upcoming event notification logic                                                     |
| `src/calendar/calendar-scheduler.ts`             | Registers sync + notification scheduled tasks on the central scheduler                |
| `src/calendar/errors.ts`                         | Calendar error types (CalendarError discriminated union)                              |
| `src/tools/connect-calendar.ts`                  | `connect_calendar` tool                                                               |
| `src/tools/disconnect-calendar.ts`               | `disconnect_calendar` tool                                                            |
| `src/tools/list-calendars.ts`                    | `list_calendars` tool                                                                 |
| `src/tools/list-calendar-events.ts`              | `list_calendar_events` tool                                                           |
| `src/tools/get-upcoming-events.ts`               | `get_upcoming_events` tool                                                            |
| `src/tools/sync-recurring-to-calendar.ts`        | `sync_recurring_to_calendar` tool                                                     |
| `src/tools/sync-calendar-to-recurring.ts`        | `sync_calendar_to_recurring` tool                                                     |
| `src/tools/list-sync-links.ts`                   | `list_sync_links` tool                                                                |
| `src/tools/resolve-sync-conflict.ts`             | `resolve_sync_conflict` tool                                                          |
| `src/tools/dismiss-calendar-event.ts`            | `dismiss_calendar_event` tool                                                         |
| `src/db/migrations/024_calendar_sync.ts`         | Migration: create calendar_connections, calendar_sync_links, calendar_event_reminders |
| `tests/calendar/rrule-parser.test.ts`            | Unit tests for RRULE ↔ cron conversion                                                |
| `tests/calendar/event-mapper.test.ts`            | Unit tests for iCalendar ↔ CalendarEvent mapping                                      |
| `tests/calendar/sync-engine.test.ts`             | Unit tests for sync engine logic with mock provider                                   |
| `tests/calendar/sync-state.test.ts`              | Unit tests for sync state DB operations                                               |
| `tests/calendar/notification-scheduler.test.ts`  | Unit tests for notification scheduling                                                |
| `tests/calendar/errors.test.ts`                  | Unit tests for calendar error types                                                   |
| `tests/calendar/caldav-client.test.ts`           | Unit tests for CalDAV client wrapper                                                  |
| `tests/tools/connect-calendar.test.ts`           | Tool tests                                                                            |
| `tests/tools/list-calendar-events.test.ts`       | Tool tests                                                                            |
| `tests/tools/get-upcoming-events.test.ts`        | Tool tests                                                                            |
| `tests/tools/sync-recurring-to-calendar.test.ts` | Tool tests                                                                            |
| `tests/tools/sync-calendar-to-recurring.test.ts` | Tool tests                                                                            |
| `tests/tools/list-sync-links.test.ts`            | Tool tests                                                                            |
| `tests/tools/resolve-sync-conflict.test.ts`      | Tool tests                                                                            |
| `tests/tools/dismiss-calendar-event.test.ts`     | Tool tests                                                                            |

### Modified files

| File                          | Change                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/types/config.ts`         | Add `CalendarConfigKey` type, extend `ConfigKey` union, add to `ALL_CONFIG_KEYS`                |
| `src/config.ts`               | Add calendar credential keys to `SENSITIVE_KEYS`                                                |
| `src/errors.ts`               | Add `CalendarError` to `AppError` union, add to `appErrorTypeSchema`, add to `getUserMessage()` |
| `src/db/schema.ts`            | Add `calendarConnections`, `calendarSyncLinks`, `calendarEventReminders` Drizzle tables         |
| `src/db/migrate.ts`           | Register migration 024 (if auto-discovered, may not need changes)                               |
| `src/tools/tools-builder.ts`  | Import and call `addCalendarTools(tools, chatUserId)`                                           |
| `src/scheduler-instance.ts`   | Import and register `calendar-sync-poll` and `calendar-notification` tasks                      |
| `src/index.ts`                | Start calendar schedulers after existing scheduler startup                                      |
| `tests/utils/test-helpers.ts` | Add migration 024 to `ALL_MIGRATIONS`                                                           |
| `package.json`                | Add `tsdav` and `ical.js` dependencies                                                          |

---

## Task 1: Install dependencies

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install tsdav and ical.js**

```bash
bun add tsdav ical.js
```

- [ ] **Step 2: Verify installation**

```bash
bun run typecheck
```

Expected: PASS (no new errors from unused deps)

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add tsdav and ical.js dependencies for calendar sync"
```

---

## Task 2: Calendar error types

**Files:**

- Create: `src/calendar/errors.ts`
- Create: `tests/calendar/errors.test.ts`
- Modify: `src/errors.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/errors.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import {
  calendarAuthExpiredError,
  calendarConnectionFailedError,
  calendarRateLimitedError,
  calendarRruleUnsupportedError,
  calendarSyncConflictError,
} from '../../src/calendar/errors.js'

describe('calendar errors', () => {
  test('calendarAuthExpiredError creates correct shape', () => {
    const err = calendarAuthExpiredError('google')
    expect(err.type).toBe('calendar')
    expect(err.code).toBe('auth-expired')
    expect(err.provider).toBe('google')
  })

  test('calendarConnectionFailedError creates correct shape', () => {
    const err = calendarConnectionFailedError('apple', 'Connection refused')
    expect(err.type).toBe('calendar')
    expect(err.code).toBe('connection-failed')
    expect(err.provider).toBe('apple')
    expect(err.message).toBe('Connection refused')
  })

  test('calendarRateLimitedError creates correct shape', () => {
    const err = calendarRateLimitedError('google')
    expect(err.type).toBe('calendar')
    expect(err.code).toBe('rate-limited')
    expect(err.provider).toBe('google')
  })

  test('calendarRruleUnsupportedError creates correct shape', () => {
    const err = calendarRruleUnsupportedError('FREQ=WEEKLY;BYDAY=MO;BYSETPOS=3')
    expect(err.type).toBe('calendar')
    expect(err.code).toBe('rrule-unsupported')
    expect(err.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;BYSETPOS=3')
  })

  test('calendarSyncConflictError creates correct shape', () => {
    const err = calendarSyncConflictError('uid-123', {
      remote: { title: 'A' },
      local: { title: 'B' },
    })
    expect(err.type).toBe('calendar')
    expect(err.code).toBe('sync-conflict')
    expect(err.eventUid).toBe('uid-123')
    expect(err.details.remote.title).toBe('A')
    expect(err.details.local.title).toBe('B')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/errors.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

`src/calendar/errors.ts`:

```typescript
export type CalendarProviderId = 'google' | 'apple'

export type CalendarError =
  | { type: 'calendar'; code: 'auth-expired'; provider: CalendarProviderId }
  | { type: 'calendar'; code: 'connection-failed'; provider: CalendarProviderId; message: string }
  | { type: 'calendar'; code: 'rate-limited'; provider: CalendarProviderId }
  | { type: 'calendar'; code: 'rrule-unsupported'; rrule: string }
  | { type: 'calendar'; code: 'sync-conflict'; eventUid: string; details: Record<string, unknown> }

export const calendarAuthExpiredError = (provider: CalendarProviderId): CalendarError => ({
  type: 'calendar',
  code: 'auth-expired',
  provider,
})

export const calendarConnectionFailedError = (provider: CalendarProviderId, message: string): CalendarError => ({
  type: 'calendar',
  code: 'connection-failed',
  provider,
  message,
})

export const calendarRateLimitedError = (provider: CalendarProviderId): CalendarError => ({
  type: 'calendar',
  code: 'rate-limited',
  provider,
})

export const calendarRruleUnsupportedError = (rrule: string): CalendarError => ({
  type: 'calendar',
  code: 'rrule-unsupported',
  rrule,
})

export const calendarSyncConflictError = (eventUid: string, details: Record<string, unknown>): CalendarError => ({
  type: 'calendar',
  code: 'sync-conflict',
  eventUid,
  details,
})

export function getCalendarErrorMessage(error: CalendarError): string {
  switch (error.code) {
    case 'auth-expired':
      return `Your ${error.provider === 'google' ? 'Google Calendar' : 'Apple Calendar'} authorization expired. Please reconnect with \`connect_calendar\`.`
    case 'connection-failed':
      return 'Could not reach your calendar. I will retry on the next sync cycle.'
    case 'rate-limited':
      return 'Calendar server is rate-limiting requests. I will retry later.'
    case 'rrule-unsupported':
      return 'This event recurrence pattern is too complex for automatic sync. You can set a custom schedule manually.'
    case 'sync-conflict':
      return `Sync conflict for event "${error.eventUid}". Both sides were modified. Please resolve the conflict.`
  }
}
```

- [ ] **Step 4: Add CalendarError to AppError union in `src/errors.ts`**

Find the `AppError` type (around line 34) and extend it:

The current line reads:

```typescript
export type AppError = ProviderError | LlmError | ValidationError | SystemError | WebFetchError
```

Change to:

```typescript
export type AppError =
  | ProviderError
  | LlmError
  | ValidationError
  | SystemError
  | WebFetchError
  | import('./calendar/errors.js').CalendarError
```

Find the `appErrorTypeSchema` (around line 56) and add `'calendar'` to the `z.enum()` array.

Find the `getUserMessage` function and add a case for `error.type === 'calendar'` that delegates to `getCalendarErrorMessage(error)` from `src/calendar/errors.js`.

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test tests/calendar/errors.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/calendar/errors.ts tests/calendar/errors.test.ts src/errors.ts
git commit -m "feat(calendar): add calendar error types and integrate with AppError"
```

---

## Task 3: Calendar types

**Files:**

- Create: `src/calendar/types.ts`

- [ ] **Step 1: Write the types**

`src/calendar/types.ts`:

```typescript
import type { CalendarProviderId } from './errors.js'

export interface CalendarInfo {
  id: string
  url: string
  displayName: string
  description?: string
  color?: string
}

export interface TimeRange {
  start: string
  end: string
}

export interface CalendarEvent {
  uid: string
  title: string
  description?: string
  location?: string
  start: string
  end: string
  isRecurring: boolean
  rrule?: string
  etag?: string
  url?: string
  reminders: CalendarReminder[]
}

export interface CalendarReminder {
  trigger: string
  action: string
  description?: string
}

export interface CalendarEventCreate {
  title: string
  description?: string
  location?: string
  start: string
  end: string
  isRecurring: boolean
  rrule?: string
  reminders?: CalendarReminder[]
}

export interface CalendarEventUpdate {
  title?: string
  description?: string
  location?: string
  start?: string
  end?: string
  rrule?: string
  reminders?: CalendarReminder[]
}

export interface SyncState {
  syncToken: string | null
  ctag: string | null
}

export interface CalendarProvider {
  readonly providerId: CalendarProviderId
  connect(): Promise<void>
  disconnect(): Promise<void>
  listCalendars(): Promise<CalendarInfo[]>
  listEvents(calendarUrl: string, range: TimeRange): Promise<CalendarEvent[]>
  createEvent(calendarUrl: string, event: CalendarEventCreate): Promise<CalendarEvent>
  updateEvent(calendarUrl: string, eventUrl: string, etag: string, event: CalendarEventUpdate): Promise<CalendarEvent>
  deleteEvent(calendarUrl: string, eventUrl: string, etag: string): Promise<void>
  getSyncState(calendarUrl: string): Promise<SyncState>
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/calendar/types.ts
git commit -m "feat(calendar): add CalendarProvider interface and domain types"
```

---

## Task 4: RRULE parser

**Files:**

- Create: `src/calendar/rrule-parser.ts`
- Create: `tests/calendar/rrule-parser.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/rrule-parser.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { rruleToCron, cronToRrule, isRruleSupported } from '../../src/calendar/rrule-parser.js'

describe('rruleToCron', () => {
  test('converts FREQ=DAILY', () => {
    expect(rruleToCron('FREQ=DAILY', '09:00')).toBe('0 9 * * *')
  })

  test('converts FREQ=WEEKLY;BYDAY=MO,WE,FR', () => {
    expect(rruleToCron('FREQ=WEEKLY;BYDAY=MO,WE,FR', '09:00')).toBe('0 9 * * 1,3,5')
  })

  test('converts FREQ=MONTHLY;BYMONTHDAY=15', () => {
    expect(rruleToCron('FREQ=MONTHLY;BYMONTHDAY=15', '09:00')).toBe('0 9 15 * *')
  })

  test('converts FREQ=YEARLY', () => {
    expect(rruleToCron('FREQ=YEARLY', '09:00', '2026-01-15')).toBe('0 9 15 1 *')
  })
})

describe('cronToRrule', () => {
  test('converts daily cron', () => {
    expect(cronToRrule('0 9 * * *')).toBe('FREQ=DAILY')
  })

  test('converts weekly cron with specific days', () => {
    expect(cronToRrule('0 9 * * 1,3,5')).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
  })

  test('converts monthly cron with specific day', () => {
    expect(cronToRrule('0 9 15 * *')).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
  })

  test('converts yearly cron', () => {
    expect(cronToRrule('0 9 15 1 *')).toBe('FREQ=YEARLY')
  })
})

describe('isRruleSupported', () => {
  test('supports simple frequencies', () => {
    expect(isRruleSupported('FREQ=DAILY')).toBe(true)
    expect(isRruleSupported('FREQ=WEEKLY;BYDAY=MO,WE')).toBe(true)
    expect(isRruleSupported('FREQ=MONTHLY;BYMONTHDAY=15')).toBe(true)
  })

  test('rejects BYSETPOS', () => {
    expect(isRruleSupported('FREQ=WEEKLY;BYDAY=MO;BYSETPOS=3')).toBe(false)
  })

  test('rejects INTERVAL > 1', () => {
    expect(isRruleSupported('FREQ=WEEKLY;INTERVAL=2')).toBe(false)
  })

  test('rejects EXDATE', () => {
    expect(isRruleSupported('FREQ=WEEKLY;EXDATE=20260101')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/rrule-parser.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/rrule-parser.ts`:

```typescript
import { calendarRruleUnsupportedError } from './errors.js'
import type { CalendarError } from './errors.js'

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
}

const CRON_DAY_MAP: Record<number, string> = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
}

function parseRruleParts(rrule: string): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const segment of rrule.split(';')) {
    const eq = segment.indexOf('=')
    if (eq === -1) continue
    parts[segment.substring(0, eq)] = segment.substring(eq + 1)
  }
  return parts
}

export function rruleToCron(rrule: string, time: string, startDate?: string): string {
  const parts = parseRruleParts(rrule)
  const [hour, minute] = time.split(':').map(Number)
  const freq = parts['FREQ']

  switch (freq) {
    case 'DAILY':
      return `${minute} ${hour} * * *`
    case 'WEEKLY': {
      const byDay = parts['BYDAY']
      if (byDay) {
        const days = byDay
          .split(',')
          .map((d) => DAY_MAP[d])
          .filter((d) => d !== undefined)
        return `${minute} ${hour} * * ${days.join(',')}`
      }
      return `${minute} ${hour} * * *`
    }
    case 'MONTHLY': {
      const byMonthDay = parts['BYMONTHDAY']
      if (byMonthDay) {
        return `${minute} ${hour} ${byMonthDay} * *`
      }
      return `${minute} ${hour} 1 * *`
    }
    case 'YEARLY': {
      if (startDate) {
        const date = new Date(startDate)
        const day = date.getUTCDate()
        const month = date.getUTCMonth() + 1
        return `${minute} ${hour} ${day} ${month} *`
      }
      return `${minute} ${hour} 1 1 *`
    }
    default:
      return `${minute} ${hour} * * *`
  }
}

export function cronToRrule(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  const dayOfMonth = parts[2]
  const month = parts[3]
  const dayOfWeek = parts[4]

  if (dayOfWeek !== '*') {
    const days = dayOfWeek
      .split(',')
      .map((d) => CRON_DAY_MAP[Number(d)])
      .join(',')
    return `FREQ=WEEKLY;BYDAY=${days}`
  }
  if (month !== '*') {
    return 'FREQ=YEARLY'
  }
  if (dayOfMonth !== '*') {
    return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`
  }
  return 'FREQ=DAILY'
}

export function isRruleSupported(rrule: string): boolean {
  const unsupported = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY', 'EXDATE', 'RDATE']
  const parts = parseRruleParts(rrule)

  for (const key of unsupported) {
    if (parts[key] !== undefined) return false
  }

  if (parts['INTERVAL'] !== undefined && parts['INTERVAL'] !== '1') return false

  return true
}

export function assertRruleSupported(rrule: string): CalendarError | null {
  if (!isRruleSupported(rrule)) {
    return calendarRruleUnsupportedError(rrule)
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/rrule-parser.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/rrule-parser.ts tests/calendar/rrule-parser.test.ts
git commit -m "feat(calendar): add RRULE ↔ cron conversion parser"
```

---

## Task 5: Event mapper

**Files:**

- Create: `src/calendar/event-mapper.ts`
- Create: `tests/calendar/event-mapper.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/event-mapper.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'
import { parseIcalToEvent, buildIcalFromEvent, buildIcalUpdate } from '../../src/calendar/event-mapper.js'

describe('parseIcalToEvent', () => {
  test('parses a simple single event', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid-1',
      'SUMMARY:Team Meeting',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'DESCRIPTION:Weekly sync',
      'LOCATION:Room A',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcalToEvent(ical, 'etag-abc', 'https://caldav.example.com/event.ics')
    expect(event.uid).toBe('test-uid-1')
    expect(event.title).toBe('Team Meeting')
    expect(event.start).toBe('2026-05-15T14:00:00.000Z')
    expect(event.end).toBe('2026-05-15T15:00:00.000Z')
    expect(event.isRecurring).toBe(false)
    expect(event.description).toBe('Weekly sync')
    expect(event.location).toBe('Room A')
  })

  test('parses a recurring event with RRULE', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:recurring-1',
      'SUMMARY:Weekly Retro',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcalToEvent(ical, 'etag-def', 'https://caldav.example.com/recurring.ics')
    expect(event.isRecurring).toBe(true)
    expect(event.rrule).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  test('parses VALARM reminders', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:alarm-1',
      'SUMMARY:Meeting',
      'DTSTART:20260515T140000Z',
      'DTEND:20260515T150000Z',
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const event = parseIcalToEvent(ical, 'etag-ghi', 'https://caldav.example.com/alarm.ics')
    expect(event.reminders).toHaveLength(1)
    expect(event.reminders[0].trigger).toBe('-PT15M')
    expect(event.reminders[0].action).toBe('DISPLAY')
  })
})

describe('buildIcalFromEvent', () => {
  test('builds iCal string for a recurring event', () => {
    const ical = buildIcalFromEvent({
      title: 'Weekly Retro',
      start: '2026-05-15T14:00:00.000Z',
      end: '2026-05-15T15:00:00.000Z',
      isRecurring: true,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      description: 'Sync meeting',
    })

    expect(ical).toContain('SUMMARY:Weekly Retro')
    expect(ical).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO')
    expect(ical).toContain('BEGIN:VEVENT')
    expect(ical).toContain('END:VEVENT')
    expect(ical).toContain('BEGIN:VCALENDAR')
    expect(ical).toContain('END:VCALENDAR')
  })
})

describe('buildIcalUpdate', () => {
  test('builds minimal iCal update string', () => {
    const update = buildIcalUpdate('original-uid', { title: 'Updated Meeting' })
    expect(update).toContain('UID:original-uid')
    expect(update).toContain('SUMMARY:Updated Meeting')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/event-mapper.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/event-mapper.ts`:

```typescript
import ICAL from 'ical.js'
import type { CalendarEvent, CalendarEventCreate, CalendarEventUpdate, CalendarReminder } from './types.js'

function formatDateToIcal(isoDate: string): string {
  return isoDate
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
    .replace('Z', 'Z')
}

function parseIcalDate(icalDate: string): string {
  try {
    const vevent = new ICAL.Component(new ICAL.Parser().parseValue(icalDate))
    return vevent.toString()
  } catch {
    if (icalDate.length === 8) {
      return `${icalDate.substring(0, 4)}-${icalDate.substring(4, 6)}-${icalDate.substring(6, 8)}T00:00:00.000Z`
    }
    if (icalDate.endsWith('Z') && icalDate.length === 16) {
      const raw = icalDate.replace('Z', '')
      return `${raw.substring(0, 4)}-${raw.substring(4, 6)}-${raw.substring(6, 8)}T${raw.substring(9, 11)}:${raw.substring(11, 13)}:${raw.substring(13, 15)}.000Z`
    }
    return icalDate
  }
}

export function parseIcalToEvent(data: string, etag: string, url: string): CalendarEvent {
  const jcalData = ICAL.parse(data)
  const vcalendar = new ICAL.Component(jcalData)
  const vevent = vcalendar.getFirstSubcomponent('vevent')
  if (vevent === null) {
    throw new Error('No VEVENT found in iCalendar data')
  }

  const event = new ICAL.Event(vevent)

  const reminders: CalendarReminder[] = []
  const alarms = vevent.getAllSubcomponents('valarm')
  for (const alarm of alarms) {
    const trigger = alarm.getFirstPropertyValue('trigger')
    const action = alarm.getFirstPropertyValue('action')
    const desc = alarm.getFirstPropertyValue('description')
    if (trigger !== null && action !== null) {
      reminders.push({
        trigger: String(trigger),
        action: String(action),
        description: desc !== null ? String(desc) : undefined,
      })
    }
  }

  return {
    uid: event.uid,
    title: event.summary ?? '',
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: event.startDate?.toJSDate()?.toISOString() ?? '',
    end: event.endDate?.toJSDate()?.toISOString() ?? '',
    isRecurring: event.isRecurring(),
    rrule: vevent.getFirstPropertyValue('rrule')?.toString() ?? undefined,
    etag,
    url,
    reminders,
  }
}

export function buildIcalFromEvent(input: CalendarEventCreate): string {
  const uid = `papai-${crypto.randomUUID()}@papai`
  const dtstamp = formatDateToIcal(new Date().toISOString())
  const dtstart = formatDateToIcal(input.start)
  const dtend = formatDateToIcal(input.end)

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//papai//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${input.title}`,
  ]

  if (input.description) lines.push(`DESCRIPTION:${input.description}`)
  if (input.location) lines.push(`LOCATION:${input.location}`)
  if (input.isRecurring && input.rrule) lines.push(`RRULE:${input.rrule}`)

  if (input.reminders) {
    for (const reminder of input.reminders) {
      lines.push('BEGIN:VALARM')
      lines.push(`TRIGGER:${reminder.trigger}`)
      lines.push(`ACTION:${reminder.action}`)
      if (reminder.description) lines.push(`DESCRIPTION:${reminder.description}`)
      lines.push('END:VALARM')
    }
  } else {
    lines.push('BEGIN:VALARM')
    lines.push('TRIGGER:-PT15M')
    lines.push('ACTION:DISPLAY')
    lines.push('DESCRIPTION:Reminder')
    lines.push('END:VALARM')
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export function buildIcalUpdate(uid: string, update: CalendarEventUpdate): string {
  const dtstamp = formatDateToIcal(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//papai//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
  ]

  if (update.title) lines.push(`SUMMARY:${update.title}`)
  if (update.description) lines.push(`DESCRIPTION:${update.description}`)
  if (update.location) lines.push(`LOCATION:${update.location}`)
  if (update.start) lines.push(`DTSTART:${formatDateToIcal(update.start)}`)
  if (update.end) lines.push(`DTEND:${formatDateToIcal(update.end)}`)
  if (update.rrule) lines.push(`RRULE:${update.rrule}`)

  if (update.reminders) {
    for (const reminder of update.reminders) {
      lines.push('BEGIN:VALARM')
      lines.push(`TRIGGER:${reminder.trigger}`)
      lines.push(`ACTION:${reminder.action}`)
      if (reminder.description) lines.push(`DESCRIPTION:${reminder.description}`)
      lines.push('END:VALARM')
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export function extractReminderMinutes(trigger: string): number | null {
  const match = trigger.match(/^-(?:PT|P)(?:(\d+)W)?(?:(\d+)D)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
  if (match === null) return null
  const weeks = Number(match[1] ?? 0)
  const days = Number(match[2] ?? 0)
  const hours = Number(match[3] ?? 0)
  const minutes = Number(match[4] ?? 0)
  return weeks * 7 * 24 * 60 + days * 24 * 60 + hours * 60 + minutes
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/event-mapper.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/event-mapper.ts tests/calendar/event-mapper.test.ts
git commit -m "feat(calendar): add iCalendar event mapper with ical.js parsing"
```

---

## Task 6: Config keys for calendar

**Files:**

- Modify: `src/types/config.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add CalendarConfigKey type and extend ConfigKey union**

In `src/types/config.ts`, add after line 6:

```typescript
export type CalendarConfigKey =
  | 'google_oauth_refresh_token'
  | 'google_oauth_access_token'
  | 'apple_caldav_url'
  | 'apple_caldav_username'
  | 'apple_caldav_password'
  | 'calendar_reminder_minutes'
  | 'calendar_sync_enabled'
  | 'calendar_dismissed_events'
```

Change line 15 from:

```typescript
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey
```

to:

```typescript
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey | CalendarConfigKey
```

Add all calendar keys to the `ALL_CONFIG_KEYS` array (around line 39):

```typescript
'google_oauth_refresh_token',
'google_oauth_access_token',
'apple_caldav_url',
'apple_caldav_username',
'apple_caldav_password',
'calendar_reminder_minutes',
'calendar_sync_enabled',
'calendar_dismissed_events',
```

- [ ] **Step 2: Add calendar credential keys to SENSITIVE_KEYS**

In `src/config.ts`, add to the `SENSITIVE_KEYS` set (line 7):

```typescript
const SENSITIVE_KEYS: ReadonlySet<ConfigKey> = new Set([
  'kaneo_apikey',
  'youtrack_token',
  'llm_apikey',
  'google_oauth_refresh_token',
  'google_oauth_access_token',
  'apple_caldav_username',
  'apple_caldav_password',
])
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/types/config.ts src/config.ts
git commit -m "feat(calendar): add calendar config keys and mark credentials as sensitive"
```

---

## Task 7: DB schema and migration

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/024_calendar_sync.ts`
- Modify: `tests/utils/test-helpers.ts` (add migration to ALL_MIGRATIONS)

- [ ] **Step 1: Add Drizzle table definitions to `src/db/schema.ts`**

Add at the end of the file (before any exports that reference tables):

```typescript
export const calendarConnections = sqliteTable(
  'calendar_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(),
    calendarId: text('calendar_id').notNull(),
    calendarName: text('calendar_name').notNull(),
    syncToken: text('sync_token'),
    ctag: text('ctag'),
    enabled: text('enabled').notNull().default('1'),
    lastSyncAt: text('last_sync_at'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_cal_conn_user').on(table.userId), index('idx_cal_conn_enabled').on(table.enabled)],
)

export const calendarSyncLinks = sqliteTable(
  'calendar_sync_links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    connectionId: text('connection_id').notNull(),
    calendarEventUid: text('calendar_event_uid').notNull(),
    recurringTaskId: text('recurring_task_id').notNull(),
    syncDirection: text('sync_direction').notNull().default('bidirectional'),
    lastRemoteEtag: text('last_remote_etag'),
    lastLocalHash: text('last_local_hash'),
    conflictState: text('conflict_state').default('none'),
    conflictDetails: text('conflict_details'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_cal_sync_user').on(table.userId),
    index('idx_cal_sync_connection').on(table.connectionId),
    index('idx_cal_sync_event_uid').on(table.calendarEventUid),
    index('idx_cal_sync_recurring').on(table.recurringTaskId),
  ],
)

export const calendarEventReminders = sqliteTable(
  'calendar_event_reminders',
  {
    userId: text('user_id').notNull(),
    connectionId: text('connection_id').notNull(),
    calendarEventUid: text('calendar_event_uid').notNull(),
    eventStart: text('event_start').notNull(),
    remindAt: text('remind_at').notNull(),
    reminded: text('reminded').notNull().default('0'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [primaryKey({ columns: [table.userId, table.calendarEventUid, table.eventStart] })],
)
```

- [ ] **Step 2: Create migration file**

`src/db/migrations/024_calendar_sync.ts`:

```typescript
import type { Migration } from '../migrate.js'
import type { Database } from 'bun:sqlite'

function createCalendarConnectionsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_connections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      calendar_name TEXT NOT NULL,
      sync_token TEXT,
      ctag TEXT,
      enabled TEXT NOT NULL DEFAULT '1',
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_conn_user ON calendar_connections(user_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_conn_enabled ON calendar_connections(enabled)')
}

function createCalendarSyncLinksTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_sync_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      calendar_event_uid TEXT NOT NULL,
      recurring_task_id TEXT NOT NULL,
      sync_direction TEXT NOT NULL DEFAULT 'bidirectional',
      last_remote_etag TEXT,
      last_local_hash TEXT,
      conflict_state TEXT DEFAULT 'none',
      conflict_details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_sync_user ON calendar_sync_links(user_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_sync_connection ON calendar_sync_links(connection_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_sync_event_uid ON calendar_sync_links(calendar_event_uid)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cal_sync_recurring ON calendar_sync_links(recurring_task_id)')
}

function createCalendarEventRemindersTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS calendar_event_reminders (
      user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      calendar_event_uid TEXT NOT NULL,
      event_start TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      reminded TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, calendar_event_uid, event_start)
    )
  `)
}

export const migration024CalendarSync: Migration = {
  id: '024_calendar_sync',
  up(db: Database): void {
    createCalendarConnectionsTable(db)
    createCalendarSyncLinksTable(db)
    createCalendarEventRemindersTable(db)
  },
}
```

- [ ] **Step 3: Register migration in test helpers**

In `tests/utils/test-helpers.ts`, import the new migration and add it to the `ALL_MIGRATIONS` array:

```typescript
import { migration024CalendarSync } from '../../src/db/migrations/024_calendar_sync.js'
```

And in the `ALL_MIGRATIONS` array, add `migration024CalendarSync` at the end.

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 5: Run existing tests to verify no regressions**

```bash
bun test
```

Expected: PASS (all existing tests still pass)

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations/024_calendar_sync.ts tests/utils/test-helpers.ts
git commit -m "feat(calendar): add DB schema and migration for calendar sync tables"
```

---

## Task 8: CalDAV client wrapper

**Files:**

- Create: `src/calendar/caldav-client.ts`
- Create: `tests/calendar/caldav-client.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/caldav-client.test.ts`:

```typescript
import { describe, expect, test, mock, beforeEach } from 'bun:test'
import { CaldavClient } from '../../src/calendar/caldav-client.js'
import { mockLogger } from '../utils/test-helpers.js'

const mockCreateDAVClient = mock(async (opts: any) => ({
  login: mock(async () => {}),
  fetchCalendars: mock(async () => [
    {
      url: 'https://caldav.example.com/cal1/',
      displayName: 'Work',
      ctag: 'ctag-1',
      syncToken: 'token-1',
    },
  ]),
  fetchCalendarObjects: mock(async () => []),
  createCalendarObject: mock(async () => ({
    ok: true,
    status: 201,
    headers: { get: () => '"etag-new"' },
  })),
  updateCalendarObject: mock(async () => ({
    ok: true,
    status: 204,
    headers: { get: () => '"etag-upd"' },
  })),
  deleteCalendarObject: mock(async () => ({ ok: true, status: 204 })),
  isCollectionDirty: mock(async () => ({ isDirty: true })),
  syncCalendars: mock(async () => ({ created: [], updated: [], deleted: [] })),
}))

describe('CaldavClient', () => {
  beforeEach(() => {
    mockLogger()
    mockCreateDAVClient.mockClear()
  })

  test('connect calls login on tsdav client', async () => {
    const client = new CaldavClient({
      serverUrl: 'https://caldav.icloud.com/',
      credentials: { username: 'user', password: 'pass' },
      authMethod: 'Basic',
      createDAVClientFn: mockCreateDAVClient,
    })
    await client.connect()
    expect(mockCreateDAVClient).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/caldav-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/caldav-client.ts`:

```typescript
import { createDAVClient, type DAVClient } from 'tsdav'
import { logger } from '../logger.js'
import type {
  CalendarInfo,
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventUpdate,
  TimeRange,
  SyncState,
} from './types.js'
import { parseIcalToEvent, buildIcalFromEvent, buildIcalUpdate } from './event-mapper.js'

const log = logger.child({ scope: 'caldav-client' })

export interface CaldavClientConfig {
  serverUrl: string
  credentials: Record<string, string>
  authMethod: 'Basic' | 'Oauth'
  createDAVClientFn?: typeof createDAVClient
}

export class CaldavClient {
  private client: DAVClient | null = null
  private readonly config: CaldavClientConfig
  private readonly createFn: typeof createDAVClient

  constructor(config: CaldavClientConfig) {
    this.config = config
    this.createFn = config.createDAVClientFn ?? createDAVClient
  }

  async connect(): Promise<void> {
    log.debug({ serverUrl: this.config.serverUrl }, 'Connecting to CalDAV server')
    this.client = await this.createFn({
      serverUrl: this.config.serverUrl,
      credentials: this.config.credentials,
      authMethod: this.config.authMethod,
      defaultAccountType: 'caldav',
    })
    await this.client.login()
    log.info({ serverUrl: this.config.serverUrl }, 'Connected to CalDAV server')
  }

  async disconnect(): Promise<void> {
    this.client = null
    log.debug('Disconnected from CalDAV server')
  }

  private requireClient(): DAVClient {
    if (this.client === null) {
      throw new Error('CalDAV client not connected. Call connect() first.')
    }
    return this.client
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const client = this.requireClient()
    const calendars = await client.fetchCalendars()
    return calendars.map((cal) => ({
      id: cal.url,
      url: cal.url,
      displayName: cal.displayName ?? 'Unnamed',
      description: cal.description ?? undefined,
      color: cal.calendarColor ?? undefined,
    }))
  }

  async listEvents(calendarUrl: string, range: TimeRange): Promise<CalendarEvent[]> {
    const client = this.requireClient()
    const calendars = await client.fetchCalendars()
    const calendar = calendars.find((c) => c.url === calendarUrl)
    if (calendar === undefined) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: range.start, end: range.end },
      expand: true,
    })

    return objects.map((obj) => parseIcalToEvent(obj.data, obj.etag ?? '', obj.url ?? ''))
  }

  async createEvent(calendarUrl: string, event: CalendarEventCreate): Promise<CalendarEvent> {
    const client = this.requireClient()
    const calendars = await client.fetchCalendars()
    const calendar = calendars.find((c) => c.url === calendarUrl)
    if (calendar === undefined) {
      throw new Error(`Calendar not found: ${calendarUrl}`)
    }

    const iCalString = buildIcalFromEvent(event)
    const filename = `papai-${crypto.randomUUID()}.ics`

    const response = await client.createCalendarObject({
      calendar,
      iCalString,
      filename,
    })

    const etag = response.headers?.get?.('etag') ?? ''
    return parseIcalToEvent(iCalString, etag, `${calendarUrl}${filename}`)
  }

  async updateEvent(
    calendarUrl: string,
    eventUrl: string,
    etag: string,
    event: CalendarEventUpdate,
  ): Promise<CalendarEvent> {
    const client = this.requireClient()

    const existing = await client.fetchCalendarObjects({
      calendar: { url: calendarUrl } as any,
      objectUrls: [eventUrl],
    })

    const uid =
      existing[0] !== undefined
        ? parseIcalToEvent(existing[0].data, existing[0].etag ?? '', existing[0].url ?? '').uid
        : `papai-${crypto.randomUUID()}`

    const iCalString = buildIcalUpdate(uid, event)

    const response = await client.updateCalendarObject({
      calendarObject: { url: eventUrl, etag, data: iCalString } as any,
    })

    const newEtag = response.headers?.get?.('etag') ?? etag
    return parseIcalToEvent(iCalString, newEtag, eventUrl)
  }

  async deleteEvent(_calendarUrl: string, eventUrl: string, etag: string): Promise<void> {
    const client = this.requireClient()
    await client.deleteCalendarObject({
      calendarObject: { url: eventUrl, etag } as any,
    })
  }

  async getSyncState(calendarUrl: string): Promise<SyncState> {
    const client = this.requireClient()
    const calendars = await client.fetchCalendars()
    const calendar = calendars.find((c) => c.url === calendarUrl)

    if (calendar === undefined) {
      return { syncToken: null, ctag: null }
    }

    const dirty = await client.isCollectionDirty({ collection: calendar })
    return {
      syncToken: (calendar as any).syncToken ?? null,
      ctag: calendar.ctag ?? null,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/caldav-client.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/caldav-client.ts tests/calendar/caldav-client.test.ts
git commit -m "feat(calendar): add CalDAV client wrapper around tsdav"
```

---

## Task 9: Google and Apple providers

**Files:**

- Create: `src/calendar/google-provider.ts`
- Create: `src/calendar/apple-provider.ts`
- Create: `src/calendar/google-auth.ts`
- Create: `src/calendar/factory.ts`

- [ ] **Step 1: Write Google auth module**

`src/calendar/google-auth.ts`:

```typescript
import { logger } from '../logger.js'
import { getConfig, setConfig } from '../config.js'
import { randomUUID } from 'crypto'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'

const log = logger.child({ scope: 'google-auth' })

const GOOGLE_TOKEN_URL = 'https://accounts.google.com/o/oauth2/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/calendar'

export interface GoogleAuthResult {
  refreshToken: string
  accessToken: string
}

export async function initiateGoogleOAuth(userId: string): Promise<string> {
  const clientId = getConfig(userId, 'google_oauth_client_id')
  const clientSecret = getConfig(userId, 'google_oauth_client_secret')
  if (clientId === null || clientSecret === null) {
    throw new Error(
      'Google OAuth client ID and secret must be configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars.',
    )
  }

  const state = randomUUID()
  const redirectUri = await startCallbackServer(userId, clientId, clientSecret, state)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

function startCallbackServer(
  userId: string,
  clientId: string,
  clientSecret: string,
  expectedState: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(
          req.url ?? '/',
          `http://localhost:${server.address !== null && typeof server.address === 'object' ? (server.address as any).port : 0}`,
        )
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (code === null || state !== expectedState) {
          res.writeHead(400)
          res.end('Invalid callback')
          return
        }

        const redirectUri = `http://localhost:${(server.address() as any).port}/callback`
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        })

        const tokens = (await tokenResponse.json()) as any
        if (tokens.refresh_token) setConfig(userId, 'google_oauth_refresh_token', tokens.refresh_token)
        if (tokens.access_token) setConfig(userId, 'google_oauth_access_token', tokens.access_token)

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Authorized! You can close this tab.</h1></body></html>')

        server.close()
        log.info({ userId }, 'Google OAuth completed successfully')
      } catch (error) {
        log.error({ error }, 'Google OAuth callback failed')
        res.writeHead(500)
        res.end('Authentication failed')
        server.close()
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      log.debug({ port }, 'Google OAuth callback server started')
      resolve(`http://127.0.0.1:${port}/callback`)
    })

    server.on('error', reject)
  })
}

export async function refreshGoogleToken(userId: string): Promise<string> {
  const clientId = getConfig(userId, 'google_oauth_client_id')
  const clientSecret = getConfig(userId, 'google_oauth_client_secret')
  const refreshToken = getConfig(userId, 'google_oauth_refresh_token')
  if (clientId === null || clientSecret === null || refreshToken === null) {
    throw new Error('Google OAuth not configured')
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  const tokens = (await response.json()) as any
  if (tokens.access_token) {
    setConfig(userId, 'google_oauth_access_token', tokens.access_token)
    return tokens.access_token
  }

  throw new Error('Failed to refresh Google access token')
}
```

- [ ] **Step 2: Write Google provider**

`src/calendar/google-provider.ts`:

```typescript
import { CaldavClient, type CaldavClientConfig } from './caldav-client.js'
import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { refreshGoogleToken } from './google-auth.js'
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventUpdate,
  TimeRange,
  SyncState,
} from './types.js'
import type { CalendarProviderId } from './errors.js'

const log = logger.child({ scope: 'google-provider' })

const GOOGLE_CALDAV_URL = 'https://apidata.googleusercontent.com/caldav/v2/'

export class GoogleCalendarProvider implements CalendarProvider {
  readonly providerId: CalendarProviderId = 'google'
  private client: CaldavClient

  constructor(private userId: string) {
    this.client = new CaldavClient(this.buildConfig())
  }

  private buildConfig(): CaldavClientConfig {
    const refreshToken = getConfig(this.userId, 'google_oauth_refresh_token')
    const accessToken = getConfig(this.userId, 'google_oauth_access_token')
    const clientId = getConfig(this.userId, 'google_oauth_client_id')
    const clientSecret = getConfig(this.userId, 'google_oauth_client_secret')

    return {
      serverUrl: GOOGLE_CALDAV_URL,
      credentials: {
        tokenUrl: 'https://accounts.google.com/o/oauth2/token',
        username: '',
        refreshToken: refreshToken ?? '',
        accessToken: accessToken ?? '',
        clientId: clientId ?? '',
        clientSecret: clientSecret ?? '',
      },
      authMethod: 'Oauth',
    }
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect()
    } catch (error) {
      log.warn({ error, userId: this.userId }, 'Google CalDAV connect failed, attempting token refresh')
      await refreshGoogleToken(this.userId)
      this.client = new CaldavClient(this.buildConfig())
      await this.client.connect()
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    return this.client.listCalendars()
  }

  async listEvents(calendarUrl: string, range: TimeRange): Promise<CalendarEvent[]> {
    return this.client.listEvents(calendarUrl, range)
  }

  async createEvent(calendarUrl: string, event: CalendarEventCreate): Promise<CalendarEvent> {
    return this.client.createEvent(calendarUrl, event)
  }

  async updateEvent(
    calendarUrl: string,
    eventUrl: string,
    etag: string,
    event: CalendarEventUpdate,
  ): Promise<CalendarEvent> {
    return this.client.updateEvent(calendarUrl, eventUrl, etag, event)
  }

  async deleteEvent(calendarUrl: string, eventUrl: string, etag: string): Promise<void> {
    await this.client.deleteEvent(calendarUrl, eventUrl, etag)
  }

  async getSyncState(calendarUrl: string): Promise<SyncState> {
    return this.client.getSyncState(calendarUrl)
  }
}
```

- [ ] **Step 3: Write Apple provider**

`src/calendar/apple-provider.ts`:

```typescript
import { CaldavClient, type CaldavClientConfig } from './caldav-client.js'
import { getConfig } from '../config.js'
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventUpdate,
  TimeRange,
  SyncState,
} from './types.js'
import type { CalendarProviderId } from './errors.js'

const APPLE_CALDAV_URL = 'https://caldav.icloud.com/'

export class AppleCalendarProvider implements CalendarProvider {
  readonly providerId: CalendarProviderId = 'apple'
  private client: CaldavClient

  constructor(private userId: string) {
    this.client = new CaldavClient(this.buildConfig())
  }

  private buildConfig(): CaldavClientConfig {
    const username = getConfig(this.userId, 'apple_caldav_username')
    const password = getConfig(this.userId, 'apple_caldav_password')

    return {
      serverUrl: APPLE_CALDAV_URL,
      credentials: {
        username: username ?? '',
        password: password ?? '',
      },
      authMethod: 'Basic',
    }
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    return this.client.listCalendars()
  }

  async listEvents(calendarUrl: string, range: TimeRange): Promise<CalendarEvent[]> {
    return this.client.listEvents(calendarUrl, range)
  }

  async createEvent(calendarUrl: string, event: CalendarEventCreate): Promise<CalendarEvent> {
    return this.client.createEvent(calendarUrl, event)
  }

  async updateEvent(
    calendarUrl: string,
    eventUrl: string,
    etag: string,
    event: CalendarEventUpdate,
  ): Promise<CalendarEvent> {
    return this.client.updateEvent(calendarUrl, eventUrl, etag, event)
  }

  async deleteEvent(calendarUrl: string, eventUrl: string, etag: string): Promise<void> {
    await this.client.deleteEvent(calendarUrl, eventUrl, etag)
  }

  async getSyncState(calendarUrl: string): Promise<SyncState> {
    return this.client.getSyncState(calendarUrl)
  }
}
```

- [ ] **Step 4: Write factory**

`src/calendar/factory.ts`:

```typescript
import { getConfig } from '../config.js'
import { GoogleCalendarProvider } from './google-provider.js'
import { AppleCalendarProvider } from './apple-provider.js'
import type { CalendarProvider } from './types.js'

export function buildCalendarProvider(userId: string): CalendarProvider | null {
  const hasGoogle = getConfig(userId, 'google_oauth_refresh_token') !== null
  if (hasGoogle) return new GoogleCalendarProvider(userId)

  const hasApple = getConfig(userId, 'apple_caldav_username') !== null
  if (hasApple) return new AppleCalendarProvider(userId)

  return null
}

export function hasCalendarConnection(userId: string): boolean {
  return buildCalendarProvider(userId) !== null
}
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/calendar/google-auth.ts src/calendar/google-provider.ts src/calendar/apple-provider.ts src/calendar/factory.ts
git commit -m "feat(calendar): add Google and Apple Calendar providers with factory"
```

---

## Task 10: Sync state DB operations

**Files:**

- Create: `src/calendar/sync-state.ts`
- Create: `tests/calendar/sync-state.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/sync-state.test.ts`:

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import {
  createConnection,
  getEnabledConnections,
  updateConnectionSyncState,
  createSyncLink,
  getSyncLinkByEventUid,
  getSyncLinkByRecurringTaskId,
  updateSyncLinkEtag,
  updateSyncLinkHash,
  setConflictState,
  getPendingConflicts,
  insertReminder,
  getDueReminders,
  markReminded,
} from '../../src/calendar/sync-state.js'

const USER_ID = 'test-user-1'

describe('sync-state', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('connections', () => {
    test('createConnection and getEnabledConnections', () => {
      createConnection({
        id: 'conn-1',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      const connections = getEnabledConnections(USER_ID)
      expect(connections).toHaveLength(1)
      expect(connections[0].provider).toBe('google')
      expect(connections[0].calendarName).toBe('Work')
    })

    test('updateConnectionSyncState', () => {
      createConnection({
        id: 'conn-2',
        userId: USER_ID,
        provider: 'apple',
        calendarId: 'cal-2',
        calendarName: 'Personal',
      })
      updateConnectionSyncState('conn-2', 'sync-token-abc', 'ctag-xyz')
      const connections = getEnabledConnections(USER_ID)
      expect(connections[0].syncToken).toBe('sync-token-abc')
      expect(connections[0].ctag).toBe('ctag-xyz')
    })
  })

  describe('sync links', () => {
    test('createSyncLink and getSyncLinkByEventUid', () => {
      createConnection({
        id: 'conn-3',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      createSyncLink({
        id: 'link-1',
        userId: USER_ID,
        connectionId: 'conn-3',
        calendarEventUid: 'evt-uid-1',
        recurringTaskId: 'task-1',
      })
      const link = getSyncLinkByEventUid(USER_ID, 'evt-uid-1')
      expect(link).not.toBeNull()
      expect(link!.recurringTaskId).toBe('task-1')
    })

    test('getSyncLinkByRecurringTaskId', () => {
      createConnection({
        id: 'conn-4',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      createSyncLink({
        id: 'link-2',
        userId: USER_ID,
        connectionId: 'conn-4',
        calendarEventUid: 'evt-uid-2',
        recurringTaskId: 'task-2',
      })
      const link = getSyncLinkByRecurringTaskId(USER_ID, 'task-2')
      expect(link).not.toBeNull()
      expect(link!.calendarEventUid).toBe('evt-uid-2')
    })

    test('updateSyncLinkEtag and updateSyncLinkHash', () => {
      createConnection({
        id: 'conn-5',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      createSyncLink({
        id: 'link-3',
        userId: USER_ID,
        connectionId: 'conn-5',
        calendarEventUid: 'evt-uid-3',
        recurringTaskId: 'task-3',
      })
      updateSyncLinkEtag('link-3', 'etag-new')
      updateSyncLinkHash('link-3', 'hash-new')
      const link = getSyncLinkByEventUid(USER_ID, 'evt-uid-3')
      expect(link!.lastRemoteEtag).toBe('etag-new')
      expect(link!.lastLocalHash).toBe('hash-new')
    })

    test('setConflictState and getPendingConflicts', () => {
      createConnection({
        id: 'conn-6',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      createSyncLink({
        id: 'link-4',
        userId: USER_ID,
        connectionId: 'conn-6',
        calendarEventUid: 'evt-uid-4',
        recurringTaskId: 'task-4',
      })
      setConflictState('link-4', 'pending_resolution', {
        remote: { title: 'A' },
        local: { title: 'B' },
      })
      const conflicts = getPendingConflicts(USER_ID)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].conflictState).toBe('pending_resolution')
    })
  })

  describe('reminders', () => {
    test('insertReminder and getDueReminders', () => {
      createConnection({
        id: 'conn-7',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      const past = new Date(Date.now() - 1000).toISOString()
      insertReminder({
        userId: USER_ID,
        connectionId: 'conn-7',
        calendarEventUid: 'evt-1',
        eventStart: '2026-05-15T14:00:00.000Z',
        remindAt: past,
      })
      const due = getDueReminders()
      expect(due).toHaveLength(1)
      expect(due[0].calendarEventUid).toBe('evt-1')
    })

    test('markReminded', () => {
      createConnection({
        id: 'conn-8',
        userId: USER_ID,
        provider: 'google',
        calendarId: 'cal-1',
        calendarName: 'Work',
      })
      const past = new Date(Date.now() - 1000).toISOString()
      insertReminder({
        userId: USER_ID,
        connectionId: 'conn-8',
        calendarEventUid: 'evt-2',
        eventStart: '2026-05-15T14:00:00.000Z',
        remindAt: past,
      })
      markReminded(USER_ID, 'evt-2', '2026-05-15T14:00:00.000Z')
      const due = getDueReminders()
      expect(due).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/sync-state.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/sync-state.ts`:

```typescript
import { eq, and, lte } from 'drizzle-orm'
import { getDrizzleDb } from '../db/drizzle.js'
import { calendarConnections, calendarSyncLinks, calendarEventReminders } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'sync-state' })

export interface ConnectionInput {
  id: string
  userId: string
  provider: string
  calendarId: string
  calendarName: string
}

export function createConnection(input: ConnectionInput): void {
  const db = getDrizzleDb()
  db.insert(calendarConnections)
    .values({
      id: input.id,
      userId: input.userId,
      provider: input.provider,
      calendarId: input.calendarId,
      calendarName: input.calendarName,
      enabled: '1',
      syncToken: null,
      ctag: null,
      lastSyncAt: null,
    })
    .run()
  log.debug({ connectionId: input.id }, 'Calendar connection created')
}

export function getEnabledConnections(userId: string) {
  const db = getDrizzleDb()
  return db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.enabled, '1')))
    .all()
}

export function updateConnectionSyncState(id: string, syncToken: string | null, ctag: string | null): void {
  const db = getDrizzleDb()
  db.update(calendarConnections)
    .set({
      syncToken,
      ctag,
      lastSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(calendarConnections.id, id))
    .run()
}

export function deleteConnectionsForUser(userId: string, provider: string): void {
  const db = getDrizzleDb()
  const links = db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.userId, userId)).all()
  for (const link of links) {
    db.delete(calendarEventReminders).where(eq(calendarEventReminders.connectionId, link.connectionId)).run()
  }
  db.delete(calendarSyncLinks).where(eq(calendarSyncLinks.userId, userId)).run()
  db.delete(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, provider)))
    .run()
}

export interface SyncLinkInput {
  id: string
  userId: string
  connectionId: string
  calendarEventUid: string
  recurringTaskId: string
}

export function createSyncLink(input: SyncLinkInput): void {
  const db = getDrizzleDb()
  db.insert(calendarSyncLinks)
    .values({
      id: input.id,
      userId: input.userId,
      connectionId: input.connectionId,
      calendarEventUid: input.calendarEventUid,
      recurringTaskId: input.recurringTaskId,
      syncDirection: 'bidirectional',
      lastRemoteEtag: null,
      lastLocalHash: null,
      conflictState: 'none',
      conflictDetails: null,
    })
    .run()
}

export function getSyncLinkByEventUid(userId: string, eventUid: string) {
  const db = getDrizzleDb()
  return db
    .select()
    .from(calendarSyncLinks)
    .where(and(eq(calendarSyncLinks.userId, userId), eq(calendarSyncLinks.calendarEventUid, eventUid)))
    .get()
}

export function getSyncLinkByRecurringTaskId(userId: string, recurringTaskId: string) {
  const db = getDrizzleDb()
  return db
    .select()
    .from(calendarSyncLinks)
    .where(and(eq(calendarSyncLinks.userId, userId), eq(calendarSyncLinks.recurringTaskId, recurringTaskId)))
    .get()
}

export function getAllSyncLinksForUser(userId: string) {
  const db = getDrizzleDb()
  return db.select().from(calendarSyncLinks).where(eq(calendarSyncLinks.userId, userId)).all()
}

export function updateSyncLinkEtag(id: string, etag: string): void {
  const db = getDrizzleDb()
  db.update(calendarSyncLinks)
    .set({ lastRemoteEtag: etag, updatedAt: new Date().toISOString() })
    .where(eq(calendarSyncLinks.id, id))
    .run()
}

export function updateSyncLinkHash(id: string, hash: string): void {
  const db = getDrizzleDb()
  db.update(calendarSyncLinks)
    .set({ lastLocalHash: hash, updatedAt: new Date().toISOString() })
    .where(eq(calendarSyncLinks.id, id))
    .run()
}

export function setConflictState(id: string, state: string, details: Record<string, unknown>): void {
  const db = getDrizzleDb()
  db.update(calendarSyncLinks)
    .set({
      conflictState: state,
      conflictDetails: JSON.stringify(details),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(calendarSyncLinks.id, id))
    .run()
}

export function clearConflictState(id: string): void {
  const db = getDrizzleDb()
  db.update(calendarSyncLinks)
    .set({ conflictState: 'none', conflictDetails: null, updatedAt: new Date().toISOString() })
    .where(eq(calendarSyncLinks.id, id))
    .run()
}

export function getPendingConflicts(userId: string) {
  const db = getDrizzleDb()
  return db
    .select()
    .from(calendarSyncLinks)
    .where(and(eq(calendarSyncLinks.userId, userId), eq(calendarSyncLinks.conflictState, 'pending_resolution')))
    .all()
}

export interface ReminderInput {
  userId: string
  connectionId: string
  calendarEventUid: string
  eventStart: string
  remindAt: string
}

export function insertReminder(input: ReminderInput): void {
  const db = getDrizzleDb()
  db.insert(calendarEventReminders)
    .values({
      userId: input.userId,
      connectionId: input.connectionId,
      calendarEventUid: input.calendarEventUid,
      eventStart: input.eventStart,
      remindAt: input.remindAt,
      reminded: '0',
    })
    .onConflictDoNothing()
    .run()
}

export function getDueReminders() {
  const db = getDrizzleDb()
  const now = new Date().toISOString()
  return db
    .select()
    .from(calendarEventReminders)
    .where(and(eq(calendarEventReminders.reminded, '0'), lte(calendarEventReminders.remindAt, now)))
    .all()
}

export function markReminded(userId: string, eventUid: string, eventStart: string): void {
  const db = getDrizzleDb()
  db.update(calendarEventReminders)
    .set({ reminded: '1' })
    .where(
      and(
        eq(calendarEventReminders.userId, userId),
        eq(calendarEventReminders.calendarEventUid, eventUid),
        eq(calendarEventReminders.eventStart, eventStart),
      ),
    )
    .run()
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/sync-state.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/sync-state.ts tests/calendar/sync-state.test.ts
git commit -m "feat(calendar): add sync state DB operations for connections, links, reminders"
```

---

## Task 11: Sync engine

**Files:**

- Create: `src/calendar/sync-engine.ts`
- Create: `tests/calendar/sync-engine.test.ts`

This is the core bidirectional sync logic. The test uses a mock CalendarProvider and mock recurring task functions.

- [ ] **Step 1: Write the failing test**

`tests/calendar/sync-engine.test.ts`:

```typescript
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { syncForConnection } from '../../src/calendar/sync-engine.js'
import type { CalendarProvider, CalendarEvent } from '../../src/calendar/types.js'
import {
  createConnection,
  getSyncLinkByEventUid,
  getAllSyncLinksForUser,
  updateSyncLinkHash,
} from '../../src/calendar/sync-state.js'

const USER_ID = 'test-user-1'

function createMockProvider(events: CalendarEvent[]): CalendarProvider {
  return {
    providerId: 'google',
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    listCalendars: mock(async () => [{ id: 'cal-1', url: 'https://caldav.example.com/cal1/', displayName: 'Work' }]),
    listEvents: mock(async () => events),
    createEvent: mock(async (_cal, event) => ({
      uid: `papai-${event.title}`,
      title: event.title,
      start: event.start,
      end: event.end,
      isRecurring: event.isRecurring,
      rrule: event.rrule,
      reminders: [],
    })),
    updateEvent: mock(async (_cal, _url, _etag, event) => ({
      uid: 'updated-1',
      title: event.title ?? 'Updated',
      start: event.start ?? '2026-05-15T14:00:00.000Z',
      end: event.end ?? '2026-05-15T15:00:00.000Z',
      isRecurring: true,
      reminders: [],
    })),
    deleteEvent: mock(async () => {}),
    getSyncState: mock(async () => ({ syncToken: null, ctag: null })),
  }
}

const recurringEvents: CalendarEvent[] = [
  {
    uid: 'evt-recurring-1',
    title: 'Weekly Retro',
    start: '2026-05-15T14:00:00.000Z',
    end: '2026-05-15T15:00:00.000Z',
    isRecurring: true,
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    etag: 'etag-v1',
    url: 'https://caldav.example.com/cal1/recurring.ics',
    reminders: [],
  },
]

describe('sync-engine', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('detects new recurring events and returns proposals', async () => {
    createConnection({
      id: 'conn-1',
      userId: USER_ID,
      provider: 'google',
      calendarId: 'cal-1',
      calendarName: 'Work',
    })
    const provider = createMockProvider(recurringEvents)

    const result = await syncForConnection(USER_ID, 'conn-1', provider, {
      getDueRecurringTasks: () => [],
      createRecurringTask: () => ({ id: 'task-1' }) as any,
      updateRecurringTask: () => {},
    })

    expect(result.newProposals).toHaveLength(1)
    expect(result.newProposals[0].uid).toBe('evt-recurring-1')
    expect(result.newProposals[0].title).toBe('Weekly Retro')
  })

  test('skips events that already have sync links', async () => {
    createConnection({
      id: 'conn-2',
      userId: USER_ID,
      provider: 'google',
      calendarId: 'cal-1',
      calendarName: 'Work',
    })
    const provider = createMockProvider(recurringEvents)

    const deps = {
      getDueRecurringTasks: () => [],
      createRecurringTask: () => ({ id: 'task-1' }) as any,
      updateRecurringTask: () => {},
    }

    const result1 = await syncForConnection(USER_ID, 'conn-2', provider, deps)
    expect(result1.newProposals).toHaveLength(1)

    const result2 = await syncForConnection(USER_ID, 'conn-2', provider, deps)
    expect(result2.newProposals).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/sync-engine.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/sync-engine.ts`:

```typescript
import { logger } from '../logger.js'
import type { CalendarProvider, CalendarEvent } from './types.js'
import {
  getEnabledConnections,
  updateConnectionSyncState,
  getSyncLinkByEventUid,
  getSyncLinkByRecurringTaskId,
  updateSyncLinkEtag,
  updateSyncLinkHash,
  setConflictState,
  clearConflictState,
  createSyncLink,
  getAllSyncLinksForUser,
} from './sync-state.js'
import { getConfig } from '../config.js'
import { cronToRrule, rruleToCron, isRruleSupported } from './rrule-parser.js'

const log = logger.child({ scope: 'sync-engine' })

export interface SyncEngineDeps {
  getDueRecurringTasks: () => Array<{
    id: string
    userId: string
    title: string
    cronExpression: string | null
    timezone: string
    description: string | null
  }>
  createRecurringTask: (input: any) => { id: string }
  updateRecurringTask: (id: string, updates: Record<string, unknown>) => void
}

export interface SyncProposal {
  uid: string
  title: string
  start: string
  rrule?: string
  cronSuggestion?: string
}

export interface SyncResult {
  newProposals: SyncProposal[]
  syncedCount: number
  conflictCount: number
  errors: Array<{ message: string }>
}

export async function syncForConnection(
  userId: string,
  connectionId: string,
  provider: CalendarProvider,
  deps: SyncEngineDeps,
): Promise<SyncResult> {
  const result: SyncResult = { newProposals: [], syncedCount: 0, conflictCount: 0, errors: [] }
  const connections = getEnabledConnections(userId)
  const connection = connections.find((c) => c.id === connectionId)
  if (connection === undefined) return result

  try {
    await provider.connect()
  } catch (error) {
    log.error({ error, userId, connectionId }, 'Failed to connect to calendar provider')
    result.errors.push({ message: error instanceof Error ? error.message : String(error) })
    return result
  }

  try {
    const now = new Date()
    const rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const rangeEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString()

    const events = await provider.listEvents(connection.calendarId, {
      start: rangeStart,
      end: rangeEnd,
    })
    const syncState = await provider.getSyncState(connection.calendarId)
    updateConnectionSyncState(connectionId, syncState.syncToken, syncState.ctag)

    const dismissedRaw = getConfig(userId, 'calendar_dismissed_events')
    const dismissed: string[] = dismissedRaw !== null ? JSON.parse(dismissedRaw) : []

    for (const event of events) {
      if (!event.isRecurring) continue
      if (dismissed.includes(event.uid)) continue

      const existingLink = getSyncLinkByEventUid(userId, event.uid)

      if (existingLink === null) {
        const cron =
          event.rrule && isRruleSupported(event.rrule)
            ? rruleToCron(event.rrule, event.start.split('T')[1]?.substring(0, 5) ?? '09:00')
            : undefined

        result.newProposals.push({
          uid: event.uid,
          title: event.title,
          start: event.start,
          rrule: event.rrule,
          cronSuggestion: cron,
        })
        continue
      }

      if (existingLink.lastRemoteEtag !== event.etag) {
        if (existingLink.conflictState === 'pending_resolution') {
          result.conflictCount++
          continue
        }

        const currentHash = existingLink.lastLocalHash
        if (currentHash !== null) {
          const remoteChanged = existingLink.lastRemoteEtag !== event.etag
          const localTasks = deps.getDueRecurringTasks().filter((t) => t.id === existingLink.recurringTaskId)
          const localTask = localTasks[0]

          if (remoteChanged && localTask !== undefined) {
            const newHash = hashTaskFields(localTask)
            if (newHash !== currentHash) {
              setConflictState(existingLink.id, 'pending_resolution', {
                remote: { title: event.title, start: event.start, rrule: event.rrule },
                local: {
                  title: localTask.title,
                  cron: localTask.cronExpression,
                  timezone: localTask.timezone,
                },
              })
              result.conflictCount++
              continue
            }
          }
        }

        updateSyncLinkEtag(existingLink.id, event.etag ?? '')
        result.syncedCount++
      }
    }
  } catch (error) {
    log.error({ error, userId, connectionId }, 'Sync failed')
    result.errors.push({ message: error instanceof Error ? error.message : String(error) })
  } finally {
    await provider.disconnect()
  }

  return result
}

export function hashTaskFields(task: {
  title: string
  cronExpression: string | null
  timezone: string
  description: string | null
}): string {
  const raw = JSON.stringify({
    t: task.title,
    c: task.cronExpression,
    tz: task.timezone,
    d: task.description,
  })
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return hash.toString(36)
}

export function acceptProposal(
  userId: string,
  connectionId: string,
  proposal: SyncProposal,
  projectId: string,
  deps: SyncEngineDeps,
): string {
  const cron = proposal.cronSuggestion ?? '0 9 * * *'
  const task = deps.createRecurringTask({
    userId,
    projectId,
    title: proposal.title,
    triggerType: 'cron',
    cronExpression: cron,
    timezone: 'UTC',
  })

  createSyncLink({
    id: crypto.randomUUID(),
    userId,
    connectionId,
    calendarEventUid: proposal.uid,
    recurringTaskId: task.id,
  })

  return task.id
}

export function resolveConflict(
  userId: string,
  linkId: string,
  winner: 'remote' | 'local',
  provider: CalendarProvider,
  connectionId: string,
  deps: SyncEngineDeps,
): void {
  clearConflictState(linkId)
  log.info({ userId, linkId, winner }, 'Sync conflict resolved')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/sync-engine.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/sync-engine.ts tests/calendar/sync-engine.test.ts
git commit -m "feat(calendar): add bidirectional sync engine with conflict detection"
```

---

## Task 12: Notification scheduler

**Files:**

- Create: `src/calendar/notification-scheduler.ts`
- Create: `tests/calendar/notification-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/calendar/notification-scheduler.test.ts`:

```typescript
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { processDueReminders, scheduleUpcomingReminders } from '../../src/calendar/notification-scheduler.js'
import { createConnection, insertReminder } from '../../src/calendar/sync-state.js'

const USER_ID = 'test-user-1'

describe('notification-scheduler', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('processDueReminders returns due reminders', () => {
    createConnection({
      id: 'conn-1',
      userId: USER_ID,
      provider: 'google',
      calendarId: 'cal-1',
      calendarName: 'Work',
    })
    const past = new Date(Date.now() - 10000).toISOString()
    insertReminder({
      userId: USER_ID,
      connectionId: 'conn-1',
      calendarEventUid: 'evt-1',
      eventStart: '2026-05-15T14:00:00.000Z',
      remindAt: past,
    })

    const sent: Array<{ userId: string; message: string }> = []
    processDueReminders((userId, message) => {
      sent.push({ userId, message })
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].userId).toBe(USER_ID)
    expect(sent[0].message).toContain('evt-1')
  })

  test('scheduleUpcomingReminders inserts reminders for future events', async () => {
    createConnection({
      id: 'conn-2',
      userId: USER_ID,
      provider: 'google',
      calendarId: 'cal-1',
      calendarName: 'Work',
    })

    const events = [
      {
        uid: 'future-1',
        title: 'Future Meeting',
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString(),
        isRecurring: false,
        reminders: [],
      },
    ]

    const count = await scheduleUpcomingReminders(USER_ID, 'conn-2', events, 15)
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/calendar/notification-scheduler.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write implementation**

`src/calendar/notification-scheduler.ts`:

```typescript
import { logger } from '../logger.js'
import { getConfig } from '../config.js'
import { getDueReminders, markReminded, insertReminder } from './sync-state.js'
import { extractReminderMinutes } from './event-mapper.js'
import type { CalendarEvent } from './types.js'

const log = logger.child({ scope: 'notification-scheduler' })

export function processDueReminders(sendMessage: (userId: string, message: string) => void): void {
  const due = getDueReminders()
  log.debug({ count: due.length }, 'Processing due reminders')

  for (const reminder of due) {
    try {
      const message = formatReminderMessage(reminder.calendarEventUid, reminder.eventStart)
      sendMessage(reminder.userId, message)
      markReminded(reminder.userId, reminder.calendarEventUid, reminder.eventStart)
      log.info({ userId: reminder.userId, eventUid: reminder.calendarEventUid }, 'Reminder sent')
    } catch (error) {
      log.error({ error, userId: reminder.userId, eventUid: reminder.calendarEventUid }, 'Failed to send reminder')
    }
  }
}

function formatReminderMessage(eventUid: string, eventStart: string): string {
  const start = new Date(eventStart)
  const time = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `📅 "${eventUid}" starts soon (${time})`
}

export async function scheduleUpcomingReminders(
  userId: string,
  connectionId: string,
  events: CalendarEvent[],
  defaultReminderMinutes: number = 15,
): Promise<number> {
  let count = 0
  const now = new Date()
  const lookaheadMs = defaultReminderMinutes * 60 * 1000 * 4
  const windowEnd = new Date(now.getTime() + lookaheadMs)

  for (const event of events) {
    const eventStart = new Date(event.start)
    if (eventStart <= now || eventStart > windowEnd) continue

    let reminderMinutes = defaultReminderMinutes
    if (event.reminders.length > 0) {
      const extracted = extractReminderMinutes(event.reminders[0].trigger)
      if (extracted !== null) reminderMinutes = extracted
    }

    const remindAt = new Date(eventStart.getTime() - reminderMinutes * 60 * 1000)
    if (remindAt <= now) continue

    insertReminder({
      userId,
      connectionId,
      calendarEventUid: event.uid,
      eventStart: event.start,
      remindAt: remindAt.toISOString(),
    })
    count++
  }

  return count
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test tests/calendar/notification-scheduler.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/notification-scheduler.ts tests/calendar/notification-scheduler.test.ts
git commit -m "feat(calendar): add notification scheduler for upcoming event reminders"
```

---

## Task 13: Calendar scheduler registration

**Files:**

- Create: `src/calendar/calendar-scheduler.ts`
- Modify: `src/scheduler-instance.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the calendar scheduler module**

`src/calendar/calendar-scheduler.ts`:

```typescript
import { logger } from '../logger.js'
import type { Scheduler } from '../utils/scheduler.js'
import { getEnabledConnections } from './sync-state.js'
import { buildCalendarProvider } from './factory.js'
import { syncForConnection } from './sync-engine.js'
import { processDueReminders, scheduleUpcomingReminders } from './notification-scheduler.js'
import { getConfig } from '../config.js'
import { getDueRecurringTasks } from '../recurring.js'
import type { ChatProvider } from '../chat/types.js'

const log = logger.child({ scope: 'calendar-scheduler' })

export function registerCalendarSchedulers(scheduler: Scheduler, chatProvider: ChatProvider): void {
  scheduler.register('calendar-sync-poll', {
    interval: 5 * 60 * 1000,
    handler: () => runCalendarSync(chatProvider),
    options: { immediate: false },
  })

  scheduler.register('calendar-notification', {
    interval: 60 * 1000,
    handler: () => runCalendarNotifications(chatProvider),
    options: { immediate: false },
  })

  log.info('Calendar sync schedulers registered')
}

async function runCalendarSync(chatProvider: ChatProvider): Promise<void> {
  log.debug('Running calendar sync poll')
  const connections = getAllEnabledConnections()
  const uniqueUsers = new Set(connections.map((c) => c.userId))

  for (const userId of uniqueUsers) {
    const provider = buildCalendarProvider(userId)
    if (provider === null) continue

    const userConnections = connections.filter((c) => c.userId === userId)
    for (const connection of userConnections) {
      try {
        await syncForConnection(userId, connection.id, provider, {
          getDueRecurringTasks: () => getDueRecurringTasks(),
          createRecurringTask: () => ({ id: 'sync-created' }),
          updateRecurringTask: () => {},
        })
      } catch (error) {
        log.error({ error, userId, connectionId: connection.id }, 'Calendar sync failed for connection')
      }
    }
  }
}

async function runCalendarNotifications(chatProvider: ChatProvider): Promise<void> {
  processDueReminders((userId, message) => {
    chatProvider.sendMessage(userId, message).catch((error) => {
      log.error({ error, userId }, 'Failed to send calendar notification')
    })
  })
}

function getAllEnabledConnections() {
  const allConnections: Array<{
    userId: string
    id: string
    provider: string
    calendarId: string
    calendarName: string
  }> = []
  const { rows } = getDrizzleDb()
    .select({ userId: calendarConnections.userId })
    .from(calendarConnections)
    .where(eq(calendarConnections.enabled, '1'))
    .groupBy(calendarConnections.userId)
  for (const row of rows) {
    allConnections.push(...getEnabledConnections(row.userId))
  }
  return allConnections
}
```

- [ ] **Step 2: Register in scheduler-instance.ts**

Add import at top of `src/scheduler-instance.ts`:

```typescript
import { registerCalendarSchedulers } from './calendar/calendar-scheduler.js'
```

After the existing `scheduler.register(...)` calls, add:

```typescript
registerCalendarSchedulers(scheduler, chatProviderRef)
```

Note: `chatProviderRef` will need to be passed in or set. Follow the same pattern as `src/scheduler.ts` where `chatProviderRef` is stored at startup. This requires a small refactor: the calendar schedulers need the chatProvider reference. The cleanest approach is to pass it through a setup function called from `src/index.ts` after the chat provider is created.

- [ ] **Step 3: Start in index.ts**

In `src/index.ts`, after `startScheduler(chatProvider)` (line 82), add:

```typescript
import { registerCalendarSchedulers } from './calendar/calendar-scheduler.js'
registerCalendarSchedulers(scheduler, chatProvider)
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/calendar/calendar-scheduler.ts src/scheduler-instance.ts src/index.ts
git commit -m "feat(calendar): register calendar sync and notification scheduled tasks"
```

---

## Task 14: Calendar tools (batch 1 — connection and read tools)

**Files:**

- Create: `src/tools/connect-calendar.ts`
- Create: `src/tools/disconnect-calendar.ts`
- Create: `src/tools/list-calendars.ts`
- Create: `src/tools/list-calendar-events.ts`
- Create: `src/tools/get-upcoming-events.ts`
- Create: `tests/tools/connect-calendar.test.ts`
- Create: `tests/tools/list-calendar-events.test.ts`
- Create: `tests/tools/get-upcoming-events.test.ts`

Each tool follows the existing pattern: `makeXxxTool(chatUserId)` factory, `tool()` from `ai` package, zod schema, DI for testability.

- [ ] **Step 1: Write tool files**

For each tool, follow this pattern. Example for `connect_calendar`:

`src/tools/connect-calendar.ts`:

```typescript
import { tool } from 'ai'
import { z } from 'zod'
import { logger } from '../logger.js'
import { setConfig } from '../config.js'

const log = logger.child({ scope: 'tool:connect-calendar' })

const inputSchema = z.object({
  provider: z.enum(['google', 'apple']).describe('Calendar provider to connect'),
  username: z.string().optional().describe('Username or email for the calendar account'),
  password: z.string().optional().describe('Password or app-specific password (Apple only)'),
})

export interface ConnectCalendarDeps {
  initiateGoogleOAuth: (userId: string) => Promise<string>
  setConfig: (userId: string, key: string, value: string) => void
}

const defaultDeps: ConnectCalendarDeps = {
  initiateGoogleOAuth: async () => {
    throw new Error('Not implemented')
  },
  setConfig: (userId, key, value) => setConfig(userId, key as any, value),
}

export function makeConnectCalendarTool(userId: string, deps: ConnectCalendarDeps = defaultDeps) {
  return tool({
    description:
      'Connect a Google or Apple Calendar account. Returns an authorization URL for Google or validates credentials for Apple.',
    inputSchema,
    execute: async (input) => {
      try {
        if (input.provider === 'google') {
          const authUrl = await deps.initiateGoogleOAuth(userId)
          return {
            success: true,
            message: `Open this URL to authorize Google Calendar: ${authUrl}`,
          }
        }

        if (input.provider === 'apple' && input.username && input.password) {
          deps.setConfig(userId, 'apple_caldav_url', 'https://caldav.icloud.com/')
          deps.setConfig(userId, 'apple_caldav_username', input.username)
          deps.setConfig(userId, 'apple_caldav_password', input.password)
          return {
            success: true,
            message: 'Apple Calendar credentials stored. Calendar will be synced on the next cycle.',
          }
        }

        return { success: false, message: 'Apple Calendar requires username and password.' }
      } catch (error) {
        log.error({ error, tool: 'connect_calendar' }, 'Tool execution failed')
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
```

Follow the same pattern for all other tools, implementing the execute function according to each tool's purpose as defined in the design spec's tool table.

- [ ] **Step 2: Write test files**

Write tests for each tool following the existing pattern: mock deps, call execute, assert results. Use `schemaValidates()` and `getToolExecutor()` from test helpers.

- [ ] **Step 3: Run tests**

```bash
bun test tests/tools/connect-calendar.test.ts tests/tools/list-calendar-events.test.ts tests/tools/get-upcoming-events.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/connect-calendar.ts src/tools/disconnect-calendar.ts src/tools/list-calendars.ts src/tools/list-calendar-events.ts src/tools/get-upcoming-events.ts tests/tools/
git commit -m "feat(calendar): add connection and read-only calendar tools"
```

---

## Task 15: Calendar tools (batch 2 — sync tools)

**Files:**

- Create: `src/tools/sync-recurring-to-calendar.ts`
- Create: `src/tools/sync-calendar-to-recurring.ts`
- Create: `src/tools/list-sync-links.ts`
- Create: `src/tools/resolve-sync-conflict.ts`
- Create: `src/tools/dismiss-calendar-event.ts`
- Create: `tests/tools/sync-recurring-to-calendar.test.ts`
- Create: `tests/tools/sync-calendar-to-recurring.test.ts`
- Create: `tests/tools/list-sync-links.test.ts`
- Create: `tests/tools/resolve-sync-conflict.test.ts`
- Create: `tests/tools/dismiss-calendar-event.test.ts`

Follow the same tool pattern as Task 14.

- [ ] **Step 1: Write all sync tool files and tests**

Each tool's execute function calls into the sync engine or sync state modules with appropriate deps.

- [ ] **Step 2: Run tests**

```bash
bun test tests/tools/sync-recurring-to-calendar.test.ts tests/tools/sync-calendar-to-recurring.test.ts tests/tools/list-sync-links.test.ts tests/tools/resolve-sync-conflict.test.ts tests/tools/dismiss-calendar-event.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/sync-*.ts src/tools/list-sync-links.ts src/tools/resolve-sync-conflict.ts src/tools/dismiss-calendar-event.ts tests/tools/sync-*.test.ts tests/tools/list-sync-links.test.ts tests/tools/resolve-sync-conflict.test.ts tests/tools/dismiss-calendar-event.test.ts
git commit -m "feat(calendar): add sync and conflict resolution calendar tools"
```

---

## Task 16: Wire tools into tools-builder

**Files:**

- Modify: `src/tools/tools-builder.ts`

- [ ] **Step 1: Add calendar tools to the builder**

In `src/tools/tools-builder.ts`, add at the end of `buildTools()` (before the `return tools` statement):

```typescript
if (hasCalendarConnection(chatUserId)) {
  addCalendarTools(tools, chatUserId)
}
```

Add a new function in the file:

```typescript
function addCalendarTools(tools: ToolSet, chatUserId: string | undefined): void {
  if (chatUserId === undefined) return
  tools['connect_calendar'] = makeConnectCalendarTool(chatUserId)
  tools['disconnect_calendar'] = makeDisconnectCalendarTool(chatUserId)
  tools['list_calendars'] = makeListCalendarsTool(chatUserId)
  tools['list_calendar_events'] = makeListCalendarEventsTool(chatUserId)
  tools['get_upcoming_events'] = makeGetUpcomingEventsTool(chatUserId)
  tools['sync_recurring_to_calendar'] = makeSyncRecurringToCalendarTool(chatUserId)
  tools['sync_calendar_to_recurring'] = makeSyncCalendarToRecurringTool(chatUserId)
  tools['list_sync_links'] = makeListSyncLinksTool(chatUserId)
  tools['resolve_sync_conflict'] = makeResolveSyncConflictTool(chatUserId)
  tools['dismiss_calendar_event'] = makeDismissCalendarEventTool(chatUserId)
}
```

Add all imports at the top of the file.

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/tools/tools-builder.ts
git commit -m "feat(calendar): wire calendar tools into tools builder with connection gating"
```

---

## Task 17: Full test suite and lint

**Files:**

- No new files

- [ ] **Step 1: Run full test suite**

```bash
bun test
```

Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: PASS

- [ ] **Step 3: Run lint**

```bash
bun run lint
```

Expected: PASS (no errors in new calendar files)

- [ ] **Step 4: Run format check**

```bash
bun run format:check
```

Expected: PASS

- [ ] **Step 5: Fix any issues found**

If any of the above fail, fix the underlying issues and re-run.

- [ ] **Step 6: Final commit if needed**

```bash
git add -A
git commit -m "chore: fix lint/typecheck issues from calendar sync integration"
```
