<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AdminApp

**Date:** 2026-08-06
**Reviewed:** `client/admin/AdminApp.svelte` (shell: `AdminTopBar`, `AdminSidebarPanel`, `admin.css`, `scrollspy.ts`; composed with the six admin sections)
**States captured:** Default, Empty data, narrow (640px), breakpoint edge (720px), just above breakpoint (760px), short viewport (1280×600), sidebar link hover, Identities scrolled into view
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                             |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | fail  | A 56px bar chart renders ~320px tall and dominates Overview, while its sibling sparkline renders as a 120px sliver. |
| 2. Affordance & signifiers      | warn  | Active state is a left accent bar, hover is a full bordered box — two unrelated visual languages on the same link.  |
| 3. Consistency w/ design system | fail  | `.admin-sidebar` is styled in two stylesheets that interleave per-property; `RemindersSection` skips the card frame. |
| 4. Feedback & state             | fail  | "last refreshed" freezes at `0s ago`, the status pill is hardcoded `configured`, and no true zero-data state exists. |
| 5. Content & language           | warn  | A quick stat is hardcoded `—`; Memos and Reminders both offer an unlabelled `user id` box with a `Load` button.      |
| 6. Accessibility                | fail  | The admin app declares no `:focus-visible` rule; the nav has no accessible name and no `aria-current`.              |
| 7. Responsive / layout          | fail  | At ≤720px the rail occupies a full viewport and buries the content; at 760px the KPI values truncate to `3…`.       |
| 8. Spacing, alignment & sizing  | warn  | Spacing is hardcoded px (2/4/6/8/12/14/20/24) throughout, beside an unused `--s1`..`--s9` scale.                    |
| 9. Interaction & micro-states   | warn  | Hover and in-flight `Loading…` states are present, but keyboard focus falls back to the UA default across the shell. |

## Findings

Severity-ranked, highest first.

### [High] Below 720px the sidebar fills the viewport and buries every section

- **Id:** admin-app-narrow-rail-buries-content
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `AdminApp — narrow` (640px) and `AdminApp — breakpoint edge` (720px) — the rail runs the full frame height and no admin content is on screen at all.
- **Source:** `client/admin/admin.css:156-165` reflows the rail with `flex-flow: row wrap` at `max-width: 720px`, but `client/admin/components/AdminSidebarPanel.svelte:45-53` sets `flex-direction: column` and `min-height: 100vh` in a Svelte-scoped block. The scoped selector carries the component hash, so it outranks the media query's plain `.admin-sidebar`: the direction never flips and the 100vh floor is never lifted.
- **Suggested fix:** Own the rail's layout in one place so the narrow-viewport rules can actually take effect, and drop the viewport-height floor.

### [High] The sticky nav scrolls out of view and cannot be reached again

- **Id:** admin-app-sticky-rail-scrolls-away
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `AdminApp — identities section scrolled into view` — `SECTIONS`, Overview, Billing and Stats have all left the frame; the rail begins mid-list at "Memos".
- **Source:** `client/admin/admin.css:21-25` makes the rail `position: sticky; top: 0`, but `client/admin/components/AdminSidebarPanel.svelte:52` gives it `min-height: 100vh` — a sticky box can only travel inside its own area, so on a page several viewports tall the rail rides off the top and stays there.
- **Suggested fix:** Size the rail to the scroll container rather than the viewport so it stays pinned for the whole page.

### [High] The activity chart ignores its height and renders six times too tall

- **Id:** admin-app-bars-height-ignored
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** every desktop shot — the bars start mid-panel and run off the bottom of the frame; Billing and everything below it sit past the fold on a 1280×720 screen.
- **Source:** `client/admin/sections/OverviewSection.svelte:126` passes `height={56}` with no `width`, which selects the fluid branch at `client/shared/ui/Bars.svelte:28-34`: there `height` becomes the viewBox denominator under `preserveAspectRatio="none"` with `width: 100%; height: auto`, so the rendered height is the container width scaled by the aspect ratio, not 56px.
- **Suggested fix:** Give the fluid branch a real rendered height so the caller's `height` means what it says.

### [Med] The admin app has no focus ring of its own

