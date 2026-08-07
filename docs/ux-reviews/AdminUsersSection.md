<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AdminUsersSection

**Date:** 2026-08-07
**Reviewed:** `client/settings/sections/admin/AdminUsersSection.svelte`, and the primitives it consumes: `client/settings/components/SettingsTable.svelte`, `client/settings/components/IdCell.svelte`, `client/shared/ui/DataTable.svelte`, `client/shared/ui/Btn.svelte`, `client/shared/ui/Field.svelte`, `client/shared/ui/Input.svelte`, `client/shared/ui/IconButton.svelte`, `client/shared/ui/Pill.svelte`, `client/shared/Confirm.svelte`, `client/settings/sections/admin/admin-users-presenters.ts`, `client/shared/ui/status-tone.ts`, `client/shared/ui/field-touched.ts`, `client/settings/settings.css`, `client/shared/tokens.css`
**States captured:** Populated, Empty, Error, Loading (generated) · populated at 640px, Remove hovered, Remove confirm open, keyboard focus on first control, search with no matches, Add submitted with a blank ID, open-access read failed (manual)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Re-review pass (2026-08-07).** All nine tasks of
`docs/superpowers/plans/2026-08-07-admin-users-open-findings.md` landed. Every screenshot was
re-shot after the fixes (`bun shoot -g AdminUsersSection`) and read back against source before
any finding was closed. Fifteen of the seventeen original findings close in this pass. Two stay
`open`, each narrowed to a residue the landed remedy did not close — see
`admin-users-username-truncates-silently` and `admin-users-table-not-sortable-or-width-pinned`
below for the evidence. One new finding is filed for a pre-existing, cross-cutting pattern this
plan deliberately left alone (`admin-users-live-region-mounts-with-text`).

**Second re-review pass (2026-08-07, same day).** `9fb8d8018` landed `table-layout: fixed` on
`DataTable`, gated on every column declaring a `width`. Re-shot and re-measured against that
commit: `admin-users-table-not-sortable-or-width-pinned` now closes for real — the same
before/after-search measurement used to narrow it now returns identical column widths
(`[319.5, 319.5, 191.6875, 191.6875, 255.625]`, both before and after, across three runs) — and
the long-username residue in `admin-users-username-truncates-silently` narrows further: the value
now genuinely truncates with an ellipsis and a working `title`, but stays `open` because a
keyboard or touch user still has no way to recover the clipped portion. Pinning the widths also
surfaced two regressions at the 640px breakpoint that did not exist under the previous `auto`
layout, filed fresh: `admin-users-narrow-actions-column-hides-remove` (the `Remove` button
disappears entirely, with no scroll affordance left to reach it) and
`admin-users-narrow-added-by-clips-mid-glyph` (the Added-by pill clips mid-word with no ellipsis
marker). Both are new, both are `open`, and neither existed before `9fb8d8018` — see each for the
DOM measurement.

**Third re-review pass (2026-08-07, same day).** `f5da228ac` landed an opt-in `minWidth` prop on
`DataTable`/`SettingsTable`, set to `1200px` on the users table, so the ancestor
`.settings-table__scroll`'s existing `overflow-x: auto` engages at narrow widths instead of the
fixed-layout columns being crushed. Independently re-shot (`bun shoot -g AdminUsersSection`) and
re-measured — not taken on the commit message's word — before closing anything: at 640px,
`.settings-table__scroll` now measures `scrollWidth: 1200` vs `clientWidth: 638`; scrolling it
right shows the `Remove` button at a full `57.75×24px` reading "Remove", and the "Announcement
signup" pill renders complete alongside "Open access" on the other row. Both
`admin-users-narrow-actions-column-hides-remove` and `admin-users-narrow-added-by-clips-mid-glyph`
close for real. The long-username truncation this fix must not disturb was re-checked too: the
48-character fixture username still clips with a visible ellipsis (`text-overflow: ellipsis`,
`scrollWidth: 368` vs `clientWidth: 276`) and a working `title`, so
`admin-users-username-truncates-silently`'s residue (no keyboard/touch equivalent to `title`)
stays `open`, unchanged by this fix. Dimensions 7, 8, and 9 are re-scored below to drop the
narrow-viewport clipping language now that it no longer reproduces.

