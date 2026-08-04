<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — GroupProviderSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/GroupProviderSection.svelte`
**States captured:** Populated, Unassigned, NamelessBound, Empty, Error, Loading · desktop
(base-state PNGs under `.storybook-shots/settings/sections/GroupProviderSection.spec.ts/`), plus
three manual states below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/GroupProviderSection.spec.ts`: Populated at ~640px, `Select`
focused, and `Save` hovered. `Unassigned` and `NamelessBound` are new this run
(`client/settings/sections/GroupProviderSection.stories.svelte:23-32`, fixtures
`groupProviderUnassigned` / `groupProviderNamelessBound` in
`client/stories/msw/settings-handlers-group.ts:112-133`) and close the two gaps the prior review
flagged here: `Unassigned` sets `taskInstanceId: null` against a non-empty `available` list — the
"not yet configured" sub-state that had never been screenshotted — and `NamelessBound` binds to
`inst_bare`, the fixture's nameless option, which a `<select>` renders only when it is the chosen
value, giving the first screenshot of the raw-id/fallback-label path. Landed in `19b96cf1d`
("test(visual): cover the GroupProvider unassigned and nameless-instance states"). All 9
screenshots re-verified clean (`bun run visual:audit -g GroupProviderSection`, 9/9 passed). There
is still no long-id / long-error fixture, so overflow behavior of a genuinely long instance label
remains unverified — a minor residual, not tracked as a separate finding.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Context

This section is the group-scoped sibling of
[`TaskProviderSection`](./TaskProviderSection.md): both bind a task instance to a context via an
identical `Field` + `Select` + primary-button form. The 2026-07-03 review found the section a
leaner clone that had dropped several state-handling affordances the sibling had (`ErrorState`
with retry, a loading placeholder, a busy/disabled save button, the muted `.placeholder` empty
style, friendly instance labels, and shared-primitive label/focus association). A sequence of
commits between 2026-07-03 and 2026-08-02 (`3b865957c`, `632e6e33a`, `0c39b6070`, `8f99c5d3d`,
`b40777d90`, plus shared-primitive work `6e0249552`/`7cdce941e`) closed essentially all of that
gap — the component now matches the sibling's pattern almost line for line. A follow-up
remediation pass (2026-08-04, `56721f1ec`..`19b96cf1d`) closed the two findings that remained
open after that convergence — the raw-id-options residue and the silent-null-preselect defect —
and added the `Unassigned`/`NamelessBound` fixtures that screenshot both fixes directly. All
seven original findings are now `fixed`; this document has zero open findings.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow → title → single field → primary action reads top-down with nothing competing; matches sibling rhythm. Unchanged from prior review.                                              |
| 2. Affordance & signifiers      | pass  | `Save` is a filled primary button with a visible hover shade (`GroupProviderSection-—-save-hover-1.png`) and the refresh `IconButton` keeps a resting border. Unchanged from prior review. |
| 3. Consistency w/ design system | pass  | Now shares error/loading/empty/busy/label handling with `TaskProviderSection` (`GroupProviderSection.svelte:80-104` vs. `TaskProviderSection.svelte:113-139`) — the prior divergence is closed. |
| 4. Feedback & state             | pass  | Load error, loading placeholder, empty state and save-busy are all handled, and the silent auto-preselect residue is closed — `Unassigned-1.png` now shows the control itself, not just adjacent copy, reflecting "nothing bound yet". |
| 5. Content & language           | pass  | Errors are humanized via `formatFetchError`, empty state is actionable, and the raw-id fallback residue is closed — the server now always populates `name`, and even the client's dead-code fallback path shows a type-qualified label (`NamelessBound-1.png`: "YouTrack instance (inst_bare)"), never a bare id. |
| 6. Accessibility                | pass  | `Select` is now labelled via `Field`'s context (`aria-labelledby`) and shows a visible `:focus-within` ring — both confirmed in source and in the `select-focused` screenshot.              |
| 7. Responsive / layout          | pass  | The ~640px shot reflows cleanly — field goes full width, button wraps below, no clipping or overflow. Unchanged from prior review.                                                        |
| 8. Spacing, alignment & sizing  | pass  | Layout is driven entirely by `.settings-form` tokens; no one-off px, edges align with the field above. Unchanged from prior review.                                                        |
| 9. Interaction & micro-states   | pass  | `Save` now shows `disabled`/`busy` + "Saving…" (`GroupProviderSection.svelte:102-104`), and the `Select` has a real `:focus-within` ring (`Select.svelte:66-69`).                          |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] `Save` gives no in-flight or disabled feedback (double-submit risk)

