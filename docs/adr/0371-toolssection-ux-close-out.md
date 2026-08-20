<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0371: ToolsSection UX Close-Out

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-04)

## Context

`ToolsSection` (`client/settings/sections/ToolsSection.svelte`) — the settings section for per-context tool-permission management (presets, domain/group toggles, per-tool `SegmentedControl`s, clear-admin-defaults) — had five open UX-review findings (`docs/ux-reviews/ToolsSection.md`), all of which this sub-project closed:

1. **`tools-race-permission-during-preset` (Med):** the confirm-bar buttons gated on the `applying`/`clearing` in-flight flags, but three leaf controls — the domain toggle, the group toggle, and the per-tool `SegmentedControl` — did not, so a manual edit could race an in-flight preset apply or defaults clear.
2. **`tools-dual-confirm-bars-overlap` (Low):** the clear-defaults trigger row could render alongside the preset confirm bar, putting two confirmation surfaces on screen at once.
3. **`tools-preset-checkmark-not-decorative` (Low):** the active preset's `✓` was baked into visible button text, so screen readers heard a redundant "check mark" on top of the `aria-pressed` state.
4. **`tools-clear-row-spacing-off-scale` (Low):** two bare `12px` margins sat outside the spacing-token scale.
5. **`tools-clear-trigger-looks-like-text` (Low):** `Btn`'s `ghost` variant renders a transparent background *and* border, so the "Clear admin defaults" trigger read as plain text rather than a control.

Two hard scope constraints shaped every fix: **no shared-primitive changes** (`client/shared/ui/` untouched; every fix local to the section or its `<style>` block) and **no new visual baselines** — the audit floor stayed 467, with exactly one named baseline (`settings-sections-ToolsSection-Preset-applied-1.png`) permitted to change.

## Decision Drivers

- **Tasks are split by expected pixel impact, not finding order.** The four pixel-preserving fixes ran the visual audit **without re-shooting**, so a green audit is real evidence rather than a tautology; only the one visible fix was permitted to overwrite a baseline.
- **One confirmation surface at a time.** The clear trigger yields to the preset bar, not the reverse: the user has just expressed preset intent, so that is the live conversation, and the trigger returns the moment they cancel. This completes a symmetry the code already half-implemented — the clear trigger's own `onClick` already set `pendingPreset = null`.
- **No busy caption on leaf controls.** The confirm bar already announces the in-flight operation centrally; repeating "Saving…" across every tool row would put up to 30 simultaneous captions on screen for one operation. Leaf controls get `disabled` only.
- **Tokenisation consistency with zero visual delta.** `--s3` is defined as `12px` (`client/shared/tokens.css:70`), so moving the two bare margins onto the token could not move a pixel.
- **Pre-existing tests are not edited to pass** — with one deliberate, spec-driven exception: the old test asserting the clear button was *present but disabled* during a preset apply was intentionally invalidated by the one-confirmation-surface fix, and was rewritten to assert absence (a strictly stronger guarantee) plus the trigger's return after the in-flight window.

## Considered Options

### Option 1 — Pixel-impact task split with one absorbing baseline (chosen)

Bundle the four pixel-preserving fixes (leaf-control gating, single confirmation surface, decorative checkmark, spacing tokens) into Task 1 and audit without re-shooting; put the one visible fix (ghost → outline on the clear trigger) in Task 2 as the only task permitted to overwrite a baseline.

- **Pros:** the audit floor is the evidence; exactly one baseline changes; each fix is independently testable; docs close-out cites two commit hashes.
- **Cons:** requires the discipline never to run `bun shoot` to make a failing audit green; one pre-existing test had to be deliberately rewritten.

### Option 2 — Add `busy` captions to the leaf controls

- **Pros:** more feedback per control.
- **Cons:** up to 30 simultaneous "Saving…" captions for one operation; the confirm bar already announces the in-flight state centrally. Rejected in the plan.

### Option 3 — Hide the preset bar while a clear confirmation is open instead of the reverse

- **Pros:** symmetric in the abstract.
- **Cons:** the user has just expressed preset intent, so that is the live conversation; hiding it would discard the in-progress confirmation. Rejected — the clear trigger yields.

### Option 4 — Leave the clear trigger's story coverage hole (no `clearPresetFn` in any story)

