<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0180: Providerless Task-Tracker Fallback

## Status

Implemented

## Date

2026-06-03

## Context

The LLM orchestrator hard-stopped when the task provider could not be resolved. `src/llm-orchestrator.ts` returned early with the hardcoded reply `I need /config before I can do that.` and never called the model, so a missing or incomplete task-tracker configuration made every conversation in the affected context look like a global bot failure — including non-task requests that needed no tracker at all. The provider contract was also required end-to-end: `prepareLlmInvocation` took a non-null `TaskProvider`, `buildSystemPrompt(provider, ...)` synthesized the system prompt from the provider, and `buildTools` mixed provider-backed and provider-independent tools in one builder, so there was no way to run a turn without a resolved provider.

Separately, `src/tools/tool-router.ts` classified the last user message with regexes (`MUTATION_RE`, `READ_RE`, `MEMO_RE`, `DEFERRED_RE`) and pruned the tool surface based on the guessed intent. The router was deterministic but shallow: ambiguous or mixed prompts easily bypassed its assumptions, and it was not trusted enough for vague real-world requests.

The 2026-06-03 design (`docs/superpowers/specs/2026-06-03-providerless-task-tracker-fallback-design.md`) specified turning the unresolved-provider early return into a providerless fallback mode that still runs the LLM with provider-independent tools and a dedicated prompt, and removing the regex router entirely so the reduced tool surface is deterministic and mode-based rather than heuristic. The implementation plan (`docs/superpowers/plans/2026-06-03-providerless-task-tracker-fallback.md`) is the source of truth for the task breakdown.

## Decision Drivers

- **Graceful degradation:** a task-tracker outage must not block unrelated conversation; the bot should still answer non-task requests with its remaining tools.
- **Honest user guidance:** when the user asks for task-tracker-backed help in fallback mode, the assistant must explain that those tools are unavailable and point to `/config` or the bot admin, never pretending it accessed tracker data.
- **Deterministic tool surface:** the fallback tool set must be a fixed, mode-derived subset, not the output of a fragile text classifier.
- **Minimal provider contract:** provider-independent tools and the system prompt must be constructible without synthesizing a fake `TaskProvider`.
- **Preserve provider-backed behavior:** the existing resolved-provider turn must stay byte-for-byte unchanged; only the `null` path changes.
- **Remove dead complexity:** the regex router and its routing telemetry were low-value and high-maintenance; deletion reduces the surface that must stay consistent with the tool catalog.

## Considered Options

### Option A: Providerless fallback mode (chosen)

Add a second invocation mode selected by `provider === null`: a providerless system prompt and a provider-independent tool set, with the model left to explain tracker unavailability. Remove the regex router outright.

- **Pros:** non-task conversation continues uninterrupted; the tool surface is a fixed mode-derived set, not a heuristic guess; no fake provider is synthesized; router deletion removes fragile complexity.
- **Cons:** the model decides when to explain the limitation (prompt-governed, not hard-coded), so the providerless prompt must be blunt and specific about forbidden claims; provider-independent tool assembly must be kept in a separate, tested helper to prevent future drift between modes.

### Option B: Keep the early return, improve the message

Replace `I need /config before I can do that.` with a richer static diagnostic, but still do not call the model when the provider is unresolved.

- **Pros:** smallest change; no new tool/prompt split; no risk of the model hallucinating tracker access.
- **Cons:** still blocks all conversation, not just task work; does not satisfy the degradation goal; leaves the regex router in place.

### Option C: Synthesize a stub provider

Build a no-op `TaskProvider` whose tracker tools throw "unavailable" at call time, so the existing single-mode pipeline runs unchanged.

- **Pros:** no new prompt path; existing `buildSystemPrompt` / `buildTools` reused.
- **Cons:** violates the spec's "do not synthesize a fake provider" guidance; every tracker tool would need a stub; larger, leakier surface than a dedicated providerless path; the system prompt would still describe full tracker capabilities.