- **Id:** group-provider-save-no-feedback
- **Status:** fixed
- **Resolved:** `client/settings/sections/GroupProviderSection.svelte:102-104` now tracks a
  `saving` flag (`:29,56,64`) and passes it to `Btn` as both `disabled={saving}` and
  `busy={saving}`, with the label switching to `Saving…` while in flight — matching the
  sibling's `Bind`/`Binding…` pattern. Landed in `0c39b6070` ("fix(settings): lock GroupProvider
  Select during save") and `632e6e33a` ("fix(settings): GroupProvider loading/empty/error/busy
  states + friendly instance label").
- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)

### [High] `Select` is unlabeled and has no visible keyboard focus ring

- **Id:** group-provider-select-unlabeled-no-focus
- **Status:** fixed
- **Resolved:** both shared-primitive gaps are closed. (a) Label association:
  `client/shared/ui/Field.svelte:25-29` now generates a `labelId` and publishes it via
  `setFieldLabelId`, and `client/shared/ui/Select.svelte:25,38`
  (`const labelId = getFieldLabelId()` → `aria-labelledby={labelId}`) consumes it — commit
  `6e0249552` ("feat(ui): associate Field label with Input/Select via context
  (aria-labelledby)"). (b) Focus ring: `client/shared/ui/Select.svelte:66-69`
  (`.ui-select:focus-within { outline: 2px solid rgba(82, 224, 138, 0.4); outline-offset: 1px; }`)
  — commit `7cdce941e` ("feat(ui): add keyboard focus-within ring to Input and Select"). Visually
  confirmed in `GroupProviderSection-—-select-focused-1.png`, which now shows a green ring around
  the select box (the 2026-07-03 review noted this shot was pixel-identical to the resting
  state; it is no longer).
- **Dimension:** 6. Accessibility (also 9. Interaction & micro-states)

### [Med] Load error is a bare red line with no recovery affordance

- **Id:** group-provider-load-error-no-recovery
- **Status:** fixed
- **Resolved:** `client/settings/sections/GroupProviderSection.svelte:80-81` now renders
  `<ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />`
  when the initial load fails, matching the sibling's pattern exactly. Confirmed visually in
  `settings-sections-GroupProviderSection-Error-1.png`: title "Something went wrong", humanized
  body text ("Something went wrong on the server. Try again shortly." — from
  `client/shared/format-error.ts:22`, not the raw `boom` exception text), and a "Try again"
  button. Note the section also added a second, narrower error path: a refresh that fails
  *after* data has already loaded keeps the form visible and shows a small inline
  `.status-error` banner instead of replacing the whole body with `ErrorState`
  (`:85-87`, `b40777d90` "GroupProvider refresh failure keeps form, not full ErrorState") — a
  reasonable refinement beyond what the sibling does.
- **Dimension:** 4. Feedback & state (also 3. Consistency)

### [Med] Initial load renders a blank body (no loading placeholder)

- **Id:** group-provider-blank-initial-load
- **Status:** fixed
- **Resolved:** `client/settings/sections/GroupProviderSection.svelte:82-83` now renders
  `<p class="placeholder">Loading…</p>` when `loading && data === null`, matching the sibling.
  Confirmed visually in `settings-sections-GroupProviderSection-Loading-1.png` — a muted
  "Loading…" line now appears below the header. Landed in `632e6e33a`.
- **Dimension:** 4. Feedback & state

### [Med] Empty state uses full-brightness text and dead-ends the user

- **Id:** group-provider-empty-state-dead-end
- **Status:** fixed
- **Resolved:** `client/settings/sections/GroupProviderSection.svelte:91` now renders
  `<p class="placeholder">No active task instances available. Ask an admin to create one.</p>`,
  which inherits `--text-muted` via `.placeholder` (`client/settings/settings.css:97-99`) and
  states the same next step as the sibling. Confirmed visually in
  `settings-sections-GroupProviderSection-Empty-1.png` — the copy now renders in the same muted
  grey as the "TASK INSTANCE" caption elsewhere in the section, not full-brightness body text.
  Landed in `632e6e33a`.
- **Dimension:** 5. Content & language (also 3. Consistency)

### [Low] Options fall back to a raw internal id when no friendly name exists

- **Id:** group-provider-raw-id-options
- **Status:** fixed
- **Resolved:** the server now guarantees every option has a friendly `name`.
  `src/debug/settings/task-instance-options.ts:13-44` introduces
  `listActiveTaskInstanceOptions()`, whose `TaskInstanceOption.name` is required (not optional as
  on the wire schema) and derived via `taskInstanceLabel(id, type, baseUrl)` (`:29-32`: `baseUrl`
  when present, else `` `${TYPE_LABELS[type] ?? type} instance (${id})` ``, never a bare id) —
  landed in `56721f1ec` ("fix(settings): always label task-instance options server-side"), which
  replaced `group-routes.ts`'s prior inline `name: taskInstance.config['baseUrl']` mapping (could
  yield `name: undefined`) with a call to this shared builder. On the client,
  `GroupProviderSection.svelte:98` now calls the shared `formatTaskInstanceOption()`
  (`client/settings/lib/task-instance-label.ts:26-32`), whose fallback — kept only as
  defense-in-depth and for Storybook, per its doc comment (`:19-24`) — was also changed by
  `65d1672e3` ("fix(settings): share one task-instance option label across the provider pair")
  from the old bare `o.id` to `` `${TYPE_LABELS[option.type] ?? option.type} instance
  (${option.id})` ``. Confirmed visually in the new
  `settings-sections-GroupProviderSection-NamelessBound-1.png`, which binds to the fixture's
  nameless `inst_bare` option and renders "YouTrack instance (inst_bare) (youtrack · active)" —
  not the bare `inst_bare (youtrack · active)` this finding originally screenshotted.
