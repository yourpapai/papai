<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message edit handling

**Date:** 2026-07-27
**Status:** Design approved, pending spec review

## Problem

When a user edits a chat message, papai ignores it. Every chat adapter
(`src/chat/telegram`, `discord`, `mattermost`, `kontur-talk`) subscribes only to
new-message events; no adapter listens to platform edit events. A repo-wide
search for `edited_message`, `messageUpdate`, `post_updated` returned no hits.

This produces two classes of wrong behavior:

1. **During an active run** the originating message's premise is already being
   acted on. An edit to it today is mis-routed by `src/bot.ts:180-191` as a
   *new* mid-run steer instruction (`activeRun.steerQueue.push({ text: … })`)
   rather than a correction of the premise.
2. **After a reply** the bot has answered based on the old text. The edited
   message is never re-considered, and the stored conversation history still
   contains the original (now-wrong) text, so later turns reference it.

What already exists and is reused by this design:

- **Outgoing edit primitives** on Telegram (`api.editMessageText`), Discord
  (`sent.edit` / `replaceOrSend`), and Mattermost (`PUT /api/v4/posts/:id/patch`)
  — used today by `src/live-status/` and permission prompts. Absent on Kontur
  Talk.
- **Mid-run steering** (`src/run-control/`): a `RunRegistry` keyed by
  `storageContextId` holds one `RunControl` per context; a `steerQueue` of
  `InjectedMessage`s is injected at the next tool-step boundary
  (`src/run-control/steering-prepare-step.ts`). One run per thread.
- **`message_metadata`** (`src/db/schema.ts:170-187`) stores observed messages
  keyed by `(contextId, messageId)` with **upsert-on-conflict**
  (`src/message-cache/persistence.ts:61-71`) and an FTS5 virtual table whose
  triggers fire on UPDATE (`migration 070`). This is the natural edit key.
- **Side-effect reporting**: `RunControl.completedEffects: EffectRecord[]`
  (`{ toolName }`), populated at `src/llm-orchestrator-invoke.ts:72` and rendered
  by `buildStopSummary`. `/stop` reports partial side-effects **honestly rather
  than rolling them back** (`docs/architecture/behaviors.md`).

## Goal

Handle incoming user-message edits across Telegram, Discord, and Mattermost
(Kontur Talk deferred), with a window-dependent policy that is correct, cheap
by default, and never silently rolls back tool side-effects.

## Decisions (locked during brainstorm)

| Decision | Choice |
| --- | --- |
| Core behavior | Window-dependent mix; history correction is the baseline across all windows |
| W1 (during active run) | Fold the edit into the existing steer queue as a correction; run continues |
| W2 (right after reply) | Regenerate if no side-effects; if side-effects, an ask-first button prompt (`[Adjust for me]` / `[Just note it]`) |
| W2 side-effects action | Ask-first prompt — never auto-rollback (matches papai's report-don't-rollback precedent) |
| W3 (old / historical) | Silent history-only — no reply, no re-run |
| Window boundary | Structural, not time-based: last turn's originating message AND no later user message in that storage context |
| Reply presentation (W2) | Edit old reply in place where supported; post-new fallback (Kontur Talk) |
| Intake mechanism | Distinct optional `ChatProvider.onMessageEdit?` handler (edits structurally bypass the coalescing queue) |
| Platform scope | Telegram / Discord / Mattermost in v1; Kontur Talk deferred (Matrix `m.replace` delivery unverified) |

## Behavior policy

An incoming edit is classified into one of three windows from **run state** and
**message identity** — no time-based cutoff. **All windows share a baseline:
correct stored history to the edited text.**

| Window | Trigger | Action | Reply |
| --- | --- | --- | --- |
| **W1 — during run** | Active `RunControl` for `storageContextId` AND edited `messageId` is one of that run's originating messages | Inject a steer correction; run continues | existing `✋ folding…` ack |
| **W2 — right after reply** | No active run AND edited `messageId` is the last completed turn's originating message AND no later user message exists in that storage context | no side-effects → **regenerate**; side-effects → **ask-first prompt** | edit old reply in place (post-new fallback) |
| **W3 — old / historical** | Everything else | Silent history-only | none |

**Baseline (all windows):** rewrite the originating user turn's text in
`conversation_history` + upsert the `message_metadata` row (FTS auto-updates via
existing triggers) + invalidate the in-memory history cache.

**Key invariant:** the persisted history always ends up recording the **edited**
text — never a transcript of "original + correction note." The W1 steer message
is ephemeral model guidance only.

## Architecture

### Intake & routing

A distinct optional handler rather than a flag on `IncomingMessage`:

- New optional `ChatProvider.onMessageEdit?(handler)` — mirrors the existing
  optional-member convention (`src/chat/types.ts:266-277`).
- `IncomingMessage` gains `editedAt?: number` (the prior text is **not** carried
  — it is read from `message_metadata` by `(contextId, messageId)` at handling
  time, keeping `IncomingMessage` lean and avoiding races with the cache write).
- New `ChatCapability`: **`messages.edit.inbound`** — present on
  Telegram/Discord/Mattermost, **absent on Kontur Talk**. Feature-detected via
  the `capabilities` set; no `chat.name` checks (`src/chat/CLAUDE.md:52`).
