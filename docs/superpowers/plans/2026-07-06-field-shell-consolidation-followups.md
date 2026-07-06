<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Field-Shell Consolidation Follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish routing settings-field rows through `SettingsFieldShell` (migrate `CodeHostSection` and `AdminPluginsConfigSection`), and fix the save-feedback bug where a successful PATCH followed by a failed reload shows both a success line and an error line.

**Architecture:** `CodeHostSection` gets the same treatment its twin `CodingCredentialsSection` already has (shell rows, `ErrorState`+retry, aria roles, whole-record dirty-state). `AdminPluginsConfigSection` migrates its rows onto the shell (single label, keeps its `required` badge, per-field dirty-state, roles). Across all four status-showing sections, `load()` returns a boolean and callers set the success status only when the reload succeeded.

**Tech Stack:** Svelte 5 runes/snippets; TypeScript (`.js` import extensions); Bun test runner (`mount`/`unmount`, `setMockFetch`/`restoreFetch`, `drain`); Storybook `bun shoot` visual screenshots.

**Spec:** [`docs/superpowers/specs/2026-07-06-field-shell-consolidation-followups-design.md`](../specs/2026-07-06-field-shell-consolidation-followups-design.md)

---

## Background the engineer needs

- **Client component tests** run only via the client runner (default `bun test` skips them):
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
  This executes the whole `tests/client/` suite; **2 pre-existing, unrelated failures** in `tests/client/settings/sections/MemorySection.test.ts` (network flake) are baseline noise — ignore them, flag only NEW failures. When a task lists a single test path, that path is the one to watch; the runner still runs the rest.
- **`SettingsFieldShell`** (`client/settings/components/SettingsFieldShell.svelte`) is DONE and unchanged by this plan. Props: `label`, `required?`, `testid?`, `editorOpen?` (default true); snippets `head`/`editor`/`footer`. It renders one `.settings-field__label` (with an `id`, publishing it via field-context so an `Input` in the `editor` snippet gets `aria-labelledby`), an accent `.settings-field__req` when `required`, and gates the editor slot on `editor && editorOpen`. READ it before editing consumers.
- **`.js` import extensions** are mandatory; **no lint-disable/type-ignore** comments (a hook blocks them).
- Commit to the current branch (`master`) — authorized.
- The `load()` → boolean change: return `true` after a successful load, `false` in the `catch` and in any early `if (id !== contextId) return` bail. `void load(...)` callers (the `$effect`s) ignore the return — leave them as `void load(...)`.

## File structure

| File                                                                     | Task | Change                                                                     |
| ------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------------- |
| `client/settings/sections/ByokSection.svelte`                            | 1    | `load()`→boolean; `save()` gates status on reload success                  |
| `client/settings/sections/CodingCredentialsSection.svelte`               | 1    | `load()`→boolean; `saveAll()`/`confirmClear()` gate status                 |
| `tests/client/settings/byok-section.test.ts`                             | 1    | +reload-fail test                                                          |
| `tests/client/settings/coding-credentials-section.test.ts`               | 1    | +reload-fail test, +`role="alert"` test                                    |
| `client/settings/sections/CodeHostSection.svelte`                        | 2    | shell rows + ErrorState + roles + dirty-state + `load()`→boolean           |
| `tests/client/settings/code-host-section.test.ts`                        | 2    | fix 1 existing test; +dirty/ErrorState/role/reload-fail/double-label tests |
| `client/settings/sections/admin/AdminPluginsConfigSection.svelte`        | 3    | shell rows + roles + dirty-state + `load()`→boolean                        |
| `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts` | 3    | +dirty/role/double-label/reload-fail tests                                 |
| `.storybook-shots/**` (gitignored)                                       | 4    | re-baseline CodeHost + AdminPluginsConfig                                  |

Order rationale: Task 1 is the low-risk save-fix on the two already-migrated sections. Tasks 2 and 3 each fully own one section (migration + its own save-fix + tests). Task 4 is visual + full check.

---

## Task 1: Save-feedback fix for ByokSection + CodingCredentialsSection

