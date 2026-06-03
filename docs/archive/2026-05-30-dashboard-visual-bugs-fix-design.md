<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Visual Bugs Fix — Design Spec

**Date:** 2026-05-30
**Branch (proposed):** `fix/dashboard-visual-bugs`
**Companion documents:**

- Findings report: [docs/design/dashboard-visual-bugs-2026-05-30.md](../../design/dashboard-visual-bugs-2026-05-30.md)
- Screenshot methodology: [docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md](../../design/dashboard-prototype-vs-storybook-screenshot-plan.md)
- Existing audit: [docs/design/dashboard-ui-audit.md](../../design/dashboard-ui-audit.md)

---

## 1. Problem

Page-level screenshot comparison between the JSX design prototypes in `client/assets/` and the live Svelte implementation served by Storybook (captured 2026-05-30) surfaced 10 findings spanning HIGH / MED / LOW severity. Findings cluster into four classes:

1. **Missing primitives** — the prototype uses a `MetricCard` chrome (uppercase caps label / 26px numeral / sub-line) for every KPI tile; the Svelte side has no equivalent and reaches for `KV` (a 12px key-value row), which is why metrics across `OverviewSection`, `StatsSection`, `BillingSection`, and `IdentitiesSection` look like form labels.
2. **Sections shipping raw HTML** — `OverviewSection` and `StatsSection` render structurally broken; six other admin sections (Billing, Memos, Reminders, Identities, Groups, System) render their forms with browser-default `<select>` / `<button>` instead of `<Seg>` / `<Btn>`, and lack `<Panel>` chrome.
3. **Missing MSW handlers** — `/admin/plugin-config` and `/api/platform-instances` (and friends) return 404 in the AdminApp story, with the literal text `request failed with status 404` visible in screenshots.
4. **Component & story polish** — `TurnsPanel` reduced from a 6-column table to a 3-column row; `SessionCard` line-bleed when nested in DebugApp; `DebugApp` has no `default` story; `TreeView` story has insufficient padding; the existing audit has one outdated claim about `PropertiesTable`.

Together these are blocking the user's next phase of work (e2e + component + screenshot regression testing) — until the page is visually correct, those harnesses would baseline against broken output.

---

## 2. Goal

Make the live Svelte dashboard visually match the JSX prototype at the page level, without changing back-end behaviour or product UX.

Specifically:

- AdminApp `default` story screenshot at 1500×3200 contains zero 404 banners, all 8 sections show `<Panel>` chrome, OverviewSection shows 5 metric cards + bar chart + surface-mix panel, StatsSection has 3 sub-panels with metric cards + distributions table.
- DebugApp `default` story screenshot at 1500×1600 shows TURNS as a 6-column table and SESSIONS rail rows do not visually overlap.
- No `<select>` / `<button>` raw browser-default elements remain in any admin section; all replaced with `<Seg>` / `<Btn>`.
- Storybook a11y addon passes for the rebuilt sections.

Non-goals:

- No new backend endpoints. No schema changes. No new fetcher behaviours.
- No removal of the existing user-id filter UX in Memos / Reminders / Identities (visual restyle only).
- No pixel-diff harness / no screenshot regression tooling — separate workstream after this spec lands.
- No new behaviours in `InstancesSection`; that 445-LOC file gets a minimal wrap-in-Panel pass only.

---

## 3. Approach

Deliver in four sequential PRs, each independently reviewable and revert-friendly. PRs 2 and 3 depend on PR 1's primitives; PR 4 can land in parallel.

| PR  | Theme                                                 | Files touched (approx)                      | Estimate   |
| --- | ----------------------------------------------------- | ------------------------------------------- | ---------- |
| 1   | Primitives (MetricCard, DataTable, Bars hardening)    | 3 new components + 3 stories + 3 tests      | 0.5–1 day  |
| 2   | HIGH section rebuilds + MSW fixtures                  | 8 sections + `handlers.ts` + `scenarios.ts` | 1.5–2 days |
| 3   | Debug fixes (TurnsPanel, SessionCard, DebugApp story) | 3 files                                     | 0.5 day    |
| 4   | Polish (TreeView padding, audit doc, plan doc update) | 2 docs + 1 story decorator                  | <0.5 day   |

