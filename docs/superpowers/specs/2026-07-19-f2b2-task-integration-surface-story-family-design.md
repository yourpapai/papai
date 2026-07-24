<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: F2b-2 task integration-surface story family

**Status:** approved

**Date:** 2026-07-19

## Context

F2b-2 is the second half of F2b: the 4 seam-carrying provider-surface scenarios —
`collaboration`, `identity`, `attachments`, `youtrack-command`. F2b-1 delivered the 7
pure provider-method scenarios. Landing F2b-2 completes the `task-*` family (21 of 21
executable) and moves the ledger from 65 to 69 executable stories.

Each scenario carries an extra seam beyond provider methods and capability ids:
collaboration needs watchers/votes/visibility semantics; identity needs the member
provisioning backstop that fires on group turns; attachments needs the incoming-file
relay with an in-memory blob store (production S3 ingest is inert in the sandbox);
youtrack-command needs configurable provider traits plus `applyCommand`.

Research basis: F2 provider-surface research (tool inventory, interface gaps
`src/providers/types.ts`, attachment relay path `src/attachments/` +
`src/bot-attachments.ts`, provisioning backstop `src/providers/membership/ensure-member.ts`

- `src/llm-orchestrator-membership.ts`, command tool `src/tools/apply-youtrack-command.ts`,
  traits capture in `tests/stories/harness/fixtures.ts`).

## Seam 1: production capability ids (12 entries)

Extend `CORE_TOOL_CAPABILITIES`:

- `tasks.watchers.list/add/remove` → `list_watchers`/`add_watcher`/`remove_watcher`
- `tasks.votes.add/remove` → `add_vote`/`remove_vote`
- `tasks.visibility.set` → `set_visibility`
- `tasks.identity.find` → `find_user`; `tasks.identity.current` → `get_current_user`
- `tasks.attachments.list/upload/delete` → `list_attachments`/`upload_attachment`/
  `remove_attachment`
- `tasks.commands.apply` → `apply_youtrack_command`

## Seam 2: MemoryTaskProvider — collaboration and identity

**Collaboration** (conventions as established):

- Watchers: `watchers: Map<taskId, UserRef[]>` — `listWatchers` / `addWatcher`
  (duplicate → `Task watcher already exists: <userId>`) / `removeWatcher`
  (`Task watcher not found: <userId>`).
- Votes: `votedTasks: Set<taskId>` — `addVote` (idempotent, returns `{ taskId }`;
  the tool carries no user) / `removeVote` (`Task vote not found: <taskId>`).
- Visibility: `setVisibility(taskId, params)` stores the `TaskVisibility` on the task
  (`public`, or `restricted` with `userIds`/`groupIds` — the tool schema already
  requires ≥1 id for restricted; the provider stores truthfully and `getTask` reflects
  it).

**Identity:**

- `listUsers(query?, limit?)` — searches the provider's existing `identityUsers` map
  (seeded via `given.providerUser`), returning `UserRef[]`.
- `getCurrentUser()` — returns a test-seeded current user: `setCurrentUser(userRef)`
  provider test API (same role as `addIdentityUser`).
- `provisionWorkspaceMember(member, opts?)` — records every call in a public
  `provisionCalls` read (for assertions) and returns
  `{ providerUserId: 'prov-<login>', login, password: 'memory-password' }`.
- Capability additions: `'tasks.watchers'`, `'tasks.votes'`, `'tasks.visibility'`,
  `'members.provision'` (plus `'attachments.list'`, `'attachments.upload'`,
  `'attachments.delete'`, `'tasks.commands'` for seams 3–4).

The provisioning backstop (`ensureWorkspaceMember`, fire-and-forget on every group
turn for non-guest actors) then fires automatically in the identity story: a group
message triggers `provisionWorkspaceMember`, and the story asserts the recorded call
plus the `kaneoWorkspaceMembers` DB row via the production read helper.

## Seam 3: attachments — relay fixture and provider methods

**`given.attachment(context, { filename, content, mimeType? })`** (harness fixture):

1. Installs the in-memory blob store via
   `setBlobStoreForTesting(createInMemoryBlobStoreForTesting())` (both exported from
   `src/attachments/`), replacing the S3 default that throws in the sandbox. Installed
   once per scenario world, before any `saveAttachment`.
