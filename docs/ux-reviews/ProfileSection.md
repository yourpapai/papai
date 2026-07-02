<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ProfileSection

**Date:** 2026-07-02 (re-review against the expanded 9-dimension rubric — adds dims 8 & 9)
**Reviewed:** `client/settings/sections/ProfileSection.svelte` (+ shared `client/settings/components/ConfigFieldRow.svelte`, which renders every row)
**States captured:** Populated, Empty, Error, Loading, input-focused, clear-confirm dialog, Save/Clear hover, long-value · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Why this section:** `profile` is the default landing view for every settings visit
(`SettingsApp.svelte:81`, `activeId = initialHash || 'profile'`) and sits at the top of the
primary "Personal" group. The populated view renders a single field: ProfileSection filters to
`field.kind === 'preference'` (`ProfileSection.svelte:25`), so the fixture's `ai-output` field
is excluded and only `display_name` shows.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                           |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow/title/label tiers are distinct; the single field is the clear focus.                                   |
| 2. Affordance & signifiers      | warn  | "Clear" (ghost) is indistinguishable from label text at rest — a background only appears on hover.             |
| 3. Consistency w/ design system | pass  | Reuses `PageHeader`, `Btn`, `Input`, `SegmentedControl`, `EmptyState`, `Confirm` — no one-off components.      |
| 4. Feedback & state             | warn  | All four states present, but the error state is a bare red string with no in-place retry.                      |
| 5. Content & language           | warn  | Empty state dead-ends with no next step; error surfaces the raw server message verbatim.                       |
| 6. Accessibility                | warn  | Keyboard focus ring handled app-wide (`.settings-grid :focus-visible`); empty-state hint contrast < AA.        |
| 7. Responsive / layout          | warn  | Long content scrolls cleanly at ~640px (no overflow), but the one-field layout looks sparse.                   |
| 8. Spacing, alignment & sizing  | warn  | Alignment is clean, but gaps/padding are hardcoded px off the `--gap-*` scale and radii disagree (2px vs 6px). |
| 9. Interaction & micro-states   | warn  | Hover/disabled/busy all exist, but every Save/Clear flashes the whole section to "Loading…" mid-write.         |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [Med] Every save/clear flashes the whole section to "Loading…"

- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not a single frame — the transition after pressing Save or confirming Clear (the field list is replaced by the Loading placeholder, then re-rendered).
- **Source:** `client/settings/sections/ProfileSection.svelte:61` (`onSaved={() => void load(contextId)}`) re-runs `load`, which sets `loading = true` (`:30`) and renders `<p class="placeholder">Loading…</p>` (`:55`) in place of every field — so a one-field save blanks the entire landing section.
- **Suggested fix:** Update the saved field in place (or use a non-blocking/row-local pending state) instead of flipping the whole section back to its full-page loading state.

### [Med] Error state is a raw message with no in-place recovery

- **Dimension:** 4. Feedback & state
- **Where visible:** Error state — a lone red `boom` under the title, nothing else.
- **Source:** `client/settings/sections/ProfileSection.svelte:53` (`<p class="status-error">{error}</p>`); the only retry is the unlabeled `⟳` icon button at `:48`.
- **Suggested fix:** Frame the failure (e.g. "Couldn't load profile settings") and offer an explicit labeled "Try again" action instead of relying on the header glyph.

### [Med] "Clear" destructive action looks like plain label text

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated (at rest "Clear" reads as label metadata); the Clear-hover shot shows a background only appears on hover — the sole resting signifier is absent.
- **Source:** `client/settings/components/ConfigFieldRow.svelte:138` uses `variant="ghost"` (`Btn.svelte`: ghost = transparent bg, `--fg2` text, transparent border) for an action that opens a _danger_ confirm dialog; a `danger` variant already exists.
- **Suggested fix:** Give "Clear" a button-shaped, destructive-leaning affordance (e.g. `danger`/`outline` variant) and/or separate it from the label cluster.

### [Med] Empty state dead-ends on the section every user lands on first

- **Dimension:** 5. Content & language
- **Where visible:** Empty state — "No profile settings / This context has no editable profile settings."
- **Source:** `client/settings/sections/ProfileSection.svelte:57`; `EmptyState.svelte` supports an `action` snippet, but none is passed.
- **Suggested fix:** Add an actionable next step (link to Task provider / a line explaining where preferences come from) so the default landing view isn't a blank end.

### [Low] Empty-state hint contrast is below WCAG AA

- **Dimension:** 6. Accessibility
- **Where visible:** Empty state — the "This context has no editable profile settings." hint line.
- **Source:** `client/shared/ui/EmptyState.svelte` `.ui-empty__hint` uses `--fg3` (`--text-dim` `#6b766e`) at 11px on `--bg` `#0a0c0a` ≈ 4:1, under the 4.5:1 AA threshold for normal text.
- **Suggested fix:** Bump the hint token or size (design-system-wide; affects every `EmptyState`).

### [Low] Spacing and radii are hardcoded off the shared scale

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated / long-value — alignment is clean, but the values don't come from the token scale.
- **Source:** `ProfileSection.svelte:70` list `gap: 12px`, `ConfigFieldRow.svelte:182-200` (`gap: 8px` / `10px`, `padding: 12px`) are literal px rather than `--gap-inline`/`--gap-field` (12/20px); radii disagree across primitives — `Btn.svelte:54` and `Input.svelte:57` use `2px` while `IconButton.svelte:37` uses `var(--radius)` (6px), so the header refresh button and the field's Save/input have different corners.
- **Suggested fix:** Draw field gaps/padding from the `--gap-*` tokens and reconcile the button/input corner radius against `--radius`.

### [Low] Section looks sparse / unbalanced when data is minimal

- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated (desktop) and narrow — one field, then a large empty expanse below.
- **Source:** `client/settings/sections/ProfileSection.svelte:59-63` (single-column field list, only `preference`-kind fields survive the filter at `:25`).
- **Suggested fix:** Acceptable as-is, but consider a short intro/helper line or grouping so a one-field profile doesn't read as a rendering gap.

### [Low] Refresh/retry is a glyph-only control

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** All states — the `⟳` icon button, top-right of the header.
- **Source:** `client/settings/sections/ProfileSection.svelte:48` (`IconButton` — has `aria-label`/`title` "Refresh", so screen-reader-named, but visually a bare glyph); it doubles as the sole retry path in the Error state.
- **Suggested fix:** Fine for the header, but don't make it the only recovery affordance mid-error (overlaps with the error-state finding above).
