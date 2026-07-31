<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0267: Settings Section Robustness — B: Stale contextId Guard

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

The settings SPA mounts every section once and drives it with a reactive `contextId={ctx}` (`SettingsApp.svelte`), where `ctx = $derived(settingsSession.activeContextId)`. The top-bar context switcher (`SettingsTopBar.svelte` — a `Select` calling `setActiveContext`) mutates `activeContextId`, and **no section is wrapped in `{#key ctx}`**, so switching context re-runs each section's `$effect → load(newId)` on the *same* instance. Nine sections already guarded against the resulting race (e.g. `MembersSection`, `IdentitySection`, `CodingIdentitySection`), but ten more did not: their `load(id)` awaited a fetch and then unconditionally wrote reactive state. On a fast context switch, a slow response for the *previous* context could resolve last and overwrite the newly-selected context's `data`/`selected`/`fields` — and a Save at that moment would write the wrong context's data. `ReleaseSubscriptionSection` was half-guarded (its group-scope write was guarded; its personal-scope write was not).

The shared design (`docs/superpowers/specs/2026-07-07-settings-section-robustness-design.md`, Workstream B) and plan (`docs/superpowers/plans/2026-07-07-settings-robustness-B-contextid-guard.md`) resolved it by applying the exact three-part guard the already-correct sections use — `if (id !== contextId) return` after the awaited fetch(es) and before the first reactive write; `if (id === contextId) <err> = err` in `catch`; `if (id === contextId) loading = false` in `finally` — to every unguarded per-context `load(id)`, plus completing the `ReleaseSubscriptionSection` partial guard and (optionally) the admin `AdminPluginsApprovalSection` prop-based variant. No backend, schema, or fetcher changes.

## Decision Drivers

- **A stale response must never overwrite the current context.** After any context switch, only the response for the *current* `contextId` may write reactive state; late responses for previous contexts are discarded.
- **A late error must not surface on the wrong context.** The `catch` error assignment and the `finally` loading reset are gated on the same `id === contextId` check, so a previous context's failure cannot flip the current view into an error/loading state.
- **Align to the pattern the codebase already contains.** Mirror the 9 already-guarded sections verbatim rather than inventing a new abstraction; reject a shared `createSectionLoader` helper (large blast radius, diverges from the inline-guard convention).
- **Transparent to existing single-context tests.** The guard is a no-op when `id === contextId`, so each section's existing client test must stay green unchanged — green is the regression proof for the mechanical sweep.
- **One deterministic race regression test, not ten fragile ones.** A bespoke reactive-`contextId` fixture proves the guard genuinely discards a late response for one representative section (`GroupProviderSection`); the remaining sections are verified by suite-green, since they apply the identical proven pattern.

## Considered Options

### Option 1 — Per-section inline three-part guard; one race regression test (chosen)

Apply the `if (id !== contextId) return` / `if (id === contextId)` guard verbatim to every unguarded `load(id)`; build one reactive-`contextId` fixture + race test for `GroupProviderSection`; verify the rest via their existing single-context test files.

- **Pros:** matches the established convention exactly; guard is a no-op for single-context tests so regression risk is near-zero; smallest blast radius; the one race test proves the mechanism end-to-end.
- **Cons:** ten near-identical inline edits (mechanical, reviewable but repetitive); only one section gets an explicit race test, relying on pattern-sameness for the rest.

### Option 2 — Extract a shared `createSectionLoader(id, contextId, …)` helper

DRY the guard/gate dance into one helper every section calls.

- **Pros:** one place to maintain the guard.
- **Cons:** restructures every section's load flow (very large blast radius); diverges from the inline-guard convention the codebase already uses; rejected explicitly in the shared design.

### Option 3 — `{#key ctx}` remount in `SettingsApp`

Force a fresh section instance per context instead of guarding in-place.

- **Pros:** eliminates the race structurally — a stale instance is destroyed.
- **Cons:** larger behavioral change (remount discards in-flight state, local draft input, scroll position, and animation); rejected in the shared design in favor of the established per-section guard.

