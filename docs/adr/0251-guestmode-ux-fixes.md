<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0251: GuestModeSection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-03

## Context

`GuestModeSection.svelte` is a security-relevant group control: when guest mode is on, any unrecognized user in the chat gets a hardcoded read-only toolset (the feature landed in ADR-0213). A UX review (`docs/ux-reviews/GuestModeSection.md`) found six legibility and resilience problems with the toggle UI:

1. **No state signifier + inverted color emphasis.** There was no indicator of the current on/off state, and the button variant flipped (`primary` when off, `outline` when on), making the *safe off* state the loudest element.
2. **Raw-exception error dead-end.** A failed GET rendered a bare `<p class="status-error">{boom.message}</p>` with no recovery path.
3. **Loading label flash.** The toggle rendered its resting label before the first load resolved, briefly flashing the wrong state.
4. **No in-flight feedback.** A pending PATCH gave the user no signal the request was underway.
5. **Binary state not exposed to assistive tech.** The on/off value was not announced.
6. **Local one-off caption style.** A component-local `<style>` + `.settings-section__caption` duplicated the shared `.t-help` class.

The design (`docs/superpowers/specs/2026-07-03-guestmode-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-03-guestmode-ux-fixes.md`) scoped the fix entirely to the one component + its unit test, mirroring the load/error/loading pattern already established in `TaskProviderSection` and the boolean-toggle-in-header shape of `ByokSection`. **No shared primitives are modified** — `Pill`, `ErrorState`, `Btn` `busy`, `formatFetchError`, `.t-help`, and `.placeholder` all pre-exist.

## Decision Drivers

- **Local scope only.** The change stays inside `GuestModeSection.svelte` + its test; shared primitives and server/routes/schema are untouched.
- **Sibling parity.** The load-error-with-retry + separate inline mutation-error pattern is copied from `TaskProviderSection`; the "hide the toggle until data loads" shape from `ByokSection`.
- **State signifier as a `Pill`, not a button color flip.** An amber (`warn`) "On" pill signals "guests currently have access — pay attention"; a grey (`mute`) "Off" pill reads as the resting state. Green/accent was rejected as reading "healthy/good" and underselling the security exposure.
- **Stable neutral button.** A fixed `secondary` variant in both states, so no action is color-nudged and the safe *off* state is not the loudest element.
- **Recoverable load errors.** `ErrorState` with `onRetry` replaces the raw dead-end, humanizing the message via `formatFetchError` and re-running the GET.
- **No wrong-state flash, no extra logic.** Hiding the pill+button behind `{#if enabled !== null}` removes the loading label flash without adding a separate "first paint" flag.
- **Reuse shared text styles.** The local `<style>` is dropped in favor of the global `.t-help` class.

## Considered Options

### Option 1 — Status pill + stable neutral button + sibling-parity error/loading branches (chosen)

Carry state in a `Pill`; fix the button to `secondary`; split the single `error` into a load `error` (→ `ErrorState` + retry) and a `toggleError` (→ inline `status-error`); gate the toggle behind `enabled !== null`; drive in-flight feedback with `Btn busy={mutating}` + an "Enabling…/Disabling…" label; swap the local caption style for `.t-help`.

- **Pros:** all six findings resolved with one self-contained rewrite; reuses only existing primitives; mirrors patterns a reviewer can cross-check against `TaskProviderSection`/`ByokSection`; no server/schema work.
- **Cons:** the pill sits in the `PageHeader` action slot beside the button (not title-adjacent) because `PageHeader` has no title slot and the design declines to edit the shared primitive; `aria-describedby`/`aria-pressed` are skipped (the shared `Btn` exposes no aria pass-through).

### Option 2 — Fix the button only, no pill

Drop the `primary`/`outline` flip to a stable variant but add no state indicator.

