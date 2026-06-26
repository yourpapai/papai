<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0208: Settings UI Advanced Grouping

## Status

Implemented

## Date

2026-06-18

## Context

The `/settings` SPA ships every personal section on one long single-scroll page. After the ADR-0187 redesign the rail already grouped sections under PERSONAL / INTEGRATIONS / ADMIN kickers, but the main column rendered every section component unconditionally, so a first-time/beta user landed on a wall of forms (Memory, AI output, Identity, BYOK, MCP, Plugins) before reaching the common ones (Profile, Task provider, Tools). The 2026-06-18 design (`docs/superpowers/specs/2026-06-18-settings-ui-advanced-grouping-design.md`) proposed a two-tier personal layout: a small set of common sections stays at the top level, and the rest move into a collapsible **Advanced** group that is collapsed by default.

The reduction-of-overload requirement is about the **content**, not just the nav: collapsing must hide the Advanced section components in the main column so the default DOM is genuinely shorter, not merely scrolled out of view. Deep links (`/settings#identity`) and the mobile jump menu must still reach Advanced sections, which means a hash targeting an Advanced id has to expand the group before the anchor resolves. The Admin zone and all role/context gating are out of scope and must stay unchanged.

The architecture is concentrated in two files: `SettingsApp.svelte` owns a single `advancedCollapsed` state and derives both the sidebar group shape and the scroll-spy observation set from it, and `SettingsSidebar.svelte` gains collapsible-group rendering with an `onToggle` callback. `scrollspy.ts` itself is untouched — the observer is simply re-established over a filtered id list.

## Decision Drivers

- **Default view must be short.** Collapsing hides the Advanced content in the main column, not just the sidebar links; the unmounted DOM is genuinely smaller.
- **Deep-link parity.** A URL hash targeting an Advanced section must auto-expand the group and scroll to it; the mobile `<select>` jump menu (which has no collapse) must keep working by relying on the same hash path.
- **Scroll-spy correctness.** The `IntersectionObserver` must never observe unmounted sections; the observation set has to track the collapsed state.
- **No new router.** Stay a single scrolling page with anchor nav; preserve the ADR-0187 rail + scroll-spy architecture.
- **Accessibility.** The Advanced toggle is a real `<button>` with `aria-expanded` and `aria-controls` pointing at the content container; the sidebar kicker is a toggle button, not a styled `<div>`.
- **No persisted state.** The collapsed/expanded flag is in-memory only; hash-targeting handles deep links, and persistence can be added later if wanted.

## Considered Options

### Option 1: CSS-only collapse (keep mounted, hide via `max-height`/`visibility`)

- **Pros:** scroll-spy stays trivial — sections are always in the DOM and observable; no rebuild on toggle.
- **Cons:** the Advanced content stays in the layout (taller render tree, form inputs still live in the DOM); `aria-hidden` management is error-prone; the "genuinely short default view" goal is only partially met.

### Option 2: Unmount-when-collapsed via `{#if !advancedCollapsed}` (chosen)

- **Pros:** genuinely shorter DOM; the scroll-spy filter is a one-line derived expression; no `aria-hidden` leak because the nodes do not exist; matches the spec's explicit "we go with unmount-when-collapsed" choice.
- **Cons:** scroll-spy must be re-established over a filtered id list; a deep link must flip `advancedCollapsed` to `false` before the anchor resolves, so the expand has to happen in initial state plus a `hashchange` handler.

### Option 3: Route/fragment-based split (separate "page" for Advanced)

- **Pros:** cleanest separation; each tier is its own view.
- **Cons:** introduces a router the SPA does not have; loses the single-page scroll-spy and the anchor-nav UX; breaks the deep-link expectation that `#identity` lands on the section in place; largest blast radius for the least structural gain.

## Decision

Six coordinated changes implement the grouping, all confined to the settings SPA shell (no backend, route, or fetcher changes):

### 1. Collapsible `SidebarGroup` (`client/settings/components/SettingsSidebar.svelte`)

