<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Robustness — Workstream C: refresh failure must not nuke a loaded section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the 5 sections where a failed post-mutation reload currently replaces the whole section with a full `ErrorState`, render that `ErrorState` **only when the section has never loaded**; once loaded, surface a reload error as a non-blocking inline banner so the form and any success status survive.

**Architecture:** Converge each of the 5 sections onto the pattern `ByokSection`/`CodeHostSection`/`MemorySection` already use: gate the full `ErrorState` on the section's not-yet-loaded flag, and add an inline `<p class="status-error" role="alert">` for the loaded-but-refresh-failed case.

**Tech Stack:** Svelte 5 runes; strict TypeScript (`.js` imports); Bun + Svelte `mount` + happy-dom client tests; `oxfmt`/`oxlint`.

**Spec:** [`../specs/2026-07-07-settings-section-robustness-design.md`](../specs/2026-07-07-settings-section-robustness-design.md) (Workstream C)

**Client tests run with:** `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`; full suite `bun run test:client`. The 2 pre-existing `MemorySection` failures on `master` are out of scope.

**Recommended ordering:** run Workstream B (the guard sweep) first for these sections so the reload's own error write is contextId-guarded; this workstream is still correct standalone, but the two compose cleanly.

---

## The Pattern (applied per section)

1. Tighten the top-level error gate from `{#if <errVar> !== null}` to `{#if <errVar> !== null && <notLoaded>}`, where `<notLoaded>` is the section's existing "never loaded" expression.
2. Inside the loaded branch, add a non-blocking inline banner: `{#if <errVar> !== null}<p class="status-error" role="alert">{formatFetchError(<errVar>)}</p>{/if}` — placed above the form/controls.

| Section                      | `<errVar>`  | `<notLoaded>`           | gate line |
| ---------------------------- | ----------- | ----------------------- | --------- |
| `CodingIdentitySection`      | `loadError` | `!loaded`               | `:109`    |
| `GroupProviderSection`       | `loadError` | `data === null`         | `:79`     |
| `TaskProviderSection`        | `error`     | `instanceData === null` | `:112`    |
| `GuestModeSection`           | `error`     | `enabled === null`      | `:90`     |
| `ReleaseSubscriptionSection` | `loadError` | `enabled === null`      | `:85`     |

---

## Task 1: `CodingIdentitySection`

**Files:**

- Modify: `client/settings/sections/CodingIdentitySection.svelte:109`
- Test: `tests/client/settings/sections/CodingIdentitySection.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('CodingIdentitySection', …)` block (reuses `render`/`drain`/`submitForm`/`identity`/`membersPayload`/`ALICE`/`json`):

