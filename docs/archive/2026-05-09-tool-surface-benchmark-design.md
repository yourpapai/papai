<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Surface Benchmark Design

**Date:** 2026-05-09
**Scope:** Design a simple advisory benchmark that compares two LLM tool-surface strategies for papai-style task workflows.
**Primary Goal:** Measure tool-use success rate across deterministic user scenarios when the model sees full direct tools or an intent-routed subset of direct tools.
**Non-Goal:** Recreate the full papai runtime, grade free-form assistant prose, or make the benchmark a required CI gate.

---

## Context

The current branch also introduces an alternate tool-surface reduction strategy: intent-based routing of direct tools. In that strategy, the model still calls normal tools directly, but the exposed tool subset is filtered before invocation based on the user request.

The benchmark should compare these two strategies fairly:

- `direct_full` — all direct tools are exposed.
- `direct_routed` — direct tools are filtered to an intent-matched subset before the model sees them.

The benchmark should stay simple and trustworthy. It should use real model calls and deterministic fake backend state, then score success from final state rather than from assistant wording.

---

## Decision

Extend the existing benchmark pattern rather than replacing it. The new benchmark will remain advisory, deterministic in backend behavior, and state-only in scoring.

The design keeps one shared fake backend, one shared scenario catalog, and one shared scoring path. Only the exposed tool surface changes between modes.

The headline result is success rate by scenario, model, and mode. Final assistant text is not part of the primary score.

---

## Architecture

The benchmark runner should be organized around a shared scenario loop:

1. Seed a fresh fake store for one scenario.
2. Build tools for one benchmark mode.
3. Call the model through AI SDK `generateText(...)`.
4. Inspect final fake state and recorded tool calls.
5. Evaluate success through the scenario's state-only evaluator.
6. Aggregate results across repetitions, scenarios, models, and modes.

The benchmark modes are:

- `direct_full`
  Expose all fake direct tools.
- `direct_routed`
  Build the same fake direct tools, then apply routing before the model sees them. This mode should follow the same routing shape as the branch implementation: start from the full tool set, classify the prompt, and expose only the filtered subset.

Fairness depends on all three modes sharing the same:

- seeded scenario state
- fake tool behavior
- prompt text
- model and repetition count
- step cap
- success evaluator

Only the visible tool surface changes.

---

## Components

Use a small two-file benchmark shape:

- `scripts/tool-surface-benchmark.ts`
  - CLI parsing
  - model loop
  - per-run execution
  - aggregation
  - markdown and JSON output
- `scripts/tool-surface-benchmark-scenarios.ts`
  - fake store types and seed helpers
  - fake tool factories
  - scenario catalog
  - scenario evaluators
  - mode-specific tool builders

The fake store should contain only the state required for the selected scenarios. At minimum it should support:

- tasks
- comments
- assignees
- recurring entries
- deferred prompt entries
- ordered tool-call trace

The fake tools should remain benchmark-local and deterministic. They should not call real providers and should not depend on broader papai runtime state.

---

## Scenario Set

The benchmark should include exactly 10 user scenarios, chosen to exercise different tool-selection pressures rather than only basic CRUD coverage.

### 1. `create_basic_task`

Prompt asks the model to create a task with a specific title and priority.

Purpose:

- baseline single-step mutation
- checks whether the approach can perform a straightforward create correctly

Success:

- expected task exists with the expected title and priority-relevant fields

### 2. `search_then_update_status`

Prompt asks the model to find a task by description and mark it in progress.

Purpose:

- requires discovery before mutation
- distinguishes models that guess IDs from models that search first

Success:

- seeded target task ends in the expected status
- required read-before-write tool family was called

### 3. `search_then_comment`

Prompt asks the model to find a task and add a specific comment.

Purpose:

- multi-step read plus mutation

Success:

- target task contains the expected comment

### 4. `search_then_assign_user`

Prompt asks the model to find a task and assign it to a named user.

Purpose:

- multi-step flow with user-targeting semantics

Success:

- target task has the expected assignee

### 5. `list_or_search_read_only`

Prompt asks the model to show or find tasks matching a topic.

Purpose:

- pure read flow
- useful for checking that routed mode exposes read tools and does not need write tools to succeed

Success:

- relevant read tool family was called
- no state mutation occurred

### 6. `delete_needs_confirmation`

Prompt asks for a delete in a way that should still require confirmation.

Purpose:

- destructive flow with guarded success criteria

Success:

- delete tool was called
- task was not deleted
- retained state reflects correct confirmation-required behavior

### 7. `time_plus_web_lookup`

Prompt asks for the current time and a summary of a linked or named public page.

Purpose:

- mixed utility plus open-world tool use
- stresses whether routed mode exposes both time and web tools together

Success:

- required tool families were called

### 8. `recurring_task_creation`

Prompt asks to create a weekly recurring reminder or task.

Purpose:

- routing-sensitive category
- checks whether recurring tools are discoverable and usable

Success:

- recurring entry exists with expected cadence and title-like payload

### 9. `deferred_prompt_creation`

Prompt asks for a reminder tomorrow about a specific topic.

Purpose:

- routing-sensitive category adjacent to generic task creation

Success:

- deferred prompt entry exists with expected content and schedule marker

