<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug dashboard UX review remediation — phased design

**Date:** 2026-08-01
**Status:** Approved (design); implementation not started
**Source document:** [`docs/ux-reviews/DebugApp.md`](../../ux-reviews/DebugApp.md) — 17 findings (4 High, 7 Med, 6 Low)
**Target area:** `client/debug/**`, plus `client/shared/ui/DataTable.svelte`, `client/shared/TreeView.svelte`, `client/shared/ui/SummaryList.svelte`, `client/shared/helpers.ts`

This spec remediates every finding in the debug-dashboard UX review in three
independently shippable phases, sliced foundation → interaction → layout.
Each phase ends with updated stories, re-shot screenshots, and a checkoff of
the findings it closes.

## Decisions

| Decision | Outcome |
|---|---|
| Coverage | All 17 findings, no re-triage |
| Phase slicing | Foundation (shared components) → interaction (debug rows/state) → layout & content |
| Shared-component blast radius | Fix in `client/shared/` directly; settings/admin stories re-shot each phase to prove no regression |
| Per-phase verification | New/updated stories + `bun shoot` re-shoot + explicit finding checkoff |
| M7 (scope filter on sessions/traces) | Relabel the Seg as activity-scoped; do **not** add scope fields to server trace/session events (rejected: server-side blast radius in `src/debug/` for a labeling problem — `LlmTrace` carries only `userId`, sessions are keyed by `userId`; neither can distinguish dm vs group threads) |
| Selected-row identity | turns → `turnId`; sessions → `userId`; logs → index; traces/failures → object identity (no stable id exists) |
| Focus-ring verification | Keyboard `Tab` navigation in manual visual-spec tests (programmatic `.focus()` does not trigger `:focus-visible`) |

## Finding → phase map

| Finding | Severity | Phase |
|---|---|---|
| H1 no responsive layout | High | 3 |
| H2 invisible keyboard focus (rows + DataTable) | High | 1 (DataTable) + 2 (row divs) |
| H3 no selected-row indication | High | 2 |
| H4 silent disconnect | High | 3 |
| M5 raw-JSON TurnDetail/FailureDetail | Med | 3 |
| M6 header counts ignore scope filter | Med | 2 |
| M7 scope filter not applied to sessions/traces | Med | 2 (relabel decision) |
| M8 dead-end empty states | Med | 3 |
| M9 TreeView bracket misalignment | Med | 1 |
| M10 SummaryList clips long ids | Med | 1 |
| M11 scope-chip tri-state undiscoverable | Med | 2 |
| L12 dead/duplicated CSS | Low | 3 |
| L13 duration formatting inconsistent | Low | 3 |
| L14 active vs operator same signifier | Low | 2 |
| L15 icon buttons lack accessible names | Low | 2 |
| L16 suspect low-contrast meta text | Low | 3 |
| L17 poller pill label is tone-only | Low | 3 |

## Phase 1 — Shared foundations (`client/shared/`)

**DataTable keyboard reachability (H2 groundwork, enables H3).**
When `onRowClick` is set, body rows get `tabindex="0"`, Enter/Space activation
(mirroring the existing click guard that ignores clicks on nested
`a, button`), and a `:focus-visible` ring drawn from `--focus-ring` /
`--focus-ring-offset`. Verify the existing `ui-datatable__tr--selected`
treatment reads as "selected" in the rail-context shots; strengthen (e.g.
add a left accent border) if the faint background alone doesn't register.

**TreeView closing brackets (M9).**
Render the closing `}`/`]` on its own row at the same indent as the opening
line instead of inline after the children span
(`client/shared/TreeView.svelte:81`). Removes the ragged floating brackets
visible in every detail-rail screenshot.

**SummaryList long values (M10).**
`.ui-summary__v` gets `min-width: 0` and `word-break: break-all`; the row gets
`min-width: 0` so long unbroken ids wrap instead of clipping at the panel
edge (`client/shared/ui/SummaryList.svelte:52`).

**Phase 1 verification.**
Extend `DataTable.stories.svelte` (selected row; keyboard-focused row via
`sharedPage.keyboard.press('Tab')`), `SummaryList.stories.svelte` (long-id
item), TreeView story (deep nesting) as needed; re-shoot
`bun shoot -g 'DataTable|TreeView|SummaryList'` plus the composed
settings/admin stories that consume DataTable to prove zero regression.
Checkoff: M9, M10; groundwork for H2/H3.

## Phase 2 — Interaction layer (`client/debug/`)

