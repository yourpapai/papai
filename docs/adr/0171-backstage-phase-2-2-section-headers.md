<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0171: Backstage Phase 2.2 — Section Headers

## Status

Implemented

## Date

2026-06-01

## Context

Four `/admin` sections — `StatsPanel`, `SystemSection`, `InstancesSection`, and `PluginConfigSection` — still carried hand-rolled `eyebrow + <h2 data-testid="admin-section-title">` section-header blocks. This is finding B1 from the backstage design audit (spec §7): a duplicated/standalone heading pattern that the Phase 1 `PageHeader` primitive (ADR-0169) was built to replace. `SystemSection` was the literal double-title case — an `eyebrow "System"` plus an `<h2>System</h2>` — where the title alone already matches the sidebar label. Phase 1 shipped `PageHeader` with zero consumers; this phase is the first `/admin` adoption of it.

One wrinkle blocked a mechanical swap: the four sections and their tests/scrollspy rely on `data-testid="admin-section-title"` sitting on the `<h2>`, but `PageHeader` rendered its title in a `<div>` with no test id. So adoption required one small, test-driven enhancement to the shared primitive — an optional `titleTestId` prop — before the four section swaps, so the existing contract survives the refactor.

This is pure consumer-side adoption in `client/admin/`; no new kit, no change to section data flow or controls. The existing refresh/Seg controls move verbatim into `PageHeader`'s `action` snippet. The redundant _inner_ headings (`<h3>Platform Instances</h3>` etc.) and the raw `<button>` → `Btn` conversions are explicitly deferred to Phase 2.3/2.4 (B7/B2). Spec: `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§7, finding B1).

## Decision Drivers

- **Eliminate B1 via one shared primitive:** replace the four hand-rolled header blocks with `PageHeader` so the duplicated/standalone heading pattern stops recurring.
- **Preserve the `admin-section-title` contract:** tests and scrollspy key off `data-testid="admin-section-title"`; the refactor must not silently drop it.
- **Fix the literal double-title:** `SystemSection`'s eyebrow + `<h2>` both saying "System" must collapse to a single title matching the sidebar label.
- **Behavior-preserving:** refresh/Seg controls move verbatim into the `action` snippet; no data-flow or control-behavior change.
- **TDD write-hook:** extend each relevant test to assert the new output (Red), then refactor to Green; the `PageHeader` enhancement is test-first too.
- **Stay B1-only:** inner-heading removal and raw-button → `Btn` conversion are scoped to Phase 2.3/2.4 and must not bleed into this phase.

## Considered Options

### Option 1: Add an opt-in `titleTestId` prop to `PageHeader`, then swap all four headers (chosen)

Add `titleTestId?: string` to `PageHeader`, applied as `data-testid={titleTestId}` on the title div (Svelte omits the attribute when `undefined`), then replace each section's `<header>` block with `<PageHeader … titleTestId="admin-section-title">`.

- **Pros:** one shared primitive across all four sections; the test-id contract is preserved through an explicit, opt-in prop; the four swaps become mechanical; `PageHeader` stays generic for non-admin consumers (no test id by default).
- **Cons:** a shared primitive gains one caller-shaped prop; future admin sections must remember to pass `titleTestId` or the test id is silently absent (Svelte omits the attribute rather than failing).

### Option 2: Hardcode `data-testid="admin-section-title"` in `PageHeader`

Bake the admin test id directly into the shared component's title div.

- **Pros:** no new prop; the contract is always present.
- **Cons:** couples a generic `client/shared/ui/` primitive to an admin-specific contract; non-admin consumers (settings/debug) inherit an irrelevant test id; violates the kit's consumer-agnostic design.

### Option 3: Leave headers hand-rolled; only dedupe `SystemSection`'s eyebrow

Keep the `eyebrow + <h2>` markup in three sections and only remove `SystemSection`'s redundant eyebrow.

- **Pros:** smallest diff; no shared-primitive change.
- **Cons:** B1 persists across `StatsPanel`/`InstancesSection`/`PluginConfigSection`; `PageHeader` stays unconsumed in `/admin`; the duplicated header markup keeps diverging.

## Decision

Six tasks, each a TDD refactor (Red → Green) committed separately, plus a verification gate:

1. **`PageHeader` `titleTestId` prop (Task 1).** Add `titleTestId?: string` to `Props` and the destructure, and apply `data-testid={titleTestId}` on the title div in `client/shared/ui/PageHeader.svelte`. Two tests in `tests/client/shared/ui/PageHeader.test.ts` assert the attribute appears when provided and is omitted when absent.
2. **`StatsPanel` → `PageHeader` (Task 2).** Replace the `<header class="stats-panel__header">` block with `<PageHeader eyebrow="Anonymous analytics" title="Stats" titleTestId="admin-section-title">`; the `Seg` window control, `Btn` refresh, and `stats-error` span move into the `action` snippet. The now-unused `.stats-panel__header`/`.stats-panel__controls` style rules are deleted.
3. **`SystemSection` → `PageHeader`, drop eyebrow (Task 3).** Replace the `<header class="system-header">` block with `<PageHeader title="System" titleTestId="admin-section-title">` — **no eyebrow**, collapsing the double-title to a single "System". The raw refresh `<button data-testid="system-refresh">` is kept verbatim in the `action` snippet (its `Btn` conversion is the B2 sweep in Phase 2.4).
4. **`InstancesSection` → `PageHeader` (Task 4).** Replace the `<header class="admin-section-header">` block with `<PageHeader eyebrow="Runtime" title="Instances" titleTestId="admin-section-title">`; the `Btn` refresh moves into `action`. The shared `.admin-section-header` rule in `client/admin/admin.css` is left in place (other code may use it).
5. **`PluginConfigSection` → `PageHeader` (Task 5).** Replace the `<header class="plugin-config-header">` block with `<PageHeader eyebrow="Plugins" title="Plugin Config" titleTestId="admin-section-title">`; the raw refresh `<button data-testid="plugin-config-refresh">` is kept verbatim in `action` (B2 sweep deferred). The inner `<h3>Plugin configuration</h3>` in `PluginConfigForm` is left for Phase 2.4/B7.
6. **Gate (Task 6).** `bun test:client` (incl. `AdminApp`/scrollspy tests querying `admin-section-title`), `bun typecheck`, `bun check:bundle-isolation`, `bun build:client`. No commit — verification only.