**Capture caveat — retired.** The fixture now carries a 48-character username
(`a_very_long_telegram_username_that_will_not_fit`, `client/stories/msw/settings-handlers.ts`)
and an `openAccessError` scenario, both added in Task 4. Every shot below is now backed by real
pixels rather than source-only inference.

**Second caveat — flush-left rendering is a story artifact, not a defect.** As in the sibling
admin reviews, `.settings-section` (`client/settings/settings.css:43-46`) carries no padding by
design; the shell supplies it. Not filed.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                    |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | A blocked user now carries a red `blocked` status pill visible at a glance; the row no longer reads like an active one (`AdminUsersSection-Populated-1.png`).                          |
| 2. Affordance & signifiers      | pass  | Open DM access has a dot-pill state indicator independent of the button, and Block (secondary) now reads as materially less destructive than Remove (danger).                          |
| 3. Consistency w/ design system | pass  | `ErrorState`, `EmptyState`, `Pill`, and live-region roles are all adopted; sorting and column-width pinning both now hold, verified by identical before/after-search header measurements. |
| 4. Feedback & state             | pass  | Loading, a fatal load failure, a non-fatal open-access failure, and a genuinely empty list each render a distinct, correctly-worded state; a blank add is blocked and explained.        |
| 5. Content & language           | pass  | `Added by` renders "Open access" / "Announcement signup" pills or a truncated id, the remove confirmation names the person, and the confirm dialog states how Block differs from Remove. |
| 6. Accessibility                | warn  | Labels, focus rings, and `aria-busy` now come correct, but the live-region roles are mounted with their text already inside them — see `admin-users-live-region-mounts-with-text` below. |
| 7. Responsive / layout          | warn  | `minWidth: 1200px` (`f5da228ac`) makes `.settings-table__scroll`'s existing `overflow-x: auto` engage at 640px instead of crushing columns — `Remove` and the Added-by pill are both fully reachable by scrolling now — but the long username still truncates with no non-hover way to recover it on keyboard or touch — see `admin-users-username-truncates-silently`. |
| 8. Spacing, alignment & sizing  | pass  | The open-access card draws its radius/padding/margin from the token scale, column widths no longer shift, and the Added-by pill now renders complete at 640px once the table's own horizontal scroll engages — re-measured directly, no more mid-word clipping. |
| 9. Interaction & micro-states   | warn  | Add has a real in-flight guard (`disabled`, "Adding…") and `Remove` is fully reachable at 640px via the table's own scroll, but the open-access toggle still never sets `aria-busy` (only `disabled`) while saving. |

## Findings

Severity-ranked, highest first.

### [High] Loading claims there are no users

- **Id:** admin-users-loading-reads-as-empty
- **Status:** fixed
- **Resolved:** `6b4258583` — `initialLoad` now gates a `Loading…` placeholder ahead of the table; verified in `settings-sections-admin-AdminUsersSection-Loading-1.png`, which reads "Loading…" and never "No users".
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Loading-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:212-213`
- **Suggested fix:** (superseded by the resolution above)

### [High] A load failure leaves every control live and the list reading as empty

- **Id:** admin-users-load-failure-renders-live-controls
- **Status:** fixed
- **Resolved:** `6b4258583` — a fatal `usersLoadError` now renders `ErrorState` with a retry button in place of the whole body; verified in `settings-sections-admin-AdminUsersSection-Error-1.png`, which shows a centred error and no form or table beneath it.
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Error-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:207-211`
- **Suggested fix:** (superseded by the resolution above)

### [High] The open-access toggle acts on a value it has not loaded yet

