<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0261: Coding Identity Fixes

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

`CodingIdentitySection` (`client/settings/sections/CodingIdentitySection.svelte`) — the group setting controlling whose coding credentials (AI provider key, code host token, agent) run a group's `/acp` sessions — scored 2 `High` / 4 `Med` / 2 `Low` findings in its UX review (`docs/ux-reviews/CodingIdentitySection.md`). The most serious consequence: the section hand-rolled its form (raw `<select>`, one-off CSS, ad-hoc error text) instead of following the pattern the sibling sections use, and after a failed initial load the form still rendered, interactive, defaulting to **Initiator** — so a Save silently overwrote the group's real (now-unknown) policy (High-1). The Designated dropdown exposed raw member ids (`u1`) instead of labels (High-2); load was indistinguishable from a defaulted value (Med-1); the raw `<select>` had a blue UA focus ring (Med-2); Save had no in-flight feedback or success confirmation (Med-3); **Designated** was saveable with no member (Med-4); errors were not announced and surfaced raw strings (Low-1); spacing/radius/font were hardcoded rather than tokenized (Low-2).

The design (`docs/superpowers/specs/2026-07-07-coding-identity-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-07-coding-identity-fixes.md`) resolved all eight findings by adopting the established `TaskProviderSection`/`GroupProviderSection` render-state convention already used by sibling sections: a top-level `loadError / loading / loaded` render gate so the editable form never renders during a failed or in-flight load, the shared `Field` + `Select` + `ErrorState` primitives, `formatFetchError`, a busy Save label, a `status-success` confirmation, and a member-label dropdown. No backend, schema, or fetcher changes — the members API already returns `user_label` (`GroupMemberSchema.user_label`, `client/settings/fetcher-schemas.ts:199`).

## Decision Drivers

- **Never render the editable form during a failed/in-flight load.** A failed load shows the framed `ErrorState` + retry with no Save; an in-flight first load shows a `Loading…` placeholder — so a Save can never overwrite an unknown real policy (High-1, Med-1).
- **Show human member labels, never raw ids.** The Designated dropdown lists `user_label ?? user_id` (High-2).
- **Adopt the shared primitives.** Replace the raw `<select>`/one-off CSS with `Field` + `Select` (green tokenized focus ring, token spacing) + `ErrorState` + `formatFetchError` (Med-2, Low-1, Low-2).
- **Give in-flight and success feedback.** A `Saving…` busy label + `aria-busy` on Save, and a `status-success` "Saved." confirmation (Med-3).
- **Guard the Designated-with-no-member case.** Disable Save and show an inline `Field` error hint when Designated is selected but no member exists (Med-4).
- **Mirror the established sibling pattern.** Follow `TaskProviderSection`/`GroupProviderSection` rather than inventing new loading/error patterns — single-component rewrite, additive-only, zero blast radius beyond the section.
- **No backend/schema/fetcher change.** Keep the change strictly client-side; the data the members API already returns is sufficient.

## Considered Options

### Option 1 — In-place rewrite to the sibling template (chosen)

Rewrite `CodingIdentitySection` to mirror `TaskProviderSection`/`GroupProviderSection`: a `loadError / loading / loaded` render gate (`ErrorState` + retry on load failure, `Loading…` placeholder on first load, else the form), shared `Field` + `Select` primitives, `formatFetchError`, a busy Save label, `status-success`, and a `memberOptions` dropdown keyed on `user_label ?? user_id`. Delete all one-off `<select>` CSS.

- **Pros:** resolves all eight findings as side effects of adopting the pattern; reuses the convention already used by 13+ sibling sections; single-file component change keeps the blast radius minimal; the members API already returns `user_label`, so no backend work.
- **Cons:** adds a render-state machine where there was none; Save moves from a header action into the form, slightly changing the layout.

### Option 2 — Patch the findings individually

Keep the hand-rolled form and address each finding in place: disable Save during load, add a `<label>`/wrapper around the `<select>`, swap ids for labels, add a busy flag, etc.

- **Pros:** smaller diff per finding.
- **Cons:** rejects the "adopt the sibling pattern" driver; leaves the one-off CSS and the raw `<select>` (Med-2/Low-2 findings) in place; the High-1 overwrite bug needs a structural render gate to fix robustly, which is exactly the pattern Option 1 adopts wholesale — patching it locally re-invents a worse version of the shared template.

### Option 3 — Extract a shared `SectionState` gating wrapper

Build a reusable wrapper component that expresses the `error / loading / loaded` gate, then adopt it here and migrate siblings to it.

- **Pros:** DRYs the render-state pattern across sections.
- **Cons:** scope creep beyond a per-section fix; no such wrapper exists today (siblings inline the gate), so it would touch unrelated sections and grow the diff far beyond the eight findings. Deferred.

## Decision

The chosen Option 1 shipped in full across the rewritten component, its component test suite, the MSW fixture, the stories, and the visual screenshot spec. What shipped:

