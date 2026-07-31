<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0298: F2a Task-Lifecycle and Policy Story Family — Behavioral Coverage for Task Create/Update/Delete, History, Comments, Labels, and the Tool-Permission Policy Path

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

The coverage-expansion roadmap sequences its families by refactor risk. **F2** (the 21 `task-*` scenarios) was split into **F2a** (this ADR) and **F2b** (a later cycle): F2a covers the task *lifecycle* and *policy* surface — create/update, query/count, delete, self-seeded history, comments, labels, and the three policy behaviors (not-configured, ask-confirm, deny) — because that surface needs only a small provider delta plus the `tool_prefs` allow/ask/deny seams, and because it is exactly the task-tool gating path (`capability registration → provider-capability gating → tool_prefs resolution`) that `plugin-core-separation` is most likely to rewire. F2b (relations, statuses, projects, project-team, worklog, sprints, saved-queries, collaboration, identity, attachments, YouTrack `applyCommand`) is the heavy `MemoryTaskProvider` build-out plus traits and the attachment relay, deferred to its own cycle.

The catalog audit classified the 9 F2a scenarios: 3 `executable-as-is` (not-configured, ask-confirm, deny), 3 needing only `capability-ids` (create-update, comments, labels), and 3 needing `capability-ids` + `memory-task-provider-expansion` (delete, query/count, history). `SCN-task-guest-readonly` was already executable. The gap was three-fold: (1) `CORE_TOOL_CAPABILITIES` registered only the four read/create task verbs, so `resolveToolCapability('tasks.update'|'tasks.delete'|'tasks.count'|'tasks.history'|'tasks.comments.*'|'tasks.labels.*')` threw and the scripted model could not address them; (2) the hermetic `MemoryTaskProvider` had no `deleteTask`/`countTasks`/`getTaskHistory` and no activity stream to feed history; and (3) the harness DSL had no way to seed `tool_prefs` (for the ask/deny policy stories) and no negative mirror of `then.task(title).exists()` (for the delete story).

The design (`docs/superpowers/specs/2026-07-19-f2a-task-lifecycle-story-family-design.md`) and plan (`docs/superpowers/plans/2026-07-19-f2a-task-lifecycle-story-family.md`) chose four small seams — a production capability-id block (14 entries), three honest contract-tested `MemoryTaskProvider` method groups (delete/count/self-seeding history), `given.toolPrefs`, and `then.task(title).absent()` — then one 9-scenario story file and the 9-entry ledger move, taking the catalog from 49 to 58 executable stories and putting behavioral tripwires on every part of the task surface the pending refactor touches.

## Decision Drivers

- **Drive the real task-tracker tools, not a parallel surface.** Every scenario dispatches through the real in-process composition (chat ingress → capability assembly → scripted LLM tool loop → real `MemoryTaskProvider`); the harness only adds deterministic LLM scripting and seeding, never a second tool implementation.
- **Capability ids are the RED→GREEN proof.** `SCN-task-create-update` is deliberately structured so that without the `tasks.update` capability id the scripted `callCapability('tasks.update', …)` cannot resolve; landing the id is what turns it green. The same registration mechanism gives the deny and not-configured behaviors for free (tools absent from the gated per-turn set never register, so capability resolution fails exactly when it should).
- **Honest, contract-tested provider semantics.** `deleteTask`/`countTasks`/`getTaskHistory` follow the provider's existing conventions (clone-in/clone-out, exact `Task not found: <id>` strings, `task.*`/`comment.*`/`label.*` events). History is **self-seeding** — every mutating operation appends an `Activity` — matching how real providers build it, with no seeding helper that could make an unsupported path look tested.
- **Existing gating carries the policy stories.** `tool_prefs` resolution (`allow`/`ask`/`deny`, most-specific-wins) and the per-turn capability gate already implement deny and not-configured; the stories only need a fixture (`given.toolPrefs`) to seed the prefs and a negative assertion (`then.task(...).absent()`) for the delete outcome. No new production policy code.
- **The ask flow composes from existing primitives.** The permission-prompt flow needs no new seam: `given.toolPrefs(... 'ask')` + a scripted call carrying `_permission_reason` + `when.dispatchMessage` (no settle) + extracting the `perm:a:`/`perm:d:` callback data from the recorded buttons reply + `when.interaction` to resolve it.
- **F2a before F2b.** Landing lifecycle + policy first puts tripwires on the gating path before the larger provider-surface build-out, and isolates the small provider delta from the heavy F2b work.

## Considered Options

