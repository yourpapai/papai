<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# GuestModeSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the six findings in the GuestModeSection UX review by making the current on/off state legible (status pill + stable neutral button), giving load errors a retry, fixing the loading label flash, signalling in-flight toggles, and using shared text styles.

**Architecture:** All changes are local to one Svelte 5 component (`client/settings/sections/GuestModeSection.svelte`) and its unit test. The component already fetches `{ enabled }` from `/settings/api/group/guest-mode` and PATCHes it. We keep that data flow and only change presentation: add a `Pill` state indicator and a neutral `Btn`, split the single `error` into a load `error` (rendered via the shared `ErrorState` with a retry) and a `toggleError` (rendered inline), gate the toggle behind `enabled !== null`, add a `busy` label, and swap the local caption `<style>` for the shared `.t-help` class. No shared primitives are modified.

**Tech Stack:** Bun test runner (`bun:test`), Svelte 5 runes (`$state`/`$props`/`$effect`), existing shared UI primitives (`Btn`, `Pill`, `ErrorState`, `PageHeader`), `formatFetchError` helper, Storybook + `@crvy/strybk` visual shots.

---

## Background the implementer needs

- **Source review:** `docs/ux-reviews/GuestModeSection.md`. **Design spec:** `docs/superpowers/specs/2026-07-03-guestmode-ux-fixes-design.md`. Read the spec first.
- **Reference sibling:** `client/settings/sections/TaskProviderSection.svelte:112-135` shows the exact error/loading pattern to mirror — a load `error` rendered through `ErrorState` with `onRetry`, a separate inline mutation error, and a `.placeholder` "Loading…" line.
- **Closest structural analog:** `client/settings/sections/ByokSection.svelte:140-165` — a boolean toggle in a `PageHeader` action slot that hides the toggle until data loads (`{#if currentData !== null}`).
- **Primitives (do not edit):**
  - `client/shared/ui/Pill.svelte` — props `{ tone?: 'accent'|'warn'|'danger'|'info'|'neutral'|'mute', dot?: boolean, children }`. Text child works (see `StatusPill.svelte:21`: `<Pill {tone} dot={showDot}>{status}</Pill>`). Renders `<span class="ui-pill ui-pill--{tone}">`.
  - `client/shared/ui/ErrorState.svelte` — props `{ message, title?, icon?, onRetry?, retryLabel? }`. Renders a container with `role="alert"`; when `onRetry` is set, a retry `Btn` with `data-testid="error-retry"`.
  - `client/shared/ui/Btn.svelte` — supports `busy` (adds `aria-busy` + dimmed pointer-events-none) and `disabled`. `children` must be an explicit `{#snippet children()}…{/snippet}`.
  - `client/shared/format-error.ts` — `formatFetchError(err: unknown): string`. A `>= 500` `FetchError` yields "Something went wrong on the server. Try again shortly."; a non-`FetchError` throw yields "Couldn't reach the server. Check your connection and try again."
- **Shared CSS classes (global, in `client/settings/settings.css`):** `.t-help` (muted 12px help text), `.placeholder` (muted), `.status-error` (danger color). No new CSS is needed.
- **Visual baselines are gitignored.** `.storybook-shots/**` is not tracked (confirmed via `git check-ignore`). Re-shooting refreshes local baselines for eyeballing; there is nothing to commit from it.

## File structure

- **Modify:** `client/settings/sections/GuestModeSection.svelte` — the whole change. Responsibility: render + toggle the group guest-mode flag.
- **Modify:** `tests/client/settings/sections/GuestModeSection.test.ts` — update one existing test (load-failure now renders `ErrorState`), add tests for the pill, busy label, loading placeholder, and retry recovery.
- **Verify only (no edit, no commit):** `client/settings/sections/GuestModeSection.stories.svelte` (fixtures unchanged) and `.storybook-shots/settings/sections/GuestModeSection.spec.ts/*` (regenerated).

---

## Task 1: Write the failing tests

**Files:**

- Test: `tests/client/settings/sections/GuestModeSection.test.ts`

This task only edits the test file. It will leave the suite RED (that is expected — Task 2 makes it green).

- [ ] **Step 1: Add mock helpers for the new states**

In `tests/client/settings/sections/GuestModeSection.test.ts`, immediately after the existing `patchErrorMock` definition (ends at line 40), add these three helpers:

```typescript
const neverResolves = (): Promise<Response> => new Promise<Response>(() => {})

const getHangsMock = (): Promise<Response> => neverResolves()

const patchHangsMock = (url: string, init: RequestInit): Promise<Response> => {
  const isPatch = url.includes('/group/guest-mode') && init.method === 'PATCH'
  return isPatch ? neverResolves() : Promise.resolve(json(disabledPayload))
}

const getFailsThenOkMock = (): ((url: string, init: RequestInit) => Promise<Response>) => {
  let calls = 0
  return () => {
    calls += 1
    return calls === 1
      ? Promise.resolve(new Response('Server Error', { status: 500 }))
      : Promise.resolve(json(disabledPayload))
  }
}
```

