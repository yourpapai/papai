<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0362: ToolsSection UX Open-Findings Fixes

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-03)

## Context

`ToolsSection` (`client/settings/sections/ToolsSection.svelte`) — the settings section for managing a context's tool permissions (presets, per-domain and per-group toggles, admin-default clearing) — had 8 open UX-review findings (`docs/ux-reviews/ToolsSection.md`) at 1 fixed / 8 open:

1. **`tools-preset-active-state-invisible` (High):** the active preset button used the same `primary` green fill as the **Apply** confirm CTA, so "currently selected" and "click to submit" were visually identical and the active state was invisible at rest.
2. **`tools-confirm-no-busy-state` (Med):** `confirmPreset`/`confirmClear` cleared `pendingPreset`/`pendingClear` synchronously before awaiting, so the confirm bar unmounted on the same tick as the click and the user got no in-flight frame.
3. **`tools-bulk-actions-look-like-text` (Med):** per-domain/per-group bulk actions (`Allow all`/`Ask all`/`Deny all`) were `ghost` buttons reading as bare text.
4. **`tools-no-per-group-count` (Med):** domain and group heads showed names but no tool counts.
5. **`tools-spacing-off-scale` (Low):** hardcoded 6/10/14px spacing mapped onto no design token.
6. **`tools-domain-expand-small-target` (Low):** the raw `<button>` expand caret had no height/padding, below the WCAG 2.5.8 target-size floor while siblings sat on `--control-h-sm: 24px`.
7. **`tools-domain-head-no-wrap` (Low):** `.settings-tools__domain-head` had no `flex-wrap`; long domain names would overflow (unproven — every fixture name was short).
8. **`tools-empty-state-no-next-step` (Low):** the empty state dead-ended with no action.

One complication: the design spec asserted a "**No shared-primitive changes**" scope boundary and listed "Any change to `Btn`" as out of scope — but the required `aria-pressed` on the active preset button could not be set because `Btn.svelte`'s `Props` exposed no `ariaPressed` and no `class` passthrough. The spec had asserted the boundary before checking this.

## Decision Drivers

- **The `primary` fill must mean exactly one thing: "click this to submit."** Fill is reserved exclusively for CTAs (`Apply`, `Clear`); state indication moves to outline + accent border + `✓` + `aria-pressed="true"` (Finding 1).
- **A request that mutates state shows an in-flight frame.** The confirm bar stays mounted with the CTA `busy`/`disabled` for the duration of the request; pending state clears in a `finally` block (Finding 2).
- **Bare actions floating in a plain row must look interactive** — `outline`, not `ghost`. Confirm-bar **Cancel** buttons stay `ghost` because they sit inside a bordered panel next to a filled CTA and inherit affordance from context (Finding 3).
- **A fix without a fixture that exercises it is an unverified claim.** `flex-wrap` on the domain head ships together with a long-domain-names Storybook fixture and a narrow-viewport screenshot case (Finding 7).
- **Honor a constraint's purpose, not just its wording.** The spec's no-shared-primitive rule existed to avoid churning visual baselines across all 18 sections; an optional ARIA attribute that renders nothing when omitted churns zero pixels, so an additive `Btn` prop satisfies the constraint's intent (deviation from spec).
- **Spacing rounds onto the token scale** (`--s2`/`--s3`/`--s4`); already-on-scale literal values (8px/12px) are left as literals to keep the finding-closing commit focused (Finding 5).
- **`SegmentedControl` is explicitly rejected** for the preset row: it cannot represent `activePreset === null` ("Custom", the common case with per-tool overrides), and it sets `aria-checked` on click — announcing selection before the confirm bar resolves, an accessibility regression.
- **`aria-pressed` on independent toggle buttons vs. `radiogroup` for per-tool permissions is an intentional inconsistency**: the confirm bar makes a preset click a request, not a state change.

## Considered Options

### Option 1 — Add an optional `ariaPressed` prop to `Btn` (chosen)

Purely additive `ariaPressed?: boolean` on the shared `Btn` primitive; when omitted the attribute is `undefined` and not rendered, so every existing consumer is byte-identical and zero visual baselines churn. Combined with the section-level fixes: busy-state confirm bars, outline preset row with accent border + `✓` + `aria-pressed`, per-group counts, outline row actions, token-rounded spacing, 24px expand target, `flex-wrap` domain head + long-name fixture, and an empty-state **Refresh** action.

- **Pros:** closes all 8 findings; the accessibility half of the High finding (`aria-pressed`) is preserved; zero pixel churn for the other 17 sections; the prop is reusable.
- **Cons:** violates the spec's literal scope boundary (documented deviation, surfaced for reviewer sign-off).

### Option 2 — Hand-roll the three preset options as raw `<button>` elements styled locally

- **Pros:** honors the spec's literal wording; no shared change.
- **Cons:** duplicates the design system inside the component — regressing the Consistency scorecard dimension this project is graded on; loses `Btn`'s `busy`/`disabled`/size handling.

### Option 3 — Drop `aria-pressed` entirely