- **Id:** admin-users-open-access-toggle-acts-on-unloaded-state
- **Status:** fixed
- **Resolved:** `6b4258583` — `toggleAccess()` now returns early unless `openAccessLoaded`, and the button is disabled and reads "Unavailable" until the value has actually resolved; verified in `AdminUsersSection-—-open-access-read-failed-1.png`, where the toggle is disabled and reads "Unavailable" while the user list beside it stays intact.
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Loading-1.png` / `…-Error-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:95-96,236-242`
- **Suggested fix:** (superseded by the resolution above)

### [High] Submitting the add form with a blank ID is a silent no-op

- **Id:** admin-users-add-blank-id-silent-noop
- **Status:** fixed
- **Resolved:** `a77f725ba` (test pinned in `a9a724b7d`) — the User ID field now carries a required-field validation message and an invalid border via `Field`/`Input`, and the Add button is disabled while the field is blank; verified in `AdminUsersSection-—-add-submitted-with-blank-id-1.png`, which shows a red-bordered input and "Enter a numeric user ID or an @username." beneath it.
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-—-add-submitted-with-blank-id-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:55-58,252-266`
- **Suggested fix:** (superseded by the resolution above)

### [High] At the narrow breakpoint, the Remove control disappears entirely

- **Id:** admin-users-narrow-actions-column-hides-remove
- **Status:** fixed
- **Resolved:** `f5da228ac` — `DataTable` gained an opt-in `minWidth` prop (forwarded through `SettingsTable`), set to `1200px` on the users table, so the ancestor `.settings-table__scroll`'s existing `overflow-x: auto` engages at narrow widths instead of the fixed-layout columns being crushed below their content's minimum. Re-shot (`bun shoot -g AdminUsersSection`) and independently re-measured at 640px: `.settings-table__scroll` reports `scrollWidth: 1200` vs `clientWidth: 638`, and scrolling it right renders the Remove button at a full `57.75×24px` reading "Remove" — no clipping, no hidden glyph.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** `AdminUsersSection-—-populated-narrow-1.png` at 640px — every row's Actions cell shows `Block`/`Unblock` followed by three literal dots where the `Remove` button used to read; no part of the button's label is visible. Confirmed by DOM measurement, not just the pixel: at 640px the Actions `<td>` is `127.625px` wide while its content (`Block`/`Unblock` + `Remove`) needs `141`–`154px`, and `.settings-table-wrap`/the document report zero horizontal overflow (`scrollWidth === clientWidth === 640` at every level) — so there is no scrollbar or any other affordance left to reach the hidden control. This is a direct side effect of `9fb8d8018`: before that fix, an unpinned `auto`-layout table simply grew wider than the 640px viewport and the existing `overflow-x: auto` on `.settings-table-wrap` let a user scroll to `Remove`; now that all five columns are pinned to their declared percentages, the table is forced to fit exactly inside 640px, and the 20%-wide Actions column is too narrow for two buttons once one of them says `Unblock` rather than `Block`.
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:193` (`{ key: 'actions', ..., width: '20%' }`) combined with `client/shared/ui/DataTable.svelte:161-163,198-206` (`table-layout: fixed` plus `.ui-datatable__td`'s `overflow: hidden; text-overflow: ellipsis`, which — for a `<td>` whose overflowing content is itself an atomic inline-block/`inline-flex` box such as `Btn` rather than plain text — hides the whole overflowing button and renders the ellipsis in its place instead of clipping it partially).
- **Suggested fix:** Give the Actions column more room at narrow widths (e.g. a wider percentage, a `min-width` in `px` that the fixed layout still honors, or dropping the two buttons to icon-only / a single overflow menu below some breakpoint) so `Remove` stays reachable without relying on the table exceeding the viewport.

### [Med] At the narrow breakpoint, the Added-by pill clips mid-word with no ellipsis

- **Id:** admin-users-narrow-added-by-clips-mid-glyph
- **Status:** fixed
- **Resolved:** `f5da228ac` — the same `minWidth: 1200px` fix lets the Added-by column keep its content's full width instead of being squeezed to 15% of a 640px viewport. Re-shot and independently re-measured: after scrolling `.settings-table__scroll` into view, the "Announcement signup" pill renders complete (no clipped glyph, no bare cut edge) alongside the fully-visible "Open access" pill on the other row.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `AdminUsersSection-—-populated-narrow-1.png` at 640px — the `Announcement signup` pill in the Added-by column renders as `Announcemen`, missing its final letter, with no `…` marker anywhere. DOM measurement confirms the column itself is squeezed to `96px` while the pill's content needs up to `176px` at that row; the `Pill` component (`client/shared/ui/Pill.svelte:33-51`) sets no `overflow`/`text-overflow` of its own, so the parent `<td>`'s ellipsis rule is what's supposed to apply — but because the pill is an `inline-flex` box, the browser clips its box edge rather than substituting an ellipsis glyph, the same class of quirk as the Remove-button finding above but manifesting as a hard, silent cut instead of a fully-hidden control. This is new at the narrow breakpoint since `9fb8d8018` pinned the Added-by column to 15% of the viewport; under the previous `auto` layout the column was never squeezed this far because the table simply grew past 640px and scrolled instead.
- **Source:** `client/shared/ui/DataTable.svelte:161-163,198-206`; `client/settings/sections/admin/admin-users-presenters.ts:24-31` (`describeAddedBy()` produces the `Announcement signup` / `Open access` prose that no longer reliably fits at 15% of a 640px viewport).
- **Suggested fix:** Either widen the Added-by column at narrow viewports, shorten the prose (e.g. "Announce" / "Open"), or add explicit `overflow: hidden; text-overflow: ellipsis; max-width: 100%` to `Pill` itself so a squeeze inside it degrades to a legible ellipsis rather than a bare glyph cut.

### [Med] A blocked user's row looks identical to an active one

- **Id:** admin-users-blocked-row-unmarked
- **Status:** fixed
- **Resolved:** `98d926898` — a dedicated Status column renders a `Pill` (`tone="danger"` for blocked, driven by `statusTone`/`userStatus`) so a blocked row is marked at the row level, not just on its action button; verified in `settings-sections-admin-AdminUsersSection-Populated-1.png`, where `charlie`'s row carries a red `blocked` pill.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:309-312`
- **Suggested fix:** (superseded by the resolution above)

