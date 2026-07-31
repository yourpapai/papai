<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Scenario-catalog coverage with hermetic full-stack stories

**Date:** 2026-07-13
**Status:** Approved design; awaiting specification review
**Source catalog:** `~/Projects/kontur/kiss-code_review-papai/papai/scenarios/catalog.md`

## Goal

Turn the scenario catalog into an auditable, deterministic Tier 0 regression
suite. The suite must cover every behavior that is reachable in this branch
through hermetic full-stack user stories, including its happy path and the
safety or failure path described by the catalog. Catalog records that are not
implemented here, are documented gaps, or require an unavailable external seam
must be explicitly recorded as pending coverage rather than represented by a
skipped or falsely passing test.

The catalog currently contains 126 records: 102 `confirmed`, 19
`forward-only`, 4 `gap`, and 1 `contract-only`.

## Scope and decomposition

This is a coverage program, implemented in independently reviewable families:

1. Conversational task operations, context scope, and authorization.
2. Proactive work, memory, public fetch, commands, and interactions.
3. Settings and HTTP surfaces.
4. ACP coding-session behavior.
5. Nerv and supervision behavior, re-evaluated after the current branch's
   available implementation and hermetic seams have been verified.

The stages determine implementation order only. The final coverage ledger
classifies every catalog record from the beginning, so the current total and
remaining work are visible throughout.

## Coverage model

### Story identity and organization

Each reachable catalog record has a declared hermetic story whose literal name
begins with the corresponding `SCN-*` ID. Stories may share setup and reside in
feature-family files, but each record retains separate assertions. This gives
the story manifest a stable, human-readable link to the catalog without
requiring one file per record.

Story files are grouped by product boundary:

- `chat-task/` for task-provider capabilities and their configuration errors;
- `context/` for storage/config scope, membership, guest mode, and permission
  decisions;
- a proactive family for recurring, deferred, memory, and web behavior;
- command and interaction families;
- `settings/` and HTTP families;
- `integrations/coding-sessions/` for ACP; and
- a separate nerv/supervision family only where the branch supplies a real
  reachable path and a hermetic protocol seam.

### Catalog coverage ledger

A repository-local, machine-checked coverage ledger will retain the catalog
snapshot identity and define one classification for every one of the 126
scenario IDs. Each entry records:

- scenario ID and catalog status;
- branch verification result;
- the executable story ID(s) and checkpoints when reachable; or
- a precise pending reason and, where applicable, the missing feature or fake
  transport needed to make it executable.

The ledger is not generated from the source catalog at test time. The catalog
lives in a peer workspace and must not become an undeclared test dependency.
Its IDs and provenance are captured in the repository so the test suite remains
hermetic and reviewable.

A contract test validates that every catalog ID appears exactly once, no
executable entry references an undeclared story ID, and pending entries include
a reason. Pending is reporting data, not `test.skip`, an expected failure, or a
way to make an unsupported path look tested.

## Execution architecture

Stories use the existing `ScenarioWorld` and only its public scenario API:

- fake chat receives a real inbound message or interaction;
- the production runtime routes it through authorization, context resolution,
  capability assembly, and the scripted LLM tool loop;
- the in-memory task provider, strict HTTP dispatcher, deterministic clock,
  fake Magi, and other focused fakes observe declared protocol behavior; and
- the real reply and persisted runtime state form the test oracle.

Tests must not invoke production tools directly to claim end-to-end coverage.
Focused test-only fakes may be added only when a reachable production seam has
a documented protocol. They must reject undeclared requests and expose
sanitized events for assertions. The existing I/O guard remains authoritative:
no real network, wall-clock sleeps, uncontrolled timers, subprocesses, or
external files.

The current fake Magi is reused for ACP stories. A fake nerv, forge, or other
peer service is introduced only after the current branch proves it can reach
that boundary. Catalog records for absent features or documented gaps remain
pending until then.

## Happy and unhappy path oracles

Every executable catalog record proves both the requested result and the
relevant safety boundary. A story will assert:

1. The user-facing result: reply text, interaction state, HTTP response, or
   proactive delivery.
2. The system result: persisted state and the expected tool or sanitized
   upstream event.
3. The safety result: no mutation, outbound request, capability advertisement,
   credential exposure, or cross-context effect when the failure/denial branch
   applies.

Unhappy paths follow catalog variants instead of generic duplicated error
tests. They include missing task/coding configuration; guest, role, and
`allow`/`ask`/`deny` tool policy; confidence and interaction denial;
unsupported optional provider methods; malformed or unauthorized HTTP;
declared upstream failures; and scheduler idempotency. The deterministic clock
drives scheduled work; tests poll/settle instead of sleeping.

For example, a task-deletion pair proves the chat-to-provider deletion path
when it is permitted and the appropriate confirmation, policy, or configuration
failure path without deleting the task. Both the reply and the absence or
presence of the provider mutation are asserted.

## Harness changes

The harness will change only where a production behavior cannot be expressed
through an existing public `given`/`when`/`then` capability. New primitives must
remain narrowly scoped, follow the current scenario API style, and receive
harness contract tests before feature stories rely on them. Test setup that
requires an existing production store or capability must use the established
fixture/setup boundary rather than creating an alternate application path.

## Verification

Each completed family runs its focused stories and relevant harness contracts.
The aggregate implementation must pass:

- `bun test:stories:contracts`;
- `bun test:stories`;
- `bun test:stories:stress` for the new stories; and
- the ledger contract proving complete catalog classification.

The suite's story manifest and JUnit output remain the standard Tier 0 reports.
The ledger supplements those reports by making explicitly pending coverage
visible; it does not alter their pass/fail semantics.

## Non-goals

- Editing the external scenario catalog.
- Calling live chat, task-tracker, Magi, nerv, forge, or HTTP services.
- Adding skipped tests for unimplemented behavior.
- Treating a catalog record as covered merely because unit tests exercise a
  component.
- Refactoring unrelated production code solely to make the test layout neater.

## Self-review

- No placeholders or open classifications are permitted: every catalog ID will
  be executable or pending with a concrete reason.
- The source catalog is treated as external evidence, while the in-repository
  ledger keeps the suite hermetic.
- Staging does not weaken completeness: it orders delivery while preserving an
  explicit total-coverage inventory.
- “Happy and unhappy path” is defined as observable result plus safety oracle,
  avoiding an ambiguous requirement for duplicate generic error tests.
