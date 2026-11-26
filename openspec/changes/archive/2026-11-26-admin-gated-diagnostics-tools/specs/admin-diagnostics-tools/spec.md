<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Gives bot admins a read-only, secret-free runtime diagnostics tool in DM
conversations so they can inspect bot health (instances, LLM config
resolution, MCP pool, queue, uptime) without reaching for logs or the
settings UI.

## ADDED Requirements

### Requirement: Diagnostics tools are gated on admin, DM, and normal mode

The diagnostics tool family SHALL be present in a turn's toolset only when
the actor that triggered the turn is a recognized bot admin, the
conversation context is a direct message, and the run mode is `normal`.
The gate SHALL fail closed: when the admin flag is absent or false, no
diagnostics tools SHALL be assembled regardless of any other option. The
same rule SHALL apply identically across every platform instance.

#### Scenario: Admin DM exposes the diagnostics tool

- **WHEN** a message from a recognized bot admin in a DM context is processed in normal mode
- **THEN** the assembled toolset includes `run_diagnostics`

#### Scenario: Non-admin DM excludes diagnostics

- **WHEN** a message from a recognized non-admin user in a DM context is processed in normal mode
- **THEN** the assembled toolset contains no diagnostics tools

#### Scenario: Missing admin flag fails closed

- **WHEN** tools are assembled without an admin flag (for example the
  `/context` tool-resolution path)
- **THEN** the assembled toolset contains no diagnostics tools

#### Scenario: Group context excludes diagnostics even for admins

- **WHEN** a bot admin sends a message in a group, including a
  thread-scoped group conversation
- **THEN** the assembled toolset contains no diagnostics tools

#### Scenario: Proactive runs exclude diagnostics

- **WHEN** tools are assembled for a proactive run (deferred prompts,
  schedulers), which resolves no per-message admin identity
- **THEN** the assembled toolset contains no diagnostics tools

#### Scenario: Guest-mode users never see diagnostics

- **WHEN** an unrecognized user is granted the guest-mode read-only toolset
- **THEN** that guest toolset contains no diagnostics tools

### Requirement: Turn identity survives queueing and coalescing

The toolset of a turn SHALL reflect the bot-admin status and platform
instance resolved when the triggering message was authorized. When the
message queue coalesces multiple pending messages from the same context
into one run, the run SHALL carry the admin status and platform instance
of the last coalesced message.

#### Scenario: Admin identity is carried into the turn

- **WHEN** an authorized admin message is enqueued and later dequeued for
  processing, including after coalescing with a newer message from the
  same context
- **THEN** the turn's tool assembly resolves the admin status of the
  triggering (last coalesced) message

#### Scenario: Non-admin identity is carried unchanged

- **WHEN** a non-admin message is enqueued and processed
- **THEN** the turn's tool assembly resolves a non-admin status and the
  diagnostics tools stay absent

### Requirement: Cached tool descriptors never cross admin status

Tool-descriptor caches SHALL be keyed such that a context is never served
descriptors assembled under a different admin status than the current
turn's, and existing context-scoped descriptor invalidation SHALL continue
to clear cached descriptors after configuration changes.

#### Scenario: Admin status change rebuilds descriptors

- **WHEN** descriptors were cached for a context under one admin status
  and the next turn for that context resolves a different admin status
- **THEN** the previously cached descriptors are not reused and the
  toolset is rebuilt to match the current turn's admin status

### Requirement: run_diagnostics returns a bounded, secret-free snapshot

The `run_diagnostics` tool SHALL return only whitelisted count, boolean,
enum, and duration fields: platform instance active state, task instance
configuration state (configured with id and type only, or not configured —
never decrypted configuration), LLM config resolution status (central,
BYOK, or unconfigured — never keys or credential-bearing URLs), MCP pool
health, active queue count, tool-descriptor cache presence, and uptime.
It SHALL NOT include tokens, API keys, session cookies, decrypted
configuration bodies, or raw logs, neither in the tool result nor in log
output.

#### Scenario: Healthy snapshot

- **WHEN** an admin invokes `run_diagnostics` in a DM while the platform
  instance is active, a task instance is configured, and a central LLM
  config resolves
- **THEN** the result reports those states as counts, booleans, and enums
  with no secret material

#### Scenario: Unconfigured task instance reports not configured

- **WHEN** the conversation's task instance is not configured (null)
- **THEN** the snapshot reports the task instance as not configured
  instead of failing

#### Scenario: Snapshot reflects the origin platform instance

- **WHEN** multiple platform instances are configured and an admin in one
  instance's DM invokes `run_diagnostics`
- **THEN** the reported platform instance state is the one the
  conversation belongs to

### Requirement: run_diagnostics obeys tool preferences

`run_diagnostics` SHALL be subject to per-context `tool_prefs`
three-state resolution like every other tool, with implicit `allow` as
default. `deny` SHALL remove it from the toolset even for a qualifying
admin; `ask` SHALL expose it wrapped so each call requires explicit
per-call user permission, and an ungranted call SHALL return the
structured permission-denied result; `allow` SHALL expose and execute it
unwrapped.

#### Scenario: Deny removes the tool for an admin

- **WHEN** an admin DM context resolves `deny` for `run_diagnostics`
- **THEN** the toolset assembled for that turn contains no diagnostics
  tools

#### Scenario: Ask gates each call

- **WHEN** an admin DM context resolves `ask` and the model calls
  `run_diagnostics` without the user granting per-call permission
- **THEN** the tool returns the structured permission-denied result
  without running the snapshot

### Requirement: Diagnostics execution is read-only with structured failures

`run_diagnostics` SHALL NOT mutate conversation, configuration, task, or
memory state. Internal failures during snapshot collection SHALL surface
as structured tool-failure results rather than uncaught exceptions.

#### Scenario: Internal failure is reported, not thrown

- **WHEN** a subsystem probe inside `run_diagnostics` throws
- **THEN** the tool returns a structured failure result and the turn
  continues

#### Scenario: No state changes

- **WHEN** `run_diagnostics` completes successfully
- **THEN** no conversation, configuration, task, or memory state has been
  modified
