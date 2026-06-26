<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0211: Ephemeral Self-Removing ask Permission Prompts

## Status

Implemented

## Date

2026-06-19

## Context

When a tool is gated to `ask` (ADR-0142), the bot posts a permission prompt — a normal channel
message with `✅ Allow` / `🚫 Deny` buttons — and pauses the tool turn on a `Promise`. Before this
work, `interaction-router.ts` handled a click by editing that prompt **in place** via
`reply.replaceText`, appending `Allowed.` / `Denied.` and stripping the buttons. The prompt therefore
**lingered in chat history forever**, and on the 5-minute timeout the prompt was left untouched with
dead buttons. The experience was noisy, especially in groups where several `ask`-gated calls could
stack stale prompts.

The 2026-06-19 design (`docs/superpowers/specs/2026-06-19-ephemeral-permission-prompts-design.md`)
set the goal: after a user decides, **delete the prompt and confirm with an ephemeral toast** where
the platform supports it; on timeout, **redact the prompt in place** to `⌛ Expired — denied.`; on
platforms that cannot do either, fall back to today's edit-in-place behavior. A hard constraint
shapes the design: native ephemeral messages (Discord ephemeral follow-ups, Mattermost
`ephemeral_text`, Telegram `answerCallbackQuery` toasts) can only be sent **in response to an
interaction**, but the prompt itself originates **mid-tool-turn**, where no interaction context
exists. The prompt therefore cannot be natively ephemeral; it must be a normal message that is
deleted the instant the user decides, with the confirmation carried by the interaction reply.

## Decision Drivers

- **Clean chat history**: a decided prompt should not persist; stale prompts and dead buttons should not accumulate in groups.
- **Fast, non-persistent feedback**: the allow/deny confirmation should be a toast, not another durable row.
- **Graceful degradation**: platforms without delete or ephemeral surfaces (Kontur Talk) must keep working, not regress.
- **Capability-driven behavior**: the mechanism should be feature-detected from a declared capability, not hard-coded per provider name, mirroring the existing `messages.delete` / `messages.redact` model.
- **A single reach-back handle for both paths**: the click path has an interaction context, but the timeout path does not — both must reach the already-sent prompt message, so a detached handle captured at send time is the unifying primitive.
- **Tool name in the confirmation**: `Allowed web_fetch ✅` is more useful than a bare `Allowed.` when the user has several `ask` tools in flight.

## Considered Options

### Option A: Edit-in-place only (status quo)

- **Pros:** Minimal change; works on every platform that has any reply surface; no new capability or handle lifecycle.
- **Cons:** Prompts linger forever; dead buttons on timeout; no ephemeral affordance; noisy group UX. Does not meet the goal.

### Option B: Send the prompt as a native ephemeral message

- **Pros:** Truly ephemeral; no cleanup needed; the toast and the prompt share a lifecycle.
- **Cons:** **Impossible on every target platform.** Native ephemeral messages require an interaction trigger (slash command or button click). The prompt is posted mid-tool-turn, where no interaction context exists. Rejected.

### Option C: Post normally, delete on decision, confirm with an ephemeral toast; capability-gated with a detached handle (chosen)

- **Pros:** Clean chat history after a decision; instant non-persistent confirmation; redact-on-timeout closes the dead-button case; platforms without the capability fall back to edit-in-place unchanged.
- **Cons:** A new capability to declare and keep consistent with the runtime reply surface; per-adapter wiring (delete + ephemeral primitives differ per platform); a handle lifecycle that must survive past the turn that created it.

## Decision

Six coordinated changes implement the architecture. The unifying idea is a **`PromptHandle`** — a
detached remote control (`redact(text)` / `remove()`) for the specific prompt message, captured at
send time and stored on the pending request. The click path reaches the prompt through the
interaction **or** the handle; the timeout path has no interaction, so the handle is the only way
to reach the prompt, which is what makes redact-on-timeout possible.

### 1. Capability + type changes — `src/chat/types.ts`, `src/chat/prompt-handle.ts`

- `'messages.ephemeral'` added to the `ChatCapability` union. It declares the platform can present a
  confirmation that does **not** persist in channel history (toast / ephemeral post / ephemeral
  interaction reply).
- `PromptHandle` is defined in `src/chat/prompt-handle.ts` and re-exported from `src/chat/types.ts`:
  `{ redact: (text: string) => Promise<void>; remove: () => Promise<void> }`.
- `ReplyFn.buttons` return type widens from `Promise<void>` to `Promise<PromptHandle | undefined>`.
  Adapters that can target the message they just sent return a handle; others return `undefined`.
- `ReplyFn` gains an optional `ephemeralConfirm: (text: string) => Promise<void>` in its `Partial`
  block, present only on interaction replies of `messages.ephemeral` platforms. Runtime code
  feature-detects `reply.ephemeralConfirm !== undefined`, consistent with the existing
  `reply.replaceText` style; the capability string is the declarative source of truth.

### 2. Permission prompt — `src/chat/permission-prompt.ts`

