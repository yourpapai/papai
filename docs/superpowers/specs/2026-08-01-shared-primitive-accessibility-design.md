<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared primitive accessibility (sub-project F)

**Date:** 2026-08-01
**Status:** Design approved, pending spec review
**Source reviews:** [`docs/ux-reviews/ReposSection.md`](../../ux-reviews/ReposSection.md),
[`docs/ux-reviews/CodeHostSection.md`](../../ux-reviews/CodeHostSection.md)
**Predecessors:** sub-projects A (namespace-aware story fixtures), B (settings field error
channel), C (control target size), D (code host connection clarity), E (repositories section
clarity) — all on branch `ui-ux-review-01`

## Problem

Sub-projects B through E each closed the findings that lived inside one section and each
deferred the same residue: findings whose fix belongs to a shared primitive that every
section renders. D deferred two, E deferred two more, and E's own final review independently
rediscovered one of them. They have now been deferred three times, which is the signal that
they need their own cycle rather than another host section.

Four gaps, all confirmed against live source:

1. **`Field`'s required marker is decoration only.** `Field.svelte:38` renders a bare `*`
   inside the label span. The control receives no `aria-required`, so a screen reader hears
   "Name" for a mandatory field and "Permission preset" for an optional one — identical.
   Six call sites pass `required` today, three of them added by E.
2. **`Field`'s hint never reaches the control.** `field-context.ts:56` returns `describedBy`
   *only* when the field is invalid, and the hint renders in an `{:else}` branch carrying no
   id at all. Twenty-seven call sites pass a `hint`; none of them is programmatically
   associated with the control it explains. E's final reviewer flagged this independently of
   the two section reviews that had already named it.
3. **`PageHeader`'s title is a `<div>`.** `PageHeader.svelte:25`, used by 30 files. Every
   settings section renders stacked into one scrolling `<main>` (`SettingsApp.svelte:217`),
   so these are section headings inside a single document — and the document has no heading
   structure whatsoever in its normal state. The eleven `<h3>`s that sections already render
   (TaskProviderSection, MemorySection, and three admin sections) sit under nothing.
4. **`Input` has no disabled state.** `CodeHostSection.svelte:211` passes
   `disabled={saving || loading}` to `Select`; the sibling `Input`s in the same form get no
   equivalent because the primitive exposes no such prop (`Input.svelte:11`–`22`). Text
   inputs stay editable during a save and are then overwritten wholesale when `load` replaces
   `drafts` on success (`CodeHostSection.svelte:128`, `:76`). Typing during a save silently
   loses the keystrokes.

## Scope

**In:** `client/shared/ui/Field.svelte`, `client/settings/components/SettingsFieldShell.svelte`,
`client/shared/ui/field-context.ts`,
`client/shared/ui/Input.svelte`, `client/shared/ui/Select.svelte`,
`client/shared/ui/Combobox.svelte`, `client/shared/ui/PageHeader.svelte`, the `<h1>` root in
`client/settings/SettingsApp.svelte`, and the single `Input disabled` consumer in
`client/settings/sections/CodeHostSection.svelte`.

**Out:**

- `--fg3` → `--fg-hint` across the remaining settings files and both admin SPAs (54 files
  reference the token). Mechanical, wide, and carrying a full visual re-baseline; it shares
  no code with this work and gets its own cycle.
- A PATCH route for coding repos and the per-row edit affordance it enables (E's deferred
  item 4) — backend plus UI, unrelated to primitives.
- The test-quality minors recorded in E's ledger (weak `Boolean(textContent)` assertion,
  inert duplicate `drain()`, brittle `ui-btn--danger` class assertion, the `tokens.css`
  comment overstating its WCAG guarantee, `SettingsFieldShell.spec.ts` missing
  `pinDefaultViewport()`). Small enough for one commit, needing no spec.
- `Btn`, which already implements `disabled` and `busy` correctly.
- Any `level` prop on `PageHeader` — see the decision below.

## Design

### 0. There are two publishers of the field context, not one

`Field.svelte` is not the only component calling `setFieldLabelId`/`setFieldError`.
`client/settings/components/SettingsFieldShell.svelte:37`–`:45` publishes the same context
for the settings sections that need a head/editor/footer layout — CodeHostSection,
CodingCredentialsSection, ConfigFieldRow, AdminPluginsConfigSection — and carries the *same
two defects*: a `*` at `:52` with no `aria-required`, and a hint `<p>` at `:65` with no id.

Every context change below therefore lands in **both** publishers, in the same task, or half
the SPA keeps the old behaviour while the other half changes — a worse state than today.
`ConfigFieldRow.svelte:46`–`:56` already implements this pattern by hand for its own enum
branch (a `hintId`, and a filtered id list because its hint and error can both be live at
once); it is the in-repo precedent the shared implementation should match, and it keeps its
local wiring because its two-live-ids case is genuinely different.

### 1. Required state travels as ARIA, not as text

`field-context.ts` gains a `required: boolean` alongside the existing label id, published by
`Field` during init. `Input`, `Select` and `Combobox` — the three consumers of
`getFieldLabelId`/`useFieldInvalid` — set `aria-required="true"` on their control when it is
set. The `*` span becomes `aria-hidden="true"`.

