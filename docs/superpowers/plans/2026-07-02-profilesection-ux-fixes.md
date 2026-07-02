<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ProfileSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 8 findings from the ProfileSection UX re-review by repairing the shared config-field components and the design-system tokens they depend on, so all three config sections (Profile, TaskProvider, AiOutput) improve together.

**Architecture:** Bottom-up — add tokens, reconcile the primitives that consume them, build a shared `ErrorState` component, then wire the sections. The one behavioral change is the "keep fields on refresh" loading guard; everything else is CSS or composition. Design source: [`docs/superpowers/specs/2026-07-02-profilesection-ux-fixes-design.md`](../specs/2026-07-02-profilesection-ux-fixes-design.md).

**Tech Stack:** Svelte 5 (runes), TypeScript (strict, `.js` import paths), Bun test runner with happy-dom for client component tests (`bun run test:client`), Storybook + Playwright for visual shots (`bun shoot`), `oxfmt` formatter.

---

## Conventions used throughout

- **Run a single client test file:**
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- **Run the whole client suite:** `bun run test:client`
- **Format before commit:** `bun run format` (oxfmt — NOT prettier). The pre-commit hook runs
  lint/typecheck/format:check/license-headers on staged files.
- All new files need the 4-line SPDX license header (`.svelte` uses `<!-- … -->`, `.ts` uses `// …`).
  Copy the header from any sibling file; `bun run license:headers` also stamps missing ones.
- Commit after each task. Do not create a branch — commit to the current branch (`master`).

## File structure

| File                                                      | Responsibility                                              | Task |
| --------------------------------------------------------- | ----------------------------------------------------------- | ---- |
| `client/shared/tokens.css`                                | add `--gap-tight: 8px`, `--radius-control: 2px`             | 1    |
| `tests/client/shared/tokens.test.ts`                      | assert the two new tokens exist                             | 1    |
| `client/shared/ui/Btn.svelte`                             | radius → `var(--radius-control)`                            | 2    |
| `client/shared/ui/Input.svelte`                           | radius → `var(--radius-control)`                            | 2    |
| `client/shared/ui/IconButton.svelte`                      | radius → `var(--radius-control)`                            | 2    |
| `tests/client/shared/ui/control-radius.test.ts`           | assert the 3 primitives use the shared radius token         | 2    |
| `client/shared/ui/EmptyState.svelte`                      | hint color `--fg3` → `--fg2` (AA)                           | 3    |
| `tests/client/shared/ui/EmptyState.test.ts`               | assert hint uses `--fg2`                                    | 3    |
| `client/shared/ui/ErrorState.svelte`                      | **new** shared error card (message + retry)                 | 4    |
| `client/shared/ui/ErrorState.stories.svelte`              | **new** Storybook stories                                   | 4    |
| `tests/client/shared/ui/ErrorState.test.ts`               | **new** render + retry-callback tests                       | 4    |
| `client/settings/components/ConfigFieldRow.svelte`        | Clear `ghost`→`outline`, right-align actions, tokenize gaps | 5    |
| `tests/client/settings/components/ConfigFieldRow.test.ts` | assert Clear uses `outline`                                 | 5    |
| `client/settings/sections/ProfileSection.svelte`          | guard, ErrorState, empty action, sub intro, token gap       | 6    |
| `tests/client/settings/ProfileSection.test.ts`            | **new** guard/error/empty/sub behavior                      | 6    |
| `client/settings/sections/TaskProviderSection.svelte`     | guard (`instanceData`), ErrorState                          | 7    |
| `client/settings/sections/AiOutputSection.svelte`         | guard (`visible`), ErrorState                               | 8    |
| `tests/visual/**` + `.storybook-shots/**`                 | re-shoot + verify                                           | 9    |

---

## Task 1: Add `--gap-tight` and `--radius-control` tokens

**Files:**

- Modify: `client/shared/tokens.css` (the `--gap-*` / `--radius*` block, currently lines 44-49)
- Test: `tests/client/shared/tokens.test.ts` (the "layout + sizing tokens" case)

