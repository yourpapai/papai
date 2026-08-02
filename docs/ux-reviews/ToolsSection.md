<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ToolsSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/ToolsSection.svelte`
**States captured:** Populated, Empty, Error, Loading, Grouped, Preset-applied, grouped/expanded @
~640px, populated/expanded per-tool segmented control · desktop (base-state PNGs under
`.storybook-shots/settings/sections/ToolsSection.spec.ts/`). The narrow-viewport and
expanded-group interaction tests recorded in `tests/visual/settings/sections/ToolsSection.spec.ts`
(below `@generated-end auto-screenshots`) are now captured — the prior run's `bun shoot`
failure ("Storybook addons channel is unavailable") was environment-specific and does not
reproduce; `bun run visual:audit -g ToolsSection` passes 8/8 against the current baselines.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                                                                        |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning   | warn  | Domain/group/tool rows share the same weight and are differentiated only by indentation (`ToolsSection.svelte:295-296`), so scanning relies on padding, not type scale or a per-group count.                                                                              |
| 2. Affordance & signifiers       | fail  | Ghost-variant preset and row-toggle buttons are still visually identical to static text at rest (`Btn.svelte:97-101`), and the active-preset indicator still sits detached from the options it summarizes.                                                                |
| 3. Consistency w/ design system  | warn  | Reuses `Btn`/`Pill`/`SegmentedControl` correctly, but still overloads the `primary` filled style to mean both "currently selected" and "submit this action" with identical weight (see `tools-preset-active-state-invisible`).                                            |
| 4. Feedback & state              | pass  | Loading/Empty/Error/Populated states are each clearly distinct and non-alarming; preset apply and admin-defaults clear are both gated behind an explicit two-step confirm.                                                                                                 |
| 5. Content & language            | warn  | Preset/permission labels are clear plain language, but the empty state is still a dead end with no actionable next step.                                                                                                                                                   |
| 6. Accessibility                 | warn  | Dim-text contrast is now fixed (`tokens.css:21`) and `SegmentedControl`/domain expander have correct `radiogroup`/`aria-expanded` semantics, but the raw `.settings-tools__expand` toggle has no shared control-height, giving it a below-24px click target unlike its row siblings. |
| 7. Responsive / layout           | warn  | Narrow-viewport shot is now captured and shows no clipping with the fixture's short domain names, but `.settings-tools__domain-head` still has no `flex-wrap` (unlike `.settings-tools__presets`), so a long domain name remains untested and at risk.                    |
| 8. Spacing, alignment & sizing   | warn  | Row gaps/paddings (6/10/14px) are hardcoded and don't map onto the `--s1`–`--s4`/`--gap-tight` scale used elsewhere.                                                                                                                                                        |
| 9. Interaction & micro-states    | warn  | `Btn`/`SegmentedControl` have real hover/focus-visible/disabled styling, but the preset Apply/Clear confirm bar unmounts the instant it's clicked, before the async request resolves, with nothing signalling the in-flight state.                                          |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Preset selector's active state is invisible at rest and its indicator is detached

- **Id:** tools-preset-active-state-invisible
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated / Grouped / Empty screenshots (`activePreset === null`, the common
  "Custom" state) — `Read-only`, `Non-destructive`, and `Allow all` render as plain unstyled
  text, indistinguishable from the `Preset` label beside them. The current-state summary is
  shown only via a `Pill` reading `Custom`/preset name pinned to the far right edge of the row
  by `margin-left: auto`, visually separated from the buttons it describes. Still reproduces —
  confirmed in the current `settings-sections-ToolsSection-Populated-1.png` and
  `settings-sections-ToolsSection-Preset-applied-1.png`: in the latter, the active `Read-only`
  option is filled solid green, the identical fill used by the `Apply`/`Clear` CTA buttons in
  the confirm dialogs, so it still reads as "click me" rather than "this is currently selected".
- **Source:** `client/settings/sections/ToolsSection.svelte:206-217` (preset buttons +
  `variant={activePreset === preset.value ? 'primary' : 'ghost'}` at `:208`), `:395-397`
  (`.settings-tools__presets-active { margin-left: auto }`); ghost resting style unchanged at
  `client/shared/ui/Btn.svelte:97-101` (`background: transparent; border-color: transparent`).
- **Suggested fix:** give inactive preset options a visible resting border/background (e.g. an
  `outline` variant) and move the current-state indicator directly adjacent to the preset row
  instead of anchoring it to the far edge.

### [Med] Bare "Ask all" / "Deny all" / "Allow all" row actions look like plain text, not buttons

- **Id:** tools-bulk-actions-look-like-text
- **Status:** open
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated/Grouped screenshots — the right-aligned action after each
  domain/group name and permission pill (e.g. `tasks  allow  Ask all`) has no border or fill,
  reading as a trailing label rather than a control. Still reproduces — confirmed in
  `settings-sections-ToolsSection-Populated-1.png` and
  `settings-sections-ToolsSection-Grouped-1.png`.
- **Source:** `client/settings/sections/ToolsSection.svelte:269-273` (domain toggle) and
  `:284-292` (group toggle) — both instantiate `<Btn variant="ghost" ...>`; ghost resting style
  unchanged at `client/shared/ui/Btn.svelte:97-101`.
- **Suggested fix:** use the `outline` or `secondary` `Btn` variant for these row-level toggle
  actions so they read as clickable controls at rest, not as trailing text.

### [Med] Populated/grouped rows are sparse — no per-domain or per-group tool count

- **Id:** tools-no-per-group-count
- **Status:** open
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Grouped screenshot — `plugin partial`, `mcp ask`, `time allow` rows still
  give no indication of how many tools are inside each bucket until it is expanded; the expanded
  narrow-viewport shot (`Tools-—-grouped-expanded-narrow-1.png`) shows the same gap one level
  down (`acp partial`, `audio-transcribe allow`).
- **Source:** `client/settings/sections/ToolsSection.svelte:257-274` (domain head markup) and
  `:281-293` (group head markup) still render only the name and summary `Pill`, never
  `domain.tools.length` or `toolGroup.tools.length`; `groupToolEntries`/`groupSummary` in
  `client/settings/lib/group-tools.ts:11-35` already have the tool arrays available.
- **Suggested fix:** append a count (e.g. `tasks (6)`) to the domain/group head so users can
  gauge scope before expanding.

### [Med] Preset Apply/Clear confirm bar gives no in-flight feedback while the request is pending

- **Id:** tools-confirm-no-busy-state
- **Status:** open
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** not a distinct screenshot (the gap is the frame *between* captured states) —
  reachable from the Populated/Grouped stories by clicking a preset button then Apply, or
  "Clear admin defaults" then Clear.
- **Source:** `client/settings/sections/ToolsSection.svelte:159-172` (`confirmPreset`) and
  `:174-186` (`confirmClear`) both set `pendingPreset = null` / `pendingClear = false`
  *synchronously* before `await`ing `applyToolPresetFn`/`clearPresetFn`, which immediately
  unmounts the `{#if pendingPreset !== null}` (`:221`) / `{#if pendingClear}` (`:241`) confirm
  bar — so the Apply/Clear/Cancel buttons at `:224-226`/`:244-246` disappear rather than show a
  busy state, and nothing replaces them until the response resolves and re-renders the domain
  list. Contrast with the Refresh action, which does wire busy state end-to-end:
  `ToolsSection.svelte:196` (`<IconButton ... busy={loading} .../>`) and
  `client/shared/ui/IconButton.svelte:20,48` (`class:ui-iconbtn--busy` → `opacity: 0.6;
  pointer-events: none`).
- **Suggested fix:** keep the confirm bar (or a lightweight busy replacement) mounted and pass a
  `busy` flag to the Apply/Clear `Btn` for the duration of the request, matching the Refresh
  button's pattern, instead of tearing the confirmation down before the request completes.

### [Low] Empty state has no actionable next step

- **Id:** tools-empty-state-no-next-step
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** Empty screenshot — "No togglable tools" / "No togglable tools for this
  context." with nothing to do next. Still reproduces —
  `settings-sections-ToolsSection-Empty-1.png` shows only the icon/title/hint, no action.
- **Source:** `client/settings/sections/ToolsSection.svelte:318`
  (`<EmptyState title="No togglable tools" hint="No togglable tools for this context." />` — no
  `action` snippet passed, though `client/shared/ui/EmptyState.svelte:13,23` still supports one).
- **Suggested fix:** pass an `action` snippet (e.g. a link to docs, or a hint to switch context)
  instead of leaving the message as a dead end.

### [Low] Domain-head row has no flex-wrap; long domain names remain untested

- **Id:** tools-domain-head-no-wrap
- **Status:** open
- **Dimension:** 7. Responsive / layout
- **Where visible:** `Tools-—-grouped-expanded-narrow-1.png` (640×900, `Grouped` story,
  `plugin` domain expanded) — now captured, and shows no clipping, but only because the
  fixture's domain names (`plugin`, `acp`, `mcp`, `time`) are short; the underlying CSS gap has
  not changed, so a long domain name is still an untested overflow risk, not a resolved one.
- **Source:** `client/settings/sections/ToolsSection.svelte:331-336`
  (`.settings-tools__domain-head { display: flex; align-items: center; gap: 10px; padding: 8px
  10px; }` — still no `flex-wrap`), contrasted with `.settings-tools__presets:383-389` which does
  set `flex-wrap: wrap`.
- **Suggested fix:** add `flex-wrap` (or truncate long domain names) to
  `.settings-tools__domain-head` so the name, summary pill, and toggle button don't overflow at
  ~640px with a longer domain string, and add a long-name fixture to confirm it.

### [Low] Row gaps/paddings drift from the spacing scale

- **Id:** tools-spacing-off-scale
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** every Populated/Grouped screenshot — all domain/group/tool rows.
- **Source:** `client/settings/sections/ToolsSection.svelte:331-336`
  (`.settings-tools__domain-head { gap: 10px; padding: 8px 10px; }`), `:345-351`
  (`.settings-tools__list { padding: 0 10px 10px; gap: 6px; }`), `:352-356`
  (`.settings-tools__tool { gap: 10px; }`), `:364-370` (`.settings-tools__group-head { gap: 10px;
  padding-top: 6px; }`) and `:379-381` (`.settings-tools__tool--grouped { padding-left: 14px; }`)
  — none of the 6/10/14px values map onto the scale in `client/shared/tokens.css:52,68-71`
  (`--gap-tight: 8px`, `--s1: 4px`, `--s2: 8px`, `--s3: 12px`, `--s4: 16px`).
- **Suggested fix:** round these gaps/paddings to the nearest scale token (8/12/16px) so tool
  rows share the same rhythm as sibling sections built on `--gap-tight`/`--gap-inline`.

### [Low] Domain-expand toggle has a below-floor click target

- **Id:** tools-domain-expand-small-target
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** every Populated/Grouped screenshot — the `▸ tasks` / `▾ plugin` toggle at
  the start of each domain row.
- **Source:** `client/settings/sections/ToolsSection.svelte:258-265` (raw `<button
  class="settings-tools__expand" ...>`) styled at `:337-344`
  (`.settings-tools__expand { background: none; border: none; ...; font-size: 12px; cursor:
  pointer; }` — no height or padding), unlike its row siblings which all sit on the shared
  24px floor: the domain-toggle `Btn size="sm"` (`:270`) → `Btn.svelte:108-112`
  (`--control-h-sm`), and `SegmentedControl.svelte:65` (`height: var(--control-h-sm)`).
- **Suggested fix:** give `.settings-tools__expand` an explicit min-height (or padding) reaching
  `--control-h-sm` so its click target matches the WCAG 2.5.8 24px floor already applied to its
  row siblings.

### [Low] Dim grey text tiers — contrast

- **Id:** tools-dim-text-contrast
- **Status:** fixed
- **Resolved:** `ca47dbb7a` ("fix(a11y): raise dim text tokens above the 4.5:1 contrast floor")
- **Dimension:** 6. Accessibility
- **Where visible:** preset hint line and group-name labels, visible in every state screenshot.
- **Evidence:** `client/shared/tokens.css:21` now documents
  `--text-dim: #828d84; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */`,
  and `--text-muted: #9aa79d` (`tokens.css:20`) is lighter still. `ToolsSection.svelte:398-402`
  (`.settings-tools__presets-hint { color: var(--text-dim); font-size: 11px; }`) and `:371-375`
  (`.settings-tools__group-name { color: var(--text-muted); font-size: 12px; }`) both consume
  these now-compliant tokens (the finding's original `--fg2`/`--fg3` names are the pre-migration
  aliases for the same tokens, per `09f46aa3c`). No further action needed.
