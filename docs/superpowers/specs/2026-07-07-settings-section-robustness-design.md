<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Settings-section robustness sweep

**Date:** 2026-07-07
**Origin:** deferred follow-ups from the CodingIdentitySection code review (see
[`docs/ux-reviews/CodingIdentitySection.md`](../../ux-reviews/CodingIdentitySection.md) and
[`2026-07-07-coding-identity-fixes-design.md`](./2026-07-07-coding-identity-fixes-design.md)).
**Scope:** full sweep across all applicable `client/settings/sections/` components.

## Problem

The settings SPA mounts every section once and drives it with a reactive `contextId={ctx}`
(`SettingsApp.svelte:196-231`), where `ctx = $derived(settingsSession.activeContextId)`. The
top bar has a **context switcher** (`SettingsTopBar.svelte:28` — a `Select` calling
`setActiveContext`) that mutates `activeContextId`, and **no section is wrapped in
`{#key ctx}`**. So switching context re-runs each section's `$effect → load(newId)` on the
same instance. Three latent robustness gaps follow from this and from shared-primitive/render
choices:

1. **Shared `Select` cannot be disabled.** `client/shared/ui/Select.svelte` has no `disabled`
   prop and no `:disabled` style, so sections built on it cannot lock their dropdowns while a
   save is in flight (a regression noted when `CodingIdentitySection` moved off a raw
   `<select disabled=…>` onto the shared primitive).
2. **A post-mutation reload failure nukes a loaded section.** Sections that `await patch()` →
   `await load()` → set a success status render a full-section `ErrorState` whenever the load
   error var is non-null. If the _reload_ fails, the user's successful save — and the entire
   form — is replaced by an error screen.
3. **Stale-`contextId` responses can overwrite the current context.** Sections whose `load(id)`
   lacks the `if (id !== contextId) return` guard can, on a fast context switch, let the
   previous context's response overwrite the newly-selected context's state — and a Save at
   that point writes the wrong context's data.

## Goal

Close all three gaps across every applicable section by **aligning to patterns the codebase
already contains** — not by inventing new ones:

- Guards match the 9 already-guarded sections (e.g. `MembersSection`, `IdentitySection`).
- The refresh-failure fix matches `ByokSection`/`CodeHostSection`/`MemorySection`, which
  already gate their full `ErrorState` on "never loaded".
- The `Select` `disabled` prop mirrors `Btn`'s existing `disabled` prop + `:disabled` style.

No backend/schema/fetcher changes.

## Approach

Three independent, independently-shippable **workstreams**, sequenced A → B → C. Rejected
alternative: extracting a shared `createSectionLoader` helper to DRY the guard/gate dance —
it would restructure every section's load flow (large blast radius) and diverge from the
inline-guard convention the codebase already uses. Per-section inline edits are the right
call.

Commits are organized **per concern** (not per file) so each stays reviewable, even though a
few sections (`CodingIdentitySection`, `GroupProviderSection`, `TaskProviderSection`) are
touched by more than one workstream.

---

## Workstream A — `Select` gains a `disabled` prop

**Primitive:** `client/shared/ui/Select.svelte`

- Add `disabled?: boolean` (default `false`) to `Props` (currently `value/options/onChange/testid`, `:15-19`).
- Bind it on the `<select>` element (`:31`).
- Add a disabled visual state mirroring `Btn` (`Btn.svelte:66`, `.ui-btn:disabled { opacity: 0.5; cursor: not-allowed }`): toggle a `ui-select--disabled` class on the `.ui-select` wrapper (`opacity` + `cursor: not-allowed`). Backward compatible — existing callers omit the prop and are unaffected.

**Wire `disabled={<in-flight flag>}` into the four Select-using sections that mutate:**

| Section                              | Select site    | In-flight flag                           |
| ------------------------------------ | -------------- | ---------------------------------------- |
| `CodingIdentitySection.svelte`       | `:121`, `:126` | `saving`                                 |
| `GroupProviderSection.svelte`        | `:91`          | `saving`                                 |
| `TaskProviderSection.svelte`         | `:126`         | `binding`                                |
| `admin/AdminInstancesSection.svelte` | `:311`, `:365` | the relevant create/apply in-flight flag |

**Out of scope:** `Input.svelte` also lacks a `disabled` prop (only `readonly`). Locking text
inputs during save is a reasonable further follow-up but is a separate primitive change, not
part of this sweep.

**Tests:** for each wired section, a client DOM test asserting the `Select`'s `<select>` gets
`disabled` while the in-flight flag is set (drive a never-resolving PATCH, assert
`select.disabled === true`).

---

## Workstream B — Stale-`contextId` guard sweep

