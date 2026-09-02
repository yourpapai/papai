<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## MODIFIED Requirements

### Requirement: Ledger entries are evidence-bearing

A documented behavior SHALL qualify only through a ledger entry backed by an
executable record. `blocked:missing-implementation` and `retired` entries SHALL
NOT count as evidence, and a `partial` record SHALL NOT qualify a global
production refactor.

Evidence SHALL be attributed to the specific required dimension it proves. A
ledger entry SHALL NOT record a scenario that proves none of the behavior's
required dimensions, and the set of dimensions a behavior requires SHALL be
exactly the union of the dimensions it proves and the dimensions it declares
open — a behavior SHALL NOT require a dimension that is neither.

#### Scenario: Blocked entry offered as evidence

- **WHEN** a behavior's only ledger entry is `blocked:missing-implementation`
- **THEN** the behavior counts as uncovered

#### Scenario: Citation that proves no required dimension

- **WHEN** an entry records evidence
- **THEN** that evidence is attributed to one of the behavior's required
  dimensions by construction; the ledger cannot express an unattributed
  citation, and a relationship that proves no required dimension may be stated
  in the entry's rationale prose instead

#### Scenario: Required dimension neither proven nor open

- **WHEN** an entry declares what it requires
- **THEN** the required set is derived as the union of the proven and open
  sets, so a required dimension that is neither cannot be expressed

## ADDED Requirements

### Requirement: A tier claim is made per dimension

A ledger entry SHALL declare a proving tier for each dimension it proves, and
the catalog proving tier of every scenario cited for a dimension SHALL equal
the tier that dimension declares. A behavior MAY declare different tiers for
different dimensions, so that each dimension is proven at the cheapest tier
that can exercise its regression boundary.

#### Scenario: Scenario cited at the wrong tier

- **WHEN** a dimension declares tier T and cites a scenario the catalog records
  at a different tier
- **THEN** the ledger is rejected, naming the dimension, the declared tier, and
  the tier the scenario actually runs at

#### Scenario: One behavior proven across two tiers

- **WHEN** a behavior proves one dimension at a tier that can observe a real
  external boundary and another dimension at a cheaper hermetic tier
- **THEN** the ledger accepts both claims, and each dimension is validated
  against its own declared tier

#### Scenario: Dimension proven with no scenario

- **WHEN** an entry declares a dimension proven but cites no scenario for it
- **THEN** the ledger is rejected, naming the behavior and the dimension

### Requirement: An open dimension declares a planned tier that is not evidence

An entry SHALL record, for each dimension it leaves open, the tier at which
that dimension is expected to be proven. A planned tier SHALL NOT carry
scenario references and SHALL NOT count as coverage: a behavior with any open
dimension SHALL remain unqualified for a global production refactor regardless
of the tiers it plans.

#### Scenario: Planned tier offered as coverage

- **WHEN** a `partial` entry declares a planned tier for every open dimension
- **THEN** the behavior is still reported as unqualified

#### Scenario: Open dimension carrying scenario references

- **WHEN** an entry records an open dimension
- **THEN** it records a planned tier and nothing else; the ledger cannot
  express scenario references on an open dimension

#### Scenario: Every dimension proven

- **WHEN** an entry's open set becomes empty because each dimension is proven
  at its declared tier
- **THEN** the behavior is reported as qualified and no longer appears in the
  unqualified set
