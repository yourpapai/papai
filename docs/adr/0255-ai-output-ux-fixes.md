<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0255: AI Output UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

`AiOutputSection` (`client/settings/sections/AiOutputSection.svelte`), the Personal settings section for AI output preferences (rendered through `ConfigFieldRow` + the shared `SegmentedControl`), carried seven UX-review findings (`docs/ux-reviews/AiOutputSection.md`): three Medium — the unselected segment label fell below the WCAG contrast minimum (`--text-dim` ≈3.6:1 on `--surface-2`), the privacy-relevant "Raw shows unredacted output" warning was a detached paragraph with no `aria-describedby` link to the control, and the toggle gave no in-flight feedback while saving and silently reverted on failure — plus four Low — no shared height baseline/radius between the segment and the sibling `sm` Clear button, the field label and the hint collapsed to one visual tier, the segment options and icon-button lacked a branded `:focus-visible` ring (unlike `Btn`), and settings components leaned on legacy token aliases (`--fg2`/`--surface`) scoped to the debug/admin SPAs.

Several defects live in shared primitives (`SegmentedControl`, `ConfigFieldRow`, `IconButton`) consumed by `ToolsSection`, `TaskProviderSection`, and `ProfileSection` too, so the design (`docs/superpowers/specs/2026-07-06-ai-output-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-06-ai-output-ux-fixes.md`) resolved all seven by fixing the primitives rather than patching `AiOutputSection` locally: extract a shared `--focus-ring`/`--focus-ring-offset` token in `tokens.css` and adopt it across `Btn`/`Input`/`IconButton`/`SegmentedControl`; raise the resting segment color to `--text-muted`, drop its height to 22px and radius to `--radius-control`; add `disabled` and `ariaDescribedBy` props to `SegmentedControl`; thread a `hint` prop through `ConfigFieldRow` that renders inside the card and wires `aria-describedby`, freezes the control while saving, brightens the label, and drops the legacy aliases; and relocate `AiOutputSection`'s standalone hint `<p>` into the card via that prop. Purely front-end; no schema/fetcher changes; the hint is a component prop, not sourced from the backend.

## Decision Drivers

- **Clear the WCAG contrast minimum.** The unselected segment label must lift off `--text-dim` (≈3.6:1) to `--text-muted` (≈6.9:1), keeping the rest → hover → selected gradient intact (Finding 1).
- **Associate the privacy warning with the control.** The "Raw shows unredacted output" hint must reach the segmented control via `aria-describedby` so a screen-reader user hears it before committing to Raw (Finding 2).
- **Signal the in-flight write on the control itself.** The segment must disable (native `disabled` + dimmed style) while a save is in flight, not just the Clear button, so a slow PATCH is not a dead frame (Finding 3).
- **Shared baseline/radius across sibling controls.** The segment adopts the `sm`-control tokens (`height: 22px`, `--radius-control`) so it aligns with the Clear button beside it (Finding 4).
- **Establish a label > hint hierarchy.** Brighten the label to `--text` so it outranks the muted hint and announces itself as the field's name (Finding 5).
- **Branded focus rings on every interactive primitive.** A single `--focus-ring` token feeds `:focus-visible` on `Btn`, `Input`, `IconButton`, and `SegmentedControl` — one branded focus style, not UA defaults (Finding 6).
- **Drop legacy aliases in the touched surface.** `ConfigFieldRow` points at canonical `--surface-1`/`--text` rather than the debug/admin-scoped `--surface`/`--fg2` aliases (Finding 7); no repo-wide alias sweep.
- **Additive-only shared-primitive changes.** Existing `SegmentedControl` callers pass no `disabled`/`ariaDescribedBy`, so resting appearance is unchanged outside the contrast/height/radius polish.

## Considered Options

### Option 1 — Shared-primitive fixes + `ConfigFieldRow` hint prop + `--focus-ring` token (chosen)

Extract `--focus-ring`/`--focus-ring-offset` in `tokens.css`; adopt in `Btn`/`Input`/`IconButton`/`SegmentedControl`; raise segment contrast and align height/radius to `sm` tokens; add `disabled` + `ariaDescribedBy` props to `SegmentedControl`; add a `hint` prop to `ConfigFieldRow` that renders inside the card, wires `aria-describedby`, and freezes the control while saving; relocate `AiOutputSection`'s hint into the card via the prop.