## Decision

Four coordinated changes implement the architecture:

### 1. Providerless system prompt path (`src/system-prompt.ts`)

`buildProviderlessSystemPrompt(contextId, enabledToolNames?, options)` produces a prompt whose intro explicitly states that task tracker tools are unavailable because configuration is missing or incomplete, forbids pretending to inspect, search, create, update, or comment on tracker data, and directs the assistant to suggest `/config` or the bot admin. It reuses a shared `assembleBasePrompt` helper for fragment inclusion, output rules, and the permission-aware unavailable/ask lines, then appends the active plugin prompt section. The provider-backed `buildSystemPrompt` is unchanged.

### 2. Split provider-independent tool assembly (`src/tools/tools-builder.ts`, `src/tools/index.ts`)

`buildProviderlessTools(chatUserId, contextId, mode, contextType, ...)` builds the provider-independent set: `get_current_time`, memo tools except `promote_memo` (`save_memo`/`search_memos`/`list_memos`/`archive_memos`), recurring-task tools, instruction tools, `lookup_group_history`, `web_fetch`, and the S3-gated staged-file helpers (`list_files`/`delete_file`/`search_staged_files`/`resolve_staged_file`). It excludes all tracker-backed tools, identity tools needing `provider.identityResolver`, and task-backed attachment operations. `buildProviderlessToolDescriptors` wraps that set and still merges user MCP and plugin MCP tools via `buildMcpToolSet`/`buildPluginMcpToolSet`, so plugin-sourced tools remain available in fallback mode when they do not require a task-provider facade.

### 3. Orchestrator fallback (`src/llm-orchestrator.ts`, `src/llm-orchestrator-tools.ts`, `src/llm-orchestrator-invoke.ts`)

`InvokeModelArgs.provider` widens to `TaskProvider | null`. `callLlm` resolves the provider; when `null` it logs `Task provider unavailable for LLM turn; using providerless fallback` and skips `ensureRequiredConfig` (which becomes a provider-backed-only concern, called inside the `else` branch). `prepareLlmInvocation` selects `buildProviderlessToolDescriptors` when `provider === null` and caches under a `'providerless'` provider-cache scope (vs `'provider-backed'`), so descriptor caches do not collide across modes. `invokeModel` picks `buildProviderlessSystemPrompt` vs `buildSystemPrompt` on the same `provider === null` branch. The hardcoded `I need /config before I can do that.` early return is removed.

### 4. Remove the regex tool router

`src/tools/tool-router.ts` and `tests/tools/tool-router.test.ts` are deleted. Routing telemetry is removed from `src/commands/context-tool-resolution.ts`, `src/commands/context.ts`, `src/commands/context-collector.ts`, and `src/deferred-prompts/proactive-llm-full.ts`; `resolveContextToolSurface` keeps a `_lastUserText` parameter for signature compatibility but no longer prunes by it. `scripts/tool-surface-benchmark-scenarios.ts` collapses `direct_routed` onto the full direct surface.

## Consequences

### Positive

- A missing or unresolvable task tracker no longer blocks conversation; the bot answers non-task requests with `web_fetch`, memos, recurring tasks, instructions, and staged-file tools.
- Task-tracker-backed requests in fallback mode get honest, consistent guidance (`/config` or bot admin) instead of a one-line early return, and the prompt forbids pretending to access tracker data.
- The tool surface in fallback mode is a fixed, mode-derived set, eliminating the regex router's shallow guesswork and its mixed-prompt failure modes.
- Descriptor caches are keyed by provider-cache scope, so providerless and provider-backed descriptors never poison each other.
- Plugin MCP tools remain available in fallback mode when provider-independent, preserving user-configured integrations through outages.

### Negative

