<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — SettingsApp

**Date:** 2026-08-06
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
| 1. Visual hierarchy & scanning  | pass  | The Personal/Advanced/Admin kickers and the red ADMIN zone read cleanly, and Admin (16 items) is now `collapsible: true` like Advanced, so no group is left flat by default |
| 2. Affordance & signifiers      | pass  | Sidebar active/hover states are unambiguous, and the inline Advanced toggle is now a bordered button with hover/active/focus-visible states instead of a divider |
| 3. Consistency w/ design system | warn  | The sub-720px navigation now renders the shared `Select` with `optgroup`s, but re-picking the option already selected still fires no change event and does nothing |
| 4. Feedback & state             | pass  | The bootstrap wait now mounts a real `role="status"` loading state, and a genuine 401 is distinguished from a recoverable failure with an in-page retry |
| 5. Content & language           | pass  | The Advanced hint is now generated from the group's own item labels (`groupHint`) instead of a hand-written summary, and the Admin-scoped "Analytics policy"/"BYOK keys" no longer collide with the Personal/Advanced labels they used to duplicate |
| 6. Accessibility                | pass  | Semantics are sound (`aria-expanded`/`aria-controls`/`aria-current`, real buttons and labels), and the loading gate is now a `role="status"` live region |
| 7. Responsive / layout          | pass  | The sidebar now scrolls inside the grid's own track instead of a sticky `100vh` box, and the single-column breakpoint moved to 900px       |
| 8. Spacing, alignment & sizing  | warn  | Shell chrome spacing now sits on the `--s*` scale; only font-size literals (12/11/9px) and one intentional sub-scale 2px remain               |
| 9. Interaction & micro-states   | warn  | The focus ring is now scoped to `.ui-shell`/`.settings-gate` so the top bar, jump menu, and both gates all get it, but its colour is still the hardcoded `rgba(82, 224, 138, 0.4)` literal rather than `var(--accent)` |

## Findings

Severity-ranked, highest first.

### [High] The sticky sidebar is taller than the area it can be seen in, so its last links are unreachable

- **Id:** settings-app-sidebar-tail-unreachable
- **Status:** fixed
- **Dimension:** 7. Responsive / layout
- **Where visible:** `SettingsApp-—-admin-sidebar-short-viewport-1.png` (1280×600) — the nav is cut mid-item after "Groups"; `settings-SettingsApp-Admin-ready-1.png` shows the same cut after "Plugin approval"
- **Source:** `client/settings/components/SettingsSidebar.svelte:71` (`position: sticky; top: 0; max-height: 100vh; overflow-y: auto`) against `client/shared/ui/Shell.svelte:35` (the scrollport is `.ui-shell__body`, which is `100vh` minus the 48px top bar and its own 16px padding)
- **Suggested fix:** Size the sticky sidebar against the shell's scrollport height rather than `100vh` — the ~80px difference is currently rendered below the visible area, and because the element is sticky the outer scroll never brings it back, so the final one or two admin links can be scrolled to inside the sidebar but never painted on screen.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [High] A network failure and an expired link are both reported as "Session expired", with no way out of the page

- **Id:** settings-app-unauthenticated-dead-end
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** not capturable — see `settings-app-unauthenticated-state-uncaptured` below; read from source
- **Source:** `client/settings/session.svelte.ts:45` (bare `catch` collapsing every bootstrap failure into `unauthenticated`) rendered by `client/settings/SettingsApp.svelte:203`
- **Suggested fix:** Distinguish a real 401 from a transport/server failure so a transient blip does not tell the user their link expired, and give the screen an in-page action — at minimum a retry for the recoverable case — instead of ending on an instruction to leave and re-run `/config` in chat.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Med] The bootstrap wait is a blank page, not a loading state

- **Id:** settings-app-loading-gate-unannounced
- **Status:** fixed
- **Dimension:** 4 — feedback & state
- **Where visible:** not capturable before this fix — the state had no DOM to shoot. The `Loading` story exercised a branch real users never reached.
- **Source:** `client/settings/index.ts:26-32` awaited `bootstrapSession(code)` **before** `mount(SettingsApp, { target })`, so the component's `loading` branch could not render in production. What a user saw for the length of the bootstrap round trip was `client/settings/settings.html`'s empty `<div id="app"></div>` — a blank page with no text, no brand mark, and nothing announced to assistive tech.
- **Fix:** mount first and let the component own the wait, with the loading copy in a `role="status"` region.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Med] The only navigation below 720px is a bare native `<select>`

