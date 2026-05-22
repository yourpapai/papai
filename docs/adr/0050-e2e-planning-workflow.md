<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0050: E2E Planning Workflow with Realism Tiers

## Status

Accepted

## Date

2026-04-10

## Context

The papai project had accumulated E2E tests in `tests/e2e/` that validated provider operations against real Kaneo instances in Docker. However, there was no standardized process for:

1. Deciding when a scenario belongs in E2E versus cheaper test levels (unit, integration, schema)
2. Planning new E2E coverage with consistent structure and terminology
3. Understanding the different types of E2E tests needed (provider-only vs runtime vs platform-integrated)
4. Documenting architecture paths and regression boundaries for test scenarios

Test authors and AI agents were creating E2E plans ad-hoc without guidance on:

- Which runtime boundaries a scenario crosses
- What realism tier is appropriate (real provider vs mocked runtime vs full platform)
- Required output structure (scenario matrix, oracles, fixtures, cleanup)
- When to escalate to higher tiers vs stay at provider-level testing

## Decision Drivers

- **Must provide clear planning algorithm** that can be followed by humans and AI agents
- **Must define realism tiers** that distinguish provider-only, runtime, platform, and operational E2E
- **Must include papai-specific priority order** for highest-signal test lanes
- **Should include reusable template** for consistent plan structure
- **Should integrate with existing docs** (tests/CLAUDE.md, e2e-testing.instructions.md)

## Considered Options

### Option 1: Ad-Hoc E2E Planning (Status Quo)

Continue without structured guidance. Each test author decides independently:

- **Pros**: No upfront documentation investment
- **Cons**: Inconsistent plan quality, duplicated effort rediscovering papai boundaries, unclear tier selection, AI agents generate incompatible plan structures

### Option 2: Create Planning Workflow with Realism Tiers

Document a day-to-day workflow guide with:

- 8-step planning algorithm
- 4-tier realism model (Provider-Real, Runtime, Platform-Integrated, Operational)
- papai priority order for test lanes
- Reusable plan template
- Cross-links to existing testing documentation

- **Pros**: Consistent planning approach, clear tier selection criteria, reusable template reduces boilerplate, integrated with AI instruction files
- **Cons**: Requires upfront documentation, must be kept in sync as architecture evolves

### Option 3: Tool-Based Planning (Future Enhancement)

Build interactive tool or CLI for generating plans:

- **Pros**: Interactive guidance, automated validation of plan structure
- **Cons**: Significant development effort, may be overkill for current scale
- **Decision**: Deferred — start with documentation-based approach, consider tooling if scale warrants

## Decision

We will adopt **Option 2: Create Planning Workflow with Realism Tiers**.

Create:

1. `docs/superpowers/e2e-planning-workflow.md` — day-to-day operator guide
2. `docs/superpowers/templates/e2e-test-plan-template.md` — copyable template
3. Updates to `tests/e2e/README.md`, `tests/CLAUDE.md`, and `.github/instructions/e2e-testing.instructions.md` — cross-links

## Rationale

We chose **Option 2** (Planning Workflow with Realism Tiers) over **Option 1** (Status Quo) because the ad-hoc approach produced inconsistent plans and forced every contributor to rediscover papai's architecture boundaries. The workflow provides shared vocabulary and structure without requiring tooling investment.

We deferred **Option 3** (Tool-Based Planning) because the documentation approach delivers 80% of the value at minimal cost. Tooling can be added later if E2E planning volume increases significantly.

Specifically:

- The **8-step planning algorithm** standardizes decision-making that was previously inconsistent across contributors
- The **4-tier realism model** resolves ambiguity about when to use real providers versus mocked runtime versus full platform integration
- The **reusable template** eliminates boilerplate and ensures required sections (oracles, fixtures, cleanup) are not forgotten
- The **papai-specific priority order** directs limited testing effort to highest-signal areas first (auth/wizard, routing, orchestrator-tool-provider path)

## Consequences

### Positive

- Consistent E2E plan structure across all contributors
- Clear criteria for choosing between test levels (unit/integration/E2E)
- AI agents can generate plans that follow team conventions
- Tier vocabulary enables precise discussions about test scope
- Template reduces boilerplate when writing new plans
- Cross-links ensure workflow is discoverable from multiple entry points

### Negative

- Documentation must be kept current as architecture evolves
- New contributors must read workflow before writing E2E plans
- Tier boundaries may require interpretation for edge cases

### Risks

- Workflow may become stale if not updated with architecture changes
- Mitigation: Link ADR to implementation plan; revisit when adding new tiers or changing harness structure

## Implementation Notes

The following files were created or modified:

**Created:**

- `docs/superpowers/e2e-planning-workflow.md` — Main workflow guide with planning algorithm, realism tiers, priority order, harness map, required output checklist, and starting point instructions
- `docs/superpowers/templates/e2e-test-plan-template.md` — Copyable template with architecture path, environment/fixtures, scenario matrix, non-E2E coverage, harness reuse/gaps, and implementation order sections

**Modified:**

- `tests/e2e/README.md` — Added "Planning New E2E Coverage" section with workflow references and Tier 1 classification
- `tests/CLAUDE.md` — Extended E2E Testing section with 4 workflow bullets (workflow reference, template reference, tier mapping, escalation criteria)
- `.github/instructions/e2e-testing.instructions.md` — Added "Planning New E2E Coverage" section with 4 workflow bullets for Copilot guidance

## Verification

All implementation artifacts verified present:

```bash
# Workflow guide exists with required sections
rg "^## " docs/superpowers/e2e-planning-workflow.md
# Output: When to Use This Workflow, Planning Algorithm, Realism Tiers,
#         papai Priority Order, Current Harness Map, Required Output, Starting Point

# Template exists with required sections
rg "^## " docs/superpowers/templates/e2e-test-plan-template.md
# Output: Architecture Path, Environment and Fixtures, Scenario Matrix,
#         Non-E2E Coverage, Harness Reuse and Gaps, Implementation Order

# Cross-links present in all three docs
rg "docs/superpowers/e2e-planning-workflow.md" tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
rg "Tier 1: Provider-Real E2E" tests/e2e/README.md tests/CLAUDE.md .github/instructions/e2e-testing.instructions.md
```

## Related Decisions

- ADR-0003: E2E Test Harness with Docker Compose — Kaneo harness classified as Tier 1 under this workflow
- ADR-0004: Comprehensive E2E Test Coverage — Test scenarios follow this planning workflow
- ADR-0043: TDD Hooks Integration — Unit/integration tests complement E2E coverage per workflow guidance

## References

- Planning Workflow: `docs/superpowers/e2e-planning-workflow.md`
- Plan Template: `docs/superpowers/templates/e2e-test-plan-template.md`
- E2E Test README: `tests/e2e/README.md`
- AI Testing Guide: `tests/CLAUDE.md`
- Copilot Instructions: `.github/instructions/e2e-testing.instructions.md`