- **Dimension:** 5. Content & language

### [Med] "Not yet configured" is indistinguishable from "configured to the first option"

- **Id:** group-provider-null-silently-preselected
- **Status:** fixed
- **Resolved:** `client/settings/sections/GroupProviderSection.svelte:43-45` now delegates to
  `resolveTaskInstanceSelection(result.taskInstanceId, result.available)`
  (`client/settings/lib/task-instance-selection.ts:26-37`, shared with the sibling section),
  which returns `selected: ''` and the placeholder `Not yet assigned — select an instance`
  (`UNASSIGNED_PLACEHOLDER`, `task-instance-selection.ts:7`) whenever nothing is bound, instead
  of falling back to `available[0]`. Landed in `7383904b1` ("fix(settings): show an unassigned
  placeholder instead of preselecting the first instance"). Confirmed visually in the new
  `settings-sections-GroupProviderSection-Unassigned-1.png`, whose fixture sets
  `taskInstanceId: null` against a two-entry `available` list
  (`client/stories/msw/settings-handlers-group.ts:112-120`) and renders "Not yet assigned —
  select an instance" in the `Select` rather than silently showing the first `available` entry
  as chosen (`19b96cf1d`, "test(visual): cover the GroupProvider unassigned and
  nameless-instance states").
- **Dimension:** 4. Feedback & state (also 5. Content & language)
