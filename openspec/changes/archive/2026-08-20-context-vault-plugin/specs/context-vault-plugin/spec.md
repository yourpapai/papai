<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Purpose

Lets Papai act as external memory for OpenSpec-based coding-agent sessions:
an indexer pushes parsed spec structures per config-context, and chat users
query them through exactly two read-only tools.

## ADDED Requirements

### Requirement: Per-context token management in the settings UI

The system SHALL let a user create, list, and revoke multiple Context Vault
tokens per config-context from a settings-UI section, reusing the existing
settings session authentication. Each token SHALL carry a user-supplied
label, and the system SHALL store only a SHA-256 hash of the token —
the plaintext SHALL be shown exactly once at creation and SHALL never be
logged or retrievable afterwards.

#### Scenario: Create token

- **WHEN** a user creates a token with a label in the settings UI
- **THEN** the plaintext token is returned once, and subsequent list calls
  show only a masked form with label, creation time, and last-used time

#### Scenario: Multiple tokens per context

- **WHEN** a user issues separate tokens for two machines in the same
  config-context
- **THEN** both are active independently and revoking one leaves the other
  functional

#### Scenario: Revoke token

- **WHEN** a user revokes a token
- **THEN** the row is marked revoked and any push presenting that token is
  rejected

#### Scenario: Unauthenticated settings access

- **WHEN** a request without a valid settings session hits the token routes
- **THEN** it is rejected without revealing token data

### Requirement: Bearer-authenticated push API with per-context isolation

The system SHALL expose a push endpoint that authenticates by hashing the
presented bearer token and matching a non-revoked token row, resolving the
owning config-context. Pushes SHALL be idempotent per
`(config-context, repo:change-name, file path)` keyed on the source content
hash: a file whose hash matches the stored hash is a no-op, and listed
deletions remove the corresponding stored files. Data of one config-context
SHALL NOT be visible to another context's tokens, tools, or queries.

#### Scenario: First push

- **WHEN** an indexer pushes files for `repo:change-name` with a valid token
- **THEN** the file hashes, kinds, and mtimes are stored under the owning
  config-context

#### Scenario: Idempotent re-push

- **WHEN** an indexer re-pushes a file whose content hash is unchanged
- **THEN** no index or summary state changes

#### Scenario: Revoked or unknown token

- **WHEN** a push presents a revoked or unknown bearer token
- **THEN** the request is rejected and nothing is stored

#### Scenario: Cross-context isolation

- **WHEN** two config-contexts each index a change with the same name
- **THEN** each context's queries return only its own entries

### Requirement: Summary generation with no raw-text retention

The system SHALL distinguish mechanical files (e.g. `tasks.md`) from
semantic files (proposal, design, specs). Mechanical files SHALL update
index progress only. Semantic files pushed with a new hash SHALL enqueue
summary and one-line regeneration as background work outside any chat
conversation, using the configured LLM. Raw file text SHALL be discarded
after summarization and full texts SHALL never be persisted. A failed
summarization SHALL keep the previous summary and SHALL be logged without
secret or token material.

#### Scenario: Semantic file with new hash

- **WHEN** a proposal file arrives with a hash different from the stored one
- **THEN** a summary job is enqueued and, on completion, the stored
  one-line, summary, and outline reflect the new content while the raw
  text is not retained

#### Scenario: Mechanical file update

- **WHEN** only `tasks.md` changes between pushes
- **THEN** progress is recomputed and no summary job is enqueued

#### Scenario: Summarization failure

- **WHEN** the background summarization call errors or returns unusable
  output
- **THEN** the previously stored summary remains and a warning is logged

### Requirement: Mechanical stage and progress derivation

The system SHALL derive each change's stage without an LLM: proposal only →
`draft`; plan or design present → `approved`; some `tasks.md` checkboxes
ticked → `in-progress` with a percentage; all checkboxes ticked or the
change moved to `archive/` → `done`.

#### Scenario: Stage transitions

- **WHEN** a change gains a design file, then partially ticked tasks, then
  all tasks ticked
- **THEN** the stored stage moves `approved` → `in-progress` → `done` with
  the progress percentage tracking the ticked ratio

#### Scenario: Archived change

- **WHEN** a pushed change resides under an archive directory
- **THEN** its stage is reported as `done`

### Requirement: Exactly two chat tools with standard gating

The system SHALL provide exactly two tools — `list_agent_specs` and
`get_agent_spec` — through a first-party `context-vault` plugin with
group-scoped storage, mirroring the `list_tasks`/`get_task` surface. Both
tools SHALL be subject to `tool_prefs` allow/ask/deny resolution with the
standard confirmation flow for `ask`, SHALL be read-only, and SHALL be
eligible for the guest-mode read-only toolset. The plugin SHALL function
independently of whether a task instance is configured for the context.

#### Scenario: List output

- **WHEN** `list_agent_specs` is invoked with optional repo, status, and
  changed-since filters
- **THEN** it returns each matching change's name, full `repo:change-name`
  id, one-line, stage, progress, and mtime, plus freshness metadata
  containing the indexer's last push time

#### Scenario: Unique bare-name resolution

- **WHEN** `get_agent_spec` is called with a bare change name that is
  unique across repos in the config-context
- **THEN** it returns the summary, outline, and freshness metadata

#### Scenario: Bare-name collision

- **WHEN** `get_agent_spec` is called with a bare name present in multiple
  repos
- **THEN** it returns a candidate list of full ids instead of a summary

#### Scenario: Ask-permission invocation

- **WHEN** either tool resolves to `ask` under `tool_prefs`
- **THEN** the standard confirmation prompt gates execution

#### Scenario: Guest-mode read-only access

- **WHEN** a guest-mode user in a group with guest mode enabled receives
  the tool list
- **THEN** the tools, if included in the guest read-only set, permit reads
  but the plugin exposes no mutation tools

### Requirement: Single shared indexer process per machine

The indexer SHALL be distributed as a coding-agent plugin but SHALL NOT
watch or push in-process. On activation the plugin SHALL check a lock file
containing a PID and heartbeat: if a live process holds it, the plugin
takes no further action; otherwise it spawns or becomes the detached
indexer daemon. A stale lock (dead PID or expired heartbeat) SHALL be
reclaimed, so any number of concurrent coding-agent sessions yield exactly
one indexer process per machine/user.

#### Scenario: Second activation no-ops

- **WHEN** a second coding-agent session activates the plugin while a live
  daemon holds the lock
- **THEN** no additional watcher or pusher process is started

#### Scenario: Stale lock reclaim

- **WHEN** the lock file references a dead PID or an expired heartbeat
- **THEN** the activating plugin reclaims the lock and starts a new daemon

### Requirement: Crash-safe delta pushing

The daemon SHALL maintain a persistent file-to-content-hash map that
survives restarts, SHALL scan or watch the configured spec directories for
markdown files, parse them into id, outline, stage, progress, and mtime,
and SHALL push only changed or deleted files. Pushes lost while the daemon
was down SHALL be re-pushed on the next scan because the server-side hash
differs.

#### Scenario: Restart after downtime

- **WHEN** spec files changed while the daemon was stopped and it restarts
- **THEN** its persisted hash map differs from disk and the changed files
  are pushed on the next scan

#### Scenario: Deletion propagation

- **WHEN** a spec file present in the hash map is deleted from disk
- **THEN** the next push lists it as a deletion and the server removes the
  stored entry
