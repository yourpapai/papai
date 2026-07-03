<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — ReleaseSubscriptionSection UX fixes

**Date:** 2026-07-03
**Source review:** [`docs/ux-reviews/ReleaseSubscriptionSection.md`](../../ux-reviews/ReleaseSubscriptionSection.md)
**Component:** `client/settings/sections/ReleaseSubscriptionSection.svelte`
**Shared primitive touched:** `client/shared/ui/Btn.svelte`

## Purpose

Resolve all five findings from the UX review of `ReleaseSubscriptionSection` — the only
unreviewed section in the top-level Personal settings nav. The section currently defaults to
a green "Subscribe" CTA before its real state is known, dead-ends on load errors with a raw
backend string and no retry, gives no in-flight feedback on the toggle, and crowds its
caption with an unspaced error line. Two findings require an additive change to the shared
`Btn` primitive (a `busy` affordance and an intrinsic focus ring).

The fixes adopt conventions already established in sibling sections — `AiOutputSection` is the
canonical template (body swaps between `ErrorState` / `Loading…` / content; always-present
header action) — rather than inventing new patterns.

## Findings addressed

| #   | Severity | Finding                                                                                        | Fix summary                                                                               |
| --- | -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A   | High     | Loading is indistinguishable from "unsubscribed"; green Subscribe CTA shown before state known | Gate the toggle: hide it until `enabled !== null`; show a distinct `Loading…` placeholder |
| B   | Med      | Load error dead-ends: raw string, no retry, toggle stuck disabled                              | Render `ErrorState` (framed title + retry) for load failures                              |
| C   | Med      | Toggle gives no in-flight feedback                                                             | New `Btn` `busy` prop + label swap to "Subscribing…"/"Unsubscribing…" while mutating      |
| D   | Low      | Inline error has no dedicated spacing; crowds caption                                          | Split load vs mutation error; give the mutation error a spacing token and `role="alert"`  |
| E   | Low      | `Btn` focus ring is ancestor-provided, not intrinsic                                           | Move a `:focus-visible` ring onto the `Btn` primitive                                     |

## Architecture

### 1. Section state machine (`ReleaseSubscriptionSection.svelte`)

Split the single `error` field into two concerns so load failures and mutation failures render
differently:

- `loadError: string | null` — a failure while fetching the current subscription state.
- `actionError: string | null` — a failure while toggling (user-triggered).

Rendering gates, in priority order (mirrors `AiOutputSection`):

```
loadError !== null   → <ErrorState title="Couldn't load subscription"
                          message={loadError} onRetry={() => void load(contextId)} />
                        (header shows title only — no toggle)

enabled === null      → header title only; body <p class="placeholder">Loading…</p>
                        (no toggle — the resting CTA is never impersonated)

enabled !== null      → header shows the toggle (primary Subscribe / outline Unsubscribe);
                        body shows the caption; actionError (if any) renders inline
                        below the caption
```

State-handling rules:

- The toggle lives in the `PageHeader` `action` snippet and is only rendered when
  `enabled !== null` and `loadError === null`. This is the core of Finding A: the header
  action slot is empty during load/error, so the green "Subscribe" CTA can never appear
  before the real state is known. Accept the minor layout shift when the button appears.
- **Loading affordance (Finding A):** while `enabled === null` and no `loadError`, the body is
  `<p class="placeholder">Loading…</p>` — the same primitive 13 other sections use.
- **Load error (Finding B):** a `load()` failure sets `loadError` and leaves `enabled === null`;
  the body renders `ErrorState` with `onRetry` wired to `load(contextId)`. `ErrorState`
  supplies the framed title, `⚠` icon, the raw message as secondary detail, and the retry
  button — so the user is never stranded.
- **In-flight feedback (Finding C):** `toggle()` sets `mutating = true`; the toggle receives
  `busy={mutating}` (new `Btn` prop) and its label swaps to **"Subscribing…"** (when
  `enabled === false`) / **"Unsubscribing…"** (when `enabled === true`) for the duration.
  Because the toggle is now only rendered when `enabled !== null && loadError === null`, the
  old `disabled={enabled === null || loading || mutating}` expression is no longer needed:
  `mutating` moves to `busy` (so we get one busy affordance, not busy + a second `disabled`
  0.5 dim stacked on it), and the `enabled === null` / `loading` guards are handled by the
  render gate. The toggle's `disabled` prop can therefore drop entirely.
