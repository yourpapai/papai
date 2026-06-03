<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0144: AI Output Visibility Controls

## Status

Implemented

## Date

2026-05-25 – 2026-06-02

## Context

Before this change, papai always sent intermediate tool-failure warnings to chat
during LLM turns and never exposed provider reasoning text. Users had no way to
see what tools the agent called, what inputs and outputs passed through, or
whether the model produced reasoning. Conversely, users who preferred minimal
chat output could not suppress the tool-failure warning messages that appeared
mid-turn.

The lack of per-context control meant every conversation context saw the same
behavior: a brief warning on tool failure, no tool progress, and no reasoning —
regardless of whether the user or group wanted more or less visibility.

Debug tracing (`llm:tool_result`, `tool:request`, the debug dashboard) already
collected full tool details, but that surface is operator-only and not visible
in normal chat.

## Decision Drivers

- **Per-context control**: Different users and groups want different levels of
  AI transparency; a global toggle is too coarse.
- **Safe defaults**: New and unconfigured contexts must not leak sensitive tool
  inputs/outputs or raw reasoning; default visibility must be off.
- **No debug regression**: Debug tracing and the dashboard must continue
  collecting full details unchanged; user-visible output is a separate channel.
- **Existing config model**: Reuse the `/config` permission and target-selection
  model already used for other per-context settings; no new slash command.
- **Sanitization first**: When visibility is enabled, default output must strip
  secrets, credentials, and long blobs; raw output is an explicit opt-in.
- **Buffered delivery**: Intermediate per-tool messages are noisy and
  unreliable across platforms; a single complete details block after the final
  answer is cleaner and more portable.

## Considered Options

### Option A: Always-on tool output with no sanitization

Show full tool inputs/outputs and reasoning in every turn for every context.

- **Pros**: Maximum transparency; simplest implementation.
- **Cons**: Exposes secrets (API keys, tokens) in group chats; raw reasoning
  can leak sensitive chain-of-thought; no per-context opt-out; noisy.

### Option B: Per-context visibility with buffered sanitized reporter (chosen)

Three context-scoped settings (`ai_tool_visibility`, `ai_reasoning_visibility`,
`ai_output_detail_level`) control what appears in chat. A request-scoped
`AiProgressReporter` buffers tool and reasoning details, then flushes one
complete block after the final answer.

- **Pros**: Safe defaults; per-context control; sanitized output by default;
  raw opt-in clearly labeled as sensitive; no platform-specific live-delivery
  complexity; debug tracing unchanged.
- **Cons**: Buffered delivery means details appear after the answer, not in
  real-time per tool call; sanitization may over-redact valid data.

### Option C: Live per-tool messages

Send a separate chat message for each tool start and finish event.

- **Pros**: Real-time progress visibility; matches some user expectations.
- **Cons**: Noisy in multi-tool turns; unreliable across platforms (rate limits,
  message ordering); harder to ensure completeness if a message is dropped.

### Option D: Admin-only raw toggle

Restrict raw detail level to bot administrators only.

- **Pros**: Reduces risk of accidental secret exposure.
- **Cons**: Group admins and power users cannot opt into raw for their own
  context; adds a privilege check that does not match the existing per-context
  config model.

## Decision

**Option B** with the following subsidiary decisions:

| Topic            | Decision                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings model   | Three keys in `user_config`: `ai_tool_visibility` (`on`/`off`, default `off`), `ai_reasoning_visibility` (`on`/`off`, default `off`), `ai_output_detail_level` (`sanitized`/`raw`, default `sanitized`). Invalid stored values fall back to defaults. |
| Reporter         | Request-scoped `AiProgressReporter` created per LLM turn with resolved settings and current `ReplyFn`. Buffers tool and reasoning events; flushes one block after the final answer.                                                                   |
| Sanitization     | Redacts values whose keys match secret patterns (`api_key`, `token`, `secret`, `password`, `authorization`, `cookie`). Truncates long strings (>240 chars). Limits arrays (10 items) and object keys (20 entries).                                    |
| Tool output      | `off`: no intermediate tool output including failure warnings. `on`: buffered tool start/finish details per `detail_level`.                                                                                                                           |
| Reasoning output | `off`: hidden. `on`: provider-exposed `reasoningText` shown; if unavailable, section omitted. Raw mode uses `result.reasoning` when the SDK/provider exposes it.                                                                                      |
| Config UI        | AI Output section appended to `/config` with toggle buttons for each setting. Callbacks routed through `cfg:ai:*` via the existing interaction-router target validation flow.                                                                         |
| Debug isolation  | Tool hooks still emit `llm:tool_result` debug/trace events. Legacy direct user-facing tool failure replies are removed from hooks; they flow through the reporter instead.                                                                            |
| No new migration | Settings use the existing `user_config` / `getCachedConfig` infrastructure; no schema change required.                                                                                                                                                |

## Consequences

### Positive

- Users can opt into tool-call transparency and provider reasoning per context
  without affecting other contexts or the debug surface.
- Safe defaults mean new and unconfigured contexts never leak secrets or raw
  reasoning in chat.
- Removing direct tool-failure warning replies from hooks eliminates a
  redundant user-visible channel; all user-visible tool output now flows through
  one reporter.
- Sanitization boundary is explicit and testable; fail-closed on unparseable
  values.
- No platform-specific delivery complexity; buffered block is portable.

### Negative

- Buffered delivery means tool details appear after the final answer, not in
  real-time as tools execute. Users expecting live per-tool progress must wait
  for the full block.
- Sanitization may over-redact legitimate data whose keys happen to match
  secret patterns (e.g., a field named `authorization_code` in a non-secret
  context).
- Raw detail level is available to any context owner, not restricted to bot
  admins. This is deliberate but increases the risk surface if a group admin
  enables raw in a public channel.

### Risks

- Raw detail level exposes full tool inputs/outputs and raw reasoning in chat.
  If a tool receives or returns secrets, enabling raw in a group context could
  leak them to all group members. Mitigation: `/config` labels raw as
  sensitive; defaults are sanitized.
- Provider reasoning content is not under papai's control. Raw reasoning may
  include instructions, internal prompts, or other data the provider did not
  intend for end-user visibility. Mitigation: reasoning is off by default;
  sanitized mode uses provider-exposed visible text only.

## Implementation Notes

Key modules:

| File                          | Role                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/ai-output-settings.ts`   | Setting keys, value unions, defaults, parsers, `getAiOutputSettings()`, `setAiOutputSetting()` |
| `src/ai-progress-reporter.ts` | Buffered `AiProgressReporter`: tool start/finish, reasoning, sanitization, flush               |
| `src/ai-output-config-ui.ts`  | `/config` section rendering, `cfg:ai:*` callback serialization/parsing, callback handling      |

Integration points:

| File                             | Change                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/commands/config.ts`         | Appends AI Output section and buttons to `/config` output                                     |
| `src/chat/interaction-router.ts` | Routes `cfg:ai:*` callbacks through existing target validation                                |
| `src/llm-orchestrator-types.ts`  | Adds optional `progressReporter` to `InvokeModelArgs`                                         |
| `src/llm-orchestrator-invoke.ts` | Reports tool starts/finishes to reporter; suppresses legacy direct failure warning replies    |
| `src/llm-orchestrator-events.ts` | Adds `reasoningText` to resolved result type                                                  |
| `src/llm-orchestrator.ts`        | Creates reporter per turn, reports reasoning after `generateText`, flushes after final answer |

No database migration: settings stored through existing `getCachedConfig` /
`setCachedConfig` helpers against the `user_config` table.

## Related Decisions

- ADR-0141: User-Configurable Tool Access — per-context tool permission model
  that the AI output settings reuse the same config infrastructure for.
- ADR-0123: Trusted-Local Plugin System — plugin tools flow through the same
  `wrapToolExecution()` path and are subject to the same reporter output.
- ADR-0014: Multi-Chat Provider Abstraction — platform differences in message
  delivery are absorbed by the buffered reporter design.
