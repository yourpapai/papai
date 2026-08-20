<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ReleaseSubscriptionSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/ReleaseSubscriptionSection.svelte`
**States captured:** Subscribed, Unsubscribed, Error, Loading, Mutating (busy), MutationError, primary-hover, primary-focus, outline-hover · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

Re-review: 4 of 5 findings from the 2026-07-03 pass are fixed by a dedicated follow-up
sub-project (`9ab5ee40c` design spec → `1108fa170` plan → `42adf1202`, `75e6b5ac6`,
`62d0a4f03`, `fcf272983` implementation commits, plus `f81de6498`/`d1825ffd9` in `Btn`). One
finding is narrowed to a residual edge case rather than closed outright.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                    |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Standard `PageHeader` eyebrow/title/caption rhythm, consistent with sibling sections.                                    |
| 2. Affordance & signifiers      | pass  | Label+variant toggle (`Subscribe`/primary ↔ `Unsubscribe`/outline) is a pattern shared with `ByokSection`/`MemorySection`, not a one-off. |
| 3. Consistency w/ design system | pass  | Reuses `PageHeader`, `Btn`, `ErrorState`; matches the header-with-action and load/retry patterns used across settings.   |
| 4. Feedback & state             | warn  | Loading, initial load error, and mutation are all now clearly signalled; a background reload failure still surfaces unframed with no retry affordance. |
| 5. Content & language           | pass  | Caption states channel + cadence (DM, per-release, no resend); the initial load error is now framed ("Couldn't load subscription"). |
| 6. Accessibility                | pass  | Real `<button>`; `Btn` now owns its own `:focus-visible` ring; caption/error contrast within app norms.                  |
| 7. Responsive / layout          | pass  | Header and `ErrorState` reflow cleanly at ~640px; button stays inline and unclipped; caption wraps.                      |
| 8. Spacing, alignment & sizing  | pass  | Both the mutation-error line and the reload-failure inline line now carry a token margin (`.settings-section__action-error` and shared `.status-error`), so neither relies on the UA default `<p>` margin. |
| 9. Interaction & micro-states   | pass  | Toggle shows a "Subscribing…/Unsubscribing…" busy label; `Btn` carries an intrinsic `:focus-visible` ring.               |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Loading is indistinguishable from "unsubscribed", and defaults to the green Subscribe CTA before state is known

- **Id:** release-subscription-loading-looks-unsubscribed
- **Status:** fixed
- **Resolved:** `42adf1202` ("fix(settings): gate release-subscription toggle behind load state, add retry + busy feedback"). The toggle is now gated by `showToggle = $derived(enabled !== null)` (`client/settings/sections/ReleaseSubscriptionSection.svelte:62`), and while `enabled === null` the template renders a bare `<p class="placeholder">Loading…</p>` (`:88`) with no button at all — confirmed in the `Loading` story shot (`.storybook-shots/settings/sections/ReleaseSubscriptionSection.spec.ts/settings-sections-ReleaseSubscriptionSection-Loading-1.png`), which shows only the header and "Loading…", never the green Subscribe CTA.
- **Dimension:** 4. Feedback & state
- **Where visible:** `Loading` (desktop) — now a distinct frame from `Unsubscribed`, with no button rendered.
- **Detail (historical):** Previously `enabled` started `null` and the label derived only from `enabled`, so the disabled-but-visible green Subscribe CTA rendered during every load. That code path no longer exists.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:62` (`showToggle`), `:87-88` (loading placeholder)

### [Med] Load error dead-ends: raw backend string, no retry, toggle stays disabled

- **Id:** release-subscription-load-error-dead-end
- **Status:** fixed
- **Resolved:** `42adf1202` + `fcf272983`. The initial-load failure path (`loadError !== null && enabled === null`) now renders the shared `ErrorState` with a framed title, the raw message, and a working retry button: `<ErrorState title="Couldn't load subscription" message={loadError} onRetry={() => void load(contextId)} />` (`client/settings/sections/ReleaseSubscriptionSection.svelte:86`). Confirmed in the `Error` story shot — "Couldn't load subscription" heading, red "boom" message, and a "Try again" button are all present and centered, not a bare disabled toggle.
- **Dimension:** 4. Feedback & state / 5. Content & language
- **Where visible:** `Error` (desktop + ~640px).
- **Detail (historical):** Previously the raw thrown message rendered inline with no framing and no retry path; `fcf272983` additionally split out a narrower residual case — see the new Low finding below for what's left of it.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:85-86`

