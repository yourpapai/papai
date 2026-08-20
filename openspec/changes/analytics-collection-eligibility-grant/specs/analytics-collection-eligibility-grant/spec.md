<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the production path by which a consenting subject is granted a
purpose-keyed collection-eligibility ref, so the pseudonymous analytics lanes
can emit events at all, and the symmetric path by which that ref is cleared.

## ADDED Requirements

### Requirement: Consent grants a purpose-keyed eligibility ref

When a subject selects a pseudonymous analytics lane through the settings
preference handler, the system SHALL derive the collection ref key for that
subject and purpose and persist an `allow` eligibility row, in the same
transaction as the preference write.

#### Scenario: Subject opts into a pseudonymous lane

- **WHEN** the settings preference handler stores `local_pseudonymous` or
  `external_pseudonymous` for a subject
- **THEN** an `allow` row exists for the derived ref key, and the next
  eligibility decision for that subject and lane no longer denies with
  `governance_incomplete`

#### Scenario: Aggregate lane needs no ref

- **WHEN** the subject selects `local_aggregate` or `external_aggregate`
- **THEN** no eligibility row is written, and the aggregate lane decision is
  unchanged

### Requirement: Grant and preference are atomic

A stored pseudonymous preference SHALL NOT exist without its eligibility ref.
If the grant cannot be written, the preference write SHALL fail as a unit and
persist nothing.

#### Scenario: Grant write fails

- **WHEN** persisting the eligibility row raises
- **THEN** the preference write rolls back, the handler returns an error, and
  the subject's previously stored lane is unchanged

### Requirement: Leaving a pseudonymous lane clears the ref

When a subject moves off a pseudonymous lane, the system SHALL clear the
eligibility ref through the existing revocation path, in the same transaction
as the preference write.

#### Scenario: Subject switches to an aggregate lane

- **WHEN** the stored lane changes from `external_pseudonymous` to
  `local_aggregate`
- **THEN** the eligibility row is no longer in state `allow`, and the next
  pseudonymous decision for that subject denies

#### Scenario: Subject turns analytics off

- **WHEN** the stored lane changes to `off`
- **THEN** the eligibility row is no longer in state `allow`

### Requirement: No grant without consent

The system SHALL grant collection eligibility only from an explicit subject
consent record. Startup, bootstrap, admin action, and default configuration
SHALL NOT produce an `allow` row.

#### Scenario: Runtime start with a stored pseudonymous preference and no ref

- **WHEN** the analytics runtime starts for a subject whose stored lane is
  pseudonymous but who has no eligibility row
- **THEN** the decision denies with `governance_incomplete` and no row is
  created

### Requirement: The ref never exposes the raw subject

The persisted ref key SHALL be a purpose-keyed pseudonym derived through the
governance keyring under the `collection-eligibility:v1` domain. The raw
subject identifier SHALL NOT be persisted in the eligibility row nor appear in
any log record.

#### Scenario: Grant is logged

- **WHEN** the grant succeeds and emits a log record
- **THEN** the record names the lane and the derived ref key, and contains no
  raw subject identifier and no keyring material