**This deliberately departs from the source review's wording.** `ReposSection.md` asked for
"a text alternative for the required `*`". A visually-hidden "(required)" placed inside the
label span would be folded into the accessible *name*, because the controls are named by
`aria-labelledby` pointing at that span — so the control would announce "Name required" as
its name and then "required" again as its state. `aria-required` is the channel ARIA defines
for this, and once it carries the meaning the glyph is decoration. Recorded here so a
reviewer reads this as a decision, not a miss.

`Field` and `SettingsFieldShell` both keep their `required` prop and their visual `*`
unchanged; nothing about the rendered pixels moves.

### 2. The hint becomes the control's description when there is no error

`Field` already mints `errorId`; it gains a parallel `hintId` and puts it on the hint span.
`SettingsFieldShell` does the same for its hint `<p>`.
`field-context.ts`'s `useFieldInvalid().describedBy` changes from

- invalid → `errorId`, otherwise `undefined`

to

- invalid → `errorId`; else hint present → `hintId`; else `undefined`.

The error and hint render in exclusive branches of the same `{#if}`, so exactly one id is
ever live and `aria-describedby` never needs a space-separated list. The context object must
expose `hintId` and hint-presence through getters, matching the existing `invalid` getter, so
a control tracks a `hint` that changes after init rather than snapshotting it.

`FieldInvalidState` keeps its two-property shape (`invalid`, `describedBy`); only the
computation behind `describedBy` changes, so no consumer signature moves.

### 3. `PageHeader` renders an `<h2>`, rooted by a hidden `<h1>`

The title `<div>` becomes `<h2 class="ui-page-header__title">`. The existing class carries
`font-family`, `font-size: 20px`, `font-weight: 700`, `color` and `letter-spacing`; the rule
gains `margin: 0` so the UA heading margin does not shift the layout. No other visual
property changes.

The level is **fixed at `h2`, with no `level` prop.** Every one of the 30 render sites is a
section inside a stacked document, so a second level has no consumer today; adding a prop now
would be an untested branch. If a future render site needs one, adding it then is a
two-line change.

`SettingsApp.svelte` gains a visually-hidden `<h1>Settings</h1>` at the top of the ready
state, so the outline is rooted rather than starting at level 2. The sections' existing
`<h3>`s then nest correctly beneath their section's `h2` with no change to them.

The one non-settings consumer, `client/admin/components/StatsPanel.svelte`, is inside the
admin SPA; the same `h2` applies, and this spec does not add an `h1` there — the admin shell
is out of scope and an `h2`-rooted outline is no worse than the `div` it replaces.

### 4. `Input` gains `disabled`

A `disabled?: boolean` prop, defaulting `false`, applied to both the `input` and `textarea`
branches, plus a `.ui-input--disabled` class on the wrapper mirroring `.ui-select--disabled`
(`Select.svelte:82`). Disabled controls are exempt from the contrast floor and from SC
2.5.8, so this introduces no new token work.

`CodeHostSection.svelte` then passes `disabled={saving || loading}` to its `Input`s, matching
what its `Select` already receives on the same line-adjacent markup. That is the only
consumer this spec wires; other sections adopt it when their own reviews call for it.

## Testing

Component tests, one file per primitive touched, following the existing
`tests/client/shared/` pattern:

- `Field` publishes `required` and the control renders `aria-required="true"`; an optional
  field renders no such attribute; the `*` carries `aria-hidden="true"`.
- `aria-describedby` resolves to the hint's id when a hint is present and the field is valid;
  to the error's id when invalid; to nothing when neither is present. Assert the id
  *resolves to an element containing the expected text*, not merely that the attribute is
  non-empty — an id pointing at nothing is the failure mode this test exists to catch.
- The same two assertions against `SettingsFieldShell`, through its existing
  `tests/client/settings/components/ShellInputFixture.svelte` fixture — the second publisher
  must satisfy the same contract, proven separately rather than assumed from `Field`.
- `PageHeader` renders an `h2` carrying the title text.
- `Input` with `disabled` renders a disabled control that does not emit `onInput`.
- One `CodeHostSection` regression test: its text inputs are disabled while a save is in
  flight. This must be shown failing before the fix.

Visual: changes 1–3 are semantics-only, so **`bun shoot` producing no baseline diff is itself
the assertion** — a diff means a UA default leaked through (most likely the `h2` margin) and
is a defect, not a baseline to accept. Change 4 is a genuine visual addition and gets a
disabled-input story state with its own baseline.

Gate: `bun run check:full`, the full client suite, and a clean `bun shoot` across the
settings sections — not only the sections this spec names, because changes 1–3 touch every
form control and every section header in the SPA.

## Risks

| Risk | Mitigation |
| --- | --- |
| The `h2` change ripples visually across 30 sections | `margin: 0` on the title rule, and a full-settings `bun shoot` as the gate rather than a per-section one |
| `aria-required` lands on a control whose `Field` sits in a different component | `Field` publishes through Svelte context, which crosses component boundaries; the existing label-id and error plumbing already proves the path |
| A hint that changes after init snapshots stale | The context exposes `hintId` and presence through getters, as `invalid` already does; a test changes `hint` post-mount |
| The blast radius makes per-task review shallow | Each task is one primitive with its own test file, so a reviewer gates one contract at a time; the whole-branch review is the net for cross-primitive interaction |
