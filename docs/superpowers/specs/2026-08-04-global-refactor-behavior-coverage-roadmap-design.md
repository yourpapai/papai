<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Global-refactor behavior-coverage roadmap

**Status:** approved

**Date:** 2026-08-04

## Goal

Make the test program sufficient to qualify a global production refactor: every
implemented, documented behavior has an auditable scenario inventory and is
proven at the cheapest tier that can exercise its regression boundary.

Qualification is not a claim that unimplemented product ideas work. Records
marked `blocked:missing-implementation` remain visible but cannot count as
coverage for production behavior.

## Current state

The repository already has five defined tiers and a bidirectional scenario
catalog. Tier 0 is a frozen, hermetic, full-stack compatibility proof; Tiers
1-4 cover provider-real, process-real, platform-adapter, and operational
boundaries respectively.

The current ledger reports 202 executable records out of 224, with 22 blocked
records. The Tier 0 story coverage command currently executes all stories but
fails its ratchet: 66.02% lines and 62.08% functions are below committed floors
of 71% and 70%. The current branch's merge-base predates frozen harness inputs,
so it cannot serve as a compatibility baseline.

The catalog's bidirectional census prevents an authored story from being
uncataloged, but it cannot reveal a documented behavior that was never made a
catalog record. The documented behavior inventory contains such gaps, including
mid-turn steering, live status lifecycle, open-DM identity provisioning and
blocking, alert edge triggering, participant resolution, the release-note
workflow, and analytics governance.

## Coverage model

Introduce one canonical implemented-behavior ledger. It reconciles the
documented behavior inventory with the existing scenario catalog rather than
only reconciling scenarios that already exist.

Each behavior record contains:

- a stable behavior ID and source declaration;
- domain and refactor-risk class;
- implementation state: `implemented`, `blocked:missing-implementation`, or
  `retired`;
- the required scenario matrix for its boundary: primary behavior,
  authorization/routing, failure/recovery, persistence/scope, and any external
  boundary case;
- the cheapest proving tier, executable story IDs, and explicit non-E2E proof
  only where a scenario is unnecessary;
- verification freshness and the change surface that requires revalidation.

A contract test enforces that every implemented behavior is represented, every
executable scenario is claimed or explicitly supporting, and every behavior has
the required matrix entries or a specific inapplicability rationale. A new
behavior, scenario, or tier claim without a ledger decision fails CI.

Tier 0 remains the sole frozen-harness compatibility instrument. Tiers 1-4 are
regression lanes: they prove boundaries Tier 0 deliberately fakes and do not
replace the compatibility proof.

## Delivery phases

### Phase 0: Repair the qualification baseline

Rebase qualifying refactors onto a committed baseline that contains every
frozen input, record its SHA and manifest tree hash, and require compatibility
preflight followed by execution. Diagnose the Tier 0 coverage shortfall and
restore the existing 71% line and 70% function floors without lowering them.

The global-refactor admission command set is initially:

1. `bun test:stories:contracts`
2. `bun test:stories:coverage`
3. `BASE_REF=<recorded-baseline> bun test:stories:compat --manifest-only`
4. `BASE_REF=<recorded-baseline> bun test:stories:compat`

### Phase 1: Reconcile the behavior inventory

Create the ledger from the documented behavior declarations and reconcile it
with the 224 existing catalog records and all T0-T4 declared scenarios. Classify
every behavior as implemented, blocked, or retired; classify every implemented
behavior by risk and proving tier. This phase adds no speculative test seams.

The reconciliation gate is complete only when no implemented behavior lacks a
record, no executable scenario lacks an accountable record, and every matrix
exception states why that dimension does not apply.

### Phase 2: Close Tier 0 in-process behavior gaps

Add hermetic full-stack stories for the highest-risk uncovered runtime paths:

- mid-turn steering at a tool boundary, one active run per context, graceful
  and forced interruption, and honest partial-effect reporting;
- live-status creation, tool labels, timing coalescence, preparing-response
  placeholder, error cleanup, and disabled or unsupported-status capability;
- pending username rebinding, open-DM user provisioning, blocked-user denial,
  and group-member resolution denial;