- [ ] **Step 1: Extend the token test to expect the new tokens (failing)**

In `tests/client/shared/tokens.test.ts`, add `'--gap-tight'` and `'--radius-control'` to the
array in the `'defines layout + sizing tokens'` test:

```ts
test('defines layout + sizing tokens', () => {
  for (const t of [
    '--content-max',
    '--table-max',
    '--gap-group',
    '--gap-section',
    '--gap-field',
    '--gap-inline',
    '--gap-tight',
    '--radius',
    '--radius-control',
    '--radius-pill',
    '--row-h',
  ]) {
    expect(css).toContain(`${t}:`)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/tokens.test.ts`
Expected: FAIL — `expect(css).toContain("--gap-tight:")` (and `--radius-control:`) not found.

- [ ] **Step 3: Add the tokens to `tokens.css`**

Edit the block so it reads (add the two new lines):

```css
--gap-group: 64px;
--gap-section: 40px;
--gap-field: 20px;
--gap-inline: 12px;
--gap-tight: 8px;
--radius: 6px;
--radius-control: 2px;
--radius-pill: 999px;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/shared/tokens.css tests/client/shared/tokens.test.ts
git commit -m "feat(tokens): add --gap-tight and --radius-control"
```

---

## Task 2: Reconcile control radius on Btn / Input / IconButton

All three control primitives should share `--radius-control` (2px) so adjacent controls match.
happy-dom does not reliably compute scoped-CSS custom properties, so this is guarded by a
deterministic source-assertion test (the repo already tests CSS by reading source, e.g.
`tokens.test.ts`, `base-css.test.ts`).

**Files:**

- Create: `tests/client/shared/ui/control-radius.test.ts`
- Modify: `client/shared/ui/Btn.svelte:54`, `client/shared/ui/Input.svelte:57`, `client/shared/ui/IconButton.svelte:37`

- [ ] **Step 1: Write the failing source-assertion test**

Create `tests/client/shared/ui/control-radius.test.ts` (add the 4-line `//` SPDX header first):

```ts
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('control primitives share --radius-control', () => {
  for (const file of ['Btn.svelte', 'Input.svelte', 'IconButton.svelte']) {
    test(`${file} uses var(--radius-control)`, () => {
      const css = read(`../../../../client/shared/ui/${file}`)
      expect(css).toContain('border-radius: var(--radius-control)')
    })
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/control-radius.test.ts`
Expected: FAIL for all three (they use `2px` / `var(--radius)`).

- [ ] **Step 3: Update the three components**

- `client/shared/ui/Btn.svelte:54` — change `border-radius: 2px;` → `border-radius: var(--radius-control);`
- `client/shared/ui/Input.svelte:57` — change `border-radius: 2px;` → `border-radius: var(--radius-control);`
- `client/shared/ui/IconButton.svelte:37` — change `border-radius: var(--radius);` → `border-radius: var(--radius-control);`

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/control-radius.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run existing primitive tests to confirm no regression**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Btn.test.ts tests/client/shared/ui/Input.test.ts tests/client/shared/ui/IconButton.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/shared/ui/Btn.svelte client/shared/ui/Input.svelte client/shared/ui/IconButton.svelte tests/client/shared/ui/control-radius.test.ts
git commit -m "fix(ui): unify control radius on --radius-control (2px)"
```

---

## Task 3: Raise EmptyState hint contrast to AA

`.ui-empty__hint` uses `--fg3` (`#6b766e`, ≈4:1 on `--bg`) — below AA. Switch to `--fg2`
(`#9aa79d`, ≈7:1). Guarded by a source-assertion (computed color of a CSS var is unreliable in
happy-dom).

**Files:**

- Modify: `client/shared/ui/EmptyState.svelte` (`.ui-empty__hint` rule)
- Test: `tests/client/shared/ui/EmptyState.test.ts`

- [ ] **Step 1: Add a failing source-assertion test**

Append this test inside the `describe('EmptyState.svelte', …)` block in
`tests/client/shared/ui/EmptyState.test.ts` (add the two imports at the top of the file if not
present: `import { readFileSync } from 'node:fs'` and `import { fileURLToPath } from 'node:url'`):

