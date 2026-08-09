<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Token contrast remediation

**Date:** 2026-08-02
**Status:** Design approved, pending spec review

## Problem

Two of the text-color tokens in `client/shared/tokens.css` produce text that fails WCAG 2.1
AA SC 1.4.3 (Contrast, Minimum) on every surface the design system defines.

Measured against the five surface tokens — `--bg` `#0a0c0a`, `--surface-1` `#111512`,
`--surface-2` `#171c18`, `--surface-hover` `#1c221d`, `--inset` `#0e1214`:

| token | value | best surface | worst surface (`--surface-hover`) |
| ------------------------- | --------- | ----- | ----- |
| `--text` | `#e6efe8` | 16.71 | 13.79 |
| `--text-muted` / `--fg2` | `#9aa79d` | 7.84 | 6.47 |
| `--text-dim` / `--fg3` | `#6b766e` | 4.15 | **3.43** |
| `--fg4` | `#3a4248` | 1.92 | **1.58** |
| `--fg-hint` | `#8b978c` | 6.45 | 5.33 |

`--text-dim` (aliased as `--fg3`) fails the 4.5:1 floor on all five surfaces. It clears the
3:1 non-text floor, which would make it legal for large text and for icons or borders — but
that exemption is unreachable here. Of its 88 uses, 87 carry text: 85 `color` declarations
plus two computed uses, `client/shared/ui/Pill.svelte:26` (the `neutral` variant) and
`client/shared/ui/KV.svelte:21`. The 88th is a `border-color` at
`client/shared/base.css:148`. Every declared font size adjacent to a `--fg3` text site is
small — 27 at 11px, 22 at 12px, 9 at 10px, and one at 20px, which is still "normal" text
under SC 1.4.3 (large text begins at 18.66px bold or 24px regular). The remaining sites
inherit their size; no site anywhere in the sweep was found at large-text size, so the
exemption applies to none of them.

`--fg4` fails even the 3:1 non-text floor, at 1.58–1.92:1. All 20 of its property uses are
`color`, plus two computed uses — `client/shared/ui/Pill.svelte:27` (the `mute` variant) and
`client/shared/ui/KV.svelte:21` (the `dim` key). At those ratios it is not a dim tier; it is
functionally invisible. This is the MemorySection review's "[High] Record meta text
(`--fg4`) is effectively invisible" finding, generalized: the token is broken everywhere it
is used, not in that one section.

Scale: `--fg3` appears 88 times across 53 files, `--fg4` 22 times across 13 files, spanning
all four SPAs (shared 25/7, debug 24/12, admin 19/3, settings 17/0, plus stories and
transcript).

The root cause is that these are **token values**, not call-site mistakes. Every call site
correctly asks for "the dim text color"; the dim text color is simply not legible. Any fix
applied at the call site would leave the failing value in the token file for the next author
to reach for.

## Scope

This is sub-project **G** on branch `ui-ux-review-01`.

In scope: the values of `--text-dim`, `--fg4`, and `--fg-hint` in `client/shared/tokens.css`;
a new contrast regression gate; and the visual re-baseline the value change forces.

Explicitly **not** in scope:

- **Deleting the legacy aliases.** Sweeping `--fg3` → `--text-dim` and `--fg4` → its
  successor is pixel-neutral and belongs in its own cycle, where it can be verified as
  producing zero screenshot diffs. Merging it here would mean a diff in which a
  pixel-changing fix and a pixel-neutral rename cannot be told apart.
- **Non-text contrast (SC 1.4.11, 3:1).** Exactly one `--fg3` site is a `border-color`
  (`client/shared/base.css:148`), and it rises with the token rather than needing its own
  treatment. Pulling `--border` and `--strong` into the gate opens a separate argument about
  decorative borders that this cycle does not need to win.
- **Component API changes.** See the `KV` note under Design.
- **Empty-state work** (GroupProvider, Identity, Mcp, Profile), deferred to sub-project H.

## Design

### Token values

Four declarations change in `client/shared/tokens.css`:

```css
--text-dim: #828d84; /* 4.70:1 on --surface-hover, 5.69:1 on --bg */
--fg3: var(--text-dim); /* declaration unchanged; inherits the new value */
--fg4: var(--text-dim); /* was #3a4248 — illegal for text and non-text alike */
--fg-hint: var(--text-dim); /* was #8b978c — redundant once dim is compliant */
```

The resulting ramp is three tiers, each clearing 4.5:1 on all five surfaces:

| tier | value | worst-case ratio |
| --------------- | --------- | ---- |
| `--text` | `#e6efe8` | 13.79 |
| `--text-muted` | `#9aa79d` | 6.47 |
| `--text-dim` | `#828d84` | 4.70 |

`#828d84` is the chosen dim value because it is close to the floor — a compliant dim should
sit as low as the criterion allows, so the tier stays visually subordinate — while leaving
margin above 4.5:1 on the worst surface rather than landing exactly on it.

`--fg-hint` folds into `--text-dim` because it existed only as a workaround for dim being
broken. Once dim is compliant, "the accessible hint color" and "the dim text color" name the
same thing. Its six call sites keep resolving; the change is zero-churn.

