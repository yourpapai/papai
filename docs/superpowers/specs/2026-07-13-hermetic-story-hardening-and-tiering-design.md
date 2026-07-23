<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Hermetic story hardening and tiered qualification

**Date:** 2026-07-13  
**Status:** Approved design; pending specification review

## Goal

Make Tier 0 story runs reproducible from declared inputs, make catalog coverage
evidence actionable, and establish a sustainable set of test tiers without turning
the fast story suite into a replacement for provider or platform E2E.

## Decision

Use a hybrid execution snapshot. The launcher keeps the existing immutable harness
snapshot and additionally materializes a read-only snapshot of the candidate runtime
inputs: `src/`, `plugins/`, package metadata, and required built assets. Dependencies
remain outside that snapshot but are explicitly allowlisted. The story manifest
records separate hashes for frozen harness inputs and runtime inputs. Harness hashes
remain the byte-identical compatibility proof; runtime hashes identify exactly which
candidate code a particular run executed.

The I/O guard is deny-by-default for filesystem reads and writes. A scenario may use
only the execution snapshot, allowlisted dependency/runtime locations, and its own
temporary root. Guards cover synchronous, callback, and promise-based filesystem
operations, `Bun.file`, streams, directory operations, and file handles. The guard
is installed before scenario test-support imports. Undeclared access, snapshot
integrity failure, leaked resource, or unconsumed strict fake fails the scenario.

## Coverage ledger

Every catalog record is either executable or pending. Pending records carry
structured branch-audit evidence: inspected ingress, observed result, blocker class,
and required seam when applicable. Generic placeholder reasons are invalid. Existing
stories are linked to catalog IDs only when they prove the full catalog behavior;
unmapped walking-skeleton stories remain useful regression tests but are not counted
as catalog coverage.

## Tiers and CI

| Tier | Purpose                                             | Execution policy                                           |
| ---- | --------------------------------------------------- | ---------------------------------------------------------- |
| 0.1  | Snapshot, I/O guard, manifest, and ledger contracts | Every pull request                                         |
| 0    | Hermetic in-process full-stack stories              | Every pull request                                         |
| 0Q   | Frozen-harness compatibility qualification          | Required for qualifying refactors with explicit `BASE_REF` |
| 1    | Provider-real Docker Kaneo E2E                      | Retain current pull-request policy                         |
| 2    | Small production-process runtime smoke              | Later, focused                                             |
| 3    | Platform-integrated chat behavior                   | Later, focused or opt-in                                   |
| 4    | Scheduler and proactive operational behavior        | Later, scheduled                                           |

Tier 0.1 runs before Tier 0. A scheduled/nightly stress lane runs Tier 0 with
randomized ordering and repeated execution; it is evidence only and never retries a
failure. CI uploads harness/runtime manifests, coverage summary, and JUnit reports
on every outcome.

## Delivery phases

1. Harden snapshot inputs and read/write isolation; add exhaustive Tier 0.1 contracts.
2. Replace generic ledger reasons with structured audit records and publish coverage
   totals.
3. Expand and map conversational task/context coverage: lifecycle, queries, mutation
   safety, configuration, policy, guest access, and context leakage.
4. Add settings/HTTP, memory/web, reminders/deferred work, commands, and interactions
   as independently reviewable story families.
5. Add Tier 4 scheduler scenarios with virtual time and Tier 3 platform checks only
   where a production ingress and deterministic seam exist. Keep Nerv and supervision
   pending until they do.

## Verification

Every phase runs its targeted Tier 0.1 contracts, `bun test:stories`,
`bun test:stories:stress`, and typecheck. Refactor qualification additionally runs
`BASE_REF=<baseline-sha> bun test:stories:compat --manifest-only` followed by the
full compatibility execution.
