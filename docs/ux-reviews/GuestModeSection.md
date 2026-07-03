<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — GuestModeSection

**Date:** 2026-07-03
**Reviewed:** `client/settings/sections/GuestModeSection.svelte`
**States captured:** Enabled (on), Disabled (off), Error, Loading · desktop (base-state PNGs
under `.storybook-shots/settings/sections/GuestModeSection.spec.ts/`), plus three manual states
added below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/GuestModeSection.spec.ts` and captured this run
(`bun shoot -g GuestModeSection`, 7/7 passed): Disabled at ~640px, and the toggle hovered in both
the off (primary) and on (outline) states. The body copy is a fixed caption and the only
data-driven string is the error message, for which no long-error fixture exists — so overflow of a
long/multiline error is unverified.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Context

This is a security-relevant group control: when on, **any** unrecognized user in the chat gets a
hardcoded read-only toolset (guest mode; see `docs/architecture/behaviors.md`). The entire section
is one imperative toggle button in the `PageHeader` action slot plus a static help caption — there
is no separate indicator of the current on/off state. Because the consequence of the state is
"strangers can/can't use the bot," the dominant theme below is **state legibility**: the current
value is inferable only from the button's verb, and the color emphasis actively inverts against the
risk (the safe _off_ state is the loud green button; the riskier _on_ state is a muted outline).
It also regresses on recovery affordances relative to already-reviewed siblings — a load error is a
bare dead-end with no retry, one step worse than
[`GroupProviderSection`](./GroupProviderSection.md), which at least keeps a header refresh control.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                    |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Eyebrow → title → caption rhythm matches siblings, but the loudest element is the toggle in its **off** state, mis-weighting emphasis toward "safe" and away from "on". |
| 2. Affordance & signifiers      | fail  | The one thing the section communicates — is guest access on right now? — has no dedicated signifier; state reads only from the verb, and the green/muted cue inverts.   |
| 3. Consistency w/ design system | warn  | Reuses `Btn` + `PageHeader`, but siblings surface current state with a `Pill`/`StatusPill` (`MemorySection.svelte:227`); here there is no state pill at all.            |
| 4. Feedback & state             | fail  | Loading has no placeholder and flashes the opposite label, the error path is a raw `boom` dead-end with no retry, and the toggle shows no in-flight cue.                |
| 5. Content & language           | warn  | Caption copy is genuinely clear and useful, but the error surface renders the raw exception string (`boom`) verbatim.                                                   |
| 6. Accessibility                | warn  | Real `<button>` with a `:focus-visible` ring, but the binary state is not exposed to AT (no `aria-pressed`), the caption is not linked, and the error is not announced. |
| 7. Responsive / layout          | pass  | The ~640px shot reflows cleanly — short title and button share one row, caption wraps to two lines, no clipping or overflow.                                            |
| 8. Spacing, alignment & sizing  | pass  | Layout is `PageHeader` default spacing; edges align. Only nit is a local one-off caption style (folded into a Low finding), not a measurable drift.                     |
| 9. Interaction & micro-states   | warn  | Hover brightens the primary button (verified) and focus-visible exists, but the PATCH uses `disabled` not `busy` — no "…"/`aria-busy`, and disabled has no reason.      |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Current on/off state has no signifier and the color emphasis is inverted

- **Dimension:** 2. Affordance & signifiers (also 1. Visual hierarchy)
- **Where visible:** Compare the `Enabled` vs `Disabled` shots. When guest access is **off** (safe
  default) the control is a bright filled-green **primary** button reading "Enable guest mode" — the
  loudest thing on screen. When guest access is **on** (strangers can use the bot) the control is a
  muted dark **outline** button reading "Disable guest mode" that recedes. There is no status pill,
  dot, or label stating the current value; it is inferable only by parsing the imperative verb.
- **Source:** `client/settings/sections/GuestModeSection.svelte:65`
  (`variant={enabled ? 'outline' : 'primary'}`) and `:70`
  (`{enabled ? 'Disable guest mode' : 'Enable guest mode'}`) — state is encoded entirely in the
  action button, with no separate indicator in the section body. Green filled reads as
  "on/active/good" by convention, but here it means "currently off"; the riskier on-state is the
  quieter variant. Siblings expose current state with a dedicated pill (e.g.
  `client/settings/sections/MemorySection.svelte:227-228`).
- **Suggested fix:** add an explicit current-state indicator (e.g. a `StatusPill` reading "On"/"Off"
  beside the title) so the value is legible without reading the verb, and reconsider the variant
  mapping so visual emphasis tracks the risk-bearing state rather than inverting against it.

### [High] Load error is a raw-text dead-end with no retry

- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** `Error` shot — the body is the single red word "boom" above the caption, and the
  toggle is a dimmed green "Enable guest mode" that cannot be clicked. There is no retry, no refresh,
  and no other affordance; the only recovery is a full page reload.
- **Source:** on load failure `client/settings/sections/GuestModeSection.svelte:33-36` sets `error`
  and leaves `enabled` at `null`; `:75` renders the caught `.message` verbatim
  (`<p class="status-error">{error}</p>`) and `:67` keeps the button `disabled` because
  `enabled === null`. Unlike the sibling [`GroupProviderSection`](./GroupProviderSection.md), this
  section has no header refresh `IconButton`, so a transient GET failure permanently strands the
  control. The message is also the raw exception string, not human copy.
- **Suggested fix:** render load failures through the shared `ErrorState` with
  `onRetry={() => void load(contextId)}`, and present a human-readable message instead of the raw
  exception text.

### [Med] Loading flashes the opposite label and shows no placeholder

- **Dimension:** 4. Feedback & state (also 9. Interaction & micro-states)
- **Where visible:** `Loading` shot — the body renders the full caption and a dimmed green
  "Enable guest mode" button; only the ~0.5 button opacity distinguishes it from a real, usable
  _off_ state. There is no "Loading…" cue.
- **Source:** while `enabled === null` the label ternary at
  `client/settings/sections/GuestModeSection.svelte:70` falls to its `false` branch, so a group that
  actually has guest mode **on** momentarily shows "Enable guest mode" (the opposite of its true
  state) until the GET resolves. The body has no loading placeholder — `:56-58` gates nothing on
  `loading`; the caption at `:77` always renders.
- **Suggested fix:** show a loading placeholder (or neutralize the button label to a non-committal
  string) while `enabled === null && loading`, so the control never advertises the wrong state
  during load.

### [Med] Toggle gives no in-flight feedback (disabled, not busy)

- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** not shootable as a stable frame — during the PATCH the button dims via
  `disabled` but keeps its resting label, making the in-flight frame visually identical to the
  `Loading`/`Error` disabled states; there is no "Enabling…/Disabling…" text or spinner.
- **Source:** `client/settings/sections/GuestModeSection.svelte:42-54` tracks a `mutating` flag but
  passes it only to `disabled` (`:67`), never to `Btn`'s `busy` prop — even though `Btn` already
  renders `busy` as `aria-busy` + a dedicated pointer-events-none dimmed state
  (`client/shared/ui/Btn.svelte:44-47,70-73`). No `aria-busy` is emitted and the label does not
  change, so AT and sighted users get no distinct "working" signal.
- **Suggested fix:** pass `busy={mutating}` to `Btn` with an "Enabling…/Disabling…" label during the
  mutation, so the in-flight state is distinct from a plain disabled control.

### [Med] Binary toggle state is not exposed to assistive tech

- **Dimension:** 6. Accessibility
- **Where visible:** source-only (screen-reader / keyboard). The control is a real `<button>` with a
  visible `:focus-visible` ring (good), but its accessible name is just the imperative verb.
- **Source:** `client/settings/sections/GuestModeSection.svelte:64-71` renders a plain toggle with no
  `aria-pressed` reflecting `enabled`, so AT announces "Enable guest mode, button" with no notion of
  the current on/off value; the help caption at `:77` is not linked to the control
  (`aria-describedby`); and the error `<p>` at `:75` is not a live region, so a toggle failure is
  never announced. (The disabled reason in the error/loading states is likewise not discoverable.)
- **Suggested fix:** give the button a stable accessible name plus `aria-pressed={enabled}`, link the
  caption via `aria-describedby`, and mark the error `role="alert"` (or `aria-live`).

### [Low] Caption re-implements a muted help style locally instead of a shared token

- **Dimension:** 3. Consistency with the design system (also 8. Spacing/sizing)
- **Where visible:** all shots — the help line under the title.
- **Source:** `client/settings/sections/GuestModeSection.svelte:80-86` defines a one-off
  `.settings-section__caption` (`font-size: 12px; color: var(--fg3); line-height: 1.45`) rather than
  reusing a shared caption/help class used elsewhere in settings; sibling muted text draws on shared
  helpers (e.g. the `.placeholder` / `--text-muted` pattern in `client/settings/settings.css:97-99`).
  Visually fine today, but it is an unmanaged duplicate that can drift.
- **Suggested fix:** adopt the shared caption/help class (or `Caption` primitive) so muted help text
  stays consistent across sections.
