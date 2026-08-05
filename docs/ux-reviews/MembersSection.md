<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — MembersSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/MembersSection.svelte` (+ shared `DataTable`, `IconButton`, `Btn`, `Field`, `Input`, `Confirm`, `Modal`, `client/shared/helpers.ts`)
**States captured:** Populated, Empty, Error, Loading, add-input-focused, Add-button hover, remove-confirmation-open, loading-is-distinct-from-empty, populated · desktop + ~640px
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

| Dimension                       | Score | Rationale (one line)                                                                                                                         |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow `GROUP` / title / field / table tiers are distinct; the add-form → member-table rhythm scans cleanly.                                |
| 2. Affordance & signifiers      | pass  | Remove is now `danger`-styled with a visible border/color, and the refresh glyph resolves at `--text` contrast — both read as interactive.   |
| 3. Consistency w/ design system | pass  | Now routes destructive removal through the shared `Confirm`/`Modal` and renders `added_at` via the shared `formatDateTime` helper.           |
| 4. Feedback & state             | pass  | Loading now renders a distinct "Loading…" placeholder, Add shows a pending "Adding…" state, and Remove is gated by `Confirm` with its own busy/error surface. |
| 5. Content & language           | pass  | `user_id`/`added_by` now prefer human labels with the raw id as a muted secondary line; the empty state now guides to the add form above, with a distinct message when the load itself failed. |
| 6. Accessibility                | pass  | Refresh glyph and destructive Remove now clear resting contrast; focus-visible ring still handled app-wide.                                  |
| 7. Responsive / layout          | pass  | Reflows cleanly at ~640px (Add collapses to a full-width row); `DataTable` cells truncate long values with ellipsis rather than breaking layout. |
| 8. Spacing, alignment & sizing  | pass  | The add row now uses the shared `.settings-form` subgrid tracks, so the field and button share a row, stay inside the section's padding, and the button sits level with the input's own box; the error line carries its own bottom margin. |
| 9. Interaction & micro-states   | pass  | Hover/focus-visible exist on `Btn`/`IconButton`; Add disables and labels "Adding…" while in flight, Remove/Confirm show a "Working…" busy state.  |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Removing a member revokes access with no confirmation

- **Id:** members-delete-no-confirm
- **Status:** fixed
- **Resolved:** `fdaa06850` — "fix(settings): confirm before removing a group member" (2026-07-03).
- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** Populated — clicking "Remove" now opens a confirmation modal (see `remove-confirmation-open` shot).
- **Source:** `client/settings/sections/MembersSection.svelte:147` now calls `requestRemove(row.user_id)` (`:65-68`), which only sets `pendingRemove`; the actual `removeGroupMember` call happens in `confirmRemove()` (`:70-89`), gated behind the shared `Confirm` dialog rendered at `:167-181` (`danger`, "Remove {label} from this group? They'll lose access to the bot here.").
- **Suggested fix:** N/A — resolved.

### [Med] Loading state is indistinguishable from Empty

- **Id:** members-loading-looks-empty
- **Status:** fixed
- **Resolved:** `587850eeb` — "fix(settings): distinguish MembersSection loading state from empty" (2026-07-03).
- **Dimension:** 4. Feedback & state
- **Where visible:** Loading — now renders "Loading…" as its own copy, confirmed distinct from Empty's "No members" (see the dedicated `loading-is-distinct-from-empty` shot).
- **Source:** `MembersSection.svelte:141-142` (`{#if loading && members.length === 0}<p class="placeholder">Loading…</p>{:else}…{/if}`) now short-circuits before the table/`DataTable` empty snippet is ever reached during the initial load.
- **Suggested fix:** N/A — resolved.

### [Med] Add gives no in-flight feedback and allows double-submit

- **Id:** members-add-no-feedback-double-submit
- **Status:** fixed
- **Resolved:** `145c84014` — "fix(settings): signal in-flight add and block double-submit in MembersSection" (2026-07-03).
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not a single frame — checked in source per the skill's guidance for busy states.
- **Source:** `MembersSection.svelte:47-48` (`if (adding) return`) guards re-entry, `:28`/`:53`/`:61` track the `adding` flag, and the submit button (`:136-138`) binds `disabled={adding}` and swaps its label to `'Adding…'` while the request is in flight.
- **Suggested fix:** N/A — resolved.

### [Med] Error is detached from the action that caused it and crowds the field label

- **Id:** members-error-detached-crowds-label
- **Status:** fixed
- **Resolved:** `fdaa06850` — "fix(settings): confirm before removing a group member" (2026-07-03, split add/remove error state) and `a7bc2810d` — "style(settings): space MembersSection error and align add row" (2026-07-03, margin).
- **Dimension:** 4. Feedback & state (also 8. Spacing)
- **Where visible:** Error — the top-of-section `<p class="status-error members-error">` now carries `margin: 0 0 var(--gap-field)` breathing room before the field label (see the `Error` shot).
- **Source:** Add and Remove failures are now separate state: add errors stay in `error`/`:128` (top-of-section, spaced via `.members-error` at `:185-187`), while Remove failures set `removeError` (`:31`, `:74`, `:81`) and render inside the `Confirm` dialog body next to the action that caused them (`:179`, `data-testid="member-remove-error"`) rather than at the top of the section.
- **Suggested fix:** N/A — resolved.

### [Med] `added_at` is a raw ISO timestamp and bypasses the shared formatter

- **Id:** members-added-at-raw-timestamp
- **Status:** fixed
- **Resolved:** `452cb8666` — "fix(settings): format MembersSection added_at via shared helper" (2026-07-03).
- **Dimension:** 5. Content & language (also 3. Consistency)
- **Where visible:** Populated — the "Added at" column now reads `2026-05-01 00:00` (see the `Populated` shot).
- **Source:** `MembersSection.svelte:107` (`added_at: formatDateTime(m.added_at)`) runs every row through the shared `client/shared/helpers.ts` formatter before it reaches `memberRows`.
- **Suggested fix:** N/A — resolved.

### [Low] "Remove" and the refresh control read as non-interactive at rest

- **Id:** members-remove-refresh-low-affordance
- **Status:** fixed
- **Resolved:** `8a7e912e1` — "fix(settings): make MembersSection Remove read as destructive" (2026-07-03) and `8ed4b85e5` — "style(ui): raise IconButton resting contrast" (2026-07-03, shared primitive).
- **Dimension:** 2. Affordance & signifiers (also 6. Accessibility)
- **Where visible:** Populated — "Remove" now shows a visible danger-tinted border/color at rest (see `Populated` shot); the header `⟳` resolves at full `--text` contrast.
- **Source:** `MembersSection.svelte:147` now uses `variant="danger"` (`Btn.svelte:102-106`: `color: var(--danger)`, `border-color: rgba(232,92,92,0.3)`) instead of `ghost`; the shared `IconButton.svelte:38` was changed from `color: var(--text-muted)` to `color: var(--text)`, raising the refresh glyph's resting contrast for every consumer, including the Members header refresh at `:124`.
- **Suggested fix:** N/A — resolved.

### [Low] Add-form alignment rule is inert; the primary button is undersized under a full-width input

- **Id:** members-add-form-alignment-inert
- **Status:** fixed
- **Resolved:** `3f7cf5a60` ("fix(settings): align form fields on shared subgrid tracks") (2026-08-04). `.settings-form` is now a grid with `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))` and `grid-template-rows: auto auto auto` (`client/settings/settings.css:43-49`), and `.ui-field` adopts the parent's three tracks via `display: grid; grid-template-rows: subgrid; grid-row: span 3` (`client/shared/ui/Field.svelte:59-62`). Both residues are addressed: (a) the add row no longer escapes the section's padding — the field and the "Add member" button now live inside the same grid tracks as every other `.settings-form` consumer, which is bounded by `.settings-section`/`.settings-group`'s own width, so the button's right edge sits well inside the table padding instead of flush with the viewport edge (confirmed in `settings-sections-MembersSection-Populated-1.png`). (b) The button now shares the input's baseline: `.settings-form > :not(.ui-field)` spans only the label+control rows (`grid-row: span 2; align-self: end; justify-self: start`, `client/settings/settings.css:53-57`), putting it level with the input's own box rather than the bottom of the field group including its hint text. The section-local `.members-add :global(.ui-field) { flex: 1; min-width: 220px; }` override that previously fought this layout has been deleted.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated (desktop) and populated/narrow (~640px) — in both shots the "Add member" button is flush against the right edge of the viewport, with no gutter, while the input beside it and the `Remove` buttons in the table below all stop short of that edge. The button also sits visibly lower than the input rather than sharing its baseline.
- **Source:** `MembersSection.svelte:189-192` (`.members-add :global(.ui-field) { flex: 1; min-width: 220px; }`) did close the original defect — the field no longer forces the button onto its own undersized line, and the two now share a row (`a7bc2810d`, "style(settings): space MembersSection error and align add row", 2026-07-03). Two residues remain, which is why this stays open rather than closing. (a) The add row escapes the section's right padding: the button's right edge lands on the viewport edge at both captured widths. (b) `.settings-form`'s `align-items: end` (`settings.css:38-44`) aligns against the bottom of the whole field group — which includes the "For Telegram, you can use @username…" hint line — so the button's baseline sits below the input's, not level with it.
- **Suggested fix:** Contain the add row within the section's horizontal padding, and align the button to the input's own box rather than to the field group including its hint text.

### [Low] Empty state dead-ends on "No members"

- **Id:** members-empty-state-dead-end
- **Status:** fixed
- **Resolved:** `74d886e40` — the `DataTable` empty snippet now reads "No members yet — add the first one using the form above.", pointing at the add form directly above it.
- **Dimension:** 5. Content & language
- **Where visible:** Empty — the table body previously read only "No members" (see the `Empty` shot).
- **Source:** `MembersSection.svelte:162` (`{#snippet empty()}No members{/snippet}`), prior to the fix.
- **Suggested fix:** N/A — resolved.

### [Low] Empty-table guidance renders under a failed-load error banner as if the load had succeeded

- **Id:** members-empty-guidance-during-load-error
- **Status:** fixed
- **Resolved:** `be7cfeab4` — discovered while closing `members-empty-state-dead-end`: the newly-worded guidance ("No members yet — add the first one using the form above.") rendered inside the empty table even when `load()` had failed, since a failed fetch leaves `members` at `[]`, so the table asserted zero members directly under the error banner saying the load failed. The `empty()` snippet is now conditional on `error`, showing "Members couldn't be loaded." instead when the two states coincide. The table itself is deliberately still rendered on error (not suppressed) so a failed *refresh* doesn't blank out previously loaded rows.
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** Not one of this document's captured states — this is the previously-uncaptured intersection of Error and Empty (a load failure with zero prior rows), not the standalone `Error` or `Empty` shots.
- **Source:** `MembersSection.svelte:162-167` (`{#snippet empty()}{#if error === null}No members yet…{:else}Members couldn't be loaded.{/if}{/snippet}`) — the `error === null` branch before this fix was unconditional.
- **Suggested fix:** N/A — resolved.
