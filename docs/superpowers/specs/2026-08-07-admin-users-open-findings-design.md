<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AdminUsersSection Open Findings — Design

**Goal:** Close all seventeen open findings in `docs/ux-reviews/AdminUsersSection.md` by adopting
the patterns the sibling admin sections already settled on, and by fixing the two defects that live
in shared code at their source rather than working around them locally.

**Scope:**

- `client/settings/sections/admin/AdminUsersSection.svelte` — the bulk of the work
- `client/stories/msw/settings-handlers.ts` and `AdminUsersSection.stories.svelte` — fixtures
- three shared files whose defects this review surfaced: `client/shared/ui/IconButton.svelte`,
  `client/shared/ui/status-tone.ts`, `client/settings/components/SettingsTable.svelte`
- a new `client/settings/lib/field-touched.ts`, and the two-line import change in
  `client/settings/sections/admin/AdminInstancesSection.svelte` that follows from extracting it

The four other open findings in the backlog (`PluginsSection`, `TranscriptApp`, two on
`SettingsApp`) are out of scope and stay open for their own cycle.

## Context

The review (commit `a1c250142`) scored the section 2 `fail` / 6 `warn` / 1 `pass`. The failures
cluster the same way `AdminInstancesSection`'s did: the section predates the shared state
primitives and never adopted them, so it hand-rolls loading, error, and empty handling that twenty
sibling sections get from `ErrorState` and `EmptyState`, and hand-rolls two badge classes that nine
siblings get from `Pill`. Most of this backlog is adoption, not invention.

The section is the bot's access-control surface, which raises the stakes on the state findings
specifically: three of the four Highs describe a UI that presents unloaded or failed state as
fact, and one of them leaves a live control wired to that false baseline.

## Finding coverage

Every open finding maps to exactly one section below. Nothing in this design is unmotivated by a
finding, and no finding is left unaddressed.

| Finding id                                          | Sev  | Addressed by            |
| --------------------------------------------------- | ---- | ----------------------- |
| `admin-users-loading-reads-as-empty`                | High | Load state machine      |
| `admin-users-load-failure-renders-live-controls`    | High | Load state machine      |
| `admin-users-open-access-toggle-acts-on-unloaded-state` | High | Open-access card    |
| `admin-users-add-blank-id-silent-noop`              | High | Add form                |
| `admin-users-blocked-row-unmarked`                  | Med  | Table                   |
| `admin-users-remove-confirm-names-raw-id`           | Med  | Actions and confirmation|
| `admin-users-block-vs-remove-unexplained`           | Med  | Actions and confirmation|
| `admin-users-add-not-guarded-against-double-submit` | Med  | Add form                |
| `admin-users-status-not-announced`                  | Med  | Announcements           |
| `admin-users-hand-rolled-badges`                    | Med  | Table                   |
| `admin-users-raw-source-values`                     | Med  | Table                   |
| `admin-users-table-not-sortable-or-width-pinned`    | Med  | Table                   |
| `admin-users-empty-copy-dead-end`                   | Low  | `SettingsTable` + Empty state |
| `admin-users-open-access-card-offscale`             | Low  | Open-access card        |
| `admin-users-username-truncates-silently`           | Low  | Table                   |
| `admin-users-pending-id-hidden`                     | Low  | Table                   |
| `admin-users-refresh-busy-not-announced`            | Low  | `IconButton`            |

## Architecture

One new shared module, one moved helper pair, and edits in place. No new components.

### `client/settings/lib/field-touched.ts` (new)

`AdminInstancesSection.svelte:89-100` holds two private helpers for blur-gated field validation.
This work needs the same pair, so they move out rather than being copied:

```ts
/** The error for `field`, but only once the user has left it. */
export function shownError(
  errors: Readonly<Record<string, string>>,
  touched: readonly string[],
  field: string,
): string | undefined

/** `touched` with `field` added, idempotently. */
export function markTouched(touched: readonly string[], field: string): string[]
```

Behaviour is exactly what `AdminInstancesSection` has today; both sections import it afterwards.
Being a pure module, it is directly unit-testable, which the inline versions were not.

### `client/shared/ui/status-tone.ts`

Add one entry: `blocked: 'danger'`. `TONE_MAP` has no `blocked` key today, so a blocked pill would
silently fall through to `neutral`. No existing consumer renders a literal `blocked`, so nothing
else changes tone.

### `client/shared/ui/IconButton.svelte`

Add `aria-busy={busy}` to the button element, mirroring `Btn.svelte:53`. Purely additive, no visual
change, 27 consumers.

### `client/settings/components/SettingsTable.svelte`

