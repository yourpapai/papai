<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — SettingsApp

**Date:** 2026-08-05
**Reviewed:** `client/settings/SettingsApp.svelte` (with `components/SettingsSidebar.svelte`, `components/SettingsJumpMenu.svelte`, `components/SettingsTopBar.svelte`, `shared/ui/Shell.svelte`, `settings.css`, `session.svelte.ts`)
**States captured:** Personal ready, Group ready, Admin ready, Loading, advanced-expanded, sidebar-link-hover, admin zone · desktop (1280) + 760px + 720px breakpoint edge + 640px narrow + 600px-tall viewport
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

This is the shell every settings visit passes through: it owns the three top-level session
gates, both navigation surfaces, the group/collapse model, and the scrollspy. Findings about
what happens *inside* a section belong to that section's own review; findings here are about
the frame.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                    |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | The Personal/Advanced/Admin kickers and the red ADMIN zone read cleanly, but an admin gets 30 flat sidebar links of which only 10 collapse |
| 2. Affordance & signifiers      | warn  | Sidebar active/hover states are unambiguous; the inline Advanced disclosure is a full-width button styled as a horizontal rule            |
| 3. Consistency w/ design system | warn  | Sidebar and top bar use shared primitives, but the sole sub-720px navigation is a raw `<select>` rather than the shared `Select`          |
| 4. Feedback & state             | fail  | Two of the shell's three session states are weak: an unannounced bare "Loading…", and an expired-session screen that is a dead end        |
| 5. Content & language           | warn  | The Advanced hint names five things for ten sections, and "Analytics"/"BYOK LLM" each appear twice in the nav with no disambiguation      |
| 6. Accessibility                | warn  | Semantics are sound (`aria-expanded`/`aria-controls`/`aria-current`, real buttons and labels); the loading gate has no live region        |
| 7. Responsive / layout          | fail  | The sticky sidebar's `max-height: 100vh` overshoots the shell's scrollport, clipping the tail of the admin nav out of reach               |
| 8. Spacing, alignment & sizing  | warn  | Shell chrome is built from one-off px (20/16/13/12/11/9/6/2) while the sections it frames use the `--gap-*` tokens                        |
| 9. Interaction & micro-states   | warn  | The focus ring is a hardcoded rgba scoped to `.settings-grid`, so the top bar, jump menu, and both gates fall back to the UA default      |

## Findings

Severity-ranked, highest first.

### [High] The sticky sidebar is taller than the area it can be seen in, so its last links are unreachable

- **Id:** settings-app-sidebar-tail-unreachable
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `SettingsApp-—-admin-sidebar-short-viewport-1.png` (1280×600) — the nav is cut mid-item after "Groups"; `settings-SettingsApp-Admin-ready-1.png` shows the same cut after "Plugin approval"
- **Source:** `client/settings/components/SettingsSidebar.svelte:71` (`position: sticky; top: 0; max-height: 100vh; overflow-y: auto`) against `client/shared/ui/Shell.svelte:35` (the scrollport is `.ui-shell__body`, which is `100vh` minus the 48px top bar and its own 16px padding)
- **Suggested fix:** Size the sticky sidebar against the shell's scrollport height rather than `100vh` — the ~80px difference is currently rendered below the visible area, and because the element is sticky the outer scroll never brings it back, so the final one or two admin links can be scrolled to inside the sidebar but never painted on screen.

### [High] A network failure and an expired link are both reported as "Session expired", with no way out of the page

- **Id:** settings-app-unauthenticated-dead-end
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** not capturable — see `settings-app-unauthenticated-state-uncaptured` below; read from source
- **Source:** `client/settings/session.svelte.ts:45` (bare `catch` collapsing every bootstrap failure into `unauthenticated`) rendered by `client/settings/SettingsApp.svelte:203`
- **Suggested fix:** Distinguish a real 401 from a transport/server failure so a transient blip does not tell the user their link expired, and give the screen an in-page action — at minimum a retry for the recoverable case — instead of ending on an instruction to leave and re-run `/config` in chat.

### [Med] The loading gate blanks the page to a single unannounced word

