<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0348: Debug Dashboard UX Remediation — Shared-Primitive-First Phases, Interaction State off `selectedDetail`, Screenshot-Verified Visual Work

## Status

Accepted (verified implemented)

## Date

2026-08-08

## Context

A 17-finding UX review of the debug dashboard (`docs/ux-reviews/DebugApp.md`: 4 High, 7 Med, 6 Low) found the dashboard hard to operate: list rows had no keyboard focus rings and no selected-row indication, so clicking a turn/trace/failure/log gave no visual feedback about what the detail rail was showing (H2, H3); a disconnected SSE stream was indistinguishable from a live one (H4); narrow viewports overlapped the three-column grid (H1); detail views dumped raw JSON trees instead of structured fields (M5); panel header counts ignored the scope filter (M6); the scope chips and activity `Seg` had no legend/caption (M7, M11); empty states gave no guidance (M8); `TreeView` closing brackets rendered inline at ragged indentation (M9); `SummaryList` clipped long unbroken values (M10); `debug.css` had grown to 1046 lines with dead selectors and duplicated tree/row styles (L12); durations rendered inconsistently (`1234ms` vs `1.2s`, L13); the operator session-card border collided with the active-row signifier (L14); icon-only buttons had no accessible names (L15); low-contrast `--fg4` meta text fell below the readability floor (L16); and poller pills showed color-only on/off state (L17).

Several findings lived in **shared primitives** (`DataTable`, `TreeView`, `SummaryList`, `Btn`, `EmptyState`) consumed by the settings and admin apps as well as debug, so a debug-local patch would leave the root causes in place. The design (`docs/superpowers/specs/2026-08-01-debug-dashboard-ux-remediation-design.md`) and plan (`docs/superpowers/plans/2026-08-01-debug-dashboard-ux-remediation.md`) chose a three-phase remediation ordered so each phase de-risks the next: **Phase 1** fixes the shared primitives with settings/admin re-shoots as regression proof; **Phase 2** wires the debug interaction layer (focus rings, selected rows, filtered counts, legends, accessible names); **Phase 3** adds responsive layout, disconnect feedback, structured detail views, empty-state hints, and dead-CSS consolidation.

## Decision Drivers

- **Fix primitives once, benefit every consumer.** `DataTable` keyboard reachability, `TreeView` bracket layout, `SummaryList` value wrapping, and `Btn` accessible names are shared-component fixes; settings/admin re-shoots act as regression proof for the wider blast radius.
- **Reuse existing state, don't add a selection store.** Selected-row indication across all five lists keys off the already-existing `dashboard.selectedDetail` discriminated union — no new state container, no synchronization surface.
- **Focus and selected are independent styles.** A shared `:focus-visible` block and a separate `.selected` block (accent inset edge + translucent accent background) in `debug.css` serve all four row types without conflating keyboard navigation with selection.
- **Structured detail, raw behind a toggle.** Turn/Failure detail views render `SummaryList` field rows (status pill, formatted durations, scope labels) with the raw `TreeView` tree hidden behind a `show raw` ghost button.
- **Visual work is verified visually.** Every CSS/markup change is guarded by a Storybook story + `bun shoot` screenshot baseline (regenerating specs with `bun shoot:gen`); logic gets `bun:test` mount/unit tests. CSS that happy-dom cannot compute is pinned by reading PNGs, not asserting computed style.
- **Co-locate single-component styles; keep cross-component rules global.** Task 17 deletes dead selectors from `debug.css` and moves single-consumer rules into scoped `<style>` blocks, keeping only the four-component interaction rules global.
- **Disconnect is a first-class state.** A `debug-banner` announces the disconnected stream, stat counters dim via a `.stale` class, and a `logsError` field surfaces a failed log bootstrap without masking live SSE delivery.

## Considered Options

### Option 1 — Three-phase shared-first remediation (chosen)

Fix the shared primitives first with settings/admin regression proof, then wire the debug interaction layer off `dashboard.selectedDetail`, then layout/content/polish; every visual step verified by Storybook screenshot baselines.

- **Pros:** closes all 17 findings at the root; shared fixes (`DataTable` keyboard rows, `Btn ariaLabel`, `SummaryList` wrapping, `formatDuration`) benefit settings/admin and future consumers; phase boundaries give natural commit checkpoints with full gates between them.
- **Cons:** broad blast radius on shared components raises regression risk (mitigated by re-shoots); 19 tasks is a long execution for a "UX fixes" pass.

