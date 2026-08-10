<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ToolsSection open-findings fix — design

**Date:** 2026-08-03
**Status:** approved, not yet planned
**Predecessor:** [`2026-08-02-ux-findings-backlog-design.md`](./2026-08-02-ux-findings-backlog-design.md)

## Goal

Close all 8 open findings in `docs/ux-reviews/ToolsSection.md`, taking the section from
**8 open / 1 fixed → 0 open / 9 fixed**, and re-score its scorecard (today: 1 `fail`,
7 `warn`, 1 `pass`). Backlog-wide open count falls **32 → 24**.

ToolsSection is the first of several fix sub-projects because it is the largest single
concentration of open findings (8 of 32) and holds the corpus's only `High`.

## Why this is one project and not eight

The eight findings share one component, one test file, and one set of visual baselines.
Fixing them separately would re-shoot the same baselines eight times. Fixing them together
in three attributable batches re-shoots them three times.

## Scope boundary

Every code fix lands in `client/settings/sections/ToolsSection.svelte`. The only file
changed outside it is a Storybook fixture adding a long domain name, plus the visual spec
case that exercises it.

**No shared-primitive changes.** This was verified, not assumed:

- The `outline` `Btn` variant already exists (`client/shared/ui/Btn.svelte:92`), so the two
  affordance findings need no new variant.
- `EmptyState` already accepts an `action` snippet (`client/shared/ui/EmptyState.svelte:13,23`).

This matters because a shared-primitive change would churn visual baselines across all 18
sections. Keeping the blast radius inside one component is what makes per-batch baseline
review affordable.

### Explicitly out of scope

- The other 24 open findings across 17 sections. Each remaining cluster is its own
  sub-project.
- `ToolsSection`'s already-`fixed` finding `tools-dim-text-contrast`. It stays `fixed`.
- Any change to `Btn`, `EmptyState`, `SegmentedControl`, `Pill`, or `IconButton`.

## Key design decision: fill means one thing

The `High` finding (`tools-preset-active-state-invisible`) and scorecard dimension 3 describe
the same root cause: the `primary` filled style means both "this is currently selected" and
"click this to submit". The preset row and the confirm bar use identical green fills, so a
selected preset reads as a call to action.

**Decision: no preset button is ever filled.** All three render as `outline`. The active one
carries an accent border, a `✓` marker, and `aria-pressed="true"`. Fill is reserved
exclusively for CTAs (`Apply`, `Clear`). The current-state indicator moves out of its
`margin-left: auto` far-edge position and becomes part of the label: `Preset: Custom`.

### Rejected: reuse `SegmentedControl`

`SegmentedControl` is used elsewhere in this same component for per-tool permissions and
would give arrow-key navigation for free. It was rejected for two reasons:

1. **It cannot represent "Custom".** `activePreset` is `null` whenever the user has
   per-tool overrides — the common case. `SegmentedControl` requires `value: string` and has
   no none-selected state.
2. **Its ARIA would lie.** Applying a preset goes through a confirm bar, so a click is a
   *request*, not a state change. `SegmentedControl` sets `aria-checked` on click
   (`SegmentedControl.svelte:35`), which would announce a preset as selected before the user
   has confirmed — an accessibility regression, not an improvement.

`aria-pressed` on independent toggle buttons is the honest semantic for "this is the current
preset, and clicking another one begins a confirmable change".

## The three batches

Batches are ordered **C → B → A**: smallest baseline blast radius first, most
judgment-heavy change last so it settles on final geometry.

### Batch C — State & content

| Finding | Severity | Fix |
| --- | --- | --- |
| `tools-confirm-no-busy-state` | Med | Keep the confirm bar mounted across the request |
| `tools-empty-state-no-next-step` | Low | Pass an `action` snippet to `EmptyState` |

`confirmPreset` (`ToolsSection.svelte:159-172`) and `confirmClear` (`:174-186`) both clear
`pendingPreset` / `pendingClear` *synchronously before* awaiting the request, which unmounts
the confirm bar (`:221`, `:241`) instantly. The Apply/Clear/Cancel buttons vanish and nothing
replaces them until the response resolves.

