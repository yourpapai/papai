<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Personal Assistant Expansion Design

**Date:** 2026-03-04
**Status:** Approved
**Approach:** Memo-First (Quick Capture → Persistent Memory → Proactive Assistance → Calendar)

## Context

papai is a Telegram bot that manages Linear tasks via LLM tool-calling. This design expands it into a broader personal assistant that handles memos, persistent memory, proactive notifications, and calendar awareness — while keeping the scope focused on productivity (no finance or habit tracking).

## Phase 1: Quick Capture & Memos

**Goal:** Let the user capture unstructured thoughts, decisions, links, and notes via natural language. The LLM decides whether a message is a Linear task or a personal memo.

### Storage

SQLite table `memos`:

| Column       | Type        | Description                                                           |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `id`         | TEXT (ULID) | Primary key                                                           |
| `content`    | TEXT        | Raw memo content                                                      |
| `summary`    | TEXT        | LLM-generated one-liner                                               |
| `tags`       | TEXT        | JSON array of tags (LLM-extracted or user-specified)                  |
| `created_at` | TEXT        | ISO 8601 timestamp                                                    |
| `embedding`  | BLOB        | Vector embedding for semantic search (nullable, populated in Phase 2) |

### New Tools

| Tool                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `save_memo`         | Store a memo with content, optional tags. LLM auto-generates summary. |
| `search_memos`      | Full-text search over memos by keyword or tag                         |
| `list_recent_memos` | Return the N most recent memos                                        |
| `delete_memo`       | Remove a memo by ID                                                   |

### Conversation Example

- User: "Note: the landlord said lease renewal deadline is June 15"
- LLM recognizes this is not a Linear task → calls `save_memo`
- Bot: "Saved memo: Lease renewal deadline June 15 [#housing]"

### System Prompt Update

Add memo capabilities so the LLM knows when to route to memo tools vs Linear tools.

## Phase 2: Persistent Memory

Two sub-features: conversation history persistence and semantic recall.

### 2a. Conversation History Persistence

**Current state:** In-memory `Map<number, CoreMessage[]>`, capped at 40 messages, lost on restart.

SQLite table `messages`:

| Column       | Type    | Description                    |
| ------------ | ------- | ------------------------------ |
| `id`         | INTEGER | Autoincrement primary key      |
| `user_id`    | INTEGER | Telegram user ID               |
| `role`       | TEXT    | "user", "assistant", or "tool" |
| `content`    | TEXT    | Message content                |
| `created_at` | TEXT    | ISO 8601 timestamp             |

On startup, load the last 40 messages per user from the database. Prune messages older than 30 days via periodic cleanup.

### 2b. Semantic Recall (Vector Search)

Use an embedding model (e.g., `text-embedding-3-small` via the configured OpenAI-compatible endpoint) to generate embeddings for memos at save time. Store in `memos.embedding`.

At query time, compute the query embedding and perform cosine similarity search. For personal-scale data (hundreds to low thousands of memos), brute-force cosine similarity or `sqlite-vec` are both viable.

| Tool     | Description                                                                                   |
| -------- | --------------------------------------------------------------------------------------------- |
| `recall` | Semantic search across memos. Returns top-N most relevant items by meaning, not just keyword. |

`search_memos` remains for exact keyword matches; `recall` adds fuzzy/semantic search.

## Phase 3: Proactive Assistance

papai initiates conversations: daily briefings, deadline reminders, and user-scheduled reminders.

### 3a. Daily Briefing

Cron-based scheduler using Grammy's `bot.api.sendMessage` outside message handlers. Runs at a configurable time stored in config DB (`briefing_time` key).

**Content:** Bot calls its own Linear tools internally (issues due today, overdue items, in-progress work) and formats a morning summary.

**Config:** `/set briefing_time 09:00` to enable, `/set briefing_time off` to disable.

### 3b. Deadline Nudges

Same scheduler checks Linear issues approaching due date:

- 1 day before due → reminder
- On due day if still open → urgent reminder
- 1 day overdue → escalation reminder

### 3c. User-Scheduled Reminders

SQLite table `reminders`:

| Column      | Type        | Description          |
| ----------- | ----------- | -------------------- |
| `id`        | TEXT (ULID) | Primary key          |
| `user_id`   | INTEGER     | Telegram user ID     |
| `content`   | TEXT        | What to remind about |
| `remind_at` | TEXT        | ISO 8601 timestamp   |
| `sent`      | INTEGER     | 0 or 1               |

| Tool              | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `create_reminder` | Schedule a reminder with content and time (absolute or relative) |
| `list_reminders`  | Show upcoming reminders                                          |
| `delete_reminder` | Cancel a reminder                                                |

**Scheduler:** A `setInterval` or `setTimeout` chain that checks for due reminders every minute and sends them via `bot.api.sendMessage`.

## Phase 4: Calendar Integration

Read-only calendar awareness. No event creation/modification.

### Scope

- View today's/this week's events
- Check free time slots
- Include calendar context in daily briefings
- Factor meetings into "what should I work on next?" recommendations

### Provider-Agnostic Interface

```typescript
interface CalendarProvider {
  getEvents(from: Date, to: Date): Promise<CalendarEvent[]>
  getFreeBusy(from: Date, to: Date): Promise<TimeSlot[]>
}
```

First provider TBD (Google Calendar via OAuth, Apple Calendar via CalDAV, etc.). Credentials stored in config DB.

| Tool                  | Description                                |
| --------------------- | ------------------------------------------ |
| `get_calendar_events` | List events for a date range               |
| `get_free_time`       | Show available time slots for a date range |

### Daily Briefing Enhancement

If calendar is configured, the morning summary includes event count, schedule overview, and free time blocks.

## Implementation Order

1. **Phase 1** — Memos (SQLite table, 4 tools, system prompt update)
2. **Phase 2** — Persistent memory (messages table, embedding pipeline, `recall` tool)
3. **Phase 3** — Proactive (scheduler, briefings, reminders table, 3 tools)
4. **Phase 4** — Calendar (provider interface, first provider, 2 tools, briefing enhancement)

Each phase is independently deployable and valuable.