- **Id:** admin-app-no-focus-ring
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** not capturable — programmatic focus does not trigger `:focus-visible`; confirmed from source.
- **Source:** `client/admin/admin.css` declares no `:focus-visible` rule anywhere, and `client/admin/admin.html:8` loads only that sheet. The equivalent rule exists for the other app at `client/settings/settings.css:146-149` but is scoped to the settings bundle. Shared primitives (`Btn`, `IconButton`, `Checkbox`, `SegmentedControl`, `DataTable`) carry their own rings, so the gap lands exactly on the bare elements — the six nav links and the top-bar links.
- **Suggested fix:** Apply the shared focus tokens app-wide in the admin sheet, as the settings sheet already does for its shell.

### [Med] KPI values truncate to a single digit and an ellipsis

- **Id:** admin-app-kpi-values-truncate
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `AdminApp — just above breakpoint` (760px) — tools, tokens and storage read `3…`, `2…`, `2…`; the actual figures (3,541 / 27.6k / 2.5 MB) are unreadable.
- **Source:** `client/admin/sections/OverviewSection.svelte:150-155` pins `grid-template-columns: repeat(5, minmax(0, 1fr))` with no breakpoint, so five tiles keep splitting whatever width remains after the fixed 220px rail; `client/shared/ui/MetricCard.svelte:55-58` then clips the value with `text-overflow: ellipsis`.
- **Suggested fix:** Let the KPI grid wrap to fewer columns as width drops, so a headline number is never the thing that gets clipped.

### [Med] The sidebar is styled by two stylesheets that interleave per property

- **Id:** admin-app-sidebar-styled-twice
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `AdminApp — sidebar link hover` — the hovered "Identities" is a full bordered box, while the active "Overview" is a left accent bar with no border. The two states of one control look like two different components.
- **Source:** `client/admin/admin.css:14-40` styles `.admin-sidebar` and its descendant `a` (border, radius, padding, hover border); `client/admin/components/AdminSidebarPanel.svelte:45-75` styles the same element and `.admin-sidebar__link` again. Svelte's scoping hash makes the component win per declared property only, so each rendered property is resolved from whichever file happens to declare it — the active treatment from the component, the hover treatment from the global sheet.
- **Suggested fix:** Keep the rail's styling in the component and reduce the global sheet to layout that the component cannot own.

### [Med] The active nav item is invisible to assistive tech

- **Id:** admin-app-active-link-not-announced
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** not capturable — confirmed from source.
- **Source:** `client/admin/components/AdminSidebarPanel.svelte:25-33` renders `<nav>` with no accessible name and marks the current section with a class only; there is no `aria-current`, so the state the scroll spy maintains never reaches a screen reader.
- **Suggested fix:** Name the nav landmark and express the active link's state in markup, not only in CSS.

### [Med] The scroll spy watches the wrong scroll container

- **Id:** admin-app-scrollspy-root-unset
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** not directly capturable in a still — the highlighted item can lag the section actually on screen.
- **Source:** `client/admin/scrollspy.ts:19-25` creates the `IntersectionObserver` with no `root`, so it measures against the document viewport, while the page actually scrolls inside `.ui-shell__body` (`client/shared/ui/Shell.svelte:41-45`). The `-30% 0px -60% 0px` margins are therefore computed over a box that includes the 96px top-bar band the user cannot scroll.
- **Suggested fix:** Point the observer at the shell's scroll container so its margins describe the visible reading band.

### [Med] "last refreshed" freezes at the moment of the last render

- **Id:** admin-app-refreshed-label-frozen
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** every shot reads `0s ago`, including the ones taken well after the fixture loaded.
- **Source:** `client/admin/components/AdminTopBar.svelte:17-23` reads `Date.now()` inside `$derived.by` with no ticker in the dependency set, so the label only recomputes when some other piece of admin state changes. On an idle dashboard it reports a staleness of zero forever.
- **Suggested fix:** Drive the relative time from a ticking source so the label ages on its own.

### [Med] The status pill always reads "configured"

- **Id:** admin-app-status-pill-hardcoded
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** every shot, including `Empty data` where the instance has no subjects.
- **Source:** `client/admin/components/AdminTopBar.svelte:29` renders `<Pill tone="accent" dot>configured</Pill>` as a literal — no state feeds it, so it is a green dot that can never turn any other colour.
- **Suggested fix:** Bind the pill to real instance health, or remove it rather than imply a check that is not being made.

