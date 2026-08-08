<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 10: Notification Controls & User Preferences — Development Plan

**Created**: 2026-03-20  
**Scope**: User stories from `docs/user-stories/phase-10-notification-controls.md`  
**Runtime**: Bun  
**Test runner**: `bun:test`  
**Linter**: oxlint (no `eslint-disable`, no `@ts-ignore`)

---

## Epic Overview

- **Business Value**: Users gain full autonomy over when and how the assistant contacts them. Timezone awareness eliminates off-hours deliveries for users in any region. Quiet hours hold non-urgent messages until the user is active. Working-day configuration prevents briefings and nudges on rest days. Digest mode stops interruption fatigue by collapsing proactive traffic into a single daily summary. Granular per-feature toggles let users keep what's valuable and silence what isn't. Snooze/dismiss/reschedule closes the feedback loop directly from chat. A single show-and-reset command gives full preference transparency.
- **Success Metrics**:
  - Setting `timezone` to any valid IANA string causes all scheduled proactive messages to fire at the correct local time; times displayed in bot responses are in that timezone
  - A proactive message generated during quiet hours is held and delivered after `quiet_hours_end`; an urgent overdue escalation (overdue ≥ 3 days) bypasses quiet hours and arrives immediately
  - On a day not in `working_days`, no briefing or nudge fires; on the first and last working day, weekly kickoff and summary fire as configured by Phase 9
  - With `delivery_mode = digest`, multiple proactive messages across the day are consolidated and delivered once at `digest_time`; direct replies from the user are never held
  - With `delivery_mode = muted`, no proactive message is sent; direct replies still work
  - Disabling `morning_briefing` stops briefings without affecting nudges; disabling `deadline_nudges` stops nudges without affecting briefings
  - Replying "snooze 2 hours" to a proactive message reschedules it; "dismiss" stops that message permanently; "remind me tomorrow morning" schedules delivery for the next working-day start
  - `get_notification_preferences` returns all nine preference keys in a single formatted summary; `reset_notification_preferences` reverts them to documented defaults
- **Priority**: High — closes the final usability gap for users in non-UTC timezones or with non-standard schedules; depends on Phases 7, 8, and 9 being fully implemented
- **Timeline**: 5–6 days

---

## Current State Audit

### What is already in place

| Area                                                                                                                                                                     | Status                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `user_config` table with `getCachedConfig` / `setCachedConfig` / `getAllConfig`                                                                                          | ✅ Complete                         |
| SQLite migration framework (`runMigrations`, numbered `NNN_name`)                                                                                                        | ✅ Complete                         |
| `drizzle-orm/bun-sqlite` schema + typed query layer                                                                                                                      | ✅ Complete                         |
| `/config` and `/set` commands for reading and writing config keys                                                                                                        | ✅ Complete                         |
| `chatProvider.sendMessage(userId, markdown)` for proactive contact                                                                                                       | ✅ Complete                         |
| Structured logger with child scopes (`logger.child({ scope })`)                                                                                                          | ✅ Complete                         |
| Tool index pattern: `makeXxxTool(provider)` returning `ToolSet[string]`                                                                                                  | ✅ Complete                         |
| `croner` cron scheduler with per-user timezone support                                                                                                                   | ⚠️ Added by Phase 8 (reused here)   |
| `ProactiveAlertService` with `checkOverdue`, `checkStaleness`, `checkBlocked`                                                                                            | ⚠️ Added by Phase 7 (extended here) |
| `BriefingService` with `generate`, `getMissedBriefing`                                                                                                                   | ⚠️ Added by Phase 7 (extended here) |
| `ReminderService` with snooze / reschedule / cancel                                                                                                                      | ⚠️ Added by Phase 7 (extended here) |
| `ProactiveAlertScheduler` with per-user briefing and global poller jobs                                                                                                  | ⚠️ Added by Phase 7 (extended here) |
| `alert_state` table (per-task suppression via `suppress_until`)                                                                                                          | ⚠️ Added by Phase 7 (migration 010) |
| `user_briefing_state` table (`last_briefing_date`, `last_briefing_at`)                                                                                                   | ⚠️ Added by Phase 7 (migration 010) |
| `reminders` table with `status = 'snoozed'` support                                                                                                                      | ⚠️ Added by Phase 7 (migration 010) |
| `weekly_state` table (`last_summary_date`, `last_kickoff_date`)                                                                                                          | ⚠️ Added by Phase 9 (migration 011) |
| `EventSuggestionService` for creation / update / completion suggestions                                                                                                  | ⚠️ Added by Phase 9                 |
| Config keys: `briefing_time`, `briefing_timezone`, `briefing_mode`, `deadline_nudges`, `staleness_days`, `weekly_review`, `workdays`, `week_end_time`, `week_start_time` | ⚠️ Added by Phases 7 & 9            |
| Migrations 008–011 registered in `src/db/index.ts`                                                                                                                       | ⚠️ Registered by Phases 7–9         |

### Confirmed gaps (mapped to user stories)

| Gap                                                                                                         | Story | File(s)                                                  |
| ----------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| No unified `timezone` config key; only feature-scoped `briefing_timezone` from Phase 7                      | US1   | `src/types/config.ts`                                    |
| No quiet-hours enforcement: proactive messages fire at any hour                                             | US2   | `src/proactive/scheduler.ts`                             |
| No `held_messages` table for queuing messages during quiet hours                                            | US2   | `src/db/schema.ts`                                       |
| `workdays` (Phase 9) only governs weekly scheduling; briefings and nudges still fire on all weekdays        | US3   | `src/proactive/scheduler.ts`, `src/proactive/service.ts` |
| No `delivery_mode` config key or digest / muted logic                                                       | US4   | none yet                                                 |
| No `digest_queue` table for buffering proactive messages                                                    | US4   | `src/db/schema.ts`                                       |
| No `morning_briefing` toggle (separate from clearing `briefing_time`)                                       | US5   | `src/types/config.ts`                                    |
| No `event_suggestions` toggle for Phase 9's EventSuggestionService                                          | US5   | `src/types/config.ts`                                    |
| `snooze_reminder` exists for reminder rows only; briefings, nudges, and weekly messages have no snooze path | US6   | `src/proactive/reminders.ts`                             |
| No `snoozed_until` field on `user_briefing_state`; no snooze fields on `weekly_state`                       | US6   | `src/db/schema.ts`                                       |
| No `snooze_notification`, `dismiss_notification`, `reschedule_notification`, or `list_snoozed` LLM tools    | US6   | none yet                                                 |
| No `get_notification_preferences` or `reset_notification_preferences` LLM tools                             | US7   | none yet                                                 |