The component owns the query and the result counter, so it — not its consumers — is the right place
to tell a filtered-to-zero list from an empty one. When `query` is non-empty and `filtered` is
empty, it renders its own state instead of the consumer's `empty` snippet:

- an `EmptyState` titled `No matches`, hinted with the query text
- an action button that clears the query and resets the page

The `empty` snippet keeps its current meaning — the genuinely-empty list — for all five consumers.

## The section itself

### Load state machine

`load()` stops using `Promise.all`, which today loses both results when either request fails. The
two fetches settle independently:

| Outcome                | Effect                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| user list fails        | fatal — `usersLoadError` swaps the region for `ErrorState` with `detail` + retry   |
| open-access flag fails | non-fatal — the list stays usable; an inline error sits on the card                |
| initial fetch in flight| `loading && initialLoad` renders the `placeholder` "Loading…" in place of the body |

This mirrors what `AdminInstancesSection` arrived at across commits `4b73de20b`, `71e473717`, and
`1e4db9032`, and it matches consequence: the list is the section, the flag is one control.

An `initialLoad` flag joins the existing `loading` so the placeholder shows only on first load, not
on every refresh.

### Open-access card

The card gains a `Pill` reading `enabled` or `disabled`, rendered only once the value has actually
resolved, and the toggle is `disabled` until then. Today the state is asserted by the verb on the
button that changes it, derived from a `false` initial value — so during loading, and in the error
state where the value never arrived at all, the card shows a live **Enable** and `toggleAccess()`
would compute `enabling = !false` from a placeholder. Stating the state in a pill that does not
exist until it is known removes the false assertion and the false baseline together.

Card geometry moves onto the token scale: `border-radius: var(--radius)`, `padding: var(--s3)`,
`margin-bottom: var(--gap-field)`, `gap: var(--gap-inline)`.

### Table

Five columns, all widths pinned and the first four sortable, with `defaultSort` on username
ascending so the order is stable rather than whatever the API returned:

| Column     | Key                | Width | Content                                        |
| ---------- | ------------------ | ----- | ---------------------------------------------- |
| User ID    | `platform_user_id` | 25%   | `IdCell`, unconditionally                      |
| Username   | `username`         | 25%   | text with a `title` for the untruncated value  |
| Status     | `status`           | 15%   | `StatusPill`                                   |
| Added by   | `added_by`         | 15%   | `Pill` tone `neutral`, prose value             |
| _(actions)_| `actions`          | 20%   | Block/Unblock + Remove, right-aligned          |

`status` derives in precedence order: `blocked` when `blocked_at` is set, else `pending` when the id
carries the `placeholder-` prefix, else `active`. That gives a blocked user a scannable, sortable,
screen-reader-visible marker — today the only trace is the word "Unblock" on a button at the far
right edge of the row.

The column header becomes `Added by`, which says what the value answers; `Source` did not.

`added_by` is an **open set**, not a two-value enum — a correction to an earlier draft of this
design. Three writers exist in the server:

| Writer                                        | Value stored                       |
| --------------------------------------------- | ---------------------------------- |
| `src/auth.ts:217,219`                         | `open-access`                      |
| `src/announcements/store.ts:38`               | `announce-subscription`            |
| `src/debug/settings/admin/system-access-routes.ts:54,70` | the acting admin's `platformUserId` |

So the common case is an arbitrary id string, and the rendering must be total rather than a lookup
table:

- `open-access` → `Open access`, neutral `Pill`
- `announce-subscription` → `Announcement signup`, neutral `Pill`
- anything else → an admin's user id, rendered through `IdCell` so it truncates, carries a `title`,
  and can be copied — it is an id, and should look like the one in the first column
- empty → `—`

**Both fixtures are wrong today** and must be corrected as part of this work: the Storybook
fixture uses `open_access` (underscore — never written by anything) and both it and the unit-test
fixture use `admin`, which no writer produces. Fixing them is what makes the finding testable
against reality rather than against a fiction.

Because `status` now carries the pending marker, the User ID cell no longer substitutes a badge for
the id — every row keeps a truncating, `title`-bearing, copyable `IdCell`. Both hand-rolled classes,
`.pending-badge` and `.source-badge`, are deleted.

### Actions and confirmation

Block drops to `variant="outline"` and Remove keeps `danger`, so visual weight tracks reversibility
and the irreversible action is the only red thing in the row. Block gains no confirmation — it is
reversible and the Unblock button is in the same cell.

`PageHeader` gains `sub="Blocking revokes access and can be undone; removing deletes the entry."`,
which is the only place the pair is currently explained at all.

The remove confirmation names the person rather than the key. The label is built from two
independent facts — whether a username exists, and whether the id is a `placeholder-` string — so
all four combinations are defined:

| Username | Real id | Label                          |
| -------- | ------- | ------------------------------ |
| yes      | yes     | `Remove alice_tg (123456789)?` |
| yes      | no      | `Remove @bob_handle (pending)?`|
| no       | yes     | `Remove 123456789?`            |
| no       | no      | `Remove this pending user?`    |

followed by `They lose access and the entry is deleted. This cannot be undone.`

### Add form

The ID field becomes `required` with its error surfaced on blur via `shownError` / `markTouched`.
Validation: a trimmed-empty id yields `Enter a numeric user ID or an @username.` **Add user**
disables while the form is invalid or a request is open, and a new `adding` flag swaps its label to
`Adding…` — closing the double-submit window that `toggleAccess` (`togglingAccess`) and
`toggleBlock` (`blocking`) already guard, and that commit `ca6b49e21` closed on the instance rows.

Today the same submit is a silent no-op: `add()` returns early on an empty id with no message, no
invalid border, and no focus move.

### Announcements

`role="alert"` on the error line and `role="status"` on the success line, matching the eleven
sibling sections that already carry them. Every outcome in this section is an access change; none
of them is currently announced.

### Empty state

The section's `empty` snippet becomes `EmptyState title="No users yet"` hinted toward the two ways
to populate the list — the add form above, or enabling open DM access. The no-match case is handled
by `SettingsTable` as described above, so the two stop sharing one string.

## Data flow

Unchanged in shape: `$effect` → `load()` → two fetchers → `$state` → `$derived` row model →
`SettingsTable`. The only structural change is that `load()` now produces three outcomes per
request rather than one combined success/failure, and that the row model gains a derived `status`
field.

Mutations keep their existing shape — mutate, `await load()`, set `status` — with `add()` gaining
the in-flight flag its siblings have.

## Error handling

Three distinct channels, which the current single `error` string conflates:

- **`usersLoadError`** — fatal, replaces the region with `ErrorState` + retry
- **`openAccessError`** — scoped to the card, leaves the rest of the section usable
- **`error` / `status`** — per-mutation outcomes at the top of the section, now announced

`removeError` keeps its current behaviour: it stays inside the confirmation dialog so a failed
delete does not dismiss the dialog the user is reading.

## Testing

TDD against `tests/client/settings/sections/admin/AdminUsersSection.test.ts` (526 lines, 22 tests).

Two existing tests change meaning and are **updated, not deleted**:

- `renders a pending badge instead of the placeholder id` — the id now survives alongside a pending
  pill, so the assertion inverts
- `a user row with added_by open-access shows a source badge` — the badge becomes a `Pill` and the
  text becomes `Open access`

New coverage:

- the loading placeholder renders, and is distinct from the empty state
- a user-list failure renders `ErrorState` and its retry re-fetches
- an open-access-only failure leaves the table rendered and the toggle disabled
- the toggle is disabled until the flag resolves, and `patchOpenAccess` is never called before then
- a blank-ID submit surfaces a field error and posts nothing
- a second submit during an open add posts once
- each of the three statuses renders its pill
- a query with no matches renders the no-match state, and clearing it restores the rows
- the confirm body names the username and falls back to the id

Plus unit tests for `field-touched.ts` as a pure module.

**Fixtures.** A new `settings-admin-users-open-access-error` scenario in
`client/stories/msw/settings-handlers.ts` (list resolves, flag fails) with a matching Storybook
story, since the partial-failure path has no fixture today. The `populated` fixture gains a
long username so the truncation behaviour finally has a shot — the review could not add this,
being unable to edit files under `client/`.

**Visual.** Re-shoot AdminUsersSection at both viewports and re-shoot the four sibling
`SettingsTable` consumers — `AdminAdminsSection`, `AdminByokSection`, `AdminGroupsSection`,
`AdminPluginsApprovalSection` — to confirm the empty-state change shifted nothing in them.

**Backlog.** Flip all seventeen findings to `fixed` with `Resolved:` lines naming their commits,
re-score the nine dimensions from the new shots, then `bun run ux:backlog`.

## Risks

- **`SettingsTable` has five consumers.** The no-match state is new behaviour for all of them; the
  re-shoot above is the check. The `empty` snippet's contract is unchanged, so no consumer needs
  editing.
- **`status-tone.ts` is app-wide.** Verified: no consumer renders a literal `blocked` today, so the
  new entry cannot change an existing pill.
- **`field-touched.ts` touches a section outside this scope.** `AdminInstancesSection` is edited
  only to import the two helpers it currently defines inline; its own test suite (971 lines) must
  stay green unmodified, which is the regression check.
- **File size.** The section grows from 286 to roughly 420 lines. `AdminInstancesSection` runs 583
  and passes, so no split is warranted; if it overruns, the row-model derivation is the piece to
  extract.