### [Med] Toggle gives no in-flight feedback

- **Id:** release-subscription-toggle-no-feedback
- **Status:** fixed
- **Resolved:** `f81de6498` ("feat(ui): add busy affordance and intrinsic focus ring to Btn") + `42adf1202`. The button now derives a `busyLabel` (`enabled ? 'Unsubscribing…' : 'Subscribing…'`) shown while `mutating` (`client/settings/sections/ReleaseSubscriptionSection.svelte:61,79`), and `Btn` renders `aria-busy` plus a dimmed, pointer-events-disabled `.ui-btn--busy` style (`client/shared/ui/Btn.svelte:46,49,73-76`). Confirmed in the `Mutating — busy toggle` spec shot: the button reads "Subscribing…" during the in-flight request, not a frozen "Subscribe".
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** `Mutating — busy toggle` spec case — button text visibly changes to "Subscribing…" during the click.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:61` (`busyLabel`), `:79` (label swap); `client/shared/ui/Btn.svelte:46,73-76` (busy styling)

### [Low] Reload-failure inline error line has no spacing token and is unframed

- **Id:** release-subscription-error-text-spacing
- **Status:** fixed
- **Resolved:** `07007a48b` ("fix(settings): give status text a token margin instead of the UA default") (2026-08-04). `.status-error` now carries `margin: var(--gap-inline) 0 0` (`client/settings/settings.css:109`), so the reload-failure line's vertical spacing comes from the spacing scale rather than the browser's default `<p>` margin, and the caption no longer shifts by an unstyled amount when the line appears. `.status-success` gained the same margin (`client/settings/settings.css:113`) so an error and a success message occupy identical space in the same slot.
- **Dimension:** 8. Spacing, alignment & sizing / 4. Feedback & state
- **Where visible:** Not story-captured (requires a successful initial load followed by a failing background reload, i.e. a failed mutation's post-toggle `load()` call while `enabled` is already known) — confirmed in source only.
- **Detail:** The original finding (raw "boom" crowding the caption in the top-level `Error` state) is gone: that state now renders the fully-spaced `ErrorState` component (see above). What remains is narrower — `fcf272983` deliberately kept a lighter-weight inline path for a reload failure that happens *after* `enabled` is already known (`{#if loadError !== null}<p class="status-error" role="alert" ...>{loadError}</p>{/if}`, `client/settings/sections/ReleaseSubscriptionSection.svelte:91`). Unlike the sibling `.settings-section__action-error` class used for mutation errors, which now has an explicit `margin: var(--gap-inline) 0 0` (`:117`), the shared `.status-error` class is still color-only (`client/settings/settings.css:91-93`), so this line's vertical spacing comes only from the browser's UA default `<p>` margin rather than the spacing scale, and the caption's position shifts by that unstyled amount whenever the line appears/disappears.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:91` (unstyled reload-error `<p>`); `client/settings/settings.css:91-93` (`.status-error` is color-only); contrast `client/settings/sections/ReleaseSubscriptionSection.svelte:116-119` (`.settings-section__action-error` — the sibling class that *does* use a token margin)
- **Suggested fix:** Give the reload-error `<p>` the same token-driven margin the mutation-error line already has (or reuse `.settings-section__action-error` for both), so no path relies on UA default spacing.

### [Low] Focus ring is ancestor-provided, not carried by the `Btn` primitive

- **Id:** release-subscription-focus-ring-not-owned
- **Status:** fixed
- **Resolved:** `f81de6498` ("feat(ui): add busy affordance and intrinsic focus ring to Btn"), building on `d1825ffd9` ("refactor(ui): add --focus-ring token and adopt in shared controls"). `Btn` now defines its own `.ui-btn:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset); }` (`client/shared/ui/Btn.svelte:77-80`), independent of the `.settings-grid :focus-visible` ancestor rule (`client/settings/settings.css:111-114`), which still exists but is now redundant rather than load-bearing. Confirmed in the `Unsubscribed — primary button focus` shot: the green ring renders on the button itself.
- **Dimension:** 9. Interaction & micro-states / 6. Accessibility
- **Where visible:** `primary-focus` — focused Subscribe button now shows the theme green ring.
- **Source:** `client/shared/ui/Btn.svelte:77-80` (intrinsic `:focus-visible`); `client/shared/tokens.css:39-40` (`--focus-ring` / `--focus-ring-offset` tokens)
