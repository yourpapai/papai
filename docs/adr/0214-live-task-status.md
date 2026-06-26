<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0214: Live Task Status

## Status

Implemented

## Date

2026-06-19

## Context

While the bot processes a turn it showed only the platform `Typing…` indicator, kept alive by `withReplyTypingHeartbeat` (`src/reply-typing-heartbeat.ts`) which re-sends `typing` every ~4500ms until the first real reply. There was no in-chat signal of _what_ the bot was doing — which tool was running, whether it was fetching a page or searching memory. The end-of-run `AiProgressReporter` tool log is privacy-gated (`ai_tool_visibility`) and buffered to flush _after_ the run, so it gives no live feedback and never reaches a context with visibility off.

The 2026-06-19 design (`docs/archive/2026-06-19-live-task-status-design.md`) added an **ephemeral, in-place status message** that runs alongside `Typing…`: a single message, edited in place as work progresses (e.g. `🌐 Fetching example.com…`, `🔍 Searching memory: "budget"…`), switching to `💭 Thinking…` between tools, and **deleted** the moment the real reply posts — leaving no trace in chat history. It is fed by the existing `experimental_onToolCallStart`/`onToolCallFinish` hooks (`src/llm-orchestrator-invoke.ts`), so no new SDK hooks and no extra model calls were required.

A new primitive was needed because plain `ReplyFn` sends (`text`/`formatted`) return `Promise<void>` with no message id, and `redactMessage`/`deleteMessage` target the _user's_ triggering message or need an id the caller never receives. Telegram and Discord natively support edit+delete (Bot API / discord.js) even though the existing `ReplyFn` did not expose delete; Mattermost can PATCH and DELETE a post; **Kontur Talk has no edit/delete/typing API** and must degrade silently.

## Decision Drivers

- **Real-time visibility**: surface the executing task _during_ the run, not only at the end.
- **Truly ephemeral**: one message, updated in place, removed on completion — no chat-history trace.
- **Heartbeat coexistence**: a status send must not trip the typing-heartbeat stop-wrapper (which stops `Typing…` on the first `text`/`formatted`/`buttons`/`file` call).
- **Provider degradation**: platforms without edit/delete (Kontur Talk) must degrade silently; a status failure must never break or slow a run.
- **Conservative privacy despite always-on**: only an explicitly-allowlisted argument may surface; MCP/plugin/unmapped tools show no argument.
- **Test determinism**: the repo forbids fixed-wall-clock timing assertions, so any time-based behavior needs injectable clocks.

## Considered Options

### A. New `StatusHandle` capability on `ReplyFn` (chosen)

Add an optional `createStatus(initialText) → Promise<StatusHandle | undefined>` to `ReplyFn`, mirroring the existing `PromptHandle` pattern. Each provider implements it with native edit/delete primitives; a dedicated `LiveStatusReporter` owns the handle lifecycle, fed by the existing tool-call hooks.

- **Pros**: small blast radius (one optional method); platform logic stays inside adapters; reuses the established `PromptHandle` capability pattern.
- **Cons**: adds an optional `ReplyFn` surface; needs a send-that-returns-an-id primitive the prior `ReplyFn` lacked.

### B. Make `text()` return a handle

- **Pros**: reuses an existing surface; no new `ReplyFn` method.
- **Cons**: every caller and the heartbeat stop-wrapper key off `text`/`formatted`/`buttons`/`file` — wide blast radius for no extra benefit; collapses the type contract for all reply paths.

### C. Branch per-platform inside one reporter

- **Pros**: a single orchestration site.
- **Cons**: still needs a send-returns-an-id, so it collapses back into A with platform logic leaking out of the adapters — the opposite of the adapter-isolation convention.

## Decision

Six coordinated changes implement the architecture:

### 1. `StatusHandle` type + optional `ReplyFn.createStatus`

A new type-only module `src/chat/status-handle.ts` exports `StatusHandle = { update(text): Promise<void>; dismiss(): Promise<void> }`. `src/chat/types.ts` re-exports it and adds `createStatus: (initialText: string) => Promise<StatusHandle | undefined>` to the optional half of `ReplyFn`. Every method is fire-and-forget-safe: a failed `createStatus` resolves `undefined` and the reporter then holds a null handle and no-ops for the rest of the run.

### 2. Per-provider implementation

| Platform    | create                                   | update                    | dismiss              |
| ----------- | ---------------------------------------- | ------------------------- | -------------------- |
| Telegram    | `ctx.reply` → `buildStatusHandle` helper | `api.editMessageText`     | `api.deleteMessage`  |
| Discord     | `channel.send` → `Message`               | `message.edit`            | `message.delete`     |
| Mattermost  | create post → `post.id`                  | PATCH `/posts/{id}/patch` | DELETE `/posts/{id}` |
| Kontur Talk | returns `undefined` (no API)             | —                         | —                    |

