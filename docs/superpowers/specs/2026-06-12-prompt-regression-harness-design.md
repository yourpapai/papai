<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Prompt Regression Harness Design

**Date:** 2026-06-12
**Status:** Draft for user review
**Roadmap phase:** Phase 0 — Evaluation And Observability Baseline
**Parent roadmap:** `docs/superpowers/specs/2026-06-12-prompt-optimization-roadmap-design.md`

## 1. Purpose

This document defines Phase 0 of the prompt optimization roadmap: a deterministic prompt regression harness for papai. The harness creates the baseline that later prompt, tool-contract, safety, tool-context reduction, and orchestration phases must extend before changing user-visible behavior.

The harness is intentionally not a live model evaluation system. It verifies what papai assembles for the model and how scripted orchestrator/tool traces behave under controlled conditions. It must be cheap, deterministic, local-friendly, and suitable for CI or targeted checks.

## 2. Goals

- Provide a stable baseline for prompt and tool-behavior changes.
- Capture system prompt structure, context blocks, feature flags, tool preferences, and active tools.
- Simulate orchestrator behavior with fake `generateText` and fake tool outputs, without real LLM or provider calls.
- Represent known current gaps as pending fixtures with phase ownership, not failing tests.
- Give later phase specs a single place to add regression cases before changing runtime behavior.

## 3. Non-Goals

- Do not change prompt text or prompt behavior in Phase 0.
- Do not change tool result envelopes, confirmation behavior, permission behavior, or recovery behavior.
- Do not enable, graduate, or redesign tool-context reduction flags.
- Do not add live model calls, external provider calls, network calls, or nondeterministic scoring.
- Do not build an automatic prompt optimizer.
- Do not expose model chain-of-thought.

## 4. Chosen Approach

Use a **layered deterministic harness** under `tests/prompt-regression/`.

The harness has two fixture families:

1. **Assembly fixtures** — verify what papai sends into the model.
2. **Trace fixtures** — verify scripted orchestrator behavior with fake model/tool traces.

Both fixture families should share setup vocabulary where practical, but they should remain separate fixture types and runners. Assembly tests stay simple and stable; trace tests can grow independently as prompt/tool contracts become more sophisticated.

Rejected alternatives:

- **Single scenario harness:** one fixture type for assembly and traces. This reduces concepts, but couples prompt snapshots to more complex trace simulation.
- **Assembly-only harness:** fastest to build, but does not cover required/forbidden tool calls, confirmation flow, or recovery behavior.
- **Model-in-the-loop harness:** useful later, but too expensive and flaky for Phase 0.

## 5. Directory Layout

Recommended structure:

```text
tests/prompt-regression/
  assembly.test.ts
  trace.test.ts
  harness/
    assembly-runner.ts
    trace-runner.ts
    fixture-types.ts
    fixture-loader.ts
    assertions.ts
    context-builders.ts
    scripted-model.ts
  fixtures/
    assembly/
      *.fixture.ts
    trace/
      *.fixture.ts
```

The implementation plan may adjust file names, but should preserve the separation between fixture data, shared harness code, and test entrypoints.

## 6. Fixture Format

### Fixture Language

Use TypeScript fixtures for Phase 0.

Rationale:

- papai provider shapes, tool preferences, feature flags, and context setup are nuanced.
- TypeScript fixtures can reuse typed builders and constants.
- Future phase specs can add fixture helpers without inventing a JSON schema migration.

JSON can be reconsidered only if fixtures remain pure data after the first implementation.

### Shared Fixture Metadata

Both fixture families should support:

```ts
interface PromptRegressionFixtureMeta {
  readonly id: string
  readonly description: string
  readonly ownerArea: 'prompt' | 'context' | 'tools' | 'orchestration' | 'safety' | 'tool-context-reduction'
  readonly roadmapPhase: 'phase-0' | 'phase-1' | 'phase-2' | 'phase-3' | 'phase-4' | 'phase-5'
  readonly pending?: {
    readonly reason: string
    readonly expectedFixPhase: 'phase-1' | 'phase-2' | 'phase-3' | 'phase-4' | 'phase-5'
    readonly unskipWhen: string
  }
}
```

