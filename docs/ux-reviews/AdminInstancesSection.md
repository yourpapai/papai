<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AdminInstancesSection

**Date:** 2026-08-07
**Reviewed:** `client/settings/sections/admin/AdminInstancesSection.svelte`, and the primitives it consumes: `client/shared/ui/DataTable.svelte`, `client/shared/ui/Select.svelte`, `client/shared/ui/Btn.svelte`, `client/shared/Confirm.svelte`, `client/settings/settings.css`
**States captured:** Populated, Empty, Error, Loading (generated) · delete hovered, delete confirm open, stop confirm open, keyboard focus on first control, populated at 640px (manual)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Capture caveat — the credential fields are unshot.** Every provider type in
`client/stories/msw/settings-handlers-admin-2.ts:161-169` declares
`instanceConfigSchema: []`, so no story renders the `{#each …instanceConfigSchema}` block at
`AdminInstancesSection.svelte:329-335` / `:387-393` — including the `type="password"` inputs that
carry bot tokens and API keys. The most security-relevant part of this form has no screenshot at
any viewport, and findings about it are drawn from source alone. That gap is filed below as
`admin-instances-config-fields-unshot`. Closing it means editing an msw handler, which this
review skill may not touch.

**Second caveat — flush-left rendering is a story artifact, not a defect.** In every shot the
title and tables sit at x=0. `.settings-section` (`client/settings/settings.css:43-46`) declares
no padding by design; the shell supplies it. Not filed.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | warn  | Four peer blocks alternate card/table with no grouping, so "which Create belongs to which table" rests on reading order.   |
| 2. Affordance & signifiers      | fail  | Create is always enabled with no required-field marking on ID or Type, and "Apply platform changes" never says what it does. |
| 3. Consistency w/ design system | fail  | Alone among its siblings it uses neither `ErrorState` nor `EmptyState`, and omits the `role="status"` 10+ sections carry.  |
| 4. Feedback & state             | fail  | Loading is indistinguishable from empty — both tables assert "No platform instances" while the fetch is still in flight.   |
| 5. Content & language           | fail  | Four raw fetch errors reach the operator joined by `; `, and Delete warns less about consequence than the gentler Stop.    |
| 6. Accessibility                | fail  | All four subheads are `<div>`, so the section's structure is invisible to a screen reader, and no status message announces. |
| 7. Responsive / layout          | pass  | 640px holds: tables compress without horizontal overflow and the create cards reflow to one column.                        |
| 8. Spacing, alignment & sizing  | warn  | Two tables built from one shared column array render different column widths; one hardcoded `16px` sits off the scale.     |
| 9. Interaction & micro-states   | warn  | Focus ring and hover come free from `Btn`, but Start/Stop rows carry no busy state and can be double-fired.                |

## Findings

Severity-ranked, highest first.

### [High] Loading claims there are no instances

- **Id:** admin-instances-loading-reads-as-empty
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `AdminInstancesSection-Loading-1.png` is pixel-near-identical to `…-Empty-1.png` — both tables read "No platform instances" / "No task instances" while the request is still in flight
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:360-362,418-420` — `DataTable` receives only `rows`, which is `[]` until `load()` resolves; the `loading` flag set at `:73` reaches the Apply button and the refresh icon but never the tables
- **Suggested fix:** Let the tables render a pending state while `loading` is true, so an operator is never told the platform list is empty before it has arrived.

### [High] Create posts empty IDs and types

- **Id:** admin-instances-create-no-validation
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `AdminInstancesSection-Populated-1.png` and `…-Empty-1.png` — "+ Create" is fully enabled against an empty ID field, and in Empty the Type control is an option-less stub
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:143,162` — `createAdminPlatformInstance({ id: platformId.trim(), type: platformType, … })` is called with no check that either is non-empty, while `collectConfig` (`:130`) does enforce required config fields; the button at `:336` disables only on `creatingPlatform`
- **Suggested fix:** Hold Create disabled until ID and Type are both non-empty, and mark them required the same way config fields are.

### [High] The section's structure is invisible to a screen reader

