<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets an authenticated actor grant and revoke their own local-pseudonymous
analytics collection eligibility through the settings preferences surface, so
the local pseudonymous lane actually collects canonical events for opted-in
actors and fails closed for everyone else.

## ADDED Requirements

### Requirement: Preference opt-in provisions collection eligibility

The system SHALL, when an authenticated actor sets their
`localLongitudinal` preference to `allow` through the settings preferences
API, provision that actor's collection eligibility reference with state
`allow` in the same logical operation as the preference write. The eligibility
reference SHALL be derived from the actor's authenticated platform instance
and platform user identity (per-user scope), never from client-supplied
identity parameters.

#### Scenario: Opt-in makes canonical collection work

- **WHEN** an authenticated actor PUTs `localLongitudinal: "allow"` and then
  performs chat activity while the policy's local mode is `local_pseudonymous`
- **THEN** their subsequent analytics facts pass the eligibility gate and
  canonical events are stored for them

#### Scenario: Identity comes from the session

- **WHEN** the preferences request carries any client-supplied actor identity
  parameter
- **THEN** the request is rejected and no eligibility is provisioned from it

### Requirement: Preference opt-out revokes collection eligibility

The system SHALL, when an authenticated actor sets their `localLongitudinal`
preference to `deny`, transition that actor's collection eligibility reference
to `deny` with a generation bump, so that subsequent canonical event insertion
attempts for that actor are refused and classified governance-ineligible at
write time.

#### Scenario: Opt-out stops new canonical events

- **WHEN** an actor with an existing `allow` eligibility reference PUTs
  `localLongitudinal: "deny"` and then performs chat activity
- **THEN** no new canonical events are stored for that actor and the events
  land in the aggregate-only disposition

#### Scenario: Revoke is idempotent

- **WHEN** `localLongitudinal: "deny"` is set twice
- **THEN** the second write succeeds and the eligibility state remains `deny`
  with no error

### Requirement: Revocation holds against later re-allows

The system SHALL keep revocation monotonically generation-stamped: a later
re-allow provisions a new `allow` state, and any event insertion already
refused under the denied generation SHALL NOT be retroactively admitted. The
withdraw and delete subject-rights flows continue to revoke eligibility
independently of preferences.

#### Scenario: Withdraw then re-allow

- **WHEN** an actor withdraws analytics (subject rights), then later re-allows
  via preferences
- **THEN** events deleted by withdrawal stay deleted and only post-re-allow
  activity is collected

### Requirement: Guests are never provisioned

The system SHALL NOT provision collection eligibility for guests: the
pseudonymous lanes deny guest-role actors regardless of any eligibility state,
and guest turns remain aggregate-only by design.

#### Scenario: Guest actor

- **WHEN** a guest-role actor's activity occurs while local mode is
  `local_pseudonymous`
- **THEN** the activity is recorded aggregate-only and no guest longitudinal
  rows exist
