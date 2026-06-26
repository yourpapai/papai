<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Admin UI — Kit Additions & Audit Fixes

**Date:** 2026-06-01
**Status:** Approved (design); pending implementation plan
**Author:** brainstorming session
**Source material:** `backstage` design canvas artifact — `bs-tokens.jsx`, `bs-design-system.jsx`, `bs-kit-additions.jsx`, `bs-kit-additions-spec.jsx`, `bs-audit.jsx` (React prototypes in the design tool, not shipped code).

## 1. Overview

The `papai · backstage` design canvas defines a "Telemetry" aesthetic design
system and audits the live `/admin` page against it. The audit (`bs-audit.jsx`)
records 18 findings; `bs-kit-additions.jsx` formalizes 13 components plus two
number-formatting helpers that the live page hand-rolled (and broke).

This spec translates that design work into the **actual Svelte codebase**
(`client/`). It covers: (a) porting the missing kit components and helpers into
the shared Svelte kit, and (b) applying the 18 audit fixes across `/admin`,
`/debug`, and the settings UI.

## 2. Critical context — the audit predates current code

The audit and kit-additions are **React prototypes**. The real app is **Svelte**,
and it has already adopted the design system substantially:

- `client/shared/tokens.css` matches the prototype tokens exactly
  (`--bg: #0b0e10`, `--accent: #5dd97a`, JetBrains Mono, 4px spacing scale).
- A Svelte UI kit exists at `client/shared/ui/`: `Bars, Btn, Caption, DataTable,
Dot, HR, Input, KV, MetricCard, Panel, Pill, Seg, Select, Shell, Spark, TopBar`.
- Composite shared components exist at `client/shared/`: `Confirm, Modal,
PanelShell, PropertiesTable, StatusDot, TreeView`.

The audit targeted an **older live deployment** (`papai.drowbridge.uk/admin`).
A verification pass against current code (file:line evidence in §6) found roughly
one-third of the findings already resolved. This spec therefore treats every
finding with an explicit **current status**: `FIXED` items become regression
guards; `BROKEN`/`PARTIAL` items become refactors.

## 3. Goals / Non-goals

### Goals

- Port all 13 missing components + `fmtNum`/`fmtBytes` into the shared Svelte kit,
  matching the prototype API 1:1, each with a Storybook story and a happy-dom test.
- Resolve every still-broken/partial audit finding in `client/admin/`.
- Sweep `/debug` and `client/settings/` for the identical anti-patterns and adopt
  the new components there too (maximum cross-surface consistency).
- Keep regression guards for the already-fixed findings.

### Non-goals

- No new visual design — the prototypes are the canonical visual spec.
- No marketplace/sandbox/runtime changes; this is client-UI-only.
- No forced consolidation of overlapping primitives (e.g. `Stat` vs `MetricCard`,
  `SummaryList` vs `KV`). Overlap is documented, not eliminated (see §4 decisions).
- No server/business-logic changes beyond a **read-only verification** of the
  `/stats/*` aggregation that feeds denominators (§7).

## 4. Decisions (locked during brainstorming)

| #   | Decision           | Choice                                                                                                                                             |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fix scope          | **All 18 findings**, each re-verified against current code.                                                                                        |
| 2   | Component strategy | **Port faithfully** — every prototype component ships as its own Svelte component matching the prototype API, even where a near-equivalent exists. |
| 3   | Surface scope      | **Kit + all surfaces** — `/admin`, `/debug`, and `/settings`.                                                                                      |
| 4   | Execution sequence | **Kit-first, then sweep** (Approach A).                                                                                                            |

## 5. Architecture & layering

Built in strict dependency order:

### Layer 1 — Shared helpers (`client/shared/helpers.ts`)

Add the canonical formatters, ported 1:1:

- `fmtNum(n, dp = 2)` — rounds to ≤`dp` decimals, thousands separators, returns
  `'—'` for null/undefined/empty/non-finite, passes strings through unchanged.
- `fmtBytes(b)` — humanizes bytes (B/KB/MB/GB/TB), **base-1024**.

These replace the three divergent local `formatBytes` implementations in
`StatsPanel.svelte`, `OverviewSection.svelte`, and `SubjectStatsPanel.svelte`.