## Decision

The chosen Option 1 shipped across all targeted sections plus the representative race test and a reusable harness:

1. **Full three-part guard applied to the nine fully-unguarded sections:** `AiOutputSection`, `GroupProviderSection`, `KaneoAccessSection`, `McpSection`, `PluginsSection`, `ProfileSection`, `ReposSection`, `TaskProviderSection`, `ToolsSection` — each `load(id)` now returns early when `id !== contextId` after its awaited fetch(es), and gates its `catch` error write and `finally` loading reset on `id === contextId`.
2. **`ReleaseSubscriptionSection` partial guard completed.** The early `return` now covers both the personal- and group-scope success writes (previously only the group path was guarded), and the `catch` error write is gated on `id === contextId`.
3. **`AdminPluginsApprovalSection` (optional) guarded.** Its prop-based variant captures `const id = catalogContextId` at the top of `load()` and compares `id !== catalogContextId` after the await before writing, with `catch`/`finally` similarly gated.
4. **Reusable reactive-`contextId` race harness.** `tests/client/settings/sections/section-race-harness.svelte.ts` exports a settable `raceState` (`$state<{ contextId: string }>`); `GroupProviderRaceFixture.svelte` binds a live-mounted `GroupProviderSection` to it, simulating the top-bar switcher.
5. **Race regression test.** `GroupProviderSection.test.ts` mounts the fixture, lets a slow `ctxA` response stay pending, switches to `ctxB` (fast), then resolves `ctxA` late — and asserts the rendered Select still holds `ctxB`'s value (`kaneo-b`), proving the guard discards the stale `ctxA` write.

## Consequences

### Positive

- A fast context switch can no longer let a previous context's response overwrite the current context's state in any per-context section, eliminating both the wrong-context render and the wrong-context Save.
- Late errors and late loading resets for a previous context no longer leak onto the current view.
- The guard mirrors the 9 already-correct sections, so the codebase now has one consistent load-guard convention rather than a split.
- The reusable `raceState` harness can host future per-section race tests without a new fixture module per section.

### Negative

- The guard is duplicated inline across ten sections (accepted as the cost of following the established convention over a shared helper).
- Only `GroupProviderSection` carries an explicit race regression test; the other nine rely on pattern-sameness + existing single-context tests staying green.

### Risks

- **Future sections that add a `load(id)` may forget the guard.** The convention is idiomatic but not enforced by a shared abstraction or lint; a new unguarded section would reintroduce the race. The reusable harness lowers the cost of adding a race test but does not mandate one.
- **Sections that fetch multiple resources must place the guard after *all* awaits.** `TaskProviderSection` (config + instance `Promise.all`) and `KaneoAccessSection` (status check then body read) are correctly guarded, but a future multi-await refactor could slip a write before the guard.

## Related Decisions

