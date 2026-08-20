<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Calendar Sync Design

Date: 2026-04-17

## Summary

Integrate Google Calendar and Apple Calendar into papai for bidirectional recurring task sync, upcoming event notifications, and calendar event discovery. Uses tsdav (CalDAV client) as a unified protocol layer for both providers.

## User Stories

1. **Setup** — As a user, I want to connect my Google Calendar or Apple Calendar to papai via `/setup` or natural language, so the bot can read and write calendar events on my behalf.
2. **Calendar-to-papai sync** — As a user, I want papai to detect recurring calendar events and offer to create matching recurring tasks in my task provider, so I don't have to define the same schedule twice.
3. **Papai-to-calendar sync** — As a user, when I create a recurring task in papai, I want it to optionally appear as a recurring event in my connected calendar, so I can see my task schedule alongside my meetings.
4. **Bidirectional updates** — As a user, when I change the time or title of a synced recurring task (in either papai or my calendar), I want the change reflected on the other side, so the two stay in sync.
5. **Notification on upcoming events** — As a user, I want papai to notify me about upcoming calendar events, so I don't miss meetings even when I'm not looking at my calendar.
6. **Non-goal** — One-off event task creation, free/busy queries, calendar-aware briefings, and daily planning sessions are out of scope. One-off events trigger notifications only, not task creation.

## Approach

**Approach A: Unified CalDAV layer via tsdav.** Both Google Calendar and Apple Calendar support CalDAV. tsdav is a TypeScript CalDAV/WebDAV client (MIT license) that provides `DAVClient` with OAuth and Basic auth support, sync primitives (ctag, syncToken), and full iCalendar CRUD. One `CalendarProvider` interface wraps both providers, differing only in auth and server URL.

Alternatives considered:

- Google REST API (`googleapis`) + tsdav separately: two codepaths, heavy dependency, overkill for this scope.
- Google REST API only, Apple deferred: delays Apple support, locks into REST patterns.
- Keeper.sh: AGPL-3.0 license incompatible; infrastructure mismatch (requires PostgreSQL + Redis + BullMQ); tracks timeslots only, not event details.

## Architecture

### New module: `src/calendar/`

```
src/calendar/
  types.ts                    — CalendarProvider interface, CalendarEvent, SyncState types
  factory.ts                  — buildCalendarProvider(userId) factory
  caldav-client.ts            — tsdav DAVClient wrapper (auth, connect, disconnect)
  google-auth.ts              — Google OAuth 2.0 flow (local HTTP callback server)
  google-provider.ts          — Google Calendar via CalDAV (tsdav with OAuth)
  apple-provider.ts           — Apple Calendar via CalDAV (tsdav with Basic auth)
  sync-engine.ts              — Bidirectional sync logic (detect changes, resolve conflicts)
  sync-state.ts               — Sync state persistence (last sync time, sync tokens, ctag)
  event-mapper.ts             — iCalendar ↔ papai domain type mapping
  notification-scheduler.ts   — Upcoming event notification logic
```

### Integration with existing architecture

```
User (Telegram/Mattermost/Discord)
  → ChatProvider
  → bot.ts
     → /setup wizard: new "Connect Calendar" step
     → /config: new calendar config keys visible
     → LLM tools (new, 'calendar' capability):
        connect_calendar, disconnect_calendar
        list_calendars, list_calendar_events, get_upcoming_events
        sync_recurring_to_calendar, sync_calendar_to_recurring
        list_sync_links, resolve_sync_conflict, dismiss_calendar_event
     → calendar/sync-engine.ts (bidirectional sync)
        → CalendarProvider (google or apple, via tsdav CalDAV)
        → TaskProvider (existing Kaneo/YouTrack)
     → calendar/notification-scheduler.ts
        → chatProvider.sendMessage() for event reminders
  → scheduler-instance.ts (new scheduled tasks):
     'calendar-sync-poll'      — 5 min interval, runs sync engine per user
     'calendar-notification'   — 60s interval, checks upcoming events
```

### CalendarProvider interface

