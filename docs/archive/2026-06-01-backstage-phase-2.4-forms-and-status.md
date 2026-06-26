<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 2.4 — Forms & Status Sweep (A7, B2/B3/B4, B7, C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `/admin` adoption sweep across the remaining sections/components: floating Reminders control → contained labeled toolbar (A7); native `<button>` → `Btn` (B2); raw `<input>` → `Field`+`Input` (B3); plain-text status → `StatusPill` (B4); unpanelled Plugin Config → `Panel`, drop duplicate heading (B7); masked credential value → `Secret` (C2).

**Architecture:** Consumer-side adoption only, one task per file. Relies on the kit primitives plus the `testid`/`password` enhancements landed in Phase 2.3.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§7 findings A7, B2, B3, B4, B7, C2).

**Depends on:** Phase 1 (`Field`, `Toolbar`, `Secret`, `StatusPill`, `EmptyState`), Phase 2.3 (`Btn`/`Input`/`Select` `testid`, `Input` `password`).

**Files touched:** `RemindersSection`, `MemosSection`, `IdentitiesSection`, `GroupsSection`, `BillingSection`, `CredentialsForm`, `PluginConfigForm`, `SubjectDetail`.

---

## Conventions (apply to every task)

- **TDD write-hook**: test-first (assert new kit classes `.ui-btn`/`.ui-input`/`.ui-pill`/`.ui-secret`), run Red, refactor Green.
- Run client suite: `bun test:client` (ignore one unrelated `ECONNREFUSED`).
- `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit each task SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.
- When converting a styled raw control to a kit component, delete the now-dead local style rule in the same file's `<style>` block (verify nothing else references it).

---

## Task 1: `RemindersSection` — A7 + B2 + B3 + B4

**Files:**

- Modify: `client/admin/sections/RemindersSection.svelte`
- Test: `tests/client/admin/RemindersSection.test.ts` (create if absent)

Changes: the floating `.reminders__header` (bare input + button) becomes a contained, labeled `Toolbar` with a `Field`+`Input` and a `Btn` (A7/B2/B3); the two status `<span class="reminders__status">` become `StatusPill` (B4).

- [ ] **Step 1: Write the failing test:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import RemindersSection from '../../../client/admin/sections/RemindersSection.svelte'

describe('RemindersSection.svelte', () => {
  test('renders the filter as a labeled toolbar with kit Input + Btn (A7/B2/B3)', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(RemindersSection, { target })
    expect(target.querySelector('.ui-toolbar')).not.toBeNull()
    expect(target.querySelector('.ui-field')).not.toBeNull()
    expect(target.querySelector('[data-testid="reminders-user-id"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="reminders-load"]')?.classList.contains('ui-btn')).toBe(true)
    // bare floating header div is gone
    expect(target.querySelector('.reminders__header')).toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/admin/RemindersSection.test.ts` — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Field from '../../shared/ui/Field.svelte'
