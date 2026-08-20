<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0369: Shared Primitives and TaskProviderSection UX Close-Out

## Status

Accepted

## Date

2026-08-08 (plan dated 2026-08-04)

## Context

Three open UX-review findings shared a dependency shape that forced them into one sub-project: two were anchored in shared UI primitives (`client/shared/ui/Secret.svelte`, `client/shared/ui/SegmentedControl.svelte`) and one at the `TaskProviderSection` call site. Closing them took `TaskProviderSection` to 0 open and dropped the generated backlog from 26 to 23 open findings at close-out time.

1. **`task-provider-empty-secret-blank-pill` (Med):** the TaskProvider `Bound` story fixture set `hasValue: true` with `value: ''`, rendering a blank masked pill. That state is **unreachable in production** — `maskSensitiveValue` (`src/config.ts:144-146`) always returns `` `****${value.slice(-4)}` ``, never empty, and all three routes feeding `ConfigFieldRow` gate on non-empty raw input before masking. The fixture fabricated the state.
2. **`ai-output-toggle-no-feedback` (Low):** `ConfigFieldRow.saveEnum` passed only `disabled={saving}` to `SegmentedControl`, so an in-flight save dimmed the control to `opacity: 0.5` — indistinguishable from a merely-disabled control and invisible to assistive tech. A segmented control cannot borrow the text-field Save button's `Saving…` label swap because its labels *are* its values.
3. **`task-provider-summary-list-no-inset` (Low):** in the provision-reveal shot, revealed `SummaryList` values terminated flush against the viewport edge while sibling `ConfigFieldRow` cards inset their content. `.settings-provision__reveal` was an entirely unstyled `<div>`.