Pending fixtures are loaded and reported, but skipped by the runner so the suite stays green.

### Shared Setup Vocabulary

Both fixture families should share setup concepts:

- context type: `dm`, `group`, `proactive`, or `providerless`.
- provider: `kaneo`, `youtrack`, `providerless`, or a capability subset.
- user/tool preferences: allow, deny, ask.
- memory state: compact memory, long-term memory, stale memory, none.
- feature flags: current default-off flags and future prompt-optimization flags.
- current time: fixed ISO timestamp and timezone.
- context IDs and user IDs: deterministic values.

The setup vocabulary should describe intent; builders should translate it into concrete provider/test objects.

## 7. Assembly Fixtures

Assembly fixtures verify model input assembly without running the orchestrator loop.

Each assembly fixture should describe:

- fixture metadata.
- context/provider setup.
- tool preferences.
- memory/context blocks.
- feature flags.
- expected prompt assertions.
- expected active tool assertions.

Expected prompt assertions should include:

- normalized section order or section outline.
- `mustContain` strings.
- `mustNotContain` strings.
- trust-label assertions.
- current-time assertions.
- providerless/provider-specific assertions.

Expected active tool assertions should include:

- tool names that must be present.
- tool names that must be absent.
- domain-level expectations where exact names are too brittle.
- ask-gated and denied tool preference text where relevant.

The runner should normalize prompt output enough to avoid whitespace churn, but must not normalize away meaningful content or section order.

## 8. Trace Fixtures

Trace fixtures verify scripted orchestrator behavior with fake model/tool steps.

Each trace fixture should describe:

- fixture metadata.
- shared context/provider/tool-preference setup.
- scripted model steps.
- fake tool outputs or fake tool failures.
- expected tool-call sequence.
- forbidden tool calls.
- expected final behavior classification.

Supported final behavior classifications:

- `completes_action`
- `asks_clarification`
- `asks_confirmation`
- `declines_unsafe_action`
- `reports_retryable_failure`
- `reports_non_retryable_failure`
- `requests_permission`
- `answers_without_tools`

Trace fixtures should not assert exact final reply prose in Phase 0. They should assert classification and required high-signal substrings only where current behavior is stable.

The trace runner should fake `generateText` through existing dependency-injection seams where possible, following current `llm-orchestrator` test patterns. It should not use real model calls.

## 9. Snapshot And Assertion Policy

Use a hybrid policy.

### Exact Assertions

Use exact assertions for stable structural outputs:

- normalized prompt section order or section outline.
- enabled tool names.
- denied/ask-gated tool lists.
- context block tags and trust labels.
- trace event sequence.
- final behavior classification.

### Targeted Text Assertions

Use targeted assertions for volatile prompt prose:

- required safety, capability, memory, and providerless wording.
- absent capabilities must not be described as available.
- denied tools must not be described as usable.
- threshold values must not appear in fixtures that cover threshold-hiding behavior.
- raw IDs must not appear where a fixture checks user-facing reply shape.

### Avoid Full Prompt Snapshots Initially

Do not require broad exact full-prompt snapshots in Phase 0. Full prompt snapshots can be added later for stable sub-builders after Phase 1 introduces structured prompt sections.

## 10. Pending Fixture Policy

Known current gaps should be represented as pending fixtures, not failing tests.

Each pending fixture must include:

- reason.
- expected fixing phase.
- owner area.
- condition for unskipping.

The runner should report pending fixture count and IDs. It should fail only if:

- a pending fixture lacks required metadata.
- a runnable fixture fails.
- a fixture is malformed.

Pending fixtures are not a place to hide flaky tests. A fixture should be pending only when it documents a known behavior gap assigned to a future roadmap phase.

