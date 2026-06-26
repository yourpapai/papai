<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0172: Backstage Phase 2.3 — Instances Section

## Status

Implemented

## Date

2026-06-01

## Context

`client/admin/sections/InstancesSection.svelte` was the most severe offender in the backstage design audit (`docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md`, §7). It carried all four of the section's outstanding findings: **B2** (raw native `<button>` for create/apply/status/delete/remove), **B3** (raw `<input>`/`<select>` for the id, type, config, and admin form fields), **B4** (plain-text status cells for platform and task instance status), and **B5** (a raw `JSON.stringify(config)` cell rendered straight into a `<td>`). Phase 1 (ADR-0169) shipped the kit primitives this section needed — `Btn`, `Input`, `Select`, `Field`, `StatusPill`, `JsonCell` — and Phase 2.2 (ADR-0171) already put the section's header on `PageHeader`. This phase is the full markup rewrite of the three Panel bodies (platform instances, task instances, admins) onto the kit, closing B2/B3/B4/B5 in one section.

Two contracts blocked a mechanical swap. First, the section's tests and E2E target `data-testid`s like `platform-id-input`, `platform-create-button`, `platform-status-<id>`, `platform-delete-<id>`, `admin-user-id-input`, but the raw kit primitives (`Btn`, `Input`, `Select`) did not pass through a `testid`. Second, the platform/task `instanceConfigSchema` marks some config fields `sensitive` (tokens, secrets), but the kit `Input` only accepted `'text' | 'search'`. So adoption required three small, test-driven enhancements to shared primitives — `Btn`, `Input`, `Select` gain an optional `testid` pass-through; `Input` gains a `'password'` type — before the section rewrite could preserve both contracts.

The "Apply changes" control that lived in a `.instances-subheader` div moves into the Panel `action` snippet (`Panel` supports `action`, as in `MemosSection`). The redundant inner `<h3>` headings ("Platform Instances", "Task Instances", "Admins") are dropped — the Panel title already names each table. Script logic (fetchers, `$effect`s, `createPlatform`, `updatePlatformStatus`, `removePlatform`, `applyPlatforms`, `createTask`, `removeTask`, `addAdmin`, `removeAdmin`, `confirmDestructive`, `fieldStorageKey`) is unchanged; only the `configLabel` helper (`JSON.stringify(config)`) is removed, replaced by `JsonCell`.

## Decision Drivers

- **Eliminate B2/B3/B4/B5 in the worst offender:** bring `InstancesSection` fully onto the kit so the raw-button/raw-input/plain-status/raw-JSON anti-patterns stop recurring in the most complex admin section.
- **Preserve the `data-testid` contract:** tests and E2E drive the forms by `platform-id-input`, `platform-create-button`, `platform-status-<id>`, `admin-*`, etc.; the refactor must not silently drop them.
- **Preserve the sensitive-field contract:** config schema fields marked `sensitive` must render as password inputs, not clear text.
- **Behavior-preserving:** fetchers, `$effect`s, create/delete/apply handlers, and `fieldStorageKey` are untouched; only rendering changes.
- **TDD write-hook:** extend each test to assert the new output (Red), then refactor to Green; the three primitive enhancements are test-first too.
- **Kit stays generic:** `testid` and `password` are opt-in props on shared primitives, not admin-coupled, so Phase 3 (`/debug` + `/settings`) can reuse them.

## Considered Options

### Option 1: Add opt-in `testid` to `Btn`/`Input`/`Select` + `password` to `Input`, then rewrite the three Panel bodies (chosen)

Add `testid?: string` to the three primitives' `Props` (applied as `data-testid={testid}`; Svelte omits the attribute when `undefined`) and extend `Input`'s `type` union to `'text' | 'search' | 'password'`, then rewrite all three Panel bodies onto the kit.

- **Pros:** shared primitives stay generic and reusable (`/debug` and `/settings` inherit `testid`/`password` for free); the test-id and sensitive-field contracts survive via explicit opt-in props; the section rewrite is mechanical once primitives are ready; one phase closes B2/B3/B4/B5 together.
- **Cons:** three shared primitives gain caller-shaped props and one gains a new type — the kit surface grows; a future consumer that forgets `testid` silently loses the attribute (Svelte omits `undefined`) rather than failing loudly.

