<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# MembersSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the MembersSection UX review findings across three isolated layers — the section's own behavior, the shared UI primitives it uses, and the group-members backend that feeds it.

**Architecture:** Three sequenced units. Unit 1 rewrites `MembersSection.svelte` behavior (confirmation dialog, distinct loading state, add-pending, split errors, formatted dates) plus a small `busy` prop on the shared `Confirm`. Unit 2 adjusts two affordances (destructive Remove variant, refresh-glyph contrast). Unit 3 enriches the members API with display names via a hybrid cache-then-live resolver reached through the existing runtime chat-router singleton — no router dependency threading required.

**Tech Stack:** Bun test runner, Svelte 5 runes (`$state`/`$derived`/`$effect`), Zod v4 schemas, Vercel-AI-SDK-adjacent chat providers, Playwright + `@crvy/strybk` for Storybook visual specs, `oxfmt` formatter.

**Source spec:** [`docs/superpowers/specs/2026-07-03-memberssection-ux-fixes-design.md`](../specs/2026-07-03-memberssection-ux-fixes-design.md)
**Source review:** [`docs/ux-reviews/MembersSection.md`](../../ux-reviews/MembersSection.md)

**Conventions for every task below:**

- Use `.js` extensions in TS/Svelte import paths (repo rule).
- Never add lint-disable / type-ignore comments (hook-blocked).
- Run the client/section tests with: `bun test tests/client/settings/sections/MembersSection.test.ts`
- Run a single test by name with: `bun test <file> -t "<test name>"`
- Visual shots require Storybook running (`bun storybook`) in another terminal, then `bun shoot -g <Story>`.
- Format before committing: `bun run format` (oxfmt). The pre-commit hook runs lint + typecheck + format:check + license-headers on staged files.

---

## Unit 1 — MembersSection client behavior

Files touched across Unit 1:

- Modify: `client/shared/Confirm.svelte` (add `busy` prop)
- Test: `tests/client/shared/Confirm.test.ts` (create)
- Modify: `client/settings/sections/MembersSection.svelte`
- Test: `tests/client/settings/sections/MembersSection.test.ts` (extend/update)
- Modify: `tests/visual/settings/sections/MembersSection.spec.ts` (add states)

### Task 1.1: Add a `busy` prop to the shared `Confirm` dialog

**Files:**

- Modify: `client/shared/Confirm.svelte`
- Test: `tests/client/shared/Confirm.test.ts` (create)

Rationale: the remove flow keeps the dialog open through the async delete, so the dialog must
be able to disable its buttons and block closing while in flight.

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/Confirm.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { createRawSnippet, flushSync, mount, unmount } from 'svelte'

import Confirm from '../../../client/shared/Confirm.svelte'