- [ ] **Step 2: Update the existing load-failure test to expect ErrorState**

Replace the existing test `shows an error when the fetch fails` (lines 100-108) with this version — a load failure now renders `ErrorState` (retry button), not the inline `guest-mode-error` line:

```typescript
test('renders ErrorState with a retry on load failure (no inline toggle error)', async () => {
  setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
  expect(target.querySelector('[role="alert"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="guest-mode-error"]')).toBeNull()
  expect(target.querySelector('[data-testid="guest-mode-toggle"]')).toBeNull()
  void unmount(component)
})
```

Leave the `shows an error when the patch fails` test (lines 110-121) unchanged — a toggle failure still renders the inline `guest-mode-error` line.

- [ ] **Step 3: Add the state-pill tests**

Append inside the `describe('GuestModeSection', …)` block (before its closing `})`):

```typescript
test('renders an "Off" mute pill when guest mode is disabled', async () => {
  setMockFetch(() => Promise.resolve(json(disabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const pill = target.querySelector('.ui-pill')!
  expect(pill).not.toBeNull()
  expect(pill.textContent?.trim()).toBe('Off')
  expect(pill.className).toContain('ui-pill--mute')
  void unmount(component)
})

test('renders an "On" warn pill when guest mode is enabled', async () => {
  setMockFetch(() => Promise.resolve(json(enabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const pill = target.querySelector('.ui-pill')!
  expect(pill.textContent?.trim()).toBe('On')
  expect(pill.className).toContain('ui-pill--warn')
  void unmount(component)
})
```

- [ ] **Step 4: Add the loading-placeholder test**

Append inside the same `describe` block:

```typescript
test('shows a Loading placeholder and hides the toggle before the first load resolves', async () => {
  setMockFetch(getHangsMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  expect(target.querySelector('.placeholder')?.textContent?.trim()).toBe('Loading…')
  expect(target.querySelector('[data-testid="guest-mode-toggle"]')).toBeNull()
  expect(target.querySelector('.ui-pill')).toBeNull()
  void unmount(component)
})
```

- [ ] **Step 5: Add the in-flight busy-label test**

Append inside the same `describe` block:

```typescript
test('shows an "Enabling…" busy label while the toggle PATCH is in flight', async () => {
  setCsrfToken('csrf-tok')
  setMockFetch(patchHangsMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
  expect(btn.textContent?.trim()).toBe('Enable guest mode')
  btn.click()
  await drain()
  expect(btn.textContent?.trim()).toBe('Enabling…')
  expect(btn.getAttribute('aria-busy')).toBe('true')
  void unmount(component)
})
```

- [ ] **Step 6: Add the retry-recovery test**

Append inside the same `describe` block:

```typescript
test('retry after a load failure re-fetches and renders the toggle', async () => {
  setMockFetch(getFailsThenOkMock())
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
  await drain()
  expect(target.querySelector('[data-testid="error-retry"]')).toBeNull()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
  expect(btn.textContent?.trim()).toBe('Enable guest mode')
  void unmount(component)
})
```

- [ ] **Step 7: Run the suite to verify the new/updated tests FAIL**

Run: `bun test tests/client/settings/sections/GuestModeSection.test.ts`
Expected: FAIL. The pill, loading-placeholder, busy-label, ErrorState, and retry tests fail against the current component (no pill, no `ErrorState`, toggle not gated, no busy label). The four pre-existing label/patch tests still pass.

Do NOT commit — the suite is intentionally red until Task 2.

---

## Task 2: Rewrite the component and go green

**Files:**

- Modify: `client/settings/sections/GuestModeSection.svelte` (full replacement below)
- Test: `tests/client/settings/sections/GuestModeSection.test.ts` (from Task 1)

- [ ] **Step 1: Replace the component file contents**

