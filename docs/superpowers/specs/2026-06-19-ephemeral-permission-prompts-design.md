<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Ephemeral / self-removing `ask` permission prompts

**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan

## Problem

When a tool is set to `ask`, the bot posts a **permission prompt** — a chat message with
Allow/Deny buttons:

```
🔐 Run `web_fetch`?

Arguments:
url: https://example.com

Needs to read the page you linked.

[ ✅ Allow ]   [ 🚫 Deny ]
```

Today, after the user clicks a button, `interaction-router.ts` → `replyToPermissionDecision`
uses `reply.replaceText` to **edit the prompt in place**, appending `Allowed.` / `Denied.`.
The prompt therefore **lingers in chat history forever** (only the buttons are stripped). On a
timeout (5 min → auto-deny) the prompt is left untouched with dead buttons.

We want the prompt to not persist: it should be **ephemeral where the platform supports it, or
removed after the decision where it does not**.

## Constraint that shapes the design

Native ephemeral messages (Discord ephemeral, Mattermost `ephemeral_text`) can only be sent **as a
reply to an interaction** (a slash-command or button click). The permission prompt is **not**
triggered by an interaction — it is posted mid-tool-turn while a tool executes, where no interaction
context exists. So the prompt itself **cannot** be sent natively-ephemeral; it must be a normal
channel message.

The chosen mechanism therefore is: **post the prompt normally, delete it the instant the user
decides, and show an ephemeral toast as confirmation.** On platforms that cannot do this, fall back
to today's edit-in-place behavior.

## Decisions (agreed)

- **On click:** delete the prompt message + show an ephemeral confirmation toast.
- **On timeout:** redact the prompt in place to `⌛ Expired — denied.`
- **Capability model:** an explicit `messages.ephemeral` capability string drives behavior
  (Approach "C").
- **Confirmation text includes the tool name**, e.g. `Allowed web_fetch ✅` / `Denied web_fetch 🚫`.

## Architecture

The unifying idea is a **`PromptHandle`** — a detached remote control for the specific prompt
message, captured at send time and stored on the pending request. The click path can reach the
prompt through the interaction _or_ the handle; the **timeout path has no interaction context**, so
the handle is the only way to reach the prompt — which is what makes redact-on-timeout possible.

### 1. Capability + type changes — `src/chat/types.ts`

- Add `'messages.ephemeral'` to the `ChatCapability` union. Declares the platform can present a
  confirmation that does **not** persist in channel history (toast / ephemeral post / ephemeral
  interaction reply).
- New type:
  ```ts
  /** Detached control over an already-sent prompt message. Valid after the turn ends. */
  export type PromptHandle = {
    redact: (text: string) => Promise<void>
    remove: () => Promise<void>
  }
  ```
- `ReplyFn.buttons` return type changes from `Promise<void>` → `Promise<PromptHandle | undefined>`.
  Adapters that can target the message they just sent return a handle; others return `undefined`.
  Only one caller exists (`askPermissionViaChat`), so this is a contained change.
- Add to the optional (`Partial`) part of `ReplyFn`:
  ```ts
  /** Present only on interaction replies of `messages.ephemeral` platforms. */
  ephemeralConfirm: (text: string) => Promise<void>
  ```

The capability string is the declarative source of truth; `reply.ephemeralConfirm` presence is its
runtime reflection. A consistency test asserts the two agree (mirrors the existing scope-registry
reconciliation pattern). Runtime code feature-detects the reply surface, consistent with the
existing `reply.replaceText !== undefined` style.

### 2. Permission prompt — `src/chat/permission-prompt.ts`

- `PendingRequest` gains `handle?: PromptHandle`. (`toolName` is already present.)
- `askPermissionViaChat`: `const handle = await reply.buttons(body, {...})`; store it on the pending
  entry alongside the existing fields.
- **Timeout path** → `await entry.handle?.redact('⌛ Expired — denied.')` (errors swallowed +
  logged), then `resolve('deny')`.
- `resolvePermissionRequest(id, decision)` returns `{ resolved: boolean; handle?: PromptHandle }`
  instead of `boolean`, so the click path can act on the handle. It still clears the timer and
  resolves the promise; it does **not** itself delete (policy stays in the interaction-router).
