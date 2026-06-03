<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0146: Dashboard Visual Bugs Fix

## Status

Implemented

## Date

2026-05-30 – 2026-06-02

## Context

Page-level screenshot comparison between the JSX design prototypes in
`client/assets/` and the live Svelte dashboard served by Storybook surfaced 10
findings across HIGH / MED / LOW severity. The findings cluster into four
classes:

1. **Missing primitives** — the prototype uses a `MetricCard` chrome (uppercase
   caps label / 26px numeral / sub-line) for every KPI tile; the Svelte side
   has no equivalent and falls back to `KV` (a 12px key-value row), making all
   metrics look like form labels.
2. **Sections shipping raw HTML** — `OverviewSection` and `StatsSection` render
   structurally broken; six other admin sections render browser-default
   `<select>` / `<button>` instead of `<Seg>` / `<Btn>`, and lack `<Panel>`
   chrome.
3. **Missing MSW handlers** — `/admin/plugin-config` and `/api/platform-instances`
   return 404 in the AdminApp story, with literal `request failed with status
404` banners visible.
4. **Component & story polish** — `TurnsPanel` reduced from 6-column table to
   3-column row; `SessionCard` line-bleed when nested in `DebugApp`; `DebugApp`
   has no `default` story; `TreeView` story has insufficient padding.

These visual bugs blocked the next workstream (e2e + component + screenshot
regression testing) because baselines would capture broken output.

Design spec:
`docs/archive/2026-05-30-dashboard-visual-bugs-fix-design.md`.
Implementation plan:
`docs/archive/2026-05-30-dashboard-visual-bugs-fix.md`.

## Decision Drivers

- **Prototype fidelity**: The dashboard must visually match the JSX prototypes
  at the page level before regression harnesses can baseline against it.
- **No backend changes**: All fixes are client-side only; no new endpoints,
  schema changes, or fetcher behaviours.
- **Primitives over ad-hoc markup**: Repeated patterns (metric tiles, dense
  tables) should be shared components, not per-section inline styles.
- **Test stability**: Existing `data-testid` attributes and component props must
  be preserved so `tests/client/admin/sections/*.test.ts` keep passing.
- **Incremental delivery**: Changes must land in independently reviewable and
  revert-friendly PRs.

## Considered Options

### Option A: Fix each section in-place with inline styles

Patch each section's markup individually without adding shared primitives.

- **Pros**: Smallest diff per file; no new components.
- **Cons**: Duplicates MetricCard styling across 8+ sections; future drift
  between sections; no Storybook catalog of the pattern.

### Option B: Add shared primitives, then rebuild sections (chosen)

Create `MetricCard` and `DataTable` as shared `client/shared/ui/` primitives,
harden `Bars`, then rewrite each admin section to compose from these
primitives. Add missing MSW handler families so Storybook renders without 404
banners.

- **Pros**: Single source of truth for metric chrome and dense table styling;
  Storybook catalog; each section's rewrite is reviewable in isolation.
- **Cons**: Larger initial PR surface; `data-testid` preservation requires
  per-section test review.

### Option C: Full design-system rewrite with new tokens

Introduce new CSS custom properties and a design-system story before fixing
sections.

- **Pros**: Token-level alignment with prototype.
- **Cons**: Token drift is not the root cause; existing tokens already match
  the prototype; adds scope without resolving the blocking findings.

## Decision

**Option B** — shared primitives + section rebuilds, delivered in four
sequential PRs:

| Topic            | Decision                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MetricCard       | Port of `client/assets/bs-admin-helpers.jsx:23`. Props: `label`, `value` (string/number/Snippet), `sub?`, `accent?`. Monospace caps label, 26px hero numeral, 11px grey sub-line. |
| DataTable        | Generic dense-row table replacing ad-hoc `<table class="admin-table">`. Typed columns, optional custom cell snippet, row click + selection, empty-state snippet.                  |
| Bars hardening   | Accept `data: number[] \| undefined`; viewBox-based SVG when `width` is omitted; `aria-hidden="true"`.                                                                            |
| Admin sections   | 8 sections rewritten to compose from `Panel` + `MetricCard` + `DataTable` + `Seg` + `Btn`. Raw `<select>`/`<button>` eliminated.                                                  |
| InstancesSection | Minimal pass: wrap in `Panel`, replace raw controls. Full rebuild deferred.                                                                                                       |
| MSW handlers     | `pluginConfigHandlers` and `instancesHandlers` families added to `client/stories/msw/handlers.ts`.                                                                                |
| TurnsPanel       | Rewrite with `DataTable` (6 columns: time, status Pill, scope, duration, msgs, tool chips).                                                                                       |
| SessionCard      | CSS-only fix for line-bleed (padding/line-height in `<style>` block).                                                                                                             |
| DebugApp story   | Rename `populated` → `default`.                                                                                                                                                   |
| TreeView story   | Add 20px padding decorator.                                                                                                                                                       |

