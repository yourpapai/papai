<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodingCredentialsSection

**Date:** 2026-07-08
**Reviewed:** `client/settings/sections/CodingCredentialsSection.svelte`
**States captured:** Populated, Empty, Error, Loading, text-input focused, secret-replace open, dirty (Save enabled + hover), clear-confirm dialog · desktop (1280) + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

> **Screenshot-fidelity caveat (read first).** The component fetches the `agent-provider`
> namespace (`coding-credentials-fetchers.ts:12`) — a rich form of _Coding agent_,
> _Model provider_, _Auth method_ selects, an _API key_ secret, a _Base URL_, and a _Model_
> combobox with cross-field show/hide logic (`FIELDS_META['agent-provider']`,
> `coding-credentials-fields-meta.ts:18`). **Both Storybook stories serve the `forge`
> fixture shape instead** (`Forge token` + `Instance URL`; `settings-handlers-personal.ts:21`),
> so no screenshot exercises the section's actual primary UI. Field-level findings below are
> therefore anchored in **source**, which the rubric treats as authoritative; the shots
> corroborate only chrome (header, states, actions row, secret masking, focus ring on the
> text `Input`). See finding H1.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                            |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Clean eyebrow/title/helper rhythm, but raw selects render at 14px system font, breaking the 12px-mono field rhythm.                             |
| 2. Affordance & signifiers      | warn  | The agent/provider/auth selects use the card's own background token, so they blend into the field card instead of reading as controls.          |
| 3. Consistency w/ design system | fail  | Raw `<select>` / `<input list>` + one-off `.coding-select` instead of the shared `Select` / `Input` primitives.                                 |
| 4. Feedback & state             | warn  | Loading/error/success are solid; but no empty-guard, disabled-Save reason is undiscoverable, model suggestions appear only post-save.           |
| 5. Content & language           | warn  | Labels/helper are clear; dynamic reveal of _Auth method_ / _Base URL_ has no explanatory text.                                                  |
| 6. Accessibility                | warn  | Labels correctly wired via `aria-labelledby`, but raw selects/combobox carry no app focus ring (UA default only).                               |
| 7. Responsive / layout          | pass  | Field cards + wrapping editor rows reflow at 640; `.coding-select` min-width 200 + `flex:1` holds (verified from source).                       |
| 8. Spacing, alignment & sizing  | warn  | `.coding-select` hardcodes `padding:6px 8px`, `font-size:14px`, `min-width:200px`, and no radius — off the shared scale.                        |
| 9. Interaction & micro-states   | warn  | Btn hover/disabled/busy states are good (Save dims when clean, brightens on hover, shows "Saving…"); raw controls lack a `:focus-visible` ring. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Both stories serve the wrong (`forge`) fixture — the real agent-provider form is never screenshotted, and the empty story misrepresents the shipped empty state

- **Dimension:** 4. Feedback & state (+ review fidelity)
- **Where visible:** Populated (`Forge token` / `Instance URL` rather than agent/provider/model); Empty (helper text "Enter it below" over a **disabled Save with no field at all**)
- **Source:** `client/stories/msw/settings-handlers-personal.ts:21` (populated returns `namespace:'forge'`), `:40` (empty returns `fields: []`); server always emits the full field list for `agent-provider` (`src/debug/settings/coding-credentials-routes.ts:55`, `coding-credentials-fields-meta.ts:18`)
- **Notes:** The real empty/unconfigured state renders the whole form (agent/provider/API-key…), so the `fields: []` empty fixture shows a dead-end that cannot occur in production — while the populated fixture hides the section's actual controls from any visual review.
- **Suggested fix:** Point both stories at `agent-provider` fixtures (populated with a masked key + selected agent/provider/model; empty with the field skeleton, `hasValue:false`) so the shots exercise the shipped UI.

### [Med] Agent/provider/auth selects use the card background token, so they blend into their own field card

