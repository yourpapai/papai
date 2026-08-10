<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0370: Shared `settings.css` Central Fixes — Token Status Margins, Placeholder Measure Cap, and Subgrid Form Layout

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-04)

## Context

Three open UX-review findings traced back to shared rules in `client/settings/settings.css` rather than to any individual section component:

1. **`release-subscription-error-text-spacing` (Low):** `.status-error`/`.status-success` were colour-only, so a `<p class="status-error">` took the browser's UA default margin (`1em` top and bottom), shifting its section's layout by an unstyled amount whenever a status line appeared or disappeared.
2. **`code-host-setup-hint-unbounded-measure` (reported Med, re-scoped Low):** `.placeholder` set only `color: var(--text-muted)` and was used 139 times across 36 files, including prose paragraphs with no reading-measure constraint. The reported "~1230px unbroken line" symptom was later established not to reproduce in the shipped app — `CodeHostSection` renders inside `.settings-group` (capped at `--content-max`, 760px); the measurement was an artifact of Storybook rendering the section standalone. The surviving defect is the narrower one: 760px of 11px text is still ~100 characters per line.
3. **`members-add-form-alignment-inert` (Low):** `.settings-form` was `display: flex; flex-wrap: wrap; align-items: end`, so a submit `<Btn>` bottom-aligned to the bottom of a neighbouring field's *hint text* rather than to the input it belongs to — visibly low in `MembersSection`, `IdentitySection` and `AdminUsersSection` alike. The same form also escaped the section's right padding, with the button's right edge on the viewport edge.

Two structural facts shaped the decision. First, these rules have large blast radii (139 `.placeholder` consumers, 12 `.settings-form` consumers, 47 `Field` usages across 19 files), so fixing only the reported call sites would leave every latent instance in place. Second, `.settings-form` alignment could not be fixed by any `align-items` value, because sibling items carry different sub-content (label / control / optional hint); shared grid tracks were the only mechanism that aligns a button to the *control* track.

Additionally, the `Field` primitive's children slot is not guaranteed to emit exactly one element (`ReposSection`'s egress field emits two), which would push the hint/error out of its track under a subgrid layout.

## Decision Drivers

- **Fix the shared rule, not the call site.** A defect whose root cause lives in a 139-consumer shared class is corrected once, centrally, so every latent instance is fixed rather than only the reported one.
- **`.status-error` and `.status-success` move together.** They render in the same slots; giving only one a token margin would make an error and a success message space differently in the same position — a new inconsistency created by the fix.
- **Reuse existing tokens.** `--gap-inline` (12px) is what `.settings-section__action-error` already used locally; `--content-max` (760px) is what `.settings-group` uses. No new token, no hardcoded px.
- **The audit floor is the evidence.** The manifest technique: run the non-mutating `visual:audit` *before* re-shooting, so its failure list enumerates exactly which baselines a shared-CSS change moves while the baselines are still pre-change originals; then re-shoot, read every manifest PNG, and confirm the audit returns to 467/0. A green audit obtained by re-shooting is a tautology, not evidence.
- **Prove pixel-neutrality separately.** The `Field` control wrapper shipped first with `display: contents` and ran the audit against *untouched* baselines — a green result proves neutrality, and a wrapper regression cannot hide inside the subgrid change's expected churn.
- **One control row, not three field rows.** The subgrid conversion only requires `.ui-field__control` to always be present, single, and second; `Field` renders hint *or* error *or* neither, so the field spans three parent tracks and may leave the third empty.
- **Delete flex-era overrides rather than layering.** `ReposSection`'s `align-items: start` / `flex: 1 1 180px` and `MembersSection`'s `.members-add :global(.ui-field) { flex: 1 }` became dead CSS once the grid's `minmax(180px, 1fr)` track superseded them; stale comments asserting removed behaviour are worse than none.

## Considered Options

### Option 1 — Central shared-rule fixes + Field control wrapper + subgrid conversion (chosen)

