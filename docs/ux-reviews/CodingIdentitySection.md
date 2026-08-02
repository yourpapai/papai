<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodingIdentitySection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/CodingIdentitySection.svelte`
**States captured:** Populated, Empty, Error, Loading, designated-policy (member select revealed), designated @ ~640px, save-button hover, policy-select focused · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                   |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow / title / label / caption rhythm matches sibling sections; single primary action reads clearly.                |
| 2. Affordance & signifiers      | pass  | Shared `Select`/`Btn` primitives are obviously interactive; disabled/busy states visibly distinct.                     |
| 3. Consistency w/ design system | pass  | Now built entirely from shared `Field`/`Select`/`Btn`/`ErrorState`/`PageHeader`; no one-off markup remains.            |
| 4. Feedback & state             | pass  | Initial-load error blocks the form via `ErrorState`+retry; explicit "Loading…"; busy "Saving…"; "Saved." confirmation. |
| 5. Content & language           | pass  | Member dropdown shows `user_label` (e.g. "Alice (@alice)"); caption states plainly whose credentials are affected.     |
| 6. Accessibility                | pass  | Error/status nodes carry `role="alert"`; `Select` wires `aria-labelledby`/`aria-invalid`/`aria-describedby`.           |
| 7. Responsive / layout          | pass  | Reflows cleanly at ~640px; selects and caption wrap without overflow or clipping.                                      |
| 8. Spacing, alignment & sizing  | pass  | Section no longer hand-rolls spacing; layout is entirely delegated to the token-driven shared primitives.              |
| 9. Interaction & micro-states   | pass  | Green `:focus-within` ring on `Select` (shared primitive), `Btn` shows "Saving…"/`aria-busy` while in flight.           |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Load failure leaves an editable form defaulting to "Initiator" — the real policy can be silently overwritten

- **Id:** coding-identity-load-failure-silent-overwrite
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern") + `bfd8be06d` ("fix(settings): CodingIdentity refresh failure keeps form, not full ErrorState")
- **Dimension:** 4. Feedback & state
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:109`–`:110`: `{#if loadError !== null && !loaded}` renders `ErrorState` + retry and the form is not rendered at all — only reachable once `loaded` is true does the form appear, so a failed initial GET can no longer be silently overwritten with `'initiator'`. Confirmed visually: `.storybook-shots/settings/sections/CodingIdentitySection.spec.ts/settings-sections-CodingIdentitySection-Error-1.png` shows only the error panel + retry button, no select/Save. A *refresh* failure after an already-loaded value (`loadError !== null` inside the `:else` branch, line 114–116) intentionally keeps the last-known-good form editable, which is the correct, non-destructive behavior the follow-up commit specifically hardened.

### [High] Designated "Member" dropdown shows raw user ids instead of human labels

- **Id:** coding-identity-raw-user-ids
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 5. Content & language
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:50`: `memberOptions = $derived(members.map((m) => ({ value: m.user_id, label: m.user_label ?? m.user_id })))`. Screenshot `CodingIdentity-—-designated-policy-reveals-member-select-1.png` shows the MEMBER select reading "Alice (@alice)", not `u1`.

### [Med] Loading state is a fully-formed control with a placeholder value, not a load affordance

- **Id:** coding-identity-loading-looks-interactive
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 4. Feedback & state
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:111`–`:112`: `{:else if loading && !loaded}<p class="placeholder">Loading…</p>{/if}` — the form (and its default-valued select) is not rendered during the initial load at all. Confirmed in `settings-sections-CodingIdentitySection-Loading-1.png`: only the title and an explicit "Loading…" line, no select/button.

### [Med] Raw one-off `<select>` diverges from the shared `Select` primitive and its focus treatment

- **Id:** coding-identity-raw-select-diverges
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 3. Consistency w/ design system · 9. Interaction & micro-states
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:124`–`:129`/`:134`–`:139` now render `<Select>` (imported at line 11 from `../../shared/ui/Select.svelte`), the same primitive `TaskProviderSection`/`GroupProviderSection` use. `client/shared/ui/Select.svelte:66`–`:69` gives the shared green `:focus-within` ring (`rgba(82,224,138,.4)`). Confirmed visually in `CodingIdentity-—-policy-select-focused-1.png`: the POLICY select shows the green ring, not the blue UA outline.

### [Med] No success confirmation and no "Saving…" busy state on Save

- **Id:** coding-identity-no-save-feedback
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 4. Feedback & state · 9. Interaction & micro-states
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:143`–`:144`: `<Btn variant="primary" type="submit" disabled={saving || designatedEmpty} busy={saving} ...>{saving ? 'Saving…' : 'Save'}</Btn>`; `:80`: `status = 'Saved.'` set after a successful `save()`, rendered at `:117` (`{#if status !== null}<p class="status-success">{status}</p>{/if}`).

### [Med] "Designated" can be saved with no member selected

- **Id:** coding-identity-designated-no-member-required
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 4. Feedback & state
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:51`: `designatedEmpty = $derived(policyKind === 'designated' && designatedUserId === '')`; `:74`: `save()` returns early `if (designatedEmpty) return`; `:133`: `Field` renders `error="Add a group member to use the Designated policy."` when empty; `:143`: `Btn disabled={saving || designatedEmpty}` blocks submission at the control level too.

### [Low] Errors are not announced to assistive tech and show raw messages

- **Id:** coding-identity-errors-not-announced
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 6. Accessibility · 5. Content & language
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:115`, `:119`: both status-error `<p>` nodes now carry `role="alert"` and route through `formatFetchError(...)` (imported at line 12 from `../../shared/format-error.js`), matching the `TaskProviderSection` pattern the original finding pointed to.

### [Low] Hardcoded spacing/sizing drifts from the token scale

- **Id:** coding-identity-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `0bcd5277d` ("fix(settings): align CodingIdentitySection with sibling pattern")
- **Dimension:** 8. Spacing, alignment & sizing
- **Evidence:** `client/settings/sections/CodingIdentitySection.svelte:157`–`:164` — the component's entire remaining `<style>` block is `.settings-section__caption { margin: 0; font-size: 12px; color: var(--text-dim); line-height: 1.45; }`. The gap/radius/padding hardcodes the finding cited (`:146`–`:166` in the pre-rewrite version) are gone; layout, radius, and typography for the controls now come entirely from the shared `Field`/`Select`/`Btn` primitives, so this section is no longer a one-off relative to its siblings (all of which share the same primitives, and therefore the same values).

## Batch-4 observation (not acted on here)

`CodingIdentitySection`'s caption explains *whose* credentials a session uses, but does not itself collect a git name/email — that lives in the sibling `CodingCredentialsSection` (the forge/code-host token configuration). If a future review of `CodingCredentialsSection` finds the UI doesn't make clear that the configured code-host identity (and any associated email) becomes public commit-author metadata once a session pushes/PRs, that is a `CodingCredentialsSection` finding, not one for this document — flagging for whoever picks up batch 4.
