<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard redesign — `/debug` and `/admin` "Telemetry" aesthetic

**Status:** draft · awaiting user review
**Date:** 2026-05-22
**Branch:** `claude/split-dashboard-admin-zaoys`
**Scope:** UI redesign of the local debug server clients (`client/debug/`, `client/admin/`). Backend changes are minimal (one new read-only `/admin/subjects/:id/recent-requests` endpoint in PR 3). No changes to chat providers, tools, scheduler, or storage.

---

## 1. Background

The branch already split the dashboard into `/debug` (engineer/live observability) and `/admin` (operator/configuration + durable records) at the routing layer, but neither client has had any visual or layout work yet. They share JetBrains Mono and dark-grey hex values but diverge on palette (`#0a0a0a` vs `#0b0d10`), border radius (2px vs 4–8px), and overall density.

The user supplied a set of UI design prototypes in `client/assets/` (33 files, ~3,800 LoC of React JSX + HTML) defining a unified "Telemetry" aesthetic: a refined ops console with mono throughout, near-black canvas, phosphor-green single accent, hairline borders, and no shadows. The prototype is split into a tokens file (`bs-tokens.jsx`), a design-system spec sheet (`bs-design-system.jsx`), and two page assemblies (`bs-debug.jsx`, `bs-admin.jsx`) plus one panel-per-file (~30 panel components).

Crucially, the prototype was designed against the **existing** `GlobalStats` and `SubjectStats` shape. `growthLast30d`, percentile distributions, `surfaceMix`, `activeSubjectCounts`, `storage`, `topTools.successRate`, and per-role `LlmUsageSubjectStats` all already exist server-side. There is no data-shape invention required.

## 2. Goals

1. Adopt the prototype's tokens, primitives, and structural layout across both pages.
2. Keep each PR independently shippable so the dashboard stays usable throughout.
3. Preserve all current functional behavior: SSE on `/debug`, REST + window selector on `/admin`, hash deep-links on `/admin`, CRUD flows on `/admin` sections, anonymity contract on `/stats/*`.

## 3. Non-goals

- New chart library (no D3 / Recharts — SVG `Spark`/`Bars` are the entire visualization layer).
- Light theme. The Telemetry aesthetic is dark-only by design.
- Mobile layouts. Existing partial responsive rules in `admin.css` will not be extended.
- SSE on `/admin`. Stays REST-driven.
- Migrating `bs-scenarios-*.jsx` flows (those describe scenarios outside the current codebase).

## 4. Decisions

| #    | Decision                                                                                                                                                          | Rationale                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **Visual + structural full redesign** (vs. visual-only restyle)                                                                                                   | User-chosen; matches the prototype's intent.                                                                                                                                                                      |
| D-2  | **`/debug` modals collapse into one swappable right rail**                                                                                                        | Prototype puts detail in a persistent rail; modals cause overlap on the dense 3-column layout. Five modal flows (Session/Trace/Log/Turn/Failure) become one `selectedDetail: SelectedDetail` discriminated union. |
| D-3  | **`/admin` becomes single-scroll with scrollspy**                                                                                                                 | Prototype renders all sections at once; sidebar acts as a scrollspy + quick-stats panel. Hash deep-links preserved via `IntersectionObserver` + `history.replaceState`.                                           |
| D-4  | **`/admin` CRUD stays modal**                                                                                                                                     | Restyled `<Modal>` + `<Confirm>`. Inline editors or slide-over drawers would multiply work without clear benefit.                                                                                                 |
| D-5  | **Tokens delivered as CSS custom properties on `:root`**, not a Svelte module                                                                                     | Existing CSS files migrate by find-replace; no Svelte component churn just to adopt the palette.                                                                                                                  |
| D-6  | **Per-section time-window filters removed** in favor of one global `Seg(24h / 7d / 30d / all)` in the top bar                                                     | Matches prototype; `BillingSection`'s window filter is the only one this affects.                                                                                                                                 |
| D-7  | **Billing subject detail moves from modal to inline panel** under the subjects table                                                                              | Matches prototype; avoids modal overlap with the data above.                                                                                                                                                      |
| D-8  | **`MemosSection` non-window filters (user-id text input + status select) preserved** as a per-section filter strip below `SectionHeader`                          | Genuine functional filters, not a time-window. Other sections have no such filters.                                                                                                                               |
| D-9  | **One new backend endpoint** `GET /admin/subjects/:id/recent-requests` (anonymous shape) added in PR 3 to feed the subject-detail panel's "recent requests" table | Single read query; anonymous-by-construction (model + role + tokens + status, no message content). Prototype is incomplete without it.                                                                            |
| D-10 | **`client/assets/` excluded from `oxlint`/`oxfmt`**                                                                                                               | Design references, not production code. Already landed: appended to `.oxlintignore` and `.oxfmtignore`.                                                                                                           |
| D-11 | **Token-first cascade (Approach A)**, four independently shippable PRs                                                                                            | Smallest reviewable diffs; every intermediate state is shippable.                                                                                                                                                 |

