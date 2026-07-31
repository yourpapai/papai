<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0265: Settings Field Shell Polish

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

`SettingsFieldShell` (shipped by ADR-0256, consolidated by ADR-0257) generates a `labelId`, stamps it on its `.settings-field__label` span, and publishes it via `setFieldLabelId` so a descendant `Input` gets `aria-labelledby` from field-context. ADR-0257's final review surfaced three small, independent polish items, captured in the design (`docs/superpowers/specs/2026-07-07-settings-field-shell-polish-design.md`) and plan (`docs/superpowers/plans/2026-07-07-settings-field-shell-polish.md`):

- **A. Select/combobox accessible name.** The native `<select>`/combobox controls rendered in a shell editor slot had no accessible name — only `Input` consumed the shell's label id via field-context. The design gave the shell a way to hand its `labelId` to any editor control by typing the snippet as `Snippet<[string]>` and rendering `{@render editor(labelId)}`, so CodeHost/Coding could stamp `aria-labelledby={labelId}` on the raw elements.
- **B. `formDirty` visibility alignment.** `CodeHostSection`/`CodingCredentialsSection` computed whole-record dirtiness over all fields, including ones hidden by a control choice. The design filtered the derivation to visible fields (`filter(shouldShowField)` / `filter(!fieldHidden)`).
- **C. Stray-class cleanup.** `CodingIdentitySection`'s two `<label class="settings-field__label">` referenced a class with no global styling effect (it was component-scoped in the old sections, now shell-scoped); the design swapped them to the app's shared `t-label` class (`client/settings/settings.css`).

All three items shipped (commits `a46a9dd0c`, `95ad8cee7`, `d8fdbeba3`), then Parts A and C were reshaped by closely following refactors: the raw `<select>`/`<input>` that Part A targeted were replaced by the shared `Select`/`Combobox` primitives (which read field-context themselves), and `CodingIdentitySection` was rewritten to the sibling `<Field>`+`<Select>` pattern (commit `0bcd5277d`), subsuming Part C. The goals of all three items are met in the current tree.

## Decision Drivers

- **Give every shell editor control an accessible name.** A `<select>`/combobox in a `SettingsFieldShell` editor slot must resolve an `aria-labelledby` to its real field label ("Code host", "Model provider", "Model"), not render nameless (Part A).
- **Backward-compatible shell change.** The snippet-signature change must not force the other consumers (`ByokSection`, `ConfigFieldRow`, `AdminPluginsConfigSection`) to edit their `{#snippet editor()}` declarations.
- **Dirtiness matches what the user sees.** `formDirty` must consider only visible fields, so a hidden field with a stale draft cannot block or spuriously enable the whole-record Save (Part B).
- **Correctness-by-construction for Part B.** No new behavioral test is added because the failing state is unreachable today; the existing dirty-state tests guard against regression (spec §3).
- **Kill the dead class.** `CodingIdentitySection`'s labels must not reference a class with no styling effect (Part C).
- **Reuse the established primitive/context mechanisms.** Prefer the shared `Select`/`Combobox`/`Field` primitives and the field-context label wiring over per-section hand-rolled markup.

## Considered Options

### Option 1 — Shell snippet param + shared-primitive field-context for a11y; formDirty filter; Field migration for CodingIdentity (chosen)

Type the shell editor as `Snippet<[string]>` and render `{@render editor(labelId)}` (additive, backward-compatible); deliver the accessible name through the shared `Select`/`Combobox` primitives, which read `getFieldLabelId()` from field-context and stamp `aria-labelledby` themselves (the same mechanism `Input` uses); insert a `.filter(...)` into both `formDirty` derivations; and migrate `CodingIdentitySection` to the `<Field>`+`<Select>` sibling pattern so its labels render via `Field`'s styled `.ui-field__label`.

- **Pros:** every shell control resolves its real field label with zero per-consumer wiring; one field-context mechanism serves `Input`/`Select`/`Combobox`/`Field`; Part B is a pure, unreachable-state filter; Part C's dead class is removed more thoroughly than a `t-label` swap.
- **Cons:** the shell's `labelId` snippet parameter becomes vestigial once the primitives read context (declared but unused in the editor body); the final shape diverges from the plan's raw-element approach.

