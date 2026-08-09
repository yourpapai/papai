<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Repositories section clarity (sub-project E)

**Date:** 2026-08-01
**Status:** Design approved, pending spec review
**Source review:** [`docs/ux-reviews/ReposSection.md`](../../ux-reviews/ReposSection.md)
**Predecessors:** sub-project A (namespace-aware story fixtures), B (settings field error
channel), C (control target size), D (code host connection clarity) — all on branch
`ui-ux-review-01`

## Problem

`ReposSection` is the last link in the coding-session setup chain, and the only one that
never adopted the shared form primitives. It hand-rolls a `<select>` and a `<textarea>` with
one-off CSS, so both controls sit outside `Field`'s labelling contract and reach a screen
reader with no accessible name. Its single destructive action fires on one click with no
confirmation, styled as the least prominent control on the row. A context with no
repositories renders nothing at all. The primary button is disabled until three of five
fields are filled, but nothing marks which three.

The section is not short of shared machinery — it is short of *use* of it. `Confirm`,
`EmptyState`, `Select`, `Input multiline`, `Field required`, `Field hint`, the
`.settings-form` layout class, `formatFetchError`, and the `role="alert"` / `role="status"`
convention all already exist and are already used by its siblings.

## Scope

**In:** the twelve findings that live inside `client/settings/sections/ReposSection.svelte`
— the primitive migration (H2, M5, part of L11), the unconfirmed delete and its variant
(H1, M6), the missing empty state (H3), the unmarked required fields (H4), the unannounced
status channel (M7), the raw error text (M10), the add-form layout and spacing (M9, L11),
the field-local contrast fix, the egress hint (L12), the preset ordering hint (L13), and a
copy acknowledgment standing in for the absent edit path (M8).

**Out, and why:**

- **The `--fg3` → `--fg-hint` sweep.** 18 files under `client/settings/` use `--fg3`; only
  4 files in the whole client use `--fg-hint`. E fixes the three declarations in its own
  style block. The sweep is a cross-SPA visual re-shoot like sub-project C and belongs in
  its own sub-project.
- **`PageHeader`'s heading promotion.** Already deferred by D
  (`2026-08-01-code-host-connection-clarity-design.md:36-40`) along with two other shared
  primitive gaps. E inherits that deferral rather than reopening it.
- **Per-row editing.** `src/debug/settings/coding-repos-routes.ts` exposes POST and DELETE
  only; adding a PATCH route means store, schema, and route work. E is rendering-only, as D
  was. Section 6 covers what E says in the meantime.

## Design

### 1. Primitive migration

This is the load-bearing change and lands first, because it closes four findings at once
and every later edit then applies to a section that already matches the design system.

`ReposSection.svelte:166-174` (raw `<select>`) becomes `Select`; `:177-182` (raw
`<textarea>`) becomes `Input multiline rows={3}`. The `.settings-repos__preset-select` and
`.settings-repos__egress-input` rules at `:262-281` are deleted.

What that buys, without any further work:

| Finding                                   | Resolved by                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| H2 — no accessible name                   | Both primitives read `getFieldLabelId()` and emit `aria-labelledby`, plus `aria-invalid` / `aria-describedby` (`Select.svelte:24-25,37-39`, `Input.svelte:41-42,60-62`) |
| M5 — one-off fill and native chrome       | Both use `--raised` and `--radius-control` instead of `--bg` and no radius   |
| L11 (part) — 30px select vs 28px inputs   | The shared metrics remove the height difference that made the label row ragged under `align-items: end` |
| Focus inconsistency noted in the review   | Both primitives carry their own `:focus-within` ring, so they no longer depend on the app-level `.settings-grid :focus-visible` rule and render correctly in Storybook isolation |

`.ui-field` is a stretch flex column (`Field.svelte:47-51`), so `Select`'s `inline-flex`
root fills the field width exactly as the `width: 100%` raw select did.

