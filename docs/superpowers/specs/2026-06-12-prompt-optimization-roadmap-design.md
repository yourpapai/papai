<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prompt Optimization Roadmap Design

**Date:** 2026-06-12
**Status:** Draft for user review
**Source research:** `docs/research/prompt-optimization/`

## 1. Purpose

This document is the source-of-truth roadmap for applying prompt optimization to papai in incremental phases. It is not an implementation plan and does not replace the detailed phase specs that will follow. Its job is to define the sequence, dependencies, ownership boundaries, rollout rules, and acceptance gates that every follow-up prompt-optimization spec must respect.

The roadmap uses the refreshed prompt-optimization research as its evidence base, especially:

- `docs/research/prompt-optimization/00-overview.md`
- `docs/research/prompt-optimization/11-refresh-and-planning-brief.md`
- `docs/research/prompt-optimization/02-system-prompt-flaws.md`
- `docs/research/prompt-optimization/04-tool-output-steering.md`
- `docs/research/prompt-optimization/05-error-handling-recovery.md`
- `docs/research/prompt-optimization/06-confirmation-safety.md`
- `docs/research/prompt-optimization/09-orchestration-routing.md`

The roadmap also treats the merged tool-context reduction work as an existing feature-flagged capability to validate and graduate, not as new architecture to redesign.

## 2. Goals

- Improve user-visible reliability: fewer wrong tool calls, better clarification behavior, safer confirmations, and stronger recovery after tool failures.
- Improve trust boundaries: explicit handling for user content, external content, task-provider content, memory, and prompt-injection-like text.
- Improve cost and context efficiency after reliability and safety contracts are measurable.
- Keep all user-visible runtime behavior changes feature-flagged until fixtures, dogfooding, and rollback criteria are satisfied.
- Make each phase independently understandable, testable, reversible, and suitable for a follow-up implementation spec.

## 3. Non-Goals

- Do not implement prompt changes directly from this roadmap.
- Do not replace task-provider, chat-provider, plugin, MCP, or settings architecture.
- Do not expose model chain-of-thought in user replies, tool outputs, logs, or debug surfaces.
- Do not introduce multi-agent runtime flows for normal chat before baseline evals show they are needed.
- Do not run automatic prompt optimization before a representative fixture dataset exists.
- Do not treat prompt rules as the only prompt-injection defense; pair them with validation, least privilege, confirmations, and observability.

## 4. Current State

The refreshed research found that papai already has several partial improvements:

- `src/system-prompt.ts` gates prompt fragments by available tools and surfaces ask/denied tool preferences.
- Current time is supplied through a `<current_time>` line and trusted as system-provided context.
- Compact memory renders as `<memory trust="compacted_low">`.
- Long-term memory renders as `<long_term_memory trust="profile_and_retrieved_low">`.
- The main LLM loop uses `generateText` with `stopWhen: stepCountIs(25)`.
- Telegram and Discord apply LLM-output formatting, and typing heartbeat is implemented.
- Tool-context reduction is merged behind feature flags, including progressive disclosure, result compaction, semantic tool retrieval, and `prepareStep`/`activeTools` integration.

The main remaining gaps are:

- No dedicated prompt/tool regression harness.
- Prompt sections are still prose-heavy and not contract-shaped.
- Active capabilities are partially surfaced but not rendered as a compact `<capabilities>` contract.
- Tool outputs and failures do not consistently provide model-facing `summary`, `next_actions`, `recovery`, or `user_action` fields.
- Destructive confirmation still exposes implementation thresholds and has weak declined/expired recovery.
- Prompt-injection boundaries are not consistently expressed across web fetch, attachments, task-provider data, memory, and custom instructions.
- Tool-context reduction flags need validation against realistic prompt/tool fixtures before broader enablement.
- Orchestration experiments need to wait until baseline behavior is measurable.

## 5. Chosen Approach

Use an **Eval-Gated Balanced Roadmap**.

Phase 0 establishes fixtures and observability before changing behavior. Every later user-visible phase ships behind feature flags and must add or update fixtures before behavior changes. The sequence then improves reliability, safety, and cost/context efficiency in order:

1. Evaluation and observability baseline.
2. Prompt surface refactor.
3. Tool result and failure contracts.
4. Safety and trust boundaries.
5. Tool-context reduction validation and graduation.
6. Orchestration and prompt optimization experiments.

Rejected alternatives:

- **Prompt-first roadmap:** faster visible prompt cleanup, but risks locking in wording before the evaluation model is strong enough.
- **Safety-first roadmap:** defensible if prompt injection is the only priority, but delays general reliability and may duplicate work when the prompt is later restructured.

## 6. Architecture Ownership Boundaries

### Prompt Assembly

Owner: `src/system-prompt.ts`

Responsibilities:

- Durable prompt sections.
- Fragment gating.
- Tool preference text.
- Capabilities text.
- Reply-style rules.
- Few-shot examples.

Refactoring should split internals into testable builders only when needed. Public callers should remain stable during the first prompt refactor.

### Context Assembly

Owners:

- `src/conversation.ts`
- `src/memory-context-block.ts`
- long-term memory context builders

Responsibilities:

- Runtime context block construction.
- Trust labels close to the data being injected.
- Memory and context size limits.
- Context-block escaping.

The system prompt defines how to use these blocks; the context builders own the data shape and labels.

### Tool Contracts

Owners:

- `src/tools/**`
- `src/tool-failure.ts`
- `src/error-analysis.ts`
- confirmation and permission gates

Responsibilities:

- Model-facing success and failure envelopes.
- Recovery and user-action hints.
- Confirmation-required shapes.
- Permission-denied shapes.
- Display hints and next-action suggestions.

New envelopes should be introduced through shared helpers rather than ad hoc per-tool JSON.

### Orchestration

Owner: `src/llm-orchestrator-invoke.ts`

Responsibilities:

- `generateText` invocation.
- `stopWhen`.
- tool callbacks.
- future route-specific `prepareStep` behavior outside the existing tool-context reduction feature.
- model/reasoning-effort routing if later phases prove it useful.

Prompt builders must not take ownership of orchestration decisions.

### Tool-Context Reduction

Owners: existing disclosure, compaction, retrieval, and flag modules.

Responsibilities:

- progressive disclosure.
- result compaction.
- semantic tool retrieval.
- `search_tools`, `load_tool`, and `expand_result`.
- `prepareStep`/`activeTools` behavior for disclosure.

This roadmap validates, observes, and graduates the feature flags. It does not redesign the already-merged architecture.

### Evaluation Harness

Owner: new dedicated test/support area to be defined by the Prompt Regression Harness Spec.

Responsibilities:

- fixture definitions.
- prompt snapshots.
- active-tool snapshots.
- tool trace assertions.
- final reply shape assertions.
- safety and adversarial cases.

The harness must be separate from runtime code and cheap enough to run in targeted checks.

## 7. Rollout Rules

Every user-visible runtime behavior change must ship behind a feature flag. The flag may be global, per-context, or both, matching existing settings/config patterns.

Examples of user-visible behavior:

- prompt wording that can change model decisions.
- new or changed tool result envelopes.
- confirmation wording or confidence behavior.
- untrusted-content boundaries that alter model input.
- active-tool narrowing.
- result compaction.
- model routing.
- reply shape changes.

The following do not require flags:

- documentation changes.
- tests and fixtures.
- pure refactors with compatibility snapshots proving behavior is unchanged.
- observability additions that do not log raw user content or secrets.

Each phase must document:

- flag name or existing flag reused.
- default state.
- global kill switch if applicable.
- per-context enablement path if applicable.
- rollback steps.
- telemetry confirming rollback.

## 8. Common Acceptance Gates

Every phase must pass these gates before broad enablement.

### Fixture Gate

The phase adds or updates fixtures covering:

- intended behavior.
- regression risks.
- at least one negative or adversarial case where relevant.

### Compatibility Gate

Flag-off behavior remains unchanged for:

- prompt text where applicable.
- active tool set.
- tool result shape.
- confirmation/permission flow.
- reply formatting.

### Dogfood Gate

The phase starts in a test context or admin-owned context with trace review before wider enablement.

