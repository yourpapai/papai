<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards

## Status

Implemented

## Date

2026-06-01

## Context

The `/admin` stats/billing surfaces are the first consumer of the Phase 1 kit shipped in ADR-0169 (`fmtNum`/`fmtBytes` in `client/shared/helpers.ts`; `Stat`, `Meter`, `StatusPill`, `DataTable` in `client/shared/ui/`). A design audit (spec §7) had logged six still-relevant findings against them: three divergent local `formatBytes` copies (two on base-1000), a raw `<table>` `SubjectsTable` with no column widths, left-aligned bare-integer numeric cells, no thousands separators (A1/A4), and active-subjects (A5) plus surface-mix (A6) widgets that hand-rolled clamps but could not surface the "value > total" data bug. The already-fixed tool-calls chart/header bugs (A2/A3) and the zero-height bar (C1) needed regression-guard tests so a future refactor could not reintroduce them.

This plan is pure consumer-side adoption in `client/admin/` — no new kit components — behavior-preserving except the deliberately-flagged base-1024 byte-format change. It is Phase 2.1 of the three-phase remediation (kit → `/admin` → `/debug`+`/settings`). Spec: `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md`.

## Decision Drivers

- **One canonical formatter:** end the three divergent `formatBytes` copies (StatsPanel, SubjectStatsPanel, OverviewSection) by routing through the shared `fmtBytes`.
- **Readable, aligned numerics:** the subjects table's token/tool totals must right-align and carry thousands separators.
- **Over-capacity as a signal, not a silent clamp:** active-subject counts and surface-mix ratios must surface "value > total" as a warn state, not silently `Math.min` it away.
- **Lock the already-fixed bugs:** A2/A3 (chart-before-table, single header) and C1 (zero-height bar) need tests so they cannot regress.
- **Behavior-preserving refactor:** except the deliberate base-1024 byte-format shift, no visible change to existing widgets.
- **No new kit components:** Phase 1 already shipped the primitives; this phase only wires consumers to them.

## Considered Options

### Option 1: Adopt the Phase 1 kit + helpers (chosen)

Consolidate `formatBytes` → `fmtBytes`, route `SubjectsTable` through `DataTable` + `fmtNum`, replace active-subjects with `Stat` and surface-mix with `Meter`, and add regression-guard tests.

- **Pros:** one source of truth for formatting and over-capacity rendering; numeric alignment/separators come from the tested `DataTable`; future Phase 2.2–2.5 sections reuse the same primitives.
- **Cons:** the base-1024 consolidation is a visible value shift at two former base-1000 call sites; `DataTable` lacks the raw table's keyboard row activation (a pre-existing nicety).

### Option 2: Keep local formatters, fix only alignment

Leave the three `formatBytes` copies in place and only right-align the subjects table inline.

- **Pros:** no byte-format behavior change; smallest diff.
- **Cons:** the divergence the audit flagged keeps diverging; no over-capacity signal (A5/A6 stay hand-rolled clamps); numeric formatting stays ad hoc per section.

### Option 3: Inline per-section fixes without `DataTable`

Hand-roll right-alignment and separators directly in `SubjectsTable.svelte` instead of routing through `DataTable`.

- **Pros:** no dependency on the shared table primitive.
- **Cons:** re-implements column widths/alignment/separators that `DataTable` already owns; duplicates the chart/table header structure the A3 guard must assert; loses the `StatusPill` type column for free.

## Decision

Six tasks, each a TDD refactor of one existing Svelte component plus its test (Red → Green), each committed separately:

1. **Consolidate `formatBytes` → `fmtBytes` (Task 1).** Delete the local `formatBytes` in `StatsPanel.svelte`, `SubjectStatsPanel.svelte`, and `OverviewSection.svelte`; import `fmtBytes` from `client/shared/helpers.js` and replace every call site. Tests assert the new base-1024 output (e.g. `271 KB`, not `271.3 KB`; `1.4 MB`, not `1.5 MB`).
2. **`SubjectsTable` → `DataTable` + `fmtNum` (A1/A4, Task 2).** Rewrite `SubjectsTable.svelte` to render through `DataTable` with right-aligned numeric columns (`main`/`small`/`embedding`/`tools`/`last`), `fmtNum(..., 0)` for thousands separators, and a `StatusPill`-rendered `type` column via a `cell` snippet; row clicks resolve back to the original `BillingSubject` through a `byId` map. The raw `<table>` keyboard activation is dropped (flagged, not silently).
3. **Active-subjects via `Stat` (A5, Task 3).** Replace the three `MetricCard`s in the active-subjects panel of `StatsPanel.svelte` with `<Stat label value of={totalSubjects} />`; `Stat`'s warn-on-over renders `.ui-stat__value--over` + an "exceeds total" note when `activeIn{1,7,30}d` exceeds `dmTotal + groupTotal`. Storage stays on `MetricCard` (no denominator there).
4. **Surface-mix via `Meter` (A6, Task 4).** Replace the hand-rolled `.overview__mix-*` bar/fill markup in `OverviewSection.svelte` with `<Meter label value total />`; `Meter` clamps to 100% and turns `.ui-meter__fill--warn` when `n > total`. Dead `.overview__mix-row/-bar/-fill` style rules are removed.
5. **Regression guards (A2/A3/C1, Task 5).** Add tests to `StatsPanel.test.ts` asserting exactly one tool-calls `DataTable` header set (A3) and that the sparkline precedes the table in document order (A2). C1 (zero-height bar) is already guarded by the Phase 1 `tests/client/shared/ui/Bars.test.ts` empty-data cases — no new test, noted in the commit.
6. **Read-only `/stats/*` aggregation verification (A4/A5/A6 server note, Task 6).** Investigation only — no server code change. Confirmed in `src/stats/global-subjects.ts` and `src/stats/global-mix.ts` that the active-subject and surface-mix numerators are **not** constrained to the `users` ∪ `authorized_groups` registered-subject universe, so a numerator can legitimately exceed `dmTotal + groupTotal` (deleted users, thread-scoped context IDs, legacy rows). Recorded as a follow-up: "fix(stats): constrain active-subject and surface-mix numerators to registered-subject universe."