- **Pros:** resolves all seven findings at their actual home (the primitives), so `ToolsSection`/`TaskProviderSection`/`ProfileSection` benefit too; one branded focus style via a single token; the `disabled`/`ariaDescribedBy` props are additive and backward-compatible; no schema/fetcher surface.
- **Cons:** touches four shared primitives plus `tokens.css`, so the blast radius ripples to every section using `SegmentedControl`/`ConfigFieldRow`, requiring a four-section baseline re-shoot; a new render-state branch (hint present vs absent) per field branch.

### Option 2 — Local overrides in `AiOutputSection` only

Patch contrast, focus, and the hint association inside `AiOutputSection` rather than the primitives.

- **Pros:** smallest diff; no ripple to sibling sections.
- **Cons:** rejects the design's core driver — the defects exist in the primitives, so sibling sections keep them; duplicates styling that belongs on `SegmentedControl`; the height/radius and contrast fixes cannot be expressed locally without fighting the primitive's own rules.

### Option 3 — Per-call-site focus styling instead of a shared `--focus-ring` token

Copy the literal `outline` into `IconButton`/`SegmentedControl` rather than minting a token.

- **Pros:** `Btn` stays untouched; zero blast radius beyond the two new rules.
- **Cons:** three copies of the same literal drift over time; the design explicitly recommends the token path; the contrast/height/disabled findings still force primitive edits.

## Decision

The chosen Option 1 shipped across the four shared primitives, `tokens.css`, `ConfigFieldRow`, `AiOutputSection`, and the unit tests. What shipped:

1. **`--focus-ring` token (`client/shared/tokens.css`).** `--focus-ring: 2px solid rgba(82, 224, 138, 0.4)` and `--focus-ring-offset: 1px` added under a new `/* ---- focus ---- */` block, extracted from `Btn`'s prior literal.
2. **Token adoption in `Btn` and `Input`.** Both primitives' `:focus-visible` / `:focus-within` rules now reference `var(--focus-ring)` / `var(--focus-ring-offset)` instead of the inline literal.
3. **`IconButton` intrinsic focus ring.** A `.ui-iconbtn:focus-visible` rule added after `:hover`, using the shared token — additive, no resting-state change.
4. **`SegmentedControl` contrast + height/radius polish.** `.ui-seg` radius `--radius` → `--radius-control`; `.ui-seg__opt` color `--text-dim` → `--text-muted`, `padding: 4px 12px` → `0 10px`, `height: 26px` → `22px`; the hover rule guarded with `:not(:disabled)`.
5. **`SegmentedControl` `disabled` + `ariaDescribedBy` props.** New optional props (default `false` / absent); `onKey` returns early when disabled; each option button carries `{disabled}`; the `role="radiogroup"` carries `aria-describedby={ariaDescribedBy}`; a `.ui-seg__opt:disabled { cursor: not-allowed; opacity: 0.5 }` style added.
6. **`SegmentedControl` focus ring.** `.ui-seg__opt:focus-visible` using the token, with a `-2px` offset because `.ui-seg` sets `overflow: hidden` (a positive offset would clip).
7. **`ConfigFieldRow` `hint` prop + aria wiring + in-flight disable.** New optional `hint?: string` prop; a `hintId = cfg-hint-${field.key}` derived; the enum branch passes `ariaDescribedBy={hint ? hintId : undefined}` and `disabled={saving}`; a `.settings-field__hint` paragraph renders in the footer of both the enum and text branches when `hint` is present.
8. **Label brightening + legacy-alias drop.** The `.settings-field` background and `.settings-field__label` color rules now use canonical `--surface-1` / `--text` (Finding 5 and 7) — shipped via the shared `SettingsFieldShell` component that `ConfigFieldRow` now renders through (see Divergence).
9. **`AiOutputSection` hint relocation.** The standalone `<p class="ai-output-hint">` and its `.ai-output-hint` style are gone; the copy is passed to `ConfigFieldRow` via the `hint` prop for the `ai_output_detail_level` field, rendering inside the card and wired for accessibility.
10. **Unit tests.** Five new `SegmentedControl` tests (disabled attribute, click is a no-op while disabled, ArrowRight is a no-op while disabled, `aria-describedby` set/omitted) and three new `ConfigFieldRow` tests (hint paragraph + `aria-describedby` when provided, omitted when absent, control disabled mid-save).

## Consequences

### Positive

