<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0187: Settings Page Redesign

## Status

Implemented

## Date

2026-06-08

## Context

The `/settings` surface is a Svelte 5 (runes) SPA under `client/settings/`, bundled by a custom Bun pipeline (no Vite/`svelte.config.js`), with design tokens in `client/shared/tokens.css` shared by the debug, admin, and settings SPAs, and shared UI primitives under `client/shared/ui/`. Pre-redesign it was a flat single-scroll of sections with ad-hoc eyebrows ("Personal", "Admin · System") glued onto `PageHeader`, per-section "Refresh" text buttons, three independent permission `Btn`s per tool, a five-card System (LLM) block each carrying a standing "enter a new value" input, no confirmations on destructive actions (user remove, instance delete, plugin reject, announce broadcast), and a token set that predated the spec's vocabulary.

The 2026-06-08 plan was explicitly **gap-driven** against a greenfield spec whose "current state" assumptions did not match the code: a sticky left rail (`SettingsSidebar.svelte`), scroll-spy (`scrollspy.ts`), a 5-variant `Btn`, `DataTable`, `Pill`/`StatusPill`/`Dot`, `Input`/`Field`/`Select`/`Secret`, `PageHeader`/`Caption`, and `Confirm`/`Modal` already shipped, and `client/shared/tokens.css` was already shared across three SPAs. The plan therefore renamed tokens (keeping legacy aliases), added the few missing primitives, and re-wired the section layout rather than rebuilding — preserving the dark terminal/monospace aesthetic with no new colors or fonts.

## Decision Drivers

- **Preserve the terminal aesthetic** — no new colors or font families beyond the existing token set; only token renames and a single radius shift.
- **Gap-driven, not greenfield** — extend the existing rail, scroll-spy, `Btn`, `DataTable`, and `Confirm` rather than discarding working code and risking regressions across three SPAs.
- **Token compatibility** — debug and admin SPAs must keep rendering after the rename, so legacy token names survive as aliases.
- **Three-state tool permissions are real** — `allow`/`ask`/`deny` is wired to per-call gating in the tool pipeline; the affordance must stay 3-state, not collapse to a binary switch.
- **Density and safety** — compact the System (LLM) block into an inline-edit table, gate destructive actions behind confirmations, and make long platform IDs copyable.
- **Client-side search/pagination** (spec §8.2) — server-side paging is a future swap, out of scope; the `SettingsTable` API must accommodate it later without a rewrite.

## Considered Options

### Option 1: Full greenfield rebuild per spec

- **Pros:** clean spec vocabulary with no alias debt; no reconciliation table needed.
- **Cons:** discards the working rail, scroll-spy, and shared primitives; high regression risk across debug/admin/settings which share `tokens.css`; largest blast radius for the least structural gain.

### Option 2: Gap-driven extend + rename with legacy aliases (chosen)

- **Pros:** preserves working components; debug/admin SPAs untouched via aliases; incremental, low-risk; reuses `DataTable`/`Confirm`/`Btn` verbatim.
- **Cons:** carries legacy alias indirection; some spec claims required an explicit reality-reconciliation table; the radius shift must be audited.

### Option 3: Token rename only, defer structure

- **Pros:** minimal diff; lowest risk.
- **Cons:** leaves the flat layout, missing confirmations, and low density unaddressed; spec goals largely unmet; the work would need redoing.

## Decision

Six coordinated changes implement the redesign:

### 1. Token rename with legacy aliases (`client/shared/tokens.css`)

The `:root` block is rewritten to the spec vocabulary: surfaces (`--surface-1/2`, `--surface-hover`), foreground (`--text`, `--text-muted`, `--text-dim`), accent (`--accent: #52e08a`, `--accent-fg`, `--accent-soft`), state (`--state-active`, `--warn`, `--danger`, `--danger-surface`, `--info`), layout (`--content-max: 760px`, `--table-max: 1100px`, `--gap-group/section/field/inline`, `--radius: 6px`, `--radius-pill`, `--row-h`). Legacy names (`--surface`, `--raised`, `--hair`, `--fg`, `--fg2`, `--fg3`, `--fg4`, `--s1`–`--s9`) are retained as aliases so `client/debug/` and `client/admin/` resolve unchanged. `--success` is defined as `var(--accent)`, fixing a prior undefined reference. `--radius` shifts 2px→6px; legacy components hardcode `border-radius: 2px` inline and are unaffected — only settings components adopting `var(--radius)` become slightly rounder.