### User story status summary

| Story | Description                                | Status     | Work Required                                                                                  |
| ----- | ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| US1   | Unified timezone setting                   | ❌ Missing | New `timezone` config key, backward-compat read order, scheduler update, display normalisation |
| US2   | Quiet hours enforcement                    | ❌ Missing | `held_messages` table, `QuietHoursGate`, release cron job, migration 012                       |
| US3   | Working days for all features              | ❌ Missing | Extend `workdays` read to govern briefings and nudges (not just weekly scheduling)             |
| US4   | Delivery mode (immediate / digest / muted) | ❌ Missing | `digest_queue` table, `ProactiveMessageSender` wrapper, digest flush job, new config key       |
| US5   | Per-feature toggles                        | ❌ Missing | `morning_briefing` and `event_suggestions` config keys + guard logic in services               |
| US6   | Snooze / dismiss / reschedule any message  | ❌ Missing | `snoozed_until` columns, `NotificationActionService`, four new LLM tools                       |
| US7   | View and reset all preferences             | ❌ Missing | `get_notification_preferences` and `reset_notification_preferences` LLM tools                  |

---

## Library Research

### Scheduler — `croner` (reused from Phases 7, 8, 9)

No additional library needed. Per-user quiet-hours release jobs and digest flush jobs follow the same pattern as Phase 7 briefing jobs: `Cron(expr, { timezone: tz }, callback)`.

| Library     | Decision | Rationale                                                              |
| ----------- | -------- | ---------------------------------------------------------------------- |
| **croner**  | ✅ Reuse | Already installed; timezone-aware; zero dependencies; MIT; 2025-active |
| `node-cron` | ❌ Skip  | Already replaced by croner in Phase 8                                  |

### Timezone Arithmetic — built-ins only

Timezone-aware time comparisons (quiet-hours boundary check, working-day check, digest-time check) use `Intl.DateTimeFormat` with `timeZone` option — available in all V8 / JavaScriptCore environments Bun uses. No additional library is needed.

| Approach                  | Decision  | Rationale                                                 |
| ------------------------- | --------- | --------------------------------------------------------- |
| **`Intl.DateTimeFormat`** | ✅ Chosen | Zero dependencies; IANA names; accurate DST handling      |
| `luxon`                   | ❌ Skip   | Already avoided in all prior phases; Intl covers the need |
| `date-fns-tz`             | ❌ Skip   | Same coverage as Intl; extra bundle weight                |
| `@js-temporal/polyfill`   | ❌ Skip   | Over-engineered for the comparisons needed here           |

---

## Technical Architecture

### Component Map

```
User sets timezone: /set timezone Europe/Warsaw
  └─ setConfig(userId, 'timezone', 'Europe/Warsaw')
  └─ ProactiveAlertScheduler.refreshUserJobs(userId)
       └─ re-register briefing cron with new tz
       └─ re-register quiet-hours release cron with new tz
       └─ re-register digest flush cron with new tz

User sets quiet hours: /set quiet_hours_start 22:00  +  /set quiet_hours_end 07:00
  └─ ProactiveAlertScheduler.registerQuietHoursReleaseJob(userId, '07:00', 'Europe/Warsaw')

Scheduler tick: alert poller fires, user has deadline nudge to send
  └─ ProactiveAlertService.runAlertCycle
       └─ for each nudge: ProactiveMessageSender.send(userId, message, { urgent: false })
            └─ QuietHoursGate.isQuietNow(userId) → true (it's 23:15 local time)
            └─ INSERT held_messages (userId, message, created_at)
            └─ return (message held)

QuietHoursReleaseJob fires at 07:00 (user's timezone)
  └─ fetch all held_messages WHERE userId ORDER BY created_at
  └─ delivery_mode = getCachedConfig(userId, 'delivery_mode') ?? 'immediate'
  └─ if 'immediate': send each in order via chatProvider.sendMessage
  └─ if 'digest': add each to digest_queue (DeliveryMode.flush handles it at digest_time)
  └─ if 'muted': discard (urgent messages were never held)
  └─ DELETE held_messages WHERE userId

DigestFlushJob fires at digest_time (user's timezone, end of working day)
  └─ SELECT * FROM digest_queue WHERE userId ORDER BY created_at
  └─ combine into single consolidated message with **📥 Daily Digest — {date}** header
  └─ chatProvider.sendMessage(userId, digestMessage)
  └─ DELETE FROM digest_queue WHERE userId

User message: "snooze 2 hours" (after receiving a deadline nudge)
  └─ processMessage → callLlm
       └─ LLM calls snooze_notification({ type: 'deadline_nudge', taskId: '...', duration: '2 hours' })
            └─ NotificationActionService.snooze({ type, taskId, duration, userId })
                 └─ alert_state: SET suppress_until = now + 2h WHERE userId AND taskId
                 └─ return confirmation with new delivery time in user's timezone

User message: "dismiss" (after receiving a morning briefing)
  └─ LLM calls dismiss_notification({ type: 'morning_briefing', userId })
       └─ NotificationActionService.dismiss({ type: 'morning_briefing', userId })
            └─ user_briefing_state: SET snoozed_until = '9999-12-31' (permanent suppress)
            └─ (note: does not delete briefing_time config — user can re-enable)
            └─ return "Briefing dismissed permanently. Use get_notification_preferences to re-enable."

User message: "remind me tomorrow morning" (after receiving a weekly kickoff)
  └─ LLM calls reschedule_notification({ type: 'weekly_kickoff', userId, newFireAt: '<next-working-day-start-ISO>' })
       └─ NotificationActionService.reschedule({ type, userId, newFireAt })
            └─ weekly_state: SET kickoff_snoozed_until = newFireAt
            └─ return confirmation in user's timezone

User message: "what have I snoozed?"
  └─ LLM calls list_snoozed({ userId })
       └─ NotificationActionService.listSnoozed(userId)
            └─ query: reminders WHERE status='snoozed', alert_state WHERE suppress_until > now,
                       user_briefing_state WHERE snoozed_until > now,
                       weekly_state WHERE kickoff/summary_snoozed_until > now
            └─ returns unified SnoozedItem[] list

User message: "show my notification settings"
  └─ LLM calls get_notification_preferences({ userId })
       └─ reads all 9 preference keys from user_config
       └─ returns formatted summary

User message: "reset notification settings to defaults"
  └─ LLM calls reset_notification_preferences({ userId })
       └─ deletes all 9 preference keys from user_config
       └─ returns confirmation with documented defaults table
```

