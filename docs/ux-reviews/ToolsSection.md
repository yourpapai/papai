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
An independent adversarial verification pass re-derived all 8 previously-open findings from
source and screenshots (including pixel sampling the active preset button's border at
`rgb(82,224,138)` — exactly `--accent` — against inactive borders at `rgb(34,42,36)` — exactly
`--border`) and confirmed all 8 fixed; it also surfaced five new defects (below), none of which
were among the original 8. Full-suite state at close: `bun test` 10850/0,
`bun run visual:audit` **462/0** (the design spec's projected 461 undercounted by one — the
long-domain fix needed both a generated desktop fixture and a manual narrow-viewport one), lint /
typecheck / `format:check` / `bun security` all clean.

**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                                                                                                        |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning   | pass  | Domain/group rows now surface a tool count alongside the name (`ToolsSection.svelte:307` `{domain.domain} ({domain.tools.length})`, `:325` `{groupName} ({toolGroup.tools.length})`), so scope is scannable before expanding; remaining differentiation is indentation-only, which is a low-severity residue, not a scanning defect. |
| 2. Affordance & signifiers       | pass  | Every non-Cancel control in the section now renders as a real `outline`-variant button with a visible resting border — preset options, the domain/group row toggles (`:313-320`, `:333-340`), and, since `bb1aba29b`, the "Clear admin defaults" trigger (`:263`). `.settings-tools__preset--active` at `:450` gives the active preset an `--accent` border+text. The two confirm-bar Cancels stay `ghost` by design. |
| 3. Consistency w/ design system  | pass  | The active-preset state is now expressed via a dedicated `--accent` border/text rule on the `outline` variant (`:450-453`) plus `aria-pressed` (`Btn.svelte:53`, `ToolsSection.svelte:227`), fully decoupled from the `primary`/`danger` filled styles still reserved for the Apply/Clear/Confirm CTAs — the prior overload is gone.                                    |
| 4. Feedback & state              | pass  | Loading/Empty/Error/Populated states are each clearly distinct and non-alarming; preset apply and admin-defaults clear are both gated behind an explicit two-step confirm, and the confirm bar now stays mounted with a busy/disabled Apply/Clear button for the duration of the request (`:159-172` `confirmPreset`, `:174-186` `confirmClear`).                        |
| 5. Content & language            | pass  | Preset/permission labels are clear plain language, and the empty state now carries an actionable next step via `EmptyState`'s `action` snippet (`:318` area) instead of being a dead end.                                                                                    |
| 6. Accessibility                 | pass  | Dim-text contrast remains fixed (`tokens.css:21`), `SegmentedControl`/domain expander keep correct `radiogroup`/`aria-expanded` semantics, the expand toggle sits on the shared 24px floor (`e69d2852b`), and the active preset's `✓` is now wrapped in an `aria-hidden="true"` span (`:230`, `ddb63df03`) so screen readers hear only the `aria-pressed` state wired at `:227`.                                     |
| 7. Responsive / layout           | pass  | `.settings-tools__domain-head` now sets `flex-wrap: wrap`, and a lengthened long-domain fixture proves the head row actually wraps instead of clipping/overflowing at ~640px, closing the previously-untested overflow risk.                                              |
| 8. Spacing, alignment & sizing   | pass  | Every gap, padding, and margin in the section's stylesheet now resolves through the shared scale — the last two bare `12px` margins, `.settings-tools__presets-hint` (`:461-465`) and `.settings-tools__clear-row` (`:477-480`), moved to `var(--s3)` in `ddb63df03`, joining the `var(--s1)`–`var(--s4)`/`--gap-tight` values already in place.                |
| 9. Interaction & micro-states    | pass  | The preset Apply/Clear confirm bar stays mounted with a busy/disabled action for the duration of the request (`:164-197`), the per-tool `SegmentedControl` and the domain/group toggles are now disabled during `applying`/`clearing` (`:313-320`, `:333-340`, `:349-355`, `ddb63df03`) so a manual edit cannot race an in-flight request, and the clear-trigger row hides while a preset confirmation is open (`:260` now also gated on `pendingPreset === null`), leaving one confirmation surface on screen at a time.             |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Preset selector's active state is invisible at rest and its indicator is detached

