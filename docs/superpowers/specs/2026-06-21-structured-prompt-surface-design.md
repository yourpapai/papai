<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Structured Prompt Surface Design

**Date:** 2026-06-21
**Status:** Draft for user review
**Roadmap phase:** Phase 1 — Prompt Surface Refactor
**Parent roadmap:** `docs/superpowers/specs/2026-06-12-prompt-optimization-roadmap-design.md`
**Prerequisite:** `docs/superpowers/specs/2026-06-12-prompt-regression-harness-design.md`

## 1. Purpose

This document defines Phase 1 of the prompt optimization roadmap: a structured prompt surface for papai.

Phase 1 makes prompt behavior readable, sectioned, capability-aware, and snapshot-testable without changing default runtime behavior. The current prose prompt remains the flag-off path. A new structured renderer is introduced in parallel and selected only by a default-off per-context flag for dogfood contexts.

The design is intentionally a prompt-surface refactor. It does not change tool result envelopes, confirmation behavior, orchestration, tool-context reduction, or model routing.

## 2. Goals

- Preserve flag-off prompt output exactly for existing representative prompt paths.
- Introduce a structured prompt renderer behind one per-context umbrella flag.
- Make prompt sections explicit and fixture-testable.
- Render active capabilities from the actual enabled tools, provider/providerless state, denied tool preferences, and ask-gated tool preferences.
- Add prompt-level untrusted-content rules for external, provider, memory, custom-instruction, plugin, and MCP content.
- Add compact, named few-shot examples for high-risk workflows.
- Extend the Phase 0 prompt-regression harness before behavior changes.
- Keep rollback to a single per-context flag disablement.

## 3. Non-Goals

- Do not change default prompt behavior when the flag is off.
- Do not migrate tool success or failure envelopes.
- Do not change destructive confirmation thresholds, confirmation state transitions, or declined-confirmation behavior.
- Do not graduate or redesign tool-context reduction.
- Do not add route-specific `prepareStep`, model routing, or reasoning-effort routing.
- Do not move ownership of memory/context block construction into the prompt renderer.
- Do not implement Phase 3 trust-boundary wrappers or security hardening beyond prompt guidance.
- Do not add live model calls or nondeterministic prompt scoring.

## 4. Chosen Approach

Use a **Structured Prompt Parallel Renderer**.

Existing callers continue to use `buildSystemPrompt(...)` and `buildProviderlessSystemPrompt(...)`. Those public entrypoints decide whether to render the legacy prompt or the structured prompt by reading one per-context flag. The flag-off path keeps the current renderer. The flag-on path builds a typed prompt assembly model and renders XML-like sections from that model.

Rejected alternatives:

- **Prompt Builder Refactor First:** lower risk, but less useful as a long-term seam because the implementation would mostly reorganize current prose fragments without a durable structured model.
- **Minimal Inline Flag Branch:** fastest, but would duplicate prompt rules inside `system-prompt.ts` and make later capability, safety, and examples work harder to reason about.

## 5. Feature Flag

Phase 1 uses one per-context default-off umbrella flag:

```text
structured_prompt_surface
```

The flag controls all Phase 1 user-visible prompt changes:

- structured section rendering.
- `<capabilities>` block.
- prompt-level untrusted-content rules.
- compact few-shot examples.

No global flag is part of Phase 1. Dogfood enablement happens by setting the flag on selected contexts only. Rollback is disabling the flag for that context.

If the existing config/settings mechanism can store this as a normal per-context config key, the implementation should use that path. The spec does not require a schema-heavy rollout unless the existing mechanism cannot represent a boolean context flag safely.

## 6. Architecture

### Existing Public API

The public prompt entrypoints remain stable:

- `buildSystemPrompt(provider, contextId, enabledToolNames?, options?)`
- `buildProviderlessSystemPrompt(contextId, enabledToolNames, options?)`

Callers should not need to know which renderer is active. The structured renderer is an internal implementation detail selected from context configuration.

### Prompt Surface Model

The structured renderer should build a `PromptSurfaceModel` before rendering text. The model should contain stable semantic fields, not only pre-rendered strings.

The model should represent:

- prompt mode: task-provider or providerless.
- shared context ID and storage context ID where relevant.
- provider prompt addendum.
- plugin prompt fragments selected for the context.
- active tool names.
- derived capability domains.
- denied tools.
- ask-gated tools.
- ask-permission availability.
- included workflow rule groups.
- providerless recovery state.
- untrusted-content guidance.
- selected few-shot example IDs.