- The unselected segment label now clears the WCAG contrast minimum (≈6.9:1) across every section using `SegmentedControl`, not just `AiOutputSection`.
- The privacy-relevant "Raw shows unredacted output" warning is programmatically associated with the control via `aria-describedby`, so screen-reader users hear it before toggling to Raw.
- The toggle now signals an in-flight write on the control itself (native `disabled` + dimmed style + no-op `onChange`/`onKey`), so a slow save is no longer a dead frame; the silent optimistic revert is still paired with the existing error line.
- The segment, the Clear button, and the refresh icon share a common height/radius in one row.
- The field label outranks the hint (bright `--text` vs muted `--text-muted`), establishing the hierarchy the review called for.
- One branded focus style travels with `Btn`, `Input`, `IconButton`, and `SegmentedControl` via the shared `--focus-ring` token.
- The `SegmentedControl` props are additive: existing callers passing neither `disabled` nor `ariaDescribedBy` are behaviorally unchanged.

### Negative

- Four shared primitives plus `tokens.css` are touched, so the blast radius ripples to every section using `SegmentedControl`/`ConfigFieldRow`; their baselines must be re-shot on any future primitive change.
- The label/alias fix landed via a sibling `SettingsFieldShell` component rather than as in-place edits to `ConfigFieldRow`'s own `<style>` (see Divergence), so the CSS ownership for `.settings-field*` rules is split across two files.

### Risks

- **Blast radius of the shared-primitive changes.** Any future edit to the `--focus-ring` token, the segment contrast/height, or the `disabled` affordance must re-shoot the affected section baselines and spot-check consuming sections.
- **Inline pass-through of the raw hint copy.** The privacy warning surfaces verbatim; if a future hint carries backend-supplied text, that string would render unredacted inside the card.
- **Text-field hint is not programmatically associated.** For text (non-enum) fields the hint renders but is not wired to the input's `aria-describedby` (the `Input` primitive derives its own `describedby` from field-error state and accepts no external value). AiOutput is enum-only, so this is latent, not active.

## Related Decisions

- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — established the `--focus-ring` token's value and the `Btn` `busy`/intrinsic-focus-ring affordances this ADR generalizes to `IconButton`, `Input`, and `SegmentedControl`. The token extraction here is the natural follow-on: 0253 hardcoded the literal on `Btn`, this ADR lifts it into `tokens.css` and points `Btn` at it.
- The `AiOutputSection` render-state convention (`ErrorState` / `Loading…` / content) that sibling UX-fix ADRs mirror.
- The `SettingsFieldShell` extraction (a sibling refactor) that carries the `.settings-field` / `.settings-field__label` CSS this ADR's Finding 5 and Finding 7 target.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/tokens.css:38-40` | `--focus-ring` / `--focus-ring-offset` under a new `/* ---- focus ---- */` block. | `read` confirms. |
| `client/shared/ui/Btn.svelte:74-77` | `.ui-btn:focus-visible` now references `var(--focus-ring)` / `var(--focus-ring-offset)`. | `read` confirms. |
| `client/shared/ui/Input.svelte:93-96` | `.ui-input:focus-within` references the token. | `read` confirms. |
| `client/shared/ui/IconButton.svelte:44-47` | `.ui-iconbtn:focus-visible` rule added after `:hover`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:11-20` | `disabled?: boolean` / `ariaDescribedBy?: string` in `Props`; destructured with `disabled = false`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:22-23` | `onKey` returns early when `disabled`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:31` | `role="radiogroup"` carries `aria-describedby={ariaDescribedBy}`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:40` | Each option button carries `{disabled}`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:53` | `.ui-seg` radius → `var(--radius-control)`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:60,64,65` | `.ui-seg__opt` color → `--text-muted`, `padding: 0 10px`, `height: 22px`. | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:68-71` | `.ui-seg__opt:focus-visible` with `outline-offset: -2px` (clipped-overflow guard). | `read` confirms. |
| `client/shared/ui/SegmentedControl.svelte:72,73-76` | Hover guarded `:not(:disabled)`; `.ui-seg__opt:disabled { cursor: not-allowed; opacity: 0.5 }`. | `read` confirms. |
| `tests/client/shared/ui/SegmentedControl.test.ts:150-237` | Five new tests: disabled attribute, disabled click no-op, disabled ArrowRight no-op, `aria-describedby` set/omitted. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:23,26` | `hint?: string` in `Props`; destructured. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:46` | `hintId = $derived(\`cfg-hint-${field.key}\`)`. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:123-124` | Enum branch: `ariaDescribedBy={hint ? hintId : undefined}` + `disabled={saving}`. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:133-140` | Enum `footer` snippet: error + `.settings-field__hint` paragraph with `id={hintId}`. | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:173-180` | Text `footer` snippet: error + hint paragraph (not aria-associated with the input). | `read` confirms. |
| `client/settings/components/ConfigFieldRow.svelte:194-198` | `.settings-field__hint { color: var(--text-muted); font-size: 12px }` style. | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:49-56` | `.settings-field` background `var(--surface-1)` (Finding 7, relocated here). | `read` confirms. |
| `client/settings/components/SettingsFieldShell.svelte:63-68` | `.settings-field__label` color `var(--text)` (Finding 5, relocated here). | `read` confirms. |
| `tests/client/settings/components/ConfigFieldRow.test.ts:558-615` | Two hint tests: paragraph + `aria-describedby` when provided; both omitted when absent. | `read` confirms. |
| `tests/client/settings/components/ConfigFieldRow.test.ts:617-654` | In-flight-disable test: segment `disabled` while PATCH pending, re-enabled on resolve. | `read` confirms. |
| `client/settings/sections/AiOutputSection.svelte:79-81` | Hint copy passed to `ConfigFieldRow` for `ai_output_detail_level`. | `read` confirms. |
| `client/settings/sections/AiOutputSection.svelte:88-93` | `<style>` reduced to `.settings-field-list`; no `ai-output-hint` rule remains. | `read` confirms. |
| `tests/visual/settings/sections/AiOutputSection.spec.ts:9-50` | Auto-screenshot baselines (Populated/Empty/Error/Loading) + narrow-640 and hover Raw/Clear interaction shots re-shot. | `read` confirms. |

Plan-vs-implementation notes:

- **The label/alias CSS (Findings 5 & 7) landed in a sibling `SettingsFieldShell`, not in-place in `ConfigFieldRow`.** The plan's Task 4 Step 6 edited `.settings-field { background: var(--surface) }` and `.settings-field__label { color: var(--fg2) }` directly inside `ConfigFieldRow.svelte`'s `<style>`. In the shipped tree, `ConfigFieldRow` renders through a shared `SettingsFieldShell.svelte` component and its own `<style>` carries only `.settings-field__hint`; the `.settings-field`/`.settings-field__head`/`.settings-field__label` rules (with canonical `--surface-1`/`--text`) live in `SettingsFieldShell.svelte:49-68`. Both findings are resolved — the field label is `--text` and the surface is canonical `--surface-1` — but the ownership relocated during a sibling extraction. `ConfigFieldRow` no longer references `--surface` or `--fg2` at all (`grep` confirms zero matches).
- **`SettingsFieldShell` also carries a label `id` and `setFieldLabelId` context.** Beyond the plan, the shell publishes a per-instance label id so the `Input` rendered in the editor snippet gets a real `aria-labelledby` (the field name) instead of a generic "Value"/"New value". This is an additive a11y improvement that rides the same extraction; it is not part of the seven findings but does not conflict with them.
- **The spec's "add new storybook states" did not ship.** The design's Testing section called for new Storybook states — segment disabled-during-save, `:focus-visible` on a segment option and the icon-button, and the AiOutput hint rendered inside the card. The `AiOutputSection.stories.svelte` file still exposes only the original four stories (Populated/Empty/Error/Loading), and the visual spec (`tests/visual/settings/sections/AiOutputSection.spec.ts`) was re-shot for those baselines plus the existing narrow/hover interaction shots — no disabled-during-save or focus-visible shot was added. The new behaviors are covered by unit tests instead; the visual coverage gap is the one substantive verification shortfall.
- **`ConfigFieldRow` gained an enum revert-on-error path beyond the plan's scope.** The shipped `saveEnum` captures `previous`, optimistically sets `current`, and reverts on PATCH failure — pairing the silent revert with the already-rendered `.status-error` line (Finding 3's full intent). This predates/overlaps the plan's "pair the silent optimistic revert with the already-rendered error line" suggestion and is covered by an existing revert test.
- **The `--focus-ring` token value matches `Btn`'s prior literal exactly.** No visual change where the `Btn`/Input ring already applied; the two new sites (`IconButton`, `SegmentedControl`) gain the branded ring. The segment uses a negative `-2px` offset (vs the token's `--focus-ring-offset: 1px`) because `.ui-seg { overflow: hidden }` would clip a positive offset — called out in the plan.

The source plan `docs/superpowers/plans/2026-07-06-ai-output-ux-fixes.md` and design `docs/superpowers/specs/2026-07-06-ai-output-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