- **Id:** settings-app-jump-menu-bare-select
- **Status:** fixed
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `SettingsApp-—-personal-narrow-1.png` and `SettingsApp-—-personal-breakpoint-edge-1.png` — the "JUMP TO" control, which renders with the browser's chevron and focus behaviour rather than the app's
- **Source:** `client/settings/components/SettingsJumpMenu.svelte:24`
- **Suggested fix:** Route the jump menu through the shared `Select` primitive that every section already uses for its dropdowns, so the one control that carries all navigation on small screens is not the least consistent control in the app.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Med] The inline Advanced disclosure is styled as a horizontal rule and has no hover or active state

- **Id:** settings-app-advanced-toggle-reads-as-divider
- **Status:** fixed
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `SettingsApp-—-advanced-expanded-1.png` — the full-width "▾ Advanced …" row separating the personal sections from Memory
- **Source:** `client/settings/SettingsApp.svelte:292` (`.settings-advanced__toggle`: full width, `background: none`, `border: none` except a `border-bottom`, and no `:hover` rule anywhere in the stylesheet)
- **Suggested fix:** Give the toggle a resting affordance and a hover/active response distinct from the section dividers it currently imitates — the chevron alone is doing all the signalling that a 1000px-wide element is clickable.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Med] The Admin group is the longest nav list and the only one that cannot be collapsed

- **Id:** settings-app-admin-nav-not-collapsible
- **Status:** fixed
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `settings-SettingsApp-Admin-ready-1.png` — 4 Personal links, a collapsed ADVANCED, then 16 Admin links running off the bottom of the screen
- **Source:** `client/settings/SettingsApp.svelte:145` (the Admin group is pushed with `danger: true` and no `collapsible` flag, unlike Advanced at `:128`), items built at `:69`
- **Suggested fix:** Apply the same collapse affordance the Advanced group already has — or sub-group the 16 admin entries — so the persona with the most sections is not the one given the flattest list; the same 16 sections are also all mounted eagerly at `:263`, unlike Advanced, which unmounts while collapsed.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Med] The layout breakpoint keys off viewport width, so the content column is narrowest just above it

- **Id:** settings-app-breakpoint-keys-off-viewport
- **Status:** fixed
- **Dimension:** 7. Responsive / layout
- **Where visible:** `SettingsApp-—-just-above-breakpoint-1.png` (760px) versus `SettingsApp-—-personal-narrow-1.png` (640px) — the content column is visibly tighter at the wider viewport, and controls that fit at 640px collide at 760px
- **Source:** `client/settings/settings.css:7` (fixed `220px` sidebar track) and `:137` (`@media (max-width: 720px)`), with the sidebar hidden at `client/settings/components/SettingsSidebar.svelte:130`
- **Suggested fix:** Choose the breakpoint from the width the main column actually gets rather than the viewport's — between 721px and roughly 800px the sidebar takes its full fixed track while the single-column affordances are already switched off, leaving sections less room than the "narrow" layout gives them.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] The Advanced hint names five items for a group of ten

- **Id:** settings-app-advanced-hint-undercounts
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `SettingsApp-—-advanced-expanded-1.png` — "Memory, AI output, identity, BYOK, integrations" beside the toggle, above ten expanded sections
- **Source:** `client/settings/SettingsApp.svelte:244`, against the group's items at `:130`
- **Suggested fix:** Make the hint describe what is actually behind the toggle — it lowercases "identity" against the section's own title, abbreviates "BYOK LLM", and folds Coding sessions, Coding MCP servers, Code host, Repositories, MCP, and Plugins into the word "integrations", which is not a label used anywhere else in the nav.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] Two nav labels appear in two groups with nothing to tell them apart

- **Id:** settings-app-duplicate-nav-labels
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `settings-SettingsApp-Admin-ready-1.png` — "Analytics" under PERSONAL and again under ADMIN; "BYOK LLM" under ADVANCED and again under ADMIN
- **Source:** `client/settings/SettingsApp.svelte:114` and `:134` against `:76` and `:86`
- **Suggested fix:** Disambiguate the admin-scoped entries in their labels rather than relying on the group kicker alone — the jump menu's `<optgroup>` preserves the grouping, but the scrollspy writes only the section id to the URL, so a copied link gives no hint which of the two a recipient will land on.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] Scrollspy overwrites the history entry, so Back returns to a position that no longer matches

- **Id:** settings-app-scrollspy-rewrites-history-entry
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** from source — a behaviour over time that a single frame cannot show
- **Source:** `client/settings/SettingsApp.svelte:194` (`window.history.replaceState` on every section crossing)
- **Suggested fix:** Clicking a sidebar link pushes a history entry, but scrolling then rewrites that entry's hash in place, so pressing Back lands on an entry whose hash is wherever the user last scrolled rather than where they came from; decide whether scroll position should participate in history at all before it rewrites entries the user did not create.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] Shell chrome spacing is hardcoded px beside a spacing scale