import Input from '../../shared/ui/Input.svelte'
import StatusPill from '../../shared/ui/StatusPill.svelte'
import Toolbar from '../../shared/ui/Toolbar.svelte'
```

Replace the `.reminders__header` block (lines 68-77) with:

```svelte
<Toolbar>
  <Field label="user id">
    <Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="reminders-user-id" />
  </Field>
  <Btn
    variant="primary"
    size="sm"
    testid="reminders-load"
    disabled={userId.trim() === '' || loading}
    onClick={() => { void loadReminders() }}>
    {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
  </Btn>
</Toolbar>
```

Replace the recurring status span:

```svelte
<span class="reminders__status">{r.enabled ? 'Enabled' : 'Paused'}</span>
```

with:

```svelte
<StatusPill status={r.enabled ? 'enabled' : 'paused'} />
```

Replace the deferred status span:

```svelte
<span class="reminders__status">{d.status}</span>
```

with:

```svelte
<StatusPill status={d.status} />
```

In `<style>`, delete `.reminders__header` and `.reminders__status` rules (now unused).

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/RemindersSection.svelte tests/client/admin/RemindersSection.test.ts
git commit -m "fix(admin): contain Reminders filter + StatusPill status (A7/B2/B3/B4)" -- client/admin/sections/RemindersSection.svelte tests/client/admin/RemindersSection.test.ts
```

---

## Task 2: `MemosSection` — B2 + B3 + B4

**Files:**

- Modify: `client/admin/sections/MemosSection.svelte`
- Test: `tests/client/admin/MemosSection.test.ts` (create if absent)

Changes: the raw `.memos__user-id-input` → `Input` (B3); the `.memos__load-btn` → `Btn` (B2); the memos table `status` column → `StatusPill` via a `DataTable` `cell` snippet (B4).

- [ ] **Step 1: Write the failing test:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import MemosSection from '../../../client/admin/sections/MemosSection.svelte'

describe('MemosSection.svelte', () => {
  test('uses kit Input + Btn in the filter (B2/B3)', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(MemosSection, { target })
    expect(target.querySelector('[data-testid="memos-user-id"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="memos-load"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
})
```

> A B4 status-pill assertion requires loaded rows; if the file already mocks `fetchMemos`, add a row and assert `.ui-pill` after load. Otherwise keep the B2/B3 assertions and rely on the visual check for B4.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Input from '../../shared/ui/Input.svelte'` and `import StatusPill from '../../shared/ui/StatusPill.svelte'` (`Btn`, `DataTable`, `Panel`, `Seg` already imported). Replace the raw input:

```svelte
<input class="memos__user-id-input" data-testid="memos-user-id" type="text" bind:value={userId} placeholder="user id" />
```

with:

```svelte
<Input value={userId} onInput={(v) => (userId = v)} placeholder="user id" testid="memos-user-id" />
```

Replace the raw load button:

```svelte
<button class="memos__load-btn" data-testid="memos-load" type="submit" disabled={userId.trim() === '' || loading}>
  {loading ? 'Loading…' : 'Load'}
</button>
```

with:

```svelte
<Btn variant="primary" size="sm" type="submit" testid="memos-load" disabled={userId.trim() === '' || loading}>
  {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
</Btn>
```

Add a `cell` snippet to the `DataTable` so the `status` column renders as a pill:

```svelte
<DataTable {columns} {rows} rowKey="id">
  {#snippet cell(row, col)}
    {#if col.key === 'status'}
      <StatusPill status={row.status} />
    {:else}
      {String(row[col.key] ?? '')}
    {/if}
  {/snippet}
</DataTable>
```

In `<style>`, delete `.memos__user-id-input` and `.memos__load-btn` (+ `:disabled`) rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/MemosSection.svelte tests/client/admin/MemosSection.test.ts
git commit -m "fix(admin): adopt Input/Btn/StatusPill in MemosSection (B2/B3/B4)" -- client/admin/sections/MemosSection.svelte tests/client/admin/MemosSection.test.ts
```

---

## Task 3: `IdentitiesSection` — B2 + B3

**Files:**

- Modify: `client/admin/sections/IdentitiesSection.svelte`
- Test: `tests/client/admin/IdentitiesSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import IdentitiesSection from '../../../client/admin/sections/IdentitiesSection.svelte'

describe('IdentitiesSection.svelte', () => {
  test('uses kit Input + Btn in the filter (B2/B3)', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(IdentitiesSection, { target })
    expect(target.querySelector('[data-testid="identities-user-id"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="identities-load"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Btn from '../../shared/ui/Btn.svelte'` and `import Input from '../../shared/ui/Input.svelte'`. Replace the raw input:

```svelte
<input class="identities__user-id-input" data-testid="identities-user-id" type="text" bind:value={userId} placeholder="filter by user id" />
```

with:

```svelte
<Input value={userId} onInput={(v) => (userId = v)} placeholder="filter by user id" testid="identities-user-id" />
```

Replace the raw reload button:

```svelte
<button class="identities__reload-btn" data-testid="identities-load" type="submit" disabled={loading}>
  {loading ? 'Loading…' : 'Reload'}
</button>
```

with:

```svelte
<Btn variant="primary" size="sm" type="submit" testid="identities-load" disabled={loading}>
  {#snippet children()}{loading ? 'Loading…' : 'Reload'}{/snippet}
</Btn>
```

Delete `.identities__user-id-input` and `.identities__reload-btn` (+ `:disabled`) style rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/IdentitiesSection.svelte tests/client/admin/IdentitiesSection.test.ts
git commit -m "fix(admin): adopt Input/Btn in IdentitiesSection (B2/B3)" -- client/admin/sections/IdentitiesSection.svelte tests/client/admin/IdentitiesSection.test.ts
```

---

## Task 4: `GroupsSection` — B2 (refresh + revoke)

**Files:**

- Modify: `client/admin/sections/GroupsSection.svelte`
- Test: `tests/client/admin/GroupsSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (refresh button is always present in the Panel action):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import GroupsSection from '../../../client/admin/sections/GroupsSection.svelte'

describe('GroupsSection.svelte', () => {
  test('renders the refresh control as a kit Btn (B2)', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(GroupsSection, { target })
    expect(target.querySelector('.ui-btn')).not.toBeNull()
    expect(target.querySelector('.groups__refresh-btn')).toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Btn from '../../shared/ui/Btn.svelte'`. Replace the refresh button (`action` snippet):

```svelte
<button class="groups__refresh-btn" type="button" onclick={() => { void loadGroups() }} disabled={loading}>
  {loading ? 'Refreshing…' : 'Refresh'}
</button>
```

with:

```svelte
<Btn variant="secondary" size="sm" onClick={() => { void loadGroups() }} disabled={loading}>
  {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
</Btn>
```

Replace the revoke button inside the `cell` snippet:

```svelte
<button class="groups__revoke-btn" type="button" onclick={() => { void revoke(row.group_id) }}>
  revoke
</button>
```

with:

```svelte
<Btn variant="danger" size="sm" onClick={() => { void revoke(row.group_id) }}>
  {#snippet children()}revoke{/snippet}
</Btn>
```

Delete `.groups__refresh-btn` (+ `:disabled`), `.groups__revoke-btn` (+ `:hover`) style rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/GroupsSection.svelte tests/client/admin/GroupsSection.test.ts
git commit -m "fix(admin): adopt Btn for Groups refresh/revoke (B2)" -- client/admin/sections/GroupsSection.svelte tests/client/admin/GroupsSection.test.ts
```

---

## Task 5: `BillingSection` — B2 (refresh)

**Files:**

- Modify: `client/admin/sections/BillingSection.svelte`
- Test: `tests/client/admin/BillingSection.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import BillingSection from '../../../client/admin/sections/BillingSection.svelte'

describe('BillingSection.svelte', () => {
  test('renders the refresh control as a kit Btn (B2)', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(BillingSection, { target })
    expect(target.querySelector('[data-testid="billing-refresh"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Btn from '../../shared/ui/Btn.svelte'`. Replace the refresh button (`action` snippet):

```svelte
<button type="button" class="billing-refresh-btn" data-testid="billing-refresh" onclick={() => { void refreshAll() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
```

with:

```svelte
<Btn variant="ghost" size="sm" testid="billing-refresh" onClick={() => { void refreshAll() }}>
  {#snippet children()}{fetching ? 'Refreshing...' : 'Refresh'}{/snippet}
</Btn>
```

Delete `.billing-refresh-btn` (+ `:hover`) style rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/BillingSection.svelte tests/client/admin/BillingSection.test.ts
git commit -m "fix(admin): adopt Btn for Billing refresh (B2)" -- client/admin/sections/BillingSection.svelte tests/client/admin/BillingSection.test.ts
```

---

## Task 6: `CredentialsForm` — C2 + B2 + B3 + B7

**Files:**

- Modify: `client/admin/components/CredentialsForm.svelte`
- Test: `tests/client/admin/CredentialsForm.test.ts` (extend; create if absent)

Changes: remove the duplicate inner `<h3>LLM credentials</h3>` (B7 — the wrapping Panel in `SystemSection` already titles it "llm credentials"); masked value `<code class="masked-value">…</code><span class="masked-hint">` → `Secret` (C2); Save/Cancel/Edit `<button>` → `Btn` (B2); edit `<input>` → `Input` (B3).

- [ ] **Step 1: Extend the failing test:**

```ts
test('renders masked credential via Secret and actions via Btn (C2/B2)', () => {
  // mount CredentialsForm with snapshot where llm_apikey.value is a masked string and required=true
  // (reuse the file's existing snapshot fixture builder)
  expect(target.querySelector('.ui-secret')).not.toBeNull()
  expect(target.querySelector('[data-testid="edit-llm_apikey"]')?.classList.contains('ui-btn')).toBe(true)
  // duplicate inner heading removed (Panel titles it)
  expect([...target.querySelectorAll('h3')].some((h) => h.textContent === 'LLM credentials')).toBe(false)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Input from '../../shared/ui/Input.svelte'
import Secret from '../../shared/ui/Secret.svelte'
```

(keep the existing `Pill` import — still used for required/optional badges.)

Remove the `<h3>LLM credentials</h3>` line.

Replace the masked-value branch:

```svelte
<code class="masked-value" data-testid={`masked-value-${key}`}>{snapshot[key].value}</code>
<span class="masked-hint">(hidden)</span>
```

with:

```svelte
<span data-testid={`masked-value-${key}`}>
  <Secret value={snapshot[key].value ?? '••••••••'} hint="(hidden)" />
</span>
```

Replace the edit `<input>`:

```svelte
<input type="text" data-testid={`input-${key}`} bind:value={inputValue} placeholder="new value" />
```

with:

```svelte
<Input
  type={SENSITIVE_KEYS.has(key) ? 'password' : 'text'}
  value={inputValue}
  onInput={(v) => (inputValue = v)}
  placeholder="new value"
  testid={`input-${key}`} />
```

Replace the three action buttons. Save:

```svelte
<Btn variant="primary" size="sm" type="button" testid={`submit-${key}`} disabled={submitting || inputValue.trim() === ''} onClick={() => { void submit(key) }}>
  {#snippet children()}Save{/snippet}
</Btn>
```

Cancel:

```svelte
<Btn variant="ghost" size="sm" onClick={cancelEdit}>
  {#snippet children()}Cancel{/snippet}
</Btn>
```

Edit:

```svelte
<Btn variant="secondary" size="sm" testid={`edit-${key}`} onClick={() => startEdit(key)}>
  {#snippet children()}Edit{/snippet}
</Btn>
```

> **Reveal note:** credential values arrive **already masked from the server** (`/admin/llm` masks `llm_apikey`). `Secret`'s reveal button is therefore a visual affordance only — leave `onReveal` unset. Wiring a real reveal would need a new server endpoint; out of scope. Record this in the commit body.

In `<style>`, the `.key-name` rule stays; if `.masked-value`/`.masked-hint` were defined here they are in `admin.css`, not this file — leave `admin.css` untouched (other code may use them) but stop emitting those classes here.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/components/CredentialsForm.svelte tests/client/admin/CredentialsForm.test.ts
git commit -m "fix(admin): adopt Secret/Input/Btn in CredentialsForm, drop duplicate heading (C2/B2/B3/B7)" -- client/admin/components/CredentialsForm.svelte tests/client/admin/CredentialsForm.test.ts
```

---

## Task 7: `PluginConfigForm` — B2 + B3 + B7 + C2

**Files:**

- Modify: `client/admin/components/PluginConfigForm.svelte`
- Test: `tests/client/admin/PluginConfigForm.test.ts` (extend; create if absent)

Changes: drop the duplicate inner `<h3>Plugin configuration</h3>` (B7 — the section's `PageHeader` titles it "Plugin Config"); wrap each plugin group in a `Panel` titled by the plugin id (B7 — gives the per-plugin tables a panel/border, replaces the bare `<h4>`); Save/Cancel/Edit → `Btn` (B2); edit `<input>` → `Input` (B3); masked value → `Secret` (C2). The empty/loading states become `EmptyState`-friendly placeholders (keep current copy).

- [ ] **Step 1: Extend the failing test:**

```ts
test('wraps each plugin group in a Panel, uses Secret/Input/Btn, drops duplicate heading (B7/B2/B3/C2)', () => {
  // mount PluginConfigForm with a snapshot: one plugin, one sensitive key with a value, one normal key
  expect([...target.querySelectorAll('h3')].some((h) => h.textContent === 'Plugin configuration')).toBe(false)
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelector('.ui-secret')).not.toBeNull()
  expect(target.querySelector('[data-testid^="edit-"]')?.classList.contains('ui-btn')).toBe(true)
})
```

> Reuse the file's existing `AdminPluginConfigSnapshot` fixture builder if present; otherwise construct a minimal snapshot matching `client/shared/api-types.ts`.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Input from '../../shared/ui/Input.svelte'
import Panel from '../../shared/ui/Panel.svelte'
import Secret from '../../shared/ui/Secret.svelte'
```

Remove `<h3>Plugin configuration</h3>`.

Wrap each plugin group: replace the per-plugin `<section class="plugin-group">…<h4>{plugin.pluginId}</h4><table>…</table></section>` with a `Panel`:

```svelte
{#each snapshot.plugins as plugin (plugin.pluginId)}
  <Panel title={plugin.pluginId}>
    {#snippet body()}
      <table>
        <thead><tr><th>Key</th><th>Value</th><th>Action</th></tr></thead>
        <tbody>
          {#each plugin.keys as keyState (keyState.key)}
            <tr data-testid="plugin-config-row">
              <td>
                <span>{keyState.label}</span>
                {#if keyState.required}<span class="required-badge">required</span>{/if}
              </td>
              <td>
                {#if isEditing(plugin.pluginId, keyState.key)}
                  <Input
                    type={keyState.sensitive ? 'password' : 'text'}
                    value={inputValue}
                    onInput={(v) => (inputValue = v)}
                    placeholder="new value"
                    testid={`input-${plugin.pluginId}-${keyState.key}`} />
                {:else if keyState.sensitive && keyState.value !== null}
                  <span data-testid={`masked-value-${plugin.pluginId}-${keyState.key}`}>
                    <Secret value={keyState.value} hint="(hidden)" />
                  </span>
                {:else}
                  <span>{display(keyState)}</span>
                {/if}
              </td>
              <td>
                {#if isEditing(plugin.pluginId, keyState.key)}
                  <Btn variant="primary" size="sm" testid={`submit-${plugin.pluginId}-${keyState.key}`} disabled={submitting || inputValue.trim() === ''} onClick={() => { void submit(plugin.pluginId, keyState.key) }}>
                    {#snippet children()}Save{/snippet}
                  </Btn>
                  <Btn variant="ghost" size="sm" onClick={cancelEdit}>
                    {#snippet children()}Cancel{/snippet}
                  </Btn>
                {:else}
                  <Btn variant="secondary" size="sm" testid={`edit-${plugin.pluginId}-${keyState.key}`} onClick={() => startEdit(plugin.pluginId, keyState.key)}>
                    {#snippet children()}Edit{/snippet}
                  </Btn>
                {/if}
                {#if status !== null && status.pluginId === plugin.pluginId && status.key === keyState.key}
                  <span class={status.kind === 'error' ? 'status-error' : 'status-success'}>{status.message}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/snippet}
  </Panel>
{/each}
```

Keep the `{#if snapshot === null}` loading and `{:else if snapshot.plugins.length === 0}` empty branches as-is (their copy is fine). In `<style>`, drop the now-unused `.plugin-group` and `.plugin-group h4` rules; keep `.required-badge` and `.empty-state`.

> Same server-masking reveal note as Task 6 — `Secret` reveal is visual only here.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/components/PluginConfigForm.svelte tests/client/admin/PluginConfigForm.test.ts
git commit -m "fix(admin): panel-wrap plugin groups, adopt Secret/Input/Btn (B7/B2/B3/C2)" -- client/admin/components/PluginConfigForm.svelte tests/client/admin/PluginConfigForm.test.ts
```

---

## Task 8: `SubjectDetail` — B4 (recent-requests status)

**Files:**

- Modify: `client/admin/components/SubjectDetail.svelte`
- Test: `tests/client/admin/SubjectDetail.test.ts` (extend; create if absent)

The "recent requests" table renders `<td>{r.finishStatus}</td>` as plain text (B4).

- [ ] **Step 1: Extend the failing test.** Mount `SubjectDetail` with a `detail` fixture and stub `fetchRecentRequests` to return one row with `finishStatus: 'error'`; assert a `.ui-pill` appears in the recent-requests table. (Reuse the file's existing fixture/mock pattern; read `client/shared/api-types.ts` + `client/admin/fetcher-schemas.ts` for `BillingDetail`/`RecentRequestRow` shapes.)

```ts
test('renders recent-request finishStatus as a StatusPill (B4)', async () => {
  // mock fetchRecentRequests -> [{ ts, modelLabel, role, inputTokens, outputTokens, finishStatus: 'error' }]
  // mount SubjectDetail with a minimal BillingDetail
  await flush()
  expect(target.querySelector('.ui-pill')).not.toBeNull()
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import StatusPill from '../../shared/ui/StatusPill.svelte'`. Replace:

```svelte
<td>{r.finishStatus}</td>
```

with:

```svelte
<td><StatusPill status={r.finishStatus} /></td>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/admin/components/SubjectDetail.svelte tests/client/admin/SubjectDetail.test.ts
git commit -m "fix(admin): render recent-request status as StatusPill (B4)" -- client/admin/components/SubjectDetail.svelte tests/client/admin/SubjectDetail.test.ts
```

---

## Task 9: Phase 2.4 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`).
- [ ] **Step 2:** `bun typecheck` — no errors.
- [ ] **Step 3:** `bun knip` — no new unused findings from removed local styles/helpers.
- [ ] **Step 4:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 5:** `bun build:client` — bundles build.
- [ ] **Step 6 (optional):** preview/Storybook — confirm every section's buttons/inputs/status now use the kit and the Reminders filter is a contained labeled toolbar.

No commit — gate over Tasks 1–8.

---

## Self-Review (completed during authoring)

- **Spec coverage:** A7 → Task 1 (Reminders toolbar); B2 → Tasks 1–7 (every raw `<button>`); B3 → Tasks 1,2,3,6,7 (every raw `<input>`); B4 → Tasks 1,2,8 (Reminders/Memos/SubjectDetail status); B7 → Tasks 6,7 (duplicate headings + Panel-wrap); C2 → Tasks 6,7 (`Secret`). (InstancesSection's B2/B3/B4/B5 were handled in Phase 2.3.)
- **Placeholder scan:** complete before/after for every control; the only adaptation is reusing each test file's existing fixture/mock builders (grounding against real types — explicitly instructed), not a placeholder.
- **Type consistency:** `Btn`(`variant`,`size`,`type`,`onClick`,`disabled`,`testid`,`children`), `Input`(`value`,`onInput`,`type`,`placeholder`,`testid`), `Secret`(`value`,`hint`), `StatusPill`(`status`), `Toolbar`/`Field`(slot) all match Phase 1 + Phase 2.3. `DataTable` `cell` snippet signature `(row, col)` matches its committed API (as used in `GroupsSection`).
- **Known constraint recorded:** `Secret` reveal is a visual affordance only because credential/plugin secret values are server-masked (Tasks 6,7) — flagged, not silently implied to be functional.
