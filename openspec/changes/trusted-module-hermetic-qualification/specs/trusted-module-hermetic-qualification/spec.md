<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the hermetic story corpus that qualifies trusted-module runtime
extensions — lifecycle isolation and settings contracts included — and the
branch-side proof that the core separation leaves the frozen story tree
byte-identical and green.

## ADDED Requirements

### Requirement: Extension lifecycle isolation story

The story corpus SHALL include a frozen runtime-extension lifecycle story
asserting that extension cleanups run exactly once in reverse start order
and that a failed extension start leaks no state into subsequent scenarios.

#### Scenario: Reverse-order cleanup

- **WHEN** two runtime extensions start and the world stops
- **THEN** their cleanups run once each in reverse start order

#### Scenario: Failed start isolation

- **WHEN** an extension's start throws in one scenario
- **THEN** the next scenario observes no extension state

### Requirement: Runtime-extension settings story

The story corpus SHALL include a frozen settings story asserting that
runtime-extension settings writes reject denied actors, persist, and hold
their next-turn contract.

#### Scenario: Denied actor

- **WHEN** a denied member attempts an extension settings write
- **THEN** the write is rejected and nothing persists

#### Scenario: Persisted write

- **WHEN** an authorized actor writes an extension setting
- **THEN** the value persists and applies on the next turn

### Requirement: Catalog registration

New qualification scenarios SHALL register in `tests/stories/catalog/coverage.ts`
under the existing `SCN-coding-acp-*` naming convention.

#### Scenario: Manifest resolution

- **WHEN** `bun test:stories:manifest` runs
- **THEN** every new scenario resolves to a literal catalog entry

### Requirement: Frozen-tree branch qualification

Branch qualification SHALL prove `tests/stories` byte-identical to the
recorded baseline and SHALL repair only `src/` composition/plugins — never
frozen inputs — until `test:stories:compat` and the full qualification
suite pass.

#### Scenario: Frozen-input touch

- **WHEN** `git diff $BASELINE_SHA -- tests/stories` becomes non-empty
  during qualification
- **THEN** the qualification is void until the tree is restored
