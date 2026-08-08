<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# UX Review — CodingMcpSection

**Date:** 2026-08-07
**Reviewed:** `client/settings/sections/CodingMcpSection.svelte`
**States captured:** Populated, Empty, No catalog, Error, Loading, Internal available, Internal selected, at-cap, blank-row-blocks-Save, Save hovered · desktop (1280px) + narrow (640px)
**Rubric:** [`RUBRIC.md`](./RUBRIC.md)

> Report-only. This document contains no code changes and no change-plan. Each finding
> carries a one-line described fix; acting on it is a separate human decision.

Layout and state claims below were measured in the browser (`getBoundingClientRect`,
`scrollWidth`/`clientWidth`, computed styles, live interaction), not inferred from the
screenshots or from the presence of a CSS property in source.

Three hypotheses were checked and **dropped** rather than filed: the `<select>` reports
`outline: 0px none`, but the ring lives on the `.ui-select` wrapper via `:focus-within` and
measures 2px solid under real keyboard focus; the index-keyed `{#each}` does not mis-bind
values (a token typed into row 1 correctly follows its server when row 0 is removed); and
`.placeholder` used for instructional prose is the established house convention, matching
`ByokSection` and `CodeHostSection`.

## Scorecard

| Dimension                       | Score | Rationale (one line)                                                                                                                                                                    |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Visual hierarchy & scanning  | pass  | Eyebrow → title → intro prose → row cards → actions reads in the same rhythm as its sibling coding sections; each row card groups its own controls and separates cleanly from its neighbours. |
| 2. Affordance & signifiers      | pass  | Every action is a real `Btn`/`IconButton`, the `Select` carries a chevron, and disabled controls dim visibly; nothing interactive is styled as plain text.                                |
| 3. Consistency w/ design system | pass  | `EmptyState` now used; `.settings-field__actions` carries a measured inset with its divergence from the siblings documented.               |
| 4. Feedback & state             | pass  | Duplicate and blank rows are both blocked with the reason named on the offending row, and the cap is stated beside Add.                    |
| 5. Content & language           | pass  | Error state names the failed operation; both dead ends carry a title and a next step.                                                      |
| 6. Accessibility                | warn  | Focus ring (2px, measured), tab order, semantics and label association all verified correct; but the status/error regions still mount with their text already inside them. |
| 7. Responsive / layout          | pass  | Measured at 640px: `scrollWidth === clientWidth === 640`, no overflow or clipping; the flex rows wrap cleanly and the credential input shrinks with the viewport.                          |
| 8. Spacing, alignment & sizing  | pass  | Measured: the actions row aligns to the card content edge on both sides, peer fields match in width.                                       |
| 9. Interaction & micro-states   | pass  | Both async actions announce via `aria-busy`; Remove locks with its siblings.                                                                |

## Findings

Severity-ranked, highest first.

### [High] The same MCP server can be selected twice and saved

