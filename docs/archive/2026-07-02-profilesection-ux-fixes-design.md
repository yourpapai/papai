<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — ProfileSection UX fixes

**Date:** 2026-07-02
**Source review:** [`docs/ux-reviews/ProfileSection.md`](../../ux-reviews/ProfileSection.md) (9-dimension rubric re-review)
**Status:** design approved; ready for implementation plan.

## Context

The ProfileSection UX review surfaced 8 findings (4 Med, 4 Low). Several are not
ProfileSection-local — they live in shared code and recur across every settings section that
renders config fields:

- **`ConfigFieldRow`** is used by 3 sections: `ProfileSection`, `TaskProviderSection`,
  `AiOutputSection`. All three use the identical `onSaved={() => void load(contextId)}`
  full-reload pattern with a `loading = true` → `<p class="placeholder">Loading…</p>` swap.
- **`EmptyState`** is used by ~12 files, so its hint contrast affects the whole app.
- **`Btn` / `Input` / `IconButton`** radii and the spacing scale are design-system-wide.

This design fixes all 8 findings. Scope was chosen as the **full design-system sweep**: the
shared component fixes plus the app-wide token changes.

## Decisions (locked)

| Decision                | Choice                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Loading-flash approach  | **Keep fields on refresh** — full "Loading…" only on initial load, not on post-save refetch. |
| "Clear" button variant  | **`outline`** — real button shape, calm; destructiveness stays gated by the confirm dialog.  |
| Radius reconciliation   | **Sharpen the outlier** — new `--radius-control: 2px`; `IconButton` joins `Btn`/`Input`.     |
| Token findings (2× Low) | **Fold in** (full sweep), not deferred.                                                      |

## Non-goals

- No change to the config API, `fetchConfig`/`patchConfig`/`unsetConfigField`, or field
  schemas.
- No optimistic-inline-update rewrite of the save data-flow (considered and rejected for this
  pass — bigger change, staleness edge cases).
- No broad `--fg3`/`--text-dim` contrast audit beyond the flagged `EmptyState` hint. Other
  dim-grey text is out of scope.
- No rework of `TaskProviderSection` / `AiOutputSection` section-specific copy or layout; they
  benefit only from the shared component + token changes.

## Changes

Organized by blast radius: shared components, ProfileSection-local, and design-system tokens.

### A. Shared components (benefit Profile + TaskProvider + AiOutput)

**A1. Loading-flash — keep fields on refresh (dim 9, Med)**

- **Problem:** `onSaved` re-runs `load()`, which sets `loading = true`
  (`ProfileSection.svelte:30`) and renders the full-section `Loading…` placeholder
  (`:55`) in place of every field on each save/clear.
- **Fix:** guard the placeholder so it only renders on the initial load (no data yet). Change
  the template branch to the effect of `{:else if loading && visible.length === 0}`. On a
  post-save refetch the fields stay on screen; the header `⟳` `IconButton` already spins via
  `busy={loading}`, which becomes the refresh signal. The per-row `Saving…` label on the Save
  button (`ConfigFieldRow.svelte:153`) remains the write-in-progress signal.
- **Applies to:** `ProfileSection.svelte`, `TaskProviderSection.svelte`, `AiOutputSection.svelte`
  (same guard; each keeps its own extra placeholders).
- **Refetch-failure behavior:** if a post-save refetch errors, the error branch renders the new
  `ErrorState` (see A2) — acceptable for an error path; retaining last-good fields on refetch
  error is explicitly out of scope.

**A2. Error state — framed message + retry (dim 4, Med; also resolves dim 2 glyph-only retry, Low)**

- **Problem:** the error branch renders the raw server message as a bare red line
  (`ProfileSection.svelte:53`, `<p class="status-error">{error}</p>`); the only retry is the
  unlabeled header `⟳` glyph.