### Option 1 — F2a lifecycle+policy slice: capability ids + provider method groups + two DSL seams + self-seeding history (chosen)

Four small seams (14 capability-id entries; `deleteTask`/`countTasks`/`getTaskHistory` with a self-seeding activity stream; `given.toolPrefs`; `then.task(...).absent()`), one 9-scenario story file driving the real tools, and the 9-entry ledger move. Existing gating semantics carry the deny and not-configured behaviors; F2b lands the remaining 12 `task-*` scenarios in a later cycle.

- **Pros:** smallest possible surface that still proves the whole gating path; capability-ids seam is RED→GREEN evidence; self-seeding history mirrors real providers and needs no test-only seeding helper; policy stories need zero new production code; cleanly isolates F2a from the heavy F2b build-out.
- **Cons:** splits F2 into two cycles (F2a + F2b), so the full `task-*` coverage lands later; the self-seeding recorder must be wired into every mutating method, which is a per-method discipline cost.

### Option 2 — Defer all of F2 to one cycle after the provider-surface build-out (rejected)

Land the entire 21-scenario `task-*` family in one pass once the full `MemoryTaskProvider` build-out (relations, statuses, projects, …) is done.

- **Pros:** one story file, one ledger move, one provider delta for all of F2.
- **Cons:** delays tripwires on the task-tool gating path — the highest-refactor-risk surface — until after the largest provider build-out, exactly inverting the roadmap's risk-first ordering; couples the small lifecycle/policy delta to the heavy provider-surface work, so a blocker on any F2b provider method blocks the policy tripwires too.

### Option 3 — Seed history via an explicit fixture helper instead of self-seeding from real mutations (rejected)

Add a `given.taskHistory(taskId, activities)` helper that injects activity records directly, and have `getTaskHistory` read them.

- **Pros:** simplest possible `getTaskHistory`; no per-method recorder discipline.
- **Cons:** dishonest — a story could assert history that no real operation produced, so a provider that failed to record activities would still look covered; diverges from how real providers (Kaneo/YouTrack) build history, weakening the contract. The self-seeding model makes the recording path itself observable.

## Decision

The chosen Option 1 shipped across the production capability map, the hermetic provider, two DSL additions, the 9-scenario story file, and the ledger. What shipped:

1. **14 task capability ids registered.** `CORE_TOOL_CAPABILITIES` gained `tasks.update`/`tasks.delete`/`tasks.count`/`tasks.history`, the four `tasks.comments.*` verbs, and the six `tasks.labels.*` verbs, each mapped to its wire name so the scripted model's `callCapability(...)` can resolve them and the per-turn capability gate can deny them.
2. **`MemoryTaskProvider.deleteTask` added.** Removes the task plus its comments, label assignments, and history; `Task not found: <id>` on missing; records a transient `task.deleted` activity before clearing the maps; emits the `task.delete` event.
3. **`MemoryTaskProvider.countTasks` added.** Reuses the provider's own `searchTasks` semantics (`query` + optional `projectId`) and returns the count; emits no event of its own.
4. **`MemoryTaskProvider.getTaskHistory` added — self-seeding.** A private `recordActivity` appends an `Activity` (`id`/`timestamp`/`category`/`field`/`added`/`removed`) from every mutating operation (create, per-field update, delete, comment create/update/delete, task-label add/remove); `getTaskHistory` applies the interface's `categories`/`author`/`limit`/`offset`/`reverse` filtering and throws loudly on `start`/`end` (counter timestamps are not dates — silently ignoring them would be dishonest). `supportedMemoryTaskCapabilities` gained `tasks.delete`/`tasks.count`/`activities.read`.
5. **`given.toolPrefs(context, prefs)` added.** Thin fixture over `setToolPrefs(scopedConfigContextId(context), prefs)`, closing at world start like every other `given.*`.
6. **`then.task(title).absent()` added.** Negative mirror of `then.task(title).exists()`, searching the provider for a matching title and asserting none is found.
7. **9-scenario story file created** at `tests/stories/tasks/lifecycle-and-policy.story.test.ts`: create-update, query, delete, history, comments, labels, not-configured, ask-confirm, deny — all DM contexts with an assigned task instance, deterministic ids (`task-1`/`comment-1`/`label-1`), and scenario names matching the ledger byte-for-byte.
8. **Ledger updated.** The 9 F2a entries moved from `AUDIT_RECORDS` (pending) to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'`; the runner totals line and the contract-test totals were updated to match.

## Consequences

### Positive

