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

When a subject consents to a pseudonymous analytics lane through the settings
preference handler, the system SHALL derive the collection ref key for that
subject and purpose and persist an `allow` eligibility row, in the same
transaction as the preference write.

The handler's consent vocabulary is the two `PreferenceLane` values,
`localLongitudinal` and `externalPseudonymous`, each `allow` or `deny`. Those
are what gate the runtime's `local_pseudonymous` / `external_pseudonymous`
lanes, so "consents to a pseudonymous lane" below means either preference lane
reading `allow` after the write.

#### Scenario: Subject opts into a pseudonymous lane

- **WHEN** the settings preference handler stores `allow` for
  `localLongitudinal` or `externalPseudonymous`
- **THEN** an `allow` row exists for the derived ref key, and the next
  eligibility decision for that subject and lane no longer denies with
  `governance_incomplete`

#### Scenario: A subject who consents to neither lane needs no ref

- **WHEN** the write leaves both preference lanes reading `deny`
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

#### Scenario: Subject withdraws one of two consents

- **WHEN** `externalPseudonymous` changes to `deny` while `localLongitudinal`
  still reads `allow`
- **THEN** the eligibility row stays in state `allow`, because consent to
  either lane is consent to collect

#### Scenario: Subject withdraws every consent

- **WHEN** the write leaves both preference lanes reading `deny`
- **THEN** the eligibility row is no longer in state `allow`, and the next
  pseudonymous decision for that subject denies

### Requirement: No grant without consent

The system SHALL grant collection eligibility only from an explicit subject
consent record. Startup, bootstrap, admin action, and default configuration
SHALL NOT produce an `allow` row.

#### Scenario: Runtime start with a stored pseudonymous preference and no ref

- **WHEN** the analytics runtime evaluates a fact for a subject whose stored
  preference lane reads `allow` but who has no eligibility row
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