- alert initial-match, unchanged-match suppression, leave/re-entry, and
  cooldown behavior;
- participant-resolution ranking, fallback labels, scope, and delivery mention
  population;
- release-note discovery, central-model-only humanization, admin review,
  opt-in delivery, idempotency, and failure isolation;
- analytics in-process governance: kill switch, lane selection, guest
  restrictions, fail-closed pseudonymous eligibility, and no-disclosure
  assertions.

Stories use existing world and fixture boundaries where possible. Any new seam
is narrow, deterministic, and introduced in its own reviewed task before the
stories that depend on it. The frozen harness may change only on master before a
new compatibility baseline is recorded.

### Phase 3: Close provider and process boundaries

Tier 1 expands parity only for normalized provider capabilities not already
covered by the shared expectation set, with a recorded exclusion for any
provider-specific impossibility. It remains responsible for real Kaneo API and
container behavior.

Tier 2 expands the built-process matrix for configuration validation, migrations,
plugin discovery and lifecycle, protected route binding, deterministic model
ingress, graceful shutdown, and failure exits. A process scenario must assert an
observable result, not merely that a container booted.

### Phase 4: Close platform and operational boundaries

Tier 3 covers real adapter behavior against deterministic platform fakes:
Telegram and Discord reply-to-bot routing, commands and callbacks; Mattermost
permalink, action, and response behavior; Kontur formatting and lifecycle.

Tier 4 adds a production clock seam only if it is required to prove operational
semantics. It covers recurrence across time zones and DST, at-least-once and
idempotent scheduler execution, proactive delivery, poller lifecycle, and
restart recovery of due work.

### Phase 5: Refactor admission and sustained assurance

Define a checked changed-surface-to-lane map. A global production refactor always
runs the Phase-0 Tier 0 qualification commands plus every tier selected by its
changed runtime surfaces. Tier 3 and Tier 4 stay nightly by default, but a
focused scenario moves into PR gating for a refactor that changes its boundary.

The ledger update, story coverage ratchet, mutation ratchet, and selected-lane
evidence are required in the same change. Periodic stress, cross-tier
consistency, and baseline recertification keep the evidence current.

## Scenario oracles and failure rules

Every scenario has both a user-visible oracle and a system oracle. User-visible
oracles are replies, status transitions, authorization outcomes, callback
responses, or proactive deliveries. System oracles are durable state observed on
a later turn, exact sanitized outbound requests, normalized provider results,
process/route behavior, or absence of leakage and duplicate delivery.

Denials must leave no durable mutation. External failures must be translated
without exposing credentials. Scheduler and delivery cases prove the production
idempotency and recovery semantics rather than adding retry behavior solely for
tests. Hermetic scenarios retain strict undeclared-I/O, environment, timer,
listener, and fixture-consumption enforcement.

## Completion criteria

The roadmap is complete when:

1. Every implemented documented behavior is present in the ledger with its
   required scenario matrix.
2. The Tier 0 coverage command is green at or above its committed floors.
3. The global-refactor compatibility baseline is valid, frozen, and produces a
   green preflight and execution proof.
4. Every lane selected by the checked refactor-impact map is green.
5. All remaining uncovered records are explicitly retired or
   `blocked:missing-implementation`; neither state is used as evidence for an
   implemented behavior.

## Non-goals

- Claiming that live SaaS tenants or a real LLM are required for refactor
  qualification.
- Replacing Tier 0 compatibility with slower external-boundary lanes.
- Lowering coverage thresholds to obtain a green build.
- Implementing blocked product features merely to remove ledger records.
- Rewriting unrelated unit coverage or existing stable harness mechanics.

## Delivery constraints

- Each phase is decomposed into independent spec, plan, and implementation
  cycles; this program document is not one implementation plan.
- Every scenario is assigned to the lowest tier that proves its boundary.
- No retries mask flaky evidence. A flaky PR-gate test is fixed or moved to an
  explicitly non-qualifying lane with a ledger note.
- Harness, catalog, and baseline changes land on master before branches rely on
  them for a compatibility claim.