- Nine new behavioral tripwires cover the entire task-tool gating path — capability registration, provider-capability gating, and the `tool_prefs` allow/ask/deny machinery — exactly the surface the pending `plugin-core-separation` refactor is most likely to rewire.
- The capability-ids seam is proven RED→GREEN by `SCN-task-create-update`: without the `tasks.update` id the scripted rename cannot resolve, so the scenario is a genuine registration proof, not a tautology.
- The policy stories pin the real `tool_prefs` resolution (`ask` gates a mutating tool behind a permission prompt; `deny` removes it from the advertised set; not-configured leaves it unregistered) with zero new production policy code — the existing gate does all the work.
- Self-seeding history makes the activity-recording path itself observable: a provider that failed to record activities would fail the history scenario, not silently pass it.
- `deleteTask`/`countTasks`/`getTaskHistory` are contract-tested to the provider's own conventions (clone semantics, exact error strings, event emission), so they double as honest provider-behavior specs.

### Negative

- **Capability-seeding burden shifts to every gated story.** The world constructs `MemoryTaskProvider` with no capabilities (zero-default), so every story whose tool is provider-capability-gated must seed them explicitly via `given.taskCapabilities(...)`. This is honest (gating becomes observable) but adds a line to five of the nine scenarios that the plan did not call for.
- **`availableTools` no longer discriminates denied/unconfigured tools.** Progressive disclosure advertises non-core tools only after a `load_tool` hop, so absence from `availableTools` cannot distinguish a denied or unconfigured tool from a merely unloaded one. The policy scenarios therefore assert `world.runtime.resolveToolCapability(...)` (registration happens on the post-deny, pre-disclosure set) instead of the planned `availableTools` contain/not-contain checks.
- **The ask flow needs a polling wait.** The synchronous buttons read raced the fire-and-forget turn, so the story polls (`setImmediate`-yield, bounded attempts — no wall-clock sleep) for the buttons reply rather than reading it inline.

### Risks

- **History categories are provider-defined strings.** The history scenario pins the memory provider's own category strings (`task.created`/`task.updated`/…); the contract is the activity shape and filtering, not vendor strings, so a real provider emitting different categories would need its own story.
- **`count_tasks` gating is observable only when seeded.** The query scenario seeds `tasks.count` via `given.taskCapabilities` exactly where the capability is required, making the gating itself observable; a story that forgot to seed it would exercise the gated (absent) path instead.
- **The ask flow depends on the buttons-reply shape.** Button extraction snapshots the reply count at wait-entry (`since`) so a later prompt cannot match an earlier prompt's stale buttons, but a future change to the recorded buttons/options shape would require the narrow in the extraction helper to be updated.

## Related Decisions

- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Story Coverage Ledger: defines the executable-vs-pending ledger this ADR's 9-entry move operates within, the `EXECUTABLE_STORY_MAPPINGS`/`AUDIT_RECORDS` boundary, and the literal-story-id qualification rule every F2a mapping satisfies.
- [ADR-0297](0297-f1-command-meta-story-family.md) — F1 Command-Surface and Meta-Tools Story Family: the preceding story-family batch (same 2026-07-19 cycle) that established the family-by-family landing pattern, the `given.taskCapabilities`/`given.llm`/`when.message` discipline, and the `load_tool` hop accounting F2a inherits. F2a's `SCN-task-create-update` mirrors F1's RED→GREEN capability-id proof.
- [ADR-0293](0293-settings-story-family.md) — Settings HTTP Story Family: the earlier Tier 0 family that proved the qualification-over-contract rule (each executable record must prove a behavior change, not just a response status) F2a's policy scenarios follow (deny → task absent; ask → allowed task exists, denied task absent).
- [ADR-0166](0166-storybook-harness-pr1.md) — Storybook Harness PR 1: the original harness vertical slice; the `MemoryTaskProvider`, scripted LLM, and scenario DSL this ADR extends all descend from that harness line.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) / [ADR-0283](0283-hermetic-story-process-sandbox-phase-1.md) / [ADR-0285](0285-hermetic-story-app-local-dependencies.md) / [ADR-0286](0286-hermetic-story-docker-all-hosts.md) — the hermetic Tier 0 story harness this family runs under (master baseline, OS sandbox, app-local dependencies, Docker-all-hosts).
- [ADR-0117](0117-youtrack-tool-parity-closure.md) — YouTrack Tool Parity Closure: the production task-tool parity baseline (due-date correctness, attachment context, priority relaxation) whose tool surface the F2a capability ids expose to the stories.
- [ADR-0122](0122-kaneo-label-semantics.md) — Kaneo Scope-Aware Label Semantics: the label surface `SCN-task-labels` exercises (create/assign/unassign by name via `getLabelByName`).
- [ADR-0202](0202-youtrack-dedicated-fields-and-teaching-errors.md) and [ADR-0209](0209-youtrack-relation-linking.md) — the YouTrack dedicated-fields and relation-linking work that defines the broader task-tool domain F2a's lifecycle scenarios sit inside.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/tools/core-capabilities.ts:16-29` | The 14 F2a capability-id entries — `tasks.update/delete/count/history`, `tasks.comments.list/create/update/delete`, `tasks.labels.list/create/update/delete/assign/unassign` mapped to their wire names. | `read` confirms; entries 30-67 are the later F2b surface. |
| `tests/stories/harness/memory-task-provider.ts:48-92` | `supportedMemoryTaskCapabilities` includes `'tasks.delete'`, `'tasks.count'`, `'activities.read'` (lines 59-61). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:208,216` | `private readonly history = new Map<string, Activity[]>()` and `private activitySequence = 0` state for the self-seeding activity stream. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:1239-1249` | `recordActivity` — monotonic `activitySequence`, builds `{ id: 'activity-N', timestamp: String(N), ...entry }`, pushes a clone into the per-task list. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:278` | `createTask` records `{ category: 'task.created' }`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:301-307` | `updateTask` records one `{ category: 'task.updated', field, added }` per patched field, with `added = typeof value === 'string' ? value : JSON.stringify(value)` (non-string fields never become `[object Object]`). | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:313-324` | `deleteTask` — `requireTask`, records `task.deleted`, clears `tasks`/`comments`/`taskLabelIds`/`history`, emits `task.delete`, returns `{ id }`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:367-369` | `countTasks` — `(await this.searchTasks({ ...params })).length`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:371-399` | `getTaskHistory` — `requireTask`; throws `MemoryTaskProvider does not support start/end history filtering` on `start`/`end`; `categories`/`author`/`reverse`/`offset`/`limit` filtering; emits `task.history`. | `read` confirms. |
| `tests/stories/harness/memory-task-provider.ts:429,441,452,575,588` | `recordActivity` call sites for comment create/update/delete (`comment.created`/`comment.updated`/`comment.deleted`) and task-label add/remove (`task.label.added`/`task.label.removed`). | `read` confirms. |
| `tests/stories/harness/scenario.ts:132,535-538` | `given.taskCapabilities(capabilities)` — pre-existing seam (`world.tasks.setCapabilities(...)`) the shipped stories use for the zero-default-capabilities divergence; not an F2a addition. | `read` confirms. |
| `tests/stories/harness/scenario.ts:555-558` | `given.toolPrefs(context, prefs)` — `prerequisite('given.toolPrefs')` then `setToolPrefs(scopedConfigContextId(context), prefs)`. | `read` confirms. |
| `tests/stories/harness/scenario.ts:893-902` | `then.task(title)` returns `{ exists(), absent() }` — both search `world.tasks.searchTasks({ query: title })` and assert title match true/false via `tracedAssertion`. | `read` confirms. |
| `tests/stories/harness/scenario.test.ts:99-118` | Contract test `given.toolPrefs gates the advertised toolset and then.task.absent passes for missing tasks` — also asserts `resolveToolCapability('tasks.create')` throws while `tasks.list` resolves (see divergence). | `read` confirms. |
| `tests/stories/tasks/lifecycle-and-policy.story.test.ts:1-270` | The 9-scenario story file: `SCN-task-create-update` (48-70), `-query` (72-97), `-delete` (99-122), `-history` (124-148), `-comments` (150-181), `-labels` (183-209), `-not-configured` (211-223), `-ask-confirm` (225-255), `-deny` (257-270). | `read` confirms; scenario names match the ledger byte-for-byte. |
| `tests/stories/tasks/lifecycle-and-policy.story.test.ts:12-46` | `permissionCallback` (defensive `typeof`/`Array.isArray` narrowing + third `since` arg) and `waitForPermissionCallback` (bounded `setImmediate` poll) helpers (see divergence). | `read` confirms. |
| `tests/stories/catalog/coverage.ts:609-662` | The 9 F2a entries in `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` and literal story ids. | `read` confirms; a `grep` for the 9 ids in `AUDIT_RECORDS` (line 1175+) returns no matches — the move is complete. |
| `tests/stories/catalog/coverage.ts:108-129` | `CATALOG_SCENARIO_IDS` still lists the 9 ids (the full-catalog index is independent of the executable/pending split). | `read` confirms. |
| `tests/stories/harness/catalog-coverage.test.ts:216` | `tracks the executable coverage total` — the ledger now holds 140 executable records (not the plan's 58); F2a's 9 are a subset (see divergence). | `read` confirms. |
| `tests/scripts/story-coverage-totals.test.ts:12-19` | Runner totals are now `{ total: 165, executable: 140, pending: 25, readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 } }` (see divergence). | `read` confirms. |

Plan-vs-implementation notes:

- **Zero-default provider capabilities shift seeding into the stories.** The plan's story bodies did not seed capabilities for `SCN-task-query`/`-delete`/`-history`/`-comments`/`-labels`. Shipped, each of those five calls `given.taskCapabilities([...])` (e.g. `given.taskCapabilities(['tasks.count'])` at `lifecycle-and-policy.story.test.ts:76`; `['tasks.delete']` at :103; `['activities.read']` at :128; `['comments.read','comments.create','comments.update','comments.delete']` at :154; `['labels.create','labels.assign']` at :187) because the world constructs `MemoryTaskProvider` with no capabilities. This is documented in the spec's "Post-implementation deviations (2026-07-19)"; it makes provider-capability gating observable and is the rule F2b's gated-surface scenarios must follow.
- **Policy scenarios assert `resolveToolCapability`, not `availableTools`.** The plan's `SCN-task-not-configured`/`-deny` asserted `availableTools` contain/not-contain checks. Shipped, progressive disclosure makes `availableTools` non-discriminating (non-core tools are never advertised until a `load_tool` hop), so both scenarios assert `world.runtime.resolveToolCapability('tasks.create')` throws `'Unknown tool capability id'` while `resolveToolCapability('tasks.list')` resolves to `'list_tasks'` (`lifecycle-and-policy.story.test.ts:221` and :268-269). The `availableTools` deny behavior itself remains covered by the harness fixture test (`scenario.test.ts:111-113`). Documented in the spec's post-implementation deviations and reflected in the design's mapping table.
- **The ask flow polls for the buttons reply.** The plan's `SCN-task-ask-confirm` read the `perm:a:`/`perm:d:` callback synchronously via a single `permissionCallback` helper. Shipped, the synchronous read raced the fire-and-forget turn, so the story uses `waitForPermissionCallback` (`lifecycle-and-policy.story.test.ts:33-46`) — a bounded `setImmediate`-yield poll (200 attempts, no wall-clock sleep) — and `permissionCallback` takes a third `since` argument that snapshots the reply count at wait-entry so a later prompt cannot match an earlier prompt's stale buttons. Documented in the spec's post-implementation deviations.
- **The `permissionCallback` helper defensively narrows the buttons shape.** The plan's helper used `'buttons' in options` and `.callbackData`. Shipped (`lifecycle-and-policy.story.test.ts:12-31`) guards each level (`typeof options === 'object'`, `Array.isArray(buttons)`, `typeof button === 'object'`, `'callbackData' in button`, `typeof button.callbackData === 'string'`) to tolerate the actual recorded options shape at runtime, per the plan's "adjust the narrow in this helper only" instruction.
- **The ledger totals grew far beyond the plan's 58/128.** The plan projected 58 executable / 128 total / 70 pending after F2a. Shipped, the ledger is 140 executable / 165 total / 25 pending (`catalog-coverage.test.ts:216`; `story-coverage-totals.test.ts:12-19`) because F2b (the remaining `task-*` provider surface) and many later families have since landed. F2a's 9 entries are the subset this ADR covers; the move itself (9 entries from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`) is complete and correct.
- **`supportedMemoryTaskCapabilities` carries many more than the 3 F2a additions.** The plan added only `tasks.delete`/`tasks.count`/`activities.read`. Shipped (`memory-task-provider.ts:48-92`) the list also includes the full F2b provider surface (relations, statuses, projects, project-team, worklog, agiles/sprints, saved-queries, watchers, votes, visibility, provisioning, attachments, commands) landed by subsequent work; the 3 F2a additions are preserved within it.
- **`CORE_TOOL_CAPABILITIES` carries the full F2b surface too.** The plan's 14 entries are present at `core-capabilities.ts:16-29`; entries 30-67 (relations/statuses/projects/worklog/agiles/sprints/watchers/votes/visibility/identity/attachments/commands) are the later F2b registration, additive to F2a's block.

The source plan `docs/superpowers/plans/2026-07-19-f2a-task-lifecycle-story-family.md` and design `docs/superpowers/specs/2026-07-19-f2a-task-lifecycle-story-family-design.md` are archived alongside this ADR to `docs/archive/`.
