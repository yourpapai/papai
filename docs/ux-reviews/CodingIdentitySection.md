<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodingIdentitySection

**Date:** 2026-07-07
**Reviewed:** `client/settings/sections/CodingIdentitySection.svelte`
**States captured:** Populated, Empty, Error, Loading, designated-policy (member select revealed), designated @ ~640px, save-button hover, policy-select focused · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                   |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow / title / label / caption rhythm matches sibling sections; single primary action reads clearly.                |
| 2. Affordance & signifiers      | pass  | Native selects and the primary `Btn` are obviously interactive; no clickable-div traps.                                |
| 3. Consistency w/ design system | warn  | Raw one-off `<select>` + raw error text instead of the shared `Select` primitive / `formatFetchError` siblings use.    |
| 4. Feedback & state             | fail  | Load-error and loading both render an interactive form defaulting to "Initiator"; no success/busy/validation feedback. |
| 5. Content & language           | fail  | Designated "Member" dropdown lists raw ids (`u1`, `u2`) though a human `user_label` is available.                      |
| 6. Accessibility                | warn  | Good `<label>`/`<select>`/`<button>` semantics, but the error is not a live region and options read as raw ids.        |
| 7. Responsive / layout          | pass  | Reflows cleanly at ~640px; selects capped at 360px; no overflow or clipping.                                           |
| 8. Spacing, alignment & sizing  | warn  | Hardcoded `gap`/`radius`/`font-size`/`padding` off the token scale; error text crammed against the POLICY label.       |
| 9. Interaction & micro-states   | warn  | Focus falls back to the blue UA outline (clashes with the app's green ring); no "Saving…" busy state.                  |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Load failure leaves an editable form defaulting to "Initiator" — the real policy can be silently overwritten

- **Dimension:** 4. Feedback & state
- **Where visible:** `Error` state (small red "boom" above POLICY; policy select + Save remain fully enabled)
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:107` (error `<p>`), `:93`–`:135` (form always rendered), `:61`–`:73` (`save`)
- **Why it matters:** When the initial GET fails, `policyKind` stays at its initial `'initiator'` and the form is still interactive. A user who hits Save writes `initiator` over whatever the group's real (now-unknown) policy was — a destructive default masquerading as the current value.
- **Suggested fix:** On load error, suppress the editable controls (or disable Save) and offer a retry, so a failed read cannot be committed as an "initiator" write.

### [High] Designated "Member" dropdown shows raw user ids instead of human labels

- **Dimension:** 5. Content & language
- **Where visible:** `designated-policy` state — the MEMBER select lists `u1` / `u2`
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:131` (`<option>{member.user_id}</option>`)
- **Why it matters:** The members payload already carries `user_label` (e.g. `"Alice (@alice)"`, per the fixture and `MembersSection`), but this control renders the opaque internal id. Choosing whose credentials a whole group uses by guessing at `u1` vs `u2` is exactly the raw-id trap the rubric calls out.
- **Suggested fix:** Render `member.user_label ?? member.user_id` as the option text (keep `user_id` as the value), matching how `MembersSection` presents members.

### [Med] Loading state is a fully-formed control with a placeholder value, not a load affordance

- **Dimension:** 4. Feedback & state
- **Where visible:** `Loading` state — visually near-identical to Populated, only a faint opacity dim
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:28` (init `'initiator'`), `:114`/`:127` (`disabled={loading || mutating}`), `:88`–`:90`
- **Why it matters:** While the identity GET is in flight the select shows "Initiator" — indistinguishable from a real saved value. The only cue that data hasn't arrived is `select:disabled { opacity: 0.6 }`; there is no spinner, skeleton, or "Loading…" text.
- **Suggested fix:** Show an explicit loading placeholder (skeleton or "Loading…") in place of the default-valued select until the real policy resolves.

### [Med] Raw one-off `<select>` diverges from the shared `Select` primitive and its focus treatment

- **Dimension:** 3. Consistency w/ design system · 9. Interaction & micro-states
- **Where visible:** `policy-select focused` state (blue browser outline); compare vs `TaskProviderSection` / `GroupProviderSection`
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:111`–`:133` (raw markup), `:153`–`:166` (one-off styles); cf. `client/shared/ui/Select.svelte:52` (green `:focus-within` ring)
- **Why it matters:** Sibling sections use `shared/ui/Select.svelte`, which renders on `--raised` with a 2px radius, mono 12px text, a custom caret, and a **green** focus ring (`rgba(82,224,138,.4)`). This section hand-rolls a select on `--bg2`, 4px radius, 13px non-mono, and inherits the **blue** UA focus outline — a visible mismatch with the rest of the settings UI.
- **Suggested fix:** Replace the hand-rolled selects with the shared `Select` primitive so bg/radius/typography and the green focus ring match siblings.

### [Med] No success confirmation and no "Saving…" busy state on Save

- **Dimension:** 4. Feedback & state · 9. Interaction & micro-states
- **Where visible:** all states — Save label is static; no post-save toast/flash
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:96`–`:104` (static "Save"), `:61`–`:73` (`save` reloads silently)
- **Why it matters:** `save()` sets `mutating`, PATCHes, then reloads with no confirmation. The button never reads "Saving…", and success produces no visible acknowledgement, so a user cannot tell whether their change took — especially on a fast reload where the disabled frame is imperceptible.
- **Suggested fix:** Swap the button label to "Saving…" (or show a spinner) while `mutating`, and surface a brief "Saved" confirmation on success.

### [Med] "Designated" can be saved with no member selected

- **Dimension:** 4. Feedback & state
- **Where visible:** `Empty` state → switch policy to Designated (member list empty)
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:65` (`designated:${designatedUserId}`), `:80` (`members[0]?.user_id ?? ''`)
- **Why it matters:** In a group with no listed members, choosing Designated leaves `designatedUserId = ''` and Save writes the identity string `designated:` (empty user). Nothing validates that a designated policy actually names a member.
- **Suggested fix:** Disable Save (or block it with inline validation) when the policy is Designated and no member is selected.

### [Low] Errors are not announced to assistive tech and show raw messages

- **Dimension:** 6. Accessibility · 5. Content & language
- **Where visible:** `Error` state (literal "boom")
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:107` (plain `<p class="status-error">`), `:35`–`:37` (`messageFrom`); cf. `TaskProviderSection.svelte:119` (`formatFetchError`)
- **Why it matters:** The error `<p>` has no `role="alert"` / `aria-live`, so a screen-reader user gets no notification when a load or save fails. The text is also the raw thrown message, where sibling sections route through `formatFetchError`.
- **Suggested fix:** Make the error node a polite live region and format the message through the shared `formatFetchError`.

### [Low] Hardcoded spacing/sizing drifts from the token scale

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** all states; error text sits directly on top of the POLICY label
- **Source:** `client/settings/sections/CodingIdentitySection.svelte:146`–`:166` (`gap: 8px`, `margin-bottom: 12px`, `border-radius: 4px`, `padding: 5px 8px`, `font-size: 13px`)
- **Why it matters:** None of these values come from the shared scale — `--radius` is 6px (the shared `Select` uses 2px), field rhythm elsewhere uses `--gap-field`/`--gap-inline`, and the one-off 4px radius / 13px font make the control subtly unlike its neighbours. The un-spaced error `<p>` also crowds the POLICY label.
- **Suggested fix:** Pull spacing/radius/size from the tokens (or inherit them via the shared `Select`), and give the error node breathing room from the controls below it.
