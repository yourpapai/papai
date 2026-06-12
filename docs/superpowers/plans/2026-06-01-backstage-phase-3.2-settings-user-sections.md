<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 3.2 — /settings User Sections Kit Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the shared kit across the user-facing settings sections + the shared `ConfigFieldRow`, eliminating the same anti-patterns: raw `<button>` → `Btn`; raw `<input>`/`<select>` → `Field`+`Input`/`Select`; raw `<form>`+`<label>` field wrappers → `Field`/`FormRow`; masked value spans → `Secret`; plain-text status (eligibility / domain summary) → `Pill` (local tone mapper); hand-rolled members `<table>` → `DataTable`; the Kaneo `<dl>` → `SummaryList`; `.placeholder` empties → `EmptyState`.

**Architecture:** Pure consumer-side adoption in `client/settings/`. No kit changes are required — `Btn`/`Input`/`Select` already carry the `testid` pass-through and `Input` the `password` type (Phase 2.3); `Field`, `FormRow`, `Secret`, `EmptyState`, `SummaryList`, `Pill`, `DataTable`, `Seg` all exist. Settings already runs the shared tokens (`tokens.css` is concatenated into the settings bundle), and `SettingsTopBar`/`SettingsSidebar`/`ToolsSection` already import kit components, so imports resolve.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§3 goal: sweep `client/settings/`; §6 kit).

**Depends on:** Phase 1 (kit + helpers), Phase 2.3 (`Btn`/`Input`/`Select` `testid`, `Input` `password`).

**Files:** `components/ConfigFieldRow.svelte`, `sections/ProfileSection.svelte`, `sections/TaskProviderSection.svelte`, `sections/ToolsSection.svelte`, `sections/McpSection.svelte`, `sections/PluginsSection.svelte`, `sections/IdentitySection.svelte`, `sections/MembersSection.svelte`, `sections/GroupProviderSection.svelte`.

---

## Deliberate scope boundaries

- **Section headers stay as-is structurally.** Each section has `<header class="settings-section-header"><div><p class="eyebrow">…</p><h2>…</h2></div><button>Refresh</button></header>`. This phase converts only the **Refresh `<button>` → `Btn`** (B2) in place. Migrating the `eyebrow + <h2>` to `PageHeader` (the B1 equivalent, incl. the `TaskProviderSection` "Task provider"/"Task provider" duplicate) is a separate consistency pass — deferred to the Phase 3.3-end cleanup so it can be done uniformly across user + admin sections at once. Noted, not missed.
- **Native checkbox stays native.** `McpSection`'s "Enabled" `<input type="checkbox">` has no kit equivalent; it stays a raw checkbox (wrapped in a `Field` label). Adding a toggle primitive is out of scope.
- **`Secret` reveal is a visual affordance.** Where a masked value is shown via `Secret`, leave `onReveal` unset — settings masked values are already server-masked / the actual edit path is a separate Replace/Save control. (Same caveat as Phase 2.4.)
- **`settings.css` dead-rule deletion is deferred** to the end of Phase 3.3 (after admin sections also migrate), so the shared `.settings-form`/`.settings-table`/`.masked-value`/`.placeholder` rules are removed in one pass. This phase may leave some now-unused local scoped rules; delete only the _scoped_ rules inside a file you fully migrate.

---

## Conventions (apply to every task)

- **TDD write-hook**: test-first under `tests/client/settings/sections/<Name>.test.ts` (or `components/ConfigFieldRow.test.ts`), create if absent, mirroring `tests/client/shared/ui/Pill.test.ts` mount/unmount style. Assert the new kit class (`.ui-btn`/`.ui-input`/`.ui-field`/`.ui-secret`/`.ui-pill`/`.ui-datatable`/`.ui-summary`/`.ui-empty`), run Red, refactor Green.
- Data-dependent assertions (tables, eligibility pills, EmptyState) need the fetcher module mocked **before** importing the component: `mock.module('../../../client/settings/fetchers.js', () => ({ … }))`, then `const { default: X } = await import(...)`. Synchronous parts (Refresh `Btn`, form `Field`/`Input`) render before the load `$effect` resolves and can be asserted without mocking the result.
- Import path from `sections/*.svelte` and `components/*.svelte`: kit is `../../shared/ui/<Name>.svelte`.
- The kit `Input`/`Select` are callback-based: replace `oninput`/`onchange` + `(e.target as …).value` with `onInput={(v) => …}` / `onChange={(v) => …}`. Preserve every `data-testid` via the kit `testid` prop.
- `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit each task SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.

---

## Task 1: `ConfigFieldRow` — `Secret` + `Input` + `Btn`

Shared by `ProfileSection` and `TaskProviderSection`, so highest leverage. Masked value span → `Secret`; the editor `<input>` → `Input`; Replace/Save/Cancel `<button>` → `Btn`.

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte`
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ConfigFieldRow from '../../../../client/settings/components/ConfigFieldRow.svelte'

