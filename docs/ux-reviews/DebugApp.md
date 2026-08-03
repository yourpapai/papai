<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — Debug Dashboard (DebugApp + components)

**Date:** 2026-08-01
**Reviewed:** `client/debug/DebugApp.svelte` + `client/debug/components/*` (SessionsList, SessionCard, TraceList, TurnsPanel, LogExplorer, ScopeFilter, NotificationsPanel, ToolFailuresPanel, DebugDetailRail, TurnDetail, TraceDetail, SessionDetail, LogDetail, FailureDetail, LiveContextCard, DebugTopBar)
**States captured:** Composed Default / Detail-selected / Disconnected-empty; all 36 component state stories (populated, empty, error, running, minimal, wizard, group-scope); narrow 640px app views · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Panel rhythm is consistent, but turn/failure details are raw JSON dumps with epoch millis — unscannable.        |
| 2. Affordance & signifiers      | fail  | Rows are hoverable/clickable but nothing marks which row the detail rail is showing; no selected state anywhere. |
| 3. Consistency w/ design system | warn  | Good reuse of Panel/Pill/Btn/DataTable, but style duplication between `debug.css` and scoped styles + dead CSS.  |
| 4. Feedback & state             | warn  | Connect pill + load-older busy state are good; disconnect leaves stale stats silently, header counts lie.        |
| 5. Content & language           | warn  | Debug-appropriate labels, but raw ids/epoch numbers, dead-end empty states, undiscoverable tri-state chips.      |
| 6. Accessibility                | fail  | Rows are `role="button"` divs with no `:focus-visible`; DataTable rows unreachable by keyboard; tiny targets.    |
| 7. Responsive / layout          | fail  | No breakpoints; at 640px the 3-column grid overflows horizontally with overlapping columns and 1-char wrapping.  |
| 8. Spacing, alignment & sizing  | warn  | Grid gaps consistent; TreeView brackets misalign; same component styled from two files with conflicting padding. |
| 9. Interaction & micro-states   | fail  | Hover exists on rows; keyboard focus ring absent on all rows; no selected state; only buttons have proper rings. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] No responsive layout — page breaks completely at ~640px

- **Dimension:** 7. Responsive / layout
- **Where visible:** `DebugApp — narrow 640px` screenshot — center/right columns overlap, tool-failure text wraps one character per line, top-bar counters spill, the scope `Seg` clips off the right edge
- **Source:** `client/debug/debug.css:1018` (fixed `260px minmax(0,1fr) 380px` grid, no `@media` anywhere in `debug.css`; settings/admin use a 720px breakpoint)
- **Suggested fix:** Add a breakpoint that collapses the three columns into a single stacked flow (rail last or as an overlay) and lets the top bar wrap.

### [High] Keyboard focus is invisible on every clickable row

- **Dimension:** 9. Interaction & micro-states / 6. Accessibility
- **Where visible:** Source — `.session-card`, `.trace-row`, `.failure-row`, `.log-entry` are `tabindex="0"` divs with hover styles but no `:focus-visible` rule; DataTable `<tr>` clicks have no `tabindex`/keydown at all, so turn rows are unreachable by keyboard
- **Source:** `client/debug/components/SessionCard.svelte:24`, `client/debug/components/TraceList.svelte:23`, `client/debug/components/ToolFailuresPanel.svelte:44`, `client/debug/components/LogExplorer.svelte:166`, `client/shared/ui/DataTable.svelte:116`
- **Suggested fix:** Give all focusable rows a visible `:focus-visible` ring (reuse `--focus-ring`) and make DataTable rows keyboard-focusable/activatable when `onRowClick` is set.

