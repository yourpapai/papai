<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings-Field Shell Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three small settings-field polish items: (A) give native `<select>`/combobox controls an accessible name via the shell's label id, (B) filter `formDirty` to visible fields, (C) fix CodingIdentitySection's dead label class.

**Architecture:** `SettingsFieldShell` passes its label `id` as a parameter into the `editor` snippet (backward-compatible); CodeHost/Coding consume it to set `aria-labelledby` on their selects/combobox. The `formDirty` derivations filter to visible fields. CodingIdentity's `<label>`s move to the shared `t-label` class.

**Tech Stack:** Svelte 5 runes/snippets; TypeScript (`.js` extensions); Bun client test runner; Storybook `bun shoot`.

**Spec:** [`docs/superpowers/specs/2026-07-07-settings-field-shell-polish-design.md`](../specs/2026-07-07-settings-field-shell-polish-design.md)

---

## Background the engineer needs

- **Client component tests** run only via: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>` (default `bun test` skips them). 2 PRE-EXISTING UNRELATED `MemorySection.test.ts` failures are baseline noise — ignore; flag only NEW failures.
- **`no-conditional-in-test` lint:** no `if`/ternary inside a `test()` body — put any conditional mock in a top-level factory. **Formatter is `oxfmt`** (`bun run format`), never `prettier`. No lint-disable/type-ignore comments. `.js` import extensions.
- Commit to the current branch (`master`) — authorized.
- `SettingsFieldShell` already generates `labelId`, puts it on its `.settings-field__label` span (`id={labelId}`), and publishes it via `setFieldLabelId` (so `Input` gets `aria-labelledby` from context). This plan adds passing that id into the `editor` snippet too, for non-`Input` controls.

## File structure

| File                                                       | Task | Change                                                                                 |
| ---------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------- |
| `client/settings/components/SettingsFieldShell.svelte`     | 1    | `editor?: Snippet<[string]>`; `{@render editor(labelId)}`                              |
| `client/settings/sections/CodeHostSection.svelte`          | 1, 2 | `editor(labelId)` + `aria-labelledby` on select (T1); `formDirty` filter (T2)          |
| `client/settings/sections/CodingCredentialsSection.svelte` | 1, 2 | `editor(labelId)` + `aria-labelledby` on select+combobox (T1); `formDirty` filter (T2) |
| `tests/client/settings/code-host-section.test.ts`          | 1    | +select aria test                                                                      |
| `tests/client/settings/coding-credentials-section.test.ts` | 1    | +select aria test                                                                      |
| `client/settings/sections/CodingIdentitySection.svelte`    | 3    | labels → `t-label`                                                                     |
| `tests/client/settings/coding-identity-section.test.ts`    | 3    | +`t-label` assertion                                                                   |

---

## Task 1: Shell label-id → editor snippet; select/combobox `aria-labelledby`

**Files:**

- Modify: `client/settings/components/SettingsFieldShell.svelte`, `client/settings/sections/CodeHostSection.svelte`, `client/settings/sections/CodingCredentialsSection.svelte`
- Test: `tests/client/settings/code-host-section.test.ts`, `tests/client/settings/coding-credentials-section.test.ts`

- [ ] **Step 1: Write the failing aria tests**

Add to `tests/client/settings/code-host-section.test.ts` inside `describe('CodeHostSection', …)`:

```typescript
test('the kind select has an accessible name via aria-labelledby', async () => {
  setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
  const labelledBy = select.getAttribute('aria-labelledby')
  expect(labelledBy).not.toBeNull()
  const labelEl = target.querySelector(`#${labelledBy}`)
  expect(labelEl).not.toBeNull()
  expect(labelEl!.textContent).toContain('Code host')
  void unmount(component)
})
```

Add to `tests/client/settings/coding-credentials-section.test.ts` inside `describe('CodingCredentialsSection', …)`:

```typescript
test('the provider select has an accessible name via aria-labelledby', async () => {
  setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
  const labelledBy = select.getAttribute('aria-labelledby')
  expect(labelledBy).not.toBeNull()
  const labelEl = target.querySelector(`#${labelledBy}`)
  expect(labelEl).not.toBeNull()
  expect(labelEl!.textContent).toContain('Model provider')
  void unmount(component)
})
```

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: both new tests FAIL (`aria-labelledby` is currently null on the selects).

- [ ] **Step 2: Shell — pass `labelId` into the editor snippet**

In `client/settings/components/SettingsFieldShell.svelte`:

- Change the `editor` prop type from `editor?: Snippet` to:

```svelte
    editor?: Snippet<[string]>