const baseField = {
  key: 'k',
  label: 'Key',
  value: '',
  hasValue: false,
  sensitive: false,
  required: false,
  kind: 'preference',
  storageKey: 'k',
}

describe('ConfigFieldRow.svelte', () => {
  test('non-sensitive field renders a kit Input and a Save Btn', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ConfigFieldRow, { target, props: { contextId: 'ctx', field: { ...baseField }, onSaved: () => {} } })
    expect(target.querySelector('[data-testid="cfg-input-k"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-save-k"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
  test('sensitive field with a value renders Secret + Replace Btn', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ConfigFieldRow, {
      target,
      props: {
        contextId: 'ctx',
        field: { ...baseField, sensitive: true, hasValue: true, value: '••••' },
        onSaved: () => {},
      },
    })
    expect(target.querySelector('.ui-secret')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-replace-k"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
})
```

> Match the `ConfigField` shape to `client/settings/fetcher-schemas.js` if fields differ.

- [ ] **Step 2: Run** `bun test:client tests/client/settings/components/ConfigFieldRow.test.ts` — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Input from '../../shared/ui/Input.svelte'
import Secret from '../../shared/ui/Secret.svelte'
```

Replace the masked-value head branch (lines 57-60):

```svelte
{#if field.sensitive && field.hasValue && !replacing}
  <span class="masked-value">{field.value}</span>
  <button type="button" data-testid={`cfg-replace-${field.key}`} onclick={() => (replacing = true)}>Replace</button>
{/if}
```

with:

```svelte
{#if field.sensitive && field.hasValue && !replacing}
  <Secret value={field.value} />
  <Btn variant="ghost" size="sm" testid={`cfg-replace-${field.key}`} onClick={() => (replacing = true)}>
    {#snippet children()}Replace{/snippet}
  </Btn>
{/if}
```

Replace the editor block (lines 64-79):

```svelte
<div class="settings-field__editor">
  <Input
    type={field.sensitive ? 'password' : 'text'}
    value={draft}
    placeholder={field.sensitive ? 'enter a new value' : ''}
    onInput={(v) => (draft = v)}
    testid={`cfg-input-${field.key}`} />
  <Btn variant="primary" size="sm" testid={`cfg-save-${field.key}`} disabled={saving} onClick={() => void save()}>
    {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
  </Btn>
  {#if field.sensitive}
    <Btn variant="ghost" size="sm" testid={`cfg-cancel-${field.key}`} onClick={() => { replacing = false; draft = '' }}>
      {#snippet children()}Cancel{/snippet}
    </Btn>
  {/if}
</div>
```

In `<style>`, drop the `.settings-field__editor input` and `.settings-field__editor button, .settings-field__head button` rules (kit components own those styles now). Keep `.settings-field`, `__head`, `__label`, `__editor` layout rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "fix(settings): adopt Secret/Input/Btn in ConfigFieldRow" -- client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
```

---

## Task 2: `ProfileSection` — Refresh `Btn` + `EmptyState`

**Files:**

- Modify: `client/settings/sections/ProfileSection.svelte`
- Test: `tests/client/settings/sections/ProfileSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders the refresh control as a kit Btn', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(ProfileSection, { target, props: { contextId: 'ctx' } })
  expect(target.querySelector('.settings-section-header .ui-btn')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Btn from '../../shared/ui/Btn.svelte'` and `import EmptyState from '../../shared/ui/EmptyState.svelte'`. Replace the header refresh button:

```svelte
<button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
```

with:

```svelte
<Btn variant="ghost" size="sm" onClick={() => void load(contextId)}>
  {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
</Btn>
```

Replace the empty branch:

```svelte
{:else if visible.length === 0}
  <p class="placeholder">No editable profile settings for this context.</p>
```

with:

```svelte
{:else if visible.length === 0}
  <EmptyState title="No profile settings" hint="This context has no editable profile settings." />
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ProfileSection.svelte tests/client/settings/sections/ProfileSection.test.ts
git commit -m "fix(settings): adopt Btn/EmptyState in ProfileSection" -- client/settings/sections/ProfileSection.svelte tests/client/settings/sections/ProfileSection.test.ts
```

---

## Task 3: `TaskProviderSection` — `Btn` + `EmptyState` + `SummaryList`/`Secret`

**Files:**

- Modify: `client/settings/sections/TaskProviderSection.svelte`
- Test: `tests/client/settings/sections/TaskProviderSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders refresh + provision as kit Btns', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(TaskProviderSection, { target, props: { contextId: 'ctx' } })
  expect(target.querySelector('.settings-section-header .ui-btn')).not.toBeNull()
  expect(target.querySelector('[data-testid="provision-kaneo"]')?.classList.contains('ui-btn')).toBe(true)
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `EmptyState`, `Secret`, `SummaryList` from `../../shared/ui/`. Replace the header refresh button (same as Task 2). Replace the empty branch:

```svelte
{:else if visible.length === 0}
  <EmptyState title="No task-provider credentials" hint="No task-provider credentials for this context." />
```

Replace the provision `<button>`:

```svelte
<button type="button" data-testid="provision-kaneo" disabled={provisioning} onclick={() => void provision()}>
  {provisioning ? 'Provisioning…' : 'Provision Kaneo'}
</button>
```

with:

```svelte
<Btn variant="primary" testid="provision-kaneo" disabled={provisioning} onClick={() => void provision()}>
  {#snippet children()}{provisioning ? 'Provisioning…' : 'Provision Kaneo'}{/snippet}
</Btn>
```

Replace the provisioned `<dl>` (lines 102-106) with a `SummaryList`, rendering the password via `Secret`:

```svelte
<SummaryList items={[
  { k: 'Email', v: provisioned.email },
  { k: 'Kaneo URL', v: provisioned.kaneoUrl },
]} />
<div class="settings-provision__secret">
  <span class="settings-provision__secret-label">Password</span>
  <Secret value={provisioned.password} hint="shown once — copy now" />
</div>
```

In `<style>`, drop the `.settings-provision button` and `.settings-provision__reveal dl/div/dt` rules; add a small flex rule for `.settings-provision__secret` (label + Secret on one row):

```css
.settings-provision__secret {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.settings-provision__secret-label {
  color: var(--fg3);
  min-width: 80px;
}
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "fix(settings): adopt Btn/EmptyState/SummaryList/Secret in TaskProviderSection" -- client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
```

---

## Task 4: `ToolsSection` — `Btn` + `Pill` summary + perm `Btn` group + `EmptyState`

`Pill` is already imported. Add a local `summaryTone` mapper for the domain summary (these tool-permission words are not generic statuses, so keep them local rather than polluting `status-tone`).

**Files:**

- Modify: `client/settings/sections/ToolsSection.svelte`
- Test: `tests/client/settings/sections/ToolsSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchTools` to return one domain with one tool):

```ts
test('renders domain summary as a Pill and per-tool permission Btns', async () => {
  // mock '../../../client/settings/fetchers.js' fetchTools -> { domains: [{ domain: 'tasks', summary: 'allow', tools: [{ name: 'create_task', risk: 'write', permission: 'allow' }] }] }
  // mount, expand the domain, then:
  expect(target.querySelector('[data-testid="domain-summary-tasks"]')?.classList.contains('ui-pill')).toBe(true)
  expect(target.querySelector('[data-testid="tool-perm-allow-create_task"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `EmptyState`. Add a local tone mapper in the script:

```ts
const summaryTone = (s: ToolDomainSummary): 'accent' | 'warn' | 'danger' | 'mute' => {
  if (s === 'allow') return 'accent'
  if (s === 'ask') return 'warn'
  if (s === 'deny') return 'danger'
  return 'mute'
}
```

Replace the header refresh button with the `Btn` form (as Task 2). Replace the domain-summary span:

```svelte
<span class="settings-tools__summary" data-testid={`domain-summary-${domain.domain}`}>{domain.summary}</span>
```

with:

```svelte
<span data-testid={`domain-summary-${domain.domain}`}>
  <Pill tone={summaryTone(domain.summary)}>{#snippet children()}{domain.summary}{/snippet}</Pill>
</span>
```

Replace the expand `<button>` with a ghost `Btn` (keep `aria-expanded` by wrapping — `Btn` has no aria passthrough, so keep this one as a styled `<button>` OR accept losing aria-expanded). **Decision:** keep the expand control a raw `<button>` (it carries `aria-expanded` semantics the kit `Btn` doesn't model) but restyle it minimally; convert the **domain-toggle** and **per-tool perm** buttons to `Btn`. (Record in the commit body that the expand toggle stays raw for `aria-expanded`.)

Replace the domain-toggle button:

```svelte
<Btn variant="ghost" size="sm" testid={`domain-toggle-${domain.domain}`} onClick={() => void onSetDomainPermission(domain.domain, domain.summary)}>
  {#snippet children()}{domain.summary === 'deny' ? 'Allow all' : domain.summary === 'ask' ? 'Deny all' : domain.summary === 'allow' ? 'Ask all' : 'Allow all'}{/snippet}
</Btn>
```

Replace the three per-tool permission buttons — each reflects active state via variant:

```svelte
<Btn
  variant={tool.permission === 'allow' ? 'primary' : 'secondary'}
  size="sm"
  testid={`tool-perm-allow-${tool.name}`}
  onClick={() => void onSetToolPermission(tool.name, 'allow')}>
  {#snippet children()}Allow{/snippet}
</Btn>
<Btn
  variant={tool.permission === 'ask' ? 'primary' : 'secondary'}
  size="sm"
  testid={`tool-perm-ask-${tool.name}`}
  onClick={() => void onSetToolPermission(tool.name, 'ask')}>
  {#snippet children()}Ask{/snippet}
</Btn>
<Btn
  variant={tool.permission === 'deny' ? 'primary' : 'secondary'}
  size="sm"
  testid={`tool-perm-deny-${tool.name}`}
  onClick={() => void onSetToolPermission(tool.name, 'deny')}>
  {#snippet children()}Deny{/snippet}
</Btn>
```

Replace the empty branch:

```svelte
{:else if error === null}
  <EmptyState title="No togglable tools" hint="No togglable tools for this context." />
```

In `<style>`, drop `.settings-tools__summary`, `.settings-tools__domain-head button:last-child`, and `.settings-tools__perm-group button(.active)` rules (kit `Btn`/`Pill` own these). Keep the expand button rule (`.settings-tools__expand`) and the layout rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
git commit -m "fix(settings): adopt Btn/Pill/EmptyState in ToolsSection (expand stays raw for aria)" -- client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
```

---

## Task 5: `IdentitySection` — `Btn` + `Field`/`Input` + `FormRow`

**Files:**

- Modify: `client/settings/sections/IdentitySection.svelte`
- Test: `tests/client/settings/sections/IdentitySection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders labeled Inputs and Save/Clear Btns', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(IdentitySection, { target, props: { contextId: 'ctx' } })
  expect(target.querySelector('[data-testid="identity-user-id"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="identity-save"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('[data-testid="identity-clear"]')?.classList.contains('ui-btn')).toBe(true)
  void unmount(c)
})
```

> The form is gated behind `{#if !loading}`; mock `fetchIdentity` to resolve quickly with a mapping, or assert after a `flush()`. Simplest: mock `'../../../client/settings/fetchers.js'` so `fetchIdentity` resolves to `{ providerName: 'kaneo', mapping: null }` and await two microtasks before asserting.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `Field`, `FormRow`, `Input`. Replace the header refresh button with `Btn` (as Task 2). Replace the `<form class="settings-form">` body (lines 97-128) with:

```svelte
<form
  class="settings-form"
  onsubmit={(event) => {
    event.preventDefault()
    void save()
  }}>
  <Field label="Provider user ID">
    <Input value={providerUserId} onInput={(v) => (providerUserId = v)} testid="identity-user-id" />
  </Field>
  <Field label="Provider login">
    <Input value={providerUserLogin} onInput={(v) => (providerUserLogin = v)} />
  </Field>
  <Field label="Display name">
    <Input value={displayName} onInput={(v) => (displayName = v)} />
  </Field>
  <FormRow>
    {#snippet children()}{/snippet}
    {#snippet action()}
      <Btn variant="primary" type="submit" testid="identity-save">{#snippet children()}Save{/snippet}</Btn>
      <Btn variant="ghost" testid="identity-clear" onClick={() => void clear()}>{#snippet children()}Clear{/snippet}</Btn>
    {/snippet}
  </FormRow>
</form>
```

> `FormRow` requires a `children` snippet (Phase 1 API); here the action buttons are the row content, so pass an empty `children` snippet and put both buttons in `action`. (Alternatively place both `Btn`s directly without `FormRow` — either is acceptable; keep them on one line.)

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/IdentitySection.svelte tests/client/settings/sections/IdentitySection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn in IdentitySection" -- client/settings/sections/IdentitySection.svelte tests/client/settings/sections/IdentitySection.test.ts
```

---

## Task 6: `MembersSection` — `Btn` + `Field`/`Input` + `DataTable`

**Files:**

- Modify: `client/settings/sections/MembersSection.svelte`
- Test: `tests/client/settings/sections/MembersSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchGroupMembers` → one member):

```ts
test('renders the add form with kit Input/Btn and members via DataTable', async () => {
  // mock '../../../client/settings/fetchers.js' fetchGroupMembers -> { members: [{ user_id: 'u1', added_by: 'a', added_at: 't' }] }
  // mount, await flush
  expect(target.querySelector('[data-testid="member-add-input"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="member-add"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `Field`, `Input`. Add to the script a rows/columns derivation:

```ts
interface MemberRow {
  user_id: string
  added_by: string
  added_at: string
}
const memberRows = $derived<MemberRow[]>(
  members.map((m) => ({ user_id: m.user_id, added_by: m.added_by, added_at: m.added_at })),
)
const memberColumns = [
  { key: 'user_id' as const, label: 'User ID' },
  { key: 'added_by' as const, label: 'Added by' },
  { key: 'added_at' as const, label: 'Added at' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the header refresh button with `Btn` (Task 2). Replace the `<form>` (lines 72-78) with:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
  <Field label="User ID">
    <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="member-add-input" />
  </Field>
  <Btn variant="primary" type="submit" testid="member-add">{#snippet children()}Add member{/snippet}</Btn>
</form>
```

Replace the `<table class="settings-table">` block (lines 80-92) with:

```svelte
<DataTable columns={memberColumns} rows={memberRows} rowKey="user_id">
  {#snippet cell(row, col)}
    {#if col.key === 'actions'}
      <Btn variant="ghost" size="sm" testid={`member-remove-${row.user_id}`} onClick={() => void remove(row.user_id)}>
        {#snippet children()}Remove{/snippet}
      </Btn>
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
  {#snippet empty()}No members{/snippet}
</DataTable>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn/DataTable in MembersSection" -- client/settings/sections/MembersSection.svelte tests/client/settings/sections/MembersSection.test.ts
```

---

## Task 7: `GroupProviderSection` — `Btn` + `Field`/`Select`

**Files:**

- Modify: `client/settings/sections/GroupProviderSection.svelte`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchGroupTaskInstance` → one available instance):

```ts
test('renders the task-instance Select and Save Btn', async () => {
  // mock fetchGroupTaskInstance -> { taskInstanceId: null, available: [{ id: 'k1', type: 'kaneo', status: 'active' }] }
  // mount, await flush
  expect(target.querySelector('[data-testid="group-task-instance"]')?.closest('.ui-select')).not.toBeNull()
  expect(target.querySelector('[data-testid="group-task-instance-save"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `Field`, `Select`. Replace the header refresh button with `Btn` (Task 2). Replace the `<form>` body (lines 72-82) with:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
  <Field label="Task instance">
    <Select
      value={selected}
      options={data.available.map((o) => ({ value: o.id, label: `${o.id} (${o.type} · ${o.status})` }))}
      onChange={(v) => (selected = v)}
      testid="group-task-instance" />
  </Field>
  <Btn variant="primary" type="submit" testid="group-task-instance-save">{#snippet children()}Save{/snippet}</Btn>
</form>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "fix(settings): adopt Field/Select/Btn in GroupProviderSection" -- client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
```

---

## Task 8: `PluginsSection` — `Btn` + `Pill` eligibility + `Field`/`Input` + `EmptyState`

**Files:**

- Modify: `client/settings/sections/PluginsSection.svelte`
- Test: `tests/client/settings/sections/PluginsSection.test.ts` (create if absent)

Eligibility strings (`eligible`, `config_missing: …`, `capability_missing: …`, `inactive`, `disabled`) aren't generic statuses; use `Pill` with a local `eligTone` keyed off `plugin.eligibility`.

- [ ] **Step 1: Write the failing test** (mock `fetchPlugins` → one plugin, one config key):

```ts
test('renders eligibility as a Pill, toggle/save as Btn, config via Field/Input', async () => {
  // mock fetchPlugins -> { plugins: [{ id: 'p', name: 'P', enabled: false, eligibility: { eligible: true },
  //   contextConfig: [{ key: 'tok', label: 'Token', required: true, sensitive: true, hasValue: false }] }] }
  // mount, await flush
  expect(target.querySelector('.settings-plugins__head .ui-pill')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-toggle-p"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('[data-testid="plugin-cfg-save-p-tok"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('.settings-plugins__cfg .ui-input')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `EmptyState`, `Field`, `Input`, `Pill`. Add a local tone mapper:

```ts
const eligTone = (plugin: PluginEntry): 'accent' | 'warn' | 'mute' => {
  if (plugin.eligibility.eligible) return 'accent'
  if (plugin.eligibility.reason === 'inactive' || plugin.eligibility.reason === 'disabled') return 'mute'
  return 'warn'
}
```

Replace the header refresh button with `Btn` (Task 2). Replace the empty branch:

```svelte
{:else if !loading && error === null && plugins.length === 0}
  <EmptyState title="No plugins discovered" />
```

Replace the eligibility span:

```svelte
<span class="settings-plugins__elig">{eligibilityLabel(plugin)}</span>
```

with:

```svelte
<span class="settings-plugins__elig">
  <Pill tone={eligTone(plugin)}>{#snippet children()}{eligibilityLabel(plugin)}{/snippet}</Pill>
</span>
```

Replace the toggle `<button>`:

```svelte
<Btn
  variant="secondary"
  size="sm"
  testid={`plugin-toggle-${plugin.id}`}
  disabled={!plugin.eligibility.eligible && plugin.eligibility.reason === 'inactive'}
  onClick={() => void toggle(plugin)}>
  {#snippet children()}{plugin.enabled ? 'Disable' : 'Enable'}{/snippet}
</Btn>
```

Replace each config `<label>` block (lines 113-125) with `Field` + `Input` + `Btn`:

```svelte
<Field label={`${cfg.label}${cfg.required ? ' *' : ''}${cfg.hasValue ? ' (set)' : ''}`}>
  <div class="settings-plugins__cfg-row">
    <Input
      type={cfg.sensitive ? 'password' : 'text'}
      value={drafts[draftKey(plugin.id, cfg.key)] ?? ''}
      placeholder={cfg.sensitive ? 'enter a new value' : ''}
      onInput={(v) => (drafts[draftKey(plugin.id, cfg.key)] = v)} />
    <Btn variant="primary" size="sm" testid={`plugin-cfg-save-${plugin.id}-${cfg.key}`} onClick={() => void saveConfig(plugin.id, cfg.key)}>
      {#snippet children()}Save{/snippet}
    </Btn>
  </div>
</Field>
```

In `<style>`, drop `.settings-plugins__head button`, `.settings-plugins__cfg label`, `.settings-plugins__cfg span`, `.settings-plugins__cfg input`, `.settings-plugins__cfg button` rules; add a `.settings-plugins__cfg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }`.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/PluginsSection.svelte tests/client/settings/sections/PluginsSection.test.ts
git commit -m "fix(settings): adopt Btn/Pill/Field/Input/EmptyState in PluginsSection" -- client/settings/sections/PluginsSection.svelte tests/client/settings/sections/PluginsSection.test.ts
```

---

## Task 9: `McpSection` — `Btn` + `Field`/`Input` (largest)

**Files:**

- Modify: `client/settings/sections/McpSection.svelte`
- Test: `tests/client/settings/sections/McpSection.test.ts` (create if absent)

Convert: header refresh + Remove/Add-header/Add-endpoint/Save `<button>` → `Btn`; every label/`<input>` (label, url, header name/value, allow/deny) → `Field`+`Input`; the "Enabled" checkbox stays a native `<input type="checkbox">` inside a `Field`.

- [ ] **Step 1: Write the failing test** (mock `fetchMcp` → one endpoint):

```ts
test('renders endpoint label/url via Field+Input and actions via Btn', async () => {
  // mock fetchMcp -> { endpoints: [{ id: 'srv-1', url: 'https://x', label: 'L', enabled: true }] }
  // mount, await flush
  expect(target.querySelector('.settings-mcp__row .ui-field .ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="mcp-add"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('[data-testid="mcp-save"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('[data-testid="mcp-remove-srv-1"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `Field`, `Input`. Replace the header refresh button with `Btn` (Task 2). Replace the row body (lines 160-231) with the kit form. Full replacement for the `{#each rows …}` block:

```svelte
{#each rows as row, index (row.endpoint.id)}
  <div class="settings-mcp__row" data-testid={`mcp-row-${row.endpoint.id}`}>
    <Field label="Label">
      <Input value={row.endpoint.label ?? ''} onInput={(v) => (row.endpoint.label = v)} />
    </Field>
    <Field label="URL (https)">
      <Input value={row.endpoint.url} onInput={(v) => (row.endpoint.url = v)} />
    </Field>
    <label class="settings-mcp__enabled">
      <input
        type="checkbox"
        checked={row.endpoint.enabled}
        onchange={(e) => (row.endpoint.enabled = (e.target as HTMLInputElement).checked)} />
      <span>Enabled</span>
    </label>
    <Btn variant="ghost" size="sm" testid={`mcp-remove-${row.endpoint.id}`} onClick={() => removeRow(index)}>
      {#snippet children()}Remove{/snippet}
    </Btn>

    <div class="settings-mcp__headers">
      <p class="settings-mcp__subsection-label">Auth headers</p>
      {#each row.headerRows as headerRow, hi (hi)}
        <div class="settings-mcp__header-row">
          <Field label="Name">
            <Input value={headerRow.name} onInput={(v) => (headerRow.name = v)} testid={`mcp-header-name-${row.endpoint.id}-${hi}`} />
          </Field>
          <Field label="Value" hint="leave unchanged to keep stored value">
            <Input value={headerRow.value} onInput={(v) => (headerRow.value = v)} testid={`mcp-header-value-${row.endpoint.id}-${hi}`} />
          </Field>
          <Btn variant="ghost" size="sm" testid={`mcp-header-remove-${row.endpoint.id}-${hi}`} onClick={() => removeHeader(index, hi)}>
            {#snippet children()}✕{/snippet}
          </Btn>
        </div>
      {/each}
      <Btn variant="secondary" size="sm" testid={`mcp-header-add-${row.endpoint.id}`} onClick={() => addHeader(index)}>
        {#snippet children()}Add header{/snippet}
      </Btn>
    </div>

    <div class="settings-mcp__toolfilter">
      <p class="settings-mcp__subsection-label">Tool filter</p>
      <Field label="Allow tools" hint="comma or newline separated">
        <Input value={row.allowText} onInput={(v) => (row.allowText = v)} testid={`mcp-toolfilter-allow-${row.endpoint.id}`} />
      </Field>
      <Field label="Deny tools" hint="comma or newline separated">
        <Input value={row.denyText} onInput={(v) => (row.denyText = v)} testid={`mcp-toolfilter-deny-${row.endpoint.id}`} />
      </Field>
    </div>
  </div>
{/each}
<div class="settings-mcp__actions">
  <Btn variant="secondary" testid="mcp-add" onClick={addRow}>{#snippet children()}Add endpoint{/snippet}</Btn>
  <Btn variant="primary" testid="mcp-save" disabled={saving} onClick={() => void save()}>
    {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
  </Btn>
</div>
```

In `<style>`, drop `.settings-mcp__row label`, `.settings-mcp__row span`, `.settings-mcp__row input[...]`, `.settings-mcp__row button, .settings-mcp__actions button` rules (kit `Field`/`Input`/`Btn` own these). Keep `.settings-mcp`, `__row`, `__enabled`, `__actions`, `__headers`, `__toolfilter`, `__subsection-label`, `__header-row`, `__hint`. (The `__hint` span markup is replaced by `Field`'s `hint` prop, so its rule may become unused — verify and drop if so.)

> Note: the kit `Input` lacks a `value`-bound `<input type="checkbox">`; the "Enabled" checkbox stays a native input inside the existing `.settings-mcp__enabled` label (recorded in the commit body).

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Visual check (preview)** — confirm endpoint rows, header rows, tool-filter inputs, and the add/save/remove controls render and still round-trip a save.
- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/McpSection.svelte tests/client/settings/sections/McpSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn in McpSection (checkbox stays native)" -- client/settings/sections/McpSection.svelte tests/client/settings/sections/McpSection.test.ts
```

---

## Task 10: Phase 3.2 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`). Watch `tests/client/settings/SettingsApp.test.ts` for any structural assertion regressions.
- [ ] **Step 2:** `bun typecheck` — no errors.
- [ ] **Step 3:** `bun knip` — no new unused findings (removed local styles/labels).
- [ ] **Step 4:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 5:** `bun build:client` — settings bundle builds.
- [ ] **Step 6 (optional):** preview the settings UI — confirm forms, buttons, masked secrets, eligibility/summary pills, members table, and empties render consistently with `/admin` and `/debug`.

No commit — gate over Tasks 1–9.

---

## Self-Review (completed during authoring)

- **Spec coverage:** every user-section anti-pattern from the inventory → a task: `Btn` (all 9 files), `Field`+`Input`/`Select` (T1,5,6,7,8,9), `Secret` (T1,T3 masked values), `Pill` via local tone mappers (T4 summary, T8 eligibility), `DataTable` (T6 members), `SummaryList`+`Secret` (T3 Kaneo provision), `EmptyState` (T2,3,4,8). Deliberately deferred and **documented**: settings header→`PageHeader` (B1-equivalent) and `settings.css` dead-rule deletion → Phase 3.3-end cleanup; native checkbox + `aria-expanded` expand toggle stay raw.
- **Placeholder scan:** complete before/after for every change; the only adaptation is matching mock fixtures to real `fetcher-schemas` shapes (explicitly instructed) and reusing each test file's mock setup — grounding, not placeholders.
- **Type consistency:** `Btn`(`variant`,`size`,`type`,`onClick`,`disabled`,`testid`,`children`), `Input`(`value`,`onInput`,`type`,`placeholder`,`testid`), `Select`(`value`,`options:{value,label}[]`,`onChange`,`testid`), `Field`(`label`,`hint`,`children`), `FormRow`(`children`,`action`), `Secret`(`value`,`hint`), `Pill`(`tone`,`children`), `SummaryList`(`items:{k,v}[]`), `DataTable`(`columns`,`rows`,`rowKey`,`cell`,`empty`), `EmptyState`(`title`,`hint`) — all match Phase 1 + Phase 2.3 APIs and existing admin/debug usage. `SummaryList` items use `{k, v}` (not `{label, value}`).
- **testid preservation:** every existing `data-testid` is carried onto the kit element via the `testid` prop (Phase 2.3), so settings tests/E2E that drive these controls keep working.

---

## Remaining Phase 3 sub-plan

- **Phase 3.3 — /settings admin sections** (`AdminAdminsSection`, `AdminAnnounceSection`, `AdminGroupsSection`, `AdminInstancesSection`, `AdminPluginsApprovalSection`, `AdminPluginsConfigSection`, `AdminSystemSection`, `AdminUsersSection`): `Btn`, `Field`+`Input`/`Select`, `DataTable` (5 tables; status cells → `StatusPill`), `Secret` (masked config/system values), `EmptyState`. **Prerequisite decision** for that plan: whether to add a `textarea`/multiline mode to `Input` for `AdminAnnounceSection`'s message field (lean: add a minimal `multiline` prop to `Input`, TDD). **Cleanup at the end of 3.3:** migrate the deferred settings headers to `PageHeader`, then delete the now-dead `.settings-form *`, `.settings-table`, `.masked-value`, `.placeholder` rules from `settings.css` and verify visual parity + `bun check:bundle-isolation`.
