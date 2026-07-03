<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — GuestModeSection UX fixes

**Date:** 2026-07-03
**Source review:** [`docs/ux-reviews/GuestModeSection.md`](../../ux-reviews/GuestModeSection.md)
**Component:** `client/settings/sections/GuestModeSection.svelte`
**Scope:** Fix all six review findings. Change stays local to `GuestModeSection.svelte`
plus its tests and story fixtures. **No shared primitives are modified** — every building
block (`Pill`, `ErrorState`, `formatFetchError`, `Btn` `busy`, `.t-help`, `.placeholder`)
already exists and is used by sibling sections.

## Goal

`GuestModeSection` is a security-relevant group control: when on, any unrecognized user in the
chat gets a hardcoded read-only toolset. The UX review found the current state is illegible (no
indicator; color emphasis inverted so the safe _off_ state is the loud green button), the error
path is a raw-exception dead-end with no retry, loading flashes the wrong label, the toggle gives
no in-flight feedback, and a local one-off caption style is used. This design resolves all six by
mirroring the patterns already established in the reviewed sibling `TaskProviderSection` and the
closest structural analog `ByokSection` (a boolean toggle in a `PageHeader` action slot).

## Approach (selected)

State is carried by an explicit **status pill**; the action button becomes a **stable neutral
control** that no longer color-flips. Load/error/loading branches mirror `TaskProviderSection`.
The toggle is hidden until data loads (as `ByokSection` does), which removes the wrong-state label
flash without extra logic. Alternatives considered and rejected during brainstorming: a
green (accent) "On" pill — rejected because green reads as "healthy/good" and undersells the
security exposure; and a "fix the button only, no pill" option — rejected because it leaves the
"no state signifier" half of the top finding unaddressed.

## Component structure (after)

### Header — `PageHeader` action slot