- **Id:** settings-app-loading-gate-unannounced
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `settings-SettingsApp-Loading-1.png` — an otherwise empty 1280×720 black field with "Loading…" set small, off-centre, near the top
- **Source:** `client/settings/SettingsApp.svelte:202`, styled by `client/settings/settings.css:122`
- **Suggested fix:** Announce the wait to assistive technology (a live/status region) and keep the shell's identity on screen while bootstrap runs — the top bar and section scaffold, or a skeleton — so the first frame of every settings visit is not an unbranded near-blank page.

### [Med] The app's focus ring is scoped to the content grid, exempting the three most global controls

- **Id:** settings-app-focus-ring-scoped-to-grid
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** from source (programmatic focus does not trigger `:focus-visible`, so this is not observable in a shot)
- **Source:** `client/settings/settings.css:132` (`.settings-grid :focus-visible`), against `client/settings/SettingsApp.svelte:211` (top bar) and `:215` (jump menu), both rendered outside `.settings-grid`
- **Suggested fix:** Scope the ring to the settings root rather than the content grid so the context switcher, sign-out, the sub-720px jump menu, and both session gates get the same treatment as the sections — and draw its colour from the accent token instead of the hardcoded `rgba(82, 224, 138, 0.4)`.

### [Med] The only navigation below 720px is a bare native `<select>`

- **Id:** settings-app-jump-menu-bare-select
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `SettingsApp-—-personal-narrow-1.png` and `SettingsApp-—-personal-breakpoint-edge-1.png` — the "JUMP TO" control, which renders with the browser's chevron and focus behaviour rather than the app's
- **Source:** `client/settings/components/SettingsJumpMenu.svelte:24`
- **Suggested fix:** Route the jump menu through the shared `Select` primitive that every section already uses for its dropdowns, so the one control that carries all navigation on small screens is not the least consistent control in the app.

### [Med] The inline Advanced disclosure is styled as a horizontal rule and has no hover or active state

- **Id:** settings-app-advanced-toggle-reads-as-divider
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `SettingsApp-—-advanced-expanded-1.png` — the full-width "▾ Advanced …" row separating the personal sections from Memory
- **Source:** `client/settings/SettingsApp.svelte:292` (`.settings-advanced__toggle`: full width, `background: none`, `border: none` except a `border-bottom`, and no `:hover` rule anywhere in the stylesheet)
- **Suggested fix:** Give the toggle a resting affordance and a hover/active response distinct from the section dividers it currently imitates — the chevron alone is doing all the signalling that a 1000px-wide element is clickable.

### [Med] The Admin group is the longest nav list and the only one that cannot be collapsed

- **Id:** settings-app-admin-nav-not-collapsible
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `settings-SettingsApp-Admin-ready-1.png` — 4 Personal links, a collapsed ADVANCED, then 16 Admin links running off the bottom of the screen
- **Source:** `client/settings/SettingsApp.svelte:145` (the Admin group is pushed with `danger: true` and no `collapsible` flag, unlike Advanced at `:128`), items built at `:69`
- **Suggested fix:** Apply the same collapse affordance the Advanced group already has — or sub-group the 16 admin entries — so the persona with the most sections is not the one given the flattest list; the same 16 sections are also all mounted eagerly at `:263`, unlike Advanced, which unmounts while collapsed.

### [Med] The layout breakpoint keys off viewport width, so the content column is narrowest just above it

- **Id:** settings-app-breakpoint-keys-off-viewport
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `SettingsApp-—-just-above-breakpoint-1.png` (760px) versus `SettingsApp-—-personal-narrow-1.png` (640px) — the content column is visibly tighter at the wider viewport, and controls that fit at 640px collide at 760px
- **Source:** `client/settings/settings.css:7` (fixed `220px` sidebar track) and `:137` (`@media (max-width: 720px)`), with the sidebar hidden at `client/settings/components/SettingsSidebar.svelte:130`
- **Suggested fix:** Choose the breakpoint from the width the main column actually gets rather than the viewport's — between 721px and roughly 800px the sidebar takes its full fixed track while the single-column affordances are already switched off, leaving sections less room than the "narrow" layout gives them.