**Testids are preserved.** `Select` and `Input` both place `testid` on the inner control, so
`repos-add-preset` and `repos-add-egress` continue to resolve for the existing visual spec
and component tests.

Preset options are reordered **readonly → cautious → autonomous**, most to least
restricted, so the hint in section 5 is verifiable by scanning. The `cautious` default at
`:27` is unchanged.

### 2. Destructive delete

New state `pendingDeleteId: string | null`. The row button opens the dialog rather than
calling `handleDelete`; `handleDelete` itself is unchanged apart from clearing
`pendingDeleteId`.

A single `Confirm` renders at section level, not per row: `open` is `pendingDeleteId !== null`,
`danger` is set, `busy` is `deletingId !== null` (only one delete can be in flight, since the
dialog is the only entry point), and `title` is "Delete repository". `onCancel` clears
`pendingDeleteId`; `onConfirm` calls `handleDelete(pendingDeleteId)`.

The body names the repository and states it will no longer be available to coding sessions.
It does **not** claim anything about existing sessions or stored history — this repo does
not own that behaviour, magi does.

The row button moves `variant="ghost"` → `variant="danger"` (`:128-130`), keeping
`size="sm"`. 24px is `--control-h-sm`, the WCAG 2.2 AA target-size floor sub-project C
established, so this does not regress it.

### 3. Empty state

The `{#each}` at `:119-138` gains an `{:else}` rendering `EmptyState` with a title stating
no repositories are connected and a hint pointing at the form directly below. No `action`
snippet — the add form is already the next thing on screen, and a button that scrolls 40px
is noise.

### 4. Required fields and the status channel

`Field required` on Name, Repository URL and Base branch, matching the disable condition at
`:191`. The `required` prop already exists and is unused (`Field.svelte:20`).

**Inherited gap, stated rather than papered over:** `Field`'s `*` has no text alternative
and the control gets no `aria-required`. D deferred exactly that to the cross-primitive
sub-project. E uses `required` as it stands and inherits the gap; closing it in E would mean
changing `Field` for every section.

`role="alert"` on the error `<p>` and `role="status"` on the status `<p>` (`:112-113`),
matching the eight sibling sections that already carry them.

`formatFetchError` (`client/shared/format-error.ts:14`) replaces the raw `err.message`
extraction at `:52`, `:76` and `:96`.

**Two deliberate deviations from the review's suggested fixes.** A review suggests; a spec
decides.

- The review proposed moving the success message next to the Add button. E keeps the single
  top channel, because that is the convention in every sibling section and a bespoke
  two-channel layout costs more than the distance does. `role="status"` is the actual fix
  here: announcement was what was missing, and it works regardless of position. The message
  persisting until the next action is intentional — it is a confirmation, not a toast.
- The review proposed a retry beside the load error. E adds none: `PageHeader`'s Refresh
  action already sits in this section, and `formatFetchError` now states what to do.

### 5. Layout, spacing and copy

`.settings-repos__add-form` (`:253-258`) is deleted for the shared `.settings-form`
(`settings.css:36-45`), which supplies `flex-wrap`, `gap: var(--gap-inline)`,
`align-items: end` and `margin-bottom: var(--gap-field)` — by construction the token values
the local rule hardcoded. Nine sections already use it.

`min-width: 180px` (`:259-261`) becomes `flex: 1 1 180px` scoped to `#repos`. That is the
M9 growth fix: wrapped fields fill their row instead of truncating at 640px while unused
width sits beside them. It targets `:global(.ui-field)` only, so the Add button keeps its
intrinsic width.

**One override, named because it is one.** `.settings-form` carries
`margin-bottom: var(--gap-field)` because siblings place the form directly in the section
body with content beneath it. Here it sits inside a bordered panel whose padding already
provides the bottom inset, so E adds `#repos .settings-form { margin-bottom: 0 }`. One
override against nine inherited declarations is the right trade, but it is an override.

Remaining changes, all within this file's style block:

| Current                                  | Becomes                                                        |
| ---------------------------------------- | -------------------------------------------------------------- |
| `.settings-repos` `gap: 8px`             | `var(--gap-tight)`                                              |
| `.settings-repos` `margin-bottom: 20px`  | `var(--gap-field)`                                              |
| `.settings-repos__row` `padding: 10px 12px` | `var(--gap-tight) var(--gap-inline)` — the row then lands on the 44px `--row-h` |
| `.settings-repos__row` `gap: 12px`       | `var(--gap-inline)`                                             |
| `.settings-repos__row`, `__add` — no radius | `var(--radius-control)`                                      |
| `.settings-repos__add` `gap`/`padding: 12px` | `var(--gap-inline)`                                         |
| `.settings-repos__meta`, `__add-label` `--fg3` | `--fg-hint`                                               |
| `.settings-repos__egress-help` rule      | deleted — the copy moves to `Field hint`                        |

The `--fg-hint` change closes the contrast finding for this file: `--fg3` (`#6b766e`) on
`--surface-1` measures ≈3.96:1 at 11px, under the 4.5:1 AA floor, and `tokens.css:79`
documents `--fg-hint` as the ≈6:1 colour for exactly this text. `.settings-repos__url` keeps
`--fg2`, which is already well clear of the floor.

Copy changes:

- The egress help `<p>` (`:183-186`) moves to the field's `hint` prop, gaining the field
  width bound and the `--fg-hint` colour, and dropping a one-off rule.

  **Correction to the source review.** Finding L12 claimed the hint would also gain
  `aria-describedby`. It will not: `useFieldInvalid().describedBy` resolves to the *error*
  id and only while the field is invalid (`field-context.ts:52-55`), and `Field` has no
  hint-describedby wiring. Describing a control by its hint is a shared-primitive gap that
  joins the three D already deferred; E does not close it and must not claim to.
- The preset field gains `hint="readonly is the most restricted, autonomous the least."`
  This states the ordering only. This repo stores `permissionPreset` as an opaque string and
  forwards it to magi (`src/coding-repos/store.ts:42` validates the enum,
  `plugins/acp/tools.ts:127` passes it through); nothing here defines what each preset
  grants, so the spec does not invent it.

### 6. The absent edit path

A `<p>` under the "Add repository" label, styled `--fg-hint` at the same 11px as that label,
states that branch, preset and egress domains are fixed when a repository is added, and
change by removing and re-adding it. That converts a
dead end a user finds by hunting for an edit control into a signposted path, without
claiming a PATCH route exists.

`__add-label` stays a `<p>`. Heading promotion travels with `PageHeader` to the
cross-primitive sub-project.

## Testing

`tests/client/settings/repos-section.test.ts` already exists, so this is TDD-first. New
coverage:

- delete does not call `deleteRepo` until the dialog is confirmed, and cancelling leaves the
  list untouched;
- the empty branch renders `EmptyState` rather than a bare form;
- Name, Repository URL and Base branch render as required; the egress field does not;
- the error and status paragraphs carry `role="alert"` and `role="status"`;
- all three failure paths render `formatFetchError` output rather than the raw message.

Visual: every baseline in `tests/visual/settings/sections/ReposSection.spec.ts` re-shoots,
plus one new state for the open confirm dialog. The existing manual states need no selector
changes, and the two focus shots become regression value — they should show the green
`--focus-ring` instead of the UA blue.

## Deferred out of E

Recorded here so the next sub-project does not have to re-derive them from the review:

1. `--fg3` → `--fg-hint` across the remaining 17 settings files and both admin SPAs, with
   the visual sweep that implies.
2. `PageHeader`'s title as a real heading element, plus D's two other deferred primitive
   gaps: a `disabled`/busy prop on `Input`, and a text alternative for `Field`'s required
   `*` with `aria-required` on the control.
3. `Field` hint-describedby wiring, so a control is programmatically described by its hint
   and not only by its error (see the §5 correction).
4. A PATCH route for coding repos and the per-row edit affordance it enables.
