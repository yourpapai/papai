<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AiOutputSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/AiOutputSection.svelte` (renders via `client/settings/components/ConfigFieldRow.svelte` → `client/settings/components/SettingsFieldShell.svelte` + `client/shared/ui/SegmentedControl.svelte`)
**States captured:** Populated, Empty, Error, Loading, hover-Raw-segment, hover-Clear, narrow-640 · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                                                                       |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | The field label "Output detail level" now renders in `--text` (bright) while the hint below it is `--text-muted` (dim) — the two tiers are visually distinct in the current Populated shot.                                                                              |
| 2. Affordance & signifiers      | pass  | The segmented control shows the selected option in solid green vs. muted unselected; Clear and the refresh icon-button both carry borders — everything interactive looks interactive.                                                                                      |
| 3. Consistency w/ design system | pass  | Reuses `PageHeader`/`EmptyState`/`ErrorState`/`IconButton`/`SegmentedControl`/`Btn`/`SettingsFieldShell`; segment, Clear, and icon-button now share one radius token (`--radius-control`), and the legacy `--fg2`/`--surface` aliases are gone from both the component and `tokens.css`. |
| 4. Feedback & state             | warn  | Loading/empty/error all use shared components with retry, and the segmented control now disables and shows a visible `role="alert"` error on a failed save; there is still no positive confirmation of a *successful* save beyond the segment having already moved.       |
| 5. Content & language           | pass  | Label and options are plain; the hint usefully warns that Raw shows unredacted tool I/O and reasoning in chat — real, non-decorative helper text that doesn't overclaim a platform-specific rendering behavior.                                                           |
| 6. Accessibility                | pass  | The unselected segment label now uses `--text-muted` (~6.9:1 on `--surface-2`), clearing the WCAG minimum; the Raw warning hint is now linked to the control via `aria-describedby`.                                                                                        |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px; `flex-wrap` keeps the label and controls tidy on one row; no overflow, clipping, or truncation.                                                                                                                                                  |
| 8. Spacing, alignment & sizing  | pass  | Segment and Clear now share height (`--control-h-sm`, 24px) and radius (`--radius-control`, 2px); the header refresh icon-button is intentionally the larger `--control-h-md` header-action size, and shares the same 2px radius rather than a third value.               |
| 9. Interaction & micro-states   | pass  | Hover/focus-visible are present on the segment and icon-button, and the segmented control disables while saving with a visible error line on failure, and it now carries a distinct busy affordance — a `Saving…` caption plus `aria-busy="true"` — so an in-flight save is no longer indistinguishable from a plain disabled state. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

> Several findings live in the shared `SegmentedControl`/`ConfigFieldRow` primitives rather than in `AiOutputSection` itself; this is the surface where they are visible, and a fix would land in the primitive.

### [Med] Unselected segment label falls below the contrast minimum

- **Id:** ai-output-segment-label-contrast
- **Status:** fixed
- **Resolved:** `4525aacc8` ("fix(ui): raise SegmentedControl contrast and align height/radius to sm controls") switched the unselected option colour from `--text-dim` to `--text-muted`; `ca47dbb7a` separately raised the dim-text tokens.
- **Dimension:** 6. Accessibility
- **Where visible:** Populated / hover-Raw / narrow-640 — the "Raw" option at rest is now a clearly legible grey, not a near-invisible dim tone
- **Source:** `client/shared/ui/SegmentedControl.svelte:60` (`.ui-seg__opt { color: var(--text-muted) }`); `--text-muted` = `#9aa79d` (`client/shared/tokens.css:20`) on `--surface-2` `#171c18` ≈ 6.9:1, clearing the 4.5:1 minimum for 11px text
- **Suggested fix:** N/A — resolved.

### [Med] Privacy-sensitive "Raw" warning is not associated with the control

