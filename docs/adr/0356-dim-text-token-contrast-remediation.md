<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0356: Dim Text Token Contrast Remediation — Token-Level Retune with Test-Enforced WCAG 4.5:1 Gate

## Status

Accepted

## Date

2026-08-02

## Context

The design system's dim text tokens in `client/shared/tokens.css` rendered below the WCAG 2.1 AA SC 1.4.3 (Contrast, Minimum) floor of 4.5:1. `--text-dim` was `#6b766e`, measuring 3.43–4.15:1 across the five surface tokens, and `--fg4` was `#3a4248` at 1.58–1.92:1 — below even the 3:1 non-text floor. The defect sat in the token values themselves, which meant all 110 dim-text call sites were simultaneously illegible, and simultaneously fixable by four value changes. Nothing in the test suite measured contrast, so the tokens shipped below the floor and stayed there. The design is in `docs/superpowers/specs/2026-08-02-token-contrast-remediation-design.md`; the implementation plan is `docs/superpowers/plans/2026-08-02-token-contrast-remediation.md`.

## Decision Drivers

- **Apply the 4.5:1 floor flat.** Every `--fg3`/`--fg4` call site renders text at 10–12px, so the WCAG large-text (3:1) exemption would be a loophole no real site could use — the gate must not encode it.
- **Fix the token, not the call sites.** All 110 call sites correctly ask for "the dim text color"; the color was illegible. A call-site sweep would leave the broken value in the token file for the next author.
- **Guard by test, not by convention.** A parser-based test must assert every text token against every surface token numerically, because code review demonstrably let a 1.58:1 foreground ship.
- **Keep aliases, don't sweep.** `--fg3`, `--fg4`, and `--fg-hint` become `var(--text-dim)` aliases rather than being deleted or replaced at call sites — `tests/client/shared/tokens.test.ts:49` asserts `--fg3:`/`--fg4:` presence, and alias deletion is a separate pixel-neutral cycle whose whole value is producing zero screenshot diffs.
- **Accept the screenshot churn deliberately.** The value change alters every baseline containing dim text; a written visual audit (pass/fail partition, diff-image sampling, hierarchy judgment) must precede re-baselining so a green suite still means something.

## Considered Options

### Option 1 — Retune token values + alias consolidation + parser-based contrast gate (chosen)

Set `--text-dim` to `#828d84` (4.70:1 on `--surface-hover`, 5.69:1 on `--bg`), make `--fg3`/`--fg4`/`--fg-hint` resolve to it via `var(--text-dim)`, and add `tests/client/shared/token-contrast.test.ts` that parses `tokens.css`, follows `var()` alias chains to hex literals, and asserts the 40 text×surface pairs against a flat 4.5:1 floor using the WCAG relative-luminance formula.

- **Pros:** four line changes fix all 110 call sites; the gate is fast, runs in the standard `bun test:client` lane, and self-documents the text/surface contract (adding a text token means adding it to the test — that is the point); sRGB linearization is computed exactly per the WCAG definition, with a negative test proving `resolve()` fails loudly on undeclared tokens; the expected failure count (15 of 41) and ratios were predicted and verified before touching tokens, validating the parser.
- **Cons:** regex parsing of CSS is approximate and the TEXT/SURFACE lists are a manually maintained contract; the retune knowingly inverts `KV.svelte`'s `dim` prop into an inert no-op (`dim ? var(--fg4) : var(--fg3)` picks the same color either way), left as-is to keep the diff clean and recorded as follow-up; every screenshot with dim text must be re-baselined.

### Option 2 — Fix contrast at the 110 call sites

Replace dim-token usages with a compliant color component by component.

- **Pros:** no new test infrastructure needed.
- **Cons:** leaves the broken value in `tokens.css` for the next author to reuse; a 110-file diff blurs review and screenshot attribution; duplicates the same correction 110 times. Rejected — if a fix edits `.svelte` files, it is outside the plan's scope by design.

### Option 3 — Computed-contrast enforcement via Playwright/Storybook

Render components and measure actual foreground/background pixel pairs.

- **Pros:** measures what users actually get, including composition effects.
- **Cons:** requires stories, a running Storybook, and a minutes-long sweep — far too heavy for the per-commit lane — and cannot enforce the token discipline (a hardcoded compliant color passes rendering but defeats the single source of truth). Retained only as the plan's Task 2 manual visual audit, not as the gate.

## Decision

Option 1 shipped:

1. `client/shared/tokens.css:21` sets `--text-dim: #828d84` annotated with its measured ratios and the WCAG clause.
2. `--fg4` and `--fg-hint` became `var(--text-dim)` aliases (with comments recording the former value's defect); `--fg3` was already an alias and inherited the new value untouched.
3. `tests/client/shared/token-contrast.test.ts` gates WCAG 2.1 AA SC 1.4.3 flat at 4.5:1: 40 text×surface pairs plus a `resolve()` error-contract test, 41 tests total, verified failing (15 failures at the predicted ratios) before the retune and passing (41/41) after.
4. A visual audit (strict-suite failure partition, three passes verified dim-text-free, diff-image samples across all four SPAs showing color-only change, hierarchy judgment of muted vs. dim) preceded `bun shoot` re-baselining; baselines stay gitignored.
5. `tests/client/shared/tokens.test.ts` passed untouched — the alias declarations survive, so its `--fg3:`/`--fg4:` presence assertions still hold.

## Consequences

### Positive

- Every dim-text call site meets the WCAG 2.1 AA 4.5:1 floor on all five surfaces with one source of truth; future retunes are one-line edits re-verified by the gate.
- The contrast gate runs in the standard client test lane at unit-test speed and was proven to catch the defect (it failed at exactly the predicted ratios before the fix).
- The TEXT/SURFACE lists make adding a text token a deliberate, tested act — the closed-contract pattern established by ADR-0344's ratchet extends to color.
- The audit-first re-baseline kept the screenshot suite meaningful: passes were proven dim-text-free and diffs proven color-only before baselines moved.

### Negative

- `KV.svelte`'s `dim` prop became inert — the plan accepted this knowingly to keep the token change's diff clean; the prop was later removed in the follow-up alias-deletion cycle (commit `cc4d40804`).
- The alias cycle deferred by this plan (`--fg3`/`--fg4`/`--fg-hint` deletion) left a layer of redundant indirection in `tokens.css` until the follow-up landed.
- The gate's CSS parsing is lexical: it resolves `var()` chains and hex literals only, so a token defined via non-hex color functions would need parser extensions.
- The 4.70:1 headroom on `--surface-hover` is thin; any future darkening of surface tokens re-trips the gate by design, forcing the pairing to be reconsidered together.

## References

- Plan: `docs/superpowers/plans/2026-08-02-token-contrast-remediation.md`
- Design spec: `docs/superpowers/specs/2026-08-02-token-contrast-remediation-design.md`
- Gate: `tests/client/shared/token-contrast.test.ts`
- Tokens: `client/shared/tokens.css`
- Implementation commit: `ca47dbb7a` ("fix(a11y): raise dim text tokens above the 4.5:1 contrast floor")
- Follow-up alias deletion: `cc4d40804`
- Related: ADR-0344 (control-height token scale with test-enforced WCAG floor)
- [WCAG 2.1 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