- `PendingRequest` gains `handle?: PromptHandle` (alongside the existing `toolName`).
- `askPermissionViaChat` registers the pending entry **before** sending, then patches `handle` in
  on the `reply.buttons(...).then`. A send failure denies immediately (the user cannot respond to a
  prompt that was never posted), rather than hanging for the full timeout.
- **Timeout path:** `redactExpiredPrompt(entry, ...)` calls `entry.handle?.redact('⌛ Expired — denied.')`
  (errors swallowed and logged), then resolves `deny`.
- `resolvePermissionRequest(id, decision)` now returns `{ resolved: boolean; handle?: PromptHandle }`
  instead of `boolean`, so the click path can act on the handle. It still clears the timer and
  resolves the promise; it does **not** delete — that policy stays in the interaction-router.
- `formatPermissionDecisionText` is replaced by `formatDecisionConfirmation(toolName, decision)` →
  `Allowed <toolName> ✅` / `Denied <toolName> 🚫`.

### 3. Interaction router — `src/chat/interaction-router.ts`

`finalizePermissionDecision` is capability-aware, with the tool name in the confirmation text:

- **Ephemeral path** (`reply.ephemeralConfirm` present **and** `handle` present): `await handle.remove()`
  (delete the prompt; errors swallowed and logged), then `await reply.ephemeralConfirm(confirmation)`.
- **Fallback** (neither — e.g. Kontur Talk, or a platform whose `buttons` returned `undefined`):
  today's behavior — `replaceText` edit-in-place, falling back to `text`, appending the tool-named
  confirmation to the original prompt text.

`peekPermissionRequest` continues to expose `toolName` so the router can render the confirmation
before resolving.

### 4. Per-adapter mapping

| Adapter         | `messages.ephemeral`                  | `buttons` → `PromptHandle`                                                                                                                       | `ephemeralConfirm`                                                                                                                                                                             |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telegram**    | added                                 | `redact` = `editMessageText(chatId, sentId)`; `remove` = `deleteMessage(chatId, sentId)`; `sendButtonReply` returns the sent `Message`           | `ctx.answerCallbackQuery({ text })` (toast). A `CallbackAnswerState` guard records that `ephemeralConfirm` answered the query so the dispatcher's safety-net `answerCallbackQuery` is skipped. |
| **Discord**     | added                                 | `redact` = `sent.edit({ content, components: [] })`; `remove` = `sent.delete()`; `SendableChannel.send` return widened to `{ id, edit, delete }` | `interaction.followUp({ content, flags: MessageFlags.Ephemeral })` via an `ephemeralReply` param threaded into `createDiscordReplyFn`                                                          |
| **Mattermost**  | added (already had `messages.delete`) | `redact` = `PUT /api/v4/posts/<id>/patch`; `remove` = `DELETE /api/v4/posts/<id>`; `post` returns the created id via `extractPostId`             | existing `setEphemeral` (`ephemeral_text` response)                                                                                                                                            |
| **Kontur Talk** | —                                     | `buttons` rejects (`Promise<never>`, assignable to `Promise<PromptHandle \| undefined>`)                                                         | — → fallback path                                                                                                                                                                              |

## Consequences

### Positive

- Decided prompts are deleted on Telegram, Discord, and Mattermost, so chat history no longer
  accumulates stale permission rows; the confirmation is a non-persistent toast.
- Timeout redacts the prompt to `⌛ Expired — denied.`, closing the dead-button case on every
  platform whose adapter returns a handle.
- The confirmation carries the tool name, disambiguating concurrent `ask`-gated calls.
- Platforms without the capability (Kontur Talk) keep the prior edit-in-place behavior unchanged —
  no regression.
- The `PromptHandle` abstraction is reusable for any future "post now, mutate later" prompt
  surface; the `messages.ephemeral` capability follows the established capability-registry pattern.
- Per-adapter `prompt-handle-builder` modules keep platform delete/edit primitives behind narrow,
  testable interfaces (e.g. `TelegramBotEditApi`), so the core never depends on the full bot client.

### Negative

- **Capability/surface consistency must be maintained.** Each adapter that declares
  `messages.ephemeral` must also wire `ephemeralConfirm` on its interaction reply; the
  `src/chat/CLAUDE.md` convention and the per-adapter metadata tests enforce this, but a future
  adapter could drift.
- **Handle lifetime is process-local.** The `pending` map and its handles live in memory; a
  restart drops in-flight prompts. This matches the pre-existing `ask`-gate behavior (the promise
  itself is in-memory), so it is not a regression, but the redact/remove callbacks are now also
  lost on restart.
- **Kontur Talk is unchanged by design.** Its `ask`-gated prompts still time out and auto-deny with
  no interaction; the fallback edit/text path applies. This is a pre-existing platform limitation,
  not closed by this work.
- **Per-adapter delete/edit primitives can fail silently.** All `redact`/`remove` failures are
  swallowed and logged (the prompt may already be gone, the bot may lack delete permissions, etc.).
  This is intentional — a confirmation must never block the decision — but means a failed delete
  leaves a stale prompt with no user-visible signal beyond the missing toast.

