<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0344: Control-Height Token Scale with Test-Enforced WCAG Floor and Closed-World Ratchet

## Status

Accepted

## Date

2026-08-08

## Context

The shared UI kit (`client/shared/ui/*.svelte`) sized its interactive primitives with hardcoded pixel heights: `Btn` at 22/28/34px for `sm`/`md`/`lg`, `SegmentedControl` options at 22px, `IconButton` at 28px square, and `Seg` with no height at all (computing to roughly 21–22px from font + padding). That put every `sm` control below the WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum) floor of 24 CSS px, and the values were scattered across component `<style>` blocks with no single source of truth and nothing stopping a future primitive from reintroducing a sub-floor height. The design is in `docs/superpowers/specs/2026-07-31-control-target-size-design.md`; the implementation plan is `docs/superpowers/plans/2026-07-31-control-target-size.md`.

## Decision Drivers

- **Hit the correct WCAG floor.** The target is 24px (SC 2.5.8, AA) — not 44px (SC 2.5.5, AAA), which would force a much larger visual change than required.
- **Single source of truth.** Control height should live in one token scale in `client/shared/tokens.css`, not in per-component literals, so future floor changes are one-line edits.
- **Minimize visual churn.** Only the `sm` step changes value (22px → 24px); `md` and `lg` are refactors at identical values and must produce no rendered difference.
- **Guard by test, not by convention.** A text guard must enforce both the numeric floor on the tokens and the no-hardcoded-height discipline on interactive primitives, because code review alone demonstrably let 22px ship.
- **Close the world.** A guard over a remembered file list silently stops policing new primitives; the suite must fail when any *new* `client/shared/ui/*.svelte` file hardcodes a height without a written exemption.
- **Distinguish target from non-target.** Some px heights are legitimate (layout containers, progress bars, a checkbox box inside a clickable label) — exemptions must be explicit and carry a reason, not blanket-allowed.

## Considered Options

### Option 1 — Token scale + literal-scanning guard test + closed-world ratchet (chosen)

Define `--control-h-{sm,md,lg}` (24/28/34px) on `:root` in `client/shared/tokens.css`, point the four interactive primitives at them, and add `tests/client/shared/control-target-size.test.ts` with three layers: (a) a regex scanner (`HEIGHT_PX` with a lookbehind excluding `line-height`/`max-height`) over each interactive file requiring zero literal heights and token usage; (b) a numeric floor check parsing every `--control-h-*` token against 24px; (c) a `Glob` ratchet over the whole `ui/` directory demanding exact equality between offenders and an `EXEMPT` map whose values are written reasons.

- **Pros:** one source of truth; floor enforced numerically, not visually; exact-equality ratchet fails both on unknown offenders *and* stale exemptions; scanner behavior is itself unit-tested (ignores `line-height`, `max-height`, and `var()` references); no build tooling or runtime cost.
- **Cons:** text scanning is not computed geometry — a height introduced via composition (e.g. `Seg`'s original font+padding sizing) is invisible to it, which is why `Seg` needed an explicit `min-height`; regexes over CSS are inherently approximate and must be kept conservative.

### Option 2 — Computed-geometry enforcement in Playwright/Storybook

Measure rendered bounding boxes of every control story and assert ≥ 24px.

- **Pros:** measures what users actually get; catches composition-based undersizing.
- **Cons:** requires a story for every control (several primitives have none), a running Storybook, and minutes of screenshot sweep — far too heavy for the per-commit test lane, and it cannot enforce the *token discipline* (a hardcoded 24px passes geometry but defeats the single source of truth). Retained only as the plan's manual Task 4 visual sweep, not as the gate.

### Option 3 — Ad-hoc bump without tokens or tests

Change the three 22px literals to 24px and move on.

- **Pros:** smallest possible diff.
- **Cons:** values stay scattered, nothing prevents regression, and the next primitive can silently reintroduce the problem — precisely the failure mode that created the issue. Rejected.

## Decision

Option 1 shipped:

1. `client/shared/tokens.css` defines `--control-h-sm: 24px`, `--control-h-md: 28px`, `--control-h-lg: 34px` (the 24px entry annotated with the WCAG clause).
2. `Btn.svelte`, `SegmentedControl.svelte`, and `IconButton.svelte` read the scale instead of literals; `Seg.svelte` gained `min-height: var(--control-h-sm)` — the only behaviorally new constraint.
3. `tests/client/shared/tokens.test.ts` asserts the token names exist; `tests/client/shared/control-target-size.test.ts` carries the scanner, floor, and ratchet tests with an `EXEMPT` map recording reasoned exemptions (`Checkbox`, `EmptyState`, `ErrorState`, `Meter`, and later additions such as `CopyButton`/`DataTable` as the ratchet evolved).
4. Visual verification (Storybook restart, full `bun shoot` sweep, PNG review of primitives and constrained containers) ran once as a manual step; baselines stay gitignored.

## Consequences

### Positive

- Every `sm` control meets the WCAG 2.2 AA 24px floor; `md`/`lg` render identically to before.
- Control height is a one-token change from now on; the ratchet makes adding a hardcoded height a deliberate, reasoned act.
- The guard suite is fast, runs in the standard `bun test:client` lane, and was proven to catch both a lowered floor and a new offender during implementation.
- The token scale has already been reused beyond the original four primitives (e.g. `CopyButton`, `DataTable`), confirming it as the kit's control-height vocabulary.

### Negative

- The guard is lexical, not geometric: it cannot see undersized targets produced by composition, so genuinely novel sizing patterns still need human review.
- The `EXEMPT` map is a small maintenance surface — entries must be added with reasons and pruned when stale (the exact-equality check forces this, which is intentional friction).
- +2px of `sm` growth inside fixed-height containers was a regression risk; the manual Task 4 sweep mitigated it, but constrained containers remain the place to watch when the scale changes.

## References

- Plan: `docs/superpowers/plans/2026-07-31-control-target-size.md`
- Design spec: `docs/superpowers/specs/2026-07-31-control-target-size-design.md`
- Guard: `tests/client/shared/control-target-size.test.ts`
- [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
