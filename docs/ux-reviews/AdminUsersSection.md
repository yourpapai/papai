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
| 3. Consistency w/ design system | warn  | `ErrorState`, `EmptyState`, `Pill`, and live-region roles are all adopted now; sorting works, but column widths are not actually pinned — see `admin-users-table-not-sortable-or-width-pinned` below. |
| 4. Feedback & state             | pass  | Loading, a fatal load failure, a non-fatal open-access failure, and a genuinely empty list each render a distinct, correctly-worded state; a blank add is blocked and explained.        |
| 5. Content & language           | pass  | `Added by` renders "Open access" / "Announcement signup" pills or a truncated id, the remove confirmation names the person, and the confirm dialog states how Block differs from Remove. |
| 6. Accessibility                | warn  | Labels, focus rings, and `aria-busy` now come correct, but the live-region roles are mounted with their text already inside them — see `admin-users-live-region-mounts-with-text` below. |
| 7. Responsive / layout          | pass  | At 640px the page itself never scrolls horizontally (`document.documentElement.scrollWidth === clientWidth`, verified); the table instead scrolls within its own `.settings-table-wrap`. |
| 8. Spacing, alignment & sizing  | warn  | The open-access card now draws its radius/padding/margin from the token scale, but column widths still visibly shift when a search narrows the row set — see the width-pinning finding. |
| 9. Interaction & micro-states   | warn  | Add now has a real in-flight guard (`disabled`, "Adding…"), but the open-access toggle still never sets `aria-busy` — `Btn`'s call site only passes `disabled`, not `busy`.              |

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
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** Sorting is confirmed fixed — `settings-sections-admin-AdminUsersSection-Populated-1.png` shows a `▲` indicator on the USERNAME header, and rows arrive in username order via `defaultSort`. Width pinning is not: with the populated fixture at the default viewport, measuring `thead th` boxes before and after filtering the search box to `alice` gives column widths of `[286, 391.9, 174, 187.6, 238.3]` before and `[319.5, 319.5, 191.7, 191.7, 255.6]` after — every column shifts as the row set changes, which is the exact instability ("the header row jumps") the finding originally described, just triggered by a search instead of by the load transition (which the new `EmptyState`/`ErrorState` branches now sidestep structurally).
- **Source:** `client/shared/ui/DataTable.svelte:148-152` — `.ui-datatable` sets `width: 100%` but never `table-layout: fixed`, so the `width` passed on each `<th>` (`client/settings/sections/admin/AdminUsersSection.svelte:189-193`) is only an initial-layout hint, not an enforced constraint; the browser's default `table-layout: auto` still redistributes column widths from the actual content of whichever rows are currently rendered.
- **Suggested fix:** Set `table-layout: fixed` on `.ui-datatable` (or an equivalent per-column `max-width`) so a `width` passed on a column is actually load-bearing; verify against the same before/after-search measurement used here, and against the long-username fixture, once that's decided.

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

### [Low] A long username truncates with no way to read it

- **Id:** admin-users-username-truncates-silently
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `AdminUsersSection-—-populated-narrow-1.png` and `settings-sections-admin-AdminUsersSection-Populated-1.png` — the 48-character fixture username (`a_very_long_telegram_username_that_will_not_fit`) renders in full in both shots, with no ellipsis. Measuring the cell directly (`scrollWidth === clientWidth === 368px` at both 640px and 1280px viewports) confirms the browser is not clipping it: the `USERNAME` column simply grows to fit the longest value present, which is also why the table's own width (926px) exceeds the 640px viewport at the narrow breakpoint — that excess is absorbed by `.settings-table-wrap`'s `overflow-x: auto` (page-level `scrollWidth` stays 640px), not by truncation.
- **Source:** `client/shared/ui/DataTable.svelte:187-196` — the `td` rule (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) and the section's own `.cell-text` (`AdminUsersSection.svelte:368-372`, same three properties) both require the cell's *box* to be narrower than its content before either can do anything; because `.ui-datatable` has no `table-layout: fixed` (see the width-pinning finding above), the column box grows to match content instead, so the ellipsis rule never activates for any username length. `title={row.username}` (`AdminUsersSection.svelte:306`) is present and correct, but currently sits on a span that never actually clips — it is not wrong, just unreachable under the current layout.
- **Suggested fix:** This is the same root cause as `admin-users-table-not-sortable-or-width-pinned`: once column widths are genuinely pinned (`table-layout: fixed` or a per-column `max-width`), the existing `overflow: hidden; text-overflow: ellipsis` will engage and the `title` already in place will make the truncated value hover-recoverable. That still leaves the value unreachable to a keyboard-only or touch user with no hover — `title` has no non-pointer path to its content — so re-verify this finding once the layout fix lands and expect it to survive, narrowed to that remainder.

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