Two hard constraints shaped the fixes: `client/shared/ui/SummaryList.svelte` must not be modified (five of its six consumers are debug detail panels already padded by `DebugDetailRail`'s `.debug-detail-rail__body`; padding the primitive would double-pad five correct consumers to fix one broken one), and `client/settings/lib/mask-secret.ts` must not be modified (it stays a pure string normalizer; the guard belongs in `Secret.svelte` so all six `Secret` consumers inherit it). Exactly one new visual baseline was permitted (audit floor 466 → 467).

## Decision Drivers

- **Primitives change before call sites.** A primitive change moves many sections' screenshot baselines at once and would invalidate any section work already verified, so `Secret` and `SegmentedControl` landed first, then the section-local inset fix, then documentation close-out.
- **The audit floor is the contract.** Exactly one new baseline (`SegmentedControl` `Busy`) was added; a second story would have put the audit at 468 and contradicted the spec. The story lives at the primitive because an in-flight MSW frame is not deterministically screenshottable through `AiOutputSection`, whereas a `busy: true` arg is.
- **No new placeholder glyph.** `Secret.svelte` already declared `value = '••••••••'`; a second variant would make two `Secret` renderings disagree about what a stored secret looks like.
- **Alignment, not pixel counts.** The inset acceptance criterion is that revealed values' right edge lines up with the sibling `Clear` button's right edge, using `var(--gap-inline)` — hand-tuned one-off px values were forbidden because matching the token scale is the point of the finding.
- **A green audit after re-shoot proves nothing.** `bun shoot` passes `--update-snapshots=all`, so every changed PNG had to be read and described; `bun run visual:audit` unfiltered (comparing against committed baselines) was the only run that counted as evidence the shell wrapper didn't move other consumers.
- **The fixture correction is not prettification.** The standing rule forbids prettifying fixtures to hide defects; this was the mirror case — the fixture fabricated a state no server route can emit. The distinction is written into the finding's `Resolved:` text so a future reader does not infer the server once emitted blank secrets.

## Considered Options

### Option 1 — Primitive guard + busy prop with shell wrapper + call-site inset (chosen)

`Secret` gains a one-branch `$derived` guard (`value === '' ? PLACEHOLDER : value`) falling back to its own existing default; the fixture is corrected to the server-shaped `'****WvfQ'`. `SegmentedControl` gains an optional `busy?: boolean` (default `false`) that wraps the radiogroup in a `.ui-seg-shell` and renders a `Saving…` caption sibling plus `aria-busy="true"`; `ConfigFieldRow` passes `busy={saving}` alongside the existing `disabled={saving}`. `TaskProviderSection` gives `.settings-provision__reveal` `padding-inline: var(--gap-inline)`.

- **Pros:** closes all three findings; the guard and busy prop live in primitives so every consumer inherits them; `busy` defaults off so the three other `SegmentedControl` consumers are untouched; the caption needs no `prefers-reduced-motion` fallback, is deterministic to screenshot, and reaches screen-reader users via `aria-busy`.
- **Cons:** the guard fires on a state production cannot reach (deliberate defense-in-depth, documented as such); the shell wrapper changes `SegmentedControl`'s outer DOM shape, which is why the unfiltered audit against untouched baselines was mandatory evidence.

### Option 2 — Put the empty-string guard in `mask-secret.ts` instead of `Secret.svelte`

- **Pros:** fixes it once at the data layer.
- **Cons:** `mask-secret.ts` is a pure string normalizer and would stop being one; only some `Secret` consumers pass through it, so the other consumers would keep the blank-pill hazard. Rejected.

### Option 3 — Pad `SummaryList.svelte` itself

- **Pros:** fixes the inset at the primitive for all consumers.
- **Cons:** five of six consumers already receive `padding: 12px 14px` from `DebugDetailRail`'s body; padding the primitive double-pads five correct consumers to fix one broken one. Rejected — the fix lands at the call site.

### Option 4 — Pulsing accent animation for the busy state (the finding's own suggestion)

- **Pros:** visually distinct from disabled.
- **Cons:** needs a `prefers-reduced-motion` fallback, is not deterministic to screenshot, and an opacity/color animation alone never reaches screen-reader users. The static `Saving…` caption plus `aria-busy` was chosen instead, reusing the wording the text-field Save button already uses.

## Decision

Option 1 shipped. What landed (verified against the tree):

1. **`Secret` guard + fixture correction** (`df4f8d620`) — `Secret.svelte:9,17,22` declares `PLACEHOLDER = '••••••••'`, defaults `value` to it, and derives `shown = value === '' ? PLACEHOLDER : value`; the value span renders `{shown}` (`:26`). A Svelte prop default fires only for `undefined`, so the explicit `''` from `maskSecret` had slipped past it. The fixture (`settings-handlers-task-provider.ts:34`) now carries `'****WvfQ'` with a comment recording why the previous `''` was impossible.
2. **`SegmentedControl` busy state** (`0f3c311bc`) — `busy?: boolean` (default `false`) added to `Props` (`SegmentedControl.svelte:19,29`); the radiogroup is wrapped in `.ui-seg-shell` (`:41`) with `aria-busy={busy ? 'true' : undefined}` (`:47`); `{#if busy}<span class="ui-seg__busy">Saving…</span>{/if}` renders as a sibling (`:64`) styled in dim 11px mono (`:73`). `busy` is presentational plus aria only — `disabled` still carries all behavioural blocking, and `onKey` gates on `disabled` alone. `client/shared/ui/Seg.svelte` (a separate primitive sharing the `.ui-seg` class prefix) was explicitly untouched.
3. **`ConfigFieldRow` wiring** (`5f68a5013`) — `busy={saving}` passed to `SegmentedControl` immediately after the existing `disabled={saving}` (`ConfigFieldRow.svelte:165`); nothing else changed because `saveEnum` already manages `saving` in its `finally` block.
4. **Busy-frame baseline** (`b1418687b`) — `client/shared/ui/SegmentedControl.stories.svelte` created with exactly one story (`Busy`); `tests/visual/shared/ui/SegmentedControl.spec.ts` generated by `bun run shoot:gen` plus the manual `pinDefaultViewport()` line every sibling carries; out-of-scope generator churn in seven unrelated specs was reverted with `git restore`. Audit floor moved 466 → 467.
5. **Provision-reveal inset** (`94769094e`) — `.settings-provision__reveal { padding-inline: var(--gap-inline); }` added to `TaskProviderSection.svelte:199`, the same 12px token the sibling cards use via `SettingsFieldShell.svelte:81`. Alignment with the `Clear` button's right edge was verified by reading the re-shot PNG, not by pixel assertion.
6. **Documentation close-out** (`f6105bd52`) — all three findings flipped to `fixed` with hash-cited `Resolved:` lines (`ai-output-toggle-no-feedback` cites both `0f3c311bc` and `5f68a5013` because the prop and its wiring are separate commits); scorecard dimensions 4 and 8 in `TaskProviderSection.md` and dimension 9 in `AiOutputSection.md` re-scored to `pass`; backlog regenerated via `bun run ux:backlog` (never hand-edited) to 23 open. `debug-icon-buttons-control-height` stayed `open` — its `superseded` recommendation was carved out of spec approval and had not been signed off.

## Consequences

### Positive

- `TaskProviderSection` reached 0 open findings; the backlog dropped 26 → 23 at close-out.
- All six `Secret` consumers now render a visible masked pill for any falsy-but-present value, with no new glyph and no change to `mask-secret.ts`'s purity.
- An in-flight enum save is now distinguishable from a merely-disabled control and is announced to assistive tech; the busy frame is pinned by a deterministic primitive-level baseline.
- The `SegmentedControl` shell wrapper was proven not to move any of the three other consumers' pixels by an unfiltered audit against untouched baselines — real evidence, not a tautology.
- The fixture now reflects a server-shaped value, and the finding's `Resolved:` text records the route analysis so no future reader reasons from the false premise that the server emitted blank secrets.

### Negative

- `SegmentedControl`'s outer DOM gained a wrapper element; any future test asserting the control is a direct child of its parent will break against the shell.
- The `Secret` guard defends against a state no route can currently emit, which is only justified by the documentation that accompanies it — without the `Resolved:` text it would read as a fix for an imaginary bug.
- The plan file's 46 checkboxes were never ticked during execution, so the plan document alone is not a reliable statement of progress; the git history is.
- The backlog's expected counts (23 open, per-section rows) were accurate only at close-out; subsequent sub-projects moved the backlog further.

### Risks

- **`busy` as second-class state:** a future consumer could pass `busy` without `disabled` and produce a control that announces busy but stays interactive. Mitigated by the test `busy alone does not block interaction — only disabled does`, which pins the semantics deliberately.
- **Baseline-scoping fragility:** the single-story file exists to hold the audit floor at 467; adding a `Default` story later is a deliberate audit-floor decision, not a casual addition.
- **Caption wording drift:** `Saving…` is now duplicated between the text-field Save button and `SegmentedControl`; a rename in one place should be mirrored in the other.

## Related Decisions

- **ADR-0352 (Shared Primitive Accessibility)** — the earlier shared-primitive hardening program this sub-project's primitive-first ordering follows.
- **ADR-0356 (Dim Text Token Contrast Remediation)** — sibling UX-remediation work touching the same token vocabulary (`--text-dim`, `--gap-inline`, `--gap-tight`).
- **ADR-0359 (UX Findings Backlog)** — the stable-id findings format, `Resolved:`-hash contract, and generated-backlog discipline the close-out task consumed.
- **ADR-0360 (Visual Gate Trustworthiness)** — the "read every changed PNG; a green audit after re-shoot is not evidence; unfiltered audit is the only gate" discipline applied per-task.
- **ADR-0367 (ReposSection UX Close-Out)** — the contrasting sibling under the same program: ReposSection required zero shared-primitive churn, while this sub-project was defined by two primitive changes.

## Implementation Notes

- Plan: `docs/superpowers/plans/2026-08-04-shared-primitives-and-task-provider.md`; spec: `docs/superpowers/specs/2026-08-04-shared-primitives-and-task-provider-design.md`.
- Branch `ui-ux-review-01`; no merge, no push; PR #212 untouched.
- Client tests run via `bun run test:client` only — `bunfig.toml:8` `pathIgnorePatterns` makes `bun test tests/client/...` silently discover nothing.
- A `d24ff6b11` follow-up corrected a line citation and the busy-prop commit attribution in the docs, after the close-out commit.
- Test counts added: `Secret.test.ts` +2 (5 total), `SegmentedControl.test.ts` +3 (14 total), `ConfigFieldRow.test.ts` +1; backlog parser test 21/21.