- **Pros:** smallest change.
- **Cons:** discards the accessibility half of the High finding's fix; the active state becomes distinguishable only visually.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **`Btn.svelte`** — additive optional `ariaPressed?: boolean` prop (`:23,38,55`); renders `aria-pressed` only when passed. Three unit tests pin omit/true/false (`tests/client/shared/ui/Btn.test.ts:137`).
2. **`ToolsSection.svelte` confirm bars** — `applying`/`clearing` `$state` flags (`:74-75`) set before the `await` and cleared with pending state in `finally`; both CTAs render `busy`/`disabled` with `Applying…`/`Clearing…` labels while in flight; flags also reset in `load` so a context switch cannot strand a busy button.
3. **Preset row redesign** — all three presets render `variant="outline"`; the active one gets `aria-pressed="true"`, a `✓` label marker, and an accent border via a `.settings-tools__preset--active :global(.ui-btn)` wrapper selector (`:457`) because `Btn` has no `class` passthrough; the current-state indicator moved from the far edge into the label (`Preset: <span data-testid="preset-active">…`).
4. **Row actions and counts** — domain and group bulk toggles are `outline` buttons; domain/group heads render `name (n)` counts (`:275,310` tests).
5. **Spacing and target size** — off-scale 6/10/14px values rounded to `--s2`/`--s3`/`--s4`; the expand caret gained `min-height: var(--control-h-sm)` (24px WCAG 2.5.8 floor) and horizontal padding.
6. **Domain-head wrap + fixture** — `flex-wrap: wrap` on `.settings-tools__domain-head`; a `Long domain names` story (`ToolsSection.stories.svelte:146`) plus generated desktop and manual narrow (`Tools — long domain names, narrow`, `ToolsSection.spec.ts:64`) screenshot cases; visual audit floor rose 460 → 462.
7. **Empty state** — gains an outline **Refresh** action (`data-testid="tools-empty-refresh"`, `:370`) inside `EmptyState`'s existing `action` snippet.
8. **Findings closed** — `docs/ux-reviews/ToolsSection.md` now 0 open / 14 fixed with per-finding `Resolved:` lines citing real commit hashes; backlog regenerated (`_BACKLOG.md`), currency gate passing.

## Consequences

### Positive

- The active preset is distinguishable from inactive ones at rest without competing with the **Apply** CTA — fill now unambiguously means "submit".
- No request completes without an in-flight frame; double-submit is structurally prevented by the guard flags.
- The shared `Btn` primitive gained a reusable, zero-churn accessibility prop; the omit-when-undefined behavior is pinned by a characterization test protecting the other 17 sections.
- Long domain names wrap instead of overflowing, proven by a dedicated fixture and narrow-viewport baseline rather than asserted.
- All 8 findings closed with hash-cited `Resolved:` lines; the section moved from 8 open / 1 fixed to 0 open.

### Negative

- The spec's "no shared-primitive changes" boundary was violated in wording (though honored in intent); the deviation required explicit reviewer sign-off.
- Three `bun shoot` re-baseline cycles (one per batch) were required, and the audit passing is meaningful only because every changed PNG was individually read — re-shooting makes the audit pass by construction.
- The `aria-pressed` preset buttons vs. `radiogroup` per-tool permissions is a deliberate control-pattern inconsistency inside one component that future readers may need explained.
- `Btn` still has no `class` passthrough; the accent border works through a `:global()` descendant selector, which is more fragile than a first-class prop.

### Risks

- **Future `Btn` edits** that change attribute forwarding could alter the omit-when-undefined guarantee; mitigated by the omit test in `Btn.test.ts`.
- **Single-token overflow residue**: `flex-wrap` wraps between flex items but cannot break inside one unbreakable domain name token; if a pathological name appears, the finding reopens narrowed to that residue (deliberately not chased with `overflow-wrap` in this pass).
- **Baseline-churn intent of the original constraint** is preserved only while `ariaPressed` stays attribute-only; adding visual coupling to the prop later would violate it.

## Related Decisions

- **ADR-0272 (McpSection UX Fixes)** — same shared-layer-first discipline: fix root causes in shared primitives with additive changes, keep section changes local.
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format and `Resolved:`-hash contract this ADR's closure step consumed.
- **ADR-0352 (Shared Primitive Accessibility)** — the precedent for additive ARIA props on shared primitives.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-03-tools-section-open-findings.md`; spec: `docs/superpowers/specs/2026-08-03-tools-section-open-findings-design.md`.
- Closing commits cited in `docs/ux-reviews/ToolsSection.md`: `a2f763cd9` (busy state + empty state), `e69d2852b` (spacing tokens + expand target), `1629c16be` (domain-head wrap + fixture), `0d0f101f7` (preset redesign + row actions + counts).
- Verification: `bun test tests/client/settings/sections/ToolsSection.test.ts` (18 tests), `bun test tests/client/shared/ui/Btn.test.ts`, `bun run visual:audit -g ToolsSection` (10 cases; full suite floor 462), plus a fresh-context adversarial reviewer pass before any status flip — "tests pass" and "audit green" were explicitly not accepted as evidence.
