<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AiOutputSection

**Date:** 2026-07-06
**Reviewed:** `client/settings/sections/AiOutputSection.svelte` (renders via `client/settings/components/ConfigFieldRow.svelte` + `client/shared/ui/SegmentedControl.svelte`)
**States captured:** Populated, Empty, Error, Loading, hover-Raw-segment, hover-Clear, narrow-640 · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                                                                       |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Header rhythm is correct, but the field label "Output detail level" renders as dim 12px mono (`--fg2`), the same colour as the hint below it, so nothing reads as the primary label.                                                                                       |
| 2. Affordance & signifiers      | pass  | The segmented control shows the selected option in solid green vs. muted unselected; Clear and the refresh icon-button both carry borders — everything interactive looks interactive.                                                                                      |
| 3. Consistency w/ design system | warn  | Reuses `PageHeader`/`EmptyState`/`ErrorState`/`IconButton`/`SegmentedControl`/`Btn` well, but the segment radius (`--radius` 6px) diverges from the Clear button beside it (`--radius-control` 2px), and settings components lean on legacy aliases (`--fg2`/`--surface`). |
| 4. Feedback & state             | warn  | Loading/empty/error all use shared components with retry, but a successful save has no confirmation beyond the optimistic segment move, and there is no busy state while it persists.                                                                                      |
| 5. Content & language           | pass  | Label and options are plain; the hint usefully warns that Raw shows unredacted tool I/O and reasoning — real, non-decorative helper text.                                                                                                                                  |
| 6. Accessibility                | warn  | The unselected segment label (`--text-dim` on `--surface-2`) is ≈3.6:1 at 11px — under the WCAG minimum; the privacy-relevant Raw warning is not tied to the control via `aria-describedby`.                                                                               |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px; `flex-wrap` keeps the label and controls tidy on one row; no overflow, clipping, or truncation.                                                                                                                                                  |
| 8. Spacing, alignment & sizing  | warn  | Control heights in the row don't share a baseline (segment 26px, `sm` Clear 22px, refresh 28px) and three different corner radii (0 / 2px / 6px) meet in one card.                                                                                                         |
| 9. Interaction & micro-states   | warn  | Hover states exist on the segment and buttons and `Btn` has a `:focus-visible` ring, but the segmented control is never disabled while saving (Clear is), gives no in-flight signal, and silently reverts on error.                                                        |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

> Several findings live in the shared `SegmentedControl`/`ConfigFieldRow` primitives rather than in `AiOutputSection` itself; this is the surface where they are visible, and a fix would land in the primitive.

### [Med] Unselected segment label falls below the contrast minimum

- **Dimension:** 6. Accessibility
- **Where visible:** Populated / hover-Raw / narrow-640 — the "Raw" option at rest is a dim grey that nearly dissolves into its cell
- **Source:** `client/shared/ui/SegmentedControl.svelte:56` (`.ui-seg__opt { color: var(--text-dim) }`); `--text-dim` = `#6b766e` (`client/shared/tokens.css:21`) on `--surface-2` `#171c18` ≈ 3.6:1 at 11px, below the 4.5:1 needed for text this size
- **Suggested fix:** Lift the resting (unselected) segment label to at least `--text-muted`, keeping the selected option's accent fill as the differentiator, so both options clear the WCAG minimum.

### [Med] Privacy-sensitive "Raw" warning is not associated with the control

- **Dimension:** 6. Accessibility
- **Where visible:** Populated — the "Raw detail shows unredacted tool inputs/outputs and reasoning in chat." line sits below the control as a detached paragraph
- **Source:** `client/settings/sections/AiOutputSection.svelte:77` (standalone `<p class="ai-output-hint">`) vs. the control's `ariaLabel` only at `client/settings/components/ConfigFieldRow.svelte:114`; no `aria-describedby` links them
- **Suggested fix:** Give the hint an id and reference it from the segmented control's `aria-describedby` so a screen-reader user toggling to Raw hears that it exposes unredacted output before committing.

### [Med] The toggle gives no in-flight feedback and reverts silently on failure

- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not capturable in a single frame — behaviour observed in source: `saveEnum` sets `saving = true` and updates `current` optimistically, but only the Clear button reads `disabled={saving}`
- **Source:** `client/settings/components/ConfigFieldRow.svelte:89-104` (`saveEnum`), `:111-116` (segmented control has no `disabled`/busy prop), `:118` (Clear is `disabled={saving}`)
- **Suggested fix:** Signal the pending write on the control itself (disable or dim the segment while `saving`) so a slow save isn't a dead frame, and pair the silent optimistic revert with the already-rendered error line.

### [Low] Controls in the field row don't share a height baseline or radius

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated / narrow-640 — the Standard·Raw segment, the Clear button, and the refresh icon sit at visibly different heights and corner roundings
- **Source:** segment `height: 26px` + `border-radius: var(--radius)` 6px (`client/shared/ui/SegmentedControl.svelte:49,61`); `sm` Btn `height: 22px` + `--radius-control` 2px (`client/shared/ui/Btn.svelte:63,108`); refresh `28px` (`client/shared/ui/IconButton.svelte:33`); enclosing `.settings-field` has no radius (`client/settings/components/ConfigFieldRow.svelte:180-186`)
- **Suggested fix:** Align the segmented-control height and radius to the shared `sm`-control tokens so siblings in one row share a common baseline and corner treatment.

### [Low] Field label and helper text collapse to one visual tier

- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated — "Output detail level" and the hint below read at the same muted weight, so the label doesn't announce itself as the field's name
- **Source:** label `.settings-field__label { color: var(--fg2); font-size: 12px }` (`client/settings/components/ConfigFieldRow.svelte:193-198`) vs. hint `.ai-output-hint { color: var(--fg2); font-size: 12px }` (`client/settings/sections/AiOutputSection.svelte:88-91`) — identical colour
- **Suggested fix:** Differentiate the two tiers (brighten/strengthen the label or drop the hint to a dimmer/smaller meta style) so the label clearly outranks its helper text.

### [Low] Segmented control and icon-button lack an explicit focus ring

- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in shots (programmatic focus doesn't trigger `:focus-visible`); confirmed absent in source
- **Source:** `client/shared/ui/SegmentedControl.svelte:45-70` and `client/shared/ui/IconButton.svelte:28-45` define no `:focus-visible` rule, unlike `client/shared/ui/Btn.svelte:74-77` which draws a branded accent ring
- **Suggested fix:** Add the same `:focus-visible` accent outline used by `Btn` to the segment options and icon-button so keyboard focus is branded and consistent rather than relying on the UA default.

### [Low] Settings components use legacy token aliases

- **Dimension:** 3. Consistency with the design system
- **Where visible:** Not visible; consistency/maintenance drift from source
- **Source:** `ConfigFieldRow` uses `--fg2` and `--surface` (`client/settings/components/ConfigFieldRow.svelte:185,194`), which `client/shared/tokens.css:66,70` labels as legacy aliases for `--surface-1`/`--text-muted` intended for the debug/admin SPAs
- **Suggested fix:** Point settings-surface components at the canonical `--surface-1`/`--text-muted` names so the settings SPA doesn't depend on aliases scoped to other apps.
