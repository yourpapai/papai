<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — IdentitySection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/IdentitySection.svelte`
**States captured:** Populated, Empty, Error, Loading, Gated · Empty-validation-error, Populated-clear-confirm-open · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Header rhythm is consistent; the destructive action now carries a colored border/text and no longer collides with the error state.  |
| 2. Affordance & signifiers      | pass  | "Clear" is `variant="danger"` with a red border/text at rest — visibly distinct from Save and from a plain ghost/secondary control.  |
| 3. Consistency w/ design system | pass  | Now imports and renders `ErrorState`, `EmptyState`, and `Confirm`, matching the pattern used by sibling sections.                    |
| 4. Feedback & state             | pass  | Busy/disabled Save with "Saving…" label, Clear gated behind `Confirm` (busy "Working…"), dedicated error state for load failures.    |
| 5. Content & language           | pass  | Intro line explains what linking does; every field carries a `hint` and a concrete `placeholder` example.                            |
| 6. Accessibility                | pass  | Validation renders through `Field`'s `role="alert"` error span, with `aria-invalid`/`aria-describedby` wired on the input.           |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px (fields stack full-width); long values fit without overflow.                                               |
| 8. Spacing, alignment & sizing  | pass  | `.identity-form`/`.identity-intro` cap at `max-width: 520px`; the load-error state replaces the form instead of overlapping it.      |
| 9. Interaction & micro-states   | pass  | Save shows `busy`/`disabled` + "Saving…"; the destructive path is gated behind `Confirm`, which itself shows a busy "Working…" state.|

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Destructive "Clear" has no affordance and no confirmation

- **Id:** identity-clear-no-confirmation
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` ("fix(settings): rework IdentitySection state model, feedback, and guidance", 2026-07-06) — Clear is now `variant="danger"` (`IdentitySection.svelte:204`) and opens the shared `Confirm` dialog (`openClear` at `:115`, `<Confirm>` at `:217-233`) which itself danger-styles the confirm action and shows a busy "Working…" label (`Confirm.svelte:33-35`) before `deleteIdentity` runs.
- **Dimension:** 2. Affordance & signifiers (also 4. Feedback & state)
- **Where visible:** Populated — clear confirm open (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-—-manual-Populated-—-clear-confirm-open-1.png`) shows the modal with a red "Clear" action and dimmed background.
- **Suggested fix:** N/A — resolved.

### [High] No in-flight feedback on Save / Clear (double-submit risk)

- **Id:** identity-save-clear-no-feedback
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — Save now passes `busy={saving} disabled={saving}` and renders "Saving…" (`IdentitySection.svelte:200-201`); `save()` guards re-entry with `if (saving) return` (`:95`). Clear opens `Confirm`, whose confirm button is `disabled={busy}` and shows "Working…" while `confirmClear()` runs (`Confirm.svelte:33-35`, `IdentitySection.svelte:120-132`).
- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** not a single frame; confirmed from source (`Btn.svelte:44-56` renders `aria-busy` and disables via `handleClick`'s busy guard).
- **Suggested fix:** N/A — resolved.

### [High] First-run / empty form is an unguided dead end

- **Id:** identity-empty-form-no-guidance
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — an intro paragraph now precedes the form (`IdentitySection.svelte:165-167`, `.identity-intro`), and every `Field` carries a `hint` plus the `Input` carries a `placeholder` (`:175-198`, e.g. `hint={\`Your account ID in ${providerName}…\`}` and `placeholder="e.g. 42"`).
- **Dimension:** 5. Content & language
- **Where visible:** Empty (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Empty-1.png`) shows the intro line and greyed placeholder text in all three fields.
- **Suggested fix:** N/A — resolved.

### [Med] Validation is late and shown far from the field

- **Id:** identity-validation-far-from-field
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — the "Provider user ID" `Field` is now `required` and receives `error={validationError ?? undefined}` (`IdentitySection.svelte:176-179`), and `Field.svelte:50` renders that error inline directly beneath the input via `role="alert"`, not at the top of the section.
- **Dimension:** 4. Feedback & state
- **Where visible:** Empty — validation error (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-—-manual-Empty-—-validation-error-1.png`) shows "Provider user ID is required." directly under the red-outlined input, with the label carrying the required `*`.
- **Suggested fix:** N/A — resolved.

### [Med] Diverges from shared state primitives used by sibling sections

- **Id:** identity-diverges-from-shared-primitives
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — the component now imports and uses `Confirm`, `EmptyState`, and `ErrorState` (`IdentitySection.svelte:9, 11-12`), rendering `EmptyState` for the gated (no task provider) case (`:154-161`) and `ErrorState` for a load failure (`:163`), matching sibling sections.
- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Error (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Error-1.png`) shows the framed `ErrorState` card with icon, message, and "Try again"; Gated (`…-Gated-1.png`) shows the `EmptyState` card.
- **Suggested fix:** N/A — resolved.

### [Med] Editable form is shown on top of a load failure

- **Id:** identity-editable-form-over-load-failure
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — the view is now a derived state machine (`IdentitySection.svelte:44-52`: `'form' | 'gated' | 'loadError' | 'loading'`); on `loadError` only `ErrorState` renders (`:162-163`), the form markup sits in the `{:else}` branch (`:164` onward) and is not reachable while `data` is null.
- **Dimension:** 4. Feedback & state
- **Where visible:** Error (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Error-1.png`) shows only the error card, no form beneath it.
- **Suggested fix:** N/A — resolved.

### [Low] Inputs stretch full-bleed with no max-width

- **Id:** identity-inputs-no-max-width
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — `.identity-form` and `.identity-intro` now cap at `max-width: 520px` (`IdentitySection.svelte:237, 243`).
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Populated-1.png`) shows the form and inputs constrained to roughly a third of the 1280px viewport rather than full-bleed.
- **Suggested fix:** N/A — resolved.

### [Low] Error line collides with the first field label

- **Id:** identity-error-collides-with-label
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — the load-error path no longer renders the form at all (see `identity-editable-form-over-load-failure`), so there is nothing for the message to collide with; `ErrorState.svelte` renders the message inside its own card layout.
- **Dimension:** 8. Spacing, alignment & sizing (also 1. Visual hierarchy)
- **Where visible:** Error (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Error-1.png`) shows clear vertical spacing between the icon, title, message, and retry button, with no form label anywhere on screen.
- **Suggested fix:** N/A — resolved.