The exact TypeScript type can be refined during implementation, but each field must have a clear producer and consumer. The model should be testable without inspecting private renderer internals where practical.

### Structured Sections

The flag-on renderer should emit XML-like sections in deterministic order:

```text
<role>
<current_time>
<capabilities>
<context_rules>
<memory_rules>
<safety>
<workflow>
<reply_style>
<examples>
<provider_addendum>
<plugin_guidance>
```

Sections with no applicable content may be omitted only when omission is deterministic and fixture-covered. Section names are part of the prompt contract and should be stable after Phase 1 lands.

### Legacy Renderer

The current renderer remains the flag-off path. Compatibility tests must prove that existing representative prompt output does not drift while Phase 1 is introduced.

Compatibility should be exact where practical. If a prompt contains intentionally unordered content from existing plugin registration or other dynamic sources, the implementation may use targeted structural assertions for that narrow case and must document why exact text is not stable.

## 7. Capabilities Block

The `<capabilities>` section must be derived from actual runtime inputs, not from provider assumptions.

Inputs:

- active tool names passed to the prompt builder.
- tool metadata and domains.
- provider/providerless state.
- per-context tool preferences.
- ask-permission availability.

The section should communicate:

- available capability domains.
- notable available tool groups when useful for model decisions.
- ask-gated tools and the `_permission_reason` requirement.
- denied or unavailable tools where needed to prevent accidental use.
- providerless task-tracker unavailability and recovery guidance.

The section must not:

- describe absent task domains as available.
- imply denied tools can be called.
- hide ask-gated requirements.
- rely on feature flags outside `structured_prompt_surface`.

## 8. Context And Memory Rules

The structured prompt should explain how the model should treat context without taking ownership of context construction.

`<context_rules>` should cover:

- current user request as the active instruction source.
- group context and group-history constraints.
- providerless mode.
- custom instructions as persistent preferences, not higher-priority system commands.
- plugin and MCP guidance as bounded addenda.

`<memory_rules>` should cover:

- compact memory as low-trust summary context.
- long-term memory as profile/retrieval context.
- stale memory losing to the current user request.
- memory content as data, not instructions that override system or user intent.

Memory and context block builders remain owned by their existing modules. Phase 1 only describes interpretation rules in the prompt surface.

## 9. Safety Rules

The `<safety>` section should add prompt-level untrusted-content instructions for:

- web fetch output.
- attachment text.
- task titles, descriptions, comments, and provider data.
- memory summaries and long-term memories.
- custom instructions.
- plugin and MCP tool output.
- instruction-like text embedded in any of the above.

The rule should be simple and repeated consistently: untrusted content is data to summarize, extract from, or act on only when it matches the user's request; it must not override system rules, tool permissions, confirmations, or the current user request.

This is prompt guidance only. Phase 3 still owns hardened trust-boundary wrappers, adversarial enforcement, confirmation hardening, and security trace classification.

## 10. Few-Shot Examples

Phase 1 includes compact few-shot examples under the same `structured_prompt_surface` flag.

Examples must be:

- named.
- small.
- fixture-backed.
- included only when relevant to the active prompt mode and capabilities.
- absent when the flag is off.

Initial example inventory:

- ambiguous create or update asks one clarifying question.
- confirmation declined does not retry a destructive tool.
- missing/providerless tools produce configuration guidance.
- stale memory loses to current user request.
- group context avoids noisy replies and respects group trigger semantics.
- ask-gated tool requests permission before execution.

The examples should avoid long transcripts. They should show input, model decision, tool-call expectation where relevant, and final behavior shape.

## 11. Data Flow

Flag-off flow:

1. Caller invokes the existing prompt entrypoint.
2. Prompt code resolves shared config context ID as it does today.
3. `structured_prompt_surface` is absent or false for the context.
4. Existing legacy prompt renderer runs.
5. Output matches current representative snapshots.

Flag-on flow:

1. Caller invokes the same existing prompt entrypoint.
2. Prompt code resolves shared config context ID.
3. `structured_prompt_surface` is true for the context.
4. Prompt code builds a `PromptSurfaceModel`.
5. Structured renderer emits deterministic XML-like sections.
6. Provider addendum and plugin fragments are placed in bounded structured sections.
7. Prompt-regression fixtures validate section order, section contents, active capabilities, ask/denied tools, untrusted-content rules, and few-shot inclusion.

## 12. Error Handling And Fallback

If flag lookup fails or returns an invalid value, prompt building should use the legacy renderer and log a recoverable warning without raw prompt or user content.

