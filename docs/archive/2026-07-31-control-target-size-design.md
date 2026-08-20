<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Control target size floor

**Date:** 2026-07-31
**Status:** Design approved, pending spec review

## Problem

The shared `Btn` primitive renders `size="sm"` at `height: 22px`
(`client/shared/ui/Btn.svelte:105`–`109`), and `SegmentedControl` hardcodes the same
22px (`client/shared/ui/SegmentedControl.svelte:65`). Both are bare interactive
controls: the whole clickable area is the control box.

WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum) puts the floor at 24×24 CSS px. Both primitives
sit 2px under it, on every surface that uses them — 117 `size="sm"` usages across 46 files,
spanning all four SPAs (settings, admin, debug, transcript). A third primitive, `Seg`,
declares no height at all and lands at roughly 21–22px from font size plus padding
(`client/shared/ui/Seg.svelte:35`–`39`).

The finding surfaced in the CodeHostSection UX review
([`docs/ux-reviews/CodeHostSection.md`](../../ux-reviews/CodeHostSection.md), "[Med] Every
control in the section is 22px tall"), where the section's entire action set — Replace,
Cancel, Clear, and Save — is `sm`. It is not section-local: the same review notes the
header's `IconButton` clears the floor at 28px
(`client/shared/ui/IconButton.svelte:31`–`33`), so the design system is internally
inconsistent about its own control sizing.

The root cause is that control heights are **literal values repeated inside each
primitive** rather than drawn from the shared scale. `tokens.css` already centralizes
spacing (`--gap-*`), radius (`--radius-*`), and row height (`--row-h`), but has no
control-height scale — so nothing stops the next primitive from drifting below the floor
the same way. Rubric dimension 8 exists to catch exactly this ("Are control sizes … pulled
from the shared size tokens instead of hardcoded, so siblings match?").

## Scope

This is sub-project **C** of four decomposed from the CodeHostSection review. The others
are tracked separately and are not addressed here:

- **A** — namespace-aware story fixtures (the MSW layer never reads request params, so
  CodeHostSection's stories serve the wrong namespace).
- **B** — `SettingsFieldShell` ↔ `Field` parity (inline validation / error channel).
- **D** — CodeHostSection's section-local fixes.

C is independent of A, B, and D. It is sequenced **first**, because it changes control
heights and therefore invalidates every screenshot baseline; landing it before A, B, and D
means their shots are read once at final control sizes rather than being re-shot afterward.
Note this costs review attention, not repository churn: `.storybook-shots/**` is gitignored
and always rewritten via `--update-snapshots`, so no baseline diff is ever committed.

## Design

### 1. Token scale

Add a control-height scale to the layout-and-sizing block in `client/shared/tokens.css`,
beside `--row-h`:

```css
--control-h-sm: 24px; /* WCAG 2.2 AA SC 2.5.8 floor */
--control-h-md: 28px;
--control-h-lg: 34px;
```

All three steps are defined, not just `sm`. Defining only the changed step would leave
`md` and `lg` hardcoded, and the guard in section 3 could then police only one third of
the surface.

### 2. Primitives consume the scale

- `client/shared/ui/Btn.svelte:105`–`119` — the `sm` / `md` / `lg` rules replace their
  height literals with `var(--control-h-sm|md|lg)`. Only `sm` changes rendered value
  (22px → 24px); `md` and `lg` are refactors at identical size and contribute no
  screenshot diff.
- `client/shared/ui/SegmentedControl.svelte:65` — `height: 22px` → `var(--control-h-sm)`.
- `client/shared/ui/IconButton.svelte:33`–`34` — already compliant at 28px; `width` and
  `height` both move to `var(--control-h-md)` (it is square), with no visual change.
- `client/shared/ui/Seg.svelte:35`–`39` — `.ui-seg__btn` declares no height at all: it is
  `font-size: 11px` plus `padding: 4px 10px`, which computes to roughly 21–22px. Add
  `min-height: var(--control-h-sm)` so the auto-height button cannot fall below the floor.
  This is the one place the section-3 guard structurally cannot see, which is why it is
  fixed explicitly here rather than left to the guard.

`box-sizing: border-box` is universal (`client/shared/base.css:5`–`9`), so `height` is the
full box: padding and border sit inside it, and the existing `padding: 3px 8px` on `sm`
needs no adjustment. Under `inline-flex` with `align-items: center`, the vertical padding
is inert. The change is a clean +2px.

**Net rendered effect:** every `size="sm"` button, every segmented control, and every `Seg`
button grows 2–3px taller across all four SPAs. Nothing else moves.

### 3. Enforcement guard

New file `tests/client/shared/control-target-size.test.ts`, following the source-scan shape
already established by `tests/no-demo-mode.test.ts` (Bun `Glob` over source, banned
pattern, assert an empty offender list). Three assertions:

**3.1 — The floor holds.** Parse the `--control-h-*` declarations out of `tokens.css` and
assert each value is ≥ 24px. This catches a later change that quietly lowers the floor.
The three token names are also appended to the existing layout-and-sizing list in
`tests/client/shared/tokens.test.ts:29`.

**3.2 — Interactive primitives do not hardcode heights.** For an explicit interactive set —
`Btn`, `SegmentedControl`, `IconButton`, `Seg` — assert the file contains no literal
`height: <n>px`. Heights must resolve through `var(--control-h-*)`.

**3.3 — Closed-world ratchet.** Scan *all* of `client/shared/ui/*.svelte` for literal
`height` / `min-height` px declarations. Every file that declares one must appear in either
the interactive set from 3.2 or an explicit `EXEMPT` map whose values are one-line
justifications. A scan of the current tree turns up exactly nine such declarations, in six
files; after section 2 the four remaining ones are all non-targets:

| Component                  | Reason                                                   |
| -------------------------- | -------------------------------------------------------- |
| `Checkbox`                 | 16px box sits inside a clickable `<label>` (`:22`, `:48`) |
| `Meter`                    | 5px progress bar, non-interactive                        |
| `EmptyState`, `ErrorState` | `min-height: 120px` on a layout container, not a target  |

Assertion 3.3 is what distinguishes this from a plain token refactor. Without it, the guard
only polices the handful of files someone remembered to list. With it, a **new** primitive that
hardcodes a height fails the suite until someone consciously either tokenizes it or exempts
it with a stated reason — the same ratchet shape as the mutation baseline and the coverage
floor.

**Known limitation, accepted deliberately.** The guard reads CSS as text, so it enforces
*discipline* (values come from tokens) rather than *computed geometry*. A component can
still render under 24px via padding on an auto-height element — `Seg` does exactly that
today — and the guard would not see it. Asserting computed geometry would mean booting a
browser per primitive, which is what the screenshot suite already does; duplicating it here
is not worth the cost. The `EXEMPT` reasons and the explicit `min-height` on `Seg` are the
human check on that gap.

### 4. Re-baseline and verification

`bun shoot` full sweep regenerates every baseline. The expected diff is uniform: `sm`
buttons, segmented controls, and `Seg` buttons 2–3px taller, nothing else.

The active risk is where +2px meets a constrained container. Review the regenerated shots
for `Toolbar`, `TopBar`, `DataTable` rows, and `Seg` groups, where growth could wrap, clip,
or introduce a scrollbar.

Acceptance:

1. `bun run check` passes (lint, typecheck, format, license headers).
2. `tests/client/shared/control-target-size.test.ts` passes, and fails when
   `--control-h-sm` is temporarily set to 22px (verify the guard actually guards).
3. The `bun shoot` sweep shows no change other than 2–3px of control growth — specifically
   no new wrapping, clipping, or scrollbars in the four container components named above.

## Alternatives considered

**Direct bump.** Change the two literals to 24px and re-baseline. Minimal diff, but leaves
heights hardcoded per primitive, so the next control can drift below the floor again — the
same root cause that produced this finding.

**Bump via token, no guard.** Adds the scale and removes the hardcoding, but nothing
prevents a future primitive from bypassing the token. Rejected in favour of the guard given
how much this repo already relies on ratchets and gates (mutation baseline, coverage floor,
write-hook policy).

**28px instead of 24px.** Comfortably compliant and would make every control in a row the
same height, but it collapses the distinction between `sm` and `md`, effectively deleting a
size step, for a much larger visual diff.

**44px (SC 2.5.5, AAA).** Matches the existing `--row-h` token, but would substantially
change the density of every SPA including operator tables. Rejected as disproportionate for
a dense mono console.

**Settings SPA only.** Would fix the end-user-facing surface and leave admin/debug at 22px
as deliberate operator density, but it requires either a settings-scoped override or
migrating those call sites to `md` — after which the `sm` token no longer means one thing.
Rejected: the accessibility floor is unconditional and one token should have one meaning.