## Consequences

### Positive

- One canonical byte formatter (base-1024) replaces three divergent copies across the admin surfaces.
- `SubjectsTable` numerics are right-aligned with thousands separators and a `StatusPill` type column, via the tested `DataTable` primitive.
- Over-capacity is now a visible warn state (`Stat`/`Meter`) rather than a silent `Math.min` clamp, making the underlying aggregation skew discoverable in the UI.
- A2/A3 regression guards lock the already-fixed chart/header bugs; C1 is guarded by Phase 1 `Bars` tests.

### Negative

- **Deliberate base-1024 behavior change** at two former base-1000 call sites: values ≥10 in a unit lose their decimal (e.g. `271.3 KB` → `271 KB`), and unit thresholds shift at the former base-1000 sites (e.g. `1.5 MB` → `1.4 MB`). Intended, asserted in tests, but a visible value shift operators may notice.
- **`DataTable` rows are click-only.** The previous raw table's `tabindex`/`role=button`/`onkeydown` keyboard activation is not preserved; flagged in the commit body rather than silently dropped, and noted as a separate scoped change if needed.
- **The server-side aggregation mismatch (Task 6) is not fixed here.** The UI clamps and warns, which masks the root cause; the fix belongs in `src/stats/` per the recorded follow-up.
- **`Stat`/`MetricCard` overlap persists** (Phase 1 decision): storage stays on `MetricCard`, active-subjects on `Stat`, by design.

### Risks

- **Base-1024 shift surprises operators** reading storage totals; mitigated by tests asserting the exact rendered values, but no changelog notice beyond the commit history.
- **Stat/Meter warn states can fire under normal data** (deleted users, thread-scoped context IDs) because the server numerators are unconstrained — this is correct given current data, but could be read as a UI bug until the `src/stats/` follow-up lands.
- **Prototype fidelity is a human assertion.** Guards assert structural CSS selectors (`.ui-datatable__td--right`, `.ui-stat__value--over`, `.ui-meter__fill--warn`), not visual parity; visual regressions rely on Storybook preview.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships the `fmtNum`/`fmtBytes` helpers and `Stat`/`Meter`/`StatusPill`/`DataTable` primitives this phase adopts.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` operator surface these sections live in.
- **ADR-0145: Dashboard Primitives Pass** — the prior `client/shared/ui/` baseline ADR-0169 extended.
- **ADR-0166: Storybook Harness — PR 1** — the harness and `bun check:bundle-isolation` gate the refactored sections' stories rely on.

## Implementation Notes

Verified present in the codebase (light confirmation, not exhaustive):

| File                                                  | Role                                                                                                                                                                                                | Evidence                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `client/shared/helpers.ts`                            | `fmtNum` (line 65) and `fmtBytes` (line 74) — the canonical formers.                                                                                                                                | `grep` confirms both exports.      |
| `client/admin/components/StatsPanel.svelte`           | Imports `fmtBytes, fmtNum`; imports `Stat`; active-subjects panel uses `<Stat label value of={totalSubjects}>` (lines 200–202); storage stays on `MetricCard` + `fmtBytes`.                         | `grep` + read confirm.             |
| `client/admin/components/SubjectStatsPanel.svelte`    | Imports `fmtBytes, fmtNum`; all metric values formatted through them.                                                                                                                               | `grep` confirms (lines 10, 52–66). |
| `client/admin/sections/OverviewSection.svelte`        | Imports `fmtBytes, fmtNum` and `Meter`; surface-mix panel renders `<Meter label value total>` (line 136).                                                                                           | `grep` + read confirm.             |
| `client/admin/components/SubjectsTable.svelte`        | Routed through `DataTable` + `fmtNum` + `StatusPill` (lines 7–10, 44–47, 103–119).                                                                                                                  | `grep` confirms.                   |
| `tests/client/admin/StatsPanel.test.ts`               | `fmtBytes` output (line 193), `Stat` over-capacity `.ui-stat__value--over` (line 217), A3 single header `.ui-datatable__th` (line 233), A2 chart-before-table `compareDocumentPosition` (line 263). | `grep` confirms.                   |
| `tests/client/admin/sections/OverviewSection.test.ts` | `fmtBytes` `1.4 MB` output (line 87), `Meter` over-capacity `.ui-meter__fill--warn` (line 171).                                                                                                     | `grep` confirms.                   |
| `tests/client/admin/components/SubjectsTable.test.ts` | Mounts `SubjectsTable`, asserts `fmtNum` separators + `DataTable` + `StatusPill` + `onSelect`.                                                                                                      | `glob`/`grep` confirm.             |
| `tests/client/admin/SubjectStatsPanel.test.ts`        | `fmtBytes` output assertion (line 82).                                                                                                                                                              | `grep` confirms.                   |

Minor path divergence from the plan's literal test paths: the OverviewSection and SubjectsTable tests mirror their source layout (`tests/client/admin/sections/` and `tests/client/admin/components/`) rather than the flat `tests/client/admin/*.test.ts` the plan named — the repo convention is test-path-mirrors-source. The tests' content matches the plan. Task 6's server-aggregation finding is recorded in the plan file's "Verification findings (Task 6)" section; the spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`.
