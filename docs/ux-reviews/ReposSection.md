<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ReposSection

**Date:** 2026-08-01
**Reviewed:** `client/settings/sections/ReposSection.svelte`
**States captured:** Populated, Empty, Error, Loading, add-submit disabled + hover, name input focused, preset select focused, egress textarea focused, form filled (primary enabled), post-add success, row delete hover, long-content add form · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | The primary form is headed by the dimmest text on screen ("Add repository", 11px `--fg3`), and the repo list itself carries no heading or count.        |
| 2. Affordance & signifiers      | fail  | The only destructive control is a borderless `ghost` button in muted `--fg2`; nothing signals it is destructive, and there is no edit affordance at all. |
| 3. Consistency w/ design system | fail  | Raw `<select>`/`<textarea>` with one-off styling instead of `Select`/`Input multiline`; no `Confirm` and no `EmptyState` while ~9 sibling sections use both. |
| 4. Feedback & state             | fail  | Zero repos renders no empty state; the primary button is disabled with no indication of why; delete fires immediately with no confirmation.             |
| 5. Content & language           | warn  | Raw backend error text is surfaced verbatim ("boom"); the three permission presets are unexplained jargon on a security-relevant choice.                |
| 6. Accessibility                | fail  | The preset select and egress textarea have no accessible name; status/error messages are not announced; `--fg3` meta text measures ~3.96:1 on `--surface`. |
| 7. Responsive / layout          | warn  | Add-form fields are fixed-min and never grow, so long values truncate at 640px while unused width sits to the right and the textarea runs full-bleed.   |
| 8. Spacing, alignment & sizing  | fail  | Every gap/padding is hardcoded px rather than a spacing token, and the 30px native select against 28px inputs leaves the label row 2px ragged.          |
| 9. Interaction & micro-states   | warn  | Shared `Btn` supplies hover/disabled/busy, but the raw controls own no focus style, and the success message never clears or moves toward the action.    |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Deleting a repository is immediate and irreversible, with no confirmation

- **Id:** repos-delete-no-confirmation
- **Status:** open
- **Dimension:** 4. Feedback & state (also 2. Affordance & signifiers)
- **Where visible:** `Populated`, `ReposSection — delete hover on a row` — one click on "Delete" removes the repo; no dialog, no undo.
- **Source:** `client/settings/sections/ReposSection.svelte:128` (delete `Btn`) → `:88` (`handleDelete`, straight to `deleteRepo`)
- **Suggested fix:** Gate the delete behind the shared `Confirm` dialog naming the repository, as `MembersSection`, `MemorySection`, `CodeHostSection` and six other sections already do.

### [High] The permission select and egress textarea have no accessible name

- **Id:** repos-inputs-no-accessible-name
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in any screenshot — source-only; `ReposSection — preset select focused`, `ReposSection — egress textarea focused` show the affected controls.
- **Source:** `client/settings/sections/ReposSection.svelte:166` (raw `<select>`), `:177` (raw `<textarea>`) — `Field` publishes its label only as a `<span id>` consumed via `aria-labelledby` (`client/shared/ui/Field.svelte:38`), which `Input`/`Select` read but these raw controls do not.
- **Suggested fix:** Route both controls through the shared `Select` and `Input multiline` primitives so they pick up the field's `aria-labelledby`, `aria-invalid`, and `aria-describedby` wiring.

### [High] A context with no repositories renders no empty state

- **Id:** repos-no-empty-state
- **Status:** open
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** `Empty` (desktop and narrow) — the list area collapses to nothing and the page opens straight onto the add form, with no confirmation that the fetch succeeded and nothing was there.
- **Source:** `client/settings/sections/ReposSection.svelte:118-138` — the `{#each}` has no `{:else}` branch.
- **Suggested fix:** Add an `EmptyState` (already used by `PluginsSection`, `MemorySection`, `KaneoAccessSection`) stating no repositories are connected and what adding one enables.

### [High] "Add" is disabled with no indication of which fields are required

