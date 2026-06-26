<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 2.3 — InstancesSection (B2/B3/B4/B5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `client/admin/sections/InstancesSection.svelte` — the most severe audit offender — onto the kit: native buttons → `Btn` (B2), raw inputs → `Field` + `Input`/`Select` (B3), plain-text status → `StatusPill` (B4), and the raw `JSON.stringify` config cell → `JsonCell` (B5). Drop the redundant inner `<h3>` headings (the Panel title already names each table).

**Architecture:** Three small test-driven enhancements to existing kit primitives (`Btn`, `Input`, `Select` gain an optional `testid` pass-through; `Input` gains `password` type) so the section's `data-testid` and sensitive-field contracts survive, followed by a full markup rewrite of `InstancesSection`. Script logic (fetchers, `$effect`s, create/delete handlers) is unchanged.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§7 findings B2, B3, B4, B5).

**Depends on:** Phase 1 (`StatusPill`, `JsonCell`, `Field`), Phase 2.2 (`InstancesSection` header already on `PageHeader`).

**Note on data-testids:** the section's tests/E2E target ids like `platform-id-input`, `platform-create-button`, `platform-status-<id>`. They MUST be preserved — hence the `testid` pass-through enhancements below.

---

## Conventions (apply to every task)

- **TDD write-hook**: test-first. Extend/author the test to assert the NEW output, run Red, refactor Green.
- Run client suite: `bun test:client` (ignore one unrelated `ECONNREFUSED`).
- `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit each task SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.

---

## Task 1: `Btn` — optional `testid` pass-through

**Files:**

- Modify: `client/shared/ui/Btn.svelte`
- Test: `tests/client/shared/ui/Btn.test.ts`

- [ ] **Step 1: Extend the failing test:**

```ts
test('forwards testid to the button element', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(Btn, { target, props: { children: textSnippet('go'), testid: 'do-thing' } })
  expect(target.querySelector('[data-testid="do-thing"]')?.tagName).toBe('BUTTON')
  void unmount(c)
})
```

(Reuse the file's existing `textSnippet` helper; if absent, copy the `createRawSnippet` helper from `tests/client/shared/ui/Pill.test.ts`.)

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/Btn.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** In `Btn.svelte` add `testid?: string` to `Props` and the destructure, and apply it:

```svelte
<button
  class="ui-btn ui-btn--{variant} ui-btn--{size}"
  {type}
  {disabled}
  data-testid={testid}
  onclick={onClick}
>
```

- [ ] **Step 4: Run** — expect PASS (existing Btn tests still green).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
git commit -m "feat(client/ui): add optional testid pass-through to Btn" -- client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
```

---

## Task 2: `Input` — `password` type + optional `testid`

**Files:**

- Modify: `client/shared/ui/Input.svelte`
- Test: `tests/client/shared/ui/Input.test.ts`

- [ ] **Step 1: Extend the failing test:**

```ts
test('supports password type and forwards testid', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(Input, { target, props: { value: '', type: 'password', testid: 'secret-field' } })
  const input = target.querySelector<HTMLInputElement>('[data-testid="secret-field"]')!
  expect(input.tagName).toBe('INPUT')
  expect(input.getAttribute('type')).toBe('password')
  void unmount(c)
})

test('emits onInput with the new value', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  let seen = ''
  const c = mount(Input, {
    target,
    props: {
      value: '',
      onInput: (v: string) => {
        seen = v
      },
    },
  })
  const input = target.querySelector<HTMLInputElement>('input')!
  input.value = 'hello'
  input.dispatchEvent(new Event('input'))
  expect(seen).toBe('hello')
  void unmount(c)
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/Input.test.ts` — expect FAIL (type union rejects `'password'`; no testid).

- [ ] **Step 3: Implement.** In `Input.svelte`:

```svelte
  interface Props {
    value: string
    placeholder?: string
    prefix?: Snippet
    onInput?: (value: string) => void
    type?: 'text' | 'search' | 'password'
    readonly?: boolean
    testid?: string
  }

  let { value, placeholder, prefix, onInput, type = 'text', readonly = false, testid }: Props = $props()
```

```svelte
  <input {type} {placeholder} {value} {readonly} data-testid={testid} oninput={handleInput} />
```

- [ ] **Step 4: Run** — expect PASS (existing Input tests still green).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Input.svelte tests/client/shared/ui/Input.test.ts
git commit -m "feat(client/ui): add password type and testid to Input" -- client/shared/ui/Input.svelte tests/client/shared/ui/Input.test.ts
```

---

## Task 3: `Select` — optional `testid` pass-through

**Files:**

- Modify: `client/shared/ui/Select.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`

- [ ] **Step 1: Extend the failing test:**

```ts
test('forwards testid to the select element and emits onChange', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  let picked = ''
  const c = mount(Select, {
    target,
    props: {
      value: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      onChange: (v: string) => {
        picked = v
      },
      testid: 'type-input',
    },
  })
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="type-input"]')!
  expect(sel.tagName).toBe('SELECT')
  sel.value = 'b'
  sel.dispatchEvent(new Event('change'))
  expect(picked).toBe('b')
  void unmount(c)
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/Select.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** In `Select.svelte` add `testid?: string` to `Props` and destructure, and apply:

```svelte
  <select {value} data-testid={testid} onchange={handleChange}>
```

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Select.svelte tests/client/shared/ui/Select.test.ts
git commit -m "feat(client/ui): add optional testid pass-through to Select" -- client/shared/ui/Select.svelte tests/client/shared/ui/Select.test.ts
```

---

## Task 4: Rewrite `InstancesSection` markup (B2/B3/B4/B5)

**Files:**

- Modify: `client/admin/sections/InstancesSection.svelte` (script imports + the three Panel bodies + `<style>`); the `<PageHeader>` block from Phase 2.2 stays as-is
- Test: `tests/client/admin/InstancesSection.test.ts` (extend; create if absent)

Keep ALL existing script logic (state, `$effect`s, `createPlatform`, `updatePlatformStatus`, `removePlatform`, `applyPlatforms`, `createTask`, `removeTask`, `addAdmin`, `removeAdmin`, `confirmDestructive`, `fieldStorageKey`). Remove only the `configLabel` helper (replaced by `JsonCell`).

- [ ] **Step 1: Write the failing test** — `tests/client/admin/InstancesSection.test.ts`. Mock the fetchers so `fetchPlatformInstances` returns one active instance with an object `config`, and `fetchPlatformProviderTypes` returns one type. Assert the kit adoption:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { mount, unmount } from 'svelte'

// Mock the fetcher module BEFORE importing the component.
mock.module('../../../client/admin/fetchers.js', () => ({
  fetchPlatformInstances: async () => [
    { id: 'tg-1', type: 'telegram', status: 'active', config: { baseUrl: 'https://x' }, createdAt: '2026-05-01' },
  ],
  fetchTaskInstances: async () => [],
  fetchAdmins: async () => [],
  fetchPlatformProviderTypes: async () => [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }],
  fetchTaskProviderTypes: async () => [],
  applyPlatformInstances: async () => ({ applied: 0, failed: [] }),
  createPlatformInstance: async () => undefined,
  createTaskInstance: async () => undefined,
  createAdmin: async () => undefined,
  deletePlatformInstance: async () => undefined,
  deleteTaskInstance: async () => undefined,
  deleteAdmin: async () => undefined,
  updatePlatformInstance: async () => undefined,
}))

const { default: InstancesSection } = await import('../../../client/admin/sections/InstancesSection.svelte')

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

describe('InstancesSection.svelte', () => {
  afterEach(() => {
    mock.restore()
  })

  test('renders status as a StatusPill, config as JsonCell, and actions as Btn', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(InstancesSection, { target })
    await flush()
    await flush()
    // B4 — status pill
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    // B5 — config rendered as key:value chips, not a raw JSON string
    expect(target.querySelector('.ui-jsoncell')).not.toBeNull()
    expect(target.textContent).not.toContain('{"baseUrl"')
    // B2 — create action is a Btn
    expect(target.querySelector('[data-testid="platform-create-button"]')?.classList.contains('ui-btn')).toBe(true)
    // B3 — id field is the Input component
    expect(target.querySelector('[data-testid="platform-id-input"]')?.closest('.ui-input')).not.toBeNull()
    void unmount(c)
  })
})
```

> Adjust the mocked shapes to the real `PlatformInstanceView`/`PlatformProviderTypeView` in `client/shared/api-types.ts` if fields differ (read it first). Keep the five assertions.

- [ ] **Step 2: Run** `bun test:client tests/client/admin/InstancesSection.test.ts` — expect FAIL.

- [ ] **Step 3: Update the script imports.** Replace the current UI imports block:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Panel from '../../shared/ui/Panel.svelte'
```

with:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Field from '../../shared/ui/Field.svelte'
import Input from '../../shared/ui/Input.svelte'
import JsonCell from '../../shared/ui/JsonCell.svelte'
import PageHeader from '../../shared/ui/PageHeader.svelte'
import Panel from '../../shared/ui/Panel.svelte'
import Select from '../../shared/ui/Select.svelte'
import StatusPill from '../../shared/ui/StatusPill.svelte'
```

(Keep the existing `PageHeader` import from Phase 2.2 — do not duplicate it.) Delete the `configLabel` helper line (`const configLabel = (config: InstanceConfigView): string => JSON.stringify(config)`); the `InstanceConfigView` type import stays (still used in signatures elsewhere — if `knip`/typecheck flags it as unused after removal, drop it from the type import list).