Fix: introduce `applying` / `clearing` flags. Clear `pendingPreset` / `pendingClear` only
*after* the await settles. While in flight, `Apply` / `Clear` receive `busy` and `disabled`,
matching the pattern `Refresh` already uses (`:196` → `IconButton.svelte:20,48`).

**End-state behavior is deliberately unchanged.** On both success and error the bar unmounts
and errors continue to surface in the existing top-of-section `status-error` line. This fix
adds only the missing in-flight frame; it does not redesign error recovery.

### Batch B — Geometry

| Finding | Severity | Fix |
| --- | --- | --- |
| `tools-spacing-off-scale` | Low | Round hardcoded gaps/paddings to scale tokens |
| `tools-domain-expand-small-target` | Low | Raise the expand toggle to the 24px floor |
| `tools-domain-head-no-wrap` | Low | Add `flex-wrap` and a fixture that proves it |

Spacing: the 6/10/14px values at `:331-336`, `:345-351`, `:352-356`, `:364-370` and
`:379-381` map onto no token. The scale is `--s1: 4px`, `--s2: 8px`, `--s3: 12px`,
`--s4: 16px`, `--gap-tight: 8px` (`client/shared/tokens.css:52,68-71`). Round 6→8 (`--s2`),
10→12 (`--s3`), 14→16 (`--s4`).

Click target: `.settings-tools__expand` (`:337-344`) is a raw `<button>` with no height or
padding, while every sibling in its row sits on `--control-h-sm: 24px`
(`client/shared/tokens.css:63`). Give it an explicit `min-height: var(--control-h-sm)`,
meeting WCAG 2.5.8.

Wrap: `.settings-tools__domain-head` has no `flex-wrap`, unlike `.settings-tools__presets`
(`:383-389`) which does. The existing narrow shot only passes because every fixture domain
name is short (`plugin`, `acp`, `mcp`, `time`). Add `flex-wrap: wrap` **and** a
long-domain-name fixture, so the wrap is demonstrated rather than assumed.

### Batch A — Affordance & hierarchy

| Finding | Severity | Fix |
| --- | --- | --- |
| `tools-preset-active-state-invisible` | **High** | Preset row redesign (see decision above) |
| `tools-bulk-actions-look-like-text` | Med | Row toggles `ghost` → `outline` |
| `tools-no-per-group-count` | Med | Append a tool count to domain/group heads |

Row toggles at `:269-273` (domain) and `:284-292` (group) use `variant="ghost"`, whose
resting style is `background: transparent; border-color: transparent`
(`Btn.svelte:97-101`) — visually identical to the static text beside them. Switch to
`outline`.

Counts: domain and group heads (`:257-274`, `:281-293`) render only a name and summary
`Pill`. The tool arrays are already available via `groupToolEntries` / `groupSummary`
(`client/settings/lib/group-tools.ts:11-35`). Append `domain.tools.length` and
`toolGroup.tools.length` as `name (n)`.

## Verification

### Per-batch loop

1. Apply the fix.
2. Run `bun test tests/client/settings/sections/ToolsSection.test.ts` — must pass.
3. `bun shoot -g ToolsSection` — baseline **creation** for an intentional visual change.
4. **Read every changed PNG with the Read tool** and describe what actually changed against
   what the finding predicted.
5. `bun run visual:audit -g ToolsSection` — must pass.
6. Commit.

Step 4 is the load-bearing step and is not optional. Re-shooting makes the audit pass by
construction, so a green audit proves nothing about whether the UI improved. The predecessor
project established this: the only defense against a green tautology is a human-readable
description of the actual pixels. A batch whose shots were not individually read is not done.

### Baseline re-churn

Batches A and B both restyle the same rows, so B's geometry change re-churns any baseline A
would have produced, and vice versa. No ordering eliminates this. Running C → B → A means
affordance shots are read once, against final geometry; roughly seven shots are read twice
across the project. This cost was accepted deliberately in preference to merging A and B into
one diff where a spacing regression and a variant regression would be indistinguishable.