### Option 2 — Explicit `aria-labelledby={labelId}` on raw `<select>`/`<input>` (plan's literal Part A) + `t-label` swap for Part C

Pass `labelId` into the editor snippet and have each consumer stamp `aria-labelledby={labelId}` directly on its raw `<select>`/combobox `<input>`; swap `CodingIdentitySection`'s two `<label>` classes to `t-label`.

- **Pros:** matches the plan/spec text exactly; no change to the shared primitives.
- **Cons:** each consumer re-wires the id by hand even though the shell already publishes one to context; keeps raw `<select>`/`<input>` markup that the subsequent shared-primitive refactor (`03dad4a31`, `bd4a3a0e8`) removes anyway; `t-label` leaves `CodingIdentitySection` on hand-rolled markup that the sibling-pattern rewrite (`0bcd5277d`) replaces.

### Option 3 — Field-context-only for Part A (no shell snippet param) and defer Parts B/C

Rely solely on extending `Select`/`Combobox` to read field-context; leave the shell snippet signature as `Snippet`; skip the `formDirty` filter and the `CodingIdentity` class cleanup.

- **Pros:** smallest shell diff; the snippet param is indeed unneeded once primitives read context.
- **Cons:** rejects the Part B robustness driver and leaves the dead `settings-field__label` class in place; the additive snippet param is harmless and was already shipped, so reverting it is pure churn.

## Decision

The chosen Option 1 shipped in full across the shell, both sections, the shared primitives, the tests, and the `CodingIdentity` rewrite. What shipped:

1. **Shell editor-snippet signature change (`client/settings/components/SettingsFieldShell.svelte`).** `editor?: Snippet<[string]>` (line 24) and `{@render editor(labelId)}` (line 43). Backward-compatible: the other consumers' `{#snippet editor()}` ignore the extra arg, and a zero-param snippet is assignable to `Snippet<[string]>`.
2. **Select/Combobox accessible name via field-context.** The shared `Select` primitive (`client/shared/ui/Select.svelte`) reads `getFieldLabelId()` and stamps `aria-labelledby={labelId}` on its `<select>`; the `Combobox` primitive does the same on its `<input>`. The shell publishes its `labelId` via `setFieldLabelId`, so a control rendered in the editor slot resolves the real field label without consumer wiring.
3. **Consumers declare `editor(labelId)` and render the primitives.** `CodeHostSection` (`{#snippet editor(labelId)}` → `<Select>`) and `CodingCredentialsSection` (`{#snippet editor(labelId)}` → `<Select>` / `<Combobox>`) consume the snippet param and render the shared primitives.
4. **`formDirty` visibility filter (verbatim).** `CodeHostSection`: `fields.filter(shouldShowField).some(…)`; `CodingCredentialsSection`: `fields.filter((f) => !fieldHidden(f)).some(…)`. No new behavioral test (the failing state is unreachable); existing dirty-state tests guard regression.
5. **A11y tests (Part A).** `code-host-section.test.ts` — "the kind select has an accessible name via aria-labelledby"; `coding-credentials-section.test.ts` — "the provider select has an accessible name via aria-labelledby" plus a bonus "the model combobox has an accessible name via aria-labelledby". Each resolves `aria-labelledby` to its element and asserts the resolved label text.
6. **`CodingIdentitySection` defect resolved via Field migration.** The plan's `t-label` swap shipped (commit `d8fdbeba3`) then was superseded same-day by a full rewrite to the sibling `<Field>`+`<Select>` pattern (commit `0bcd5277d`): the dead `settings-field__label` class is gone, labels render through `Field`'s `.ui-field__label`, and a 14-test suite replaced the single `t-label` assertion.

## Consequences

### Positive

