<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodingCredentialsSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/CodingCredentialsSection.svelte`
**States captured:** Populated, Empty, Error, Loading, text-input focused, secret-replace open, dirty (Save enabled + hover), clear-confirm dialog · desktop (1280) + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

> **Re-review update (2026-08-03).** The screenshot-fidelity caveat that used to sit here no
> longer applies: both stories now serve the real `agent-provider` fixture (`namespace:
> 'agent-provider'`, `client/stories/msw/settings-handlers-coding.ts:62`,`:71`) via a dedicated
> `codingCredentialsHandlers` family (introduced in commit `a03f9506c`), and the component was
> refactored onto the shared `Select`/`Combobox`/`Input` primitives (commit `bd4a3a0e8`). Every
> screenshot below now shows the section's actual primary UI — agent/provider/auth-method
> selects, masked API key, base URL, model combobox. See finding H1, now `fixed`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                            |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | The agent/provider/auth selects now render through shared `Select`, 12px mono, matching the field-card rhythm (`Select.svelte:63`).             |
| 2. Affordance & signifiers      | pass  | `Select`/`Combobox` use `--surface-2` against the card's `--surface-1`, so they read as controls, not card background (confirmed in "Populated" shot). |
| 3. Consistency w/ design system | pass  | The section now renders every field through shared `Select`/`Combobox`/`Input`; no raw `<select>`/`<input list>` or `.coding-select` remain (`CodingCredentialsSection.svelte:325`–`351`). |
| 4. Feedback & state             | pass  | Loading/error/success solid; an explicit empty-guard now renders ("No provider fields available…", `:293`–`294`) and a model-suggestions hint covers first setup (`:311`–`313`). |
| 5. Content & language           | pass  | Labels/helper are clear, the model-combobox hints at post-save population, and `hintFor(field)` now explains why _Auth method_ appears and why _Base URL_ becomes required. |
| 6. Accessibility                | pass  | Labels wired via `aria-labelledby` (`SettingsFieldShell.svelte:40`); `Select`/`Combobox` now show a focus ring on `:focus-within` (`Select.svelte:66`–`69`, confirmed in "base URL input focused" shot). |
| 7. Responsive / layout          | pass  | Field cards + wrapping editor rows reflow cleanly at 640 (confirmed in "Populated — narrow 640" and "Empty — narrow 640" shots).                |
| 8. Spacing, alignment & sizing  | pass  | Selects now pull 12px mono font and `border-radius:2px` in line with `Input`/`Combobox`; no more hardcoded 14px/no-radius scale drift (`Select.svelte:54`–`65`). |
| 9. Interaction & micro-states   | pass  | Btn hover/disabled/busy states are good (Save dims when clean, brightens on hover, shows "Saving…"); `Select`/`Combobox` now show the same `:focus-within` ring treatment as `Input`. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Both stories serve the wrong (`forge`) fixture — the real agent-provider form is never screenshotted, and the empty story misrepresents the shipped empty state

- **Id:** coding-credentials-wrong-fixture-stories
- **Status:** fixed
- **Resolved:** commit `a03f9506c` ("refactor(stories): guard agent-provider fixtures by namespace") replaced the shared forge fixture with a dedicated `codingCredentialsHandlers` family serving `namespace: 'agent-provider'` for both Populated and Empty (`client/stories/msw/settings-handlers-coding.ts:62`, `:71`), and commit `bd4a3a0e8` moved the component onto the shared `Select`/`Combobox` primitives. Confirmed by reading the current "Populated" and "Empty" PNGs: both now show _Coding agent_ / _Model provider_ / _Auth method_ selects, a masked API key (`****ab12`) with a Replace button, _Base URL_, and a _Model_ combobox — the section's real primary UI, not the forge shape.
- **Dimension:** 4. Feedback & state (+ review fidelity)
- **Where visible:** Populated and Empty screenshots now show the agent-provider field set; Empty additionally shows the full field skeleton (not a dead-end with no fields) plus the model-suggestions hint.
- **Source:** `client/stories/msw/settings-handlers-coding.ts:29`–`59` (`agentProviderFields`), `:62`–`78` (populated/empty fixtures, both `namespace: 'agent-provider'`)

### [Med] Agent/provider/auth selects use the card background token, so they blend into their own field card

- **Id:** coding-credentials-selects-blend-into-card
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` moved the section's selects onto the shared `Select` component, which sets `background: var(--surface-2)` (`Select.svelte:58`) against the `SettingsFieldShell` card's `background: var(--surface-1)` (`SettingsFieldShell.svelte:84`). Confirmed visually in the "Populated" screenshot: the "Coding agent" / "Model provider" / "Auth method" boxes render as visibly lighter, bordered controls distinct from the surrounding card.
- **Dimension:** 2. Affordance & signifiers (also 6. contrast)
- **Where visible:** "Populated" screenshot — select boxes read as controls, not card background.
- **Source:** `client/shared/ui/Select.svelte:58` (`--surface-2`), `client/settings/components/SettingsFieldShell.svelte:84` (`--surface-1`)

### [Med] Raw `<select>` / `<input list>` instead of the shared `Select` / `Input` primitives