Give `.status-error`/`.status-success` `margin: var(--gap-inline) 0 0`; give `.placeholder` `max-width: var(--content-max)`; wrap `Field`'s children slot in a `.ui-field__control` element (`display: contents` first, promoted to `display: block`); convert `.settings-form` to a three-track grid (`repeat(auto-fit, minmax(180px, 1fr))` × `auto auto auto`) with fields adopting the tracks via `grid-template-rows: subgrid; grid-row: span 3`, and non-field children spanning label+control only (`grid-row: span 2; align-self: end; justify-self: start`); delete the flex-era section overrides.

- **Pros:** closes all three findings and every latent instance; uniform `1fr` columns make sizing consistent across all 12 settings forms; the button lands level with its input at both desktop and ~640px widths; both findings' residues (right-padding escape and baseline) resolved by the same mechanism.
- **Cons:** a large re-baseline manifest (every `.settings-form` consumer moves); field widths change in all 12 forms, which must be treated as intended; depends on CSS subgrid support in the pinned Playwright Chromium (verified, 1.61.1 ≫ Chromium 117).

### Option 2 — Per-call-site fixes

Patch only `ReleaseSubscriptionSection`'s status line, `CodeHostSection`'s hint, and `MembersSection`'s add row.

- **Pros:** minimal blast radius; almost no re-baselining.
- **Cons:** leaves the identical defect latent in every other consumer; three section-local fixes to maintain where one shared rule suffices; contradicts the program's "fix centrally" goal.

### Option 3 — Flex-only alignment tweaks

Adjust `align-items`, per-item margins, or a hardcoded negative offset to lift the button.

- **Pros:** no layout-mode change; smaller manifest.
- **Cons:** no `align-items` value aligns to the control when siblings carry different sub-content; a hardcoded offset breaks when the hint wraps or font metrics change — explicitly rejected as an unacceptable fallback.

### Option 4 — Absolute `grid-row: 2` for buttons

Pin non-field children to the second grid row instead of `grid-row: span 2`.

- **Pros:** simpler mental model.
- **Cons:** pins the button to the first row-set and breaks when the form wraps at narrow widths; `span 2` survives wrapping.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **Status-text token margin** (`07007a48b`) — `.status-error` and `.status-success` both carry `margin: var(--gap-inline) 0 0` (`client/settings/settings.css:107-114`); both changed together so the two message kinds occupy identical space in the same slot.
2. **Placeholder measure cap** (`238e59b72`) — `.placeholder` carries `max-width: var(--content-max)` (`client/settings/settings.css:117-120`), the same cap `.settings-group` uses, rather than a new token or hardcoded value.
3. **Field control wrapper** (`83358fd64`) — the children slot sits inside `<div class="ui-field__control">` (`client/shared/ui/Field.svelte:49`), initially `display: contents`; the visual audit ran against untouched baselines and passed 467/0, proving the wrapper moved no pixels.
4. **Subgrid conversion** (`3f7cf5a60`) — `.settings-form` is now a grid with three shared tracks (`settings.css:43-57`); `.ui-field` adopts them via `grid-template-rows: subgrid; grid-row: span 3` (`Field.svelte:59-65`); `.ui-field__control` promoted to `display: block; min-width: 0` (`:68-71`); non-field children span only label+control and sit at the bottom of the control track; the flex-era overrides in `ReposSection.svelte` (`:361-363`, margin only) and `MembersSection.svelte` (deleted) were removed as dead CSS. Both Members residues — the escaped right padding and the button's baseline — were confirmed resolved from the re-shot PNGs.
5. **Documentation close-out** — all three findings flipped to `fixed` with hash-cited `Resolved:` lines in `docs/ux-reviews/{ReleaseSubscriptionSection,CodeHostSection,MembersSection}.md`; the code-host finding re-scoped Med → Low with a `- **Correction:**` line recording that the ~1230px symptom was a standalone-Storybook artifact; rubric rows re-scored; `_BACKLOG.md` regenerated via `bun run ux:backlog` (never hand-edited).

