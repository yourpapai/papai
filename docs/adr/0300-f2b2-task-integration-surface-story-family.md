<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0300: F2b-2 Task Integration-Surface Story Family — Behavioral Coverage for Collaboration, Identity, Attachments, and YouTrack Commands

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The coverage-expansion roadmap sequences its families by refactor risk and lands F2 (the 21 `task-*` scenarios) in three slices: **F2a** (task lifecycle and policy — ADR-0298), **F2b-1** (the pure provider-method surface — ADR-0299), and **F2b-2** (this ADR). F2b-2 is the final slice: the 4 `task-*` scenarios that each carry an extra seam beyond provider methods and capability ids — `collaboration` (watchers/votes/visibility semantics), `identity` (the member-provisioning backstop that fires on group turns), `attachments` (the incoming-file relay backed by an in-memory blob store), and `youtrack-command` (configurable provider traits plus `applyCommand`). Landing F2b-2 completes the `task-*` family.

The catalog audit classified the 4 F2b-2 scenarios as `needs-seam` pending, each blocked on a distinct production/harness seam: (1) `CORE_TOOL_CAPABILITIES` registered no integration-surface verbs, so `resolveToolCapability('tasks.watchers.*'|'tasks.votes.*'|'tasks.visibility.*'|'tasks.identity.*'|'tasks.attachments.*'|'tasks.commands.apply')` threw and the scripted model could not address them; (2) the hermetic `MemoryTaskProvider` had no collaboration/identity/attachment/command state and no mutable traits set (the registry captures `traits` by reference at registration, so a replaced set would silently drop new traits); (3) the attachment scenarios required an incoming-file relay the harness did not expose (`upload_attachment` consumes incoming files from the per-context blob store, which throws under S3 in the sandbox); and (4) the identity scenario required the production member-provisioning backstop (`ensureWorkspaceMember`, fire-and-forget on every group turn for non-guest actors) to fire and be observed through a bounded poll.

The design (`docs/superpowers/specs/2026-07-19-f2b2-task-integration-surface-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-19-f2b2-task-integration-surface-story-family.md`) chose four seams — a 12-entry production capability-id block, `MemoryTaskProvider` collaboration/identity/attachment/command methods plus a mutable traits set, a `given.attachment` relay fixture over the real `saveAttachment` (with the in-memory blob store already installed by the test preload), and one 4-scenario story file — then the 4-entry ledger move, extending the behavioral tripwires to the seam-carrying integration surface.

## Decision Drivers

- **Drive the real task-tracker tools through the seam-carrying integration surface.** Every scenario dispatches through the real in-process composition (chat ingress → capability + trait + method assembly → scripted LLM tool loop → real `MemoryTaskProvider`/`saveAttachment`/provisioning backstop); the harness only adds deterministic LLM scripting, seeding, and the relay fixture, never a second implementation.
- **Capability ids, provider capabilities, traits, and the relay together make each seam observable.** Registering the 12 ids makes the scripted `callCapability('tasks.<surface>.<verb>', …)` resolvable; seeding the matching `supportedMemoryTaskCapabilities` strings admits the per-turn gate; the `youtrack-command` scenario additionally requires the `command-language:youtrack` + `supports-command-language` traits (all three of trait + capability + method gate `apply_youtrack_command` assembly); the attachment scenario requires the relay to have materialized a blob the `upload_attachment` tool can resolve.
- **Honest, contract-tested provider semantics per surface.** Watchers/votes/visibility follow the provider's existing conventions (clone-in/clone-out, exact error strings, `<noun>.<verb>` events); votes are idempotent to add and strict to remove (the tool carries no user); visibility stores truthfully and exposes a `getTaskVisibility` read accessor (the `Task` type has no `visibility` field, so visibility lives in its own map, like F2b-1's `taskSprints`). Attachments store metadata with a deterministic `attachment-<counter>` id; `applyCommand` records every call in a public `commandCalls` read and echoes the payload.
- **Mutate the captured traits set in place.** The provider registry captures `traits` by reference at registration; `setTraits` must add to the *existing* set, not replace it, or traits seeded after registration would be invisible to tool assembly. The story proves this by seeding traits after the provider is registered and asserting `apply_youtrack_command` then assembles.
- **The relay fixture calls the real `saveAttachment`; the blob store is already in-memory.** `tests/mock-reset.ts` installs `setBlobStoreForTesting(createInMemoryBlobStoreForTesting())` for every scenario world, so the relay calls the real drizzle-backed `saveAttachment` and returns an opaque handle carrying the `att_…` id the scripted `upload_attachment` call then consumes. Message-level ingest (S3 + adapter file plumbing) stays untested — adapter territory.
- **Observe the fire-and-forget backstop by bounded poll, never wall-clock sleep.** The provisioning backstop runs off the group-turn event loop; the identity story polls `world.tasks.provisionCalls` and the `kaneoWorkspaceMembers` DB row via the production drizzle schema (`waitFor(() => …)` over `setImmediate`), reusing the F2a ask-flow pattern.
- **`setTraits`/`setCurrentUser`/`provisionCalls`/`commandCalls` stay test-API, not `given.*` DSL.** Per the spec's deliberate-exclusions rule ("promote on second consumer"), these are provider test APIs accessed via `world.tasks.*`, avoiding harness-seam proliferation.