### 2. Type-scale utilities + layout primitives (`client/settings/settings.css`)

Composite type styles ship as utility classes: `.t-kicker`, `.t-section`, `.t-subhead`, `.t-label`, `.t-body`, `.t-help`, `.t-mono-data`. Layout primitives: `.settings-grid` (220px rail + `minmax(0,1fr)` main, collapses to one column under 720px), `.settings-group` (capped at `--content-max`; `--wide` variant at `--table-max`), `.settings-section` (`scroll-margin-top: 96px`), `.settings-form`, and a shared `.settings-grid :focus-visible` ring at reduced accent alpha.

### 3. Grouped sidebar rail + responsive jump menu

`SettingsSidebar.svelte` exports `SidebarGroup` (`kicker`, `items`, `danger`) and renders group kickers (PERSONAL / INTEGRATIONS / ADMIN), marks the active link with `aria-current`, and flags the Admin group as a danger zone (`settings-sidebar__group--danger`). `SettingsJumpMenu.svelte` is a `<select>` with `<optgroup>`s, shown only on narrow viewports, setting `location.hash` on change. `SettingsApp.svelte` builds a grouped `SidebarGroup[]` from role flags (`isBotAdmin`/`isSuperAdmin`), feeds the flattened id list to scroll-spy, and wraps section runs in `.settings-group` containers; the Admin run lives in `.settings-group--wide .settings-admin-zone`.

### 4. New shared/settings primitives

- `IconButton.svelte` (`client/shared/ui/`) — labelled glyph button with `--busy` state; collapses per-section "Refresh" text buttons into a single `⟳`.
- `SegmentedControl.svelte` (`client/shared/ui/`) — `role="radiogroup"` with `aria-checked` and arrow-key/space operability; replaces the three independent permission `Btn`s, preserving the `allow`/`ask`/`deny` model.
- `CopyButton.svelte` (`client/shared/ui/`) — clipboard write with `✓` feedback.
- `IdCell.svelte` (`client/settings/components/`) — middle-truncated value + `title` (full) + `CopyButton`.
- `SettingsTable.svelte` (`client/settings/components/`) — settings-scoped wrapper over `DataTable` adding a live search input, client-side pagination (default 25), a capped-height sticky-header scroll container, and row hover; reused by Users, Groups, Admins, Plugin approval.
- `SystemKvRow.svelte` (`client/settings/components/`) — inline-edit table row replacing the five standing-input System (LLM) cards.
- `mask-secret.ts`, `truncate-middle.ts` (`client/settings/lib/`) — pure helpers.

### 5. Three-button discipline, secret masking, and confirmations

`Provision Kaneo` normalizes to a content-width primary (not full-bleed); approve=primary, reject=danger. `maskSecret()` normalizes server `****WvfQ` to `••••WvfQ` at call sites (`ConfigFieldRow`, `SystemKvRow`) — masking stays in settings scope (no shared→settings import). `Confirm.svelte` gains a `danger` prop rendering a danger-variant confirm button; AdminUsers/Instances/Groups/Admins remove, instance delete/stop, plugin reject, announce broadcast, and secret-key saves all route through `Confirm danger`.

### 6. Admin danger zone (`.settings-admin-zone`)

The Admin group carries the rail danger badge (Task 3) and a visual divider: `border-top: var(--danger)` with an absolutely-positioned "ADMIN" kicker over the background. The two highest-blast-radius actions (broadcast announce, secret-key save) require confirmation.

## Consequences

### Positive

