<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — McpSection UX fixes

**Date:** 2026-07-08
**Source review:** [`docs/ux-reviews/McpSection.md`](../../ux-reviews/McpSection.md)
**Target:** `client/settings/sections/McpSection.svelte` + two shared `client/shared/ui/` additions
**Scope:** all 10 findings from the review (2 High, 4 Med, 4 Low)

## Goal

Resolve every finding in the McpSection UX review. Two findings have root causes in
shared code (the app-wide low-contrast `Field` hint, and the absence of a themed boolean
control); per the agreed boundary decision, those are fixed **at the shared layer** so the
whole app benefits, rather than patched locally. Everything else is contained to
`McpSection.svelte` plus one small, testable validation helper.

## Decisions (agreed during brainstorming)

1. **Scope:** address all 10 findings, not a subset.
2. **Change boundary:** root-cause fixes at the shared layer for the hint contrast and the
   boolean control.
3. **Boolean control:** a themed **checkbox** (square, accent-green check, mono label) — not
   a sliding switch — to match the terminal/mono aesthetic and `--radius-control`.
4. **Validation:** inline per-field error + **disabled Save**; errors reveal on **blur**
   (touched), never on a pristine row or mid-typing.
5. **Structure (Approach C):** extract the two seams that benefit from isolation — the
   reusable `Checkbox` primitive and a pure `validateMcpEndpoint` helper — but keep the
   endpoint-row markup inline in `McpSection`. A full `EndpointRow` extraction is an
   explicit later escalation only if the file grows uncomfortable.

## Architecture

Three units, each independently understandable and testable:

- **`client/shared/ui/Checkbox.svelte`** — reusable themed boolean control. Depends only on
  design tokens. Consumers pass state + `onChange`.
- **`client/settings/lib/` — `validateMcpEndpoint(endpoint)`** — pure function, no DOM, no
  side effects. Single source of truth for endpoint validity, used by both the inline field
  error and the Save-gating aggregate so the two can never disagree.
- **`client/settings/sections/McpSection.svelte`** — consumes the above; owns list state,
  touched state, layout, empty state, and save.

The server (`src/mcp/types.ts`, `src/debug/settings/mcp-routes.ts`) is **unchanged**; the
client mirrors `mcpEndpointConfigSchema` for pre-submit validation.

---

## Section 1 — Shared additions

### 1a. `Checkbox.svelte` (new)

The app has no themed boolean control today; section-level booleans use a `Btn` variant-swap,
and the only inline booleans are raw `<input type="checkbox">` (McpSection here, and
`AdminCodingGuardrailsSection`), which render browser-default blue. `accent-color` is used
nowhere in the app.

- **API:** `{ checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean; testid?: string }`.
- **Markup:** a real `<label>` wrapping a native `<input type="checkbox">` — accessible name
  via the wrapping label, keyboard-reachable by default.
- **Theming:** `accent-color: var(--accent)` for the green checked fill (the browser
  auto-contrasts the checkmark, matching the primary `Btn`). Label text reuses the `Field`
  label treatment (mono, 10px, uppercase, `--fg3`, letter-spacing) so it reads consistently
  beside sibling field labels.
- **Focus:** explicit `input:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-ring-offset) }`
  so it uses the app's green ring, not just the browser default.
- **Story:** `Checkbox.stories.svelte` — on / off / disabled.
- **Reuse:** `AdminCodingGuardrailsSection`'s raw checkboxes can adopt it later; **out of
  scope** for this pass to keep the diff focused.

### 1b. `Field` hint legibility (root-cause)

`Field`'s `.ui-field__hint` uses `--fg4` (`#3a4248`), ~1.6:1 on the card surface — well under
WCAG AA. Raising the `--fg4` **token** is wrong: it has ~23 unrelated uses (Pill "mute", KV
dim, `Secret`, `TreeView`, admin/debug CSS…) and would relight all of them.

- Add a dedicated **`--fg-hint`** token in `client/shared/tokens.css`, tuned to **≥4.5:1** on
  the panel/card surfaces (approximately `#8b978c`; exact value validated against
  `--surface-1`/`--surface-2` at implementation), positioned _below_ body text so hierarchy
  is preserved.
- Point `Field`'s `.ui-field__hint` **and** `EmptyState`'s hint (same `--fg4` issue) at
  `--fg-hint`.
- **Accepted trade-off:** stories rendering a `Field` hint or `EmptyState` hint re-baseline.

---

## Section 2 — Endpoint row layout & empty state (`McpSection.svelte`)

### 2a. Primary line: grow the URL (H1) + pin trailing controls (M4)

Restructure each card's top line into two flex groups:

- **Left group (grows):** `Label` field at a modest basis (`flex: 0 1 200px`) + `URL` field
  that grows to fill (`flex: 1 1 320px`). The URL now consumes the free row width instead of
  truncating at ~200px while the row sits mostly empty.
- **Right group (pinned via `margin-left: auto`):** the new `Checkbox` ("Enabled") + the
  **Remove** button, promoted from `ghost` to **`outline`** so it reads as a real button, not
  static text beside the checkbox label. On narrow widths the trailing group wraps below
  cleanly (`flex-wrap`).

`Remove` uses `outline` (not `danger`): removal is only destructive on Save and the red
per-row treatment reads heavy across multiple rows; `outline` gives clear button affordance
while staying calm.

### 2b. Header-row baseline (M3)

The Name/Value misalignment comes from `align-items: end` while only the Value field carries
a hint. Switch the header row to **top-align** so Name and Value labels and inputs share
edges; the hint hangs below Value without shifting the row, and the remove `✕` is centered on
the input line rather than stretched to the hint's bottom.

