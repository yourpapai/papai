<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodeHostSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/CodeHostSection.svelte`
**States captured:** Populated, Empty, Error, Loading, Save validation error, Incomplete, Self hosted, secret-replace open, dirty (Save enabled), Save hover while disabled, clear-confirm dialog, long-URL overflow, self-hosted kind reveals Instance URL, inline error under the offending field · desktop (1280) + ~640px narrow
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

> **Re-review note (2026-08-03).** The section was substantially rewritten since the
> 2026-07-31 pass (see `git log -- client/settings/sections/CodeHostSection.svelte` between
> `f934dbf65` and `e9c0b3baa`), alongside a dedicated `forge`-namespace MSW fixture family
> (`client/stories/msw/settings-handlers-coding.ts`) and shared-primitive work in
> `SettingsFieldShell.svelte`, `Input.svelte`, and `client/shared/tokens.css`. The
> screenshot-fidelity caveat from the previous pass no longer applies — every story now
> renders the real forge form (Host type / Instance URL / Access token) — so it has been
> removed. All 13 prior findings are re-verified below; 12 now reproduce as fixed against
> current source and screenshots, 1 (bare required marker) is fixed via a different
> mechanism than originally suggested. One new finding was opened
> (`code-host-setup-hint-unbounded-measure`): the new first-setup hint paragraph has no
> `max-width`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | A `StatusPill` (connected/pending/not connected/error) plus a `sub` naming the host now sit in the header; the primary action is still the smallest control on the page but is no longer the only signal of state. |
| 2. Affordance & signifiers      | pass  | Clear is now `variant="danger"` (`CodeHostSection.svelte:334`), matching the weight of the confirm dialog it opens.                                    |
| 3. Consistency w/ design system | pass  | Setup helper, empty-fields guard, field hints, and the hidden-field submit invariant are now all present, mirroring the sibling `CodingCredentialsSection`. |
| 4. Feedback & state             | pass  | Connection state, first-setup guidance, inline per-field errors, the conditional required Instance URL, and the stale-hidden-field submit invariant are all wired and screenshot-verified. |
| 5. Content & language           | pass  | The empty state now explains what the connection is for and what scopes the token needs; the label collision between the section title and the `kind` field is resolved (`kind` label is now "Host type").|
| 6. Accessibility                | pass  | `aria-required` now travels through `field-context.ts` to the actual control; the page title is a real `<h2>`; controls clear the 24px target floor.  |
| 7. Responsive / layout          | pass  | Field cards and wrapping editor rows reflow cleanly at 640; a long self-hosted URL stays contained inside the input (verified in the long-value shot). |
| 8. Spacing, alignment & sizing  | warn  | The actions row now declares `gap: var(--gap-tight)` and matches the field-card content edge, but the first-setup hint paragraph has no `max-width` and runs as one ~1230px unbroken line. |
| 9. Interaction & micro-states   | pass  | Save disabled→enabled, hover, "Saving…"/"Clearing…", the focus ring, and now `Input`'s own `disabled` prop during save/refresh are all verified working. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] All four stories serve the `agent-provider` fixture — the forge form has zero screenshot coverage

- **Id:** code-host-forge-form-uncovered
- **Status:** fixed
- **Resolved:** `a03f9506c` (refactor(stories): guard agent-provider fixtures by namespace) + `7a4cee9ec` (feat(stories): add forge fixtures and retarget CodeHostSection) + `d1306207d`/`d1d2b9ca4` (rename + connection-state coverage)
- **Dimension:** 4. Feedback & state (+ review fidelity)
- **Where visible:** All seven state stories (Populated, Empty, Error, Loading, Save validation error, Incomplete, Self hosted) plus 8 manual interaction specs now render the real forge fields
- **Source:** `client/stories/msw/settings-handlers-coding.ts:117`–`263` defines namespace-guarded `forgeHandlers`/`forgeIncompleteHandlers`/`forgeSelfHostedHandlers`/`forgeSaveErrorHandlers`, each gated by `isNamespace(request, 'forge')` (`:210`, `:216`, `:229`, `:245`); `CodeHostSection.stories.svelte:20`–`61` wires all seven states to these fixtures; `tests/visual/settings/sections/CodeHostSection.spec.ts` covers the `kind` select reveal (`:98`–`102`) and the 422 inline-error path (`:104`–`110`)
- **Notes:** Confirmed against the current baselines — `settings-sections-CodeHostSection-Populated-1.png` shows "Host type / Access token" under "Code host", not the agent/provider fields the old fixture served.

### [High] Nothing tells the user whether a code host is connected — `complete` and `missing` are never rendered

- **Id:** code-host-connection-state-hidden
- **Status:** fixed
- **Resolved:** `e00d0b503` (feat(settings): surface code-host connection state in the header)
- **Dimension:** 1. Visual hierarchy & scanning (also 4. feedback & state)
- **Source:** `CodeHostSection.svelte:100`–`105` derives `statusPill` from `configured`/`complete`/`unreadable` (error/not connected/pending/connected); `:107`–`116` derives `headerSub` naming the forge kind and host or "needs an access token"; both are rendered via `PageHeader`'s `action`/`sub` (`:257`–`261`)
- **Notes:** Verified in `settings-sections-CodeHostSection-Populated-1.png` ("connected" pill, "GitHub · github.com" sub) and `-Incomplete-1.png` ("pending" pill, "GitHub · needs an access token" sub).

### [High] The empty / first-setup state gives no guidance at all

- **Id:** code-host-empty-state-no-guidance
- **Status:** fixed
- **Resolved:** `b085b844c` (feat(settings): explain the code-host token on first setup)
- **Dimension:** 5. Content & language
- **Source:** `CodeHostSection.svelte:279`–`281` renders a `data-testid="code-host-setup-hint"` paragraph whenever `!currentData.complete`, naming what the connection is for and what scope the token needs; `placeholderFor` gives the token field a scope-specific placeholder ("token with repo read/write access", `:174`)
- **Notes:** Verified in `settings-sections-CodeHostSection-Empty-1.png` and `-Incomplete-1.png` — both show the helper paragraph above the fields.

### [High] The revealed Instance URL is neither marked required nor hinted, yet the server rejects it blank

- **Id:** code-host-instance-url-unmarked-required
- **Status:** fixed
- **Resolved:** `e39bc95f8` (feat(settings): mark and explain the conditional instance URL)
- **Dimension:** 4. Feedback & state (also 5. content)
- **Source:** `CodeHostSection.svelte:286`, `:289` computes `instanceUrlShown` and passes `required={field.required || instanceUrlShown}` to `SettingsFieldShell`; `:292`–`294` passes a `hint` explaining why the field appeared ("Needed because you chose a self-hosted code host…"); `placeholderFor` gives it an `https://…` example (`:175`)
- **Notes:** Verified in `settings-sections-CodeHostSection-Self-hosted-1.png` — Instance URL shows a green `*` and the hint paragraph beneath it.

