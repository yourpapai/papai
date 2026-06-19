<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Live Task Status — Design

**Date:** 2026-06-19
**Status:** Approved (design); ready for implementation planning

## Summary

While the bot processes a user's request, it currently shows only the platform
`Typing…` indicator (kept alive by an interval heartbeat). This feature adds an
**ephemeral, in-place status message** that runs alongside `Typing…` and shows
the task the bot is currently executing — e.g. `🌐 Fetching example.com…`,
`🔍 Searching memory: "budget"…` — switching to `💭 Thinking…` between tools and
during pure LLM generation. The status message is a single message, edited in
place as work progresses, and **deleted** the moment the real reply is posted,
so it leaves no trace in chat history.

## Goals

- Surface, in real time, what the bot is doing during a run.
- Truly ephemeral: one message, updated in place, removed at the end.
- Always on (independent of the privacy-gated `ai_tool_visibility` end-of-run log).
- Never break or slow a run if a status operation fails.
- Degrade gracefully on platforms without edit/delete support.

## Non-goals

- No new settings UI surface or config key (always-on; no toggle).
- No change to the existing end-of-run `AiProgressReporter` tool log or its
  `ai_tool_visibility` gating.
- No LLM-authored status text (no extra model calls).
- No per-platform native "ephemeral message" semantics (Discord ephemeral,
  Mattermost `ephemeral_text`) — "ephemeral" here means _update-in-place then delete_.

## Decisions (from brainstorming)

| Question       | Decision                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle      | One message, edited in place, **deleted** when the final reply posts.                                                                                                                  |
| Content        | Humanized **label + one allowlisted argument**; generic fallback for MCP/plugin/unmapped tools.                                                                                        |
| Gating         | **Always on**, independent of `ai_tool_visibility`.                                                                                                                                    |
| Thinking phase | Show `💭 Thinking…` at run start and between tools; switch to the tool label while a tool runs; keep something shown until the reply lands (no-tool replies show `Thinking…` briefly). |
| Architecture   | New `StatusHandle` capability on `ReplyFn` (Approach A).                                                                                                                               |

## Existing building blocks (context)

- **Typing heartbeat** — `src/reply-typing-heartbeat.ts`. `withReplyTypingHeartbeat`
  wraps the entire `invokeModel` call (all LLM steps + tool executions),
  re-sending `typing` every `4500ms` until the first real reply. The wrapper
  (`wrapReplyWithHeartbeatStop`) stops the heartbeat the moment any outbound
  method (`text`/`formatted`/`buttons`/`file`/…) is called.
- **Real-time tool hooks** — `src/llm-orchestrator-invoke.ts`:
  `experimental_onToolCallStart` / `experimental_onToolCallFinish` fire per tool
  in real time and already route to `progressReporter.toolStarted/toolFinished`.
  Those today **buffer** and flush only after the run (gated by `ai_tool_visibility`).
- **Reply surface** — `src/chat/types.ts` `ReplyFn`. Plain sends (`text`,
  `formatted`) return `Promise<void>` (**no message id**). Only `buttons()`
  returns an editable `PromptHandle` (`redact`/`remove`). `redactMessage` targets
  the _user's triggering_ message, not a new one; `deleteMessage` (Mattermost
  only) needs a message id the caller never receives.
- **Per-platform capability** — Telegram & Discord can edit and (via Bot API /
  discord.js) delete; Mattermost can edit (patch) and delete; **Kontur Talk has
  no edit/delete/typing API** (typing is already a no-op there).

The lack of a send-that-returns-an-id is why a new primitive is required rather
than reusing `redactMessage`/`deleteMessage`.

## Approach (chosen: A)

Add a `StatusHandle` capability to `ReplyFn`, mirroring the existing
`PromptHandle` pattern. Each provider implements it with its native primitives; a
dedicated `LiveStatusReporter` owns the handle's lifecycle, fed by the existing
tool-call hooks.

**Rejected alternatives:**

