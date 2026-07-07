<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — McpSection

**Date:** 2026-07-07
**Reviewed:** `client/settings/sections/McpSection.svelte`
**States captured:** Populated, Empty, Error, Loading, header-row expanded + new endpoint, long label/URL (desktop + ~640px), Save hover · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | warn  | Subsection labels are the same tiny 11px grey as hints; empty state elevates green Save over the useful action. |
| 2. Affordance & signifiers      | warn  | Ghost "Remove" reads as plain text, near-identical to the adjacent "Enabled" label.                             |
| 3. Consistency w/ design system | warn  | Native blue checkbox, hardcoded px spacing, no shared `EmptyState`, full-width `Add header` button.             |
| 4. Feedback & state             | warn  | URL never validated inline; a bad URL surfaces only as a generic server error at the top of the section.        |
| 5. Content & language           | warn  | Empty state has no copy explaining what an MCP endpoint is or why to add one; good masked-header hint.          |
| 6. Accessibility                | warn  | Low-contrast hint text on the card surface; header/tool-filter groups are `<p>`, not semantic groupings.        |
| 7. Responsive / layout          | fail  | Primary URL field is capped at ~200px and truncates while 60–70% of the row stays empty at desktop width.       |
| 8. Spacing, alignment & sizing  | warn  | Header-row Name/Value inputs don't share a baseline; hardcoded px off the spacing scale; stretched Add button.  |
| 9. Interaction & micro-states   | pass  | Save shows "Saving…"/disabled/busy, Refresh has a busy state, inputs/buttons have real focus rings and hovers.  |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Primary URL field is cramped to ~200px while most of the row is empty

- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated (desktop), Long-label/URL overflow (desktop + 640) — URL shows only `https://mcp.example.com/s…` / `endpoint?tenant=acme-corp`
- **Source:** `client/settings/sections/McpSection.svelte:262` (`.settings-mcp__row :global(.ui-field) { min-width: 200px }` with no flex-grow)
- **Detail:** The Label and URL `Field`s stay at their 200px min-width and never grow, so the most important value — the endpoint URL a user must verify — is the narrowest control on the row, truncated, while ~800px to its right is blank. The allow/deny inputs directly below span the full width, making the imbalance obvious.
- **Suggested fix:** Let the URL field grow to consume the free row width (flex-grow on the URL field) so the full endpoint is visible; keep Label at a modest fixed width.

### [High] Empty state is a bare pair of buttons with no explanation

- **Dimension:** 5. Content & language (also 1. hierarchy)
- **Where visible:** Empty
- **Source:** `client/settings/sections/McpSection.svelte:165` (renders straight into the row loop with no empty branch) and `:236` (actions)
- **Detail:** With no endpoints the section shows only "Add endpoint" and a green "Save" — no sentence on what an MCP endpoint is, why to add one, or that Save does nothing until a row exists. The primary green Save also out-weights "Add endpoint" (secondary), inverting which action is actually useful when empty.
- **Suggested fix:** Render the shared `EmptyState` with one line of guidance and promote "Add endpoint" to the primary CTA while the list is empty.

### [Med] Native blue checkbox is off-theme

- **Dimension:** 3. Consistency with the design system
- **Where visible:** Populated, all states with a row (the "Enabled" control renders as a browser-blue checkbox)
- **Source:** `client/settings/sections/McpSection.svelte:174` (raw `<input type="checkbox">`)
- **Suggested fix:** Style the enabled toggle with the app's themed control so it reads in the green accent system rather than default browser blue.

### [Med] Invalid URL is never surfaced at the field

- **Dimension:** 4. Feedback & state
- **Where visible:** Not visible in fixtures (no client validation exists); Error story shows the top-of-section pattern a bad save would reuse
- **Source:** `client/settings/sections/McpSection.svelte:171` (URL `Field` never receives an `error`) and `:131` (`save()` has no URL check; relies on server)
- **Detail:** The label promises "URL (https)" but a malformed or non-https URL produces only a generic server error string at the top of the section, detached from the offending row/field. `Field` already supports an `error` slot that goes unused.
- **Suggested fix:** Validate the https URL client-side and pass the message to that row's URL `Field` so it renders inline beneath the input.

