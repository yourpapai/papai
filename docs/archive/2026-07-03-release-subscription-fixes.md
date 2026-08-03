<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ReleaseSubscriptionSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all five UX-review findings for `ReleaseSubscriptionSection` — the top-level Personal settings section that currently shows a green "Subscribe" CTA before its state is known, dead-ends on load errors, gives no in-flight feedback, and crowds its caption with an unspaced error.

**Architecture:** Add two additive, backward-compatible features to the shared `Btn` primitive (a `busy` affordance and an intrinsic `:focus-visible` ring), then rework `ReleaseSubscriptionSection` to gate on the same four render states the codebase already uses (`ErrorState` / `Loading…` / content), splitting the single `error` field into `loadError` (body `ErrorState` + retry) and `actionError` (inline, spaced, `role="alert"`).

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$effect`/`$props`), TypeScript (strict, `.js` import paths), Bun test runner, `mount`/`unmount`/`flushSync` from `svelte`, `setMockFetch`/`restoreFetch` test helpers, Storybook + MSW fixtures, `@crvy/strybk` Playwright screenshots.

**Design spec:** [`docs/superpowers/specs/2026-07-03-release-subscription-fixes-design.md`](../specs/2026-07-03-release-subscription-fixes-design.md)

---

## File Structure

- **Modify:** `client/shared/ui/Btn.svelte` — add `busy` prop + `:focus-visible` ring (findings C-enabler, E).
- **Modify:** `tests/client/shared/ui/Btn.test.ts` — cover `busy` behavior + focus-ring presence.
- **Rewrite:** `client/settings/sections/ReleaseSubscriptionSection.svelte` — state machine (findings A, B, C, D).
- **Create:** `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts` — cover all render states.
- **Modify:** `client/stories/msw/settings-handlers-personal.ts` — add PATCH handlers for mutation states.
- **Modify:** `client/stories/msw/scenarios.ts` — register two new scenario keys.
- **Modify:** `client/settings/sections/ReleaseSubscriptionSection.stories.svelte` — add stories for the new states.
- **Modify:** `tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts` — re-point interaction shots at the new markup.

---

## Task 1: Add `busy` prop and intrinsic focus ring to `Btn`

Two additive changes to the shared button. `busy` mirrors the existing `IconButton` `busy` affordance (opacity + `pointer-events: none`), stays visually and semantically distinct from `disabled` (a busy button is _working_, not _forbidden_), and guards `onClick` so it cannot fire mid-flight. The focus ring duplicates the value currently provided only by the `.settings-grid` ancestor selector, so there is no visual change inside settings.

**Files:**

- Modify: `client/shared/ui/Btn.svelte`
- Test: `tests/client/shared/ui/Btn.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe('Btn.svelte', ...)` block in `tests/client/shared/ui/Btn.test.ts` (the file already imports `createRawSnippet`, `mount`, `unmount`, `Btn`, and defines `textSnippet`):

```typescript
test('applies ui-btn--busy class and aria-busy when busy', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Btn, { target, props: { children: textSnippet('x'), busy: true } })
  const btn = target.querySelector<HTMLButtonElement>('.ui-btn')!
  expect(btn.classList.contains('ui-btn--busy')).toBe(true)
  expect(btn.getAttribute('aria-busy')).toBe('true')
  void unmount(component)
})

test('does not invoke onClick while busy', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  let clicked = 0
  const component = mount(Btn, {
    target,
    props: {
      children: textSnippet('go'),
      busy: true,
      onClick: () => {
        clicked += 1
      },
    },
  })
  target.querySelector<HTMLButtonElement>('.ui-btn')!.click()
  expect(clicked).toBe(0)
  void unmount(component)
})