- The router fans edits out the same way it fans messages out
  (`src/chat/router.ts:173-178`, template `registerExistingHandlers`
  `router.ts:257-267`).

Rationale: the coalescing queue (`src/message-queue/queue.ts`) is the dealbreaker
for a flag-on-`IncomingMessage` design. An edit delivered through `onMessage`
could be batched or mis-routed into steer/new-turn unless short-circuited every
time. A distinct handler makes "edits bypass the queue" a **structural**
guarantee.

**Flow:** adapter edit-event → maps to `IncomingMessage`(+`editedAt`) tagged with
`platformInstanceId` → `ChatRouter` fan-out → `bot.onIncomingEdit(...)` → shared
auth/group-filter guards → classify (W1/W2/W3) → handle.

### Platform wiring

| Platform | Event | Notes |
| --- | --- | --- |
| Telegram (grammy) | `bot.on('edited_message:text')` + `edited_channel_post:text` | `edit_date` on payload. Media variants deferred. |
| Discord (discord.js) | `client.on('messageUpdate', (old, new))` | `ACCEPTED_MESSAGE_TYPES` (0/19) is fine — edited msgs keep type 0. |
| Mattermost (raw WS) | branch on `event === 'post_updated'` | `MattermostWsEventSchema` already accepts any event string; only the dispatcher lacks the branch. |
| Kontur Talk | none (capability absent) | Matrix `m.replace` delivery unverified; do not subscribe until confirmed. |

### Edit→turn correlation & state

Four bounded additions:

1. **Originating `messageId`s survive coalescing.** `QueueItem` and
   `CoalescedItem` (`src/message-queue/types.ts:18-42`) currently discard
   `messageId`. Add `messageId` / `messageIds: string[]` and thread them through
   `processCoalescedMessage` → `processMessage` → `runRegistry.begin(...)`.
   Coalesced turns → array; single-message turns → one element. (Independently
   useful for chat-history-search provenance.)

2. **`RunControl` records its origin.** Add `originatingMessageIds: string[]` to
   `RunControl` (`src/run-control/types.ts:15-23`), set at `begin()`. W1 test:
   active run for `storageContextId` AND edited `messageId ∈
   run.originatingMessageIds`.

3. **New `LastTurnRegistry` (in-memory, per `storageContextId`).** `runRegistry.end()`
   today discards everything. Capture the just-finished turn:

   ```ts
   type LastTurn = {
     originatingMessageIds: string[]
     completedEffects: EffectRecord[]
     replyTarget: ReplyTarget | undefined
     finishedAt: number
   }
   ```

   Evicted when a new run begins for that context (a later turn supersedes). The
   "no later user message" check (below) routes any stale entry to W3 anyway, so
   there is no leak.

4. **"No later user message" check** — a `message_metadata` query: any row for
   this `contextId` with `timestamp >` the originating message's timestamp?
   (`message_metadata` already indexes `contextId`; originating ts read by
   `(contextId, messageId)`.) If yes → W3.

**Classification:**

```
activeRun = runRegistry.get(ctx)
if activeRun && editedId ∈ activeRun.originatingMessageIds  → W1 (steer)
else if activeRun                                           → W3 (don't disrupt a live run for a non-originating edit)
else:
  last = lastTurnRegistry.get(ctx)
  if last && editedId ∈ last.originatingMessageIds
     && no later user message in message_metadata(ctx)      → W2
                                                            //  → regenerate if last.completedEffects empty, else ask
  else                                                      → W3 (silent history-only)
```

### Reply-target capture (W2 edit-in-place)

`reply.formatted` returns `Promise<void>` today and hands back no handle to the
sent reply. The per-platform edit primitives all exist (Telegram
`editMessageText`, Discord `sent.edit`/`replaceOrSend`, Mattermost
`PUT /api/v4/posts/:id/patch`). Add a bounded surface:

- A `ReplyTarget` is the opaque, platform-specific handle to a sent reply
  (Telegram `{chatId,messageId}`, Discord message id/reference, Mattermost post
  id). It is produced by the adapter when it sends the reply.
- The adapter records the sent reply's `ReplyTarget` when `sendLlmResponse`
  posts (`src/llm-orchestrator-send.ts`), captured into the turn's `LastTurn`.
- A new optional `ReplyFn.editReply?(target, markdown)` edits it in place where
  supported; Kontur Talk lacks it → **post-new fallback**.
- Whether `formatted` returns the id or a recorder callback is used is a
  planning-level decision.

### Side-effects reuse `EffectRecord` as-is

The coarse `{ toolName }` list already feeds `buildStopSummary` for the
ask-prompt and the empty/non-empty check. The corrective-regen ("Adjust") path
needs **no** `EffectRecord` enrichment — the model re-reads its own prior tool
results from `conversation_history`.

## History mutation (shared baseline)

`conversation_history` is a serialized `ModelMessage[]` with **no `messageId`**
on entries, so the edited turn can't be reliably found (W3 is
positional-impossible; W1/W2 only work by "last user message"). Fix:

- Store the platform `messageId` on user messages (via `providerOptions` /
  metadata) at `appendHistory` time.
- `applyEditToHistory(storageContextId, messageId, newText)`: load JSON → find
  the user message with matching `messageId` → replace text → save → invalidate
  the in-memory cache (`src/cache.ts`).
- `message_metadata`: upsert `(contextId, messageId)` with the new text (already
  edit-friendly; FTS5 auto-updates).

**Accepted limitation:** derived durable artifacts (long-term facts / summaries
extracted from the old text) are NOT retroactively changed — consistent with
W3's silent stance.

## Per-window handling

**W1 (during run):** apply baseline → push a steer message onto
`activeRun.steerQueue`:

> ⟲ Your earlier message was edited. New version:
>
> "<edited text>"

Existing machinery injects at the next step boundary; the `✋ folding…` ack
fires. No abort. *(The live model already consumed the old text at turn-start —
the steer correction is how it learns; persisted history reflects the edited
truth.)*

**W2 (right after reply):** apply baseline, then:

- **No side-effects** (`lastTurn.completedEffects` empty): run a fresh turn from
  the corrected history; **edit old reply in place** via `reply.editReply(...)`;
  post-new fallback where unsupported. The new turn supersedes
  `lastTurnRegistry`.
- **Side-effects present:** post a button prompt —

  > I already did {buildStopSummary}. Your edit: "<edited>".
  > [Adjust for me] / [Just note it]

  — routed through `interaction-router` (extend its prefix set beyond `perm:` to
  also handle `edit:adjust:` / `edit:note:`). `Adjust` → corrective regen
  (framing tells the model the user edited X→Y and it already did {summary}; it
  reconciles using its tools, reading its own prior results from history); edit
  old reply in place. `Just note it` / timeout / no-buttons → history-only
  already done + `ephemeralConfirm "✏️ Noted"` (or redact the prompt in place on
  non-ephemeral platforms).

**W3 (old):** apply baseline only. No reply, no turn.

## Guards, edge cases, concurrency

**Guards (reuse existing):**

- **Auth & group filter:** `onIncomingEdit` runs the same
  `checkAuthorizationExtended` + `shouldIgnoreGroupMessage` path as
  `onIncomingMessage` (`src/bot.ts:231-259`). Edits to non-mentioned /
  non-reply-to-bot group messages and blocked users → ignored.
- **Commands → no-op:** edit of a command message (`commandMatch` / leading `/`)
  is dropped — commands already executed, re-running risks double-execution.
- **Same-text skip:** if edited text equals stored text, no-op (no history write,
  no action).
- **Media / attachment edits → out of scope for v1** (text only); deferred.
- **Bot's own messages → out of scope** (users can't edit them on these
  platforms).

**Concurrency / re-entry:**

- W1 rapid double-edits → multiple steer pushes; acceptable (model sees latest).
- W2 regeneration **is** a run (`runRegistry.begin`), so a second edit arriving
  mid-regen routes to **W1 of the regen run** — no separate guard needed.
- Edit arriving while the W2 ask-prompt is showing → update the prompt's
  edited-text snippet + reset its timer; don't spawn a second prompt.

**Edge cases:**

- `replyTarget` missing (bot's reply deleted / capture failed) → edit-in-place
  falls back to **post-new**.
- `messageId` not found in `conversation_history` (history compacted /
  summarized, old turn dropped) → history mutation no-ops for the blob;
  `message_metadata` still updates so search stays correct. Never throws.

## Migrations

**None required.** `message_metadata` is already edit-friendly; `messageId` on
user messages lives in the `conversation_history` JSON (not a column), so legacy
rows simply lack it and degrade gracefully (find-and-replace no-ops) until
overwritten. No backfill.

## Testing

Per `tests/CLAUDE.md` (DI-first):

- **Unit:** W1/W2/W3 classification matrix; history find-and-replace by
  `messageId`; "no later user message" query; command-edit no-op; same-text
  skip.
- **Per-window integration:** W1 steer + history; W2 no-effects regenerate +
  edit-reply; W2 side-effects prompt + both button choices; W3 silent.
- **Adapter mapping:** telegram `edited_message` / discord `messageUpdate` /
  mattermost `post_updated` → `IncomingMessage`(+`editedAt`); kontur-talk no-op.
- **Capability gating:** handlers not wired when `messages.edit.inbound` absent.
  Mutation ratchet applies to new files.

## Rollout

Additive feature (new event subscriptions + new handler); existing message flow
untouched. Capability `messages.edit.inbound` default-on for Telegram / Discord
/ Mattermost, absent on Kontur Talk (deferred until Matrix `m.replace` delivery
verified). No settings toggle in v1.

## Out of scope

- Kontur Talk inbound edits (deferred pending Matrix `m.replace` verification).
- Media / attachment edits (text only in v1).
- Editing the bot's own messages (not user-controllable on these platforms).
- Retroactive correction of derived durable artifacts (long-term facts /
  summaries extracted from edited text).
- Auto-rollback of irreversible tool side-effects (rejected — against papai's
  report-don't-rollback precedent).
- A settings toggle for the feature (deferred).
