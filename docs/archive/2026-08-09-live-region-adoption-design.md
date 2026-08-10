<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Live-region adoption — Design

**Date:** 2026-08-09

## Problem

A live region announces a change only if the element already existed when the text arrived. A
region created in the same tick as its message is routinely missed by screen readers. Ten sites in
`client/` still build their status and error text as `{#if message}<p role="alert">…</p>{/if}`,
so the node and the text appear together and the announcement is lost.

`LiveRegion.svelte` already solves this: it stays mounted, swaps text in place, and collapses to
zero height when empty. It is used at section level in `AnalyticsPreferencesSection`. This design
extends it to the shared field primitives and to the two sections that carry open findings.

Closes:

- `admin-users-live-region-mounts-with-text` (Med, `AdminUsersSection`)
- `coding-mcp-live-region-mounts-with-text` (Low, `CodingMcpSection`)

## Scope

In scope: `LiveRegion`, the three shared field primitives (`Field`, `SettingsFieldShell`,
`ConfigFieldRow`), `AdminUsersSection`, `CodingMcpSection`, and a guard test.

Out of scope, deliberately: the ~19 other sections whose section-level status paragraphs keep the
old shape. Every section that renders through the three primitives is fixed for free; the rest are
not. This is a chosen inconsistency, and Section 4 makes it an enumerated, checked-in fact rather
than an unwritten one.

## Section 1 — `LiveRegion` gains `id` and `class`

```ts
interface Props {
  message: string | null
  tone: 'status' | 'alert'
  id?: string
  class?: string
  testid?: string
}
```

The element, the `role`/`aria-live` bindings, and the `:empty` collapse are unchanged. The header
comment at `LiveRegion.svelte:16-23` — which explains why the markup must not branch on `tone` —
stays valid verbatim and must not be weakened.

`id` exists because the field primitives' `aria-describedby` points at the error node.

**`class`, when given, replaces the tone class rather than joining it.** Today the component
applies `status-error`/`status-success` itself; those are global rules in `settings.css:119-126`
carrying colour *and* margin. A field passing `ui-field__error` (10px, `--danger`) alongside them
would leave font-size and margin contested with no clear winner. So `tone` keeps owning `role` and
`aria-live` — the accessibility contract — and `class` overrides the visual default. Callers that
pass no `class` keep exactly their current appearance.

## Section 2 — the empty region must not consume a gap

At section level there is nothing to solve: `.settings-section` is normal flow, and `LiveRegion`'s
scoped `.live-region { margin: 0 }` out-specifies `.status-error`'s margin. That is the shipped,
visually verified behaviour.

Both field primitives are grids with `gap`, and **a zero-height grid child still consumes a full
gap**. A permanently mounted empty error region would therefore add `--gap-tight` to the bottom of
every field across the whole settings UI. The node cannot be hidden to avoid this: both
`display: none` and `visibility: hidden` remove it from the accessibility tree, which is the one
thing it is mounted for.

Each primitive gets a single message wrapper — one grid child, mirroring what `.ui-field__control`
already does for the control row (`Field.svelte:66-71`) — plus one rule cancelling the gap while
that wrapper holds nothing visible:

```svelte
<div class="ui-field__msg">
  <LiveRegion tone="alert" message={error ?? null} id={errorId} class="ui-field__error" />
  {#if !error && hint}<span class="ui-field__hint" id={hintId}>{hint}</span>{/if}
</div>
```

```css
/* The region below stays mounted so a screen reader can hear it change, which means it is
   still a grid child when it has no text -- and a zero-height grid child consumes a full row
   gap. It cannot be display:none'd without leaving the accessibility tree, so cancel the gap
   instead of removing the box. */
.ui-field__msg:not(:has(*:not(:empty))) {
  margin-top: calc(-1 * var(--gap-tight));
}
```

`SettingsFieldShell` takes the same wrapper and the same rule against its own `gap`.

Two consequences:

- `.ui-field__error` and `.settings-field__error` must become descendant-scoped globals
  (`.ui-field__msg :global(.ui-field__error)`). A class passed to a child component lands on that
  component's element and does not pick up the parent's scoped styles, so the styling would
  otherwise vanish silently. Precedent: `.settings-field__editor :global(.ui-input)` in
  `SettingsFieldShell.svelte:109`.
- `Field`'s error `<span>` becomes `LiveRegion`'s `<p>`. The wrapper is what keeps
  `grid-row: span 3` (`Field.svelte:59-65`) honest across that change.

**The hint keeps its current behaviour: it renders only while no error is set.** The error and the
hint no longer share a slot in the markup, but they still share it visually, so nothing shifts.

