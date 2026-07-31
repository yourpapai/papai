<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0258: Identity Section UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-06

## Context

`IdentitySection` (`client/settings/sections/IdentitySection.svelte`) — the per-user onboarding surface that links a chat account to a task-provider identity — scored 4 `fail` / 3 `warn` / 2 `pass` in its UX review (`docs/ux-reviews/IdentitySection.md`). The failures clustered around feedback/state and design-system consistency: a destructive **Clear** with no affordance or confirmation (H1), no in-flight feedback on Save/Clear (H2), an unguided first-run form (H3), late/misplaced validation (M1), hand-rolled error/empty markup instead of the shared primitives (M2), an editable form rendered over a load failure (M3), plus four lower-severity polish findings (full-bleed inputs L1, error/label collision L2, a11y announcement L3, Clear offered when nothing to clear L4).

The design (`docs/superpowers/specs/2026-07-06-identity-section-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-06-identity-section-ux-fixes.md`) resolved all ten by adopting **Approach B**: replace the ad-hoc `{#if notice}{:else if error}…` render ladder with one derived, mutually-exclusive `view` (`loading | gated | loadError | form`) plus transient overlay flags (`saving`, `clearing`, `confirmingClear`, `validationError`, `saveError`, `saved`), and add a backward-compatible `error` prop to the shared `Field`/`Input` primitives so inline field validation works app-wide. Feedback is verified through the Storybook screenshot harness plus an existing component unit test the plan/spec had not accounted for.

## Decision Drivers

- **Unambiguous render state.** One derived `view` discriminant (not a flag ladder) so load-vs-save errors are structurally distinct — load errors replace the form via `ErrorState`, mutation/validation errors stay inline with the form intact (Findings M1, M2, M3, L2).
- **Destructive Clear must be gated + confirmed.** Clear becomes `variant="danger"` and opens the shared `Confirm` modal; it renders only when a mapping exists (Findings H1, L4).
- **In-flight feedback on every async action.** `saving`/`clearing` flags drive `busy`+`disabled` on Save and on the modal confirm (Finding H2), mirroring `ReleaseSubscriptionSection` (ADR-0253).
- **Guided first-run.** Intro line, per-field `hint`s, and input `placeholder`s turn the empty mapping into a fill-in form rather than a dead end (Finding H3).
- **Inline validation at the field.** Provider-user-ID is `required`; the validation message renders under it through a new shared `Field` `error` prop wired into `Input` via `aria-invalid`/`aria-describedby` + a danger border (Findings M1, L3).
- **Adopt shared primitives.** `ErrorState` (loadError), `EmptyState` (gated), `Confirm` (clear) replace hand-rolled markup (Finding M2).
- **Constrain input width.** Section-scoped `max-width` (~520px) on the identity form only — not the shared `.settings-form` (Finding L1).
- **Additive-only shared-primitive change.** Existing `Field`/`Input` callers omit `error`, so their appearance is unchanged; every section gains inline field validation for free.

## Considered Options

### Option 1 — derived `view` discriminant + transient overlay flags; shared `Field` `error` prop (chosen)

Replace the render ladder with one `$derived view` (`loading | gated | loadError | form`); keep transient flags that overlay only the `form` view; split the single `error` into `loadError` (body `ErrorState` + retry) vs `saveError`/`validationError` (inline); add a backward-compatible `error` prop to `Field` that publishes `{ errorId, invalid }` into a new context channel consumed by `Input`.

- **Pros:** resolves all ten findings; makes rendering unambiguous and load-vs-save errors distinct by construction; the `Field`/`Input` change is additive and app-wide reusable; keeps the work in the single component (no YAGNI extraction).
- **Cons:** adds a fourth render branch (`gated`) and a second error field to manage; touches the shared `Field`/`Input` primitives, so their stories must be re-shot on future changes.

### Option 2 — minimal flags on the existing render ladder

Keep the `{#if notice}{:else if error}{:else if loading}{:else}form` ladder, only add a confirm modal, busy flags, and an inline validation line.

- **Pros:** smaller diff; no state-machine rework; no shared-primitive change.
- **Cons:** leaves render logic ad-hoc and makes the load-vs-save error split easy to get wrong (the M3 form-over-load-error class regresses); inline validation either needs per-section markup or a shared-primitive change anyway, so the `Field` work is not avoided.

### Option 3 — extract an `IdentityForm` subcomponent + state module