## 5. Tokens (PR 1)

A single new file `client/shared/tokens.css` declares the prototype's `T` object as CSS custom properties on `:root`. Both `admin.html` and `debug.html` import it before anything else.

```css
:root {
  --bg: #0b0e10;
  --surface: #14181b;
  --raised: #1a1f23;
  --inset: #0e1214;
  --hair: #1f262a;
  --border: #2a3338;
  --strong: #3a464d;
  --fg: #e6ebee;
  --fg2: #9aa5ac;
  --fg3: #5e6970;
  --fg4: #3a4248;
  --accent: #5dd97a;
  --accent-soft: rgba(93, 217, 122, 0.1);
  --accent-dim: rgba(93, 217, 122, 0.55);
  --warn: #e5a93a;
  --warn-soft: rgba(229, 169, 58, 0.1);
  --danger: #e85c5c;
  --danger-soft: rgba(232, 92, 92, 0.1);
  --info: #6cb6ff;
  --info-soft: rgba(108, 182, 255, 0.1);
  --font-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  --s7: 32px;
}
```

`base.css`, `admin.css`, and `debug.css` migrate their hex values to `var(--…)` — no Svelte component touched in PR 1.

## 6. Primitives (PR 1)

New directory `client/shared/ui/`. One file per primitive, each a thin Svelte 5 component using runes (`$props()`, no internal state).

| File             | API                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `Panel.svelte`   | Caps title, optional count, `action` slot, `dense` and `flat` variants. Body via default `<slot>`.           |
| `Pill.svelte`    | `tone: 'accent' \| 'warn' \| 'danger' \| 'info' \| 'neutral' \| 'mute'`, optional `dot` with glow on accent. |
| `Btn.svelte`     | `variant: 'primary' \| 'secondary' \| 'outline' \| 'ghost' \| 'danger'`; `size: 'sm' \| 'md' \| 'lg'`.       |
| `Input.svelte`   | Prefix slot for `⌕` glyph; flat 2px radius, raised background.                                               |
| `Select.svelte`  | Display-only chevron control; real `<select>` underneath for a11y.                                           |
| `Seg.svelte`     | Controlled segmented buttons; `value` + `onChange`.                                                          |
| `KV.svelte`      | Key left (fg3), value right (fg, right-aligned, ellipsis).                                                   |
| `Dot.svelte`     | 6px round, optional glow.                                                                                    |
| `Spark.svelte`   | SVG sparkline; `data: number[]`, `width`, `height`, `color`, `fill`.                                         |
| `Bars.svelte`    | SVG bars; same data shape.                                                                                   |
| `Caption.svelte` | Caps caption (10–11px, 0.08–0.10em tracking, fg3).                                                           |
| `HR.svelte`      | Hairline rule; `dashed` optional.                                                                            |
| `Shell.svelte`   | Page shell: top bar slot + content area.                                                                     |
| `TopBar.svelte`  | Brand `papai ::page`, `statusRow` slot, optional `secondaryRow` slot.                                        |