### [Med] The remove confirmation names an id, not a person

- **Id:** admin-users-remove-confirm-names-raw-id
- **Status:** fixed
- **Resolved:** `cfd6a5183` — `pendingRemovalRow` plus `removeUserLabel()` now name the confirmation subject username-first, id-as-support (or "(pending)" for a placeholder row); verified in `AdminUsersSection-—-remove-confirm-open-1.png`, which reads "Remove alice_tg (123456789)?".
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-—-remove-confirm-open-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:59-67,354`
- **Suggested fix:** (superseded by the resolution above)

### [Med] Nothing states how Block differs from Remove

- **Id:** admin-users-block-vs-remove-unexplained
- **Status:** fixed
- **Resolved:** `cfd6a5183` — Block is reweighted from `danger` to `secondary`, and the remove confirmation now states the consequence directly ("They lose access entirely and drop off this list. To keep the record and revoke access reversibly, Block them instead."); verified in `AdminUsersSection-—-remove-confirm-open-1.png`.
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:280-298,355-358`
- **Suggested fix:** (superseded by the resolution above)

### [Med] Add user can be fired twice

- **Id:** admin-users-add-not-guarded-against-double-submit
- **Status:** fixed
- **Resolved:** `a77f725ba` — `adding` now guards `add()` against re-entry and the button is disabled and reads "Adding…" for the duration of the request, matching the pattern `toggleAccess`/`toggleBlock` already used.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in a single frame (timing-dependent); confirmed from source and the unit test added in `a77f725ba` (`a double submit posts once`).
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:52,112-133,272-274`
- **Suggested fix:** (superseded by the resolution above)

### [Med] Status and error lines announce nothing

- **Id:** admin-users-status-not-announced
- **Status:** fixed
- **Resolved:** `50b24f24d` (roles landed in `6b4258583`) — the status and error paragraphs now carry `role="alert"` / `role="status"`, matching the convention the rest of settings uses. A deeper reliability gap in that same convention — the region mounts with its text already inside it rather than starting empty — predates this plan and is filed separately as `admin-users-live-region-mounts-with-text`, deliberately not fixed here because it is a module-wide pattern.
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a static frame; confirmed from source.
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:204-205`
- **Suggested fix:** (superseded by the resolution above)