2. Calls the real `saveAttachment` with the scenario storage context id and returns an
   opaque handle carrying the `att_…` id for scripting.

Production message-level ingest (`IncomingMessage.files`) stays untested — it requires
S3 configuration and adapter file plumbing, which is adapter-territory (Tier 3), not a
story-harness gap.

**Provider methods:** `attachments: Map<taskId, Attachment[]>` — `listAttachments` /
`uploadAttachment` (stores metadata; size from content length; id
`attachment-<counter>`) / `deleteAttachment` (`Attachment not found: <id>`).

## Seam 4: traits setter and `applyCommand`

- `setTraits(traits: readonly TaskProviderTrait[])` — **mutates the existing
  `traits` set in place** (the provider registry captures the set by reference at
  registration; replacing it would silently drop the new traits).
- `applyCommand(params)` — records every call in a public `commandCalls` read and
  returns the real `TaskCommandResult` echo `{ query, taskIds, comment?, silent? }`.
- The story seeds traits `['command-language:youtrack', 'supports-command-language']`
  and capability `'tasks.commands'` (all three are required for
  `apply_youtrack_command` assembly: trait + capability + method).

## Story file

`tests/stories/tasks/integration-surface.story.test.ts` — 4 scenarios. DM + assigned
instance + minimal `given.taskCapabilities([...])` unless noted.

| Scenario                    | Shape                                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCN-task-collaboration`    | Create task → `add_watcher` → `list_watchers` → duplicate add surfaces the error → `remove_watcher` → `add_vote` → `remove_vote` → `set_visibility` restricted with `userIds` → task reflects it → `set_visibility` public → cleared                                                     |
| `SCN-task-identity`         | Seed provider users + current user → `find_user` (query match) → `get_current_user` → a GROUP turn (group context, member actor) fires the backstop: `provisionCalls` recorded + `kaneoWorkspaceMembers` row present (read via the production helper)                                    |
| `SCN-task-attachments`      | `given.attachment(dm, { filename: 'spec.txt', content })` → create task → `upload_attachment` with the returned `att_` id → `list_attachments` shows it (name + size) → `remove_attachment` with confidence → list empty; uploading an unknown `att_` id surfaces `attachment_not_found` |
| `SCN-task-youtrack-command` | Seed traits + capability → `apply_youtrack_command` (`{ query: 'state Fixed', taskIds: ['task-1'], confidence: 0.9 }`) → `commandCalls` recorded with the exact payload → bulk (`taskIds` ×2) is rejected by the tool (no provider call) → scripted reply conveys it                     |

## Deliberate exclusions

- Message-level attachment ingest (adapter territory, needs S3 config).
- `describe_project` / `custom-fields` tooling beyond `supportsCustomFields` (already
  true) — the trait exists but no scenario consumes it in this family.
- `get_current_user` in non-identity contexts; `preferredUserIdentifier` behavior.
- Promoting `setTraits`/`setCurrentUser`/`provisionCalls`/`commandCalls` to `given.*`
  DSL (provider test API; promote on second consumer).

## Ledger updates (same PR, roadmap rule 5)

Four `AUDIT_RECORDS` entries move to `EXECUTABLE_STORY_MAPPINGS` with
`verifiedAt: '2026-07-19'`. Totals: 128 ids / 69 executable / 59 pending; readiness
`{2, 35, 22}`. The runner totals line follows.

## Risks

1. **The backstop is fire-and-forget** — the group-turn assertion must poll for the
   provisioned row (bounded, no wall-clock sleep; the F2a ask-flow pattern), not read
   synchronously.
2. **In-memory blob store lifetime** — installed per scenario world; the harness
   teardown already resets test hooks (`mock-reset` covers `setBlobStoreForTesting`
   per its existing reset list — verify at implementation; add if missing).
3. **Traits mutation in place** — contract-tested: traits seeded after provider
   registration must be visible to tool assembly (proves the mutate-in-place rule).

## Success criteria

- 4 new scenarios pass sandboxed (`bun test:stories`: 73 → 77); `task-*` is 21/21.
- Ledger: 69 executable / 59 pending; runner prints the updated totals.
- `bun test:stories:contracts`, typecheck, and lint stay green; the compat baseline is
  re-recorded after landing.