If structured model assembly encounters optional missing data, it should omit the affected optional section only when safe and deterministic. It should not silently omit critical sections such as `<role>`, `<current_time>`, `<capabilities>`, or `<reply_style>`.

If plugin prompt rendering fails, existing plugin prompt failure behavior should be preserved. Phase 1 should not make plugin prompt failures fatal unless current behavior already does.

## 13. Observability

Phase 1 may add structured, content-safe observability for:

- prompt surface variant: `legacy` or `structured`.
- prompt section version.
- `structured_prompt_surface` flag state.
- active tool count.
- capability domain count.
- number of ask-gated tools.
- number of denied tools surfaced.
- selected few-shot example IDs.

Observability must not log raw prompt text, user messages, tool inputs, tool outputs, plugin secrets, API keys, tokens, session cookies, or realistic fixture secrets.

## 14. Test Strategy

Phase 1 must extend the Phase 0 prompt-regression harness before enabling structured rendering.

Required coverage:

- flag-off compatibility snapshots for representative `buildSystemPrompt` paths.
- flag-off compatibility snapshots for representative `buildProviderlessSystemPrompt` paths.
- structured prompt section order and required section presence.
- `<capabilities>` for normal task-provider tools.
- `<capabilities>` for providerless mode.
- `<capabilities>` for denied tools.
- `<capabilities>` for ask-gated tools.
- `<safety>` rules for web fetch, attachment, task-provider, memory, custom-instruction, plugin, and MCP content.
- `<examples>` inclusion for the initial few-shot inventory.
- `<examples>` absence when the flag is off.
- plugin prompt fragments remain gated by plugin config and providerless safety rules.
- provider addendum remains present in the structured task-provider path.

Existing focused tests must continue to pass, especially:

- `tests/system-prompt.test.ts`
- `tests/prompt-regression/assembly.test.ts`
- `tests/prompt-regression/trace.test.ts`
- `tests/prompt-regression/harness/**`

The targeted suite should remain:

```bash
bun run test:prompt-regression
```

The implementation plan should add any new focused command if structured prompt tests live outside `tests/prompt-regression/`.

## 15. Acceptance Criteria

Phase 1 is complete when:

- `structured_prompt_surface` exists as a default-off per-context flag.
- Flag-off prompt output is exact-compatible for representative legacy paths.
- Flag-on output is deterministic and sectioned.
- The structured renderer uses a testable prompt surface model.
- `<capabilities>` is derived from active tools and preferences.
- Absent domains are not described as available.
- Denied tools are not described as usable.
- Ask-gated tools retain `_permission_reason` guidance.
- Prompt-level untrusted-content rules are present in flag-on output.
- Initial few-shot examples are compact, named, and fixture-backed.
- Phase 0 pending prompt-surface fixtures that Phase 1 owns are either made runnable or explicitly kept pending with updated rationale.
- Rollback is disabling the per-context flag.

## 16. Rollout

Phase 1 dogfood rollout:

1. Land flag-off compatibility refactor and fixtures.
2. Land structured renderer behind `structured_prompt_surface`.
3. Enable the flag only in a test or admin-owned context.
4. Review prompt-regression output and live dogfood traces for capability hallucination, ask/denied handling, and unwanted verbosity.
5. Expand to additional selected contexts only after fixtures and dogfood traces remain clean.

Rollback:

1. Disable `structured_prompt_surface` for the affected context.
2. Confirm prompt variant returns to `legacy` in content-safe telemetry where available.
3. Re-run prompt-regression compatibility fixtures if a code rollback is also needed.

## 17. Implementation Boundaries

Phase 1 may change:

- `src/system-prompt.ts` internals.
- new prompt-surface helper modules under `src/` if they keep ownership clear.
- config key registration for the per-context flag.
- tests and fixtures under `tests/prompt-regression/**`.
- focused prompt tests such as `tests/system-prompt.test.ts`.
- documentation for the structured prompt surface.

Phase 1 must not change:

- tool runtime behavior.
- tool result shapes.
- confirmation runtime behavior.
- permission-gate runtime behavior.
- `llm-orchestrator` control flow.
- tool-context reduction flag behavior.
- provider interfaces.

## 18. Follow-Up Work

Phase 2 should use the structured prompt to describe standardized tool result and failure envelopes once those envelopes exist.

Phase 3 should turn prompt-level untrusted-content rules into stronger trust-boundary wrappers and adversarial enforcement.

Phase 4 should validate the already-merged tool-context reduction flags against the structured prompt surface.

Phase 5 should use the fixture corpus to evaluate orchestration and prompt optimization experiments.