- **ADR-0266: Settings Section Robustness — A: Save-Locking Selects** — sibling workstream from the same shared design; shares the `GroupProviderSection`/`TaskProviderSection` touch points.
- **ADR-0268: Settings Section Robustness — C: Refresh-Failure Gate** — sibling workstream from the same shared design; Workstream C's plan recommended running B first so the reload's own error write is contextId-guarded, and the two compose cleanly in the shipped tree.
- The 9 already-guarded sections (`MembersSection`, `IdentitySection`, `CodingIdentitySection`, …) whose pattern this sweep replicates.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/GroupProviderSection.svelte:38` | `if (id !== contextId) return` after `fetchGroupTaskInstance`. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:46` | `catch`: `if (id === contextId) loadError = err`. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:48` | `finally`: `if (id === contextId) loading = false`. | `read` confirms. |
| `client/settings/sections/AiOutputSection.svelte:41,44,46` | Guard / catch / finally gated on `id === contextId`. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:41` | First guard after the status fetch. | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:47` | Second guard after `readBody` (before the schema parse). | `read` confirms. |
| `client/settings/sections/KaneoAccessSection.svelte:55,57` | `catch` / `finally` gated. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:94,98-101,103` | Guard / catch / finally gated. | `read` confirms. |
| `client/settings/sections/PluginsSection.svelte:56,59,61` | Guard / catch / finally gated. | `read` confirms. |
| `client/settings/sections/ProfileSection.svelte:34,37,39` | Guard / catch / finally gated. | `read` confirms. |
| `client/settings/sections/ReposSection.svelte:49,52,54` | Guard / catch / finally gated. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:48` | Guard after `await Promise.all([fetchConfig, fetchContextTaskInstance])`. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:57,59` | `catch` / `finally` gated. | `read` confirms. |
| `client/settings/sections/ToolsSection.svelte:104,109,111` | Guard / catch / finally gated. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:37-38` | Scope-branch fetch then single `if (id !== contextId) return` covering both personal + group writes. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:41` | `catch`: `if (id === contextId) loadError = messageFrom(err)`. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsApprovalSection.svelte:32` | `const id = catalogContextId` captured at top of `load()`. | `read` confirms. |
| `client/settings/sections/admin/AdminPluginsApprovalSection.svelte:38,41,43` | Guard / catch / finally gated on `id === catalogContextId`. | `read` confirms. |
| `tests/client/settings/sections/section-race-harness.svelte.ts:10` | Reusable `raceState` (`$state<{ contextId: string }>`). | `read` confirms. |
| `tests/client/settings/sections/GroupProviderRaceFixture.svelte:8` | Fixture binds `GroupProviderSection contextId={raceState.contextId}`. | `grep` confirms. |
| `tests/client/settings/sections/GroupProviderSection.test.ts:338-362` | Race regression test: late `ctxA` discarded, Select holds `kaneo-b`. | `read` confirms. |

Plan-vs-implementation notes:

- **`ReleaseSubscriptionSection`'s guard was restructured, not duplicated.** The plan (Task 10) expected the existing group-scope guard to remain and a *second* `if (id !== contextId) return` to be added before the personal-scope write. Shipped instead collapses the scope choice into the fetch expression (`scope === 'group' ? fetchGroupReleaseSubscription(id) : fetchReleaseSubscription()` at `:37`) and places a *single* guard (`:38`) after it, so one guard covers both branches. Intent is preserved (both writes are protected); the shape is cleaner than the plan's two-guard form. Also note `ReleaseSubscriptionSection` has no `loading` flag (it proxies load via `enabled === null`), so there is no `finally` loading-reset to guard — consistent with the plan's "guard the writes that exist" intent.
- **`KaneoAccessSection` carries a second guard.** Its `load()` awaits the HTTP status, then awaits `readBody` before parsing; shipped places a guard after *each* await (`:41` and `:47`). The plan specified a single guard after the awaited fetch(es); the second guard is a stricter variant that also covers the body-read window — a minor enhancement, not a regression.
- **`AdminPluginsApprovalSection` (optional Task 11) was completed.** The plan marked it optional "included per full-sweep intent"; it shipped with the prop-capture pattern exactly as described.
- **The race harness was made reusable, not GroupProvider-specific.** The plan's `section-race-harness.svelte.ts` carried a single `contextId` field; shipped adds a doc-comment stating it is reusable across per-section race fixtures ("add one field here per section"). Only the `GroupProviderRaceFixture` + test exist today, matching the plan's one-race-test coverage decision.
- **`CodingIdentitySection` is guarded but was not a B target.** Its `load()` (`:58`,`:65`,`:67`) carries the same guard, but that predates / lands with ADR-0261's concurrent rewrite; Workstream B did not list it (the spec counted it among the already-guarded set). Noted here only to avoid mis-attribution.

The source plan `docs/superpowers/plans/2026-07-07-settings-robustness-B-contextid-guard.md` is archived alongside this ADR to `docs/archive/`. The shared design spec (`2026-07-07-settings-section-robustness-design.md`) is archived with ADR-0266.