- **Id:** coding-credentials-raw-select-inputs
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` ("refactor(settings): CodingCredentialsSection onto Select/Combobox + empty guard + model hint"). The component now imports and renders the shared `Select`, `Combobox`, and `Input` primitives directly (`CodingCredentialsSection.svelte:19`, `:13`, `:16`, used at `:325`, `:332`, `:340`); no raw `<select>`/`<input list>` or `.coding-select` class remains anywhere in the file (confirmed via `grep -n "coding-select" CodingCredentialsSection.svelte` — no matches).
- **Dimension:** 3. Consistency with the design system
- **Where visible:** All screenshots — selects/combobox render with the shared caret, mono font, and border styling.
- **Source:** `client/settings/sections/CodingCredentialsSection.svelte:324`–`338`

### [Med] Raw selects/combobox have no app focus ring — keyboard focus is inconsistent with the rest of the form

- **Id:** coding-credentials-no-focus-ring
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` moved the selects onto the shared `Select`/`Combobox` primitives, which both define a focus ring: `Combobox.svelte:69`–`72` uses `outline: var(--focus-ring)` directly; `Select.svelte:66`–`69` uses `outline: 2px solid rgba(82, 224, 138, 0.4); outline-offset: 1px`, the literal value `--focus-ring` resolves to (`tokens.css:39`–`40`), so it renders identically. Confirmed in the "Populated — base URL input focused" screenshot: the Base URL `Input` shows the green focus ring, and the same `:focus-within` rule now applies to the Select/Combobox controls above it.
- **Dimension:** 6. Accessibility (also 9. interaction/micro-states)
- **Where visible:** "Populated — base URL input focused" screenshot shows the ring on the text input; the same rule now exists in `Select.svelte`/`Combobox.svelte` for the select/combobox rows.
- **Source:** `client/shared/ui/Select.svelte:66`–`69`, `client/shared/ui/Combobox.svelte:69`–`72`
- **Notes:** `Select.svelte` hardcodes the ring color/width as a literal instead of referencing `var(--focus-ring)` the way `Input`/`Combobox` do — a minor design-token authoring drift (if the token value ever changes, `Select` would not follow), not a visible defect today. Not raised as its own finding since nothing currently renders differently.

### [Med] `.coding-select` sizing/typography is off the shared scale

- **Id:** coding-credentials-select-sizing-off-scale
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` removed `.coding-select` entirely; the shared `Select.svelte` now sets `font-family: var(--font-mono); font-size: 12px` and `border-radius: 2px` (`Select.svelte:61`–`63`), matching the sibling `Input`/`Combobox` rows and the `--radius-control` scale. Confirmed in the "Populated" screenshot — the "Coding agent" / "Model provider" / "Auth method" select rows line up with the "API key", "Base URL", and "Model" input rows at the same left edge, height, and type size.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** "Populated" screenshot — select and input rows share consistent height/typography.
- **Source:** `client/shared/ui/Select.svelte:54`–`65`

### [Low] Empty field list has no guard — helper promises an input that may not render

- **Id:** coding-credentials-empty-field-list-no-guard
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` added an explicit `{:else}` guard: `{#if fields.length === 0}<p class="placeholder">No provider fields available — try Refresh.</p>{:else}…{/if}` (`CodingCredentialsSection.svelte:293`–`294`), so a zero-fields response no longer drops the user into a dead-end helper/Save with nothing to fill in.
- **Dimension:** 4. Feedback & state
- **Source:** `client/settings/sections/CodingCredentialsSection.svelte:293`–`294`

### [Low] Model combobox offers no suggestions until credentials are saved, with no hint

- **Id:** coding-credentials-model-combobox-no-hint
- **Status:** fixed
- **Resolved:** commit `bd4a3a0e8` added an explicit hint on the model row: `hint={field.control === 'combobox' && !hasSavedKey ? 'Save your API key to load model suggestions.' : undefined}` (`CodingCredentialsSection.svelte:311`–`313`). Confirmed in the "Empty" and "Empty — narrow 640" screenshots: the line "Save your API key to load model suggestions." renders directly under the Model field on first setup.
- **Dimension:** 5. Content & language
- **Where visible:** "Empty" and "Empty — narrow 640" screenshots.
- **Source:** `client/settings/sections/CodingCredentialsSection.svelte:311`–`313`

### [Low] Auth method / Base URL appear and become required with no explanation

- **Id:** coding-credentials-conditional-fields-unexplained
- **Status:** fixed
- **Resolved:** `7b7a84b74` — the inline `hint` ternary became a `hintFor(field)` helper carrying three cases: the pre-existing combobox hint, why *Auth method* appears (provider is Anthropic), and why *Base URL* is required (OpenAI-compatible endpoint). A `settings-coding-credentials-openai-compatible` fixture and story were added so the Base URL hint has a shootable state — the story set previously exercised only `claude`/`anthropic`/`api-key`.
- **Dimension:** 5. Content & language (also 4. feedback)
- **Where visible:** Selecting `anthropic` reveals _Auth method_; selecting `openai-compatible` makes _Base URL_ required (source; still not reproducible in the current story set, which only exercises `claude`/`anthropic`/`api-key`)
- **Source:** `fieldHidden` logic (`CodingCredentialsSection.svelte:90`–`94`), `effectiveRequired` (`:305`); the `openai-compatible` case still only supplies an inline placeholder on the `Input` itself ("https://your-llm-endpoint/v1 (required)", `:347`–`349`) and the model combobox now gets a proper `hint` (see the now-`fixed` finding above), but `Auth method`'s reveal (when `provider === 'anthropic'`) and Base URL's required-on-reveal (when `provider === 'openai-compatible'`) still carry no explanatory `hint` prop on their `SettingsFieldShell`.
- **Notes:** Unchanged since the last review — the sibling model-combobox hint was added, but no equivalent hint was added for these two conditional fields. Residue narrowed to: `Auth method`'s appearance and `Base URL`'s required-flip have no `hint`, only Base URL has an inline placeholder.
- **Suggested fix:** Add a one-line helper on the dynamically-revealed fields explaining why they appeared (e.g. "OAuth is Anthropic-only", "self-hosted endpoints need a base URL"), the same way the model combobox now explains its empty state.
