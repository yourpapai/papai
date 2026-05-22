<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# E2E Planning Workflow Design

**Date:** 2026-04-10  
**Topic:** Reusable Workflow for Writing Full-Product E2E Test Plans  
**Status:** Approved

---

## 1. Problem Statement

papai now spans multiple architectural layers and product surfaces:

- chat adapters for Telegram and Mattermost
- authorization, setup, group routing, wizard interception, and config editing in the bot layer
- LLM orchestration with capability-gated tool calling
- provider adapters for Kaneo and YouTrack
- persistent state for config, history, memory, instructions, memos, and scheduling
- proactive and operational flows such as recurring tasks, deferred prompts, and debug instrumentation

The current E2E suite exercises only part of that system. It is strong at the **Kaneo provider integration** layer, but it is not a reusable planning method for future end-to-end coverage across the full product.

The missing piece is not just more tests. It is a **repeatable planning workflow** that helps maintainers and AI agents decide:

1. what actually deserves E2E coverage
2. which system boundaries a scenario crosses
3. which dependencies must be real versus controlled
4. what artifacts a complete E2E plan must contain

Without that workflow, future plans will drift toward either narrow provider-only checks or vague top-level journey lists that miss important architectural seams.

---

## 2. Goals

1. Define a reusable workflow for writing future E2E test plans in papai.
2. Make planning **layer-first**, with feature and journey overlays.
3. Tier candidate scenarios by **realism and cost** so E2E scope stays intentional.
4. Standardize the output shape of E2E plans for both maintainers and AI agents.
5. Ground planning in the current repo architecture, current harnesses, and known coverage gaps.

## 3. Non-Goals

- Writing the implementation plan for this workflow.
- Designing the exact test cases for every papai feature in this document.
- Replacing unit, schema, or integration testing with E2E testing.
- Redesigning the current E2E harness before a concrete plan calls for it.
- Restricting future E2E work to Kaneo only; Kaneo is the current baseline, not the permanent boundary.

---

## 4. Current Project Context

### 4.1 Runtime Architecture

For E2E planning, papai should be modeled as this delivery chain:

```text
Chat platform
  -> chat adapter
  -> bot authorization / command routing / wizard + config interception
  -> LLM orchestrator
  -> capability-gated tools
  -> task provider adapter
  -> external task system
  -> reply path back to chat
```

Important stateful subsystems sit beside that path:

- per-user runtime config
- authorization and group membership state
- conversation history and cache
- fact memory
- memos
- recurring tasks
- deferred prompts
- custom instructions
- identity mappings
- debug event emission and dashboard state

This matters because a user-visible behavior in papai often spans multiple seams at once. A useful E2E plan must therefore treat features as **cross-layer workflows**, not isolated module checks.

### 4.2 Available Feature Surface

The planning workflow must recognize the full product surface, not only the existing E2E suite.

| Area                         | Current Surface                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Core task flow               | create, update, search, list, get, current time                                                            |
| Provider-gated task flow     | delete, count, relations, watchers, votes, visibility                                                      |
| Provider-gated domains       | comments, labels, projects and team, statuses, attachments, work items                                     |
| User-scoped product features | memos, recurring tasks, deferred prompts, instructions                                                     |
| Contextual features          | identity linking, group-history lookup                                                                     |
| Operational and UX flows     | `/setup`, `/config`, `/clear`, admin and group commands, auto-start wizard, config editor, debug dashboard |
| Platform surfaces            | Telegram and Mattermost adapters, formatting, file handling, reply behavior                                |

### 4.3 Current E2E Baseline

The repository already has a solid **provider-real** E2E harness:

- Docker-managed Kaneo environment
- global setup that provisions a real user and workspace
- cleanup client for projects, tasks, and labels
- E2E coverage for tasks, search, comments, relations, labels, projects, statuses/columns, error handling, and several workflow-style provider tests

That baseline is valuable, but it is still concentrated on **provider adapter behavior**. It does not yet provide a planning system for:

- chat adapter behavior
- DM versus group routing
- auth and setup flows
- wizard interception and config editing
- LLM orchestration decisions
- memory, instructions, recurring, deferred, and proactive flows
- provider parity across Kaneo and YouTrack
- platform-specific interaction differences

---