- Confirmation text helper: produce `Allowed <toolName> ✅` / `Denied <toolName> 🚫` from the
  decision + the pending entry's `toolName`. `peekPermissionRequest` already exposes `toolName`;
  expose it to the decision text path (e.g. return it from `resolvePermissionRequest` or read via
  peek before resolving).

### 3. Interaction router — `src/chat/interaction-router.ts`

`replyToPermissionDecision` becomes capability-aware. Confirmation text includes the tool name:
`Allowed <toolName> ✅` / `Denied <toolName> 🚫`.

- **Ephemeral path** (`reply.ephemeralConfirm` present **and** `handle` present):
  `await handle.remove()` (delete the prompt) then `await reply.ephemeralConfirm(text)`.
- **Fallback** (neither — e.g. Kontur Talk): today's behavior — `replaceText` edit-in-place,
  falling back to `text`. The appended label also gains the tool name for consistency.

### 4. Per-adapter mapping

| Adapter         | `messages.ephemeral`                | `buttons` → `PromptHandle`                                                                                                             | `ephemeralConfirm`                                                                                                                                                                   |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Telegram**    | add                                 | `redact` = `editMessageText(chatId, sentId)`, `remove` = `deleteMessage(chatId, sentId)`; `sendButtonReply` returns the sent `Message` | `ctx.answerCallbackQuery({ text })` (toast). Remove the unconditional pre-answer in `dispatchCallbackQuery`; guarantee a single answer via an "answered" guard                       |
| **Discord**     | add                                 | `redact` = `msg.edit({ content, components: [] })`, `remove` = `msg.delete()` on the sent message                                      | extend `ButtonInteractionLike` + `createDiscordReplyFn` params with the interaction; `ephemeralConfirm` = `interaction.followUp({ content, ephemeral: true })` (after `deferUpdate`) |
| **Mattermost**  | add (already has `messages.delete`) | `redact` = edit post, `remove` = delete post (both by captured `postId`)                                                               | existing `setEphemeral` (`ephemeral_text` response)                                                                                                                                  |
| **Kontur Talk** | —                                   | returns `undefined` (no buttons/callbacks)                                                                                             | — → fallback path                                                                                                                                                                    |

### 5. Flow summary

**Tool wants to run (no interaction yet):**

1. LLM calls an `ask`-gated tool; the permission gate pauses execution.
2. `askPermissionViaChat()` calls `reply.buttons(...)` → posts the prompt.
3. `reply.buttons` returns a `PromptHandle` for that message (captures IDs; valid minutes later).
4. Handle is stored in the `pending` map keyed by a random request id (also embedded in the button
   `callbackData`). The tool awaits a `Promise`.

**User taps a button (interaction):**

5. Click arrives as `IncomingInteraction` (`callbackData = perm:a:<id>` / `perm:d:<id>`) → routes to
   `routeInteraction()`.
6. Authorize, look up `<id>`, confirm context matches.
7. `resolvePermissionRequest(id, decision)` clears timeout, resolves the promise (the paused tool
   proceeds on allow / is refused on deny), returns the stored handle.
8. Capability-driven ending (see §3).

**User never taps anything (timeout):**

5. After 5 min the `setTimeout` fires; no interaction context.
6. `handle.redact('⌛ Expired — denied.')` rewrites the prompt; promise resolves to `deny`.

## Testing

- `permission-prompt.test`: handle stored; timeout invokes `handle.redact`; `resolvePermissionRequest`
  returns the handle and resolves; confirmation text includes the tool name.
- `interaction-router.test`: ephemeral path deletes + confirms (with tool name); fallback path edits
  in place (with tool name).
- Per-adapter reply tests: `buttons` returns a working handle (`redact`/`remove` call the right
  primitives); `ephemeralConfirm` wired on interaction replies.
- Consistency test: `messages.ephemeral` ⟺ `ephemeralConfirm` provided on each adapter.

## Out of scope / notes

- The prompt is still sent as a normal channel message (it originates mid-tool-turn, not from an
  interaction), so native pre-emptive ephemeral is not available; "ephemeral" here means
  delete-after-decision + ephemeral confirmation.
- **Kontur Talk** has no buttons/callbacks, so `ask`-gated prompts there cannot be interacted with
  and still time out and auto-deny as today; the fallback edit/text path applies. Pre-existing
  limitation, unchanged by this work.