Add the guard used by the already-correct sections to every unguarded per-context `load(id)`:

- after the awaited fetch(es) resolve: `if (id !== contextId) return` **before** writing any
  reactive state (`loaded`/`data`/domain state);
- in `catch`: `if (id === contextId) <error> = err`;
- in `finally`: `if (id === contextId) loading = false`.

**Sections (fully unguarded today):**

| Section                       | `load` fn |
| ----------------------------- | --------- |
| `AiOutputSection.svelte`      | `:36`     |
| `GroupProviderSection.svelte` | `:31`     |
| `KaneoAccessSection.svelte`   | `:25`     |
| `McpSection.svelte`           | `:72`     |
| `PluginsSection.svelte`       | `:51`     |
| `ProfileSection.svelte`       | `:29`     |
| `ReposSection.svelte`         | `:44`     |
| `TaskProviderSection.svelte`  | `:43`     |
| `ToolsSection.svelte`         | `:96`     |

**Partial — complete the guard:** `ReleaseSubscriptionSection.svelte:38` already guards the
group-scope success write but leaves the personal-scope write unguarded; extend the guard to
the personal path.

**Optional (included per full-sweep intent):** `admin/AdminPluginsApprovalSection.svelte:31`
closes over a `catalogContextId` prop with no re-check after its awaited load. It has a
different shape (prop, not id-param): capture `catalogContextId` into a local at the top of
`load()` and compare it after the await before writing state. All other admin sections use a
`load()` with **no** id param (global data, not context-switched) and are correctly out of
scope.

**Tests:** a race regression test per representative section — mount, let a slow response for
context A be in flight, switch to context B (fast response), then let A resolve, and assert
the displayed state is B's, not A's. (Because the settings test harness mounts with fixed
props, the plan will use a small wrapper or `contextId`-driven remount pattern; if a
deterministic race test proves too fragile for a given section, fall back to a unit-level
assertion that `load('other')` does not mutate state while `contextId` differs, and note it.)

---

## Workstream C — A refresh failure must not nuke a loaded section

Converge on the `ByokSection`/`CodeHostSection`/`MemorySection` pattern: render the full
`ErrorState` **only when the section has never loaded**, and once loaded, surface a reload
error as a **non-blocking inline banner** (`<p class="status-error" role="alert">`) above the
controls, preserving the form and any success status.

For each section, tighten the top-level gate to also require the not-yet-loaded flag the
section already tracks, and add the inline banner for the loaded-but-refresh-failed case:

| Section                                | Gate today                 | Tighten to                                | Not-loaded flag  |
| -------------------------------------- | -------------------------- | ----------------------------------------- | ---------------- |
| `CodingIdentitySection.svelte:109`     | `{#if loadError !== null}` | `loadError !== null && !loaded`           | `loaded` (`:45`) |
| `GroupProviderSection.svelte:79`       | `{#if loadError !== null}` | `loadError !== null && data === null`     | `data`           |
| `TaskProviderSection.svelte:112`       | `{#if error !== null}`     | `error !== null && instanceData === null` | `instanceData`   |
| `GuestModeSection.svelte:90`           | `{#if error !== null}`     | `error !== null && enabled === null`      | `enabled`        |
| `ReleaseSubscriptionSection.svelte:85` | `{#if loadError !== null}` | `loadError !== null && enabled === null`  | `enabled`        |

Already-correct (leave untouched): `ByokSection`, `CodeHostSection`,
`CodingCredentialsSection`, `MemorySection` (gate on `currentData === null` /
`currentMemory === null`), and `IdentitySection` (uses a separate silent `refresh()` after
save, so a refresh failure never flips the blocking `loadError` view).

**Tests:** for each of the five sections, a client DOM test: load successfully, trigger a
mutation whose subsequent reload fails, and assert the form/controls (and success status
where the section sets one) remain visible with an inline error — i.e. the full `ErrorState`
does **not** take over.

---

## Testing summary

All tests use the existing client DOM harness (Svelte `mount` + happy-dom + `setMockFetch`;
run with `bun run test:client`, or per-file with
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`).
New assertions are additive to each section's existing test file where one exists; a new test
file is created following the sibling pattern where one does not. Each workstream must leave
`bun run test:client` green (modulo the two pre-existing, unrelated `MemorySection` failures
already present on `master`, which are out of scope for this work).

## Out of scope

- `Input.svelte` `disabled` prop.
- Any backend/schema/fetcher change.
- The 2 pre-existing `MemorySection` unit-test failures on `master`.
- A shared `createSectionLoader` refactor (rejected above).
- `{#key ctx}`-based remount in `SettingsApp` as an alternative to per-section guards
  (larger behavioral change; the per-section guard is the established convention).
