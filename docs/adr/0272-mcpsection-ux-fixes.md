<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0272: MCPSection UX Fixes

## Status

Implemented (with divergence)

## Date

2026-07-08

## Context

`McpSection` (`client/settings/sections/McpSection.svelte`) — the settings section for editing a context's MCP endpoints (URL, auth headers, tool filter) — had ten UX-review findings (`docs/ux-reviews/McpSection.md`): the URL field was cramped at a fixed ~200px while the row sat mostly empty (H1); a loaded-with-zero-endpoints state dead-ended on a green **Save**-with-nothing-to-save with no empty affordance (H2); the per-endpoint **Enabled** toggle was a browser-default blue `<input type="checkbox">` that broke the terminal aesthetic (M1); there was no inline URL validation and an invalid URL could only fail server-side with a generic banner (M2); the Name/Value header-row fields misaligned because only Value carried a hint (M3); **Remove** was a `ghost` button that read as static text (M4); spacing was hardcoded `12px`/`8px` rather than tokens (L1); **Add header** stretched full-width because its grid parent (L2); the `Field` hint used `--fg4` (`#3a4248`, ~1.6–1.8:1 on the card surface — well under WCAG AA) (L3); and the endpoint card had no radius and grouped its "Auth headers"/"Tool filter" sections with non-semantic `<p>` labels (L4).

The design (`docs/superpowers/specs/2026-07-08-mcpsection-ux-fixes-design.md`) and plan (`docs/superpowers/plans/2026-07-08-mcpsection-ux-fixes.md`) resolved all ten by fixing two findings at the **shared layer** so the whole app benefits (a themed `Checkbox` primitive for M1, and a legible `--fg-hint` design token for L3, repointing only the `Field` hint so ~23 unrelated `--fg4` consumers are untouched) plus an additive `onBlur` hook on `Input`; extracting one pure, unit-tested helper (`validateMcpEndpoint`) as the single source of truth for endpoint validity feeding both the blur-triggered inline error and the Save gate; and rewriting `McpSection` to consume all of them (growing URL field, pinned trailing controls, `<fieldset>`/`<legend>` groups, an `EmptyState` that hides the bottom bar, blur-revealed inline errors, and a disabled Save). The server (`src/mcp/types.ts`, `src/debug/settings/mcp-routes.ts`) is unchanged; the client mirrors `mcpEndpointConfigSchema`.

## Decision Drivers

- **Fix root causes at the shared layer where the cause is shared.** The low-contrast `Field` hint and the missing themed boolean control affect the whole app, not just `McpSection`; patching them locally would leave the root cause for every sibling section (Findings L3, M1).
- **A dedicated hint token, not a token-value bump.** Raising `--fg4` itself would relight ~23 unrelated consumers (Pill "mute", KV dim, `Secret`, `TreeView`, admin/debug CSS); add `--fg-hint` tuned to ≥4.5:1 and point only `Field`'s hint at it (Finding L3).
- **Themed checkbox, not a switch.** A square, accent-green-check checkbox matching the mono/terminal aesthetic and `Field`'s label treatment, using native `<input type="checkbox">` for keyboard accessibility (Finding M1).
- **One validator, two consumers, never disagree.** A pure `validateMcpEndpoint` helper is the single seam feeding both the inline field error and the Save-gating aggregate (Finding M2).
- **Errors reveal on blur, never mid-typing or on a pristine row.** Track touched fields; a red error appears only for a touched-and-invalid URL so the user is not shouted at while typing `https:` (Finding M2).
- **Grow the URL, pin the controls, hide Save when empty.** The URL consumes free row width; trailing controls pin right; an empty list renders `EmptyState` with the single meaningful action and no Save bar (Findings H1, H2, M4).
- **Semantic groups, tokens, and radius.** Promote groupings to `<fieldset>`/`<legend>`, replace hardcoded spacing with gap tokens, and round the card (Findings L1, L4).
- **Additive-only shared changes.** The `--fg-hint` token and `Input.onBlur` are additive; existing `Input` callers pass no `onBlur` and are unaffected.

## Considered Options

### Option 1 — shared `Checkbox` + `--fg-hint` + `validateMcpEndpoint` helper; row markup kept inline (chosen, Approach C)