### The collapsed tier

Merging `--fg4` into `--text-dim` removes a hierarchy tier. Ten files use both tokens
adjacently to express two levels: `client/shared/ui/KV.svelte`,
`client/shared/ui/Pill.svelte`, `client/shared/TreeView.svelte`, `client/admin/admin.css`,
`client/debug/debug.css`, `client/admin/components/SubjectsTable.svelte`,
`client/admin/components/SubjectDetail.svelte`, `client/debug/components/LogExplorer.svelte`,
`client/debug/components/ScopeFilter.svelte`, `client/debug/components/TurnsPanel.svelte`.

The collapse is correct regardless. At 1.58–1.92:1 the removed tier was never perceptible —
the distinction existed in the stylesheet, not on screen. Deleting it removes a fiction
rather than a feature.

The alternative, preserving four tiers, would have to fit them between 4.5:1 and 7.4:1,
producing steps of roughly 4.7 / 5.4 / 6.2 / 7.2. Those are indistinguishable from one
another; that design would restore the fiction, not the hierarchy.

One consequence is accepted explicitly: `KV`'s `dim` prop
(`client/shared/ui/KV.svelte:21`, `dim ? var(--fg4) : var(--fg3)`) becomes inert, since both
branches resolve to the same value. The prop stays in place this cycle — changing a component
API inside a token change would blur the diff the same way the alias sweep would. It is
recorded here as follow-up work for the alias-deletion cycle.

### Regression gate

Retuning fixes today's values but does not stop the next author from adding
`--text-faint: #444`. A new test derives the contrast from the stylesheet itself:
`tests/client/shared/token-contrast.test.ts`, placed beside the existing
`control-target-size.test.ts`, which already establishes one-accessibility-criterion-per-file
as the local pattern. `tokens.test.ts` stays what it is — a declaration-presence check.

The test reads `client/shared/tokens.css`, parses `--name: value` pairs, resolves `var(--x)`
references transitively to a hex literal, and asserts the ratio for every text token against
every surface token:

```typescript
const TEXT = ['--text', '--text-muted', '--text-dim', '--fg', '--fg2', '--fg3', '--fg4', '--fg-hint']
const SURFACE = ['--bg', '--surface-1', '--surface-2', '--surface-hover', '--inset']

for (const fg of TEXT)
  for (const bg of SURFACE) expect(ratio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(4.5)
```

Forty assertions from two hardcoded lists. Those lists are the contract: CSS carries no
semantics distinguishing a text custom property from a background one, so the test must
declare it. Adding a text token means adding it to `TEXT`, and the gate then binds it.

The 4.5:1 floor is applied flat, with no large-text exemption. No call site in the codebase
could use such an exemption, and building one would only create a loophole.

The contrast math — sRGB linearization, relative luminance, ratio — lives in the test file.
It is roughly fifteen lines with no production consumer, so it does not ship in `client/`.

## Verification

`.storybook-shots/` is gitignored and untracked, so no committed baseline exists to diff
against; the current local baselines are the pre-change state. They are trustworthy for the
first time now that all 94 spec files pin their viewport via `pinDefaultViewport()`. That
makes the strict run usable as an audit, not only as a gate:

1. **Before any edit**, run `bunx playwright test` (strict, no `--update-snapshots`) and
   confirm 454/454. An unclean starting baseline makes every later step unreadable.
2. Apply the token change.
3. **Run strict again and read the failure list as data.** Every failing spec should render
   dim text; every passing spec should not. Spot-check two or three of the passes to confirm
   they genuinely contain no dim text rather than silently missing the change — a pass that
   should have failed is the same class of defect as the `CodingMcpSection` viewport leak: a
   green result that means nothing.
4. **Read a sample of diff PNGs.** A color-only change must not move a pixel of geometry; a
   diff showing reflow means a token is being consumed somewhere it should not be. Sample
   across all four SPAs rather than settings alone — debug carries the heaviest `--fg4` usage
   at 12 of 22 sites.
5. Run `bun shoot` to re-baseline, then a strict run to confirm green.

`DebugApp` carries a live uptime counter that produces a spurious diff on every run. It is a
known false positive and is discounted, not investigated.

Alongside the visual work: `bun run test:client` for `tokens.test.ts` and the new contrast
gate, and `bun run check:full` at 12/12 before the cycle closes.

### What verification cannot prove

The gate proves 4.70:1. It cannot prove that the new dim still *reads* as subordinate to
`--text-muted`. That is a judgment call made from the sampled PNGs in step 4. If the ramp
reads flat, the remedy is to lift `--text-muted` — not to lower `--text-dim` back below the
floor.

## Risks

**The ramp compresses.** A compliant dim at 4.70:1 sits closer to muted at 6.47:1 than the
broken dim did at 3.43:1. This is inherent to the criterion, not to this design: any
compliant three-tier ramp on these surfaces has less range than a non-compliant one. Step 4
of verification is where this gets judged.

**Blast radius is the whole UI.** Every screenshot containing dim text changes. This is
expected and is the point; the risk is that a genuine regression hides inside a large
expected-diff set. Step 3's pass/fail partition is the control for that.