Overwrite `client/settings/sections/GuestModeSection.svelte` with exactly:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { formatFetchError } from '../../shared/format-error.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import { fetchGroupGuestMode, patchGroupGuestMode } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let enabled = $state<boolean | null>(null)
  let loading = $state(false)
  let mutating = $state(false)
  let error = $state<unknown>(null)
  let toggleError = $state<unknown>(null)

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = await fetchGroupGuestMode(id)
      if (id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      if (id === contextId) error = err
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    toggleError = null
    mutating = true
    try {
      await patchGroupGuestMode({ contextId, enabled: !enabled })
      await load(contextId)
    } catch (err) {
      toggleError = err
    } finally {
      mutating = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="guest-mode" class="settings-section">
  <PageHeader eyebrow="Group" title="Guest mode">
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
              ? enabled
                ? 'Disabling…'
                : 'Enabling…'
              : enabled
                ? 'Disable guest mode'
                : 'Enable guest mode'}
          {/snippet}
        </Btn>
      {/if}
    {/snippet}
  </PageHeader>

  {#if toggleError !== null}
    <p class="status-error" data-testid="guest-mode-error">{formatFetchError(toggleError)}</p>
  {/if}

  {#if error !== null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && enabled === null}
    <p class="placeholder">Loading…</p>
  {:else}
    <p class="t-help">
      When on, anyone in this chat can use the bot, read-only. Members and admins are unaffected.
    </p>
  {/if}
</section>
```

Notes for the implementer:

- The old local `<style>` block and `.settings-section__caption` class are gone — the caption now uses the global `.t-help` class.
- `error`/`toggleError` hold the raw caught value (`unknown`); `formatFetchError` is called in the template, matching `TaskProviderSection`.
- The `enabled === null` guard for the button is now the enclosing `{#if enabled !== null}`, so the button's own `disabled` is just `loading || mutating`.

- [ ] **Step 2: Run the component test suite to verify it PASSES**

Run: `bun test tests/client/settings/sections/GuestModeSection.test.ts`
Expected: PASS — all tests (four pre-existing + the updated load-failure + the five added) green.

- [ ] **Step 3: Typecheck and format**

Run: `bun run format` then `bun typecheck`
Expected: format rewrites nothing meaningful (or only whitespace); typecheck passes with no errors in `GuestModeSection.svelte`.

(If `bun typecheck` is not the exact script name, check `package.json` scripts; the repo exposes a TypeScript check via `bun run check` / `check:full` — run whichever the repo uses for type checking.)

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/GuestModeSection.svelte tests/client/settings/sections/GuestModeSection.test.ts
git commit -m "fix(settings): make guest-mode state legible + recoverable (UX review fixes)"
```

---

## Task 3: Refresh and eyeball the visual baselines

**Files:**

- Verify only: `.storybook-shots/settings/sections/GuestModeSection.spec.ts/*` (regenerated, gitignored — nothing to commit)

- [ ] **Step 1: Ensure Storybook is running**

Run (in a separate shell if not already up): `bun storybook`
Expected: Storybook serving on `http://localhost:6006`.

- [ ] **Step 2: Re-shoot the GuestModeSection states**

Run: `bun shoot -g GuestModeSection`
Expected: 7/7 tests pass and baselines are rewritten (the four state stories + the three manual states — narrow 640, and the two hover states — added during the review).

- [ ] **Step 3: Eyeball the regenerated PNGs**

Open (Read) these under `.storybook-shots/settings/sections/GuestModeSection.spec.ts/` and confirm:

- `…-Enabled-1.png`: amber "On" pill + neutral (secondary) "Disable guest mode" button.
- `…-Disabled-1.png`: grey "Off" pill + neutral "Enable guest mode" button (no loud green).
- `…-Error-1.png`: centered `ErrorState` with a "Try again" button; no toggle in the header.
- `…-Loading-1.png`: "Loading…" placeholder; no toggle/pill in the header.

Expected: matches the above. If not, revisit Task 2. No commit — these baselines are gitignored.

- [ ] **Step 4: Run the full check gate**

Run: `bun run check` (lint + typecheck + format:check + license-headers; the pre-commit gate the repo uses)
Expected: all checks pass.

---

## Self-review notes (already reconciled)

- **Spec coverage:** finding #1 → pill + `variant="secondary"` (Task 2 Step 1); #2 → `ErrorState` + `onRetry` (Step 1, tested Task 1 Steps 2/6); #3 → `{#if enabled !== null}` gate + `.placeholder` (Step 1, tested Task 1 Step 4); #4 → `busy={mutating}` + label (Step 1, tested Task 1 Step 5); #5 → pill text + `ErrorState` `role="alert"` (tested Task 1 Steps 2/3); #6 → `.t-help` class, local `<style>` removed (Step 1).
- **Spec deviation (intentional, more faithful to the cited sibling):** the single `error` was split into `error` (load → `ErrorState`) and `toggleError` (mutation → inline `status-error`), exactly as `TaskProviderSection` separates `error`/`bindError`. This preserves the `guest-mode-error` testid for toggle failures.
- **Type/name consistency:** `error`/`toggleError` are `unknown`; `formatFetchError(unknown): string`; `Pill` tones `warn`/`mute` are valid; `Btn` `busy`/`disabled`/`testid` props match `Btn.svelte`; retry testid `error-retry` matches `ErrorState.svelte`.
- **Out of scope (unchanged):** shared primitives, fetchers, `GroupGuestModeResponseSchema`, server routes, and the identical color-inversion in `ByokSection`.
