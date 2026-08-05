<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — PluginsSection

**Date:** 2026-08-05
**Reviewed:** `client/settings/sections/PluginsSection.svelte`
**States captured:** Populated, Empty, Error, Loading, toggle hover, refresh hover · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**Coverage caveat.** The populated fixture
(`client/stories/msw/settings-handlers-personal.ts:139`) now includes a `--configurable` and an
`--ineligible` variant alongside the original eligible plugin. The `settings-plugins-configurable`
and `settings-plugins-ineligible` scenarios render config rows, a masked secret, ineligible pills
and a disabled toggle, closing the gap this caveat originally recorded. See
`plugins-fixture-coverage-gap`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                   |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Each card is a real `<li>` with an `<h3>` name, a status `Pill` and a trailing action, so weight follows structure      |
| 2. Affordance & signifiers      | pass  | Stored config renders through `SettingsFieldShell` + `Secret` with a "Replace" affordance; a disabled toggle is paired with a discoverable reason |
| 3. Consistency w/ design system | pass  | The section now uses `ErrorState`, `SettingsFieldShell` and `Secret`, matching every sibling config section            |
| 4. Feedback & state             | pass  | Load failure retries through `ErrorState`; toggles and saves show in-flight `busy` state and a transient success marker |
| 5. Content & language           | pass  | Eligibility reasons render as human sentences naming the consequence and next step, not raw enum identifiers          |
| 6. Accessibility                | pass  | Cards are `<li>`s with `<h3>` names; `required` is passed to `Field`; the toggle's `ariaDescribedBy` names its status  |
| 7. Responsive / layout          | pass  | The head row wraps with `min-width: 0` on the name, so a long plugin name no longer squeezes the pill and action       |
| 8. Spacing, alignment & sizing  | pass  | Gaps and padding use `--gap-inline` / `--gap-tight`, the card carries `border-radius: var(--radius)`, and the action sits on a trailing edge |
| 9. Interaction & micro-states   | pass  | Toggle and Save both drive `Btn`'s `busy` prop, so a second click mid-round-trip cannot fire a contradictory request   |

## Findings

### [High] Load failure renders as a bare red word with no recovery path

- **Id:** plugins-load-error-no-recovery
- **Status:** fixed
- **Resolved:** dd5b75d86 — the load-failure path now renders through the shared `ErrorState`
  (title, demoted technical detail, "Try again" retry) instead of a bare `<p class="status-error">`.
- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** `settings-sections-PluginsSection-Error-1.png`, `Plugins-—-error-narrow-1.png` — the entire section is the word "boom" in 11px red
- **Source:** `client/settings/sections/PluginsSection.svelte:125`
- **Suggested fix:** Render the load-failure path through the shared `ErrorState` (title, demoted technical detail, "Try again" retry) as the eighteen sibling sections already do, instead of a bare `<p class="status-error">`.

### [High] Machine enum identifiers are shown as user-facing status copy

- **Id:** plugins-raw-eligibility-strings
- **Status:** fixed
- **Resolved:** b09f857c5 — each eligibility reason is now mapped to a human sentence naming the
  consequence and the next step, instead of the schema's raw `reason` value and joined key names.
- **Dimension:** 5. Content & language
- **Where visible:** Source only — no fixture produces an ineligible plugin; `Populated` shows only the `eligible` case
- **Source:** `client/settings/sections/PluginsSection.svelte:32`
- **Suggested fix:** Map each eligibility reason to a human sentence that names the consequence and the next step (e.g. missing config keys phrased as "Needs an API key before it can run"), rather than emitting the schema's `reason` value and joined key names.

### [High] Stored plugin secrets bypass the section's own config-field pattern

- **Id:** plugins-config-field-not-shell
- **Status:** fixed
- **Resolved:** 00219058f — config rows adopt `SettingsFieldShell` + `Secret`/Replace. Also fixed the
  underlying server defect in 542e7c2f2: `plugins-routes.ts` computed `hasValue` but never emitted
  `value`, so a non-sensitive stored value was invisible in the UI regardless of how the field rendered.
- **Dimension:** 3. Consistency w/ design system (also 2. Affordance)
- **Where visible:** Source only — no fixture supplies a `contextConfig` entry
- **Source:** `client/settings/sections/PluginsSection.svelte:154`
- **Suggested fix:** Adopt the settled pattern from `CodeHostSection.svelte:296` — `SettingsFieldShell` plus `Secret` and an explicit "Replace" affordance — instead of appending `(set)` to the label string and leaving a permanently empty password input that reads as unsaved.