### [Med] Two hand-rolled badge classes stand in for `Pill`

- **Id:** admin-users-hand-rolled-badges
- **Status:** fixed
- **Resolved:** `98d926898` — `.pending-badge` / `.source-badge` are deleted; the Status and Added-by cells both render through `Pill`, inheriting its tone scale and sizing; verified in `settings-sections-admin-AdminUsersSection-Populated-1.png`, where `pending`, `active`, `blocked`, `Open access`, and `Announcement signup` all render as the same pill shape used elsewhere in admin.
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:309-323`
- **Suggested fix:** (superseded by the resolution above)

### [Med] The Source column shows a raw storage value

- **Id:** admin-users-raw-source-values
- **Status:** fixed
- **Resolved:** `98d926898` — the column is relabelled "Added by" and `describeAddedBy()` renders `open-access` / `announce-subscription` as "Open access" / "Announcement signup" prose pills, falling back to a truncated `IdCell` for an admin id; verified in `settings-sections-admin-AdminUsersSection-Populated-1.png`.
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/admin-users-presenters.ts:24-31`, `client/settings/sections/admin/AdminUsersSection.svelte:313-323`
- **Suggested fix:** (superseded by the resolution above)

### [Med] The users table is neither sortable nor width-pinned

- **Id:** admin-users-table-not-sortable-or-width-pinned
- **Status:** fixed
- **Resolved:** `98d926898` (sorting — a `▲` indicator on the USERNAME header, rows arrive in username order via `defaultSort`) + `9fb8d8018` (width pinning — `DataTable` now sets `table-layout: fixed` on `.ui-datatable`, gated on every column declaring a `width`). Re-measured directly: at the default (1280px) viewport, `thead th` boxes give `[319.5, 319.5, 191.6875, 191.6875, 255.625]` before filtering the search box to `alice` and the identical `[319.5, 319.5, 191.6875, 191.6875, 255.625]` after — repeated across three runs. The instability this finding originally described (column widths shifting as the row set changes) no longer reproduces at the default viewport.
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `settings-sections-admin-AdminUsersSection-Populated-1.png` (sort indicator); before/after-search measurement above (width pinning).
- **Source:** `client/shared/ui/DataTable.svelte:93-99,161-163` — `table-layout: fixed` is applied via `.ui-datatable--fixed`, gated on `allColumnsHaveWidths`.
- **Suggested fix:** (superseded by the resolution above)

### [Low] The empty table is a dead end, and says the same thing when a search misses

- **Id:** admin-users-empty-copy-dead-end
- **Status:** fixed
- **Resolved:** `40b001d1f` (SettingsTable no-match state) + `50b24f24d` (section empty copy) — a genuinely empty list now renders "No users yet" with a next step ("Add one above by numeric ID…"), and a zero-result search renders a distinct "No matches" state with a Clear-search button; verified in `settings-sections-admin-AdminUsersSection-Empty-1.png` and `AdminUsersSection-—-search-with-no-matches-1.png`.
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Empty-1.png` / `AdminUsersSection-—-search-with-no-matches-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:337-339`, `client/settings/components/SettingsTable.svelte:71-78`
- **Suggested fix:** (superseded by the resolution above)

### [Low] The open-access card's geometry is off the token scale

- **Id:** admin-users-open-access-card-offscale
- **Status:** fixed
- **Resolved:** `50b24f24d` — `border-radius`, `padding`, and `margin-bottom` on `.open-access-card` now read `var(--radius)`, `var(--s2) var(--s3)`, and `var(--s3)` respectively; confirmed by reading the current stylesheet.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:373-382`
- **Suggested fix:** (superseded by the resolution above)

### [Low] A long username truncates with no way to read it on keyboard or touch