```ts
test('hint uses the AA-passing --fg2 token', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../../client/shared/ui/EmptyState.svelte', import.meta.url)),
    'utf8',
  )
  const hintRule = src.slice(src.indexOf('.ui-empty__hint'))
  expect(hintRule).toContain('color: var(--fg2)')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/EmptyState.test.ts`
Expected: FAIL — hint rule still uses `var(--fg3)`.

- [ ] **Step 3: Change the hint color**

In `client/shared/ui/EmptyState.svelte`, in the `.ui-empty__hint` rule, change
`color: var(--fg3);` → `color: var(--fg2);` (leave `font-size: 11px;` and `max-width` unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/EmptyState.test.ts`
Expected: PASS (3 tests: title/hint, action slot, hint token).

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/shared/ui/EmptyState.svelte tests/client/shared/ui/EmptyState.test.ts
git commit -m "fix(ui): raise EmptyState hint contrast to AA (--fg2)"
```

---

## Task 4: Create the shared `ErrorState` component

A centered error card mirroring `EmptyState`: icon + title + message, with an optional retry
button. Replaces the raw red `<p class="status-error">` in the sections (Tasks 6-8).

**Files:**

- Create: `client/shared/ui/ErrorState.svelte`
- Create: `client/shared/ui/ErrorState.stories.svelte`
- Create: `tests/client/shared/ui/ErrorState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/ErrorState.test.ts` (add the 4-line `//` SPDX header first):

```ts
import { describe, expect, test } from 'bun:test'
import { mount, unmount } from 'svelte'

import ErrorState from '../../../../client/shared/ui/ErrorState.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(ErrorState, { target, props }) }
}

describe('ErrorState.svelte', () => {
  test('renders the message and a default title', () => {
    const { target, component } = render({ message: 'boom' })
    expect(target.querySelector('.ui-error__message')?.textContent).toContain('boom')
    expect(target.querySelector('.ui-error__title')?.textContent).toContain('Something went wrong')
    expect(target.querySelector('[data-testid="error-retry"]')).toBeNull()
    void unmount(component)
  })

  test('renders a retry button that fires onRetry when clicked', () => {
    let retried = 0
    const { target, component } = render({
      message: 'boom',
      onRetry: () => {
        retried += 1
      },
    })
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    expect(retry!.textContent).toContain('Try again')
    retry!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(retried).toBe(1)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/ErrorState.test.ts`
Expected: FAIL — cannot resolve `ErrorState.svelte` (module not found).

- [ ] **Step 3: Create the component**

Create `client/shared/ui/ErrorState.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from './Btn.svelte'

  interface Props {
    message: string
    title?: string
    icon?: string
    onRetry?: () => void
    retryLabel?: string
  }

  let { message, title = 'Something went wrong', icon = '⚠', onRetry, retryLabel = 'Try again' }: Props = $props()
</script>

<div class="ui-error" role="alert">
  <div class="ui-error__icon">{icon}</div>
  <div class="ui-error__title">{title}</div>
  <div class="ui-error__message">{message}</div>
  {#if onRetry}
    <div class="ui-error__action">
      <Btn variant="outline" size="sm" onClick={onRetry} testid="error-retry">
        {#snippet children()}{retryLabel}{/snippet}
      </Btn>
    </div>
  {/if}
</div>

<style>
  .ui-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-tight);
    padding: 36px 24px;
    text-align: center;
    min-height: 120px;
  }
  .ui-error__icon {
    font-size: 22px;
    color: var(--danger);
    line-height: 1;
  }
  .ui-error__title {
    font-size: 13px;
    color: var(--fg2);
  }
  .ui-error__message {
    font-size: 11px;
    color: var(--danger);
    max-width: 320px;
    word-break: break-word;
  }
  .ui-error__action {
    margin-top: 6px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/ErrorState.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the Storybook stories**

Create `client/shared/ui/ErrorState.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import ErrorState from './ErrorState.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/ErrorState',
    component: ErrorState,
  })
