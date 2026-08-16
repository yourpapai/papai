<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Makes the Context Vault indexer runnable: a real daemon entrypoint, a registration
channel so one daemon serves every repo a coding agent opens, and the operator
documentation for standing it up.

## MODIFIED Requirements

### Requirement: Single shared indexer process per machine

The indexer SHALL be distributed as a coding-agent plugin but SHALL NOT watch or
push in-process. On activation the plugin SHALL check a lock file containing a PID
and heartbeat: if a live process holds it, the plugin SHALL register its repository
with that daemon over the IPC channel instead of taking no action; otherwise it
SHALL spawn the detached indexer daemon, hand the lock off to the daemon's PID, and
then register its repository. A stale lock (dead PID or expired heartbeat) SHALL be
reclaimed, so any number of concurrent coding-agent sessions yield exactly one
indexer process per machine/user, watching every repository they registered.

A registration attempt that fails SHALL be logged as a warning and SHALL NOT throw
into the coding-agent session.

#### Scenario: Second activation registers instead of no-oping

- **WHEN** a second coding-agent session activates the plugin for a different
  repository while a live daemon holds the lock
- **THEN** no additional daemon process is started, and the running daemon begins
  scanning the second repository on its next tick

#### Scenario: Stale lock reclaim

- **WHEN** the lock file references a dead PID or an expired heartbeat
- **THEN** the activating plugin reclaims the lock, starts a new daemon, and
  registers its repository with it

#### Scenario: Daemon unreachable during registration

- **WHEN** the lock reads as held but no process is listening on the IPC socket
- **THEN** the adapter retries a bounded number of times, then logs a warning and
  returns without throwing, leaving the coding-agent session unaffected

## ADDED Requirements

### Requirement: Runnable daemon entrypoint with file config and env-only token

The package SHALL ship an executable entrypoint that wires concrete filesystem and
HTTP implementations into the daemon loop and is spawnable as
`bun run <entry> <stateDir>`. It SHALL read its configuration from a JSON file in
the state directory, validated against a schema covering the push URL, the scan
interval, and the registered repository list.

The vault bearer token SHALL be read **only** from the environment
(`CONTEXT_VAULT_TOKEN`) and SHALL NOT be read from, or written to, the config file
or any other file. A missing or empty token SHALL cause the entrypoint to exit
non-zero with a diagnostic instead of running unauthenticated. The token SHALL never
appear in a log record, an error message, or the config file the daemon rewrites.

An unreadable or schema-invalid config file SHALL cause a non-zero exit with a
message naming the offending file, rather than a silent fallback to defaults.

#### Scenario: Entry starts from config file

- **WHEN** the entrypoint is started with a state directory holding a valid config
  file and `CONTEXT_VAULT_TOKEN` set
- **THEN** it acquires the singleton lock, begins scanning every configured
  repository, and pushes deltas to the configured URL with that bearer token

#### Scenario: Missing token

- **WHEN** the entrypoint is started with no `CONTEXT_VAULT_TOKEN` in the environment
- **THEN** it exits non-zero with a diagnostic and pushes nothing

#### Scenario: Malformed config

- **WHEN** the config file is absent, unparseable, or fails schema validation
- **THEN** the entrypoint exits non-zero naming the file, and does not start a scan
  loop under default values

#### Scenario: Token stays out of persisted state

- **WHEN** the daemon rewrites its config file after a registration
- **THEN** the written file contains the repository list and settings but no token
  value

### Requirement: IPC repository registration against the running daemon

The daemon SHALL listen on a unix domain socket inside its state directory and
accept newline-delimited JSON requests to register a repository (a repository name
and a spec directory) and to report status (the registered repositories and last
scan time). Requests SHALL be schema-validated and size-capped; an unknown operation
or a malformed request SHALL receive an error response and SHALL NOT alter daemon
state.

A registration SHALL take effect on the daemon's next scan tick without a restart,
and SHALL be persisted to the config file so it survives a daemon restart. A
registration naming a spec directory that does not exist SHALL be rejected with an
error response.

The socket SHALL be created with owner-only permissions, and a stale socket file
left by a dead daemon SHALL be removed before binding — only after the singleton
lock is held, so a live daemon's socket is never unlinked.

#### Scenario: Register a new repository

- **WHEN** a client sends a register request for a repository not yet watched
- **THEN** the daemon acknowledges it, includes it in the next scan tick, and records
  it in the config file

#### Scenario: Re-register an unchanged repository

- **WHEN** a client registers a repository and spec directory already registered
- **THEN** the daemon acknowledges it as unchanged and neither duplicates the entry
  nor resets its scan state

#### Scenario: Registration survives restart

- **WHEN** the daemon is stopped and started again after a registration
- **THEN** it resumes scanning the registered repository from its persisted config
  without a new registration

#### Scenario: Malformed or oversized request

- **WHEN** a client sends an unknown operation, an invalid body, or a body over the
  size cap
- **THEN** the daemon responds with an error, leaves its repository set unchanged,
  and keeps serving subsequent requests

#### Scenario: Nonexistent spec directory

- **WHEN** a register request names a spec directory that does not exist
- **THEN** the daemon rejects it with an error and does not add it to the config file

### Requirement: Worktree collapsing to one repository identity

Registration SHALL resolve a spec directory to its owning repository, treating a git
worktree as the repository it belongs to rather than as a separate repository, so
several worktrees of one project produce exactly one vault entry.

Registering a different worktree of an already-registered repository SHALL update
that repository's active spec directory rather than adding a second entry. Scan
state SHALL be keyed per repository identity so that re-pointing the active
directory diffs against the same ledger instead of re-pushing every file as new.

#### Scenario: Two worktrees, one repository

- **WHEN** sessions register two worktrees of the same repository
- **THEN** the daemon holds one entry for that repository and papai lists one spec
  set for it, not two

#### Scenario: Re-point to the active worktree

- **WHEN** a session registers a second worktree of a repository already registered
  from a different directory
- **THEN** the daemon updates that repository's spec directory to the newly
  registered one and pushes only the resulting content differences

#### Scenario: Distinct repositories stay distinct

- **WHEN** sessions register spec directories belonging to two different repositories
- **THEN** the daemon watches both independently, each with its own scan state

### Requirement: Operator documentation for the Context Vault plugin

The plugin directory SHALL carry a README covering the end-to-end operator path:
approving and enabling the plugin, minting and revoking a vault token in the settings
UI, the two tools it contributes and their gating, configuring and starting the
indexer beside a coding agent, and how to verify that pushes are arriving.

The README SHALL NOT instruct the operator to restart the bot to activate the plugin
after approval, and SHALL NOT show a real token value in any example.

#### Scenario: Operator follows the README

- **WHEN** an operator follows the README from an unapproved plugin to a running
  indexer
- **THEN** every step needed is present — approval, enablement, token creation,
  indexer config, start command, and a verification step

#### Scenario: Documented activation matches behavior

- **WHEN** the README describes what happens after plugin approval
- **THEN** it states that approval activates the plugin in-process, and names
  discovery of newly added plugin directories as the only restart-requiring step