Lift the form and its state into a dedicated child component and a state module.

- **Pros:** cleanest separation; form state is unit-testable in isolation.
- **Cons:** over-engineered — there is no second consumer of the form; one extra file and indirection for a single ~260-line section; the load/gated/error branches still live in the parent, so the view-model work is not avoided.

## Decision

The chosen Option 1 shipped in full across the shared primitives, the rewritten section, its MSW fixtures, the stories, the visual screenshot spec, and the pre-existing component unit test. What shipped:

1. **`field-context.ts` error channel (`client/shared/ui/field-context.ts`).** A second `Symbol`-keyed context (`FIELD_ERROR`) carrying `{ errorId, invalid }`, exposed via `setFieldError`/`getFieldError` — separate from the existing label-id channel so `Select.svelte` is untouched.
2. **`Field` `error` prop (`client/shared/ui/Field.svelte`).** New optional `error?: string`; when set, renders `<span class="ui-field__error" id={errorId} role="alert">` below the control and publishes `errorId` + a reactive `invalid` getter into context; falls back to `hint` when no error.
3. **`Input` invalid wiring (`client/shared/ui/Input.svelte`).** Reads the error context; derives `invalid`/`describedBy`; adds `class:ui-input--invalid`, `aria-invalid`, and `aria-describedby` to both `<input>` and `<textarea>`, plus a `.ui-input--invalid` danger-border rule.
4. **`IdentitySection` view model (`client/settings/sections/IdentitySection.svelte`).** Single derived `view` (`loading | gated | loadError | form`); `loadError` split from `saveError`; transient `saving`/`clearing`/`confirmingClear`/`validationError`/`saved` flags; `Clear` is `variant="danger"` and gated on `hasMapping`; `Confirm` modal with `danger`/`busy={clearing}`; intro line + per-field hints + placeholders; section-scoped `max-width: 520px` form.
5. **In-flight feedback.** Save receives `busy={saving}`/`disabled={saving}` and swaps its label to **Saving…**; the modal confirm receives `busy={clearing}`; the header Refresh icon shows `busy={loading}`.
6. **Inline validation.** `save()` sets `validationError` (no network call) when Provider-user-ID is empty; rendered inline via `Field` `error={validationError}`.
7. **MSW fixture + scenario.** `identityGatedHandlers` (HTTP 422 "no task instance configured") registered as the `settings-identity-gated` scenario key.
8. **Stories + screenshots.** `Gated` story added to `IdentitySection.stories.svelte`; an `Invalid` story added to `Field.stories.svelte`; the visual spec gains a `Gated` auto-screenshot and three manual interaction shots (narrow 640, validation-error, clear-confirm-open).
9. **Component unit test (pre-existing, updated).** `tests/client/settings/sections/IdentitySection.test.ts` — its 422 case was updated to assert the gated `EmptyState` copy; the suite stays green at 6 tests.

## Consequences

### Positive

- Load failures no longer show an editable form: `loadError` renders `ErrorState` with retry in place of the form (M3/L2 fixed by construction).
- The destructive Clear is visually danger-styled, confirmed via modal, and absent when there is nothing to clear (H1/L4).
- Every async action gives in-flight feedback (`Saving…` + `aria-busy` + dimmed affordance; modal confirm busy; refresh icon busy) and stays distinct from `disabled`-for-validation.
- First-run is a guided fill-in form (intro + hints + placeholders) instead of a dead end.
- Inline validation renders directly under the offending field with `role="alert"`, `aria-invalid`, and `aria-describedby`, and never reaches the network on an empty required field.
- The `Field`/`Input` changes are additive and backward-compatible: every section gains inline field validation for free; existing callers omitting `error` are visually unchanged.
- Input width is constrained to ~520px so short identity values no longer stretch full-bleed.

### Negative

- The section gained a fourth render branch (`gated`) and a third error field (`clearError`) beyond the plan's `loadError`/`saveError` split, adding conditional complexity.
- The shared `Field`/`Input` primitives are touched, so their stories must be re-shot on any future change to confirm additive-only diffs.
- `.storybook-shots/` baselines are gitignored local artifacts, so the visual states are verified locally/in CI runs rather than reviewed as committed images.

### Risks