### 2c. `Add header` sizing (L2)

`Add header` stretches full-width because its parent (`.settings-mcp__headers`) is
`display: grid`. Constrain the button (`justify-self: start`) so it matches the
natural-width `Add endpoint` / `Save` buttons.

### 2d. Tokens, radius, semantics (L1, L4)

- Replace hardcoded `12px` / `8px` with `--gap-inline` / `--gap-tight` (and `--gap-tight`
  for the ~6–8px inline gaps). Where no exact token exists, use the nearest scale value.
- Add `border-radius: var(--radius)` to the endpoint card (`.settings-mcp__row`).
- Promote the "Auth headers" / "Tool filter" groupings from `<p>` labels to
  `<fieldset>` + `<legend>` (styled to match today's small mono label look) so grouped
  form controls are semantically grouped for assistive tech.

### 2e. Empty state (H2)

When loaded with **zero** endpoints, render the shared `EmptyState`:

> **No MCP endpoints** — "Connect an external MCP server to add its tools to this context."

with its `action` snippet holding a **primary** `Add endpoint` button. In the empty case the
bottom actions bar — including the green `Save`-with-nothing-to-save — is **hidden**, so the
only offered action is the meaningful one (fixes the hierarchy inversion). Once ≥1 row exists,
the bottom bar returns with `Add endpoint` (secondary) + `Save` (primary).

---

## Section 3 — Inline validation & disabled Save (M2)

### 3a. Pure helper

`validateMcpEndpoint(endpoint): { url?: string }` in `client/settings/lib/`, mirroring
`mcpEndpointConfigSchema`:

- URL empty after trim → `"URL is required."`
- URL present but not a valid `https://` URL → `"URL must start with https://"`
- `id` is generated internally (`srv-N`) and `label` is optional → neither is user-validated.
- Header rows with a blank name are already dropped on save (`fromHeaderRows`) → no error.

This function is the shared seam feeding both the inline error and the Save gate.

### 3b. Blur-triggered inline error

Track which URL fields have been **touched** (blurred). The inline error renders only when a
field is **touched _and_ invalid** — never on a pristine new row or mid-typing
(`https:` en route to `https://`). Passing it to the URL `Field`'s existing `error` prop gives
the red border, `role="alert"`, and `aria-invalid` already wired in `Field`/`Input`.

This needs one small shared addition: an **`onBlur?: () => void`** prop on `Input` (it exposes
`onInput` but no blur hook today).

### 3c. Save gating

`const hasErrors = $derived(rows.some(r => validateMcpEndpoint(r.endpoint).url !== undefined))`;
Save becomes `disabled={saving || hasErrors}`. Because pristine rows show no red, the
"why is Save disabled?" signal for a brand-new blank row is the **visibly empty required URL
field itself** + the disabled button — the conventional non-aggressive pattern. Red errors
appear only once a field has been edited and left holding a bad value.

### 3d. Server-error fallback

The client now blocks invalid URLs before submit, so the generic 422 should rarely fire; the
existing top `status-error` banner stays as a fallback for genuine server/network failures
(auth, unreachable, unexpected 5xx).

---

## Testing & verification

**New tests**

- **`validateMcpEndpoint` unit tests** (pure, no DOM): empty/whitespace → required;
  `http://…`, `ftp://…`, non-URL text → https message; valid `https://…` → no error. Mirror
  the path convention of existing `client/settings/lib` tests under `tests/`.
- **`Checkbox.stories.svelte`** → on / off / disabled; baseline via `bun shoot`.

**Updated visual states (McpSection)** — promote the review's manual states (populated,
narrow-640, header-row expanded, long-content) into the regression set and add two: **empty
state** (EmptyState + primary Add) and **touched-invalid URL** (red inline error + disabled
Save). Existing states re-baseline for the new layout.

**Expected re-baselines** — the `--fg-hint` change re-shoots any story showing a `Field` or
`EmptyState` hint across sibling sections; the checkbox/`Btn`/layout changes re-shoot
McpSection. All via `bun shoot`; no logic changes elsewhere.

**Server** — unchanged; `mcp-routes.ts` and its tests stay as-is.

**Verification gate** — `bun shoot` (visual), the new unit tests, and typecheck/lint via the
write hooks.

## Finding-coverage map (all 10)

| #   | Finding                              | Design element                                        |
| --- | ------------------------------------ | ----------------------------------------------------- |
| H1  | Cramped URL field                    | 2a — URL field grows to fill the row                  |
| H2  | Dead-end empty state                 | 2e — EmptyState + primary Add, Save hidden when empty |
| M1  | Native blue checkbox                 | 1a — themed `Checkbox` primitive                      |
| M2  | No inline URL validation             | 3 — `validateMcpEndpoint`, blur error, disabled Save  |
| M3  | Header-row Name/Value baseline       | 2b — top-align header row                             |
| M4  | Weak "Remove" affordance             | 2a — `outline` variant, pinned trailing group         |
| L1  | Hardcoded spacing                    | 2d — gap tokens                                       |
| L2  | Stretched `Add header` button        | 2c — `justify-self: start`                            |
| L3  | Low-contrast hint text               | 1b — new `--fg-hint` token (shared)                   |
| L4  | No card radius / non-semantic groups | 2d — `--radius` + `<fieldset>`/`<legend>`             |

## Out of scope

- Migrating `AdminCodingGuardrailsSection`'s raw checkboxes to the new `Checkbox` (follow-up).
- Any server-side change.
- Full extraction of an `EndpointRow` component (escalation only if the file grows unwieldy).
- Remove-confirmation dialog (removal is recoverable pre-Save; not flagged by the review).