## Consequences

### Positive

- All 10 visual-bug findings resolved (HIGH §2.1–2.4, MED §2.5–2.7, LOW
  §2.8–2.9); §2.10 (InstancesSection full rebuild) intentionally deferred.
- Shared `MetricCard` and `DataTable` primitives provide a single source of
  truth for metric and table chrome across admin and debug surfaces.
- MSW handler families eliminate 404 banners in Storybook, enabling visual
  review and future screenshot regression baselines.
- `Bars` viewBox mode enables fluid-width charts in `OverviewSection` and
  future callers.
- No backend, schema, or fetcher changes required.

### Negative

- 8 section rewrites carry per-section `data-testid` migration risk; each
  rewrite required reviewing the existing test to preserve selectors.
- `InstancesSection` minimal pass means it still does not fully match the
  prototype; documented as scope debt.
- `DataTable` row-click ignores clicks on child `<a>`/`<button>` elements; this
  heuristic may miss edge cases in future sections.

### Risks

- `Bars` viewBox change could regress callers that explicitly pass `width`.
  Mitigation: fixed `width` prop behaviour is unchanged; viewBox only activates
  when `width` is omitted.
- MSW handler shapes could drift from server-side responses if fetcher schemas
  evolve. Mitigation: handlers seeded from fetcher expected-response types, not
  hand-crafted.

## Implementation Notes

Key artifacts:

| File                                             | Change                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `client/shared/ui/MetricCard.svelte`             | New primitive (port of prototype `bs-admin-helpers.jsx:23`) |
| `client/shared/ui/DataTable.svelte`              | New primitive (generic dense-row table)                     |
| `client/shared/ui/Bars.svelte`                   | Hardened: undefined data, viewBox, aria-hidden              |
| `client/admin/sections/OverviewSection.svelte`   | Rewrite: 5 MetricCards + Bars + surface-mix panel           |
| `client/admin/sections/StatsSection.svelte`      | Rewrite: 3 sub-panels with MetricCards + DataTable          |
| `client/admin/sections/BillingSection.svelte`    | Rewrite: DataTable + SubjectDetail                          |
| `client/admin/sections/MemosSection.svelte`      | Rewrite: Panel + filter form + memo cards                   |
| `client/admin/sections/RemindersSection.svelte`  | Rewrite: 2 Panel side-by-side                               |
| `client/admin/sections/IdentitiesSection.svelte` | Rewrite: DataTable + filter                                 |
| `client/admin/sections/GroupsSection.svelte`     | Rewrite: DataTable + authorize button                       |
| `client/admin/sections/SystemSection.svelte`     | Rewrite: 2 Panels (credentials + summary)                   |
| `client/admin/sections/InstancesSection.svelte`  | Minimal: Panel wrap + Seg/Btn                               |
| `client/stories/msw/handlers.ts`                 | Added `pluginConfigHandlers` and `instancesHandlers`        |
| `client/stories/msw/scenarios.ts`                | Wired new handler families into admin scenarios             |
| `client/debug/components/TurnsPanel.svelte`      | Rewrite with DataTable (6 columns)                          |
| `client/debug/components/SessionCard.svelte`     | CSS-only line-bleed fix                                     |
| `client/debug/DebugApp.stories.svelte`           | Story rename `populated` → `default`                        |
| `client/shared/TreeView.stories.svelte`          | Padding decorator                                           |

All changes preserve `data-testid` attributes and public component props so
existing tests pass without selector changes. No new tokens introduced; all
styling uses existing CSS custom properties from `client/shared/tokens.css`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — `pluginConfigHandlers` MSW family
  mocks the plugin-config endpoint introduced by this system.
- ADR-0014: Multi-Chat Provider Abstraction — `instancesHandlers` MSW family
  mocks the platform/task instance endpoints from this architecture.
