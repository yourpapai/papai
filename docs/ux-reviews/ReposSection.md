<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ReposSection

**Date:** 2026-08-02
**Reviewed:** `client/settings/sections/ReposSection.svelte`
**States captured:** Populated, Empty, Error, Loading, add-submit disabled + hover, name input focused, preset select focused, egress textarea focused, form filled (primary enabled), post-add success, row delete hover, delete confirm dialog, long-content add form · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                 |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | pass  | The list and add-form heading text now clears AA contrast (`--fg-hint`), and the add-form label is an `<h3>` beneath the section's `<h2>`, so the form is reachable by heading navigation. |
| 2. Affordance & signifiers      | pass  | Delete is now a bordered `danger` button behind a confirm dialog; the only residual is that editing still doesn't exist, softened by an explicit note. |
| 3. Consistency w/ design system | pass  | Preset select and egress textarea now route through shared `Select`/`Input multiline`; `EmptyState` and `Confirm` are both in use like sibling sections. |
| 4. Feedback & state             | pass  | Empty state, delete confirmation, and required-field marking are all present; feedback now renders beside the control that produced it, success messages auto-dismiss, and the egress field previews what it will actually save. |
| 5. Content & language           | pass  | Load errors are now plain language with a labelled retry; the preset choice carries a one-line consequence hint.                                        |
| 6. Accessibility                | pass  | Select/textarea have accessible names via `Field`; status/error are live regions; meta/label text clears the AA contrast floor.                          |
| 7. Responsive / layout          | pass  | Add-form fields now grow to fill the row at 640px via `flex: 1 1 180px`; only extremely long values still truncate, which is expected at any field width. |
| 8. Spacing, alignment & sizing  | pass  | Every gap/padding/radius in the section now reads from spacing tokens; Select and Input render at visually matched heights.                              |
| 9. Interaction & micro-states   | pass  | Shared `Btn`/`Select`/`Input` supply hover/focus/disabled/busy; success messages clear themselves after `statusTimeoutMs` and a failed load offers an inline `Retry`. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [Low] Deleting a repository is immediate and irreversible, with no confirmation

- **Id:** repos-delete-no-confirmation
- **Status:** fixed
- **Resolved:** `e5d0fcbac` ("feat(settings): confirm repository deletion and weight the row action") — delete now opens the shared `Confirm` dialog naming the repository before calling `deleteRepo`.
- **Dimension:** 4. Feedback & state (also 2. Affordance & signifiers)
- **Where visible:** `ReposSection — delete confirm dialog` shows the modal ("Delete repository" / "Delete my-project? Coding sessions in this context will no longer be able to use it."); `Populated`/`delete hover on a row` show the `danger`-variant trigger.
- **Source:** `client/settings/sections/ReposSection.svelte:141-148` (`pendingDeleteId` set on click, no direct delete), `:218-236` (`Confirm` wired to `handleDelete`).

### [Low] The permission select and egress textarea have no accessible name

- **Id:** repos-inputs-no-accessible-name
- **Status:** fixed
- **Resolved:** `15bff0412` ("refactor(settings): route the repo preset and egress fields through shared primitives").
- **Dimension:** 6. Accessibility
- **Source:** `client/settings/sections/ReposSection.svelte:187-193` (preset now a `<Select>`), `:194-204` (egress now `<Input multiline>`) — both render inside `Field`, and `Select.svelte:34-42` / `Input.svelte:74-86` wire `aria-labelledby`/`aria-invalid`/`aria-describedby` from `field-context.ts`.

### [Low] A context with no repositories renders no empty state

- **Id:** repos-no-empty-state
- **Status:** fixed
- **Resolved:** `89e1c8c5b` ("feat(settings): give an empty repository list an empty state").
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** `Empty` (desktop and narrow) now show the `EmptyState` — "No repositories connected" / "Add one below to make it available to coding sessions in this context."
- **Source:** `client/settings/sections/ReposSection.svelte:150-153` — `{:else}` branch on the `{#each}` renders `EmptyState`.

### [Low] "Add" is disabled with no indication of which fields are required