```typescript
interface CalendarProvider {
  readonly providerId: 'google' | 'apple'
  connect(): Promise<void>
  disconnect(): Promise<void>
  listCalendars(): Promise<CalendarInfo[]>
  listEvents(calendarId: string, range: TimeRange): Promise<CalendarEvent[]>
  createEvent(calendarId: string, event: CalendarEventCreate): Promise<CalendarEvent>
  updateEvent(calendarId: string, eventId: string, event: CalendarEventUpdate): Promise<CalendarEvent>
  deleteEvent(calendarId: string, eventId: string): Promise<void>
  getSyncState(calendarId: string): Promise<SyncToken | null>
}
```

Both `google-provider.ts` and `apple-provider.ts` implement this interface. They share the same CalDAV protocol via tsdav but differ in auth (OAuth vs Basic) and server URL.

## Data Model

### New DB tables

**`calendar_connections`** — one row per user's connected calendar:

| Column          | Type          | Purpose                               |
| --------------- | ------------- | ------------------------------------- |
| `id`            | text PK       | UUID                                  |
| `user_id`       | text          | Platform user ID                      |
| `provider`      | text          | `'google'` or `'apple'`               |
| `calendar_id`   | text          | Remote calendar ID from provider      |
| `calendar_name` | text          | Display name (e.g., "Work")           |
| `sync_token`    | text nullable | CalDAV syncToken for incremental sync |
| `ctag`          | text nullable | CalDAV ctag for change detection      |
| `enabled`       | text          | `'1'` or `'0'`                        |
| `last_sync_at`  | text nullable | ISO timestamp of last successful sync |
| `created_at`    | text          |                                       |
| `updated_at`    | text          |                                       |

Indexes: `idx_cal_conn_user`, `idx_cal_conn_enabled`

**`calendar_sync_links`** — explicit link between a calendar recurring event and a papai recurring task:

| Column               | Type          | Purpose                                     |
| -------------------- | ------------- | ------------------------------------------- |
| `id`                 | text PK       | UUID                                        |
| `user_id`            | text          | Platform user ID                            |
| `connection_id`      | text FK       | References `calendar_connections.id`        |
| `calendar_event_uid` | text          | iCalendar UID of the remote recurring event |
| `recurring_task_id`  | text          | References `recurring_tasks.id`             |
| `sync_direction`     | text          | `'bidirectional'`                           |
| `last_remote_etag`   | text nullable | ETag of last-seen remote event version      |
| `last_local_hash`    | text nullable | Hash of last-synced local task fields       |
| `conflict_state`     | text nullable | `'none'` or `'pending_resolution'`          |
| `conflict_details`   | text nullable | JSON: `{ remote: {...}, local: {...} }`     |
| `created_at`         | text          |                                             |
| `updated_at`         | text          |                                             |

Indexes: `idx_cal_sync_user`, `idx_cal_sync_connection`, `idx_cal_sync_event_uid`, `idx_cal_sync_recurring`

**`calendar_event_reminders`** — upcoming event notification tracking:

| Column               | Type | Purpose        |
| -------------------- | ---- | -------------- |
| `user_id`            | text |                |
| `connection_id`      | text |                |
| `calendar_event_uid` | text |                |
| `event_start`        | text | ISO datetime   |
| `remind_at`          | text | ISO datetime   |
| `reminded`           | text | `'1'` or `'0'` |
| `created_at`         | text |                |

PK: `(user_id, calendar_event_uid, event_start)`

### New config keys

```typescript
type CalendarConfigKey =
  | 'google_oauth_client_id'
  | 'google_oauth_client_secret'
  | 'google_oauth_refresh_token'
  | 'google_oauth_access_token'
  | 'apple_caldav_url'
  | 'apple_caldav_username'
  | 'apple_caldav_password'
  | 'calendar_reminder_minutes' // global default, default '15'
  | 'calendar_sync_enabled' // '1' or '0'
  | 'calendar_dismissed_events' // JSON array of dismissed event UIDs (internal, not user-visible)
```

Sensitive keys: all credential keys. User-visible preferences: `calendar_reminder_minutes`, `calendar_sync_enabled`.

### Migration

`src/db/migrations/<next>_calendar_sync.ts` — creates all three tables with indexes.

## Sync Engine

### Scheduled tasks