### New Config Keys

Added to `src/types/config.ts` (`ConfigKey` union + `CONFIG_KEYS` array):

| Key                 | Format                               | Default                                            | Description                                         |
| ------------------- | ------------------------------------ | -------------------------------------------------- | --------------------------------------------------- |
| `timezone`          | IANA string (e.g. `'Europe/Warsaw'`) | none (falls back to `briefing_timezone`, then UTC) | Unified user timezone for all proactive features    |
| `quiet_hours_start` | `'HH:MM'` (24h)                      | none (disabled)                                    | Start of quiet period in local time                 |
| `quiet_hours_end`   | `'HH:MM'` (24h)                      | none (disabled)                                    | End of quiet period; held messages release here     |
| `delivery_mode`     | `'immediate' \| 'digest' \| 'muted'` | `'immediate'`                                      | How proactive messages are delivered                |
| `digest_time`       | `'HH:MM'` (24h)                      | `'17:00'`                                          | Local time for digest flush on working days         |
| `morning_briefing`  | `'enabled' \| 'disabled'`            | `'enabled'`                                        | Toggle for morning briefing delivery (Phase 7)      |
| `event_suggestions` | `'enabled' \| 'disabled'`            | `'enabled'`                                        | Toggle for post-create/update suggestions (Phase 9) |

**Backward-compatibility note**: `timezone` takes precedence over the Phase 7 `briefing_timezone` key. All services that currently read `briefing_timezone` must be updated to call `resolveUserTimezone(userId)` helper (reads `timezone` first, falls back to `briefing_timezone`, then `'UTC'`). No database migration or data deletion needed; existing `briefing_timezone` values continue to work.

**`working_days` scope expansion**: The `workdays` key added in Phase 9 only governed weekly summary/kickoff triggers. Phase 10 widens its semantics: `workdays` now also controls whether `BriefingService` fires on a given day and whether `ProactiveAlertService` sends nudges on a given day. No new key; existing data unchanged.

### Data Model

#### `held_messages` (migration 012)

Stores proactive messages held during quiet hours for deferred delivery.

| Column              | Type             | Description                                                                |
| ------------------- | ---------------- | -------------------------------------------------------------------------- |
| `id`                | TEXT PK          | UUID                                                                       |
| `user_id`           | TEXT NOT NULL    | Owner                                                                      |
| `message`           | TEXT NOT NULL    | Full markdown message body                                                 |
| `is_urgent`         | INTEGER NOT NULL | `0` or `1`; urgent messages bypass quiet hours and are never inserted here |
| `notification_type` | TEXT NOT NULL    | e.g. `'deadline_nudge'`, `'morning_briefing'`, `'weekly_kickoff'`          |
| `created_at`        | TEXT NOT NULL    | DEFAULT `(datetime('now'))`                                                |

Indexes: `(user_id)`, `(user_id, created_at)` powers the ordered flush query.

#### `digest_queue` (migration 012)

Collects proactive messages for users in digest mode.

| Column              | Type          | Description                                 |
| ------------------- | ------------- | ------------------------------------------- |
| `id`                | TEXT PK       | UUID                                        |
| `user_id`           | TEXT NOT NULL | Owner                                       |
| `message`           | TEXT NOT NULL | Full markdown message body                  |
| `notification_type` | TEXT NOT NULL | Source identifier for digest section header |
| `created_at`        | TEXT NOT NULL | DEFAULT `(datetime('now'))`                 |

Indexes: `(user_id)`, `(user_id, created_at)` powers the ordered flush query.

#### Schema extensions (migration 012)

| Table                 | Change                                                                             |
| --------------------- | ---------------------------------------------------------------------------------- |
| `user_briefing_state` | ADD COLUMN `snoozed_until TEXT` — ISO timestamp; NULL means not snoozed            |
| `weekly_state`        | ADD COLUMN `summary_snoozed_until TEXT` — ISO timestamp for snoozed weekly summary |
| `weekly_state`        | ADD COLUMN `kickoff_snoozed_until TEXT` — ISO timestamp for snoozed weekly kickoff |

### Timezone Resolution Helper

```
resolveUserTimezone(userId: string): string
  1. value = getCachedConfig(userId, 'timezone')
  2. if truthy → validate with Intl.DateTimeFormat([], { timeZone: value }) try/catch → return if valid
  3. fallback = getCachedConfig(userId, 'briefing_timezone')  // Phase 7 legacy
  4. if truthy → validate → return if valid
  5. return 'UTC'
```

Exposed from `src/proactive/index.ts`. All services in `src/proactive/` call this helper instead of reading either config key directly.

### QuietHoursGate Design

```typescript
// src/proactive/quiet-hours.ts

isQuietNow(userId: string): boolean
  // reads quiet_hours_start, quiet_hours_end, resolveUserTimezone(userId)
  // uses Intl.DateTimeFormat to get HH:MM in user's tz
  // returns true if current local time is within [start, end)
  // handles midnight-crossing correctly: 22:00–07:00 means 22:00–23:59 and 00:00–07:00

hold(userId: string, message: string, notificationType: string): Promise<void>
  // INSERT held_messages

releaseHeld(userId: string, deliveryMode: string): Promise<void>
  // SELECT ordered held_messages
  // for each: route to chatProvider.sendMessage or digest_queue per deliveryMode
  // DELETE held_messages WHERE user_id = ?
```

### ProactiveMessageSender Design

```typescript
// src/proactive/sender.ts

send(userId: string, message: string, notificationType: string, opts: { urgent?: boolean }): Promise<void>
```

Decision tree in `send`:

1. `delivery_mode = muted` AND NOT `urgent` → return (noop)
2. `isQuietNow(userId)` AND NOT `urgent` → `hold(userId, message, notificationType)` → return
3. `delivery_mode = digest` → INSERT `digest_queue` → return
4. `delivery_mode = immediate` (default) → `chatProvider.sendMessage(userId, message)`

Urgency rule: a message is `urgent` when `ProactiveAlertService` classifies it as an overdue escalation at tier ≥3 (≥3 days overdue, as defined by Phase 7). Urgency bypasses both muted and quiet-hours checks but never bypasses digest (digest-mode users chose that mode explicitly; urgent messages still appear in the digest, just marked with `⚠️ Urgent` prefix).

