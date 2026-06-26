<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Providerless Task-Tracker Fallback Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Author:** brainstorming session

## 1. Overview

Today the LLM orchestrator hard-stops when the task provider cannot be resolved.
`src/llm-orchestrator.ts:189-193` replies with `I need /config before I can do
that.` and never calls the model. That makes task-tracker outages look like a
global bot failure and blocks unrelated, non-task conversations.

This design changes unresolved task-provider turns from an early-return failure
into a providerless fallback mode:

- if the task provider resolves, current behavior stays unchanged;
- if the task provider does not resolve, the bot still runs the LLM;
- the fallback LLM turn uses only provider-independent tools and a dedicated
  providerless system prompt;
- when the user asks for task-tracker-backed help, the assistant explains that
  task tracker tools are unavailable because of configuration issues and points
  the user to `/config` or the bot admin.

The same change removes the regex-based tool router in
`src/tools/tool-router.ts`, which is currently only a heuristic tool-pruning
layer and is not trusted enough for vague real-world requests.

## 2. Goals / Non-goals

### Goals

- Gracefully degrade when the task tracker is not configured or cannot be
  resolved for the current context.
- Preserve normal non-task conversation instead of blocking the turn.
- Give clear user-facing guidance when task-tracker-backed capabilities are not
  available.
- Use only provider-independent tools in fallback mode.
- Remove `src/tools/tool-router.ts` and all runtime/tooling dependencies on it.

### Non-goals

- No attempt to diagnose the exact backend failure in chat (`context_settings`
  missing vs inactive task instance vs provider validation failure).
- No change to authorization behavior. Unauthorized users still fail earlier in
  `src/bot.ts` / `src/auth.ts`.
- No change to successful provider-backed turns.
- No new task-provider auto-recovery flow beyond the existing `/config` and
  admin-managed settings UI.

## 3. Current constraints

The current pipeline is provider-required end-to-end:

- `src/llm-orchestrator.ts` returns early when `deps.resolve(configId)` returns
  `null`.
- `src/llm-orchestrator-tools.ts` requires a `TaskProvider` to build tools.
- `src/system-prompt.ts` only exposes `buildSystemPrompt(provider, contextId, ...)`.
- `src/tools/tools-builder.ts` mixes provider-backed and provider-independent
  tools in one builder.

Separately, `src/tools/tool-router.ts` classifies text with regexes like
`MUTATION_RE`, `READ_RE`, `MEMO_RE`, and `DEFERRED_RE`, then hides tools based
on the guessed intent. This is deterministic but shallow, and ambiguous or
mixed prompts can easily bypass its assumptions.

## 4. Locked decisions

| #   | Decision                          | Choice                                                                                                                                     |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Fallback trigger                  | Any unresolved provider enters providerless mode; no pre-classification branch.                                                            |
| 2   | User experience                   | Non-task requests still run through the LLM normally.                                                                                      |
| 3   | Task-related requests in fallback | The model must explain that task tracker tools are unavailable due to configuration and suggest `/config` or asking the bot admin.         |
| 4   | Control surface                   | Use application logic to choose provider-backed vs providerless mode; use the prompt to govern fallback behavior inside providerless mode. |
| 5   | Tool router                       | Remove `src/tools/tool-router.ts` completely.                                                                                              |

## 5. Design summary

Add a second LLM invocation mode.

### Provider-backed mode

Unchanged current path:

1. Resolve provider.
2. Build normal system prompt.
3. Build full tool surface.
4. Invoke the model.

### Providerless mode

New fallback path:

1. Provider resolution returns `null`.
2. Build a providerless system prompt.
3. Build a provider-independent tool set.
4. Invoke the model with that reduced tool set.
5. Let the model explain task-tracker unavailability when the request depends on
   tracker-backed capabilities.

This removes the hardcoded user reply `I need /config before I can do that.` for
resolver failures and replaces it with a real LLM turn that can still help.

## 6. Component changes

### 6.1 `src/llm-orchestrator.ts`

Replace the early return at `src/llm-orchestrator.ts:189-193` with branching:

- provider exists: current flow unchanged;
- provider missing: call a new providerless preparation/invocation path.

`ensureRequiredConfig()` should remain a provider-backed concern only. In
providerless mode there is no provider config contract to validate up front; the
assistant explains the limitation instead.

### 6.2 `src/llm-orchestrator-tools.ts`

Split preparation into two entry points that share as much logic as possible:

- provider-backed preparation: current behavior without router-based pruning;
- providerless preparation: provider-independent tools, validated messages,
  enabled tool names.

Both paths should still:

- reuse history + memory assembly;
- reuse tool-result validation;
- return a consistent shape for model invocation.

Remove the `routeToolsForMessage()` dependency entirely.

### 6.3 `src/system-prompt.ts`

Add a providerless prompt builder instead of trying to synthesize a fake
`TaskProvider`.

The providerless prompt must explicitly state:

- task tracker tools are unavailable in this chat because task tracker
  configuration is missing or incomplete;
- the assistant must not pretend it can inspect, search, create, update, or
  comment on tracker data;
- when the user asks for tracker-backed help, the assistant should say those
  tools are unavailable and suggest checking `/config` or asking the bot admin;
- otherwise, the assistant should still help normally with the remaining tools
  and ordinary conversational assistance.