- **Id:** repos-add-disabled-no-indication
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `Empty`, `ReposSection — add submit disabled, hover` — the button is dimmed at rest and hovering changes nothing; all five labels look identical, and the one optional field is indistinguishable from the three mandatory ones.
- **Source:** `client/settings/sections/ReposSection.svelte:191` (disabled on `addName`/`addUrl`/`addBranch` being blank); `Field` exposes an unused `required` prop at `client/shared/ui/Field.svelte:20`.
- **Suggested fix:** Mark Name / Repository URL / Base branch with `Field required` so the disabled reason is readable from the form itself.

### [Med] Raw select and textarea visibly break from the sibling inputs

- **Id:** repos-raw-inputs-visual-break
- **Status:** open
- **Dimension:** 3. Consistency w/ design system (also 8. Spacing, alignment & sizing)
- **Where visible:** `Populated`, `Empty` — the preset control renders as a native OS select (system arrow, brighter text) and both it and the textarea sit on `--bg`, visibly darker than the `--raised` fill of the three inputs beside them.
- **Source:** `client/settings/sections/ReposSection.svelte:262-281` (`--bg` background, 6px 8px padding, no `--radius-control`) vs `client/shared/ui/Input.svelte` / `Select.svelte`, which use `--raised` and `--radius-control`.
- **Suggested fix:** Replace both one-off controls with the shared `Select` and `Input multiline` and delete the local styling.

### [Med] The destructive action is styled as the least prominent control on the row

- **Id:** repos-delete-low-affordance
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `Populated` — "Delete" is borderless muted text at the far right of each row; it reads as a caption until hovered.
- **Source:** `client/settings/sections/ReposSection.svelte:128-130` — `variant="ghost" size="sm"` (`--fg2`, transparent border, 24px tall).
- **Suggested fix:** Use the `danger` variant so the control carries a border and the danger colour, matching how sibling sections present destructive row actions.

### [Med] Status and error messages are never announced and never clear

- **Id:** repos-status-not-announced-never-clears
- **Status:** open
- **Dimension:** 6. Accessibility (also 4. Feedback & state)
- **Where visible:** `ReposSection — added, success status` — "Repository added." appears at the very top of the section, ~380px above the button that was pressed, and stays there indefinitely.
- **Source:** `client/settings/sections/ReposSection.svelte:112-113` — plain `<p>` elements with no `role="status"` / `aria-live`.
- **Suggested fix:** Give the status/error pair a live region and place the add-form outcome next to the add form, timing out the success message.

### [Med] Meta and helper text fall below the AA contrast floor

- **Id:** repos-helper-text-low-contrast
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** `Populated` — the `main · cautious · egress: pypi.org` line and the "Add repository" label.
- **Source:** `client/settings/sections/ReposSection.svelte:235-241` (`--fg3` on `--surface`), `:247-252`, `:282-286` — `--fg3` (`#6b766e`) on `--surface-1` (`#111512`) measures ≈3.96:1 at 11px, under the 4.5:1 AA floor; `tokens.css:79` documents `--fg-hint` as the ≈6:1 colour intended for exactly this text.
- **Suggested fix:** Move the 11px meta/label/help text from `--fg3` to `--fg-hint`.

### [Med] A repository can only be added or deleted, never edited

- **Id:** repos-no-edit-capability
- **Status:** open
- **Dimension:** 4. Feedback & state (also 2. Affordance & signifiers)
- **Where visible:** `Populated` — each row shows branch, preset and egress domains as static text with no way to change them.
- **Source:** `client/settings/repos-fetchers.ts:16-34` — only `addRepo` and `deleteRepo` exist, so changing a preset means deleting the repo and re-adding it.
- **Suggested fix:** Either offer per-row editing of branch/preset/egress, or state on the row that these are fixed at creation so the delete-and-re-add path is a deliberate choice rather than a discovery.

### [Med] Add-form fields never use the available width