## 5. Design Principles

### 5.1 Layer-First Planning

Planning begins with the architectural layers a behavior crosses, not with a flat feature list. This keeps E2E work tied to real integration seams.

### 5.2 Feature and Journey Overlays

Feature tags and user-journey tags are still required, but they augment the layer model instead of replacing it.

### 5.3 Realism Must Be Earned

Every candidate scenario must justify its E2E cost. If a behavior can be proven at a cheaper level without losing confidence in the important boundary, it should not be promoted into the E2E plan.

### 5.4 Explicit Oracles

A plan is incomplete unless it states how success is proven:

- user-visible reply
- provider-side state
- database or cache state
- scheduled artifact
- emitted debug or operational signal

### 5.5 Isolation and Cleanup Are Part of Planning

Fixtures, teardown, time control, seeded identities, and cross-test isolation are not implementation details. They belong in the planning workflow itself.

---

## 6. Workflow Pipeline

Future E2E plans should be written with the following pipeline.

### Step 1: Define the Planning Unit

Start with one bounded change or behavior at a time.

Required output:

- the user-visible outcome
- the regression boundary
- the “must not break” behaviors

Examples:

- “First-time user completes setup and can issue a natural-language task request”
- “Group mention flow respects authorization and thread-scoped storage”
- “Deferred prompt fires later and replies into the correct context”

### Step 2: Map the Architecture Path

Trace which layers the behavior crosses.

Possible layers:

- chat adapter
- bot authorization and routing
- wizard or config interception
- LLM orchestrator
- tool assembly and capability gating
- provider adapter
- external task system
- persistence and cache
- scheduler and proactive delivery
- debug and observability surfaces

This step is mandatory. If the path is unclear, the plan is not ready.

### Step 3: Overlay Feature and Journey Context

Tag the planning unit with:

1. **feature domains**  
   such as tasks, labels, memos, recurring tasks, instructions, identity, or attachments
2. **journey domains**  
   such as first-time setup, DM usage, group usage, admin flow, proactive flow, or failure recovery

These overlays make the final plan auditable by product capability and user journey while still remaining architecture-aware.

### Step 4: Select the Realism Tier

Choose the cheapest tier that still validates the meaningful boundary.

If the scenario does not require a real cross-boundary interaction, remove it from the E2E plan and push it down to a cheaper test level.

### Step 5: Expand Scenario Classes

For each approved E2E candidate, the plan must consider:

- happy path
- permission or routing gates
- invalid input or unsupported capability behavior
- external provider or platform failure
- persistence and refresh verification
- cleanup and isolation
- cross-context leakage checks when context is part of the behavior
- eventual consistency or retry behavior when the backend is known to be asynchronous

This is where a single product behavior becomes a scenario matrix instead of a single optimistic test.

### Step 6: Define Oracles and Observability

Each scenario must name both:

1. the **user-visible oracle**
2. the **system oracle**

Examples:

| Scenario Type     | User-Visible Oracle                           | System Oracle                                        |
| ----------------- | --------------------------------------------- | ---------------------------------------------------- |
| Chat flow         | expected text, button state, or file response | message routing, stored context, emitted reply event |
| Provider workflow | expected confirmation message                 | created or updated provider entity                   |
| Scheduler flow    | notification arrives at the right time        | scheduled entry consumed or state transitioned       |
| Wizard flow       | next prompt or validation error               | config state updated, wizard state advanced          |

### Step 7: Define Fixtures, Controls, and Teardown

The plan must specify:

- provider and chat platform assumptions
- required capabilities
- config and auth state
- seed users, tasks, projects, labels, or files
- timing controls and clock assumptions
- cleanup rules
- shared harness reuse versus new harness requirements

### Step 8: Emit the Plan Artifact

The resulting E2E plan should be concise but structured, with a stable schema described in Section 8.

---

## 7. Realism Tiers

The planning workflow uses realism tiers to keep cost proportional to confidence.