### [High] No selected-row indication for what the detail rail shows

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `DebugApp — Detail selected` screenshot — rail shows `turn · T-1` but the turns table marks nothing; same for traces, sessions, logs, failures
- **Source:** `client/debug/components/TurnsPanel.svelte:106` (`selectedKey` never passed to DataTable); `TraceList.svelte:23`, `SessionCard.svelte:24`, `LogExplorer.svelte:166` (no `selected` class binding)
- **Suggested fix:** Track the selected item id per list and apply the shared selected-row treatment (cf. DataTable's `ui-datatable__tr--selected`).

### [High] Disconnected state is silent — stale stats, unexplained empty panels

- **Dimension:** 4. Feedback & state
- **Where visible:** `DebugApp — Disconnected empty` screenshot — only a small red pill changes; uptime/msgs/llm/tools keep showing values, every panel shows a bare "No …" with no hint that the stream is down; the initial-log fetch failure is swallowed
- **Source:** `client/debug/components/DebugTopBar.svelte:46`, `client/debug/DebugApp.svelte:49` (empty `catch`)
- **Suggested fix:** On disconnect, surface a banner or per-panel hint ("stream disconnected — showing last buffered data / reconnecting") and visually dim the stat counters as stale.

### [Med] Turn and failure details are raw JSON trees with epoch timestamps

- **Dimension:** 1. Visual hierarchy & scanning / 5. Content & language
- **Where visible:** `DebugDetailRail — Turn selected`, `TurnDetail — *`, `FailureDetail — *` screenshots — `startedAt: 1779278400000`, nested `{ }` dumps; compare with TraceDetail's structured, formatted layout
- **Source:** `client/debug/components/TurnDetail.svelte:12`, `client/debug/components/FailureDetail.svelte:12`
- **Suggested fix:** Give turns and failures structured detail views (formatted timestamps, status pill, scope, tool-call list) like TraceDetail instead of a raw TreeView dump.

### [Med] Panel header counts ignore the active scope filter

- **Dimension:** 4. Feedback & state
- **Where visible:** Any state with `dm`/`group` selected — header shows e.g. `TURNS 2` while the table lists fewer filtered rows
- **Source:** `client/debug/components/TurnsPanel.svelte:91` (`count={dashboard.turns.length}` vs filtered rows), `ToolFailuresPanel.svelte:35`, `NotificationsPanel.svelte:43`
- **Suggested fix:** Show the filtered count (optionally `filtered/total`) in the panel header when the scope filter is active.

### [Med] Top-bar scope filter does not apply to sessions or LLM trace list

- **Dimension:** 3. Consistency w/ design system / 4. Feedback & state
- **Where visible:** Composed Default with `dm`/`group` selected — turns/notifications/failures filter, sessions and traces do not
- **Source:** `client/debug/components/SessionsList.svelte:20`, `client/debug/components/TraceList.svelte:21` (no `scopeFilter` usage; turns/notifications/failures implement `matchesScope`)
- **Suggested fix:** Either apply the scope filter consistently to sessions and traces, or label the Seg as applying only to activity panels.

### [Med] Empty states are dead ends

- **Dimension:** 5. Content & language
- **Where visible:** `Disconnected empty` and every `— Empty` component shot — `∅ No turns / No traces / No notifications / No failures / No active sessions` with no hint or action
- **Source:** `client/debug/components/TurnsPanel.svelte:113` (and siblings); `EmptyState.svelte:10` supports `hint`/`action` but debug never passes them
- **Suggested fix:** Add a one-line hint per empty state (e.g. "turns appear here as messages are processed", "no failures in the buffered window").

### [Med] TreeView closing brackets render inline at ragged horizontal positions

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `DebugDetailRail — Turn selected` screenshot — `}` / `]` glyphs float mid-row at inconsistent offsets (`scope: ▼ { kind: "user" }` spreads across the width; a stray `▼ {` row sits at the far left bottom)
- **Source:** `client/shared/TreeView.svelte:81` (closing bracket emitted inline after the children span)
- **Suggested fix:** Render the closing bracket on its own row aligned with the opening indent.

### [Med] SummaryList values clip long unbroken ids

- **Dimension:** 7. Responsive / layout
- **Where visible:** `TraceDetail — With tool calls` screenshot — right-aligned values (`tg:100…`, `17:00:0…`) cut off at the panel edge
- **Source:** `client/shared/ui/SummaryList.svelte:52` (`.ui-summary__v` has no `min-width: 0` / `word-break`; row is `justify-content: space-between`)
- **Suggested fix:** Allow the value cell to shrink and break long unbroken strings (`min-width: 0; word-break: break-all`).

### [Med] ScopeFilter include/exclude tri-state is undiscoverable

- **Dimension:** 5. Content & language / 9. Interaction & micro-states
- **Where visible:** LogExplorer toolbar — chips cycle neutral → include → exclude (line-through) on repeated clicks with no legend
- **Source:** `client/debug/components/ScopeFilter.svelte:24`
- **Suggested fix:** Add a tiny legend or tooltip copy explaining click cycles include → exclude → off.

### [Low] Debug stylesheet duplicates and conflicts with scoped component styles; dead CSS

- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Source — `.session-card` styled in both `debug.css` (padding `6px 8px`, left border) and `SessionCard.svelte` (padding `10px 12px`); `.tree-*` colors defined in `debug.css` and overridden by `TreeView.svelte` scoped rules; `.log-filters`, `#log-autoscroll`, `.turn-row`, `.turn-summary`, `.turn-log-link`, `.placeholder` appear unused; SessionDetail reuses `.tool-call-item` for facts
- **Source:** `client/debug/debug.css:197` vs `client/debug/components/SessionCard.svelte:54`; `client/debug/debug.css:610` vs `client/shared/TreeView.svelte:89`; `client/debug/components/SessionDetail.svelte:68`
- **Suggested fix:** Consolidate each component's styles in one place and delete the dead rules.

### [Low] Duration formatting inconsistent across panels

- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Turns table shows `1234ms`; trace list shows `1.2s` for the same magnitude
- **Source:** `client/debug/components/TurnsPanel.svelte:136` vs `client/debug/components/TraceList.svelte:39`
- **Suggested fix:** Route all durations through one shared formatter.

### [Low] "Active" session and "operator" session share the same accent left border

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Sessions list — a recently-active session and the operator's own session are indistinguishable (both get the accent border), and an idle operator session reads as active
- **Source:** `client/debug/debug.css:211` (`.session-card.active`) vs `client/debug/components/SessionCard.svelte:68` (`.operator`)
- **Suggested fix:** Use distinct signifiers (e.g. keep the border for recency, badge-only for operator).

### [Low] Icon-only buttons have no accessible names

- **Dimension:** 6. Accessibility
- **Where visible:** Detail rail `✕` close, log turn-badge `×` clear
- **Source:** `client/debug/components/DebugDetailRail.svelte:53`, `client/debug/components/LogExplorer.svelte:143`
- **Suggested fix:** Add `aria-label` ("close detail", "clear turn filter") to both buttons.

### [Low] Suspect low-contrast meta text

- **Dimension:** 6. Accessibility
- **Where visible:** Session cards (`fg4` 11px detail lines), wizard badge (10px), log buffer stat (`fg3` 11px), trace `+N` overflow (10px)
- **Source:** `client/debug/debug.css:221`, `client/debug/components/SessionCard.svelte:74`, `client/debug/components/LogExplorer.svelte:239`
- **Suggested fix:** Bump the smallest meta text to `fg3` minimum and verify contrast of `fg4` on `--surface` against the dark theme.

### [Low] Poller pills encode state only in tone, not in the label

- **Dimension:** 5. Content & language
- **Where visible:** Top bar secondary row — a mute-tone pill still reads `scheduled` / `alerts` whether the poller runs or not
- **Source:** `client/debug/components/DebugTopBar.svelte:69`
- **Suggested fix:** Include state in the pill text (e.g. `scheduled · on/off`) so status doesn't rely on color alone.
