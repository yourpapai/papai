<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — KaneoAccessSection UX fixes

**Date:** 2026-07-08
**Source review:** [`docs/ux-reviews/KaneoAccessSection.md`](../../ux-reviews/KaneoAccessSection.md)
**Target:** `client/settings/sections/KaneoAccessSection.svelte`
**Type:** Frontend recompose (presentation only; no backend/route/fetcher changes)

## Problem

`KaneoAccessSection` renders raw `<h2>`, `<button>`, `<dl>`, `<a>`, and a one-off `.error`
class with **zero shared design-system primitives**, while every sibling settings section
composes `PageHeader` / `KV` / `Secret` / `ErrorState` / `EmptyState`. The result is
UA-default styling (grey native button, browser-default `#0000EE` links, cramped `dl`
margins) on a core, security-sensitive surface — the one-time Kaneo password reveal. The
UX review raised 9 findings (4 fail / 4 warn / 1 pass); nearly all trace to this single
root cause.

## Goal

Recompose the section onto the canonical sibling pattern (as used by
`CodingCredentialsSection` / `TaskProviderSection`), resolving all 9 findings in one
coherent pass, while preserving existing behavior: initial load, `404 → not provisioned`,
error handling, and the one-time password reveal.

## Non-goals

- **No backend changes.** `/settings/api/kaneo/credentials`, the reveal endpoint, and the
  `fetchers.ts` helpers are untouched.
- **No new provisioning action.** Provisioning already lives, scope-gated, in the Task
  Provider section (`provisionKaneo()`); this read-only "my access" view will not duplicate
  it. The not-provisioned state stays informative.
- **No client-side Hide/re-mask toggle.** The revealed password stays visible until reload
  (it is a one-time secret; the primary need is copy-without-transcription-error).

## Decisions (from brainstorming)

1. **Scope:** full recompose covering all 9 findings.
2. **Reveal UX:** after reveal, the password stays visible in a bordered mono box with a
   `CopyButton` and a "shown once" warning. No re-hide toggle.
3. **Not provisioned:** informative `EmptyState` with no action button.

## Design

### 1. Section shell & header — findings 1, 5

Replace `<section id="kaneo-access">` + `<h2>My Kaneo access</h2>` with the standard shell:

```svelte
<section id="kaneo-access" class="settings-section">
  <PageHeader eyebrow="Personal" title="My Kaneo access">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="kaneo-refresh" />
    {/snippet}
  </PageHeader>
  <!-- state branches -->
</section>
```

- Adds `.settings-section` (inherits `color: var(--text)`) and the shared `PageHeader`
  eyebrow/title rhythm — fixes flat hierarchy (finding 5) and the biggest design-system gap
  (finding 1).
- Adds a Refresh affordance the section currently lacks (matches siblings).
- **Consistency trade:** `PageHeader`'s title is a styled `<div>`, not an `<h2>`. This
  matches every sibling section (the app dropped section-level `<h2>`s wholesale), so
  consistency wins over the lost heading semantic.

### 2. State branches — findings 2, 7, 8

| State           | Current                                                                | New                                                                                                                               |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Loading         | `<p>Loading…</p>` (default color)                                      | `<p class="placeholder">Loading…</p>` (muted token) — **finding 8**                                                               |
| Error           | `<p class="error">` — `.error` undefined in settings scope → tiny grey | `<ErrorState message={error} onRetry={() => void load(contextId)} />` — danger-styled, `role="alert"`, adds retry — **finding 2** |
| Not provisioned | bare sentence                                                          | `EmptyState` (below), no action — **finding 7**                                                                                   |

Not-provisioned copy:

```svelte
<EmptyState
  title="No Kaneo access yet"
  hint="Your account isn't provisioned in this group yet. Group members are set up automatically — if this persists, ask a group admin to add you." />
```

Branch order in the template is unchanged (`loading` → `notProvisioned` → `error` →
`credentials`), preserving current state logic.

### 3. Credential rows (populated) — findings 4, 5, 6, 9

Render the three data points as `KV` rows (label/value from the shared scale):