- **Providerless mode spread beyond the plan's File Map.** Widening `provider` to `TaskProvider | null` rippled through every consumer: the proactive deferred-prompt path (`src/deferred-prompts/proactive-llm-helpers.ts`, `proactive-llm-full.ts`), the deferred-prompt poller (`src/deferred-prompts/poller.ts`), the scheduler (`src/scheduler.ts`), the `/context` command prompt preview (`src/commands/context.ts`), context tool-surface resolution (`src/commands/context-tool-resolution.ts`), and plugin contributions (`src/plugins/contributions.ts`) all gained `provider === null` branches. This is broader than the plan enumerated but is the natural consequence of the type change and keeps all modes consistent.
- **Prompt-governed task detection.** The model decides when to explain tracker unavailability rather than a hard-coded branch, so the providerless prompt is the single guard against hallucinated tracker access. Mitigated by a blunt, specific prompt with explicit forbidden-claims language.
- **Router removal drops routing telemetry.** Context/debug surfaces that displayed routed-tool counts or intent labels lose them. Treated as intentional cleanup, not a regression.

### Risks

- **Tool-surface drift between modes.** Future tool additions may land in the wrong layer (provider-independent vs provider-dependent). Mitigated by keeping `buildProviderlessTools` in a separate, directly-tested helper.
- **Hidden provider dependencies in "generic" tools.** A tool that looks provider-independent may still need a provider facade (`promote_memo` already did). Mitigated by an explicit providerless allowlist and exclusion of identity/tracker-attachment tools.
- **Providerless tool-assembly failure.** If assembly throws unexpectedly, the turn falls back to a no-tool LLM invocation rather than failing the request; if prompt assembly fails, a minimal static providerless string is used. Bot-wide LLM misconfiguration still blocks via the existing `replyBotMisconfigured()` flow.

## Related Decisions

- ADR-0129: Multi-Provider Router — the `TaskProviderResolver` whose `null` return now selects providerless mode instead of aborting the turn.
- ADR-0125: Multi-Provider Phase 2 Task Provider Resolver — established the resolver contract this fallback consumes.
- ADR-0133: Task Provider as Plugin Phases 3 to 5 — the plugin contribution path whose `provider === null` branch keeps provider-independent plugin tools available in fallback mode.
- ADR-0141: User-Configurable Tool Access — `tool_prefs` permission filtering (`applyToolPreferences`) still applies to the providerless descriptor set.
- ADR-0116: Deferred Prompt Delivery Redesign — the proactive/deferred path that also gained providerless fallback.

## Implementation Notes

Key files confirming presence:

- `src/system-prompt.ts:282` — `buildProviderlessSystemPrompt` (+ shared `assembleBasePrompt`).
- `src/tools/tools-builder.ts:247` — `buildProviderlessTools` (provider-independent set).
- `src/tools/index.ts:214` — `buildProviderlessToolDescriptors` (wraps `buildProviderlessTools`, merges MCP/plugin tools).
- `src/llm-orchestrator.ts:157` — `provider === null` branch logging the fallback and skipping `ensureRequiredConfig`.
- `src/llm-orchestrator-tools.ts:84` — descriptor selection on `provider === null` with `'providerless'` cache scope.
- `src/llm-orchestrator-invoke.ts:192` — `buildProviderlessSystemPrompt` vs `buildSystemPrompt` selection.
- `src/tools/tool-router.ts` — deleted (glob confirms absence); `tests/tools/tool-router.test.ts` deleted.

Divergence from the plan: the `TaskProvider | null` widening propagated to more call sites than the plan's File Map listed (`proactive-llm-helpers.ts`, `poller.ts`, `scheduler.ts`, `commands/context.ts`, `plugins/contributions.ts`), all adding `provider === null` branches for consistency. Additionally, `buildLlmInvocationOpts` now carries a `chatParticipantResolver` (added later by the chat-participant-resolution feature), which is outside this plan's scope. The spec's locked decisions (fallback trigger, user experience, task-request handling, control surface, router removal) are all satisfied.
