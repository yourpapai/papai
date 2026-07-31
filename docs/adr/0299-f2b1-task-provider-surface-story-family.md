<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0299: F2b-1 Task Provider-Surface Story Family — Behavioral Coverage for Task Relations, Statuses, Projects, Project Team, Worklog, Sprints, and Saved Queries

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The coverage-expansion roadmap sequences its families by refactor risk. **F2** (the 21 `task-*` scenarios) was split into **F2a** (the task *lifecycle* and *policy* surface — ADR-0298) and **F2b** (the provider *surface*). F2b is itself split at the seam boundary: **F2b-1** (this ADR) covers the 7 scenarios that are pure provider-method expansion — `relations`, `statuses`, `projects`, `project-team`, `worklog`, `sprints`, `saved-queries`; **F2b-2** (a later cycle) covers the 4 seam-carrying scenarios — `collaboration`, `identity` (provisioning backstop), `attachments` (relay + blob-store seam), and `youtrack-command` (traits + `applyCommand`).

The catalog audit classified the 7 F2b-1 scenarios as `needs-seam` pending, each blocked on two production/harness seams: (1) `CORE_TOOL_CAPABILITIES` registered only the four read/create task verbs (plus F2a's 14), so `resolveToolCapability('tasks.relations.*'|'tasks.statuses.*'|'tasks.projects.*'|'tasks.worklog.*'|'tasks.sprints.*'|'tasks.queries.saved.*')` threw and the scripted model could not address them; and (2) the hermetic `MemoryTaskProvider` had none of the six backing state groups (projects, statuses, project team, relations, worklog, sprints/saved-queries), so even with the capability ids registered there was no honest provider behind the gates. The gap was the full provider-surface build-out behind the capability gates that `plugin-core-separation` is most likely to rewire.

The design (`docs/superpowers/specs/2026-07-19-f2b1-task-provider-surface-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-19-f2b1-task-provider-surface-story-family.md`) chose two seams — a production capability-id block (27 entries following the established `tasks.<surface>.<verb>` convention) and six contract-tested `MemoryTaskProvider` state groups with honest semantics — then one 7-scenario story file and the 7-entry ledger move, extending the behavioral tripwires to the gated provider surface.

## Decision Drivers

- **Drive the real task-tracker tools through the gated provider surface.** Every scenario dispatches through the real in-process composition (chat ingress → capability assembly → scripted LLM tool loop → real `MemoryTaskProvider`); the harness only adds deterministic LLM scripting and seeding, never a second tool implementation.
- **Capability ids are the registration proof; provider methods are the gating proof.** Registering the 27 ids makes the scripted `callCapability('tasks.<surface>.<verb>', …)` resolvable; seeding the matching `supportedMemoryTaskCapabilities` strings (the F2a zero-default learning) is what then lets the per-turn capability gate admit the tools. Both halves must land for a scenario to go green.
- **Honest, contract-tested provider semantics per group.** Each of the six state groups follows the provider's existing conventions (clone-in/clone-out, exact error strings, `<noun>.<verb>` events, deterministic `<noun>-<counter>` ids). Status mutations emulate the real shared-set confirmation passthrough (`{ status: 'confirmation_required' }` unless `confirm === true`); `addAgile`/`addSavedQuery` are synchronous test-API seed helpers (no create tools exist for these — same role as `addIdentityUser`), not promoted to the DSL.
- **No referential validation beyond the established provider leniency.** Tasks keep their `projectId` when a project is deleted; `createTask` still does not require the project to exist. This matches the documented provider leniency and keeps the six groups decoupled (no shared fixtures between groups).
- **F2b-1 before F2b-2.** Landing the pure provider-method expansion first isolates the heavy (but seam-free) `MemoryTaskProvider` build-out from the trait/relay/provisioning seams F2b-2 carries.

## Considered Options

### Option 1 — F2b-1 provider-surface slice: 27 capability ids + six provider state groups + 7-scenario story + ledger move (chosen)

Two seams (27-entry capability block; six `MemoryTaskProvider` state groups with full CRUD + confirmation passthrough + seed helpers, each contract-tested to the provider's own conventions), one 7-scenario story file driving the real gated tools, and the 7-entry ledger move.

- **Pros:** smallest surface that still proves the whole provider-surface gating path; capability ids + provider capabilities together make gating observable; the status-confirmation passthrough pins the memory provider's honest version of the real shared-set contract; seed helpers stay test-API (not DSL), matching the spec's "promote on second consumer" rule; cleanly isolates F2b-1 from the seam-carrying F2b-2.
- **Cons:** six new maps is the largest single provider delta in the harness; the per-group contract discipline (clone semantics, exact error strings, event kinds) is real per-method cost; splits F2b into two cycles, so the full `task-*` coverage lands later.

### Option 2 — Defer all of F2b to one cycle after the seam-carrying scenarios are designed (rejected)

Land the entire remaining 11-scenario F2b family (7 pure-provider + 4 seam-carrying) in one pass once F2b-2's trait/relay/provisioning seams are specified.

- **Pros:** one story file, one ledger move, one provider delta for all of F2b.
- **Cons:** couples the seam-free provider build-out (which can land now) to the F2b-2 seam design (which is not ready), delaying tripwires on the gated provider surface until the seams unblock; violates the roadmap's "land what is unblocked now" ordering.

### Option 3 — Promote `addAgile`/`addSavedQuery` to `given.*` DSL fixtures (rejected)

Add `given.agile(...)` and `given.savedQuery(...)` DSL seams mirroring the synchronous seed helpers, so stories seed through the harness facade instead of `world.tasks.*`.

- **Pros:** stories stay uniform (everything routes through `given.*`).
- **Cons:** adds two harness seams for a single consumer each; the spec's deliberate-exclusions rule is "promote on second consumer," and F2b-1 has exactly one consumer per helper. `world.tasks.addAgile(...)` in the scenario's `given` phase is honest and avoids seam proliferation.

## Decision

The chosen Option 1 shipped across the production capability map, the hermetic provider, the 7-scenario story file, and the ledger. What shipped:

1. **27 provider-surface capability ids registered.** `CORE_TOOL_CAPABILITIES` gained the relations triad (`tasks.relations.add/update/remove`), the statuses quintet (`tasks.statuses.list/create/update/delete/reorder`), the projects quintet plus the team triad (`tasks.projects.get/list/create/update/delete` + `tasks.projects.team.list/add/remove`), the worklog quartet (`tasks.worklog.list/create/update/delete`), `tasks.agiles.list` + the sprints quartet (`tasks.sprints.list/create/update/assign`), and the saved-queries pair (`tasks.queries.saved.list/run`), each mapped to its wire name.
2. **`MemoryTaskProvider` projects group added.** `listProjects`/`getProject`/`createProject` (duplicate-name rejection, `buildProjectUrl` for the required `url`)/`updateProject` (merge, duplicate-name guard)/`deleteProject` (removes only the project plus its statuses/team). `requireProject` throws `Project not found: <id>`.
3. **Statuses group added — confirmation passthrough.** Full CRUD + `reorderStatuses`; the four mutating ops return `{ status: 'confirmation_required', message }` unless `confirm === true`; `listStatuses` is ordered by `order`; `requireColumn` throws `Status not found: project <id>, status <id>`. A module-level `definedStatusUpdate` helper mirrors `definedUpdate`.
4. **Project-team group added.** `listProjectTeam`/`addProjectMember` (duplicate → `Project member already exists: <userId>`)/`removeProjectMember` (`Project member not found: <userId>`).
5. **Relations group added.** `addRelation` requires both tasks and rejects duplicates (`Task relation already exists: <a> <b>`); `updateRelation` requires an existing link; `removeRelation` throws `Task relation not found: <a> <b>`.
6. **Worklog group added.** Paginated `listWorkItems` + `createWorkItem` (duration required; defaults `author: 'unknown'`, `date: '2026-01-01'`) + `updateWorkItem` + `deleteWorkItem` (`Work item not found: <id>`).
7. **Sprints + saved-queries group added.** Synchronous seed helpers `addAgile`/`addSavedQuery`; `listAgiles`/`listSprints` (`requireAgile` → `Agile not found: <id>`)/`createSprint` (required `archived: false`)/`updateSprint`/`assignTaskToSprint` (resolves the agile by sprint id, throws `Sprint not found: <id>`); `listSavedQueries`/`runSavedQuery` (no/empty query returns all tasks, otherwise routes through the provider's own `searchTasks`). `taskSprintId` exposes the assignment for assertion.
8. **`supportedMemoryTaskCapabilities` extended** with the matching capability strings (`tasks.relations`, `statuses.*`, `projects.*`, `projects.team`, `workItems.*`, `agiles.list`, `sprints.*`, `queries.saved`).
9. **7-scenario story file created** at `tests/stories/tasks/provider-surface.story.test.ts`: relations, statuses, projects, project-team, worklog, sprints, saved-queries — all DM contexts with an assigned task instance, deterministic ids, and scenario names matching the ledger byte-for-byte.
10. **Ledger updated.** The 7 F2b-1 entries moved from `AUDIT_RECORDS` (pending) to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'`.

## Consequences

### Positive

- Seven new behavioral tripwires cover the entire gated task provider surface — relations, statuses, projects, project team, worklog, sprints, and saved queries — exactly the methods real task providers implement behind capability gates that the pending `plugin-core-separation` refactor is most likely to rewire.
- The two-seam proof (capability id + provider capability) makes gating observable end to end: without the 27 ids the scripted calls cannot resolve, and without the seeded `supportedMemoryTaskCapabilities` strings the per-turn gate never admits the tools.
- The status-confirmation passthrough pins the memory provider's honest version of the real shared-set-mutation contract (mutating ops return `confirmation_required` unless `confirm === true`), so a provider that dropped the passthrough would fail the statuses scenario, not silently pass it.
- Each provider group is contract-tested to the provider's own conventions (clone semantics, exact error strings, event emission), so the six groups double as honest provider-behavior specs, not just story scaffolding.
- Seed helpers (`addAgile`/`addSavedQuery`) stay test-API, honoring the spec's "promote on second consumer" rule and avoiding harness-seam proliferation.

### Negative

- **Capability-seeding burden is per-scenario.** The world constructs `MemoryTaskProvider` with no capabilities (zero-default, the F2a learning), so every story whose tools are provider-capability-gated must seed them explicitly via `given.taskCapabilities([...])`. Honest (gating becomes observable) but a line in every scenario.
- **Progressive disclosure adds scripting overhead.** The first capability call in a turn routes through an automatic `load_tool` hop, so several scripted `given.llm` arrays carry an extra `answer(...)` step the plan did not call for (see divergence).
- **The largest single provider delta in the harness.** Six new maps and ~30 methods is real per-group contract discipline; a future group that drops the clone/event/error convention would not be caught unless its own contract test asserts it.

### Risks

- **Status categories and event kinds are provider-defined strings.** The stories pin the memory provider's own event kinds (`status.create`, `project.team.add`, `task.relation.create`, …); the contract is the shape and the confirmation/error behavior, not vendor strings, so a real provider emitting different event kinds would need its own coverage.
- **`assignTaskToSprint` resolves the agile by scanning sprints.** The lookup is O(sprints) and assumes sprint ids are globally unique across agiles; a provider that reused sprint ids across boards would need a different resolution path.
- **No referential validation is deliberate leniency.** Deleting a project does not invalidate tasks that reference its `projectId`, matching the existing `createTask` behavior; a story that assumed cascade validation would be wrong.

## Related Decisions

- [ADR-0298](0298-f2a-task-lifecycle-story-family.md) — F2a Task-Lifecycle and Policy Story Family: the direct sibling (same 2026-07-19 cycle) that split F2 into lifecycle/policy (F2a) and provider-surface (F2b). F2a established the `given.taskCapabilities` zero-default discipline, the `resolveToolCapability` discrimination rule, and the progressive-disclosure `load_tool` accounting this ADR inherits; F2b-1's capability block immediately follows F2a's 14-entry block in `CORE_TOOL_CAPABILITIES`.
- [ADR-0297](0297-f1-command-meta-story-family.md) — F1 Command-Surface and Meta-Tools Story Family: the preceding story-family batch that established the family-by-family landing pattern and the `given.taskCapabilities`/`given.llm`/`when.message` discipline F2b-1 follows.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: defines the executable-vs-pending ledger this ADR's 7-entry move operates within, the `EXECUTABLE_STORY_MAPPINGS`/`AUDIT_RECORDS` boundary, and the literal-story-id qualification rule every F2b-1 mapping satisfies.
- [ADR-0293](0293-settings-story-family.md) — Settings HTTP Story Family: the earlier Tier 0 family that proved the qualification-over-contract rule F2b-1's provider-surface scenarios follow.
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness PR 1: the original harness vertical slice; the `MemoryTaskProvider`, scripted LLM, and scenario DSL this ADR extends all descend from that harness line.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0285](0285-hermetic-story-app-local-dependencies.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness this family runs under (master baseline, OS sandbox, app-local dependencies, Docker-all-hosts).
- [ADR-0180](0180-providerless-task-tracker-fallback.md) — Providerless Task-Tracker Fallback: the production task-provider surface (and the `null` task-instance semantics) these stories exercise end to end through the assigned instance.
- [ADR-0129](0129-multi-provider-router.md) / [ADR-0133](0133-task-provider-as-plugin-phases-3-to-5.md) — the multi-provider router and task-provider-as-plugin architecture whose provider-instance resolution and capability gating the F2b-1 stories drive.
- [ADR-0209](0209-youtrack-relation-linking.md) — YouTrack Relation Linking: the production relation surface `SCN-task-relations` exercises through the hermetic provider.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:30-56` | The 27 F2b-1 capability-id entries — relations triad, statuses quintet, projects quintet + team triad, worklog quartet, `tasks.agiles.list`, sprints quartet, saved-queries pair — each mapped to its wire name. | `read` confirms; the block immediately follows F2a's 14 entries (16-29). |
| `tests/stories/harness/memory-task-provider.ts:48` | `supportedMemoryTaskCapabilities` start; the F2b-1 capability strings sit at lines 62-83 (`tasks.relations`, `statuses.*`, `projects.*`, `projects.team`, `workItems.*`, `agiles.list`, `sprints.*`, `queries.saved`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:217-229` | The six new state maps + sequences: `projects`/`statuses`/`projectTeam`/`relations`/`workItems`/`agiles`/`sprints`/`taskSprints`/`savedQueries` + `projectSequence`/`statusSequence`/`workSequence`/`agileSequence`/`sprintSequence`/`querySequence`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:594-660` | Projects group — `listProjects`/`getProject`/`createProject` (duplicate-name rejection, `url: this.buildProjectUrl(id)`)/`updateProject`/`deleteProject` (clears `statuses` + `projectTeam`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:662-770` | Statuses group — `listStatuses` (sorted by `order`), `createStatus`/`updateStatus`/`deleteStatus`/`reorderStatuses` with the `{ status: 'confirmation_required' }` passthrough unless `confirm === true`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:772-804` | Project team — `listProjectTeam`/`addProjectMember` (duplicate error)/`removeProjectMember` (not-found error). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:806-848` | Relations — `addRelation` (requires both tasks, duplicate error)/`updateRelation`/`removeRelation` (`Task relation not found: <a> <b>`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:850-916` | Worklog — paginated `listWorkItems`/`createWorkItem` (defaults `author: 'unknown'`, `date: '2026-01-01'`)/`updateWorkItem`/`deleteWorkItem` (`Work item not found: <id>`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:918-1013` | Sprints — `addAgile`/`listAgiles`/`listSprints` (`requireAgile`)/`createSprint` (required `archived: false`)/`updateSprint`/`assignTaskToSprint` (resolves agile by sprint id). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1015-1017` | `taskSprintId` — assignment read accessor for scenario assertion. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1019-1046` | Saved queries — `addSavedQuery`/`listSavedQueries`/`runSavedQuery` (no/empty query returns all tasks, else routes through `searchTasks`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:175,715` | `definedStatusUpdate` helper (keeps only defined fields) used by `updateStatus`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1215-1217` | `buildProjectUrl` — `memory://projects/${projectId}` (public, visible to parity consumers). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1274-1296` | `requireProject`/`requireColumn`/`requireAgile`/`requireSprint` private helpers with the exact not-found error strings. | `read` confirms. |
| `tests/stories/tasks/provider-surface.story.test.ts:1-260` | The 7-scenario story file: `SCN-task-relations` (11-54), `-statuses` (56-100), `-projects` (102-135), `-project-team` (137-170), `-worklog` (172-204), `-sprints` (206-232), `-saved-queries` (234-260). | `read` confirms; scenario names match the ledger byte-for-byte. |
| `tests/stories/harness/memory-task-provider.test.ts:564-729` | The 6 contract `describe` blocks (projects, statuses, project team, relations, worklog, sprints and saved queries) exercising the six groups to the provider's own conventions. | `read` confirms. |
| `tests/stories/catalog/coverage.ts:663-696` | The 7 F2b-1 entries in `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` and literal story ids. | `read` confirms; a `grep` for the 7 ids in `AUDIT_RECORDS` (line 1175+) returns no matches — the move is complete. |
| `tests/stories/catalog/coverage.ts:115-121` | `CATALOG_SCENARIO_IDS` still lists the 7 ids (the full-catalog index is independent of the executable/pending split). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:216` | `tracks the executable coverage total` — the ledger now holds 140 executable records (not the plan's 65); F2b-1's 7 are a subset (see divergence). | `read` confirms. |
| `tests/scripts/story-coverage-totals.test.ts:12-26` | Runner totals are now `{ total: 165, executable: 140, pending: 25, readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 } }` (see divergence). | `read` confirms. |

Plan-vs-implementation notes:

- **The ledger totals grew far beyond the plan's 65/128 projection.** The plan projected 65 executable / 128 total / 63 pending after F2b-1. Shipped, the ledger is 140 executable / 165 total / 25 pending (`catalog-coverage.test.ts:216`; `story-coverage-totals.test.ts:12-26`) because F2b-2 (collaboration/identity/attachments/commands) and many later families have since landed. F2b-1's 7 entries are the subset this ADR covers; the move itself (7 entries from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`) is complete and correct.
- **Progressive disclosure added extra `answer()` hops in the scripted flows.** The plan's `given.llm` arrays had one `answer(...)` per turn. Shipped, several scenarios carry a second `answer(...)` (e.g. `SCN-task-relations` at `provider-surface.story.test.ts:34-35` and :50-51; `SCN-task-projects` at :126-127; `SCN-task-project-team` at :158-159) because the first capability call in a turn routes through an automatic `load_tool` hop (progressive disclosure), which consumes the first scripted step. This is the F2a learning applied; the scenario intent and the provider-state assertions are preserved.
- **`SCN-task-statuses` is simpler than planned.** The plan's status scenario scripted create → confirm-create → second create (`Done`) → reorder → unconfirmed-delete (confirmation_required) → confirmed-delete. Shipped (`provider-surface.story.test.ts:56-100`) scripts create (confirmation_required) → confirm-create → delete only, dropping the second-status creation, the reorder, and the unconfirmed-delete scripted steps. The capability seeding still includes `statuses.update`/`statuses.reorder`/`statuses.delete`, and the contract test (`memory-task-provider.test.ts:580-609`) covers the full CRUD + reorder + confirmation path the story no longer exercises inline. The two core behaviors the plan targeted — confirmation passthrough on create, and delete — remain pinned by the story.
- **`SCN-task-statuses` delete carries `confidence: 0.9`.** The plan's `delete_status` call passed only `confirm: true`; shipped (`provider-surface.story.test.ts:90-95`) adds `confidence: 0.9` because `delete_status` is a destructive-action tool that runs the shared `checkConfidence()` gate alongside the status confirmation passthrough. Intent (shared-set delete needs confirmation) preserved.
- **`buildProjectUrl` is public, not a private helper.** The spec's "Project requires `url` (use `this.buildProjectUrl(id)`)" implied a private helper; shipped (`memory-task-provider.ts:1215`) it is a public method (mirroring `buildTaskUrl`), visible to parity-test consumers. Additive; the `url` requirement is satisfied either way.
- **`supportedMemoryTaskCapabilities` carries the full F2b-2 surface too.** The plan added the F2b-1 strings only. Shipped (`memory-task-provider.ts:48-92`) the list also includes watchers, votes, visibility, provisioning, attachments, and commands landed by F2b-2's subsequent work; the F2b-1 additions are preserved within it.
- **`CORE_TOOL_CAPABILITIES` carries the full F2b-2 surface too.** The plan's 27 entries are present at `core-capabilities.ts:30-56`; entries 57-68 (watchers/votes/visibility/identity/attachments/commands) are the later F2b-2 registration, additive to F2b-1's block.

The source plan `docs/superpowers/plans/2026-07-19-f2b1-task-provider-surface-story-family.md` and design `docs/superpowers/specs/2026-07-19-f2b1-task-provider-surface-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
