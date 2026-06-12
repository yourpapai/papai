<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 3.3 — /settings Admin Sections + Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the settings sweep across the 8 bot-admin/super-admin sections — raw `<button>` → `Btn`; raw `<input>`/`<select>` → `Field`+`Input`/`Select`; `<textarea>` → `Input` multiline; hand-rolled `<table>` → `DataTable` (status cells → `StatusPill`); masked config/system values → `Secret`; `.placeholder` empties → `EmptyState`. Then close out Phase 3 with two cross-cutting cleanups: migrate **all** settings section headers (user + admin) to `PageHeader`, and delete the now-dead `settings.css` shadow-styling rules.

**Architecture:** One small test-driven kit enhancement (`Input` gains a `multiline` mode for the announce textarea), then one task per admin file, then the header migration and the CSS cleanup. Pure consumer-side adoption otherwise.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§3 goal: sweep `client/settings/`; §6 kit). Completes the spec's `/settings` scope.

**Depends on:** Phase 1 (kit + helpers), Phase 2.3 (`Btn`/`Input`/`Select` `testid`, `Input` `password`), Phase 3.2 (user sections + `ConfigFieldRow` already migrated; user-section Refresh buttons already `Btn`).

**Files:** `sections/admin/{AdminAdminsSection, AdminAnnounceSection, AdminGroupsSection, AdminUsersSection, AdminInstancesSection, AdminPluginsApprovalSection, AdminPluginsConfigSection, AdminSystemSection}.svelte`; then all settings sections for the header migration; then `client/settings/settings.css`.

---

## Conventions (apply to every task)