- **Id:** tools-preset-active-state-invisible
- **Status:** fixed
- **Resolved:** `0d0f101f7` ("fix(settings): make the ToolsSection preset state visible and row
  actions look interactive") (2026-08-03), building on `82c8513de` ("feat(ui): add an optional
  ariaPressed prop to Btn"). Every preset option now uses `variant="outline"` with a visible
  resting border (`ToolsSection.svelte:208-217`), and the active option gets a dedicated
  `--accent` border + text color (`.settings-tools__preset--active :global(.ui-btn)` at
  `:450-453`) plus `ariaPressed={active}` (`:227`, wired through to `aria-pressed` at
  `Btn.svelte:53`). An independent adversarial verification pass sampled the active button's
  border pixel at `rgb(82,224,138)` (exactly `--accent`) against inactive borders at
  `rgb(34,42,36)` (exactly `--border`), confirming the fix. The active state is no longer
  filled solid green like the Apply/Clear CTAs, so it no longer reads as "click me".
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated / Grouped / Preset-applied screenshots.
- **Source:** `client/settings/sections/ToolsSection.svelte:208-227`, `:450-453`;
  `client/shared/ui/Btn.svelte:23,37,53`.
- **Suggested fix:** N/A — resolved.

### [Med] Bare "Ask all" / "Deny all" / "Allow all" row actions look like plain text, not buttons

- **Id:** tools-bulk-actions-look-like-text
- **Status:** fixed
- **Resolved:** `0d0f101f7` ("fix(settings): make the ToolsSection preset state visible and row
  actions look interactive") (2026-08-03). The domain toggle (`ToolsSection.svelte:313`) and the
  group toggle (`:344`) now both instantiate `<Btn variant="outline" ...>` instead of `ghost`, so
  they render with a visible resting border and read as controls, not trailing text. Confirmed by
  the independent adversarial verification pass against current screenshots.
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated/Grouped screenshots.
- **Source:** `client/settings/sections/ToolsSection.svelte:313`, `:344`.
- **Suggested fix:** N/A — resolved.

### [Med] Populated/grouped rows are sparse — no per-domain or per-group tool count

- **Id:** tools-no-per-group-count
- **Status:** fixed
- **Resolved:** `0d0f101f7` ("fix(settings): make the ToolsSection preset state visible and row
  actions look interactive") (2026-08-03). The domain head now renders
  `{domain.domain} ({domain.tools.length})` (`ToolsSection.svelte:307`) and the group head renders
  `{groupName} ({toolGroup.tools.length})` (`:325`), so scope is visible before expanding.
  Confirmed by the independent adversarial verification pass against current screenshots.
- **Dimension:** 1. Visual hierarchy & scanning
- **Where visible:** Populated/Grouped screenshots, and the expanded narrow-viewport shot.
- **Source:** `client/settings/sections/ToolsSection.svelte:307`, `:325`.
- **Suggested fix:** N/A — resolved.

### [Med] Preset Apply/Clear confirm bar gives no in-flight feedback while the request is pending

- **Id:** tools-confirm-no-busy-state
- **Status:** fixed
- **Resolved:** `a2f763cd9` ("fix(settings): keep the Tools confirm bar mounted while in flight and
  give the empty state a next step") (2026-08-03), hardened by `3b1c5bf09` ("fix(settings):
  prevent the Tools preset and clear flows from interrupting each other") which stopped the
  preset-apply and clear-defaults flows from being able to interrupt one another mid-flight.
  `confirmPreset` (`ToolsSection.svelte:159-172`) now sets `applying = true` before awaiting and
  clears `pendingPreset` only in a `finally` block; `confirmClear` (`:174-186`) does the same with
  `clearing`/`pendingClear`. The confirm bar therefore stays mounted with `Apply`/`Clear` in a
  `busy`/`disabled` state (`:242-243`, `:278-279`) for the duration of the request instead of
  unmounting instantly. Confirmed by the independent adversarial verification pass.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** not a distinct screenshot — reachable by clicking a preset button then
  Apply, or "Clear admin defaults" then Clear.
- **Source:** `client/settings/sections/ToolsSection.svelte:159-186`, `:242-243`, `:278-279`.
- **Suggested fix:** N/A — resolved.

### [Med] Per-tool/domain/group permission controls stay live during a preset apply or clear

- **Id:** tools-race-permission-during-preset
- **Status:** fixed
- **Resolved:** `ddb63df03` ("fix(settings): close four pixel-preserving ToolsSection findings")
  (2026-08-04). The domain toggle (`:313-320`), the group toggle (`:333-340`), and the per-tool
  `SegmentedControl` (`:349-355`) each now carry `disabled={applying || clearing}`, matching the
  gating the confirm-bar buttons already had. No `busy` caption was added to the leaf controls —
  the confirm bar announces the in-flight operation centrally, and up to 30 simultaneous "Saving…"
  captions for one operation would be worse than none.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** not a distinct screenshot — reachable by starting a preset Apply or "Clear
  admin defaults" Clear, then, before the request resolves, changing an individual tool's
  `SegmentedControl` or clicking a domain/group "Ask all"/"Deny all"/"Allow all" toggle.
- **Source:** `client/settings/sections/ToolsSection.svelte:343-349` (`SegmentedControl`, no
  `disabled` prop), `:313` (domain toggle `Btn`, no `disabled` prop tied to `applying`/`clearing`),
  `:328-334` (group toggle `Btn`, same gap). The preset (`:242-243`) and clear (`:278-279`) confirm
  buttons already gate correctly on `applying`/`clearing`, but these three row-level controls do
  not, so a manual edit during a slow preset/clear request races the in-flight response —
  whichever resolves last silently wins, invisibly discarding the other. An earlier commit,
  `3b1c5bf09`, closed this same class of hole between the preset-apply and clear-defaults flows,
  but not for these per-tool/domain/group controls.
- **Suggested fix:** N/A — resolved.

### [Low] "Clear admin defaults" trigger still uses the bare `ghost` variant

- **Id:** tools-clear-trigger-looks-like-text
- **Status:** fixed
- **Resolved:** `bb1aba29b` ("fix(settings): give the Tools clear-defaults trigger a real button
  affordance") (2026-08-04). `:263` is now `variant="outline"`, so the trigger has a visible
  resting border matching the domain/group row toggles. The two confirm-bar Cancels (`:250`,
  `:286`) remain `ghost` by design. This was the only change in the sub-project permitted to move
  pixels; it altered exactly one baseline,
  `settings-sections-ToolsSection-Preset-applied-1.png`, which was read directly to confirm the
  border appeared and nothing else shifted. That baseline only shows the trigger at all because
  the same commit added `clearPresetFn` to the `Preset applied` story — before it, the guard at
  `:260` meant no story rendered the trigger, so the change would have been invisible in every
  frame.
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** source only at review time — no story passed `clearPresetFn`, so the
  "Clear admin defaults" trigger rendered in no baseline. It is visible in the `Preset applied`
  screenshot from `bb1aba29b` onward, above the preset confirm area.
- **Source:** `client/settings/sections/ToolsSection.svelte:263` (`<Btn variant="ghost" ...
  testid="tool-defaults-clear">`) — transparent background *and* transparent border
  (`Btn.svelte:97-101`), so it reads as plain text. Same defect class as the now-fixed
  `tools-bulk-actions-look-like-text`, but a different button, hence a new finding rather than a
  residue. The two other remaining `ghost` buttons (`:250`, `:286`, the confirm-bar Cancels) are
  deliberately kept `ghost` by design and are not part of this finding.
- **Suggested fix:** N/A — resolved.

### [Low] Clear-defaults trigger row can render alongside the preset confirm bar

- **Id:** tools-dual-confirm-bars-overlap
- **Status:** fixed
- **Resolved:** `ddb63df03` ("fix(settings): close four pixel-preserving ToolsSection findings")
  (2026-08-04). The clear-row guard at `:260` gained `&& pendingPreset === null`, so the trigger
  hides while a preset confirmation is open and returns the moment the user cancels. The clear
  trigger yields to the preset bar rather than the reverse, because the user has just expressed
  preset intent. This completes a symmetry the code already half-implemented: the clear trigger's
  own `onClick` at `:267` already set `pendingPreset = null`.
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** not a distinct screenshot — reachable by requesting a preset (opening the
  preset confirm bar) while stored admin defaults still exist.
- **Source:** `client/settings/sections/ToolsSection.svelte:260`
  (`{#if clearPresetFn !== undefined && storedDefaults && !pendingClear}`) — gated only on
  `storedDefaults && !pendingClear`, not on `pendingPreset === null`, so the "Clear admin
  defaults" row can be visible at the same time as the preset Apply/Cancel confirm bar
  (`:236-256`), putting two competing confirmation affordances on screen at once.
- **Suggested fix:** N/A — resolved.

### [Low] Two spacing values remain off the token scale

- **Id:** tools-clear-row-spacing-off-scale
- **Status:** fixed
- **Resolved:** `ddb63df03` ("fix(settings): close four pixel-preserving ToolsSection findings")
  (2026-08-04). Both bare margins are now `var(--s3)` — `.settings-tools__presets-hint` at
  `:461-465` and `.settings-tools__clear-row` at `:477-480`. `--s3` is `12px`
  (`client/shared/tokens.css:70`), so
  this was a tokenisation-consistency change with no visual delta. The visual audit run before any
  re-shoot confirmed it moved no pixels.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated/Grouped screenshots whenever the clear-admin-defaults row or the
  presets hint line renders.
- **Source:** `client/settings/sections/ToolsSection.svelte:472`
  (`.settings-tools__clear-row { margin-bottom: 12px; }`) and `:455`
  (`.settings-tools__presets-hint { margin: 0 0 12px; }`) — both still a bare `12px` rather than
  `var(--s3)`. Note the values themselves are on-scale (`--s3` is `12px`); this is a
  tokenization-consistency gap, a distinct defect from the now-closed `tools-spacing-off-scale`.
- **Suggested fix:** N/A — resolved.

### [Low] Active-preset checkmark is redundant with `aria-pressed` for screen readers

- **Id:** tools-preset-checkmark-not-decorative
- **Status:** fixed
- **Resolved:** `ddb63df03` ("fix(settings): close four pixel-preserving ToolsSection findings")
  (2026-08-04). `:230` now reads
  `{#if active}<span aria-hidden="true">✓ </span>{/if}{preset.label}`, so a screen reader hears
  only the `aria-pressed` state wired at `:227`, not a redundant "check mark" announcement. The
  glyph remains visible to sighted users. The wrapper turned out **not** to be pixel-neutral: the
  audit run before any re-shoot caught a ~1px re-shaping of the active preset button, because
  splitting the glyph and the label into two inline runs re-shapes the text. The glyph, the label,
  and every colour are unchanged; only the button's width moved, nudging the two buttons to its
  right by 1px. `bb1aba29b` absorbed that shift when it re-shot the same baseline, so the sub-project
  still changed exactly one baseline and added none.
- **Dimension:** 6. Accessibility
- **Where visible:** Preset-applied screenshot — the active preset button reads `✓ Read-only`.
- **Source:** `client/settings/sections/ToolsSection.svelte:230`
  (`{active ? '✓ ' : ''}{preset.label}`) — the `✓` is baked into the button's visible text rather
  than marked decorative, so a screen reader announces "check mark Read-only" in addition to the
  `aria-pressed="true"` state already wired at `:227`/`Btn.svelte:53`, duplicating the same
  information.
- **Suggested fix:** N/A — resolved.

### [Low] Empty state has no actionable next step

- **Id:** tools-empty-state-no-next-step
- **Status:** fixed
- **Resolved:** `a2f763cd9` ("fix(settings): keep the Tools confirm bar mounted while in flight and
  give the empty state a next step") (2026-08-03). `ToolsSection.svelte:361-367` now passes an
  `action` snippet to `EmptyState` — a `Refresh` button (`variant="outline"`,
  `testid="tools-empty-refresh"`) that re-runs `load(contextId)` — so the empty state is no
  longer a dead end. Confirmed by the independent adversarial verification pass.
- **Dimension:** 5. Content & language
- **Where visible:** Empty screenshot.
- **Source:** `client/settings/sections/ToolsSection.svelte:361-367`;
  `client/shared/ui/EmptyState.svelte:13,23`.
- **Suggested fix:** N/A — resolved.

### [Low] Domain-head row has no flex-wrap; long domain names remain untested

- **Id:** tools-domain-head-no-wrap
- **Status:** fixed
- **Resolved:** `1629c16be` ("fix(settings): wrap the ToolsSection domain head and prove it with a
  long-name fixture") (2026-08-03), hardened by `96d0283c6` ("test(visual): lengthen the
  ToolsSection long-domain fixture until the head row wraps") after the first fixture's domain
  name turned out not to be long enough to force the wrap. `.settings-tools__domain-head` now sets
  `flex-wrap: wrap` (`ToolsSection.svelte:380-386`), and the lengthened long-domain fixture's
  narrow-viewport shot confirms the head row wraps rather than clipping or overflowing. Confirmed
  by the independent adversarial verification pass.
- **Dimension:** 7. Responsive / layout
- **Where visible:** narrow-viewport long-domain shot.
- **Source:** `client/settings/sections/ToolsSection.svelte:380-386`.
- **Suggested fix:** N/A — resolved.

### [Low] Row gaps/paddings drift from the spacing scale

- **Id:** tools-spacing-off-scale
- **Status:** fixed
- **Resolved:** `e69d2852b` ("style(settings): round ToolsSection spacing onto the scale and raise
  the expand target to 24px") (2026-08-03). The domain-head, list, tool, and group-head rules now
  use `var(--s2)`/`var(--s3)`/`var(--gap-tight)` instead of hardcoded 6/10/14px values (e.g.
  `.settings-tools__domain-head` at `ToolsSection.svelte:380-386` now reads
  `gap: var(--s3); padding: var(--s2) var(--s3);`). Confirmed by the independent adversarial
  verification pass. A narrower residue remains: `.settings-tools__clear-row` (`:472`) and
  `.settings-tools__presets-hint` (`:455`) still carry a bare `12px` margin outside the token
  scale — tracked separately as a new finding below, since the values this finding targeted are
  now genuinely on-scale.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** every Populated/Grouped screenshot — all domain/group/tool rows.
- **Source:** `client/settings/sections/ToolsSection.svelte:380-431`.
- **Suggested fix:** N/A — resolved.

### [Low] Domain-expand toggle has a below-floor click target

- **Id:** tools-domain-expand-small-target
- **Status:** fixed
- **Resolved:** `e69d2852b` ("style(settings): round ToolsSection spacing onto the scale and raise
  the expand target to 24px") (2026-08-03). `.settings-tools__expand` now reaches the shared
  24px floor (`ToolsSection.svelte:387-396`, `min-height: var(--control-h-sm)`), matching its row
  siblings (`Btn size="sm"`, `SegmentedControl`). Confirmed by the independent adversarial
  verification pass.
- **Dimension:** 6. Accessibility
- **Where visible:** every Populated/Grouped screenshot — the `▸ tasks` / `▾ plugin` toggle at
  the start of each domain row.
- **Source:** `client/settings/sections/ToolsSection.svelte:387-396`.
- **Suggested fix:** N/A — resolved.

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