## Considered Options

### Option 1 — F2b-2 integration-surface slice: 12 capability ids + provider collaboration/identity/attachment/command methods + mutable traits + relay fixture + 4-scenario story + ledger move (chosen)

Four seams (12-entry capability block; `MemoryTaskProvider` collaboration/identity/attachment/command state groups + a mutable-in-place traits set, each contract-tested to the provider's own conventions; a `given.attachment` relay fixture over the real `saveAttachment` with the pre-installed in-memory blob store), one 4-scenario story file driving the real gated tools and the production provisioning backstop, and the 4-entry ledger move.

- **Pros:** smallest surface that still proves each seam-carrying path end to end; capability ids + provider capabilities + traits + the relay together make every gate observable; the traits-mutation contract pins the registry-capture rule; the relay exercises real `saveAttachment` without adapter/S3 plumbing; the backstop poll reuses the established F2a pattern; test-API surfaces stay off the DSL.
- **Cons:** four seams is the most of any F2 slice; the identity scenario reaches into the production drizzle schema to read the backstop's `kaneoWorkspaceMembers` row, coupling the story to the DB table shape; the relay fixture is a new harness seam with its own contract test.

### Option 2 — Defer F2b-2 until message-level attachment ingest is in scope (rejected)

Hold the entire F2b-2 family until the S3-backed message-level attachment ingest path is testable, so the attachment scenario covers the full incoming-file pipeline rather than just the relay + provider metadata.

- **Pros:** the attachment scenario would cover adapter ingest, not just the relay.
- **Cons:** message-level ingest is adapter territory (Tier 3) needing S3 config and adapter fakes that do not exist; blocking all four scenarios on one adapter seam would delay tripwires on collaboration, identity, and youtrack-command, violating the roadmap's "land what is unblocked now" ordering. The relay already proves the tool-side `upload_attachment` path against real blob storage.

### Option 3 — Promote `setTraits`/`setCurrentUser`/`provisionCalls`/`commandCalls` to `given.*` DSL fixtures (rejected)

Add `given.traits(...)`, `given.currentUser(...)`, and assertion DSL seams mirroring the provider test APIs, so stories route through the harness facade instead of `world.tasks.*`.

- **Pros:** stories stay uniform (everything routes through `given.*`).
- **Cons:** adds four harness seams for single consumers; the spec's deliberate-exclusions rule is "promote on second consumer," and F2b-2 has exactly one consumer per surface. `world.tasks.setTraits(...)` / `world.tasks.commandCalls` in the scenario is honest and avoids seam proliferation.

## Decision

The chosen Option 1 shipped across the production capability map, the hermetic provider (state, methods, and mutable traits), the relay fixture, the 4-scenario story file, and the ledger. What shipped:

1. **12 integration-surface capability ids registered.** `CORE_TOOL_CAPABILITIES` gained the watchers triad (`tasks.watchers.list/add/remove`), the votes pair (`tasks.votes.add/remove`), `tasks.visibility.set`, the identity pair (`tasks.identity.find`/`tasks.identity.current`), the attachments triad (`tasks.attachments.list/upload/delete`), and `tasks.commands.apply`, each mapped to its wire name, immediately following F2b-1's block.
2. **`MemoryTaskProvider` traits made mutable in place.** The fixed `readonly traits` declaration was replaced by a private `traitSet` plus a public `traits` view that aliases it, and `setTraits(traits)` adds to the captured set so the registry's by-reference capture stays valid.
3. **Collaboration group added.** `listWatchers`/`addWatcher` (duplicate → `Task watcher already exists: <userId>`)/`removeWatcher` (`Task watcher not found: <userId>`) over `watchers: Map<taskId, UserRef[]>`; `addVote` (idempotent, returns `{ taskId }`)/`removeVote` (`Task vote not found: <taskId>`) over `votedTasks: Set<taskId>`; `setVisibility(taskId, params)` storing a `TaskVisibility` on `taskVisibility` (public, or restricted with mapped user/group refs) plus `getTaskVisibility` read accessor.
4. **Identity group added.** `listUsers(query?, limit?)` searching the existing `identityUsers` map and returning `UserRef[]`; `getCurrentUser()` returning the test-seeded current user plus `setCurrentUser(userRef)`; `provisionWorkspaceMember(member, opts?)` recording every call in a public `provisionCalls` read and returning `{ providerUserId: 'prov-<login>', login, password: 'memory-password' }`.
5. **Attachments group added.** `listAttachments`/`uploadAttachment` (stores metadata; size from content length via a `contentSize` helper handling both `Uint8Array` and `Blob`; deterministic id `attachment-<counter>`; `url: memory://attachments/<id>`)/`deleteAttachment` (`Attachment not found: <id>`) over `attachments: Map<taskId, Attachment[]>`.
6. **`applyCommand` added.** Records every call in a public `commandCalls` read and echoes the payload as `TaskCommandResult`; the `commandCalls` array type is `{ query, taskIds, comment?, silent? }` (no `confidence` — the tool consumes that in its own gate).
7. **`supportedMemoryTaskCapabilities` extended** with `tasks.watchers`, `tasks.votes`, `tasks.visibility`, `members.provision`, `attachments.list`, `attachments.upload`, `attachments.delete`, `tasks.commands`.
8. **`given.attachment` relay fixture added.** `seedRelayAttachment` in `fixtures.ts` calls the real `saveAttachment` and returns `{ id: ref.attachmentId }`; `ScenarioGiven.attachment(context, { filename, content, mimeType? })` exposes it, returning an `AttachmentHandle = Readonly<{ id: string }>`. The in-memory blob store is installed once per scenario world by `tests/mock-reset.ts`.
9. **4-scenario story file created** at `tests/stories/tasks/integration-surface.story.test.ts`: `SCN-task-collaboration`, `SCN-task-identity` (group turn driving the provisioning backstop, observed by bounded poll + production drizzle read of `kaneoWorkspaceMembers`), `SCN-task-attachments` (relay upload, unknown-attachment rejection, confidence-gated delete), `SCN-task-youtrack-command` (single-task apply + bulk rejection) — scenario names matching the ledger byte-for-byte.
10. **Ledger updated.** The 4 F2b-2 entries moved from `AUDIT_RECORDS` (pending) to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` and literal story ids.

## Consequences

### Positive

- Four new behavioral tripwires cover the seam-carrying task integration surface — collaboration, identity (with the live provisioning backstop), attachments (through the real blob store relay), and youtrack-command (through the trait + capability + method triple) — completing the 21-scenario `task-*` family.
- The four-seam proof makes each gate observable end to end: without the 12 ids the scripted calls cannot resolve; without the seeded `supportedMemoryTaskCapabilities` strings the per-turn gate never admits the tools; without the traits the `apply_youtrack_command` tool never assembles; without the relay the `upload_attachment` tool has no blob to resolve.
- The traits-mutation-in-place contract is pinned by a contract test (`setTraits` mutates the captured set), so a registry that captured `traits` by value, or a provider that replaced the set, would fail visibly.
- The attachment relay exercises the real drizzle-backed `saveAttachment` against the in-memory blob store, proving the tool-side `upload_attachment` path without adapter/S3 plumbing.
- The identity scenario drives the production provisioning backstop on a real group turn and observes its effects by bounded poll (no wall-clock sleep), reusing the F2a ask-flow pattern — a fire-and-forget path that a refactor could easily break.
- Test-API surfaces (`setTraits`/`setCurrentUser`/`provisionCalls`/`commandCalls`) stay off the DSL, honoring the spec's "promote on second consumer" rule.

### Negative

- **The identity story couples to the production drizzle schema.** `readWorkspaceMember` reads the `kaneoWorkspaceMembers` row directly via `getDrizzleDb` + the schema table, so a rename or reshape of that table breaks the story. No production read helper for workspace members existed, so the story reaches into the schema (the plan anticipated this).
- **The relay fixture is a new harness seam.** `given.attachment` + `seedRelayAttachment` add a fixture with its own contract test; a second consumer would justify promoting it, but for now it is single-purpose.
- **Capability-seeding and trait-seeding burden is per-scenario.** Every integration-surface story must seed its capability strings (and the youtrack-command story its traits) explicitly, the zero-default discipline F2a established. Honest (gating becomes observable) but a line in every scenario.

### Risks

- **The provisioning backstop is fire-and-forget.** If the backstop's scheduling changes (e.g. no longer fires on group turns, or fires synchronously), the identity scenario's bounded poll either times out (200 `setImmediate` yields) or reads stale state. The poll is bounded and fails closed (the test fails if the condition never holds), but it is a behavioral dependency on backstop timing.
- **`commandCalls` and `provisionCalls` shapes are provider-defined.** The stories pin the memory provider's own echo shapes; a real provider returning a different `TaskCommandResult`/provisioning shape would need its own coverage. The `confidence` field is intentionally absent from `commandCalls` (the tool consumes it in its gate, not forwarded) — a story that asserted `confidence` echoed would be wrong.
- **The relay's `saveAttachment` input shape is a contract dependency.** The fixture passes `sourceProvider`, `sourceMessageId`, `sourceFileId`, `status`, and `Buffer`-wrapped content; a `saveAttachment` signature change would break the relay. The contract test (`given.attachment seeds the relay and upload_attachment consumes it`) guards this.

## Related Decisions

- [ADR-0299](0299-f2b1-task-provider-surface-story-family.md) — F2b-1 Task Provider-Surface Story Family: the direct predecessor that split F2b at the seam boundary and covered the 7 pure provider-method scenarios. F2b-2's capability block immediately follows F2b-1's 27-entry block in `CORE_TOOL_CAPABILITIES`, and `supportedMemoryTaskCapabilities` carries both slices; the mutable-traits, visibility-map, and `getTaskVisibility` patterns mirror F2b-1's `taskSprints`/`taskSprintId` accessor pattern.
- [ADR-0298](0298-f2a-task-lifecycle-story-family.md) — F2a Task-Lifecycle and Policy Story Family: established the `given.taskCapabilities` zero-default discipline and the progressive-disclosure `load_tool`/extra-`answer` accounting F2b-2's scripted flows inherit.
- [ADR-0297](0297-f1-command-meta-story-family.md) — F1 Command-Surface and Meta-Tools Story Family: the preceding story-family batch that established the family-by-family landing pattern F2b-2 follows.
- [ADR-0293](0293-settings-story-family.md) — Settings HTTP Story Family: the earlier Tier 0 family that proved the qualification-over-contract rule F2b-2's scenarios follow.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: defines the executable-vs-pending ledger this ADR's 4-entry move operates within, the `EXECUTABLE_STORY_MAPPINGS`/`AUDIT_RECORDS` boundary, and the literal-story-id qualification rule every F2b-2 mapping satisfies.
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness PR 1: the original harness vertical slice; the `MemoryTaskProvider`, scripted LLM, and scenario DSL this ADR extends descend from that harness line.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0285](0285-hermetic-story-app-local-dependencies.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness this family runs under (master baseline, OS sandbox, app-local dependencies, Docker-all-hosts).
- [ADR-0218](0218-papai-acp-plugin.md) / [ADR-0228](0228-acp-cleanup.md) / [ADR-0242](0242-follow-up-coding-sessions.md) / [ADR-0254](0254-acp-transcript-web-viewer.md) — the ACP/coding-integration surface whose command tool (`apply_youtrack_command`) and command-language trait gating `SCN-task-youtrack-command` exercises; the trait + capability + method assembly triple this scenario pins is the one these integration ADRs depend on.
- [ADR-0123](0123-trusted-local-plugin-system.md) / [ADR-0156](0156-plugin-review-remediation.md) / [ADR-0157](0157-plugin-review-followup-fixes.md) / [ADR-0158](0158-plugin-system-remediation.md) — the plugin system whose provider-trait and capability gating model the youtrack-command scenario drives through the hermetic provider.
- [ADR-0119](0119-file-attachments-implementation.md) — Shared Attachment Pipeline: the production `saveAttachment`/blob-store path the `given.attachment` relay fixture calls for real.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:57-68` | The 12 F2b-2 capability-id entries — watchers triad, votes pair, `tasks.visibility.set`, identity pair, attachments triad, `tasks.commands.apply` — each mapped to its wire name, immediately following F2b-1's block. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:84-91` | The F2b-2 `supportedMemoryTaskCapabilities` additions (`tasks.watchers`, `tasks.votes`, `tasks.visibility`, `members.provision`, `attachments.list/upload/delete`, `tasks.commands`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:187-188` | Mutable traits: `private readonly traitSet = new Set<TaskProviderTrait>()` then `readonly traits: ReadonlySet<TaskProviderTrait> = this.traitSet` (view aliases the captured set). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:266-268` | `setTraits` adds to `traitSet` in place (registry's by-reference capture stays valid). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:232-242` | New state: `watchers`/`votedTasks`/`taskVisibility`/`currentUser`/`provisionCalls`/`attachments`/`attachmentSequence`/`commandCalls`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1049-1099` | Watchers group (`listWatchers`/`addWatcher` duplicate error/`removeWatcher` not-found error) + votes (`addVote` idempotent/`removeVote` `Task vote not found: <taskId>`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1101-1125` | `setVisibility` (maps `userIds`/`groupIds` to refs, stores on `taskVisibility`) + `getTaskVisibility` read accessor (defaults to `{ kind: 'public' }`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1127-1155` | `listUsers` (searches `identityUsers`, returns `UserRef[]`)/`getCurrentUser`/`setCurrentUser`/`provisionWorkspaceMember` (records in `provisionCalls`, returns `{ providerUserId: 'prov-<login>', login, password: 'memory-password' }`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1157-1209` | Attachments group (`listAttachments`/`uploadAttachment` with `contentSize` + `memory://attachments/<id>` url/`deleteAttachment` not-found error) + `applyCommand` (records in `commandCalls`, echoes payload). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:126` | `contentSize` helper — `'size' in content ? content.size : content.length` (handles `Uint8Array` and `Blob`). | `read` confirms. |
| `tests/stories/tasks/integration-surface.story.test.ts:28-70` | `SCN-task-collaboration` — watchers add/list/remove, votes add/remove, visibility restricted→public. | `read` confirms. |
| `tests/stories/tasks/integration-surface.story.test.ts:72-97` | `SCN-task-identity` — group turn fires the backstop; asserts `provisionCalls` + `kaneoWorkspaceMembers` row via `readWorkspaceMember`. | `read` confirms. |
| `tests/stories/tasks/integration-surface.story.test.ts:99-136` | `SCN-task-attachments` — relay upload, unknown-attachment rejection, confidence-gated delete. | `read` confirms. |
| `tests/stories/tasks/integration-surface.story.test.ts:138-167` | `SCN-task-youtrack-command` — single-task apply + bulk (`taskIds` ×2) rejection; `commandCalls` stays at 1. | `read` confirms. |
| `tests/stories/tasks/integration-surface.story.test.ts:15-26` | `waitFor` (bounded `setImmediate` poll, 200 attempts) + `readWorkspaceMember` (production drizzle read of `kaneoWorkspaceMembers`). | `read` confirms. |
| `tests/stories/harness/fixtures.ts:449-461` | `seedRelayAttachment` — calls real `saveAttachment`, returns `{ id: ref.attachmentId }`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:110,124,127-130,520-528` | `AttachmentHandle` type, `providerUser` DSL (shape `{ id, login, name? }`), and `given.attachment(context, file)` delegating to `seedRelayAttachment`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.test.ts:731-849` | The contract `describe` blocks (collaboration incl. watchers/votes/visibility with user + group refs, identity surface, traits mutation, attachments, applyCommand) exercising the new surface to the provider's own conventions. | `read` confirms. |
| `tests/stories/harness/fixtures.test.ts:242-260` | `given.attachment seeds the relay and upload_attachment consumes it` — relay contract test. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:697-720` | The 4 F2b-2 entries in `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` and literal story ids matching the scenario names byte-for-byte. | `read` confirms; a `grep` for the 4 ids in `AUDIT_RECORDS` (line 1175+) returns no matches — the move is complete. |
| `tests/stories/catalog/coverage.ts:122-125` | `CATALOG_SCENARIO_IDS` still lists the 4 ids (the full-catalog index is independent of the executable/pending split). | `read` confirms. |
| `tests/mock-reset.ts:30,145` | `createInMemoryBlobStoreForTesting`/`setBlobStoreForTesting` import + per-world install (the relay's in-memory blob store). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:216` | `tracks the executable coverage total` — the ledger now holds 140 executable records (not the plan's 69); F2b-2's 4 are a subset (see divergence). | `read` confirms. |
| `tests/scripts/story-coverage-totals.test.ts:12-26` | Runner totals are now `{ total: 165, executable: 140, pending: 25, readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 } }` (see divergence). | `read` confirms. |

Plan-vs-implementation notes:

- **The ledger totals grew far beyond the plan's 69/128 projection.** The plan projected 69 executable / 128 total / 59 pending after F2b-2. Shipped, the ledger is 140 executable / 165 total / 25 pending (`catalog-coverage.test.ts:216`; `story-coverage-totals.test.ts:12-26`) because many later families (F3–F8, the parity lanes, the smoke lane, the platform lane) have since landed. F2b-2's 4 entries are the subset this ADR covers; the move itself (4 entries from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`) is complete and correct, and the `task-*` family is 21/21 executable.
- **The identity-surface shape uses `{ id, login, name }`, not the plan's `{ id, username, displayName }`.** The plan's contract test seeded `addIdentityUser({ id, username, displayName })` and mapped `username → login`, `displayName → name`. Shipped, the real `IdentityUser` type carries `login`/`name` directly, so `addIdentityUser`/`listUsers`/`given.providerUser` all use `{ id, login, name? }` (`memory-task-provider.ts:1127-1134`, `scenario.ts:124`, story at `:81`). The plan anticipated this ("Adjust … to the real `IdentityUser`/`UserRef` fields if they differ … Report the actual mapping used"); the mapping is the identity mapping (no rename).
- **Visibility group refs carry `{ id, name }`, not the plan's `{ name }`.** The plan's `setVisibility` mapped `groupIds` to `{ name }`. Shipped (`memory-task-provider.ts:1114`), groups map to `{ id, name: id }` because the real `VisibilityGroupRef` requires both fields; a second contract test (`stores visibility with group refs`, `memory-task-provider.test.ts:768-777`) pins this shape. Additive; the user-ref shape (`{ id }`) matches the plan.
- **`seedRelayAttachment` diverges from the plan's input shape.** The plan used `sourceProvider: 'scenario'` and omitted `status`. Shipped (`fixtures.ts:449-461`) uses `sourceProvider: 'unknown'`, adds `status: 'available'`, and wraps content in `Buffer.from(new TextEncoder().encode(input.content))` (the real `saveAttachment` requires `status` and a `Buffer`/`Uint8Array` content field). The relay intent (call real `saveAttachment`, return `{ id: ref.attachmentId }`) is preserved; the field values match the real `saveAttachment` signature.
- **`commandCalls` assertion drops `confidence`, as the plan predicted.** The plan noted "the tool forwards `confidence` only into its own gate, not to `applyCommand` — the `commandCalls` assertion may need to drop `confidence`." Shipped (`integration-surface.story.test.ts:157`) asserts `[{ query: 'state Fixed', taskIds: ['task-1'] }]` (no `confidence`), and `commandCalls`' type (`memory-task-provider.ts:242`) is `{ query, taskIds, comment?, silent? }`. The prediction held.
- **The youtrack-command bulk-rejection turn carries two `answer(...)` entries.** The plan's bulk-rejection scripted flow had one `answer(...)`. Shipped (`integration-surface.story.test.ts:161-163`) the bulk `taskIds.length > 1` call is rejected by the tool before the provider is invoked, surfacing as a tool result the scripted loop must consume, so the `given.llm` array carries two identical `answer('I can only run commands on one task at a time.')` entries (one for the tool-result turn, one for the reply turn). This is the F2a/F2b-1 progressive-disclosure + tool-result accounting applied; the intent (`commandCalls` stays at 1, proving the provider was never invoked) is preserved.
- **`listUsers`/`identityResolver.searchUsers` are distinct methods.** The plan's "listUsers … reuse the same matcher the identityResolver uses" is honored: both share the module-level `identityMatches` helper (`memory-task-provider.ts:153-156`), but `listUsers` (returning `UserRef[]`) and `identityResolver.searchUsers` (returning `IdentityUser[]`) remain separate methods on the provider. Additive; the shared matcher keeps their behavior symmetric.

The source plan `docs/superpowers/plans/2026-07-19-f2b2-task-integration-surface-story-family.md` and design `docs/superpowers/specs/2026-07-19-f2b2-task-integration-surface-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
