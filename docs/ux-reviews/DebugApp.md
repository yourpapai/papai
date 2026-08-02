<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — Debug Dashboard (DebugApp + components)

**Date:** 2026-08-03
**Reviewed:** `client/debug/DebugApp.svelte` + `client/debug/components/*` (SessionsList, SessionCard, TraceList, TurnsPanel, LogExplorer, ScopeFilter, NotificationsPanel, ToolFailuresPanel, DebugDetailRail, TurnDetail, TraceDetail, SessionDetail, LogDetail, FailureDetail, LiveContextCard, DebugTopBar) + shared primitives (`DataTable`, `SummaryList`, `TreeView`, `Btn`, `tokens.css`)
**States captured:** Composed Default / Connecting / Detail-selected / Disconnected-empty; all 38 component state stories (populated, empty, error, running, minimal, wizard, group-scope, keyboard-focus-ring, raw-expanded); narrow 640px app views · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

## Re-review note (2026-08-03)

A merge of `origin/master` at `ff10474e4` plus a run of `debug`-scoped fix commits
(`1ea40dfc9` through `86c6221c5`) rewrote most of `client/debug/**` and the shared
`TreeView`/`DataTable`/`SummaryList` primitives between the original review and this
pass. All 17 findings below were re-verified against the current source and Storybook
screenshots; every one now has a source-cited fix — see each finding's `Resolved:` line.

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | `TurnDetail`/`FailureDetail` now render a formatted `SummaryList` + status pill + tool-call list; raw tree is opt-in behind "show raw". |
| 2. Affordance & signifiers      | pass  | Every list (`SessionCard`, `TraceList`, `ToolFailuresPanel`, `LogExplorer`, `DataTable`) applies a `selected` treatment tied to the detail rail. |
| 3. Consistency w/ design system | pass  | `debug.css` shrank from ~1018 to 387 lines; no more cross-file style duplication; one shared `formatDuration`.   |
| 4. Feedback & state             | pass  | Disconnect banner + stale-stat dimming + per-panel empty-state hints + surfaced initial-log-fetch error.         |
| 5. Content & language           | pass  | Every empty state carries an actionable hint; `ScopeFilter` chips carry an inline cycle legend.                  |
| 6. Accessibility                | warn  | Focus rings, keyboard activation, and `aria-label`s are all now present; icon-only buttons still sit at a 24px control height. |
| 7. Responsive / layout          | pass  | `@media (max-width: 720px)` collapses the 3-column grid to one column with no overlap or clipping (verified in shots). |
| 8. Spacing, alignment & sizing  | pass  | `TreeView` closing brackets render on their own aligned row; `SummaryList` values shrink/wrap instead of clipping. |
| 9. Interaction & micro-states   | pass  | `:focus-visible` rings, `selected` states, and a `loading…` busy label on "load older" are all present in source. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] No responsive layout — page breaks completely at ~640px

- **Id:** debug-no-responsive-layout
- **Status:** fixed
- **Resolved:** `2ab790294` ("fix(debug): 720px responsive collapse for dashboard grid and top bar")
- **Dimension:** 7. Responsive / layout
- **Where visible:** `DebugApp — narrow 640px` screenshot — single-column stacked layout, top bar wraps to two rows, no overlap or 1-char wrapping
- **Source:** `client/debug/debug.css:347` (`@media (max-width: 720px)` collapses `.debug-grid`/`.debug-grid__center-row` to `minmax(0, 1fr)`); `client/debug/components/DebugTopBar.svelte:110` (`flex-wrap: wrap` on both top-bar rows at the same breakpoint)
- **Suggested fix:** ~~Add a breakpoint that collapses the three columns into a single stacked flow (rail last or as an overlay) and lets the top bar wrap.~~ Done.

### [High] Keyboard focus is invisible on every clickable row

