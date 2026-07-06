<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — AI output UX fixes

**Date:** 2026-07-06
**Source review:** [`docs/ux-reviews/AiOutputSection.md`](../../ux-reviews/AiOutputSection.md)
**Status:** approved design, pending implementation plan

## Goal

Fix all 7 findings from the `AiOutputSection` UX review. Several findings live in shared
primitives (`SegmentedControl`, `ConfigFieldRow`, `IconButton`) that sibling sections also
use, so the correct fixes ripple to `ToolsSection`, `TaskProviderSection`, and
`ProfileSection` — this is intended, since the same defects exist there.

## Decisions (locked)

- **Fix placement:** shared defects fixed in the primitives; AiOutput-specific wiring stays
  local. (Not local-only overrides, not a repo-wide token migration.)
- **Findings in scope:** all 7 (3 Med + 4 Low).
- **Label/hint hierarchy:** create the tier by brightening the label to `--text`, keeping the
  hint muted (the hint cannot be dimmed further without failing WCAG contrast).
- **No server/schema changes:** `ConfigField` carries no hint metadata; the hint is threaded
  as a prop, not sourced from the fetcher.

## Changes by file

### A. `client/shared/ui/SegmentedControl.svelte` (shared)

Affects: `ToolsSection` and every enum field rendered through `ConfigFieldRow`.

1. **Contrast (Med, finding: unselected segment label).** Resting option color
   `--text-dim` (`#6b766e`, ≈3.6:1 on `--surface-2`) → `--text-muted` (`#9aa79d`, ≈6.9:1).
   Preserves the rest → hover (`--text`) → selected (`--accent-fg` on `--accent`) gradient.
   - Anchor: `.ui-seg__opt { color: var(--text-dim) }` at `SegmentedControl.svelte:56`.

2. **In-flight feedback (Med, finding: toggle gives no in-flight feedback).** Add optional
   `disabled?: boolean` prop. When `true`: each option button gets the native `disabled`
   attribute and the group gets a dimmed style (`opacity: .6; pointer-events: none`).
   `onChange` must be a no-op while disabled. `ConfigFieldRow` passes `disabled={saving}`.
   - Anchor: props block `SegmentedControl.svelte:11-18`; button element `:30-41`.

3. **Focus ring (Low, finding: missing explicit focus ring).** Add `:focus-visible` on
   `.ui-seg__opt` using the shared token from §E.

4. **Height/radius (Low, finding: controls don't share baseline/radius).** `.ui-seg__opt`
   `height: 26px → 22px`; `.ui-seg` `border-radius: var(--radius)` (6px) →
   `var(--radius-control)` (2px). Adjust option padding to keep the 11px label vertically
   centered. Result matches the `sm` Clear button (`height: 22px`, `--radius-control`) beside it.
   - Anchor: `.ui-seg { border-radius: var(--radius) }` `:49`; `.ui-seg__opt { height: 26px }` `:61`.

### B. `client/shared/ui/IconButton.svelte` (shared, 22 call sites)

5. **Focus ring (Low).** Add `:focus-visible` using the §E token. Additive; no resting-state
   change.
   - Anchor: `.ui-iconbtn` style block `IconButton.svelte:28-45`.

### C. `client/settings/components/ConfigFieldRow.svelte` (shared)

Affects: `ProfileSection`, `TaskProviderSection`.

6. **Hint + aria (Med, finding: privacy warning not associated with control).** Add optional
   `hint?: string` prop. When present, render `<p class="settings-field__hint"
id={`cfg-hint-${field.key}`}>{hint}</p>` inside the card, below the control row, and pass a
   new `ariaDescribedBy` value (= that id) into `SegmentedControl` (and `Input` for text
   fields). `SegmentedControl` sets `aria-describedby` on its `role="radiogroup"` element.
   - Anchor: props block `ConfigFieldRow.svelte:18-22`; enum branch `:107-126`; text branch `:127-166`.

7. **Label hierarchy (Low).** `.settings-field__label` color `--fg2` → `--text`, so the label
   outranks the muted hint. Applies to config labels in Profile/TaskProvider too.
   - Anchor: `.settings-field__label { color: var(--fg2) }` `ConfigFieldRow.svelte:193-198`.

8. **Legacy aliases (Low).** `.settings-field { background: var(--surface) }` →
   `var(--surface-1)`; the label color already moves to canonical `--text` in §C.7. Scoped to
   this file only — not a repo-wide alias sweep.
   - Anchor: `.settings-field { background: var(--surface) }` `ConfigFieldRow.svelte:180-186`.

### D. `client/settings/sections/AiOutputSection.svelte` (local)

Remove the standalone `<p class="ai-output-hint">` and its `.ai-output-hint` style; pass the
hint through `ConfigFieldRow` instead:

```
hint={field.key === 'ai_output_detail_level'
  ? 'Raw detail shows unredacted tool inputs/outputs and reasoning in chat.'
  : undefined}
```

Hint text is unchanged — relocated into the card and wired for accessibility.

- Anchor: hint `<p>` `AiOutputSection.svelte:76-78`; `.ai-output-hint` style `:88-91`; the
  `{#each}` passing `field` to `ConfigFieldRow` `:73-75`.

### E. `client/shared/tokens.css` (shared, tiny)

Add a focus-ring token extracted from `Btn`'s existing literal:

```
--focus-ring: 2px solid rgba(82, 224, 138, 0.4);
--focus-ring-offset: 1px;
```

Update `Btn` (`Btn.svelte:74-77`), `SegmentedControl`, and `IconButton` to reference it — one
branded focus style. (If keeping `Btn` untouched is preferred, copy the literal into the two
new spots instead; token is the recommended path.)

## Non-goals

- No repo-wide legacy-alias (`--fg2`/`--surface`/…) migration; only `ConfigFieldRow` is touched.
- No `ConfigField` schema/fetcher change to carry hint metadata; hint stays a component prop.
- No change to the Raw/Standard behavior, options, or the optimistic-save model itself — only
  its in-flight signalling.

## Testing / verification

- **Storybook re-shoot** (`bun shoot -g <Section>`) for the four affected sections: AiOutput,
  Tools, TaskProvider, Profile. Add states: segment disabled-during-save, `:focus-visible` on
  a segment option and the icon-button, and the AiOutput hint rendered inside the card.
- **Unit tests:**
  - `SegmentedControl` with `disabled` does not invoke `onChange` on click or arrow keys, and
    renders the options as `disabled`.
  - `ConfigFieldRow` renders the hint paragraph and sets `aria-describedby` on the control
    only when `hint` is provided; omits both otherwise.
- **Source/manual checks:** unselected segment label ≥4.5:1 contrast; focus rings render from
  the shared token; `aria-describedby` resolves to the rendered hint id.

## Rollout notes

Blast radius: 3 shared primitives + `tokens.css`, rippling to Tools/TaskProvider/Profile.
Purely front-end; no migrations. Re-shooting the four sections is the regression gate.
