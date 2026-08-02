<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — GuestModeSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/GuestModeSection.svelte`
**States captured:** Enabled (on), Disabled (off), Error, Loading · desktop (base-state PNGs
under `.storybook-shots/settings/sections/GuestModeSection.spec.ts/`), plus three manual states
added below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/GuestModeSection.spec.ts` (7/7 passed, no re-shoot needed this
pass): Disabled at ~640px, and the toggle hovered in both the off and on states (both now the same
`secondary` `Btn` variant — see re-review below). The body copy is a fixed caption and the only
data-driven string is the error message, for which no long-error fixture exists — so overflow of a
long/multiline error remains unverified.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Context

This is a security-relevant group control: when on, **any** unrecognized user in the chat gets a
hardcoded read-only toolset (guest mode; see `docs/architecture/behaviors.md`). The section is a
`PageHeader` with a `Pill` + toggle `Btn` in the action slot and a static help caption.

**Re-review (2026-08-03):** commit `037f4527a` ("fix(settings): make guest-mode state legible +
recoverable (UX review fixes)") directly addressed this document's dominant theme and closed 4 of
6 findings: it added a dedicated `Pill` state indicator, unified both toggle states to the same
`secondary` `Btn` variant (removing the color inversion), added a real loading placeholder, wired
the load-error path through `ErrorState` with retry, wired `busy`/label-changing feedback into the
toggle mutation, and moved the help caption onto the shared `.t-help` class. Two follow-up commits
(`831d6582d`, `2e50df529`) refined the reload-error path to keep the toggle visible instead of
replacing the whole section with `ErrorState` on a refresh-only failure. The remaining gap is
accessibility: no `aria-pressed` on the toggle, no `aria-describedby` linking the caption, and the
inline toggle-mutation error banner still isn't a live region (see the narrowed Med finding below).

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | pass  | `Pill` + toggle now share equal, calm weight (both `secondary` `Btn`); no state is artificially louder than the other (`GuestModeSection.svelte:64-81`).                                 |
| 2. Affordance & signifiers      | pass  | A dedicated `Pill` states "On"/"Off" with a dot beside the title, independent of the button verb (`:64`); tone is `warn` (amber) for on, `mute` (grey) for off — risk-appropriate.       |
| 3. Consistency w/ design system | pass  | Uses `Pill` the same way `MemorySection.svelte:227` does, and the caption now uses the shared `.t-help` class (`client/settings/settings.css:79-83`) instead of a local one-off style.   |
| 4. Feedback & state             | pass  | Loading shows a real `Loading…` placeholder and hides the button until state resolves (`:63,93`); load error renders via `ErrorState` with retry (`:91`); toggle mutation shows `busy` + a changing label (`:68,73-79`). |
| 5. Content & language           | pass  | Errors render through `formatFetchError` (`client/shared/format-error.ts:14-26`), giving human copy ("Something went wrong on the server. Try again shortly.") instead of the raw exception string. |
| 6. Accessibility                | warn  | Real `<button>` with `:focus-visible`; the load-error text now has `role="alert"` (`:96`), but the toggle still has no `aria-pressed`, the caption isn't linked via `aria-describedby`, and the toggle-mutation error banner (`:87`) has no live region. |
| 7. Responsive / layout          | pass  | The ~640px shot reflows cleanly — title/pill/button share the header row, caption wraps to two lines, no clipping or overflow.                                                            |
| 8. Spacing, alignment & sizing  | pass  | Layout is `PageHeader` default spacing; edges align; the caption no longer carries a local one-off style (component has no `<style>` block at all).                                     |
| 9. Interaction & micro-states   | pass  | Hover darkens the shared `secondary` variant in both hovered shots; focus-visible ring exists in `Btn.svelte:77-80`; the PATCH now passes `busy={mutating}` with a changing label (`:68,73-79`), which `Btn` renders as `aria-busy` + dimmed/pointer-events-none (`Btn.svelte:46,49,73-76`). |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Current on/off state has no signifier and the color emphasis is inverted

- **Id:** guest-mode-state-no-signifier-inverted
- **Status:** fixed
- **Resolved:** commit `037f4527a` ("fix(settings): make guest-mode state legible + recoverable (UX
  review fixes)").
- **Dimension:** 2. Affordance & signifiers (also 1. Visual hierarchy)
- **Where visible:** Compare the `Enabled` vs `Disabled` shots. A `Pill` at the header action slot
  now reads "On" (amber, with a dot) or "Off" (grey, no dot) independent of the toggle button, and
  both toggle states use the same `secondary` `Btn` variant — no more green/muted inversion.
- **Source:** `client/settings/sections/GuestModeSection.svelte:64`
  (`<Pill tone={enabled ? 'warn' : 'mute'} dot={enabled}>{enabled ? 'On' : 'Off'}</Pill>`) and `:66`
  (`variant="secondary"` for both states, replacing the old `primary`/`outline` split). Verified in
  `.storybook-shots/settings/sections/GuestModeSection.spec.ts/settings-sections-GuestModeSection-Enabled-1.png`
  and `…-Disabled-1.png`.

### [High] Load error is a raw-text dead-end with no retry

- **Id:** guest-mode-load-error-no-retry
- **Status:** fixed
- **Resolved:** commit `037f4527a` ("fix(settings): make guest-mode state legible + recoverable (UX
  review fixes)"), refined by `2e50df529` (keeps the toggle visible on a reload-only failure instead
  of replacing the whole section).
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** `Error` shot — now shows the shared `ErrorState` with a warning icon, the
  human-readable message "Something went wrong on the server. Try again shortly.", and a "Try again"
  button.