- **Id:** debug-invisible-row-focus
- **Status:** fixed
- **Resolved:** `1ea40dfc9` ("fix(debug): visible keyboard focus rings on list rows")
- **Dimension:** 9. Interaction & micro-states / 6. Accessibility
- **Where visible:** `SessionCard — keyboard focus ring` screenshot — green `:focus-visible` outline on the focused card; source confirms the same for traces/failures/logs and DataTable
- **Source:** `client/debug/debug.css:361` (`.session-card:focus-visible, .trace-row:focus-visible, .failure-row:focus-visible, .log-entry:focus-visible { outline: var(--focus-ring); }`); `client/debug/components/SessionCard.svelte:29-37`, `TraceList.svelte:35-43`, `ToolFailuresPanel.svelte:56-64`, `LogExplorer.svelte:181-189` (all `tabindex="0"` + `onkeydown` Enter/Space); `client/shared/ui/DataTable.svelte:129-131` (row `tabindex`/`onkeydown` when `onRowClick` set) and `:209-212` (`:focus-visible` rule)
- **Suggested fix:** ~~Give all focusable rows a visible `:focus-visible` ring... make DataTable rows keyboard-focusable/activatable when `onRowClick` is set.~~ Done.

### [High] No selected-row indication for what the detail rail shows

- **Id:** debug-no-selected-row-indication
- **Status:** fixed
- **Resolved:** `fd8e1f0ba` ("feat(debug): selected-row indication across all detail-rail lists"), narrowed by `3913411f2` ("fix(debug): narrow selected-row signature in TraceList/ToolFailuresPanel") and `25595b393` ("fix(debug): pin log-row selected highlight to content key, not positional index")
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `DebugApp — Detail selected` screenshot — the selected turn row carries the accent left-bar + tint treatment
- **Source:** `client/debug/components/TurnsPanel.svelte:78-80,106` (`selectedTurnId` derived, passed as DataTable `selectedKey`); `TraceList.svelte:18-20,34`, `ToolFailuresPanel.svelte:39-41,55`, `LogExplorer.svelte:30-36,180` (each derives a content-keyed `selected*Key` and binds `class:selected`); `SessionsList.svelte:30-31` (`selected` prop from `dashboard.selectedDetail`); `client/debug/debug.css:369-375` and `client/shared/ui/DataTable.svelte:213-216` (shared `.selected`/`ui-datatable__tr--selected` treatment)
- **Suggested fix:** ~~Track the selected item id per list and apply the shared selected-row treatment.~~ Done.

### [High] Disconnected state is silent — stale stats, unexplained empty panels

- **Id:** debug-silent-disconnected-state
- **Status:** fixed
- **Resolved:** `ab7e93eb5` ("feat(debug): disconnect banner, stale-stat dimming, logs-error note"), refined by `8fc0086ea` ("fix(debug): suppress disconnect banner and stale dimming during initial SSE connecting state")
- **Dimension:** 4. Feedback & state
- **Where visible:** `DebugApp — Disconnected empty` screenshot — red "stream disconnected — showing last buffered data, reconnecting…" banner; every panel's empty state now carries an explanatory hint
- **Source:** `client/debug/DebugApp.svelte:78-80` (banner shown when `!connected && hasConnectedOnce`, i.e. not during the initial connecting frame — see `Connecting` story); `client/debug/components/DebugTopBar.svelte:45,118-120` (`.stale` class dims the stat counters); `client/debug/DebugApp.svelte:50-53` (`catch` now sets `dashboard.logsError`, rendered by `LogExplorer.svelte:200-202`)
- **Suggested fix:** ~~On disconnect, surface a banner or per-panel hint... and visually dim the stat counters as stale.~~ Done.

### [Med] Turn and failure details are raw JSON trees with epoch timestamps

