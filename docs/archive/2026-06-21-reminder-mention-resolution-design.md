<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Reminder @mention resolution — design spec

**Date:** 2026-06-21
**Status:** Approved for planning
**Branch:** `feat/live-status-toggle`
**Bug:** "When a user asks to remind/@mention a named person in a group (e.g. 'remind Alice at 9am'), the bot asks who to mention instead of resolving the name."

---

## 1. Problem

The `create_deferred_prompt` tool's `delivery.mention_user_ids` field expects **chat platform
user IDs** (`src/deferred-prompts/types.ts:27-39`). `buildDeliveryInput`
(`src/deferred-prompts/delivery-input.ts:37`) stores the array **verbatim** — there is no
name → ID resolution at creation time, and all three fire paths (Telegram
`reply-helpers.ts:62`, Discord `send-message.ts:46`, Mattermost `file-helpers.ts:34`) consume
raw IDs.

The gap: every chat adapter implements `ChatProvider.resolveUserId` and `ChatRouter` delegates
it (`router.ts:231`), but **no LLM tool wraps it**. `find_user` (`src/tools/find-user.ts`)
resolves **task-tracker** users, whose IDs are useless for chat mentions. The system prompt
(`GROUP_DEFERRED`, `src/system-prompt.ts`) tells the LLM to put **user IDs** in
`mention_user_ids` but gives it no mechanism to obtain them — so it falls back to the
"ask ONE short question" bullet.

**Platform reality:** Telegram's `resolveUserId` uses `getChat('@username')`, which cannot
resolve private accounts (no public username). So a pure username-lookup tool is unreliable on
Telegram — the platform most affected by the bug.

## 2. Goal

In a group, the bot resolves a named person ("Alice") to a chat user ID using people it already
knows, populates `mention_user_ids` itself, and asks a clarifying question **only** when there
is no confident match or genuine ambiguity.

Non-goals (v1): resolving task-tracker assignees (that is the separate Kaneo group-member
spec); a username-API resolver tool; cross-group resolution.

## 3. Decisions (locked during brainstorming)

| Decision            | Choice                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Resolution strategy | **Participant roster** — match against people the bot already knows, not the username API.                  |
| Roster source       | **Members + recent senders** — `group_members` ∪ distinct authors in `message_metadata`.                    |
| Tool shape          | **Approach B** — `resolve_chat_participant(query)` returns a small **ranked candidate** list (server-side). |
| Mention schema      | **Unchanged** — LLM calls the tool, then fills the existing `delivery.mention_user_ids` with chat user IDs. |
| Prompt              | Explicit end-to-end **population procedure**, not just "a tool exists".                                     |

## 4. Architecture

### 4.1 Roster service

`src/chat/participants/` (provider-agnostic):

```ts
resolveChatParticipant(
  contextId: string,
  query: string,
  limit?: number,
): Promise<Array<{ userId: string; displayName: string; username: string | null; score: number }>>
```

1. **Gather candidates** — union of `group_members(groupContextId)` (curated) and distinct
   `authorId`/`authorUsername` from `message_metadata(contextId)` (recently-seen senders).
   Dedupe by `userId`.
2. **Resolve display names** — `ChatRouter.resolveUserLabel(userId, { contextType:'group',
contextId, platformInstanceId })`, bounded with `p-limit`, best-effort and cached;
   fall back to `authorUsername`, then `userId`.
3. **Fuzzy-match & rank** — case-insensitive over `{displayName, username}`:
   exact > prefix > substring, with a deterministic tie-break. Return top-N with score.

### 4.2 Tool

`src/tools/resolve-chat-participant.ts` → `resolve_chat_participant`:

- Input `{ query: string, limit?: number }`; returns the ranked candidate list.
- **Group-context only**, registered in `tools-builder` when a chat-participant resolver is
  available. Risk class **`read`** (so the `read-only` preset keeps it available); subject to
  `tool_prefs` like any tool.