Total: ~3–4 working days end-to-end.

Each PR ends with a re-run of the page-level screenshot pass against the prototype counterparts and confirmation that the relevant findings collapse to ✅ in the visual-bugs report.

---

## 4. Architecture

### 4.1 Primitives layer (PR 1)

Three additions to `client/shared/ui/`. Existing primitives (`Panel`, `Shell`, `TopBar`, `Btn`, `Seg`, `Pill`, `Spark`, `KV`) are unchanged.

**`MetricCard.svelte`** — direct port of the prototype's `MetricCard` helper at `client/assets/bs-admin-helpers.jsx:23`. Props:

```ts
interface Props {
  label: string // caps eyebrow text
  value: string | number | Snippet // hero numeral or custom render
  sub?: string // small grey sub-line
  accent?: string // optional value colour (e.g. var(--accent))
}
```

Rendered structure: `<Panel pad={0}>` wrapping a `padding: 14px 16px` body, with:

- 10px caps label (`letter-spacing: 0.10em`, `text-transform: uppercase`, `color: var(--fg3)`)
- 26px value (`font-weight: 600`, `color: accent ?? var(--fg)`, `letter-spacing: -0.02em`, `margin-top: 6px`)
- 11px sub line (`color: var(--fg3)`, `margin-top: 4px`)

No new tokens required — all values map to existing CSS custom properties in `tokens.css`.

**`DataTable.svelte`** — generic dense-row table primitive replacing every ad-hoc `<table class="admin-table">` in `client/admin/sections/`. Props:

```ts
interface Column<Row> {
  key: keyof Row & string
  label: string
  align?: 'left' | 'right' | 'center' // default 'left'
  width?: string // CSS width hint
}
interface Props<Row> {
  columns: Column<Row>[]
  rows: Row[]
  cell?: Snippet<[Row, Column<Row>]> // optional custom cell renderer
  onRowClick?: (row: Row) => void
  selectedKey?: string // highlight matching row id
  empty?: Snippet // empty-state body
}
```

Styling matches prototype's dense table on the design-system page (`bs-design-system.jsx`):

- `th` — 10px caps, `letter-spacing: 0.08em`, `color: var(--fg3)`
- `td` — 13px, `color: var(--fg)`
- Row separator — 1px hairline `var(--hair)`; no zebra
- Selected row — `background: rgba(93, 217, 122, 0.06)` (matches prototype `dl@papai` highlighted row in billing table)
- Optional sticky header (CSS-only, opt-in via `data-sticky`)

**`Bars.svelte` hardening** — current `client/shared/ui/Bars.svelte` is 31 LOC; reasonable. Three changes:

- Accept `data: number[] | undefined`; treat undefined as `[]`.
- Change default `width: 240` to `width: '100%'`; switch SVG to `viewBox` so it scales to its container instead of being fixed-pixel.
- Add `aria-hidden="true"`.

Three new stories cover edge cases used by callers: `[]`, `[5]`, `[0,0,0,0]`, `[1,2,3,4,5,6,7,8]`.

### 4.2 Section rebuilds (PR 2)

Each admin section file is rewritten in place. Public surface (component props, exported types, `data-testid` attributes used by existing tests) is preserved. Fetcher imports and side-effect order are unchanged.