### Option 2 — Debug-local patches only

Fix each finding inside `client/debug/` without touching `client/shared/`.

- **Pros:** minimal blast radius; no settings/admin regression risk.
- **Cons:** duplicates or forks shared components (a debug-only table, a debug-only tree); leaves the same defects in settings/admin; contradicts the design-system direction established in ADR-0248.

### Option 3 — Defer cosmetic/low findings

Ship only the High findings (H1–H4) and leave Med/Low polish for later.

- **Pros:** shorter execution.
- **Cons:** the Low/Med findings (dead CSS, contrast floor, empty-state hints, pill text) are cheap compounding debt; the review explicitly framed all 17 as one closure, and partial passes historically invite re-review churn.

## Decision

Option 1 shipped in full. What landed, by phase:

1. **Phase 1 — shared foundations.** `DataTable` rows gained `tabindex="0"` + Enter/Space activation (`keyRow`) and a stronger `.ui-datatable__tr--selected` (accent inset edge); `TreeView` renders closing brackets on their own aligned rows (`.tree-closing`); `SummaryList` wraps long unbroken values (`min-width: 0` + `word-break: break-all`).
2. **Phase 2 — interaction layer.** A shared `:focus-visible` block covers `.session-card`/`.trace-row`/`.failure-row`/`.log-entry`; selected-row wiring keys off `dashboard.selectedDetail` across all five lists (with key-based matching in `TraceList`/`ToolFailuresPanel`/`LogExplorer`); `panelCount(filtered, total, scopeFilter)` renders honest `7/42` header counts; the scope chips gained a tri-state legend and the activity `Seg` a caption; `Btn` gained `ariaLabel` (consumed by the rail ✕ and log-filter ×); the operator session-card border was removed, leaving the `you` badge as the sole operator signifier.
3. **Phase 3 — layout & content.** `formatDuration` unified duration display; `formatScope` was extracted from `TurnsPanel` and shared with the detail views; `TurnDetail`/`FailureDetail` render structured `SummaryList` views with collapsible raw trees; a 720px breakpoint collapses the grid and wraps the top bar; the disconnect banner, stale-stat dimming, and `logsError` note shipped; every panel's empty state gained an actionable hint; `debug.css` shrank from 1046 to ~386 lines with dead selectors deleted and single-component styles co-located; poller pills render `scheduled · on` / `alerts · off` and meta text moved off `--fg4` to `--fg3`.

## Consequences

### Positive

- All 17 review findings closed: keyboard users can reach and identify every interactive row; selection state is visible across all five lists; disconnect and log-bootstrap failure are explicit UI states.
- Shared primitives improved once and everywhere: `DataTable` keyboard reachability, `Btn ariaLabel`, `SummaryList` wrapping, `TreeView` bracket rows, and `formatDuration`/`formatScope`/`panelCount` helpers are reusable beyond debug.
- `debug.css` dropped ~66% of its lines; single-component styles now live in scoped blocks where knip/dead-code hygiene can see them, and the remaining global rules are the genuinely cross-component interaction states.
- Every visual change carries a screenshot baseline (Storybook + `bun shoot`), so future CSS refactors have regression proof; logic changes carry `bun:test` mount tests (10 new/extended test files).
- The `dashboard.selectedDetail` union proved sufficient as the single selection source of truth — no new state store was needed.

### Negative

- Shared-component changes carry regression surface for settings/admin (radius/selection/wrapping shifts propagate); mitigated by re-shoots but the coupling is now structural.
- Selection matching for traces/failures/logs moved from the plan's object-identity check to key-based matching (`selectedTraceKey`, `failureKey`, `logKey`) — a post-plan hardening (`3913411f2`, `25595b393`) meaning the plan's identity-based snippets no longer describe the shipped code.
- The plan's ~90 checkboxes were never ticked (`- [ ]` throughout), so the plan file alone misreports completion; this ADR's Implementation Notes are the closure record.

### Risks

- **Screenshot-baseline maintenance cost.** Every debug CSS change now implies `bun shoot:gen && bun shoot` and PNG review; skipping it silently drifts baselines. Mitigated by the repo's existing shoot pipeline being part of the client-change workflow.
- **Selected-key divergence.** Key-based selection in three lists vs `selectedKey` prop in `DataTable` is two mechanisms for one concept; a future refactor could unify them.

## Related Decisions