- **Id:** ai-output-raw-warning-not-associated
- **Status:** fixed
- **Resolved:** `4212e2945` ("feat(settings): ConfigFieldRow hint prop, aria wiring, in-flight disable, brighter label") added `hintId` + wired `ariaDescribedBy` on the segmented control; `0189895ab` ("fix(settings): associate enum-field errors with the segmented control") extended it to also compose the error id.
- **Dimension:** 6. Accessibility
- **Where visible:** Populated — the hint still renders as a paragraph below the control, but it is now programmatically linked to it
- **Source:** `AiOutputSection.svelte` passes `hint=` into `ConfigFieldRow` (`client/settings/sections/AiOutputSection.svelte:79-81`); `ConfigFieldRow.svelte:46` derives `hintId`, `:52-55` `segmentedDescribedBy()` composes `[errorId, hintId]`, and `:132` sets `ariaDescribedBy={segmentedDescribedBy(errorId)}` on `SegmentedControl`, whose `:31` wires `aria-describedby={ariaDescribedBy}` onto the `radiogroup`
- **Suggested fix:** N/A — resolved.

### [Low] The toggle disables and shows an error, but still has no positive busy indicator

- **Id:** ai-output-toggle-no-feedback
- **Status:** fixed
- **Resolved:** `5f68a5013`. `client/shared/ui/SegmentedControl.svelte` gained an optional
  `busy?: boolean` prop (default `false`) that renders a `Saving…` caption beside the control
  and sets `aria-busy="true"` on the `role="radiogroup"` element;
  `client/settings/components/ConfigFieldRow.svelte` passes `busy={saving}` alongside its
  existing `disabled={saving}`. The wording reuses the text-field `Save` button's existing
  `Saving…` label. A static caption was chosen over the suggested pulsing accent because it
  needs no `prefers-reduced-motion` fallback, is deterministic to screenshot, and — paired with
  `aria-busy` — reaches screen-reader users, which an opacity change never did. The frame is
  pinned by `.storybook-shots/shared/ui/SegmentedControl.spec.ts/shared-ui-SegmentedControl-Busy-1.png`. `busy` is
  presentational plus aria only; `disabled` still carries all behavioural blocking, so the three
  other consumers are unchanged.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not capturable in a single frame — behaviour confirmed in source: `saveEnum` sets `saving = true`, updates `current` optimistically, and now passes `disabled={saving}` to `SegmentedControl` (which dims to `opacity: 0.5` and shows `cursor: not-allowed`); on failure it reverts `current` and renders the message via `role="alert"`. What remains: the only "in-flight" signal is the disabled-dim treatment shared with every other disabled state — there is no distinct busy/spinner cue (unlike the `Save` button elsewhere in the same primitive, which swaps its label to "Saving…"), so a slow save and a merely-disabled control look identical.