**All code that currently calls `chatProvider.sendMessage` inside `src/proactive/` must be migrated to call `ProactiveMessageSender.send`.** Direct replies in `src/llm-orchestrator.ts` continue to call `chatProvider` directly and are unaffected.

### NotificationActionService Design

```typescript
// src/proactive/notification-actions.ts

snooze(params: { userId, notificationType, taskId?, duration }): Promise<SnoozedItem>
dismiss(params: { userId, notificationType, taskId? }): Promise<void>
reschedule(params: { userId, notificationType, taskId?, newFireAt }): Promise<SnoozedItem>
listSnoozed(userId: string): Promise<SnoozedItem[]>
resetAll(userId: string): Promise<void>  // used by reset_notification_preferences
```

Internal routing by `notificationType`:

| Type                                                       | Backing store                           | Operation                                                                        |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `'reminder'`                                               | `reminders.status`, `reminders.fire_at` | delegate to `ReminderService.snooze/cancel/reschedule`                           |
| `'deadline_nudge'`, `'staleness_alert'`, `'blocked_alert'` | `alert_state.suppress_until`            | update suppression timestamp                                                     |
| `'morning_briefing'`                                       | `user_briefing_state.snoozed_until`     | set to `now + duration` or ISO timestamp or `'9999-12-31T23:59:59Z'` for dismiss |
| `'weekly_summary'`                                         | `weekly_state.summary_snoozed_until`    | set to target or permanent                                                       |
| `'weekly_kickoff'`                                         | `weekly_state.kickoff_snoozed_until`    | set to target or permanent                                                       |

`listSnoozed` performs a UNION of:

1. `SELECT` from `reminders` WHERE `status='snoozed'`
2. `SELECT` from `alert_state` WHERE `suppress_until > datetime('now')`
3. `SELECT` from `user_briefing_state` WHERE `snoozed_until > datetime('now')`
4. `SELECT` from `weekly_state` WHERE `summary_snoozed_until > datetime('now')` OR `kickoff_snoozed_until > datetime('now')`