### [High] Toggle and Save give no in-flight signal and stay clickable mid-request

- **Id:** plugins-no-inflight-state
- **Status:** fixed
- **Resolved:** dd5b75d86 — the toggle and Save now drive `Btn`'s `busy` prop from per-plugin and
  per-field pending state, so a second click during the toggle-then-reload round-trip cannot fire a
  contradictory second request.
- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** `Plugins-—-toggle-hovered-1.png` — hover is the only state the button ever leaves its resting appearance for
- **Source:** `client/settings/sections/PluginsSection.svelte:65`
- **Suggested fix:** Track per-plugin and per-field pending state and pass it to `Btn`'s existing `busy` prop, so a second click during the toggle-then-reload round-trip cannot fire a contradictory second request.

### [High] Required-field validation surfaces at the top of the section, not at the field

- **Id:** plugins-validation-far-from-field
- **Status:** fixed
- **Resolved:** dd5b75d86 — the "is required" message now routes into the owning `Field`'s `error`
  prop, which wires `role="alert"`, `aria-invalid` and adjacency, instead of the section-wide error
  variable shared with load and toggle failures.
- **Dimension:** 4. Feedback & state (also 6. Accessibility)
- **Where visible:** Source only
- **Source:** `client/settings/sections/PluginsSection.svelte:80`
- **Suggested fix:** Route the "is required" message into the owning `Field`'s `error` prop — which already wires `role="alert"`, `aria-invalid` and adjacency — instead of the section-wide `error` variable shared with load and toggle failures, which can land off-screen above a card the user scrolled to.

### [Med] A disabled Enable button never explains why

- **Id:** plugins-disabled-toggle-unexplained
- **Status:** fixed
- **Resolved:** b09f857c5 — the status `Pill` gained an id and the disabled toggle's
  `ariaDescribedBy` points at it, pairing the control with a discoverable reason instead of leaving
  it a dead control.
- **Dimension:** 4. Feedback & state (also 2. Affordance)
- **Where visible:** Source only — no fixture produces an inactive plugin
- **Source:** `client/settings/sections/PluginsSection.svelte:146`
- **Suggested fix:** Pair the disabled toggle with a discoverable reason (hint text or `ariaDescribedBy` pointing at the eligibility copy) so "inactive" reads as an operator-side state the user cannot resolve here, rather than a dead control.

### [Med] Card spacing and radius are hardcoded px off the shared scale

- **Id:** plugins-hardcoded-spacing
- **Status:** fixed
- **Resolved:** cb8b63d5a — the literal 12/10/8px gaps and padding are replaced with `--gap-inline` /
  `--gap-tight`, and the card now carries `border-radius: var(--radius)` to match the sibling card in
  `McpSection.svelte`.
- **Dimension:** 8. Spacing, alignment & sizing (also 3. Consistency)
- **Where visible:** `settings-sections-PluginsSection-Populated-1.png` — square corners next to `McpSection`'s rounded cards at the same width
- **Source:** `client/settings/sections/PluginsSection.svelte:208`
- **Suggested fix:** Replace the literal 12/10/8px gaps and padding with `--gap-inline` / `--gap-tight` (10px sits on no rung of the 4px scale) and add `border-radius: var(--radius)` to match the sibling card in `McpSection.svelte`.

### [Med] Head row has no trailing edge and no wrap for long plugin names

- **Id:** plugins-head-no-trailing-alignment
- **Status:** fixed
- **Resolved:** cb8b63d5a — the action now sits on a `margin-left: auto` trailing edge as
  `McpSection`'s row does, and `flex-wrap` plus `min-width: 0` on the name let a long plugin name wrap
  instead of squeezing the pill and button.
- **Dimension:** 7. Responsive / layout (also 8. Spacing)
- **Where visible:** `settings-sections-PluginsSection-Populated-1.png` (action crowded against the pill, ~1070px of empty card to its right) and `Plugins-—-populated-narrow-1.png`
- **Source:** `client/settings/sections/PluginsSection.svelte:219`
- **Suggested fix:** Give the action a `margin-left: auto` trailing edge as `McpSection`'s row does, and add `flex-wrap` plus `min-width: 0` on the name so a long plugin name wraps instead of squeezing the pill and button.

### [Med] Plugin cards carry no list or heading structure

- **Id:** plugins-cards-not-a-list
- **Status:** fixed
- **Resolved:** b09f857c5 — cards are now emitted as `<li>` list items with the plugin name as a real
  `<h3>` heading, so a screen-reader user can count and jump between plugins instead of traversing a
  flat run of `div`/`span`.