`SidebarGroup` gains optional `collapsible?: boolean` and `collapsed?: boolean`, and `Props` gains `onToggle?: (kicker: string) => void`. A collapsible group renders its kicker as a real `<button type="button">` carrying `aria-expanded={group.collapsed !== true}` and `data-testid="sidebar-toggle-${group.kicker}"`, with a chevron (`▸`/`▾`) that reflects the collapsed state; the items `<nav>` is wrapped in `{#if group.collapsed !== true}` so the links unmount when collapsed. Non-collapsible groups keep the plain kicker `<div>` and the existing active-link styling (`aria-current`, `settings-sidebar__link--active`).

### 2. Single `advancedCollapsed` state (`client/settings/SettingsApp.svelte`)

A single `let advancedCollapsed = $state(!ADVANCED_IDS.includes(initialHash))` is the source of truth. It initializes expanded when the mount-time hash (`window.location.hash.slice(1)`) targets an Advanced section, so a deep link expands the group **before** the first render rather than after. The same flag drives the sidebar group's `collapsed` field and the main-column `{#if !advancedCollapsed}` wrapper; `toggleAdvanced()` flips it and is passed as the sidebar's `onToggle`.

### 3. Unmount-when-collapsed main-column wrapper

The Advanced section components render inside `<div class="settings-group settings-advanced">` behind a `<button data-testid="advanced-toggle" aria-expanded={!advancedCollapsed} aria-controls="settings-advanced-content">` header and a `{#if !advancedCollapsed}<div id="settings-advanced-content">…</div>{/if}` body. The header carries a hint ("Memory, AI output, identity, BYOK, integrations") so the collapsed state still advertises what is inside. Group-only sections (`members`, `group-provider`) stay top-level alongside Profile/Task provider/Tools and are never folded into Advanced.

### 4. `observableSectionIds` scroll-spy filter

`sectionIds` is still the flattened `groups` id list (so the sidebar/jump menu keep the full set), but `observableSectionIds = $derived(advancedCollapsed ? sectionIds.filter((id) => !ADVANCED_IDS.includes(id)) : sectionIds)` is what `useScrollSpy` consumes. The observer is rebuilt (via the existing `$effect` that owns `spy.start()`/`spy.stop()`) whenever the derived set changes, so it never tries to observe unmounted Advanced sections and re-covers them once expanded. `scrollspy.ts` itself is unchanged.

### 5. `hashchange` auto-expand + first-ready scroll

Two `$effect` blocks handle hash targeting. The first registers a `hashchange` listener: if the new hash is in `ADVANCED_IDS`, it sets `advancedCollapsed = false` and `tick().then(() => document.getElementById(id)?.scrollIntoView())`, so a sidebar link, jump-menu selection, or in-page hash change expands and scrolls in one step. The second scrolls on the first ready render for an initial hash (the mount-time state already expanded the group, so the anchor exists). Scroll-spy writes the hash via `history.replaceState` (no `hashchange` event), so it never re-triggers the auto-expand handler — there is no hash loop.

### 6. Mobile jump menu unchanged

`SettingsJumpMenu.svelte` is a `<select>` with `<optgroup>`s and has no collapse concept; it already lists every group. Selecting an Advanced option sets `location.hash`, which fires the `hashchange` handler above, so the group expands and the target becomes visible after navigation. No edit was required.

## Consequences

### Positive

- The default `/settings` view is short: Profile, Task provider, Tools (plus Members/Group provider in a group context) and a collapsed Advanced header.
- Advanced sections unmount when collapsed, so the DOM, form input count, and layout cost are genuinely smaller — not just visually hidden.
- Deep links (`#identity`), sidebar links, and mobile jump-menu selections all auto-expand Advanced and scroll to the target via one shared `hashchange` path.
- The scroll-spy observation set tracks the collapsed state, so the active link never desynchronizes and never observes unmounted sections.
- Accessibility is real: both the sidebar kicker and the main-column header are `<button>`s with `aria-expanded`/`aria-controls`, and the chevron reflects state.
- No backend, route, fetcher, or individual-section changes; the work is confined to the SPA shell.

### Negative