- **Fix:** new shared component **`client/shared/ui/ErrorState.svelte`**, mirroring
  `EmptyState`'s centered/framed layout for consistency.
  - **Props:** `message: string` (required), `title?: string` (default e.g. "Something went
    wrong"), `onRetry?: () => void`, `retryLabel?: string` (default "Try again"),
    `icon?: string`.
  - **Renders:** icon + title + message; when `onRetry` is set, a labeled `Btn`
    (`variant="outline"`, matching the calm-outline choice for Clear) that calls `onRetry`.
  - The message text keeps the `--danger` accent; framing/title use standard fg tokens so it
    reads as recoverable, not alarming.
- **Adoption:** replace the raw error `<p>` in all three sections with
  `<ErrorState message={error} onRetry={() => void load(contextId)} />`.
- The header `⟳` stays as a manual refresh, but is no longer the _only_ recovery path.

**A3. "Clear" affordance — outline + right-align (dim 2, Med)**

- **Problem:** `ConfigFieldRow` renders Clear (and the enum-row Clear) as `variant="ghost"`
  (`:118`, `:138`) — transparent bg, `--fg2` text, transparent border — so at rest it is
  indistinguishable from the label; a background only appears on hover. It opens a _danger_
  confirm yet carries no button affordance.
- **Fix:**
  - Change the Clear buttons from `ghost` to **`outline`** (neutral bordered button). The
    existing `Confirm` dialog continues to gate the destructive action, so `danger` red on
    every row is unnecessary.
  - Separate the actions from the label: push Clear/Replace to the right edge of
    `.settings-field__head` (e.g. `margin-left: auto` on the trailing action group) so they no
    longer read as label metadata.
- **Applies to:** both the enum branch and the text/secret branch of `ConfigFieldRow`.

### B. ProfileSection-local

**B1. Empty state — actionable next step (dim 5, Med)**

- **Problem:** `EmptyState` is rendered with no `action` snippet
  (`ProfileSection.svelte:57`), so "No profile settings" is a dead end on the default landing
  view.
- **Fix:** pass an `action` snippet — a link/`Btn` to a real next step, **"Configure task
  provider →"** targeting `#task-provider` — and sharpen the hint copy to, e.g., "Personal
  preferences will appear here once this context has editable settings." (Uses `EmptyState`'s
  existing `action` support. Copy is a concrete proposal, adjustable during implementation
  without reopening the design.)

**B2. Sparse layout — section intro (dim 7, Low)**

- **Problem:** the single-field populated view leaves a large empty expanse below.
- **Fix:** add a one-line intro under the `PageHeader` describing what Profile controls —
  "Personal preferences for how the bot addresses and responds to you." — giving the
  single-field state visual balance. (Concrete proposal, adjustable during implementation.)

### C. Design-system tokens (app-wide)

**C1. EmptyState hint contrast (dim 6, Low)**

- **Problem:** `.ui-empty__hint` uses `--fg3` (`--text-dim` `#6b766e`) at 11px on `--bg`
  `#0a0c0a` ≈ 4:1 — below WCAG AA 4.5:1 for normal text.
- **Fix:** change `.ui-empty__hint` color from `--fg3` to **`--fg2`** (`--text-muted`
  `#9aa79d`, ≈ 7:1 — passes AA). One edit in `EmptyState.svelte`; benefits all ~12 users. A
  size bump cannot fix 11px normal text (would need ≥24px), so this must be a color change.

**C2. Radius reconciliation (dim 8, Low)**

- **Problem:** `Btn` (`:54`) and `Input` (`:57`) use `border-radius: 2px`; `IconButton`
  (`:37`) uses `var(--radius)` (6px). Adjacent controls (header refresh vs field Save/input)
  have different corners.
- **Fix:** add token **`--radius-control: 2px`** to `tokens.css` and point `Btn`, `Input`, and
  `IconButton` at it. Only the icon-button visibly changes (6px → 2px); the app's existing
  sharp control aesthetic is preserved. `--radius` (6px) / `--radius-pill` remain for larger
  surfaces.