- **Blast radius of the shared-primitive change.** Any future edit to the `Field` `error` prop or the `Input` invalid wiring must re-shoot the shared `Field` stories and spot-check consuming sections; the danger border uses the existing `--danger` token to stay consistent.
- **Inline surfacing of backend mutation errors.** `saveError`/`clearError` surface the raw backend message (acceptable because the user triggered the action), which could expose an unhelpful string if the backend message is poor.
- **Gated detection is substring-based.** `view === 'gated'` keys off `loadError.includes('no task instance')` rather than the HTTP 422 status (a fetcher-layer change, explicitly out of scope); a backend wording change would regress the gated branch to a generic `loadError`.

## Related Decisions

- **UX review source** — `docs/ux-reviews/IdentitySection.md` (the 10 findings this resolves).
- **ADR-0249: Confirm-Dialog Retrofit and Schema Dedup** — shipped the shared `Confirm` primitive this section adopts for the destructive clear.
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — established the `busy`+`disabled` in-flight pattern and the `loadError`/`actionError` split mirrored here.
- The sibling settings-section UX-fix batch (ADR-0248 Profile, 0250 Group Provider, 0251 GuestMode, 0252 Members, 0253 Release Subscription) whose shared-primitive conventions (`ErrorState`/`EmptyState`/`Confirm`/`PageHeader`/`IconButton` busy) this section converges on.
- The `Field` label-context work (`setFieldLabelId`/`getFieldLabelId`) this change extends with a parallel error channel.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/ui/field-context.ts:20-37` | `FIELD_ERROR` symbol, `FieldErrorContext`, `setFieldError`/`getFieldError`. | `read` confirms. |
| `client/shared/ui/Field.svelte:20` | `error?: string` added to `Props`. | `read` confirms. |
| `client/shared/ui/Field.svelte:27-34` | `errorId` derived; `setFieldError` with reactive `invalid` getter. | `read` confirms. |
| `client/shared/ui/Field.svelte:42-43` | `ui-field__error` span with `role="alert"` when `error` set. | `read` confirms. |
| `client/shared/ui/Field.svelte:69-72` | `.ui-field__error { color: var(--danger); }` style. | `read` confirms. |
| `client/shared/ui/Input.svelte:9` | `getFieldError` imported alongside `getFieldLabelId`. | `read` confirms. |
| `client/shared/ui/Input.svelte:38-40` | `fieldError`, `invalid`, `describedBy` derived. | `read` confirms. |
| `client/shared/ui/Input.svelte:48-52` | wrapper `class:ui-input--invalid={invalid}`. | `read` confirms. |
| `client/shared/ui/Input.svelte:60-61, 76-77` | `aria-invalid`/`aria-describedby` on `<textarea>` and `<input>`. | `read` confirms. |
| `client/shared/ui/Input.svelte:97-99` | `.ui-input--invalid { border-color: var(--danger); }`. | `read` confirms. |
| `client/shared/ui/Field.stories.svelte:26-27` | `Invalid` story exercising `Field` `error` + `Input`. | `read` confirms. |
| `tests/visual/shared/ui/Field.spec.ts:20-23` | `Invalid` auto-screenshot test. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:24-38` | state split: `data`/`loadError`/`loading` + `saving`/`clearing`/`confirmingClear`/`validationError`/`saveError`/`clearError`/`saved`. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:44-52` | derived `view` (`loading`/`gated`/`loadError`/`form`). | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:62-80` | `load()` resets all errors; stale-response guard (`if (id !== contextId) return`). | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:84-92` | silent `refresh()` for post-mutation reload (errors ignored). | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:94-113` | `save()` re-entrancy guard (`if (saving) return`) + inline validation + `refresh` on success. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:115-132` | `openClear()` (resets `clearError`) + `confirmClear()` with `clearError` capture. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:151-164` | `loading`/`gated`/`loadError` render branches. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:165-214` | `form` branch: intro + three `Field`s + Save/Clear + status region. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:200-207` | Save `busy={saving}`/`disabled={saving}`, Clear `variant="danger"` gated on `hasMapping`. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:211-213` | status lines carry `role="alert"` (error) / `role="status"` (success). | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:217-233` | `Confirm` modal (`danger`, `busy={clearing}`) with inline `clearError` in body. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:242-244` | section-scoped `.identity-form { max-width: 520px; }`. | `read` confirms. |
| `client/settings/sections/IdentitySection.svelte:252-260` | scoped `.settings-empty-link` rule for the gated `EmptyState` action. | `read` confirms. |
| `client/stories/msw/settings-handlers-personal.ts:293-298` | `identityGatedHandlers` (HTTP 422 "no task instance configured"). | `read` confirms. |
| `client/stories/msw/scenarios.ts:50` | `identityGatedHandlers` imported. | `grep` confirms. |
| `client/stories/msw/scenarios.ts:226` | `settings-identity-gated` scenario key registered. | `grep` confirms. |
| `client/settings/sections/IdentitySection.stories.svelte:29-30` | `Gated` story. | `read` confirms. |
| `tests/visual/settings/sections/IdentitySection.spec.ts:30-33` | `Gated` auto-screenshot test. | `read` confirms. |
| `tests/visual/settings/sections/IdentitySection.spec.ts:37-56` | manual states: narrow 640, validation-error, clear-confirm-open. | `read` confirms. |
| `tests/client/settings/sections/IdentitySection.test.ts:52-62` | 422 gated asserts "No task provider configured" / "Configure task provider"; no Save button. | `read` confirms. |
| `tests/client/settings/sections/IdentitySection.test.ts:64-92` | empty Provider-user-ID shows inline error and makes no network call. | `read` confirms. |
| `tests/client/settings/sections/IdentitySection.test.ts:94-113` | null mapping renders empty fill-in form. | `read` confirms. |

Plan-vs-implementation notes:

- **`clearError` split from `saveError`.** The plan's task code used a single `saveError` for both PUT and DELETE failures and closed the `Confirm` modal on a failed delete. Shipped adds a separate `clearError` (`IdentitySection.svelte:37`): a failed delete keeps the modal open and renders the error inside the modal body (`IdentitySection.svelte:231-232`), matching `MembersSection`. A dedicated `openClear()` helper resets `clearError` before opening.
- **Post-save uses a silent `refresh()` instead of `load()`.** The plan's `save()` called `load(contextId)` after a successful PUT, which would blank the form on a reload failure and hide the "Identity saved." confirmation. Shipped introduces `refresh()` (`IdentitySection.svelte:84-92`) that silently ignores reload failures, so a background refresh failure cannot clobber a successful save.
- **Stale-response guards.** `load()` and `refresh()` both early-return (`if (id !== contextId) return`) when a response arrives for a previous `contextId`, mirroring `MembersSection`/`CodingIdentitySection`; prevents a slow response for an old context from clobbering a newer one. Not in the plan's task code.
- **`save()` re-entrancy guard.** `if (saving) return` at the top of `save()` prevents a double-submit while a PUT is in flight. Not in the plan's task code.
- **Status a11y uses explicit roles.** The plan's task code put `aria-live="polite"` on the status container. Shipped instead gives the error line `role="alert"` and the success line `role="status"` (`IdentitySection.svelte:211-212`) — stronger semantics for assistive tech.
- **`.settings-empty-link` scoped style added.** The plan rendered the gated `EmptyState` action as `<a class="settings-empty-link">` expecting it to inherit `ProfileSection`'s rule, but Svelte styles are component-scoped, so a local `.settings-empty-link` rule was added to `IdentitySection.svelte` (`252-260`). This landed as a follow-up commit (`fix(settings): style the gated empty-state link in IdentitySection`).
- **`Input.svelte` preserves `onBlur` and uses `$derived`.** The plan's rewrite snippet for `Input` omitted the existing `onBlur` wiring and used inline `fieldError?.invalid` expressions; shipped keeps `onblur={onBlur}` on both controls and factors `invalid`/`describedBy` into `$derived` values — functionally equivalent and avoids regressing blur handling.
- **A component unit test already existed.** The plan/spec assumed the section was visual-only; `tests/client/settings/sections/IdentitySection.test.ts` pre-existed. Its 422 case was updated to assert the new gated `EmptyState` copy and stays green (6 tests).
- **`.storybook-shots/` is gitignored.** The plan's per-task `git add .storybook-shots/...` lines were dropped during execution; screenshot baselines are local/CI artifacts, not committed images.
- **MSW handler landed later in the file than the plan's line hint.** The plan inserted the gated handler "after line 192"; it shipped at `settings-handlers-personal.ts:293-298` because the file grew. Intent unchanged.

The source plan `docs/superpowers/plans/2026-07-06-identity-section-ux-fixes.md` and design `docs/superpowers/specs/2026-07-06-identity-section-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
