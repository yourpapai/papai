<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — GroupProviderSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/GroupProviderSection.svelte`
**States captured:** Populated, Empty, Error, Loading · desktop (base-state PNGs under
`.storybook-shots/settings/sections/GroupProviderSection.spec.ts/`), plus three manual states
below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/GroupProviderSection.spec.ts`: Populated at ~640px, `Select`
focused, and `Save` hovered. All 7 re-verified clean this run (`bun run visual:audit -g
GroupProviderSection`, 7/7 passed; no new stories added). Only the `Populated` fixture exercises
a bound instance; there is no long-id / long-error fixture, so overflow behavior of a long
instance label remains unverified, and no fixture exercises `taskInstanceId: null` with a
non-empty `available` list (the "not yet configured" sub-state — see new finding below).

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
gap — the component now matches the sibling's pattern almost line for line. Five of the six
original findings are `fixed`; the sixth (raw-id option labels) is narrowed to its residue. One
new finding is added for a state-distinction gap the task brief specifically asked to check.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow → title → single field → primary action reads top-down with nothing competing; matches sibling rhythm. Unchanged from prior review.                                              |
| 2. Affordance & signifiers      | pass  | `Save` is a filled primary button with a visible hover shade (`GroupProviderSection-—-save-hover-1.png`) and the refresh `IconButton` keeps a resting border. Unchanged from prior review. |
| 3. Consistency w/ design system | pass  | Now shares error/loading/empty/busy/label handling with `TaskProviderSection` (`GroupProviderSection.svelte:80-104` vs. `TaskProviderSection.svelte:113-139`) — the prior divergence is closed. |
| 4. Feedback & state             | warn  | Load error, loading placeholder, empty state and save-busy are all now handled; residual gap is a silent auto-preselect when no instance is actually assigned (new finding below).        |
| 5. Content & language           | warn  | Errors are humanized via `formatFetchError`, empty state is actionable; residual gap is raw-id fallback for instances lacking a `name` (finding narrowed, not closed).                     |
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
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** Populated shot — the bound option now reads `https://kaneo.example (kaneo ·
  active)` (a friendly name), but the fixture's second, unbound option
  (`{ id: 'inst_bare', type: 'youtrack', status: 'active' }`, no `name`) would still render as
  the raw id `inst_bare (youtrack · active)` if selected/opened
  (`client/stories/msw/settings-handlers-group.ts:86`).
- **Source:** `client/settings/sections/GroupProviderSection.svelte:97`
  (`` label: `${o.name ?? o.id} (${o.type} · ${o.status})` ``) — the schema's `name` field is
  optional (`client/settings/fetcher-schemas.ts:204-209`, `TaskInstanceOptionSchema.name:
  z.string().optional()`), so any instance the task-tracker integration hasn't given a name
  still displays its opaque id. This is a substantial narrowing from the original finding: the
  common case (a Kaneo/YouTrack instance with a discoverable URL/name) is now fixed; only
  nameless instances still show the raw id. Same residue exists in the sibling
  (`TaskProviderSection.svelte:132`, identical fallback expression).
- **Suggested fix:** have the task-instance API always populate `name` (e.g. fall back to a
  server-side label derived from type + creation order) rather than leaving the client to show
  a raw id when it's absent.

### [Med] "Not yet configured" is indistinguishable from "configured to the first option"

- **Id:** group-provider-null-silently-preselected
- **Status:** open
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** not captured by any story — no fixture sets `taskInstanceId: null` with a
  non-empty `available` list; the `Populated` fixture's `taskInstanceId` (`'inst_abc'`) already
  matches `available[0].id`
  (`client/stories/msw/settings-handlers-group.ts:81-88`), so this state has never been
  screenshotted.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:40-44`:
  ```
  const currentId = result.taskInstanceId
  selected =
    currentId !== null && result.available.some((a) => a.id === currentId)
      ? currentId
      : (result.available[0]?.id ?? '')
  ```
  When the group has no task instance assigned yet (`taskInstanceId === null`) but instances
  exist, `selected` silently falls back to `available[0].id` and the `Select` renders that
  option as chosen — pixel-identical to a group that is genuinely bound to that instance. A
  group admin opening this section for an unconfigured group sees what looks like an active,
  saved assignment rather than an unset one; they may assume routing is already correct and skip
  configuring it, or conversely re-save a value they never actually chose, believing they are
  correcting an existing binding. The task brief for this section calls this out explicitly
  because a misrouted task provider silently sends work to the wrong tracker.
- **Suggested fix:** when `taskInstanceId === null`, either leave the `Select` unselected (add a
  `placeholder` option, which `Select` already supports —
  `client/shared/ui/Select.svelte:43-45`) or render an explicit "Not yet assigned" indicator
  distinct from a real bound value, instead of silently defaulting the dropdown to the first
  entry.