- **Id:** admin-users-username-truncates-silently
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `AdminUsersSection-—-populated-narrow-1.png` and `settings-sections-admin-AdminUsersSection-Populated-1.png` — the 48-character fixture username (`a_very_long_telegram_username_that_will_not_fit`) now renders as `a_very_long_tele…` in both shots. Now that `table-layout: fixed` (`9fb8d8018`) holds the USERNAME column to its declared width, the ellipsis rule genuinely engages: measured directly, the `span.cell-text` carrying the username has `scrollWidth: 368` against `clientWidth: 136` at 640px and `clientWidth: 296` at 1280px — the content is reliably wider than the box at both breakpoints, so it clips.
- **Source:** `client/shared/ui/DataTable.svelte:198-206` (`.ui-datatable__td`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) and `AdminUsersSection.svelte:306,368-372` (`.cell-text`, same three properties, plus `title={row.username}`). `title` is present and now actually load-bearing — a mouse user can hover the truncated cell and read the full username in the native tooltip. What remains: `title` has no keyboard or touch equivalent — a keyboard-only user tabbing to a row, or a touch user with no hover concept, has no way to recover the clipped portion of the value. That is the residue this finding narrows to.
- **Suggested fix:** Give the truncated value a non-hover path to its full text — e.g. render it as a focusable element (a button/disclosure) that reveals the full username on focus or tap, or move the full value into an always-visible/expandable place (a tooltip-on-focus pattern, or a details row) rather than relying solely on `title`.

### [Low] A pending user has no readable identifier

- **Id:** admin-users-pending-id-hidden
- **Status:** fixed
- **Resolved:** `98d926898` — the User ID cell for a pending row now shows the person's handle (e.g. `@bob_handle`) instead of the bare word "pending"; the pending state moved to its own Status pill, so the row keeps an identifier alongside the marker rather than in place of one; verified in `settings-sections-admin-AdminUsersSection-Populated-1.png`.
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` (pre-fix)
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:299-304`
- **Suggested fix:** (superseded by the resolution above)

### [Low] The refresh control's busy state is silent

- **Id:** admin-users-refresh-busy-not-announced
- **Status:** fixed
- **Resolved:** `0c47492a8` — `IconButton` now sets `aria-busy="true"` while `busy` is true (and omits the attribute otherwise), matching `Btn`; confirmed by reading `client/shared/ui/IconButton.svelte:17-26`, which the section's Refresh button (`AdminUsersSection.svelte:200`, `busy={loading}`) now benefits from directly.
- **Dimension:** 6. Accessibility
- **Where visible:** `AdminUsersSection-Loading-1.png` (pre-fix)
- **Source:** `client/shared/ui/IconButton.svelte:17-26`
- **Suggested fix:** (superseded by the resolution above)

### [Med] Status and error regions mount with their announcement already inside them

- **Id:** admin-users-live-region-mounts-with-text
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a static frame — the defect is in *how* the announcement is inserted, not in its final rendered appearance, which looks correct in every populated/error/status shot.
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:204-205,228-231,359` — every status and error line in this section follows the shape `{#if x !== null}<p role="alert">{x}</p>{/if}` (or `role="status"`): the `{#if}` block means the `<p>` element with its `role` attribute and its text content are all created in a single DOM mutation. The same shape is the convention across the rest of the settings module — confirmed present in `client/settings/sections/IdentitySection.svelte:211-212`, `client/settings/sections/ByokSection.svelte:245-246`, `client/settings/sections/CodeHostSection.svelte:264-265,273`, and `client/settings/sections/admin/AdminInstancesSection.svelte:358-359`, among others. The WAI-ARIA Authoring Practices guidance on live regions is that this shape is unreliable: many assistive technologies only pick up a live region when a node that already exists in the tree has its content changed, not when a new node carrying both the role and the content arrives at once. The recommended shape is a persistent container — mounted once, empty — whose text content is set afterwards.
- **Suggested fix:** Not fixed here — it predates this branch and is deliberately out of scope: fixing it only in `AdminUsersSection` would be inconsistent with every sibling section using the identical pattern, and a module-wide fix is a separate, larger change. Filed as a fresh finding, not folded into `admin-users-status-not-announced`, precisely so it survives that finding's closure and can be picked up as a cross-cutting pass over `client/settings/**` (persistent live-region container per status/error slot, filled after mount) rather than fixed piecemeal per section.