### Option 2: Bake admin test-ids into local wrapper components in `client/admin/`

Wrap the kit primitives in admin-local components that hardcode the `data-testid`s, leaving the shared primitives untouched.

- **Pros:** no shared-primitive change; the test-id contract lives entirely in `client/admin/`.
- **Cons:** duplicates the kit locally; `/debug` and `/settings` cannot reuse the `testid` pass-through for the Phase 3 sweep; violates the kit's consumer-agnostic design; the `password` type still needs an `Input` change regardless, so the primitive edit is not avoided.

### Option 3: Adopt the kit components but drop the `data-testid` contract

Rewrite the Panel bodies onto `Btn`/`Input`/`Select`/`StatusPill`/`JsonCell` without forwarding test-ids, and rewrite the tests/E2E to query by text/role instead.

- **Pros:** smallest primitive diff; no `testid` prop anywhere.
- **Cons:** breaks every test and E2E that drives the instances form by `data-testid` (`platform-id-input`, `platform-create-button`, `platform-status-<id>`, `platform-delete-<id>`, `admin-user-id-input`, `admin-platform-id-input`, …); the contract is load-bearing for the admin test suite, and text/role queries are far more brittle across the three forms.

## Decision

Five tasks, each a TDD refactor (Red → Green) committed separately, plus a verification gate:

1. **`Btn` — optional `testid` pass-through (Task 1).** Add `testid?: string` to `Props` and the destructure, and apply `data-testid={testid}` on the `<button>` in `client/shared/ui/Btn.svelte`. The test in `tests/client/shared/ui/Btn.test.ts` asserts the attribute forwards to a `BUTTON` element.
2. **`Input` — `password` type + optional `testid` (Task 2).** Extend the `type` union to `'text' | 'search' | 'password'`; add `testid?: string`; apply both on the `<input>` in `client/shared/ui/Input.svelte`. Two tests assert the `password` type renders, the `testid` forwards, and `onInput` emits the new value.
3. **`Select` — optional `testid` pass-through (Task 3).** Add `testid?: string` to `Props` and the destructure, and apply `data-testid={testid}` on the `<select>` in `client/shared/ui/Select.svelte`. The test asserts `testid` forwards and `onChange` emits.
4. **`InstancesSection` markup rewrite (Task 4).** Imports gain `Field`, `Input`, `JsonCell`, `Select`, `StatusPill` (the `PageHeader` import from Phase 2.2 stays, unduplicated). All three Panel bodies are rewritten: raw `<button>` → `Btn` (variant per action: `primary` create, `outline` stop/start, `danger` delete/remove, `secondary` apply); raw `<input>`/`<select>` → `Field` + `Input`/`Select`; plain-text status → `StatusPill`; the raw `JSON.stringify(config)` cell → `JsonCell` (accepts the object `config` directly). The "Apply changes" control moves into the `Panel` `action` snippet. The inner `<h3>` headings are dropped. The `configLabel` helper is removed. Script logic is untouched. The test asserts `.ui-pill`, `.ui-jsoncell` (and no raw `{"baseUrl` text), `.ui-btn` on `platform-create-button`, and `platform-id-input` closest `.ui-input`.
5. **Gate (Task 5).** `bun test:client` (incl. `AdminApp`/E2E tests driving the instances form by `data-testid`), `bun typecheck`, `bun knip` (no new unused from the removed `configLabel`), `bun check:bundle-isolation`, `bun build:client`. No commit — verification only.

## Consequences

### Positive

- The worst audit offender is fully on the kit; B2/B3/B4/B5 are closed for `InstancesSection`.
- Status renders as a colored `StatusPill` (active = accent/green, stopped = danger/red) instead of plain text; config renders as key:value chips via `JsonCell` instead of a raw JSON blob.
- Every action button is a kit `Btn` with consistent variant/size semantics; all inputs share the dark raised style and `Field` labels.
- Sensitive config fields (tokens, secrets) render as `password` inputs, restoring the masked-field contract the raw `<input type="text">` had broken.
- The `data-testid` contract survives via the opt-in `testid` props, so the admin test suite and E2E stay green without touching them.
- The three primitive enhancements (`testid` on `Btn`/`Input`/`Select`; `password` on `Input`) are reusable by `/debug` and `client/settings/` for the Phase 3 sweep.