The existing provider-backed prompt stays unchanged.

### 6.4 `src/tools/`

Split tool assembly into provider-dependent and provider-independent layers.

Provider-independent tools should be constructible without a `TaskProvider`.
Expected providerless set:

- `get_current_time`
- memo tools except `promote_memo`
- recurring task tools
- instruction tools
- `lookup_group_history`
- `web_fetch`
- workspace/staged-file helpers that do not require a task provider, such as
  `list_files`, `delete_file`, `search_staged_files`, and `resolve_staged_file`
  when their existing environment prerequisites are met
- MCP/plugin tools only if they do not require a task-provider facade

Explicitly excluded from providerless mode:

- all task/project/status/comment/relation/label/worklog/sprint/query/collaboration
  tracker tools
- identity tools that require `provider.identityResolver`
- task-backed attachment operations such as tracker attachment list/upload/delete
- any plugin tool whose runtime contract requires a real task provider

The simplest code shape is:

- one helper that builds provider-independent tools;
- one helper that adds provider-dependent tools when a provider exists;
- normal mode combines both;
- providerless mode uses only the independent set.

### 6.5 Remove `src/tools/tool-router.ts`

Delete the router and its runtime dependencies.

Runtime call sites to clean up:

- `src/llm-orchestrator-tools.ts`
- `src/commands/context-tool-resolution.ts`
- `src/deferred-prompts/proactive-llm-full.ts`

Supporting cleanup:

- remove routing telemetry plumbing from `src/llm-orchestrator.ts`,
  `src/llm-orchestrator-types.ts`, `src/llm-orchestrator-invoke.ts`, and any
  debug/context surfaces that only display routed-tool counts or intent labels;
- remove `tests/tools/tool-router.test.ts`.

## 7. Data flow

### Normal provider-backed turn

1. Message arrives.
2. Resolve provider.
3. Build provider-backed prompt.
4. Build full tool surface.
5. Invoke model.
6. Reply as today.

### Providerless fallback turn

1. Message arrives.
2. Resolve provider and get `null`.
3. Build providerless prompt.
4. Build provider-independent tools.
5. Invoke model.
6. If the user asks for tracker-backed work, the assistant explains the
   configuration limitation and recovery path.
7. If the user asks for non-task help, the assistant continues normally.

## 8. Error handling

- Provider resolution failure remains non-fatal for the turn; it only selects
  providerless mode.
- If providerless tool assembly fails unexpectedly, fall back to a no-tool LLM
  turn rather than failing the request.
- If providerless prompt assembly fails unexpectedly, fall back to a minimal
  static providerless prompt string.
- Bot-wide LLM misconfiguration remains unchanged and still blocks the turn via
  the existing `replyBotMisconfigured()` flow.

## 9. Testing strategy

### Orchestrator behavior

Update `tests/llm-orchestrator.test.ts` to cover:

- provider resolves: current flow still works unchanged;
- provider returns `null`: the model is still invoked;
- unresolved-provider turns no longer emit `I need /config before I can do that.`;
- providerless task-related requests are handled through the fallback prompt path;
- providerless non-task requests still proceed normally.

### Tool assembly

Add focused tests for the providerless tool builder:

- expected provider-independent tools are present;
- tracker-backed tools are absent;
- mixed tools such as `promote_memo` are excluded unless explicitly refactored;
- permission filtering still applies correctly after tool assembly.

### Prompt coverage

Add tests for the providerless prompt builder asserting that it:

- states that task tracker tools are unavailable because of configuration;
- tells the assistant not to pretend it accessed tracker data;
- suggests `/config` or contacting the bot admin.

### Router removal

- delete `tests/tools/tool-router.test.ts`;
- update any tests or debug/context snapshots that asserted routing metadata.

## 10. Risks and mitigations

- **Hidden provider dependencies in "non-task" tools**: some tools that look
  generic may still depend on a real provider (`promote_memo` already does).
  Mitigation: review providerless candidates explicitly and exclude anything
  with a provider contract.
- **Prompt-only task detection in fallback mode**: the assistant decides when to
  explain tracker unavailability. Mitigation: make the providerless prompt blunt
  and specific about forbidden claims and required recovery guidance.
- **Telemetry/debug churn from router removal**: routing counters may disappear
  from context/debug surfaces. Mitigation: treat that as intentional cleanup,
  not a regression.
- **Tool-surface drift between modes**: future tool additions may accidentally be
  placed in the wrong layer. Mitigation: keep provider-independent assembly in a
  separate helper with direct tests.

## 11. Implementation outline

1. Introduce providerless prompt builder.
2. Split tool assembly into provider-independent and provider-dependent layers.
3. Change the orchestrator to invoke providerless mode when provider resolution
   returns `null`.
4. Remove router-based pruning and routing telemetry.
5. Update tests for providerless turns and delete router tests.

## 12. References

- Current early return: `src/llm-orchestrator.ts:189-193`
- Provider-required preparation: `src/llm-orchestrator-tools.ts:102-151`
- Current system prompt entrypoint: `src/system-prompt.ts:206-226`
- Current mixed tool builder: `src/tools/tools-builder.ts:237-285`
- Router to remove: `src/tools/tool-router.ts:1-130`
