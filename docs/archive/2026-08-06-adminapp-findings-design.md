<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AdminApp Review Findings — Design

**Date:** 2026-08-06
**Closes:** the 16 findings in [`docs/ux-reviews/AdminApp.md`](../../ux-reviews/AdminApp.md), plus one new finding this design surfaced.
**Predecessor:** [`2026-08-05-settingsapp-shell-findings-design.md`](./2026-08-05-settingsapp-shell-findings-design.md) — the same class of shell defects in the sibling app. Its solutions are reused here rather than reinvented.

## Goal

Make the admin app usable below 900px, keep its navigation on screen, stop its charts from rendering at several times their requested size, and give it the focus ring and scroll-container awareness the settings app already has.

## Why one sub-project

The 16 findings fall into three clusters whose files barely overlap:

| Cluster                   | Findings | Files                                                             |
| ------------------------- | -------- | ----------------------------------------------------------------- |
| A — shell layout, nav, a11y | 7        | `client/admin/admin.css`, `AdminApp.svelte`, `AdminSidebarPanel.svelte`, `scrollspy.ts` |
| B — chart and KPI sizing  | 3        | `client/shared/ui/Bars.svelte`, `Spark.svelte`, `OverviewSection.svelte` |
| C — content and state     | 6        | `AdminTopBar.svelte`, `AdminSidebarPanel.svelte`, `RemindersSection.svelte`, `MemosSection.svelte`, `global-stats.svelte.ts` |

Tasks stay independent inside one plan. The comparable predecessor sub-project carried 14 findings across 14 tasks.

## Global Constraints

- Runtime **Bun**; **Svelte 5 runes**; strict TypeScript; **`.js` extension in import paths**.
- Formatter is **oxfmt** (`bun run format`), not prettier.
- New files carry BUSL-1.1 headers (`bun license:headers`).
- **Never add lint-disable or type-ignore comments** — fix the underlying issue.
- Client tests run as `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`. A bare `bun test tests/client/...` matches nothing and reports success without executing.
- Never hand-edit inside a visual spec's `@generated-begin` / `@generated-end auto-screenshots` region; regenerate with `bun run shoot:gen`.
- `docs/ux-reviews/_BACKLOG.md` is generated — regenerate with `bun run ux:backlog`, never hand-edit.
- Never pass `--no-verify` to `git commit`.
- Spacing values that land on the 4px scale use `--s1`..`--s9` (`client/shared/tokens.css:68-76`). Font size is explicitly **out of scope** — the repo has no shared type scale, tracked as the deferred finding `settings-app-no-shared-type-scale`.

## Cluster A — shell layout, navigation, accessibility

### A1. Scroll ownership

**Today.** `AdminApp.svelte:37` renders `<Shell>` with no `bodyScroll` prop, so it defaults to `true` and `.ui-shell__body` owns the page scroll (`client/shared/ui/Shell.svelte:41-45`). The rail then sits inside that scroller as a `position: sticky; top: 0` box (`admin.css:21-25`) carrying `min-height: 100vh` (`AdminSidebarPanel.svelte:52`). A sticky box can only travel within its own area, so once the page exceeds one viewport the rail rides off the top and never returns — visible in `AdminApp — identities section scrolled into view`, where the nav starts mid-list at "Memos".

**Change.** Adopt the shape `SettingsApp` already runs:

- `AdminApp.svelte` renders `<Shell bodyScroll={false}>`.
- `.admin-grid` gains `flex: 1 1 auto; min-height: 0` so it fills the shell body (mirrors `settings.css:16-22`).
- `.admin-grid__main` gains `overflow-y: auto` and becomes the scroller (mirrors `settings.css:23-30`).
- `.admin-sidebar` drops `position: sticky`, `top`, `align-self`, `max-height: 100vh` and `min-height: 100vh`, and gains `height: 100%; overflow-y: auto` — it fills its grid track and scrolls inside it (mirrors `SettingsSidebar.svelte:73-77`, whose comment records why the sticky/100vh box failed).

**Closes:** `admin-app-sticky-rail-scrolls-away`.

### A2. One home for the rail's styling