- **Id:** debug-raw-json-epoch-timestamps
- **Status:** fixed
- **Resolved:** `605ea8821` ("feat(debug): structured TurnDetail with collapsible raw tree"), `7e867f9d2` ("feat(debug): structured FailureDetail with collapsible raw tree")
- **Dimension:** 1. Visual hierarchy & scanning / 5. Content & language
- **Where visible:** `TurnDetail — Completed` / `FailureDetail — Default` screenshots — formatted `SummaryList` (`Started 17:00:00`, `Duration 1.2s`, status pill), tool-call list with per-call status pills; the raw `TreeView` dump only appears after clicking "show raw" (see `TurnDetail — raw expanded`)
- **Source:** `client/debug/components/TurnDetail.svelte:25-63` (`SummaryList` + `formatTime`/`formatDuration` + `showRaw` toggle gating `TreeView`); `client/debug/components/FailureDetail.svelte:28-59` (same pattern)
- **Suggested fix:** ~~Give turns and failures structured detail views... instead of a raw TreeView dump.~~ Done.

### [Med] Panel header counts ignore the active scope filter

- **Id:** debug-header-counts-ignore-filter
- **Status:** fixed
- **Resolved:** `6e6c031c0` ("fix(debug): panel header counts reflect active scope filter")
- **Dimension:** 4. Feedback & state
- **Where visible:** Any state with `dm`/`group` selected — header now reads `filtered/total` (e.g. `TURNS 1/2`)
- **Source:** `client/debug/panel-count.ts:12-14` (`panelCount()` returns bare total when unfiltered, `filtered/total` otherwise); used at `TurnsPanel.svelte:87`, `ToolFailuresPanel.svelte:44`, `NotificationsPanel.svelte:44`
- **Suggested fix:** ~~Show the filtered count (optionally filtered/total) in the panel header when the scope filter is active.~~ Done.

### [Med] Top-bar scope filter does not apply to sessions or LLM trace list

- **Id:** debug-scope-filter-incomplete
- **Status:** fixed
- **Resolved:** `be80ebced` ("fix(debug): scope-chip legend, activity-scope caption on Seg")
- **Dimension:** 3. Consistency w/ design system / 4. Feedback & state
- **Where visible:** Top bar secondary row — the `Seg` is now captioned `activity scope`, scoping the reader's expectation to the activity panels rather than implying it filters everything
- **Source:** `client/debug/components/DebugTopBar.svelte:74-78` (`<span class="debug-topbar__lbl">activity scope</span>` immediately precedes the `Seg`); `SessionsList.svelte` and `TraceList.svelte` still intentionally have no `scopeFilter` usage — the second suggested-fix option (label rather than extend) was taken
- **Suggested fix:** ~~Either apply the scope filter consistently to sessions and traces, or label the Seg as applying only to activity panels.~~ Done via labeling.

### [Med] Empty states are dead ends

- **Id:** debug-empty-states-dead-end
- **Status:** fixed
- **Resolved:** `e159aecb3` ("fix(debug): actionable hints on every empty state")
- **Dimension:** 5. Content & language
- **Where visible:** `Disconnected empty` screenshot — every panel now reads e.g. `No sessions` / "sessions appear here as users talk to the bot"
- **Source:** `client/debug/components/SessionsList.svelte:22` (`hint="sessions appear here as users talk to the bot"`), `TurnsPanel.svelte:110`, `ToolFailuresPanel.svelte:47`, `NotificationsPanel.svelte:47`, `TraceList.svelte:27` — all now pass `EmptyState`'s `hint` prop
- **Suggested fix:** ~~Add a one-line hint per empty state.~~ Done.

### [Med] TreeView closing brackets render inline at ragged horizontal positions

- **Id:** debug-treeview-ragged-brackets
- **Status:** fixed
- **Resolved:** merge `ff10474e4` (TreeView rewrite; see `tests/client/shared/TreeView.test.ts`)
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `TurnDetail — raw expanded` screenshot — closing `}`/`]` now sit on their own row, indented flush with the matching opening bracket's toggle
- **Source:** `client/shared/TreeView.svelte:85-87` (`<div class="tree-row tree-closing" style="padding-left: {depth * 12 + 18}px"><span class="tree-bracket">{bracketClose}</span></div>` — a dedicated closing row, not inline after the children span)
- **Suggested fix:** ~~Render the closing bracket on its own row aligned with the opening indent.~~ Done.