- **No persisted collapse state.** The flag is in-memory; a reload of `/settings` (with no hash) collapses Advanced again. The spec calls this out as a deliberate non-goal; persistence can be added later if wanted.
- **Scroll-spy rebuilds on every toggle.** Expanding/collapsing re-runs the `$effect` that owns `spy.start()`/`spy.stop()` because `observableSectionIds` changes. The cost is negligible for the section counts involved but is a re-subscription, not a no-op.
- **Group membership drifted after shipping.** The plan's `ADVANCED_IDS` had six entries (`memory`, `ai-output`, `identity`, `byok`, `mcp`, `plugins`); the shipped list has eight (adds `coding-credentials` and `code-host`), and the Personal group gained group-only `guest-mode` and `kaneo-access`, and the Admin zone gained `AdminToolDefaultsSection`. These were added by later work on top of this plan's baseline; the collapse/expand/deep-link architecture itself is unchanged.

### Risks

- **Stale `ADVANCED_IDS`.** Because the unmount condition, the `observableSectionIds` filter, the deep-link checks, and the sidebar group items all key off `ADVANCED_IDS`, a new Advanced section added without updating the constant would render inside the collapsed wrapper but not be deep-link-expandable. The constant is the single source of truth and must be edited in lockstep with the Advanced group's `items`.
- **`hashchange` reliance on `replaceState` discipline.** The no-loop invariant depends on scroll-spy writing the hash with `history.replaceState` (which does not fire `hashchange`). Any future code that sets `location.hash = …` instead would re-trigger the auto-expand handler. This is a convention the file already follows, but it is implicit.
- **Mobile jump menu shows Advanced even when collapsed.** Because the `<select>` has no collapse, Advanced options are always selectable; the `hashchange` handler makes that work, but a user who picks an Advanced option sees the group expand rather than a pre-expanded list.

## Related Decisions

- ADR-0136, ADR-0137, ADR-0138: Settings Web UI — access model, HTTP API, and client SPA whose shell this grouping restructures.
- ADR-0187: Settings Page Redesign — the grouped sidebar rail, scroll-spy, and `.settings-group` layout this change builds on; ADR-0187's risks already note the Integrations group being refined into this collapsible Advanced disclosure.
- ADR-0188: AI Output settings — the `AiOutputSection` that lives under the collapsed Advanced group.

## Implementation Notes

Confirmed present in the repo:

- `client/settings/components/SettingsSidebar.svelte` — `SidebarGroup` gains `collapsible?`/`collapsed?` (`:15`–`:16`), `Props.onToggle?` (`:22`), the collapsible kicker `<button>` branch with `aria-expanded={group.collapsed !== true}` (`:35`) and `data-testid="sidebar-toggle-${group.kicker}"` (`:36`), and the `{#if group.collapsed !== true}` items unmount (`:46`).
- `client/settings/SettingsApp.svelte` — `ADVANCED_IDS` constant (`:46`); `advancedCollapsed` initialized from `!ADVANCED_IDS.includes(initialHash)` (`:76`); grouped `SidebarGroup[]` builder with the collapsible Advanced group (`:80`–`:117`); `observableSectionIds` filter (`:122`–`:124`); `toggleAdvanced()` (`:128`–`:130`); `hashchange` auto-expand effect (`:140`–`:149`); first-ready scroll effect (`:152`–`:158`); `useScrollSpy(observableSectionIds, …)` (`:162`); `onToggle={toggleAdvanced}` on the sidebar (`:186`); `.settings-advanced` wrapper with `advanced-toggle` testid, `aria-expanded`/`aria-controls="settings-advanced-content"`, and `{#if !advancedCollapsed}` body (`:199`–`:223`).
- `tests/client/settings/components/SettingsSidebar.test.ts` — `describe('SettingsSidebar collapsible group', …)` block (`:66`): collapsed group renders `sidebar-toggle-Advanced` with `aria-expanded="false"` and hides its links; expanded group shows links with `aria-expanded="true"`; clicking the toggle calls `onToggle` with `'Advanced'`.
- `tests/client/settings/SettingsApp.test.ts` — `advanced-toggle` testid assertion; "expanding Advanced renders its sections"; "a deep link to an Advanced section auto-expands the group" (mounts with `history.replaceState(null, '', '/settings#identity')` and asserts `#identity` is present); "group-only sections stay top-level while Advanced is collapsed".
- `client/settings/scrollspy.ts` — unchanged; the filter is applied at the call site, not inside the hook.
- `client/settings/components/SettingsJumpMenu.svelte` — unchanged; the `<select>`/`<optgroup>` mirror relies on the `hashchange` path to expand Advanced on selection.