`Modal.svelte`, `Confirm.svelte`, `PanelShell.svelte`, `PropertiesTable.svelte`, `StatusDot.svelte`, `TreeView.svelte` keep their APIs; only their CSS is rewritten against the tokens (no shadow, hairline border, 2px radius).

Each primitive ships with a smoke test under `tests/client/shared/ui/<Primitive>.test.ts` (happy-dom). No new dev dependencies.

## 7. `/debug` shell + right rail (PR 2)

### Layout

Three-column grid:

```
┌─────────────────────────────────────────────────────────────────────┐
│ TopBar  papai ::debug   [connected] uptime msgs llm tools   /admin→ │
│ Secondary  scheduler · pollers · cache · ─── Seg(all|dm|group)      │
├──────────┬──────────────────────────────────────────────┬───────────┤
│ Sessions │ Turns                                        │ TurnDetail │
│ Traces   │ ┌───────────────┬───────────────┐            │  (or Trace/│
│          │ │ Notifications │ Failures      │            │   Log/etc) │
│          │ └───────────────┴───────────────┘            ├───────────┤
│          │ Logs                                         │ Context    │
└──────────┴──────────────────────────────────────────────┴───────────┘
   260px                       1fr                            380px
```

CSS: `grid-template-columns: 260px minmax(0, 1fr) 380px; grid-template-rows: auto 1fr;`. Left and right rails span both rows.

### Right-rail state machine

Five separate state cells and five `<Modal>` blocks collapse into one cell and one `<DebugDetailRail>`:

```ts
type SelectedDetail =
  | { kind: 'turn'; payload: Turn }
  | { kind: 'trace'; payload: LlmTrace }
  | { kind: 'session'; payload: { userId: string; session: Session } }
  | { kind: 'log'; payload: { entry: LogEntry; index: number } }
  | { kind: 'failure'; payload: ToolFailure }
  | null
```

`DebugDetailRail.svelte` pattern-matches on `kind` and embeds the existing detail components (`TurnDetail`, `TraceDetail`, `SessionDetail`, `LogDetail`, `FailureDetail`) — they are reused as-is, no internal changes. Header is a caps caption + entity id + `✕` ghost button to clear. Empty state when `null`. `LiveContextCard` (identities, config editors, groups, cache) is always visible underneath.

### Top bar

`DebugTopBar.svelte` composes `<Shell><TopBar>`:

- Brand: `papai ::debug` (`::debug` in `--accent`).
- Status row: `Pill[connected]`, uptime, msgs, llm count, tools count, divider, `Btn[/admin →]`.
- Secondary row: scheduler pill, poller pills, msg-cache count, spacer, `Seg(all|dm|group)` filter writing to `dashboard.scopeFilter`.

### Removed

- Five `<Modal>` blocks at the bottom of `DebugApp.svelte`.
- Five separate `selected*` cells.

### Kept

- `setupEventSource(dashboard, …)` and `dashboard.*` state shape.
- All existing detail component internals.
- `<Modal>` and `<Confirm>` (used by other code paths and PR 4 polish).

### Tests

- New `tests/client/debug/DebugDetailRail.test.ts` covering each `kind` rendering.
- Existing per-detail-component tests stay green.

## 8. `/admin` shell + scrollspy (PR 3)

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ TopBar  papai ::admin   [configured] admin dl@papai      ← /debug   │
│ Secondary  window Seg(24h|7d|30d|all)  ──── last refreshed · refresh│
├──────────┬──────────────────────────────────────────────────────────┤
│ Sidebar  │ ▸ OVERVIEW                                               │
│ overview │   [KPI · KPI · KPI · KPI]                                │
│ billing  │   [Growth sparkline 2fr] [Surface mix 1fr]               │
│ stats    │ ▸ BILLING                                                │
│ memos    │   BillingTable                                           │
│ reminders│   [Subject detail 1.4fr] [Tool calls 1fr]                │
│ identity │ ▸ STATS                                                  │
│ groups   │   [ActiveSubjects] [Storage]                             │
│ creds    │   [Distributions span-2]                                 │
│ ──────── │ ▸ MEMOS / RECURRING / DEFERRED                           │
│ QuickStats   [Memos 1.2fr] [Recurring + Deferred stack 1fr]         │
│ DM:32    │ ▸ ACCESS & IDENTITY                                      │
│ Grp:4    │   [Identity] [Groups]                                    │
│ Act24:4  │ ▸ LLM CREDENTIALS                                        │
│ Act7d:7  │   CredentialsForm                                        │
│ 284 MB   │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
   180px                          1fr