- **No change** to `delivery.mention_user_ids` — the LLM takes a candidate's `userId` and
  writes it into the existing field.

### 4.3 Plumbing (main integration point)

Tools today receive a `TaskProvider` but **no** chat-side handle. The roster needs
`resolveUserLabel`, which lives on `ChatProvider` via `ChatRouter`. Thread a **narrow injected
dependency** — a `chatParticipantResolver` bound to the message's `platformInstanceId` — into
`MakeToolsOptions`, sourced from the `ChatRouter` in the orchestrator. Tools receive a function,
not the whole router (decoupled, DI-test-friendly). When the resolver is absent (e.g. DM, or no
router), the tool is not registered.

### 4.4 Data flow

"remind Alice at 9am" → LLM calls `resolve_chat_participant("Alice")` → ranked candidates →
LLM sets `delivery.mention_user_ids=[<Alice userId>]` → `create_deferred_prompt` → existing
fire path renders the @mention from the stored ID (unchanged).

## 5. Prompt guidance (explicit population procedure)

Extend `GROUP_DEFERRED` (and a general group line) to spell out the decision procedure so the
LLM reliably populates the list:

- _"remind me" / requester_ → omit `mention_user_ids` (unchanged).
- _"remind us / everyone / the team"_ → `mention_user_ids: []` (unchanged).
- _named people ("remind Alice and Bob")_ → **for each name, call `resolve_chat_participant`,
  take the top candidate's `userId`, and collect them into `mention_user_ids`. Resolve all
  names before creating the reminder.**
- _no confident match, or multiple candidates for one name_ → ask ONE targeted question naming
  the candidates; do not guess.

The general line makes the tool usable anytime the LLM needs a chat user ID for a named person
in a group, not only for reminders.

## 6. Error handling & edge cases (all best-effort)

- **No candidates** → tool returns `[]`; prompt directs the LLM to ask one short, specific
  question rather than a vague "who?".
- **Ambiguous** (several "Alex") → multiple ranked candidates; LLM disambiguates with one
  question.
- **`resolveUserLabel` null / Kontur Talk** (echoes the userId, no real names) → roster
  degrades to username/ID labels; display-name matching may fail and the LLM falls back to
  asking. Documented platform limitation, not a regression.
- **DM context** → tool not registered (no group roster).
- **`message_metadata` TTL** → expired senders drop out; `group_members` still covers curated
  members. Reduced recall only — noted, not silently masked.
- **Permissions** → `read` risk; `read-only` preset keeps it available.

## 7. Testing (DI-first, per `tests/CLAUDE.md`)

- Roster gather: members ∪ senders dedupe by `userId`.
- Label-resolution fallback chain (`resolveUserLabel` → `authorUsername` → `userId`).
- Deterministic fuzzy ranking (exact/prefix/substring, stable tie-break).
- Group-only gating; tool absent in DM / when resolver missing.
- Empty and ambiguous result handling.
- `p-limit` boundedness on label resolution.
- Injected-resolver seam with a fake router.
- System-prompt fragment assertion for the population procedure.
- No fixed-wall-clock assertions; poll for conditions.

## 8. Phasing (no blocking spike — every capability already exists)

- **Phase 1** — roster service (gather + label resolve + fuzzy rank), DI, unit-tested.
- **Phase 2** — `resolve_chat_participant` tool + `tools-builder` gating + thread
  `chatParticipantResolver` through `MakeToolsOptions` from the orchestrator / `ChatRouter`.
- **Phase 3** — `GROUP_DEFERRED` / group system-prompt update with the explicit population
  procedure.
- **Phase 4** — tests + docs (tool description, `CLAUDE.md` note).

## 9. Relationship to the Kaneo group-member spec

Independent. This spec resolves **chat** users for @mentions; the Kaneo spec resolves
**task-tracker** users for assignment. They share no code path and can ship in either order.