- **Login email:** `<KV k="Login email" v={credentials.login} />`
- **Workspace URL:** `KV` with a value snippet wrapping a styled anchor —
  `color: var(--accent)` (`#52e08a`, passes contrast on `--bg`) and `overflow-wrap: anywhere`
  so long hosts wrap instead of overflowing (`KV`'s default value is `nowrap`+ellipsis, so
  this row overrides to wrap). Fixes link contrast (finding 4) and URL overflow (finding 9).
  Rendered only when `credentials.kaneoUrl !== null` (unchanged).
- **Status:** `KV` with a `<StatusPill status={credentials.status} />` value
  (`statusTone('active') → accent`), consistent with status rendering elsewhere.

Consistent `KV` rows replace the cramped browser-default `dl`/`dt`/`dd`, drawing spacing
from the shared scale — fixes hierarchy (finding 5) and spacing (finding 6).

### 4. Password reveal — finding 3 (High)

Preserves the existing reveal flow (`revealPassword()` state machine: `revealing`,
`revealedPassword`), only re-presented:

- **Before reveal** — `<Btn variant="secondary" size="sm" disabled={revealing} onClick={revealPassword}>`
  with label `Reveal password` / `Revealing…`. Keeps the existing in-flight signalling and
  disabled-while-busy behavior (finding 9 was already a partial pass here).
- **After reveal** (`revealedPassword !== null`):

  ```svelte
  <div class="kaneo-pw">
    <span class="ui-field__label">Password (shown once)</span>
    <div class="kaneo-pw__row">
      <Code truncate={false}>{revealedPassword}</Code>
      <CopyButton value={revealedPassword} label="Copy password" />
    </div>
    <p class="placeholder">Store this password securely — it won't be shown again.</p>
  </div>
  ```

  `Code` (`truncate={false}`) gives the bordered mono box that wraps; `CopyButton` gives
  one-click copy with ✓ feedback — fixes the High copy-affordance finding (finding 3).

### 5. Interaction / focus (rubric dimensions 2 & 9)

Using `Btn` / `IconButton` / `ErrorState` retry buttons replaces the native `<button>`, so
hover/active and the shared `:focus-visible` ring (scoped to `.settings-grid` and the
primitives' own styles) now apply consistently. This is a beneficial side effect of the
recompose rather than a separately-numbered finding — it addresses rubric dimension 2
(affordance) and dimension 9 (interaction / micro-states): the native-button affordance
gap and the missing hover/active feedback the review scored `warn`.

## Components used (all existing)

`PageHeader`, `IconButton`, `KV`, `StatusPill`, `Btn`, `Code`, `CopyButton`, `ErrorState`,
`EmptyState` — all under `client/shared/ui/`. No new primitives.

## Testing

- **Behavior preserved:** existing `tests/client/settings/sections/KaneoAccessSection.test.ts`
  covers load / 404-empty / error / reveal. Update selectors where markup changed (e.g. the
  reveal button and error/empty text), but assertions on behavior stay.
- **Visual:** the visual spec (`tests/visual/settings/sections/KaneoAccessSection.spec.ts`)
  already captures Populated, Not provisioned, Error, Loading, password-revealed, hover, and
  narrow states — re-shoot with `bun shoot -g KaneoAccessSection` to refresh baselines and
  confirm the recompose visually.
- No new backend/unit tests needed (no logic changes).

## Findings → fix traceability

| Finding                             | Fix                                   |
| ----------------------------------- | ------------------------------------- |
| 1 Bypasses design system (High)     | §1 shell + `PageHeader`, §3 `KV` rows |
| 2 Error not an error (High)         | §2 `ErrorState`                       |
| 3 Password no copy / re-hide (High) | §4 `Code` + `CopyButton`              |
| 4 Link low contrast (Med)           | §3 accent-colored anchor              |
| 5 Flat hierarchy (Med)              | §1 `PageHeader`, §3 `KV`              |
| 6 Spacing off-scale (Med)           | §3 `KV` rows                          |
| 7 Empty state dead-end (Low)        | §2 `EmptyState`                       |
| 8 Loading unstyled (Low)            | §2 `.placeholder`                     |
| 9 Long URL overflow (Low)           | §3 `overflow-wrap: anywhere`          |
