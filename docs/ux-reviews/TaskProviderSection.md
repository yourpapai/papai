<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — TaskProviderSection

**Date:** 2026-07-02
**Reviewed:** `client/settings/sections/TaskProviderSection.svelte`
**States captured:** Populated, Error · desktop (base-state PNGs under
`.storybook-shots/settings/sections/TaskProviderSection.spec.ts/`), plus a manual ~640px
narrow-viewport shot of Populated added to
`tests/visual/settings/sections/TaskProviderSection.spec.ts` (below `@generated-end
auto-screenshots`) and captured successfully this run (`bun shoot -g TaskProviderSection`, 3/3
passed). Both stories' fixtures (`client/stories/msw/settings-handlers.ts:212-218`) set
`taskInstanceId: null` and `canProvision: false`, so three of the component's states — a bound
instance rendering its `ConfigFieldRow` credential list (`TaskProviderSection.svelte:138-143`),
the Kaneo auto-provision block (`:149-175`), and the post-provision secret reveal (`:161-173`) —
were never exercised by any story and are not visually verified in this review; those findings
below are sourced from code only and flagged as such.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                       |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow/title, field group, and primary action follow a single clear top-down reading order in both captured states, with nothing competing for attention.                                                                 |
| 2. Affordance & signifiers      | pass  | `Bind`/`Provision Kaneo` are filled primary buttons and the refresh `IconButton` keeps a resting border, so controls read as clickable at rest (contrast with ghost-only patterns seen elsewhere).                         |
| 3. Consistency w/ design system | pass  | Reuses `Field`/`Select`/`Btn`/`IconButton`/`PageHeader`/`SummaryList`/`Secret` shared primitives throughout; no one-off styling.                                                                                           |
| 4. Feedback & state             | warn  | Loading/empty/bind-success are handled, but raw exception/HTTP text is surfaced verbatim to the user in three separate error paths.                                                                                        |
| 5. Content & language           | fail  | The only human-facing label for a task instance is its raw internal id (`inst_abc (kaneo · active)`), and errors are unprocessed technical strings (`request failed with status 404`).                                     |
| 6. Accessibility                | fail  | The "Task instance" field label is a plain `<span>` with no `for`/`aria-labelledby` link to the underlying `<select>`, which itself has no `id` or `aria-label` — the control is effectively unlabeled for assistive tech. |
| 7. Responsive / layout          | pass  | Captured 640px shot reflows cleanly with no clipping; caveat: only the "no instance bound yet" sub-state was ever rendered at narrow width — the field-list/provision layouts are unverified at any viewport.              |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Task-instance `<select>` has no programmatic label

- **Dimension:** 6. Accessibility
- **Where visible:** Populated and narrow screenshots — visually the grey "TASK INSTANCE"
  caption sits directly above the dropdown, but this is a layout relationship only.
- **Source:** `client/shared/ui/Field.svelte:19-25` renders the label as
  `<span class="ui-field__label">{label}</span>` with no `id`/`for`, followed by
  `{@render children()}`; `client/shared/ui/Select.svelte:26-27` renders
  `<select {value} onchange={handleChange} data-testid={testid}>` with no `id` or `aria-label`;
  the composition at `client/settings/sections/TaskProviderSection.svelte:123-128`
  (`<Field label="Task instance"><Select .../></Field>`) never connects the two, so a screen
  reader announces an unlabeled combobox.
- **Suggested fix:** give `Field` an `id`/`for` pair (or have it wrap children with
  `aria-labelledby`) so every `Field`-wrapped control, including this `Select`, is
  programmatically associated with its visible label.

### [Med] Task-instance options are labeled with a raw internal id

- **Dimension:** 5. Content & language
- **Where visible:** Populated and narrow screenshots — the only bind option reads
  `inst_abc (kaneo · active)`, an opaque database id concatenated with provider type and status.
- **Source:** `client/settings/sections/TaskProviderSection.svelte:126`
  (`options={instanceData.available.map((o) => ({ value: o.id, label: \`${o.id} (${o.type} ·
  ${o.status})\` }))}`) — the `available`entries carry no human-friendly name field to fall back
to, per the`ContextTaskInstanceResponse` shape consumed here.
- **Suggested fix:** surface a human-readable instance name (or a short ordinal like "Instance
  1") ahead of/instead of the raw id, reserving the id for a secondary/monospace detail.

### [Med] Errors are shown to users as raw exception/HTTP text

- **Dimension:** 4. Feedback & state
- **Where visible:** Error screenshot — `request failed with status 404` rendered directly as
  the page's only content besides the header.
- **Source:** three independent paths do this: `TaskProviderSection.svelte:53-54`
  (`catch (err) { error = err instanceof Error ? err.message : String(err) }`) rendered at
  `:110-111`; `:69-70` (`bindError = ...`) rendered at `:117`; `:83-84`
  (`provisionError = ...`) rendered at `:159` — all pass the caught error's raw `.message`
  straight into a `.status-error` paragraph with no user-facing translation.
- **Suggested fix:** map known failure classes (network, 404, 401/403, validation) to a short
  plain-language message and keep the raw error as secondary/technical detail.

### [Low] Password-reveal label/hint use low-contrast tokens (not visible this run)

- **Dimension:** 6. Accessibility
- **Where visible:** not captured — no story sets `canProvision: true`, so the provisioned
  secret block never rendered in this review; this is a source-only inference.
- **Source:** `client/settings/sections/TaskProviderSection.svelte:198-201`
  (`.settings-provision__secret-label { color: var(--fg3); min-width: 80px; }`, used at `:169`
  for the "Password" label) and `client/shared/ui/Secret.svelte:42-45`
  (`.ui-secret__hint { font-size: 10px; color: var(--fg4); }`, populated from
  `TaskProviderSection.svelte:170`'s `hint="shown once — copy now"`) — `--fg3`/`--text-dim`
  (`#6b766e`) computes to roughly 4.4:1 against `--bg` (`#0a0c0a`, just under the 4.5:1 AA
  threshold for sub-14px text) and `--fg4` (`#3a4248`) to roughly 2:1, per
  `client/shared/tokens.css:20-21,70`.
- **Suggested fix:** confirm actual rendered contrast for `--fg3`/`--fg4` text in this block once
  a `canProvision: true` fixture exists, and move the one-time-reveal hint to a higher-contrast
  token given it communicates a "you will lose this" warning.

### [Low] Three of five component states are unverified by any Storybook fixture

- **Dimension:** 7. Responsive / layout
- **Where visible:** not captured — both `Populated` and `Error` stories use
  `taskInstanceId: null, canProvision: false`.
- **Source:** `client/stories/msw/settings-handlers.ts:212-218` (the only `/settings/api/context/
task-instance` fixture in `shellReadyHandlers`) and `client/settings/sections/
TaskProviderSection.stories.svelte:20-23` (only `Populated`/`Error` stories defined) mean the
  bound-instance field list (`TaskProviderSection.svelte:138-143`), the Kaneo provision CTA
  (`:149-157`), and the post-provision secret reveal (`:161-173`) have never been screenshotted,
  at any viewport.
- **Suggested fix:** add a story/fixture variant with a bound `taskInstanceId` and one with
  `canProvision: true` so those layouts get visual-regression coverage and can be reviewed.