The pill sits in the action slot, immediately left of the button (right-aligned group), because
`PageHeader` has no title-adjacent slot and this design does not modify that shared primitive.
Both pill and button render only once `enabled !== null`, so during loading and error the header
shows just the eyebrow/title — this is what removes the wrong-state label flash (finding #3).

```
{#snippet action()}
  {#if enabled !== null}
    <Pill tone={enabled ? 'warn' : 'mute'} dot={enabled}>{enabled ? 'On' : 'Off'}</Pill>
    <Btn
      variant="secondary"
      size="sm"
      busy={mutating}
      disabled={loading || mutating}
      testid="guest-mode-toggle"
      onClick={() => void toggle()}>
      {#snippet children()}
        {mutating
          ? (enabled ? 'Disabling…' : 'Enabling…')
          : (enabled ? 'Disable guest mode' : 'Enable guest mode')}
      {/snippet}
    </Btn>
  {/if}
{/snippet}
```

Notes:

- **Pill tone:** `warn` (amber) when on, `mute` (grey) when off. Rendered with `Pill` directly
  (not `StatusPill`), because `statusTone` maps `on`/`off` to `neutral` and would not produce the
  chosen amber. The amber `warn` tone signals "guests currently have access — pay attention"
  rather than the accent-green "healthy" reading the review flagged.
- **Pill dot:** `dot={enabled}` shows the amber dot only in the on state; off is a plain grey pill.
- **Button variant:** fixed `secondary` (raised background + border) in both states, replacing the
  previous `enabled ? 'outline' : 'primary'` mapping that made the safe _off_ state the loudest
  element. `secondary` reads as a real, clickable control without nudging toward either action.
- **In-flight:** `busy={mutating}` drives `Btn`'s existing `aria-busy` + dimmed pointer-events-none
  state, paired with an "Enabling…/Disabling…" label. During the mutation `enabled` still holds the
  pre-toggle value, so a currently-on section correctly reads "Disabling…".
- **Disabled:** `disabled={loading || mutating}` (the `enabled === null` guard is now handled by the
  enclosing `{#if enabled !== null}`, so it is dropped from the button's own `disabled`).

### Body — three-way branch

Mirrors `TaskProviderSection.svelte:112-116`:

```
{#if error !== null}
  <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
{:else if loading && enabled === null}
  <p class="placeholder">Loading…</p>
{:else}
  <p class="t-help">
    When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.
  </p>
{/if}
```

- **Error:** `ErrorState` provides the retry button (`onRetry` re-runs `load(contextId)`), a
  humanized message via `formatFetchError`, and `role="alert"` so the failure is announced. This
  replaces the previous bare `<p class="status-error">{error}</p>` dead-end.
- **Loading:** shared `.placeholder` "Loading…" line while the first GET is in flight.
- **Help caption:** now uses the shared `.t-help` class; the component's local `<style>` block and
  `.settings-section__caption` class are removed entirely.

## Findings → fix map

| #   | Finding                             | Fix                                                                       |
| --- | ----------------------------------- | ------------------------------------------------------------------------- |
| 1   | No state signifier + inverted color | Amber/grey `Pill` carries state; button becomes stable `secondary`        |
| 2   | Raw-`boom` error dead-end           | `ErrorState` + `onRetry` + `formatFetchError` (humanized, `role="alert"`) |
| 3   | Loading flashes the wrong label     | Toggle hidden until `enabled !== null`; `.placeholder` "Loading…"         |
| 4   | No in-flight feedback               | `Btn busy={mutating}` + "Enabling…/Disabling…" label                      |
| 5   | Binary state not exposed to AT      | Pill text ("On"/"Off") announces state; `ErrorState` `role="alert"`       |
| 6   | Local one-off caption style         | Shared `.t-help` class; remove local `<style>`                            |

## Accepted trade-offs

- **Pill placement:** in the action slot beside the button, not next to the title. Avoids editing
  the shared `PageHeader`. Same information, right-aligned with the toggle.
- **No `aria-describedby` / `aria-pressed`:** finding #5 also suggested linking the caption to the
  button. `Btn` exposes no aria pass-through prop, so wiring it would require editing the shared
  `Btn` — out of scope. With the pill now stating the value and the caption visible as adjacent
  text, formal `aria-describedby` is skipped. `aria-pressed` is also skipped: the button is now a
  neutral action button, not a pressed-state toggle, so `aria-pressed` would misrepresent it.

## No behavior/API changes

- `load()` / `toggle()` control flow, the `contextId`-guarded async pattern, and the
  `fetchGroupGuestMode` / `patchGroupGuestMode` fetchers are unchanged.
- `GroupGuestModeResponseSchema` (`{ contextId, enabled }`) is unchanged — no server or schema work.
- No new success-confirmation line (the pill + label flip is the confirmation), per the chosen
  "full sibling parity" scope.

## Testing

- **Component test** (`tests/client/settings/sections/GuestModeSection.test.ts`): existing
  assertions on the resting labels ("Enable guest mode" / "Disable guest mode") remain valid (the
  test drains before querying, and the toggle renders once loaded). Add assertions for: the
  `On`/`Off` pill text per state; the "Enabling…/Disabling…" busy label during a pending PATCH; the
  `ErrorState` retry button on a failed GET (and that clicking it re-issues the GET); and the
  "Loading…" placeholder before the first GET resolves.
- **Visual stories** (`GuestModeSection.stories.svelte` + `tests/visual/.../GuestModeSection.spec.ts`):
  the four state fixtures (populated/empty/error/loading) already exist and now exercise the new
  pill, neutral button, `ErrorState`, and loading placeholder. Re-shoot with
  `bun shoot -g GuestModeSection` to refresh baselines; the manual narrow/hover states added during
  the review remain valid.
- Run `bun run format`, typecheck, and the settings client test suite.

## Files touched

- `client/settings/sections/GuestModeSection.svelte` — the change described above.
- `tests/client/settings/sections/GuestModeSection.test.ts` — added assertions.
- `.storybook-shots/settings/sections/GuestModeSection.spec.ts/*` — refreshed baselines (generated).

## Out of scope

- Any change to shared primitives (`Btn`, `PageHeader`, `Pill`, `ErrorState`).
- A confirmation dialog before enabling guest mode (not raised by the review).
- Server/route/schema changes.
- The identical color-inversion issue in `ByokSection` (tracked separately if desired).
