<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ReleaseSubscriptionSection

**Date:** 2026-07-03
**Reviewed:** `client/settings/sections/ReleaseSubscriptionSection.svelte`
**States captured:** Subscribed, Unsubscribed, Error, Loading, primary-hover, primary-focus, outline-hover · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

Selected as the next-most-valuable review target: it is the only unreviewed section in the
**top-level Personal nav** (rendered for every user, outside the collapsed "Advanced" group),
alongside the already-reviewed Profile, Task-provider, and Tools sections.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                      |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Standard `PageHeader` eyebrow/title/caption rhythm, consistent with sibling sections.                     |
| 2. Affordance & signifiers      | warn  | Subscription state is signalled only by the toggle's label/variant; no explicit "Subscribed" indicator.   |
| 3. Consistency w/ design system | pass  | Reuses `PageHeader` + `Btn`; matches the header-with-action pattern used across settings.                 |
| 4. Feedback & state             | fail  | Loading is visually identical to Unsubscribed; no in-flight feedback; load error dead-ends with no retry. |
| 5. Content & language           | warn  | Caption is clear, but load failures surface the raw backend string with no framing.                       |
| 6. Accessibility                | pass  | Real `<button>` with a green `:focus-visible` ring inherited in-app; caption contrast within app norms.   |
| 7. Responsive / layout          | pass  | Header reflows cleanly at ~640px; button stays inline and unclipped; caption wraps.                       |
| 8. Spacing, alignment & sizing  | warn  | Error `<p>` has only a color, no spacing token — it crowds the caption when present.                      |
| 9. Interaction & micro-states   | warn  | No busy state on toggle; disabled is opacity-only; primitive focus ring is ancestor-dependent.            |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Loading is indistinguishable from "unsubscribed", and defaults to the green Subscribe CTA before state is known

- **Dimension:** 4. Feedback & state
- **Where visible:** `Loading` vs `Unsubscribed` (desktop) — the two frames are near-identical: both show the green primary **Subscribe** button and the full caption, with no skeleton or spinner.
- **Detail:** `enabled` starts `null`, and the label is `enabled ? 'Unsubscribe' : 'Subscribe'`, so during every page load the control renders the inviting green **Subscribe** CTA (merely disabled via `Btn`'s `opacity: 0.5`). A user whose account is actually _subscribed_ is briefly shown "Subscribe", i.e. the opposite of their real state, and a slow or momentarily-failed load reads as a settled "you are not subscribed" screen.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:75` (label derives only from `enabled`), `:72` (disabled while `enabled === null`)
- **Suggested fix:** While `enabled === null`, render a neutral loading affordance (skeleton or "…") for the action instead of the default green Subscribe CTA, so the resting state is never impersonated before it is known.

### [Med] Load error dead-ends: raw backend string, no retry, toggle stays disabled

- **Dimension:** 4. Feedback & state / 5. Content & language
- **Where visible:** `Error` (desktop + ~640px) — a bare red "boom" appears between title and caption while the button remains a disabled green "Subscribe".
- **Detail:** `load()` failures assign the raw thrown message straight into the template (`{error}`), so users see unframed developer text with no "Couldn't load subscription" context and no icon. Because a load error leaves `enabled === null`, the toggle stays disabled — there is no in-UI way to re-attempt short of reloading the whole settings page.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:80` (renders raw `error`), `:39-43` (load-failure path leaves `enabled` null)
- **Suggested fix:** Present load failures as a friendly section-scoped message with a **Retry** affordance; reserve pass-through of the raw message for mutation failures where the user's action is the trigger.

### [Med] Toggle gives no in-flight feedback

- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not capturable as a stable frame (async), confirmed in source.
- **Detail:** On click, `mutating` only disables the button; the label depends solely on `enabled`, so it keeps reading "Subscribe"/"Unsubscribe" during the request. A slow network call shows a frozen, dimmed button with no "Subscribing…"/spinner, which reads as unresponsive and invites a second-click perception.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:46-59` (toggle sets `mutating` but not label), `:75` (label ignores `mutating`)
- **Suggested fix:** Reflect `mutating` in the control — a busy label ("Subscribing…"/"Updating…") or spinner — so the async work is visibly acknowledged.

### [Low] Error text has no dedicated spacing and disrupts the header → caption rhythm

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `Error` (desktop + ~640px) — "boom" sits tight against the caption with no intentional separation.
- **Detail:** The shared `.status-error` class sets only `color`; the error `<p>` therefore inherits ad-hoc block spacing and is injected between `PageHeader` (which owns the `4px 0 14px` header rhythm) and the caption, crowding the caption and shifting layout when it appears/disappears.
- **Source:** `client/settings/sections/ReleaseSubscriptionSection.svelte:80`; `client/settings/settings.css:91` (`.status-error` is color-only)
- **Suggested fix:** Give the inline error a consistent margin from the spacing scale (or a reserved slot) so the caption keeps a stable position whether or not an error is present.

### [Low] Focus ring is ancestor-provided, not carried by the `Btn` primitive

- **Dimension:** 9. Interaction & micro-states / 6. Accessibility
- **Where visible:** `primary-focus` — in the story harness the focused Subscribe button shows the **UA default blue** outline, not the theme green.
- **Detail:** In the real settings app the button gets a green ring only because it descends from `.settings-grid :focus-visible` (`settings.css:111`). `Btn` itself defines no `:focus-visible`, so the correct ring does not travel with the primitive; any placement outside that ancestor (or a future host) falls back to the mismatched UA outline. In-app behaviour is currently fine — this is a robustness/consistency note.
- **Source:** `client/shared/ui/Btn.svelte` (no `:focus-visible` rule); `client/settings/settings.css:111` (ancestor-scoped ring)
- **Suggested fix:** Move a `:focus-visible` ring onto `Btn` so focus styling is intrinsic to the primitive rather than dependent on a specific ancestor.