Returns unified `SnoozedItem[]` with fields: `id`, `type`, `description`, `resumesAt` (in user's local timezone).

### LLM Tools

| Tool                             | Description                                                          | Key input fields                                                                            |
| -------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `snooze_notification`            | Snooze the most recent proactive message by type                     | `notificationType`, `duration` (natural string → LLM converts to ISO `resumeAt`), `taskId?` |
| `dismiss_notification`           | Permanently suppress a proactive message type or task-specific alert | `notificationType`, `taskId?`, `permanent?` (default true)                                  |
| `reschedule_notification`        | Move a proactive message to a specific future time                   | `notificationType`, `newFireAt` (ISO timestamp), `taskId?`                                  |
| `list_snoozed`                   | List all currently snoozed or suppressed notifications               | none                                                                                        |
| `get_notification_preferences`   | Return all notification preference config keys as a readable summary | none                                                                                        |
| `reset_notification_preferences` | Revert all notification preference keys to documented defaults       | none (uses `confirm: true` convention from Phase 7's confirmation-gate pattern)             |

**Snooze tool LLM instruction**: The tool description instructs the LLM to resolve natural duration strings ("2 hours", "tomorrow morning", "next Monday") into explicit ISO timestamps (`resumeAt = now + duration`) before calling the tool. The `notificationType` value is populated from the most recently received proactive message type, which is included as a structured field in Phase 7/8/9 message headers.

### Preference Display Format

`get_notification_preferences` outputs:

```
**🔔 Notification Preferences**

**Timezone**: Europe/Warsaw
**Quiet Hours**: 22:00–07:00 (local)
**Working Days**: Mon, Tue, Wed, Thu, Fri
**Delivery Mode**: immediate

**Feature Toggles**
• Morning briefing: enabled (08:30, full mode)
• Deadline nudges: enabled (staleness after 7 days)
• Weekly review: enabled (Mon 09:00 kickoff, Fri 17:00 summary)
• Event suggestions: enabled

**Digest delivery time**: 17:00 (only applies when delivery_mode = digest)
```

`reset_notification_preferences` clears `timezone`, `quiet_hours_start`, `quiet_hours_end`, `delivery_mode`, `digest_time`, `morning_briefing`, `event_suggestions` from `user_config`. It does NOT reset `briefing_timezone` (Phase 7, separate concern), `deadline_nudges`, `weekly_review`, `workdays`, `week_end_time`, `week_start_time` (Phase 9 keys, separate reset path), or `briefing_time`, `briefing_mode`, `staleness_days` (Phase 7 keys outside the Phase 10 scope).

### Scheduler Integration

Phase 10 adds three classes of cron jobs to `ProactiveAlertScheduler`:

```
ProactiveAlertScheduler.start(...)
  ...existing from Phase 7...
  └─ for each user with quiet_hours_end configured:
       registerQuietHoursReleaseJob(userId, quiet_hours_end, tz)
  └─ for each user with delivery_mode = 'digest':
       registerDigestFlushJob(userId, digest_time ?? '17:00', tz)

ProactiveAlertScheduler.registerQuietHoursReleaseJob(userId, time, tz)
  └─ Cron("MM HH * * *", { timezone: tz }, () => releaseHeld(userId, deliveryMode))

ProactiveAlertScheduler.registerDigestFlushJob(userId, time, tz)
  └─ Cron("MM HH * * {workdays}", { timezone: tz }, () => flushDigest(userId))
```

`refreshUserJobs(userId)` is extended to re-register these new job types when `timezone`, `quiet_hours_end`, `delivery_mode`, or `digest_time` change via `/set`.

### File Structure

```
src/
  proactive/
    index.ts              ← export QuietHoursGate, ProactiveMessageSender, NotificationActionService
    quiet-hours.ts        ← QuietHoursGate (isQuietNow, hold, releaseHeld)
    sender.ts             ← ProactiveMessageSender.send (replaces direct chatProvider calls in proactive/)
    notification-actions.ts ← NotificationActionService (snooze, dismiss, reschedule, listSnoozed, resetAll)
    timezone.ts           ← resolveUserTimezone helper (reads 'timezone' → 'briefing_timezone' → 'UTC')
    notification-tools.ts ← snooze_notification, dismiss_notification, reschedule_notification,
                             list_snoozed, get_notification_preferences, reset_notification_preferences
    ...existing files from Phase 7/8/9...
  db/
    migrations/
      012_notification_controls.ts ← held_messages, digest_queue + ALTER TABLE extensions
  types/
    config.ts             ← extended with 7 new config keys

tests/
  proactive/
    quiet-hours.test.ts
    sender.test.ts
    notification-actions.test.ts
    notification-tools.test.ts
    timezone.test.ts
```

**Modified files** (beyond new files):

- `src/db/schema.ts` — add `held_messages`, `digest_queue` tables + column extensions
- `src/db/index.ts` — register `migration012NotificationControls`
- `src/types/config.ts` — 7 new keys added to `ConfigKey` union and `CONFIG_KEYS`
- `src/proactive/service.ts` — replace `chatProvider.sendMessage` calls with `ProactiveMessageSender.send`; add `workdays` check before firing briefings and nudges (US3)
- `src/proactive/briefing.ts` — read `morning_briefing` toggle; update `generate` to call `ProactiveMessageSender.send`; check `user_briefing_state.snoozed_until` before generating
- `src/proactive/scheduler.ts` — register quiet-hours release jobs and digest flush jobs; extend `refreshUserJobs`
- `src/proactive/index.ts` — export new services and tools
- `src/tools/index.ts` — include `notification-tools.ts` in LLM tool set

---

## Detailed Task Breakdown

### Phase 1 — DB Schema & Migration (0.5 days)

#### Task 1.1 — Create `src/db/migrations/012_notification_controls.ts`

- **File**: `src/db/migrations/012_notification_controls.ts` (new)
- **Change**: `CREATE TABLE held_messages (...)`, `CREATE TABLE digest_queue (...)`, `ALTER TABLE user_briefing_state ADD COLUMN snoozed_until TEXT`, `ALTER TABLE weekly_state ADD COLUMN summary_snoozed_until TEXT`, `ALTER TABLE weekly_state ADD COLUMN kickoff_snoozed_until TEXT`; create indexes on `(user_id)` and `(user_id, created_at)` for both new tables
- **Estimate**: 0.5h ±0.25h | **Priority**: Blocker
- **Acceptance Criteria**:
  - Migration runs cleanly on a DB with migrations 001–011 already applied
  - Both tables present with all columns after `initDb()`
  - `ALTER TABLE` additions do not break existing rows in `user_briefing_state` or `weekly_state`
  - `bun typecheck` passes
- **Dependencies**: Phase 9 migration 011 registered in `src/db/index.ts`

#### Task 1.2 — Add Drizzle schema definitions for new tables to `src/db/schema.ts`

- **File**: `src/db/schema.ts`
- **Change**: Add `heldMessages` and `digestQueue` table definitions with all columns. Add `snoozedUntil` to `userBriefingState` definition; add `summarySnoo zedUntil` and `kickoffSnoozedUntil` to `weeklyState` definition. Export inferred types: `HeldMessage`, `DigestQueueItem`.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: `typeof heldMessages.$inferSelect` contains all six columns; `typeof digestQueue.$inferSelect` contains all five; `bun typecheck` passes
- **Dependencies**: Task 1.1

#### Task 1.3 — Register migration 012 in `src/db/index.ts`

- **File**: `src/db/index.ts`
- **Change**: Import `migration012NotificationControls` and append to `MIGRATIONS` array after `migration011WeeklyState` (Phase 9)
- **Estimate**: 0.1h ±0 | **Priority**: Blocker
- **Acceptance Criteria**: `initDb()` applies all 12 migrations without error
- **Dependencies**: Tasks 1.1, 1.2

#### Task 1.4 — Extend `ConfigKey` in `src/types/config.ts`

- **File**: `src/types/config.ts`
- **Change**: Add `'timezone' | 'quiet_hours_start' | 'quiet_hours_end' | 'delivery_mode' | 'digest_time' | 'morning_briefing' | 'event_suggestions'` to the `ConfigKey` union and to the `CONFIG_KEYS` readonly array
- **Estimate**: 0.1h ±0 | **Priority**: High
- **Acceptance Criteria**: `isConfigKey('timezone')` and all six other new keys return `true`; `/config` command output includes all new keys; `bun typecheck` passes
- **Dependencies**: None

---

### Phase 2 — Timezone Resolution Helper (0.5 days)

#### Task 2.1 — Create `src/proactive/timezone.ts`

- **File**: `src/proactive/timezone.ts` (new)
- **Change**: Implement `resolveUserTimezone(userId: string): string`. Reads `timezone` config key first, falls back to `briefing_timezone`, then returns `'UTC'`. Validates the resolved string using `Intl.DateTimeFormat([], { timeZone: value })` in a try/catch — returns `'UTC'` on invalid IANA string.
- **Estimate**: 0.5h ±0.25h | **Priority**: Blocker
- **Acceptance Criteria**:
  - Returns `timezone` value when set to a valid IANA string
  - Returns `briefing_timezone` when only that key is set
  - Returns `'UTC'` when neither key is set
  - Returns `'UTC'` when an invalid string (e.g. `'Foobar/Baz'`) is stored
- **Dependencies**: Task 1.4

#### Task 2.2 — Update all proactive services to use `resolveUserTimezone`

- **Files**: `src/proactive/service.ts`, `src/proactive/briefing.ts`, `src/proactive/scheduler.ts`, `src/proactive/reminders.ts` (all from Phase 7/9)
- **Change**: Replace every direct read of `getCachedConfig(userId, 'briefing_timezone')` with a call to `resolveUserTimezone(userId)`. This is a pure substitution with no behavior change for users who have `briefing_timezone` set; it adds correct behaviour for users who set `timezone` instead.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: No remaining direct reads of `'briefing_timezone'` in `src/proactive/` (check with grep); `bun typecheck` passes
- **Dependencies**: Task 2.1

#### Task 2.3 — Write unit tests for `timezone.ts`

- **File**: `tests/proactive/timezone.test.ts` (new)
- **Change**: Parameterized tests covering: only `timezone` set, only `briefing_timezone` set, both set (`timezone` wins), neither set (returns `'UTC'`), invalid IANA string (returns `'UTC'`)
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: All tests pass with `bun test`
- **Dependencies**: Task 2.1

---

### Phase 3 — Quiet Hours Gate (1 day)

#### Task 3.1 — Create `src/proactive/quiet-hours.ts`

- **File**: `src/proactive/quiet-hours.ts` (new)
- **Change**: Implement `QuietHoursGate` class with:
  - `isQuietNow(userId: string): boolean` — reads `quiet_hours_start`, `quiet_hours_end`, `resolveUserTimezone`; computes current local `HH:MM` via `Intl.DateTimeFormat`; handles midnight-crossing ranges (start > end)
  - `hold(userId, message, notificationType): Promise<void>` — INSERT `held_messages`
  - `releaseHeld(userId, deliveryMode): Promise<void>` — SELECT ordered rows, route to `chatProvider.sendMessage` or `digest_queue` per `deliveryMode`, DELETE rows
- **Estimate**: 2h ±0.5h | **Priority**: Blocker
- **Acceptance Criteria**:
  - `isQuietNow` returns `true` for time inside the range, `false` outside
  - Midnight-crossing range `22:00–07:00`: `isQuietNow` is `true` at `23:15` and `04:00`, `false` at `12:00`
  - `hold` inserts one row per call with correct columns
  - `releaseHeld` with `delivery_mode = 'immediate'` sends each held message and deletes rows
  - `releaseHeld` with `delivery_mode = 'digest'` inserts into `digest_queue` instead
  - `releaseHeld` with `delivery_mode = 'muted'` deletes rows without sending
  - `bun typecheck` passes
- **Dependencies**: Tasks 1.2, 2.1

#### Task 3.2 — Write unit tests for `QuietHoursGate`

- **File**: `tests/proactive/quiet-hours.test.ts` (new)
- **Change**: Tests for `isQuietNow` (both same-day and midnight-crossing), `hold`, and `releaseHeld` for all three delivery modes. Use sinon/fake db for isolation.
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**: All tests pass; midnight-crossing edge case is explicitly covered
- **Dependencies**: Task 3.1

#### Task 3.3 — Register per-user quiet-hours release jobs in `ProactiveAlertScheduler`

- **File**: `src/proactive/scheduler.ts`
- **Change**: Add `registerQuietHoursReleaseJob(userId, quietHoursEnd, tz)` method — creates a `Cron("MM HH * * *", { timezone: tz }, releaseCallback)` job. Extend `start()` to enumerate all users with `quiet_hours_end` configured and register jobs. Extend `refreshUserJobs(userId)` to re-register when `timezone`, `quiet_hours_end`, `delivery_mode` change.
- **Estimate**: 1h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Job fires at the correct local time (verified in test with fake timers); `stopAll()` stops the new job types; `bun typecheck` passes
- **Dependencies**: Tasks 3.1, 2.2

---

### Phase 4 — Delivery Mode & Digest (1 day)

#### Task 4.1 — Create `src/proactive/sender.ts`

- **File**: `src/proactive/sender.ts` (new)
- **Change**: Implement `ProactiveMessageSender` class with `send(userId, message, notificationType, opts?)`. Full decision tree (muted noop → quiet-hours hold → digest queue → immediate send) as specified in the Technical Architecture section.
- **Estimate**: 1.5h ±0.5h | **Priority**: Blocker
- **Acceptance Criteria**:
  - `delivery_mode = 'muted'`, non-urgent: `chatProvider.sendMessage` is never called; no row inserted
  - `delivery_mode = 'muted'`, urgent: message is sent immediately
  - Quiet hours active, non-urgent: message goes to `held_messages`; `chatProvider.sendMessage` not called
  - Quiet hours active, urgent: message is sent immediately (bypass)
  - `delivery_mode = 'digest'`: message goes to `digest_queue`; `chatProvider.sendMessage` not called
  - `delivery_mode = 'immediate'` (default): `chatProvider.sendMessage` is called
  - `bun typecheck` passes
- **Dependencies**: Tasks 3.1, 1.2

#### Task 4.2 — Migrate all direct `chatProvider.sendMessage` calls in `src/proactive/` to `ProactiveMessageSender.send`

- **Files**: `src/proactive/service.ts`, `src/proactive/briefing.ts`, `src/proactive/reminders.ts`, `src/proactive/scheduler.ts` (all Phase 7/9 files)
- **Change**: Replace `chatProvider.sendMessage(userId, msg)` calls with `sender.send(userId, msg, notificationType, { urgent })`. Pass `urgent: true` only for overdue escalations at tier ≥3 (already flagged by Phase 7's `ProactiveAlertService`).
- **Estimate**: 1h ±0.25h | **Priority**: High
- **Acceptance Criteria**: No direct `chatProvider.sendMessage` calls remain in `src/proactive/` (confirm with grep — direct replies in `src/llm-orchestrator.ts` are exempted); `bun typecheck` passes
- **Dependencies**: Tasks 4.1, 2.2

#### Task 4.3 — Register digest flush jobs in `ProactiveAlertScheduler`

- **File**: `src/proactive/scheduler.ts`
- **Change**: Add `registerDigestFlushJob(userId, digestTime, tz)` — creates `Cron("MM HH * * {workdays}", { timezone: tz }, flushCallback)` where `workdays` is read from config. `flushCallback` runs the SQLite SELECT + combine + send + DELETE cycle. Register for all users with `delivery_mode = 'digest'` in `start()`; update `refreshUserJobs`.
- **Estimate**: 1h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Flush job fires only on configured working days at `digest_time`; digest message includes all queued items with source labels; rows are deleted after send; `bun typecheck` passes
- **Dependencies**: Tasks 4.1, 4.2

#### Task 4.4 — Write unit tests for `sender.ts`

- **File**: `tests/proactive/sender.test.ts` (new)
- **Change**: All decision-tree branches tested with mocked `QuietHoursGate`, `db`, and `chatProvider`. Cover all `delivery_mode` values × urgent flag combinations.
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**: All tests pass; eight distinct combinations (3 modes × urgent variants) are covered
- **Dependencies**: Task 4.1

---

### Phase 5 — Working Days Scope Expansion (0.5 days)

#### Task 5.1 — Apply `workdays` check in `BriefingService`

- **File**: `src/proactive/briefing.ts`
- **Change**: At the start of `generate(userId, mode)`, call `isWorkingDay(userId, today)` — if `false`, return `null` (skip briefing). `isWorkingDay` reads `workdays` config key and checks whether today's cron day-of-week index is in the comma-separated list; defaults to `'1,2,3,4,5'` (Mon–Fri) when not set.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Briefing is skipped on non-working days; briefing fires on all listed working days; default (no config) means Mon–Fri only; `bun typecheck` passes
- **Dependencies**: Task 1.4

#### Task 5.2 — Apply `workdays` check in `ProactiveAlertService`

- **File**: `src/proactive/service.ts`
- **Change**: At the start of `runAlertCycle()`, filter out users for whom today is not a working day. Those users are skipped for the entire nudge cycle (deadline nudges, staleness alerts, blocked alerts are not generated on non-working days).
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: No nudge is generated on non-working days for affected users; working-day users are unaffected; `bun typecheck` passes
- **Dependencies**: Tasks 1.4, 5.1

#### Task 5.3 — Add `morning_briefing` and `event_suggestions` toggle guards

- **Files**: `src/proactive/briefing.ts`, `src/proactive/service.ts` (EventSuggestionService, Phase 9)
- **Change**:
  - In `BriefingService.generate`: if `getCachedConfig(userId, 'morning_briefing') === 'disabled'` → return `null`
  - In `EventSuggestionService.suggestMissingDetails` / `detectSignificantChange` / `getCompletionSuggestions`: if `getCachedConfig(userId, 'event_suggestions') === 'disabled'` → return `null`
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Disabling `morning_briefing` stops briefings but not nudges or weekly messages; disabling `event_suggestions` stops all three Phase 9 suggestion types; `bun typecheck` passes
- **Dependencies**: Task 1.4

#### Task 5.4 — Write unit tests for working-day and toggle guards

- **File**: `tests/proactive/sender.test.ts` and existing Phase 7/9 test files
- **Change**: Extend existing tests with cases: briefing fires on working day, briefing skipped on non-working day, briefing skipped when `morning_briefing = 'disabled'`, suggestions skipped when `event_suggestions = 'disabled'`
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: All new cases pass; no existing tests broken
- **Dependencies**: Tasks 5.1, 5.2, 5.3

---

### Phase 6 — Snooze / Dismiss / Reschedule (1 day)

#### Task 6.1 — Create `src/proactive/notification-actions.ts`

- **File**: `src/proactive/notification-actions.ts` (new)
- **Change**: Implement `NotificationActionService` with `snooze`, `dismiss`, `reschedule`, `listSnoozed`, `resetAll` methods. Internal routing per `notificationType` as specified in the Technical Architecture section.
- **Estimate**: 2h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `snooze({ type: 'morning_briefing', duration: '2 hours' })` sets `user_briefing_state.snoozed_until = now + 2h`
  - `dismiss({ type: 'morning_briefing' })` sets `snoozed_until = '9999-12-31T23:59:59Z'`
  - `reschedule({ type: 'weekly_kickoff', newFireAt: '<ISO>' })` sets `weekly_state.kickoff_snoozed_until`
  - `snooze({ type: 'reminder', reminderId: '...' })` delegates to `ReminderService.snooze`
  - `snooze({ type: 'deadline_nudge', taskId: '...' })` updates `alert_state.suppress_until`
  - `listSnoozed` returns items from all four backing stores in a unified array
  - `resetAll` clears all snooze timestamps across all four tables for the given user
  - `bun typecheck` passes
- **Dependencies**: Tasks 1.2, 2.1

#### Task 6.2 — Create `src/proactive/notification-tools.ts` — snooze/dismiss/reschedule/list tools

- **File**: `src/proactive/notification-tools.ts` (new, partial — preference tools in Task 7.1)
- **Change**: Implement `makeNotificationActionTools(service)` returning tool set for `snooze_notification`, `dismiss_notification`, `reschedule_notification`, `list_snoozed`. Each tool validates its inputs and calls the corresponding `NotificationActionService` method. Tool descriptions instruct the LLM to resolve natural language durations to ISO timestamps before calling.
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**:
  - `snooze_notification` with `duration = 'in 2 hours'` fails type-check (LLM must pass ISO string); tool description is explicit about this
  - `list_snoozed` returns formatted response with human-readable `resumesAt` in user's timezone
  - All tools are included in `src/tools/index.ts`
  - `bun typecheck` passes
- **Dependencies**: Tasks 6.1, 2.1

#### Task 6.3 — Write unit tests for `notification-actions.ts`

- **File**: `tests/proactive/notification-actions.test.ts` (new)
- **Change**: Cover all five methods across all notification types; verify backing-store updates with in-memory DB; verify `listSnoozed` union combines results from all tables.
- **Estimate**: 1.5h ±0.5h | **Priority**: High
- **Acceptance Criteria**: All tests pass; at least 20 test cases covering routing, persistence, and edge cases (already-dismissed, snooze overlap, invalid type)
- **Dependencies**: Tasks 6.1

---

### Phase 7 — Preference View & Reset (0.5 days)

#### Task 7.1 — Add `get_notification_preferences` and `reset_notification_preferences` tools

- **File**: `src/proactive/notification-tools.ts` (extend from Task 6.2)
- **Change**: Implement `get_notification_preferences` tool — calls `getAllConfig(userId)`, extracts all 9 Phase 10 preference keys (plus relevant Phase 7/9 keys), formats using the display template in the Technical Architecture section. Implement `reset_notification_preferences` — deletes the 7 Phase 10 keys from `user_config`, calls `NotificationActionService.resetAll(userId)` to clear snooze state, re-registers scheduler jobs with defaults.
- **Estimate**: 1h ±0.25h | **Priority**: High
- **Acceptance Criteria**:
  - `get_notification_preferences` returns a block where all 9 keys are listed with current values or their defaults
  - `reset_notification_preferences` returns a confirmation block and a table of the restored default values
  - After reset, a second call to `get_notification_preferences` shows only defaults
  - Does NOT reset Phase 7 or 9 operational keys (`briefing_time`, `briefing_mode`, etc.)
  - `bun typecheck` passes
- **Dependencies**: Tasks 6.1, 6.2, 1.4

#### Task 7.2 — Write unit tests for preference tools

- **File**: `tests/proactive/notification-tools.test.ts` (new)
- **Change**: Test `get_notification_preferences` with all keys set, some set, and none set. Test `reset_notification_preferences` clears exactly the right keys and leaves Phase 7/9 keys intact.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: All tests pass; boundary between Phase 10 keys and Phase 7/9 keys is confirmed correct
- **Dependencies**: Task 7.1

---

### Phase 8 — Integration & Wire-up (0.5 days)

#### Task 8.1 — Export new services and tools from `src/proactive/index.ts`

- **File**: `src/proactive/index.ts`
- **Change**: Add exports for `QuietHoursGate`, `ProactiveMessageSender`, `NotificationActionService`, `makeNotificationActionTools`, `resolveUserTimezone`
- **Estimate**: 0.2h ±0 | **Priority**: High
- **Acceptance Criteria**: All consumers can import from `src/proactive/index.js` without relative path hacks; `bun typecheck` passes
- **Dependencies**: Tasks 3.1, 4.1, 6.1, 7.1, 2.1

#### Task 8.2 — Include `makeNotificationActionTools` in `src/tools/index.ts`

- **File**: `src/tools/index.ts`
- **Change**: Import and call `makeNotificationActionTools(notificationActionService)` and spread the result into the tool set returned to `callLlm`
- **Estimate**: 0.2h ±0 | **Priority**: High
- **Acceptance Criteria**: LLM has access to all six new tools; `bun typecheck` passes
- **Dependencies**: Task 8.1

#### Task 8.3 — Wire scheduler job registration to `/set` command config-change hook

- **File**: `src/proactive/scheduler.ts`, `src/commands/set.ts` or `src/config.ts`
- **Change**: When a user sets `timezone`, `quiet_hours_end`, `delivery_mode`, or `digest_time` via `/set`, call `ProactiveAlertScheduler.refreshUserJobs(userId)` to re-register affected jobs with updated parameters. The hook is an event or callback registered at bot startup.
- **Estimate**: 0.5h ±0.25h | **Priority**: High
- **Acceptance Criteria**: Changing `timezone` via `/set` causes the briefing, quiet-hours release, and digest flush jobs to fire at the new local time on the next occurrence; old jobs are cancelled; `bun typecheck` passes
- **Dependencies**: Tasks 3.3, 4.3

#### Task 8.4 — End-to-end integration test

- **File**: `tests/e2e/notification-controls.test.ts` (new)
- **Change**: A scripted conversation that: (1) sets timezone, quiet hours, and `delivery_mode = 'digest'`; (2) triggers a simulated deadline nudge; (3) verifies the message is queued in `digest_queue` not sent; (4) advances fake time past `quiet_hours_end` and `digest_time`; (5) verifies a single consolidated digest message is sent.
- **Estimate**: 1.5h ±0.5h | **Priority**: Medium
- **Acceptance Criteria**: Test passes end-to-end with an in-memory database and mocked `chatProvider`
- **Dependencies**: All prior tasks

---

## Risk Assessment Matrix

| Risk                                                                                                                             | Probability | Impact | Mitigation                                                                                                                                                                            | Owner |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Phase 7/8/9 not yet implemented when Phase 10 begins                                                                             | High        | High   | Phase 10 task breakdown is written to be conditional on prior phases; Tasks 2.2 and 4.2 are no-ops if prior phases are not done; plan can be executed alongside or after prior phases | Dev   |
| `Intl.DateTimeFormat` behavior for edge-case IANA zones (e.g. half-hour offsets like `Asia/Kolkata`) differs across Bun versions | Low         | Medium | Unit test `resolveUserTimezone` against `Asia/Kolkata` and `Pacific/Chatham` (UTC+12:45); pin Bun version in `package.json#engines`                                                   | Dev   |
| Midnight-crossing quiet hours (`22:00–07:00`) cause off-by-one errors in `isQuietNow`                                            | Medium      | Medium | Explicit parametric test for boundary values (21:59, 22:00, 22:01, 06:59, 07:00, 07:01); treat start as inclusive, end as exclusive                                                   | Dev   |
| `ALTER TABLE` on `user_briefing_state` or `weekly_state` breaks if Phase 7/9 migrations haven't run                              | High        | High   | Migration 012 checks for table existence before ALTER; migration ordering in `MIGRATIONS` array guarantees Phase 7/9 run first                                                        | Dev   |
| `ProactiveMessageSender.send` wrapper adds latency to all proactive paths                                                        | Low         | Low    | All DB writes in `hold` and `digest_queue` INSERT are synchronous SQLite; no network calls involved                                                                                   | Dev   |
| `reset_notification_preferences` accidentally clears Phase 7/9 operational keys, breaking scheduled jobs                         | Medium      | High   | Explicit allowlist of exactly the 7 Phase 10 keys; unit test asserts Phase 7/9 keys are untouched after reset                                                                         | Dev   |
| `list_snoozed` UNION across four tables returns duplicates or has schema mismatch                                                | Low         | Low    | Shared `SnoozedItem` type enforced by TypeScript; each sub-query has a hard LIMIT 50 clause                                                                                           | Dev   |

---

## Resource Requirements

- **Total estimated development hours**: 22h ±4h
- **Skills required**: TypeScript, Bun, SQLite (Drizzle ORM), cron scheduling (croner), `Intl` timezone APIs
- **External dependencies**: Phases 7, 8, and 9 fully implemented; `croner` already installed
- **Testing requirements**: Unit tests for every new service and tool (≥90% branch coverage target); one E2E integration test; all existing tests must continue to pass

---

## Planning Quality Gates

**✅ Requirements Coverage**

- [x] All 7 user stories mapped to specific tasks
- [x] Scope boundaries defined: Phase 10 adds notification gating/controls only; no changes to task management or provider integrations
- [x] Non-functional: timezone correctness validated with IANA, no 3 AM deliveries, no duplicate digests
- [x] Phase dependencies identified with explicit fallback notes for partial implementation

**✅ Task Specification**

- [x] Each task has measurable acceptance criteria
- [x] Effort estimates include confidence intervals
- [x] Dependencies mapped with handoff criteria
- [x] Blocking tasks identified for each phase

**✅ Risk Management**

- [x] Phase-ordering risk addressed with conditional task notes
- [x] Midnight-crossing timezone edge case explicitly mitigated
- [x] ALTER TABLE dependency risk mitigated with migration ordering
- [x] Reset-scope risk mitigated with allowlist and unit test

**✅ Library Research Validation**

- [x] No new library needed (croner reused; Intl built-in)
- [x] All logic is custom only where no library alternative exists (timezone math, quiet-hours check)
- [x] No security vulnerabilities: no exec/eval, no direct SQL string interpolation (Drizzle parameterized queries throughout), no SSRF (no outbound HTTP calls added)

---

## 📋 DISPLAY INSTRUCTIONS FOR OUTER AGENT

**Outer Agent: You MUST present this development plan using the following format:**

1. **Present the COMPLETE development roadmap** - Do not summarize or abbreviate sections
2. **Preserve ALL task breakdown structures** with checkboxes and formatting intact
3. **Show the full risk assessment matrix** with all columns and rows
4. **Display ALL planning templates exactly as generated** - Do not merge sections
5. **Maintain all markdown formatting** including tables, checklists, and code blocks
6. **Present the complete technical specification** without condensing
7. **Show ALL quality gates and validation checklists** in full detail
8. **Display the complete library research section** with all recommendations and evaluations

**Do NOT create an executive summary or overview - present the complete development plan exactly as generated with all detail intact.**