> **Intentional behavior change to confirm:** two of the three current local
> copies use base-1000. Standardizing on the prototype's base-1024 changes the
> displayed unit thresholds at those two call sites. The plan must call this out
> explicitly and verify the rendered values in those sections.

### Layer 2 — Kit components

13 new Svelte components. Generic primitives go in `client/shared/ui/`; the choice
of `client/shared/ui/` vs `client/shared/` follows the existing split (primitives
in `ui/`, composites in `shared/`). `statusTone()` ships as a helper exported
alongside `StatusPill`. Each component:

- matches the prototype props/behavior 1:1,
- consumes only existing CSS tokens (no new tokens),
- ships with a `.stories.svelte` and a happy-dom unit test mirroring the path
  under `tests/client/` (mandated by the TDD write-hook and `bun test:client`).

### Layer 3 — Surface adoption

Refactor `/admin` sections first (where the findings live), then `/debug` and
`client/settings/` where the identical anti-pattern exists.

## 6. Component inventory (ported 1:1)

| New component | Location    | Prototype API                                      | Fixes           |
| ------------- | ----------- | -------------------------------------------------- | --------------- |
| `PageHeader`  | `shared/ui` | `eyebrow, title, sub, action`                      | B1              |
| `Field`       | `shared/ui` | `label, required, hint`, slot                      | A7, B3          |
| `FormRow`     | `shared/ui` | slot, `action`                                     | A7              |
| `Toolbar`     | `shared/ui` | slot                                               | A7, C3          |
| `Tag`         | `shared/ui` | `tone`: neutral/required/optional/info             | metadata badges |
| `Code`        | `shared/ui` | `truncate, max`, slot                              | B5              |
| `JsonCell`    | `shared/ui` | `value` (string/obj) → key:value chips             | B5              |
| `Secret`      | `shared/ui` | `value, hint`, reveal affordance                   | C2              |
| `EmptyState`  | `shared/ui` | `icon, title, hint, action`                        | empty panels    |
| `Meter`       | `shared/ui` | `label, value, total`, clamp + warn-on-over        | A6 (guard)      |
| `Stat`        | `shared/ui` | `label, value, of`, warn-on-over                   | A5 (guard)      |
| `StatusPill`  | `shared/ui` | `status, dot`; maps via `statusTone()` over `Pill` | B4              |
| `SummaryList` | `shared/ui` | `items[{k, v, pill, vColor}], cols`                | B6              |

Reused as-is: `DataTable` (already matches the prototype), `Panel`, `Pill`, `Btn`,
`Input`, `Select`, `Seg`, `Bars`, `Caption`, `HR`.

Documented overlaps (no consolidation): `Stat` ↔ `MetricCard`; `SummaryList` ↔
`KV`/`PropertiesTable`; `StatusPill` wraps `Pill`.

## 7. Finding → fix mapping (all 18, with verified current status)

### Regression-guard (verified already FIXED in current code)

| ID  | Area                          | Current evidence                                                                                 | Task                                                            |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| A2  | tool-calls chart overflow     | `StatsPanel.svelte` (chart in `.stats-panel__sparkline`, then `DataTable`; `Bars` fluid viewBox) | add/confirm story+test asserting chart and table do not overlap |
| A3  | tool-calls duplicate header   | `StatsPanel.svelte` (single `Panel` + one `DataTable`)                                           | confirm single header in test                                   |
| A5  | active-subjects denominator   | `StatsPanel.svelte` (`totalSubjects = dmTotal + groupTotal`, same source)                        | adopt `Stat` (warn-on-over) as guard                            |
| A6  | surface-mix overflow          | `OverviewSection.svelte` (`Math.min(100, …)`, guarded total)                                     | adopt `Meter` (clamp+warn) as guard                             |
| C1  | zero-height bar rectangle     | `Bars.svelte` (`Math.max(0, …)`, no rect border)                                                 | confirm via story with zero values                              |
| C3  | competing memos load controls | `MemosSection.svelte` (single filter form)                                                       | confirm single control                                          |
| D1  | sidebar casing                | `AdminSidebarPanel.svelte` (consistent Title Case)                                               | no change; documented                                           |

### Refactor (verified STILL BROKEN or PARTIAL)