Telegram extracts the create/update/dismiss into `buildStatusHandle` (`src/chat/telegram/reply-fn-builder.ts:28`); Discord and Mattermost inline it (`src/chat/discord/reply-helpers.ts:208`, `src/chat/mattermost/reply-helpers.ts:208`). Kontur Talk omits the method, which is the contract.

### 3. `LiveStatusReporter` lifecycle (`src/live-status/reporter.ts`)

`createLiveStatusReporter(reply, options?)` owns one `StatusHandle` per turn. `start()` calls `reply.createStatus('💭 Thinking…')`; `onToolStart({ toolName, input })` resolves the label and updates; `onToolFinish()` decrements an in-flight counter and reverts to `💭 Thinking…` when it reaches 0; `dismiss()` is idempotent and cancels any pending revert. `options` = `{ enabled?, minLabelMs?, now?, schedule? }`. An internal `createStatusEngine`/`EngineState` tracks `inFlight`, `lastStartLabel`, `lastRendered`, `labelShownAt`, and `cancelPending`.

**Anti-flicker** is a time-based `minLabelMs` hold (default 1000ms): a tool label is held at least `minLabelMs` before reverting to `Thinking…`; the revert is _deferred_ via `schedule`, a new tool start within the window cancels the pending revert and shows its label immediately, and `dismiss()` cancels it. Dedup-by-equality (skip an edit when the rendered text is unchanged) is a secondary guard in `pushText`. Clocks are injectable (`now`/`schedule`) so tests need no real timers.

### 4. Label + allowlisted-argument registry (`src/live-status/tool-status-labels.ts`)

A pure map `REGISTRY` keyed by tool name: `{ emoji, label, quote?, arg? }`. The `arg` extractor _is_ the allowlist — only the single field it reads is ever surfaced. `sanitizeArg` collapses whitespace and truncates to 40 chars. `formatToolStatus` renders `${emoji} ${label}${arg ? `: "${arg}"` : ''}…` (bare when `quote: false`, e.g. hosts). Fallback for MCP (`mcp_*`), plugin (`plugin_*`), and unmapped tools humanizes the id (strip prefix, last `__` segment, `_`→space) and shows **no argument** — `⚙️ Running transcribe…`.

### 5. Wiring off the existing tool-call hooks

`liveStatus: LiveStatusReporter` is added to `InvokeModelArgs` and `ToolCallContext` (`src/llm-orchestrator-types.ts:71,90`). `handleToolCallStart`/`handleToolCallFinishEvent` (`src/llm-orchestrator-invoke.ts`) forward to `onToolStart`/`onToolFinish` right after the existing `reportToolStarted`/`reportToolFinished` calls — no new SDK hooks. The reporter is created/dismissed in `invokeWithLiveStatus` (`src/llm-orchestrator-support.ts:270`), called from `callLlm` (`src/llm-orchestrator.ts:174`); `dismiss()` fires both before `sendLlmResponse` and in `finally` (idempotent safety net for error/`/stop`/abort).

### 6. Per-context `ai_live_status` setting gate

A reserved config key `ai_live_status` (`src/ai-output-settings.ts:11`, surfaced as a `ConfigField` `kind: 'ai-output'` in `src/config-keys.ts:78`) gates the feature per context. It is read at the **config-context id** via `getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)).liveStatus` (`src/llm-orchestrator.ts:173`), so it shares scope across a group's threads like the other AI-output settings. `parseLiveStatus` is **opt-out**: any value other than the explicit `'off'` (including unset/invalid) preserves the historical always-on behavior; only a literal `'off'` disables the status (leaving just `Typing…`).

## Consequences

### Positive