### [Med] SummaryList values clip long unbroken ids

- **Id:** debug-summarylist-clips-ids
- **Status:** fixed
- **Resolved:** merge `ff10474e4` (`client/shared/ui/SummaryList.svelte` diff `+3` lines). Evidence is source-based; no captured screenshot exercises a long unbroken id — the only shot of this area (`TraceDetail — With tool calls`) uses short values, and `SummaryList.stories.svelte`'s own "Long unbroken values" fixture exists but has not been captured.
- **Dimension:** 7. Responsive / layout
- **Where visible:** `TraceDetail — With tool calls` screenshot — `User ID`/`Model`/`Timestamp` values render in full, no clipping at the panel edge
- **Source:** `client/shared/ui/SummaryList.svelte:40-48` (`.ui-summary__row` has `min-width: 0`), `:53-59` (`.ui-summary__v` has `min-width: 0; word-break: break-all`)
- **Suggested fix:** ~~Allow the value cell to shrink and break long unbroken strings.~~ Done.

### [Med] ScopeFilter include/exclude tri-state is undiscoverable

- **Id:** debug-scopefilter-tristate-undiscoverable
- **Status:** fixed
- **Resolved:** `be80ebced` ("fix(debug): scope-chip legend, activity-scope caption on Seg")
- **Dimension:** 5. Content & language / 9. Interaction & micro-states
- **Where visible:** LogExplorer toolbar — a legend line sits directly above the chips
- **Source:** `client/debug/components/ScopeFilter.svelte:34` (`<div class="scope-filter__hint">click to include · again to exclude · again to clear</div>`)
- **Suggested fix:** ~~Add a tiny legend or tooltip copy explaining click cycles include → exclude → off.~~ Done.

### [Low] Debug stylesheet duplicates and conflicts with scoped component styles; dead CSS

- **Id:** debug-stylesheet-conflicts-dead-css
- **Status:** fixed
- **Resolved:** `5f9e5b945` ("refactor(debug): delete dead css, co-locate component styles"), `fee6f5dd9` ("fix(client/debug): remove dead CSS selectors from debug.css"), `9e2a45302` ("fix(debug): deterministic shots, TraceDetail duration, dead css cleanup")
- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Source only — `client/debug/debug.css` is now 387 lines (was ~1018) with no `.session-card`/`.tree-*`/`.log-filters`/`.turn-row`/`.turn-summary`/`.turn-log-link`/`.placeholder` selectors left in it
- **Source:** `client/debug/debug.css` (grep confirms no remaining `.session-card`/dead selectors; only shared `:focus-visible`/`.selected`/`.debug-banner` rules and the grid live here now); `client/debug/components/SessionDetail.svelte:129-133` (facts now use a dedicated `.fact-item` class, not `.tool-call-item`)
- **Suggested fix:** ~~Consolidate each component's styles in one place and delete the dead rules.~~ Done.

### [Low] Duration formatting inconsistent across panels

- **Id:** debug-inconsistent-duration-format
- **Status:** fixed
- **Resolved:** `bab2f2004` ("feat(shared): formatDuration, consistent duration display in debug")
- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Turns table and trace list both show e.g. `1.2s` for the same magnitude
- **Source:** `client/shared/helpers.ts:87-91` (`formatDuration`); used at `client/debug/components/TurnsPanel.svelte:133` and `TraceList.svelte:48`
- **Suggested fix:** ~~Route all durations through one shared formatter.~~ Done.

### [Low] "Active" session and "operator" session share the same accent left border