### 10. `ambiguous_but_solvable_task_update`

Prompt asks to update “the benchmark task” without giving the exact ID.

Purpose:

- realistic ambiguity
- pressures the model to search before updating

Success:

- correct seeded task was updated
- required discovery happened instead of blind mutation

### Scenario Rules

The scenario set should satisfy these constraints:

- every scenario is solvable by all three modes
- every scenario has one clear state-based success predicate
- at least four scenarios require multiple tool calls
- at least two scenarios stress routing-sensitive categories such as recurring, deferred, or web
- no scenario depends on judging free-form assistant prose

---

## Scoring

Primary scoring is state-only.

Each run produces exactly one structured result:

- `success: true | false`
- `failureCategory: string | null`

The evaluator inputs are:

- final fake store state
- ordered tool-call trace

The benchmark does not use LLM-as-judge and does not use final assistant text in the headline score.

Scenario evaluators may use both final state and required tool-call evidence. This is important for read-only or guarded flows where final state alone may be too weak to distinguish correct from accidental success.

---

## Failure Categories

Use a normalized failure set so results remain comparable across scenarios and modes:

- `wrong_tool`
- `missing_call`
- `validation_failed`
- `confirmation_error`
- `routing_miss`
- `model_error`

Scenario evaluators may apply their own logic internally, but they should map failures back to one of these categories.

Interpretation:

- `wrong_tool` — the model used an irrelevant or incorrect tool path
- `missing_call` — the model failed to call a required tool
- `validation_failed` — final state does not satisfy the scenario predicate
- `confirmation_error` — destructive flow violated confirmation expectations
- `routing_miss` — routed mode hid the required tool family or led to unusable exposure
- `model_error` — model call failed or ended without a usable benchmark result

---

## Reporting

Produce two result artifacts for each benchmark run.

### Markdown Summary

Primary human-facing artifact:

- summary table by `model x mode`
- detailed scenario table by `model x mode x scenario`

Summary table columns:

- runs
- success rate
- average tool calls
- average steps
- failure breakdown

Detailed table columns:

- scenario
- runs
- success rate
- average tool calls
- average steps
- top failure category

### JSON Results

Machine-readable artifact with raw per-run rows for later slicing.

Each row should include:

- model
- mode
- scenario
- success
- failureCategory
- toolCallCount
- stepCount
- fullToolCount
- exposedToolCount

Recording both `fullToolCount` and `exposedToolCount` is especially useful for `direct_routed`, because it allows later analysis of whether reduced exposure correlates with success changes.

### Output Paths

Recommended defaults:

- markdown: `docs/superpowers/plans/tool-surface-benchmark-results.md`
- json: `docs/superpowers/plans/tool-surface-benchmark-results.json`

The runner should still allow an explicit output override by flag.

---

## CLI And Execution

Follow the existing benchmark style for CLI shape:

- configurable base URL
- configurable API key environment variable name
- configurable comma-separated model list
- configurable repetition count
- configurable output path

The benchmark remains advisory and manual. It must not be part of required CI because it depends on external credentials and model behavior.

The runner should also preserve a clear missing-credentials failure path so users can confirm setup without accidentally calling a model.

---

## Verification

The benchmark code should have deterministic unit tests for:

- CLI argument parsing
- summary aggregation
- per-scenario evaluation behavior
- mode-specific tool builder behavior
- routed-mode exposure counts or filtered tool availability

The benchmark tests must not depend on live model calls.

One smoke path should verify that running the benchmark with a missing API key env var fails early with a clear error.

---

## Boundaries

To keep the benchmark simple and maintainable:

- extend the existing benchmark pattern rather than replacing it
- keep fake tools and fake state benchmark-local
- do not route through the full papai runtime
- do not call external task providers
- do not grade free-form final text in the primary score
- do not introduce CI gating from benchmark outcomes

This design intentionally measures comparative tool-use reliability under controlled conditions, not end-to-end product quality.

---

## Success Criteria

The benchmark design is successful when:

1. It compares `direct_full`, `proxy`, and `direct_routed` fairly against the same scenarios.
2. It includes 10 scenarios covering straightforward, multi-step, confirmation-sensitive, and routing-sensitive requests.
3. The primary score is deterministic and state-only.
4. The output is readable at both summary and scenario detail levels.
5. Benchmark-specific code stays isolated from the broader papai runtime.
6. Adding a new scenario only requires updating the scenario catalog and evaluator definitions, not the runner architecture.

---

## Alternatives Considered

### Rebuild the Benchmark Around Real `makeTools()` Output

Rejected for the initial version because it increases setup complexity and weakens determinism. The goal here is comparative signal across tool-surface strategies, not a full production-runtime simulation.

### Grade Final Assistant Text Alongside State

Rejected for the headline score because it introduces brittleness and wording sensitivity. State-only scoring is more objective for a tool-use comparison benchmark.

### Build a Dedicated Benchmark Framework First

Rejected because it adds framework cost before proving the value of the simple comparison. The existing scaffold is already close to the desired design.

---

## Open Decisions

There are no open design decisions for the benchmark structure itself. Implementation details such as exact seed data, exact recurring/deferred fields, and exact markdown table formatting can be resolved during planning without changing the approved design.