### Negative

- Three shared primitives gain caller-shaped props (`testid`) and one gains a new type (`password`). The kit surface grows; future consumers must remember to pass `testid` or the attribute is silently absent (Svelte omits `undefined`).
- The config cell no longer shows the raw JSON string; an operator who relied on reading the raw blob loses that. `JsonCell` renders key:value chips, and arrays/scalars fall back to its truncation path.
- The "Apply changes" control relocated into the `Panel` `action` snippet; any test/selector keyed on the old `.instances-subheader` div broke and was updated, and the dead `.instances-subheader` CSS rules (and their `@media` rule) were removed.
- The inner `<h3>` headings are gone; an operator who relied on them as in-page anchors loses those — the `Panel` title is the single heading now.

### Risks

- The `data-testid` contract is opt-in, not enforced by the primitives. A future admin section that forgets to pass `testid` silently loses the attribute rather than failing loudly; tests keyed on it would silently no-op instead of erroring.
- `JsonCell` accepts the object `config` directly (no `JSON.stringify`), so the rendered chips depend on `InstanceConfigView` being a plain object. If a provider returns a non-object config (array/scalar), `JsonCell` falls back to its truncation path; the section does not pre-validate the shape.
- Visual parity depends on the kit's `Btn`/`Input`/`Select` styling matching the former raw elements. Tests assert class presence (`.ui-btn`/`.ui-input`/`.ui-pill`/`.ui-jsoncell`), not pixel parity; visual regressions rely on Storybook preview.
- The `password` type relies on the config schema's `sensitive` flag. A provider that mislabels a sensitive field as non-sensitive would render it in the clear; the section trusts `instanceConfigSchema` and does not double-check.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships `Btn`/`Input`/`Select`/`Field`/`StatusPill`/`JsonCell` this phase adopts and the `testid`/`password` enhancement targets.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — the prior `/admin` consumer-adoption phase this continues.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — put `InstancesSection`'s header on `PageHeader` (kept verbatim this phase); also deferred the inner `<h3>` removal and raw-button conversion that this phase owns.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` operator surface this section lives in.
- **ADR-0166: Storybook Harness — PR 1** — the harness and `bun check:bundle-isolation` gate the refactored section's stories rely on.

## Implementation Notes

Verified present in the codebase (light confirmation, not exhaustive):

| File                                                   | Role                                                                                                                                                                                                                                                                                                                           | Evidence         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `client/shared/ui/Btn.svelte`                          | `testid?: string` in `Props` (line 20) and destructure (line 31); `data-testid={testid}` on the `<button>` (line 40).                                                                                                                                                                                                          | `grep` confirms. |
| `client/shared/ui/Input.svelte`                        | `type?: 'text' \| 'search' \| 'password'` (line 14); `testid?: string` (line 16); both applied on the `<input>` (line 46).                                                                                                                                                                                                     | `grep` confirms. |
| `client/shared/ui/Select.svelte`                       | `testid?: string` in `Props` (line 16) and destructure (line 19); `data-testid={testid}` on the `<select>` (line 27).                                                                                                                                                                                                          | `grep` confirms. |
| `client/admin/sections/InstancesSection.svelte`        | Imports `Btn`/`Field`/`Input`/`JsonCell`/`PageHeader`/`Panel`/`Select`/`StatusPill` (lines 31–38); `<PageHeader eyebrow="Runtime" title="Instances" titleTestId="admin-section-title">` (line 279); `platform-apply-button` `Btn` in the `Panel` `action` snippet (line 294). No `configLabel`/`.instances-subheader` remains. | `grep` confirms. |
| `tests/client/admin/sections/InstancesSection.test.ts` | Asserts `admin-section-title` → "Instances" and `.ui-page-header` (lines 628–629); B4 `.ui-pill` (line 669); B5 `.ui-jsoncell` and no raw `{"baseUrl` (lines 670–671); B2 `.ui-btn` on `platform-create-button` (line 674); B3 `platform-id-input` closest `.ui-input` (line 676).                                             | `grep` confirms. |

Minor path note: the section test mirrors its source under `tests/client/admin/sections/` (the repo's test-path-mirrors-source convention), matching the plan's literal path. Test content matches the plan. The spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`.
