<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — AnalyticsPreferencesSection

**Date:** 2026-08-09
**Reviewed:** `client/settings/sections/AnalyticsPreferencesSection.svelte` (plus the shared primitives it consumes: `client/shared/ui/SegmentedControl.svelte`, `client/shared/Confirm.svelte`, `client/shared/ui/PageHeader.svelte`, `client/shared/ui/Field.svelte`)
**States captured:** AggregateDefault, MixedPreferences, Error, Loading, WithdrawalInProgress, RightsUnavailable (subject-rights-unavailable, three of four controls disabled with the explanatory paragraph), LegitimateInterestUnset (unset local lane under legitimate interest past the policy's effective date), destructive-action hover, first-Tab keyboard focus, withdraw confirmation, delete confirmation, post-deletion success, failed preference save · desktop (1280) + ~640px narrow, incl. narrow confirmation dialog
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

**States not captured:** none outstanding — `subjectRightsAvailable: false` and the
legitimate-interest unset lane are now covered by the `RightsUnavailable` and
`LegitimateInterestUnset` stories (`settings-analytics-rights-unavailable` /
`settings-analytics-legitimate-interest-unset` fixtures). The section still takes no props, yet
its stories pass `contextId` / `scope` args (`AnalyticsPreferencesSection.stories.svelte:16`) —
story hygiene, not a UX defect.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                       |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | warn  | Three same-size dim caption paragraphs stack ahead of the controls, and the current-setting summary is styled identically to legal boilerplate. |
| 2. Affordance & signifiers      | warn  | Segments read as interactive and the selected state is unmistakable, but the default `unknown` state renders as "neither segment on" with nothing saying a choice is unrecorded. |
| 3. Consistency w/ design system | fail  | The only settings section that hand-rolls its own field layout instead of `Field`, skips `PageHeader`'s `sub`/`action` slots, and bypasses `formatFetchError`. |
| 4. Feedback & state             | fail  | Disabled controls carry no discoverable reason, and a failed preference save reverts the control with no statement that it did not save.      |
| 5. Content & language           | warn  | Explanations are genuinely clear, but three machine strings (`unknown`, `in_progress`, `request failed with status 404`) reach the user verbatim. |
| 6. Accessibility                | fail  | In the default state both consent radiogroups are unreachable by keyboard — the first Tab skips straight to Export.                          |
| 7. Responsive / layout          | warn  | Reflows cleanly at 640px, but `space-between` strands the control at the far right edge with no max-width, flush against the viewport at 1280. |
| 8. Spacing, alignment & sizing  | warn  | A literal `12px`, a 13px label off the type scale, and `--gap-inline` used where the field rhythm is `--gap-field`.                          |
| 9. Interaction & micro-states   | fail  | `busy` gates the controls but is never surfaced: `SegmentedControl`'s own `busy` prop and `Btn`'s are both left unset, so async work is a dead frozen frame. |

## Findings

### [High] Both consent radiogroups are unreachable by keyboard until a choice already exists

- **Id:** analytics-prefs-radiogroup-unreachable-when-unset
- **Status:** fixed
- **Dimension:** 6. Accessibility
- **Where visible:** `AnalyticsPreferences-—-keyboard-focus-lands-on-the-first-choice-1.png` — one Tab into the section lands the focus ring on "Export analytics data", skipping both radiogroups
- **Source:** `client/shared/ui/SegmentedControl.svelte:53`, consumed at `client/settings/sections/AnalyticsPreferencesSection.svelte:139`
- **Suggested fix:** `tabindex={value === opt.value ? 0 : -1}` gives every option `-1` when `value` matches no option (here the initial `unknown`); the roving-tabindex needs a fallback that puts `0` on the first option when nothing is selected.
- **Resolved:** b10d978 — `activeIndex` falls back to `Math.max(0, options.findIndex(...))`, keeping the group in the tab order when no option matches.

### [High] Disabled consent controls never say why they are disabled

- **Id:** analytics-prefs-disabled-rights-unexplained
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** source only — no fixture covers `subjectRightsAvailable: false` (see "States not captured")
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:143`, `:155`, `:168`, `:176`
- **Suggested fix:** when `subjectRightsAvailable` is false, three of the four controls grey out with no accompanying sentence anywhere in the template — the section needs an explanatory line tied to that condition.
- **Resolved:** 3e47acd — `RIGHTS_UNAVAILABLE_TEXT` renders as an explanatory paragraph when `!data.subjectRightsAvailable`.

### [High] A failed preference save silently reverts the choice

- **Id:** analytics-prefs-failed-save-silently-reverts
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** `AnalyticsPreferences-—-a-failed-preference-save-1.png` — after clicking Deny the summary still reads `unknown`, and the only feedback is `request failed with status 404` rendered below the action row, far from the control that failed
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:55`, `:184`
- **Suggested fix:** the alert should name the lane that failed and state that the setting was not changed, and should render adjacent to the control rather than beneath the destructive actions.
- **Resolved:** 3e47acd — `choose()` sets a per-lane error (`${formatFetchError(err)} The setting was not changed.`) rendered by `SettingsFieldShell`'s own error slot.

### [Med] The section hand-rolls its own field layout instead of using `Field`

- **Id:** analytics-prefs-bespoke-field-layout
- **Status:** fixed
- **Dimension:** 3. Consistency with the design system
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-AggregateDefault-1.png` — sentence-case 13px labels with the control stranded at the opposite edge, against the uppercase mono 10px stacked labels every sibling shows in `settings-SettingsApp-Personal-ready-1.png`
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:135`, `:225`
- **Suggested fix:** it is the only section defining local `.settings-field` / `.settings-field__label` rules rather than consuming `client/shared/ui/Field.svelte`, which is also what produces the label/control separation and the flush right edge.
- **Resolved:** 00a1379 — the bespoke rows are gone; both consent controls render inside `SettingsFieldShell`.

### [Med] Async work is never signalled — `busy` only freezes the controls

- **Id:** analytics-prefs-no-inflight-signal
- **Status:** fixed
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** source only; no frame in the captured set shows a pending state
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:143`, `:162`
- **Suggested fix:** `SegmentedControl` already accepts a `busy` prop that renders a "Saving…" marker (`client/shared/ui/SegmentedControl.svelte:64`) and `Btn` accepts `busy`; the section passes `busy` to `disabled` only, so an in-flight save is indistinguishable from a permanently disabled control.
- **Resolved:** 3e47acd / f2ad0d8 — `SegmentedControl`'s `busy` (3e47acd) and the three action `Btn`'s `busy` (f2ad0d8) both now mirror the section's `busy` state alongside `disabled`.

### [Med] Raw status enums and transport errors reach the user

- **Id:** analytics-prefs-raw-status-enum-copy
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `AnalyticsPreferences-—-after-a-queued-deletion-1.png` — "Deletion in_progress (analytics only)."
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:102`
- **Suggested fix:** the API's `status` value is interpolated verbatim; it needs a mapping to user copy that also says what "queued" means for the user's data.
- **Resolved:** 6410489 / 3e47acd — `deleteStatusMessage` maps each of the four `DeleteStatus` values to its own sentence, wired in by `confirmDelete()`.

### [Med] Error text bypasses the shared fetch-error formatter

- **Id:** analytics-prefs-raw-fetch-errors
- **Status:** fixed
- **Dimension:** 3. Consistency with the design system / 5. Content & language
- **Where visible:** `AnalyticsPreferences-—-a-failed-preference-save-1.png` — `request failed with status 404`
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:33`
- **Suggested fix:** the local `messageFrom` helper returns `err.message` unmodified, where seven sibling settings files route the same errors through `formatFetchError`.
- **Resolved:** 3e47acd — `messageFrom` is gone; `load()`, `run()` and `choose()` all format errors through the shared `formatFetchError`.

### [Med] The unrecorded-choice state is never named

- **Id:** analytics-prefs-unknown-state-unlabelled
- **Status:** fixed
- **Dimension:** 2. Affordance & signifiers / 5. Content & language
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-AggregateDefault-1.png` — both segments render unselected and the summary reads "Local longitudinal: unknown · External pseudonymous: unknown"
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:109`
- **Suggested fix:** on a consent surface the "no choice recorded yet" state carries meaning and should be stated in user words rather than shown as the raw `unknown` enum plus an ambiguous empty control.
- **Resolved:** 6410489 / 00a1379 — `laneHint` names the unrecorded state ("No choice recorded — … stay off until you allow them.") and `SettingsFieldShell` surfaces it as the field's hint.

### [Med] Status and error regions mount with their announcement already inside them

- **Id:** analytics-prefs-live-regions-mount-with-text
- **Status:** fixed
- **Dimension:** 6. Accessibility
- **Where visible:** `AnalyticsPreferences-—-after-a-queued-deletion-1.png`, `AnalyticsPreferences-—-a-failed-preference-save-1.png`
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:184`, `:187`
- **Suggested fix:** both `role="alert"` and `role="status"` elements are created by `{#if}` with their text already present, so assistive tech may not announce the change; the regions should be permanently mounted and their text swapped. (Same defect as the open `admin-users-live-region-mounts-with-text` and `coding-mcp-live-region-mounts-with-text`.)
- **Resolved:** f0f8027 / 3e47acd — the new `LiveRegion` primitive is always mounted with text swapped in place; the section renders it unconditionally for both `actionError` and `announcement`.

### [Med] The header's description and refresh slots go unused

- **Id:** analytics-prefs-header-sub-and-refresh-unused
- **Status:** fixed
- **Dimension:** 1. Visual hierarchy & scanning / 3. Consistency with the design system
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-AggregateDefault-1.png` against `settings-SettingsApp-Personal-ready-1.png`, where Profile, Task provider and Tools all carry a `sub` line and a ⟳ action
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:121`
- **Suggested fix:** `PageHeader` exposes `sub` and `action`; the section instead emits three flat caption paragraphs at body size and offers no way to re-read preferences after a failure short of a page reload.
- **Resolved:** 00a1379 — `PageHeader` now carries a `sub` line and an `action` snippet rendering an `IconButton` "Refresh" that re-runs `load()`.

### [Low] The control detaches to the far edge on wide viewports

- **Id:** analytics-prefs-field-row-unbounded-width
- **Status:** fixed
- **Dimension:** 7. Responsive / layout
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-AggregateDefault-1.png` at 1280 — roughly 950px of dead space between a label and its own control, with the segmented control flush against the right edge
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:226`
- **Suggested fix:** `justify-content: space-between` with no max-width breaks label/control proximity as the viewport grows; inside the real settings column (~760px) it is milder but still present.
- **Resolved:** 00a1379 — the bespoke `space-between` row is gone; `SettingsFieldShell`'s `.settings-field__head` keeps the label and control adjacent (`flex` with `margin-right: auto` on the label).

### [Low] Both radiogroups are announced twice under the same name

- **Id:** analytics-prefs-duplicate-aria-naming
- **Status:** fixed
- **Dimension:** 6. Accessibility
- **Where visible:** source only
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:140`
- **Suggested fix:** `ariaLabel` and `ariaDescribedBy` resolve to the same string ("Local longitudinal analytics"), so the group name is read once as its label and again as its description; one of the two should carry the explanatory text instead.
- **Resolved:** 921ef88 / 00a1379 — `SettingsFieldShell`'s `head` snippet now hands the control the error/hint id (`describedBy`), and the section passes it straight through as `ariaDescribedBy`, so the group is described by its own status line instead of by its own name.

### [Low] Spacing and type values drift off the shared scale

- **Id:** analytics-prefs-off-scale-spacing-and-type
- **Status:** fixed
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-AggregateDefault-1.png` — the two consent rows sit closer together than fields in sibling sections
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:229`, `:230`, `:233`
- **Suggested fix:** The off-scale 13px field label and the literal `12px` row gap should come
  from the shared scale, and the caption block should be separated from the fields on the
  section rhythm rather than the within-block one.
- **Resolved:** 00a1379 — the bespoke row is gone with `SettingsFieldShell` (13px label and the
  `12px` gap with it), and the caption-to-field separation is now `--gap-field`. The original
  finding also claimed the 12px caption was off-scale; that was wrong and has been struck.

### [Low] Export is not gated by subject-rights availability while the other rights are

- **Id:** analytics-prefs-export-not-rights-gated
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** source only
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:162` against `:168` and `:176`
- **Suggested fix:** Export is the only one of the three subject-rights actions left enabled when `subjectRightsAvailable` is false; either the gating is inconsistent or the difference needs stating.
- **Resolved:** 3e47acd — Export's `Btn` now carries `disabled={busy || !data.subjectRightsAvailable}`, matching Withdraw and Delete.

### [Low] The effective-since timestamp is a raw full locale string

- **Id:** analytics-prefs-effective-timestamp-raw-locale
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `settings-sections-AnalyticsPreferencesSection-MixedPreferences-1.png` — "effective 1/15/2027, 8:00:00 AM"
- **Source:** `client/settings/sections/AnalyticsPreferencesSection.svelte:112`
- **Suggested fix:** `toLocaleString()` with no options emits seconds and a machine-ordered date inside an otherwise prose summary line.
- **Resolved:** 6410489 — `laneHint`'s `since()` helper formats via the shared `formatDateTime`, replacing the raw `toLocaleString()` call.

### [High] An unrecorded choice was presented as "off" on a deployment where it is not

- **Id:** analytics-prefs-unset-not-always-off
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** LegitimateInterestUnset story, desktop
- **Source:** `src/analytics/governance/eligibility.ts:99-107`
- **Suggested fix:** Make the unset copy a function of the published lawful basis — under
  legitimate interest past the policy's effective date the local lane is collected until denied.
- **Resolved:** 6410489 — `laneHint` branches on `lawfulBasisMode` and `policyEffectiveAtMs`.

### [Med] A failed deletion was announced through the success region

- **Id:** analytics-prefs-failed-deletion-announced-as-success
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** delete confirmation, `status: 'failed'` response
- **Source:** `client/settings/fetcher-schemas-analytics.ts:75`
- **Suggested fix:** Map each of the four delete statuses to its own sentence and route the
  failure to the alert region.
- **Resolved:** 6410489 / 3e47acd — `deleteStatusMessage` returns a tone alongside the text, and
  `confirmDelete()` routes `tone === 'alert'` to `actionError` (the alert `LiveRegion`) instead of
  `announcement`.