## Consequences

### Positive

- All four `/admin` sections now share one header primitive; the B1 duplicated/standalone heading pattern is eliminated.
- The `data-testid="admin-section-title"` contract survives the refactor via the opt-in `titleTestId` prop, so scrollspy and existing tests stay green without touching them.
- `SystemSection`'s literal double-title is fixed — a single "System" title matching the sidebar label.
- Refresh/Seg controls are unchanged in behavior, only relocated into the `action` snippet; no data-flow change.

### Negative

- `PageHeader` gains an admin-contract-shaped prop (`titleTestId`); a generic `client/shared/ui/` primitive now carries a caller-specific test-id hook. Kept opt-in so non-admin consumers are unaffected, but the coupling exists.
- Raw `<button>` refresh controls in `SystemSection`/`PluginConfigSection` remain raw (not `Btn`) — the B2 sweep owns their conversion in Phase 2.4; this phase deliberately does not touch them.
- Inner redundant headings (`<h3>Platform Instances</h3>` under a Panel title, `<h3>Plugin configuration</h3>`) remain — deferred to Phase 2.3 (InstancesSection rewrite) and 2.4 (B7).
- The shared `.admin-section-header` CSS rule is left in `client/admin/admin.css` though `InstancesSection` no longer uses it; it is orphaned until a cleanup pass.

### Risks

- scrollspy and tests keyed on `admin-section-title` rely on every section passing `titleTestId`. A future admin section that forgets the prop silently loses the test id (Svelte omits the attribute) rather than failing loudly — the contract is opt-in, not enforced by the primitive.
- Raw-button refresh controls moved verbatim into `action` retain their existing accessibility/keyboard behavior; this phase does not improve them (B2 owns that), so a reviewer must not read the header swap as a button a11y fix.
- Visual parity depends on `PageHeader`'s flex layout matching the former hand-rolled headers. Tests assert `.ui-page-header` presence and the title text, not pixel parity; visual regressions rely on Storybook preview.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships the `PageHeader` primitive this phase adopts and the `titleTestId` enhancement target.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — the prior `/admin` consumer-adoption phase this continues.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` operator surface these sections live in.
- **ADR-0166: Storybook Harness — PR 1** — the harness and `bun check:bundle-isolation` gate the refactored sections' stories rely on.

## Implementation Notes

Verified present in the codebase (light confirmation, not exhaustive):

| File                                                      | Role                                                                                                                           | Evidence         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `client/shared/ui/PageHeader.svelte`                      | `titleTestId?: string` in `Props` (line 16) and destructure (line 19); `data-testid={titleTestId}` on the title div (line 25). | `grep` confirms. |
| `tests/client/shared/ui/PageHeader.test.ts`               | `titleTestId` present (line 31) and absent (line 39) tests.                                                                    | `grep` confirms. |
| `client/admin/components/StatsPanel.svelte`               | `<PageHeader eyebrow="Anonymous analytics" title="Stats" titleTestId="admin-section-title">` (line 179).                       | `grep` confirms. |
| `client/admin/sections/SystemSection.svelte`              | `<PageHeader title="System" titleTestId="admin-section-title">` (line 51) — no eyebrow, double-title collapsed.                | `grep` confirms. |
| `client/admin/sections/InstancesSection.svelte`           | `<PageHeader eyebrow="Runtime" title="Instances" titleTestId="admin-section-title">` (line 279).                               | `grep` confirms. |
| `client/admin/sections/PluginConfigSection.svelte`        | `<PageHeader eyebrow="Plugins" title="Plugin Config" titleTestId="admin-section-title">` (line 38).                            | `grep` confirms. |
| `tests/client/admin/StatsPanel.test.ts`                   | Asserts `admin-section-title` → "Stats" and `.ui-page-header` present (lines 242–243).                                         | `grep` confirms. |
| `tests/client/admin/sections/SystemSection.test.ts`       | Asserts `admin-section-title` → "System" and `.ui-page-header` present (lines 118–119).                                        | `grep` confirms. |
| `tests/client/admin/sections/InstancesSection.test.ts`    | Asserts `admin-section-title` → "Instances" and `.ui-page-header` present (lines 628–629).                                     | `grep` confirms. |
| `tests/client/admin/sections/PluginConfigSection.test.ts` | Asserts `admin-section-title` → "Plugin Config" and `.ui-page-header` present (lines 31–32).                                   | `grep` confirms. |

Minor path note: `StatsPanel.test.ts` sits flat at `tests/client/admin/` (matching the plan's literal path), while the three section tests mirror their source under `tests/client/admin/sections/` — the repo's test-path-mirrors-source convention. Test content matches the plan. The spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`.