### [Med] Validation surfaces only as a top banner carrying raw server text — the field shell has no inline error channel

- **Id:** code-host-validation-no-inline-channel
- **Status:** fixed
- **Resolved:** `98ff431e6` (feat(settings): give SettingsFieldShell an inline error and hint channel) + `cc75d00c1` (feat(settings): render attributed validation errors under their field)
- **Dimension:** 4. Feedback & state (also 6. accessibility)
- **Source:** `CodeHostSection.svelte:79`–`81` derives `inlineField` from the server-named `errorField` resolved against visible fields; `:264` suppresses the banner when the error is attributed inline; `:291` passes `error={inlineField === field.key ? (error ?? undefined) : undefined}` to `SettingsFieldShell`, which now calls `setFieldError` (`SettingsFieldShell.svelte:43`–`55`) exposing `invalid`/`describedBy`/`required` via `client/shared/ui/field-context.ts:56`–`73`; `Input.svelte:63`, `:81`–`83` wires `aria-invalid`/`aria-describedby`/`aria-required` and `.ui-input--invalid` (`:103`–`105`) from that context
- **Notes:** Verified in `CodeHostSection-—-inline-error-under-the-offending-field-1.png` — the red-bordered Instance URL input carries "required for self-hosted code hosts, and must start with https://" directly beneath it, no top banner.

