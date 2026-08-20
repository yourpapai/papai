<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 Completion Design

Date: 2026-08-01
Status: approved

## Goal

Close Phase 3 completely: make every Phase 3 catalog record executable at its
lowest proving tier and give each of the eleven originally zero-coverage source
files non-zero coverage in the tier that owns its behavior.

## Scope

The implementation promotes all remaining Phase 3 records, including:

- `SCN-stats-anonymity` and `SCN-stats-aggregate-window` at Tier 0.
- The staged downloader and changelog reader coverage obligations at Tier 0.
- The five existing platform-adapter scenarios at Tier 3 with lane-local
  coverage collection.
- `SCN-deferred-poller-lifecycle` at a new runnable Tier 4 operational lane.

The implementation may make narrow production refactors when needed for a safe,
restorable test seam. It must not change production behavior merely to improve
coverage.

## Tier 0 Stories

Two new literal stories prove the remaining stats records through the real
protected `/stats/*` routes. Fixtures seed distinct scoped subjects and
window-bound usage events. The anonymity story verifies that responses never
contain raw usernames or display names. The aggregate story verifies totals,
distributions, and window filtering against the same seeded data. Tests reset
the stats cache so every response reflects its fixtures.

The staged-attachment story constructs its download callback with
`createStagedDownloader`. Its deterministic dependency records the selected
platform instance, source provider, and file ID while returning fixture bytes.
The existing staged-resolution invariants remain unchanged.

The release-announcement flow receives a controlled changelog reader at its
composition boundary. The story invokes that public flow and verifies that the
requested version returns only its own changelog section. It does not mock a
filesystem API or depend on repository files outside the scenario root.

## Tier 3 Coverage

The existing Discord, Kontur Talk, and Telegram adapter scenarios remain the
canonical Tier 3 records. The platform lane collects coverage and applies a
lane-local assertion that these files each have at least one covered line:

- `src/chat/discord/commands.ts`
- `src/chat/discord/format-chunking.ts`
- `src/chat/discord/interaction-helpers.ts`
- `src/chat/kontur-talk/reply-helpers.ts`
- `src/chat/telegram/admin-helpers.ts`

Tier 3 coverage is reported separately and does not alter the Tier 0 coverage
floor.

## Tier 4 Operational Lane

Add `tests/operational/` and an explicit `test:operational` command. Its
deferred-poller lifecycle scenario starts the real pollers with deterministic
chat and provider dependencies, observes scheduler registration and execution
state, then stops and drains them in `finally`.

The scenario verifies a single registration/start lifecycle, idempotent repeat
start behavior, stop/unregister cleanup, and the absence of surviving tasks or
timers. It must wait for observable state rather than a fixed delay. If the
process-global scheduler prevents isolation, introduce the narrowest test seam
that can replace and restore it without leaking state into other suites.

Tier 4 coverage must make `src/deferred-prompts/poller-lifecycle.ts` non-zero.

## Catalog And Contracts

Add the Tier 4 suite root to the runnable lane configuration and promote every
Phase 3 record to an executable mapping with literal story IDs under its
matching tier root. Remove Phase 3 entries from `AUDIT_RECORDS` and update the
catalog contract's exact totals and audit projections. No record may claim a
broader sibling behavior or a lower proving tier than its actual test boundary.

The final catalog outcome is 193 executable records out of 218, with no pending
Phase 3 records. The 25 remaining pending records are pre-existing, non-Phase 3
gaps and remain out of scope.

## Error Handling And Isolation

Test seams are explicit and restorable. Downloader failures retain their
terminal attachment behavior. Stats responses must never gain identifying
fields. Poller stop is safe with absent registrations, and start remains
idempotent. Tests do not use live network access, wall-clock timing, or
cross-file global state.

## Acceptance Criteria

- All Phase 3 catalog records are executable at their declared proving tiers.
- Each originally zero-coverage file has non-zero coverage in Tier 0, Tier 3,
  or Tier 4.
- Tier 0 contracts, stories, and coverage pass.
- Tier 3 platform scenarios and their coverage gate pass.
- Tier 4 operational scenarios and their coverage gate pass.
- Typecheck, lint, and applicable coverage ratchets pass.
- Generated reports are not committed.
