<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — TaskProviderSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/TaskProviderSection.svelte`
**States captured:** Populated, Error · desktop (base-state PNGs under
`.storybook-shots/settings/sections/TaskProviderSection.spec.ts/`), plus three manual states
below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/TaskProviderSection.spec.ts`: Populated at ~640px, `Select`
focused, and `Bind` hovered. This run added the latter two (previously only the narrow shot
existed) to get direct visual evidence for dimension 9 rather than inferring it from source; all
5 re-verified clean (`bun run visual:audit -g TaskProviderSection`, 5/5 passed). The `Populated`
and `Error` fixtures (`client/stories/msw/settings-handlers.ts:238-245`) still set
`taskInstanceId: null` and `canProvision: false`, so three of the component's states — a bound
instance rendering its `ConfigFieldRow` credential list (`TaskProviderSection.svelte:145-150`),
the Kaneo auto-provision block (`:156-164`), and the post-provision secret reveal (`:168-180`) —
remain unexercised by any story and are not visually verified in this review; those findings
below are sourced from code only and flagged as such. `.storybook-shots/` is gitignored, so the
two new local screenshots are not committed artifacts — only the spec file and this document
change.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Context

This section is the personal-scoped sibling of
[`GroupProviderSection`](./GroupProviderSection.md); both bind a task instance to a context via
an almost identical `Field` + `Select` + primary-button form, and historically this section was
the more complete of the two. A single commit,
`b4a605bdf` ("fix(settings): TaskProvider friendly errors + instance label (sibling
convergence)"), closed two of this section's own findings on 2026-07-03: it routes all three
error paths (`load`, `bindInstance`, `provision`) through the shared `formatFetchError()` mapper
instead of surfacing raw `.message` text, and it added a `name`-first fallback to the
instance-option label. A separate a11y token pass (`ca47dbb7a`, "fix(a11y): raise dim text tokens
above the 4.5:1 contrast floor") retired the sub-AA `--fg3`/`--fg4` tokens the low-contrast
finding cited; the component now uses the compliant `--text-dim` (5.69:1 on `--bg`, per
`client/shared/tokens.css:21`) in both places that finding named. The shared-primitive work that
fixed the sibling's unlabeled-`Select` finding (`6e0249552`, `7cdce941e`) applies here too, since
this section already composed `Field`/`Select` the same way. One new finding is added for the
silent-null-preselect defect the task brief asked to check for explicitly — it reproduces here,
partially mitigated by an adjacent placeholder line the group sibling doesn't have.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow/title, field group, and primary action follow a single clear top-down reading order in both captured states, with nothing competing for attention. Unchanged from prior review.                                   |
| 2. Affordance & signifiers      | pass  | `Bind`/`Provision Kaneo` are filled primary buttons with a visible hover shade (`TaskProvider-—-bind-hovered-1.png` now confirms this directly), and the refresh `IconButton` keeps a resting border.                     |
| 3. Consistency w/ design system | pass  | Reuses `Field`/`Select`/`Btn`/`IconButton`/`PageHeader`/`SummaryList`/`Secret`/`ErrorState`/`formatFetchError` shared primitives throughout; now matches `GroupProviderSection`'s error/label/focus handling closely (see Context). |
| 4. Feedback & state             | warn  | Loading/empty/bind-success/friendly-error are all handled well now, but a bound-vs-unbound `Select` selection is visually indistinguishable when no instance is yet assigned (new finding below).                          |
| 5. Content & language           | warn  | Errors are now humanized via `formatFetchError`; residual gap is the raw-id fallback for instances lacking a `name` (finding narrowed, not closed).                                                                       |
| 6. Accessibility                | pass  | `Select` is labelled via `Field`'s `aria-labelledby` context and shows a visible `:focus-within` ring, both confirmed in source and in the new `select-focused` screenshot.                                                |
| 7. Responsive / layout          | pass  | Captured 640px shot reflows cleanly with no clipping; caveat unchanged: only the "no instance bound yet" sub-state has ever been rendered at narrow width — the field-list/provision layouts are unverified at any viewport (existing finding below). |
| 8. Spacing, alignment & sizing  | pass  | `.settings-field-list` gap is tokenized (`--gap-inline`, `TaskProviderSection.svelte:186-190`); the provision block's `gap: 8px`/`padding-top: 8px` (`:191-197`) are hardcoded but numerically match `--gap-tight`, no drift from the scale. |
| 9. Interaction & micro-states   | pass  | `Select` shows a real `:focus-within` ring (`select-focused` shot) and `Bind`/`Provision Kaneo` show a lighter hover shade (`bind-hovered` shot) plus disabled/busy label swaps ("Binding…"/"Provisioning…") confirmed in source. |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Task-instance `<select>` has no programmatic label

- **Id:** task-provider-select-no-label
- **Status:** fixed
- **Resolved:** `client/shared/ui/Field.svelte:25-29` now generates a `labelId` and publishes it
  via `setFieldLabelId`, and `client/shared/ui/Select.svelte:25,38`
  (`const labelId = getFieldLabelId()` → `aria-labelledby={labelId}`) consumes it — commit
  `6e0249552` ("feat(ui): associate Field label with Input/Select via context
  (aria-labelledby)"). `client/shared/ui/Select.svelte:66-69` also now gives the control a
  visible `:focus-within` ring (`7cdce941e`, "feat(ui): add keyboard focus-within ring to Input
  and Select"). `TaskProviderSection.svelte:129-135`'s `<Field label="Task instance"><Select
  .../></Field>` composition was unchanged, but both primitives it relies on gained the missing
  association and focus ring. Visually confirmed in the new
  `TaskProvider-—-select-focused-1.png`: a green ring now surrounds the select box.
- **Dimension:** 6. Accessibility

### [Med] "Not yet configured" is indistinguishable from "configured to the first option"

- **Id:** task-provider-null-silently-preselected
- **Status:** open
- **Dimension:** 4. Feedback & state (also 5. Content & language)
- **Where visible:** `settings-sections-TaskProviderSection-Populated-1.png` and
  `TaskProvider-—-narrow-1.png` — the `Select` shows "https://kaneo.example (kaneo · active)" as
  the chosen value even though the fixture's `taskInstanceId` is `null`
  (`client/stories/msw/settings-handlers.ts:238-245`, one `available` entry).
- **Source:** `client/settings/sections/TaskProviderSection.svelte:51-55`:
  ```
  const currentId = instance.taskInstanceId
  selectedInstanceId =
    currentId !== null && instance.available.some((a) => a.id === currentId)
      ? currentId
      : (instance.available[0]?.id ?? '')
  ```
  When no instance is bound yet but instances exist, `selectedInstanceId` silently falls back to
  `available[0].id` and the `Select` renders it as chosen — the identical pattern flagged in
  `GroupProviderSection.md`'s `group-provider-null-silently-preselected` finding, and it
  reproduces here with the same fixture shape. It is partially mitigated in this section only:
  the placeholder line "Bind a task instance above to configure its credentials."
  (`TaskProviderSection.svelte:152`, driven by `instanceData?.taskInstanceId == null`) does tell
  a user reading the whole page that nothing is bound yet, which `GroupProviderSection` has no
  equivalent of. The `Select` itself is still pixel-identical to a real bound state, so a user
  who only glances at the dropdown (not the placeholder line below it) can still misread "not yet
  configured" as "configured to the first option."
- **Suggested fix:** when `instanceData.taskInstanceId === null`, leave the `Select` unselected
  (it already supports a `placeholder` option, `client/shared/ui/Select.svelte:43-45`) rather than
  silently defaulting to `available[0]`, so the control itself — not just adjacent copy — reflects
  the unbound state.

### [Med] Task-instance options fall back to a raw internal id when no friendly name exists

- **Id:** task-provider-raw-id-options
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `settings-sections-TaskProviderSection-Populated-1.png` — the single fixture
  option now reads "https://kaneo.example (kaneo · active)", a friendly name, not the raw id this
  finding originally flagged.
- **Source:** `client/settings/sections/TaskProviderSection.svelte:132`
  (`` label: `${o.name ?? o.id} (${o.type} · ${o.status})` ``) — fixed for the common case by
  `b4a605bdf` ("fix(settings): TaskProvider friendly errors + instance label (sibling
  convergence)"), which added the `o.name ??` fallback (previously `o.id` alone, per the
  finding's original text). This is a substantial narrowing, not a close: `name` is optional on
  the schema (`client/settings/fetcher-schemas.ts` — `TaskInstanceOptionSchema.name:
  z.string().optional()`, same shape the sibling review cites), so any instance the task-tracker
  integration hasn't given a name still displays its opaque id. Identical residue exists in
  `GroupProviderSection.svelte:97` (see `group-provider-raw-id-options`, also narrowed rather
  than closed).
- **Suggested fix:** have the task-instance API always populate `name` (e.g. a server-side label
  derived from type + creation order) rather than leaving the client to show a raw id when it's
  absent.

### [Med] Errors were shown to users as raw exception/HTTP text

- **Id:** task-provider-raw-error-text
- **Status:** fixed
- **Resolved:** all three error paths now render through `formatFetchError()`:
  `TaskProviderSection.svelte:114` (`<ErrorState message={formatFetchError(error)} .../>`),
  `:119` (inline reload-error banner), `:123` (`bindError`), and `:166` (`provisionError`) —
  landed in `b4a605bdf` ("fix(settings): TaskProvider friendly errors + instance label (sibling
  convergence)"), which replaced `error = err instanceof Error ? err.message : String(err)` with
  `error = err` (kept as `unknown`) plus the `formatFetchError()` call at render time
  (`client/shared/format-error.ts:14-26`, maps by HTTP status to plain-language copy). Visually
  confirmed in `settings-sections-TaskProviderSection-Error-1.png`: the `boom` 500 fixture now
  renders "Something went wrong" / "Something went wrong on the server. Try again shortly." with
  a "Try again" button, not the raw exception text this finding originally screenshotted.
- **Dimension:** 4. Feedback & state

### [Low] Password-reveal label/hint used low-contrast tokens

- **Id:** task-provider-reveal-low-contrast
- **Status:** fixed
- **Resolved:** the sub-AA `--fg3`/`--fg4` tokens this finding cited no longer exist —
  `ca47dbb7a` ("fix(a11y): raise dim text tokens above the 4.5:1 contrast floor") replaced them
  with `--text-dim`, documented in `client/shared/tokens.css:21` as "4.70:1 on --surface-hover,
  5.69:1 on --bg — WCAG SC 1.4.3 floor" (both above the 4.5:1 AA threshold this finding flagged as
  missed). `client/settings/sections/TaskProviderSection.svelte:176,206`
  (`.settings-provision__secret-label { color: var(--text-dim) }`, used for the "Password" label)
  and `client/shared/ui/Secret.svelte:44` (`.ui-secret__hint { color: var(--text-dim) }`,
  populated from `TaskProviderSection.svelte:177`'s `hint="shown once — copy now"`) both consume
  the now-compliant token. This block still has no story fixture (`canProvision` is never `true`
  in either story), so this is a source-only confirmation, not a screenshot one — consistent with
  how the finding was originally sourced.
- **Dimension:** 6. Accessibility

### [Low] Three of five component states are unverified by any Storybook fixture

- **Id:** task-provider-states-unverified
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** not captured — both `Populated` and `Error` stories still use
  `taskInstanceId: null, canProvision: false`.
- **Source:** `client/stories/msw/settings-handlers.ts:238-245` (the only `/settings/api/context/
  task-instance` fixture in `shellReadyHandlers`) and
  `client/settings/sections/TaskProviderSection.stories.svelte:20-23` (only `Populated`/`Error`
  stories defined) mean the bound-instance field list
  (`TaskProviderSection.svelte:145-150`), the Kaneo provision CTA (`:156-164`), and the
  post-provision secret reveal (`:168-180`) have never been screenshotted, at any viewport. Line
  numbers moved slightly since the prior review (formerly `:138-175`) but the gap is otherwise
  unchanged.
- **Suggested fix:** add a story/fixture variant with a bound `taskInstanceId` and one with
  `canProvision: true` so those layouts get visual-regression coverage and can be reviewed.
