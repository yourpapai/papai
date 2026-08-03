<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0253: ReleaseSubscriptionSection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-03

## Context

`ReleaseSubscriptionSection` (`client/settings/sections/ReleaseSubscriptionSection.svelte`) — the top-level Personal/Group settings section shipped by ADR-0233 — had five UX-review findings (`docs/ux-reviews/ReleaseSubscriptionSection.md`). It defaulted to a green **Subscribe** CTA before the real subscription state was known (loading was indistinguishable from "unsubscribed"), dead-ended on load errors with a raw backend string and no retry, gave no in-flight feedback on the toggle, crowded its caption with an unspaced mutation error, and relied on an ancestor selector (`.settings-grid :focus-visible`) for its button focus ring rather than carrying it on the primitive.

The design (`docs/superpowers/specs/2026-07-03-release-subscription-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-03-release-subscription-fixes.md`) resolved all five by adopting the render-state conventions already established in sibling sections (the canonical template is `AiOutputSection`: body swaps between `ErrorState` / `Loading…` / content): split the single `error` field into `loadError` (body `ErrorState` + retry) and `actionError` (inline, spaced, `role="alert"`), gate the toggle behind known state, and add two additive, backward-compatible features to the shared `Btn` primitive (a `busy` affordance and an intrinsic `:focus-visible` ring). No change to the fetchers or the announcement backend.

## Decision Drivers

- **Never impersonate the resting CTA.** The green **Subscribe** button must not render until `enabled` is known; the header action slot stays empty during load/error (Finding A).
- **Recoverable load errors, not dead-ends.** A failed load shows the framed `ErrorState` with a working retry; the user is never stranded on a raw string with a disabled toggle (Finding B).
- **In-flight feedback on the toggle.** A busy affordance (`Btn` `busy` prop) plus a label swap to **Subscribing…/Unsubscribing…** while a PATCH is in flight (Finding C).
- **Separate load vs mutation error concerns.** `loadError` takes over the body; `actionError` renders inline below the caption with a real spacing token and `role="alert"`, keeping the toggle enabled for an immediate retry (Finding D).
- **Focus styling travels with the primitive.** Move the `:focus-visible` ring onto `Btn` so it applies in the debug app, admin app, and Storybook — not only where `.settings-grid` happens to be an ancestor (Finding E).
- **Additive-only shared-primitive changes.** Existing `Btn` callers pass no `busy`, so resting appearance is unchanged; the focus ring duplicates the existing token value so there is no visual change where the ancestor ring already applies.
- **Reuse established section conventions.** Mirror `AiOutputSection` rather than inventing new loading/error patterns.

## Considered Options

### Option 1 — loadError/actionError state machine; gate the toggle; `Btn` `busy` + intrinsic focus ring (chosen)

Split `error` into `loadError`/`actionError`; render `ErrorState`+retry on load failure, `Loading…` placeholder while state unknown, caption+inline `actionError` otherwise; gate the toggle on `enabled !== null`; add a `busy` prop (opacity + `pointer-events: none` + `aria-busy` + `onClick` guard) and a `:focus-visible` ring to `Btn`.

- **Pros:** directly resolves all five findings; reuses the `AiOutputSection` pattern already used by 13+ sibling sections; additive `Btn` changes keep the blast radius minimal; busy is visually/semantically distinct from `disabled` (working vs forbidden).
- **Cons:** adds a fourth render state to manage; the toggle's appearance causes a minor layout shift when state resolves.

### Option 2 — Keep a single `error` field; just add retry + a disabled-during-load guard

Leave the one-error-field model, only add a retry button and `disabled={enabled === null}` so the toggle can't be clicked during load.

- **Pros:** smaller diff; no state split.
- **Cons:** rejects the Finding D driver — load and mutation errors need different rendering (body takeover vs inline alert), and a single field cannot express "load failed, hide toggle" vs "mutation failed, keep toggle"; the green CTA would still flash before state is known unless the whole section is gated.

### Option 3 — Per-section busy styling instead of a shared `Btn` prop

Implement the busy affordance locally in `ReleaseSubscriptionSection` rather than adding `busy` to `Btn`.

- **Pros:** no change to the shared primitive; zero blast radius.
- **Cons:** duplicates the existing `IconButton` `busy` affordance rather than reusing it; other sections that later need in-flight feedback would each re-implement it; the focus-ring finding (E) still forces a `Btn` change anyway.

## Decision

The chosen Option 1 shipped in full across the shared primitive, the rewritten section, its tests, the MSW fixtures, the stories, and the visual screenshot spec. What shipped:

1. **`Btn` `busy` affordance (`client/shared/ui/Btn.svelte`).** New `busy?: boolean` prop (default `false`); adds `class:ui-btn--busy`, sets `aria-busy`, and guards `onClick` via a `handleClick` that returns early when busy — so a busy button cannot fire mid-flight.
2. **`Btn` intrinsic focus ring.** A `.ui-btn:focus-visible` rule carries focus styling on the primitive itself.
3. **`ReleaseSubscriptionSection` state machine.** `error` split into `loadError`/`actionError`; `enabled: boolean | null`; `mutating` flag; the toggle lives in the `PageHeader` action snippet and is gated on known state; body renders `ErrorState`+retry on load failure, a `Loading…` placeholder while unknown, or the caption + inline `actionError` otherwise.
4. **In-flight feedback.** `toggle()` sets `mutating = true`; the toggle receives `busy={mutating}` and its label swaps to **Subscribing…/Unsubscribing…** for the duration.
5. **Component test suite (new).** `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts` covers all render states: loading placeholder, subscribed/unsubscribed toggle, load-error `ErrorState`+retry, mutation-error inline alert, and the busy label/`aria-busy` while in flight.
6. **`Btn` test coverage.** Three new tests cover the `ui-btn--busy` class + `aria-busy`, the `onClick` guard while busy, and the presence of the `:focus-visible` ring in source.
7. **MSW fixtures + scenarios.** Two new handler families (`releaseSubscriptionMutatingHandlers` — GET resolves, PATCH never resolves; `releaseSubscriptionMutationErrorHandlers` — GET resolves, PATCH 500) registered as `settings-release-mutating` / `settings-release-mutation-error` scenario keys.
8. **Stories + screenshots.** `Mutating` and `MutationError` stories added; the visual spec re-shoots all states and adds `Mutating — busy toggle` and `MutationError — inline alert` interaction shots.

## Consequences

### Positive

- The green **Subscribe** CTA can never appear before the real subscription state is known — load is now visibly distinct from "unsubscribed" via the `Loading…` placeholder.
- Load failures are recoverable in place: the framed `ErrorState` + retry replaces a raw string and a stuck-disabled toggle.
- The toggle gives clear in-flight feedback (`Subscribing…` + `aria-busy` + dimmed busy affordance) and stays distinct from `disabled`.
- Mutation errors render inline, spaced away from the caption with `role="alert"`, while the toggle remains enabled for an immediate retry.
- The `Btn` focus ring now travels with the primitive into the debug app, admin app, and Storybook, not only inside `.settings-grid`.
- The `Btn` changes are additive and backward-compatible: existing callers pass no `busy` and are visually unchanged.

### Negative

- The section gained a fourth render branch (load error while `enabled` is known — the post-toggle reload case), adding a small amount of conditional complexity beyond the plan's three branches.
- The toggle's appearance after load resolves causes a minor layout shift in the header action slot (accepted by the design).
- The shared `Btn` primitive is touched, so its stories must be re-shot on any future change to confirm additive-only diffs.

### Risks

- **Blast radius of the `Btn` change.** Any future edit to the `busy` or focus-ring rules must re-shoot the shared `Btn` stories and spot-check consuming sections; the focus-ring value is tokenized to stay consistent with the ancestor rule.
- **Inline pass-through of backend mutation errors.** `actionError` surfaces the raw backend message (acceptable because the user triggered the action), which could expose an unhelpful string if the backend message is poor.
- **Post-toggle reload failure is a soft state.** A failed reload after a successful PATCH now keeps the toggle visible with an inline load-error alert rather than a full `ErrorState` takeover — correct for UX, but means the displayed `enabled` value is stale until the next successful load/retry.

## Related Decisions

