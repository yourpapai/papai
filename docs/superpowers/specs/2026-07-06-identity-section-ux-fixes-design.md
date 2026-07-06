<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — IdentitySection UX fixes

**Date:** 2026-07-06
**Source review:** [`docs/ux-reviews/IdentitySection.md`](../../ux-reviews/IdentitySection.md)
**Target:** `client/settings/sections/IdentitySection.svelte` (+ shared `Field`/`Input`/`field-context`)
**Scope:** all 10 review findings (3 High, 3 Med, 4 Low)

## Problem

`IdentitySection` links a user's chat account to their task-provider identity — the per-user
onboarding surface without which the bot can't attribute tasks. The UX review scored it 4
`fail` / 3 `warn` / 2 `pass`. The failures cluster around feedback/state and design-system
consistency: a destructive "Clear" with no affordance or confirmation, no in-flight feedback
on async actions, an unguided first-run form, late/misplaced validation, and hand-rolled
error/empty markup instead of the shared state primitives.

## Approach (chosen: B — explicit view discriminant + transient overlay flags)

Replace the ad-hoc `{#if notice}{:else if error}{:else if loading}{:else}form` ladder with one
derived, mutually-exclusive full-section `view`, plus independent transient flags that overlay
the `form` view. This keeps the work in the single ~129-line component (no new files — approach
C's extraction is YAGNI for one section) while making rendering unambiguous and resolving the
load-vs-save error findings by construction.

Rejected alternatives:

- **A (minimal flags on the existing ladder):** smaller diff but leaves render logic ad-hoc and
  makes the load-vs-save error split easy to get wrong.
- **C (extract `IdentityForm` subcomponent + state module):** over-engineered; no second consumer.

### View model

```
view (derived, mutually exclusive):
  'loading'   → loading && no data yet             → "Loading…" placeholder (unchanged)
  'gated'     → load failed w/ "no task instance"  → <EmptyState> + "Configure task provider →"
  'loadError' → load failed, any other reason      → <ErrorState message onRetry>  (replaces form)
  'form'      → data present                        → the editable form

transient flags (only meaningful in 'form'):
  saving          → Save busy + disabled
  clearing        → Confirm modal confirm busy
  confirmingClear → Confirm modal open
  validationError → inline under the Provider-user-ID field (string | null)
  saveError       → inline near the actions; network failure on PUT/DELETE keeps the form (string | null)
  saved           → transient "Identity saved." near the actions (boolean)
```

The current single `error` variable splits into **`loadError`** (replaces the form via
`ErrorState`) versus **`saveError` / `validationError`** (inline, form stays). This is the
structural fix for M3 (form shown over a load error) and M1 (validation misplaced), and it
removes L2 (error colliding with the first field label) because load errors no longer render
above the form.

The `gated` case is the genuine dead-end (context has no task instance, so there is no provider
to map against); it is distinct from a `form` with `data.mapping === null`, which is a normal
first-run fill-in form and must keep its inputs.

## Finding-by-finding fix map

| #   | Finding                                    | Fix                                                                                                                                             |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Clear: no affordance / no confirmation     | Clear becomes `variant="danger"`; click opens `shared/Confirm.svelte` (`danger`, `busy={clearing}`), mirroring `MembersSection`.                |
| H2  | No in-flight feedback on Save / Clear      | `saving` / `clearing` flags drive `busy`+`disabled` on Save and the modal confirm (pattern: `ReleaseSubscriptionSection`).                      |
| H3  | First-run form is an unguided dead end     | Intro line + per-field `hint`s + input `placeholder`s (see Microcopy).                                                                          |
| M1  | Validation late and far from the field     | Mark Provider-user-ID `required`; render the message inline under it via the new `Field` `error` prop.                                          |
| M2  | Diverges from shared primitives            | Adopt `ErrorState` (loadError), `EmptyState` (gated), `Confirm` (clear).                                                                        |
| M3  | Editable form shown over a load failure    | `loadError` view renders `ErrorState` with retry in place of the form.                                                                          |
| L1  | Inputs stretch full-bleed                  | Section-scoped `max-width` (~520px) on the identity form only — **not** the shared `.settings-form`.                                            |
| L2  | Error line collides with first field label | Resolved by M3; remaining inline status gets `--gap-field` spacing from the form.                                                               |
| L3  | Validation not announced to assistive tech | `ErrorState` already has `role="alert"`; `Field` error + inline save status get `aria-live`/`role="alert"` + `aria-invalid`/`aria-describedby`. |
| L4  | Clear offered when nothing to clear        | Render Clear only when `data.mapping` is non-null.                                                                                              |

## Component-level changes

### `client/settings/sections/IdentitySection.svelte`

- Introduce the derived `view` and the transient flags above.
- `save()`: set `validationError` inline (not a section-top error) when Provider-user-ID is
  empty; set `saving` for the request window; on failure set `saveError` and keep the form; on
  success set `saved` and reload. Guard against double-submit while `saving`.
- `clear()`: gate behind `confirmingClear`; the actual delete runs from the modal's confirm with
  `clearing` busy.
- Render branches by `view`; the `form` branch renders intro, three `Field`s (Provider-user-ID
  `required`, with `error={validationError}`), Save (`busy`/`disabled={saving}`), and Clear
  (`variant="danger"`, only when `data.mapping !== null`) plus the `Confirm` modal and the
  inline `saveError` / `saved` status region (`aria-live="polite"`).

### Shared `Field` error prop (backward-compatible)

- `client/shared/ui/field-context.ts`: the context value carries `{ labelId, errorId?, invalid }`
  instead of a bare `labelId`.
- `client/shared/ui/Field.svelte`: new optional `error?: string`. When set, render
  `<span class="ui-field__error" id={errorId} role="alert">{error}</span>` below the control and
  publish `errorId` + `invalid = true` into context.
- `client/shared/ui/Input.svelte`: read `errorId` / `invalid` from context; set `aria-invalid`
  and `aria-describedby` on the `<input>`/`<textarea>`, plus an optional danger-border class.

All existing `Field` usages omit `error`, so behavior is unchanged for them; this gives every
section inline field validation for free.

## Microcopy (draft — subject to review)

`<Provider>` = `data.providerName` (e.g. "Kaneo", "YouTrack").

- **Intro:** "Link your chat account to your `<Provider>` account so the bot can create and assign tasks as you."
- **Provider user ID** (required) — hint: "Your account ID in `<Provider>` — from your tracker profile or user URL." · placeholder: `e.g. 42`
- **Provider login** — hint: "Your `<Provider>` username, if different from the ID." · placeholder: `e.g. alice`
- **Display name** — hint: "Name shown on tasks the bot creates for you." · placeholder: `e.g. Alice`
- **Gated `EmptyState`** — title: "No task provider configured" · hint: "Assign a task provider to this context before linking your identity." · action: "Configure task provider →" (`href="#task-provider"`, per `ProfileSection`)
- **Clear `Confirm`** — title: "Clear identity?" · body: "This removes the link between your chat account and `<Provider>`. The bot will stop acting as you until you set it again." · confirm: "Clear" (danger)
- **Validation:** "Provider user ID is required."

## Styling

- Section-scoped `max-width` (~520px) on the identity form (local class in the component's
  `<style>`, not the shared `.settings-form`), so short identity values don't sit in a
  full-viewport-width input.
- Inline `saveError` / `saved` status sits below the actions with `--gap-field` separation.

## Testing

- **Fixtures:** add a `settings-identity-gated` MSW scenario (HTTP 422 "no task instance
  configured") in `client/stories/msw/scenarios.ts` (new `identityHandlers.gated`) to drive the
  gated `EmptyState`. The existing `settings-identity-error` scenario now drives the `loadError`
  `ErrorState`.
- **Stories:** add a **Gated** story; add a `Field` error-variant story so the shared change is
  screenshot-covered.
- **Visual spec** (`tests/visual/settings/sections/IdentitySection.spec.ts`): add manual states —
  gated, validation-error (inline), saving (busy Save), Clear-confirm-open, and danger-Clear at
  rest — at desktop + 640px where relevant.
- **Behavioral tests:** a component unit test already exists at
  `tests/client/settings/sections/IdentitySection.test.ts` — its "no task instance (422)" case must
  be updated to assert the new gated `EmptyState` copy, and the file must stay green.

## Non-goals

- Mapping metadata (`matchMethod` / `confidence` / `matchedAt`) stays hidden — surfacing it is
  beyond the review findings.
- Shared 10px uppercase field-label sizing is unchanged — altering it is a cross-section
  design-system decision, not part of this fix.
- Keying the `gated` detection off the HTTP 422 status instead of the error-message substring is
  a nice robustness improvement but out of scope (would require a fetcher-layer change); the
  existing substring check is retained.

## Affected files

- `client/settings/sections/IdentitySection.svelte` (rework)
- `client/shared/ui/Field.svelte`, `client/shared/ui/Input.svelte`, `client/shared/ui/field-context.ts` (error prop)
- `client/settings/sections/IdentitySection.stories.svelte` (+ Gated story), `Field` stories (+ error variant)
- `tests/visual/settings/sections/IdentitySection.spec.ts` (+ manual states) and `client/stories/msw/scenarios.ts` (+ `settings-identity-gated`)
