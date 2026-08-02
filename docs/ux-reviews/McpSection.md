<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — McpSection

**Date:** 2026-08-03
**Reviewed:** `client/settings/sections/McpSection.svelte`
**States captured:** Populated, Empty, Error, Loading, header-row expanded + new endpoint, long label/URL (desktop + ~640px), Save hover, invalid URL touched · desktop + ~640px
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

## Scorecard

Re-scored 2026-08-03. The section was substantially reworked in `ef7407af2` ("rework
McpSection layout, empty state, and URL validation"), which closed 9 of this document's 10
findings outright; the tenth (hint contrast) was closed separately by the token-level a11y
fix in `ca47dbb7a`. See per-finding entries below for evidence.

| Dimension                       | Score | Rationale (one line)                                                                                       |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| 1. Visual hierarchy & scanning  | pass  | Empty state now promotes "Add endpoint" as the primary (green) CTA; no competing Save is shown when empty. |
| 2. Affordance & signifiers      | pass  | "Remove" is now an `outline` `Btn` with a visible border, distinct from the "Enabled" checkbox label.       |
| 3. Consistency w/ design system | pass  | Themed `Checkbox` component, shared `EmptyState`, gap tokens throughout, natural-width `Add header` button. |
| 4. Feedback & state             | pass  | URL is validated on blur and the error renders inline in the row's `Field`; Save disables while invalid.    |
| 5. Content & language           | pass  | Empty state now carries a one-line explanation of what an MCP endpoint is and why to add one.               |
| 6. Accessibility                | pass  | Hint text token now clears 4.5:1; Auth headers / Tool filter are `<fieldset>`/`<legend>`, not plain `<p>`.  |
| 7. Responsive / layout          | pass  | URL field is `flex: 1 1 320px` and grows to fill the row; long URLs render in full at desktop width.        |
| 8. Spacing, alignment & sizing  | pass  | Header-row Name/Value share a baseline; spacing uses `--gap-inline`/`--gap-tight`; Add header is natural width. |
| 9. Interaction & micro-states   | pass  | Save shows "Saving…"/disabled/busy, Refresh has a busy state, inputs/buttons have real focus rings and hovers.  |

## Findings

Severity-ranked, highest first. Each finding = dimension · severity · where visible · source anchor · suggested fix.

### [High] Primary URL field is cramped to ~200px while most of the row is empty

- **Id:** mcp-url-field-cramped
- **Status:** fixed
- **Resolved:** `ef7407af2` ("feat(settings): rework McpSection layout, empty state, and URL validation") — the row layout was rebuilt around a flex `.settings-mcp__field--url { flex: 1 1 320px; }` (`client/settings/sections/McpSection.svelte:328`) inside a growing `.settings-mcp__primary-fields`, replacing the old fixed-`min-width` field. Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-long-label-and-url-overflow-1.png`: the full `https://mcp.analytics.internal.example.com/servers/production/streamable-http/v2/endpoint?tenant=acme-corp` renders unclipped, filling the row.
- **Dimension:** 7. Responsive / layout
- **Where visible:** Populated (desktop), Long-label/URL overflow (desktop + 640) — URL shows only `https://mcp.example.com/s…` / `endpoint?tenant=acme-corp`
- **Source:** `client/settings/sections/McpSection.svelte:262` (`.settings-mcp__row :global(.ui-field) { min-width: 200px }` with no flex-grow)
- **Detail:** The Label and URL `Field`s stay at their 200px min-width and never grow, so the most important value — the endpoint URL a user must verify — is the narrowest control on the row, truncated, while ~800px to its right is blank. The allow/deny inputs directly below span the full width, making the imbalance obvious.
- **Suggested fix:** Let the URL field grow to consume the free row width (flex-grow on the URL field) so the full endpoint is visible; keep Label at a modest fixed width.

### [High] Empty state is a bare pair of buttons with no explanation

- **Id:** mcp-empty-state-no-explanation
- **Status:** fixed
- **Resolved:** `ef7407af2` — the empty branch now renders the shared `EmptyState` (`client/settings/sections/McpSection.svelte:183`) with hint copy "Connect an external MCP server to add its tools to this context." and a single primary "Add endpoint" action; there is no competing Save button when the list is empty. Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/settings-sections-McpSection-Empty-1.png`.
- **Dimension:** 5. Content & language (also 1. hierarchy)
- **Where visible:** Empty
- **Source:** `client/settings/sections/McpSection.svelte:165` (renders straight into the row loop with no empty branch) and `:236` (actions)
- **Detail:** With no endpoints the section shows only "Add endpoint" and a green "Save" — no sentence on what an MCP endpoint is, why to add one, or that Save does nothing until a row exists. The primary green Save also out-weights "Add endpoint" (secondary), inverting which action is actually useful when empty.
- **Suggested fix:** Render the shared `EmptyState` with one line of guidance and promote "Add endpoint" to the primary CTA while the list is empty.

### [Med] Native blue checkbox is off-theme

- **Id:** mcp-checkbox-off-theme
- **Status:** fixed
- **Resolved:** `ef7407af2` replaced the raw `<input type="checkbox">` with the shared `Checkbox` component (`client/settings/sections/McpSection.svelte:212`), which sets `accent-color: var(--accent)` (`client/shared/ui/Checkbox.svelte:47`). Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/settings-sections-McpSection-Populated-1.png` — the Enabled control renders as the themed green square, not browser blue.
- **Dimension:** 3. Consistency with the design system
- **Where visible:** Populated, all states with a row (the "Enabled" control renders as a browser-blue checkbox)
- **Source:** `client/settings/sections/McpSection.svelte:174` (raw `<input type="checkbox">`)
- **Suggested fix:** Style the enabled toggle with the app's themed control so it reads in the green accent system rather than default browser blue.

### [Med] Invalid URL is never surfaced at the field

- **Id:** mcp-invalid-url-not-surfaced
- **Status:** fixed
- **Resolved:** `ef7407af2` added `validateMcpEndpoint` (`client/settings/lib/validate-mcp-endpoint.js`), wired through `visibleUrlError()` (`client/settings/sections/McpSection.svelte:51-54`) into the URL `Field`'s `error` prop (`:202`) on blur (`markTouched`, `:206`), and disables Save while any row is invalid (`hasErrors`, `:44`, consumed at `:287`). Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-invalid-url-touched-1.png`: the URL field shows a red border and "URL must start with https://" directly beneath it, and Save renders in its disabled (darker) state.
- **Dimension:** 4. Feedback & state
- **Where visible:** Not visible in fixtures (no client validation exists); Error story shows the top-of-section pattern a bad save would reuse
- **Source:** `client/settings/sections/McpSection.svelte:171` (URL `Field` never receives an `error`) and `:131` (`save()` has no URL check; relies on server)
- **Detail:** The label promises "URL (https)" but a malformed or non-https URL produces only a generic server error string at the top of the section, detached from the offending row/field. `Field` already supports an `error` slot that goes unused.
- **Suggested fix:** Validate the https URL client-side and pass the message to that row's URL `Field` so it renders inline beneath the input.

### [Med] Header-row Name and Value inputs don't share a baseline

- **Id:** mcp-header-inputs-misaligned
- **Status:** fixed
- **Resolved:** `ef7407af2` moved the "leave unchanged to keep stored value" hint out of the per-field `Field hint` and into a single `.settings-mcp__group-hint` line shown once above the header rows (`client/settings/sections/McpSection.svelte:227`), so the Name and Value `Field`s in each header row (`:231`, `:237`) are now visually identical (no field-level hint on either). Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-header-row-new-endpoint-expanded-1.png` — NAME and VALUE labels and inputs land on one baseline.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** "header row + new endpoint expanded" — the NAME input sits visibly lower than the VALUE input, and the column labels are misaligned
- **Source:** `client/settings/sections/McpSection.svelte:298` (`.settings-mcp__header-row { align-items: end }`) with the hint on `:195` making only the Value field taller
- **Detail:** `align-items: end` bottom-aligns the two fields, but the Value field carries a hint line ("leave unchanged to keep stored value") and the Name field does not, so their inputs and labels land on different rows.
- **Suggested fix:** Top-align the header-row fields (or reserve hint height) so Name and Value inputs line up on one baseline.

### [Med] "Remove" ghost button reads as static text

- **Id:** mcp-remove-button-low-affordance
- **Status:** fixed
- **Resolved:** `ef7407af2` changed Remove from `variant="ghost"` to `variant="outline"` (`client/settings/sections/McpSection.svelte:217`); `Btn`'s `--outline` style draws a real `border-color: var(--border)` (`client/shared/ui/Btn.svelte`, `.ui-btn--outline`), unlike ghost's transparent border. Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/settings-sections-McpSection-Populated-1.png` — Remove renders as a bordered button, clearly distinct from the plain "Enabled" checkbox label beside it.
- **Dimension:** 2. Affordance & signifiers
- **Where visible:** Populated — "Remove" sits immediately after the "Enabled" checkbox label with near-identical grey styling
- **Source:** `client/settings/sections/McpSection.svelte:181` (`variant="ghost"` Remove) beside the plain label on `:179`
- **Suggested fix:** Give Remove a clearer interactive/destructive affordance (outline or danger styling) so it isn't mistaken for the neighbouring checkbox label.

### [Low] Spacing uses hardcoded px instead of the gap tokens

- **Id:** mcp-hardcoded-spacing
- **Status:** fixed
- **Resolved:** `ef7407af2` rewrote the section's stylesheet to use `gap: var(--gap-inline)` / `gap: var(--gap-tight)` / `padding: var(--gap-inline)` throughout (`client/settings/sections/McpSection.svelte:298`, `:302-303`, `:343`, `:350`, `:357`, `:367`); no literal 12px/8px/6px gap or padding values remain in the current stylesheet.
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** All states (row gap/padding, subsection gaps)
- **Source:** `client/settings/sections/McpSection.svelte:250` (`gap: 12px`), `:257` (`padding: 12px`), `:274` (`gap: 6px`), `:288` (`gap: 8px`)
- **Detail:** The 12px/8px values happen to equal `--gap-inline`/`--gap-tight` but are hardcoded, so they'll drift from siblings if the scale changes.
- **Suggested fix:** Reference the `--gap-inline` / `--gap-tight` tokens instead of literal px.

### [Low] `Add header` button stretches to full card width

- **Id:** mcp-add-header-button-full-width
- **Status:** fixed
- **Resolved:** `ef7407af2` wraps the button in `.settings-mcp__group-action` (`client/settings/sections/McpSection.svelte:252-260`); `Btn` renders `display: inline-flex` so it sizes to its label rather than stretching. Confirmed in `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-header-row-new-endpoint-expanded-1.png` and the Populated shot — "Add header" is a natural-width button matching "Add endpoint" / "Save", not a full-width bar.
- **Dimension:** 8. Spacing, alignment & sizing (also 3. consistency)
- **Where visible:** "header row + new endpoint expanded" — Add header is a full-width bar, unlike the natural-width Add endpoint / Save
- **Source:** `client/settings/sections/McpSection.svelte:284` (`.settings-mcp__headers { display: grid }` stretches its `Btn` child) vs the flex `.settings-mcp__actions` on `:280`
- **Suggested fix:** Constrain the button to its natural width (`justify-self: start`) so it matches the other action buttons.

### [Low] Hint text is low-contrast on the card surface

- **Id:** mcp-hint-text-low-contrast
- **Status:** fixed
- **Resolved:** `ca47dbb7a` ("fix(a11y): raise dim text tokens above the 4.5:1 contrast floor") changed `--text-dim` from `#6b766e` to `#828d84` and `--fg4` from the hardcoded `#3a4248` (annotated in the diff as "1.58:1 — below even the 3:1 non-text floor") to `var(--text-dim)` (`client/shared/tokens.css:20-21`). `Field`'s hint (`client/shared/ui/Field.svelte`, `.ui-field__hint`) uses `color: var(--text-dim)`, consumed here at `McpSection.svelte:267`, `:273`. `#828d84` on `--surface-1` (`#111512`) computes to ≈5.34:1, clearing WCAG 1.4.3.
- **Dimension:** 6. Accessibility
- **Where visible:** Populated / expanded — "comma or newline separated", "leave unchanged to keep stored value"
- **Source:** shared `client/shared/ui/Field.svelte` hint uses `--fg4` (`#3a4248`) rendered on the card `--surface`; consumed here at `McpSection.svelte:195`, `:221`, `:227`
- **Detail:** `#3a4248` on the dark card is well under the WCAG 4.5:1 threshold for this small text; the hints carry real instructions (secret-preservation behaviour), not decoration. Shared-component issue, but it manifests across this section.
- **Suggested fix:** Raise the hint token contrast (or use `--fg3`) so instructional hints are legible on the card surface.

### [Low] Endpoint card has no border-radius and non-semantic subsection labels

- **Id:** mcp-endpoint-card-no-radius
- **Status:** fixed
- **Resolved:** `ef7407af2` added `border-radius: var(--radius)` to `.settings-mcp__row` (`client/settings/sections/McpSection.svelte:305`) and replaced the plain `<p class="settings-mcp__subsection-label">` markup with `<fieldset class="settings-mcp__group"><legend class="settings-mcp__legend">` for both "Auth headers" (`:223-224`) and "Tool filter" (`:264-265`).
- **Dimension:** 3. Consistency / 6. Accessibility
- **Where visible:** Populated — square card corners; "Auth headers" / "Tool filter" are plain `<p>`
- **Source:** `client/settings/sections/McpSection.svelte:253` (`.settings-mcp__row` border, no `--radius`) and `:186` / `:220` (`<p class="settings-mcp__subsection-label">`)
- **Suggested fix:** Apply the shared `--radius` to the card and express the header/tool-filter groups as `<fieldset>`/`<legend>` (or headings) so they read as grouped controls.
