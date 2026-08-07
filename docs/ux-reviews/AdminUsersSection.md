<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AdminUsersSection

**Date:** 2026-08-07
**Reviewed:** `client/settings/sections/admin/AdminUsersSection.svelte`, and the primitives it consumes: `client/settings/components/SettingsTable.svelte`, `client/settings/components/IdCell.svelte`, `client/shared/ui/DataTable.svelte`, `client/shared/ui/Btn.svelte`, `client/shared/ui/Field.svelte`, `client/shared/ui/Input.svelte`, `client/shared/ui/IconButton.svelte`, `client/shared/ui/Pill.svelte`, `client/shared/Confirm.svelte`, `client/settings/settings.css`, `client/shared/tokens.css`
**States captured:** Populated, Empty, Error, Loading (generated) · populated at 640px, Remove hovered, Remove confirm open, keyboard focus on first control, search with no matches, Add submitted with a blank ID (manual)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Capture caveat — no long-content variant.** The fixture usernames are short (`alice_tg`,
`charlie`) and every user id is nine digits, so no shot exercises a long display name or a long
transport error. Widening them means editing `client/stories/msw/settings-handlers.ts:196-215`,
a `.ts` file under `client/` that this review skill may not touch. The truncation finding below
is therefore drawn from `DataTable`'s source rather than from a screenshot.

**Second caveat — flush-left rendering is a story artifact, not a defect.** As in the sibling
admin reviews, `.settings-section` (`client/settings/settings.css:43-46`) carries no padding by
design; the shell supplies it. Not filed.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                        |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | The open-access card, the add form and the table are three unlabelled peers, and a blocked user carries no visual weight at all — the row reads exactly like an active one. |
| 2. Affordance & signifiers      | warn  | Open DM access has no state indicator; its current value is inferable only from the verb on the button that changes it, and Block/Remove read as equally destructive.       |
| 3. Consistency w/ design system | fail  | The section reaches for none of the patterns its siblings settled on — no `ErrorState`, no `EmptyState`, no `Pill`, no `role="status"`, no sortable or width-pinned columns. |
| 4. Feedback & state             | fail  | Loading, load-failed and genuinely-empty all render the same "No users" table, and submitting the add form with a blank ID does nothing and says nothing.                    |
| 5. Content & language           | warn  | The Source column shows raw `open_access`, the remove confirmation names a numeric id instead of the person, and nothing states how Block differs from Remove.               |
| 6. Accessibility                | warn  | Labels and focus rings come correct from `Field`/`Input`/`Btn`, but the error and status lines are plain `<p>`s that announce nothing and the refresh busy state is silent.  |
| 7. Responsive / layout          | pass  | 640px reflows cleanly — the card wraps, the form keeps its columns, the table compresses with no horizontal overflow (long-value truncation filed Low).                      |
| 8. Spacing, alignment & sizing  | warn  | The open-access card's radius/padding/margin and both badge classes are hand-picked px off the token scale, and the unpinned columns shift between empty and populated.      |
| 9. Interaction & micro-states   | warn  | Hover, focus-visible and disabled all arrive free from the primitives, but Add has no in-flight guard and the open-access toggle's only busy signal is a label swap.         |

## Findings

Severity-ranked, highest first.

### [High] Loading claims there are no users

- **Id:** admin-users-loading-reads-as-empty
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Loading-1.png` is pixel-identical to `…-Empty-1.png` apart from the dimmed refresh glyph — both read "0 results" and "No users" while the request is still in flight
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:236-244` — `SettingsTable` receives only `userRows`, which is `[]` until `load()` resolves; the `loading` flag set at `:41` reaches the refresh `IconButton` at `:155` and nothing else
- **Suggested fix:** Give the table a pending state while the initial fetch is in flight, so an operator is never told the access list is empty before it has arrived — the same distinction `AdminInstancesSection` now draws.

### [High] A load failure leaves every control live and the list reading as empty

- **Id:** admin-users-load-failure-renders-live-controls
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Error-1.png` — a 10px red `boom` sits above a fully interactive open-access card, add form and "No users" table; nothing says the list failed to load or offers a retry
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:159` — the fatal load error is rendered as an inline `<p class="status-error">` and the section body renders unconditionally below it; 20 sibling sections import `ErrorState` for exactly this case
- **Suggested fix:** Let a failed load replace the list region with a named `ErrorState` carrying a retry, rather than presenting an unloaded access list as an accurate empty one.

