<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0340: Message Edit Handling — Window-Dependent Policy over a Distinct `onMessageEdit` Channel

## Status

Accepted

## Date

2026-08-08

## Context

Users edit their chat messages after sending them. Before this change papai silently dropped inbound edits on every platform: Telegram `edited_message`, Discord `messageUpdate`, and Mattermost `post_updated` events had no subscription, and `conversation_history` retained the stale pre-edit text forever. The bot could then act on (or quote) content the user had already corrected. The design is in `docs/superpowers/specs/2026-07-27-message-edit-handling-design.md`; the implementation plan is `docs/superpowers/plans/2026-07-27-message-edit-handling.md`.

The right response to an edit depends on *when* it arrives relative to the agent run it triggered:

- **W1 — mid-run, edit is the run's origin**: the user is correcting the very request the agent is executing; the correction should steer the live run.
- **W2 — run just finished, edit is the last turn's origin**: the answer is already posted; either regenerate it (no side-effects) or ask first (side-effects happened).
- **W3 — anything older or unrelated**: silent history-only correction; replying to an old edit would be noise.

The repo already had the ingredients: mid-run steering (`RunControl.steerQueue`), `message_metadata` observation caching, the stop-summary effect recorder (`completedEffects`), coalescing queue, and per-adapter reply helpers.

## Decision Drivers

- **Reuse existing machinery.** Steering, effect reporting, and message caching already exist; the feature should thread into them rather than build parallel state.
- **Capability-driven, not platform-name checks.** Per `src/chat/CLAUDE.md`, behavior is gated on a declared capability (`messages.edit.inbound`), never `chat.name`.
- **Structural bypass of the coalescing queue.** Edits must not be coalesced as new user turns — an edit *mutates* a prior turn; routing it through the queue would spawn a fresh run on stale context.
- **Edits must be attributable to the coalesced turn they contributed to.** Multi-message coalescing means one user turn can originate from several platform messages; each segment needs its own `messageId` so an edit can find and surgically rewrite its segment.
- **Safety on side-effects.** If the last turn executed task-tracker or other external effects, regenerating silently could duplicate them; the bot must ask first.
- **v1 scope discipline.** Kontur Talk has no edit subscription and stays unsupported; true in-place regeneration is deferred in favor of a portable post-new + supersede-old presentation.

## Considered Options

### Option 1 — Distinct `onMessageEdit` channel + pure `classifyEdit` window routing (chosen)

A new optional `ChatProvider.onMessageEdit` handler (structurally bypassing the coalescing queue) delivers edits to `onIncomingEdit`, which applies a baseline correction to `message_metadata` + `conversation_history` on every edit, then a pure `classifyEdit` routes to W1/W2/W3 based on active run + `LastTurnRegistry` + a `message_metadata` "later user message" check. Originating `messageId`s and per-message segments are preserved through coalescing and stored on the user turn as `providerOptions.papai`, so `applyEditToHistory` can rebuild the coalesced text with just the edited segment replaced. W1 pushes a steer note into `RunControl.steerQueue`; W2 regenerates via the normal `processMessage` path and supersedes the old reply via `ReplyFn.editReply` (or, when the last turn had side-effects, posts an ask-first prompt with `edit:adjust:`/`edit:note:` buttons routed through the interaction router); W3 is silent.

- **Pros:** pure, unit-testable classifier; edits never pollute the coalescing queue; reuses steer queue, effect records, and button-confirmation patterns; per-adapter work is confined to subscription + `editReply`; capability gate keeps Kontur Talk untouched.
- **Cons:** new in-memory state (`LastTurnRegistry`) that lives and dies with the process; W2 regeneration posts a new reply rather than editing the old one in place; `providerOptions.papai` adds a papai-specific payload to stored AI SDK messages.

### Option 2 — Route edits through the existing `onMessage` path as normal messages

Deliver edits as ordinary incoming messages (with an `editedAt` marker) and let the queue/orchestrator treat them as new turns.

- **Pros:** no new provider surface; no new routing code.
- **Cons:** every edit starts a fresh run on already-stale context — W1's "fold into the current run" becomes impossible, W2's regenerate requires reconstructing turn identity after the fact, and old edits (W3) would spam replies. Rejected: the queue is the wrong abstraction for a mutation event.

### Option 3 — True edit-in-place regeneration for W2

Have the W2 regeneration turn target the *existing* bot reply message, replacing its content atomically instead of posting a new reply.