- Every `<select>`/combobox in a `SettingsFieldShell` editor slot resolves an accessible name to its real field label, asserted by three tests — screen-reader users hear "Code host"/"Model provider"/"Model" instead of a nameless control.
- One field-context mechanism (`setFieldLabelId`/`getFieldLabelId`) now serves `Input`, `Select`, `Combobox`, and `Field`; no consumer duplicates the label-id wiring.
- `formDirty` in both sections considers only visible fields, so a hidden field with a stale draft can no longer block or spuriously enable the whole-record Save — robust against future field-hiding changes.
- `CodingIdentitySection` no longer references a dead class; its labels carry the shared `Field` styling and the section gained load-error/`ErrorState`/busy-save coverage in the rewrite.
- The shell snippet-signature change is additive and backward-compatible; the other consumers needed no edit.

### Negative

- The shell's `labelId` snippet parameter is now vestigial for `Select`/`Combobox` consumers — declared in `{#snippet editor(labelId)}` but unused in the body, because the primitives read field-context. It remains the channel for any future non-primitive control that does not read context.
- The shipped shape diverges from the plan's raw-element approach: the explicit `aria-labelledby={labelId}` on raw `<select>`/`<input>` (commit `a46a9dd0c`) lived only until the shared-primitive refactor (`03dad4a31`, `bd4a3a0e8`) replaced those elements.
- Part C's `t-label` change was short-lived: the same-day sibling-pattern rewrite removed the raw `<label>` elements entirely, so the plan's `t-label` test no longer exists.

### Risks

- **Vestigial snippet parameter could mislead.** A future editor consumer may assume it must wire `aria-labelledby={labelId}` manually; in practice the primitives handle it, and a manual wire on a primitive that also reads context would duplicate (harmlessly) the same id.
- **Part B has no dedicated test.** The failing state is unreachable by construction today (a hidden field cannot be dirty without a co-occurring visible change); a future change to field-hiding logic could make it reachable without a test catching it.
- **Shared-primitive blast radius.** Any edit to `Select`/`Combobox` field-context consumption ripples to every consumer; the a11y tests in CodeHost/Coding plus `GroupProviderSection` guard the wiring.

## Related Decisions