- **Id:** settings-app-hardcoded-px-in-shell-chrome
- **Status:** fixed
- **Dimension:** 8 — spacing, alignment & sizing
- **Where visible:** every SettingsApp screenshot; the danger group in the sidebar sits 2px left of its siblings.
- **Source:** `client/settings/components/SettingsSidebar.svelte` and `client/settings/components/SettingsTopBar.svelte` set gaps and padding as literals (20px, 16px, 12px, 10px, 6px) while `client/shared/tokens.css:44-52` declares `--s1`..`--s9` on a 4px scale. The danger group's `padding-left: 10px` against `margin-left: -12px` is the visible symptom.
- **Fix:** move the values that land on the 4px scale onto `--s*`. Scoped to **spacing**: font size is excluded deliberately — the codebase carries 218 hardcoded `font-size` declarations across 85 files and no shared type scale exists to move them onto, which makes it a cross-cutting migration rather than a shell fix. Filed separately as `settings-app-no-shared-type-scale`.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] The expired-session state has no story and cannot be given one

- **Id:** settings-app-unauthenticated-state-uncaptured
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** nowhere — one of the shell's three top-level states has no screenshot coverage
- **Source:** `client/stories/decorators/withFixtures.ts:37` — `applyReadySettingsSession` accepts only `'personal' | 'group' | 'admin'`, and the `settingsReady` parameter has no value that leaves the session at `unauthenticated`
- **Suggested fix:** Add an unauthenticated mode to the settings-session fixture decorator so the gate a user sees whenever their link lapses is reviewable at all; it is currently the only shell state that no visual test can reach, which is why the two findings above had to be read from source.
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)

### [Low] Re-picking the jump menu's current section does nothing

- **Id:** settings-app-jump-menu-ignores-collapse
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** from source — a native `<select>`'s `change` event does not fire when the chosen option matches the current value, which a single frame cannot show
- **Source:** `client/settings/components/SettingsJumpMenu.svelte:16-18` (`onChange` sets `window.location.hash` only on the underlying `<select>`'s `change` event) and `client/shared/ui/Select.svelte:53-55` (`handleChange` forwards that native event unmodified)
- **Suggested fix:** The collapse-model half of this finding is fixed — the option list now skips collapsed groups (`client/settings/components/SettingsJumpMenu.svelte:19-25`) — but re-picking the option the user is already on still fires no event and does nothing; give the user an explicit way to reaffirm or return to the current section from the menu.

### [Low] The focus ring's colour is a hardcoded literal instead of the accent token

- **Id:** settings-app-focus-ring-scoped-to-grid
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** from source (programmatic focus does not trigger `:focus-visible`, so this is not observable in a shot)
- **Source:** `client/shared/tokens.css:39` (`--focus-ring: 2px solid rgba(82, 224, 138, 0.4)`) restates the same colour as `--accent: #52e08a` at `:24` as a separate literal instead of referencing the token
- **Suggested fix:** The scope half of this finding is fixed — `.ui-shell :focus-visible, .settings-gate :focus-visible` (`client/settings/settings.css:146-149`) now covers the top bar, jump menu, and both gates along with the sections — but the ring's colour is still the hardcoded `rgba(82, 224, 138, 0.4)` rather than `var(--accent)`; move it onto the token so a future accent change does not leave the ring silently out of sync. Severity lowered from Med to Low: the original defect (three global controls falling back to the UA default ring entirely) is fixed, and the residue is a token-sourcing nit with no visible symptom today, since the literal and `--accent` currently resolve to the same colour.

### [Low] No shared type scale, so every component invents its own font sizes

- **Id:** settings-app-no-shared-type-scale
- **Status:** deferred
- **Dimension:** 3 — design-system consistency
- **Where visible:** every settings screenshot; the shell chrome's 13px/12px/11px sit beside `.t-*` utilities that declare their own sizes.
- **Source:** `client/shared/tokens.css:39-77` declares colour, focus, spacing, radius, and control-height tokens but no type scale; `client/settings/settings.css:62-101` defines `.t-*` utilities that are settings-scoped, not shared.
- **Fix:** introduce shared font-size tokens and migrate the 218 hardcoded `font-size` declarations across 85 files onto them.
- **Resolved:** deferred — a cross-cutting migration touching every section and both apps, out of scope for the shell sub-project. Filed here so the gap stays visible in the Deferred backlog.