- **Source:** `client/settings/sections/GuestModeSection.svelte:90-91`
  (`{#if error !== null && enabled === null}<ErrorState message={formatFetchError(error)}
  onRetry={() => void load(contextId)} />`); the message now runs through
  `client/shared/format-error.ts:14-26`, which maps thrown errors to short plain-language copy
  instead of the raw exception string. Verified in
  `.storybook-shots/settings/sections/GuestModeSection.spec.ts/settings-sections-GuestModeSection-Error-1.png`.

### [Med] Loading flashes the opposite label and shows no placeholder

- **Id:** guest-mode-loading-flashes-opposite-label
- **Status:** fixed
- **Resolved:** commit `037f4527a` ("fix(settings): make guest-mode state legible + recoverable (UX
  review fixes)").
- **Dimension:** 4. Feedback & state (also 9. Interaction & micro-states)
- **Where visible:** `Loading` shot — now shows the title plus a plain "Loading…" placeholder line;
  no toggle button and no `Pill` render at all until state resolves.
- **Source:** `client/settings/sections/GuestModeSection.svelte:63`
  (`{#if enabled !== null}` gates the entire `Pill`+`Btn` action block, so nothing renders — let
  alone the wrong label — while `enabled` is still `null`) and `:92-93`
  (`{:else if loading && enabled === null}<p class="placeholder">Loading…</p>`). Verified in
  `.storybook-shots/settings/sections/GuestModeSection.spec.ts/settings-sections-GuestModeSection-Loading-1.png`.

### [Med] Toggle gives no in-flight feedback (disabled, not busy)

- **Id:** guest-mode-toggle-no-feedback
- **Status:** fixed
- **Resolved:** commit `037f4527a` ("fix(settings): make guest-mode state legible + recoverable (UX
  review fixes)").
- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** not shootable as a stable frame, but confirmed from source: the button now
  gets `busy={mutating}` and the label switches to "Enabling…"/"Disabling…" during the PATCH.
- **Source:** `client/settings/sections/GuestModeSection.svelte:68`
  (`busy={mutating}`) and `:73-79` (label ternary: `mutating ? (enabled ? 'Disabling…' :
  'Enabling…') : …`). `Btn` renders `busy` as `aria-busy` plus a dedicated
  pointer-events-none/dimmed state (`client/shared/ui/Btn.svelte:46,49,73-76`), so the mutation now
  has a distinct signal for both AT and sighted users.

### [Med] Binary toggle state is not exposed to assistive tech

- **Id:** guest-mode-toggle-not-exposed-a11y
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** source-only (screen-reader / keyboard). The control is a real `<button>` with a
  visible `:focus-visible` ring (good), and the load-error path is now announced, but the toggle's
  on/off value and the toggle-mutation error are still not exposed to AT.
- **Source:** the load-error `<p>` now has `role="alert"`
  (`client/settings/sections/GuestModeSection.svelte:96`) — that part of the original finding is
  resolved. Still open: `:65-71` renders the toggle `<button>` with no `aria-pressed={enabled}`, so
  AT announces "Enable/Disable guest mode, button" with no notion of the current on/off value (the
  new visual `Pill` at `:64` is not read as part of the control); the help caption at `:98-100` is
  still not linked via `aria-describedby`; and the toggle-mutation error banner at `:87`
  (`<p class="status-error" data-testid="guest-mode-error">`) still has no `role`/`aria-live`, unlike
  the load-error `<p>` right below it.
- **Suggested fix:** add `aria-pressed={enabled}` to the toggle button, link the caption via
  `aria-describedby`, and add `role="alert"` to the toggle-mutation error banner at `:87` to match
  the load-error banner at `:96`.

### [Low] Caption re-implements a muted help style locally instead of a shared token

- **Id:** guest-mode-caption-local-style
- **Status:** fixed
- **Resolved:** commit `037f4527a` ("fix(settings): make guest-mode state legible + recoverable (UX
  review fixes)").
- **Dimension:** 3. Consistency with the design system (also 8. Spacing/sizing)
- **Where visible:** all shots — the help line under the title.
- **Source:** `client/settings/sections/GuestModeSection.svelte` no longer defines any local
  `<style>` block (the file ends at line 102, immediately after the markup); the caption at `:98-100`
  now uses the shared `.t-help` class defined once in
  `client/settings/settings.css:79-83` (`font-size: 12px; font-weight: 400; color:
  var(--text-dim)`), the same helper used by other sections' muted help text.