- **Id:** debug-active-operator-same-border
- **Status:** fixed
- **Resolved:** `2d69e1f81` ("fix(debug+shared): distinct operator signifier, aria names on icon buttons")
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Sessions list — the operator's own card carries a small "you" badge; only recency (`isActive`) still drives the left-accent border
- **Source:** `client/debug/components/SessionCard.svelte:27,41,71-73,93-102` — `class:active={isActive}` is the only thing that sets `.session-card.active`'s border; `isOperator` renders a separate `.operator-badge` pill, not a border/class on the card
- **Suggested fix:** ~~Use distinct signifiers (e.g. keep the border for recency, badge-only for operator).~~ Done.

### [Low] Icon-only buttons have no accessible names

- **Id:** debug-icon-buttons-no-accessible-names
- **Status:** fixed
- **Resolved:** `2d69e1f81` ("fix(debug+shared): distinct operator signifier, aria names on icon buttons")
- **Dimension:** 6. Accessibility
- **Where visible:** Source only — both buttons now carry `ariaLabel`
- **Source:** `client/debug/components/DebugDetailRail.svelte:53` (`<Btn ... ariaLabel="Close detail" ...>✕</Btn>`), `client/debug/components/LogExplorer.svelte:155` (`<Btn ... ariaLabel="Clear turn filter" ...>×</Btn>`)
- **Suggested fix:** ~~Add an aria-label to both buttons.~~ Done.

### [Low] Suspect low-contrast meta text

- **Id:** debug-low-contrast-meta-text
- **Status:** fixed
- **Resolved:** `09f46aa3c` ("refactor(client): migrate 314 legacy token aliases to the semantic vocabulary"), plus `86c6221c5` for the specific `LogExplorer`/`DebugTopBar` instances
- **Dimension:** 6. Accessibility
- **Where visible:** Source only — no low-contrast alias remains
- **Source:** `client/shared/tokens.css:21` — `--text-dim: #828d84; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */` is now the floor for all meta text (`SessionCard.svelte:83`, `LogExplorer.svelte:265` `.log-history__note`, `TraceList.svelte` overflow text); `grep -rn "var(--fg[0-9])" client/` returns no matches — the old `fg3`/`fg4` aliases this finding referenced no longer exist anywhere
- **Suggested fix:** ~~Bump the smallest meta text to fg3 minimum and verify contrast.~~ Done.

### [Low] Poller pills encode state only in tone, not in the label

- **Id:** debug-poller-pills-tone-only
- **Status:** fixed
- **Resolved:** `86c6221c5` ("fix(debug): poller state in pill text, fg3 floor for meta text")
- **Dimension:** 5. Content & language
- **Where visible:** Top bar secondary row — pills read `scheduled · on`/`scheduled · off` and `alerts · on`/`alerts · off`
- **Source:** `client/debug/components/DebugTopBar.svelte:69-70`
- **Suggested fix:** ~~Include state in the pill text so status doesn't rely on color alone.~~ Done.

### [Low] Icon-only buttons sit at the shared 24px control-height token

- **Id:** debug-icon-buttons-control-height
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Detail rail `✕` close, log turn-badge `×` clear, and every other `size="sm"` `Btn` in the debug dashboard
- **Source:** `client/shared/ui/Btn.svelte:111` (`.sm { height: var(--control-h-sm); }`); `client/shared/tokens.css:63` (`--control-h-sm: 24px`)
- **Note:** 24px meets, rather than violates, WCAG 2.2 SC 2.5.8 (Target Size Minimum)'s 24×24px floor — this is not an accessibility failure. It is recorded because it is a shared design-token fact, not a `DebugApp`-specific defect: `DebugDetailRail`/`LogExplorer` merely consume `Btn`'s `sm` size like every other section does. A later implementer should not "fix" this by growing buttons locally in `DebugApp`; any change to the floor belongs in `--control-h-sm` in `client/shared/tokens.css`, where it affects every consumer at once.
- **Suggested fix:** No action needed in `DebugApp`. If a larger default is wanted app-wide, raise `--control-h-sm` in `client/shared/tokens.css` and re-review the sections that would be affected.