- **Pros:** cleanest UX — one answer per question, no superseded markers.
- **Cons:** requires `ReplyFn.formatted` (and therefore the whole `sendLlmResponse` path) to target a pre-existing message across three platforms with different edit semantics (Telegram single message, Discord chunked `BotMessage[]`, Mattermost post patch). A deep orchestrator refactor for a presentation nicety. **Deferred** — v1 ships post-new + `editReply`-supersede-old; the `ReplyTarget`/`editReply` seam makes the refinement a localized change later.

## Decision

Option 1 shipped:

1. **Capability + types** (`src/chat/types.ts`): `'messages.edit.inbound'` capability, `IncomingMessage.editedAt?`, `ChatProvider.onMessageEdit?`, `ReplyFn.editReply?` + `lastReplyTarget?`, and an opaque `ReplyTarget`. Declared by Telegram, Discord, Mattermost; absent on Kontur Talk.
2. **Identity preservation through coalescing** (`src/message-queue/`): `QueueItem.messageId?` → `CoalescedItem.messageIds` + `segments`; segment formatting factored into pure `src/message-edit/segments.ts` (`formatMessageSegment`, `rebuildCoalescedText`).
3. **Turn metadata** (`src/llm-orchestrator-attachments.ts`): the user `ModelMessage` carries `providerOptions.papai = { messageIds, segments, isThread, isDm }` (omitted for legacy turns); `src/history.ts` `applyEditToHistory` rewrites just the edited segment and rebuilds the coalesced content.
4. **Run + last-turn state** (`src/run-control/`): `RunControl.originatingMessageIds` + `replyTarget`; `LastTurnRegistry` records the finished turn's origin ids, `completedEffects`, and reply target on `runRegistry.end`, evicted on the next `begin`.
5. **Classification + dispatch** (`src/message-edit/`): pure `classifyEdit` → W1 steer push / W2 regen-or-ask (`w2-regen.ts`, `edit-prompt-store.ts` with `edit:adjust:`/`edit:note:` interaction-router branch) / W3 silent.
6. **Platform wiring**: router fan-out (`ChatRouter.onMessageEdit`), `setupBot` capability-gated wiring, and per-adapter subscriptions (Telegram `edited_message:text`, Discord `messageUpdate`, Mattermost `post_updated`) plus per-adapter `editReply` builders.
7. **Kontur Talk verified unsupported** via `tests/chat/kontur-talk/edit-noop.test.ts`.

## Consequences

### Positive

- Edited user intent is honored: mid-run edits steer the live run, post-reply edits regenerate or prompt, and every edit corrects stored history so the agent never again acts on retracted text.
- History correction is surgical: only the edited segment of a coalesced turn changes; other segments and the turn's join formatting are preserved.
- Side-effecting turns are never silently re-executed — the ask-first prompt reuses the established button-confirmation pattern and expires safely ("Action is no longer available").
- All routing logic is pure and unit-tested; platform-specific code is limited to event subscription and `editReply`, keeping the capability model intact.
- The `ReplyTarget` + `LastTurnRegistry` seams make future refinements (true in-place regen, Kontur Talk support, edit-window expiry) localized changes.

### Negative

- W2 regeneration posts a *new* reply and marks the old one "⟲ Superseded" rather than editing it in place — a visible UX compromise accepted for v1 and documented in the plan.
- `LastTurnRegistry` is process-local: a restart between the reply and the edit downgrades W2 to W3 (silent history-only). Acceptable because history correction (the safety-critical part) is persistent.
- User turns in `conversation_history` now carry a papai-specific `providerOptions` payload; legacy turns without it permanently no-op on edits.

### Risks

- An adapter that mis-maps edit events could steer or regenerate against the wrong turn. Mitigation: `classifyEdit` requires exact `messageId` membership in the active/last turn's origin ids; mismatches fall to W3.
- `edit:` prompt store is in-memory and unbounded by TTL; stale prompts resolve to "no longer available" on click, matching the permission-prompt precedent.

## Related Decisions

- ADR-0210: Agent Interruption & Steering — provides the `RunControl.steerQueue` mechanism W1 builds on.
- ADR-0211: Ephemeral Self-Removing Ask-Permission Prompts — precedent for the `edit:` ask-first button flow.

## References

- Spec: `docs/superpowers/specs/2026-07-27-message-edit-handling-design.md`
- Plan: `docs/superpowers/plans/2026-07-27-message-edit-handling.md`
- Implementation: `src/message-edit/`, `src/run-control/last-turn-registry.ts`, `src/history.ts` (`applyEditToHistory`)