- Real-time, in-chat signal of the executing task on all platforms with an edit/delete API.
- Truly ephemeral: edited in place, deleted on completion — no chat-history trace.
- `Typing…` and the live status coexist for the whole run (reporter uses the unwrapped reply; `createStatus` is not in the heartbeat wrapper's hooked-method list).
- Core absorbs every status failure; a status op can never break or slow a run.
- Privacy stays conservative despite always-on: only explicitly-allowlisted args surface; MCP/plugin/unmapped tools show no argument.
- `minLabelMs` + injectable `now`/`schedule` give flicker-free UX with deterministic, timer-free tests.

### Negative

- **Kontur Talk gets no live status** (no edit/delete API) — only `Typing…` shows. This is the intended degradation, not a regression.
- **An orphaned status on a hard crash** before `finally` leaves at worst a stale `💭 Thinking…` line; the run is unaffected.
- **`minLabelMs` adds up to one hold of lag** before the revert to `Thinking…` when fast tools chain; a new tool start cancels the pending revert, so steady chains are not delayed.

### Risks

- **Platform rate-limiting of edit/delete** could throttle rapid status updates; mitigated by dedup-by-equality (redundant edits are skipped before the network call) and the `minLabelMs` coalescing window.
- **Setting drift across threads**: because `ai_live_status` is read at the config-context id, a group's threads share one setting — disabling it in one thread disables it for siblings. This matches the other AI-output settings by design.

## Related Decisions

- **ADR-0040: Debug Dashboard HTML** — the `/debug` live-observability surface; live status is a chat-visible complement, not a duplicate, of the engineer dashboard.
- **ADR-0144: AI Output Visibility Controls** — the `ai_tool_visibility`/`ai_reasoning_visibility`/`ai_output_detail_level` end-of-run logs; `ai_live_status` joins this family as the always-on (opt-out) in-run indicator.
- **ADR-0210: Agent Interruption and Steering** — `/stop` and mid-run steering share the same turn lifecycle; live status is dismissed in `finally` alongside the independent stop-summary post.

## Implementation Notes

The shipped implementation diverges from the 2026-06-19 plan/spec in three deliberate ways:

1. **Setting gate.** The plan and spec both stated "always on, no settings UI, no config key, no toggle." Shipped with the per-context `ai_live_status` toggle (default **on**, opt-out), read at the config-context id so it is group-shared across threads, surfaced as a `ConfigField` `kind: 'ai-output'` in the settings-UI **AI output** section. `parseLiveStatus` (`src/ai-output-settings.ts:29`) preserves always-on for any non-`'off'` value.

2. **Anti-flicker.** The plan's header note claimed it _replaced_ the spec's ~600ms throttle with deterministic dedup-by-equality to avoid wall-clock timing assertions. Shipped instead with a `minLabelMs` time-based hold (default 1000ms) and a _deferred_ `Thinking…` revert, kept deterministic via injectable `now`/`schedule` (`LiveStatusReporterOptions`) rather than by dropping the throttle. Dedup-by-equality remains as a secondary guard in `pushText`.

3. **Wiring site.** The plan created/dismissed the reporter inline in `callLlm` (`src/llm-orchestrator.ts`). Shipped extracted into `invokeWithLiveStatus` (`src/llm-orchestrator-support.ts:270`), invoked from `callLlm` with `{ enabled: liveStatusEnabled }`; `callLlm` only resolves the enabled flag via `getAiOutputSettings`.

Key files confirming presence:

- `src/chat/status-handle.ts` — `StatusHandle` type (type-only, mirrors `prompt-handle.ts`).
- `src/chat/types.ts:234` — optional `createStatus` on `ReplyFn`.
- `src/chat/telegram/reply-fn-builder.ts:28,110` — `buildStatusHandle` + `createStatus`.
- `src/chat/discord/reply-helpers.ts:208` — Discord `createStatus`.
- `src/chat/mattermost/reply-helpers.ts:208` — Mattermost `createStatus`.
- `src/chat/kontur-talk/` — omits `createStatus` (the contract).
- `src/live-status/tool-status-labels.ts` — `formatToolStatus`, `sanitizeArg`, `REGISTRY` (private), `humanizeToolName` fallback.
- `src/live-status/reporter.ts` — `LiveStatusReporter`, `createLiveStatusReporter`, `LiveStatusReporterOptions`, `createStatusEngine`/`EngineState` with `minLabelMs` deferred revert.
- `src/llm-orchestrator-types.ts:71,90` — `liveStatus` on `InvokeModelArgs`/`ToolCallContext`.
- `src/llm-orchestrator-invoke.ts` — `handleToolCallStart`/`handleToolCallFinishEvent` forward to `onToolStart`/`onToolFinish`.
- `src/llm-orchestrator-support.ts:270` — `invokeWithLiveStatus` create/dismiss from the unwrapped reply.
- `src/llm-orchestrator.ts:173,174` — `liveStatusEnabled` resolution + `invokeWithLiveStatus` call.
- `src/ai-output-settings.ts:11,29,42` — `AI_LIVE_STATUS_KEY`, opt-out `parseLiveStatus`, `liveStatus` field.
- `src/config-keys.ts:78` — `ai_live_status` `ConfigField`.
- Tests: `tests/live-status/{tool-status-labels,reporter}.test.ts`, per-provider `createStatus` suites, `tests/chat/kontur-talk/reply-helpers.test.ts` (omission), `tests/reply-typing-heartbeat.test.ts` (passthrough), `tests/llm-orchestrator{,-invoke}.test.ts` (wiring).