- **ADR-0233: Release Announcement Subscriptions** — the feature this fixes. ADR-0233 shipped the original single-`error` `ReleaseSubscriptionSection` and noted this `2026-07-03` UX-fixes design as a later, separate layering on top.
- The `AiOutputSection` render-state convention (`ErrorState` / `Loading…` / content) this rewrite mirrors, and the `IconButton` `busy` affordance the `Btn` `busy` prop mirrors.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/ui/Btn.svelte:12-22` | `busy?: boolean` added to the `Props` interface. | `read` confirms. |
| `client/shared/ui/Btn.svelte:32` | `busy = false` destructured default. | `read` confirms. |
| `client/shared/ui/Btn.svelte:36-39` | `handleClick` guards `onClick` while busy (`if (busy) return`). | `read` confirms. |
| `client/shared/ui/Btn.svelte:42-50` | Button markup: `class:ui-btn--busy={busy}`, `aria-busy={busy}`, `onclick={handleClick}`. | `read` confirms. |
| `client/shared/ui/Btn.svelte:70-73` | `.ui-btn.ui-btn--busy { opacity: 0.6; pointer-events: none; }`. | `read` confirms. |
| `client/shared/ui/Btn.svelte:74-77` | `.ui-btn:focus-visible` ring using `var(--focus-ring)` / `var(--focus-ring-offset)` tokens. | `read` confirms. |
| `tests/client/shared/ui/Btn.test.ts:94-102` | `ui-btn--busy` class + `aria-busy` assertion. | `read` confirms. |
| `tests/client/shared/ui/Btn.test.ts:104-121` | `onClick` does not fire while busy. | `read` confirms. |
| `tests/client/shared/ui/Btn.test.ts:123-127` | Source contains `.ui-btn:focus-visible`. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:24-27` | `enabled`/`mutating`/`loadError`/`actionError` state split. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:33-43` | `load()` resets `loadError` (+ `actionError`) and sets `loadError` on failure. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:45-58` | `toggle()` sets `mutating`, clears/resets `actionError`, re-loads on success. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:60-62` | `idleLabel`/`busyLabel`/`showToggle` derived. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:71-83` | Toggle in `PageHeader` action snippet, gated on `showToggle`, `busy={mutating}`, label swap. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:85-92` | `ErrorState`+retry on load failure; `Loading…` placeholder; inline load-error branch when `enabled` known. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:101-105` | Inline `actionError` with `--gap-inline` margin + `role="alert"` (`release-subscription-error`). | `read` confirms. |
| `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts:54-157` | 7 tests: loading, subscribed/unsubscribed, load-error+retry, mutation-error inline alert, post-toggle-reload, busy label/`aria-busy`. | `read` confirms. |
| `client/stories/msw/settings-handlers-personal-2.ts:82-95` | `releaseSubscriptionMutatingHandlers` + `releaseSubscriptionMutationErrorHandlers` exports. | `read` confirms. |
| `client/stories/msw/scenarios.ts:45-46` | Both handler families imported. | `grep` confirms. |
| `client/stories/msw/scenarios.ts:231-232` | `settings-release-mutating` / `settings-release-mutation-error` scenario keys registered. | `grep` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.stories.svelte:29-31` | `Mutating` + `MutationError` stories. | `read` confirms. |
| `tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts:30-38` | Auto-screenshot tests for `Mutating` + `MutationError` states. | `read` confirms. |
| `tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts:72-84` | `Mutating — busy toggle` + `MutationError — inline alert` interaction shots. | `read` confirms. |

Plan-vs-implementation notes:

- **A fourth render branch handles post-toggle reload failure.** The plan specified three mutually exclusive branches (`loadError` → `ErrorState` takeover, `enabled === null` → `Loading…`, else → caption + `actionError`). Shipped adds a fourth: when `loadError !== null && enabled !== null` (a successful PATCH whose follow-up reload GET fails), the toggle stays visible and an inline `release-subscription-load-error` alert renders above the caption instead of a full `ErrorState` takeover. This avoids losing the toggle — and the just-changed `enabled` value — behind a body-level error frame. The `toggle()` path re-loads on success, so this is the common reload-failure path; a fresh load error (before `enabled` is known) still produces the `ErrorState` takeover.
- **`showToggle` is `enabled !== null` only.** The plan gated the toggle on `enabled !== null && loadError === null`. Shipped gates on `enabled !== null` alone (a `$derived`), because the loadError branch is now mutually exclusive with the reload case above. Net effect: the toggle remains interactive during a post-toggle reload failure, matching the new branch.
- **`load()` also clears `actionError`.** The plan's `load()` reset only `loadError`. Shipped resets both `loadError` and `actionError` at the top of `load()`, so a successful retry after a mutation error clears the stale inline alert.
- **The `Btn` focus ring is tokenized.** The plan/spec hardcoded `outline: 2px solid rgba(82, 224, 138, 0.4); outline-offset: 1px;`. Shipped uses `outline: var(--focus-ring); outline-offset: var(--focus-ring-offset);` — the same token values the `.settings-grid` ancestor rule uses — keeping the ring consistent with the rest of the app and conflict-free where both rules apply.
- **The `Btn` busy rule uses two-class specificity and drops `cursor: progress`.** Shipped is `.ui-btn.ui-btn--busy { opacity: 0.6; pointer-events: none; }` (the plan's `.ui-btn--busy` also specified `cursor: progress`). `pointer-events: none` already prevents interaction, so `cursor: progress` is redundant; opacity matches the plan's 0.6.
- **The MSW handlers file was split/renamed.** The plan edited `client/stories/msw/settings-handlers-personal.ts`; the two new handler families live in `client/stories/msw/settings-handlers-personal-2.ts`, and `scenarios.ts` imports them from there. Intent unchanged; the split happened alongside/after this plan.
- **The component test suite gained helpers and a seventh test.** The plan's six tests shipped verbatim in intent, plus `respondByMethod`/`reloadFailureMock` helpers and a seventh test ("a failed post-toggle reload keeps the toggle, no full ErrorState takeover") covering the divergence above. The `Btn` busy/focus-visible tests shipped verbatim.

The source plan `docs/superpowers/plans/2026-07-03-release-subscription-fixes.md` and design `docs/superpowers/specs/2026-07-03-release-subscription-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
