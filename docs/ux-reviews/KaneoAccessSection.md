<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — KaneoAccessSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/KaneoAccessSection.svelte`
**States captured:** Populated, Not provisioned, Error, Loading, password-revealed, reveal-button hover · desktop + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Summary

Re-review: commit `75b762a5a` ("recompose KaneoAccessSection onto design-system
primitives", 2026-07-08) rewrote the section from raw `<h2>`/`<button>`/`<dl>`/`<a>` +
undefined `.error` onto `PageHeader`, `KV`, `StatusPill`, `ErrorState`, `EmptyState`,
`Code`, and `CopyButton`. Its own commit message names 9 resolved findings; verification
below confirms 8 of the original 9 are actually fixed against current source/screenshots.
The residual (the revealed password could not be re-hidden; copy affordance itself was
already present via `CopyButton`) was later closed by `c7ad1ba31`, which added a one-way
"Hide" control. This is no longer an outlier section — it now matches sibling composition
patterns.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                  |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | `PageHeader` gives eyebrow/title rhythm; `KV` distinguishes label (`--text-dim`) from value (`--text`) as siblings do. |
| 2. Affordance & signifiers      | pass  | `Btn`/`IconButton`/`CopyButton` give hover/focus states consistent with the app's shared controls.                     |
| 3. Consistency w/ design system | pass  | Composes `PageHeader`/`KV`/`StatusPill`/`ErrorState`/`EmptyState`/`Code`/`CopyButton`/`Btn` — no raw elements remain.  |
| 4. Feedback & state             | pass  | `ErrorState` renders a danger-colored, alert-role message; loading uses shared `.placeholder`; busy button disables.   |
| 5. Content & language           | pass  | "No Kaneo access yet" hint now pairs with an `EmptyState` `action` snippet — a "Check again" button re-running `load(contextId)`.       |
| 6. Accessibility                | pass  | Workspace URL now uses `var(--accent)` (green) instead of UA-default link blue; contrast is no longer suspect.         |
| 7. Responsive / layout          | pass  | `.kaneo-url__link { overflow-wrap: anywhere }` plus a `KV` value override let long URLs wrap instead of overflowing.   |
| 8. Spacing, alignment & sizing  | pass  | Rows use `--gap-inline`/`--gap-field` tokens; no more UA-default `dl` margins.                                         |
| 9. Interaction & micro-states   | pass  | Busy "Revealing…" + disabled-in-flight and a working copy button exist; a "Hide" control now clears the revealed password (one-way, matching the server's clear-on-reveal behavior). |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Section bypasses the design system entirely

- **Id:** kaneo-access-bypasses-design-system
- **Status:** fixed
- **Resolved:** `75b762a5a` ("feat(settings): recompose KaneoAccessSection onto design-system primitives", 2026-07-08)
- **Dimension:** 3. Consistency with the design system
- **Where visible:** all states (Populated, Error, Loading, Not provisioned)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:81` (`PageHeader`), `:95` (`EmptyState`), `:99` (`ErrorState`), `:102`/`:116` (`KV`+`StatusPill`), `:132` (`Btn`) — no raw `<h2>`/`<dl>`/native `<button>` remain.
- **Suggested fix:** n/a — resolved.

### [High] Error state does not read as an error