**`calendar-sync-poll`** (5 min interval):

- Queries all enabled `calendar_connections`
- For each connection, runs incremental sync via CalDAV syncToken/ctag
- If syncToken unavailable, falls back to full scan with time range (last 30 days → next 90 days)

**`calendar-notification`** (60s interval):

- Queries `calendar_event_reminders` where `reminded = '0'` and `remind_at <= now`
- Sends notification via `chatProvider.sendMessage(userId, markdown)`
- Marks row as `reminded = '1'`
- Looks ahead 2x the reminder window and inserts new reminder rows for upcoming events

### Sync flow (`sync-engine.ts`)

```
syncForUser(userId, connection):
  1. Fetch remote changes (incremental via syncToken, or full scan)
  2. Update syncToken/ctag in calendar_connections
  3. For each remote recurring event:
     a. Find existing calendar_sync_links by calendar_event_uid
     b. If link exists → compare lastRemoteEtag with current ETag
        - No change → skip
        - Changed → apply remote changes to local recurring task (if no conflict)
     c. If no link → bot proposes match (new recurring event detected)
  4. For each local recurring task with sync enabled (sync_to_calendar = '1'):
     a. Find link by recurring_task_id
     b. If link exists → compare lastLocalHash with current task hash
        - Changed → push changes to remote calendar event
     c. If no link → create new calendar event + link row
```

### Conflict detection

When both sides changed since last sync:

1. Compute local hash of task fields (title, cron, timezone, description)
2. Compare stored `lastLocalHash` vs current hash → local changed
3. Compare stored `lastRemoteEtag` vs current ETag → remote changed
4. If both changed → set `conflict_state = 'pending_resolution'`, store `conflict_details`
5. Notify user via chat with both versions
6. User picks winner → overwrite losing side, clear conflict_state

### RRULE handling

Inbound CalDAV RRULE strings are stored verbatim in `recurring_tasks.rrule`; outbound writes push the same column value to CalDAV unchanged. No translation layer exists. See `docs/superpowers/specs/2026-04-19-rrule-library-adoption-design.md` for the unified recurrence format.

### Discovery flow

When a new recurring event is found on a connected calendar:

1. Bot sends: "Found recurring event **'Weekly Retro'** (every Monday at 3pm). Create a matching recurring task?"
2. User says yes → `create_recurring_task` + insert `calendar_sync_links` row
3. User says no → event UID added to `calendar_dismissed_events` config key (JSON array)

## Authentication & Setup

### Google Calendar (OAuth 2.0)

Uses a temporary local HTTP server on a random port:

```
User: "connect my google calendar"
  1. Bot checks for GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars
  2. Bot starts a temporary HTTP server on localhost:{random port}
  3. Bot generates PKCE code_verifier + code_challenge
  4. Bot sends user a URL: https://accounts.google.com/o/oauth2/v2/auth?...
     redirect_uri=http://localhost:{port}/callback
     scope=https://www.googleapis.com/auth/calendar
  5. User opens URL in browser, authorizes
  6. Google redirects to localhost callback with auth code
  7. Bot exchanges code for access_token + refresh_token
  8. Bot stores refresh_token in user_config (google_oauth_refresh_token)
  9. Bot shuts down the temp server
  10. Bot: "Google Calendar connected. Which calendars should I sync?"
  11. Bot calls listCalendars(), presents numbered list
  12. User picks calendars → calendar_connections rows created
```

Token refresh: the CalDAV client checks token expiry before every request. If expired, it uses the refresh_token to get a new access_token, updates `google_oauth_access_token` in user_config.

Required env vars (set by bot operator):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Apple Calendar (CalDAV Basic Auth)

```
User: "connect my apple calendar"
  1. Bot: "I'll need your Apple ID email and an app-specific password.
           Generate one at https://appleid.apple.com > Sign-In and Security > App-Specific Passwords"
  2. User provides email + app-specific password via /setup or DM
  3. Bot stores as apple_caldav_url, apple_caldav_username, apple_caldav_password in user_config
  4. Bot connects via tsdav with Basic auth to https://caldav.icloud.com
  5. Bot: "Apple Calendar connected. Which calendars should I sync?"
  6. Same calendar selection flow as Google
```

