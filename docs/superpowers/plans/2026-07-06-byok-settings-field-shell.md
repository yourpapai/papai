<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ByokSection UX Fixes via Shared Settings-Field Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 7 ByokSection UX-review findings by extracting a shared presentational `SettingsFieldShell`, routing ByokSection, CodingCredentialsSection, and ConfigFieldRow through it, and applying the section-level fixes (state Pill, ErrorState+retry, aria roles, dirty-state Save).

**Architecture:** A new presentational `SettingsFieldShell.svelte` owns the settings-field card structure (single accent-required label + head slot + editor slot + footer slot) and the tokenized CSS. Three consumers keep their own endpoints/save-model/dirty-state and pass controls in via snippets. Section-level concerns (Pill, ErrorState, aria roles, dirty-state) live in each consumer.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$props`, snippets), TypeScript (`.js` import extensions), Bun test runner (`mount`/`unmount` from `svelte`, `setMockFetch`/`restoreFetch`), Storybook + `@crvy/strybk` visual screenshots (`bun shoot`, `bun shoot:gen`).

**Spec:** [`docs/superpowers/specs/2026-07-06-byok-section-field-shell-design.md`](../specs/2026-07-06-byok-section-field-shell-design.md)

---

## Background the engineer needs

- **Runes:** `$state(x)` declares reactive state; `$derived(expr)` / `$derived.by(() => …)` derive; `$props()` reads props; `$effect(() => …)` runs side effects. Snippets are passed as props: `{#snippet name()}…{/snippet}` and rendered with `{@render name?.()}`.
- **`.js` import extension is mandatory** even for `.ts` files (e.g. `import x from './x.js'`).
- **No lint-disable / type-ignore comments** — a hook blocks them. Fix the underlying issue.
- **Component test idiom** (see `tests/client/settings/byok-section.test.ts`): mount into a `#root` div, `setMockFetch((url, init) => Promise<Response>)`, `await drain()` (10 microtask turns + `flushSync()`), assert on `target.querySelector(...)` / `target.textContent`, then `unmount`.
- **Do not change** any HTTP route or Zod schema — every fix uses data already returned (`ByokResponse.enabled/complete/unreadable`, each field's `hasValue`/`value`).
- Run the two consumer suites often: `bun test tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts tests/client/settings/components/ConfigFieldRow.test.ts`.

## File structure

| File                                                           | Responsibility                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `client/settings/components/SettingsFieldShell.svelte`         | **New.** Presentational card: single accent-required label + `head`/`editor`/`footer` snippets + tokenized CSS. |
| `client/settings/components/SettingsFieldShell.stories.svelte` | **New.** Storybook states for visual capture.                                                                   |
| `tests/client/settings/components/SettingsFieldShell.test.ts`  | **New.** Unit tests for label / required marker / testid / editor gating.                                       |
| `client/settings/components/ConfigFieldRow.svelte`             | **Modify.** Route rows through the shell; accent required marker; non-enum dirty-state Save.                    |
| `client/settings/sections/ByokSection.svelte`                  | **Modify.** Shell rows; state Pill; ErrorState+retry; aria roles; per-field dirty-state Save.                   |
| `client/settings/sections/CodingCredentialsSection.svelte`     | **Modify.** Shell rows; ErrorState+retry; aria roles; whole-record dirty-state Save.                            |
| `tests/client/settings/byok-section.test.ts`                   | **Modify.** Add Pill / dirty-state / role / ErrorState tests.                                                   |
| `tests/client/settings/coding-credentials-section.test.ts`     | **Modify.** Add whole-record dirty-state test.                                                                  |
| `tests/client/settings/components/ConfigFieldRow.test.ts`      | **Modify.** Add non-enum dirty-state test.                                                                      |
| `tests/visual/**` + `.storybook-shots/**`                      | **Regenerate.** New shell spec; re-baseline the three consumers' shots (intended diffs).                        |

Order: **Task 1** builds the shell (with its own tests). **Task 2** migrates ConfigFieldRow first (richest existing suite → fastest signal that the shell is correct). **Task 3** ByokSection. **Task 4** CodingCredentialsSection. **Task 5** stories + visual re-baseline + full check.

---

## Task 1: Create `SettingsFieldShell`

**Files:**

- Create: `client/settings/components/SettingsFieldShell.svelte`
- Test: `tests/client/settings/components/SettingsFieldShell.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/components/SettingsFieldShell.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsFieldShell, { target, props }), target }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsFieldShell', () => {
  test('renders the label text and the card testid', () => {
    const { component, target } = render({ label: 'Anthropic API Key', testid: 'byok-row-x' })
    flushSync()
    expect(target.querySelector('[data-testid="byok-row-x"]')).not.toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('Anthropic API Key')
    void unmount(component)
  })

  test('renders an accent-colored required marker only when required', () => {
    const { component, target } = render({ label: 'Key', required: true })
    flushSync()
    const req = target.querySelector('.settings-field__req')
    expect(req).not.toBeNull()
    expect(req!.textContent).toBe('*')
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('*')
    void unmount(component)
  })

  test('omits the required marker when not required', () => {
    const { component, target } = render({ label: 'Key', required: false })
    flushSync()
    expect(target.querySelector('.settings-field__req')).toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).not.toContain('*')
    void unmount(component)
  })

  test('does not render an editor wrapper when no editor snippet is provided', () => {
    const { component, target } = render({ label: 'Key' })
    flushSync()
    expect(target.querySelector('.settings-field__editor')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: FAIL — module `SettingsFieldShell.svelte` does not exist / cannot resolve import.

- [ ] **Step 3: Create the component**

Create `client/settings/components/SettingsFieldShell.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    required?: boolean
    testid?: string
    // Whether to render the editor slot. Consumers pass their own open/closed logic
    // (masked-resting secret fields render `head` only). Defaults to true.
    editorOpen?: boolean
    head?: Snippet
    editor?: Snippet
    footer?: Snippet
  }

  let { label, required = false, testid, editorOpen = true, head, editor, footer }: Props = $props()
</script>

<div class="settings-field" data-testid={testid}>
  <div class="settings-field__head">
    <span class="settings-field__label">{label}{#if required}<span class="settings-field__req">*</span>{/if}</span>
    {@render head?.()}
  </div>
  {#if editor && editorOpen}
    <div class="settings-field__editor">{@render editor()}</div>
  {/if}
  {@render footer?.()}
</div>

<style>
  .settings-field {
    display: grid;
    gap: var(--gap-tight);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface-1);
  }
  .settings-field__head {
    display: flex;
    align-items: center;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__label {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: auto;
  }
  .settings-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .settings-field__editor {
    display: flex;
    align-items: end;
    gap: var(--gap-tight);
    flex-wrap: wrap;
  }
  .settings-field__editor :global(.ui-input) {
    flex: 1;
    min-width: 200px;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/SettingsFieldShell.svelte tests/client/settings/components/SettingsFieldShell.test.ts
git commit -m "feat(settings): add presentational SettingsFieldShell component"
```

---

## Task 2: Migrate `ConfigFieldRow` onto the shell (+ accent marker, dirty-state)

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`

This task proves the shell against ConfigFieldRow's existing 20-test suite. The behavior must stay identical except: single label is now the shell's, the required `*` is accent-colored, and the non-enum Save is disabled until the draft differs from the stored value.

- [ ] **Step 1: Write the failing dirty-state test**

Add this test inside the `describe('ConfigFieldRow', …)` block in `tests/client/settings/components/ConfigFieldRow.test.ts` (after the existing "saving a non-sensitive field" test):

```typescript
test('non-sensitive Save is disabled until the value changes', () => {
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
  const save = target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-timezone"]')!
  expect(save.disabled).toBe(true)
  const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-timezone"]')!
  input.value = 'Europe/Berlin'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  expect(save.disabled).toBe(false)
  void unmount(component)
})

test('the required marker is an accent-colored .settings-field__req span', () => {
  setMockFetch(() => Promise.resolve(json({})))
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      kind: 'preference',
      hasValue: false,
      value: '',
    },
    onSaved: () => undefined,
  })
  flushSync()
  expect(target.querySelector('.settings-field__req')!.textContent).toBe('*')
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: FAIL — the new dirty-state test fails (Save currently always enabled), and `.settings-field__req` does not exist yet.

- [ ] **Step 3: Add the `dirty` derived and shell import to `ConfigFieldRow.svelte`**

In the `<script>` of `client/settings/components/ConfigFieldRow.svelte`, add the import (with the other UI imports around line 12-16):

```svelte
  import SettingsFieldShell from './SettingsFieldShell.svelte'
```

And add this derived right after `const editorOpen = $derived(…)` (around line 38):

```svelte
  // Save is meaningful only when the draft differs from the stored value. A sensitive
  // field's editor baseline is '' (an untouched/absent secret), so Save stays disabled
  // until the user types.
  const dirty = $derived(draft !== (field.sensitive ? '' : field.value))
```

- [ ] **Step 4: Replace the non-enum branch markup to use the shell**

In `ConfigFieldRow.svelte`, replace the entire `{:else}` non-enum branch (currently lines 135-177, the second `<div class="settings-field" …>…</div>`) with:

```svelte
{:else}
  <SettingsFieldShell label={field.label} required={field.required} editorOpen={editorOpen} testid={`cfg-row-${field.key}`}>
    {#snippet head()}
      {#if field.sensitive && field.hasValue && !replacing}
        <Secret value={maskSecret(field.value)} />
        <Btn variant="secondary" size="sm" testid={`cfg-replace-${field.key}`} onClick={() => (replacing = true)}>
          {#snippet children()}Replace{/snippet}
        </Btn>
      {/if}
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet editor()}
      <Input
        type={field.sensitive ? 'password' : 'text'}
        value={draft}
        placeholder={field.sensitive ? 'enter a new value' : ''}
        onInput={(v) => (draft = v)}
        testid={`cfg-input-${field.key}`} />
      <Btn variant="primary" size="sm" testid={`cfg-save-${field.key}`} disabled={!dirty || saving} onClick={() => void save()}>
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
      {#if field.sensitive && field.hasValue}
        <Btn variant="ghost" size="sm" testid={`cfg-cancel-${field.key}`} onClick={() => { replacing = false; draft = '' }}>
          {#snippet children()}Cancel{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {/if}
      {#if hint}
        <p class="settings-field__hint" id={hintId}>{hint}</p>
      {/if}
    {/snippet}
  </SettingsFieldShell>
{/if}
```

- [ ] **Step 5: Replace the enum branch markup to use the shell**

Replace the `{#if isEnum}` branch (currently lines 110-134, the first `<div class="settings-field" …>…</div>`) with:

```svelte
{#if isEnum}
  <SettingsFieldShell label={field.label} editorOpen={false} testid={`cfg-row-${field.key}`}>
    {#snippet head()}
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        ariaDescribedBy={hint ? hintId : undefined}
        disabled={saving}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    {/snippet}
    {#snippet footer()}
      {#if error !== null}
        <p class="status-error">{error}</p>
      {/if}
      {#if hint}
        <p class="settings-field__hint" id={hintId}>{hint}</p>
      {/if}
    {/snippet}
  </SettingsFieldShell>
{:else}
```

Note: the `{:else}` line above is the same one that opens the non-enum branch from Step 4 — keep exactly one `{:else}` between the two branches.

- [ ] **Step 6: Trim the moved-out CSS**

In `ConfigFieldRow.svelte`'s `<style>`, delete the `.settings-field`, `.settings-field__head`, `.settings-field__label`, `.settings-field__editor`, and `.settings-field__editor :global(.ui-input)` rules (now owned by the shell). Keep only `.settings-field__hint`:

```svelte
<style>
  .settings-field__hint {
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 7: Run the ConfigFieldRow suite**

Run: `bun test tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: PASS (all existing tests + 2 new). If the "input wrapped in .ui-input" or "cfg-select"/hint tests fail, verify the snippets render the same elements/ids as before.

- [ ] **Step 8: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "refactor(settings): route ConfigFieldRow through SettingsFieldShell + dirty-state Save"
```

---

## Task 3: Refactor `ByokSection` (shell + Pill + ErrorState + roles + dirty-state)

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte`
- Test: `tests/client/settings/byok-section.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside `describe('ByokSection', …)` in `tests/client/settings/byok-section.test.ts`:

```typescript
test('shows a mute "Central credentials" state pill when disabled', async () => {
  setMockFetch(() => Promise.resolve(json(disabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  const pill = target.querySelector('[data-testid="byok-state"]')
  expect(pill).not.toBeNull()
  expect(pill!.textContent).toContain('Central credentials')
  void unmount(component)
})

test('shows an "Incomplete" state pill when required fields are missing', async () => {
  setMockFetch(() => Promise.resolve(json(enabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  expect(target.querySelector('[data-testid="byok-state"]')!.textContent).toContain('Incomplete')
  void unmount(component)
})

test('shows an "Active" state pill when enabled and complete', async () => {
  setMockFetch(() => Promise.resolve(json(rawSecretPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  expect(target.querySelector('[data-testid="byok-state"]')!.textContent).toContain('Active')
  void unmount(component)
})

test('a per-field Save is disabled until the value changes', async () => {
  setMockFetch(() => Promise.resolve(json(enabledPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  const save = target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!
  expect(save.disabled).toBe(true)
  const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
  input.value = 'gpt-next'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  expect(save.disabled).toBe(false)
  void unmount(component)
})

test('a failed initial load renders ErrorState with a retry control', async () => {
  setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
  expect(target.querySelector('.ui-error')).not.toBeNull()
  void unmount(component)
})

test('a save success line is announced via role="status"', async () => {
  setCsrfToken('c')
  setMockFetch(routeByokMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
  input.value = 'gpt-next'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!.click()
  await drain()
  expect(target.querySelector('p[role="status"]')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/byok-section.test.ts`
Expected: FAIL — no `byok-state` pill, Save not gated on dirty, no `.ui-error`/`error-retry`, no `role="status"`.

- [ ] **Step 3: Update the `<script>` (imports + derived)**

In `client/settings/sections/ByokSection.svelte`, replace the import of `Field` with the new imports. The import block (lines 9-17) becomes:

```svelte
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
  import type { ByokField, ByokResponse } from '../fetcher-schemas.js'
  import { fetchByok, patchByok, toggleByok } from '../fetchers.js'
  import { maskSecret } from '../lib/mask-secret.js'
```

Add these after the existing `unreadableError` derived (line 38):

```svelte
  type PillTone = 'accent' | 'warn' | 'danger' | 'mute'
  interface PillState {
    tone: PillTone
    dot: boolean
    text: string
  }
  const pillState = $derived.by((): PillState | null => {
    if (currentData === null) return null
    if (!currentData.enabled) return { tone: 'mute', dot: false, text: 'Central credentials' }
    if (unreadableError !== null) return { tone: 'danger', dot: true, text: 'Unreadable' }
    if (!currentData.complete) return { tone: 'warn', dot: true, text: 'Incomplete' }
    return { tone: 'accent', dot: true, text: 'Active' }
  })

  function isDirty(field: ByokField): boolean {
    return (drafts[field.key] ?? '') !== (field.sensitive ? '' : field.value)
  }
```

- [ ] **Step 4: Replace the template**

Replace the entire `<section id="byok" …> … </section>` block (lines 140-218) with:

```svelte
<section id="byok" class="settings-section">
  <PageHeader eyebrow="Personal" title="BYOK LLM">
    {#snippet action()}
      {#if pillState !== null}
        <span data-testid="byok-state">
          <Pill tone={pillState.tone} dot={pillState.dot}>
            {#snippet children()}{pillState.text}{/snippet}
          </Pill>
        </span>
      {/if}
      {#if currentData !== null}
        <Btn
          variant={currentData.enabled ? 'outline' : 'primary'}
          size="sm"
          testid="byok-toggle"
          disabled={loading || toggling}
          onClick={() => void setEnabled(!currentData.enabled)}>
          {#snippet children()}{currentData.enabled ? 'Use central credentials' : 'Use my own credentials'}{/snippet}
        </Btn>
      {/if}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="byok-refresh" />
    {/snippet}
  </PageHeader>

  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null && !currentData.enabled}
    <p class="placeholder">
      Using the central LLM credentials. Turn on "Use my own credentials" to configure BYOK for this context.
    </p>
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored BYOK credentials are unreadable. Re-enter the values to repair this context.</p>
    {/if}
    {#if !currentData.complete && missing.length > 0}
      <p class="status-error" role="alert">Missing required fields: {missing.join(', ')}</p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        <SettingsFieldShell
          label={field.label}
          required={field.required}
          editorOpen={editorOpen(field)}
          testid={`byok-row-${field.key}`}>
          {#snippet head()}
            {#if field.sensitive && field.hasValue && !editorOpen(field)}
              <Secret value={displaySecret(field.value)} />
              <Btn variant="secondary" size="sm" testid={`byok-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                {#snippet children()}Replace{/snippet}
              </Btn>
            {/if}
          {/snippet}
          {#snippet editor()}
            <Input
              type={field.sensitive ? 'password' : 'text'}
              value={drafts[field.key] ?? ''}
              placeholder={field.sensitive ? 'enter a new value' : ''}
              onInput={(value) => updateDraft(field.key, value)}
              testid={`byok-input-${field.key}`} />
            <Btn
              variant="primary"
              size="sm"
              testid={`byok-save-${field.key}`}
              disabled={!isDirty(field) || savingKey === field.key || loading || toggling}
              onClick={() => void save(field)}>
              {#snippet children()}{savingKey === field.key ? 'Saving…' : 'Save'}{/snippet}
            </Btn>
            {#if field.sensitive && field.hasValue}
              <Btn variant="ghost" size="sm" testid={`byok-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                {#snippet children()}Cancel{/snippet}
              </Btn>
            {/if}
          {/snippet}
        </SettingsFieldShell>
      {/each}
    </div>
  {/if}
</section>
```

- [ ] **Step 5: Trim the moved-out CSS**

Replace ByokSection's `<style>` block (lines 220-253) with only the fields-container rule (the `.settings-field*` rules now live in the shell):

```svelte
<style>
  .settings-byok-fields {
    display: grid;
    gap: var(--gap-inline);
  }
</style>
```

- [ ] **Step 6: Run the ByokSection suite**

Run: `bun test tests/client/settings/byok-section.test.ts`
Expected: PASS (all existing + 6 new). The existing "failed context switch" test still passes because `ErrorState` renders the message text (`request failed with status 500`) and `byok-save-main_model` remains absent.

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/ByokSection.svelte tests/client/settings/byok-section.test.ts
git commit -m "feat(settings): ByokSection state pill, ErrorState retry, aria roles, dirty-state, shell rows"
```

---

## Task 4: Refactor `CodingCredentialsSection` (shell + ErrorState + roles + dirty-state)

**Files:**

- Modify: `client/settings/sections/CodingCredentialsSection.svelte`
- Test: `tests/client/settings/coding-credentials-section.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside `describe('CodingCredentialsSection', …)` in `tests/client/settings/coding-credentials-section.test.ts`:

```typescript
test('the whole-record Save is disabled until a field changes', async () => {
  setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!
  expect(save.disabled).toBe(true)
  const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
  providerSelect.value = 'openai'
  providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  expect(save.disabled).toBe(false)
  void unmount(component)
})

test('a failed initial load renders ErrorState with a retry control', async () => {
  setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/coding-credentials-section.test.ts`
Expected: FAIL — Save not gated on dirty; no `error-retry`.

- [ ] **Step 3: Update the `<script>` (imports + derived)**

In `client/settings/sections/CodingCredentialsSection.svelte`, remove the `Field` import (line 11) and add the two new imports alongside the other UI imports:

```svelte
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
```

Add this derived after the `unreadableError` derived (around line 51):

```svelte
  // Whole-record save is meaningful only when at least one field's draft differs from its
  // stored value. A sensitive field's editor baseline is '' (untouched secret).
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

- [ ] **Step 4: Replace the field-row markup with the shell**

Replace the `{#each fields as field (field.key)}` … `{/each}` block (lines 262-339) with:

```svelte
      {#each fields as field (field.key)}
        {#if !fieldHidden(field)}
          {@const effectiveRequired = field.required || (field.key === 'provider_base_url' && isOpenAiCompatible)}
          <SettingsFieldShell
            label={labelFor(field)}
            required={effectiveRequired}
            editorOpen={editorOpen(field)}
            testid={`coding-row-${field.key}`}>
            {#snippet head()}
              {#if field.sensitive && field.hasValue && !editorOpen(field)}
                <Secret value={displaySecret(field.value)} />
                <Btn variant="secondary" size="sm" testid={`coding-replace-${field.key}`} onClick={() => replaceSecret(field.key)}>
                  {#snippet children()}Replace{/snippet}
                </Btn>
              {/if}
            {/snippet}
            {#snippet editor()}
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-select-${field.key}`}
                  value={drafts[field.key] ?? ''}
                  disabled={saving || loading}
                  onchange={(e) => onSelectChange(field, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  {#each selectOptionsFor(field) as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else if field.control === 'combobox'}
                <input
                  list={`coding-models-${field.key}`}
                  data-testid={`coding-combobox-${field.key}`}
                  value={drafts[field.key] ?? ''}
                  placeholder="model id (leave blank for the agent default)"
                  disabled={saving || loading}
                  oninput={(e) => updateDraft(field.key, (e.currentTarget as HTMLInputElement).value)}
                  class="coding-select" />
                <datalist id={`coding-models-${field.key}`}>
                  {#each modelOptions as opt (opt.value)}
                    <option value={opt.value}></option>
                  {/each}
                </datalist>
              {:else}
                <Input
                  type={field.sensitive ? 'password' : 'text'}
                  value={drafts[field.key] ?? ''}
                  placeholder={field.key === 'provider_api_key' && isOauthSubscription
                    ? 'sk-ant-oat01-… (run `claude setup-token`)'
                    : field.sensitive
                      ? 'enter a new value'
                      : field.key === 'provider_base_url' && isOpenAiCompatible
                        ? 'https://your-llm-endpoint/v1 (required)'
                        : ''}
                  onInput={(value) => updateDraft(field.key, value)}
                  testid={`coding-input-${field.key}`} />
                {#if field.sensitive && field.hasValue}
                  <Btn variant="ghost" size="sm" testid={`coding-cancel-${field.key}`} onClick={() => cancelReplace(field.key)}>
                    {#snippet children()}Cancel{/snippet}
                  </Btn>
                {/if}
              {/if}
            {/snippet}
          </SettingsFieldShell>
        {/if}
      {/each}
```

Note: the previous code special-cased `{:else if editorOpen(field)}` for the plain-input branch. Because the shell's `editorOpen` prop already gates the whole editor slot (masked-resting secrets render `head` only, no editor), the inner branch is now a plain `{:else}` — for a masked sensitive field the editor slot is not rendered at all, so this branch only runs when the input should show.

- [ ] **Step 5: Gate the whole-record Save on `formDirty`**

In the `.settings-field__actions` block, change the Save button's `disabled` (line 359) from `disabled={saving || loading || clearing}` to:

```svelte
          disabled={!formDirty || saving || loading || clearing}
```

Leave the **Clear** button unchanged (it must stay enabled regardless of dirtiness).

- [ ] **Step 6: Add ErrorState + aria roles to the status block**

Replace the two status lines and the loading/placeholder head of the render block (lines 246-259) with:

```svelte
  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your key to repair this context.</p>
    {/if}
    {#if !currentData.complete}
      <p class="placeholder">
        Coding sessions need your model-provider API key. Enter it below — it is encrypted and used only to run your sessions.
      </p>
    {/if}
```

(The existing `<div class="settings-byok-fields">…</div>`, `.settings-field__actions`, and closing `{/if}` stay as they are after this block.)

- [ ] **Step 7: Trim the moved-out CSS and fix `.coding-select` sizing**

In CodingCredentialsSection's `<style>` (lines 382-427), delete the `.settings-field`, `.settings-field__head`, `.settings-field__label`, `.settings-field__editor`, and `.settings-field__editor :global(.ui-field)` rules. Keep `.settings-byok-fields`, `.settings-field__actions`, and update `.coding-select` to flex inside the shell editor:

```svelte
<style>
  .settings-byok-fields {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-field__actions {
    display: flex;
    justify-content: flex-end;
  }
  .coding-select {
    flex: 1;
    min-width: 200px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-size: 14px;
  }
</style>
```

- [ ] **Step 8: Run the CodingCredentialsSection suite**

Run: `bun test tests/client/settings/coding-credentials-section.test.ts`
Expected: PASS (all existing + 2 new). The base-URL asterisk tests still pass because the shell renders `*` inside `.settings-field__label`; the whole-record save tests still pass because each changes a field before saving.

- [ ] **Step 9: Commit**

```bash
git add client/settings/sections/CodingCredentialsSection.svelte tests/client/settings/coding-credentials-section.test.ts
git commit -m "feat(settings): CodingCredentialsSection ErrorState retry, aria roles, dirty-state, shell rows"
```

---

## Task 5: Storybook story + visual re-baseline + full check

**Files:**

- Create: `client/settings/components/SettingsFieldShell.stories.svelte`
- Regenerate: `tests/visual/**` (via `bun shoot:gen`) + `.storybook-shots/**` (via `bun shoot`)

- [ ] **Step 1: Create the shell story**

Create `client/settings/components/SettingsFieldShell.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Secret from '../../shared/ui/Secret.svelte'
  import SettingsFieldShell from './SettingsFieldShell.svelte'

  const { Story } = defineMeta({
    title: 'settings/components/SettingsFieldShell',
    component: SettingsFieldShell,
  })
</script>

<Story name="Editor open, required">
  <SettingsFieldShell label="Anthropic API Key" required editorOpen={true}>
    {#snippet editor()}
      <Input type="password" value="" placeholder="enter a new value" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>

<Story name="Masked resting">
  <SettingsFieldShell label="Anthropic API Key" required editorOpen={false}>
    {#snippet head()}
      <Secret value="••••WvfQ" />
      <Btn variant="secondary" size="sm">{#snippet children()}Replace{/snippet}</Btn>
    {/snippet}
  </SettingsFieldShell>
</Story>

<Story name="Optional with footer hint">
  <SettingsFieldShell label="Model" editorOpen={true}>
    {#snippet editor()}
      <Input value="claude-opus-4-5" />
      <Btn variant="primary" size="sm">{#snippet children()}Save{/snippet}</Btn>
    {/snippet}
    {#snippet footer()}
      <p class="settings-field__hint">Leave blank for the agent default.</p>
    {/snippet}
  </SettingsFieldShell>
</Story>
```

- [ ] **Step 2: Generate the visual spec for the new story**

Run: `bun shoot:gen`
Expected: creates `tests/visual/settings/components/SettingsFieldShell.spec.ts` (and re-runs the formatter/license headers). Confirm the file exists:

Run: `ls tests/visual/settings/components/SettingsFieldShell.spec.ts`

- [ ] **Step 3: Capture the shell baseline**

Ensure Storybook is running (`bun storybook` in another terminal), then:

Run: `bun shoot -g SettingsFieldShell`
Expected: writes new PNGs under `.storybook-shots/settings/components/SettingsFieldShell.spec.ts/`. Read them with the Read tool and confirm: single label (no `NEW VALUE`/`VALUE` sub-label), accent-colored `*`, rounded `2px` card corners.

- [ ] **Step 4: Re-baseline the three consumers (intended diffs)**

Run: `bun shoot -g ByokSection` then `bun shoot -g CodingCredentialsSection` then `bun shoot -g ProfileSection` then `bun shoot -g AiOutputSection` then `bun shoot -g TaskProviderSection`

Read a sample PNG from each and verify the changes are exactly the intended ones and nothing else regressed:

- ByokSection: header state Pill present; error story shows `ErrorState` (icon + title + Retry); no `NEW VALUE`/`VALUE`; accent `*`; rounded corners; label slightly brighter (`--text` vs old `--fg2`).
- CodingCredentialsSection: no `VALUE` sub-label; accent `*`; rounded corners.
- Profile/AiOutput/TaskProvider (ConfigFieldRow-backed): accent `*` on required config fields; rounded card corners. No layout breakage.

- [ ] **Step 5: Run the full check**

Run: `bun run check`
Expected: lint, typecheck, format, and license-headers all pass. Fix any type/lint issues surfaced (e.g. an unused import) without adding suppressions.

Then run the affected unit suites together:

Run: `bun test tests/client/settings/components/SettingsFieldShell.test.ts tests/client/settings/components/ConfigFieldRow.test.ts tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/components/SettingsFieldShell.stories.svelte tests/visual .storybook-shots
git commit -m "test(visual): SettingsFieldShell story + re-baseline settings-field rows"
```

---

## Self-review — spec coverage check

- **Finding [High] active-state indicator** → Task 3 Step 3-4 (Pill in `PageHeader`, 4 states from `enabled`/`complete`/`unreadable`). ✅
- **Finding [Med] load-error recovery** → Task 3 Step 4 + Task 4 Step 6 (`ErrorState` + `onRetry`). ✅
- **Finding [Med] double label** → Task 1 (shell renders one label; no inner `Field label`); applied in Tasks 2-4. ✅
- **Finding [Med] aria-live** → Task 3 Step 4 + Task 4 Step 6 (`role="alert"` / `role="status"`). ✅
- **Finding [Low] required marker** → Task 1 `.settings-field__req` accent; consumed via `required` prop in Tasks 2-4. ✅
- **Finding [Low] spacing/radius** → Task 1 shell CSS (`--gap-tight`/`--gap-inline`/`--surface-1` + `--radius-control`). ✅
- **Finding [Low] dirty-state Save** → Task 2 (ConfigFieldRow `dirty`), Task 3 (`isDirty` per field), Task 4 (`formDirty`). ✅
- **Twin consistency (CodingCredentialsSection)** → Task 4 covers all four shared findings. ✅
- **Testing / visual re-baseline** → Task 5 (new shell story + spec, re-baseline five story sets, full `bun run check`). ✅

**Type/name consistency:** shell props `label`/`required`/`testid`/`editorOpen`/`head`/`editor`/`footer` are used identically in all three consumers; dirty helpers named `dirty` (ConfigFieldRow), `isDirty(field)` (Byok), `formDirty` (Coding) match their call sites; `PillState`/`PillTone` are local to ByokSection. No placeholders remain.