- **Mutation error + spacing (Finding D):** a `toggle()` failure sets `actionError` while
  `enabled` stays intact, so the toggle remains visible. `actionError` renders inline below
  the caption in a wrapper carrying a real spacing token (`--gap-inline`) and `role="alert"`.
  Raw pass-through of the backend message is acceptable here because the user triggered the
  action. Clearing: `actionError` resets to `null` at the start of the next `toggle()`, and
  `loadError` resets at the start of `load()`.

Preserved as-is: the `scope === 'group' && id !== contextId` stale-response guard, the
`messageFrom` helper, the `$effect(() => void load(contextId))` load trigger, and the group vs
personal caption/label copy.

### 2. Shared `Btn` primitive (`client/shared/ui/Btn.svelte`)

Two additive, backward-compatible changes:

- **`busy?: boolean` prop** (default `false`), mirroring the existing `IconButton` `busy`
  affordance:
  - adds `class:ui-btn--busy` → `{ opacity: 0.6; pointer-events: none; }`;
  - sets `aria-busy={busy}`;
  - is treated as non-interactive (the button does not fire `onClick` while busy — achieved by
    disabling interaction, e.g. `disabled={disabled || busy}` on the element while keeping the
    two states visually and semantically distinct: `disabled` = forbidden, `busy` = working).
  - Existing callers pass no `busy` → unchanged.
- **Intrinsic `:focus-visible` ring** on `.ui-btn`, using the app's existing token value so
  there is no visual change where the ancestor ring already applies:
  ```css
  .ui-btn:focus-visible {
    outline: 2px solid rgba(82, 224, 138, 0.4);
    outline-offset: 1px;
  }
  ```
  This duplicates the value currently provided only by `.settings-grid :focus-visible`
  (`client/settings/settings.css:111`), making focus styling travel with the primitive into
  the debug app, admin app, and Storybook. The ancestor rule may remain; the values are
  identical so they do not conflict.

## Data flow

No change to fetchers or the network layer. `fetchReleaseSubscription` /
`fetchGroupReleaseSubscription` / `patchReleaseSubscription` /
`patchGroupReleaseSubscription` are used exactly as today. All changes are in component render
logic and local `$state`.

## Error handling

- **Load failure** → `loadError` set → `ErrorState` in body with retry. Non-alarming, framed,
  recoverable in place.
- **Toggle failure** → `actionError` set, `enabled` unchanged → inline `role="alert"` message
  below the caption; the toggle stays enabled so the user can immediately retry by clicking.
- **Stale group response** → existing guard drops the result silently (unchanged).

## Testing & verification

- **Stories** (`ReleaseSubscriptionSection.stories.svelte`): keep `Subscribed`, `Unsubscribed`,
  `Loading` (now renders `Loading…`), `Error` (now renders `ErrorState` + retry). Add a
  `MutationError` state (toggle visible, inline error) and a busy/`Mutating` state if a fixture
  supports an in-flight frame.
- **Screenshots:** re-shoot `ReleaseSubscriptionSection` per
  `docs/architecture/storybook-screenshots.md` and confirm: no green CTA during load; `Loading…`
  visible; `ErrorState` + retry on load error; busy label + dim during mutation; inline error
  spaced away from the caption.
- **Shared `Btn` blast radius:** because Section 2 touches a shared primitive, re-shoot the
  `Btn` stories and spot-check a sample of consuming sections to confirm the focus ring is
  additive-only (identical value) and `busy` defaults leave existing buttons unchanged.
- **Unit/behaviour:** existing component tests continue to pass; add coverage for the
  load-error-vs-mutation-error split (that a load failure hides the toggle and shows retry,
  and a toggle failure keeps the toggle and shows an inline alert).

## Out of scope

- No change to the announcement delivery backend, fetchers, or subscription semantics.
- No redesign of `PageHeader`, `ErrorState`, or `EmptyState`.
- No broader audit of other sections' loading/error handling beyond the `Btn` spot-check.

## Findings-to-change traceability

| Finding  | Files touched                                                                            |
| -------- | ---------------------------------------------------------------------------------------- |
| A (High) | `ReleaseSubscriptionSection.svelte` (gate toggle, `Loading…` placeholder)                |
| B (Med)  | `ReleaseSubscriptionSection.svelte` (`loadError` → `ErrorState` + retry)                 |
| C (Med)  | `ReleaseSubscriptionSection.svelte` (busy + label swap), `Btn.svelte` (`busy` prop)      |
| D (Low)  | `ReleaseSubscriptionSection.svelte` (`actionError` split, spacing token, `role="alert"`) |
| E (Low)  | `Btn.svelte` (`:focus-visible` ring)                                                     |
