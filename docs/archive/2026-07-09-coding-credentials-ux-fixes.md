<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Coding-cluster Credential UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the three coding-cluster credential sections off the triplicated raw `<select>`/`<input list>` controls onto shared design-system primitives, and fix the `CodingCredentialsSection` empty-state dead-end, model-suggestion opacity, and misleading story fixtures.

**Architecture:** Add an optional `placeholder` prop to the existing `Select` primitive and introduce a new `Combobox` primitive (Input-styled input + datalist). Swap the raw controls in `CodingCredentialsSection`, `CodeHostSection`, and `CodingMcpSection` for these primitives, deleting each section's one-off `.coding-select` style block. Add an empty-state guard and a model-suggestion hint to `CodingCredentialsSection`, and repoint its Storybook/MSW fixtures to a realistic `agent-provider` shape with a models endpoint.

**Tech Stack:** Svelte 5 (runes), TypeScript (`.js` import extensions), Zod v4, Bun test runner, MSW for Storybook fixtures, Playwright + `@crvy/strybk` for visual screenshots, `oxfmt`/`oxlint`.

**Source design:** [`docs/superpowers/specs/2026-07-09-coding-credentials-ux-fixes-design.md`](../specs/2026-07-09-coding-credentials-ux-fixes-design.md)
**Source review:** [`docs/ux-reviews/CodingCredentialsSection.md`](../../ux-reviews/CodingCredentialsSection.md)

---

## File Structure

**Created:**

- `client/shared/ui/Combobox.svelte` — new primitive: text input backed by a `<datalist>` of suggestions; Input-styled shell, reads the field label id from context.
- `client/shared/ui/Combobox.stories.svelte` — Storybook story for the new primitive.
- `tests/client/shared/ui/Combobox.test.ts` — unit test for the new primitive.

**Modified:**

- `client/shared/ui/Select.svelte` — add optional `placeholder` prop (leading disabled option).
- `client/shared/ui/Select.stories.svelte` — add a `Placeholder` story variant.
- `tests/client/shared/ui/Select.test.ts` — add a placeholder test.
- `client/settings/sections/CodingCredentialsSection.svelte` — use `Select` + `Combobox`; delete `.coding-select`; add empty-state guard + model-suggestion hint.
- `client/settings/sections/CodeHostSection.svelte` — use `Select`; delete `.coding-select`.
- `client/settings/sections/CodingMcpSection.svelte` — use `Select` (with placeholder); delete `.coding-select`.
- `client/stories/msw/settings-handlers-personal.ts` — realistic `agent-provider` populated/empty fixtures + a models handler.
- `tests/client/stories/msw/settings-handlers-personal.test.ts` — assert the populated scenario wires the models endpoint.
- `tests/client/settings/coding-credentials-section.test.ts` — add an empty-guard case.
- `tests/visual/settings/sections/CodingCredentialsSection.spec.ts` — rework manual states to the agent-provider fields.

**Verified-only (no edits expected, run their tests):** `CodeHostSection`/`CodingMcpSection` existing tests.

---

## Task 1: Add `placeholder` prop to the `Select` primitive

**Files:**

- Modify: `client/shared/ui/Select.svelte`
- Modify: `client/shared/ui/Select.stories.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('Select.svelte', …)` block in `tests/client/shared/ui/Select.test.ts` (after the last test, before the closing `})`):

```ts
test('renders a leading disabled placeholder option when placeholder is set', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Select, {
    target,
    props: {
      value: '',
      placeholder: 'Pick one…',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      testid: 'sel',
    },
  })
  const opts = target.querySelectorAll('option')
  expect(opts.length).toBe(3)
  const first = opts[0]!
  expect(first.textContent).toBe('Pick one…')
  expect(first.hasAttribute('disabled')).toBe(true)
  expect(first.getAttribute('value')).toBe('')
  void unmount(component)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/shared/ui/Select.test.ts`
Expected: FAIL — the placeholder option is not rendered, so `opts.length` is `2`, not `3`.

- [ ] **Step 3: Implement the placeholder prop**

In `client/shared/ui/Select.svelte`, add `placeholder` to the `Props` interface and destructuring. Replace the existing `interface Props { … }` and `let { … } = $props()` (lines ~14–22) with:

```svelte
  interface Props {
    value: string
    options: Option[]
    onChange?: (value: string) => void
    testid?: string
    disabled?: boolean
    placeholder?: string
  }

  let { value, options, onChange, testid, disabled = false, placeholder }: Props = $props()
```

Then, inside the `<select>` element, render a leading disabled option before the `{#each}`:

```svelte
  <select {value} {disabled} onchange={handleChange} aria-labelledby={labelId} data-testid={testid}>
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/shared/ui/Select.test.ts`
Expected: PASS (all tests, including the pre-existing option-count test which passes no placeholder and still sees exactly its option count).

- [ ] **Step 5: Add a Storybook story variant**

In `client/shared/ui/Select.stories.svelte`, add after the existing `Single option` story:

```svelte
<Story
  name="Placeholder"
  args={{
    value: '',
    placeholder: 'Select an option…',
    options: [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ],
  }} />
```

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Select.svelte client/shared/ui/Select.stories.svelte tests/client/shared/ui/Select.test.ts
git commit -m "feat(ui): add optional placeholder option to Select primitive"
```

---

## Task 2: Create the `Combobox` primitive

**Files:**

- Create: `client/shared/ui/Combobox.svelte`
- Create: `client/shared/ui/Combobox.stories.svelte`
- Test: `tests/client/shared/ui/Combobox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/Combobox.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Combobox from '../../../../client/shared/ui/Combobox.svelte'

