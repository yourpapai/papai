<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ToolsSection

**Date:** 2026-07-02
**Reviewed:** `client/settings/sections/ToolsSection.svelte`
**States captured:** Populated, Empty, Error, Loading, Grouped, Preset-applied · desktop (base-state
PNGs under `.storybook-shots/settings/sections/ToolsSection.spec.ts/`). A ~640px narrow-viewport
and expanded-group interaction test was added to
`tests/visual/settings/sections/ToolsSection.spec.ts` (below `@generated-end auto-screenshots`)
but **could not be captured this run** — `bun shoot -g ToolsSection` failed for every story,
including the pre-existing generated ones, with `Error: Storybook addons channel is unavailable`
(the dev Storybook instance was reachable at `http://localhost:6006` but its addons channel was
not responding to the shoot harness). The narrow-viewport/interaction finding below is therefore
inferred from source (`.settings-tools__domain-head` layout rules) rather than a captured
screenshot; the desktop base-state PNGs on disk were used for everything else.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                                                                         |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Domain/group/tool rows share the same weight and are differentiated only by indentation (`ToolsSection.svelte:295`), so scanning relies on padding, not type scale.                                                                                                          |
| 2. Affordance & signifiers      | fail  | Ghost-variant preset and row-toggle buttons are visually identical to static text at rest, and the active-preset indicator sits detached from the options it summarizes.                                                                                                     |
| 3. Consistency w/ design system | warn  | Reuses `Btn`/`Pill`/`SegmentedControl` correctly, but overloads the `primary` filled style to mean both "currently selected" and "submit this action" with identical weight.                                                                                                 |
| 4. Feedback & state             | pass  | Loading/Empty/Error/Populated states are each clearly distinct and non-alarming; preset apply and admin-defaults clear are both gated behind an explicit two-step confirm.                                                                                                   |
| 5. Content & language           | warn  | Preset/permission labels are clear plain language, but the empty state is a dead end with no actionable next step.                                                                                                                                                           |
| 6. Accessibility                | warn  | Per-tool `SegmentedControl` has correct `radiogroup`/`radio`/`aria-checked`/roving-tabindex semantics and the domain expander has `aria-expanded`, but several text tiers rely on dim `--fg2`/`--fg3` at 11px and the ghost-button actions have no resting visual signifier. |
| 7. Responsive / layout          | warn  | Narrow-viewport shot could not be captured this run; source shows `.settings-tools__domain-head` has no `flex-wrap` while the sibling `.settings-tools__presets` rule does, a plausible overflow risk at ~640px.                                                             |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Preset selector's active state is invisible at rest and its indicator is detached

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated / Grouped / Empty screenshots (`activePreset === null`, the common
  "Custom" state) — `Read-only`, `Non-destructive`, and `Allow all` render as plain unstyled
  text, indistinguishable from the `Preset` label beside them. The current-state summary is
  shown only via a `Pill` reading `Custom`/preset name pinned to the far right edge of the row
  by `margin-left: auto`, visually separated from the buttons it describes. (The Preset-applied
  screenshot does show the matching option filled green once a preset is actually active — but
  that filled style is identical to the `Apply`/`Clear` CTA buttons used in the confirm dialogs
  below, so it reads as "click me" rather than "this is currently selected".)
- **Source:** `client/settings/sections/ToolsSection.svelte:205-217` (preset buttons +
  `variant={activePreset === preset.value ? 'primary' : 'ghost'}`), `:394-396`
  (`.settings-tools__presets-active { margin-left: auto }`); ghost resting style at
  `client/shared/ui/Btn.svelte:77-81` (`background: transparent; border-color: transparent`).
- **Suggested fix:** give inactive preset options a visible resting border/background (e.g. an
  `outline` variant) and move the current-state indicator directly adjacent to the preset row
  instead of anchoring it to the far edge.

### [Med] Bare "Ask all" / "Deny all" / "Allow all" row actions look like plain text, not buttons

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated/Grouped screenshots — the right-aligned action after each
  domain/group name and permission pill (e.g. `tasks  allow  Ask all`) has no border or fill,
  reading as a trailing label rather than a control.
- **Source:** `client/settings/sections/ToolsSection.svelte:268-272` (domain toggle) and
  `:283-291` (group toggle) — both instantiate `<Btn variant="ghost" ...>`; ghost resting style
  at `client/shared/ui/Btn.svelte:77-81`.
- **Suggested fix:** use the `outline` or `secondary` `Btn` variant for these row-level toggle
  actions so they read as clickable controls at rest, not as trailing text.

### [Med] Populated/grouped rows are sparse — no per-domain or per-group tool count

- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Grouped screenshot — `plugin partial`, `mcp ask`, `time allow` rows give no
  indication of how many tools are inside each bucket until it is expanded.
- **Source:** `client/settings/sections/ToolsSection.svelte:256-273` (domain head markup) and
  `:280-292` (group head markup) render only the name and summary `Pill`, never `domain.tools.length`
  or `toolGroup.tools.length`; `groupToolEntries`/`groupSummary` in
  `client/settings/lib/group-tools.ts:11-35` already have the tool arrays available.
- **Suggested fix:** append a count (e.g. `tasks (6)`) to the domain/group head so users can
  gauge scope before expanding.

### [Low] Empty state has no actionable next step

- **Dimension:** 5. Content & language
- **Where visible:** Empty screenshot — "No togglable tools" / "No togglable tools for this
  context." with nothing to do next.
- **Source:** `client/settings/sections/ToolsSection.svelte:317`
  (`<EmptyState title="No togglable tools" hint="No togglable tools for this context." />` — no
  `action` snippet passed, though `client/shared/ui/EmptyState.svelte:13,23` supports one).
- **Suggested fix:** pass an `action` snippet (e.g. a link to docs, or a hint to switch context)
  instead of leaving the message as a dead end.

### [Low] Domain-head row has no flex-wrap; possible clipping at narrow widths

- **Dimension:** 7. Responsive / layout
- **Where visible:** not captured this run — `bun shoot -g ToolsSection` failed with `Storybook
addons channel is unavailable` for every story before the manual narrow-viewport test could
  run; this is a source-level inference, not a confirmed screenshot regression.
- **Source:** `client/settings/sections/ToolsSection.svelte:330-335`
  (`.settings-tools__domain-head { display: flex; align-items: center; gap: 10px; padding: 8px
10px; }` — no `flex-wrap`), contrasted with `.settings-tools__presets:382-388` which does set
  `flex-wrap: wrap`.
- **Suggested fix:** add `flex-wrap` (or truncate long domain names) to
  `.settings-tools__domain-head` so the name, summary pill, and toggle button don't overflow at
  ~640px; re-verify with a captured narrow-viewport screenshot once Storybook's addons channel
  is stable.

### [Low] Dim grey text tiers — verify contrast on dark theme

- **Dimension:** 6. Accessibility
- **Where visible:** preset hint line and group-name labels, visible in every state screenshot.
- **Source:** `client/settings/sections/ToolsSection.svelte:397-401`
  (`.settings-tools__presets-hint { color: var(--fg3); font-size: 11px; }`) and `:370-374`
  (`.settings-tools__group-name { color: var(--fg2); font-size: 12px; }`).
- **Suggested fix:** confirm `--fg3`/`--fg2` meet WCAG AA contrast against the dark background at
  11-12px, or bump hint/group-name text to a higher-contrast token.