- **Dimension:** 6. Accessibility
- **Where visible:** Source only
- **Source:** `client/settings/sections/PluginsSection.svelte:136`
- **Suggested fix:** Emit the cards as list items with the plugin name as a real heading, so a screen-reader user can count and jump between plugins instead of traversing a flat run of `div`/`span`.

### [Med] Saving a config value produces no confirmation

- **Id:** plugins-save-no-success-feedback
- **Status:** fixed
- **Resolved:** dd5b75d86 — a save is acknowledged with a transient `✓ Saved` marker. Also fixed the
  underlying server defect in 542e7c2f2: the route answers an empty or masked-equal submit on a
  sensitive field with `{ unchanged: true }`, and `patchPluginConfig` discarded it, so that Save reported
  nothing at all. The card now says "No change — the stored value was the same" instead.
- **Dimension:** 4. Feedback & state
- **Where visible:** Source only
- **Source:** `client/settings/sections/PluginsSection.svelte:86`
- **Suggested fix:** Acknowledge a successful save explicitly; today the draft is cleared and the list reloaded, so for a sensitive field the only evidence is `(set)` appearing in the label — indistinguishable from a save that silently no-opped.

### [Med] Required-ness is label text, so the input is never marked required

- **Id:** plugins-required-not-passed-to-field
- **Status:** fixed
- **Resolved:** 00219058f — `required={cfg.required}` is now passed to `Field`, which renders the
  asterisk `aria-hidden` and sets `aria-required` on the control, instead of concatenating `' *'` into
  the label.
- **Dimension:** 6. Accessibility
- **Where visible:** Source only
- **Source:** `client/settings/sections/PluginsSection.svelte:154`
- **Suggested fix:** Pass `required={cfg.required}` to `Field` — which renders the asterisk `aria-hidden` and sets `aria-required` on the control — instead of concatenating `' *'` into the label, where it is announced as literal punctuation and conveys nothing programmatically.

### [Low] Empty state is a dead end

- **Id:** plugins-empty-state-dead-end
- **Status:** fixed
- **Resolved:** cb8b63d5a — the empty state now uses `EmptyState`'s `hint` to say who installs
  plugins and what the user can do next, instead of titling the void "No plugins discovered" and
  stopping.
- **Dimension:** 5. Content & language
- **Where visible:** `settings-sections-PluginsSection-Empty-1.png`, `Plugins-—-empty-narrow-1.png`
- **Source:** `client/settings/sections/PluginsSection.svelte:130`
- **Suggested fix:** Use `EmptyState`'s existing `hint` (and optionally `action`) to say who installs plugins and what the user can do next, rather than titling the void "No plugins discovered" and stopping.

### [Low] The state toggle does not expose its pressed state

- **Id:** plugins-toggle-no-aria-pressed
- **Status:** fixed
- **Resolved:** b09f857c5 — closed by a different mechanism than suggested. `ariaPressed` was
  rejected on the precedent set for `guest-mode-toggle-not-exposed-a11y`: the button's label already
  swaps between "Enable" and "Disable", so `aria-pressed` would announce "Disable, pressed" — the label
  naming the action and the state naming its opposite. The status `Pill` gained an id and the toggle's
  `ariaDescribedBy` points at it, giving "Disable, button, Ready".
- **Dimension:** 6. Accessibility
- **Where visible:** Source only
- **Source:** `client/settings/sections/PluginsSection.svelte:142`
- **Suggested fix:** Pass `ariaPressed={plugin.enabled}` to the existing `Btn` prop so the on/off state is programmatic, not inferable only from whether the label currently reads "Enable" or "Disable".

### [Low] No story exercises the section's config, ineligible, or disabled paths

- **Id:** plugins-fixture-coverage-gap
- **Status:** fixed
- **Resolved:** 00219058f — the populated plugins fixture gained an ineligible plugin and a plugin
  carrying required and sensitive `contextConfig` entries (`--configurable` / `--ineligible` story
  fixtures), so this section's config, ineligible and disabled paths are now visually reviewable and
  regression-gated.
- **Dimension:** 4. Feedback & state (review coverage)
- **Where visible:** `settings-sections-PluginsSection-Populated-1.png` — one eligible plugin, no config rows
- **Source:** `client/stories/msw/settings-handlers-personal.ts:139`
- **Suggested fix:** Extend the populated plugins fixture with an ineligible plugin and a plugin carrying required and sensitive `contextConfig` entries, so more than half of this section's UI becomes visually reviewable and regression-gated.