- **ADR-0256: BYOK Settings Field Shell** — introduced `SettingsFieldShell`, the `setFieldLabelId`/`getFieldLabelId` context wiring, and the shared-primitive convention this ADR leans on.
- **ADR-0257: Field Shell Consolidation Followups** — direct predecessor. It migrated `CodeHostSection`/`AdminPluginsConfigSection` onto the shell, recorded the bonus `aria-labelledby` tests this plan formalized, and noted the raw-`<select>`→`<Select>` divergence. This ADR closes the three optional items ADR-0257's final review surfaced.
- The `Field`/`Input`/`Select`/`Combobox` field-context label association (`commit 6e0249552`) and the `.t-label` global class (`client/settings/settings.css`) this ADR builds on.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/components/SettingsFieldShell.svelte:24` | `editor?: Snippet<[string]>` (signature change). | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:33-34` | `labelId` generated and published via `setFieldLabelId(labelId)`. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:43` | `{@render editor(labelId)}` (id handed to the snippet). | `read` confirms. |
| `client/shared/ui/field-context.ts:11-18` | `setFieldLabelId` / `getFieldLabelId` context pair. | `read` confirms. |
| `client/shared/ui/Select.svelte:7,25,33` | `Select` reads `getFieldLabelId()` and stamps `aria-labelledby={labelId}` on `<select>`. | `read` confirms. |
| `client/shared/ui/Combobox.svelte:12,30,44` | `Combobox` reads `getFieldLabelId()` and stamps `aria-labelledby={labelId}` on `<input>`. | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:205` | `{#snippet editor(labelId)}` (param declared; `Select` reads context). | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:207-212` | `select` branch renders the shared `Select` primitive (not a raw `<select>`). | `read` confirms. |
| `client/settings/sections/CodeHostSection.svelte:46` | `formDirty = $derived(fields.filter(shouldShowField).some(…))` (Part B, verbatim). | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:296` | `{#snippet editor(labelId)}` (param declared). | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:298-303,305-311` | `select`/`combobox` branches render `Select`/`Combobox` primitives. | `read` confirms. |
| `client/settings/sections/CodingCredentialsSection.svelte:58` | `formDirty = $derived(fields.filter((f) => !fieldHidden(f)).some(…))` (Part B, verbatim). | `read` confirms. |
| `tests/client/settings/code-host-section.test.ts:584-597` | "the kind select has an accessible name via aria-labelledby" (Part A test). | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:840-853` | "the provider select has an accessible name via aria-labelledby" (Part A test). | `read` confirms. |
| `tests/client/settings/coding-credentials-section.test.ts:855-869` | "the model combobox has an accessible name via aria-labelledby" (bonus combobox test). | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:123,133` | `<Field label="Policy">` / `<Field label="Member" error=…>` — no raw `<label>`, no `settings-field__label`/`t-label`. | `read` + `grep` confirm. |
| `client/shared/ui/Field.svelte:28,38` | `setFieldLabelId(labelId)` + `<span class="ui-field__label" id={labelId}>` (styled label). | `read` confirms. |
| `tests/client/settings/sections/CodingIdentitySection.test.ts:99-265` | 14-test rewrite suite (load states, `ErrorState`+retry, busy Save, `role="alert"`, member labels); no `t-label` assertion. | `read` confirms. |
| `client/settings/settings.css:68` | `.t-label` global class exists (the plan's Part C target). | `grep` confirms. |

Plan-vs-implementation notes:

- **Part A's mechanism shifted from explicit `aria-labelledby={labelId}` to shared-primitive field-context.** The plan (and the original Task 1 commit `a46a9dd0c`) stamped `aria-labelledby={labelId}` directly on the raw `<select>`/combobox `<input>` in `CodeHostSection`/`CodingCredentialsSection`. Two later refactors replaced those raw elements with the shared `Select` primitive (`03dad4a31 refactor(settings): CodeHostSection select onto shared Select primitive`) and the `Select`/`Combobox` primitives (`bd4a3a0e8 refactor(settings): CodingCredentialsSection onto Select/Combobox + empty guard + model hint`). Both primitives already read `getFieldLabelId()` from context and apply `aria-labelledby` themselves, so the consumer no longer wires the id — making the shell's `labelId` snippet parameter declared-but-unused in the editor bodies. The accessible-name goal is fully met (and asserted by the three a11y tests); the wiring is just owned by the primitive, not the consumer. This is the same shared-primitive divergence ADR-0256/0257 recorded.
- **A bonus combobox a11y test shipped beyond the plan.** The plan's Part A added one select test per section; the shipped suite also covers the model combobox (`coding-credentials-section.test.ts:855`), verifying the `Combobox` primitive's field-context wiring end-to-end.
- **Part B shipped verbatim with no new test, exactly as the spec prescribed.** `CodeHostSection.svelte:46` and `CodingCredentialsSection.svelte:58` carry the `.filter(…)` insertion; the spec §3 reachability analysis (no reachable dirty-hidden state) held, so no dedicated behavioral test was added and the existing dirty-state tests guard regression.
- **Part C shipped then was superseded same-day by a fuller rewrite.** The plan's `t-label` swap landed in `d8fdbeba3 fix(settings): CodingIdentitySection labels use shared t-label class` (both `<label>`s → `t-label` + a `t-label` assertion). Hours later, `0bcd5277d fix(settings): align CodingIdentitySection with sibling pattern` rewrote the section onto `<Field>`+`<Select>` (resolving eight UX-review findings), deleting the raw `<label>` elements entirely. The dead `settings-field__label` defect is therefore resolved more thoroughly than the plan proposed — labels now render through `Field`'s `.ui-field__label` — and the single `t-label` test was replaced by a 14-test suite at the moved path `tests/client/settings/sections/CodingIdentitySection.test.ts`. No `t-label` or `settings-field__label` reference remains in the section (`grep` confirms).
- **The plan's referenced test path moved.** The plan edited `tests/client/settings/coding-identity-section.test.ts`; that file was superseded by `tests/client/settings/sections/CodingIdentitySection.test.ts` in the rewrite.

The source plan `docs/superpowers/plans/2026-07-07-settings-field-shell-polish.md` and design `docs/superpowers/specs/2026-07-07-settings-field-shell-polish-design.md` are archived alongside this ADR to `docs/archive/`.