1. **Render-state gate.** `loadError / loading / loaded` state drives three top-level branches: `ErrorState` + retry on a first-load failure, a `Loading…` placeholder while the first load is in flight, else the editable form.
2. **Shared primitives.** The raw `<select>`/label/error markup was replaced with `Field` + `Select` (Policy, and Member under Designated) + `Btn` + `ErrorState`; `formatFetchError` wraps both load and save errors. All one-off `<select>` CSS was deleted; spacing, radius, and the green focus ring now come from the primitives.
3. **Member labels, not raw ids.** `memberOptions = members.map(m => ({ value: m.user_id, label: m.user_label ?? m.user_id }))` powers the Designated dropdown (raw id only as a fallback).
4. **In-flight + success feedback.** Save lives in the form as a submit `Btn` with `busy={saving}` + a `Saving…` label swap; a `status-success` "Saved." renders after a successful PATCH + reload.
5. **Designated-with-no-member guard.** `designatedEmpty` disables Save and renders an inline `Field` error hint ("Add a group member to use the Designated policy."); `save()` is also a no-op when `designatedEmpty` (defense in depth).
6. **Stale feedback clearing.** `onPolicyChange` / `onMemberChange` clear `status` and `saveError` so a prior "Saved." does not linger while editing.
7. **Component test suite (new).** `tests/client/settings/sections/CodingIdentitySection.test.ts` covers loading placeholder, loaded control, member labels, designated-empty Save disable + hint, load-error `ErrorState` + retry, success message, busy label/`aria-busy`, and failed-save inline alert.
8. **MSW fixture fix.** The Populated coding-identity fixture was pointed at `designated:u1` so the story actually exercises the member dropdown.
9. **Visual spec.** The four manual interaction/narrow-viewport states added during the review (designated-expanded, 640px viewport, Save hover, policy-select focus) were committed alongside the four auto-screenshot states.

## Consequences

### Positive

- The High-1 silent-overwrite bug is structurally fixed: the editable form (and its Save) cannot render during a failed or in-flight first load — the body shows `ErrorState`+retry or `Loading…` instead.
- The Designated dropdown shows human member labels; raw ids appear only as a fallback when `user_label` is null.
- Load errors are recoverable in place via the framed `ErrorState` + retry; save errors render as an inline `role="alert"` while the form stays editable.
- Save gives clear in-flight feedback (`Saving…` + `aria-busy` + the shared busy affordance) and a `status-success` confirmation, and the controls disable during a save.
- One-off CSS is gone; spacing, radius, and focus styling now travel with the shared primitives.
- The change is contained to one section plus tests/fixtures/stories — zero blast radius for sibling sections.

### Negative

- The section gained a render-state machine (and, beyond the plan, a fourth branch for post-save reload failure — see Divergence), adding conditional complexity.
- Save moved from a header action into the form, slightly changing the section's layout versus the prior version.
- A header `Refresh` IconButton (present on some siblings) is intentionally omitted; `ErrorState`'s retry covers the failure path.

### Risks

- **Inline pass-through of backend errors.** `saveError`/`loadError` surface `formatFetchError`'s mapping of the backend message, which could expose an unhelpful string if the backend message is poor (acceptable because the user triggered the action, or it follows a user-initiated reload).
- **Post-save reload failure is a soft state.** A failed reload after a successful PATCH keeps the form and the just-displayed "Saved." with an inline load-error banner rather than a full `ErrorState` takeover — correct for UX, but the displayed policy value is then stale until the next successful load/retry.
- **`parseIdentity` is not hardened** against arbitrary unknown identity strings (a deferred data concern, explicitly out of scope).

## Related Decisions