describe('Combobox.svelte', () => {
  test('renders an input wired to a datalist with one option per entry', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Combobox, {
      target,
      props: {
        value: 'gpt-4o',
        options: [{ value: 'gpt-4o' }, { value: 'gpt-4o-mini' }],
        testid: 'model',
      },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    expect(input.tagName).toBe('INPUT')
    const listId = input.getAttribute('list')!
    expect(listId.length).toBeGreaterThan(0)
    const datalist = target.querySelector<HTMLDataListElement>(`#${listId}`)!
    expect(datalist.querySelectorAll('option').length).toBe(2)
    void unmount(component)
  })

  test('emits onInput with the typed value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let typed = ''
    const component = mount(Combobox, {
      target,
      props: {
        value: '',
        options: [],
        onInput: (v: string) => {
          typed = v
        },
        testid: 'model',
      },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    input.value = 'claude-sonnet-4'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(typed).toBe('claude-sonnet-4')
    void unmount(component)
  })

  test('applies the disabled attribute when disabled', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Combobox, {
      target,
      props: { value: '', options: [], disabled: true, testid: 'model' },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="model"]')!
    expect(input.disabled).toBe(true)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/shared/ui/Combobox.test.ts`
Expected: FAIL — module `client/shared/ui/Combobox.svelte` does not exist (import/resolve error).

- [ ] **Step 3: Create the primitive**

Create `client/shared/ui/Combobox.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  // Per-instance sequence for a stable datalist id, mirroring Field/SettingsFieldShell.
  let seq = 0
</script>

<script lang="ts">
  import { getFieldLabelId } from './field-context.js'

  interface Option {
    value: string
    label?: string
  }

  interface Props {
    value: string
    options?: Option[]
    onInput?: (value: string) => void
    placeholder?: string
    disabled?: boolean
    testid?: string
  }

  let { value, options = [], onInput, placeholder, disabled = false, testid }: Props = $props()

  const labelId = getFieldLabelId()
  const listId = `ui-combobox-${++seq}`

  function handleInput(event: Event): void {
    onInput?.((event.target as HTMLInputElement).value)
  }
</script>

<div class="ui-combobox" class:ui-combobox--disabled={disabled}>
  <input
    list={listId}
    {value}
    {placeholder}
    {disabled}
    aria-labelledby={labelId}
    data-testid={testid}
    oninput={handleInput} />
  <datalist id={listId}>
    {#each options as opt (opt.value)}
      <option value={opt.value}></option>
    {/each}
  </datalist>
</div>

<style>
  .ui-combobox {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 200px;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 0 10px;
    border-radius: var(--radius-control);
  }
  .ui-combobox:focus-within {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
  .ui-combobox input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
  }
  .ui-combobox--disabled {
    opacity: 0.6;
  }
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/shared/ui/Combobox.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Add a Storybook story**

Create `client/shared/ui/Combobox.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Combobox from './Combobox.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Combobox',
    component: Combobox,
  })
</script>

<Story
  name="With suggestions"
  args={{
    value: '',
    placeholder: 'model id…',
    options: [{ value: 'claude-sonnet-4' }, { value: 'claude-opus-4' }, { value: 'gpt-4o' }],
  }} />

<Story name="Empty" args={{ value: '', placeholder: 'model id…', options: [] }} />
```

- [ ] **Step 6: Verify types and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add client/shared/ui/Combobox.svelte client/shared/ui/Combobox.stories.svelte tests/client/shared/ui/Combobox.test.ts
git commit -m "feat(ui): add Combobox primitive (input + datalist, design-system styled)"
```

---

## Task 3: Migrate `CodingCredentialsSection` + empty guard + model hint

**Files:**

- Modify: `client/settings/sections/CodingCredentialsSection.svelte`
- Test: `tests/client/settings/coding-credentials-section.test.ts`

This section's existing 870-line test is the regression harness. First confirm it is green, then migrate, then re-confirm, then add the new empty-guard behavior via TDD.

- [ ] **Step 1: Establish the green baseline**

Run: `bun test tests/client/settings/coding-credentials-section.test.ts`
Expected: PASS (baseline before any change).

- [ ] **Step 2: Add the primitive imports**

In `client/settings/sections/CodingCredentialsSection.svelte`, add these two imports to the import block (keep alphabetical grouping with the other `../../shared/ui/*` imports, around lines 9–16):

```svelte
  import Combobox from '../../shared/ui/Combobox.svelte'
  import Select from '../../shared/ui/Select.svelte'
```

- [ ] **Step 3: Add a derived flag for the model hint**

In the `<script>`, after the `isOauthSubscription` derived (around line 72), add:

```svelte
  // Model suggestions load only once the API key is saved (see the models $effect below);
  // surface a hint on first setup so an empty dropdown does not read as broken.
  const hasSavedKey = $derived(fields.find((f) => f.key === 'provider_api_key')?.hasValue === true)
```

- [ ] **Step 4: Replace the raw select and combobox with primitives**

Replace the `{#if field.control === 'select'}` … `{:else if field.control === 'combobox'}` … blocks inside the `editor` snippet (current lines ~288–314) with:

```svelte
              {#if field.control === 'select'}
                <Select
                  value={drafts[field.key] ?? ''}
                  options={selectOptionsFor(field).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => onSelectChange(field, v)}
                  disabled={saving || loading}
                  testid={`coding-select-${field.key}`} />
              {:else if field.control === 'combobox'}
                <Combobox
                  value={drafts[field.key] ?? ''}
                  options={modelOptions}
                  onInput={(v) => updateDraft(field.key, v)}
                  placeholder="model id (leave blank for the agent default)"
                  testid={`coding-combobox-${field.key}`} />
```

Leave the trailing `{:else} … <Input … /> … {/if}` branch (the text/secret input, current lines ~315–333) unchanged.

- [ ] **Step 5: Add the model-suggestion hint via the field footer**

The `SettingsFieldShell` renders a `footer` snippet after the editor. Add a `footer` snippet to the `<SettingsFieldShell …>` invocation (the element opened at current line ~274), directly after the closing `{/snippet}` of the `editor` snippet and before `</SettingsFieldShell>`:

```svelte
            {#snippet footer()}
              {#if field.control === 'combobox' && !hasSavedKey}
                <p class="field-hint">Save your API key to load model suggestions.</p>
              {/if}
            {/snippet}
```

- [ ] **Step 6: Add the empty-state guard**

Replace the region from the incomplete-helper block through the fields grid (current lines ~264–362) — i.e. everything from `{#if !currentData.complete}` down to the closing `</div>` of `.settings-byok-fields` — with:

```svelte
    {#if fields.length === 0}
      <p class="placeholder">No provider fields available — try Refresh.</p>
    {:else}
      {#if !currentData.complete}
        <p class="placeholder">
          Coding sessions need your model-provider API key. Enter it below — it is encrypted and used only to run your sessions.
        </p>
      {/if}

      <div class="settings-byok-fields">
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
              {#snippet editor(labelId)}
                {#if field.control === 'select'}
                  <Select
                    value={drafts[field.key] ?? ''}
                    options={selectOptionsFor(field).map((o) => ({ value: o, label: o }))}
                    onChange={(v) => onSelectChange(field, v)}
                    disabled={saving || loading}
                    testid={`coding-select-${field.key}`} />
                {:else if field.control === 'combobox'}
                  <Combobox
                    value={drafts[field.key] ?? ''}
                    options={modelOptions}
                    onInput={(v) => updateDraft(field.key, v)}
                    placeholder="model id (leave blank for the agent default)"
                    testid={`coding-combobox-${field.key}`} />
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
              {#snippet footer()}
                {#if field.control === 'combobox' && !hasSavedKey}
                  <p class="field-hint">Save your API key to load model suggestions.</p>
                {/if}
              {/snippet}
            </SettingsFieldShell>
          {/if}
        {/each}

        <div class="settings-field__actions">
          {#if currentData.configured}
            <Btn
              variant="ghost"
              size="sm"
              testid="coding-credentials-clear"
              disabled={saving || loading || clearing}
              onClick={() => {
                pendingClear = true
                clearError = null
              }}>
              {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
            </Btn>
          {/if}
          <Btn
            variant="primary"
            size="sm"
            testid="coding-credentials-save"
            disabled={!formDirty || saving || loading || clearing}
            onClick={() => void saveAll()}>
            {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
          </Btn>
        </div>
      </div>
    {/if}
```

> Note: this consolidates Steps 4–5's edits into the final markup — if you applied Steps 4–5 already, this replacement supersedes them. The `unreadableError` block above this region (current lines ~261–263) stays unchanged.

- [ ] **Step 7: Delete the `.coding-select` style block and add `.field-hint`**

In the `<style>` block, delete the entire `.coding-select { … }` rule (current lines ~389–397):

```css
.coding-select {
  flex: 1;
  min-width: 200px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  font-size: 14px;
}
```

Then add a `.field-hint` rule in its place:

```css
.field-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}
```

- [ ] **Step 8: Verify the regression suite still passes**

Run: `bun test tests/client/settings/coding-credentials-section.test.ts`
Expected: PASS — testids (`coding-select-agent`, `coding-select-provider`, `coding-input-provider_api_key`, `coding-credentials-save`, etc.) are preserved on the primitives' inner elements, so all existing assertions still resolve.

- [ ] **Step 9: Write the failing empty-guard test**

Add this test to the `describe('CodingCredentialsSection', …)` block in `tests/client/settings/coding-credentials-section.test.ts` (after the last test, before the block's closing `})`):

```ts
test('shows a placeholder and no Save button when the field list is empty', async () => {
  setMockFetch(() =>
    Promise.resolve(json({ namespace: 'agent-provider', configured: false, complete: false, missing: [], fields: [] })),
  )
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

  await drain()

  const placeholder = target.querySelector('.placeholder')
  expect(placeholder).not.toBeNull()
  expect(String(placeholder?.textContent)).toContain('No provider fields available')
  expect(target.querySelector('[data-testid="coding-credentials-save"]')).toBeNull()
  void unmount(component)
})
```

- [ ] **Step 10: Run the empty-guard test to verify it passes**

Run: `bun test tests/client/settings/coding-credentials-section.test.ts`
Expected: PASS (the new test plus the full pre-existing suite).

- [ ] **Step 11: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add client/settings/sections/CodingCredentialsSection.svelte tests/client/settings/coding-credentials-section.test.ts
git commit -m "refactor(settings): CodingCredentialsSection onto Select/Combobox + empty guard + model hint"
```

---

## Task 4: Migrate `CodeHostSection` to the `Select` primitive

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte`
- Verify: existing `CodeHostSection` tests (if any) stay green.

- [ ] **Step 1: Establish the green baseline**

Run: `bun test tests/ --parallel 2>/dev/null | tail -5` (or, if a dedicated file exists, `bun test $(git ls-files 'tests/**/*code-host*')`)
Expected: PASS baseline. Note the current pass/fail counts to compare after the change.

- [ ] **Step 2: Add the `Select` import**

In `client/settings/sections/CodeHostSection.svelte`, add to the `../../shared/ui/*` import group (around lines 10–16):

```svelte
  import Select from '../../shared/ui/Select.svelte'
```

- [ ] **Step 3: Replace the raw `<select>`**

Replace the select branch inside the `editor` snippet (current lines ~205–216):

```svelte
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-select-${field.key}`}
                  aria-labelledby={labelId}
                  value={drafts[field.key] ?? ''}
                  disabled={saving || loading}
                  onchange={(e) => updateDraft(field.key, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  {#each field.options ?? [] as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
```

with:

```svelte
              {#if field.control === 'select'}
                <Select
                  value={drafts[field.key] ?? ''}
                  options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => updateDraft(field.key, v)}
                  disabled={saving || loading}
                  testid={`coding-select-${field.key}`} />
```

Leave the `{:else} … <Input … /> … {/if}` branch unchanged. The existing `initialDrafts` default-first-option logic (lines ~52–62) is untouched and still guarantees a persisted value matching the shown option.

- [ ] **Step 4: Delete the `.coding-select` style block**

In the `<style>` block, delete the entire `.coding-select { … }` rule (current lines ~285–293), identical to the block shown in Task 3 Step 7.

- [ ] **Step 5: Typecheck and re-run tests**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test tests/ --parallel 2>/dev/null | tail -5`
Expected: same pass counts as the Step 1 baseline (no regressions).

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte
git commit -m "refactor(settings): CodeHostSection select onto shared Select primitive"
```

---

## Task 5: Migrate `CodingMcpSection` to the `Select` primitive (with placeholder)

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte`
- Verify: existing `CodingMcpSection` tests stay green.

- [ ] **Step 1: Establish the green baseline**

Run: `bun test $(git ls-files 'tests/**/*coding-mcp*' 'tests/**/*codingmcp*') 2>/dev/null | tail -5`
Expected: PASS baseline. Note the counts.

- [ ] **Step 2: Add the `Select` import**

In `client/settings/sections/CodingMcpSection.svelte`, add to the `../../shared/ui/*` import group (around lines 10–16):

```svelte
  import Select from '../../shared/ui/Select.svelte'
```

- [ ] **Step 3: Replace the raw `<select>` (preserving the placeholder option)**

Replace the select branch inside the `editor` snippet (current lines ~202–214):

```svelte
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-mcp-select-${field.key}`}
                  aria-labelledby={labelId}
                  value={drafts[field.key] ?? ''}
                  disabled={saving || loading || catalogEmpty}
                  onchange={(e) => updateDraft(field.key, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  <option value="" disabled>Select an MCP server…</option>
                  {#each selectOptionsFor(field) as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
```

with:

```svelte
              {#if field.control === 'select'}
                <Select
                  value={drafts[field.key] ?? ''}
                  options={selectOptionsFor(field).map((o) => ({ value: o, label: o }))}
                  onChange={(v) => updateDraft(field.key, v)}
                  disabled={saving || loading || catalogEmpty}
                  placeholder="Select an MCP server…"
                  testid={`coding-mcp-select-${field.key}`} />
```

Leave the `{:else}` input branch unchanged.

- [ ] **Step 4: Delete the `.coding-select` style block**

In the `<style>` block, delete the entire `.coding-select { … }` rule (around line ~283), identical to the block shown in Task 3 Step 7.

- [ ] **Step 5: Typecheck and re-run tests**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun test $(git ls-files 'tests/**/*coding-mcp*' 'tests/**/*codingmcp*') 2>/dev/null | tail -5`
Expected: same pass counts as the Step 1 baseline. If a test counted the raw placeholder `<option>` separately, adjust it to account for the primitive rendering the same leading disabled option (the placeholder prop reproduces it exactly).

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte
git commit -m "refactor(settings): CodingMcpSection select onto shared Select primitive"
```

---

## Task 6: Realistic `agent-provider` story fixtures + models handler

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal.ts`
- Test: `tests/client/stories/msw/settings-handlers-personal.test.ts`

- [ ] **Step 1: Write the failing handler test**

In `tests/client/stories/msw/settings-handlers-personal.test.ts`, add this test inside the `describe('personal settings msw handlers', …)` block, after the existing `codingCredentialsHandlers populated covers …` test (around line 37):

```ts
test('codingCredentialsHandlers populated wires the models endpoint', () => {
  expect(
    pathsOf(codingCredentialsHandlers.populated).some((p) => p.includes('/settings/api/coding-credentials/models')),
  ).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/stories/msw/settings-handlers-personal.test.ts`
Expected: FAIL — the populated family only registers the base `/settings/api/coding-credentials` handler, so no path includes `/models`.

- [ ] **Step 3: Replace the fixtures and handler family**

In `client/stories/msw/settings-handlers-personal.ts`, replace the current coding-credentials block (the `codingCredentialsPopulated`, `codingCredentialsEmpty` consts and the `codingCredentialsHandlers` export — current lines ~21–58) with:

```ts
const codingCredentialsPopulated = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'agent',
      label: 'Coding agent',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'claude',
      control: 'select',
      options: ['claude', 'codex', 'opencode'],
    },
    {
      key: 'provider',
      label: 'Model provider',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'anthropic',
      control: 'select',
      options: ['anthropic', 'openai', 'openai-compatible'],
    },
    {
      key: 'auth_method',
      label: 'Auth method',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'api-key',
      control: 'select',
      options: ['api-key', 'oauth-subscription'],
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****ab12' },
    { key: 'provider_base_url', label: 'Base URL', required: false, sensitive: false, hasValue: false, value: '' },
    {
      key: 'model',
      label: 'Model',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'claude-sonnet-4',
      control: 'combobox',
    },
  ],
  allowedAgents: ['claude', 'codex', 'opencode'],
}

const codingCredentialsEmpty = {
  namespace: 'agent-provider',
  configured: false,
  complete: false,
  missing: ['provider_api_key'],
  fields: [
    {
      key: 'agent',
      label: 'Coding agent',
      required: true,
      sensitive: false,
      hasValue: false,
      value: 'claude',
      control: 'select',
      options: ['claude', 'codex', 'opencode'],
    },
    {
      key: 'provider',
      label: 'Model provider',
      required: true,
      sensitive: false,
      hasValue: false,
      value: 'anthropic',
      control: 'select',
      options: ['anthropic', 'openai', 'openai-compatible'],
    },
    {
      key: 'auth_method',
      label: 'Auth method',
      required: false,
      sensitive: false,
      hasValue: false,
      value: 'api-key',
      control: 'select',
      options: ['api-key', 'oauth-subscription'],
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: false, value: '' },
    { key: 'provider_base_url', label: 'Base URL', required: false, sensitive: false, hasValue: false, value: '' },
    {
      key: 'model',
      label: 'Model',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
      control: 'combobox',
    },
  ],
  allowedAgents: ['claude', 'codex', 'opencode'],
}

const codingModelsPopulated = {
  ok: true,
  models: [
    { value: 'claude-sonnet-4', label: 'claude-sonnet-4' },
    { value: 'claude-opus-4', label: 'claude-opus-4' },
  ],
}

export const codingCredentialsHandlers: HandlerFamily = {
  populated: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json(codingModelsPopulated)),
    http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredentialsPopulated)),
  ],
  empty: [
    http.get('/settings/api/coding-credentials/models', () => HttpResponse.json({ ok: false, models: [] })),
    http.get('/settings/api/coding-credentials', () => HttpResponse.json(codingCredentialsEmpty)),
  ],
  error: [http.get('/settings/api/coding-credentials', boom)],
  loading: [
    http.get('/settings/api/coding-credentials', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(codingCredentialsEmpty)
    }),
  ],
}
```

> The `/models` handler is registered **before** the base `/coding-credentials` handler so MSW's most-specific-first matching resolves the models path correctly.

- [ ] **Step 4: Run the handler test to verify it passes**

Run: `bun test tests/client/stories/msw/settings-handlers-personal.test.ts`
Expected: PASS (including the new models-endpoint test and the pre-existing existence/path tests).

- [ ] **Step 5: Commit**

```bash
git add client/stories/msw/settings-handlers-personal.ts tests/client/stories/msw/settings-handlers-personal.test.ts
git commit -m "test(stories): realistic agent-provider coding-credentials fixtures + models handler"
```

---

## Task 7: Rework the visual spec and re-shoot baselines

**Files:**

- Modify: `tests/visual/settings/sections/CodingCredentialsSection.spec.ts`
- Re-shoot: `.storybook-shots/**` (gitignored — not committed)

Prerequisite: Storybook running (`bun storybook`, kept warm) and `bunx playwright install chromium` done once.

- [ ] **Step 1: Replace the manual states with agent-provider states**

In `tests/visual/settings/sections/CodingCredentialsSection.spec.ts`, replace everything **below** the `// @generated-end auto-screenshots` line with:

```ts
test('Populated — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Empty — narrow 640', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--empty')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — base URL input focused', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-input-provider_base_url').focus()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — API key replace open', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-replace-provider_api_key').click()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — dirty, Save enabled + hovered', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-input-provider_base_url').fill('https://llm.example.com/v1')
  await sharedPage.getByTestId('coding-credentials-save').hover()
  await expect(sharedPage).toHaveScreenshot()
})

test('Populated — clear confirm dialog', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingcredentialssection--populated')
  await sharedPage.getByTestId('coding-credentials-clear').click()
  await expect(sharedPage).toHaveScreenshot()
})
```

> `provider_base_url` is visible in the populated fixture (provider is `anthropic` with `auth_method` `api-key`, so it is not hidden), and it is a plain text `Input`, making it the right target for the focus/dirty states.

- [ ] **Step 2: Re-shoot this section's baselines**

Run: `bun shoot -g CodingCredentialsSection`
Expected: all generated + manual states pass and write PNGs under `.storybook-shots/settings/sections/CodingCredentialsSection.spec.ts/`.

- [ ] **Step 3: Read the new baselines to confirm the real form renders**

Read (with the Read tool) `.storybook-shots/settings/sections/CodingCredentialsSection.spec.ts/settings-sections-CodingCredentialsSection-Populated-1.png` and confirm it now shows the agent/provider/auth **selects with carets**, a masked API key, and the model combobox — not the old Forge token / Instance URL fields.

- [ ] **Step 4: Re-shoot the sibling sections (markup changed)**

Run: `bun shoot -g CodeHostSection`
Run: `bun shoot -g CodingMcpSection`
Expected: PASS; the selects now render via the shared primitive (caret, focus ring). These baselines are gitignored.

- [ ] **Step 5: Commit the spec change**

```bash
git add tests/visual/settings/sections/CodingCredentialsSection.spec.ts
git commit -m "test(visual): agent-provider states for CodingCredentialsSection"
```

---

## Task 8: Full verification gates

**Files:** none (verification only).

- [ ] **Step 1: Format**

Run: `bun run format`
Expected: completes; re-stage and amend the last commit if any file was reformatted:

```bash
git add -A && git commit --amend --no-edit
```

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: no errors. (No lint-disable/type-ignore comments were added; `max-lines` should be unaffected or lower — three style blocks were deleted.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full affected test set**

Run: `bun test tests/client/shared/ui/Select.test.ts tests/client/shared/ui/Combobox.test.ts tests/client/settings/coding-credentials-section.test.ts tests/client/stories/msw/settings-handlers-personal.test.ts`
Expected: all PASS.

- [ ] **Step 5: Security scan**

Run: `bun security`
Expected: no new findings (this change adds no fetch/secret-handling code paths).

- [ ] **Step 6: Final full suite (optional but recommended)**

Run: `bun run test`
Expected: PASS. Investigate any failure before considering the plan complete.

---

## Self-Review Notes (for the author, not steps)

- **Spec coverage:** whole-cluster primitive migration → Tasks 1,2,4,5 + Task 3; empty-state guard → Task 3 Steps 6/9/10; model-suggestion hint → Task 3 Steps 3/5; H1 realistic fixtures → Task 6; visual fidelity → Task 7. All spec sections mapped.
- **Type consistency:** `Select` gains `placeholder?: string`; `Combobox` uses `value/options/onInput/placeholder/disabled/testid`; sections call `onChange`/`onInput` with a single `string` — matches the primitives. Fixture fields use `control`/`options`, which `StoredConfigValueSchema` permits.
- **Testid stability:** `coding-select-*`, `coding-mcp-select-*`, `coding-combobox-*`, `coding-input-*`, `coding-replace-*`, `coding-credentials-save/clear` all preserved on inner elements, keeping component + visual specs valid.
- **Out of scope (not planned):** dynamic-field helper text for Auth method / Base URL reveals.
  </content>
