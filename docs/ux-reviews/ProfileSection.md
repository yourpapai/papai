<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ProfileSection

**Date:** 2026-08-03 (re-review — most findings closed by shared-primitive and section-local fixes since 2026-07-02)
**Reviewed:** `client/settings/sections/ProfileSection.svelte` (+ shared `client/settings/components/ConfigFieldRow.svelte`, `SettingsFieldShell.svelte`, and primitives `Btn.svelte`, `Input.svelte`, `IconButton.svelte`, `EmptyState.svelte`, `ErrorState.svelte`, `tokens.css`)
**States captured:** Populated, Empty, Error, Loading, input-focused, clear-confirm dialog, Save/Clear hover, long-value · desktop + ~640px (unchanged)
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
| 1. Visual hierarchy & scanning  | pass  | Eyebrow/title/label tiers are distinct; the single field is the clear focus. `eyebrow="Personal"` (`ProfileSection.svelte:50`) also disambiguates per-user scope from the "Group"-eyebrow sections beside it in the nav. |
| 2. Affordance & signifiers      | pass  | "Clear" is now `variant="outline"` — a visible border at rest (`ConfigFieldRow.svelte:137,164`); the header refresh glyph is no longer the sole error-recovery path now that `ErrorState` supplies an explicit "Try again". |
| 3. Consistency w/ design system | pass  | Reuses `PageHeader`, `Btn`, `Input`, `SegmentedControl`, `EmptyState`, `ErrorState`, `Confirm` — no one-off components. |
| 4. Feedback & state             | pass  | All four states present; the error state now uses shared `ErrorState` with a labeled, working retry action.   |
| 5. Content & language           | pass  | Empty state now links to "Configure task provider →"; the error is framed under a "Something went wrong" title rather than a bare string. |
| 6. Accessibility                | pass  | Keyboard focus ring via `--focus-ring` on all controls; empty-state hint now renders at `--text-muted` (~7.8:1 on `--bg`), clear of the AA floor. |
| 7. Responsive / layout          | warn  | Long content scrolls cleanly at ~640px (no overflow); the one-field layout still leaves a large empty expanse below it despite the added intro line. |
| 8. Spacing, alignment & sizing  | pass  | Field-list and row gaps are drawn from `--gap-inline`/`--gap-tight`; `Btn`, `Input`, and `IconButton` all now share `--radius-control` (2px) — no more 2px-vs-6px disagreement. |
| 9. Interaction & micro-states   | pass  | Hover/disabled/busy all exist; Save/Clear no longer flash the whole section to "Loading…" — the placeholder only shows on the true initial load. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [Med] Every save/clear flashes the whole section to "Loading…"

- **Id:** profile-save-clear-full-flash
- **Status:** fixed
- **Resolved:** commit `7b4210424` ("fix(settings): ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro")
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** N/A — no longer reproduces.
- **Source:** `client/settings/sections/ProfileSection.svelte:61` now guards the placeholder with `{:else if loading && visible.length === 0}`; `load()` no longer clears `fields` before refetching, so `visible` stays populated during a refresh and the field list keeps rendering instead of being replaced by "Loading…".

### [Med] Error state is a raw message with no in-place recovery

- **Id:** profile-error-no-recovery
- **Status:** fixed
- **Resolved:** commit `7b4210424` ("fix(settings): ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro")
- **Dimension:** 4. Feedback & state
- **Where visible:** Error state screenshot (`settings-sections-ProfileSection-Error-1.png`) now shows a "Something went wrong" title, the `boom` message, and a bordered "Try again" button beneath it.
- **Source:** `client/settings/sections/ProfileSection.svelte:60` renders `<ErrorState message={error} onRetry={() => void load(contextId)} />`; `client/shared/ui/ErrorState.svelte:17,24-30` frames the failure under a title and renders a labeled, working `Btn variant="outline"` "Try again" action.

### [Med] "Clear" destructive action looks like plain label text

- **Id:** profile-clear-low-affordance
- **Status:** fixed
- **Resolved:** commit `765ad4958` ("fix(settings): outline Clear, right-align field actions, tokenize gaps")
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated screenshot (`settings-sections-ProfileSection-Populated-1.png`) — "Clear" now renders as a bordered chip at rest, distinct from the "Display name" label to its left.
- **Source:** `client/settings/components/ConfigFieldRow.svelte:137,164` now use `variant="outline"` (`Btn.svelte:92-96`: transparent bg, `var(--border)` border, visible at rest — no hover required).
- **Suggested fix:** N/A — resolved.