### [Med] Reminders is the only section without the card frame its siblings use

- **Id:** admin-app-reminders-section-uncarded
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `AdminApp — identities section scrolled into view` — between the bordered `MEMOS` and `IDENTITY MAPPINGS` cards, the Reminders controls float on the page background with no header and no border.
- **Source:** `client/admin/sections/RemindersSection.svelte:72` opens `<section id="reminders" class="admin-section">` without the `admin-data-section` class or the wrapping `Panel` that `MemosSection.svelte:83` and `IdentitiesSection.svelte:76` both use.
- **Suggested fix:** Wrap Reminders in the same titled panel as its siblings so the section boundary is visible.

### [Low] The overview sparkline renders at a fixed 120px inside a 570px panel

- **Id:** admin-app-spark-fixed-width
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** every desktop shot — the "new subjects per day" chart is a small dark wedge in the panel's top-left corner, easily read as a rendering artefact rather than a chart.
- **Source:** `client/admin/sections/OverviewSection.svelte:122` renders `<Spark data={sparkData} />` with no dimensions, taking the defaults `width = 120, height = 28` from `client/shared/ui/Spark.svelte:15`; the surrounding `.admin-overview__spark` wrapper is `width: 100%` but the SVG's own width attribute keeps it at 120px.
- **Suggested fix:** Let the sparkline fill its panel the way the bar chart below it does.

### [Low] A quick stat is hardcoded to an em dash

- **Id:** admin-app-quick-stat-tools-hardcoded
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** every shot — `tools —` sits in QUICK STATS below two rows that do carry numbers, reading as permanently missing data.
- **Source:** `client/admin/components/AdminSidebarPanel.svelte:40` is `<KV k="tools" v="—" />` — a literal, unlike lines 38-39 which read from `adminGlobals.data`.
- **Suggested fix:** Feed the row from the globals payload, or drop it until that number exists.

### [Low] The "Empty data" state is not actually empty

- **Id:** admin-app-empty-state-undesigned
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `Empty data` — subjects reads `0`, but LLM calls, tools, tokens, storage, surface mix and both charts stay fully populated.
- **Source:** `client/admin/AdminApp.stories.svelte` maps the story to the `admin-empty` fixture, which zeroes one metric only; no admin surface renders a zero-data treatment, so the state a fresh instance actually shows is neither designed nor captured.
- **Suggested fix:** Define what a brand-new instance looks like across the shell and capture it as a story.

### [Low] Two sections offer indistinguishable "user id" lookups, one of them unlabelled

- **Id:** admin-app-duplicate-load-controls
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminApp — identities section scrolled into view` — a `user id` box and a `Load` button appear twice within one screen, scoped to different sections, with nothing in either control naming what it loads.
- **Source:** `client/admin/sections/MemosSection.svelte:92` and `client/admin/sections/RemindersSection.svelte:75` share the `user id` placeholder and the `Load` label. Memos' input has no `Field` wrapper at all, so it carries a placeholder where Reminders carries a real label. Compounded by `admin-app-reminders-section-uncarded`, which removes the card that would have told the user which section the second one belongs to.
- **Suggested fix:** Give the Memos input a real label, and say what each lookup loads in its button.

### [Low] Shell spacing is hardcoded px beside an unused spacing scale

- **Id:** admin-app-hardcoded-px-spacing
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** every shot; the rail's 12px padding against the main column's 24px is the most visible mismatch.
- **Source:** `client/admin/admin.css:14-20,136-155` and `client/admin/components/AdminSidebarPanel.svelte:45-78` set gaps and padding as literals (2, 4, 6, 8, 12, 14, 20, 24px) while `client/shared/tokens.css:68-76` declares `--s1`..`--s9` on a 4px scale; 6px and 14px do not land on that scale at all. The two rail declarations disagree on both gap (4 vs 8) and padding (14 vs 12), which is the same duplication as `admin-app-sidebar-styled-twice`.
- **Suggested fix:** Move the values that sit on the 4px scale onto the spacing tokens, and reconcile the two rail declarations to one.
