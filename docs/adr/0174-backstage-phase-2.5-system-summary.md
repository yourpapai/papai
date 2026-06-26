<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0174: Backstage Phase 2.5 — System Summary

## Status

Implemented

## Date

2026-06-01

## Context

This is the closing `/admin` consumer-side adoption step of the backstage remediation. Phase 1 (ADR-0169) shipped the 13 kit primitives plus `fmtNum`/`fmtBytes`; Phases 2.1–2.4 (ADRs 0170–0173) adopted them across the sections carrying the number/table/guard, header, instances, and forms/status findings. Phase 2.5 closes the single remaining audit finding from `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` §7 — **B6** (stacked system summary): `client/admin/sections/SystemSection.svelte` rendered the four system facts (chat provider, task provider, debug server, admin user) as a block-stacked raw `<dl>` with no row alignment, hairline separators, or status treatment for the boolean/enum values.

The fix is a single consumer-side swap in one file. The `system` data and refresh flow are unchanged; only the `system summary` Panel body markup changes. `SummaryList` (shipped in Phase 1, and itself built on `StatusPill`) supplies the aligned two-column key/value layout with hairline row separators; `pill: true` on an item routes its value through `StatusPill` (`.ui-pill`), giving the task provider, debug server, and admin user values the same colored treatment as the other `/admin` status surfaces fixed in Phase 2.4. The phase depends on Phase 1 (`SummaryList`/`StatusPill`) and Phase 2.2 (the `SystemSection` header is already on `PageHeader`).

With 2.5 done, every `/admin` finding from spec §7 is addressed: A1/A4 (2.1), A2/A3/A5/A6/C1 guards (2.1), B1 (2.2), B2/B3/B4/B5 in Instances (2.3), A7/B2/B3/B4/B7/C2 (2.4), B6 (2.5), D1/C3 already-fixed. The remaining spec scope is **Phase 3** — sweeping `/debug` and `client/settings/` for the same anti-patterns using the kit components now proven in `/admin`.

## Decision Drivers

- **Close the last `/admin` finding (B6)** — Phase 2.5 is the final `/admin` consumer adoption; the stacked `<dl>` is the last kit-bypassing markup in `/admin`.
- **Consumer-only:** rely on the Phase 1 `SummaryList` (and its `StatusPill` dependency); touch no shared primitive this phase.
- **Preserve the `data-testid="system-summary"` contract** that the admin and E2E suites drive the summary by — move it from the `<dl>` to the wrapper `<div>`.
- **Keep `boolLabel` and the loading placeholder flow** — the `system` data and refresh flow are unchanged; only the summary body markup changes.
- **Kit-faithful pill rendering** — `pill: true` routes the value through `StatusPill` (`.ui-pill`), consistent with the other `/admin` status surfaces.
- **TDD Red→Green, scoped commit, verification gate** — one task, one file, gated by `bun test:client`/`bun typecheck`/`bun check:bundle-isolation`/`bun build:client`.

## Considered Options

### Option 1: Adopt `SummaryList` verbatim, move `data-testid` to the wrapper `div` (chosen)

Replace the `<dl data-testid="system-summary">` with a `<div data-testid="system-summary">` wrapping `<SummaryList cols={2} items=[…]>`; flag the three status-style values with `pill: true`.

- **Pros:** no primitive churn (Phase 1 already paid for `SummaryList`/`StatusPill`); the `data-testid="system-summary"` contract survives by moving the testid to the wrapper div; `pill: true` gives task provider/debug server/admin user the same colored treatment as the B4 fixes in Phase 2.4; one-file, independently reviewable.
- **Cons:** the four-row summary was already legible; the swap is a visual consistency win, not a correctness fix — the risk/reward is lower than the Phase 2.1–2.4 refactors.

### Option 2: Keep the `<dl>` and only restyle it (CSS-only fix)

Align the `<dt>`/`<dd>` pairs via CSS grid and color the status values inline, without adopting the kit.

- **Pros:** zero component churn; no new import; the existing `<dl>`/`<dt>`/`<dd>` is semantically correct for a definition list.
- **Cons:** leaves B6 open and the stacked `<dl>` divergent from the kit's aligned-row/hairline-separator pattern that every other `/admin` summary surface now uses; the spec explicitly chose `SummaryList` as the fix; the status values stay plain text instead of colored pills, inconsistent with the B4 fixes in Phase 2.4; re-implements layout `SummaryList` already owns.

### Option 3: Consolidate `SummaryList` into the existing `KV`/`PropertiesTable` composite

Drop `SummaryList` and route the system summary through `KV`/`PropertiesTable` instead of a separate component.

- **Pros:** one fewer overlapping primitive (spec §6 already documents `SummaryList` ↔ `KV`/`PropertiesTable` overlap).
- **Cons:** out of scope — `SummaryList` shipped in Phase 1 (ADR-0169) as its own component to match the prototype API 1:1; consolidating now would re-litigate a Phase 1 decision and touch a shared primitive, violating the consumer-only scope of Phase 2.5.

## Decision

One TDD refactor (Red → Green) in `client/admin/sections/SystemSection.svelte`, plus a verification gate:

1. **`SystemSection` summary → `SummaryList`.** Add `import SummaryList from '../../shared/ui/SummaryList.svelte'`. Replace the `system summary` Panel body's `<dl data-testid="system-summary">` with a `<div data-testid="system-summary">` wrapping `<SummaryList cols={2} items=[…]>`. Four rows: `chat provider` (plain `system.chatProvider`), `task provider` (`system.taskProvider`, `pill: true`), `debug server` (`boolLabel(system.debugServer)`, `pill: true`), `admin user` (`system.adminUserSet ? 'Configured' : 'Missing'`, `pill: true`). The `data-testid="system-summary"` moves from the `<dl>` to the wrapper `<div>` (preserving the contract). `boolLabel` stays in the script (still used). `.system__summary` stays as the padded container; no `<dl>`/`<dt>`/`<dd>` CSS rules existed locally (verified), so none are pruned.
2. **Gate (no commit).** `bun test:client` (all pass, ignoring one unrelated `ECONNREFUSED`), `bun typecheck`, `bun check:bundle-isolation`, `bun build:client`.

Files:

- Modify: `client/admin/sections/SystemSection.svelte` (the `system summary` Panel body; `<style>`).
- Test: `tests/client/admin/sections/SystemSection.test.ts` (extend the Phase 2.2 suite).

## Consequences

### Positive

- B6 is closed; every `/admin` finding from spec §7 is now addressed. The system summary uses the same aligned-row/hairline-separator layout as the rest of the `/admin` kit, and the three status values render as colored pills, consistent with the B4 fixes.
- The `data-testid="system-summary"` contract survives by moving to the wrapper `<div>`; no admin/E2E selector rewrite.
- No primitive churn — `SummaryList` and `StatusPill` are reused from Phase 1. `boolLabel` and the loading placeholder flow are unchanged; the `system` data/refresh flow is untouched.

### Negative

- The summary was already legible; the swap is a consistency win, not a correctness fix — lower value than the Phase 2.1–2.4 refactors.
- `SummaryList` overlaps the existing `KV`/`PropertiesTable` (documented in spec §6, not consolidated), so the codebase now has three near-equivalent KV primitives.
- The `chat provider` value is the only non-pill row; an operator may expect it pill-styled too, but it is a free-form provider name, not a status.

### Risks

- **Visual parity is a human assertion.** The test asserts kit class presence (`.ui-summary`, `.ui-summary__row` count, `.ui-pill` count), not pixel parity; visual regressions rely on Storybook preview.
- **`StatusPill` `statusTone()` fallback.** The three pill-flagged values route through `statusTone()`; an unrecognized value (e.g. an unknown task provider id) renders neutral until the map grows. Covered by `status-tone.test.ts` for the shipped set, but the map is a coordination point.
- **`SummaryList` `items` shape is a coordination point.** The `{k, v, pill?, vColor?}` contract is shared with Phase 1; a future change to the prop shape would break this consumer.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships `SummaryList` (and its `StatusPill` dependency) this phase adopts.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — the first `/admin` consumer-adoption phase.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — put the `SystemSection` header on `PageHeader` this phase's summary body sits under.
- **ADR-0172: Backstage Phase 2.3 — Instances Section** — adopted the kit in the Instances section.
- **ADR-0173: Backstage Phase 2.4 — Forms and Status** — closed the B4 plain-text-status finding this phase's pill rendering is consistent with.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` operator surface this section lives in.
- **ADR-0166: Storybook Harness — PR 1** — the harness and `bun check:bundle-isolation` gate the verification relies on.

## Implementation Notes

Verified present in the codebase (light confirmation, not exhaustive):

| File                                                | Role                                                                                                                                                                                                                                                                            | Evidence         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `client/admin/sections/SystemSection.svelte`        | Imports `SummaryList` from `../../shared/ui/SummaryList.svelte` (line 12); `<div data-testid="system-summary">` wrapping `<SummaryList cols={2} items=[…]>` with four rows, three `pill: true` (lines 72–81). No `<dl data-testid="system-summary">`.                           | `grep` confirms. |
| `tests/client/admin/sections/SystemSection.test.ts` | Test `'renders the system summary via SummaryList with aligned rows and pills (B6)'` asserts `.ui-summary` present, 4 `.ui-summary__row`, exactly 3 `.ui-pill` inside `[data-testid="system-summary"]`, and the old `dl[data-testid="system-summary"]` is null (lines 125–138). | `grep` confirms. |

Minor spec-vs-plan notes:

- The plan's Task 1 listed the test path as `tests/client/admin/SystemSection.test.ts`, but the actual file lives at `tests/client/admin/sections/SystemSection.test.ts` (mirroring the `sections/` source path). The implementation follows the mirroring convention.
- The plan's Step 1 test snippet asserted the pill with `not.toBeNull()` (≥1 pill); the shipped test asserts **exactly 3** pills (task provider, debug server, admin user), strengthening the contract. `chat provider` is intentionally not pill-flagged.
- The plan's Step 1 referenced a `mock.module('../../../client/admin/fetchers.js', …)` setup; the actual test reuses the file's existing `installReadFetch()`/`render()`/`drain()`/`unmount()` harness from Phase 2.2.

The spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`; only the plan was archived.