| ID  | Area                         | Current evidence                                                                                                | Fix                                                                     |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A1  | subjects table alignment     | `SubjectsTable.svelte` raw `<table>`, no right-align/widths                                                     | route through `DataTable` with right-aligned numeric columns + `fmtNum` |
| A4  | float/byte formatting        | `SubjectsTable.svelte` raw ints; 3 divergent `formatBytes`                                                      | apply `fmtNum`; consolidate to shared `fmtBytes`                        |
| A7  | floating Reminders control   | `RemindersSection.svelte` bare header div outside any Panel                                                     | wrap in `Panel` + `Toolbar` + `Field` + `Input`/`Btn`                   |
| B1  | double section titles        | eyebrow + `<h2>` duplicate in `StatsPanel`, `SystemSection`, `InstancesSection`, `PluginConfigSection`          | replace with `PageHeader`                                               |
| B2  | native buttons               | raw `<button>` across Billing/Memos/Reminders/Identities/Groups/Instances/PluginConfig/System/Credentials forms | route through `Btn` (variant per action)                                |
| B3  | raw inputs                   | raw `<input>` across Memos/Reminders/Identities/Instances/Credentials/PluginConfig forms                        | route through `Input`/`Field`                                           |
| B4  | plain-text status            | `MemosSection`, `RemindersSection`, `InstancesSection`, `SubjectDetail`                                         | route through `StatusPill`                                              |
| B5  | raw JSON config cell         | `InstancesSection.svelte:59` `JSON.stringify(config)` in `<td>`                                                 | render with `JsonCell`                                                  |
| B6  | stacked system summary       | `SystemSection.svelte` raw `<dl>` block-stacked                                                                 | render with `SummaryList`                                               |
| B7  | unpanelled plugin config     | `PluginConfigSection`/`PluginConfigForm` no Panel, `<h4>`, bare table                                           | wrap in `Panel` + `PageHeader`; render rows with `DataTable`            |
| C2  | credentials secret/alignment | `CredentialsForm.svelte` inline masking, no column widths                                                       | use `Secret`; align via `DataTable`                                     |

### Data-correctness verification (audit note on A4/A5/A6)

The audit flags that A4/A5/A6 were also server-side aggregation bugs. Client logic
is already corrected, but the spec includes one **read-only** task: confirm the
`/stats/*` aggregation (in `src/stats/`) that feeds denominators returns
distinct-subject bases consistent with the numerators. This is verification only;
any server fix surfaced is recorded as a separate follow-up, not bundled here.

## 8. Testing & verification strategy

- **New components:** each gets `<Name>.stories.svelte` + a happy-dom test under
  `tests/client/...` mirroring the source path. Required by the TDD write-hook
  (Red → Green) and run by `bun test:client`.
- **Bundle isolation:** `bun check:bundle-isolation` must still pass — the
  `client/stories/**` harness must never leak into prod debug/admin/settings bundles.
- **Refactored sections:** update existing `.stories.svelte`; verify renderable
  changes through the preview workflow.
- **Regression guards:** tests/stories asserting the already-fixed behavior
  (clamped meters, right-aligned numerics, single headers).
- **Full gate:** `bun check:full` (lint, typecheck, format, client tests) green
  before each phase merges.

## 9. Phasing (reviewable units)

1. **Phase 1 — Kit + helpers.** Add `fmtNum`/`fmtBytes` to `helpers.ts`; build the
   13 components with stories + tests. No surface changes yet. Replace the 3 local
   `formatBytes` copies with `fmtBytes` (confirm base-1024 behavior change).
2. **Phase 2 — `/admin` adoption.** Apply all refactor findings and regression
   guards across `client/admin/` sections.
3. **Phase 3 — `/debug` + `/settings` sweep.** Adopt the new components where the
   identical anti-pattern exists in `client/debug/` and `client/settings/`.

## 10. Risks & mitigations

- **base-1024 vs base-1000 byte formatting** — visible value shift at two call
  sites. Mitigation: explicit confirmation task + preview verification (§5, §7).
- **Component overlap confusion** (`Stat`/`MetricCard`, `SummaryList`/`KV`) —
  mitigation: doc comment on each new component pointing to its near-equivalent
  and when to use which.
- **Large change surface (all surfaces)** — mitigation: strict phasing; each phase
  independently reviewable and gated by `bun check:full`.
- **TDD write-hook friction** — every new file needs a passing test first.
  Mitigation: author story + test before/with each component (test-driven).
