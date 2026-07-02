<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — MembersSection

**Date:** 2026-07-03
**Reviewed:** `client/settings/sections/MembersSection.svelte` (+ shared `DataTable`, `IconButton`, `Btn`, `Field`, `Input`)
**States captured:** Populated, Empty, Error, Loading, add-input-focused, Add-button hover, populated · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Why this section:** Members is the fourth item in the primary "Personal" nav group
(`SettingsApp.svelte:95`) and the first section that appears once a context is a group — the
control surface for _who is allowed to use the bot in this group_. The three sections ahead of
it (Profile, Task provider, Tools) are already reviewed, making Members the next
most-prominent user-facing surface. It manages membership (add / list / remove) against the
group-members API and is a genuinely destructive surface (removing a member revokes access).

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                         |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow `GROUP` / title / field / table tiers are distinct; the add-form → member-table rhythm scans cleanly.                |
| 2. Affordance & signifiers      | warn  | "Remove" (ghost) reads like plain text at rest; the header refresh is a faint glyph — neither looks interactive until hover. |
| 3. Consistency w/ design system | warn  | Reuses the shared primitives, but skips `Confirm` (used by 8+ sibling sections) and the shared `formatDateTime` helper.      |
| 4. Feedback & state             | fail  | Loading is pixel-identical to Empty, Add gives no in-flight feedback, and the destructive Remove has no confirmation.        |
| 5. Content & language           | warn  | `added_at` is a raw ISO string and `added_by`/`user_id` are opaque ids; the empty state dead-ends on "No members".           |
| 6. Accessibility                | warn  | Focus ring handled app-wide (`.settings-grid :focus-visible`); refresh glyph (`--text-muted`) and ghost "Remove" run faint.  |
| 7. Responsive / layout          | warn  | Reflows cleanly at ~640px with short ids; long ids fall back to horizontal scroll, and 0–2 members leave a large empty span. |
| 8. Spacing, alignment & sizing  | warn  | `.settings-form align-items: end` is inert here — the full-width field drops the small `md` button to its own line.          |
| 9. Interaction & micro-states   | warn  | Hover exists on `Btn`; but Add/Remove never enter a busy/disabled state while their async request is in flight.              |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Removing a member revokes access with no confirmation

- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** Populated — each row's right-aligned "Remove".
- **Source:** `client/settings/sections/MembersSection.svelte:107` (`Btn … onClick={() => void remove(row.user_id)}`) calls `remove()` (`:52`) immediately; there is no interstitial. Eight-plus sibling sections (`MemorySection`, `CodeHostSection`, `CodingCredentialsSection`, `PluginsSection`, several `admin/*`) gate destructive actions behind the shared `Confirm` component — this one does not.
- **Suggested fix:** Gate Remove behind the shared `Confirm` dialog (naming the member) as sibling sections do, so a single mis-click can't silently revoke someone's access.

### [Med] Loading state is indistinguishable from Empty

- **Dimension:** 4. Feedback & state
- **Where visible:** Loading vs Empty — the two screenshots are pixel-identical; the table shows "No members" while the fetch is still in flight.
- **Source:** `MembersSection.svelte:62-64` (`$effect` → `load`) sets `loading = true` (`:29`) but the body still renders `memberRows` (empty during the initial load), so `DataTable` falls through to its `empty` snippet "No members" (`:115`). The only loading signal is the header `IconButton busy` (`:87`), a faint glyph most users won't notice.
- **Suggested fix:** When `loading` and no rows are present yet, render an in-body loading placeholder/skeleton instead of the empty-state copy, so "still loading" never reads as "nobody is a member".

### [Med] Add gives no in-flight feedback and allows double-submit

- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not a single frame — the interval after pressing "Add member" (button stays green, enabled, and unchanged while the request runs).
- **Source:** `MembersSection.svelte:39-50` (`add()` is async but sets no pending flag); the button (`:99-101`) has no `disabled`/busy binding, so it neither disables nor shows an "Adding…" state — a second click before `load()` returns re-submits.
- **Suggested fix:** Track a pending flag for the add request and bind it to the button (`disabled` + busy label) so the control signals in-flight work and blocks duplicate submits.

### [Med] Error is detached from the action that caused it and crowds the field label

- **Dimension:** 4. Feedback & state (also 8. Spacing)
- **Where visible:** Error — "boom" sits directly above the "USER ID OR @USERNAME" label with no breathing room, between the header and the form.
- **Source:** `MembersSection.svelte:91` renders the error `<p class="status-error">` at the top for _all_ failures; a Remove failure originates in the table far below (`:52`), so the message lands nowhere near its trigger. `.status-error` (`settings.css:91-93`) is a bare `color` rule with no margin, so it crowds the following label.
- **Suggested fix:** Surface add errors adjacent to the form and remove errors near the table/row, and give the status line vertical rhythm from the `--gap-*` scale.

### [Med] `added_at` is a raw ISO timestamp and bypasses the shared formatter

- **Dimension:** 5. Content & language (also 3. Consistency)
- **Where visible:** Populated — the "Added at" column reads `2026-05-01T00:00:00Z`.
- **Source:** `MembersSection.svelte:73` passes `m.added_at` through unchanged and `:111` stringifies it verbatim; `client/shared/helpers.ts:41` exports `formatDateTime()` for exactly this, used by other data tables.
- **Suggested fix:** Render `added_at` via the shared `formatDateTime` helper so the timestamp is human-readable and consistent with sibling tables.

### [Low] "Remove" and the refresh control read as non-interactive at rest

- **Dimension:** 2. Affordance & signifiers (also 6. Accessibility)
- **Where visible:** Populated (both "Remove" cells look like label text until hover); all states (the faint header `⟳`).
- **Source:** `MembersSection.svelte:107` uses `variant="ghost"` (`Btn.svelte:77-81`: transparent bg, `--fg2` text, transparent border) for a _destructive_ action; the refresh `IconButton` (`:87`) uses `--text-muted` on transparent (`IconButton.svelte:38`), running low-contrast on the dark theme.
- **Suggested fix:** Give the destructive Remove a button-shaped or `danger`-leaning affordance, and raise the refresh glyph's resting contrast.

### [Low] Add-form alignment rule is inert; the primary button is undersized under a full-width input

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated (desktop + narrow) — the full-width input, then a small "Add member" button dropped onto its own line below the hint.
- **Source:** `settings.css:38-44` (`.settings-form` `flex-wrap: wrap; align-items: end`) is written for an inline input-plus-button row, but the `Field` (`:93-98`) spans the row width so the `md` button (`:99`) wraps below — leaving `align-items: end` with nothing to align and the primary action visually small next to the input.
- **Suggested fix:** Either constrain the input width so the button sits inline (honoring `align-items: end`) or make the button full-width to match the input's visual weight.

### [Low] Empty state dead-ends on "No members"

- **Dimension:** 5. Content & language
- **Where visible:** Empty — the table body reads only "No members".
- **Source:** `MembersSection.svelte:115` (`{#snippet empty()}No members{/snippet}`); the add form directly above partly mitigates, but the copy offers no next step.
- **Suggested fix:** Acceptable as-is given the adjacent form, but a one-line pointer ("Add the first member above") would turn the dead-end into guidance.