- [ ] **Step 4: Rewrite the platform-instances Panel body.** Replace the `{#snippet body()}` of `<Panel title="platform instances">` with:

```svelte
{#snippet body()}
  {#if platformDirty}
    <p class="placeholder" data-testid="platform-unapplied-indicator">Platform changes are unapplied</p>
  {/if}
  <form class="admin-filter-form" data-testid="platform-create-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
    <Field label="ID">
      <Input value={platformId} onInput={(v) => (platformId = v)} testid="platform-id-input" />
    </Field>
    <Field label="Type">
      <Select
        value={platformType}
        options={platformProviderTypes.map((d) => ({ value: d.type, label: d.displayName }))}
        onChange={(v) => (platformType = v as PlatformType)}
        testid="platform-type-input" />
    </Field>
    {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
      <Field label={field.label} required={field.required}>
        <Input
          type={field.sensitive ? 'password' : 'text'}
          value={platformConfigFields[field.key] ?? ''}
          onInput={(v) => (platformConfigFields[field.key] = v)}
          testid={`platform-config-${field.key}`} />
      </Field>
    {/each}
    <Btn type="submit" variant="primary" testid="platform-create-button">
      {#snippet children()}Create{/snippet}
    </Btn>
  </form>
  <div class="admin-table-wrap">
    <table class="admin-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Config</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        {#each platformInstances as instance (instance.id)}
          <tr data-testid="platform-instance-row">
            <td>{instance.id}</td>
            <td>{instance.type}</td>
            <td><StatusPill status={instance.status} /></td>
            <td><JsonCell value={instance.config} /></td>
            <td>{instance.createdAt}</td>
            <td class="admin-table__actions">
              <Btn variant="outline" size="sm" testid={`platform-status-${instance.id}`} onClick={() => void updatePlatformStatus(instance)}>
                {#snippet children()}{instance.status === 'active' ? 'Stop' : 'Start'}{/snippet}
              </Btn>
              <Btn variant="danger" size="sm" testid={`platform-delete-${instance.id}`} onClick={() => void removePlatform(instance.id)}>
                {#snippet children()}Delete{/snippet}
              </Btn>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}
```

(The Apply-changes control that was in the `.instances-subheader` moves to the Panel `action` slot — see Step 7. The inner `<h3>Platform Instances</h3>` is removed; the Panel title already names it.)

- [ ] **Step 5: Rewrite the task-instances Panel body.** Replace the `{#snippet body()}` of `<Panel title="task instances">` with:

```svelte
{#snippet body()}
  <form class="admin-filter-form" data-testid="task-create-form" onsubmit={(event) => { event.preventDefault(); void createTask() }}>
    <Field label="ID">
      <Input value={taskId} onInput={(v) => (taskId = v)} testid="task-id-input" />
    </Field>
    <Field label="Type">
      <Select
        value={taskType}
        options={taskProviderTypes.map((d) => ({ value: d.type, label: d.displayName }))}
        onChange={(v) => (taskType = v)}
        testid="task-type-input" />
    </Field>
    {#each selectedTaskType?.instanceConfigSchema ?? [] as field (field.key)}
      <Field label={field.label} required={field.required}>
        <Input
          type={field.sensitive ? 'password' : 'text'}
          value={taskConfigFields[field.key] ?? ''}
          onInput={(v) => (taskConfigFields[field.key] = v)}
          testid={`task-config-${field.key}`} />
      </Field>
    {/each}
    <Btn type="submit" variant="primary" testid="task-create-button">
      {#snippet children()}Create{/snippet}
    </Btn>
  </form>
  <div class="admin-table-wrap">
    <table class="admin-table">
      <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Config</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        {#each taskInstances as instance (instance.id)}
          <tr data-testid="task-instance-row">
            <td>{instance.id}</td>
            <td>{instance.type}</td>
            <td><StatusPill status={instance.status} /></td>
            <td><JsonCell value={instance.config} /></td>
            <td>{instance.createdAt}</td>
            <td class="admin-table__actions">
              {#if instance.unresolvedReason}
                <span data-testid={`task-instance-unresolved-${instance.id}`} class="unresolved-label">{instance.unresolvedReason}</span>
              {/if}
              <Btn variant="danger" size="sm" testid={`task-delete-${instance.id}`} onClick={() => void removeTask(instance)}>
                {#snippet children()}Delete{/snippet}
              </Btn>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}
```

(Removed the inner `<h3>Task Instances</h3>`.)

- [ ] **Step 6: Rewrite the admins Panel body.** Replace the `{#snippet body()}` of `<Panel title="admins">` with:

```svelte
{#snippet body()}
  <form class="admin-filter-form" data-testid="admin-create-form" onsubmit={(event) => { event.preventDefault(); void addAdmin() }}>
    <Field label="User ID">
      <Input value={adminUserId} onInput={(v) => (adminUserId = v)} testid="admin-user-id-input" />
    </Field>
    <Field label="Platform Instance ID">
      <Input value={adminPlatformInstanceId} onInput={(v) => (adminPlatformInstanceId = v)} testid="admin-platform-id-input" />
    </Field>
    <Btn type="submit" variant="primary" testid="admin-create-button">
      {#snippet children()}Create{/snippet}
    </Btn>
  </form>
  <div class="admin-table-wrap">
    <table class="admin-table">
      <thead><tr><th>User ID</th><th>Platform Instance</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        {#each admins as admin (`${admin.userId}:${admin.platformInstanceId}`)}
          <tr data-testid="admin-instance-row">
            <td>{admin.userId}</td>
            <td>{admin.platformInstanceId}</td>
            <td>{admin.createdAt ?? 'n/a'}</td>
            <td class="admin-table__actions">
              <Btn variant="danger" size="sm" testid={`admin-remove-${admin.userId}`} onClick={() => void removeAdmin(admin.userId, admin.platformInstanceId)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}
```

(Removed the inner `<h3>Admins</h3>`.)

- [ ] **Step 7: Move the platform "Apply changes" control into the Panel `action` slot.** Add an `action` snippet to `<Panel title="platform instances">` (Panel supports `action`, as in `MemosSection`):

```svelte
<Panel title="platform instances">
  {#snippet action()}
    <Btn variant="secondary" size="sm" testid="platform-apply-button" onClick={() => void applyPlatforms()}>
      {#snippet children()}Apply changes{/snippet}
    </Btn>
  {/snippet}
  {#snippet body()}
    …(body from Step 4)…
  {/snippet}
</Panel>
```

- [ ] **Step 8: Clean the `<style>` block.** Remove the now-dead rules: `.instances-subheader`, `.instances-subheader button, .admin-table button { … }`, and the `@media` rule that targeted `.instances-subheader`. Add an actions-cell layout rule and keep `.unresolved-label` / `.status-success`:

```css
.admin-table__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

- [ ] **Step 9: Run** `bun test:client tests/client/admin/InstancesSection.test.ts` — expect PASS. Then run the full client suite to catch any E2E/AdminApp testid breakage.

- [ ] **Step 10: Visual check (preview/Storybook).** Confirm: status pills render (active=green, stopped=red), config shows key:value chips, every button is a kit `Btn` (Delete/Remove red, Stop/Start outline, Create/Apply solid), inputs are the dark raised style, and create/delete/apply still function.

- [ ] **Step 11: Commit**

```bash
git add client/admin/sections/InstancesSection.svelte tests/client/admin/InstancesSection.test.ts
git commit -m "fix(admin): adopt Btn/Input/Select/StatusPill/JsonCell in InstancesSection (B2/B3/B4/B5)" -- client/admin/sections/InstancesSection.svelte tests/client/admin/InstancesSection.test.ts
```

---

## Task 5: Phase 2.3 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`). Watch for any E2E/AdminApp test that drives the instances form by `data-testid`.
- [ ] **Step 2:** `bun typecheck` — no errors (confirm `InstanceConfigView` import is either still used or removed).
- [ ] **Step 3:** `bun knip` — no new unused-export/import findings from the removed `configLabel`.
- [ ] **Step 4:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 5:** `bun build:client` — bundles build.

No commit — gate over Tasks 1–4.

---

## Self-Review (completed during authoring)

- **Spec coverage:** B2 (all create/apply/status/delete/remove buttons → `Btn`), B3 (all text/select inputs → `Field`+`Input`/`Select`), B4 (`StatusPill` for platform & task status), B5 (`JsonCell` for both config columns) → Task 4; the `data-testid`/password-field contracts enabled by Tasks 1–3.
- **Placeholder scan:** full rewritten markup for all three Panel bodies; the only adaptation is reconciling mock fixture shapes with the real `api-types` (explicitly instructed to read them) — grounding, not a placeholder.
- **Type consistency:** `Input` (`value`, `onInput`, `type` incl. `'password'`, `testid`), `Select` (`value`, `options:{value,label}[]`, `onChange`, `testid`), `Btn` (`variant`, `size`, `type`, `onClick`, `testid`, `children`), `StatusPill` (`status`), `JsonCell` (`value` accepts object) all match the components after Tasks 1–3 + Phase 1. `platformType` cast `as PlatformType` matches the existing `PlatformType` alias in the file.
- **Behavior preserved:** all handlers and `$effect`s untouched; `JsonCell` accepts the object `config` directly (no `JSON.stringify`), so the B5 cell shows chips while the underlying data is unchanged.