## Consequences

### Positive

- Three shared-rule defects and every latent instance closed centrally; no section-local copies of the fix to drift.
- Status lines no longer shift their section by the UA default when appearing/disappearing; error and success messages space identically in the same slot.
- Placeholder prose wraps at the measure of the column that usually contains it.
- Submit buttons in all 12 settings forms align level with their inputs instead of below a neighbour's hint; the Members add row's button sits inside the section padding at both captured widths.
- The `Field` children slot can emit any number of elements without breaking the three-track layout; the wrapper's pixel-neutrality was proven against untouched baselines before the subgrid change consumed it.
- The manifest technique now bounds the blast radius of shared-CSS changes honestly: every moved baseline was enumerated before re-shooting and read as a PNG.

### Negative

- `.ui-field` now depends on a grid parent to be fully correct; outside a `.settings-form` grid, `grid-template-rows: subgrid` is invalid and falls back to independent auto rows — visually the same stack as before, but the coupling is implicit.
- Field widths changed in all 12 forms at once; intended, but it produced the plan's largest re-baseline manifest and any future width regression hides among many expected diffs.
- `bun shoot`'s pre-existing non-determinism (baselines refreshed beyond what a change can affect, under 6-worker parallelism) means manifest entries occasionally need an explicit "not my change" check recorded in the task report.

### Risks

- **Subgrid support in non-Playwright browsers**: subgrid shipped in Chromium 117 / Firefox 71 / Safari 16; settings UI consumers on older browsers get the independent-auto-rows fallback (acceptable degradation). Verified in pinned Playwright 1.61.1.
- **New non-field children in forms**: any future `.settings-form` child that is not a `.ui-field` inherits `grid-row: span 2; align-self: end; justify-self: start`, which may be wrong for e.g. a full-width notice; such additions must be checked against the layout, not just appended.
- **Narrow-width wrapping**: `span 2` survives wrapping, but if a future form shows a button misplaced at ~640px, the named fallback (wrapping form actions in their own element across 12 forms) is a markup change requiring its own decision — not an improvisation.

## Related Decisions

- **ADR-0360 (Visual Gate Trustworthiness)** — the manifest technique and "read every changed PNG; a green audit after re-shoot is not evidence" discipline applied per-task here.
- **ADR-0359 (UX Findings Backlog)** — the stable-id format, `Resolved:`-hash contract, and generated-backlog discipline the close-out consumed (this ADR's sub-project closed three such findings).
- **ADR-0367 (ReposSection UX Close-Out)** — sibling sub-project whose hard constraint *not* to touch shared `settings.css` rules carved this work out; this ADR is that deferred central fix. Its egress preview (`e6c8f7ec3`) is the two-element children slot that motivated the `Field` wrapper.
- **ADR-0369 (Shared Primitives and TaskProviderSection Close-Out)** — companion close-out under the same UX-review program.
- **ADR-0256 / ADR-0265 (BYOK Settings Field Shell; Field Shell Polish)** — the `Field` primitive lineage this change extends.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-04-shared-settings-css-central-fixes.md` (self-contained; no separate spec/design document is referenced).
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Tests: `tests/client/settings/settings-css.test.ts` gained text assertions for the three shared rules (spacing-token margin, measure cap, grid tracks); `tests/client/shared/ui/field-context.test.ts` gained three per-state DOM assertions for `.ui-field__control` (present, single, second child under hint / error / neither).
- Client tests run via `bun run test:client` only — `bunfig.toml:8` `pathIgnorePatterns` makes `bun test tests/client/...` silently discover nothing. Audit floor held at 467 baselines throughout; no story renamed, no baseline orphaned.
- The CodeHost finding's `Correction:` line is the durable record that Storybook standalone renders do not inherit `.settings-group`'s width cap — evaluate future width findings against the shipped shell, not the isolated story.