- **Source:** `client/settings/components/ConfigFieldRow.svelte:107-122` (`saveEnum`), `:133` (`disabled={saving}` on `SegmentedControl`), `client/shared/ui/SegmentedControl.svelte:73-76` (`:disabled { opacity: 0.5 }`, no distinct busy state) vs. `client/settings/components/ConfigFieldRow.svelte:177` (`{saving ? 'Saving…' : 'Save'}` on the text-field `Save` button, showing the pattern exists elsewhere but isn't applied to the segmented control)
- **Suggested fix:** Give the segmented control a busy visual distinct from plain-disabled (e.g. a subtle pulsing accent on the selected segment) while `saving`, mirroring the text-field Save button's "Saving…" label.

### [Low] No positive confirmation that a save actually succeeded

- **Id:** ai-output-no-save-confirmation
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** Not capturable in a single frame — behaviour confirmed in source: after `saveEnum` resolves, the segmented control simply stops being disabled and shows the newly-selected option; there is no toast, inline "Saved" text, or other transient signal distinguishing a completed save from the control having just never been touched.
- **Source:** `client/settings/components/ConfigFieldRow.svelte:114-115` — `await patchConfig({ key: field.key, value: next, contextId })` is immediately followed by `onSaved()` (`AiOutputSection.svelte:82`'s `() => void load(contextId)`), which only re-fetches fields; neither call surfaces any success indicator to the user.
- **Suggested fix:** Show a brief, auto-dismissing "Saved" confirmation (e.g. next to the control or via a shared toast) when `saveEnum` resolves successfully.

### [Low] Controls in the field row don't share a height baseline or radius

- **Id:** ai-output-controls-misaligned
- **Status:** fixed
- **Resolved:** `4525aacc8` ("fix(ui): raise SegmentedControl contrast and align height/radius to sm controls") moved the segment to `--radius-control`; `19028f289` ("fix(ui): unify control radius on --radius-control (2px)") did the same for `Btn`/`IconButton`; `d1433ac34` ("fix(ui): raise sm controls to the 24px WCAG target-size floor") aligned the segment's height to the shared `--control-h-sm` token used by `sm` `Btn`.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated / narrow-640 — the Standard·Raw segment and the Clear button now sit at the same height with the same corner rounding
- **Source:** segment `height: var(--control-h-sm)` (24px) + `border-radius: var(--radius-control)` (`client/shared/ui/SegmentedControl.svelte:53,65`); `sm` Btn `height: var(--control-h-sm)` + `border-radius: var(--radius-control)` (`client/shared/ui/Btn.svelte:66,111`); the header refresh `IconButton` is deliberately the larger `--control-h-md` (28px) header-action size but shares the same `--radius-control` (`client/shared/ui/IconButton.svelte:33-34,37`) — one radius token used throughout, not three
- **Suggested fix:** N/A — resolved. (The remaining height difference between the in-row segment/Clear pair and the header's refresh icon-button is an intentional header-action vs. field-control size distinction, not a one-off value.)

### [Low] Field label and helper text collapse to one visual tier

- **Id:** ai-output-label-helper-collapse
- **Status:** fixed
- **Resolved:** `4212e2945` ("feat(settings): ConfigFieldRow hint prop, aria wiring, in-flight disable, brighter label") changed the label colour from `--fg2` to `--text` while leaving the hint at `--text-muted`.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated — "Output detail level" now renders visibly brighter (white) than the muted grey hint underneath it, confirmed in `.storybook-shots/settings/sections/AiOutputSection.spec.ts/settings-sections-AiOutputSection-Populated-1.png`
- **Source:** label `.settings-field__label { color: var(--text); font-size: 12px }` (`client/settings/components/SettingsFieldShell.svelte:92-97`) vs. hint `.settings-field__hint { color: var(--text-muted); font-size: 12px }` (`client/settings/components/SettingsFieldShell.svelte:117-121`) — two distinct tiers
- **Suggested fix:** N/A — resolved.

### [Low] Segmented control and icon-button lack an explicit focus ring

- **Id:** ai-output-missing-focus-ring
- **Status:** fixed
- **Resolved:** `d1825ffd9` ("refactor(ui): add --focus-ring token and adopt in shared controls") introduced the shared `--focus-ring` token and adopted it across `SegmentedControl`/`Btn`; `2d69e1f81` ("fix(debug+shared): distinct operator signifier, aria names on icon buttons") added the same to `IconButton`.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in shots (programmatic focus doesn't trigger `:focus-visible`); confirmed present in source
- **Source:** `client/shared/ui/SegmentedControl.svelte:68-71` (`.ui-seg__opt:focus-visible { outline: var(--focus-ring); outline-offset: -2px }`) and `client/shared/ui/IconButton.svelte:44-47` (`.ui-iconbtn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset) }`), matching `client/shared/ui/Btn.svelte:77-80`
- **Suggested fix:** N/A — resolved.

### [Low] Settings components use legacy token aliases

- **Id:** ai-output-legacy-token-aliases
- **Status:** fixed
- **Resolved:** `4212e2945` moved `ConfigFieldRow`'s surface/label colours onto `--surface-1`/`--text`; `09f46aa3c` ("refactor(client): migrate 314 legacy token aliases to the semantic vocabulary") migrated the remaining legacy-alias call sites app-wide; `cc4d40804` ("refactor(client): delete the legacy token alias block") removed the alias definitions from `tokens.css` entirely.
- **Dimension:** 3. Consistency with the design system
- **Where visible:** Not visible; consistency/maintenance drift from source
- **Source:** `client/shared/tokens.css` no longer defines `--fg2` or a legacy `--surface` alias anywhere in the file (see the full token list at `client/shared/tokens.css:1-77`); the field shell now reads `--surface-1`/`--text`/`--text-muted` directly (`client/settings/components/SettingsFieldShell.svelte:84,93,119`)
- **Suggested fix:** N/A — resolved.