- **TDD write-hook**: test-first under `tests/client/settings/sections/admin/<Name>.test.ts` (create if absent), mirroring `tests/client/shared/ui/Pill.test.ts`. Data-dependent assertions mock the fetcher module before import: `mock.module('../../../../client/settings/admin-fetchers.js', () => ({ … }))` (and `…/fetchers.js` for `AdminPluginsApprovalSection`, which imports `fetchPlugins`). Assert the new kit class, run Red, refactor Green.
- Import path from `sections/admin/*.svelte`: kit is `../../../shared/ui/<Name>.svelte`.
- Kit `Input`/`Select` are callback-based; preserve every `data-testid` via the `testid` prop.
- `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit each task SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.
- `StatusPill` tones in use: `active`→accent, `stopped`→danger, `disabled`→mute (all already in `status-tone`).

---

## Task 1: `Input` — `multiline` (textarea) mode

For `AdminAnnounceSection`'s message field. Add an opt-in multiline mode rendering a `<textarea>`.

**Files:**

- Modify: `client/shared/ui/Input.svelte`
- Test: `tests/client/shared/ui/Input.test.ts`

- [ ] **Step 1: Extend the failing test:**

```ts
test('renders a textarea in multiline mode and emits onInput', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  let seen = ''
  const c = mount(Input, {
    target,
    props: {
      value: '',
      multiline: true,
      rows: 3,
      onInput: (v: string) => {
        seen = v
      },
    },
  })
  const ta = target.querySelector<HTMLTextAreaElement>('textarea')!
  expect(ta).not.toBeNull()
  ta.value = 'hi'
  ta.dispatchEvent(new Event('input'))
  expect(seen).toBe('hi')
  void unmount(c)
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/Input.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** In `Input.svelte`, add `multiline`/`rows` to `Props` and destructure, broaden the input handler cast, and branch the template:

```svelte
  interface Props {
    value: string
    placeholder?: string
    prefix?: Snippet
    onInput?: (value: string) => void
    type?: 'text' | 'search' | 'password'
    readonly?: boolean
    testid?: string
    multiline?: boolean
    rows?: number
  }

  let { value, placeholder, prefix, onInput, type = 'text', readonly = false, testid, multiline = false, rows = 3 }: Props = $props()

  function handleInput(event: Event): void {
    const next = (event.target as HTMLInputElement | HTMLTextAreaElement).value
    onInput?.(next)
  }
```

```svelte
<div class="ui-input" class:ui-input--multiline={multiline}>
  {#if multiline}
    <textarea {placeholder} {value} {readonly} {rows} data-testid={testid} oninput={handleInput}></textarea>
  {:else}
    {#if prefix}
      <span class="ui-input__prefix">{@render prefix()}</span>
    {/if}
    <input {type} {placeholder} {value} {readonly} data-testid={testid} oninput={handleInput} />
  {/if}
</div>
```

Add to `<style>`:

```css
.ui-input--multiline {
  align-items: stretch;
}
.ui-input textarea {
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 12px;
  flex: 1;
  padding: 6px 0;
  resize: vertical;
}
```

- [ ] **Step 4: Run** — expect PASS (existing Input tests still green).
- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Input.svelte tests/client/shared/ui/Input.test.ts
git commit -m "feat(client/ui): add multiline (textarea) mode to Input" -- client/shared/ui/Input.svelte tests/client/shared/ui/Input.test.ts
```

---

## Task 2: `AdminAdminsSection` — `Field`/`Input` + `Btn` + `DataTable`

**Files:**

- Modify: `client/settings/sections/admin/AdminAdminsSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminAdminsSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchAdminRoster` → one row):

```ts
test('renders the add form with Field/Input/Btn and roster via DataTable', async () => {
  // mock '../../../../client/settings/admin-fetchers.js' fetchAdminRoster -> { admins: [{ userId: 'u', platformInstanceId: 'p' }] }
  // mount, await flush
  expect(target.querySelector('[data-testid="admin-user-input"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="admin-add"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `Field`, `Input`. Replace the header refresh button:

```svelte
<button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
```

with:

```svelte
<Btn variant="ghost" size="sm" onClick={() => void load()}>
  {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
</Btn>
```

Replace the `<form>` (lines 76-80) with:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
  <Field label="User ID">
    <Input value={userId} onInput={(v) => (userId = v)} testid="admin-user-input" />
  </Field>
  <Field label="Platform instance ID">
    <Input value={platformInstanceId} onInput={(v) => (platformInstanceId = v)} testid="admin-platform-input" />
  </Field>
  <Btn variant="primary" type="submit" testid="admin-add">{#snippet children()}Add admin{/snippet}</Btn>
</form>
```

Add to the script a rows/columns derivation:

```ts
interface AdminRow {
  rowKey: string
  userId: string
  platformInstanceId: string
}
const adminRows = $derived<AdminRow[]>(
  admins.map((a) => ({
    rowKey: `${a.userId}:${a.platformInstanceId}`,
    userId: a.userId,
    platformInstanceId: a.platformInstanceId,
  })),
)
const adminColumns = [
  { key: 'userId' as const, label: 'User ID' },
  { key: 'platformInstanceId' as const, label: 'Platform instance' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the `<table class="settings-table">` block with:

```svelte
<DataTable columns={adminColumns} rows={adminRows} rowKey="rowKey">
  {#snippet cell(row, col)}
    {#if col.key === 'actions'}
      <Btn variant="ghost" size="sm" testid={`admin-remove-${row.userId}`} onClick={() => void remove({ userId: row.userId, platformInstanceId: row.platformInstanceId })}>
        {#snippet children()}Remove{/snippet}
      </Btn>
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
  {#snippet empty()}No admins{/snippet}
</DataTable>
```

(`remove()` takes the `AdminRosterRow`; reconstruct `{ userId, platformInstanceId }` from the row — both fields are present.)

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminAdminsSection.svelte tests/client/settings/sections/admin/AdminAdminsSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn/DataTable in AdminAdminsSection" -- client/settings/sections/admin/AdminAdminsSection.svelte tests/client/settings/sections/admin/AdminAdminsSection.test.ts
```

---

## Task 3: `AdminGroupsSection` — `Field`/`Input` + `Btn` + `DataTable`

**Files:**

- Modify: `client/settings/sections/admin/AdminGroupsSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminGroupsSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchAdminGroups` → one row):

```ts
test('renders the add form with Field/Input/Btn and groups via DataTable', async () => {
  // mock fetchAdminGroups -> { groups: [{ group_id: 'g', added_by: 'a', added_at: 't' }] }
  expect(target.querySelector('[data-testid="group-add-input"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="group-add"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `Field`, `Input`. Replace the header refresh button with `Btn` (as Task 2). Replace the `<form>`:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
  <Field label="Group ID">
    <Input value={newGroupId} onInput={(v) => (newGroupId = v)} testid="group-add-input" />
  </Field>
  <Btn variant="primary" type="submit" testid="group-add">{#snippet children()}Add group{/snippet}</Btn>
</form>
```

Add rows/columns:

```ts
interface GroupRow {
  group_id: string
  added_by: string
  added_at: string
}
const groupRows = $derived<GroupRow[]>(
  groups.map((g) => ({ group_id: g.group_id, added_by: g.added_by, added_at: g.added_at })),
)
const groupColumns = [
  { key: 'group_id' as const, label: 'Group ID' },
  { key: 'added_by' as const, label: 'Added by' },
  { key: 'added_at' as const, label: 'Added at' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the table with:

```svelte
<DataTable columns={groupColumns} rows={groupRows} rowKey="group_id">
  {#snippet cell(row, col)}
    {#if col.key === 'actions'}
      <Btn variant="ghost" size="sm" testid={`group-remove-${row.group_id}`} onClick={() => void remove(row.group_id)}>
        {#snippet children()}Remove{/snippet}
      </Btn>
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
  {#snippet empty()}No groups{/snippet}
</DataTable>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminGroupsSection.svelte tests/client/settings/sections/admin/AdminGroupsSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn/DataTable in AdminGroupsSection" -- client/settings/sections/admin/AdminGroupsSection.svelte tests/client/settings/sections/admin/AdminGroupsSection.test.ts
```

---

## Task 4: `AdminUsersSection` — `Field`/`Input` + `Btn` + `DataTable`

**Files:**

- Modify: `client/settings/sections/admin/AdminUsersSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchAdminUsers` → one row):

```ts
test('renders the add form with Field/Input/Btn and users via DataTable', async () => {
  // mock fetchAdminUsers -> { users: [{ platform_user_id: 'u', username: 'name' }] }
  expect(target.querySelector('[data-testid="user-add-input"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="user-add"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `Field`, `Input`. Replace the header refresh button with `Btn` (Task 2). Replace the `<form>`:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void add() }}>
  <Field label="User ID">
    <Input value={newUserId} onInput={(v) => (newUserId = v)} testid="user-add-input" />
  </Field>
  <Field label="Username" hint="optional">
    <Input value={newUsername} onInput={(v) => (newUsername = v)} />
  </Field>
  <Btn variant="primary" type="submit" testid="user-add">{#snippet children()}Add user{/snippet}</Btn>
</form>
```

Add rows/columns:

```ts
interface UserRow {
  platform_user_id: string
  username: string
}
const userRows = $derived<UserRow[]>(
  users.map((u) => ({ platform_user_id: u.platform_user_id, username: u.username ?? '—' })),
)
const userColumns = [
  { key: 'platform_user_id' as const, label: 'User ID' },
  { key: 'username' as const, label: 'Username' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the table:

```svelte
<DataTable columns={userColumns} rows={userRows} rowKey="platform_user_id">
  {#snippet cell(row, col)}
    {#if col.key === 'actions'}
      <Btn variant="ghost" size="sm" testid={`user-remove-${row.platform_user_id}`} onClick={() => void remove(row.platform_user_id)}>
        {#snippet children()}Remove{/snippet}
      </Btn>
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
  {#snippet empty()}No users{/snippet}
</DataTable>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Btn/DataTable in AdminUsersSection" -- client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
```

---

## Task 5: `AdminAnnounceSection` — `Field`/`Input` multiline + `Btn`

**Files:**

- Modify: `client/settings/sections/admin/AdminAnnounceSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminAnnounceSection.test.ts` (create if absent)
- Depends on: Task 1 (`Input` multiline).

- [ ] **Step 1: Write the failing test:**

```ts
test('renders the message field as a multiline Input and Send as a Btn', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(AdminAnnounceSection, { target, props: {} })
  expect(target.querySelector('[data-testid="announce-message"]')?.tagName).toBe('TEXTAREA')
  expect(target.querySelector('[data-testid="announce-send"]')?.classList.contains('ui-btn')).toBe(true)
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `Field`, `Input`. Replace the `<form>` (lines 42-48) with:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void send() }}>
  <Field label="Message" style="flex: 1; min-width: 280px;">
    <Input value={message} onInput={(v) => (message = v)} testid="announce-message" multiline rows={3} />
  </Field>
  <Btn variant="primary" type="submit" testid="announce-send" disabled={sending}>
    {#snippet children()}{sending ? 'Sending…' : 'Send announcement'}{/snippet}
  </Btn>
</form>
```

> `Field` does not accept a `style` prop in the Phase 1 API — if inline width is needed, wrap the `Field` in a `<div style="flex:1;min-width:280px">` instead, or drop the inline width (the form is flex; the field will size naturally). Prefer dropping the inline width. Delete the local `textarea` `<style>` block (now owned by `Input`).

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminAnnounceSection.svelte tests/client/settings/sections/admin/AdminAnnounceSection.test.ts
git commit -m "fix(settings): adopt multiline Input + Btn in AdminAnnounceSection" -- client/settings/sections/admin/AdminAnnounceSection.svelte tests/client/settings/sections/admin/AdminAnnounceSection.test.ts
```

---

## Task 6: `AdminPluginsApprovalSection` — `DataTable` + `StatusPill` + `Btn`

**Files:**

- Modify: `client/settings/sections/admin/AdminPluginsApprovalSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchPlugins` from `…/fetchers.js`):

```ts
test('renders plugins via DataTable with active StatusPill and approve/reject Btns', async () => {
  // mock '../../../../client/settings/fetchers.js' fetchPlugins -> { plugins: [{ id: 'p', name: 'P', active: true }] }
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
  expect(target.querySelector('.ui-pill')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-approve-p"]')?.classList.contains('ui-btn')).toBe(true)
  expect(target.querySelector('[data-testid="plugin-reject-p"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `StatusPill`. Replace the header refresh button with `Btn` (Task 2). Add rows/columns:

```ts
interface ApprovalRow {
  id: string
  name: string
  active: boolean
}
const approvalRows = $derived<ApprovalRow[]>(plugins.map((p) => ({ id: p.id, name: p.name, active: p.active })))
const approvalColumns = [
  { key: 'name' as const, label: 'Plugin' },
  { key: 'active' as const, label: 'Active' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the `<table class="settings-table">` block (lines 64-80) with:

```svelte
<DataTable columns={approvalColumns} rows={approvalRows} rowKey="id">
  {#snippet cell(row, col)}
    {#if col.key === 'name'}
      {row.name} <span class="placeholder">({row.id})</span>
    {:else if col.key === 'active'}
      <StatusPill status={row.active ? 'active' : 'disabled'} />
    {:else}
      <Btn variant="primary" size="sm" testid={`plugin-approve-${row.id}`} onClick={() => void decide(row.id, 'approve')}>
        {#snippet children()}Approve{/snippet}
      </Btn>
      <Btn variant="ghost" size="sm" testid={`plugin-reject-${row.id}`} onClick={() => void decide(row.id, 'reject')}>
        {#snippet children()}Reject{/snippet}
      </Btn>
    {/if}
  {/snippet}
  {#snippet empty()}No plugins{/snippet}
</DataTable>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminPluginsApprovalSection.svelte tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts
git commit -m "fix(settings): adopt DataTable/StatusPill/Btn in AdminPluginsApprovalSection" -- client/settings/sections/admin/AdminPluginsApprovalSection.svelte tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts
```

---

## Task 7: `AdminPluginsConfigSection` — `Secret` + `Field`/`Input` + `Btn` + `EmptyState`

**Files:**

- Modify: `client/settings/sections/admin/AdminPluginsConfigSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchAdminPluginConfig` → one plugin, one sensitive key with a value):

```ts
test('renders masked value via Secret, editor via Field/Input/Btn', async () => {
  // mock fetchAdminPluginConfig -> { plugins: [{ pluginId: 'p', keys: [{ key: 'tok', label: 'Token', value: '••••', required: true, sensitive: true }] }] }
  expect(target.querySelector('.ui-secret')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-config-input-p-tok"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-config-save-p-tok"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `EmptyState`, `Field`, `Input`, `Secret`. Replace the header refresh button with `Btn` (Task 2). Replace each per-key `<div class="settings-field">` block (lines 71-95) with a kit field. Replace the whole inner `{#each plugin.keys …}` body:

```svelte
{#each plugin.keys as keyState (keyState.key)}
  <div class="settings-field" data-testid={`plugin-config-key-${plugin.pluginId}-${keyState.key}`}>
    <div class="settings-field__head">
      <span class="settings-field__label">{keyState.label}</span>
      {#if keyState.value !== null}
        <Secret value={keyState.value} />
      {:else}
        <span class="placeholder">unset</span>
      {/if}
      {#if keyState.required}<span class="badge-required">required</span>{/if}
    </div>
    <Field label="New value">
      <div class="settings-field__editor-row">
        <Input
          type={keyState.sensitive ? 'password' : 'text'}
          value={drafts[draftKey(plugin.pluginId, keyState.key)] ?? ''}
          placeholder="enter a new value"
          onInput={(v) => (drafts[draftKey(plugin.pluginId, keyState.key)] = v)}
          testid={`plugin-config-input-${plugin.pluginId}-${keyState.key}`} />
        <Btn variant="primary" size="sm" testid={`plugin-config-save-${plugin.pluginId}-${keyState.key}`} onClick={() => void save(plugin.pluginId, keyState.key)}>
          {#snippet children()}Save{/snippet}
        </Btn>
      </div>
    </Field>
  </div>
{/each}
```

Replace the empty branch:

```svelte
{#if plugins.length === 0 && !loading}
  <EmptyState title="No plugin config keys" hint="No plugins with admin config keys found." />
{/if}
```

In `<style>`, drop `.settings-field__editor`, `.settings-field__editor input`, `.settings-field__editor button`; add `.settings-field__editor-row { display: flex; gap: 8px; align-items: center; }`. Keep `.plugin-block*`, `.settings-field`, `__head`, `__label`, `.badge-required`.

> `Secret` reveal is visual-only (server-masked values) — leave `onReveal` unset.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminPluginsConfigSection.svelte tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts
git commit -m "fix(settings): adopt Secret/Field/Input/Btn/EmptyState in AdminPluginsConfigSection" -- client/settings/sections/admin/AdminPluginsConfigSection.svelte tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts
```

---

## Task 8: `AdminSystemSection` — `Secret` + `Field`/`Input` + `Btn`

**Files:**

- Modify: `client/settings/sections/admin/AdminSystemSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminSystemSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (mock `fetchAdminSystem` → one key with a value):

```ts
test('renders masked system value via Secret, editor via Field/Input/Btn', async () => {
  // mock fetchAdminSystem -> { config: { llm_apikey: { value: '••••' } } }
  expect(target.querySelector('.ui-secret')).not.toBeNull()
  expect(target.querySelector('[data-testid="system-input-llm_apikey"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('[data-testid="system-save-llm_apikey"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `Field`, `Input`, `Secret`. Replace the header refresh button with `Btn` (Task 2). Replace each `<div class="settings-field">` body (lines 66-80):

```svelte
{#each keys as key (key)}
  <div class="settings-field" data-testid={`system-row-${key}`}>
    <div class="settings-field__head">
      <span class="settings-field__label">{key}</span>
      {#if config[key]?.value !== null}
        <Secret value={config[key]?.value ?? ''} />
      {:else}
        <span class="placeholder">unset</span>
      {/if}
    </div>
    <Field label="New value">
      <div class="settings-field__editor-row">
        <Input
          type={SENSITIVE_SYSTEM_KEYS.has(key) ? 'password' : 'text'}
          value={drafts[key] ?? ''}
          placeholder="enter a new value"
          onInput={(v) => (drafts[key] = v)}
          testid={`system-input-${key}`} />
        <Btn variant="primary" size="sm" testid={`system-save-${key}`} onClick={() => void save(key)}>
          {#snippet children()}Save{/snippet}
        </Btn>
      </div>
    </Field>
  </div>
{/each}
```

In `<style>`, drop `.settings-field__editor`, `.settings-field__editor input`, `.settings-field__editor button`; add `.settings-field__editor-row { display: flex; gap: 8px; align-items: center; }`. Keep the rest.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminSystemSection.svelte tests/client/settings/sections/admin/AdminSystemSection.test.ts
git commit -m "fix(settings): adopt Secret/Field/Input/Btn in AdminSystemSection" -- client/settings/sections/admin/AdminSystemSection.svelte tests/client/settings/sections/admin/AdminSystemSection.test.ts
```

---

## Task 9: `AdminInstancesSection` — `Field`/`Input`/`Select` + `Btn` + `DataTable`/`StatusPill`

**Files:**

- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminInstancesSection.test.ts` (create if absent)

Two forms (platform, task) + two tables. Keep the `<h3>Platform instances</h3>` / `<h3>Task instances</h3>` sub-labels (they distinguish the two tables; not a Panel-title duplicate). Status cells → `StatusPill`; all buttons → `Btn`; inputs → `Field`+`Input`; type selects → `Field`+`Select`.

- [ ] **Step 1: Write the failing test** (mock the four admin fetchers; one platform with `status: 'active'`, one provider type):

```ts
test('renders forms via Field/Input/Select/Btn and tables via DataTable with StatusPill', async () => {
  // mock '../../../../client/settings/admin-fetchers.js':
  //   fetchAdminPlatformInstances -> { instances: [{ id: 'tg', type: 'telegram', status: 'active' }] }
  //   fetchAdminTaskInstances -> { instances: [] }
  //   fetchAdminPlatformProviderTypes -> { providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }
  //   fetchAdminTaskProviderTypes -> { providerTypes: [] }
  expect(target.querySelector('[data-testid="platform-id"]')?.closest('.ui-input')).not.toBeNull()
  expect(target.querySelector('.ui-select')).not.toBeNull()
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
  expect(target.querySelector('.ui-pill')).not.toBeNull()
  expect(target.querySelector('[data-testid="platform-status-tg"]')?.classList.contains('ui-btn')).toBe(true)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Btn`, `DataTable`, `Field`, `Input`, `Select`, `StatusPill`. Replace the header refresh button with `Btn` (Task 2). Add table column/row derivations:

```ts
interface InstanceRow {
  id: string
  type: string
  status: string
}
const platformRows = $derived<InstanceRow[]>(platforms.map((r) => ({ id: r.id, type: r.type, status: r.status })))
const taskRows = $derived<InstanceRow[]>(tasks.map((r) => ({ id: r.id, type: r.type, status: r.status })))
const instanceColumns = [
  { key: 'id' as const, label: 'ID' },
  { key: 'type' as const, label: 'Type' },
  { key: 'status' as const, label: 'Status' },
  { key: 'actions' as const, label: '', align: 'right' as const },
]
```

Replace the platform `<form>` (lines 161-192) with:

```svelte
<form class="settings-form" onsubmit={(event) => { event.preventDefault(); void createPlatform() }}>
  <Field label="ID">
    <Input value={platformId} onInput={(v) => (platformId = v)} testid="platform-id" />
  </Field>
  <Field label="Type">
    <Select value={platformType} options={platformTypes.map((t) => ({ value: t.type, label: t.displayName }))} onChange={(v) => (platformType = v)} />
  </Field>
  {#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
    <Field label={`${field.label}${field.required ? ' *' : ''}`}>
      <Input type={field.sensitive ? 'password' : 'text'} value={platformConfig[field.key] ?? ''} onInput={(v) => (platformConfig[field.key] = v)} />
    </Field>
  {/each}
  <Btn variant="primary" type="submit">{#snippet children()}Create{/snippet}</Btn>
</form>
```

Replace the platform `<table>` (lines 193-216) with:

```svelte
<DataTable columns={instanceColumns} rows={platformRows} rowKey="id">
  {#snippet cell(row, col)}
    {#if col.key === 'status'}
      <StatusPill status={row.status} />
    {:else if col.key === 'actions'}
      <Btn variant="outline" size="sm" testid={`platform-status-${row.id}`} onClick={() => void toggleStatus(platforms.find((p) => p.id === row.id)!)}>
        {#snippet children()}{row.status === 'active' ? 'Stop' : 'Start'}{/snippet}
      </Btn>
      <Btn variant="danger" size="sm" testid={`platform-delete-${row.id}`} onClick={() => void deletePlatform(row.id)}>
        {#snippet children()}Delete{/snippet}
      </Btn>
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
  {#snippet empty()}No platform instances{/snippet}
</DataTable>
```

Replace the task `<form>` (lines 219-250) with the analogous kit form (testid `task-id`, `taskType`/`taskTypes`/`taskConfig`/`selectedTaskType`, submit calls `createTask`). Replace the task `<table>` (lines 251-269) with a `DataTable` over `taskRows` whose actions cell has only the Delete `Btn` (testid `task-delete-${row.id}` → `deleteTask(row.id)`), status cell `StatusPill`.

> The `toggleStatus` handler takes the full `AdminInstanceRow`; resolve it from `platforms` by id inside the cell (shown above). In `<style>` there are no local rules to remove (the file relies on shared `settings.css`).

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Visual check (preview)** — confirm both forms, both tables (status pills, action buttons), create/stop/start/delete still function.
- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/admin/AdminInstancesSection.svelte tests/client/settings/sections/admin/AdminInstancesSection.test.ts
git commit -m "fix(settings): adopt Field/Input/Select/Btn/DataTable/StatusPill in AdminInstancesSection" -- client/settings/sections/admin/AdminInstancesSection.svelte tests/client/settings/sections/admin/AdminInstancesSection.test.ts
```

---

## Task 10: Migrate ALL settings section headers to `PageHeader`

The deferred B1-equivalent cleanup. Every settings section (user + admin) renders `<header class="settings-section-header"><div><p class="eyebrow">E</p><h2>T</h2></div>[<Btn refresh>]</header>`. Replace each with `PageHeader`, hosting the (already-converted) Refresh `Btn` in the `action` snippet. Where the eyebrow duplicates the title, omit the eyebrow.

**Files (16 sections):** see the table below. **Tests:** the relevant section test files (from 3.2 + this phase) may assert the old `<h2>`/eyebrow; update those assertions to the `PageHeader` output (`.ui-page-header__title` text) as you go.

Per-section parameters:

| File                                                | eyebrow                    | title                 | has Refresh action |
| --------------------------------------------------- | -------------------------- | --------------------- | ------------------ |
| `sections/ProfileSection.svelte`                    | `Personal`                 | `Profile`             | yes                |
| `sections/TaskProviderSection.svelte`               | — (omit; duplicates title) | `Task provider`       | yes                |
| `sections/ToolsSection.svelte`                      | — (omit; duplicates title) | `Tools`               | yes                |
| `sections/McpSection.svelte`                        | `Integrations`             | `MCP endpoints`       | yes                |
| `sections/PluginsSection.svelte`                    | — (omit; duplicates title) | `Plugins`             | yes                |
| `sections/IdentitySection.svelte`                   | — (omit)                   | dynamic (see note)    | yes                |
| `sections/MembersSection.svelte`                    | `Group`                    | `Members`             | yes                |
| `sections/GroupProviderSection.svelte`              | `Group`                    | `Group task provider` | yes                |
| `sections/admin/AdminAdminsSection.svelte`          | `Admin · Roster`           | `Admins`              | yes                |
| `sections/admin/AdminAnnounceSection.svelte`        | `Admin`                    | `Announce`            | **no**             |
| `sections/admin/AdminGroupsSection.svelte`          | `Admin · Access`           | `Groups`              | yes                |
| `sections/admin/AdminUsersSection.svelte`           | `Admin · Access`           | `Users`               | yes                |
| `sections/admin/AdminInstancesSection.svelte`       | `Admin · Runtime`          | `Instances`           | yes                |
| `sections/admin/AdminPluginsApprovalSection.svelte` | `Admin · Plugins`          | `Plugin approval`     | yes                |
| `sections/admin/AdminPluginsConfigSection.svelte`   | `Admin · Plugins`          | `Plugin config`       | yes                |
| `sections/admin/AdminSystemSection.svelte`          | `Admin · System`           | `System (LLM)`        | yes                |

> **IdentitySection title** is dynamic. Add `const headerTitle = $derived(data !== null ? \`Identity · ${data.providerName}\` : 'Identity')`and pass`title={headerTitle}`.

Worked example (the standard transformation — apply per row, with that row's import path: `../../shared/ui/PageHeader.svelte` for `sections/*`, `../../../shared/ui/PageHeader.svelte` for `sections/admin/*`):

- [ ] **Step 1:** Pick a section, write/extend its test to assert `target.querySelector('.ui-page-header__title')?.textContent` equals the title and that `.settings-section-header` is gone (run Red).

- [ ] **Step 2: Implement.** Add `import PageHeader from '…/PageHeader.svelte'`. Replace:

```svelte
<header class="settings-section-header">
  <div>
    <p class="eyebrow">Admin · Access</p>
    <h2>Groups</h2>
  </div>
  <Btn variant="ghost" size="sm" onClick={() => void load()}>
    {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
  </Btn>
</header>
```

with (eyebrow present + action):

```svelte
<PageHeader eyebrow="Admin · Access" title="Groups">
  {#snippet action()}
    <Btn variant="ghost" size="sm" onClick={() => void load()}>
      {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
    </Btn>
  {/snippet}
</PageHeader>
```

For **eyebrow-omitted** rows, drop the `eyebrow` prop: `<PageHeader title="Tools">…`. For **AdminAnnounceSection** (no refresh), use `<PageHeader eyebrow="Admin" title="Announce" />` with no `action` snippet.

- [ ] **Step 3:** Run that section's test — expect PASS. Repeat Steps 1–3 for each of the 16 rows.

- [ ] **Step 4: Commit** (one scoped commit listing all 16 sections + their touched tests):

```bash
git add client/settings/sections/*.svelte client/settings/sections/admin/*.svelte tests/client/settings/sections
git commit -m "fix(settings): migrate all section headers to PageHeader (B1)" -- client/settings/sections client/settings/sections/admin tests/client/settings/sections
```

> If `bun knip`/typecheck flags an unused `Caption`/`eyebrow` import anywhere, remove it. `SettingsApp.test.ts`/scrollspy rely on the section `id=` attributes, not the header markup — those `id`s are on the `<section>`, unchanged.

---

## Task 11: Delete dead `settings.css` shadow rules

After Tasks 1–10 + Phase 3.2, the settings shadow-styling layer is unused. Read `client/settings/settings.css` and remove the rule blocks that no longer have consumers. **Verify each with grep before deleting.**

- [ ] **Step 1: Confirm no remaining consumers** for each candidate selector:

```bash
rg -n "settings-table|masked-value|settings-section-header|settings-form (input|button|select|label)|class=\"eyebrow\"" client/settings --glob '!*.css'
```

Expected: no matches in `.svelte` files (all migrated). Any match means that file still needs migrating first.

- [ ] **Step 2: Delete the dead rule blocks** from `client/settings/settings.css`:
  - `.settings-table`, `.settings-table th`, `.settings-table td`, `.settings-table-wrap` (tables → `DataTable`)
  - `.masked-value` (→ `Secret`)
  - `.settings-section-header` and the settings `.eyebrow` rule (→ `PageHeader`)
  - the descendant form-control rules `.settings-form input`, `.settings-form select`, `.settings-form button`, `.settings-form label` (→ `Field`/`Input`/`Select`/`Btn`)

  **Keep:** the `.settings-form` container/flex rule (forms still use it for layout), `.placeholder`, `.status-error`, `.status-success` (still used by loading/notice/status messages).

- [ ] **Step 3: Rebuild + visual check.** `bun build:client`; preview the settings UI and confirm no unstyled regressions (forms, tables, headers, masked secrets render via kit).

- [ ] **Step 4: Commit**

```bash
git add client/settings/settings.css
git commit -m "chore(settings): remove dead shadow-styling rules superseded by the kit" -- client/settings/settings.css
```

---

## Task 12: Phase 3.3 + Phase 3 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`). Pay attention to `tests/client/settings/SettingsApp.test.ts` and scrollspy.
- [ ] **Step 2:** `bun typecheck` — no errors.
- [ ] **Step 3:** `bun knip` — no new unused findings (removed imports/styles).
- [ ] **Step 4:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 5:** `bun build:client` — all three bundles (debug/admin/settings) build.
- [ ] **Step 6:** `bun check:full` — full gate green.
- [ ] **Step 7 (optional):** preview `/admin`, `/debug`, and the settings UI side by side — confirm one consistent telemetry design language across all three surfaces.

No commit — gate over Tasks 1–11 (and the whole Phase 3).

---

## Self-Review (completed during authoring)

- **Spec coverage:** every admin-section anti-pattern → a task: `Btn` (all 8), `Field`+`Input`/`Select` (T2,3,4,5,7,8,9), `Input` multiline (T1,T5), `DataTable` (T2,3,4,6,9 — 6 tables incl. 2 in Instances), `StatusPill` (T6,T9 status cells), `Secret` (T7,T8 masked values), `EmptyState` (T7). Cross-cutting: `PageHeader` for all 16 settings headers (T10), `settings.css` dead-rule deletion (T11). This completes the spec's `/settings` sweep.
- **Placeholder scan:** complete before/after for every change; the only adaptation is matching mock fixtures to real `fetcher-schemas`/`admin-fetchers` shapes (explicitly instructed). Task 10 uses one worked example + an exhaustive per-file parameter table (mechanical uniform transform), and Task 11 is verification-driven deletion with grep guards — neither is a placeholder.
- **Type consistency:** `Input`(`value`,`onInput`,`type`,`placeholder`,`testid`,`multiline`,`rows`), `Select`(`value`,`options:{value,label}[]`,`onChange`), `Field`(`label`,`hint`,`children`), `Btn`(`variant`,`size`,`type`,`onClick`,`disabled`,`testid`,`children`), `DataTable`(`columns`,`rows`,`rowKey`,`cell`,`empty`), `StatusPill`(`status`), `Secret`(`value`), `PageHeader`(`eyebrow`,`title`,`action`), `EmptyState`(`title`,`hint`) — all match Phase 1 + 2.3 + this phase's Task 1. `Field` has no `style` prop (noted in Task 5).
- **testid preservation:** every existing `data-testid` carried onto the kit element via `testid`.

---

## Phase 3 complete

With 3.1 (`/debug`), 3.2 (settings user sections), and 3.3 (settings admin + cleanup) done, the spec's "kit + all surfaces" scope is fully realized: `/admin`, `/debug`, and the settings UI all render through the shared backstage kit, and the legacy `settings.css` shadow layer is gone. No further backstage phases remain.