**Row focus rings (H2 completion).** One shared rule in `debug.css` applying
`--focus-ring` `:focus-visible` styling to `.session-card`, `.trace-row`,
`.failure-row`, `.log-entry` (all are `tabindex="0"` `role="button"` divs).

**Selected-row wiring (H3).** Each list derives its selected id from
`dashboard.selectedDetail`: TurnsPanel passes `selectedKey =
payload.turnId` to DataTable; SessionCard / TraceList / ToolFailuresPanel /
LogExplorer rows get a `class:selected` binding (identity for traces and
failures, `userId` for sessions, index for logs) sharing the DataTable
selected visual.

**Filtered counts (M6).** TurnsPanel, ToolFailuresPanel, NotificationsPanel
headers render the filtered count, shown as `filtered/total` when
`scopeFilter !== 'all'`, plain count otherwise.

**Scope-filter labeling (M7, per Decisions).** Add a short caption near the
Seg clarifying it scopes activity panels (turns, notifications, failures);
sessions and traces stay unfiltered.

**Scope-chip legend (M11).** One line of hint text above the ScopeFilter
chip cloud: "click to include · again to exclude · again to clear".

**Active vs operator (L14).** `.session-card.operator` loses the accent left
border (keeps the `you` badge); accent border + faint background means
"accessed in the last 5 minutes" only.

**Aria-labels (L15).** `aria-label="close detail"` on the rail ✕ button;
`aria-label="clear turn filter"` on the log turnId-badge ×.

**Phase 2 verification.** New story states: selected row per list,
filtered-count header variant, operator+active session card. Focus rings
verified via keyboard-Tab manual spec tests (or source confirmation per the
ux-review convention where a shot is impractical). Checkoff: H2, H3, M6,
M7, M11, L14, L15.

## Phase 3 — Layout & content

**Responsive (H1).** Add `@media (max-width: 720px)` (matching
`settings.css`/`admin.css`) to `debug.css`: `.debug-grid` collapses to a
single stacked column (left → center → rail), `.debug-grid__center-row`
stacks, and the top-bar rows wrap. The two existing narrow-640px tests in
`tests/visual/debug/DebugApp.spec.ts` are the regression proof.

**Disconnected state (H4).** A full-width banner under the top bar when
`!dashboard.connected` ("stream disconnected — showing last buffered data,
reconnecting…"); the top-bar stat counters dim to `--fg3` while
disconnected; the swallowed fetch `catch` in `DebugApp.svelte:49` sets a
`dashboard.logsError` flag surfaced as an inline note in LogExplorer.

**Structured TurnDetail / FailureDetail (M5).** Replace the raw TreeView
dumps with formatted views mirroring TraceDetail: SummaryList of formatted
fields (human-readable timestamps via `formatTime`, status pill, scope
label, duration) plus a tool-call list for turns and an error/retriable
section for failures. The raw TreeView remains available as a collapsed
"raw" section at the bottom for deep inspection.

**Empty-state hints (M8).** Every debug `EmptyState` usage passes a `hint`
(e.g. "turns appear here as messages are processed", "no failures in the
buffered window").

**Low polish.**
- L12: delete dead CSS in `debug.css` (`.log-filters`, `#log-autoscroll`,
  `.turn-row`, `.turn-summary`, `.turn-log-link`, `.placeholder`, the
  duplicated `.tree-*` and `.session-card` blocks); consolidate SessionCard
  styling into `SessionCard.svelte`; stop reusing `.tool-call-item` for
  facts in SessionDetail.
- L13: one shared duration formatter in `client/shared/helpers.ts` used by
  TurnsPanel and TraceList.
- L16: bump the smallest meta text (`fg4` 10–11px) to `--fg3` minimum.
- L17: poller pills include state in text (e.g. `scheduled · off`).

**Phase 3 verification.** Re-shoot everything (`bun shoot -g 'debug/'`)
including the narrow baselines; new stories for the disconnected banner and
structured details. Checkoff: remaining findings — 17/17 closed.

## Testing

- Pure helpers (duration formatter, filtered-count logic, scope-matching)
  get `bun:test` unit tests following the DI-first pattern in
  `tests/CLAUDE.md`.
- Components are verified via Storybook stories + screenshots per phase;
  no new test harness is introduced.
- After each phase: `bun run lint`, typecheck, and `bun run format` per repo
  convention, plus the phase's finding checkoff recorded in the commit
  message or PR description.

## Non-goals

- Server-side (`src/debug/`) event-shape changes (rejected for M7).
- Visual-regression gating in CI (screenshots remain local baselines).
- Redesigning the dashboard's information architecture beyond the findings
  (e.g. new panels, new data sources).