| Tier                            | Purpose                                                                                   | Real Dependencies                                                              | Typical papai Uses                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Tier 1: Provider-Real E2E       | Validate provider adapters and normalized domain behavior                                 | real task provider, controlled outer layers                                    | Kaneo or YouTrack task operations, relations, comments, labels, statuses                     |
| Tier 2: Runtime E2E             | Validate papai runtime behavior across bot, orchestration, storage, and provider boundary | real papai runtime, controlled chat injection and deterministic model boundary | setup flow, auth gating, wizard progression, context routing, tool capability behavior       |
| Tier 3: Platform-Integrated E2E | Validate adapter-specific behavior and platform interaction semantics                     | real chat platform integration plus runtime                                    | Telegram or Mattermost command handling, mentions, buttons, file behavior, formatting limits |
| Tier 4: Operational E2E         | Validate scheduled, proactive, or operational flows over time                             | runtime plus schedulers, background services, and relevant external systems    | recurring tasks, deferred prompts, proactive delivery, debug instrumentation visibility      |

### Tiering Rule

A scenario belongs in an E2E plan only if it depends on at least one meaningful real boundary **and** at least one user-visible oracle.

If not, the workflow should explicitly mark it as:

- unit
- integration
- schema
- contract
- or manual verification

instead of forcing it into E2E scope.

---

## 8. Standard Output for Every E2E Plan

Every future E2E plan written with this workflow should contain the same sections.

### 8.1 Plan Header

- objective
- regression boundary
- owners or audience
- chosen realism tier
- included platforms and providers
- excluded scope

### 8.2 Architecture Path

List the exact layers crossed by the planned behavior.

Example:

```text
Telegram group mention
  -> auth check
  -> thread-scoped storage resolution
  -> wizard interception
  -> LLM orchestrator
  -> tool capability gating
  -> Kaneo provider
  -> reply formatting back to Telegram
```

### 8.3 Environment and Fixture Model

Document:

- runtime assumptions
- seeded users and credentials
- required projects, tasks, labels, or files
- scheduler or time controls
- teardown strategy

### 8.4 Scenario Matrix

Each row in the plan should contain:

| Field          | Meaning                                     |
| -------------- | ------------------------------------------- |
| Scenario       | Short scenario name                         |
| Feature Tags   | Product domains involved                    |
| Journey Tags   | User journey class                          |
| Layers Crossed | Architectural boundaries exercised          |
| Trigger        | What starts the behavior                    |
| User Oracle    | What the user should observe                |
| System Oracle  | What the system state must show             |
| Failure Mode   | Negative or degraded condition covered      |
| Cleanup        | How isolation is restored                   |
| Notes          | Harness gaps, backend quirks, or exclusions |

### 8.5 Implementation Notes

Each plan should also include:

- existing harnesses to reuse
- new harness work required
- known backend quirks
- order of implementation

This ensures the plan is immediately actionable without mixing implementation details into the scenario matrix itself.

---

## 9. papai Default Priority Lanes

When multiple E2E plans compete for attention, papai should bias toward these lanes.

### 9.1 High Priority

- setup, auth, and configuration flows
- wizard interception and validation
- DM versus group routing and mention rules
- orchestrator-to-tool-to-provider happy path
- orchestrator failure rollback and user-facing error behavior
- provider capability-gated behavior and unsupported-surface handling

These are the places where cross-layer regressions are most likely to damage core user trust.

### 9.2 Medium Priority

- identity linking and “me” resolution flows
- memos, instructions, and group-history behavior
- recurring tasks, deferred prompts, and scheduled execution
- cross-context persistence and isolation guarantees

These are important but often require more harness work or more deterministic time controls.

### 9.3 Expansion Lanes

- Telegram versus Mattermost parity and platform-specific interaction differences
- YouTrack parity against Kaneo-covered behavior
- attachments, work items, watchers, votes, visibility, and other provider-gated surfaces
- debug dashboard and operational observability flows

These are valuable targets once the highest-risk runtime journeys are planned and covered.

---

## 10. How Maintainers and AI Agents Should Use This

When writing a new E2E plan:

1. start with the bounded behavior
2. map the architecture path
3. tag features and journeys
4. choose the realism tier
5. expand the scenario matrix
6. state the oracles, fixtures, and teardown
7. call out what is intentionally excluded from E2E

The result should read like a **planning algorithm applied to one behavior**, not like a backlog dump or a giant list of possible tests.

That is the core purpose of this design: make future E2E plans consistent, architecture-aware, and cheap enough to maintain while still covering the product boundaries that matter.
