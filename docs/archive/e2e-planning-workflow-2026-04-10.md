<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# E2E Planning Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operationalize the approved E2E planning workflow so maintainers and AI agents can consistently write architecture-aware papai E2E plans from a shared guide, reusable template, and linked testing instructions.

**Architecture:** This is a docs-first rollout, not a runtime change. Create one day-to-day workflow guide distilled from the approved spec, create one reusable plan template that matches the required output contract, then wire both artifacts into the existing E2E testing docs and AI instruction files where future planners already look for guidance.

**Tech Stack:** Markdown, repository docs under `docs/`, `tests/CLAUDE.md`, `.github/instructions/e2e-testing.instructions.md`, `rg`, `git`

---

## File Structure

This stays as a **single plan** because every change supports one bounded outcome: making the new E2E planning workflow discoverable and reusable. Splitting guide, template, and doc wiring into separate plans would force the implementer to rediscover the same terminology, tier model, and output contract multiple times.

| Path                                                   | Responsibility                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `docs/superpowers/e2e-planning-workflow.md`            | Maintainer-facing operator guide that distills the approved spec into a practical planning algorithm |
| `docs/superpowers/templates/e2e-test-plan-template.md` | Copyable template for new E2E plan documents with the required papai structure                       |
| `tests/e2e/README.md`                                  | Human-facing description of how the current Kaneo harness fits into the broader tier model           |
| `tests/CLAUDE.md`                                      | Agent-facing testing guidance for future E2E planners working in `tests/`                            |
| `.github/instructions/e2e-testing.instructions.md`     | Copilot instruction snippet so future E2E plan work automatically follows the workflow               |

---

### Task 1: Publish the day-to-day E2E planning guide

**Files:**

- Create: `docs/superpowers/e2e-planning-workflow.md`

- [ ] **Step 1: Verify the guide does not already exist**

Run:

```bash
test ! -f docs/superpowers/e2e-planning-workflow.md && echo "missing"
```

Expected: `missing`

- [ ] **Step 2: Create the guide with the approved workflow**

Create `docs/superpowers/e2e-planning-workflow.md` with this content:

```markdown
# E2E Planning Workflow

Use this workflow before writing any new papai E2E plan.

## When to Use This Workflow

Use this guide when you are:

- proposing a new E2E plan
- expanding the existing E2E suite
- deciding whether a scenario belongs in E2E or at a cheaper test level
- mapping a feature request to papai runtime boundaries

## Planning Algorithm

1. **Define the planning unit**  
   State the user-visible behavior, the regression boundary, and the behaviors that must not break.
2. **Map the architecture path**  
   Trace the runtime boundaries the scenario crosses: chat adapter, auth or wizard interception, orchestrator, tools, provider, storage, scheduler, or debug surfaces.
3. **Add feature and journey tags**  
   Tag the scenario by product domain and by user journey so the final plan is auditable from both angles.
4. **Choose the cheapest realism tier that proves the boundary**  
   Do not promote a scenario into E2E if unit, integration, contract, or schema coverage is enough.
5. **Expand the scenario matrix**  
   Cover happy path, routing or permission gates, invalid input, external failures, persistence checks, cleanup, and cross-context leakage where relevant.
6. **Name the oracles**  
   Every scenario needs both a user-visible oracle and a backend or system oracle.
7. **Define fixtures and teardown**  
   State required config, auth state, test data, timing assumptions, and cleanup rules.
8. **Emit the plan**  
   Save the plan under `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` using the shared template.

## Realism Tiers

| Tier                            | Meaning                                                                            | Typical papai use                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Tier 1: Provider-Real E2E       | Real task provider, controlled outer layers                                        | Kaneo or YouTrack provider operations and normalized task behavior           |
| Tier 2: Runtime E2E             | Real papai runtime with controlled chat injection and deterministic model boundary | setup, auth, wizard, routing, tool capability behavior                       |
| Tier 3: Platform-Integrated E2E | Real chat platform plus runtime                                                    | Telegram or Mattermost command, mention, button, and file behavior           |
| Tier 4: Operational E2E         | Runtime plus schedulers or background delivery surfaces                            | recurring tasks, deferred prompts, proactive delivery, debug instrumentation |

## papai Priority Order

Start with the highest-signal lanes:

1. setup, auth, configuration, and wizard flows
2. DM versus group routing and mention rules
3. orchestrator-to-tool-to-provider happy path and failure rollback
4. capability-gated behavior and unsupported-surface handling

Then cover:

- identity linking
- memos, instructions, and group-history behavior
- recurring, deferred, and proactive flows
- provider and platform parity gaps

## Current Harness Map

- `bun test:e2e` runs the current Docker-backed Kaneo suite.
- `tests/e2e/bun-test-setup.ts` starts one shared E2E environment for the suite.
- `tests/e2e/global-setup.ts` provisions a user and workspace and exposes the shared config.
- `tests/e2e/kaneo-test-client.ts` owns test resource cleanup.
- Today’s harness is **Tier 1: Provider-Real E2E** in the tier model above.

## Required Output for Every Plan

Every E2E plan must contain:

- objective
- regression boundary
- chosen realism tier and rationale
- included providers and platforms
- architecture path
- environment and fixtures
- scenario matrix
- non-E2E coverage or explicit exclusions
- harness reuse and new gaps
- implementation order

## Starting Point

Copy `docs/superpowers/templates/e2e-test-plan-template.md` into `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` and fill it in with the workflow above.
```