```

- Change the editor render from `<div class="settings-field__editor">{@render editor()}</div>` to:

```svelte
    <div class="settings-field__editor">{@render editor(labelId)}</div>
```

(`Snippet` is already imported as a type at the top; no other change. This is backward-compatible: `ByokSection`/`ConfigFieldRow`/`AdminPluginsConfigSection` declare `{#snippet editor()}` and ignore the extra arg, and a zero-param snippet is assignable to `Snippet<[string]>`.)

- [ ] **Step 3: CodeHostSection — consume `labelId`, label the select**

In `client/settings/sections/CodeHostSection.svelte`, change `{#snippet editor()}` (the field-row editor, around line 204) to `{#snippet editor(labelId)}`, and add `aria-labelledby={labelId}` to the `<select>`:

```svelte
            {#snippet editor(labelId)}
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
              {:else}
```

(Leave the `{:else}` `<Input>` branch unchanged — `Input` gets its name via context.)

- [ ] **Step 4: CodingCredentialsSection — consume `labelId`, label select + combobox**

In `client/settings/sections/CodingCredentialsSection.svelte`, change `{#snippet editor()}` (around line 287) to `{#snippet editor(labelId)}`, and add `aria-labelledby={labelId}` to both the `<select>` and the combobox `<input>`:

```svelte
            {#snippet editor(labelId)}
              {#if field.control === 'select'}
                <select
                  data-testid={`coding-select-${field.key}`}
                  aria-labelledby={labelId}
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
                  aria-labelledby={labelId}
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
```

(Leave the `{:else}` `<Input>` branch unchanged.)

- [ ] **Step 5: Run**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: both new aria tests pass; all existing CodeHost/Coding tests still pass.

- [ ] **Step 6: Verify the shell change didn't regress the other consumers**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/byok-section.test.ts tests/client/settings/components/ConfigFieldRow.test.ts tests/client/settings/components/SettingsFieldShell.test.ts tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`
Expected: all pass (these consumers use `{#snippet editor()}` and ignore the new arg).

- [ ] **Step 7: Commit**

```bash
git add client/settings/components/SettingsFieldShell.svelte client/settings/sections/CodeHostSection.svelte client/settings/sections/CodingCredentialsSection.svelte tests/client/settings/code-host-section.test.ts tests/client/settings/coding-credentials-section.test.ts
git commit -m "feat(settings): accessible name for select/combobox via SettingsFieldShell label id"
```

---

## Task 2: `formDirty` visibility filter

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte`, `client/settings/sections/CodingCredentialsSection.svelte`

Per the spec (§3), no new behavioral test is added — the failing state is unreachable. This task confirms the existing dirty tests still pass after the filter.

- [ ] **Step 1: CodeHostSection — filter to visible fields**

Change the `formDirty` derived (around line 45) from:

```svelte
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

to:

```svelte
  const formDirty = $derived(fields.filter(shouldShowField).some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

(`shouldShowField` is a hoisted function declaration, so referencing it above its definition is fine.)

- [ ] **Step 2: CodingCredentialsSection — filter to visible fields**

Change the `formDirty` derived (around line 56) from:

```svelte
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

to:

```svelte
  const formDirty = $derived(fields.filter((f) => !fieldHidden(f)).some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

- [ ] **Step 3: Run the dirty tests**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: all pass — specifically the CodeHost "whole-record Save is disabled until a field changes (configured host)" and the Coding "whole-record Save is disabled until a field changes" tests, plus every save test (which changes a visible field before saving). The visible-field fixtures make `.filter(...)` a no-op for these tests, so behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte client/settings/sections/CodingCredentialsSection.svelte
git commit -m "refactor(settings): scope whole-record formDirty to visible fields"
```

---

## Task 3: CodingIdentitySection labels → `t-label`; final check

**Files:**

- Modify: `client/settings/sections/CodingIdentitySection.svelte`
- Test: `tests/client/settings/coding-identity-section.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/coding-identity-section.test.ts` inside its `describe(...)`:

```typescript
test('the Policy label uses the shared t-label class', async () => {
  setMockFetch(routeReadMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })
  await drain()
  const label = target.querySelector<HTMLLabelElement>('label[for="coding-identity-policy"]')!
  expect(label).not.toBeNull()
  expect(label.classList.contains('t-label')).toBe(true)
  void unmount(component)
})
```

(If `CodingIdentitySection`'s props differ — e.g. it takes no `contextId` — match the existing tests' mount call in this file. Read the file's existing tests first and mirror their mount signature.)

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/coding-identity-section.test.ts`
Expected: the new test FAILS (label currently has `settings-field__label`, not `t-label`).

- [ ] **Step 2: Swap the label class**

In `client/settings/sections/CodingIdentitySection.svelte`, change both `<label>` elements (Policy ~line 110, Member ~line 123) from `class="settings-field__label"` to `class="t-label"`:

```svelte
    <label class="t-label" for="coding-identity-policy">Policy</label>
```

```svelte
      <label class="t-label" for="coding-identity-member">Member</label>
```

(No `<style>` change — `t-label` is a global class from `client/settings/settings.css`.)

- [ ] **Step 3: Run**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/coding-identity-section.test.ts`
Expected: the new test passes; all existing CodingIdentity tests still pass.

- [ ] **Step 4: Visual re-baseline**

Ensure Storybook is running (`http://localhost:6006`), then:
Run: `bun shoot -g CodingIdentitySection`
Read a Populated PNG under `.storybook-shots/settings/sections/CodingIdentitySection.spec.ts/` and confirm the intended change: the "Policy" (and "Member", when shown) labels now render in the app's uppercase `t-label` style. No other layout change. (`.storybook-shots/` is gitignored — nothing to commit.)

- [ ] **Step 5: Full check + all affected suites**

Run: `bun run check` — expect lint/typecheck/format/license pass (operates on staged files; nothing staged after commits, but run it to catch anything).
Then:
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsFieldShell.test.ts tests/client/settings/components/ConfigFieldRow.test.ts tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts tests/client/settings/code-host-section.test.ts tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts tests/client/settings/coding-identity-section.test.ts`
Expected: all pass (ignore the 2 known MemorySection flakes if surfaced).

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingIdentitySection.svelte tests/client/settings/coding-identity-section.test.ts
git commit -m "fix(settings): CodingIdentitySection labels use shared t-label class"
```

---

## Self-review — spec coverage

- **A — select/combobox accessible name** → Task 1 (shell `Snippet<[string]>` + `{@render editor(labelId)}`; CodeHost select + Coding select/combobox `aria-labelledby`; 2 aria tests; regression check of the other 4 consumers). ✅
- **B — formDirty visibility filter** → Task 2 (CodeHost `filter(shouldShowField)`, Coding `filter(!fieldHidden)`; existing dirty tests confirm no regression; no new test per spec). ✅
- **C — CodingIdentity labels → t-label** → Task 3 (both `<label>`s + test + visual re-baseline). ✅
- **Backward-compat of the shell change** → Task 1 Step 6 explicitly runs Byok/ConfigFieldRow/Shell/AdminPlugins suites. ✅

**Type/name consistency:** `editor?: Snippet<[string]>` matches `{@render editor(labelId)}` and consumers' `{#snippet editor(labelId)}`; `shouldShowField`/`fieldHidden` are the existing hoisted predicates; `t-label` is the existing global class. No placeholders remain.