### [Low] The Advanced hint names five items for a group of ten

- **Id:** settings-app-advanced-hint-undercounts
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `SettingsApp-—-advanced-expanded-1.png` — "Memory, AI output, identity, BYOK, integrations" beside the toggle, above ten expanded sections
- **Source:** `client/settings/SettingsApp.svelte:244`, against the group's items at `:130`
- **Suggested fix:** Make the hint describe what is actually behind the toggle — it lowercases "identity" against the section's own title, abbreviates "BYOK LLM", and folds Coding sessions, Coding MCP servers, Code host, Repositories, MCP, and Plugins into the word "integrations", which is not a label used anywhere else in the nav.

### [Low] Two nav labels appear in two groups with nothing to tell them apart

- **Id:** settings-app-duplicate-nav-labels
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `settings-SettingsApp-Admin-ready-1.png` — "Analytics" under PERSONAL and again under ADMIN; "BYOK LLM" under ADVANCED and again under ADMIN
- **Source:** `client/settings/SettingsApp.svelte:114` and `:134` against `:76` and `:86`
- **Suggested fix:** Disambiguate the admin-scoped entries in their labels rather than relying on the group kicker alone — the jump menu's `<optgroup>` preserves the grouping, but the scrollspy writes only the section id to the URL, so a copied link gives no hint which of the two a recipient will land on.

### [Low] Scrollspy overwrites the history entry, so Back returns to a position that no longer matches

- **Id:** settings-app-scrollspy-rewrites-history-entry
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** from source — a behaviour over time that a single frame cannot show
- **Source:** `client/settings/SettingsApp.svelte:194` (`window.history.replaceState` on every section crossing)
- **Suggested fix:** Clicking a sidebar link pushes a history entry, but scrolling then rewrites that entry's hash in place, so pressing Back lands on an entry whose hash is wherever the user last scrolled rather than where they came from; decide whether scroll position should participate in history at all before it rewrites entries the user did not create.

### [Low] The shell chrome is built from one-off px while the sections it frames use the spacing tokens

- **Id:** settings-app-hardcoded-px-in-shell-chrome
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** all desktop shots — the rhythm inside a section and the rhythm of the frame around it are set by different scales
- **Source:** `client/settings/components/SettingsSidebar.svelte:64` (gap 20px, padding 16px 12px, link padding 6px 8px, font 12px, badge font 9px, nav gap 2px) and `client/settings/SettingsApp.svelte:292` (gap 8px, font 13px, padding 10px 4px, hint font 11px), against `client/settings/settings.css:13` where the main column uses `--gap-section` / `--gap-group`
- **Suggested fix:** Pull the shell's gaps, paddings and type sizes from the same `--gap-*` and type tokens the sections use, so a change to the scale moves the frame and its contents together instead of only one of them.

### [Low] The expired-session state has no story and cannot be given one

- **Id:** settings-app-unauthenticated-state-uncaptured
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** nowhere — one of the shell's three top-level states has no screenshot coverage
- **Source:** `client/stories/decorators/withFixtures.ts:37` — `applyReadySettingsSession` accepts only `'personal' | 'group' | 'admin'`, and the `settingsReady` parameter has no value that leaves the session at `unauthenticated`
- **Suggested fix:** Add an unauthenticated mode to the settings-session fixture decorator so the gate a user sees whenever their link lapses is reviewable at all; it is currently the only shell state that no visual test can reach, which is why the two findings above had to be read from source.

### [Low] The jump menu ignores the collapse model and cannot re-select the current section

- **Id:** settings-app-jump-menu-ignores-collapse
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `SettingsApp-—-personal-narrow-1.png` — the "JUMP TO" control, whose option list carries all ten Advanced sections even though the group is collapsed
- **Source:** `client/settings/components/SettingsJumpMenu.svelte:25` (iterates every group's items with no reference to `group.collapsed`) and `:16` (navigation happens on `change`)
- **Suggested fix:** Decide whether the Advanced collapse is a concept below 720px at all — right now the menu silently ignores it — and give the user a way back to the section they are already on, since re-picking the current option fires no `change` event and therefore does nothing.
