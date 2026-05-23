<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0121: Debug/Admin Surface Split and Dashboard Redesign

## Status

Implemented (with noted deviations)

## Date

2026-05-21 – 2026-05-23

## Context

The debug server originally served a single client at `/dashboard` (redirected
from the old `/debug` path). As the operator surface grew — LLM credentials,
billing, anonymous stats, per-subject request logs — the single-page design
became unsatisfying: engineer-facing live observability (turn stream, tool
failures, notification backlog) was mixed with operator-facing configuration and
durable records (credentials form, billing table, global stats).

Two audiences have different security postures. The engineer surface is
read-only and appropriate to leave ungated on an internal network. The operator
surface must be write-protected (`POST /admin/llm` returns 401 when
`DEBUG_TOKEN` is unset). Merging them in a single UI forces a binary
gating choice that fits neither audience well.

Additionally, the existing client was built with vanilla DOM manipulation and
ad-hoc CSS. The codebase had accumulated layout inconsistencies, no shared
token system, and copy-paste duplication between the two nascent surfaces. A
redesign to Svelte 5 runes with a shared primitive library was needed before
the operator surface could grow without accumulating further design debt.

Design captured in `docs/archive/2026-05-21-dashboard-admin-split-design.md`
and `docs/archive/2026-05-22-dashboard-redesign-design.md`. Implementation
plans in `docs/archive/2026-05-21-dashboard-admin-split-plan.md`,
`docs/archive/2026-05-22-dashboard-redesign-pr1-tokens-primitives.md`,
`docs/archive/2026-05-22-dashboard-redesign-pr2-debug-shell.md`,
`docs/archive/2026-05-22-dashboard-redesign-pr3-admin-shell.md`,
`docs/archive/2026-05-22-dashboard-redesign-pr4-polish.md`.

## Decision Drivers

- **Audience separation**: Engineer observability (`/debug`) and operator
  configuration (`/admin`) must be navigable and securable independently.
- **301 backward compatibility**: `/dashboard` is referenced in CLAUDE.md and
  internal tooling; a redirect preserves those references without a flag day.
- **Shared token system**: A single `:root`-scoped CSS custom-property file
  (`client/shared/tokens.css`) must be the sole source of spacing, color, and
  typography values across both clients.
- **Reusable primitives**: Frequently composed elements (KV pair, pill, button,
  panel, sparkline, bar chart, shell chrome) must live in `client/shared/ui/`
  so neither client owns what both need.
- **Svelte 5 runes only**: New client code must use `$state`, `$derived`,
  `$effect`, and `$props`; no legacy options API or writable stores.
- **Scrollspy admin navigation**: The admin shell must use a single scrolling
  `<main>` with a sticky `AdminSidebarPanel` driven by `IntersectionObserver`
  so that deep-linking to a section (e.g. `#billing`) and keyboard navigation
  require no JavaScript routing.
- **Anonymous stats contract enforced at the data layer**: `/stats/global` and
  `/stats/subject/:id` must return counts, sizes, timestamps, and
  keyed-hash distributions only. Any content leak is a release-blocking defect
  (established in ADR-0120; this ADR extends the enforcement to the client
  schema).

## Considered Options

### URL routing: separate origin vs separate path

#### Option 1: Separate origins (`debug.example.com`, `admin.example.com`)

- **Pros**: Hard security boundary at TLS/DNS level; no accidental cross-link.
- **Cons**: Requires operator DNS config; breaks `bun start:debug` single-port
  simplicity; overkill for an internal-only surface.

**Rejected.** The debug server is an opt-in internal tool, not a public service.
Path-level separation with bearer-token gating on write routes is sufficient.

#### Option 2: Single SPA with role-based view switching

- **Pros**: One bundle, one origin.
- **Cons**: Couples engineer and operator concerns; cannot gate one surface
  without gating the other; URL does not communicate audience.

**Rejected.** The audiences have different workflows and different security
requirements. Co-location in a single view does not serve either well.

#### Option 3 (chosen): `/debug` and `/admin` as separate Svelte apps, `/dashboard` → 301

Both clients are compiled independently (`client/debug/` and `client/admin/`),
served at their own paths, and linked to each other via a nav affordance. The
legacy `/dashboard` path issues a 301 to `/debug`.

