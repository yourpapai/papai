<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — ByokSection

**Date:** 2026-07-06
**Reviewed:** `client/settings/sections/ByokSection.svelte`
**States captured:** Secret set, Missing required, Disabled, Error, Loading, input-focused, · desktop (1280) + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                     |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | warn  | Each field stacks two competing label tiers (field name + a redundant "VALUE"/"NEW VALUE" eyebrow).                      |
| 2. Affordance & signifiers      | warn  | Whether BYOK is currently active is only inferable from an inverse-labeled toggle; no explicit on/active state.          |
| 3. Consistency w/ design system | warn  | Hand-rolled `.settings-field` card + literal `*` marker instead of `Field`'s accent required marker and card radius.     |
| 4. Feedback & state             | warn  | No positive "active/complete" confirmation; on hard load error the primary toggle vanishes, leaving only a refresh icon. |
| 5. Content & language           | warn  | Raw server error text surfaced verbatim ("boom"); redundant "VALUE" micro-label is decorative, not helpful.              |
| 6. Accessibility                | warn  | Section-level status/error `<p>` are not in an aria-live region, so save success/failure isn't announced.                |
| 7. Responsive / layout          | pass  | Reflows cleanly at 640px; field cards and header wrap without clipping (right-edge icon clip is a canvas artifact).      |
| 8. Spacing, alignment & sizing  | warn  | Card padding/gaps (12/10/8px, min-width 200px) hardcoded instead of `--gap-*`/`--s*`; card has no `--radius`.            |
| 9. Interaction & micro-states   | pass  | Save shows "Saving…"; buttons/inputs have real `:focus-visible`/`:focus-within` rings and hover states (from source).    |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Active BYOK state is not explicitly indicated — inferred only from an inverse-labeled toggle

- **Dimension:** 2. Affordance & signifiers / 4. Feedback & state
- **Where visible:** "Secret set" (enabled+complete) and "Disabled" states
- **Source:** `client/settings/sections/ByokSection.svelte:141-155` (PageHeader eyebrow `Personal` / title `BYOK LLM`, toggle button label is the inverse action)
- **Detail:** When own-credentials mode is on and complete, the only cue is the button reading "Use central credentials" (what a click _does_, not the current state). There is no status pill, "Active", or "central vs own" indicator. A user who just enabled their key gets no positive confirmation that BYOK is live and valid — high stakes because this gates which LLM powers the bot.
- **Suggested fix:** Add an explicit current-state indicator (e.g. a `StatusPill`/`Pill` showing "Using your credentials" vs "Using central credentials") alongside the toggle, so state is readable independent of the button's action label.

### [Med] Load-error state drops the primary control and shows the raw server message

- **Dimension:** 4. Feedback & state / 5. Content & language
- **Where visible:** "Error" state (`boom` in red)
- **Source:** `client/settings/sections/ByokSection.svelte:143` (toggle only rendered when `currentData !== null`), `:157` (`{error}` printed verbatim), `:68` / `:103` / `:118` (raw `err.message`)
- **Detail:** On a failed GET, `currentData` is null, so the toggle button is not rendered — the only recovery affordance is the small `⟳` IconButton. The error body is the raw exception text ("boom"), not a user-facing sentence with a next step.
- **Suggested fix:** Render a friendly, actionable error message with a visible Retry action in the body (not only the header icon), and keep the raw detail secondary.

### [Med] Redundant double label on every field

- **Dimension:** 1. Visual hierarchy & scanning / 5. Content & language
- **Where visible:** "Missing required" — `Anthropic API Key *` then `NEW VALUE`; `Model` then `VALUE`
- **Source:** `client/settings/sections/ByokSection.svelte:178` (custom field-name label) + `:189` (`Field label={field.sensitive ? 'New value' : 'Value'}`)
- **Detail:** Each card renders the field name as one label tier and then the `Field` primitive's own uppercase micro-label ("VALUE"/"NEW VALUE") directly beneath it. The "VALUE" eyebrow carries no information the field name doesn't already convey, and the two tiers compete visually.
- **Suggested fix:** Collapse to a single label — either pass the field name as the `Field` label (dropping the custom head label) or render the input label-less under the existing head label.

### [Med] Section status/error not announced to assistive tech

- **Dimension:** 6. Accessibility
- **Where visible:** "Error", "Missing required", and post-save success (not screenshot-visible)
- **Source:** `client/settings/sections/ByokSection.svelte:157-158` (`<p class="status-error">` / `status-success`), `:170-172` (missing-fields error)
- **Detail:** These paragraphs mutate reactively but sit in no `aria-live` region and carry no `role`, so a screen-reader user gets no announcement when a save succeeds/fails or when required fields are missing. (The inner `Field` error uses `role="alert"`, but these section-level messages don't.)
- **Suggested fix:** Wrap the status/error region in an `aria-live="polite"` (or `role="status"`/`role="alert"`) container so state changes are announced.

### [Low] Card spacing and radius are hardcoded, off the shared scale

- **Dimension:** 8. Spacing, alignment & sizing / 3. Consistency w/ design system
- **Where visible:** all populated states (field cards)
- **Source:** `client/settings/sections/ByokSection.svelte:221-252` (`gap: 12px`, `gap: 8px`, `gap: 10px`, `padding: 12px`, `min-width: 200px`; no `border-radius`)
- **Detail:** These map to existing tokens (`--gap-inline`/`--s3` = 12px, `--gap-tight`/`--s2` = 8px) but are written as one-off px, and the `.settings-field` card has square corners while sibling inputs/buttons use `--radius-control`. Drift risks divergence from neighboring sections.
- **Suggested fix:** Replace the literals with the spacing tokens and give the card a shared radius (or reuse a `Panel`/card primitive) so it matches sibling rows.

### [Low] Required marker is hand-rolled and low-emphasis

- **Dimension:** 3. Consistency w/ design system / 2. Affordance & signifiers
- **Where visible:** "Secret set" / "Missing required" — `Anthropic API Key *`
- **Source:** `client/settings/sections/ByokSection.svelte:178` (`{field.required ? ' *' : ''}` in muted label color)
- **Detail:** The `*` is appended as plain text in the muted label color, whereas the design system's `Field` renders required via `.ui-field__req` in the accent color. The cue is easy to miss and inconsistent with other forms.
- **Suggested fix:** Use the `Field`/design-system required marker (accent asterisk) rather than an inline muted `*`.

### [Low] Non-sensitive field has no dirty state — Save always active

- **Dimension:** 9. Interaction & micro-states / 4. Feedback & state
- **Where visible:** "Missing required" — `Model` row (pre-filled `claude-opus-4-5`, Save enabled)
- **Source:** `client/settings/sections/ByokSection.svelte:89-91` (`editorOpen` true for non-sensitive) + `:199-206` (Save disabled only during in-flight)
- **Detail:** A non-sensitive field is always shown as an editable input with an enabled Save, even when the value is unchanged; there's no dirty detection, so Save fires a PATCH for a no-op.
- **Suggested fix:** Disable Save until the draft differs from the stored value (and reflect that "no changes" state).

---

### Notes (not findings)

- **Refresh icon clipped at right edge (1280px shots):** a storybook zero-padding canvas artifact — the header fits at 640px and the real app's `.settings-grid__main` padding prevents it. Not a component defect.
- **Focus ring faintness:** `--focus-ring` is `2px solid rgba(82,224,138,0.4)` (40% alpha); the ring exists in source on `Btn`/`Input`/`IconButton` and satisfies dim 9, but reads subtly on the dark inset — worth a glance if a broader focus-contrast pass is ever run (applies app-wide, not specific to this section).