test('Btn.svelte source contains a :focus-visible ring', async () => {
  const url = new URL('../../../../client/shared/ui/Btn.svelte', import.meta.url)
  const source = await Bun.file(url).text()
  expect(source).toContain('.ui-btn:focus-visible')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: FAIL — the two `busy` tests fail (no `ui-btn--busy` class / `aria-busy`; `onClick` still fires), and the focus-visible source test fails (string not present).

- [ ] **Step 3: Add the `busy` prop and click guard to the script**

In `client/shared/ui/Btn.svelte`, add `busy?: boolean` to the `Props` interface and to the destructured props (default `false`), and add a click guard. The `Props` interface becomes:

```svelte
  interface Props {
    children: Snippet
    icon?: Snippet
    variant?: Variant
    size?: Size
    onClick?: () => void
    type?: 'button' | 'submit'
    disabled?: boolean
    busy?: boolean
    testid?: string
  }

  let {
    children,
    icon,
    variant = 'secondary',
    size = 'md',
    onClick,
    type = 'button',
    disabled = false,
    busy = false,
    testid,
  }: Props = $props()

  function handleClick(): void {
    if (busy) return
    onClick?.()
  }
```

- [ ] **Step 4: Update the button markup**

Replace the opening `<button ...>` tag in `client/shared/ui/Btn.svelte` with:

```svelte
<button
  class="ui-btn ui-btn--{variant} ui-btn--{size}"
  class:ui-btn--busy={busy}
  {type}
  {disabled}
  aria-busy={busy}
  onclick={handleClick}
  data-testid={testid}
>
```

- [ ] **Step 5: Add the busy + focus-visible styles**

In the `<style>` block of `client/shared/ui/Btn.svelte`, add the busy rule directly after the existing `.ui-btn:disabled { ... }` rule:

```css
.ui-btn--busy {
  opacity: 0.6;
  cursor: progress;
  pointer-events: none;
}
.ui-btn:focus-visible {
  outline: 2px solid rgba(82, 224, 138, 0.4);
  outline-offset: 1px;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: PASS — all tests, including the three new ones and the pre-existing variant/size/onClick/testid/hover/icon tests.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
git commit -m "feat(ui): add busy affordance and intrinsic focus ring to Btn"
```

---

## Task 2: Rework `ReleaseSubscriptionSection` state machine

Split `error` into `loadError` and `actionError`; gate the toggle so it renders only when `enabled !== null && loadError === null`; render a `Loading…` placeholder and an `ErrorState`-with-retry; drive the busy label and inline mutation error.

**Files:**

- Rewrite: `client/settings/sections/ReleaseSubscriptionSection.svelte`
- Test (create): `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import ReleaseSubscriptionSection from '../../../../client/settings/sections/ReleaseSubscriptionSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return {
    target,
    component: mount(ReleaseSubscriptionSection, { target, props: { scope: 'personal', contextId: 'user:1' } }),
  }
}

const isPatch = (init: RequestInit): boolean => init.method === 'PATCH'

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ReleaseSubscriptionSection', () => {
  test('shows a Loading placeholder and no toggle while the state is unknown', () => {
    setMockFetch(() => new Promise<Response>(() => {})) // never resolves
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('.placeholder')?.textContent).toContain('Loading…')
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).toBeNull()
    void unmount(component)
  })

  test('renders the Subscribe toggle and caption once loaded (unsubscribed)', async () => {
    setMockFetch(() => Promise.resolve(json({ enabled: false })))
    const { target, component } = render()
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')
    expect(toggle).not.toBeNull()
    expect(toggle!.textContent).toContain('Subscribe')
    expect(toggle!.classList.contains('ui-btn--primary')).toBe(true)
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('.settings-section__caption')).not.toBeNull()
    void unmount(component)
  })

  test('renders the Unsubscribe toggle as outline once loaded (subscribed)', async () => {
    setMockFetch(() => Promise.resolve(json({ enabled: true })))
    const { target, component } = render()
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')
    expect(toggle!.textContent).toContain('Unsubscribe')
    expect(toggle!.classList.contains('ui-btn--outline')).toBe(true)
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry and no toggle', async () => {
    let n = 0
    const handlers: Array<() => Promise<Response>> = [
      () => Promise.resolve(json({ error: 'boom' }, 500)),
      () => Promise.resolve(json({ enabled: false })),
    ]
    setMockFetch(() => handlers[n++]!())
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).toBeNull()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    retry!.click()
    await drain()
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    expect(target.querySelector('.ui-error')).toBeNull()
    void unmount(component)
  })

  test('a failed toggle keeps the toggle visible and shows an inline alert', async () => {
    setCsrfToken('t')
    setMockFetch((_url, init) => {
      if (isPatch(init)) return Promise.resolve(json({ error: 'nope' }, 500))
      return Promise.resolve(json({ enabled: false }))
    })
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!.click()
    await drain()
    const alert = target.querySelector('[data-testid="release-subscription-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('role')).toBe('alert')
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows a busy label and aria-busy while a toggle is in flight', async () => {
    setCsrfToken('t')
    setMockFetch((_url, init) => {
      if (isPatch(init)) return new Promise<Response>(() => {}) // never resolves
      return Promise.resolve(json({ enabled: false }))
    })
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!.click()
    flushSync()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!
    expect(toggle.textContent).toContain('Subscribing…')
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`
Expected: FAIL — the current component renders the toggle during load, uses `.status-error` instead of `ErrorState`, and never swaps to a busy label.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `client/settings/sections/ReleaseSubscriptionSection.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import {
    fetchGroupReleaseSubscription,
    fetchReleaseSubscription,
    patchGroupReleaseSubscription,
    patchReleaseSubscription,
  } from '../release-fetchers.js'

  interface Props {
    scope: 'personal' | 'group'
    contextId: string
  }

  let { scope, contextId }: Props = $props()

  let enabled = $state<boolean | null>(null)
  let mutating = $state(false)
  let loadError: string | null = $state(null)
  let actionError: string | null = $state(null)

  function messageFrom(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  async function load(id: string): Promise<void> {
    loadError = null
    try {
      const result = scope === 'group' ? await fetchGroupReleaseSubscription(id) : await fetchReleaseSubscription()
      if (scope === 'group' && id !== contextId) return
      enabled = result.enabled
    } catch (err) {
      if (id === contextId) loadError = messageFrom(err)
    }
  }

  async function toggle(): Promise<void> {
    if (enabled === null) return
    actionError = null
    mutating = true
    try {
      if (scope === 'group') await patchGroupReleaseSubscription({ contextId, enabled: !enabled })
      else await patchReleaseSubscription({ enabled: !enabled })
      await load(contextId)
    } catch (err) {
      actionError = messageFrom(err)
    } finally {
      mutating = false
    }
  }

  const idleLabel = $derived(enabled ? 'Unsubscribe' : 'Subscribe')
  const busyLabel = $derived(enabled ? 'Unsubscribing…' : 'Subscribing…')

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="release-announcements-{scope}" class="settings-section">
  <PageHeader eyebrow={scope === 'group' ? 'Group' : 'Personal'} title="Release announcements">
    {#snippet action()}
      {#if enabled !== null && loadError === null}
        <Btn
          variant={enabled ? 'outline' : 'primary'}
          size="sm"
          busy={mutating}
          testid="release-subscription-toggle"
          onClick={() => void toggle()}>
          {#snippet children()}{mutating ? busyLabel : idleLabel}{/snippet}
        </Btn>
      {/if}
    {/snippet}
  </PageHeader>

  {#if loadError !== null}
    <ErrorState title="Couldn't load subscription" message={loadError} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
    <p class="placeholder">Loading…</p>
  {:else}
    <p class="settings-section__caption">
      {#if scope === 'group'}
        When on, this group receives a message whenever a new bot version ships. Only future releases — past ones are
        not re-sent.
      {:else}
        When on, you receive a DM whenever a new bot version ships. Only future releases — past ones are not re-sent.
      {/if}
    </p>
    {#if actionError !== null}
      <p class="settings-section__action-error status-error" role="alert" data-testid="release-subscription-error">
        {actionError}
      </p>
    {/if}
  {/if}
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
  .settings-section__action-error {
    margin: var(--gap-inline) 0 0;
    font-size: 12px;
  }
</style>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`
Expected: PASS — all six tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/sections/ReleaseSubscriptionSection.svelte tests/client/settings/sections/ReleaseSubscriptionSection.test.ts
git commit -m "fix(settings): gate release-subscription toggle behind load state, add retry + busy feedback"
```

---

## Task 3: Update stories, MSW fixtures, and screenshot spec

Add mutation-state fixtures so the busy and mutation-error frames can be captured, register stories, and re-point the interaction screenshots at the new markup. The existing GET-only fixtures already cover `Loading` (now renders `Loading…`) and `Error` (now renders `ErrorState`).

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal.ts`
- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/settings/sections/ReleaseSubscriptionSection.stories.svelte`
- Modify: `tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts`

- [ ] **Step 1: Add PATCH handlers for the mutation states**

In `client/stories/msw/settings-handlers-personal.ts`, immediately after the `releaseSubscriptionHandlers` object (which ends at the line `}` following the `loading:` array, around line 260), add two standalone exports. These reuse the file's existing `http`, `HttpResponse`, `delay`, `boom`, `NEVER_RESOLVE_MS`, and `releaseSubscriptionEmpty` bindings:

```typescript
// Toggle-in-flight: GET resolves (so the toggle renders), PATCH never resolves.
export const releaseSubscriptionMutatingHandlers: HttpHandler[] = [
  http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionEmpty)),
  http.patch('/settings/api/release-subscription', async () => {
    await delay(NEVER_RESOLVE_MS)
    return HttpResponse.json({})
  }),
]