| File                       | New composition                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OverviewSection.svelte`   | `<Panel title="overview" subtitle="30-day window · anonymous aggregates">` → 5 `<MetricCard>` row (subjects / llm calls / tools / tokens / storage), hairline, then 2-col grid: `SUBJECT GROWTH · 30D` panel with `<Bars>` (full-width) + `SURFACE MIX` panel with horizontal progress rows |
| `StatsSection.svelte`      | Three stacked panels: `ACTIVE SUBJECTS` (3 MetricCards), `STORAGE` (2 MetricCards), `DISTRIBUTIONS` (1 `<DataTable>` with N/MIN/P50/P90/P99/MAX/MEAN cols). Window picker + Refresh move into a `<TopBar.statusRow>` Snippet with `<Seg>` + `<Btn>`                                         |
| `BillingSection.svelte`    | `<Panel title="billing" subtitle="usage aggregated from llm_usage_events">` containing `<DataTable>` (subject/id/type/tok in/tok out/llm/tools); row click expands existing `<SubjectDetail>` below, wrapped in its own Panel                                                               |
| `MemosSection.svelte`      | Header eyebrow + title. Filter form into a `<TopBar.statusRow>` Snippet (`<Input>` + `<Seg active/archived>` + `<Btn>`). Body: `<Panel title="memos · active">` with memo cards (author / timestamp / id / body / tag pills) via `{#each}`                                                  |
| `RemindersSection.svelte`  | Two side-by-side `<Panel>`s: `RECURRING TASKS` and `DEFERRED PROMPTS`. Each contains rows styled like the prototype (title / target / next-run / FREQ line / status pill). Shared filter form in a single `<TopBar.statusRow>`                                                              |
| `IdentitiesSection.svelte` | `<Panel title="identity mappings">` with `<DataTable>` (user / provider / login / method / conf). Filter form in TopBar.statusRow                                                                                                                                                           |
| `GroupsSection.svelte`     | `<Panel title="authorized groups">` with `<DataTable>` (label / added / revoke action). `+ authorize` button in panel header right slot                                                                                                                                                     |
| `SystemSection.svelte`     | Two panels: `llm credentials` (existing `<CredentialsForm>` wrapped in Panel) + `system summary` (existing summary data via `<KV>` rows in a Panel)                                                                                                                                         |
| `InstancesSection.svelte`  | **Minimal pass only.** Wrap existing tables in `<Panel>` chrome; replace raw `<select>` / `<button>` with `<Seg>` / `<Btn>`. No further restructuring.                                                                                                                                      |

Behavioural preservation:

- All existing `data-testid` attributes remain on the same logical element (input → input, button → button), so `tests/client/admin/sections/*.test.ts` keep passing without selector changes.
- Filter UX stays as it is today (user-id input + Load button). MSW pre-populates Storybook so the visual catalog matches the prototype.

### 4.3 MSW fixtures (PR 2, same branch)

Two new handler families in `client/stories/msw/handlers.ts`:

- **`pluginConfigHandlers`** — `GET /admin/plugin-config`, `POST /admin/plugin-config`. Variants: `default` (populated list of 3 plugins), `empty` (0 plugins), `error` (500), `slow` (2s delay).
- **`instancesHandlers`** — `GET /api/platform-instances`, `GET /api/task-instances`, `GET /api/admins`, `GET /api/platform-provider-types`, plus `POST/DELETE` success paths. Same four variants.

Both families wired into existing `admin-app-populated`, `admin-app-empty`, `admin-app-error` scenarios in `client/stories/msw/scenarios.ts`. No new scenarios introduced unless a section's story specifically benefits from one.

### 4.4 Debug fixes (PR 3)

- **`TurnsPanel.svelte`** — replace current row layout with `<DataTable>` (PR 1). Columns: `time`, `status` (Pill via custom `cell` snippet), `scope`, `duration` (right-align, ms suffix), `msgs` (right-align), `tools` (pill chips, max 3 with `+N` overflow via custom `cell` snippet). Existing header summary row (`running 1 · error 1 · cancelled 1`) preserved.
- **`SessionCard.svelte`** — CSS-only fix. Diagnose with `preview_inspect` against `debug-debugapp--populated`; expected root cause is missing `padding-bottom` or wrong `line-height` on the card body. Change is constrained to the `<style>` block in this 38-LOC file.
- **`DebugApp.stories.svelte`** — rename `populated` → `default`. One-line story rename.

### 4.5 Polish (PR 4)

- `client/shared/TreeView.stories.svelte` — wrap each story body in a 20px-padded `<div>` decorator.
- `docs/design/dashboard-ui-audit.md` — remove the "PropertiesTable visually broken" claim from § 1.7; reframe the TreeView claim as "story decorator padding missing" rather than "missing `tree-*` CSS classes."
- `docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md` — mark findings 2.1–2.10 as resolved (or link to merge commits).

### 4.6 Optional follow-up (not in scope of these PRs)

`DesignSystem.stories.svelte` — the user surveyed "doesn't matter" on whether to author this. Default: skip. Open the question again only if a later screenshot pass catches token / primitive drift that the per-component stories miss.

---

## 5. Testing strategy

Per-PR test posture:

**PR 1 (Primitives):**

- Each new component has a co-located `.test.ts` under `tests/client/shared/ui/` covering: renders without error with valid props, optional props are handled, edge cases (empty rows, undefined data, single value).
- Each new component has a `.stories.svelte` with at minimum `default` + `empty-edge` + one variant story.
- `bun test:client` passes.

**PR 2 (Section rebuilds):**

- Existing `tests/client/admin/sections/*.test.ts` keep passing without selector changes. Where a selector unavoidably moves, prefer adjusting the test rather than the markup.
- New MSW handler families have light coverage in `tests/client/stories/msw/` (one test per family: `default` variant returns expected shape).
- Re-run page-level screenshot pass against `backstage.html#admin-page` vs `admin-adminapp--default`; confirm findings §2.1–§2.4 resolve.

**PR 3 (Debug fixes):**

- `tests/client/debug/components/TurnsPanel.test.ts` updated to assert 6-column structure.
- Re-run screenshot pass against `debug-page` vs `debug-debugapp--default` (post-rename); confirm §2.5–§2.7 resolve.

**PR 4 (Polish):**

- No tests beyond the existing TreeView story re-screenshot to confirm no clipping.

Cross-cutting:

- `bun check:full` passes on every PR (lint, typecheck, format, knip).
- Storybook a11y addon passes for every rebuilt section.

---

## 6. Risks & open questions

**R1. `data-testid` preservation isn't free.** Each rewritten section needs each `data-testid` carefully kept on the right element. Mitigation: review every existing test before rewriting that section's markup; failing tests block merge.

**R2. MSW handler shape drift.** `/admin/plugin-config` and `/api/platform-instances` may have evolved server-side since the fetcher was last touched. Mitigation: handlers seeded from the fetcher's expected response type (via `client/admin/instance-fetcher-schemas.ts` and `plugin-config-fetcher-schemas.ts`), not from imagination.

**R3. `<Bars>` viewBox change may regress callers that pass fixed `width`.** Mitigation: keep `width` as a prop with the same default (`240`), only switch to viewBox-based scaling when `width` is omitted; existing callers explicitly passing `width={240}` still get the same behaviour.

**R4. `<DataTable>` row-click conflicts with text selection.** Mitigation: only fire `onRowClick` when the click target is a `<td>` (not a child link/button); test in `BillingSection`.

**R5. InstancesSection minimal pass may still look off.** This is acknowledged scope debt; document in the PR description that a full rebuild is a deferred follow-up.

Open:

- Whether `<MetricCard>` should accept a `Snippet` for the value column (e.g. for inline mini-sparklines like the prototype's `TOKENS 2.41M` card with embedded chart). Recommend: yes, accept `Snippet | string | number`. Tracked in PR 1.
- Whether the prototype's `SURFACE MIX` panel deserves its own `<SurfaceMix>` component or stays inline in `OverviewSection`. Default: inline; promote later if reused.

---

## 7. Definition of done

The visual sweep documented in [docs/design/dashboard-visual-bugs-2026-05-30.md](../../design/dashboard-visual-bugs-2026-05-30.md) is re-run after PR 4 lands, and:

- Findings §2.1–§2.4 (HIGH) → ✅
- Findings §2.5–§2.7 (MED) → ✅
- Findings §2.8–§2.10 (LOW) → ✅ for §2.8 and §2.9; §2.10 noted as intentionally deferred.

A screenshot of `admin-adminapp--default` at 1500×3200 placed next to `backstage.html#admin-page` shows no structural deltas (acceptable: timestamp drift, anti-aliasing micro-differences). Same for `debug-debugapp--default` vs `backstage.html#debug-page`.

After acceptance, the next workstream the user named (e2e + component + screenshot regression testing) can baseline against this state.