### Adversarial verification

After all three batches, a **fresh agent** re-derives every `fixed` claim against current
source and current screenshots. Whoever writes a fix does not certify it. The predecessor
project ran this after every batch and it refuted a claim that had already passed its own
author's review, which is the whole justification for the step.

## Testing

`tests/client/settings/sections/ToolsSection.test.ts` currently holds 13 tests, mounting the
component with `mount`/`flushSync` and `setMockFetch`. All 13 must keep passing.

**One existing test must change.** `:215` (`renders the preset bar with the active preset
highlighted`) asserts the current `primary`-fill highlight. Batch A replaces that mechanism,
so the test is **updated to assert `aria-pressed="true"` on the active preset** — not
deleted, not loosened to a weaker assertion. A test that stops proving the active state is
distinguishable would silently discard the `High` finding's entire guarantee.

**New tests:**

- The confirm bar stays mounted and `Apply` is busy/disabled while the request is pending
  (Batch C). Drive this with a fetch mock whose promise is resolved manually, so the in-flight
  window is observable rather than timing-dependent.
- Domain and group heads render their tool counts (Batch A).

**Visual audit floor: 460 → 461.** ToolsSection's spec holds 8 cases today; the long-domain
fixture adds one. The floor is the audit's *test count*, not the number of tracked baselines
— `.storybook-shots/` is git-ignored.

## Closing the loop

A final task, after the adversarial pass:

1. Flip all 8 findings to `- **Status:** fixed`, each with a `- **Resolved:**` line citing
   its actual fix commit. The parser rejects a non-`open` status lacking one.
2. Re-score the ToolsSection scorecard. Dimension 2 moves `fail` → `pass`. Dimensions 1, 3,
   5, 6, 7, 8, 9 move `warn` → `pass` only where the batch actually earns it; a dimension
   whose rationale still describes a real residue keeps its `warn` and keeps a finding open.
3. `bun run ux:backlog` → ToolsSection `0 open / 9 fixed`, total **24 open**.
4. `bun test tests/scripts/ux-backlog.test.ts` (currency gate) after `bun run format`.

Statuses may only be flipped after the fix commits exist, because `Resolved:` must cite a
real hash.

## Risks

- **Spacing rounding shifts layout.** Moving 6/10/14 → 8/12/16 grows every row slightly.
  The ~640px narrow shot must be re-read specifically for new clipping or overflow.
- **`aria-pressed` is a judgment call.** It is the honest semantic given the confirm flow,
  but it is a different control pattern from the `radiogroup` used for per-tool permissions
  in the same component. That inconsistency is intentional and is documented above; a
  reviewer should weigh it rather than assume it is an oversight.
- **The long-domain fixture may reveal a second defect.** If wrapping exposes a layout
  problem the finding did not anticipate, that is a new finding to record as `open` — not
  something to absorb silently into this project's scope.

## Success criteria

- All 8 findings named in this spec reach `fixed`, each citing a real commit.
- `bun run visual:audit -g ToolsSection`: 9/9 passed.
- Full audit: 461 passed, 0 failed.
- Every changed baseline read and described by a human-readable account.
- Adversarial pass finds no unsupported `fixed` claim.

The expected end state is ToolsSection `0 open / 9 fixed` and a backlog total of 24 open,
with the `High` bucket empty.

**This target is not a hard criterion, and must not be defended by suppressing findings.**
Two paths legitimately lead elsewhere:

- A fix leaves a genuine residue. That dimension keeps its `warn` and the finding stays
  `open` with its text narrowed to the residue — the predecessor project's no-`partial` rule.
- The long-domain fixture, or any batch's baseline read, exposes a defect this spec did not
  anticipate. It is recorded as a new `open` finding.

In either case the counts land above zero and the project is still successful. A `0 open`
result obtained by declaring a residual defect fixed is a failure, however green the audit
is. Report the actual numbers.