- **Id:** repos-add-form-narrow-fields
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `ReposSection — long content in the add form, narrow` — at 640px the three inputs stay ~180px and truncate ("https://gitlab.self-ho", "release/2026-08-long-l") while ~250px of empty row sits to their right and the textarea below them spans the full width.
- **Source:** `client/settings/sections/ReposSection.svelte:259-261` (`min-width: 180px` with no `flex: 1`), `:253-258` (`flex-wrap` row).
- **Suggested fix:** Let the wrapped fields grow to fill their row so URL and branch values are readable at narrow widths.

### [Med] Load failures surface the raw backend string with no recovery affordance

- **Id:** repos-load-error-no-recovery
- **Status:** open
- **Dimension:** 5. Content & language (also 4. Feedback & state)
- **Where visible:** `Error` — the section shows a bare red `boom` under the title; the only retry is the unlabelled `⟳` glyph in the far top-right corner.
- **Source:** `client/settings/sections/ReposSection.svelte:52` (raw `err.message`), rendered at `:112`.
- **Suggested fix:** Frame the failure ("Couldn't load repositories") with the raw detail secondary, and put a retry action next to the message.

### [Low] The add form's spacing and sizing are all hardcoded px

- **Id:** repos-hardcoded-spacing
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `Populated` — the 2px offset between the `PERMISSION PRESET` label and its three neighbours, and the square repo rows against the rounded inputs.
- **Source:** `client/settings/sections/ReposSection.svelte:201-286` — `gap: 8px`, `margin-bottom: 20px`, `padding: 10px 12px`, `padding: 12px`, `gap: 12px` and a `border-radius`-less row, none drawn from `--gap-tight` / `--gap-field` / `--gap-inline` / `--radius-control`; the native select's 30px box against the 28px `--control-h-md` inputs is what makes the label row ragged under `align-items: end`.
- **Suggested fix:** Pull the gaps, padding and radius from the spacing/size tokens, which also settles the select-vs-input height once the shared `Select` is in place.

### [Low] The egress help text is the widest, least readable line in the section

- **Id:** repos-egress-help-text-unreadable
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning (also 6. Accessibility)
- **Where visible:** `Populated`, `Empty` — a single ~1230px unbroken sentence spanning the whole section at desktop width.
- **Source:** `client/settings/sections/ReposSection.svelte:183-186` — a hand-rolled `<p>` inside the field's children rather than `Field`'s `hint` slot (`client/shared/ui/Field.svelte:22`), so it is neither width-bounded nor referenced by the textarea's `aria-describedby`.
- **Suggested fix:** Pass the copy through `Field hint` so it inherits the field width, the hint colour, and the describedby wiring.

### [Low] The three permission presets are unexplained on a security-relevant choice

- **Id:** repos-permission-presets-unexplained
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `Populated` — the select offers `autonomous` / `cautious` / `readonly` and rows print the chosen value bare, with no statement of what each grants.
- **Source:** `client/settings/sections/ReposSection.svelte:169-171`
- **Suggested fix:** Give each option a short consequence-bearing label or a field hint describing what the preset lets a coding session do.

### [Low] Egress input is silently normalised

- **Id:** repos-egress-silently-normalised
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** Not visible in the screenshots — source-only.
- **Source:** `client/settings/sections/ReposSection.svelte:32-40` — `parseEgress` lowercases, trims and dedupes; the form then clears, so a user who typed `PyPI.org` twice never sees what was actually stored.
- **Suggested fix:** Echo the normalised domain list back on the saved row (the row already renders `egress: …`) or normalise visibly in the field on blur.

### [Low] The section has no heading element

- **Id:** repos-no-heading-element
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible — source-only.
- **Source:** `client/shared/ui/PageHeader.svelte:25` renders the title as a `<div>`; `client/settings/sections/ReposSection.svelte:142` renders "Add repository" as a `<p>`.
- **Suggested fix:** Promote both to real headings so the settings page is navigable by heading — the `PageHeader` half is shared and affects every reviewed section, not just this one.