- **B — make `text()` return a handle.** Far wider blast radius (every caller +
  the heartbeat stop-wrapper keys off those methods) for no extra benefit.
- **C — branch per-platform inside one reporter.** Still needs a
  send-that-returns-an-id, so it collapses back into A with platform logic leaked
  out of the providers.

## Design

### 1. `StatusHandle` interface (`src/chat/types.ts`)

```typescript
export type StatusHandle = {
  update(text: string): Promise<void>   // edit the status message in place
  dismiss(): Promise<void>              // delete the status message
}

// added to the optional half of ReplyFn:
createStatus?(initialText: string): Promise<StatusHandle | undefined>
```

- Every method is fire-and-forget-safe: each wraps its platform op in try/catch
  and swallows errors (same discipline as `sendTypingSafely`). A failed
  `createStatus` resolves to `undefined`; the reporter then holds a null handle
  and silently no-ops for the rest of the run. The run is **never** broken by a
  status failure.
- `createStatus` is **optional on `ReplyFn`** — absent ⇒ no live status (e.g.
  button/interaction reply contexts that don't need it).

### 2. Per-provider implementation

| Platform    | create                                   | update                    | dismiss              |
| ----------- | ---------------------------------------- | ------------------------- | -------------------- |
| Telegram    | `ctx.reply(text)` → capture `message_id` | `api.editMessageText`     | `api.deleteMessage`  |
| Discord     | `channel.send(text)` → `Message`         | `message.edit`            | `message.delete`     |
| Mattermost  | create post → `post.id`                  | PATCH `/posts/{id}/patch` | DELETE `/posts/{id}` |
| Kontur Talk | returns `undefined` (no API)             | —                         | —                    |

Telegram and Discord natively support delete (Bot API / discord.js) even though
the current `ReplyFn` does not expose it; the `StatusHandle` adds that use
internally and does not alter the existing `redactMessage`/`deleteMessage`
surface.

### 3. `LiveStatusReporter` (`src/live-status/reporter.ts`)

A dedicated, DI-friendly object, **separate** from `AiProgressReporter` (which
stays the privacy-gated, buffer-and-flush-at-end log). Owns one `StatusHandle`
per turn:

- **start(reply)** — called at run start in `callLlm` (after `runRegistry.begin`,
  alongside `invokeModelWithTyping`). Calls `reply.createStatus('💭 Thinking…')`,
  stores the handle.
- **onToolStart(event)** — resolves the label + arg (§4) and `update`s the handle.
  Increments an in-flight counter for parallel tool calls.
- **onToolFinish(event)** — decrements in-flight; when it reaches 0, `update`s
  back to `💭 Thinking…`.
- **finish()** — `dismiss()`es the handle. Called in the turn's `finally`, so it
  fires on success, error, `/stop`, and abort alike. The final answer (and any
  stop summary) post as normal, separate messages.

Wired off the **existing** `experimental_onToolCallStart` /
`experimental_onToolCallFinish` hooks in `src/llm-orchestrator-invoke.ts` — the
same place `progressReporter.toolStarted/toolFinished` are invoked. No new SDK
hooks needed.

### 4. Label + argument registry (`src/live-status/tool-status-labels.ts`)

A pure, side-effect-free map keyed by tool name:

```typescript
type StatusLabel = {
  emoji: string
  label: string // "Searching memory"
  arg?: (input: unknown) => string | undefined // ONE allowlisted, safe field
}
```

- **Core-tool entries**, e.g.:
  - `web_fetch → { '🌐', 'Fetching', arg: i => host(i.url) }`
  - `search_memory → { '🔍', 'Searching memory', arg: i => i.query }`
  - `create_task → { '📝', 'Creating task', arg: i => i.title }`

  The `arg` extractor **is** the allowlist — only fields explicitly named here
  are ever shown.

- **Central sanitization** applied to every arg: strip newlines, collapse
  whitespace, truncate to ~40 chars with `…`. Render:
  `${emoji} ${label}${arg ? `: "${arg}"` : ''}…`.
- **Fallback** for MCP (`mcp_*`), plugin (`plugin_*`), and any unmapped tool:
  humanize the id (strip prefix, `_`→space, title-case), generic `⚙️`, and **no
  argument** (we can't know which field is safe). e.g.
  `plugin_audio-transcribe__transcribe → "⚙️ Running transcribe…"`.

This keeps the privacy posture conservative despite always-on: arguments surface
only where a maintainer has explicitly marked a field safe.

### 5. Typing-heartbeat interaction

The status must not trip the heartbeat stop-wrapper (which stops `Typing…` the
moment `text`/`formatted`/`buttons`/`file`/… is called). Two-part guard:

- The `LiveStatusReporter` is created from the **original, unwrapped `reply`**
  (captured in `src/llm-orchestrator.ts` before `withReplyTypingHeartbeat` wraps
  it); the handle is passed down, so status sends never flow through the
  stop-wrapper.
- `createStatus` is deliberately **not** added to the wrapper's hooked-method
  list, so even if called on a wrapped reply it would not stop typing.

Result: `Typing…` and the live status coexist for the whole run.

### 6. Edge cases

- **Parallel tools in one step**: last-start-wins for the label, with an
  in-flight suffix when >1 — `🔍 Searching memory… (+1)`. Counter decremented on
  each finish.
- **Anti-flicker**: a minimum update interval (~600ms) coalesces rapid label
  churn so very fast tools don't strobe; `dismiss` ignores the throttle and
  always fires.
- **No-tool reply**: shows `💭 Thinking…` briefly, dismissed when the answer
  posts (accepted per the "Thinking + tools" decision).
- **`/stop` & abort**: `finish()` in `finally` dismisses regardless;
  `buildStopSummary` posts independently.
- **Mid-run steer**: unaffected — the `✋` ack is a separate message; the status
  keeps updating.
- **Crash mid-run**: `finally` still dismisses; if even that fails, the error is
  swallowed and the orphaned status is at worst a stale `Thinking…` line (no run
  impact).

## Test plan (DI-first, per repo conventions)

- **Label registry** (pure unit): core entries map correctly; arg sanitization
  (newline strip, truncation); MCP/plugin/unmapped fallback yields a generic
  label with **no** arg.
- **`LiveStatusReporter`** with an injected fake `StatusHandle`: asserts the
  sequence `create('💭 Thinking…') → update(label) → update('💭 Thinking…') →
dismiss()`; parallel-tool counter; throttle coalescing; all handle errors
  swallowed (run continues).
- **Per-provider `createStatus`** (mocked platform clients, following existing
  reply-helper test patterns): Telegram/Discord/Mattermost create→update→dismiss
  hit the right APIs; **Kontur Talk returns `undefined`** and the reporter
  no-ops.
- **Heartbeat coexistence**: a status send does not stop the typing heartbeat
  (status uses the unwrapped reply path).

## Files touched

- `src/chat/types.ts` — `StatusHandle` type + optional `createStatus` on `ReplyFn`.
- `src/chat/telegram/reply-fn-builder.ts` — Telegram `createStatus`.
- `src/chat/discord/reply-helpers.ts` — Discord `createStatus`.
- `src/chat/mattermost/reply-helpers.ts` — Mattermost `createStatus`.
- `src/chat/kontur-talk/reply-helpers.ts` — Kontur Talk no-op `createStatus`.
- `src/live-status/reporter.ts` — new `LiveStatusReporter`.
- `src/live-status/tool-status-labels.ts` — new label + safe-arg registry.
- `src/llm-orchestrator.ts` — create handle at run start (unwrapped reply), dismiss in `finally`.
- `src/llm-orchestrator-invoke.ts` — drive `onToolStart`/`onToolFinish` from the existing hooks.
- Matching tests under `tests/` for each new/changed unit.