## 11. Baseline Fixture Set

### Assembly Fixtures

Initial assembly fixtures:

- DM with task provider and normal tools.
- Providerless DM.
- Group context with group-history/tool differences.
- Ask-gated tool preference.
- Denied tool or denied domain preference.
- Compact memory plus long-term memory present.
- Proactive/deferred mode prompt.
- Tool-context reduction flags off baseline.
- Tool-context reduction flags on pending fixture, if current harness cannot safely exercise it yet.

### Trace Fixtures

Initial trace fixtures:

- Create task with enough detail.
- Ambiguous task update should ask a clarifying question.
- Destructive action returns confirmation required.
- Confirmation declined should produce safe final reply.
- Tool denied or ask-gated should not execute without permission.
- Provider error retryable vs non-retryable recovery.
- Web fetch or tool output contains instruction-like text and must not override system behavior.
- Stale memory conflict with current user instruction should prefer current user instruction.

Runnable fixtures should be green against current behavior. Known gaps become pending fixtures with phase ownership.

## 12. Implementation Boundaries

Phase 0 may add:

- test-only harness code.
- TypeScript fixtures.
- small production exports only when necessary to test existing behavior cleanly.
- observability tests for existing trace/debug seams.

Phase 0 must not add:

- prompt behavior changes.
- tool envelope changes.
- safety-boundary rendering changes.
- orchestration behavior changes.
- feature flag enablement changes.
- live model/provider dependencies.

If implementation discovers that a production refactor is required to make assembly or trace behavior testable, that refactor must preserve behavior and be covered by compatibility assertions.

## 13. Integration With Existing Tests

The implementation should follow existing test conventions:

- Use Bun test runner.
- Keep tests isolation-clean under `bun test --parallel`.
- Prefer dependency injection over module mocking.
- Use helpers from `tests/utils/test-helpers.ts` and `tests/tools/mock-provider.ts`.
- Follow existing `llm-orchestrator` test patterns for fake `generateText`.
- Avoid direct `globalThis.fetch` mocks.
- Keep fixture builders deterministic: fixed time, IDs, provider capabilities, and settings.

The new harness complements, not replaces:

- `tests/system-prompt.test.ts`
- `tests/llm-orchestrator-system-prompt.test.ts`
- `tests/llm-orchestrator-invoke.test.ts`
- `tests/tool-failure.test.ts`
- `tests/memory-context-block.test.ts`
- existing debug trace tests

Phase 0 can reuse behavior from those tests, but should give later prompt-optimization phases one obvious place to add scenario-level regressions.

## 14. Observability Baseline

Phase 0 should document what is already observable and what is missing for later phases.

Minimum baseline:

- prompt source or prompt variant under test.
- active tool names/count.
- context type and provider shape.
- feature flags included in setup.
- scripted tool call sequence.
- scripted tool result/failure shape.
- final behavior classification.

The harness must not log raw user content, secrets, API keys, tokens, or session cookies. Fixture text is test data and can be stored in the repository, but should still avoid realistic secrets.

## 15. Acceptance Criteria

Phase 0 is complete when:

- `tests/prompt-regression/` exists with separate assembly and trace runners.
- Initial assembly fixtures are present.
- Initial trace fixtures are present.
- Runnable fixtures pass deterministically without real model/provider calls.
- Pending fixtures are reported and include required metadata.
- The harness can run as a targeted Bun test.
- The implementation plan for Phase 1 can add fixtures without changing the harness architecture.

## 16. Follow-Up Work

After Phase 0:

- Phase 1 adds structured prompt fixtures and flips pending prompt-surface cases into runnable assertions.
- Phase 2 adds tool envelope and recovery fixtures.
- Phase 3 adds adversarial trust-boundary fixtures.
- Phase 4 adds tool-context reduction graduation fixtures and metrics.
- Phase 5 adds orchestration experiment fixtures and optional offline prompt-variant evaluation.