- **ADR-0258: Identity Section UX Fixes** — the sibling per-user identity section fix (same date window, same adopt-the-sibling-pattern approach); this ADR is its group-scope coding-identity counterpart.
- The `TaskProviderSection` / `GroupProviderSection` render-state convention this rewrite mirrors (`ErrorState` + retry / `Loading…` / content), and the `Btn` `busy` affordance landed by ADR-0253.
- The members API surface (`GroupMemberSchema.user_label`) and the `fetchGroupCodingIdentity` / `patchGroupCodingIdentity` fetchers this change consumes unchanged.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/CodingIdentitySection.svelte:7-14` | Shared-primitive + fetcher imports (`Btn`, `ErrorState`, `Field`, `PageHeader`, `Select`, `formatFetchError`, `GroupMembersResponse`, three fetchers). | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:25-29` | `POLICY_OPTIONS` constant (Initiator / Shared / Designated with explanations). | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:32-38` | `parseIdentity` splits `designated:` / `shared` / default-initiator. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:40-48` | State: `policyKind`, `designatedUserId`, `members`, `loading`, `saving`, `loaded`, `loadError`, `saveError`, `status`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:50-51` | Derived `memberOptions` (`user_label ?? user_id`) + `designatedEmpty`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:53-69` | `load()` parallel-fetches identity + members; sets `loaded`; catches into `loadError`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:71-86` | `save()` no-ops on `designatedEmpty`, PATCHes, reloads, sets `status='Saved.'`; catch into `saveError`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:88-99` | `onPolicyChange`/`onMemberChange` clear `status` + `saveError`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:106-116` | Render gate: `ErrorState`+retry on first-load failure (`loadError !== null && !loaded`); `Loading…` placeholder; inline `coding-identity-load-error` alert in the form branch. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:117-120` | `status-success` + inline `coding-identity-error` `role="alert"` save-error. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:122-146` | Form: `Field`+`Select` (Policy, Member), both `disabled={saving}`; submit `Btn` `disabled={saving \|\| designatedEmpty}` `busy={saving}`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:143-145` | Busy Save label swap (`Saving…`/`Save`) inside `{#snippet children()}`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:148-163` | Caption retained; one-off `<select>` CSS removed (only caption style block remains). | `read` confirms. |
| `tests/client/settings/sections/CodingIdentitySection.test.ts:52-92` | `route` (clone-per-read) + `routeCapturingPatch` fetch router helpers. | `read` confirms. |
| `tests/client/settings/sections/CodingIdentitySection.test.ts:100-264` | 12 tests: loading placeholder, loaded control, member labels, designated-empty disable+hint, load-error ErrorState+retry, success message, busy label/`aria-busy`, failed-save inline alert, three-policy-options, PATCH body, save-disables-Select, post-save-reload no-takeover. | `read` confirms. |
| `client/stories/msw/settings-handlers-group.ts:114-117` | `codingIdentityPopulated` fixture set to `identity: 'designated:u1'`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.stories.svelte:20-26` | Populated / Empty / Error / Loading stories (Error now renders `ErrorState`). | `read` confirms. |
| `tests/visual/settings/sections/CodingIdentitySection.spec.ts:9-29` | Four auto-screenshot states (Populated / Empty / Error / Loading). | `read` confirms. |
| `tests/visual/settings/sections/CodingIdentitySection.spec.ts:32-55` | Four manual interaction states (designated-expanded, 640px viewport, Save hover, policy-select focus). | `read` confirms. |
| `client/shared/ui/ErrorState.svelte:13,24-26` | `onRetry` prop + `error-retry` testid consumed by the load-error retry test. | `grep` confirms. |
| `client/settings/fetcher-schemas.ts:199,202-203` | `GroupMemberSchema.user_label` + `GroupMembersResponse` type the component imports. | `grep` confirms. |
| `client/settings/fetchers.ts:229,250,255` | `fetchGroupMembers` / `fetchGroupCodingIdentity` / `patchGroupCodingIdentity` unchanged fetchers. | `grep` confirms. |

Plan-vs-implementation notes:

- **A fourth render branch handles post-save reload failure.** The plan specified three mutually exclusive branches (`loadError` → `ErrorState` takeover, `loading && !loaded` → `Loading…`, else → form). Shipped gates the `ErrorState` takeover on `loadError !== null && !loaded` (line 109) and adds an inline `coding-identity-load-error` alert (line 114-116) inside the form branch: a successful PATCH whose follow-up reload GET fails keeps the form and the "Saved." banner with an inline alert rather than collapsing to a body-level `ErrorState`. A fresh first-load failure (before `loaded`) still produces the `ErrorState` takeover. This mirrors the ADR-0253 divergence and is covered by an extra test (`tests/.../CodingIdentitySection.test.ts:243-264`).
- **`load()` gained a stale-context guard.** The plan's `load()` unconditionally wrote state. Shipped guards writes on `id !== contextId` / `id === contextId` (lines 58, 65, 67-68) so a stale in-flight load after a `contextId` change cannot clobber fresh state. Intent (load → populate, error → `loadError`) unchanged.
- **Both `Select`s disable during a save.** The plan's component did not disable the Policy/Member selects while saving. Shipped passes `disabled={saving}` to both (lines 128, 138), and the suite gained an extra test asserting the policy Select disables mid-save (`tests/.../CodingIdentitySection.test.ts:231-241`).
- **State naming diverges from the spec, matches the plan.** The design spec named the in-flight flag `mutating` and the success field `saveStatus`; the plan's component (and shipped code) use `saving` and `status`. Behavior is identical; only the identifiers differ.
- **The test suite grew from 8 to 12.** The plan's eight tests shipped verbatim in intent, plus four additions covering the divergences and adjacent behavior: "renders all three policy options", "Save PATCHes the selected identity with the contextId" (via a new `routeCapturingPatch` helper), "disables the policy Select while a save is in flight", and "a failed post-save reload keeps the form + success, no full ErrorState takeover". The `route` helper also gained per-branch `.clone()` (with an explanatory comment) so `save()`'s post-PATCH reload can re-read the same fixture `Response`.
- **No `busy`/focus-ring primitive change was needed.** Unlike ADR-0253, the `Btn` `busy` affordance and `Select` focus ring already existed, so this change consumed them unchanged.

The source plan `docs/superpowers/plans/2026-07-07-coding-identity-fixes.md` and design `docs/superpowers/specs/2026-07-07-coding-identity-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