- **Id:** repos-add-disabled-no-indication
- **Status:** fixed
- **Resolved:** `7d3a331b9` ("feat(settings): mark the required repo fields and announce the status channel").
- **Dimension:** 4. Feedback & state
- **Where visible:** `Empty`, `ReposSection — add submit disabled, hover` now show `NAME *`, `REPOSITORY URL (HTTPS) *`, `BASE BRANCH *` with a required marker; Permission preset and Additional egress domains carry none, matching that they're optional.
- **Source:** `client/settings/sections/ReposSection.svelte:166,173,180` (`Field ... required`) rendering `Field.svelte:47` (`ui-field__req`); disabled condition unchanged at `:210`.

### [Low] Raw select and textarea visibly break from the sibling inputs

- **Id:** repos-raw-inputs-visual-break
- **Status:** fixed
- **Resolved:** `15bff0412`.
- **Dimension:** 3. Consistency w/ design system (also 8. Spacing, alignment & sizing)
- **Where visible:** `Populated`, `Empty`, `preset select focused` — the preset control now renders with the same fill and border as the neighbouring inputs, at a visually matched height.
- **Source:** `client/settings/sections/ReposSection.svelte:187-193` / `:197-204` now use `Select`/`Input` (`--surface-2`, `--radius-control`-equivalent) instead of local one-off styling.

### [Low] The destructive action is styled as the least prominent control on the row

- **Id:** repos-delete-low-affordance
- **Status:** fixed
- **Resolved:** `e5d0fcbac`.
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `Populated` — "Delete" is now a bordered `danger`-variant button (red border, red text), no longer borderless ghost text.
- **Source:** `client/settings/sections/ReposSection.svelte:141-142` — `variant="danger"` (was `variant="ghost"`).

### [Low] Status messages are positioned away from the action and never clear