</script>

<Story name="With retry" args={{ message: 'Request failed: 500 Internal Server Error', onRetry: () => {} }} />
<Story name="Message only" args={{ message: 'Request failed: 500 Internal Server Error' }} />
```

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/shared/ui/ErrorState.svelte client/shared/ui/ErrorState.stories.svelte tests/client/shared/ui/ErrorState.test.ts
git commit -m "feat(ui): add shared ErrorState component with retry"
```

---

## Task 5: ConfigFieldRow — outline Clear, right-aligned actions, tokenized spacing

Change both Clear buttons from `ghost` to `outline`, push the trailing actions to the right edge
(so they stop reading as label text), and replace hardcoded gaps/padding with tokens.

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte` (buttons at `:118` and `:138`; styles at `:180-201`)
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

- [ ] **Step 1: Add a failing test for the outline variant**

Append inside `describe('ConfigFieldRow', …)` in
`tests/client/settings/components/ConfigFieldRow.test.ts`:

```ts
test('the Clear button uses the outline variant', () => {
  setMockFetch(() => Promise.resolve(json({})))
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: false,
      sensitive: false,
      kind: 'preference',
      hasValue: true,
      value: 'UTC',
    },
    onSaved: () => undefined,
  })
  flushSync()
  const clear = target.querySelector<HTMLButtonElement>('[data-testid="cfg-clear-timezone"]')!
  expect(clear.classList.contains('ui-btn--outline')).toBe(true)
  expect(clear.classList.contains('ui-btn--ghost')).toBe(false)
  void unmount(component)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: FAIL — Clear still has `ui-btn--ghost`.

- [ ] **Step 3: Change both Clear buttons to `outline`**

In `client/settings/components/ConfigFieldRow.svelte`, both Clear buttons currently read
`variant="ghost"` — the enum branch (`:118`) and the text/secret branch (`:138`). Change **both**
to `variant="outline"`. Leave the Replace button (`:133`, `variant="secondary"`) unchanged.

- [ ] **Step 4: Right-align the trailing actions and tokenize spacing**

In the same file's `<style>` block, make these edits:

- Push actions away from the label — add `margin-right: auto;` to the label rule:

```css
.settings-field__label {
  color: var(--fg2);
  font-family: var(--font-mono);
  font-size: 12px;
  margin-right: auto;
}
```

- Replace the hardcoded gaps/padding with tokens:

```css
.settings-field {
  display: grid;
  gap: var(--gap-tight);
  padding: var(--gap-inline);
  border: 1px solid var(--border);
  background: var(--surface);
}
.settings-field__head {
  display: flex;
  align-items: center;
  gap: var(--gap-tight);
  flex-wrap: wrap;
}
.settings-field__editor {
  display: flex;
  gap: var(--gap-tight);
  flex-wrap: wrap;
}
```