```

### Sidebar

`AdminSidebarPanel.svelte` replaces `NavSidebar.svelte`. Top: caps section list with counts (`memos · 32`, `reminders · 7`). Bottom: `<KV>` rows for quick-stats (`DM subjects`, `Groups`, `Active 24h` in accent, `Active 7d`, `Storage`) — sourced from `adminGlobals.data`.

### Scrollspy

`useScrollSpy(sectionIds)` in `admin.svelte.ts`:

- One `IntersectionObserver` on each `<section id="overview|billing|stats|memos|reminders|identities|groups|system">` anchor with `rootMargin: '-30% 0px -60% 0px'`.
- Active id writes to `adminState.currentSection` and to `window.location.hash` via `history.replaceState` (no jump).
- Page-load reads `window.location.hash` and `scrollIntoView({ behavior: 'instant' })`s; defaults to `#overview` if absent.
- Sidebar links are plain `<a href="#section-id">`; the browser handles scroll, the observer updates state.

### Sections

| Section                                                  | Behavior                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `OverviewSection` (new)                                  | KPI cards (subjects · llm calls · tools · tokens) + growth `Spark` (`growthLast30d`) + `Bars` surface-mix. Reads `adminGlobals`.                |
| `BillingSection`                                         | Subjects table → click → inline `AdminSubjectDetailPanel` + `AdminToolCallsPanel` below. Modal removed. Per-section time-window filter removed. |
| `StatsSection`                                           | Active subjects + storage + distributions (p50/p90/p99). Reads `adminGlobals`.                                                                  |
| `MemosSection`                                           | Per-section filter strip (user-id text input + status select) kept. CRUD modals restyled.                                                       |
| `RemindersSection`, `IdentitiesSection`, `GroupsSection` | Same shape as today, restyled, modals kept.                                                                                                     |
| `SystemSection` (credentials)                            | Form unchanged; restyled. Inline header note `POST /admin/llm requires DEBUG_TOKEN`.                                                            |

### Global window selector

Top-bar `Seg(24h|7d|30d|all)` writes to `adminState.window: StatsWindow`. Subscribers (`OverviewSection`, `StatsSection`, `BillingSection`) use `$derived` and refetch on change. Non-window sections ignore it.

### Per-section lazy fetch

`MemosSection`, `RemindersSection`, `IdentitiesSection`, `GroupsSection` each register a one-shot `IntersectionObserver` in `onMount` that triggers their initial fetch only when first scrolled into view. After that they refresh on `refresh all`.

### Backend change (PR 3)

`GET /admin/subjects/:id/recent-requests`:

- Returns N most-recent rows from `llm_usage_events` filtered by `storage_context_id`.
- Anonymous shape: `{ ts, modelLabel, role, inputTokens, outputTokens, finishStatus }[]`. No message text, no prompt content. Same anonymity contract as `/stats/*`.
- Bearer-token gated when `DEBUG_TOKEN` is set; read-only without it (consistent with other read routes).
- Zod schema in `src/debug/schemas.ts`. Route in `src/debug/admin-system.ts`. Unit test under `tests/debug/admin-system.test.ts`.

### Tests

- `tests/client/admin/scrollspy.test.ts` mocking `IntersectionObserver`.
- `tests/debug/admin-system.recent-requests.test.ts` for the new endpoint.
- Existing per-section tests stay green.

## 9. Data plumbing (PR 3 supporting work)

`client/admin/global-stats.svelte.ts`:

```ts
export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
})

export async function refreshGlobals(): Promise<void> {
  // GET /stats/global?window=<window>, validate via Zod, write data + fetchedAt
}
```

Owners:

- `OverviewSection`, `StatsSection`, sidebar `QuickStats`, top-bar `last refreshed` field → all subscribe.
- Top-bar `Seg(window)` change → writes `adminGlobals.window` → triggers `refreshGlobals()`.
- Top-bar `refresh all` button → calls `refreshGlobals()` + each section's optional `refresh()`.

## 10. Polish (PR 4)

- `Spark` wired to `globalStats.subjects.growthLast30d`.
- `Bars` wired to `globalStats.toolMix.topTools` (with success-rate as the bar height multiplier).
- KPI cards finalized with sub-labels (`892 main · 197 small`, `4,184 ok · 206 fail`, etc.).
- Restyle CRUD modals (Add Memo, Add Recurring, etc.) to the new tokens.
- Dead-code removal: old `admin-section-header`, `admin-filter-form`, `admin-key-value-list` CSS classes if unused.
- Screenshot pairs in the PR description for each section.

## 11. PR sequence summary

| PR                                                   | Touches                                                                                                                                                                                                                                                    | Visible change                                                                                  | Test gate                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **1 · Tokens + primitives**                          | `client/shared/tokens.css` (new), `client/shared/ui/*` (new, 14 files), `Modal.svelte`/`Confirm.svelte` restyle, `base.css`/`admin.css`/`debug.css` hex → `var(--…)`                                                                                       | Subtle palette shift; no layout change                                                          | `bun test:client` + primitive smoke tests                                |
| **2 · `/debug` shell + right rail**                  | `DebugApp.svelte`, `dashboard-types.ts` (`SelectedDetail` union), `DebugDetailRail.svelte` (new), `DebugTopBar.svelte` (new), `debug.css` grid rules                                                                                                       | Modals gone, 3-column with right rail, scope-filter Seg                                         | `tests/client/debug/DebugDetailRail.test.ts` + existing detail tests     |
| **3 · `/admin` shell + scrollspy + recent-requests** | `AdminApp.svelte`, `admin.svelte.ts` (`useScrollSpy`), `AdminSidebarPanel.svelte` (new), `OverviewSection.svelte` (new), `BillingSection.svelte` (inline subject detail), `global-stats.svelte.ts` (new), `src/debug/admin-system.ts` (route + Zod + test) | Single-scroll admin, global window selector, sidebar quick-stats, billing subject detail inline | `tests/client/admin/scrollspy.test.ts` + recent-requests route unit test |
| **4 · Polish & widget fill-in**                      | `Spark`/`Bars` wired to real data, KPI cards, restyled CRUD modals, dead-code removal                                                                                                                                                                      | Live charts, polished modals                                                                    | screenshot review                                                        |

## 12. Risks

| Risk                                                         | Mitigation                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seven simultaneous fetches on `/admin` first paint           | Shared `adminGlobals` store (1 request for Overview + Billing + Stats); `IntersectionObserver` lazy-fetch for Memos/Reminders/Identity/Groups. Worst case: 2 requests on initial load. |
| `SelectedDetail` union grows over time                       | Intentional extension point; discriminated union documented in `dashboard-types.ts`.                                                                                                   |
| Token-only PR 1 looks like a no-op in review                 | Screenshot pairs in PR description; smoke tests gate.                                                                                                                                  |
| Removing per-section time-window filters loses functionality | Only `BillingSection` had one. The global Seg subsumes it. Memos's user-id + status filter is preserved.                                                                               |
| Billing modal → inline reduces vertical density              | Acceptable: the page is already single-scroll; the inline panel reads better than a popped modal.                                                                                      |

## 13. Open questions

None. All cleared during brainstorming.

## 14. Out of scope

- New chart library.
- Light theme.
- Mobile layouts.
- SSE on `/admin`.
- Restyling `/debug` SSE wire format or the event bus.
- `bs-scenarios-data.jsx` / `bs-scenarios-admin-data.jsx` flows.