### Component API: Svelte snippets vs. direct string props for display primitives

#### Option 1: Snippet props (`{#snippet k()}…{/snippet}`)

Aligns with the Svelte 5 pattern for composable slot replacements; allows
arbitrary content in label and value positions.

- **Pros**: Maximum flexibility; arbitrary markup in key/value positions.
- **Cons**: Verbose for the primary use case (string label + string/number
  value); snippet syntax adds ceremony to every callsite; harder to test
  with `@testing-library`.

#### Option 2 (chosen): Direct string props (`k: string`, `v: string | number`, `sub?: string`)

The `KV` primitive is exclusively used for read-only label/value display. No
callsite ever needs arbitrary markup in the key or value position. The
`sub` optional prop (added in PR4) handles sub-labels without requiring
a separate snippet.

- **Pros**: Concise callsites; straightforward property testing; sub-labels
  handled by a single optional prop rather than a third snippet.
- **Cons**: Cannot render arbitrary markup inside key or value without
  extending the prop surface.

**Chosen.** The plan was originally written assuming snippet props; during
implementation direct props were adopted instead. The plan was resynced to
match the code (see Drift Log in the PR3 plan, decision: code wins).

### Admin navigation: modal-driven vs. scroll-anchored sections

#### Option 1: Per-section modals (prior implementation)

Each admin section opened a modal for per-subject detail. Section transitions
were controlled by JavaScript routing.

- **Pros**: Familiar SPA pattern.
- **Cons**: Modal state is not URL-addressable; back-button breaks navigation;
  modals for CRUD forms add a stacking context that conflicts with sticky
  headers.

#### Option 2 (chosen): Single scrolling `<main>` with scrollspy sidebar

All sections are always in the DOM under one `<main>`. The sticky
`AdminSidebarPanel` tracks the visible section via `IntersectionObserver`
(`scrollspy.ts`). Deep-linking uses the fragment identifier (`#billing`,
`#stats`, etc.).

- **Pros**: URL-addressable sections; no JS routing; works without JavaScript
  for initial render; sidebar state is derived, not managed.
- **Cons**: All sections are mounted on load (mitigated by lazy-fetch
  `IntersectionObserver` that fires the initial data fetch only when a section
  scrolls into view).

### Stats window contract: `'24h'` vs `'1d'`

The initial plan used `'24h'` as the shortest window token. The server
`/stats/global` route accepts `'1d' | '7d' | '30d' | 'all'`. During
implementation the client was aligned to the server contract (`'1d'`). The
plan was resynced; the `AdminTopBar` `Seg` options and `StatsWindow` type
reflect the server-authoritative values.

## Decision

1. **Split `/debug` and `/admin` into separate Svelte 5 app bundles** served
   at their respective paths. Issue a 301 from `/dashboard` to `/debug`.
2. **Introduce `client/shared/tokens.css`** as the single token source for
   spacing, color, and typography across both clients. All existing
   client-specific CSS migrated to consume tokens.
3. **Implement 14 shared UI primitives** in `client/shared/ui/`:
   `Dot`, `HR`, `Caption`, `KV`, `Pill`, `Btn`, `Input`, `Select`, `Seg`,
   `Panel`, `Spark`, `Bars`, `Shell`, `TopBar`. Each primitive has a
   corresponding test under `tests/client/shared/ui/`.
4. **`KV` uses direct string props** (`k`, `v`, `sub`, `vColor`, `dim`), not
   Svelte snippets.
5. **`ScopeFilter = 'all' | 'dm' | 'group'`** replaces the prior
   `activeContext: string` in debug shell state (`DashboardState`).
   `SelectedDetail` is a discriminated union (`{ kind: 'turn'; … }` /
   `{ kind: 'none' }`) for right-rail state.
6. **`AdminSidebarPanel` + `scrollspy.ts`** drive the admin shell navigation
   via `IntersectionObserver`. Per-section lazy fetch fires only when the
   section first scrolls into view.
7. **`StatsWindow = '1d' | '7d' | '30d' | 'all'`** (server-authoritative).
   Client schema `GlobalStatsSchema` mirrors the nested `/stats/global`
   response shape (`subjects.dmTotal`, `subjects.groupTotal`,
   `subjects.growthLast30d`, `active`, `storage`, `surfaceMix`, `toolMix`).
