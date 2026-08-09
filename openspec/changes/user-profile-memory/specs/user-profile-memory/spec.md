<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines a per-user markdown profile memory: a background-extracted blob
about each user, injected into DM system prompts for personalization and
editable via explicit LLM tools, with group contexts strictly excluded.

## ADDED Requirements

### Requirement: Per-user profile storage

The system SHALL store at most one markdown profile blob per platform user
id in a `user_profile` table and SHALL expose load/save/clear operations.
Profile state is per-user and SHALL NOT be keyed by storage context or
config context.

#### Scenario: First profile write

- **WHEN** extraction or an explicit edit produces a profile for a user
  with no row
- **THEN** a new row is inserted keyed by that user's platform user id

#### Scenario: Isolation across users

- **WHEN** two users in the same group each have profiles
- **THEN** each load returns only the requesting user's blob

### Requirement: DM-only prompt injection

The system SHALL render an `=== User profile ===` section containing the
blob into the system prompt only when `contextType` is `dm`, and SHALL NOT
render it in group contexts.

#### Scenario: DM turn with profile

- **WHEN** a DM turn builds messages and a profile blob exists
- **THEN** the system prompt includes the profile section and the DM-only
  profile rules

#### Scenario: Group turn

- **WHEN** a group turn builds messages for a user who has a profile
- **THEN** no profile section, profile rules, or profile tools appear

### Requirement: Background extraction with failure safety

The system SHALL run profile extraction in the background alongside the
existing trim trigger for DM conversations only, and SHALL keep the
previous blob when extraction output fails validation or the model call
errors.

#### Scenario: Extraction validation failure

- **WHEN** the extraction model returns malformed or oversized content
- **THEN** the stored blob is unchanged and a warning is logged

### Requirement: Explicit-edit tools

The system SHALL provide `remember_about_user` and `forget_user_profile`
tools available only in DM contexts, subject to `tool_prefs`
allow/ask/deny resolution with the standard confirmation flow for `ask`.

#### Scenario: Guest or group invocation

- **WHEN** a group context or guest-mode session would receive the tool
  list
- **THEN** neither profile tool is present

#### Scenario: Ask-permission edit

- **WHEN** `remember_about_user` is invoked under an `ask` permission
- **THEN** the standard confirmation prompt gates the edit

### Requirement: User-facing inspection and clearing

The system SHALL provide `/profile` (view) and `/profile clear` commands in
DM contexts, include profile lines in `/help`, and include the profile in
the `/context` admin export.

#### Scenario: Clearing

- **WHEN** a user runs `/profile clear` in a DM
- **THEN** the blob and its cache slot are removed and subsequent turns
  render no profile section