- **Id:** kaneo-access-error-not-legible
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 4. Feedback & state · 6. Accessibility
- **Where visible:** Error state
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:99` — now `<ErrorState message={error} onRetry={...} />`; `ErrorState.svelte:20` (`role="alert"`) and `:55` (`.ui-error__message { color: var(--danger) }`) render the message in alarm-red with a warning icon, confirmed in `.storybook-shots/settings/sections/KaneoAccessSection.spec.ts/settings-sections-KaneoAccessSection-Error-1.png`.
- **Suggested fix:** n/a — resolved.

### [Low] Revealed password cannot be re-hidden

- **Id:** kaneo-access-password-no-copy-rehide
- **Status:** fixed
- **Resolved:** `c7ad1ba31` — a "Hide" control beside the copy button clears `revealedPassword`. Hiding is one-way by design: `src/debug/settings/kaneo-credentials-routes.ts:127` clears the stored password before responding, so a second reveal 409s. A bare Hide would have re-armed a Reveal button that cannot work after the user discarded the only copy; the component instead renders a terminal "shown once" line.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Populated — password revealed
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:121`–`129` — once `revealedPassword !== null`, there is no control to clear it back to the "Reveal password" button state for the rest of the session
- **Prior narrowing:** `75b762a5a` added a `CopyButton` (`:126`) next to the `Code`-contained secret, closing the original "no copy affordance, manual selection of tiny text" complaint and downgrading this from High before this residue was fixed.
- **Suggested fix:** N/A — resolved.

### [Med] Workspace URL link is low-contrast on the dark theme

- **Id:** kaneo-access-url-link-low-contrast
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 6. Accessibility
- **Where visible:** Populated / password-revealed
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:158`–`161` — `.kaneo-url__link { color: var(--accent); overflow-wrap: anywhere; }`; screenshot shows the URL in the app's green accent, not UA-default blue.
- **Suggested fix:** n/a — resolved.

### [Med] Flat visual hierarchy — label and value tiers collapse

- **Id:** kaneo-access-flat-hierarchy
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:102`,`105`,`116` now render through the shared `KV` component; `KV.svelte:20`–`21` colors the label `var(--text-dim)` and the value `var(--text)`, the same label/value tiering used by every other `KV`-based sibling section (no longer a one-off pattern).
- **Suggested fix:** n/a — resolved.

### [Med] Spacing not drawn from the shared scale

- **Id:** kaneo-access-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:149`–`150` (`gap: var(--gap-inline)`, `margin-top: var(--gap-field)`) and `:166`,`:183` (further `--gap-field` uses) — no default `dl`/`dt`/`dd` margins remain.
- **Suggested fix:** n/a — resolved.

### [Low] "Not provisioned" empty state still has no next step

- **Id:** kaneo-access-empty-state-dead-end
- **Status:** fixed
- **Resolved:** `c7ad1ba31` — the `EmptyState` now passes an `action` snippet with a "Check again" button re-running `load(contextId)`. A link was rejected: this is a non-provisioned member's personal view, provisioning is asynchronous server-side, and the SPA has no members/admin destination reachable from that context.
- **Dimension:** 5. Content & language
- **Where visible:** Not provisioned
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:95`–`97` — now composed via `EmptyState` (fixing the "no component" half of the original finding), but no `action` snippet is passed even though `EmptyState` supports one (`EmptyState.svelte:13`,`:23`). The hint text ("ask a group admin to add you") is still the dead end; there is no link or button.
- **Suggested fix:** Pass an `action` snippet to `EmptyState` (e.g. a link to the members/admin contact) instead of relying on prose alone.

### [Low] Loading state is unstyled bare text

- **Id:** kaneo-access-loading-unstyled
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 4. Feedback & state
- **Where visible:** Loading
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:93` — `<p class="placeholder">Loading…</p>`; `.placeholder` is defined at `settings/settings.css:97` (`color: var(--text-muted)`), confirmed muted in the Loading screenshot.
- **Suggested fix:** n/a — resolved.

### [Low] Long workspace URL has no wrap/overflow handling

- **Id:** kaneo-access-url-no-wrap-handling
- **Status:** fixed
- **Resolved:** `75b762a5a`
- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated — narrow (~640px)
- **Source:** `client/settings/sections/KaneoAccessSection.svelte:152`–`161` — a `:global(.ui-kv__v)` override sets `white-space: normal; overflow: visible; text-overflow: clip;` for `.kaneo-url`, and `.kaneo-url__link { overflow-wrap: anywhere; }` lets long hosts break instead of overflow.
- **Suggested fix:** n/a — resolved.