**Today.** `.admin-sidebar` is declared twice — `admin.css:14-40` and the Svelte-scoped block at `AdminSidebarPanel.svelte:45-78`. Svelte's scoping hash gives the component's selectors specificity (0,3,0) against the global's (0,2,0), so the component wins **per declared property only**. Every property the component does not declare still resolves from `admin.css`. The visible consequence is in `AdminApp — sidebar link hover`: the hovered link is a bordered box (`admin.css:28-38`) while the active link is a left accent bar (`AdminSidebarPanel.svelte:71-74`) — one control with two unrelated visual languages. The two declarations also disagree on gap (4px vs 8px) and padding (14px vs 12px).

**Change.** All `.admin-sidebar*` rules live in `AdminSidebarPanel.svelte`. `admin.css` retains only `.admin-grid`, `.admin-grid__main`, `.admin-section`, the breakpoint block, and the focus ring from A5. The surviving values move onto the spacing scale: gap `--s2` (8px), padding `--s3` (12px). The `border-left: 2px` active marker stays a literal — it is a hairline rule, not spacing, and 2px is below the 4px scale on purpose.

**Closes:** `admin-app-sidebar-styled-twice`, `admin-app-hardcoded-px-spacing`.

### A3. Narrow-viewport navigation

**Today.** `admin.css:156-165` tries to reflow the rail at `max-width: 720px` with `flex-flow: row wrap`, but that plain selector is (0,1,0) against the component's scoped (0,2,0) `flex-direction: column`, so the direction never flips, and nothing lifts the scoped `min-height: 100vh`. At 640px and 720px the rail fills the entire frame and no admin content is on screen at all.

**Change.**

- Breakpoint moves **720px → 900px**, with the reasoning already recorded at `settings.css:152-154`: against a fixed 220px rail, a 760px viewport leaves the content column ~492px — narrower than the 608px it gets at 640px where the rail is already gone.
- Below 900px the rail is `display: none` (mirrors `SettingsSidebar.svelte:140-142`) and `.admin-grid` becomes `grid-template-columns: 1fr`.
- A new `client/admin/components/AdminJumpMenu.svelte` renders in `AdminTopBar`'s `secondaryRow`, `display: none` above 900px. It wraps the shared `Select` with a **flat** `options` array built from `adminSections` — no `groups`, because admin has six ungrouped sections. It follows `SettingsJumpMenu.svelte:34-45`: a labelled `<span id="admin-jump-label">Jump to</span>` beside a `<Select block ariaLabelledby="admin-jump-label" testid="admin-jump-select">`, with `onChange` setting `window.location.hash`.

The label uses the admin app's own `.admin-topbar__lbl` (`AdminTopBar.svelte:77-81`), which already styles the `window` caption beside the `Seg` in the same row. It must **not** use `.t-label` — that utility is defined at `settings.css:92` and is not loaded by `admin.html`, which is the concrete instance of the deferred `settings-app-no-shared-type-scale` gap.

`AdminJumpMenu` is **not** shared with `SettingsJumpMenu`: the settings one is typed against `SidebarGroup` and filters collapsed groups, neither of which admin has. Two small components beat one component with a mode flag.

**Quick stats below the breakpoint.** The rail's `QUICK STATS` block hides with the rail. Two of its three rows already duplicate Overview KPIs — `DM` restates the `subjects` tile's `12 dm · 4 group` subline, and `tools` restates the `tools` tile. Only `active` (`activeIn30d`) has no home in Overview, so it joins the `subjects` tile's subline rather than porting a duplicate block into the section. This is the minimal reading of "the quick stats move into Overview".

**Closes:** `admin-app-narrow-rail-buries-content`.

### A4. Scroll spy

**Today.** `client/admin/scrollspy.ts` and `client/settings/scrollspy.ts` are identical apart from the `root` parameter only the settings copy has (`client/settings/scrollspy.ts:15`). The admin observer therefore measures against the document viewport, while after A1 the page scrolls inside `.admin-grid__main`. Its `-30% 0px -60% 0px` margins are computed over a box that includes the 96px top-bar band the user cannot scroll.

**Change.** The two modules collapse into `client/shared/scrollspy.ts`, carrying the settings signature verbatim:

```typescript
export const useScrollSpy = (
  sectionIds: readonly string[],
  onChange: (id: string) => void,
  /** The scroll container to measure against. null observes the viewport. */
  root: Element | null = null,
): ScrollSpyHandle
```

Both apps import it; `client/admin/scrollspy.ts` and `client/settings/scrollspy.ts` are deleted. `AdminApp.svelte` binds the main column to a `$state` element ref and passes it as `root`, matching `SettingsApp.svelte:129-140`. Any existing tests for the settings module move with it.

**Closes:** `admin-app-scrollspy-root-unset`.

### A5. Accessibility

**Today.** `client/admin/admin.css` declares no `:focus-visible` rule, and `client/admin/admin.html:8` loads only that sheet. The shared primitives (`Btn`, `IconButton`, `Checkbox`, `SegmentedControl`, `DataTable`) carry their own rings, so the gap lands exactly on the bare elements — the six nav links and the top-bar links. The equivalent rule exists at `settings.css:146-149` but is scoped to the settings bundle. Separately, `AdminSidebarPanel.svelte:25-33` renders `<nav>` with no accessible name and marks the current section with a class only.

**Change.**

- `admin.css` gains, using the shared tokens (`tokens.css:39-40`) rather than a copied literal:

  ```css
  .ui-shell :focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  ```

- `<nav>` gains `aria-label="Admin sections"`.
- The active link gains `aria-current="true"` under the same condition that applies `admin-sidebar__link--active`.

**Closes:** `admin-app-no-focus-ring`, `admin-app-active-link-not-announced`.

## Cluster B — chart and KPI sizing

### B1. `Bars` ignores its height

**Today.** `client/shared/ui/Bars.svelte:28-34` renders the width-less branch as `viewBox="0 0 {intrinsicW} {height}"` with `preserveAspectRatio="none"` under `.ui-bars--fluid { width: 100%; height: auto }`. The caller's `height` becomes an aspect-ratio denominator, so the rendered height is the container width scaled by `height / intrinsicW`. `OverviewSection.svelte:126` asks for `height={56}` and gets roughly 320px in a ~570px panel, pushing five of six sections below the fold on a 1280×720 screen.

**Change.** The fluid branch renders at the requested height — `style="height: {height}px"` on the SVG, with `width: 100%` and `preserveAspectRatio="none"` retained so bars still stretch horizontally to fill the panel, which is what that attribute was for. `height: auto` is removed from `.ui-bars--fluid`.

**Blast radius: four call sites, all under `client/admin/`** — `OverviewSection.svelte:126`, `StatsPanel.svelte:232`, `StatsPanel.svelte:260`, `SubjectDetail.svelte:61`. All four are oversized today; all four shrink to their intended height. The visual diff is broad but uniformly in one direction. No consumer outside the admin app exists.

**Closes:** `admin-app-bars-height-ignored`.

### B2. `Spark` cannot fill its panel

**Today.** `OverviewSection.svelte:122` renders `<Spark data={sparkData} />` with no dimensions, taking the defaults `width = 120, height = 28` (`Spark.svelte:15`). The `.admin-overview__spark` figure is `width: 100%`, but the SVG's own `width` attribute pins it at 120px, so it reads as a stray dark wedge in a ~570px panel.

**Change.** `Spark` gains the same two-branch structure `Bars` has: an explicit `width` renders fixed; omitting `width` renders fluid (`viewBox="0 0 {intrinsicW} {height}"`, `preserveAspectRatio="none"`, `width: 100%`, `style="height: {height}px"`). `width` loses its `120` default and becomes `width?: number`. `OverviewSection.svelte:122` then renders fluid. One call site, so no other consumer changes.

**Closes:** `admin-app-spark-fixed-width`.

### B3. KPI values truncate

**Today.** `OverviewSection.svelte:150-155` pins `grid-template-columns: repeat(5, minmax(0, 1fr))` with no breakpoint, so five tiles keep splitting whatever width remains after the 220px rail. `MetricCard.svelte:55-58` then clips the value with `text-overflow: ellipsis` — at 760px the tiles read `3…`, `2…`, `2…` where the real figures are 3,541 / 27.6k / 2.5 MB.

