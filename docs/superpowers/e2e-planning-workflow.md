<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

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
   Propose an OpenSpec change (`/opsx:propose`) for the work and save the plan as `openspec/changes/<name>/e2e-plan.md` using the shared template, referenced from the change's `design.md` / `tasks.md`.

## Realism Tiers

Canonical definition: `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`.
This table mirrors it; the spec wins on any disagreement.

| Tier         | Meaning                                                                                                                                       | Still fakes                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 0.1 / 0 / 0Q | Hermetic in-process stories, harness contracts, frozen-harness compatibility proof                                                            | process, provider, platform, clock, LLM |
| 1            | Provider-real: real Kaneo/YouTrack behind the normalized provider interface                                                                   | process, platform, clock, LLM           |
| 2            | Process-real smoke: the built artifact boots and serves — migrations, env validation, plugin discovery and lifecycle, route binding, shutdown | platform, clock, LLM                    |
| 3            | Platform-integrated: real grammY / discord.js / Mattermost client code against fake platform servers                                          | clock, LLM                              |
| 4            | Operational: virtual clock, schedulers, recurrence, proactive delivery, restart recovery                                                      | LLM                                     |

Tier 2 was formerly defined as "Runtime E2E — real papai runtime with controlled
chat injection and deterministic model boundary". Tier 0 does that today,
in-process and hermetically, so Tier 2 is re-chartered around the process
boundary and that former charter is retired rather than moved.

**0Q is a Tier 0 instrument only.** The frozen-harness compatibility proof depends
on byte-identical harness hashes, which Docker-, provider-, and platform-backed
tiers cannot supply. Tiers 1–4 are regression lanes, never qualification gates.

Each tier's stories live under its own suite root, declared in
`TIER_SUITE_ROOTS` in `tests/stories/catalog/coverage.ts` and enforced by the
Tier 0.1 contracts. Only tiers listed in `LIVE_STORY_TIERS` may back an
executable ledger record; the rest are planned and counted separately.

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
- owners or audience
- chosen realism tier and rationale
- included providers and platforms
- excluded scope
- architecture path
- environment and fixtures
- scenario matrix
- non-E2E coverage or explicit exclusions
- harness reuse and new gaps
- implementation order

## Starting Point

Copy `docs/superpowers/templates/e2e-test-plan-template.md` into `openspec/changes/<name>/e2e-plan.md` (inside the OpenSpec change proposed for the work) and fill it in with the workflow above.