### [Med] Switching back to a SaaS kind leaves a stale stored Instance URL

- **Id:** code-host-stale-instance-url-on-saas
- **Status:** fixed
- **Resolved:** `23241c765` (fix(settings): clear a stale instance URL when saving a SaaS code host)
- **Dimension:** 4. Feedback & state
- **Source:** `collectValues()` (`CodeHostSection.svelte:188`–`204`) explicitly sets `values['instance_url'] = ''` whenever the field exists and the current kind doesn't need it (`:200`–`202`), with a comment naming the exact bug this closes
- **Notes:** This is the same submit-time-invariant pattern the sibling `CodingCredentialsSection` used, now applied here directly rather than left as a gap.

### [Med] No guard when the field list comes back empty

- **Id:** code-host-no-empty-field-list-guard
- **Status:** fixed
- **Resolved:** `420af5eee` (feat(settings): guard empty code-host fields and weight the Clear trigger)
- **Dimension:** 4. Feedback & state
- **Source:** `{#if fields.length === 0}` now renders `data-testid="code-host-no-fields"` "No code host fields available — try Refresh." (`CodeHostSection.svelte:276`–`277`) before falling into the field loop

### [Med] Text inputs stay editable during save and refresh, then get overwritten

- **Id:** code-host-inputs-editable-during-save
- **Status:** fixed
- **Resolved:** `d29bcbf45` (fix(settings): lock the code-host inputs while a save is in flight)
- **Dimension:** 9. Interaction & micro-states
- **Source:** `Input.svelte` now exposes a `disabled` prop (`:19`, `:33`) applied to the underlying `<input>`/`<textarea>` (`:60`, `:79`) with `.ui-input--disabled` styling (`:106`–`109`); `CodeHostSection.svelte:318` passes `disabled={saving || loading}` to every text `Input`, matching the `Select` at `:310`

### [Med] Every control in the section is 22px tall — below the minimum target size

- **Id:** code-host-controls-below-min-target-size
- **Status:** fixed
- **Resolved:** token change raising `--control-h-sm` to the 24px floor (see `client/shared/tokens.css`)
- **Dimension:** 6. Accessibility (also 8. sizing)
- **Source:** `client/shared/tokens.css:63` now defines `--control-h-sm: 24px` (`--control-h-md: 28px` at `:64`); `Btn.svelte`'s `.ui-btn--sm` consumes it directly (`height: var(--control-h-sm)`); all four buttons in this section (`CodeHostSection.svelte:299`, `:321`, `:333`, `:345`) still pass `size="sm"` but now resolve to 24px, clearing the WCAG 2.2 AA floor
- **Notes:** `IconButton` (`md`, 28px) and the section's `sm` controls (24px) are still two different heights, but both now individually clear the floor, so the internal-inconsistency remark no longer carries an accessibility failure — it is cosmetic only and not re-opened as a separate finding.

### [Med] The first-setup hint paragraph runs as one unbroken ~1230px line with no `max-width`