### Risks

- **Telegram double-answer.** `answerCallbackQuery` may only be called once per callback. The
  `CallbackAnswerState` guard ensures `ephemeralConfirm` answers the query and the dispatcher skips
  the safety-net answer; if the guard were bypassed, the second answer fails harmlessly (swallowed),
  but the toast could be lost.
- **Mattermost post-id extraction.** `extractPostId` defensively returns `undefined` for an
  unexpected response shape, in which case `buttons` returns `undefined` and the prompt takes the
  fallback path (no delete, no toast) — degraded but safe.
- **Race between timeout and click.** `resolvePermissionRequest` deletes the entry and clears the
  timer, so a click wins the race; a timeout that fires first denies and redacts, and a later click
  finds no entry and reports "Action is no longer available." Correct, but the prompt is already
  redacted, which may briefly surprise a slow clicker.

## Related Decisions

- ADR-0142: Tool `ask` Permission Gate — the gate that produces these prompts; this ADR defines the
  prompt's lifecycle after it is posted.
- ADR-0189: Ask Permission Arguments — the prompt body and argument rendering this prompt surfaces.
- ADR-0182: Mattermost Buttons And Always-On Web Server — the Mattermost interactive-button
  infrastructure (`buildActions`, signed action context) that the Mattermost handle and
  `ephemeral_text` confirmation build on.
- ADR-0140: Kontur Talk Chat Provider — the platform that takes the fallback path (no
  buttons/callbacks), and whose `buttons` rejecting `Promise<never>` stays type-compatible with the
  widened return.
- ADR-0126: Multi-Provider Phase 3: Chat Router — the `ChatRouter`/`ReplyFn` surface and
  capability-driven adapter model this work extends.

## Implementation Notes

Key files, confirming presence:

- `src/chat/prompt-handle.ts` — `PromptHandle` type (`redact`/`remove`), re-exported from
  `src/chat/types.ts:207-208`. (`PromptHandle` was extracted to its own module rather than inlined
  in `types.ts` as the plan described — single-responsibility and reusable.)
- `src/chat/types.ts:52` — `'messages.ephemeral'` in the `ChatCapability` union;
  `src/chat/types.ts:217` — `buttons: (...) => Promise<PromptHandle | undefined>`;
  `src/chat/types.ts:226-227` — optional `ephemeralConfirm`.
- `src/chat/permission-prompt.ts:90` — `handle?: PromptHandle` on `PendingRequest`;
  `:124` — `formatDecisionConfirmation(toolName, decision)`; `:141` — `redactExpiredPrompt`;
  `:177-192` — redact-on-timeout with swallowed errors; `:194-204` — `resolvePermissionRequest`
  returns `{ resolved: boolean; handle?: PromptHandle }`; `:144-173` — register-before-send with
  immediate deny on send failure.
- `src/chat/interaction-router.ts:20-46` — `finalizePermissionDecision` ephemeral path
  (`handle.remove()` + `reply.ephemeralConfirm`) and edit-in-place fallback; `:78-83` — resolves
  and finalizes with `pending.toolName`.
- `src/chat/telegram/prompt-handle-builder.ts` — `buildTelegramPromptHandle(api, chatId, msgId)`
  behind a narrow `TelegramBotEditApi` (DI-friendly, unit-testable without the full Grammy bot).
- `src/chat/telegram/reply-fn-builder.ts:58-67` — `ephemeralConfirm` sets
  `callbackAnswerState.answered = true`; `:106-109` — `buttons` returns
  `buildTelegramPromptHandle(api, sent.chat.id, sent.message_id)`.
- `src/chat/telegram/index.ts:252-255` — `dispatchCallbackQuery` builds a `callbackAnswerState`
  and skips the safety-net `answerCallbackQuery` when already answered.
- `src/chat/discord/prompt-handle-builder.ts` — `buildPromptHandle(sent)` over a `SentMessage`
  with optional `delete`; `src/chat/discord/reply-helpers.ts:193-195` — `buttons` returns the
  handle; `:223` — `reply.ephemeralConfirm = ephemeralReply` when provided.
- `src/chat/mattermost/reply-helpers.ts:103` — `createButtonsReply` returns
  `Promise<PromptHandle | undefined>`, redact/remove via `apiFetch`; `action-callbacks.ts:142` —
  `ephemeralConfirm: setEphemeral`.
- `src/chat/telegram/metadata.ts:12`, `src/chat/discord/metadata.ts:11`,
  `src/chat/mattermost/metadata.ts:12` — `'messages.ephemeral'` declared.
- `src/chat/kontur-talk/` — no `messages.ephemeral`, no `ephemeralConfirm`, no `PromptHandle`; its
  `buttons` rejects and the fallback path applies.
- `src/chat/CLAUDE.md:51,57` — adapter conventions updated to document `PromptHandle` and the
  self-removing prompt behavior.
