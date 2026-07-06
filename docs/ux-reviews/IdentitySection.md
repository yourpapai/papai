<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — IdentitySection

**Date:** 2026-07-06
**Reviewed:** `client/settings/sections/IdentitySection.svelte`
**States captured:** Populated, Empty, Error, Loading, Clear-hover, user-id focus-within, long-value · desktop (1280) + narrow (640)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Header rhythm is right, but the destructive action carries no visual weight and the error text collides with the first field label. |
| 2. Affordance & signifiers      | fail  | The destructive "Clear" is a ghost button that reads as static grey text at rest — no signifier until hover.                        |
| 3. Consistency w/ design system | fail  | Rolls its own inline error/empty markup and skips `ErrorState`/`EmptyState`/`Confirm`/`busy` that sibling sections use.             |
| 4. Feedback & state             | fail  | No in-flight feedback, late/misplaced validation, destructive delete with no confirm, editable form shown over a load error.        |
| 5. Content & language           | fail  | First-run form is an unguided dead end: three jargon labels, no placeholder/hint/help, no next step.                                |
| 6. Accessibility                | warn  | Real semantics + focus rings exist, but validation is color-only tiny text with no live region; required field not marked.          |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px (fields stack full-width); long values fit without overflow.                                               |
| 8. Spacing, alignment & sizing  | warn  | Inputs stretch full-bleed with no max-width; error line has no separation from the form.                                            |
| 9. Interaction & micro-states   | fail  | Save/Clear give no busy state during the async round-trip — dead frozen control, double-submit possible.                            |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Destructive "Clear" has no affordance and no confirmation

- **Dimension:** 2. Affordance & signifiers (also 4. Feedback & state)
- **Where visible:** Populated (Clear reads as plain grey text next to Save); Empty — Clear hover (only hover reveals a raised background)
- **Source:** `client/settings/sections/IdentitySection.svelte:125` (`variant="ghost"`, `onClick={() => void clear()}`) → `clear()` at `:70`
- **Suggested fix:** Give the delete a `danger` variant so it reads as interactive and destructive, and gate it behind the shared `shared/Confirm.svelte` dialog that sibling sections (Members, Memory, CodingCredentials) already use — one stray click currently deletes the identity mapping irreversibly.

### [High] No in-flight feedback on Save / Clear (double-submit risk)

- **Dimension:** 9. Interaction & micro-states (also 4. Feedback & state)
- **Where visible:** not capturable as a single frame — `save()`/`clear()` are async but neither button is disabled or `busy` during the request
- **Source:** `client/settings/sections/IdentitySection.svelte:124-125` (no `busy`/`disabled`); `save()` `:54`, `clear()` `:70`
- **Suggested fix:** Track a pending flag and pass `busy`/`disabled` to the buttons (with a "Saving…" label), matching the established pattern in `ReleaseSubscriptionSection.svelte:76` and `GroupProviderSection.svelte:97`.

### [High] First-run / empty form is an unguided dead end

- **Dimension:** 5. Content & language
- **Where visible:** Empty (three blank fields, no guidance); Error (same blank form under a raw message)
- **Source:** `client/settings/sections/IdentitySection.svelte:109-123` — `Field`/`Input` render with no `hint`, no `placeholder`, and no intro copy
- **Suggested fix:** Add field hints/placeholders and a one-line intro explaining what "Provider user ID" is and where to find it — both `Field` (`hint`) and `Input` (`placeholder`) already support this; this section is the per-user onboarding surface, so a bare form blocks first-time setup.

### [Med] Validation is late and shown far from the field

- **Dimension:** 4. Feedback & state
- **Where visible:** triggered on submit with an empty required field — message renders at the top of the section (`status-error`), not next to the input
- **Source:** `client/settings/sections/IdentitySection.svelte:57-59` (required check in `save()`) and `:97` (error printed at section top); the "Provider user ID" `Field` at `:109` is not marked `required`
- **Suggested fix:** Mark the field `required` (the `Field` primitive renders the asterisk) and surface the validation message inline beneath that input rather than only at the top after a failed submit.

### [Med] Diverges from shared state primitives used by sibling sections

- **Dimension:** 3. Consistency w/ design system
- **Where visible:** Error (custom inline `status-error` paragraph vs. the framed `ErrorState` card); Empty (bare form vs. `EmptyState`)
- **Source:** `client/settings/sections/IdentitySection.svelte:97-98` inline status paragraphs; no `ErrorState`/`EmptyState`/`Confirm` imports — contrast the sibling `AiOutputSection.svelte:10-11` which uses both
- **Suggested fix:** Adopt the shared `ErrorState`/`EmptyState` components (and `Confirm` for the destructive path) so the section matches the rest of the settings surface.

### [Med] Editable form is shown on top of a load failure

- **Dimension:** 4. Feedback & state
- **Where visible:** Error — the raw "boom" line appears above a fully editable empty form, implying the user can fill it in and Save when the load actually failed
- **Source:** `client/settings/sections/IdentitySection.svelte:96-101` — on `error` the form still renders below the message (only `loading`/`notice` short-circuit it)
- **Suggested fix:** On load failure, render an error state with a retry in place of the form (as `AiOutputSection` does) instead of layering the message over an editable form.

### [Low] Inputs stretch full-bleed with no max-width

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated / long-value (desktop) — a numeric id sits in a ~1200px-wide input; the form looks sparse and unbalanced
- **Source:** `client/settings/settings.css:38-44` (`.settings-form`) + `client/shared/ui/Input.svelte:64` (input `flex: 1`, no width cap)
- **Suggested fix:** Cap the form/input to a readable measure (max-width) so short identity values don't render in a full-viewport-width field.

### [Low] Error line collides with the first field label

- **Dimension:** 8. Spacing, alignment & sizing (also 1. Visual hierarchy)
- **Where visible:** Error — "boom" sits directly on top of the "PROVIDER USER ID" label with no separating whitespace
- **Source:** `client/settings/sections/IdentitySection.svelte:97-98` status paragraphs; `.settings-form` has `margin-bottom` but nothing separates the status line above it
- **Suggested fix:** Add vertical separation between the status/notice line and the form so the message isn't visually fused to the first label.

### [Low] Validation error is not announced to assistive tech

- **Dimension:** 6. Accessibility
- **Where visible:** Error — conveyed only by red color at 11px, no icon and no live region
- **Source:** `client/settings/settings.css:91-93` (`.status-error` is color-only) applied at `IdentitySection.svelte:97`
- **Suggested fix:** Give the status line an assertive live region (`role="alert"`/`aria-live`) so save failures and validation are announced, not just colored.

### [Low] "Clear" is offered when there is nothing to clear

- **Dimension:** 4. Feedback & state
- **Where visible:** Empty — Clear is shown even though the mapping is null, so it issues a no-op delete
- **Source:** `client/settings/sections/IdentitySection.svelte:125` (Clear always rendered) vs. `data.mapping` nullability at `:42-44`
- **Suggested fix:** Hide (or disable) Clear when no identity mapping exists so the destructive control only appears when it has an effect.
