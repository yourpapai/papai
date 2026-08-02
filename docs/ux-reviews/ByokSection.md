<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ByokSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/ByokSection.svelte` (+ `ProviderForm.svelte`, `RoleBindingBlock.svelte`, `VerificationPill.svelte`, `Pill.svelte`, `ErrorState.svelte`)
**States captured:** Enabled with provider, Enabled no providers, Disabled, Error, Loading, add-provider form open · desktop (1280) + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | pass  | Redesigned to a `Pill` state indicator + provider table + role-overrides block; no more competing double labels.         |
| 2. Affordance & signifiers      | pass  | A `Pill` next to the toggle reads "Active" / "Central credentials" / "No providers" / "Unreadable" independent of the toggle's own action label. |
| 3. Consistency w/ design system | warn  | `ByokSection`/`ProviderForm`/`RoleBindingBlock` still hand-roll gap/padding literals (4/6/8/16px) instead of `--gap-*`/`--s*` tokens. |
| 4. Feedback & state             | warn  | Load error now shows a friendly `ErrorState` with a visible Retry action, but the message body is still the raw exception text. |
| 5. Content & language           | warn  | Raw server error text ("boom") still surfaced verbatim in the error body; fallback-to-central and delete-consequence copy are otherwise clear. |
| 6. Accessibility                | pass  | Section status/error `<p>` now carry `role="alert"`/`role="status"`, so save success/failure and the unreadable-context message are announced. |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px; the provider table scrolls via its own `overflow-x: auto` wrapper rather than clipping (right-edge icon clip is a canvas artifact). |
| 8. Spacing, alignment & sizing  | warn  | Same hardcoded-literal gaps/padding as dim 3, viewed from the sizing/token angle (see `byok-hardcoded-spacing`).         |
| 9. Interaction & micro-states   | pass  | Save/roles-save show busy text and disable while in-flight; buttons/inputs have real `:focus-visible`/hover/`aria-busy` states (from source). |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Active BYOK state is not explicitly indicated — inferred only from an inverse-labeled toggle

- **Id:** byok-active-state-not-indicated
- **Status:** fixed
- **Resolved:** `bea2119f4` ("ByokSection state pill, ErrorState retry, aria roles, dirty-state, shell rows") added a `Pill` next to the toggle; `188b5660e` ("generalized ByokSection with multi-provider UI") kept it through the multi-provider redesign.
- **Dimension:** 2. Affordance & signifiers / 4. Feedback & state
- **Where visible:** `.storybook-shots/settings/sections/ByokSection.spec.ts/settings-sections-ByokSection-Enabled-with-provider-1.png` shows a green "● Active" pill to the left of the "Use central credentials" toggle button; the `Disabled` shot shows a muted "Central credentials" pill next to a green "Use my own credentials" toggle; the `Enabled-no-providers` shot shows an amber "● No providers" pill.
- **Source:** `client/settings/sections/ByokSection.svelte:56-62` (`pillState` derived: `Active`/`Central credentials`/`No providers`/`Unreadable` by tone), `:218-238` (PageHeader `action` snippet renders the `Pill` before the toggle `Btn`).
- **Detail:** A `Pill` component now sits next to the toggle and reads the current state independent of the toggle's action label — "Active" (accent, dot) when enabled with a working provider, "Central credentials" (mute) when disabled, "No providers" (warn) when enabled but empty, "Unreadable" (danger) when the stored blob can't be decrypted. This is exactly the explicit state indicator the original finding asked for.
- **Suggested fix:** N/A — resolved.

### [Med] Load-error state drops the primary control and shows the raw server message

- **Id:** byok-load-error-raw-message
- **Status:** open
- **Dimension:** 5. Content & language
- **Where visible:** `.storybook-shots/settings/sections/ByokSection.spec.ts/settings-sections-ByokSection-Error-1.png` — a centered panel with a warning glyph, the title "Something went wrong", the raw string "boom" in red, and a "Try again" button.
- **Source:** `client/settings/sections/ByokSection.svelte:246-247` (`{:else if currentData === null && error !== null}` renders `<ErrorState message={error} onRetry={...} />`), `client/shared/ui/ErrorState.svelte:17,23` (`title` defaults to "Something went wrong"; `message` is printed verbatim as `.ui-error__message`), `:92-96` (raw `err.message` assigned to `error`).
- **Detail:** Narrowed to the residue: the "primary control vanishes, leaving only a refresh icon" half of the original finding is fixed — a failed load now renders the shared `ErrorState` with a friendly title and a visible "Try again" button in the body. What remains: the message body under that title is still the raw, unedited exception string ("boom" in the fixture; a real provider/network error would surface its raw text the same way), not a user-facing sentence.
- **Suggested fix:** Keep the friendly title/Retry, but pass a sanitized, user-facing message and demote the raw exception text to a secondary/collapsed detail.

### [Med] Redundant double label on every field

- **Id:** byok-redundant-double-label
- **Status:** superseded
- **Resolved:** `188b5660e` ("generalized ByokSection with multi-provider UI") replaced the single-secret `.settings-field` card layout entirely with a multi-provider table (Label/Type/API Key/Status columns) plus a separate `ProviderForm` for adding a provider.
- **Dimension:** 1. Visual hierarchy & scanning / 5. Content & language
- **Where visible:** N/A — the described "field name label + `Field`'s VALUE/NEW VALUE eyebrow" UI no longer exists anywhere in the current source or stories; the `Field` primitive is not imported by `ByokSection.svelte` or `ProviderForm.svelte` (confirmed via import lists in both files).
- **Source:** `client/settings/sections/ByokSection.svelte:279-321` (provider table), `client/settings/components/ProviderForm.svelte:59-95` (single label per input, e.g. `<span class="provider-form__label">Label</span>` at `:69`, one tier, no secondary eyebrow).
- **Detail:** The single-secret-field UI this finding described was removed in the move to a multi-provider table + add-provider form. Each `ProviderForm` field now has exactly one label tier (`Type`/`Label`/`Base URL`/`API Key`); there is no redundant micro-label.
- **Suggested fix:** N/A — superseded by redesign.

### [Med] Section status/error not announced to assistive tech

- **Id:** byok-status-not-announced
- **Status:** fixed
- **Resolved:** `bea2119f4` ("ByokSection state pill, ErrorState retry, aria roles, dirty-state, shell rows") — the commit subject names "aria roles" and the current source confirms it.
- **Dimension:** 6. Accessibility
- **Where visible:** Not independently screenshot-verifiable (ARIA roles don't render visually); confirmed from source instead.
- **Source:** `client/settings/sections/ByokSection.svelte:241` (`<p class="status-error" role="alert">{error}</p>`), `:242` (`<p class="status-success" role="status">{status}</p>`), `:254` (unreadable-context message: `<p class="status-error" role="alert">`).
- **Detail:** Every section-level status/error paragraph now carries an explicit `role="alert"` (assertive) or `role="status"` (polite), both of which are implicit ARIA live regions — a screen reader announces the text when it appears. The specific "Missing required" no-role paragraph this finding cited no longer exists (that validation flow was replaced by `ProviderForm`'s `canSave` gate, which disables Save instead of showing a separate error line).
- **Suggested fix:** N/A — resolved.

### [Low] Card spacing and radius are hardcoded, off the shared scale

- **Id:** byok-hardcoded-spacing
- **Status:** open
- **Dimension:** 8. Spacing, alignment & sizing / 3. Consistency w/ design system
- **Where visible:** all populated states (provider table, add-provider form, role-overrides block)
- **Source:** `client/settings/sections/ByokSection.svelte:397-403` (`.mono` ok, `.row-actions { gap: 4px }`), `:380-386` (`.provider-create { padding: 16px }` — this one now correctly uses `border-radius: var(--radius)`), `client/settings/components/ProviderForm.svelte:98-101` (`.provider-form__field { gap: 4px }`, `.provider-form__actions { gap: 8px }`), `client/settings/components/RoleBindingBlock.svelte:96-100` (`.role-binding { gap: 6px; padding: 8px 0 }`, `.role-binding__controls { gap: 8px }`).
- **Detail:** Narrowed to the residue: the original `.settings-field` card (min-width 200px, square corners, 12/10/8px literals) is gone with the redesign — `.provider-create` now uses `var(--radius)` for its corner. What remains is a new set of one-off px values scattered across `ByokSection.svelte` and the two components it composes (`ProviderForm.svelte`, `RoleBindingBlock.svelte`): `gap: 4px`/`6px`/`8px` and `padding: 8px 0`/`16px` where `--s1` (4px), `--gap-tight`/`--s2` (8px), and a 6px value with no matching token are available or should be reconciled.
- **Suggested fix:** Replace the literals in all three files with the spacing tokens (`--s1`/`--gap-tight`/`--s2`), and add a token for the 6px `role-binding` gap or round it to `--s2`.

### [Low] Required marker is hand-rolled and low-emphasis

- **Id:** byok-required-marker-low-emphasis
- **Status:** superseded
- **Resolved:** `188b5660e` ("generalized ByokSection with multi-provider UI") replaced the single-secret field (with its hand-rolled `*`) with `ProviderForm`, which has no per-field required marker of any kind.
- **Dimension:** 3. Consistency w/ design system / 2. Affordance & signifiers
- **Where visible:** `.storybook-shots/settings/sections/ByokSection.spec.ts/Enabled-no-providers-—-add-provider-form-open-1.png` — Type/Label/Base URL/API Key fields each show a plain label with no asterisk or other required marker.
- **Source:** `client/settings/components/ProviderForm.svelte:59-95` (no `*`/required glyph anywhere in the template), `:47-51` (`canSave` gates the Save button on non-empty `label`/`baseUrl`/`apiKey` instead of a visual marker).
- **Detail:** The specific defect (a hand-rolled, muted-color `*`) no longer exists — there is no required-field UI at all now; required-ness is communicated only implicitly by the Save button staying disabled. That is a different, new observation (silent required-validation) rather than the "low-emphasis marker" this finding described, so it is superseded rather than fixed; a fresh finding would be needed to flag the current silent-validation pattern if desired.
- **Suggested fix:** N/A — superseded by redesign.

### [Low] Non-sensitive field has no dirty state — Save always active

- **Id:** byok-no-dirty-state
- **Status:** superseded
- **Resolved:** `188b5660e` ("generalized ByokSection with multi-provider UI") removed the per-field editor (`editorOpen`, always-on Save for non-sensitive fields) this finding described; `bea2119f4` separately added dirty-tracking for the surviving editable form.
- **Dimension:** 9. Interaction & micro-states / 4. Feedback & state
- **Where visible:** N/A — the "Model" per-field editor row this finding cited no longer exists.
- **Source:** `client/settings/sections/ByokSection.svelte:64-68` (`rolesDirty` derived by deep-comparing `draftRoles` against `currentData.roles`), `:326-333` (`Save roles` button `disabled={!rolesDirty || saving}`).
- **Detail:** The specific UI (a non-sensitive field always rendered editable with an always-enabled Save) is gone. The role-overrides block that replaced the field-editing flow now has real dirty-state tracking: `rolesDirty` compares the draft against the loaded roles and the "Save roles" button stays disabled until they differ. The `ProviderForm`'s own Save is gated on required-field presence (`canSave`, `ProviderForm.svelte:47-51`), not dirtiness, but that form has no "unchanged" case to guard against (it only creates new providers). No dirty-state gap remains in the current design.
- **Suggested fix:** N/A — superseded by redesign, and the replacement already implements dirty-gating.

---

### Notes (not findings)

- **Refresh icon clipped at right edge (1280px shots):** a storybook zero-padding canvas artifact — the header fits at 640px and the real app's `.settings-grid__main` padding prevents it. Not a component defect.
- **Focus ring faintness:** `--focus-ring` is `2px solid rgba(82,224,138,0.4)` (40% alpha); the ring exists in source on `Btn`/`Input`/`IconButton` and satisfies dim 9, but reads subtly on the dark inset — worth a glance if a broader focus-contrast pass is ever run (applies app-wide, not specific to this section).