(`.settings-field__head` gap goes 10px → `--gap-tight` (8px), an accepted ~2px normalization.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: PASS (all existing tests plus the new outline test).

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "fix(settings): outline Clear, right-align field actions, tokenize gaps"
```

---

## Task 6: ProfileSection — loading guard, ErrorState, empty action, intro

The marquee behavioral change (keep fields on refresh) plus the ProfileSection-local copy fixes.

**Files:**

- Modify: `client/settings/sections/ProfileSection.svelte`
- Create: `tests/client/settings/ProfileSection.test.ts`

- [ ] **Step 1: Write the failing behavior tests**

Create `tests/client/settings/ProfileSection.test.ts` (add the 4-line `//` SPDX header first):

```ts
import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'

import ProfileSection from '../../../client/settings/sections/ProfileSection.svelte'
import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const field = {
  key: 'display_name',
  storageKey: 'display_name',
  label: 'Display name',
  required: false,
  sensitive: false,
  kind: 'preference',
  hasValue: true,
  value: 'Alice',
}

const configWith = (fields: unknown[]): unknown => ({ contextId: 'user:1', fields })

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(ProfileSection, { target, props: { contextId: 'user:1' } }) }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ProfileSection', () => {
  test('renders the field after the initial load, no loading placeholder', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([field]))))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    expect(target.querySelector('.placeholder')).toBeNull()
    void unmount(component)
  })

  test('keeps fields visible during a refetch (no Loading flash)', async () => {
    let resolveSecond: ((r: Response) => void) | null = null
    let call = 0
    setMockFetch(() => {
      call += 1
      if (call === 1) return Promise.resolve(json(configWith([field])))
      return new Promise<Response>((res) => {
        resolveSecond = res
      })
    })
    const { target, component } = render()
    await drain()
    // trigger a refetch via the header refresh button
    target.querySelector<HTMLButtonElement>('[data-testid="profile-refresh"]')!.click()
    flushSync()
    // during the pending refetch, fields stay and the full-section placeholder is absent
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    resolveSecond!(json(configWith([field])))
    await drain()
    void unmount(component)
  })

  test('empty config shows an action linking to the task provider', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([]))))
    const { target, component } = render()
    await drain()
    const action = target.querySelector('.ui-empty__action a')
    expect(action).not.toBeNull()
    expect(action!.getAttribute('href')).toBe('#task-provider')
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry', async () => {
    let call = 0
    setMockFetch(() => {
      call += 1
      if (call === 1) return Promise.resolve(json({ error: 'boom' }, 500))
      return Promise.resolve(json(configWith([field])))
    })
    const { target, component } = render()
    await drain()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    retry!.click()
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    void unmount(component)
  })

  test('header shows the descriptive sub intro', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([field]))))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-page-header__sub')?.textContent).toContain('Personal preferences')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/ProfileSection.test.ts`
Expected: FAIL — refetch shows `.placeholder`; no `.ui-empty__action a`; no `error-retry`; no `.ui-page-header__sub`.

- [ ] **Step 3: Update the component**

In `client/settings/sections/ProfileSection.svelte`:

1. Import ErrorState — add to the imports block:

```svelte
  import ErrorState from '../../shared/ui/ErrorState.svelte'
```

2. Add the `sub` to the header (keep the existing `eyebrow`/`title`/`action`):

```svelte
  <PageHeader eyebrow="Personal" title="Profile" sub="Personal preferences for how the bot addresses and responds to you.">
```

3. Replace the error/loading branches and the empty state. The current markup is:

```svelte
  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No profile settings" hint="This context has no editable profile settings." />
  {:else}
```

Change it to (guard the placeholder, swap in ErrorState, add the empty action):

```svelte
  {#if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if loading && visible.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No profile settings" hint="Personal preferences will appear here once this context has editable settings.">
      {#snippet action()}
        <a href="#task-provider">Configure task provider →</a>
      {/snippet}
    </EmptyState>
  {:else}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/ProfileSection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/settings/sections/ProfileSection.svelte tests/client/settings/ProfileSection.test.ts
git commit -m "fix(settings): ProfileSection keep-fields-on-refresh, ErrorState, empty action, intro"
```

---

## Task 7: TaskProviderSection — loading guard + ErrorState

Same two shared fixes. TaskProvider's primary payload is `instanceData` (not `visible`), so the
guard keys off `instanceData === null`.

**Files:**

- Modify: `client/settings/sections/TaskProviderSection.svelte` (error/loading branch at `:110-113`)

- [ ] **Step 1: Update the component**

1. Add the import:

```svelte
  import ErrorState from '../../shared/ui/ErrorState.svelte'
```

2. Change the error/loading branch. Current:

```svelte
  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else}
```

To (guard on `instanceData`, which `load()` sets alongside `fields`):

```svelte
  {#if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if loading && instanceData === null}
    <p class="placeholder">Loading…</p>
  {:else}
```

(Leave the inner `bindError` / `bindStatus` `<p class="status-error">` lines at `:117-118`
untouched — those are per-action inline messages, not the section load error.)

- [ ] **Step 2: Verify typecheck + existing suite**

Run: `bun run typecheck`
Expected: PASS (no type errors from the new import/usage).

Run: `bun run test:client`
Expected: PASS (whole client suite, including any existing TaskProvider tests).

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/TaskProviderSection.svelte
git commit -m "fix(settings): TaskProviderSection keep-data-on-refresh + ErrorState"
```

---

## Task 8: AiOutputSection — loading guard + ErrorState

Identical shape to ProfileSection (guard on `visible.length === 0`).

**Files:**

- Modify: `client/settings/sections/AiOutputSection.svelte` (error/loading branch at `:64-67`)

- [ ] **Step 1: Update the component**

1. Add the import:

```svelte
  import ErrorState from '../../shared/ui/ErrorState.svelte'
```

2. Change the branch. Current:

```svelte
  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
```

To:

```svelte
  {#if error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if loading && visible.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
```

- [ ] **Step 2: Verify typecheck + suite**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test:client`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
bun run format
git add client/settings/sections/AiOutputSection.svelte
git commit -m "fix(settings): AiOutputSection keep-fields-on-refresh + ErrorState"
```

---

## Task 9: Re-shoot visual specs and full verification

Confirm the fixes render correctly and nothing regressed. This task is visual + full-suite; no
new unit tests.

**Files:**

- Generated/updated: `tests/visual/**` (spec regen for the new ErrorState story), `.storybook-shots/**` (gitignored baselines)

- [ ] **Step 1: Start Storybook (kept warm)**

Run: `bun storybook` (in a background shell; wait for `http://localhost:6006` to return 200).

- [ ] **Step 2: Generate the visual spec for the new ErrorState story**

Run: `bun shoot:gen`
Expected: creates `tests/visual/shared/ui/ErrorState.spec.ts` (and reformats/stamps). Commit-safe.

- [ ] **Step 3: Shoot the affected stories**

Run: `bun shoot -g "ErrorState|ProfileSection|TaskProviderSection|AiOutputSection"`
Expected: all pass; new baselines written under `.storybook-shots/`.

- [ ] **Step 4: Read the PNGs and confirm the fixes**

Read (with the Read tool) and eyeball:

- `.storybook-shots/shared/ui/ErrorState.spec.ts/*` — framed message + "Try again" button.
- `.storybook-shots/settings/sections/ProfileSection.spec.ts/*` — Populated: Clear is an
  outline button pushed to the right; header shows the sub intro. Empty: shows the "Configure
  task provider →" link. (Error story still renders the raw section? No — ProfileSection now
  uses ErrorState; confirm the Error shot shows the framed card + retry.)
- Confirm the empty-state hint reads at the higher `--fg2` contrast.

- [ ] **Step 5: Run the full check**

Run: `bun run test:client`
Expected: PASS (all client tests).

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, tests, license-headers).

- [ ] **Step 6: Commit the regenerated visual spec**

```bash
bun run format
git add tests/visual/shared/ui/ErrorState.spec.ts
git commit -m "test(visual): add ErrorState story spec"
```

(`.storybook-shots/` is gitignored — do not commit PNGs.)

---

## Self-review notes (author checklist — already applied)

- **Spec coverage:** A1 loading-flash → Tasks 6/7/8; A2 ErrorState → Task 4 + adoption in 6/7/8;
  A3 Clear affordance → Task 5; B1 empty action → Task 6; B2 intro → Task 6 (via `PageHeader.sub`);
  C1 contrast → Task 3; C2 radius → Tasks 1+2; C3 spacing → Tasks 1+5. Glyph-only-retry (dim 2 Low)
  resolved by the ErrorState retry (Task 4/6-8). All 8 findings covered.
- **Per-section guard difference is intentional:** Profile/AiOutput guard on `visible.length === 0`;
  TaskProvider guards on `instanceData === null` (its primary payload). Verified against source.
- **Type/name consistency:** `ErrorState` props (`message`, `onRetry`, `retryLabel`, `title`,
  `icon`) are identical in the component, its test, and all three section call sites
  (`<ErrorState message={error} onRetry={() => void load(contextId)} />`). Retry testid is
  `error-retry` everywhere.
- **No placeholders:** every code/test step contains full content and an exact run command with
  expected result.