- **Id:** repos-status-not-announced-never-clears
- **Status:** fixed
- **Resolved:** `3814bd2b8` ("fix(settings): route Repositories feedback to the action that caused
  it") (2026-08-04). The single top-of-section status pair became two slots: load and delete
  outcomes render above the repo rows (`ReposSection.svelte:150-158`), add outcomes render inside
  the add-form card (`ReposSection.svelte:255-256`), so each message sits with the control that
  produced it. Success messages now clear after `statusTimeoutMs` (default 4000,
  `ReposSection.svelte:22,25,64-74`); errors persist until the user retries or succeeds. The
  duration is a prop rather than a constant so the stories and the visual spec can hold a message
  on screen — otherwise the `added, success status` baseline would race a wall clock and fail
  intermittently under CI load.
- **Dimension:** 6. Accessibility (also 4. Feedback & state)
- **Where visible:** `ReposSection — added, success status` — "Repository added." now carries `role="status"` (error carries `role="alert"`), so both are announced; but the message still renders at the very top of the section, above any existing repo rows, and stays there indefinitely.
- **Source:** `client/settings/sections/ReposSection.svelte:124-125` (`role="alert"` / `role="status"` added — the accessibility gap from the prior review is closed), `:71,98` (`status` is only cleared at the start of the next `handleAdd`/`handleDelete`, never on a timer or on navigating away).
- **Suggested fix:** N/A — resolved.
- **Note:** narrowed from the original finding — the "never announced" half is fixed (`7d3a331b9`); only placement and auto-clear remain.

### [Low] Meta and helper text fall below the AA contrast floor

- **Id:** repos-helper-text-low-contrast
- **Status:** fixed
- **Resolved:** `e6e223424` ("refactor(settings): put the repo add form on the shared layout and tokens") — moved the 11px meta/label/help text from `--fg3` to `--fg-hint`.
- **Dimension:** 6. Accessibility
- **Source:** `client/settings/sections/ReposSection.svelte:275-279` (`.settings-repos__meta`), `:292,298` (`.settings-repos__add-label`, `.settings-repos__add-note`) all use `var(--text-dim)` (the `--fg-hint` alias post-token-migration in `09f46aa3c`); `--text-dim` (`#828d84`) on `--surface-1` (`#111512`) computes to ≈5.3:1, clearing the 4.5:1 AA floor (token comment in `tokens.css:21` documents ≈5.69:1 on `--bg`).

### [Low] A repository can only be added or deleted, never edited

- **Id:** repos-no-edit-capability
- **Status:** deferred
- **Resolved:** 2026-08-04 — decision, no commit. `client/settings/repos-fetchers.ts:16-34` exposes only add and delete; per-row editing of branch, preset and egress needs backend update support that does not exist. The surprise-discovery half of this finding is already closed by the note at `ReposSection.svelte:160-163`. Deferred rather than won't-fix because the capability may genuinely be built later.
- **Dimension:** 4. Feedback & state (also 2. Affordance & signifiers)
- **Where visible:** `Populated` — each row still shows branch, preset and egress domains as static text with no way to change them; the add form now states this plainly ("Branch, preset and egress domains are fixed when a repository is added — change them by removing and re-adding it.").
- **Source:** `client/settings/repos-fetchers.ts:16-34` — still only `addRepo`/`deleteRepo`; the discoverability half of this finding is closed by the note added in `e6e223424` (`ReposSection.svelte:160-163`).
- **Suggested fix:** Offer per-row editing of branch/preset/egress if the underlying API grows update support; the "fixed at creation" framing is otherwise now adequate.
- **Note:** downgraded from Med — the surprise-discovery problem the finding centred on is resolved by the explicit note; the residual is a capability gap, not a UX defect in this section.

### [Low] Add-form fields never use the available width

- **Id:** repos-add-form-narrow-fields
- **Status:** fixed
- **Resolved:** `e6e223424`.
- **Dimension:** 7. Responsive / layout
- **Where visible:** `ReposSection — long content in the add form, narrow` — the three fields now each occupy a roughly equal share of the row with no unused space to the right; very long values still truncate at their (now wider) field width, which is an inherent limit of any fixed-width text input, not the wasted-space defect originally reported.
- **Source:** `client/settings/sections/ReposSection.svelte:308-310` (`#repos .settings-form :global(.ui-field) { flex: 1 1 180px; }`, replacing the old `min-width: 180px` with no `flex: 1`).

### [Low] Load failures surface the raw backend string with no recovery affordance

- **Id:** repos-load-error-no-recovery
- **Status:** fixed
- **Resolved:** `3814bd2b8` ("fix(settings): route Repositories feedback to the action that caused
  it") (2026-08-04). The list-slot error now carries an inline `Retry` button
  (`ReposSection.svelte:151-156`, `testid="repos-error-retry"`) that re-runs `load(contextId)`, so
  recovery sits beside the message instead of depending on the refresh glyph in the header's far
  corner (`ReposSection.svelte:146`, `testid="repos-refresh"`). That glyph stays as the idle
  refresh affordance. The button also renders for a failed delete (`ReposSection.svelte:126`,
  `listError` set in `handleDelete`'s catch), which is deliberate: after a failed delete the list
  state is uncertain and re-fetching tells the user whether it landed.
- **Dimension:** 5. Content & language (also 4. Feedback & state)
- **Where visible:** `Error` — the message now reads "Something went wrong on the server. Try again shortly." (plain language, not a raw backend string), and the retry control (`IconButton label="Refresh"`) carries an accessible name and visible border via `aria-label`/`title`.
- **Source:** `client/shared/format-error.ts:14-26` (`formatFetchError`, added in `c5cbcf13b`) maps 5xx/4xx classes to canned copy; `client/settings/sections/ReposSection.svelte:120` (`IconButton label="Refresh" ... testid="repos-refresh"`) in the `PageHeader` action slot.
- **Suggested fix:** N/A — resolved.
- **Note:** narrowed and downgraded from Med — both defects the original finding cited by name (raw text, unlabelled glyph) are resolved; only the proximity suggestion remains outstanding.

### [Low] The add form's spacing and sizing are all hardcoded px

- **Id:** repos-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `e6e223424`.
- **Dimension:** 8. Spacing, alignment & sizing
- **Source:** `client/settings/sections/ReposSection.svelte:239-314` — `gap`/`margin-bottom`/`padding`/`border-radius` all now read `var(--gap-tight)`, `var(--gap-field)`, `var(--gap-inline)`, `var(--radius-control)`, `var(--s1)`; the only remaining literal is the 2px row-internal `gap` in `.settings-repos__info` (name/url/meta stack), which is a deliberate micro-gap, not the drifted value the finding described. Select/Input now render at visually matched heights in `preset select focused` vs `name input focused`.

### [Low] The egress help text is the widest, least readable line in the section

- **Id:** repos-egress-help-text-unreadable
- **Status:** fixed
- **Resolved:** `15bff0412` (routes egress through `Field`'s `hint` prop rather than a hand-rolled paragraph).
- **Dimension:** 1. Visual hierarchy & scanning (also 6. Accessibility)
- **Where visible:** `Populated` — the help text is now width-bounded to the egress field's column (wraps at ~4 lines instead of spanning the full 1230px section width).
- **Source:** `client/settings/sections/ReposSection.svelte:194-196` — `Field label="Additional egress domains" hint="..."` renders through `Field.svelte:50-51` (`.ui-field__hint`), which is also wired into `aria-describedby` via `field-context.ts:67`.

### [Low] The three permission presets are unexplained on a security-relevant choice

- **Id:** repos-permission-presets-unexplained
- **Status:** fixed
- **Resolved:** `e6e223424` — the preset `Field` now carries `hint="readonly is the most restricted, autonomous the least."`, visible in every `Populated`/`Empty` shot.
- **Dimension:** 5. Content & language
- **Source:** `client/settings/sections/ReposSection.svelte:187` (`Field label="Permission preset" hint="readonly is the most restricted, autonomous the least."`).

### [Low] Egress input is silently normalised

- **Id:** repos-egress-silently-normalised
- **Status:** fixed
- **Resolved:** `e6c8f7ec3` ("fix(settings): show what the egress field will actually save")
  (2026-08-04). A read-only hint under the egress textarea (`ReposSection.svelte:237-243`,
  `data-testid="repos-egress-preview"`) previews the parsed hosts live, derived from the same
  `parseEgress` (`ReposSection.svelte:50-57`) the submit path calls, via `egressPreview`
  (`ReposSection.svelte:59`), so it cannot drift from what is stored. The field is never
  rewritten — rewriting on blur would silently edit what the user typed and destroy their line
  breaks and ordering. The hint renders nothing when no hosts parse, which is also why only the
  long-content screenshot changed.
- **Dimension:** 4. Feedback & state
- **Where visible:** Not visible in the screenshots — source-only.
- **Source:** `client/settings/sections/ReposSection.svelte:46-53` — `parseEgress` still lowercases, trims and dedupes; the form still clears on success, so a user who typed `PyPI.org` twice still doesn't see the normalised value until the row re-renders after `load()`.
- **Suggested fix:** N/A — resolved.

### [Low] The section has no heading element

- **Id:** repos-no-heading-element
- **Status:** fixed
- **Resolved:** `e24abe5a1` ("fix(settings): make the Repositories add-form label a real heading")
  (2026-08-04). The add-form sub-label is now an `<h3>` carrying the same
  `.settings-repos__add-label` class (`ReposSection.svelte:192`), sitting under the `<h2>` that
  `PageHeader.svelte:25` already rendered, so the add form is reachable by heading navigation.
  The class gained an explicit `font-weight: 400` (`ReposSection.svelte:345`) because `<h3>`
  defaults to bold — without it the tag change would have moved pixels. The visual audit was run
  against the untouched baselines, with no re-shoot, and passed 467/0, which is what proves the
  promotion was purely semantic.
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible — source-only.
- **Source:** `client/shared/ui/PageHeader.svelte:25` now renders the section title as an `<h2>` (fixed — this half was shared and affects every reviewed section); `client/settings/sections/ReposSection.svelte:159` still renders "Add repository" as a `<p class="settings-repos__add-label">`, not a heading.
- **Suggested fix:** N/A — resolved.
- **Note:** narrowed — the `PageHeader` half of this finding (originally `<div>`) is resolved; the residual is scoped to this section's own add-form label.