- **Pros:** no story diff.
- **Cons:** the outline-border fix would have been invisible in every frame — the guard requires `clearPresetFn !== undefined` and no story passed it, so the trigger had never rendered in any baseline. The finding's own "Where visible: Populated/Grouped screenshots" line was wrong for the same reason. Rejected: the fix must be seen to be verified.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **Leaf-control gating** — the domain toggle (`ToolsSection.svelte:316`), group toggle (`:336`), and per-tool `SegmentedControl` (`:353`) each carry `disabled={applying || clearing}`, matching the gating the confirm-bar buttons already had. No `busy` caption on leaf controls.
2. **One confirmation surface** — the clear-row guard at `:260` gained `&& pendingPreset === null`, so the trigger hides while a preset confirmation is open and returns on cancel.
3. **Decorative checkmark** — `:230` now reads `{#if active}<span aria-hidden="true">✓ </span>{/if}{preset.label}`, so screen readers hear only the `aria-pressed` state; the glyph stays visible to sighted users.
4. **Spacing tokens** — both bare `12px` margins moved to `var(--s3)` (`:462`, `:472`, `:479`); token-identical, no visual delta.
5. **Real button affordance** — the clear trigger switched from `variant="ghost"` to `variant="outline"` (`:263`), matching the domain/group row toggles; the two confirm-bar Cancels stay `ghost` by design.
6. **Story coverage hole closed** — the `Preset applied` story gained `clearPresetFn: clearDefaults` (`ToolsSection.stories.svelte:121,138`) so the trigger actually renders in the frame; the story was not renamed (the baseline filename derives from the story name).
7. **Documentation close-out** — all five findings flipped to `fixed` in `docs/ux-reviews/ToolsSection.md` with hash-cited `Resolved:` lines; rubric dimensions 2, 6, 8, and 9 re-scored `warn` → `pass`; backlog regenerated via `bun run ux:backlog` (never hand-edited).

## Consequences

### Positive

- A manual edit can no longer race an in-flight preset apply or defaults clear; only one confirmation surface is ever on screen.
- The clear trigger is now visibly a control, and — because the story now passes `clearPresetFn` — that affordance is covered by a visual baseline for the first time.
- Screen-reader users hear the preset state exactly once (via `aria-pressed`), not twice.
- Every gap, padding, and margin in the section's stylesheet resolves through the shared token scale.
- Exactly one baseline changed across the whole sub-project; the 467 audit floor held; shared primitives untouched. ToolsSection reached zero open findings.

### Negative

- The `aria-hidden` span wrapper turned out **not** to be pixel-neutral: splitting `✓ ` and the label into two inline runs re-shaped the text, rendering the active preset button ~1px narrower and nudging its neighbours. The pre-re-shoot audit caught it; the glyph, label, and colours were verified identical by reading the diff PNGs, and the change was absorbed into the single baseline Task 2 already re-shot. The plan's original "467/0 at Task 1" expectation was wrong and was amended in place.
- One pre-existing test had to be rewritten to accommodate the single-confirmation-surface fix — a deliberate, documented exception to "never edit a test to pass" that must not be generalised from.
- The plan's checkbox state and expected backlog numbers (18 open) were accurate only at close-out time; subsequent sub-projects moved the backlog further, so the plan document alone is no longer a reliable statement of current state.

### Risks

- **Baseline-absorption fragility**: the `Preset applied` baseline now carries three changes at once (newly-rendered trigger, outline border, ~1px preset-row shift); any future regression in that frame must be read against a busier baseline. Mitigated by having read the changed PNG directly at close-out.
- **Guard-order coupling**: the clear-row guard now depends on four conditions (`clearPresetFn`, `storedDefaults`, `!pendingClear`, `pendingPreset === null`); adding story coverage for new states must respect all four or the trigger silently disappears from frames again.
- **Amended-in-place plans**: the Task 1 Step 8 amendment documents an execution-time discovery; future readers trusting the original 467/0 expectation would misdiagnose a passing run.

## Related Decisions

- **ADR-0362 (ToolsSection UX Open-Findings Fixes)** — the immediately preceding ToolsSection sub-project that closed the earlier tranche of findings; this ADR closes the remainder.
- **ADR-0367 (ReposSection UX Close-Out)** — sibling close-out under the same UX-review program, applying the same pixel-impact task split and read-the-PNG discipline.
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format, `Resolved:`-hash contract, and generated-backlog discipline the close-out task consumed.
- **ADR-0360 (Visual Gate Trustworthiness)** — the "run the audit without re-shooting; read every changed PNG" discipline this plan applied, and the reason the checkmark's 1px shift was caught rather than shot away.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-04-toolssection-close-out.md`; spec: `docs/superpowers/specs/2026-08-04-toolssection-close-out-design.md`.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` `pathIgnorePatterns` makes `bun test tests/client/...` silently discover nothing. Expected final gates per plan: `test:client` 1427/0, `visual:audit` 467/0, backlog parser suite green.
- Two commits: `<T1>` "fix(settings): close four pixel-preserving ToolsSection findings" and `<T2>` "fix(settings): give the Tools clear-defaults trigger a real button affordance", cited in the five `Resolved:` lines.
- The one deliberate test rewrite (Task 1 Step 5) asserts *absence* of the clear trigger during a preset apply — strictly stronger than the old disabled-ness assertion — plus its return after the in-flight window, so the rewrite cannot silently accept a permanently-missing button.