const bodySnippet = createRawSnippet(() => ({ render: () => '<p>Are you sure?</p>' }))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Confirm', () => {
  test('busy disables both footer buttons', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(Confirm, {
      target,
      props: {
        open: true,
        title: 'Remove member',
        busy: true,
        body: bodySnippet,
        onCancel: () => {},
        onConfirm: () => {},
      },
    })
    flushSync()
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.modal-footer .ui-btn')]
    expect(buttons.length).toBe(2)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    void unmount(component)
  })

  test('not busy leaves footer buttons enabled', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(Confirm, {
      target,
      props: {
        open: true,
        title: 'Remove member',
        body: bodySnippet,
        onCancel: () => {},
        onConfirm: () => {},
      },
    })
    flushSync()
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.modal-footer .ui-btn')]
    expect(buttons.some((b) => b.disabled)).toBe(false)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/Confirm.test.ts`
Expected: FAIL — `busy` is not a prop yet, so buttons are not disabled (`busy disables both footer buttons` fails).

- [ ] **Step 3: Add the `busy` prop and wire it into `Btn` `disabled`**

Edit `client/shared/Confirm.svelte`. Add `busy` to the `Props` interface and destructuring, disable both buttons when busy, and make the confirm button show a pending label. Replace the `<script>` props block and the `footer` snippet:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Btn from './ui/Btn.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    title: string
    onCancel: () => void
    onConfirm: () => void
    body: Snippet
    cancelLabel?: string
    confirmLabel?: string
    danger?: boolean
    busy?: boolean
  }
  let { open, title, onCancel, onConfirm, body, cancelLabel, confirmLabel, danger = false, busy = false }: Props =
    $props()
  const resolvedCancelLabel = $derived(cancelLabel ?? 'Cancel')
  const resolvedConfirmLabel = $derived(confirmLabel ?? 'Confirm')
</script>

<Modal {open} {title} onClose={busy ? () => {} : onCancel} {body} size="sm">
  {#snippet footer()}
    <Btn variant="secondary" disabled={busy} onClick={onCancel}>
      {#snippet children()}{resolvedCancelLabel}{/snippet}
    </Btn>
    <Btn variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
      {#snippet children()}{busy ? 'Working…' : resolvedConfirmLabel}{/snippet}
    </Btn>
  {/snippet}
</Modal>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/Confirm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Confirm no existing callers broke**

Run: `bun test tests/client/settings/sections/CodeHostSection.test.ts tests/client/settings/sections/MemorySection.test.ts`
Expected: PASS (existing `Confirm` callers pass `busy` implicitly as `false`).

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/shared/Confirm.svelte tests/client/shared/Confirm.test.ts
git commit -m "feat(settings): add busy prop to shared Confirm dialog"
```

### Task 1.2: Loading state distinct from empty

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte:104-117` (table region)
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/sections/MembersSection.test.ts` inside `describe('MembersSection', …)`. This uses a fetch that stays pending so the loading frame is observable:

```ts
test('shows Loading placeholder before the first fetch resolves, not "No members"', async () => {
  let resolveFetch: (r: Response) => void = () => {}
  setMockFetch(() => new Promise<Response>((resolve) => (resolveFetch = resolve)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  flushSync()
  expect(target.textContent).toContain('Loading…')
  expect(target.textContent).not.toContain('No members')
  resolveFetch(json({ contextId: 'group:7', members: [] }))
  await drain()
  expect(target.textContent).toContain('No members')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "Loading placeholder"`
Expected: FAIL — currently the empty table ("No members") renders during loading, so `toContain('Loading…')` fails.

- [ ] **Step 3: Guard the table region with the loading state**

In `client/settings/sections/MembersSection.svelte`, wrap the `settings-table-wrap` block. Replace the existing `<div class="settings-table-wrap"> … </div>` (lines 104-117) with:

```svelte
  {#if loading && members.length === 0}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="settings-table-wrap">
      {#snippet cell(row: MemberRow, col: { key: string; label: string })}
        {#if col.key === 'actions'}
          <Btn variant="ghost" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => void remove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
        {:else}
          {String(row[col.key as keyof MemberRow] ?? '')}
        {/if}
      {/snippet}
      <DataTable columns={memberColumns} rows={memberRows} {cell} rowKey="user_id">
        {#snippet empty()}No members{/snippet}
      </DataTable>
    </div>
  {/if}
```

(The Remove button changes further in Task 1.4; leave it as-is here.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "Loading placeholder"`
Expected: PASS. Also run the whole file to confirm no regressions: `bun test tests/client/settings/sections/MembersSection.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): distinguish MembersSection loading state from empty"
```

### Task 1.3: Add in-flight pending state + double-submit guard

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (`add()` + submit button)
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the test file:

```ts
test('add disables the button and shows "Adding…" while in flight, and blocks double-submit', async () => {
  setCsrfToken('c')
  let postCalls = 0
  let resolvePost: (r: Response) => void = () => {}
  setMockFetch((url: string, init: RequestInit) => {
    if (url.includes('/group/members') && init.method === 'POST') {
      postCalls += 1
      return new Promise<Response>((resolve) => (resolvePost = resolve))
    }
    return Promise.resolve(json({ contextId: 'group:7', members: [] }))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="member-add-input"]')!
  input.value = '99'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="member-add"]')!
  btn.click()
  flushSync()
  expect(btn.disabled).toBe(true)
  expect(btn.textContent).toContain('Adding…')
  btn.click() // second click must not fire a second POST
  flushSync()
  expect(postCalls).toBe(1)
  resolvePost(json({ ok: true, contextId: 'group:7' }))
  await drain()
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "Adding…"`
Expected: FAIL — button is never disabled and has no "Adding…" label, and a second click fires a second POST.

- [ ] **Step 3: Add the `adding` flag and bind it to the button**

In `MembersSection.svelte` script, add state near the other `$state` declarations:

```ts
let adding = $state(false)
```

Replace the `add()` function (lines 39-50) with:

```ts
async function add(): Promise<void> {
  if (adding) return
  error = null
  const userId = newUserId.trim()
  if (userId === '') return
  adding = true
  try {
    await addGroupMember({ userId, contextId })
    newUserId = ''
    await load(contextId)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    adding = false
  }
}
```

Replace the submit `Btn` (lines 99-101) with:

```svelte
    <Btn variant="primary" type="submit" disabled={adding} testid="member-add">
      {#snippet children()}{adding ? 'Adding…' : 'Add member'}{/snippet}
    </Btn>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "Adding…"`
Expected: PASS. Run the full file → PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): signal in-flight add and block double-submit in MembersSection"
```

### Task 1.4: Gate Remove behind a confirmation dialog

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (remove flow + `Confirm`)
- Test: `tests/client/settings/sections/MembersSection.test.ts` (UPDATE the existing DELETE test)

- [ ] **Step 1: Update the existing DELETE test + add a "no confirm = no delete" test**

Replace the existing test `removing a member sends a DELETE with userId + contextId` (lines 84-95) with the two tests below. The old test clicked Remove and expected an immediate DELETE; that is exactly the behavior we are removing.

```ts
test('clicking Remove does not delete until the confirmation is accepted', async () => {
  setCsrfToken('c')
  setMockFetch(capturePostMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="member-remove-42"]')!.click()
  await drain()
  expect(capturedDeleteBody).toBeUndefined() // dialog open, nothing deleted yet
  expect(document.querySelector('.modal')).not.toBeNull()
  void unmount(component)
})

test('confirming the dialog sends a DELETE with userId + contextId', async () => {
  setCsrfToken('c')
  setMockFetch(capturePostMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="member-remove-42"]')!.click()
  await drain()
  // Confirm does not forward a testid to its confirm button; target the danger variant.
  target.querySelector<HTMLButtonElement>('.modal-footer .ui-btn--danger')!.click()
  await drain()
  expect(capturedDeleteBody).toBe(JSON.stringify({ userId: '42', contextId: 'group:7' }))
  void unmount(component)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "confirmation"`
Expected: FAIL — there is no dialog; the danger confirm button does not exist and Remove deletes immediately.

- [ ] **Step 3: Implement the confirmation flow**

In `MembersSection.svelte` script, add imports and state:

```ts
import Confirm from '../../shared/Confirm.svelte'
```

```ts
let pendingRemove = $state<{ userId: string; label: string } | null>(null)
let removing = $state(false)
let removeError = $state<string | null>(null)
```

Replace the `remove()` function (lines 52-60) with a request-runner that is invoked on confirm:

```ts
function requestRemove(userId: string): void {
  removeError = null
  pendingRemove = { userId, label: userId }
}

async function confirmRemove(): Promise<void> {
  const target = pendingRemove
  if (target === null || removing) return
  removeError = null
  removing = true
  try {
    await removeGroupMember({ userId: target.userId, contextId })
    pendingRemove = null
    await load(contextId)
  } catch (err) {
    removeError = err instanceof Error ? err.message : String(err)
  } finally {
    removing = false
  }
}
```

In the `cell` snippet (inside the `{:else}` table branch added in Task 1.2), change the Remove button's `onClick` to open the dialog and give the confirm button a testid. Replace the Remove `Btn` with:

```svelte
          <Btn variant="ghost" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => requestRemove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
```

Add the `Confirm` dialog just before the closing `</section>` tag:

```svelte
  <Confirm
    open={pendingRemove !== null}
    title="Remove member"
    danger
    busy={removing}
    confirmLabel="Remove"
    onCancel={() => (pendingRemove = null)}
    onConfirm={() => void confirmRemove()}>
    {#snippet body()}
      <p>Remove {pendingRemove?.label} from this group? They'll lose access to the bot here.</p>
      {#if removeError !== null}<p class="status-error" data-testid="member-remove-error">{removeError}</p>{/if}
    {/snippet}
  </Confirm>
```

(The dialog's confirm button is the `danger` variant rendered by `Confirm` → `Modal`, matched
in the tests via `.modal-footer .ui-btn--danger`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "confirmation"` and `-t "confirming the dialog"`
Expected: PASS. Run the full file → PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): confirm before removing a group member"
```

### Task 1.5: Surface remove errors inside the dialog

**Files:**

- Test: `tests/client/settings/sections/MembersSection.test.ts`
- (implementation already added in Task 1.4 via `removeError`; this task proves it)

- [ ] **Step 1: Write the failing-then-passing regression test**

Add:

```ts
test('a failed remove shows the error inside the still-open dialog', async () => {
  setCsrfToken('c')
  setMockFetch((url: string, init: RequestInit) => {
    if (url.includes('/group/members') && init.method === 'DELETE') {
      return Promise.resolve(new Response('nope', { status: 500 }))
    }
    return Promise.resolve(json(membersPayload))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="member-remove-42"]')!.click()
  await drain()
  target.querySelector<HTMLButtonElement>('.modal-footer .ui-btn--danger')!.click()
  await drain()
  expect(document.querySelector('.modal')).not.toBeNull() // dialog stayed open
  expect(target.querySelector('[data-testid="member-remove-error"]')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run the test**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "failed remove"`
Expected: PASS (implementation from Task 1.4 already handles it). If it fails, the dialog is closing on error — verify `confirmRemove` only clears `pendingRemove` in the success branch.

- [ ] **Step 3: Commit**

```bash
git add tests/client/settings/sections/MembersSection.test.ts
git commit -m "test(settings): cover MembersSection remove-error stays in dialog"
```

### Task 1.6: Format `added_at` with the shared helper

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (import + `memberRows`)
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add:

```ts
test('formats added_at instead of showing a raw ISO timestamp', async () => {
  setMockFetch(() =>
    Promise.resolve(
      json({
        contextId: 'group:7',
        members: [{ user_id: '42', added_by: '1', added_at: '2026-05-01T00:00:00Z' }],
      }),
    ),
  )
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  expect(target.textContent).toContain('2026-05-01 00:00')
  expect(target.textContent).not.toContain('2026-05-01T00:00:00Z')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "added_at"`
Expected: FAIL — raw `2026-05-01T00:00:00Z` is rendered.

- [ ] **Step 3: Apply `formatDateTime` in `memberRows`**

Add the import near the other imports in `MembersSection.svelte`:

```ts
import { formatDateTime } from '../../shared/helpers.js'
```

Replace the `memberRows` derived (lines 72-74) with:

```ts
const memberRows = $derived<MemberRow[]>(
  members.map((m) => ({ user_id: m.user_id, added_by: m.added_by, added_at: formatDateTime(m.added_at) })),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "added_at"`
Expected: PASS. Full file → PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): format MembersSection added_at via shared helper"
```

### Task 1.7: Error spacing + add-form alignment (section-local CSS)

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (top error markup + a scoped `<style>`)

No unit test (pure styling); verified in the visual task 1.8.

- [ ] **Step 1: Give the top error vertical rhythm and lay out the add row locally**

In `MembersSection.svelte`, replace the top error line (line 91) so it carries a spacing class:

```svelte
  {#if error !== null}<p class="status-error members-error">{error}</p>{/if}
```

Wrap the add form so the button sits inline with the input on one clean edge and the hint sits
below, using a section-local class rather than the shared `.settings-form` (which is inert
here). Replace the `<form class="settings-form" …>` opening tag with:

```svelte
  <form class="settings-form members-add" onsubmit={(event) => { event.preventDefault(); void add() }}>
```

Add a scoped `<style>` block at the end of the component (Svelte scopes it to this component):

```svelte
<style>
  .members-error {
    margin: 0 0 var(--gap-field);
  }
  /* Keep the input growing and the button on the same baseline; hint wraps below the row. */
  .members-add :global(.ui-field) {
    flex: 1;
    min-width: 220px;
  }
</style>
```

- [ ] **Step 2: Typecheck + build the client**

Run: `bun run typecheck`
Expected: PASS (no type errors introduced).

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte
git commit -m "style(settings): space MembersSection error and align add row"
```

### Task 1.8: Capture the new visual states

**Files:**

- Modify: `tests/visual/settings/sections/MembersSection.spec.ts` (manual region, below `// @generated-end auto-screenshots`)

- [ ] **Step 1: Add interaction-state screenshots**

Below the `// @generated-end auto-screenshots` marker in `tests/visual/settings/sections/MembersSection.spec.ts`, add (keeping any states added during the review):

```ts
test('MembersSection — remove confirmation open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-memberssection--populated')
  await sharedPage.setViewportSize({ width: 1280, height: 720 })
  await sharedPage.getByTestId('member-remove-u1').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('MembersSection — loading is distinct from empty', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-memberssection--loading')
  await sharedPage.setViewportSize({ width: 1280, height: 720 })
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Shoot the states**

Ensure Storybook is running (`bun storybook`), then:

Run: `bun shoot -g MembersSection`
Expected: all MembersSection screenshots pass/write; the two new PNGs are written under `.storybook-shots/settings/sections/MembersSection.spec.ts/`.

- [ ] **Step 3: Read the new PNGs to sanity-check**

Read `.storybook-shots/settings/sections/MembersSection.spec.ts/MembersSection-—-remove-confirmation-open-1.png` and confirm the danger dialog renders with the member label. Confirm the loading shot shows "Loading…", not "No members".

- [ ] **Step 4: Commit**

```bash
git add tests/visual/settings/sections/MembersSection.spec.ts
git commit -m "test(visual): add MembersSection confirm + loading states"
```

---

## Unit 2 — Shared affordance

Files touched:

- Modify: `client/settings/sections/MembersSection.svelte` (Remove variant)
- Modify: `client/shared/ui/IconButton.svelte` (resting contrast)

### Task 2.1: Give Remove a destructive resting affordance

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (Remove `Btn` variant)
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add:

```ts
test('Remove uses the danger button variant', async () => {
  setMockFetch(() => Promise.resolve(json(membersPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="member-remove-42"]')!
  expect(btn.classList.contains('ui-btn--danger')).toBe(true)
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "danger button variant"`
Expected: FAIL — the Remove button is currently `variant="ghost"` (`ui-btn--ghost`).

- [ ] **Step 3: Switch the Remove button variant**

In the `cell` snippet in `MembersSection.svelte`, change the Remove `Btn` from `variant="ghost"` to `variant="danger"`:

```svelte
          <Btn variant="danger" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => requestRemove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "danger button variant"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): make MembersSection Remove read as destructive"
```

### Task 2.2: Raise the IconButton resting contrast (shared — cross-section check)

**Files:**

- Modify: `client/shared/ui/IconButton.svelte:38`

This changes every section header that uses `IconButton`, so it carries a cross-section
visual re-check.

- [ ] **Step 1: Bump the resting color token**

In `client/shared/ui/IconButton.svelte`, change the `.ui-iconbtn` rule's resting color from the
muted token to the brighter secondary foreground:

```css
.ui-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--fg2);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 13px;
}
```

(Only the `color` line changes: `var(--text-muted)` → `var(--fg2)`.)

- [ ] **Step 2: Re-shoot IconButton and a sample of section headers**

Ensure Storybook is running, then:

Run: `bun shoot -g IconButton && bun shoot -g MembersSection && bun shoot -g ProfileSection && bun shoot -g CodeHostSection`
Expected: shots write. Read one header PNG (e.g. `ProfileSection` populated) and confirm the `⟳` glyph is legible and not overbearing across sections.

- [ ] **Step 3: Run the full visual + client suites**

Run: `bun test tests/client`
Expected: PASS (no assertions depend on the old color).

- [ ] **Step 4: Commit**

```bash
bun run format
git add client/shared/ui/IconButton.svelte tests/visual
git commit -m "style(ui): raise IconButton resting contrast"
```

---

## Unit 3 — Backend name enrichment (hybrid cache → live)

The members GET is enriched with display labels. Resolution is reached through the existing
runtime chat-router singleton (`getRuntimeChatRouter()`) — the same pattern
`resolveSettingsUserId` already uses inside `group-routes.ts` — so **no dependency is threaded
through `handleGroupRoutes`**.

Files touched:

- Modify: `src/group-settings/registry.ts` (add a batch label read) + `tests/group-settings/member-observation-labels.test.ts` (create)
- Create: `src/debug/settings/member-labels.ts` + `tests/debug/settings/member-labels.test.ts`
- Modify: `src/debug/settings/group-routes.ts` (async `handleMembersGet` + enrichment)
- Modify: `tests/debug/settings/group-routes.test.ts` (enrichment cases)
- Modify: `client/settings/fetcher-schemas.ts:186` (nullable label fields) + `tests/client/settings/member-schema.test.ts` (create)
- Modify: `client/settings/sections/MembersSection.svelte` (render labels) + `tests/client/settings/sections/MembersSection.test.ts`

### Task 3.1: Add a batch label read to the registry

**Files:**

- Modify: `src/group-settings/registry.ts`
- Test: `tests/group-settings/member-observation-labels.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/group-settings/member-observation-labels.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getGroupUserObservationLabels, upsertGroupUserObservation } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('getGroupUserObservationLabels', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns displayLabel per userId for matching (provider, contextId)', () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'c1',
      userId: '42',
      username: 'ann',
      displayLabel: 'Ann (@ann)',
    })
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'c1',
      userId: '43',
      username: null,
      displayLabel: 'Bob',
    })
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'other',
      userId: '42',
      username: 'x',
      displayLabel: 'Wrong Ctx',
    })

    const labels = getGroupUserObservationLabels('telegram', 'c1', ['42', '43', '99'])
    expect(labels.get('42')).toBe('Ann (@ann)')
    expect(labels.get('43')).toBe('Bob')
    expect(labels.has('99')).toBe(false) // no observation → absent
  })

  test('returns an empty map for no ids', () => {
    expect(getGroupUserObservationLabels('telegram', 'c1', []).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/group-settings/member-observation-labels.test.ts`
Expected: FAIL — `getGroupUserObservationLabels` is not exported.

- [ ] **Step 3: Add the exported batch query**

In `src/group-settings/registry.ts`, extend the drizzle import on line 6 to include `inArray`:

```ts
import { and, eq, inArray } from 'drizzle-orm'
```

Add this exported function (place it near the other `groupUserObservations` helpers, after `upsertGroupUserObservation`):

```ts
/** Batch-read cached display labels for members of a group, keyed by userId. Missing ids are absent. */
export function getGroupUserObservationLabels(
  provider: string,
  contextId: string,
  userIds: readonly string[],
): Map<string, string> {
  if (userIds.length === 0) return new Map()
  const rows = getDrizzleDb()
    .select({ userId: groupUserObservations.userId, displayLabel: groupUserObservations.displayLabel })
    .from(groupUserObservations)
    .where(
      and(
        eq(groupUserObservations.provider, provider),
        eq(groupUserObservations.contextId, contextId),
        inArray(groupUserObservations.userId, [...userIds]),
      ),
    )
    .all()
  return new Map(rows.map((r) => [r.userId, r.displayLabel]))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/group-settings/member-observation-labels.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/group-settings/registry.ts tests/group-settings/member-observation-labels.test.ts
git commit -m "feat(group-settings): batch-read group member display labels"
```

### Task 3.2: Create the `resolveMemberLabels` resolver

**Files:**

- Create: `src/debug/settings/member-labels.ts`
- Test: `tests/debug/settings/member-labels.test.ts` (create)

Pure, dependency-injected — no DB or router. Cache hits win; misses fall back to a bounded set
of live calls; a live rejection yields `null` for that id; the function never throws.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/member-labels.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { resolveMemberLabels } from '../../../src/debug/settings/member-labels.js'

describe('resolveMemberLabels', () => {
  test('uses the cache and never calls live for a cache hit', async () => {
    const live = mock(() => Promise.resolve<string | null>('LIVE'))
    const out = await resolveMemberLabels(['42'], new Map([['42', 'Cached Ann']]), live)
    expect(out.get('42')).toBe('Cached Ann')
    expect(live).not.toHaveBeenCalled()
  })

  test('falls back to the live resolver on a cache miss', async () => {
    const live = mock((id: string) => Promise.resolve<string | null>(`Live ${id}`))
    const out = await resolveMemberLabels(['42', '43'], new Map([['42', 'Cached']]), live)
    expect(out.get('42')).toBe('Cached')
    expect(out.get('43')).toBe('Live 43')
    expect(live).toHaveBeenCalledTimes(1)
  })

  test('yields null when the live resolver rejects (best-effort, no throw)', async () => {
    const live = mock(() => Promise.reject(new Error('platform down')))
    const out = await resolveMemberLabels(['99'], new Map(), live)
    expect(out.get('99')).toBeNull()
  })

  test('yields null when live resolves null', async () => {
    const live = mock(() => Promise.resolve<string | null>(null))
    const out = await resolveMemberLabels(['99'], new Map(), live)
    expect(out.get('99')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/member-labels.test.ts`
Expected: FAIL — module `member-labels.js` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/debug/settings/member-labels.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

export type LiveLabelResolver = (userId: string) => Promise<string | null>

const LIVE_CONCURRENCY = 5

/**
 * Resolve a display label for each userId. Cache hits (from the prefetched map) win; misses
 * fall back to a bounded set of live resolver calls. A live call that rejects yields null for
 * that id — resolution is best-effort and never throws.
 */
export async function resolveMemberLabels(
  userIds: readonly string[],
  cached: ReadonlyMap<string, string>,
  resolveLive: LiveLabelResolver,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>()
  const misses: string[] = []
  for (const id of userIds) {
    const hit = cached.get(id)
    if (hit !== undefined) result.set(id, hit)
    else misses.push(id)
  }
  const limit = pLimit(LIVE_CONCURRENCY)
  await Promise.all(
    misses.map((id) =>
      limit(async () => {
        try {
          result.set(id, await resolveLive(id))
        } catch {
          result.set(id, null)
        }
      }),
    ),
  )
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/member-labels.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/debug/settings/member-labels.ts tests/debug/settings/member-labels.test.ts
git commit -m "feat(settings): add hybrid member-label resolver"
```

### Task 3.3: Add nullable label fields to the client schema

**Files:**

- Modify: `client/settings/fetcher-schemas.ts:186`
- Test: `tests/client/settings/member-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/member-schema.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GroupMembersResponseSchema } from '../../../client/settings/fetcher-schemas.js'

describe('GroupMembersResponseSchema label fields', () => {
  test('accepts members with label fields', () => {
    const parsed = GroupMembersResponseSchema.parse({
      contextId: 'c1',
      members: [{ user_id: '42', added_by: '1', added_at: 't', user_label: 'Ann', added_by_label: 'Admin' }],
    })
    expect(parsed.members[0]!.user_label).toBe('Ann')
    expect(parsed.members[0]!.added_by_label).toBe('Admin')
  })

  test('accepts members without label fields (backward compatible)', () => {
    const parsed = GroupMembersResponseSchema.parse({
      contextId: 'c1',
      members: [{ user_id: '42', added_by: '1', added_at: 't' }],
    })
    expect(parsed.members[0]!.user_label ?? null).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/member-schema.test.ts`
Expected: FAIL — `user_label` is stripped/undefined because the schema doesn't declare it (first test's `toBe('Ann')` fails).

- [ ] **Step 3: Extend `GroupMemberSchema`**

In `client/settings/fetcher-schemas.ts`, replace line 186:

```ts
export const GroupMemberSchema = z.object({
  user_id: z.string(),
  added_by: z.string(),
  added_at: z.string(),
  user_label: z.string().nullish(),
  added_by_label: z.string().nullish(),
})
```

(`z.string().nullish()` = `string | null | undefined`, so both new and legacy payloads parse.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/member-schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/fetcher-schemas.ts tests/client/settings/member-schema.test.ts
git commit -m "feat(settings): add nullable member label fields to schema"
```

### Task 3.4: Enrich the members GET route

**Files:**

- Modify: `src/debug/settings/group-routes.ts` (imports, `handleMembersGet`, dispatch at `:229`)
- Test: `tests/debug/settings/group-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/debug/settings/group-routes.test.ts`. The first proves the live path via a mock
router that implements `resolveUserLabel`; the second proves the endpoint still returns 200
with null labels when the router is absent (best-effort). Add a label mock and extend
`MockChatRouter`:

At the top, alongside `mockResolveUserId`:

```ts
const mockResolveUserLabel = mock((userId: string, _context?: unknown) =>
  Promise.resolve<string | null>(userId === 'member-1' ? 'Member One (@m1)' : null),
)
```

Add the override inside `class MockChatRouter`:

```ts
  override resolveUserLabel(userId: string, context?: unknown): Promise<string | null> {
    return mockResolveUserLabel(userId, context)
  }
```

Add `mockResolveUserLabel.mockClear()` in the existing `beforeEach` (next to `mockResolveUserId.mockClear()`).

Then add the tests (note `member-1` is stored as `resolved-member-1` by the POST resolver, so
the live mock keys off the raw member id the GET passes — adjust the fixture to add the raw id
directly via a second observation-free member). Use a direct add of a numeric id so no rename
happens:

```ts
const MembersLabelSchema = z.object({
  contextId: z.string(),
  members: z.array(
    z.object({
      user_id: z.string(),
      added_by: z.string(),
      added_at: z.string(),
      user_label: z.string().nullable(),
      added_by_label: z.string().nullable(),
    }),
  ),
})

test('members GET enriches user_label via the live resolver', async () => {
  const contextId = seedManageableGroup()
  // numeric id is added verbatim (resolver returns it unchanged), so the GET passes 'member-1'
  // through resolveUserLabel; use a numeric id the mock recognises.
  mockResolveUserLabel.mockImplementation((userId: string) =>
    Promise.resolve<string | null>(userId === '777' ? 'Lucky (@lucky)' : null),
  )
  const postUrl = new URL('https://x/settings/api/group/members')
  await handleGroupRoutes(
    new Request(postUrl, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '777', contextId }),
    }),
    postUrl,
    '/settings/api/group/members',
  )
  const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
  const res = await handleGroupRoutes(
    new Request(getUrl, { headers: authHeaders(session) }),
    getUrl,
    '/settings/api/group/members',
  )
  expect(res.status).toBe(200)
  const body = MembersLabelSchema.parse(await res.json())
  const row = body.members.find((m) => m.user_id === '777')!
  expect(row.user_label).toBe('Lucky (@lucky)')
})

test('members GET returns 200 with null labels when the chat router is absent', async () => {
  const contextId = seedManageableGroup()
  const postUrl = new URL('https://x/settings/api/group/members')
  await handleGroupRoutes(
    new Request(postUrl, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '777', contextId }),
    }),
    postUrl,
    '/settings/api/group/members',
  )
  clearRuntimeChatRouter() // no live resolver available
  const getUrl = new URL(`https://x/settings/api/group/members?contextId=${encodeURIComponent(contextId)}`)
  const res = await handleGroupRoutes(
    new Request(getUrl, { headers: authHeaders(session) }),
    getUrl,
    '/settings/api/group/members',
  )
  expect(res.status).toBe(200)
  const body = MembersLabelSchema.parse(await res.json())
  expect(body.members.every((m) => m.user_label === null)).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/group-routes.test.ts -t "user_label"`
Expected: FAIL — the response has no `user_label`/`added_by_label` fields, so `MembersLabelSchema.parse` throws.

- [ ] **Step 3: Add enrichment to the route**

In `src/debug/settings/group-routes.ts`, add imports (top of file, with the other imports):

```ts
import { parseScopedContextId } from '../../chat/scoped-context.js'
import { resolveSourceProviderName } from '../../chat/source-instance.js'
import { getPlatformInstance } from '../../instances/platform-store.js'
import { getGroupUserObservationLabels } from '../../group-settings/registry.js'
import { getRuntimeChatRouter } from '../chat-router-runtime.js'
import { resolveMemberLabels } from './member-labels.js'
```

Add the enrichment helpers (place them above `handleMembersGet`):

```ts
type BareMember = { user_id: string; added_by: string; added_at: string }
type EnrichedMember = BareMember & { user_label: string | null; added_by_label: string | null }

/** Resolve the persisted provider name for a platform instance, preferring the live router. */
function resolveProviderName(platformInstanceId: string): string | null {
  const router = getRuntimeChatRouter()
  if (router !== null) {
    try {
      return resolveSourceProviderName(router, platformInstanceId)
    } catch {
      // fall through to the platform-store type
    }
  }
  return getPlatformInstance(platformInstanceId)?.type ?? null
}

/** Best-effort display-label enrichment. Never throws — falls back to raw ids on any failure. */
async function enrichMembers(contextId: string, members: BareMember[]): Promise<EnrichedMember[]> {
  const bare = (): EnrichedMember[] => members.map((m) => ({ ...m, user_label: null, added_by_label: null }))
  try {
    const parsed = parseScopedContextId(contextId)
    if (parsed === null) return bare()
    const { platformInstanceId } = parsed
    const provider = resolveProviderName(platformInstanceId)
    const ids = [...new Set(members.flatMap((m) => [m.user_id, m.added_by]))]
    const cached =
      provider === null ? new Map<string, string>() : getGroupUserObservationLabels(provider, contextId, ids)
    const router = getRuntimeChatRouter()
    const resolveLive = (userId: string): Promise<string | null> =>
      router?.resolveUserLabel?.(userId, { contextId, contextType: 'group', platformInstanceId }) ??
      Promise.resolve(null)
    const labels = await resolveMemberLabels(ids, cached, resolveLive)
    return members.map((m) => ({
      ...m,
      user_label: labels.get(m.user_id) ?? null,
      added_by_label: labels.get(m.added_by) ?? null,
    }))
  } catch {
    return bare()
  }
}
```

Replace `handleMembersGet` (lines 57-61) with an async version:

```ts
async function handleMembersGet(authed: AuthenticatedSettingsRequest, url: URL): Promise<Response> {
  const outcome = requireGroup(authed, 'read', url.searchParams.get('contextId'))
  if (!outcome.ok) return outcome.response
  const contextId = outcome.group.contextId
  const members = await enrichMembers(contextId, listGroupMembers(contextId))
  return settingsJson(200, { contextId, members })
}
```

Update the dispatch on line 229 (it now returns a promise directly):

```ts
if (req.method === 'GET') return handleMembersGet(auth.authed, url)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/group-routes.test.ts`
Expected: PASS — the two new tests plus all existing members/task-instance tests (the existing
`members GET returns member list` asserts `members` is an array and still holds).

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/debug/settings/group-routes.ts tests/debug/settings/group-routes.test.ts
git commit -m "feat(settings): enrich group members GET with display labels"
```

### Task 3.5: Render labels in MembersSection

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte` (columns, `MemberRow`, `memberRows`, `cell`)
- Test: `tests/client/settings/sections/MembersSection.test.ts`

- [ ] **Step 1: Write the failing test**

Add:

```ts
test('renders the display label as primary with the raw id as secondary', async () => {
  setMockFetch(() =>
    Promise.resolve(
      json({
        contextId: 'group:7',
        members: [
          { user_id: '42', added_by: '1', added_at: '2026-05-01', user_label: 'Ann (@ann)', added_by_label: 'Admin' },
          { user_id: '43', added_by: '1', added_at: '2026-05-01', user_label: null, added_by_label: 'Admin' },
        ],
      }),
    ),
  )
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
  await drain()
  expect(target.textContent).toContain('Ann (@ann)') // labelled member: label shown
  expect(target.textContent).toContain('42') // ...and raw id still present as secondary
  expect(target.textContent).toContain('Admin') // added_by label
  expect(target.textContent).toContain('43') // unlabelled member: raw id shown
  const headers = [...target.querySelectorAll('.ui-datatable__th')].map((h) => h.textContent?.trim())
  expect(headers).toContain('Member')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "display label as primary"`
Expected: FAIL — the label text is not rendered and the column header is still "User ID".

- [ ] **Step 3: Render labels**

In `MembersSection.svelte`, update the `MemberRow` interface:

```ts
interface MemberRow {
  user_id: string
  added_by: string
  added_at: string
  user_label: string | null
  added_by_label: string | null
}
```

Update `memberRows` to carry the labels (keep the `formatDateTime` from Task 1.6):

```ts
const memberRows = $derived<MemberRow[]>(
  members.map((m) => ({
    user_id: m.user_id,
    added_by: m.added_by,
    added_at: formatDateTime(m.added_at),
    user_label: m.user_label ?? null,
    added_by_label: m.added_by_label ?? null,
  })),
)
```

Rename the first column label in `memberColumns`:

```ts
const memberColumns = [
  { key: 'user_id' as const, label: 'Member' },
  { key: 'added_by' as const, label: 'Added by' },
  { key: 'added_at' as const, label: 'Added at' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Extend the `cell` snippet (inside the `{:else}` table branch) to render labels. Replace the
`cell` snippet body with:

```svelte
      {#snippet cell(row: MemberRow, col: { key: string; label: string })}
        {#if col.key === 'actions'}
          <Btn variant="danger" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => requestRemove(row.user_id)}>
            {#snippet children()}Remove{/snippet}
          </Btn>
        {:else if col.key === 'user_id'}
          <span class="member-cell">
            <span>{row.user_label ?? row.user_id}</span>
            {#if row.user_label !== null}<span class="member-cell__raw">{row.user_id}</span>{/if}
          </span>
        {:else if col.key === 'added_by'}
          {row.added_by_label ?? row.added_by}
        {:else}
          {String(row[col.key as keyof MemberRow] ?? '')}
        {/if}
      {/snippet}
```

Add to the scoped `<style>` block (from Task 1.7):

```css
.member-cell {
  display: inline-flex;
  flex-direction: column;
  line-height: 1.3;
}
.member-cell__raw {
  color: var(--fg3);
  font-size: 11px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/sections/MembersSection.test.ts -t "display label as primary"`
Expected: PASS. Run the full file → PASS (the existing `lists members` test still finds `42`).

- [ ] **Step 5: Re-shoot the populated state**

Ensure Storybook is running. To see labels in the shot, the fixture may need label fields; if
the `settings-members-populated` fixture lacks them, the shot simply shows raw ids (still
valid). Run: `bun shoot -g MembersSection` and read the populated PNG to confirm layout.

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts tests/visual
git commit -m "feat(settings): show member display names in MembersSection"
```

---

## Final verification

- [ ] **Run the full affected suites**

Run: `bun test tests/client/settings tests/debug/settings tests/group-settings`
Expected: PASS.

- [ ] **Typecheck + lint the whole repo**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Confirm the review findings are closed**

Cross-check each row of the "Findings → units map" in the spec against the committed work:
confirmation dialog (1.4), loading≠empty (1.2), add pending (1.3), split errors (1.4/1.5/1.7),
formatted date (1.6), form alignment (1.7), destructive Remove (2.1), refresh contrast (2.2),
display names (3.1–3.5).