### [Med] Header-row Name and Value inputs don't share a baseline

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** "header row + new endpoint expanded" — the NAME input sits visibly lower than the VALUE input, and the column labels are misaligned
- **Source:** `client/settings/sections/McpSection.svelte:298` (`.settings-mcp__header-row { align-items: end }`) with the hint on `:195` making only the Value field taller
- **Detail:** `align-items: end` bottom-aligns the two fields, but the Value field carries a hint line ("leave unchanged to keep stored value") and the Name field does not, so their inputs and labels land on different rows.
- **Suggested fix:** Top-align the header-row fields (or reserve hint height) so Name and Value inputs line up on one baseline.

### [Med] "Remove" ghost button reads as static text

- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated — "Remove" sits immediately after the "Enabled" checkbox label with near-identical grey styling
- **Source:** `client/settings/sections/McpSection.svelte:181` (`variant="ghost"` Remove) beside the plain label on `:179`
- **Suggested fix:** Give Remove a clearer interactive/destructive affordance (outline or danger styling) so it isn't mistaken for the neighbouring checkbox label.

### [Low] Spacing uses hardcoded px instead of the gap tokens

- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** All states (row gap/padding, subsection gaps)
- **Source:** `client/settings/sections/McpSection.svelte:250` (`gap: 12px`), `:257` (`padding: 12px`), `:274` (`gap: 6px`), `:288` (`gap: 8px`)
- **Detail:** The 12px/8px values happen to equal `--gap-inline`/`--gap-tight` but are hardcoded, so they'll drift from siblings if the scale changes.
- **Suggested fix:** Reference the `--gap-inline` / `--gap-tight` tokens instead of literal px.

### [Low] `Add header` button stretches to full card width

- **Dimension:** 8. Spacing, alignment & sizing (also 3. consistency)
- **Where visible:** "header row + new endpoint expanded" — Add header is a full-width bar, unlike the natural-width Add endpoint / Save
- **Source:** `client/settings/sections/McpSection.svelte:284` (`.settings-mcp__headers { display: grid }` stretches its `Btn` child) vs the flex `.settings-mcp__actions` on `:280`
- **Suggested fix:** Constrain the button to its natural width (`justify-self: start`) so it matches the other action buttons.

### [Low] Hint text is low-contrast on the card surface

- **Dimension:** 6. Accessibility
- **Where visible:** Populated / expanded — "comma or newline separated", "leave unchanged to keep stored value"
- **Source:** shared `client/shared/ui/Field.svelte` hint uses `--fg4` (`#3a4248`) rendered on the card `--surface`; consumed here at `McpSection.svelte:195`, `:221`, `:227`
- **Detail:** `#3a4248` on the dark card is well under the WCAG 4.5:1 threshold for this small text; the hints carry real instructions (secret-preservation behaviour), not decoration. Shared-component issue, but it manifests across this section.
- **Suggested fix:** Raise the hint token contrast (or use `--fg3`) so instructional hints are legible on the card surface.

### [Low] Endpoint card has no border-radius and non-semantic subsection labels

- **Dimension:** 3. Consistency / 6. Accessibility
- **Where visible:** Populated — square card corners; "Auth headers" / "Tool filter" are plain `<p>`
- **Source:** `client/settings/sections/McpSection.svelte:253` (`.settings-mcp__row` border, no `--radius`) and `:186` / `:220` (`<p class="settings-mcp__subsection-label">`)
- **Suggested fix:** Apply the shared `--radius` to the card and express the header/tool-filter groups as `<fieldset>`/`<legend>` (or headings) so they read as grouped controls.