- **Id:** coding-mcp-duplicate-server-saves-silently
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** Populated, after adding a row and re-picking a server already chosen in another row — measured live: `selectedServers: ['plugin:synthetic-web-search', 'search', 'plugin:synthetic-web-search']`, `duplicated: true`, `saveDisabled: false`
- **Source:** `client/settings/sections/CodingMcpSection.svelte:99` (`updateRowServer` does not check the other rows) and `:266` (Save's disabled predicate tests only `hasEmptyServer`)
- **Consequence:** The saved state is one the backend refuses. `src/coding-credentials/resolve-mcp-servers.ts:123-127` rejects a repeated selection, and the function is fail-closed and all-or-nothing (documented at `:94-97`), so a single duplicate costs the context **every** MCP server, not just the repeated one. The user is told nothing at save time and meets the failure later, inside a coding session, far from the settings page that caused it.
- **Suggested fix:** Treat a duplicate server as a validation failure the same way a blank one is — block Save and mark the offending row — or drop already-selected servers from the remaining rows' options so the state cannot be produced.

### [High] Save blocks on a blank server row without saying so

- **Id:** coding-mcp-blank-row-blocks-save-silently
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** `CodingMcp-—-a-blank-server-row-blocks-Save-1.png` — the row shows the "Select an MCP server…" placeholder with no error styling, and Save is greyed with nothing explaining why
- **Source:** `client/settings/sections/CodingMcpSection.svelte:266` (`hasEmptyServer` gates Save) and `:201` (the server `Field` never receives the `error` prop it already supports at `client/shared/ui/Field.svelte:23`)
- **Suggested fix:** Surface the blocking condition on the row that causes it via `Field`'s existing `error` slot, so the disabled Save has a visible cause.

### [Med] The error state headlines a raw exception and never says what failed

- **Id:** coding-mcp-error-state-buries-what-failed
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `settings-sections-CodingMcpSection-Error-1.png` — renders "Something went wrong" over a red `boom`
- **Source:** `client/settings/sections/CodingMcpSection.svelte:184` passes the raw exception as `message`; `client/shared/ui/ErrorState.svelte:13-14` documents `detail` as the slot for "Raw diagnostic text (e.g. an exception message) demoted to a collapsed disclosure"
- **Suggested fix:** Use the primitive as its contract intends — a plain-language `message` naming the failed operation, with the exception text moved to `detail`.

### [Med] The server cap disables Add with no indication a cap exists

- **Id:** coding-mcp-server-cap-unexplained
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** `CodingMcp-—-at-the-server-cap-1.png` — measured: `addDisabled: true`, `aria-describedby: null`, and the section's full text contains no mention of a limit
- **Source:** `client/settings/sections/CodingMcpSection.svelte:59` (`atCap`) and `:244`
- **Suggested fix:** State the operator limit near the Add control (a used-of-total count, or a line that appears on reaching it) so the dead button has a stated cause.

### [Med] The actions row is misaligned with the row cards on both edges

- **Id:** coding-mcp-actions-row-escapes-card-alignment
- **Status:** fixed
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated and `CodingMcp-—-populated-narrow-1.png` — measured at 1280px: card content starts at x=13 but "Add server" starts at x=0; Save's right edge is 1280.0, exactly the viewport boundary, against card content ending at 1197.3
- **Source:** `client/settings/sections/CodingMcpSection.svelte:321` — the local `.settings-field__actions` sets no `padding-inline`, while `CodingCredentialsSection.svelte:419` and `CodeHostSection.svelte:378` both carry `padding-inline: 14px` with comments explaining it lands the row on the cards' content edge
- **Suggested fix:** Bring this row's inset into line with the two sibling sections that already solved the same alignment, rather than leaving the primary action flush against the viewport.

### [Med] Two peer fields in one row differ in width by nearly 4×

- **Id:** coding-mcp-peer-field-widths-diverge
- **Status:** fixed
- **Dimension:** 8. Spacing, alignment & sizing
- **Where visible:** Populated and at-cap — measured: the server `<select>` is 152.0px inside a 566.1px flex item while the credential `<input>` is 584.1px inside a 606.1px one, leaving ~390px of dead space between the select and the "CREDENTIAL" label
- **Source:** `client/settings/sections/CodingMcpSection.svelte:315` — `.settings-mcp__field :global(.ui-input) { width: 100% }` stretches the Input but has no counterpart for the Select, so the Select keeps its intrinsic width at every viewport (152px at both 1280px and 640px)
- **Suggested fix:** Have the server control fill its flex item the way the credential control does, so the two fields read as a matched pair.

### [Med] Save and Clear change their label while saving but never announce it

- **Id:** coding-mcp-async-actions-never-announce-busy
- **Status:** fixed
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in a still frame — measured: Save reports `aria-busy="false"`, and neither button is passed the `busy` prop that `client/shared/ui/Btn.svelte:53` forwards to `aria-busy`
- **Source:** `client/settings/sections/CodingMcpSection.svelte:262` (Save) and `:250` (Clear) — both drive only the visible label from `saving` / `clearing`
- **Suggested fix:** Pass the existing in-flight flags through `Btn`'s `busy` prop so the state reaches assistive tech, matching the treatment the Refresh `IconButton` already gets at `:174`.

### [Low] Remove stays clickable while every other control locks during a save

- **Id:** coding-mcp-remove-live-during-save
- **Status:** fixed
- **Dimension:** 9. Interaction & micro-states
- **Where visible:** Not visible in a still frame — source-confirmed asymmetry
- **Source:** `client/settings/sections/CodingMcpSection.svelte:228` — the Remove `Btn` takes no `disabled` prop, while the row's `Select` (`:206`) and the Add button (`:244`) both carry `disabled={saving || loading}`
- **Suggested fix:** Give Remove the same in-flight guard as its siblings so the row set cannot change underneath an in-flight save.

### [Low] Both empty states are bare prose rather than the shared empty-state primitive

- **Id:** coding-mcp-empty-states-are-bare-prose
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** `settings-sections-CodingMcpSection-Empty-1.png` (an intro paragraph and a bare button row, no title or next step) and `settings-sections-CodingMcpSection-No-catalog-1.png` (a single dim line)
- **Source:** `client/settings/sections/CodingMcpSection.svelte:190` and `:192`; the `EmptyState` primitive used by sibling sections is not imported here
- **Suggested fix:** Render both dead-end states through the shared `EmptyState` so each gets a title and an actionable next step instead of muted body copy.

### [Low] Status and error regions mount with their announcement already inside them

- **Id:** coding-mcp-live-region-mounts-with-text
- **Status:** open
- **Dimension:** 6. Accessibility
- **Where visible:** Not visible in a still frame — source-confirmed
- **Source:** `client/settings/sections/CodingMcpSection.svelte:178`, `:179`, `:187` — each is `{#if x !== null}<p role="alert">{x}</p>{/if}`, so the live region is created with its text rather than filled after mount
- **Suggested fix:** Keep the container mounted and empty, writing the message into it afterwards, per the WAI-ARIA APG live-region guidance. Note this is the same module-wide pattern recorded as `admin-users-live-region-mounts-with-text`; it likely warrants a single cross-section change rather than a per-section fix. This sub-project added another instance of the same pattern: `Field.svelte`'s error span carries `role="alert"` and is now mounted already populated by the per-row validation, so the cross-section fix must also cover `Field`'s error slot, not only this component's local status/error paragraphs.