### /setup integration

New step in the setup wizard (after LLM config, before completion):

```
Would you like to connect a calendar?
  1. Google Calendar
  2. Apple Calendar
  3. Skip for now
```

Calendar setup is optional — the bot works fine without it.

### /config integration

New user-visible keys when calendar is connected:

- `calendar_reminder_minutes` — "Reminder time (minutes before event)"
- `calendar_sync_enabled` — "Calendar sync on/off"

Calendar credentials are hidden from `/config` output.

### Disconnect

```
User: "disconnect my calendar"
  1. Bot deletes calendar_connections rows for that provider
  2. Bot deletes associated calendar_sync_links rows
  3. Bot deletes calendar_event_reminders rows
  4. Bot clears credential config keys for that provider
  5. Bot: "Calendar disconnected. Synced recurring tasks remain but will no longer sync."
```

## Tools, Notifications & Error Handling

### New LLM tools (capability-gated, `calendar` capability)

All tools only appear when the user has an active calendar connection.

| Tool                         | Purpose                                         | Context    |
| ---------------------------- | ----------------------------------------------- | ---------- |
| `connect_calendar`           | Initiate Google/Apple calendar connection       | DM only    |
| `disconnect_calendar`        | Remove calendar connection                      | DM only    |
| `list_calendars`             | Show connected calendars                        | DM + group |
| `list_calendar_events`       | List events in a date range                     | DM + group |
| `get_upcoming_events`        | Next N events across all synced calendars       | DM + group |
| `sync_recurring_to_calendar` | Push a papai recurring task → calendar event    | DM + group |
| `sync_calendar_to_recurring` | Create papai recurring task from calendar event | DM + group |
| `list_sync_links`            | Show active sync links                          | DM + group |
| `resolve_sync_conflict`      | Pick winner for a pending conflict              | DM + group |
| `dismiss_calendar_event`     | Stop proposing sync for a specific event        | DM + group |

### Notification format

Linked recurring event:

```
📅 "Weekly Retro" starts in 15 minutes
   → Linked task: [TASK-42] Weekly Retro Meeting
```

One-off event (notification only):

```
📅 "Dentist Appointment" starts in 30 minutes (2:00 PM, Thursday)
```

### Reminder timing priority

1. Event's own VALARM reminders (from calendar's iCalendar data)
2. Per-event override (stored in `calendar_event_reminders.remind_at`, set via tool)
3. Global default: `calendar_reminder_minutes` config key (default 15)

The notification scheduler inserts rows into `calendar_event_reminders` during the lookahead phase, calculating `remind_at = event_start - reminder_minutes` for each upcoming event.

### Error handling

New error kinds following the existing `AppError` pattern:

| Kind                         | When                            | User message                                                                            |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `calendar_auth_expired`      | OAuth token refresh fails       | "Your Google Calendar authorization expired. Please reconnect with `connect_calendar`." |
| `calendar_connection_failed` | tsdav can't reach CalDAV server | "Could not reach your calendar. I'll retry on the next sync cycle."                     |
| `calendar_rate_limited`      | CalDAV server returns 429       | Logged as warn, retried next cycle with exponential backoff                             |
| `calendar_sync_conflict`     | Both sides changed              | Triggers conflict resolution flow                                                       |

Transient errors (connection, rate limit) are logged and retried on the next sync cycle. No user notification unless they persist for 3+ consecutive cycles, then a single warning is sent.

### Testing strategy

- **Unit tests**: `event-mapper.ts`, `sync-engine.ts` with mock CalendarProvider
- **Integration tests**: full sync flow with mock CalDAV server (tsdav supports configurable `serverUrl`)
- **Provider tests**: each provider tested against expected CalDAV request/response patterns
- **Notification tests**: scheduler inserts correct reminder rows, fires at correct time

## Dependencies

- **tsdav** (MIT) — CalDAV/WebDAV client for both Google and Apple Calendar
- **uuid** or **crypto.randomUUID()** — for generating row IDs (already available in Bun)
- No new infrastructure dependencies — uses existing SQLite, existing scheduler, existing chatProvider