### Rollback Gate

The phase documents:

- which flag disables the behavior.
- what runtime state must be cleared, if any.
- what telemetry confirms rollback.

## 9. Observability Requirements

The roadmap requires traces or structured logs for the following, without logging raw user content, secrets, API keys, tokens, or session cookies:

- prompt version or prompt section version.
- enabled prompt/tool/orchestration flags.
- active tool count and active tool names where already allowed by existing debug surfaces.
- tool result envelope type.
- tool failure code and recovery action.
- confirmation-required, confirmed, declined, and expired outcomes.
- ask-permission allow/deny outcomes.
- step count.
- disclosure search/load/fallback events.
- result compaction applied/expanded/expired events.
- final reply classification where available.

## 10. Phase Briefs

### Phase 0: Evaluation And Observability Baseline

Objective: create the measurement baseline that all later phases depend on.

Prerequisites:

- refreshed prompt-optimization research is available.
- current tool-context reduction flags remain default-off unless already configured.

Primary work:

- Define fixture format for prompt/tool scenarios.
- Capture system prompt snapshots for representative contexts.
- Capture active tool names and relevant prompt flags.
- Stub or script tool traces without calling real providers.
- Add assertions for final reply shape, required tool calls, forbidden tool calls, confirmation behavior, and recovery behavior.
- Add adversarial fixtures for web fetch, attachment text, task descriptions, memory, and custom instructions.

Minimum fixture set:

- DM create task with enough detail.
- DM create task with ambiguity that should ask a clarifying question.
- Group mention with group history available.
- Group reply to bot message path.
- Tool denied by preferences.
- Ask-gated tool requiring permission reason.
- Missing task provider.
- Empty search result.
- Ambiguous task match.
- Destructive action confirmation required.
- Confirmation declined.
- Stale memory conflict with current user instruction.
- Web fetch result containing instruction-injection text.
- Attachment text containing instruction-injection text.
- Provider error with retryable vs non-retryable recovery.

Feature flags:

- No user-visible flags required for the harness itself.
- Observability additions must avoid raw content and secrets.

Acceptance:

- Harness can run targeted checks locally.
- Baseline fixtures pass against current behavior or explicitly record known failures.
- Later phase specs can add fixtures without redefining the harness.

Non-goals:

- No prompt rewrite.
- No live model eval service.
- No automatic prompt optimization.

### Phase 1: Prompt Surface Refactor

Objective: make prompt behavior readable, sectioned, capability-aware, and snapshot-testable.

Prerequisites:

- Phase 0 harness exists.
- Current prompt snapshots are captured.

Primary work:

- Refactor prompt rendering into explicit internal section builders.
- Preserve current behavior first, proven by compatibility snapshots.
- Add XML-like sections such as `<role>`, `<current_time>`, `<capabilities>`, `<context_rules>`, `<memory_rules>`, `<safety>`, `<reply_style>`, and `<examples>`.
- Render a compact `<capabilities>` block from the actual enabled tools, provider state, and denied/ask-gated preferences.
- Add untrusted-content instructions at the prompt level.
- Add compact few-shots for high-risk workflows: ambiguity, confirmation decline, missing tools, providerless mode, stale memory, and group context.

Feature flags:

- sectioned prompt flag.
- capabilities block flag.
- examples flag.
- untrusted-content prompt rules flag.

Acceptance:

- Flag-off prompt snapshots match current behavior.
- Flag-on prompt snapshots are deterministic.
- Active capabilities do not mention absent tool domains as available.
- Few-shot examples are covered by fixtures and can be disabled independently.

Non-goals:

- No tool envelope migration.
- No `prepareStep` changes outside already-merged tool-context reduction.
- No model routing.

### Phase 2: Tool Result And Failure Contracts

Objective: make tool outputs and failures easier for the model to use safely and predictably.

Prerequisites:

- Phase 0 harness exists.
- Phase 1 prompt sections are at least internally testable, even if not broadly enabled.

Primary work:

- Define shared success envelope fields: `status`, `summary`, `data`, `display`, and `next_actions`.
- Define shared non-success envelope fields: `status`, `message`, `code`, `retryable`, `recovery`, and `user_action`.
- Migrate high-value tools first: task search/list/get/create/update, confirmation-gated destructive tools, web fetch, memory/memo tools, and provider failure paths.
- Add recovery variants such as `ask_user`, `retry_later`, `call_tool`, `check_config`, `permission_required`, and `abort`.
- Add display hints and suggested replies where they reduce model guesswork.
- Keep raw provider data available in `data` only where needed and bounded.

Feature flags:

- standard tool success envelopes.
- standard tool failure envelopes.
- confirmation envelope migration.
- display/next-action hints.

Acceptance:

- Flag-off tool shapes remain unchanged.
- Flag-on fixtures show improved clarification/recovery behavior.
- Tool failures never trigger unsafe follow-up calls when `recovery.action` requires asking the user or aborting.
- Envelopes are consistent enough for the system prompt to describe once.

Non-goals:

- No provider interface redesign.
- No UI redesign for displaying tool data.
- No requirement to migrate every low-use tool in the first phase spec.

### Phase 3: Safety And Trust Boundaries

Objective: reduce prompt-injection and accidental-action risk across all untrusted content channels.

Prerequisites:

- Phase 0 adversarial fixtures exist.
- Tool failure/confirmation contracts are defined or scheduled.

Primary work:

- Define trusted vs untrusted content taxonomy:
  - system prompt and application-generated boundaries.
  - current user request.
  - custom instructions.
  - web fetch output.
  - attachment text.
  - task titles/descriptions/comments.
  - memory summaries and long-term memory records.
  - plugin/MCP tool output.
- Add explicit data-not-instructions rules to prompt sections.
- Keep trust labels close to context builders and tool result builders.
- Harden destructive confirmation wording.
- Remove implementation threshold values from model-facing descriptions.
- Ensure confirmation declined/expired states produce safe recovery instructions.
- Add adversarial fixtures for each external-content channel.

Feature flags:

- untrusted content wrappers or trust-boundary rendering.
- hardened confirmation wording.
- confirmation recovery envelope.
- security trace classification.

Acceptance:

- Existing legitimate user requests still work under the new boundaries.
- Adversarial fixtures cannot cause denied/destructive tool calls or prompt leakage.
- Rollback returns to current prompt/context rendering.
- No raw sensitive content is added to logs.

Non-goals:

- No regex-based user-message blocking.
- No external security product integration.
- No guarantee that prompt rules alone prevent all injection; this phase is one layer.

### Phase 4: Tool-Context Reduction Validation And Graduation

Objective: validate and graduate the already-merged tool-context reduction capabilities using the prompt regression harness.

Prerequisites:

- Phase 0 harness exists.
- Tool-context reduction flags remain controllable.
- Prompt compatibility with disclosure meta-tools is covered by fixtures.

Primary work:

- Add fixtures for result compaction, `expand_result`, progressive disclosure, semantic retrieval, and fallback behavior.
- Verify denied tools are never searchable or loadable.
- Verify ask-gated tools still require permission after `load_tool`.
- Verify disclosure fallback completes tasks when the model fails to load tools.
- Measure active schema count, step count, fallback rate, compaction rate, and final task success.
- Define default-on or wider enablement thresholds.

Existing feature flags:

- progressive disclosure.
- result compaction.
- semantic tool retrieval.

Acceptance:

- Flag-off behavior remains byte-compatible with current non-disclosure behavior.
- Flag-on dogfood contexts show acceptable task success and lower context/tool-definition pressure.
- Fallback and rollback are documented and observed.
- No prompt or tool contract phase depends on disclosure being enabled by default.

Non-goals:

- No redesign of disclosure/compaction/retrieval architecture.
- No persistence of disclosure sessions across turns unless a later dedicated spec approves it.
- No default-on rollout without dogfood metrics.

### Phase 5: Orchestration And Prompt Optimization Experiments

Objective: test higher-order optimization techniques after prompt and tool contracts are measurable.

Prerequisites:

- Phase 0 harness exists.
- Phases 1-3 have stable flag-on variants, or explicit baselines for comparison.
- Tool-context reduction behavior is validated or intentionally disabled for the experiment.