**Change.** `.overview__kpis` becomes `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`. 160px fits the widest realistic value (`27.6k` at the tile's headline size) inside the 128px left after `MetricCard`'s `padding: 14px 16px` (`MetricCard.svelte:37`), so tiles wrap to a second row rather than ellipsing a headline number.

**Out of scope:** `StatsPanel.svelte` has its own KPI grids. The review never scrolled into the Stats section, so they stay untouched rather than receive an unreviewed change. If they share the pattern, they get their own finding in a later review.

**Closes:** `admin-app-kpi-values-truncate`.

## Cluster C — content and state

### C1. `refreshGlobals` swallows every failure — new finding

**Discovered during this design, not in the review.** `global-stats.svelte.ts:82-96` returns early on both failure paths — `if (!res.ok) return` and `if (!parsed.success) return` — leaving `data` and `fetchedAt` at their stale values while `loading` flips back to false in the `finally`. A failed refresh is indistinguishable from a successful one: nothing on screen changes and nothing is logged.

**Change.** `adminGlobals` gains `error: null as string | null`. `refreshGlobals` clears it on entry, sets it on both failure paths (`` `request failed with status ${res.status}` `` and `'response did not match the expected shape'`), and leaves stale `data` in place so the last good numbers stay readable.

This is required by C2 rather than added alongside it: the pill has no health signal to bind to until this field exists.

**Files a new finding** in `docs/ux-reviews/AdminApp.md` at Med severity under dimension 4, id `admin-app-global-refresh-fails-silently`, closed in the same sub-project.

### C2. The status pill asserts something nothing checks

**Today.** `AdminTopBar.svelte:29` renders `<Pill tone="accent" dot>configured</Pill>` as a literal. Nothing in `GlobalStatsSchema` (`global-stats.svelte.ts:18-70`) describes instance health or configuration, so the green dot claims a check that is not being made — including in the `Empty data` story, where the instance has no subjects.

**Change.** The pill binds to fetch health, the one signal the client actually has, and sits beside the `last refreshed` label it now pairs with:

| Condition                                   | Tone      | Text      |
| ------------------------------------------- | --------- | --------- |
| `adminGlobals.loading`                      | `neutral` | `loading` |
| `adminGlobals.error !== null`               | `warn`    | `stale`   |
| otherwise                                   | `accent`  | `live`    |

`warn` rather than `danger`: the numbers on screen are stale, not wrong. The pill keeps `dot`; `Pill`'s tones are `accent | warn | danger | info | neutral` (`Pill.svelte:13-27`).

**Closes:** `admin-app-status-pill-hardcoded`.

### C3. "last refreshed" freezes

**Today.** `AdminTopBar.svelte:17-23` reads `Date.now()` inside `$derived.by` with no ticker in its dependency set, so the label only recomputes when other admin state changes. Every screenshot reads `0s ago`, including ones taken long after the fixture loaded.

**Change.** A `let now = $state(Date.now())` in `AdminTopBar`, advanced by a 1s `setInterval` inside an `$effect` that clears the interval in its cleanup. `refreshedLabel` reads `now` instead of calling `Date.now()`, which puts the tick in its dependency set. 1s granularity is required because the label renders seconds below one minute.

**Closes:** `admin-app-refreshed-label-frozen`.

### C4. The `tools` quick stat is hardcoded

**Today.** `AdminSidebarPanel.svelte:40` is `<KV k="tools" v="—" />` — a literal, unlike lines 38-39 which read from `adminGlobals.data`. It renders as a permanently dead row below two rows that do carry numbers.

**Change.** Bind it to the same derivation the Overview `tools` tile already uses — the sum of `toolMix.topTools[].count` — falling back to `'—'` when `toolMix` is absent, matching the `?? '—'` pattern on lines 38-39. The derivation is extracted so the tile and the quick stat cannot drift apart.

**Closes:** `admin-app-quick-stat-tools-hardcoded`.

### C5. Reminders skips the card frame

**Today.** `RemindersSection.svelte:72` opens `<section id="reminders" class="admin-section">` without the `admin-data-section` class or the wrapping `Panel` that `MemosSection.svelte:83` and `IdentitiesSection.svelte:76` both use. Between two bordered, titled cards, its controls float on the page background with no header and no border — visible in `AdminApp — identities section scrolled into view`.

**Change.** Wrap the section in `<Panel title="reminders">` with the existing `Toolbar` as its `action` snippet, and add `admin-data-section` to the section's class list, matching its two siblings.

**Closes:** `admin-app-reminders-section-uncarded`.

### C6. Two indistinguishable "user id" lookups

**Today.** `MemosSection.svelte:92` and `RemindersSection.svelte:75` share the `user id` placeholder and the `Load` button label. Memos' input has no `Field` wrapper at all, so it carries only a placeholder where Reminders carries a real label. Scrolled together they appear twice in one screen with nothing naming what either loads.

**Change.** Memos' `Input` gains a `Field label="user id"` wrapper, matching `RemindersSection.svelte:74-76`. Both buttons name their object — `Load memos` and `Load reminders` — in both the resting and the in-flight label (`Loading…` becomes `Loading memos…` / `Loading reminders…`).

**Closes:** `admin-app-duplicate-load-controls`.

### C7. No designed empty state

**Today.** The `admin-empty` fixture zeroes `subjects` only; LLM calls, tools, tokens, storage, surface mix and both charts stay fully populated in the `Empty data` story. No admin surface renders a zero-data treatment, so what a fresh instance actually shows is neither designed nor captured.

**Change.**

- The `admin-empty` fixture becomes genuinely empty — every `GlobalStats` sub-object present with zeroed counts and empty arrays, which is what a migrated-but-unused instance returns.
- `Bars` and `Spark` render nothing when their data array is empty or all-zero, and their callers render `<EmptyState title="No activity yet" />` in that case. `EmptyState`'s API is `{ title, icon = '∅', hint?, action? }` (`EmptyState.svelte:9-15`); the default icon is used, no hint — an admin dashboard with no traffic yet needs no next step.
- The `surfaceMix` panel renders `<EmptyState title="No subjects yet" />` when every count is zero.
- KPI tiles keep rendering `0`, which is meaningful information, not an empty state.

**Closes:** `admin-app-empty-state-undesigned`.

## Testing

Following the precedent set by the predecessor sub-project:

- **CSS assertions** in the style of `tests/client/settings/settings-css.test.ts`: the focus ring resolves to `var(--focus-ring)` / `var(--focus-ring-offset)` and not a copied literal; the breakpoint is 900px; no `100vh` and no `position: sticky` survives on `.admin-sidebar`; `.admin-grid__main` owns `overflow-y`.
- **`tests/client/shared/token-references.test.ts`** proves every `var(--x)` still resolves.
- **`client/shared/scrollspy.ts`** carries the settings module's existing unit coverage, extended to assert the `root` argument reaches the `IntersectionObserver` options.
- **`Bars` and `Spark`** get unit coverage asserting the fluid branch renders the requested height and that an all-zero series renders no bars.
- **Visual states** in `tests/visual/admin/AdminApp.spec.ts` below `@generated-end`: 900px breakpoint edge, 640px narrow (jump menu present, rail gone), 940px just above the breakpoint, 1280×600 short viewport (rail tail reachable), sidebar link hover, and the Identities section scrolled into view with the rail still pinned. The `Empty data` story is regenerated via `bun run shoot:gen` after the fixture change.
- **Mutation ratchet** — `bun test:mutate:changed` must hold every changed file at or above its floor in `scripts/mutation/baseline.json`.
- **Backlog** — `docs/ux-reviews/AdminApp.md` closes all 16 findings with `**Resolved:**` lines naming this spec, adds `admin-app-global-refresh-fails-silently` as a seventeenth (also closed), and re-scores all nine dimensions. `bun run ux:backlog` regenerates `_BACKLOG.md`.
- **`tests/scripts/ux-backlog.test.ts:232`** — the hardcoded review-document count moves from 20 to 21 to admit `AdminApp.md`.

## Out of Scope

Filed, not folded in:

- `StatsPanel.svelte`'s own KPI grids — never reviewed, see B3.
- An app-wide type scale — already deferred as `settings-app-no-shared-type-scale`.
- A real instance-health endpoint. C2 rebinds the pill to fetch freshness; genuine configuration health (task provider assigned, LLM credentials present, chat instances connected) is server work with its own schema, route, and `/stats/*` anonymity review.