### [High] The open-access toggle acts on a value it has not loaded yet

- **Id:** admin-users-open-access-toggle-acts-on-unloaded-state
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-Loading-1.png` and `…-Error-1.png` both show a live green **Enable** button; in the error shot the real value was never fetched at all
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:26,169-176` — `openDmAccess` initialises to `false` and the button is disabled only by `togglingAccess`, never by `loading`; `toggleAccess()` at `:58` then computes `enabling = !openDmAccess` from that placeholder
- **Suggested fix:** Hold the toggle inert until the open-access value has actually resolved, so the control can never flip the bot's front door from an assumed baseline.

### [High] Submitting the add form with a blank ID is a silent no-op

- **Id:** admin-users-add-blank-id-silent-noop
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminUsersSection-—-add-submitted-with-blank-id-1.png` — pressing **Add user** with both fields empty changes nothing: no message, no invalid border, no focus move
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:73-74` — `add()` returns early on an empty trimmed id; the `Field` at `:185` is neither `required` nor given an `error`, and `Btn` at `:197` is never disabled
- **Suggested fix:** Mark the ID field required and surface the reason the submit did nothing — `Field` already carries an `error` slot and `Input` already renders an invalid border for it.

### [Med] A blocked user's row looks identical to an active one

- **Id:** admin-users-blocked-row-unmarked
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `AdminUsersSection-Populated-1.png` — `charlie` is blocked, but the only trace of it is the word "Unblock" on a button at the far right edge, 1100px from the id
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:140,205-212` — `blocked` is computed into the row model but consumed solely to pick the action button's label and variant; no column renders it
- **Suggested fix:** Give a blocked user a visible row-level marker so the access list can be scanned for who is currently shut out, instead of read button by button.

### [Med] The remove confirmation names an id, not a person

- **Id:** admin-users-remove-confirm-names-raw-id
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-—-remove-confirm-open-1.png` — "Remove user 123456789? This cannot be undone." while the table row beside it is captioned `alice_tg`
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:37,256` — `pendingRemovalLabel` is `pendingRemoval` verbatim, which is `platform_user_id`; for a pending row that is the `placeholder-…` string the table deliberately hides behind a badge at `:225-226`
- **Suggested fix:** Name the user the way the table named them — username first, id as support — so the confirmation is checkable against the row that was clicked.

### [Med] Nothing states how Block differs from Remove

- **Id:** admin-users-block-vs-remove-unexplained
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` — every row ends in two adjacent red-outlined buttons; the section prose mentions only "block individuals to revoke"
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:205-223` — both actions render as `variant="danger"` with bare verbs, and the only consequence text anywhere is "This cannot be undone" inside the remove confirmation
- **Suggested fix:** State each action's consequence — reversible loss of access versus deletion of the entry — and let the weaker of the two carry less destructive styling.

### [Med] Add user can be fired twice

- **Id:** admin-users-add-not-guarded-against-double-submit
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in any frame — the button never changes appearance between click and reload
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:70-86` — `add()` keeps no in-flight flag, so a second submit posts again while the first is open; `toggleAccess` (`togglingAccess`) and `toggleBlock` (`blocking`) both guard, and commit ca6b49e21 closed the same window on the instance rows
- **Suggested fix:** Hold the add form busy for the duration of the request, matching the guard the section's other three mutations already carry.

### [Med] Status and error lines announce nothing

- **Id:** admin-users-status-not-announced
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible — the outcome of blocking, unblocking, adding or removing a user is a silently-swapped paragraph at the top of the section
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:159-160` — both are plain `<p>` elements; 11 sibling sections carry `role="alert"` / `role="status"` on the same two classes
- **Suggested fix:** Give the two status lines the live-region roles the rest of settings uses, so an access change is announced rather than only drawn.

### [Med] Two hand-rolled badge classes stand in for `Pill`

- **Id:** admin-users-hand-rolled-badges
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `AdminUsersSection-Populated-1.png` — the `pending` and `admin` / `open_access` chips are 10px text in a 2px-radius hairline box, visibly lighter and squarer than the pills used elsewhere in admin
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:263-270` — `.pending-badge` / `.source-badge` set their own font-size, padding, border and radius, while `client/shared/ui/Pill.svelte` exists and is used by `AdminInstancesSection` and eight other sections
- **Suggested fix:** Render both chips through the shared pill primitive so they inherit its tone scale and sizing instead of drifting from it.

