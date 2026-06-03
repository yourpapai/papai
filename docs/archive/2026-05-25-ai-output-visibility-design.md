<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI Output Visibility Design

**Date:** 2026-05-25
**Status:** Approved
**Scope:** Normal chat output only; debug UI remains unchanged

## Goal

Allow users to configure, per conversation context, whether papai shows AI agent tool-call details and provider-exposed reasoning in normal chat. The feature is controlled through `/config` only and uses the same target-selection and permission model that `/config` already applies to personal and managed group contexts.

## Non-Goals

- Do not change the debug dashboard, trace collector, or debug event payloads.
- Do not add a new slash command.
- Do not infer or generate reasoning summaries when the model provider does not expose reasoning text.
- Do not expose raw data unless the context setting explicitly selects raw detail level.

## Settings Model

Add three context-scoped config settings:

| Setting                   | Values             | Default     | Meaning                                                                           |
| ------------------------- | ------------------ | ----------- | --------------------------------------------------------------------------------- |
| `ai_tool_visibility`      | `on`, `off`        | `off`       | `on` shows tool-call progress/details; `off` hides intermediate tool-call output. |
| `ai_reasoning_visibility` | `on`, `off`        | `off`       | `on` shows provider-exposed reasoning text when available; `off` hides reasoning. |
| `ai_output_detail_level`  | `sanitized`, `raw` | `sanitized` | Controls whether enabled outputs use safe summaries or raw data.                  |

Missing or invalid stored values fall back to these defaults. With all defaults, no tool progress, tool failure warning, or reasoning is shown as intermediate chat output. Final answers and top-level error messages still send normally.

## Architecture

The feature is split into small units with clear boundaries:

| Component                     | Purpose                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/ai-output-settings.ts`   | Defines setting keys, allowed values, defaults, parsers, and `getAiOutputSettings(contextId)`.                                                         |
| `src/ai-progress-reporter.ts` | Owns no-op, live, and buffered user-visible reporting plus the sanitization boundary.                                                                  |
| `/config` integration         | Adds an “AI Output” section and buttons for tool visibility, reasoning visibility, and detail level for the selected context.                          |
| LLM invocation wiring         | Creates the reporter for each turn, passes it into model invocation, calls it from tool hooks, and flushes buffered details around the final response. |
| Tests                         | Cover settings, config rendering/callbacks, reporter behavior, suppression/defaults, reasoning availability, and final-response regressions.           |

The reporter is a request-scoped abstraction. Tool execution and LLM orchestration report events to it, not to chat adapters directly. Chat-provider differences stay inside the reporter or a small delivery helper.

Existing debug tracing remains separate. Events such as `tool:request`, `llm:tool_result`, `llm:end`, and debug `stepsDetail` continue to serve observability and must not become the user-visible source of truth.

## Data Flow

For each incoming turn:

1. Bot authorization resolves the storage context as it does today.
2. The orchestrator reads AI output settings for that storage context.
3. The orchestrator creates an `AiProgressReporter` with the resolved settings and current `ReplyFn`.
4. `experimental_onToolCallStart` reports tool name and input to the reporter.
5. `experimental_onToolCallFinish` reports tool success/failure, duration, output, and errors to the reporter.
6. After `generateText` resolves, provider-exposed `reasoningText` is reported if reasoning visibility is enabled.
7. The final answer is sent as today.
8. If live delivery was not used or is unavailable, the reporter flushes one complete details block around the final answer.

The grouped details block is complete, not compressed. “Compact” means grouped into one message, not trimmed or summarized beyond the configured `sanitized` vs `raw` detail policy.

## Output Rules

Tool output:

| Setting                  | Behavior                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `ai_tool_visibility=off` | Do not send intermediate tool-call output, including tool-specific failure warnings. |
| `ai_tool_visibility=on`  | Show tool start and finish details according to `ai_output_detail_level`.            |

Reasoning output:

| Setting                       | Behavior                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `ai_reasoning_visibility=off` | Do not show reasoning.                                                                           |
| `ai_reasoning_visibility=on`  | Show provider-exposed reasoning text when available. If unavailable, omit the reasoning section. |

Detail level:

| Setting                            | Behavior                                                                                                                                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_output_detail_level=sanitized` | Show tool names, status, duration, and safe summaries of inputs/results. Redact secrets, credentials, risky URLs, long blobs, attachment contents, and excessive structured data. Reasoning uses provider-exposed visible reasoning text only. |
| `ai_output_detail_level=raw`       | Show raw tool inputs/results and raw provider reasoning where the SDK/provider exposes them. `/config` labels this setting as sensitive.                                                                                                       |

Raw detail level is available wherever the context settings can be changed. It is intentionally not bot-admin-only.

## Platform Delivery

The reporter chooses delivery style per platform capability and reliability:

| Delivery Style | Behavior                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Live messages  | Sends separate intermediate messages during the turn where this is practical and not overly noisy.                                  |
| Buffered block | Accumulates all enabled details and sends one complete block before or after the final response where live delivery is impractical. |

The first implementation can choose conservative buffered delivery for any platform where live behavior is uncertain. The design allows later provider-specific tuning without changing the settings model.

## Error Handling

Tool failures are handled through two channels:

| Channel                  | Behavior                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Intermediate tool output | Controlled by `ai_tool_visibility`. If `off`, no tool-specific progress or warning messages are sent during the turn. If `on`, failures appear with sanitized or raw detail according to `ai_output_detail_level`. |
| Final/top-level response | Always preserved. If the model recovers and returns a final answer, the final answer is sent. If the whole turn fails, the existing user-facing top-level error message is sent.                                   |

Reasoning absence is quiet. If the provider or SDK does not expose reasoning text, no reasoning section is shown. If raw reasoning is unavailable, raw mode does not fabricate it.

Sanitization failures fail closed. If a value cannot be safely summarized, sanitized output reports metadata such as type, approximate size, or `redacted`, not the raw value.

## Testing

Tests should cover:

| Area                 | Coverage                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settings parsing     | Missing keys resolve to `tool=off`, `reasoning=off`, `level=sanitized`; invalid stored values fall back safely.                                  |
| `/config` UI         | AI Output section renders for selected context; buttons write to the target context; existing permission and group-selection behavior is reused. |
| Tool visibility off  | Tool start/finish hooks do not send intermediate chat output, including tool failure warnings.                                                   |
| Tool visibility on   | Tool activity is shown with sanitized values by default and raw values only at `raw` level.                                                      |
| Reasoning visibility | Provider-exposed `reasoningText` is shown only when reasoning is on; unavailable reasoning produces no invented summary.                         |
| Buffered delivery    | If live delivery is disabled or unavailable, the full details block is emitted once and remains complete.                                        |
| Regression           | Final answers and top-level failures still send as before. Debug trace events still collect tool details.                                        |

Verification should include targeted unit tests first, then `bun typecheck` and the relevant `bun test ...` command. Client tests are only needed if implementation touches client-side code.

## Documentation References

- Vercel AI SDK 6 exposes `generateText` `reasoningText`, `reasoning`, `toolCalls`, and `toolResults` result fields.
- Vercel AI SDK UI streams can include reasoning parts, and stream responses support a `sendReasoning` option. papai currently uses `generateText`, so this design reads provider-exposed reasoning from the generation result rather than adopting UI streaming.
- Raw chain-of-thought can reveal sensitive or unintended information. The design keeps reasoning hidden by default and labels raw detail level as sensitive.