**C3. Spacing tokenization (dim 8, Low)**

- **Problem:** field spacing is hardcoded px off the `--gap-*` scale (which only defines
  12/20/40/64): `ProfileSection.svelte:70` list `gap: 12px`; `ConfigFieldRow.svelte`
  `.settings-field gap: 8px` / `padding: 12px` (`:182-183`), `__head gap: 10px` (`:190`),
  `__editor gap: 8px` (`:200`).
- **Fix:** add one tighter semantic token **`--gap-tight: 8px`** to the `--gap-*` family for
  intra-row/control spacing, then replace the hardcoded values:
  - field-list gap 12px → `--gap-inline`;
  - `.settings-field` gap 8px / `__editor` gap 8px → `--gap-tight`;
  - `.settings-field__head` gap 10px → `--gap-tight` (a ~2px normalization, accepted to avoid a
    one-off 10px token) — or `--gap-inline` if the label/action separation needs the extra
    room — but this design picks `--gap-tight` for consistency;
  - `.settings-field` padding 12px → `--gap-inline`.
- Net: visuals essentially unchanged; arbitrary px removed.

## Affected files

| File                                                  | Change                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `client/shared/ui/ErrorState.svelte`                  | **new** shared error component (A2)                                              |
| `client/shared/ui/EmptyState.svelte`                  | hint color `--fg3` → `--fg2` (C1)                                                |
| `client/shared/ui/Btn.svelte`                         | radius `2px` → `var(--radius-control)` (C2)                                      |
| `client/shared/ui/Input.svelte`                       | radius `2px` → `var(--radius-control)` (C2)                                      |
| `client/shared/ui/IconButton.svelte`                  | radius `var(--radius)` → `var(--radius-control)` (C2)                            |
| `client/shared/tokens.css`                            | add `--radius-control: 2px`, `--gap-tight: 8px` (C2, C3)                         |
| `client/settings/components/ConfigFieldRow.svelte`    | Clear `ghost` → `outline`, right-align actions, tokens (A3, C3)                  |
| `client/settings/sections/ProfileSection.svelte`      | loading guard, ErrorState, EmptyState action, intro, tokens (A1, A2, B1, B2, C3) |
| `client/settings/sections/TaskProviderSection.svelte` | loading guard, ErrorState (A1, A2)                                               |
| `client/settings/sections/AiOutputSection.svelte`     | loading guard, ErrorState (A1, A2)                                               |
| `client/shared/ui/ErrorState.stories.svelte`          | **new** story for the error component (states)                                   |

## Testing

- **Storybook / visual (`bun shoot`):** add an `ErrorState` story; re-shoot `ProfileSection`
  (all states incl. the save/clear interaction — confirm no full-section flash, outline Clear,
  new ErrorState, empty-state action, intro) plus `TaskProviderSection` and `AiOutputSection`
  populated + error, at desktop and ~640px.
- **Unit/DOM (`bun test`):** if `ErrorState` warrants it, a light render test that the retry
  callback fires. Follow existing `client/` component test patterns; no new heavy harness.
- **Accessibility check:** confirm the `EmptyState` hint now meets AA (`--fg2` on `--bg`), and
  that `ErrorState`'s retry is a real `<button>` with a text label.
- **Regression watch (token sweep):** radius change touches every `Btn`/`Input`/`IconButton`;
  spacing tokens touch every config field. Visually confirm no unintended shifts in a couple of
  unrelated sections that use these primitives.

## Rollout / sequencing note

Suggested implementation order (finalized in the plan): tokens (C) → shared components
(A2 `ErrorState`, A3 `ConfigFieldRow`) → per-section wiring (A1 guard + A2 adoption across the
3 sections) → ProfileSection copy/action (B) → re-shoot + verify. This lands the low-risk token
and shared pieces first, then the section wiring on top.