- **Dimension:** 2. Affordance & signifiers (also 6. contrast)
- **Where visible:** Real agent-provider form (source); not reproducible in the current forge shots
- **Source:** `.coding-select { background: var(--surface) }` (`CodingCredentialsSection.svelte:394`) resolves to `--surface-1` (`tokens.css:70`), the same token as the `SettingsFieldShell` card (`SettingsFieldShell.svelte:55`); the shared `Input` uses `--raised`/`--surface-2` to stand out (`Input.svelte:88`)
- **Suggested fix:** Give the select/combobox the raised control surface (as `Input`/`Select` do) so it separates from the field card.

### [Med] Raw `<select>` / `<input list>` instead of the shared `Select` / `Input` primitives

- **Dimension:** 3. Consistency with the design system
- **Where visible:** Real agent-provider form (source)
- **Source:** raw controls at `CodingCredentialsSection.svelte:289` (select) and `:301` (combobox) styled by one-off `.coding-select` (`:389`); shared `Select.svelte` (styled caret, mono 12px, `--raised`, focus ring) and `Input.svelte` go unused for these fields
- **Suggested fix:** Render the select fields through the shared `Select` primitive (and reuse `Input` for the combobox shell) so they inherit the caret, tokens, and focus ring.

### [Med] Raw selects/combobox have no app focus ring — keyboard focus is inconsistent with the rest of the form

- **Dimension:** 6. Accessibility (also 9. interaction/micro-states)
- **Where visible:** Keyboard focus on the agent/provider/auth selects and model combobox (source; the text `Input` focus ring is visible in "text-input focused")
- **Source:** `.coding-select` defines no `:focus`/`:focus-visible` rule (`CodingCredentialsSection.svelte:389`); no global fallback exists (`base.css` has none), whereas `Input`/`Select` apply `--focus-ring` (`Input.svelte:93`, `Select.svelte:53`, `tokens.css:39`)
- **Suggested fix:** Apply the shared `--focus-ring` on `:focus-visible` to the raw controls (moot if they adopt the shared primitives per the finding above).

### [Med] `.coding-select` sizing/typography is off the shared scale

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Real agent-provider form (source)
- **Source:** `CodingCredentialsSection.svelte:389` — `font-size:14px` (siblings are 12px mono), no `border-radius` (siblings use `--radius-control:2px`), hardcoded `padding:6px 8px`, `min-width:200px`
- **Suggested fix:** Pull font, radius, and padding from the shared control tokens so the selects line up with the `Input` rows and labels.

### [Low] Empty field list has no guard — helper promises an input that may not render

- **Dimension:** 4. Feedback & state
- **Where visible:** Empty, Empty — narrow 640 (helper "Enter it below" above a disabled Save, no field)
- **Source:** `{#each fields}` with no `{:else}` (`CodingCredentialsSection.svelte:271`–`337`); helper copy at `:264`–`268`
- **Notes:** Low likelihood in production (the server always returns the field skeleton), but any partial-load or future namespace with no fields drops the user into a dead-end.
- **Suggested fix:** Add an `{:else}` empty/error affordance (or hide the helper + Save) when `fields.length === 0`.

### [Low] Model combobox offers no suggestions until credentials are saved, with no hint

- **Dimension:** 5. Content & language
- **Where visible:** Real agent-provider form on first setup (source)
- **Source:** model suggestions load only when a key exists and the provider draft equals the saved provider (`CodingCredentialsSection.svelte:221`–`242`); combobox placeholder is "model id (leave blank for the agent default)" (`:306`)
- **Suggested fix:** Note in the helper/placeholder that the model list populates after the key is saved, so an empty dropdown on first setup does not read as broken.

### [Low] Auth method / Base URL appear and become required with no explanation

- **Dimension:** 5. Content & language (also 4. feedback)
- **Where visible:** Selecting `anthropic` reveals _Auth method_; selecting `openai-compatible` makes _Base URL_ required (source)
- **Source:** `fieldHidden` / `effectiveRequired` logic (`CodingCredentialsSection.svelte:74`–`78`, `:273`); the `openai-compatible` case does supply an inline placeholder hint (`:323`)
- **Suggested fix:** Add a one-line helper on the dynamically-revealed fields explaining why they appeared (e.g. "OAuth is Anthropic-only", "self-hosted endpoints need a base URL").
  </content>
  </invoke>