- **Pros:** smaller diff.
- **Cons:** leaves the "no state signifier" half of the headline finding (#1) and the AT-exposure finding (#5) unaddressed.

### Option 3 — Green (accent) "On" pill

Use the accent/green tone for the on state.

- **Pros:** conventional "enabled" coloring.
- **Cons:** green reads as "healthy/good" and undersells that guests currently have read-only access to the bot — the exact inverted emphasis the review flagged.

## Decision

The chosen Option 1 shipped in full, verified against the tree. What shipped:

1. **Status pill in the header action slot.** A `Pill` (`tone={enabled ? 'warn' : 'mute'}`, `dot={enabled}`, text `On`/`Off`) renders immediately left of the button, only once `enabled !== null`.
2. **Stable neutral button.** `Btn variant="secondary" size="sm"` with `busy={mutating}`, `disabled={loading || mutating}`, `testid="guest-mode-toggle"`, and a label that flips to `Enabling…`/`Disabling…` while a PATCH is in flight.
3. **Toggle gated until data loads.** The pill+button are wrapped in `{#if enabled !== null}`, removing the wrong-state label flash (#3).
4. **Split error state.** A load failure → `ErrorState` (`formatFetchError` + `onRetry` that re-runs `load(contextId)`); a mutation failure → inline `<p class="status-error" data-testid="guest-mode-error">`. `error`/`toggleError` hold the raw `unknown` and are humanized in the template.
5. **Loading placeholder.** A shared `.placeholder` "Loading…" line shows before the first GET resolves.
6. **Shared caption style.** The local `<style>` block and `.settings-section__caption` are gone; the caption uses the global `.t-help` class.
7. **Control flow unchanged.** `load()`/`toggle()` control flow, the `contextId`-guarded async pattern, and the `fetchGroupGuestMode`/`patchGroupGuestMode` fetchers are unmodified.

## Consequences

### Positive

- The current on/off state is now legible at a glance (pill) and announced to AT (pill text + `ErrorState` `role="alert"`), and the safe *off* state is no longer the loudest element.
- Load failures are recoverable via a retry button with a humanized message, replacing the raw-exception dead-end.
- The loading label flash is gone without any extra "first paint" flag — a structural consequence of gating the toggle behind `enabled !== null`.
- In-flight PATCHes are signalled both visually (`Btn` `aria-busy` + dimmed pointer-events) and textually ("Enabling…/Disabling…").
- The component carries no local CSS; it reuses the shared text classes.
- The change is self-contained: no shared primitive, fetcher, schema, or server route was edited.

### Negative

- The pill lives beside the button in the action slot rather than next to the title, because `PageHeader` has no title-adjacent slot and editing the shared primitive was out of scope.
- Formal `aria-describedby` (caption→button) and `aria-pressed` are skipped: `Btn` exposes no aria pass-through, and the neutral action button is not a pressed-state toggle, so `aria-pressed` would misrepresent it.

### Risks

- **Divergence from the plan's error branch (see Implementation Notes).** The shipped `error !== null && enabled === null` gate means a failed *post-toggle reload* renders an inline load error instead of a full `ErrorState` takeover. This is a deliberate hardening, but it means there are now two load-error code paths (`ErrorState` on initial failure vs inline `guest-mode-load-error` after data has loaded) that a future editor must keep coherent.

## Related Decisions

- **ADR-0213: Guest Mode for Group Chats** — the feature this UI surfaces; established the per-group read-only toolset toggle and the `fetchGroupGuestMode`/`patchGroupGuestMode` + `GroupGuestModeResponseSchema` plumbing this component drives.
- **ADR-0248: ProfileSection UX Fixes** and **ADR-0250: Group Provider Section UX Fixes** — sibling `2026-07-02`/`2026-07-03` settings-section UX-fixes ADRs following the same `TaskProviderSection` load/error/loading + `Btn busy` pattern.
- The `TaskProviderSection` (load `error`/inline `bindError` split + `ErrorState` retry + `.placeholder`) and `ByokSection` (boolean toggle hidden until data loads) patterns this rewrite mirrors.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/GuestModeSection.svelte:64` | Amber/grey `Pill` (`tone={enabled ? 'warn' : 'mute'}`, `dot={enabled}`, `On`/`Off`) carries state. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:63` | `{#if enabled !== null}` gates pill+button — removes the loading label flash. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:65-81` | Stable neutral `Btn variant="secondary"`, `busy={mutating}`, `disabled={loading || mutating}`, `testid="guest-mode-toggle"`, `Enabling…`/`Disabling…` label. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:86-88` | Inline `toggleError` → `<p class="status-error" data-testid="guest-mode-error">`. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:90-91` | Load failure (when `enabled === null`) → `ErrorState` + `onRetry` re-running `load(contextId)`. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:93` | `.placeholder` "Loading…" before first GET resolves. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:95-100` | Inline `guest-mode-load-error` branch (divergence — see below) + shared `.t-help` caption; no local `<style>`. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:23-24,28` | `error`/`toggleError` typed `unknown`; `load()` resets both `error` and `toggleError`. | `read` confirms. |
| `client/settings/fetchers.ts:244,247` | `fetchGroupGuestMode` / `patchGroupGuestMode` unchanged from ADR-0213. | `grep` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:132-143` | Load failure renders `ErrorState` + retry (`error-retry`), no inline toggle error, no toggle. | `read` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:168-191` | "Off"/mute and "On"/warn pill assertions per state. | `read` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:193-203` | Loading placeholder + hidden toggle/pill before first resolve. | `read` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:205-219` | "Enabling…" busy label + `aria-busy="true"` during pending PATCH. | `read` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:237-249` | Retry after load failure re-fetches and renders the toggle. | `read` confirms. |

Plan-vs-implementation notes:

- **The error-rendering branch was hardened beyond the plan.** The plan/spec gated the full `ErrorState` takeover on `error !== null` alone. Under that logic, a *successful* toggle followed by a *failed* reload would have hidden the (still-functional) toggle and replaced the whole section with a full `ErrorState`. Shipped (`GuestModeSection.svelte:90-97`) gates the `ErrorState` on `error !== null && enabled === null` — i.e. only an *initial* load failure takes over — and adds a new inline branch: when `enabled` is already loaded and a reload fails, the load error renders as `<p class="status-error" role="alert" data-testid="guest-mode-load-error">` alongside the help text, leaving the toggle visible. Intent preserved (load failures are recoverable and announced), behavior improved.
- **`load()` resets `toggleError = null`.** The plan's `load()` cleared only `error`. Shipped (`GuestModeSection.svelte:28`) also clears `toggleError` on each load so a stale mutation error is dismissed once the reload (e.g. triggered by `toggle()` itself) completes.
- **A new test covers the post-toggle-reload-failure case.** `getOkThenPatchOkThenReloadFailsMock` (`GuestModeSection.test.ts:62-72`) and the test `a failed post-toggle reload keeps the toggle, no full ErrorState takeover` (`GuestModeSection.test.ts:221-235`) assert the divergence above — not present in the plan's task list.
- **The header-eyebrow test was added.** A `renders section header with Group eyebrow and Guest mode title` test (`GuestModeSection.test.ts:158-166`) exists beyond the plan's enumerated tests.

The source plan `docs/superpowers/plans/2026-07-03-guestmode-ux-fixes.md` and design `docs/superpowers/specs/2026-07-03-guestmode-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