### [Low] Validation error is not announced to assistive tech

- **Id:** identity-validation-not-announced
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` (`Field` primitive) — the error span now renders with `role="alert"` (`client/shared/ui/Field.svelte:50`), and the associated `Input` sets `aria-invalid` and `aria-describedby` pointing at that error id (`client/shared/ui/Input.svelte:63, 65, 81, 83`) via `useFieldInvalid()`/`field-context.js`.
- **Dimension:** 6. Accessibility
- **Where visible:** Empty — validation error (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-—-manual-Empty-—-validation-error-1.png`); confirmed from `Field.svelte`/`Input.svelte` source, not inferable from the screenshot alone.
- **Suggested fix:** N/A — resolved.

### [Low] "Clear" is offered when there is nothing to clear

- **Id:** identity-clear-offered-when-empty
- **Status:** fixed
- **Resolved:** `c1e4a3bbe` — the Clear button is now wrapped in `{#if hasMapping}` (`IdentitySection.svelte:203-207`), where `hasMapping` is `$derived(data?.mapping != null)` (`:42`).
- **Dimension:** 4. Feedback & state
- **Where visible:** Empty (`.storybook-shots/settings/sections/IdentitySection.spec.ts/settings-sections-IdentitySection-Empty-1.png`) shows only the "Save" button, no Clear.
- **Suggested fix:** N/A — resolved.