- **Id:** admin-instances-subheads-not-headings
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a shot; all four block titles render as visually-styled `<div>`s
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:313,342,371,400` — "Add platform instance", "Platform instances", "Add task instance", "Task instances" are each `<div class="t-subhead">`, a type utility (`client/settings/settings.css:87-91`) carrying no semantics; sibling sections including `AdminAnalyticsSection` and `AdminGroupsSection` use real `<h2>`/`<h3>`
- **Suggested fix:** Promote the four subheads to real headings so the two create/list pairs are navigable by heading.

### [Med] Four raw fetch errors reach the operator joined by semicolons

- **Id:** admin-instances-raw-error-string
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminInstancesSection-Error-1.png` — "boom; request failed with status 404; request failed with status 404; request failed with status 404"
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:83-117` — `load()` collects each settled rejection's raw `Error.message` into `loadErrors` and renders `loadErrors.join('; ')` as one line at `:309`; nothing names which of the four requests failed
- **Suggested fix:** Say which lists failed to load and offer a retry, rather than concatenating transport-level messages.

### [Med] Delete warns less about consequence than Stop

- **Id:** admin-instances-delete-understates-impact
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `AdminInstancesSection-—-delete-confirm-open-1.png` says only "This cannot be undone", where `…-stop-confirm-open-1.png` says "Active conversations on it will be interrupted"
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:437` vs `:451` — the strictly more destructive action carries the weaker warning, and `:353` lets an `active` instance be deleted without stopping it first
- **Suggested fix:** State what deleting a live instance costs — the platform stops being served and its stored credentials are gone — at least as plainly as Stop does.

### [Med] Neither status message is announced

- **Id:** admin-instances-status-not-announced
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a shot; applies after every create, delete, stop, and apply
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:309-310` — both `<p class="status-error">` and `<p class="status-success">` render without `role`; `role="status"` on the success line is the established convention in at least ten sibling sections (`IdentitySection.svelte:212`, `ByokSection.svelte:246`, `AdminModelsSection.svelte:86`, and others)
- **Suggested fix:** Announce both outcome lines the way the rest of the settings surface already does — every mutation here reports success only through this text.

### [Med] "Apply platform changes" never says what it applies

- **Id:** admin-instances-apply-unexplained
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** `AdminInstancesSection-Populated-1.png` — a bulk action sits in the header with no description, adjacent to per-row Start/Stop that also change platform state
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:302-304` — the only description of its effect is the post-hoc result string at `:265`; nothing distinguishes it from the per-row controls beforehand, and it is the first control in tab order
- **Suggested fix:** Say what Apply reconciles and how it differs from the row-level Start/Stop, before it is pressed.

### [Med] Start and Stop can be double-fired

- **Id:** admin-instances-row-actions-no-busy
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in a static shot; reproduces on a slow network by pressing a row's Start twice
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:174-194,350,408` — `toggleStatus` / `toggleTaskStatus` set no per-row pending flag and their buttons pass neither `busy` nor `disabled`, unlike the create path which guards on `creatingPlatform` (`:137`)
- **Suggested fix:** Give each row's action a pending state while its request is in flight, matching the guard the create forms already have.

### [Med] The credential fields have no screenshot in any state

- **Id:** admin-instances-config-fields-unshot
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** Nowhere — that is the finding; no story renders the config-schema block
- **Source:** `client/stories/msw/settings-handlers-admin-2.ts:161-169` gives every provider type `instanceConfigSchema: []`, so `AdminInstancesSection.svelte:329-335` and `:387-393` never render, leaving the `sensitive → type="password"` inputs, the `*` required markers, and the required-field error from `:130` entirely uncaptured
- **Suggested fix:** Give at least one provider type a realistic config schema in the fixtures so credential entry, masking, and required-field validation are shot like every other state.

### [Low] Two tables built from one column array don't line up

- **Id:** admin-instances-table-columns-misaligned
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `AdminInstancesSection-Populated-1.png` — TYPE starts at x=330 in the platform table and x=413 in the task table; STATUS likewise diverges
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:285-290` — `instanceColumns` is shared by both `DataTable`s but sets no `width`, and `DataTable` (`client/shared/ui/DataTable.svelte`) uses auto table layout, so each table sizes to its own content
- **Suggested fix:** Give the shared columns explicit widths — `DataTable` already supports a per-column `width` — so two tables from one definition read as one system.

### [Low] The create card's padding is off the spacing scale

- **Id:** admin-instances-hardcoded-card-padding
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `AdminInstancesSection-Populated-1.png` — both create cards
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:462` — `padding: 16px` is the section's only hardcoded spacing literal; its neighbours in the same rule already use `var(--radius)` and `var(--gap-field)`, and `16px` is exactly `--s4` on the shared scale
- **Suggested fix:** Take the card padding from the spacing scale like the rest of the rule.

### [Low] Neither instance table can be sorted

- **Id:** admin-instances-tables-not-sortable
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** `AdminInstancesSection-Populated-1.png` — column headers are static labels
- **Source:** `client/settings/sections/admin/AdminInstancesSection.svelte:285-290` — no column sets `sortable`, though `DataTable` supports it and rows arrive in server order; an operator scanning for the one stopped instance among many has no way to group by status
- **Suggested fix:** Make status and id sortable, so a long instance list can be scanned by the column that matters.