- [ ] **Step 3: Verify the guide has the required sections**

Run:

```bash
rg "^## " docs/superpowers/e2e-planning-workflow.md
```

Expected output contains these headings:

- `## When to Use This Workflow`
- `## Planning Algorithm`
- `## Realism Tiers`
- `## papai Priority Order`
- `## Current Harness Map`
- `## Required Output for Every Plan`
- `## Starting Point`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/e2e-planning-workflow.md
git commit -m "docs: add e2e planning workflow guide"
```

### Task 2: Create the reusable E2E plan template

**Files:**

- Create: `docs/superpowers/templates/e2e-test-plan-template.md`

- [ ] **Step 1: Verify the template does not already exist**

Run:

```bash
test ! -f docs/superpowers/templates/e2e-test-plan-template.md && echo "missing"
```

Expected: `missing`

- [ ] **Step 2: Create the template file**

Create `docs/superpowers/templates/e2e-test-plan-template.md` with this content:

````markdown
# E2E Test Plan

Rename this file and title to match the specific behavior or journey before saving it under `docs/superpowers/plans/`.

**Objective:** State the user-visible behavior being validated.

**Regression Boundary:** State what existing behavior must remain safe while adding this coverage.

**Realism Tier:** State the chosen tier and why cheaper tests are not enough.

**Platforms and Providers:** Name the included surfaces and the intentionally excluded ones.

---

## Architecture Path

```text
List the runtime path here, one boundary per line.
Example:
DM message
  -> auth check
  -> wizard interception
  -> LLM orchestrator
  -> tool capability gating
  -> task provider
  -> reply formatting
```
````

## Environment and Fixtures

- State runtime assumptions.
- State auth and config preconditions.
- List seeded users, projects, tasks, labels, files, or scheduler state.
- State teardown and isolation expectations.

## Scenario Matrix

| Scenario                      | Feature Tags                      | Journey Tags           | Layers Crossed                        | Trigger                       | User Oracle                       | System Oracle              | Failure Mode                                    | Cleanup                         | Notes                               |
| ----------------------------- | --------------------------------- | ---------------------- | ------------------------------------- | ----------------------------- | --------------------------------- | -------------------------- | ----------------------------------------------- | ------------------------------- | ----------------------------------- |
| Describe the happy path first | List the product domains involved | List the journey class | List the runtime boundaries exercised | Describe what starts the flow | Describe what the user should see | Describe the backend proof | Name the negative or degraded condition covered | Describe teardown and isolation | Note harness gaps or backend quirks |

Add more rows until the plan covers happy path, routing or permission gates, invalid input, external failure, persistence verification, and cleanup.

## Non-E2E Coverage

- List the behaviors intentionally pushed down to unit, integration, schema, or contract tests.
- Name anything explicitly left for manual verification.

## Harness Reuse and Gaps

- Name the existing harnesses to reuse.
- Name any new helper, fixture, or platform setup work required.

## Implementation Order

1. Start with the highest-signal happy path.
2. Add the most important negative path next.
3. Add context leakage, persistence, or cleanup coverage after the main flow is stable.

````

- [ ] **Step 3: Verify the template exposes the required structure**

Run:

```bash
rg "^## " docs/superpowers/templates/e2e-test-plan-template.md
````