**Files:**

- Modify: `client/settings/sections/ByokSection.svelte`, `client/settings/sections/CodingCredentialsSection.svelte`
- Test: `tests/client/settings/byok-section.test.ts`, `tests/client/settings/coding-credentials-section.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/byok-section.test.ts` inside `describe('ByokSection', …)`:

```typescript
test('a save whose reload fails shows the error and no success line', async () => {
  setCsrfToken('c')
  let getCount = 0
  setMockFetch((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/byok') && method === 'PATCH') return Promise.resolve(json({ ok: true }))
    getCount++
    return getCount === 1
      ? Promise.resolve(json(enabledPayload))
      : Promise.resolve(new Response('reload failed', { status: 500 }))
  })
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
  await drain()
  expect(target.querySelector('p[role="status"]')).toBeNull()
  expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
  void unmount(component)
})
```

Add to `tests/client/settings/coding-credentials-section.test.ts` inside `describe('CodingCredentialsSection', …)`:

```typescript
test('a failed save shows an inline error with role="alert"', async () => {
  setCsrfToken('c')
  setMockFetch((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
      return Promise.resolve(new Response('save failed', { status: 500 }))
    return Promise.resolve(json(withSelectsPayload))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
  providerSelect.value = 'openai'
  providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
  await drain()
  expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
  void unmount(component)
})

test('a save whose reload fails shows no success line', async () => {
  setCsrfToken('c')
  let getCount = 0
  setMockFetch((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
      return Promise.resolve(json({ ok: true }))
    getCount++
    return getCount === 1
      ? Promise.resolve(json(withSelectsPayload))
      : Promise.resolve(new Response('reload failed', { status: 500 }))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
  providerSelect.value = 'openai'
  providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
  await drain()
  await drain()
  expect(target.querySelector('p[role="status"]')).toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: the two reload-fail tests FAIL (a `p[role="status"]` success line is currently present after a failed reload). The `role="alert"` test may already pass (the inline error already has the role from the predecessor) — that's fine.

- [ ] **Step 3: `ByokSection.svelte` — `load()` returns boolean, `save()` gates status**

In `client/settings/sections/ByokSection.svelte`, change the `load` signature and returns. Replace the `async function load(id: string): Promise<void> {` body so it returns `boolean`:

```svelte
  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    if (id !== loadedContextId) clearContextState()
    loading = true
    try {
      const next = await fetchByok(id)
      if (id !== contextId) return false
      data = next
      loadedContextId = id
      drafts = initialDrafts(next.fields)
      replacing = {}
      return true
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }
```

In `save()`, replace `await load(contextId)` + the unconditional `status = …` with a gated version:

```svelte
      await patchByok({ contextId, values: { [field.key]: drafts[field.key] ?? '' } })
      const ok = await load(contextId)
      if (ok) status = `${field.label} saved.`
```

- [ ] **Step 4: `CodingCredentialsSection.svelte` — `load()` boolean, gate `saveAll()` and reorder `confirmClear()`**

Change `load` to return boolean (same shape as above): after `data = next … replacing = {}` add `return true`; change the `if (id !== contextId) return` to `return false`; add `return false` in the `catch`; signature `Promise<boolean>`.

In `saveAll()`, replace:

```svelte
      await patchCodingCredentials({ contextId, values: collectValues() })
      await load(contextId)
      status = 'AI provider saved.'
```

with:

```svelte
      await patchCodingCredentials({ contextId, values: collectValues() })
      const ok = await load(contextId)
      if (ok) status = 'AI provider saved.'
```

In `confirmClear()`, the success block currently sets `status` before `await load(contextId)`. Reorder it to reload first, then set status only on success:

```svelte
    if (ok) {
      pendingClear = false
      const reloaded = await load(contextId)
      if (reloaded) status = 'AI provider credentials cleared.'
    }
```

- [ ] **Step 5: Run the two suites**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts`
Expected: all ByokSection + CodingCredentialsSection tests PASS (existing + new). The predecessor's "save success line announced via role=status" test still passes (its mock returns the payload for every GET, so the reload succeeds and status is set).

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/ByokSection.svelte client/settings/sections/CodingCredentialsSection.svelte tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts
git commit -m "fix(settings): suppress save success line when the post-save reload fails (Byok, Coding)"
```

---

## Task 2: CodeHostSection — full shell migration + save-fix + tests

**Files:**

- Modify: `client/settings/sections/CodeHostSection.svelte`
- Test: `tests/client/settings/code-host-section.test.ts`

- [ ] **Step 1: Fix the one existing test that conflicts with dirty-state, and add the new tests**

In `tests/client/settings/code-host-section.test.ts`, the test `saving a configured forge omits the untouched masked token` clicks Save with no change — dirty-gating will disable Save. **Replace that test's body** so it edits a field first (preserving the "untouched token omitted" assertion):

```typescript
test('saving a configured forge omits the untouched masked token', async () => {
  setCsrfToken('csrf-t')
  setMockFetch(routeCodeHostMockSelfHosted)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

  await drain()

  // Make a real change (edit the instance URL) so the whole-record Save is enabled;
  // the untouched masked token must still be omitted from the PATCH.
  const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
  instance.value = 'https://gitlab.corp.com/edited'
  instance.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
  await drain()

  const parsed: unknown = JSON.parse(capturedPatchBody)
  expect(parsed).toMatchObject({
    values: { kind: 'gitlab-self-hosted', instance_url: 'https://gitlab.corp.com/edited' },
  })
  expect(parsed).not.toHaveProperty('values.forge_token')
  void unmount(component)
})
```

Then add these new tests inside `describe('CodeHostSection', …)`:

```typescript
test('the whole-record Save is disabled until a field changes (configured host)', async () => {
  setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const save = target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!
  expect(save.disabled).toBe(true)
  const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
  instance.value = 'https://gitlab.corp.com/x'
  instance.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  expect(save.disabled).toBe(false)
  void unmount(component)
})

test('a failed initial load renders ErrorState with a retry control', async () => {
  setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
  void unmount(component)
})

test('a save success line is announced via role="status"', async () => {
  setCsrfToken('csrf-t')
  setMockFetch(routeCodeHostMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
  input.value = 'ghp_secret'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
  await drain()
  expect(target.querySelector('p[role="status"]')).not.toBeNull()
  void unmount(component)
})

test('rows carry no redundant Field sub-label after the shell migration', async () => {
  setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  expect(target.querySelector('.ui-field__label')).toBeNull()
  void unmount(component)
})

test('a save whose reload fails shows no success line', async () => {
  setCsrfToken('csrf-t')
  let getCount = 0
  setMockFetch((url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
      return Promise.resolve(json({ ok: true }))
    getCount++
    return getCount === 1
      ? Promise.resolve(json(typedForgePayloadSelfHosted))
      : Promise.resolve(new Response('reload failed', { status: 500 }))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
  await drain()
  const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
  instance.value = 'https://gitlab.corp.com/edited'
  instance.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
  await drain()
  await drain()
  expect(target.querySelector('p[role="status"]')).toBeNull()
  expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run to verify new/updated tests fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: dirty-state, ErrorState, double-label (`.ui-field__label` still present pre-migration), and reload-fail tests FAIL.

- [ ] **Step 3: Update the `<script>` — imports, `load()` boolean, `formDirty`**

In `client/settings/sections/CodeHostSection.svelte`: remove `import Field from '../../shared/ui/Field.svelte'`. Add alongside the other UI imports:

```svelte
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
```

Change `load` to return boolean (as in Task 1): `Promise<boolean>`, `return true` after `replacing = {}`, `return false` at the `if (id !== contextId)` bail and in `catch`.

Add after the `unreadableError` derived:

```svelte
  // Whole-record save is meaningful only when a field's draft differs from its stored value.
  const formDirty = $derived(fields.some((f) => (drafts[f.key] ?? '') !== (f.sensitive ? '' : f.value)))
```

In `saveAll()`, gate the status:

```svelte
      await patchCodingCredentials({ contextId, namespace: 'forge', values: collectValues() })
      const ok = await load(contextId)
      if (ok) status = 'Code host saved.'
```

In `confirmClear()`, reorder to gate on the reload (it currently sets `status` before `await load(contextId)`):

```svelte
    if (ok) {
      pendingClear = false
      const reloaded = await load(contextId)
      if (reloaded) status = 'Code host credentials cleared.'
    }
```

- [ ] **Step 4: Replace the status block + field rows in the template**

Replace everything from `{#if error !== null}<p class="status-error">{error}</p>{/if}` down through the closing `</div>` of `.settings-byok-fields` (i.e. the current lines rendering status, the loading/`{:else if currentData !== null}` chain, the `{#each}` rows, and the `.settings-field__actions` block) with:

```svelte
  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your token to repair this context.</p>
    {/if}

    <div class="settings-byok-fields">
      {#each fields as field (field.key)}
        {#if shouldShowField(field)}
          <SettingsFieldShell
            label={field.label}
            required={field.required}
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
                  onchange={(e) => updateDraft(field.key, (e.currentTarget as HTMLSelectElement).value)}
                  class="coding-select">
                  {#each field.options ?? [] as opt (opt)}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {:else}
                <Input
                  type={field.sensitive ? 'password' : 'text'}
                  value={drafts[field.key] ?? ''}
                  placeholder={field.sensitive ? 'enter a new value' : ''}
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

      <div class="settings-field__actions">
        {#if currentData.configured}
          <Btn
            variant="ghost"
            size="sm"
            testid="code-host-clear"
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
          testid="code-host-save"
          disabled={!formDirty || saving || loading || clearing}
          onClick={() => void saveAll()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}
```

- [ ] **Step 5: Trim CSS**

Replace CodeHostSection's `<style>` block with:

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

- [ ] **Step 6: Run the suite**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/code-host-section.test.ts`
Expected: ALL CodeHostSection tests pass (existing incl. the updated "omits untouched token" + the 5 new). The `changing the kind select does not PATCH` and `saving a self-hosted forge persists…` tests still pass (they change fields before/without asserting Save-disabled).

- [ ] **Step 7: Commit**

```bash
git add client/settings/sections/CodeHostSection.svelte tests/client/settings/code-host-section.test.ts
git commit -m "feat(settings): CodeHostSection shell rows, ErrorState, roles, dirty-state, reload-safe save"
```

---

## Task 3: AdminPluginsConfigSection — shell migration + save-fix + tests

**Files:**

- Modify: `client/settings/sections/admin/AdminPluginsConfigSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`

- [ ] **Step 1: Add failing tests**

Add inside `describe('AdminPluginsConfigSection', …)` in `tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`:

```typescript
test('Save is disabled until the key input is non-empty', async () => {
  setMockFetch(() => Promise.resolve(json(snapshotPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminPluginsConfigSection, { target })
  await drain()
  const save = target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-save-my-plugin-api_key"]')!
  expect(save.disabled).toBe(true)
  const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-api_key"]')!
  input.value = 'x'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  expect(save.disabled).toBe(false)
  void unmount(component)
})

test('the required badge still renders and there is no redundant Field sub-label', async () => {
  setMockFetch(() => Promise.resolve(json(snapshotPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminPluginsConfigSection, { target })
  await drain()
  expect(target.querySelector('.badge-required')).not.toBeNull()
  expect(target.querySelector('.ui-field__label')).toBeNull()
  void unmount(component)
})

test('a save error is announced via role="alert"', async () => {
  setCsrfToken('c')
  setMockFetch(patchErrorMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminPluginsConfigSection, { target })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-api_key"]')!
  input.value = 'bad-value'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-save-my-plugin-api_key"]')!.click()
  await drain()
  expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
  void unmount(component)
})

test('a save whose reload fails shows no success line', async () => {
  setCsrfToken('c')
  let getCount = 0
  setMockFetch((url, init) => {
    if (url.includes('/admin/plugin-config') && init.method === 'PATCH')
      return Promise.resolve(json({ ok: true, pluginId: 'my-plugin', key: 'api_key', updatedAt: 1 }))
    getCount++
    return getCount === 1
      ? Promise.resolve(json(snapshotPayload))
      : Promise.resolve(new Response('reload failed', { status: 500 }))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(AdminPluginsConfigSection, { target })
  await drain()
  const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-api_key"]')!
  input.value = 'new-secret'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-save-my-plugin-api_key"]')!.click()
  await drain()
  await drain()
  expect(target.querySelector('p[role="status"]')).toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`
Expected: dirty-state, double-label (`.ui-field__label` present pre-migration), role=alert (no `role` yet), and reload-fail tests FAIL.

- [ ] **Step 3: Update `<script>` — imports, `load()` boolean, gate `save()`/`confirmClear()`**

In `client/settings/sections/admin/AdminPluginsConfigSection.svelte`: remove `import Field from '../../../shared/ui/Field.svelte'`. Add:

```svelte
  import SettingsFieldShell from '../../components/SettingsFieldShell.svelte'
```

Change `load()` to return boolean:

```svelte
  async function load(): Promise<boolean> {
    error = null
    status = null
    loading = true
    try {
      plugins = (await fetchAdminPluginConfig()).plugins
      return true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      loading = false
    }
  }
```

In `save()`, gate the status (keep the `drafts[dk] = ''` reset before the reload):

```svelte
      await patchAdminPluginConfig({ pluginId, key, value })
      drafts[dk] = ''
      const ok = await load()
      if (ok) status = `${pluginId} / ${key} updated.`
```

In `confirmClear()`, gate the status:

```svelte
    if (ok) {
      pendingClear = null
      const reloaded = await load()
      if (reloaded) status = `${p.pluginId} / ${p.key} cleared.`
    }
```

- [ ] **Step 4: Add roles to the status lines**

Replace:

```svelte
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}
```

with:

```svelte
  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}
```

- [ ] **Step 5: Migrate the key row to the shell**

Replace the `<div class="settings-field" …>…</div>` block (the per-key card, from `<div class="settings-field"` through its closing `</div>` that ends the card — including the `<div class="settings-field__head">` and the `<Field label="New value">…</Field>`) with:

```svelte
          <SettingsFieldShell
            label={keyState.label}
            testid={`plugin-config-key-${plugin.pluginId}-${keyState.key}`}>
            {#snippet head()}
              {#if keyState.value !== null}
                <Secret value={keyState.value} />
              {:else}
                <span class="placeholder">unset</span>
              {/if}
              {#if keyState.required}<span class="badge-required">required</span>{/if}
            {/snippet}
            {#snippet editor()}
              <Input
                type={keyState.sensitive ? 'password' : 'text'}
                value={drafts[draftKey(plugin.pluginId, keyState.key)] ?? ''}
                placeholder="enter a new value"
                onInput={(v) => (drafts[draftKey(plugin.pluginId, keyState.key)] = v)}
                testid={`plugin-config-input-${plugin.pluginId}-${keyState.key}`} />
              <Btn
                variant="primary"
                size="sm"
                testid={`plugin-config-save-${plugin.pluginId}-${keyState.key}`}
                disabled={(drafts[draftKey(plugin.pluginId, keyState.key)] ?? '').trim() === ''}
                onClick={() => void save(plugin.pluginId, keyState.key)}>
                {#snippet children()}Save{/snippet}
              </Btn>
              {#if keyState.value !== null}
                <Btn
                  variant="ghost"
                  size="sm"
                  testid={`plugin-config-clear-${plugin.pluginId}-${keyState.key}`}
                  onClick={() => {
                    pendingClear = { pluginId: plugin.pluginId, key: keyState.key, required: keyState.required }
                    clearError = null
                  }}>
                  {#snippet children()}Clear{/snippet}
                </Btn>
              {/if}
            {/snippet}
          </SettingsFieldShell>
```

- [ ] **Step 6: Trim CSS**

In the `<style>` block, delete the `.settings-field`, `.settings-field__head`, `.settings-field__label`, and `.settings-field__editor-row` rules. Keep `.plugin-block`, `.plugin-block__id`, `.settings-field-list`, and `.badge-required`:

```svelte
<style>
  .plugin-block {
    margin-bottom: 16px;
  }
  .plugin-block__id {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg2);
    margin: 0 0 8px 0;
  }
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
  .badge-required {
    font-size: 10px;
    color: var(--fg2);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 2px;
  }
</style>
```

- [ ] **Step 7: Run the suite**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`
Expected: ALL AdminPluginsConfigSection tests pass (existing + 4 new). The existing "renders masked value via Secret and editor via Field/Input/Btn" test still passes (it asserts `.ui-secret`, `.ui-input`, and the save `.ui-btn` — none of which the migration removes; only the `Field` wrapper/`.ui-field` is gone, which it does not assert).

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/admin/AdminPluginsConfigSection.svelte tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts
git commit -m "feat(settings): AdminPluginsConfigSection shell rows, roles, dirty-state, reload-safe save"
```

---

## Task 4: Visual re-baseline + full check

**Files:** `.storybook-shots/**` (gitignored — not committed)

- [ ] **Step 1: Ensure Storybook is running**

Storybook must be up at `http://localhost:6006` (`bun storybook` in another terminal if not).

- [ ] **Step 2: Re-baseline the two migrated sections**

Run: `bun shoot -g CodeHostSection` then `bun shoot -g AdminPluginsConfigSection`
Read a populated PNG from each under `.storybook-shots/settings/sections/…` and confirm the intended diffs: no `New value`/`Value` sub-label; CodeHost required fields show an accent `*`; AdminPluginsConfig keeps its `required` badge (no asterisk); rounded `2px` card corners; AdminPluginsConfig editor row alignment shifted to bottom (`align-items: end`). No layout breakage. If a screenshot shows a real defect (not an intended diff), STOP and report it rather than proceeding.

- [ ] **Step 3: Full check + affected suites**

Run: `bun run check` — expect lint/typecheck/format/license all pass; fix any surfaced issue (e.g. an unused import) without suppressions.
Then run the affected client suites together:
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/byok-section.test.ts tests/client/settings/coding-credentials-section.test.ts tests/client/settings/code-host-section.test.ts tests/client/settings/sections/admin/AdminPluginsConfigSection.test.ts`
Expected: all pass (ignore the 2 known MemorySection flakes if the runner surfaces them).

- [ ] **Step 4: Commit (only if `bun run check` changed tracked files)**

`.storybook-shots/` is gitignored, so there is normally nothing to commit here. If `bun run check` reformatted a tracked file, commit that:

```bash
git add -A
git commit -m "chore(settings): formatting after field-shell consolidation follow-ups"
```

Otherwise report that no commit was needed.

---

## Self-review — spec coverage

- **Part A — CodeHost migration** → Task 2 (shell rows, ErrorState+retry, roles, whole-record dirty-state, CSS trim). ✅
- **Part A — AdminPluginsConfig migration** → Task 3 (shell rows, kept badge, single label, per-field dirty-state, roles, CSS trim). ✅
- **Part B — reload-fail suppression** → Task 1 (Byok, Coding), Task 2 (CodeHost), Task 3 (AdminPluginsConfig); `load()`→boolean + gated status + `confirmClear` reorder. ✅
- **Part C — tests** → reload-fail tests (all four sections), CodingCredentials `role="alert"`, CodeHost + AdminPluginsConfig dirty/role/double-label tests, updated the conflicting CodeHost "omits untouched token" test. ✅
- **Visual re-baseline** → Task 4. ✅

**Type/name consistency:** `load()` is `Promise<boolean>` in every edited section; success status is set only under `if (ok)` / `if (reloaded)`; `formDirty` (whole-record: CodeHost) and the per-field blank-check (AdminPluginsConfig) match their call sites; double-label-gone is asserted via the absence of `.ui-field__label`. No placeholders remain.