```typescript
test('a failed post-save reload keeps the form + success, no full ErrorState takeover', async () => {
  setCsrfToken('t')
  let identityCall = 0
  setMockFetch((url: string, init: RequestInit) => {
    if ((init.method ?? 'GET').toUpperCase() === 'PATCH') return Promise.resolve(json({}))
    if (url.includes('/coding-identity')) {
      identityCall++
      return Promise.resolve(identityCall === 1 ? identity('shared') : json({ error: 'boom' }, 500))
    }
    if (url.includes('/members')) return Promise.resolve(membersPayload([ALICE]))
    return Promise.resolve(json({}, 404))
  })
  const { target, component } = render()
  await drain()
  submitForm(target)
  await drain()
  expect(target.querySelector('.ui-error')).toBeNull() // no full-section ErrorState
  expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull() // form survives
  expect(target.querySelector('[data-testid="coding-identity-load-error"]')).not.toBeNull() // inline banner
  expect(target.querySelector('.status-success')?.textContent).toContain('Saved.') // success survives
  void unmount(component)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: FAIL — today the failed reload sets `loadError`, `{#if loadError !== null}` renders the full `ErrorState`, `.ui-error` is present, and the form/testids are gone.

- [ ] **Step 3: Tighten the gate + add the inline banner**

In `client/settings/sections/CodingIdentitySection.svelte`, change the gate at `:109` from:

```svelte
  {#if loadError !== null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && !loaded}
```

to:

```svelte
  {#if loadError !== null && !loaded}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && !loaded}
```

Then, inside the `{:else}` branch, immediately above the existing `{#if status !== null}…` line, add the inline reload-error banner:

```svelte
    {#if loadError !== null}
      <p class="status-error" role="alert" data-testid="coding-identity-load-error">{formatFetchError(loadError)}</p>
    {/if}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/CodingIdentitySection.svelte tests/client/settings/sections/CodingIdentitySection.test.ts
git commit -m "fix(settings): CodingIdentity refresh failure keeps form, not full ErrorState"
```

---

## Task 2: `GroupProviderSection`

**Files:**

- Modify: `client/settings/sections/GroupProviderSection.svelte:79`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file (reuse its `json`/`drain`/`payload` helpers). Drive: initial load ok, PATCH ok, post-save reload fails; assert the form survives with an inline error and no `.ui-error`:

```typescript
test('a failed post-save reload keeps the form, no full ErrorState takeover', async () => {
  setCsrfToken('t')
  let getCount = 0
  setMockFetch((url: string, init: RequestInit) => {
    if (init.method === 'PATCH') return Promise.resolve(json({ ok: true }))
    getCount++
    if (getCount === 1) return Promise.resolve(json(payload))
    return Promise.resolve(json({ error: 'boom' }, 500))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target
    .querySelector<HTMLFormElement>('form.settings-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await drain()
  expect(target.querySelector('.ui-error')).toBeNull()
  expect(target.querySelector('[data-testid="group-task-instance"]')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — `.ui-error` present, `group-task-instance` gone.

- [ ] **Step 3: Tighten the gate + add the inline banner**

In `client/settings/sections/GroupProviderSection.svelte`, change `:79`:

```svelte
  {#if loadError !== null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && data === null}
```

to:

```svelte
  {#if loadError !== null && data === null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && data === null}
```

Then inside the `{:else if data !== null}` branch, above the existing `{#if status !== null}…` line, add:

```svelte
    {#if loadError !== null}<p class="status-error" role="alert">{formatFetchError(loadError)}</p>{/if}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "fix(settings): GroupProvider refresh failure keeps form, not full ErrorState"
```

---

## Task 3: `TaskProviderSection`

**Files:**

- Modify: `client/settings/sections/TaskProviderSection.svelte:112`
- Test: `tests/client/settings/sections/TaskProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

Read the test file for its config + context-task-instance fixtures. Add a test: initial load ok, `bindInstance` PATCH ok, post-bind reload fails; assert the form/Select (`context-task-instance`) survives and `.ui-error` is absent. Use the same shape as Task 2 (first GET(s) ok, later GET 500). Because `load` does `Promise.all([fetchConfig, fetchContextTaskInstance])`, the failing reload should make one of those GETs return 500 on its second call.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: FAIL — full `ErrorState` (`.ui-error`) takes over.

- [ ] **Step 3: Tighten the gate + add the inline banner**

In `client/settings/sections/TaskProviderSection.svelte`, change `:112`:

```svelte
  {#if error !== null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && instanceData === null}
```

to:

```svelte
  {#if error !== null && instanceData === null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if loading && instanceData === null}
```

Then inside the loaded (`{:else}`) branch, above its first child, add:

```svelte
    {#if error !== null}<p class="status-error" role="alert">{formatFetchError(error)}</p>{/if}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "fix(settings): TaskProvider refresh failure keeps form, not full ErrorState"
```

---

## Task 4: `GuestModeSection`

**Files:**

- Modify: `client/settings/sections/GuestModeSection.svelte:90`
- Test: `tests/client/settings/sections/GuestModeSection.test.ts`

`GuestModeSection` is a toggle (no success status string); the fix keeps the toggle visible with an inline error when a post-toggle reload fails, instead of hiding it behind a full `ErrorState`.

- [ ] **Step 1: Write the failing test**

Read the test file for its guest-mode fixture and toggle testid. Add: initial load ok, toggle PATCH ok, post-toggle reload fails; assert the toggle button survives and `.ui-error` is absent. Use the same first-GET-ok / later-GET-500 mock shape as Task 2.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GuestModeSection.test.ts`
Expected: FAIL — `.ui-error` present, toggle gone.

- [ ] **Step 3: Tighten the gate + add the inline banner**

In `client/settings/sections/GuestModeSection.svelte`, change `:90`:

```svelte
  {#if error !== null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
```

to:

```svelte
  {#if error !== null && enabled === null}
    <ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
```

> Read the exact `:90` region first — if the second branch is `{:else if loading && enabled === null}` rather than `{:else if enabled === null}`, keep it as-is and only change the first `{#if}` condition. Then, in the loaded branch that renders the toggle, add above the toggle:

```svelte
    {#if error !== null}<p class="status-error" role="alert">{formatFetchError(error)}</p>{/if}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GuestModeSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/GuestModeSection.svelte tests/client/settings/sections/GuestModeSection.test.ts
git commit -m "fix(settings): GuestMode refresh failure keeps toggle, not full ErrorState"
```

---

## Task 5: `ReleaseSubscriptionSection`

**Files:**

- Modify: `client/settings/sections/ReleaseSubscriptionSection.svelte:85`
- Test: `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`

Also a toggle (no success status). Note its `ErrorState` has a custom `title="Couldn't load subscription"` — preserve it.

- [ ] **Step 1: Write the failing test**

Read the test file for its subscription fixture (`{ enabled: boolean }`) and toggle testid (`release-subscription-toggle`). Add: initial load ok, toggle PATCH ok, post-toggle reload fails; assert the toggle survives and `.ui-error` is absent (first GET ok, later GET 500).

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`
Expected: FAIL — `.ui-error` present, toggle gone.

- [ ] **Step 3: Tighten the gate + add the inline banner**

In `client/settings/sections/ReleaseSubscriptionSection.svelte`, change `:85` from:

```svelte
  {#if loadError !== null}
    <ErrorState title="Couldn't load subscription" message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
```

to:

```svelte
  {#if loadError !== null && enabled === null}
    <ErrorState title="Couldn't load subscription" message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if enabled === null}
```

> Read `:85` first and preserve the exact `ErrorState` props and the exact second-branch condition; only add `&& enabled === null` to the first `{#if}`. Then, in the loaded branch that renders the toggle, add above the toggle:

```svelte
    {#if loadError !== null}<p class="status-error" role="alert">{formatFetchError(loadError)}</p>{/if}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/ReleaseSubscriptionSection.svelte tests/client/settings/sections/ReleaseSubscriptionSection.test.ts
git commit -m "fix(settings): ReleaseSubscription refresh failure keeps toggle, not full ErrorState"
```

---

## Final verification

- [ ] `bun run test:client` — green except the 2 pre-existing `MemorySection` failures.
- [ ] `bun run typecheck` — clean.
- [ ] `git status --short` — clean.
- [ ] Sanity: the 4 already-correct sections (`Byok`, `CodeHost`, `CodingCredentials`, `Memory`) and `Identity` were **not** modified by this workstream.