Expected output contains these headings:

- `## Architecture Path`
- `## Environment and Fixtures`
- `## Scenario Matrix`
- `## Non-E2E Coverage`
- `## Harness Reuse and Gaps`
- `## Implementation Order`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/templates/e2e-test-plan-template.md
git commit -m "docs: add e2e test plan template"
```

### Task 3: Wire the workflow into existing E2E docs and agent instructions

**Files:**

- Modify: `tests/e2e/README.md`
- Modify: `tests/CLAUDE.md`
- Modify: `.github/instructions/e2e-testing.instructions.md`

- [ ] **Step 1: Verify the current docs do not already reference the workflow**

Run:

```bash
rg "e2e-planning-workflow|e2e-test-plan-template" tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
```

Expected: no matches

- [ ] **Step 2: Add the workflow references**

Update `tests/e2e/README.md` by adding this section after `## Overview`:

```markdown
## Planning New E2E Coverage

Before drafting a new papai E2E plan, read `docs/superpowers/e2e-planning-workflow.md` and start from `docs/superpowers/templates/e2e-test-plan-template.md`.

Treat the current Docker-backed Kaneo suite as **Tier 1: Provider-Real E2E** in that workflow.

Only promote scenarios to higher tiers when they need full runtime, platform, or operational boundaries that Tier 1 cannot prove.
```

Update `tests/CLAUDE.md` by extending the `## E2E Testing` section with these bullets:

```markdown
- Before writing a new E2E plan, read `docs/superpowers/e2e-planning-workflow.md`.
- Start new E2E plan docs from `docs/superpowers/templates/e2e-test-plan-template.md`.
- The current Docker-backed Kaneo harness maps to **Tier 1: Provider-Real E2E**.
- Escalate to Tier 2-4 only when the scenario depends on runtime, platform, or operational boundaries that Tier 1 cannot prove.
```

Update `.github/instructions/e2e-testing.instructions.md` by adding this section after `## Rules`:

```markdown
## Planning New E2E Coverage

- Before proposing or writing a new E2E plan, read `docs/superpowers/e2e-planning-workflow.md`.
- Start new plan files from `docs/superpowers/templates/e2e-test-plan-template.md`.
- Treat the existing Docker-backed Kaneo suite as **Tier 1: Provider-Real E2E**.
- Prefer the smallest realism tier that proves the boundary; do not inflate Tier 2-4 coverage when Tier 1 or cheaper tests are sufficient.
```

- [ ] **Step 3: Verify all three docs now point to the workflow**

Run:

```bash
rg "docs/superpowers/e2e-planning-workflow.md|docs/superpowers/templates/e2e-test-plan-template.md|Tier 1: Provider-Real E2E" tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
```

Expected: matches in all three files

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
git commit -m "docs: link e2e planning workflow"
```

### Task 4: Final verification pass

**Files:**

- Modify: `docs/superpowers/e2e-planning-workflow.md`
- Modify: `docs/superpowers/templates/e2e-test-plan-template.md`
- Modify: `tests/e2e/README.md`
- Modify: `tests/CLAUDE.md`
- Modify: `.github/instructions/e2e-testing.instructions.md`

- [ ] **Step 1: Review cross-links and terminology**

Run:

```bash
rg "Tier 1: Provider-Real E2E|docs/superpowers/e2e-planning-workflow.md|docs/superpowers/templates/e2e-test-plan-template.md" docs/superpowers/e2e-planning-workflow.md docs/superpowers/templates/e2e-test-plan-template.md tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
```

Expected: the tier name and both file paths are used consistently everywhere

- [ ] **Step 2: Trim any duplicated or conflicting wording**

If any file drifts from the approved terminology, normalize it so these exact phrases remain stable:

```markdown
Tier 1: Provider-Real E2E
docs/superpowers/e2e-planning-workflow.md
docs/superpowers/templates/e2e-test-plan-template.md
```

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git --no-pager diff -- docs/superpowers/e2e-planning-workflow.md docs/superpowers/templates/e2e-test-plan-template.md tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
```

Expected: only the planned workflow, template, and reference changes are present

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/e2e-planning-workflow.md docs/superpowers/templates/e2e-test-plan-template.md tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
git commit -m "docs: finish e2e planning workflow rollout"
```