8. **`GET /admin/subjects/:id/recent-requests`** returns only the anonymous
   six-field shape `{ ts, modelLabel, role, inputTokens, outputTokens,
finishStatus }`, enforcing the anonymity contract from ADR-0120.

## Consequences

### Positive

- Engineer and operator surfaces are independently navigable and securable.
- `/dashboard` references in documentation and tooling remain valid via 301.
- The shared token and primitive system eliminates per-surface duplication; new
  sections in either client inherit consistent spacing, color, and chrome at
  zero cost.
- Scroll-anchored admin navigation is URL-addressable and requires no JS
  routing layer.
- The client `GlobalStatsSchema` is now structurally aligned with the server
  response; parse failures are caught at the Zod boundary rather than
  silently producing `undefined` in derived values.

### Negative

- All admin sections are mounted on initial load (mitigated by lazy-fetch
  observers, but the DOM nodes exist immediately).
- The 14-primitive library adds surface area to maintain; each primitive now
  needs a test.
- `KV`'s direct-prop API does not support arbitrary markup in key or value
  positions; any future need for rich content requires a prop-surface extension
  or a separate component.

### Risks

- **LLM usage totals on Overview KPIs** (spec example `892 main · 197 small`)
  are not yet wired. The current Overview derives KPIs from the existing
  `/stats/global` shape. Extending to llmUsage totals requires a new
  aggregator in `src/stats/` — tracked in
  `docs/archive/2026-05-23-stats-global-llm-totals.md` (separate plan,
  not part of this ADR).
- **Mobile layout and light theme** (spec §14) are deferred; the current CSS
  grid is desktop-first.

## Implementation Notes

- `client/debug/` → three-column CSS grid: sidebar (scope filter + context
  list), main (turn stream / notification / tool-failure panels), right rail
  (detail panel controlled by `SelectedDetail`).
- `client/admin/` → two-column CSS grid: sticky `AdminSidebarPanel` left,
  scrolling `<main>` right. Section `id` attributes are the scroll-anchor
  targets.
- `scrollspy.ts` exports a factory `useScrollSpy(sectionIds, onChange)` that
  returns `{ start, stop }` for use inside Svelte `$effect` blocks.
- `POST /admin/llm` returns 401 when `DEBUG_TOKEN` is unset; all other
  debug/admin routes are read-only and remain accessible without a token.
- The `KV.sub` prop renders a small-caps sub-label below the value; used for
  growth annotations on Overview KPI cards (e.g. `+3 this month`).

## Deviations from Plan

| Deviation                                                                                                                                                                     | Category             | Resolution                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| `KV` component: plan specified Svelte snippet props; implementation used direct string props                                                                                  | In-plan, divergent   | Code wins — plan resynced (PR3 Drift Log)                                  |
| `OverviewSection` KPI values: plan showed inline data access (`adminGlobals.data?.subjects`); implementation extracts computed intermediates (`subjectsTotal`, `subjectsSub`) | In-plan, divergent   | Code wins — PR4 refinement pattern; named intermediates are authoritative  |
| `feat(stats): add llmUsage to /stats/global` commit not covered by PR1–PR4 plans                                                                                              | Out-of-plan, on-goal | Sidecar plan created: `docs/archive/2026-05-23-stats-global-llm-totals.md` |

## References

- Split design: `docs/archive/2026-05-21-dashboard-admin-split-design.md`
- Redesign spec: `docs/archive/2026-05-22-dashboard-redesign-design.md`
- Conceptual plan: `docs/archive/2026-05-21-dashboard-admin-split-plan.md`
- PR1 (tokens + primitives): `docs/archive/2026-05-22-dashboard-redesign-pr1-tokens-primitives.md`
- PR2 (debug shell): `docs/archive/2026-05-22-dashboard-redesign-pr2-debug-shell.md`
- PR3 (admin shell): `docs/archive/2026-05-22-dashboard-redesign-pr3-admin-shell.md`
- PR4 (polish): `docs/archive/2026-05-22-dashboard-redesign-pr4-polish.md`
- LLM usage totals follow-up: `docs/archive/2026-05-23-stats-global-llm-totals.md`
- Predecessor: ADR-0120 (central LLM credentials, usage telemetry, anonymous stats)
- Predecessor: ADR-0087 (original debug dashboard expansion)
