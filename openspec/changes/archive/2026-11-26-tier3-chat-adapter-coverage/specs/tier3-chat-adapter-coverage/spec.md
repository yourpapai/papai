<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Defines the Tier 3 proving records for Discord and Mattermost adapter
behaviors that currently ship unproven — reply-to-bot mention equivalence,
live-status lifecycles on both platforms, and Mattermost thread-root reply
propagation — and the fake-boundary surfaces those records depend on.

## ADDED Requirements

### Requirement: Discord reply-to-bot mention equivalence

A Discord message that replies to a bot-authored message SHALL be dispatched
through the real provider exactly as an explicit @-mention of the bot, and the
proving scenario SHALL resolve the parent through the injected fake client's
`messages.fetch` surface rather than a stubbed helper.

#### Scenario: Reply without explicit mention

- **WHEN** a guild message with `messageReference` pointing at a seeded
  bot-authored parent arrives and its content contains no bot mention
- **THEN** the adapter dispatches it to the agent with the same normalized
  message the equivalent explicit-mention input produces

#### Scenario: Reply to a non-bot message

- **WHEN** the referenced parent was authored by another user and the content
  carries no bot mention
- **THEN** the adapter dispatches nothing

### Requirement: Discord live-status lifecycle record

The Tier 3 lane SHALL prove the Discord live-status create/update/dismiss
ordering against the fake client, including the fallback taken when the status
message cannot be sent.

#### Scenario: Status create, update, dismiss

- **WHEN** an agent turn emits successive status updates and then completes
- **THEN** the fake client records one status send, the updates in emission
  order, and a dismissal, with no status edits after the dismissal

#### Scenario: Status send fails once

- **WHEN** `failNextChannelSend` rejects the initial status send
- **THEN** the turn still delivers its final reply and no further status edit
  or delete is attempted

### Requirement: Mattermost thread-root reply propagation

The Tier 3 lane SHALL prove in-container that a message delivered with a
`root_id` is answered into the same thread, keeping conversation state
thread-isolated.

#### Scenario: Reply carries the thread root

- **WHEN** the fake Mattermost server delivers a post whose `rootId` names an
  existing thread root
- **THEN** the adapter's outbound post carries the same `root_id`, and the
  storage context id used for the turn is the thread-scoped one

### Requirement: Mattermost live-status mutation lifecycle

The Tier 3 lane SHALL prove the Mattermost live-status lifecycle through the
real adapter using the fake server's ordered mutation capture.

#### Scenario: Patch then delete

- **WHEN** an agent turn emits status updates and then completes
- **THEN** `postMutations()` records the status post creation, each update as
  a `PUT /api/v4/posts/:id/patch` in emission order, and a terminating
  `DELETE /api/v4/posts/:id`

### Requirement: Additive fake-boundary extensions

Extensions to the shared fake Mattermost server SHALL be additive — new
optional fields, routes, and accessors only — so the Tier 2 smoke lane passes
unchanged, and fake surfaces SHALL expose only APIs the production adapter
consumes.

#### Scenario: Tier 2 smoke unaffected

- **WHEN** the fake-server extensions land
- **THEN** `bun test:smoke` passes with no edits to any Tier 2 scenario

#### Scenario: Cleanup still strict

- **WHEN** a scenario leaves a pending listener, request, or client resource
- **THEN** harness cleanup fails the scenario

### Requirement: Catalog registration

Each new scenario SHALL be registered one-to-one in `PLATFORM_STORIES` and in
`tests/stories/catalog/coverage.ts` with `provingTier: '3'` and seam
`platform-adapter-fakes`, and the cross-check SHALL assert the raised Tier 3
cardinality.

#### Scenario: Cross-check enforces cardinality

- **WHEN** `tests/platform/catalog-crosscheck.test.ts` runs after the records
  land
- **THEN** it asserts sixteen Tier 3 records and fails if a scenario module is
  registered in one catalog but not the other