### [Med] Empty state dead-ends on the section every user lands on first

- **Id:** profile-empty-state-dead-end
- **Status:** fixed
- **Resolved:** commit `7b4210424` ("fix(settings): ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro")
- **Dimension:** 5. Content & language
- **Where visible:** Empty state screenshot (`settings-sections-ProfileSection-Empty-1.png`) now shows a "Configure task provider →" action link beneath the hint.
- **Source:** `client/settings/sections/ProfileSection.svelte:68-70` now passes an `action` snippet (`<a class="settings-empty-link" href="#task-provider">Configure task provider →</a>`) to `EmptyState`.

### [Low] Empty-state hint contrast is below WCAG AA

- **Id:** profile-empty-hint-low-contrast
- **Status:** fixed
- **Resolved:** commits `da44f30d0` ("fix(ui): raise EmptyState hint contrast to AA (--fg2)") and `09f46aa3c` (token vocabulary migration)
- **Dimension:** 6. Accessibility
- **Where visible:** Empty state screenshot — hint line "Personal preferences will appear here once this context has editable settings." now renders visibly lighter than the earlier low-contrast grey.
- **Source:** `client/shared/ui/EmptyState.svelte:48` (`.ui-empty__hint`) now uses `color: var(--text-muted)`; `client/shared/tokens.css:20` sets `--text-muted: #9aa79d`, ≈7.8:1 against `--bg: #0a0c0a` (`tokens.css:8`) — well clear of the 4.5:1 AA floor.

### [Low] Spacing and radii are hardcoded off the shared scale

- **Id:** profile-hardcoded-spacing
- **Status:** fixed
- **Resolved:** commits `5932fe9d4` ("style(settings): tokenize settings-field-list gap to --gap-inline"), `765ad4958` ("fix(settings): outline Clear, right-align field actions, tokenize gaps"), and `19028f289` ("fix(ui): unify control radius on --radius-control (2px)")
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated / long-value — same clean alignment, now confirmed token-backed rather than literal px.
- **Source:** `client/settings/sections/ProfileSection.svelte:84` (`gap: var(--gap-inline)`); `client/settings/components/SettingsFieldShell.svelte:80,89,105` (`var(--gap-tight)`/`var(--gap-inline)`) — `ConfigFieldRow.svelte` itself no longer declares layout gaps. Radii: `Btn.svelte:66`, `Input.svelte:97`, and `IconButton.svelte:37` all now read `border-radius: var(--radius-control)` (`tokens.css:54`, `2px`), so the header refresh button and the field's Save/input share the same corner radius.

### [Low] Section looks sparse / unbalanced when data is minimal

- **Id:** profile-sparse-layout-minimal-data
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated (`settings-sections-ProfileSection-Populated-1.png`) and narrow (`ProfileSection-—-populated-narrow-1.png`) — both still show one field row followed by a large empty expanse below it.
- **Narrowed:** Partially addressed — `PageHeader` now carries a descriptive `sub` intro ("Personal preferences for how the bot addresses and responds to you.", commit `7b4210424`), which was part of the original suggested fix. The remaining residue is purely visual: the field list still renders as a single bordered row with no grouping/framing, so the bulk of the viewport below it is still bare background at both desktop and ~640px.
- **Source:** `client/settings/sections/ProfileSection.svelte:59-77` (single-column field list, only `preference`-kind fields survive the filter at `:26`).
- **Suggested fix:** Consider a lightweight visual anchor (e.g. a subtle bordered panel/section wrapper sized to content, or additional grouping) rather than a bare field row floating at the top of an otherwise empty section.

### [Low] Refresh/retry is a glyph-only control

- **Id:** profile-refresh-glyph-only
- **Status:** fixed
- **Resolved:** commit `7b4210424` ("fix(settings): ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro")
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Error state screenshot — the header `⟳` glyph remains, but the Error state now also shows a labeled "Try again" button, so the glyph is no longer the sole recovery affordance.
- **Source:** `client/settings/sections/ProfileSection.svelte:55` (header `IconButton`, unchanged glyph-only affordance — still fine per the original note) plus `:60` now wiring `ErrorState`'s `onRetry`, which renders the labeled retry button at `client/shared/ui/ErrorState.svelte:24-30`. The specific defect flagged — the glyph being the *only* mid-error recovery path — no longer holds.