**The `aria-describedby` contract is unchanged** in both primitives: `error ? errorId : hint ?
hintId : undefined`. The error node now always exists, but pointing a control at an empty node
describes it with nothing, so the conditional and its comment at `SettingsFieldShell.svelte:61-67`
both stay correct as written.

## Section 3 — the ten call sites

Each site keeps the tone its current role implies: `role="alert"` becomes `tone="alert"`,
`role="status"` becomes `tone="status"`. No site changes how urgently it announces.

A site converts when its text can change while its container is mounted. A site whose text is
fixed for its container's lifetime is page content, not an announcement, and loses its live role
instead — nothing changed for a screen reader to notice. **No site in the current scope falls
under that second rule**; it is recorded here as the test to apply to future sites.

**Primitives**

- `Field.svelte:50-51` — wrapper + `LiveRegion` per Section 2.
- `SettingsFieldShell.svelte:73-74` — same.
- `ConfigFieldRow.svelte:151-152` — always-mounted region carrying static text:
  `message={justSaved ? '✓ Saved' : null}`. The row is permanently mounted and `justSaved` is a
  timed flag (`:52-61`), making this the clearest later-arriving case of the ten.

**`AdminUsersSection`**

- `:218` / `:219` — the pair the finding names; straight conversion.
- `:243` — always-mounted region inside the open-access card. `openAccessError` is set by the
  loader at `:89` and can change on re-load, so it is a later-arriving message, not mount-time
  content. Compose the full sentence in script so the region carries either complete text or
  nothing — never a bare trailing em-dash.
- `:375` — inside the `Confirm` body snippet. The dialog mounts on open and `removeError` arrives
  only from a failed confirm after that, so mounting the region with the dialog is correct; no
  hoisting to a section-level region is needed.

**`CodingMcpSection`**

- `:206` — the `currentData !== null` guard moves out of the markup and into the message
  (`message={currentData !== null ? error : null}`). That is what lets the node stay mounted.
- `:207` — straight conversion.
- `:218` — always-mounted region inside the `currentData !== null` branch. `unreadableError` is
  `$derived(currentData…)` at `:44`, so a refresh can flip it while that branch stays mounted.

## Section 4 — the guard test

`tests/client/live-region-guard.test.ts`, a plain file-reading `bun:test` — no browser, so it runs
in the default lane rather than the `--conditions=browser` one.

It walks `client/**/*.svelte`, skips `LiveRegion.svelte`, and matches `role="alert"`,
`role="status"`, and `aria-live`. Two assertions, both required:

1. A match in a file not on the allowlist fails. This is the drift guard — it stops the next
   section from copying the old pattern and stops a later edit from re-wrapping a `LiveRegion` in
   an `{#if}`.
2. An allowlist entry with no matches fails. This stops the list from outliving the files it
   excuses, and is what makes it shrink as later sub-projects land.

The allowlist ships holding the ~19 sections left on the old shape, each as a bare path. It is the
checked-in form of the inconsistency this design accepts.

## Section 5 — testing

**Unit.** `LiveRegion.test.ts` covers `id` and `class`, including that `class` replaces rather than
joins the tone class. `Field.test.ts`, `SettingsFieldShell.test.ts`, `ConfigFieldRow.test.ts`, and
`CodingMcpSection.test.ts` each gain the assertion that encodes the fix — *the region is in the DOM
before its message is* — and, for the two primitives, that the hint disappears while an error shows
and that `aria-describedby` resolves to a node that has text.

Client tests run as
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`;
`bunfig.toml` excludes `tests/client/**` from default discovery. The guard test in Section 4 is not
a client test and runs under plain `bun test`.

**Visual.** Re-shoot `CodingMcpSection.spec.ts`, `AdminUsersSection.spec.ts`, and every section
spec rendering through the two primitives. The gap-cancellation rule exists precisely so this is a
no-op: **any baseline diff at all is a bug in that rule**, to be fixed rather than accepted and
re-approved.

## Constraints

- `oxc/no-optional-chaining` is an error in `client/` and `src/`. No `?.` in new code.
- `vitest(no-conditional-in-test)` is an error. Hoist any conditional out of a `test()` body into a
  module-scope helper, following the existing `routePutPending` / `routeRefresh` convention.
- `explicit-function-return-type` is enforced.
- Formatter is `oxfmt` (`bun run format`), not prettier.
- Never add a lint-disable or type-ignore comment. A `max-lines` failure is a design signal — split
  the file.

## Follow-on work, not part of this design

Sub-projects B, C, and D from the same triage remain open and unscoped:
`plugins-inactive-copy-overclaims-approval`, `transcript-aria-live-history-race`,
`settings-app-focus-ring-scoped-to-grid`, and `settings-app-jump-menu-ignores-collapse`.
