<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — GroupProviderSection

**Date:** 2026-07-03
**Reviewed:** `client/settings/sections/GroupProviderSection.svelte`
**States captured:** Populated, Empty, Error, Loading · desktop (base-state PNGs under
`.storybook-shots/settings/sections/GroupProviderSection.spec.ts/`), plus three manual states
added below `@generated-end auto-screenshots` in
`tests/visual/settings/sections/GroupProviderSection.spec.ts` and captured this run
(`bun shoot -g GroupProviderSection`, 7/7 passed): Populated at ~640px, `Select` focused, and
`Save` hovered. Only the `Populated` fixture exercises a bound instance; there is no long-id /
long-error fixture, so overflow behavior of a long instance label is unverified.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Context

This section is the group-scoped sibling of the already-reviewed
[`TaskProviderSection`](./TaskProviderSection.md): both bind a task instance to a context via an
identical `Field` + `Select` + primary-button form. The dominant theme below is **regression
against that sibling** — `GroupProviderSection` is a leaner clone that dropped several
state-handling affordances the sibling has (`ErrorState` with retry, a loading placeholder, a
busy/disabled save button, the muted `.placeholder` empty style). Three findings (unlabeled
`Select`, raw-id option labels, raw error text) are shared with the sibling and inherited
verbatim; they are consolidated into one finding here rather than re-argued.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                              |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow → title → single field → primary action reads top-down with nothing competing; matches sibling rhythm.                                                    |
| 2. Affordance & signifiers      | pass  | `Save` is a filled primary button and the refresh `IconButton` keeps a resting border, so both controls read as clickable at rest.                                |
| 3. Consistency w/ design system | warn  | Reuses shared primitives, but diverges from its direct sibling on error, loading, empty, and save-busy handling — the same task-bind flow behaves differently.    |
| 4. Feedback & state             | fail  | Initial load renders a blank body (no placeholder), the error path is a bare red line with no retry, and `Save` gives no in-flight feedback.                      |
| 5. Content & language           | fail  | Options are labeled with the raw internal id (`inst_abc (kaneo · active)`), errors are raw exception text (`boom`), and the empty state is a dead end.            |
| 6. Accessibility                | fail  | The `Select` has no programmatic label and shows no visible keyboard focus ring — the section's primary control is unlabeled and focus-invisible for keyboard/AT. |
| 7. Responsive / layout          | pass  | The ~640px shot reflows cleanly — field goes full width, button wraps below, no clipping or overflow.                                                             |
| 8. Spacing, alignment & sizing  | pass  | Layout is driven entirely by `.settings-form` tokens (`--gap-inline` / `--gap-field`); no one-off px, edges align with the field above.                           |
| 9. Interaction & micro-states   | fail  | `Save` has no busy/disabled transition (frozen frame + double-submit risk) and the `Select` has no `:focus-visible` ring; only the button hover state works.      |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] `Save` gives no in-flight or disabled feedback (double-submit risk)

- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** Populated / Save-hover shots — the button is a static "Save" at rest and
  during the async PATCH; there is no "Saving…" frame, spinner, or disabled state to shoot.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:46-57` — `save()` sets no
  in-flight flag, and `:86` renders
  `<Btn variant="primary" type="submit" testid="group-task-instance-save">Save</Btn>` with no
  `disabled` and no `busy`. `Btn` already exposes a `busy` prop it renders as `aria-busy` + a
  dimmed, pointer-events-none state (`client/shared/ui/Btn.svelte:31,44-47,70-73`), so the
  affordance exists and is simply unused. The sibling does this correctly at
  `client/settings/sections/TaskProviderSection.svelte:131-133`
  (`disabled={binding}` + `{binding ? 'Binding…' : 'Bind'}`).
- **Suggested fix:** track a `saving` flag across the PATCH and pass it to `Btn` as
  `disabled`/`busy` with a "Saving…" label, matching the sibling's `Bind` button.

### [High] `Select` is unlabeled and has no visible keyboard focus ring

- **Dimension:** 6. Accessibility (also 9. Interaction & micro-states)
- **Where visible:** Select-focused shot is pixel-identical to the resting Populated shot —
  focusing the dropdown produces no visible ring. The grey "TASK INSTANCE" caption above it is a
  layout relationship only.
- **Source:** two shared-primitive gaps, both surfacing on this section's only data control.
  (a) No label association — `client/shared/ui/Field.svelte:19-25` renders the label as a plain
  `<span>` with no `for`/`id`, and `client/shared/ui/Select.svelte:26-27` renders `<select>` with
  no `id`/`aria-label`; the composition at `GroupProviderSection.svelte:79-85` never links them
  (same defect documented for the sibling in [`TaskProviderSection.md`](./TaskProviderSection.md)).
  (b) No focus ring — `client/shared/ui/Select.svelte:48-55` sets `outline: 0` on the `<select>`
  and the `.ui-select` wrapper has no `:focus-within` style, so keyboard focus is invisible
  (contrast `Btn`'s real `:focus-visible` at `Btn.svelte:74-77`).
- **Suggested fix:** in the shared primitives, associate `Field`'s label with its control
  (`for`/`id` or `aria-labelledby`) and add a `:focus-within` ring to `.ui-select`; this repairs
  every `Field`+`Select` section at once, including this one.

### [Med] Load error is a bare red line with no recovery affordance

- **Dimension:** 4. Feedback & state (also 3. Consistency)
- **Where visible:** Error shot — the entire body is a single small red word ("boom"); the form
  never renders because `data` stays `null`.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:71`
  (`{#if error !== null}<p class="status-error">{error}</p>{/if}`) renders the caught error's raw
  `.message` (set at `:39-40`) with no retry control. The only recovery is the header refresh
  `IconButton` (`:66-68`), which is not signposted as the error's remedy. The sibling instead
  uses the shared `ErrorState` with an explicit `onRetry`
  (`TaskProviderSection.svelte:111-112`).
- **Suggested fix:** render load failures through the shared `ErrorState` component with an
  `onRetry={() => void load(contextId)}` button, as the sibling does.

### [Med] Initial load renders a blank body (no loading placeholder)

- **Dimension:** 4. Feedback & state
- **Where visible:** Loading shot — only the eyebrow/title and header refresh button render; the
  content area is empty with no "Loading…" cue.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:74` gates all body content on
  `{#if data !== null}`, and the `loading` flag (`:25`) drives only the header `IconButton`'s
  `busy` (`:67`) — never a body placeholder. The sibling shows `<p class="placeholder">Loading…</p>`
  on first load (`TaskProviderSection.svelte:113-114`).
- **Suggested fix:** show a `.placeholder` "Loading…" line while `data === null && loading`,
  matching the sibling.

### [Med] Empty state uses full-brightness text and dead-ends the user

- **Dimension:** 5. Content & language (also 3. Consistency)
- **Where visible:** Empty shot — "No active task instances are available for this group." renders
  at full body brightness (not the muted placeholder grey used elsewhere) and offers no next step.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:76` is a bare
  `<p>…</p>` with no `.placeholder` class, so it inherits `--text` rather than the muted
  `--text-muted` (`client/settings/settings.css:97-99`). The sibling both mutes the text and gives
  a next step: `<p class="placeholder">No active task instances available. Ask an admin to create
one.</p>` (`TaskProviderSection.svelte:121`).
- **Suggested fix:** apply the `.placeholder` class and append an actionable hint (e.g. "Ask an
  admin to create one."), matching the sibling's empty copy.

### [Low] Options are labeled with a raw internal id (inherited from sibling)

- **Dimension:** 5. Content & language
- **Where visible:** Populated / narrow shots — the only option reads `inst_abc (kaneo · active)`,
  an opaque database id concatenated with provider type and status.
- **Source:** `client/settings/sections/GroupProviderSection.svelte:82`
  (`label: \`${o.id} (${o.type} · ${o.status})\``) — identical to the sibling; the `available`
entries carry no human-friendly name to fall back to. Documented once already in
[`TaskProviderSection.md`](./TaskProviderSection.md); repeated here only because it is visible in
  this section too.
- **Suggested fix:** surface a human-readable instance name (or a short ordinal) ahead of the raw
  id, ideally fixed at the shared level so both sections benefit.
  </content>
  </invoke>