// Toggle failure: GET resolves, PATCH returns 500.
export const releaseSubscriptionMutationErrorHandlers: HttpHandler[] = [
  http.get('/settings/api/release-subscription', () => HttpResponse.json(releaseSubscriptionEmpty)),
  http.patch('/settings/api/release-subscription', boom),
]
```

- [ ] **Step 2: Register the new scenario keys**

In `client/stories/msw/scenarios.ts`, add the two handler families to the import from `./settings-handlers-personal.js` (the file already imports `releaseSubscriptionHandlers` there — extend that import list):

```typescript
  releaseSubscriptionHandlers,
  releaseSubscriptionMutatingHandlers,
  releaseSubscriptionMutationErrorHandlers,
```

Then, directly after the existing `'settings-release-loading'` entry (line ~191), add:

```typescript
  'settings-release-mutating': [...releaseSubscriptionMutatingHandlers],
  'settings-release-mutation-error': [...releaseSubscriptionMutationErrorHandlers],
```

- [ ] **Step 3: Add the new stories**

In `client/settings/sections/ReleaseSubscriptionSection.stories.svelte`, add two stories after the existing `Loading` story (line 27):

```svelte
<Story name="Mutating" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-mutating' }} />

<Story name="MutationError" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-release-mutation-error' }} />
```

- [ ] **Step 4: Verify the TypeScript compiles**

Run: `bun run typecheck`
Expected: PASS — no type errors in the modified `.ts` files.

- [ ] **Step 5: Re-point the interaction screenshot spec**

The manual region of `tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts` (below `// @generated-end auto-screenshots`) drives the toggle by test id, which is unchanged — so the existing hover/focus/narrow shots still target the right element and need no edits. Append two new interaction tests that exercise the new states, below the existing manual tests:

```ts
test('Mutating — busy toggle', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--mutating')
  await sharedPage.getByTestId('release-subscription-toggle').click()
  await expect(sharedPage.getByTestId('release-subscription-toggle')).toHaveText('Subscribing…')
  await expect(sharedPage).toHaveScreenshot()
})

test('MutationError — inline alert', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-releasesubscriptionsection--mutationerror')
  await sharedPage.getByTestId('release-subscription-toggle').click()
  await expect(sharedPage.getByTestId('release-subscription-error')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 6: Re-shoot the screenshots**

Ensure Storybook is running (`bun storybook`), then:

Run: `bun shoot -g ReleaseSubscriptionSection`
Expected: all states pass; new baselines written for `Mutating` and `MutationError`. Then read the PNGs under `.storybook-shots/settings/sections/ReleaseSubscriptionSection.spec.ts/` and confirm: no green CTA during `Loading` (shows `Loading…`); `Error` shows the framed `ErrorState` with a `Try again` button; `Mutating` shows `Subscribing…` and a dimmed busy button; `MutationError` shows the inline red alert spaced below the caption.

- [ ] **Step 7: Re-shoot the shared `Btn` stories (blast-radius check)**

Because Task 1 touched a shared primitive:

Run: `bun shoot -g Btn`
Expected: PASS with no unexpected diffs — the focus ring is only visible on `:focus-visible`, and existing stories pass no `busy`, so resting appearance is unchanged. If any baseline updates, eyeball them to confirm they are additive-only.

- [ ] **Step 8: Commit**

The `.storybook-shots/` baselines are gitignored (local-only), so they are not committed — only the source files are:

```bash
bun run format
git add client/stories/msw/settings-handlers-personal.ts client/stories/msw/scenarios.ts client/settings/sections/ReleaseSubscriptionSection.stories.svelte tests/visual/settings/sections/ReleaseSubscriptionSection.spec.ts
git commit -m "test(settings): add release-subscription mutation stories, fixtures, and screenshots"
```

---

## Final verification

- [ ] **Run the full affected test suite**

Run: `bun test tests/client/shared/ui/Btn.test.ts tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`
Expected: PASS — all tests across both files.

- [ ] **Run typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS — no errors.

- [ ] **Confirm every finding is addressed**

Cross-check against the source review [`docs/ux-reviews/ReleaseSubscriptionSection.md`](../../ux-reviews/ReleaseSubscriptionSection.md):

- A (High) — toggle hidden during load; `Loading…` placeholder shown → Task 2.
- B (Med) — `ErrorState` + retry on load failure → Task 2.
- C (Med) — busy label + `aria-busy` while mutating → Tasks 1 + 2.
- D (Low) — inline `actionError` with `--gap-inline` margin + `role="alert"` → Task 2.
- E (Low) — `.ui-btn:focus-visible` ring on the primitive → Task 1.