### [Med] The Source column shows a raw storage value

- **Id:** admin-users-raw-source-values
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` — the column reads `admin`, `admin`, `open_access`
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:139,146` — `source` is `added_by` passed straight through, under a header labelled "Source" that does not say added-by-what
- **Suggested fix:** Label the column for what it answers and render the two values as prose, rather than exposing the snake-case field name to the operator.

### [Med] The users table is neither sortable nor width-pinned

- **Id:** admin-users-table-not-sortable-or-width-pinned
- **Status:** open
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `AdminUsersSection-Empty-1.png` vs `…-Populated-1.png` — the USERNAME header sits at x≈393 when the table is empty and x≈335 once rows arrive, so the header row jumps as data loads; no header is clickable in any shot
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:144-149` — the column array sets no `sortable` and no `width`, where the sibling array at `AdminInstancesSection.svelte:345-348` sets both (commit 455fafd38)
- **Suggested fix:** Pin the column widths and make id/username/source sortable, so the access list holds still across states and can be ordered the way the instance tables can.

### [Low] The empty table is a dead end, and says the same thing when a search misses

- **Id:** admin-users-empty-copy-dead-end
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Empty-1.png` and `AdminUsersSection-—-search-with-no-matches-1.png` — both render the bare string "No users", the second while `zzzz` sits in the search box above it
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:243` — a single `empty` snippet serves both cases; `SettingsTable` passes it through for a filtered-to-zero list as readily as an actually-empty one
- **Suggested fix:** Point the genuine empty state at the add form above it, and tell a zero-result search that it is the query, not the list, that is empty.

### [Low] The open-access card's geometry is off the token scale

- **Id:** admin-users-open-access-card-offscale
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `AdminUsersSection-Populated-1.png` — the card's corners are visibly rounder than the controls inside it and its gap to the form below is tighter than the form's gap to the table
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:271-280` — `border-radius: 4px` matches neither `--radius` (6px) nor `--radius-control` (2px), and `padding: 10px 12px` / `margin-bottom: 12px` are literals where `--s3`/`--gap-inline`/`--gap-field` exist
- **Suggested fix:** Draw the card's radius, padding and trailing margin from the shared scale so it sits on the same rhythm as the form and table beneath it.

### [Low] A long username truncates with no way to read it

- **Id:** admin-users-username-truncates-silently
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** Not reproducible in the current fixtures — see the capture caveat above
- **Source:** `client/shared/ui/DataTable.svelte:187-196` — every `td` is `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`; `IdCell` compensates with a `title` at `client/settings/components/IdCell.svelte:20`, but the username cell at `AdminUsersSection.svelte:232-234` renders bare text with none
- **Suggested fix:** Let the username cell expose its full value on hover the way the id cell already does, so a clipped handle stays recoverable.

### [Low] A pending user has no readable identifier

- **Id:** admin-users-pending-id-hidden
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminUsersSection-Populated-1.png` — the second row's User ID cell contains only the word `pending`; there is nothing to copy and no `IdCell`
- **Source:** `client/settings/sections/admin/AdminUsersSection.svelte:225-229` — the `placeholder-` branch replaces the id entirely rather than annotating it, so the row's actual key is visible only in the remove confirmation
- **Suggested fix:** Mark the row as pending alongside an identifier rather than in place of one, so a pending entry can still be matched against a log line or an API response.

### [Low] The refresh control's busy state is silent

- **Id:** admin-users-refresh-busy-not-announced
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** `AdminUsersSection-Loading-1.png` — the top-right glyph dims to 0.6 opacity and stops responding, with no other signal
- **Source:** `client/shared/ui/IconButton.svelte:17-26` — the button sets no `aria-busy`, where `Btn` sets it at `client/shared/ui/Btn.svelte:53`; `AdminUsersSection.svelte:155` passes `busy={loading}` and gets only the opacity change
- **Suggested fix:** Have the shared icon button expose its busy state the way the shared text button does, so a reload in progress is perceivable without seeing the dimming.
