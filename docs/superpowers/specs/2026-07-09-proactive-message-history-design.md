<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proactive messages in conversation history

**Date:** 2026-07-09
**Status:** Design approved, pending spec review

## Problem

papai's LLM turn loop persists the bot's own replies into a per-thread
`conversation_history` store (`src/db/schema.ts:57-60`, keyed by
`storageContextId`) and reads them back on the next turn, so in normal
conversation the LLM _does_ see its own prior messages.

However, the bot sends many messages **outside** that turn loop, and almost
none of them are persisted. An audit of every outbound path found that the
only non-turn path that records to history is the deferred-prompts/alerts
pipeline (`src/deferred-prompts/proactive-llm-helpers.ts`), which deliberately
calls `appendHistory` before delivery. Everything else — announcements,
"recurring task created" pings, external `notify` webhook pushes, command
replies, confirmation prompts, and more — sends via `chat.sendMessage` /
`reply.*` with no history write.

The observed symptom: **the bot has no memory of proactive/announcement
messages it sent.** It tells a user about a new release or a newly created
recurring task, then on the next turn has zero record that it ever said so.

A related, separate defect surfaced during the audit: the turn-error path
`handleLlmTurnError` (`src/llm-orchestrator-support.ts:188-193`) calls
`saveHistory(contextId, baseHistory)`, which rewinds the cached history to the
pre-turn state — discarding even the _user's_ triggering message for that turn.

## Goal

1. Content-bearing proactive messages the bot sends outside the LLM turn loop
   become part of the target thread's `conversation_history`, so the LLM sees
   them on the next turn.
2. The turn-error path stops discarding the user's own triggering message.

## Non-goals

- **Live-status** progress messages stay ephemeral (edited in place, deleted
  before the turn ends) — correct as-is, not persisted.
- **Command replies** (`/help`, `/config`, `/context`, `/start`, `/clear`,
  `/dashboard`, `/stop`) — not persisted.
- **Interaction chatter** — confirmation prompts/decisions, the mid-run "✋"
  steering ack, unauthorized-access replies — not persisted.
- No change to how normal LLM turns persist history.
- No change to the deferred-LLM path's persist-before-send ordering (see §4).

## Scope: which proactive messages get recorded

"Content-bearing proactive" — messages where the bot proactively communicates
real content to the user, then today forgets it:

| Path                                                  | Site                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Release-notes broadcast (DM + group fan-out)          | `src/announcements/broadcast.ts` (`broadcastAnnouncement`)          |
| Admin free-text announce broadcast                    | `src/commands/announce-broadcast.ts` (`broadcastMessage`)           |
| Version-announcement review notice to admin           | `src/announcements.ts` (`sendAnnouncementToAdmin`)                  |
| "Recurring task created" notification                 | `src/scheduler-recurring.ts` (`notifyUser`)                         |
| External `notify` webhook push (e.g. magi milestones) | `src/debug/notify-route.ts` (`handleNotifyRoute` / `sendNotify`)    |
| Deferred-prompt/alert **error-delivery** branch       | `src/deferred-prompts/poller.ts` (catch branches ~L82-87, L175-180) |

The deferred-prompt/alert _success_ path already persists correctly and is the
reference implementation; only its error branch is a gap.

## Design

### 1. Architecture — one send-and-record unit

Introduce a single function, `sendRecordedProactive` (built on / extending the
existing `sendProactiveMessage` wrapper the deferred pipeline already uses).
Given a **delivery target** (user/group identity + platform instance) and
message text, it:

1. Resolves the target's **thread-scoped `storageContextId`**, reusing the
   deferred pipeline's existing target → context-id resolution. DM targets
   resolve to the user's context; group targets resolve to the group's
   main-thread storage context (the same context normal replies use when not in
   a sub-thread).
2. Sends the message via `chat.sendMessage`.
3. On successful send, appends a faithful assistant `ModelMessage` to that
   context's history (best-effort; see §3, §4).

All content-bearing proactive callers route through this unit. Raw
`chat.sendMessage` / `reply.*` remains for everything we are _not_ persisting.
This centralizes the three concerns that today are scattered and have already
drifted (context-id resolution, history framing, race-safety) into one
well-bounded, testable place, and prevents the next proactive path from
silently forgetting to persist.

The existing deferred-prompt success path may be migrated onto this unit as a
consolidation, but that migration is optional and must preserve its
persist-before-send ordering (§4); it is not required to close the gap.

### 2. Context-id resolution

Persisted proactive messages go to the **same thread-scoped
`storageContextId`** the target's normal replies would use — never the
group-shared config-context id. This keeps proactive history consistent with
in-band conversation and honors the scope model in
`src/chat/context-scope.ts`.

### 3. History framing — faithful, no markers

Store **exactly the text the user saw**, as a plain `assistant`-role
`ModelMessage` — in the same spirit as how normal turns persist
`response.messages`. No `(proactive)` prefix and no synthetic preceding user
turn.

Rationale: the guiding principle is that the bot's history should match what
was actually in the chat. Faithful storage is simplest and avoids leaking a
marker into a real reply. A dangling assistant message with no preceding user
turn is well-tolerated by chat models.

Because proactive messages are plain text (no tool calls), appending them does
not disturb the tool-call/tool-result pairing invariant enforced by
`validateToolResults` (`src/llm-orchestrator-validation.ts`).

Fallback (not implemented now): if the model is later observed getting confused
about un-prompted announcements, add a lightweight system-context breadcrumb.
Start faithful.

### 4. Ordering & error resilience

**Send first, then persist (best-effort).** These are fire-and-forget
notifications, so a history-write failure must never block or duplicate the
user-facing send. If the persist fails, the behavior degrades gracefully to
today's (message delivered, just not remembered), logged at `warn`.

Persistence is keyed to a **successful per-recipient send**, which also gives
broadcasts natural idempotency — a partial broadcast that retries will not
double-persist to recipients that already succeeded.

This intentionally differs from the deferred-LLM _success_ path, which
persists-before-send because there the persisted turn _is_ the product; that
path retains its own ordering.

### 5. Turn-error rollback fix (separate change)

In `handleLlmTurnError` (`src/llm-orchestrator-support.ts:188-193`), replace the
`saveHistory(contextId, baseHistory)` rewind so it preserves history **up to and
including the user's triggering message** (`turn.historyMessage`), rolling back
only the incomplete assistant turn. Small and targeted; orthogonal to the
send-and-record unit.

## Testing

- **Unit (`sendRecordedProactive`):**
  - Persists a faithful assistant `ModelMessage` at the resolved context id on
    send success.
  - Persists nothing when the send fails.
  - A history-write failure is caught, logged, and does not throw or block the
    send result.
- **Per-site:** each migrated caller records to the correct thread scope
  (DM context vs group main-thread context).
- **Regression:**
  - Turn-error path preserves the user's triggering message in history.
  - A follow-up turn's assembled `messages` include a prior proactive message.

## Constraints respected

- `conversation_history` is plain JSON in SQLite (`src/db/schema.ts:57-60`) — no
  crypto plumbing needed (contrast: instance configs are AES-256-GCM encrypted).
- Thread-scoped keying (`ENTITY_SCOPES`, `src/chat/context-scope.ts`) — proactive
  writes must use the target's storage-context id, not the config-context id.
- Appended proactive messages carry no tool calls, preserving the
  tool-call/tool-result pairing invariant.

## Out of scope / follow-ups

- Command replies and interaction chatter (deliberately excluded).
- The verified-completion gap (risky turns whose verifier-produced final text is
  never persisted) — a separate, previously-identified defect; not addressed
  here.