Add `--fg-hint` (point only `Field`'s hint at it), build a themed `Checkbox.svelte`, add an `onBlur` hook to `Input`, extract a pure `validateMcpEndpoint` helper as the single validity source, and rewrite `McpSection` to consume all of them with blur-revealed inline errors + a disabled Save. Keep the endpoint-row markup inline rather than extracting an `EndpointRow` component.

- **Pros:** directly resolves all ten findings; the shared additions benefit the whole app; the pure helper keeps inline-error and Save-gate in lockstep; additive `Input` change has minimal blast radius; an inline row keeps the file at a comfortable size without a premature component extraction.
- **Cons:** adds two shared files and a helper module; the rewrite touches the whole section in one task; sibling stories re-baseline from the `--fg-hint` change (accepted app-wide re-baseline).

### Option 2 — Patch all findings locally inside `McpSection`

Leave `Field`/`Input`/`tokens.css` alone; fix the hint contrast with a local override, the checkbox with a local styled control, and validation inline.

- **Pros:** no shared-primitive change; smallest blast radius; no sibling re-baseline.
- **Cons:** rejects the root-cause driver — the low-contrast hint and the missing themed control are app-wide; duplicates work every sibling section would later repeat; leaves `--fg4` as a latent footgun; a local checkbox control duplicates what a shared primitive should be.

### Option 3 — Full `EndpointRow` component extraction

Extract each endpoint card into an `EndpointRow.svelte` component alongside the helper and shared primitives.

- **Pros:** isolates the per-row layout/validity concerns; shrinks `McpSection`.
- **Cons:** premature — the file is comfortable at its current size; the row shares list-level state (touched set, payload build) with the section, so extraction would thread callbacks and split cohesive logic; the spec explicitly deferred this to an escalation only if the file grows unwieldy.

## Decision

The chosen Option 1 shipped across the shared token, the new `Checkbox` primitive, the `Input` blur hook, the pure validator and its tests, the rewritten section, the stories, and the visual specs. What shipped:

1. **`--fg-hint` design token** (`client/shared/tokens.css`). New `--fg-hint: #8b978c` (≥4.5:1 on `--surface-1`/`-2`, measures ~6:1), positioned below body text to preserve hierarchy.
2. **`Field` hint repointed.** `.ui-field__hint` color moved from `--fg4` to `--fg-hint`; `EmptyState`'s hint is intentionally untouched (it already used `--fg2`).
3. **Themed `Checkbox` primitive** (`client/shared/ui/Checkbox.svelte`). `{ checked, label, onChange, disabled?, testid? }`; a real `<label>` wrapping a native `<input type="checkbox">` with `accent-color: var(--accent)` (green fill), a mono uppercase label matching `Field`, and an intrinsic `:focus-visible` ring.
4. **`Input.onBlur` hook** (`client/shared/ui/Input.svelte`). New optional `onBlur?: () => void` wired to both the `<textarea>` and `<input>`.
5. **Pure `validateMcpEndpoint` helper** (`client/settings/lib/validate-mcp-endpoint.ts`). Mirrors `mcpEndpointConfigSchema`: empty-after-trim → `URL is required.`; not a parseable `https://` URL → `URL must start with https://`; else valid. Single source of truth for both the inline error and the Save gate.
6. **`McpSection` rewrite.** URL field grows (`flex: 1 1 320px`) beside a fixed-basis Label; trailing group pins right (`margin-left: auto`) holding the `Checkbox` + an `outline` **Remove**; auth-headers/tool-filter promoted to `<fieldset>`+`<legend>`; card gains `border-radius: var(--radius)`; hardcoded spacing replaced with `--gap-inline`/`--gap-tight`; a zero-endpoint load renders `EmptyState` with a primary **Add endpoint** and hides the bottom action bar.
7. **Blur-triggered inline validation + disabled Save.** `visibleUrlError(row)` returns the error only for touched rows; `hasErrors` is `$derived(rows.some(...))`; Save is `disabled={saving || hasErrors}`.
8. **Validator unit tests** (`tests/client/settings/lib/validate-mcp-endpoint.test.ts`): required/whitespace, non-https, non-http(s) scheme, unparseable text, bare `https://`, valid URL, trim-before-validate, plus two extra cases (uppercase `HTTPS://`, scheme-only `https:example.com`).
9. **Stories + visual specs.** `Checkbox.stories.svelte` (On/Off/Disabled) with a generated `Checkbox.spec.ts`; `McpSection.spec.ts` gained the `McpSection — invalid url touched` manual state (red inline error + disabled Save).

## Consequences

### Positive

- The `Field` hint now meets WCAG AA across every section that uses it, without disturbing the ~23 unrelated `--fg4` consumers.
- The MCP URL field consumes the free row width instead of truncating, and the **Enabled** toggle and **Remove** read as real controls pinned right.
- Invalid URLs are caught before submit with a clear inline error on blur, and Save stays disabled until the row is valid — the inline error and the Save gate can never disagree because they share one validator.
- A brand-new blank row shows no red (untouched); the disabled Save + visibly empty URL is the conventional non-aggressive signal.
- The empty state offers the single meaningful action and no longer shows a green Save-with-nothing-to-save.
- Grouped controls are now semantically grouped (`<fieldset>`/`<legend>`) for assistive tech, and the card carries the app's radius.
- The shared `Checkbox` and `Input.onBlur` are reusable; `AdminCodingGuardrailsSection`'s raw checkboxes can adopt it later.

### Negative

- The `--fg-hint` change re-baselines every story that renders a `Field` hint across sibling sections (the accepted app-wide re-baseline).
- `McpSection` remains a single file with inline row markup; if it grows uncomfortable, the deferred `EndpointRow` extraction is the documented escalation.
- The rewrite touched the whole section markup/style in one task, so the diff is large relative to a per-finding patch.

### Risks

- **Blast radius of the shared changes.** Any future edit to `--fg-hint` or the `Checkbox`/`Input.onBlur` contract must re-shoot affected stories and spot-check consuming sections.
- **Inline pass-through of server mutation errors.** The top `status-error` banner stays as the fallback for genuine server/network failures; a poor backend string could surface there.
- **`accent-color` check contrast is browser-controlled.** The green fill uses the browser's auto-contrasted checkmark; a future token change to a low-luminance accent could reduce check contrast, untested here.
- **`AdminCodingGuardrailsSection` still uses raw checkboxes.** Out of scope for this pass; the shared primitive exists but the migration is a documented follow-up.

## Related Decisions

- **ADR-0271: MCP Catalog Hardening** — the sibling MCP-area work shipped the same day; this ADR is papai settings-UI-only (`McpSection`) and does not touch the catalog, resolver, or server routes that ADR-0271 hardened.
- The `AiOutputSection`/`EmptyState` render-state conventions this rewrite mirrors, and the `Field` label treatment the `Checkbox` label reuses.
- **The `ReleaseSubscriptionSection` UX-fix pattern (ADR-0253)** — same shared-layer-first discipline (fix root causes in shared primitives, keep section changes additive where possible).

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/tokens.css:77` | `--fg-hint: #8b978c` token added below `--fg4`. | `read` confirms. |
| `client/shared/ui/Field.svelte:67` | `.ui-field__hint` color repointed to `var(--fg-hint)`. | `read` confirms. |
| `client/shared/ui/EmptyState.svelte:46-49` | `.ui-empty__hint` unchanged — still `var(--fg2)` (planning correction honored). | `read` confirms. |
| `client/shared/ui/Checkbox.svelte:7-13` | `Props { checked, label, onChange, disabled?, testid? }`. | `read` confirms. |
| `client/shared/ui/Checkbox.svelte:22-25` | `<label>` wrapping native `<input type="checkbox">`. | `read` confirms. |
| `client/shared/ui/Checkbox.svelte:50` | `accent-color: var(--accent)` (green check). | `read` confirms. |
| `client/shared/ui/Checkbox.svelte:53-56` | `input:focus-visible` ring via `--focus-ring`/`--focus-ring-offset`. | `read` confirms. |
| `client/shared/ui/Input.svelte:16,29` | `onBlur?: () => void` in `Props` + destructure. | `read` confirms. |
| `client/shared/ui/Input.svelte:64,80` | `onblur={onBlur}` wired to `<textarea>` and `<input>`. | `read` confirms. |
| `client/settings/lib/validate-mcp-endpoint.ts:16-26` | `validateMcpEndpoint` — trim → required; not-https → message; else valid. | `read` confirms. |
| `client/settings/lib/validate-mcp-endpoint.ts:19` | `startsWith('https://')` pre-check added beyond the plan. | `read` confirms. |
| `tests/client/settings/lib/validate-mcp-endpoint.test.ts:10-41` | 10 unit tests (plan specified 8; 2 extra for `HTTPS://` and `https:example.com`). | `read` confirms. |
| `client/settings/sections/McpSection.svelte:44` | `hasErrors = $derived(rows.some(... validateMcpEndpoint ...))`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:46-54` | `markTouched` + `visibleUrlError` (error only for touched rows). | `read` confirms. |
| `client/settings/sections/McpSection.svelte:182-189` | Zero-endpoints → `EmptyState` with primary **Add endpoint**; bottom bar hidden in this branch. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:201-209` | URL `Field` with `error={visibleUrlError(row)}` and `Input onBlur={() => markTouched(...)}`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:211-220` | Trailing `Checkbox` + `outline` **Remove** pinned via `margin-left: auto`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:223-224` | "Auth headers" group as `<fieldset>` + `<legend>`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:264-265` | "Tool filter" group as `<fieldset>` + `<legend>`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:287` | Save `disabled={saving || hasErrors}`. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:300-307` | `.settings-mcp__row` card with `border-radius: var(--radius)` + token gaps. | `read` confirms. |
| `client/settings/sections/McpSection.svelte:325-330` | Label `flex: 0 1 200px`; URL `flex: 1 1 320px` (grow). | `read` confirms. |
| `client/settings/sections/McpSection.svelte:347-354` | `.settings-mcp__legend { display: block }` (renders as a label, not on the separator). | `read` confirms. |
| `client/settings/sections/McpSection.svelte:359-363` | `.settings-mcp__group-hint` single group caption using `--fg-hint` (per-Value hint removed). | `read` confirms. |
| `client/shared/ui/Checkbox.stories.svelte:18-22` | On / Off / Disabled stories. | `read` confirms. |
| `tests/visual/shared/ui/Checkbox.spec.ts:9-24` | Generated On/Off/Disabled auto-screenshot tests. | `read` confirms. |
| `tests/visual/settings/sections/McpSection.spec.ts:74-80` | `McpSection — invalid url touched` manual screenshot state (fill `http://…` + blur). | `read` confirms. |

Plan-vs-implementation notes:

- **`validateMcpEndpoint` gained a `startsWith('https://')` prefix pre-check (commit `9b79e2a58` "mirror server https prefix check").** The plan relied solely on `new URL()` + a `protocol !== 'https:'` check. Shipped rejects before constructing the URL if it does not start with `https://`. This closes two cases `new URL()` alone would have wrongly accepted: scheme-only `https:example.com` (parses with protocol `https:` and a path, no host) and uppercase `HTTPS://example.com` (the server is case-sensitive on the prefix). Two extra unit tests cover these (`tests/client/settings/lib/validate-mcp-endpoint.test.ts:35-40`), bringing the suite from the plan's 8 to 10. Net behavior is stricter and matches the server prefix check.
- **`EmptyState` was intentionally not changed — a documented plan-vs-spec divergence.** The spec said to repoint _both_ `Field` and `EmptyState` hints at `--fg-hint`. The plan's "Planning correction vs spec" noted that `EmptyState`'s hint already uses `--fg2` (~7:1, legible) and only its decorative _icon_ uses `--fg4`; only `Field`'s hint needed the fix. Shipped honors the plan: `EmptyState.svelte:46-49` still uses `var(--fg2)`.
- **M3 (header-row baseline) was resolved differently from the spec.** The spec (2b) proposed top-aligning the header row (`align-items: start`) so Name/Value share edges with the hint hanging below Value. The plan (and shipped) instead kept `align-items: end` (`McpSection.svelte:368`) and removed the per-Value hint, moving it to a single `.settings-mcp__group-hint` caption; with both Name and Value fields hint-less and equal-height, the labels and inputs bottom-align cleanly with no baseline drift. Same UX outcome, different mechanism.
- **`Add header` sizing (L2) used a wrapper block, not `justify-self: start`.** The spec (2c) proposed `justify-self: start` to stop the full-width stretch. Shipped wraps the button in a block `<div class="settings-mcp__group-action">` so it renders at natural width within the grid; net effect (natural-width button) matches.
- **`.storybook-shots` PNG baselines are not present in this worktree** (generated artifacts, not committed source). Verification of the visual regression set is via the spec test definitions (`Checkbox.spec.ts`, `McpSection.spec.ts`), which define the On/Off/Disabled and the `invalid url touched` states; the PNGs themselves are regenerated by `bun shoot` and read back at implementation time per the plan's Task 6 Step 5.

The source plan `docs/superpowers/plans/2026-07-08-mcpsection-ux-fixes.md` and design `docs/superpowers/specs/2026-07-08-mcpsection-ux-fixes-design.md` are archived alongside this ADR to `docs/archive/`.