- **Id:** code-host-setup-hint-unbounded-measure
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Incomplete, Empty — the helper paragraph above the fields spans the full desktop viewport width, wrapping only where the viewport itself ends
- **Source:** the paragraph renders with class `placeholder` (`CodeHostSection.svelte:280`), and `.placeholder` in `client/settings/settings.css:97`–`99` sets only `color: var(--text-muted)` — no `max-width` or measure constraint at all, unlike `.settings-gate` in the same file (`:100`–`106`), which caps at `max-width: 540px`
- **Notes:** Confirmed in `settings-sections-CodeHostSection-Incomplete-1.png` — the sentence runs edge-to-edge at ~1230px (viewport 1280 minus the section's inline padding) before wrapping, well past a comfortable reading measure. Readability-only — nothing is blocked or ambiguous — but this is the same defect class `ReposSection` had before `e6e223424` ("refactor(settings): put the repo add form on the shared layout and tokens"), which moved that section's hand-rolled text onto shared layout/tokens rather than leaving it unconstrained.
- **Suggested fix:** Apply the same remedy `e6e223424` used for `ReposSection` — put the hint paragraph on a shared, measure-constrained text style (or a token-driven `max-width`) instead of the bare `.placeholder` class, rather than inventing a section-local cap.

### [Low] The destructive Clear is the quietest control on the page

- **Id:** code-host-clear-low-affordance
- **Status:** fixed
- **Resolved:** `420af5eee` (feat(settings): guard empty code-host fields and weight the Clear trigger)
- **Dimension:** 2. Affordance & signifiers
- **Source:** the Clear trigger is now `variant="danger"` (`CodeHostSection.svelte:334`), matching the dialog it opens (`:361`)
- **Notes:** Verified in `settings-sections-CodeHostSection-Populated-1.png` — "Clear" now renders in red outline, distinct from the filled green Save.

### [Low] The actions row has no gap token and no shared alignment edge with the fields

- **Id:** code-host-actions-row-no-gap-token
- **Status:** fixed
- **Resolved:** `67a69d43e` (fix(settings): align the code-host actions row with the field content edge)
- **Dimension:** 8. Spacing, alignment & sizing
- **Source:** `.settings-field__actions` now declares `gap: var(--gap-tight)` and `padding-inline: 14px` (`CodeHostSection.svelte:378`–`388`), with a comment explaining the 14px value was confirmed against the Populated baseline to land on the field cards' content edge

### [Low] Required is signalled by a bare `*`, and the section has no heading element

- **Id:** code-host-bare-required-marker-no-heading
- **Status:** fixed
- **Resolved:** `d1187955e` (fix(a11y): convey a required field through aria-required) + `PageHeader.svelte` heading change
- **Dimension:** 6. Accessibility
- **Source:** `PageHeader.svelte:25` now renders the title as `<h2 class="ui-page-header__title">`, not a `<div>`; the visual marker is still an `aria-hidden` `<span>` (`SettingsFieldShell.svelte:60`) with no text alternative of its own, but the actual accessibility gap is closed differently — `required` now flows through `setFieldError`'s `required` getter (`SettingsFieldShell.svelte:52`–`54`) to `useFieldInvalid()` (`field-context.ts:69`–`71`), and `Input.svelte:64`/`:82` and `Select` render `aria-required="true"` on the real control
- **Notes:** The suggested fix text ("give the marker a text alternative") wasn't the mechanism used, but the underlying defect — a screen-reader user has no way to know a field is required — is closed via `aria-required`, which is the more direct fix. Scored as fixed rather than narrowed because the finding's actual concern (SR-discoverability of required state) is addressed.

### [Low] "Code host" names both the section and its first field, and the Instance URL label carries its qualifier inline

- **Id:** code-host-label-naming-collision
- **Status:** fixed
- **Resolved:** `b1306207d` (refactor(settings): rename forge kind and instance-url labels)
- **Dimension:** 5. Content & language
- **Source:** `src/debug/settings/coding-credentials-fields-meta.ts:66` now labels the `kind` field "Host type" (no longer "Code host"); `instance_url`'s label is now the bare "Instance URL" (`:74`), with the enterprise/self-hosted qualifier moved into the field's `hint` (`CodeHostSection.svelte:292`–`294`) instead of the label
- **Notes:** Verified in `settings-sections-CodeHostSection-Self-hosted-1.png` — section title "Code host", first field label "Host type", no collision.
