<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0352: Shared Primitive Accessibility — Extended Field Context, ARIA Required State, Heading Outline, and Input Disabled

## Status

Accepted

## Date

2026-08-01

## Context

Four accessibility gaps were deferred by the settings-robustness sub-projects D and E because each lives in a shared UI primitive rather than in any one settings section:

1. **Hints were never programmatically associated with their control.** `Field.svelte` and `SettingsFieldShell.svelte` rendered the hint in an `{:else}` branch carrying no `id`, and the field context's `describedBy` getter returned the error id only when invalid — so none of the 27 hints in the settings SPA was reachable via `aria-describedby`.
2. **Required was conveyed only by a `*` glyph inside the label span.** Because that span is what `aria-labelledby` points at, the asterisk folded into the accessible name ("Kaneo URL*") and a mandatory field announced identically to an optional one apart from the glyph.
3. **The settings SPA had no heading outline.** All 30 section titles rendered by `PageHeader` were `div`s, and the eleven `h3`s sections already render sat under nothing.
4. **`Input` had no `disabled` prop** while its sibling `Select` did. `CodeHostSection` passed `disabled={saving || loading}` to its `Select` but could not pass it to the sibling `Input`s; since `saveAll` reloads on success and `load` replaces `drafts` wholesale, keystrokes typed during a save were silently discarded.

The design (`docs/superpowers/specs/2026-08-01-shared-primitive-accessibility-design.md`) and plan (`docs/superpowers/plans/2026-08-01-shared-primitive-accessibility.md`) resolved all four in one sub-project (F).

## Decision Drivers

- **Both publishers change together.** Two components publish the field context (`Field.svelte`, `SettingsFieldShell.svelte`) and three consume it (`Input`, `Select`, `Combobox`). Any change to the `field-context.ts` contract lands in both publishers in the same task — a half-migrated SPA is worse than an unmigrated one.
- **Reuse the existing context channel.** The `FieldErrorContext`/`useFieldInvalid` seam from ADR-0345 already carries live, getter-based state from publisher to control; the fix is growing that contract (`hintId`, `hasHint`, `required`), not inventing a second channel.
- **Exactly one described-by id is ever live.** Error and hint render in exclusive branches of one `{#if}`, so `describedBy` returns a single id — never a space-separated list.
- **Meaning moves to ARIA state, not to text.** The required glyph becomes `aria-hidden="true"` and the control gains `aria-required`. A visually-hidden "(required)" text node in the label was rejected: the label is referenced by `aria-labelledby`, so the text would fold into the accessible *name* and double-announce alongside the state.
- **No visual change for the semantics-only work.** Tasks 1–3 change ids, ARIA attributes, and tags only; any moved pixel is a defect. The one intended new visual baseline is the disabled `Input` story.
- **Fixed heading level, no prop.** `PageHeader`'s title becomes an `h2` with `margin: 0` (to neutralize the UA heading margin); no `level` prop is added because no render site needs a second level and an untested branch is worse than a two-line change later. A visually-hidden `h1` in the settings shell roots the outline.
- **Mirror, don't redesign.** `Input`'s disabled styling (`opacity: 0.6`, `cursor: not-allowed`) mirrors `.ui-select--disabled`; disabled controls are exempt from the WCAG contrast floor and SC 2.5.8, so no token work is needed.
- **`ConfigFieldRow` keeps its local `hintId` wiring.** Its enum branch can show hint *and* error simultaneously, so it needs the filtered id list it already builds; it is not routed through the shared context.

## Considered Options

### Option 1 — Grow the shared field-context contract, publishers together (chosen)

Add `hintId` + `hasHint` + `required` to `FieldErrorContext` and `required` to `FieldInvalidState`; have both publishers mint a hint id and publish all three getters in the same task; change `describedBy` to return error-id-when-invalid else hint-id-when-present; render `aria-required` in all three consumer controls; promote `PageHeader` to `h2` with a hidden `h1` in the shell; add `disabled` to `Input` and wire `CodeHostSection`.

- **Pros:** one contract change fixes hints everywhere at once (27 hint sites, no per-section edits); consumers needed no edit for the hint change because they already render `aria-describedby={fieldError.describedBy}`; semantics-only changes verified against rebuilt pre-change visual baselines in strict Playwright mode; the disabled-Input bug is fixed at the primitive so other sections can adopt it later.
- **Cons:** touches six primitives plus the settings shell and two fixtures in one sub-project; the strict-mode baseline gate requires Storybook running and a careful revert/restore dance against the pre-F commit.

### Option 2 — Visually-hidden "(required)" text in the label

Keep `aria-required` off and append a screen-reader-only "(required)" to the label span.

- **Pros:** no context contract change.
- **Cons:** the label is what `aria-labelledby` points at, so the text folds into the accessible name — the control announces "Kaneo URL required" as its name and then "required" again as its state. Rejected (spec §1).

### Option 3 — Per-section hint wiring instead of the shared context

Give each settings section its own hint id and `aria-describedby` wiring.

- **Pros:** no primitive changes.
- **Cons:** 27 hand-wired copies of the same three lines, guaranteed to drift; leaves `Field` consumers in other SPAs unfixed. Rejected.

### Option 4 — `level` prop on `PageHeader`

Make the heading level configurable per render site.

- **Pros:** flexible if a future page nests sections.
- **Cons:** no render site needs a second level today; an untested branch is worse than adding the prop later. Rejected (plan constraint).

## Decision

Implement Option 1 across five tasks:

1. **Hint association**: `FieldErrorContext` gains `hintId` and a `readonly hasHint` getter; `describedBy` returns the error id when invalid, else the hint id when present, else `undefined`. Both publishers mint `ui-field-hint-<uid>` / `settings-field-hint-<uid>` and put the id on the hint element. Consumers are untouched.
2. **Required as ARIA**: the contract and `FieldInvalidState` gain `readonly required`; both publishers publish it and mark the `*` span `aria-hidden="true"`; `Input` (both `textarea` and `input`), `Select`, and `Combobox` render `aria-required={fieldError.required ? 'true' : undefined}`.
3. **Heading outline**: `PageHeader`'s title becomes `<h2 class="ui-page-header__title">` with `margin: 0` first in the rule; `SettingsApp` gains a visually-hidden `<h1>Settings</h1>`; the sr-only utility ships in CSS (consolidated as `.sr-only` in `client/shared/base.css`).
4. **Input disabled**: `Input` gains `disabled?: boolean` (default `false`), applied to the wrapper class and both control branches, styled to mirror `.ui-select--disabled`; `CodeHostSection` passes `disabled={saving || loading}`; a `Disabled` story is added.
5. **Visual gate**: rebuild every Storybook baseline from the pre-sub-project commit (`a1b418f23`), restore the code, and re-run Playwright in strict mode (no `--update-snapshots`) so a moved pixel fails instead of silently rewriting evidence; then generate and baseline only the new `Disabled` Input shot. This gate replaced the plan's original `git status --short .storybook-shots/` check, which was inert (the directory is gitignored and untracked) and would have reported success against arbitrary regressions.

## Consequences

### Positive

- Every hint in the settings SPA is programmatically associated with its control via `aria-describedby`; error still wins when both are set.
- Required fields announce as required through `aria-required` on all three control types, and the accessible name no longer contains the asterisk.
- The settings document has a real outline: hidden `h1` → section `h2`s → existing `h3`s, with zero visual change (`margin: 0` on the title rule).
- Code-host inputs lock during a save, so keystrokes typed mid-save are no longer silently discarded; the `disabled` prop is available to any future `Input` consumer.
- The strict-mode baseline gate is a reusable procedure for proving semantics-only changes move no pixels.

### Negative

- The field-context contract is now wider (`hintId`, `hasHint`, `required`); any future publisher of the context must supply all three getters — currently enforced only by the two-publisher convention and tests, not by a shared factory.
- `ConfigFieldRow` keeps its local hint-id wiring as a documented asymmetry; its enum branch can never move onto the shared context without losing simultaneous hint+error.
- The visual gate depends on a running Storybook and a manual revert/restore sequence; it is not part of CI.

### Risks

- A future `Field`-like publisher that forgets `hasHint`/`required` compiles (all members are present in the type, but a publisher could snapshot instead of using getters and lose live reactivity). Mitigation: the getter pattern is documented in the context file and pinned by fixture tests.

## Implementation Status

**Implemented** — All key outcomes verified present in the codebase.

- Task commits landed in sequence after the plan commit `a1b418f23`: `27a795051` (hint association), `d1187955e` (aria-required), `5b121bdc4` (headings), `d29bcbf45` (Input disabled), `e972cafda` (visual baseline for the Disabled story).
- Both publishers satisfy the contract: `hintId` appears in `client/shared/ui/Field.svelte` and `client/settings/components/SettingsFieldShell.svelte`; both required glyphs carry `aria-hidden="true"`.
- All three consumers render `aria-required`: `client/shared/ui/Input.svelte`, `Select.svelte`, `Combobox.svelte`.
- `client/shared/ui/PageHeader.svelte` renders `<h2 class="ui-page-header__title">` and is the only file referencing that class.
- `client/shared/ui/Input.svelte` has the `disabled` prop and `.ui-input--disabled` rule; `client/settings/sections/CodeHostSection.svelte` passes `disabled={saving || loading}`; `client/shared/ui/Input.stories.svelte` has the `Disabled` story and `tests/visual/shared/ui/Input.spec.ts` has the generated `Disabled` test.
- Minor divergence: the plan called for a new `.settings-sr-only` utility in `client/settings/settings.css`; the hidden `<h1>` instead uses the shared `.sr-only` utility (`client/shared/base.css`), consolidated by a later refactor. Functionally equivalent.
- The plan's 42 step checkboxes were never ticked in the file despite all work landing; completion is evidenced by the commits above.

## Related Decisions

- ADR-0345: Settings Field Error Channel — introduced the `FieldErrorContext`/`useFieldInvalid` seam this ADR extends
- ADR-0256: BYOK Settings Field Shell — introduced `SettingsFieldShell`, the second publisher
- ADR-0344: Control Height Token Scale and WCAG Floor Ratchet — the contrast-floor ratchet the disabled-state exemption is checked against
- ADR-0238: Storybook Agent Screenshot Pipeline — visual-baseline verification mechanism used for the strict-mode gate
- ADR-0266: Settings Robustness A (Select Disabled) — the `.ui-select--disabled` pattern `Input` mirrors

## References

- Plan: `docs/superpowers/plans/2026-08-01-shared-primitive-accessibility.md`
- Design spec: `docs/superpowers/specs/2026-08-01-shared-primitive-accessibility-design.md`
- Contract: `client/shared/ui/field-context.ts`
- Publishers: `client/shared/ui/Field.svelte`, `client/settings/components/SettingsFieldShell.svelte`
- Consumers: `client/shared/ui/Input.svelte`, `Select.svelte`, `Combobox.svelte`
- Outline: `client/shared/ui/PageHeader.svelte`, `client/settings/SettingsApp.svelte`
- Disabled consumer: `client/settings/sections/CodeHostSection.svelte`
