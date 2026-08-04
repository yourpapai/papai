<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — TaskProviderSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/TaskProviderSection.svelte`
**States captured:** Populated, Bound, Error · desktop (base-state PNGs under
`.storybook-shots/settings/sections/TaskProviderSection.spec.ts/`), plus four manual states
below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/TaskProviderSection.spec.ts`: Populated at ~640px, `Select`
focused, `Bind` hovered, and the post-provision secret reveal (switches to the `Bound` story and
clicks `provision-kaneo`). The `Bound` story is new this run
(`client/stories/msw/settings-handlers-task-provider.ts`: `taskProviderBoundInstance` /
`taskProviderBoundConfig` / `taskProviderProvisionResult`) and closes
`task-provider-states-unverified` — it renders, for the first time, the bound-instance
`ConfigFieldRow` credential list (`TaskProviderSection.svelte:147-152`), the Kaneo auto-provision
block (`:158-166`), and, via the provision-reveal shot, the post-provision secret reveal
(`:170-182`). Rendering those states for the first time surfaced two new defects, both recorded
as `open` findings below: `task-provider-empty-secret-blank-pill` (the "Kaneo API key" row's
`hasValue: true, value: ''` fixture renders an essentially blank masked pill instead of a
visible placeholder) and `task-provider-summary-list-no-inset` (the provision-reveal
`SummaryList` has no horizontal inset, so its values run flush to the viewport edge). All 7
screenshots re-verified clean (`bun run visual:audit -g TaskProviderSection`, 7/7 passed).
`.storybook-shots/` is gitignored, so the screenshots are not committed artifacts — only the
spec/fixture files and this document change.

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
this section already composed `Field`/`Select` the same way. A follow-up remediation pass
(2026-08-04, `56721f1ec`..`19b96cf1d`) closed the silent-null-preselect and raw-id-options
findings this section shared with its sibling, and added the `Bound` fixture that finally
exercises this section's bound-instance and provision states — see the scorecard and findings
below. Rendering those previously-unexercised states surfaced two new findings, both `open`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow/title, field group, and primary action follow a single clear top-down reading order in both captured states, with nothing competing for attention. Unchanged from prior review.                                   |
| 2. Affordance & signifiers      | pass  | `Bind`/`Provision Kaneo` are filled primary buttons with a visible hover shade (`TaskProvider-—-bind-hovered-1.png` now confirms this directly), and the refresh `IconButton` keeps a resting border.                     |
| 3. Consistency w/ design system | pass  | Reuses `Field`/`Select`/`Btn`/`IconButton`/`PageHeader`/`SummaryList`/`Secret`/`ErrorState`/`formatFetchError` shared primitives throughout; now matches `GroupProviderSection`'s error/label/focus handling closely (see Context). |
| 4. Feedback & state             | warn  | Loading/empty/bind-success/friendly-error are all handled well, and the null-vs-bound `Select` selection is now correct (`resolveTaskInstanceSelection` leaves the control unselected with a placeholder until something is bound); residual gap is a stored secret with `hasValue: true` and an empty `value` rendering an essentially blank masked pill, giving no visual signal a credential exists (new finding below). |
| 5. Content & language           | pass  | Errors are humanized via `formatFetchError`; the raw-id-options residue is closed — the server (`src/debug/settings/task-instance-options.ts`) now always populates a friendly `name`, so the client's `o.name ?? o.id` fallback is unreachable in production.            |
| 6. Accessibility                | pass  | `Select` is labelled via `Field`'s `aria-labelledby` context and shows a visible `:focus-within` ring, both confirmed in source and in the new `select-focused` screenshot.                                                |
| 7. Responsive / layout          | pass  | Captured 640px shot reflows cleanly with no clipping; the field-list and provision layouts, previously unverified at any viewport, are now confirmed at desktop width via the new `Bound` story (`Bound-1.png`, `TaskProvider-—-provision-reveal-1.png`) — only narrow-width coverage of those two states remains unshot, a minor residual not tracked as a separate finding. |
| 8. Spacing, alignment & sizing  | warn  | `.settings-field-list` gap is tokenized (`--gap-inline`, `TaskProviderSection.svelte:186-190`) and the provision block's hardcoded `gap: 8px`/`padding-top: 8px` (`:191-197`) numerically match `--gap-tight`. Downgraded from `pass` because rendering the provision-reveal state for the first time exposed `task-provider-summary-list-no-inset` (open, Low): the revealed `SummaryList` has zero horizontal inset, so right-aligned values sit flush at the viewport edge while sibling `ConfigFieldRow` cards inset ~16px. |
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
- **Status:** fixed
- **Resolved:** `client/settings/sections/TaskProviderSection.svelte:54-56` now delegates to
  `resolveTaskInstanceSelection(instance.taskInstanceId, instance.available)`
  (`client/settings/lib/task-instance-selection.ts:26-37`), which returns `selected: ''` and the
  placeholder `Not yet assigned — select an instance` (`UNASSIGNED_PLACEHOLDER`,
  `task-instance-selection.ts:7`) whenever nothing is bound, instead of falling back to
  `available[0]`. Landed in `7383904b1` ("fix(settings): show an unassigned placeholder instead
  of preselecting the first instance"). Confirmed visually in
  `settings-sections-TaskProviderSection-Populated-1.png`, whose fixture still has
  `taskInstanceId: null` and one `available` entry
  (`client/stories/msw/settings-handlers.ts:241-242`) but now renders "Not yet assigned — select
  an instance" in the `Select` rather than "https://kaneo.example (kaneo · active)".
- **Dimension:** 4. Feedback & state (also 5. Content & language)

### [Med] Task-instance options fall back to a raw internal id when no friendly name exists

- **Id:** task-provider-raw-id-options
- **Status:** fixed
- **Resolved:** the server now guarantees every option has a friendly `name`.
  `src/debug/settings/task-instance-options.ts:13-44` introduces
  `listActiveTaskInstanceOptions()`, whose `TaskInstanceOption` interface makes `name` required
  (not optional as on the wire schema) and derives it via `taskInstanceLabel(id, type, baseUrl)`
  (`:29-32`, `baseUrl` when present, else `` `${TYPE_LABELS[type] ?? type} instance (${id})` ``,
  never the bare id) — landed in `56721f1ec` ("fix(settings): always label task-instance options
  server-side"), which replaced the ad hoc `name: taskInstance.config['baseUrl']` mapping
  previously inlined in both `context-task-instance-routes.ts` and `group-routes.ts` (which could
  yield `name: undefined`) with this shared, always-populated builder. On the client,
  `client/settings/lib/task-instance-label.ts:26-32`'s `formatTaskInstanceOption()` — now shared
  by both `TaskProviderSection.svelte:133` and `GroupProviderSection.svelte:98` — still carries an
  `o.name ?? ...` fallback, but its doc comment (`:19-24`) states this is deliberately-kept dead
  code for defense-in-depth and Storybook fixtures, unreachable against the real server; commit
  `65d1672e3` ("fix(settings): share one task-instance option label across the provider pair")
  also changed that fallback from the old bare `o.id` to
  `` `${TYPE_LABELS[option.type] ?? option.type} instance (${option.id})` ``, so even the
  never-supposed-to-run path shows a type-qualified label, not a raw id. Confirmed visually in
  `settings-sections-TaskProviderSection-Populated-1.png` (server path: "https://kaneo.example
  (kaneo · active)") and, for the fallback path itself, in the sibling's
  `settings-sections-GroupProviderSection-NamelessBound-1.png` ("YouTrack instance (inst_bare)
  (youtrack · active)", not the bare id "inst_bare (youtrack · active)" this finding originally
  screenshotted).
- **Dimension:** 5. Content & language

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
- **Status:** fixed
- **Resolved:** `client/settings/sections/TaskProviderSection.stories.svelte:24` adds a `Bound`
  story on the new `settings-task-provider-bound` fixture family
  (`client/stories/msw/settings-handlers-task-provider.ts:15-65`: `taskProviderBoundInstance`
  sets `taskInstanceId: 'inst_abc'` and `canProvision: true`; `taskProviderBoundConfig` gives two
  `provider-context` fields, one sensitive with `hasValue: true`). Landed in `b03995932`
  ("test(visual): cover the TaskProvider bound, provisionable and reveal states"). This exercises,
  for the first time, all three previously-unverified states: the bound-instance `ConfigFieldRow`
  credential list (`TaskProviderSection.svelte:147-152`,
  `settings-sections-TaskProviderSection-Bound-1.png`), the Kaneo auto-provision CTA (`:158-166`,
  same screenshot), and the post-provision secret reveal (`:170-182`,
  `tests/visual/settings/sections/TaskProviderSection.spec.ts:49-54`'s "TaskProvider — provision
  reveal" test, which switches to `Bound`, clicks `provision-kaneo`, and shoots
  `TaskProvider-—-provision-reveal-1.png`). Rendering these states for the first time — the
  explicit purpose of this finding — surfaced two new defects in what it rendered; see
  `task-provider-empty-secret-blank-pill` and `task-provider-summary-list-no-inset` below.
- **Dimension:** 7. Responsive / layout

### [Med] A stored secret with an empty value renders an essentially blank masked pill

- **Id:** task-provider-empty-secret-blank-pill
- **Status:** open
- **Dimension:** 4. Feedback & state
- **Where visible:** `settings-sections-TaskProviderSection-Bound-1.png` — the "Kaneo API key"
  row shows a ~20px empty grey pill immediately left of the `Replace`/`Clear` buttons, where a
  masked secret value (e.g. `••••WvfQ`) would normally read.
- **Source:** `client/settings/components/ConfigFieldRow.svelte:158`
  (`<Secret value={maskSecret(field.value)} />`, reached when `field.sensitive && field.hasValue
  && !replacing`). The `Bound` fixture's `kaneo_apikey` field
  (`client/stories/msw/settings-handlers-task-provider.ts:26-35`) sets `hasValue: true` but
  `value: ''`, and `maskSecret('')` (`client/settings/lib/mask-secret.ts:7-9`,
  `value.replace(/\*/gu, '•')`) returns `''` unchanged — there are no `*` characters to replace
  in an empty string. `Secret.svelte:19` then renders `<span
  class="ui-secret__value">{value}</span>` with an empty string, so the pill's fixed padding
  (`Secret.svelte:39`, `padding: 3px 10px`) is the only thing giving it any width. A field the
  server reports as *having* a stored credential therefore gives the user no visual confirmation
  that a value exists.
- **Suggested fix:** when `field.sensitive && field.hasValue`, render a fixed-width masked
  placeholder (e.g. `••••••••`, `Secret`'s own default) instead of `maskSecret(field.value)`
  whenever `field.value` is empty, so the pill always signals "a secret is stored" regardless of
  what the (masked) value happens to contain.

### [Low] The provision-reveal `SummaryList` has no horizontal inset

- **Id:** task-provider-summary-list-no-inset
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:**
  `.storybook-shots/settings/sections/TaskProviderSection.spec.ts/TaskProvider-—-provision-reveal-1.png`
  at 1280px: `demo-user@example.invalid` and `https://kaneo.example` both terminate flush against
  the viewport's right edge (x≈1280), while the sibling `ConfigFieldRow` cards above inset their
  content roughly 16px from the same edge (their `Clear` button ends at x≈1264).
- **Source:** `client/shared/ui/SummaryList.svelte:36-39` — `.ui-summary { display: grid;
  column-gap: 32px; }` sets no horizontal padding at all, and the row rule (`:40-48`,
  `.ui-summary__row`) has none either. `TaskProviderSection.svelte:173-176` renders this
  component directly inside `.settings-provision__reveal` with no wrapping inset of its own.
  Longer real values (a longer email or a self-hosted Kaneo URL) would run past the edge with no
  padding to absorb them, worsened by `.ui-summary__v`'s `word-break: break-all`
  (`SummaryList.svelte:58`).
- **Suggested fix:** give `.ui-summary` (or its usage site) the same horizontal inset the
  `ConfigFieldRow`/`SettingsFieldShell` cards use, so right-aligned values keep breathing room
  from the container edge.