- Every section is reachable via the grouped rail; scroll-spy drives `aria-current` on the active link; a `<select>` jump menu covers narrow viewports.
- Legacy token aliases keep debug/admin SPAs rendering without a single edit to those trees.
- The segmented control preserves the 3-state permission model with proper radiogroup semantics and keyboard operability, replacing three ambiguous buttons.
- Destructive confirmations prevent accidental deletes/broadcasts; `IdCell` makes long platform IDs copyable instead of overflowing.
- System (LLM) compacts from five standing-input cards to one inline-edit table; `SettingsTable` adds live search, pagination, sticky headers, and hover to every admin list.
- No new colors or fonts; the terminal aesthetic is preserved.

### Negative

- **Legacy alias debt.** `--surface`/`--raised`/`--fg2`/`--s4` remain as indirection; a future debug/admin token migration needs a coordinated sweep to retire them.
- **`aria-current` value diverged from the plan's test literal.** The implementation uses `aria-current="page"` (correct WAI-ARIA) rather than the plan's `"true"`; tests were updated to match. This is an improvement, not a regression.
- **Client-side pagination caps practical roster size.** Thousands of users would need a server-backed fetcher; the `SettingsTable` API (`filtered`/`pageRows` derived state) can absorb that swap without an external change.
- **Domain-level tool permission left as a single cycle `Btn`.** Accepted per §6.4; not upgraded to a `SegmentedControl` for symmetry with the per-tool control.

### Risks

- **Radius shift (2px→6px).** Settings components adopting `var(--radius)` are slightly rounder; legacy components hardcode 2px and are unaffected. If product wants the old crispness, a single `--radius: 2px` override restores it, but new settings CSS must be audited against the assumption.
- **Group structure drifted after shipping.** The Integrations group was later wrapped in a collapsible "Advanced" disclosure (`settings-advanced`) by ADR-0208, and section membership/ordering in the Personal group grew (GuestMode, KaneoAccess, Memory, AI output, identity, BYOK). The literal two-group Personal/Integrations split in this plan is the baseline, not the current shape.

## Related Decisions

- ADR-0136, ADR-0137, ADR-0138: Settings Web UI — access model, HTTP API, and client SPA this redesign restructures.
- ADR-0188: AI Output settings — the `AiOutputSection` surfaced within the restructured settings surface.
- ADR-0208: Settings UI Advanced Grouping — the collapsible "Advanced" disclosure that later refined the Integrations group into Memory/AI output/identity/BYOK/integrations.

## Implementation Notes

Confirmed present in the repo:

- `client/shared/tokens.css` — spec vocabulary (`--surface-1`, `--text-muted`, `--content-max`, `--gap-group`, `--accent: #52e08a`) and legacy aliases (`--surface`, `--raised`, `--fg2`, `--s4`).
- `client/settings/settings.css` — `.t-*` type-scale utilities, `.settings-grid`, `.settings-group(--wide)`, `.settings-admin-zone`, `:focus-visible`.
- `client/settings/components/SettingsSidebar.svelte` — `SidebarGroup` export, `aria-current`, `settings-sidebar__group--danger`; also gained an `onToggle` prop for the later advanced disclosure.
- `client/settings/components/SettingsJumpMenu.svelte` — `<select>` jump menu importing `SidebarGroup`.
- `client/settings/components/SettingsTable.svelte` — `settings-table-search`, `pageSize` (default 25), `filtered`/`pageRows`, sticky header, hover.
- `client/settings/components/SystemKvRow.svelte` — inline-edit row, masked secret display, confirm-on-secret-save.
- `client/settings/components/IdCell.svelte` — `truncateMiddle` + `CopyButton`.
- `client/shared/ui/IconButton.svelte` — labelled glyph, `--busy`.
- `client/shared/ui/SegmentedControl.svelte` — `role="radiogroup"`, `aria-checked`, arrow-key nav.
- `client/shared/ui/CopyButton.svelte` — clipboard write, `✓` feedback.
- `client/shared/Confirm.svelte` — `danger` prop, danger-variant confirm button.
- `client/settings/SettingsApp.svelte` — grouped `SidebarGroup[]` builder, role-gated Admin group, `.settings-group` wrappers, `.settings-admin-zone`; the Integrations group is now a collapsible `.settings-advanced` disclosure.
- `client/settings/lib/mask-secret.ts`, `client/settings/lib/truncate-middle.ts` — pure helpers.
