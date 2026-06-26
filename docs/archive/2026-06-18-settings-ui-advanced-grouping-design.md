<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings UI — Advanced Grouping — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

The settings SPA renders every section on one long page, which is overwhelming for a
first-time/beta user. Reorganize the **personal** sections into two tiers: a small set of
common sections at the top level, and a **collapsible "Advanced" group (collapsed by
default)** holding the rest. The Advanced container collapses the actual content in the
main column (not just the sidebar nav), so the default view is short. Admin and group-only
sections are unchanged.

## Background — current system

- **`SettingsApp.svelte`** is the single place sections are ordered. A `groups` derived
  value (≈lines 68–99) returns `SidebarGroup[]`:
  - **Personal**: `profile`, `memory`, `task-provider`, `tools`, `ai-output`, `byok`,
    `identity` (+ group-only `members`, `group-provider` when `isGroup`).
  - **Integrations**: `mcp`, `plugins`.
  - **Admin** (`danger: true`, bot-admin/super-admin gated): instances, system, byok-admin,
    plugin-config, users, groups, announce, admins, plugin-approval, feature-flags.
- The page body renders each section component inside `<div class="settings-group">`
  wrappers; each section is a `<section id="…">` whose id matches its sidebar item.
- **`SettingsSidebar.svelte`**: sticky desktop nav; `SidebarGroup = { kicker, items, danger? }`.
  No collapse mechanism. `SettingsJumpMenu.svelte`: mobile `<select>`/`<optgroup>` mirror.
- **`scrollspy.ts`** (`useScrollSpy`): `IntersectionObserver` over the flattened
  `sectionIds` (derived ≈line 101); keeps the active link + URL hash in sync.
- Sections take only `contextId` and do no role/context gating themselves — all gating is
  imperative in `SettingsApp.svelte`.

## Goals

- **Top level (Personal):** `profile`, `task-provider`, `tools` (+ group-only `members`,
  `group-provider`).
- **New collapsible "Advanced" group, collapsed by default:** `memory`, `ai-output`,
  `identity`, `byok`, `mcp`, `plugins` (the standalone "Integrations" group is folded in).
- Collapsing hides the Advanced **content** in the main column, so the initial page is
  short; expanding reveals it. State mirrored in the sidebar.
- A deep link / URL hash to an Advanced section (`#identity`) **auto-expands** the group
  and scrolls to it.
- Admin zone and all role/context gating unchanged.

## Non-goals

- No change to any individual section's content, fetchers, or APIs.
- No persistence of the collapsed/expanded state across reloads (in-memory only;
  hash-targeting handles deep links). Persistence can be added later if wanted.
- No new router; still a single scrolling page with anchor nav.

## Design

### Section grouping (`SettingsApp.svelte`)

Restructure the `groups` derived value into three personal-facing groups plus Admin:

```ts
// Personal (top level)
{ kicker: 'Personal', items: [
  { id: 'profile', label: 'Profile' },
  { id: 'task-provider', label: 'Task provider' },
  { id: 'tools', label: 'Tools' },
  ...(isGroup ? [{ id: 'members', label: 'Members' },
                 { id: 'group-provider', label: 'Group provider' }] : []),
] }
// Advanced (collapsible, collapsed by default)
{ kicker: 'Advanced', collapsible: true, items: [
  { id: 'memory',    label: 'Memory' },
  { id: 'ai-output', label: 'AI output' },
  { id: 'identity',  label: 'Identity' },
  { id: 'byok',      label: 'BYOK LLM' },
  { id: 'mcp',       label: 'MCP' },
  { id: 'plugins',   label: 'Plugins' },
] }
// Admin (unchanged)
```

(Item order within Advanced is not load-bearing; the listing above is the proposed order.)

### Collapsible content in the main column

The reduction-of-overload requirement is about the **content**, so the Advanced sections
are wrapped in a collapsible container in `<main>`:

- A single shared `collapsed` state (`$state(true)`) in `SettingsApp.svelte` drives both
  the main-column container and the sidebar group.
- Wrap the Advanced section components in a labeled, collapsible block — a header row
  ("Advanced" + chevron + short caption like "Memory, integrations, identity, BYOK, AI
  output") and the section list rendered only when expanded. Use a native
  `<details>`/`<summary>` or an explicit button + `{#if !collapsed}` block (whichever
  matches the existing component primitives; `<details>` gives keyboard/a11y for free).
- Group-only sections (`members`, `group-provider`) remain top-level (not advanced).

### Sidebar + jump menu

- `SidebarGroup` gains optional `collapsible?: boolean` and the sidebar tracks the same
  collapsed state (passed in or shared via a small store). A collapsible group renders its
  `kicker` as a toggle (chevron); its `items` list is hidden when collapsed.
- `SettingsSidebar.svelte` reuses the existing active-link styling; clicking the Advanced
  kicker toggles `collapsed`.
- `SettingsJumpMenu.svelte` (mobile): the `<optgroup label="Advanced">` is always present
  (a `<select>` has no collapse); selecting an Advanced option sets the hash, which
  triggers the auto-expand below so the target is visible after navigation.

### Deep-link / hash auto-expand

- On mount and on `hashchange`, if `location.hash` targets a section in the Advanced group,
  set `collapsed = false` **before** scroll/scrollspy resolves, so the anchor exists and
  is reachable.
- `scrollspy.ts` keeps deriving `sectionIds` from the flattened `groups`. While Advanced is
  collapsed its sections are not in the DOM, so the observer simply won't report them —
  acceptable, because the only way to reach them is via a link/hash that first expands the
  group. (Alternative if we prefer the sections always observable: keep them mounted but
  visually collapsed via CSS height; the chosen approach unmounts for a genuinely shorter
  DOM. We go with unmount-when-collapsed.)

### Accessibility

- The Advanced toggle is a real `<button>`/`<summary>` with `aria-expanded` and
  `aria-controls` pointing at the content container; chevron state reflects expansion.

## Testing

Client suite (happy-dom, `tests/client/...`):

- Advanced group is **collapsed by default**: its section components are not rendered;
  top-level sections (Profile, Task provider, Tools) are.
- Expanding via the sidebar/main toggle renders the Advanced sections; collapsing hides
  them again.
- Deep link: mounting with `location.hash = '#identity'` auto-expands Advanced and the
  `identity` section is present.
- Group context: `members` / `group-provider` render at top level (not under Advanced);
  Advanced still collapses independently.
- Admin zone renders unchanged for bot-admin / super-admin and is unaffected by the
  Advanced collapse state.
- `aria-expanded` flips with the toggle.

## Files touched

- `client/settings/SettingsApp.svelte` — regrouped `groups`, shared `collapsed` state,
  Advanced content wrapper, hash auto-expand.
- `client/settings/components/SettingsSidebar.svelte` — `collapsible` group rendering +
  toggle.
- `client/settings/components/SettingsJumpMenu.svelte` — Advanced optgroup (+ ensure hash
  selection expands).
- `client/settings/scrollspy.ts` — only if `sectionIds` derivation needs to tolerate
  collapsed (unmounted) sections; otherwise unchanged.
- Tests as above.