Primary work:

- Evaluate route-specific step limits.
- Evaluate `prepareStep` outside disclosure, such as forcing text replies after `recovery.action = ask_user`.
- Evaluate model or reasoning-effort routing for complex planning turns.
- Evaluate offline prompt variants using fixture datasets.
- Consider APE/APO/OPRO/DSPy-style optimization only after fixtures are representative.

Feature flags:

- route-specific step limits.
- recovery-aware `prepareStep`.
- model/reasoning-effort routing.
- prompt variant selection.

Acceptance:

- Experiments compare against baseline fixtures.
- Runtime changes are reversible per flag.
- Cost/latency improvements do not reduce safety or reliability fixtures.
- Failed experiments are documented as rejected alternatives.

Non-goals:

- No multi-agent runtime for normal chat.
- No automatic prompt mutation in production.
- No chain-of-thought exposure.

## 11. Follow-Up Specs

This roadmap decomposes into these follow-up specs. The first required follow-up is the Prompt Regression Harness Spec.

### 1. Prompt Regression Harness Spec

Owns:

- fixture format.
- trace capture.
- prompt snapshots.
- model/tool stubs.
- expected assertions.
- local and CI execution strategy.

### 2. Structured Prompt Surface Spec

Owns:

- XML-like section rendering.
- `<capabilities>`.
- untrusted-content instructions.
- prompt versioning.
- few-shot selection.
- compatibility snapshots.

### 3. Tool Result Contract Spec

Owns:

- success envelopes.
- failure envelopes.
- recovery fields.
- display hints.
- next actions.
- confirmation envelopes.
- migration order across high-value tools.

### 4. Safety Boundary Spec

Owns:

- prompt-injection boundaries for external/user/tool/memory content.
- destructive-action hardening.
- adversarial fixtures.
- security observability.

### 5. Tool-Context Reduction Graduation Spec

Owns:

- validating already-merged feature flags.
- fixture coverage.
- dogfood rollout thresholds.
- criteria for wider enablement.

### 6. Orchestration Experiments Spec

Owns:

- route-specific step limits.
- `prepareStep` experiments outside disclosure.
- model/reasoning-effort routing.
- offline prompt optimization workflows.

Follow-up specs may split further if they touch too many files or mix unrelated behavior changes.

## 12. Source Of Truth Rules For Future Specs

Future phase specs must:

- name which roadmap phase they implement.
- list the research files and references they depend on.
- identify the owning seam: prompt, context, tools, orchestration, tool-context reduction, or eval harness.
- define feature flags for all user-visible behavior.
- add or update fixtures before behavior changes.
- define flag-off compatibility assertions.
- define dogfood and rollback criteria.
- explicitly state non-goals.

Future phase specs must not:

- bypass the eval harness once Phase 0 exists.
- mix unrelated phases without naming the dependency.
- redesign already-merged tool-context reduction unless a dedicated replacement spec is approved.
- remove feature flags from user-visible behavior before broad enablement criteria are met.

## 13. Initial Implementation Order

1. Write the Prompt Regression Harness Spec.
2. Implement the harness with current-behavior baselines.
3. Write the Structured Prompt Surface Spec.
4. Implement prompt refactor behind flags.
5. Write the Tool Result Contract Spec.
6. Implement high-value envelopes behind flags.
7. Write the Safety Boundary Spec.
8. Implement trust-boundary hardening behind flags.
9. Write the Tool-Context Reduction Graduation Spec.
10. Validate and graduate existing flags where metrics justify it.
11. Write the Orchestration Experiments Spec.
12. Run bounded experiments against the fixture set.

## 14. Open Decisions For Follow-Up Specs

These are intentionally deferred from the umbrella roadmap:

- Exact fixture file format.
- Exact prompt section names and prompt versioning scheme.
- Exact feature flag storage keys.
- Exact envelope TypeScript types.
- Which tool family migrates first after the high-value set is confirmed.
- Dogfood thresholds for disclosure fallback, compaction rate, and active-tool reduction.
- Whether model/reasoning-effort routing is worth runtime complexity.