- **ADR-0248: ProfileSection UX Fixes** — established the fix-shared-primitives-first pattern and the source/screenshot verification approach this remediation extends to the debug dashboard.
- **ADR-0245: AI UX Review Workflow** — the `docs/ux-reviews/DebugApp.md` report this plan closes was produced by that review loop; this ADR is its execution record.
- **ADR-0238 / ADR-0269: Storybook screenshot pipeline and per-app CSS fidelity** — the verification substrate (`bun shoot`, `@crvy/strybk` specs) all visual steps depend on.

## Implementation Notes

Verified present against the shipped tree (branch work landed via `ui-ux-review-01`); core commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/ui/DataTable.svelte:84,129-131` | `keyRow` factory, `tabindex` + `onkeydown` on clickable rows | `rg` confirms |
| `client/shared/TreeView.svelte:85` | `.tree-row.tree-closing` closing-bracket row | `rg` confirms |
| `client/shared/ui/SummaryList.svelte:47,57-58` | `min-width: 0` + `word-break: break-all` | `rg` confirms |
| `client/debug/debug.css:361-364,347` | shared `:focus-visible` block; 720px media query; 386 total lines (was 1046) | `rg`/`rg -c` confirms |
| `client/debug/components/TurnsPanel.svelte:106,110,133` | `selectedKey={selectedTurnId}`, `EmptyState` hint, `formatDuration` | `rg` confirms |
| `client/debug/components/{SessionCard,TraceList,ToolFailuresPanel,LogExplorer}.svelte` | `class:selected` wiring (key-based in the latter three) | `rg` confirms |
| `client/debug/panel-count.ts`, `client/debug/scope-label.ts` | new pure helpers + tests | files exist |
| `client/shared/helpers.ts:87` | `formatDuration` | `rg` confirms |
| `client/shared/ui/Btn.svelte:22,54` | `ariaLabel?: string` → `aria-label` | `rg` confirms |
| `client/debug/dashboard-types.ts:100`, `client/debug/DebugApp.svelte:49-52,79` | `logsError?: string`; bootstrap-failure note; disconnect banner | `rg` confirms |
| `client/debug/components/{TurnDetail,FailureDetail}.svelte` | structured `SummaryList` + `show raw` toggle | `rg` confirms |
| `client/debug/components/ScopeFilter.svelte:34`, `DebugTopBar.svelte:69,74,110` | tri-state legend; `scheduled · on` pills; `activity scope` caption; 720px scoped media | `rg` confirms |
| `tests/client/debug/**` + `tests/client/shared/TreeView.test.ts` | 10 new/extended test files (TurnsPanel, SessionCard, ScopeFilter, TurnDetail, FailureDetail, ToolFailuresPanel, DebugTopBar, panel-count, scope-label, TreeView) | files exist |
| commits `1ea40dfc9`…`86c6221c5` + hardening `3913411f2`, `25595b393`, `8fc0086ea`, `fee6f5dd9`, `9e2a45302` | plan task commits match verbatim; post-plan fixes for key-based selection, connecting-state banner suppression, and dead-CSS leftovers | `git log --grep` confirms |

Plan-vs-implementation notes:

- **Selection matching hardened from object identity to keys.** The plan specified `dashboard.selectedDetail.payload === trace` identity checks for traces/failures and positional-index matching for logs. Shipped code uses derived keys (`selectedTraceKey`/`traceKey`, `selectedFailureKey`/`failureKey`, `selectedLogKey`/`logKey`) after `3913411f2` ("narrow selected-row signature") and `25595b393` ("pin log-row selected highlight to content key, not positional index") — more robust against list re-renders; intent unchanged.
- **Disconnect banner gained a connecting-state guard.** `8fc0086ea` suppresses the banner/stale dimming during the initial SSE connecting state — an edge the plan's "banner when `!connected`" rule would have flashed on every page load.
- **Dead-CSS cleanup needed a second pass.** `fee6f5dd9` and `9e2a45302` removed selectors Task 17's sweep missed; `rg` now finds no `.placeholder`/`.turn-row`/`.log-toolbar`/`.config-table` remnants.
- **Plan checkboxes unticked.** All steps remain `- [ ]` in the plan file despite full implementation; the git history and this table are the accurate completion record.

The source plan `docs/superpowers/plans/2026-08-01-debug-dashboard-ux-remediation.md` and design `docs/superpowers/specs/2026-08-01-debug-dashboard-ux-remediation-design.md` remain in `docs/superpowers/` pending archive.
