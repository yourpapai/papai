<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Robustness — Workstream A: `Select` disabled prop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shared `Select` primitive a `disabled` prop and lock the Select-based controls in the four settings sections that mutate, while a save is in flight.

**Architecture:** Add `disabled?: boolean` to `client/shared/ui/Select.svelte` (mirroring `Btn`'s existing `disabled` prop + `:disabled` style), then bind it to each section's in-flight state flag. One new admin section needs a `creating` flag added because its create flow has none.

**Tech Stack:** Svelte 5 runes; TypeScript (strict, `.js` import extensions); Bun test runner with Svelte `mount` + happy-dom for client DOM tests; `oxfmt`/`oxlint`.

**Spec:** [`../specs/2026-07-07-settings-section-robustness-design.md`](../specs/2026-07-07-settings-section-robustness-design.md) (Workstream A)

**Client tests run with:** `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>` (plain `bun test` skips client tests). Full client suite: `bun run test:client`. Two pre-existing `MemorySection` failures on `master` are unrelated and out of scope.

---

## File Structure

| File                                                           | Responsibility                                 | Change |
| -------------------------------------------------------------- | ---------------------------------------------- | ------ |
| `client/shared/ui/Select.svelte`                               | Add `disabled` prop + disabled style           | Modify |
| `tests/client/shared/ui/Select.test.ts`                        | Cover the new prop                             | Modify |
| `client/settings/sections/CodingIdentitySection.svelte`        | Lock its 2 Selects while `saving`              | Modify |
| `client/settings/sections/GroupProviderSection.svelte`         | Lock its Select while `saving`                 | Modify |
| `client/settings/sections/TaskProviderSection.svelte`          | Lock its Select while `binding`                | Modify |
| `client/settings/sections/admin/AdminInstancesSection.svelte`  | Add `creating` flag; lock its 2 create Selects | Modify |
| `tests/client/settings/sections/CodingIdentitySection.test.ts` | Assert Select disabled while saving            | Modify |
| `tests/client/settings/sections/GroupProviderSection.test.ts`  | Assert Select disabled while saving            | Modify |
| `tests/client/settings/sections/TaskProviderSection.test.ts`   | Assert Select disabled while binding           | Modify |

---

## Task 1: Add `disabled` to the shared `Select`

**Files:**

- Modify: `client/shared/ui/Select.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe('Select.svelte', …)` block in `tests/client/shared/ui/Select.test.ts`:

```typescript
test('applies the disabled attribute and disabled class when disabled', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Select, {
    target,
    props: {
      value: 'a',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
      disabled: true,
      testid: 'sel',
    },
  })
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="sel"]')!
  expect(sel.disabled).toBe(true)
  expect(target.querySelector('.ui-select--disabled')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts`
Expected: FAIL — `sel.disabled` is `false` and `.ui-select--disabled` is null (prop not implemented).

- [ ] **Step 3: Implement the prop**

In `client/shared/ui/Select.svelte`:

Add `disabled` to the `Props` interface (currently `value/options/onChange/testid`):

```svelte
  interface Props {
    value: string
    options: Option[]
    onChange?: (value: string) => void
    testid?: string
    disabled?: boolean
  }

  let { value, options, onChange, testid, disabled = false }: Props = $props()
```

Bind it on the wrapper and the `<select>`:

```svelte
<div class="ui-select" class:ui-select--disabled={disabled}>
  <select {value} {disabled} onchange={handleChange} aria-labelledby={labelId} data-testid={testid}>
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <span class="ui-select__caret">▾</span>
</div>
```

Add the disabled visual state to the `<style>` block (mirrors `Btn.svelte:66`):

```css
.ui-select--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts`
Expected: PASS (all Select tests, including the 3 originals).

- [ ] **Step 5: Typecheck + format**

Run: `bun run typecheck` (expect clean) then `bun run format`.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Select.svelte tests/client/shared/ui/Select.test.ts
git commit -m "feat(ui): add disabled prop to shared Select"
```

---

## Task 2: Lock `CodingIdentitySection` Selects while saving

**Files:**

- Modify: `client/settings/sections/CodingIdentitySection.svelte:121,126`
- Test: `tests/client/settings/sections/CodingIdentitySection.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('CodingIdentitySection', …)` block in `tests/client/settings/sections/CodingIdentitySection.test.ts` (reuses the file's existing `route`, `render`, `drain`, `submitForm`, `identity`, `membersPayload`, `ALICE` helpers):

```typescript
test('disables the policy Select while a save is in flight', async () => {
  setCsrfToken('t')
  setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE]), patch: 'never' }))
  const { target, component } = render()
  await drain()
  submitForm(target)
  flushSync()
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')!
  expect(sel.disabled).toBe(true)
  void unmount(component)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: FAIL — `sel.disabled` is `false` (not yet wired).

- [ ] **Step 3: Wire `disabled={saving}` on both Selects**

In `client/settings/sections/CodingIdentitySection.svelte`, add `disabled={saving}` to both `<Select>` calls (the `saving` state already exists at `:44`):

```svelte
        <Select value={policyKind} options={POLICY_OPTIONS} onChange={onPolicyChange} disabled={saving} testid="coding-identity-policy" />
```

```svelte
          <Select value={designatedUserId} options={memberOptions} onChange={onMemberChange} disabled={saving} testid="coding-identity-member" />
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/CodingIdentitySection.svelte tests/client/settings/sections/CodingIdentitySection.test.ts
git commit -m "fix(settings): lock CodingIdentity Selects during save"
```

---

## Task 3: Lock `GroupProviderSection` Select while saving

**Files:**

- Modify: `client/settings/sections/GroupProviderSection.svelte:91`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

Read the top of `tests/client/settings/sections/GroupProviderSection.test.ts` to reuse its helpers (`json`, `drain`, `payload`, `capturePatchMock`, and its `render`/mount pattern — it uses a `payload` const and a `capturePatchMock`). Append a test that drives a never-resolving PATCH and asserts the Select is disabled. Model (adjust helper names to the ones the file actually defines — read it first):

```typescript
test('disables the task-instance Select while a save is in flight', async () => {
  setCsrfToken('t')
  setMockFetch((url: string, init: RequestInit) => {
    if (init.method === 'PATCH') return new Promise<Response>(() => {})
    return Promise.resolve(json(payload))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target
    .querySelector<HTMLFormElement>('form.settings-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  flushSync()
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
  expect(sel.disabled).toBe(true)
  void unmount(component)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — `sel.disabled` is `false`.

- [ ] **Step 3: Wire `disabled={saving}`**

In `client/settings/sections/GroupProviderSection.svelte`, the `<Select>` at `:91` currently reads:

```svelte
          <Select
            value={selected}
            options={data.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
            onChange={(v) => (selected = v)}
            testid="group-task-instance" />
```

Add `disabled={saving}` (the `saving` state exists at `:29`):

```svelte
          <Select
            value={selected}
            options={data.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
            onChange={(v) => (selected = v)}
            disabled={saving}
            testid="group-task-instance" />
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "fix(settings): lock GroupProvider Select during save"
```

---

## Task 4: Lock `TaskProviderSection` Select while binding

**Files:**

- Modify: `client/settings/sections/TaskProviderSection.svelte:126`
- Test: `tests/client/settings/sections/TaskProviderSection.test.ts`

- [ ] **Step 1: Write the failing test**

Read `tests/client/settings/sections/TaskProviderSection.test.ts` for its helpers/payload, then append a test that drives a never-resolving PATCH to `/context/task-instance` and asserts the Select (`testid="context-task-instance"`) is disabled. Model (adapt payload/mock to the file's existing shape):

```typescript
test('disables the instance Select while a bind is in flight', async () => {
  setCsrfToken('t')
  setMockFetch((url: string, init: RequestInit) => {
    if (init.method === 'PATCH') return new Promise<Response>(() => {})
    // return the file's existing loaded fixtures for config + context-task-instance GETs
    return Promise.resolve(json(/* the file's loaded instance payload */))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(TaskProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target
    .querySelector<HTMLFormElement>('form.settings-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  flushSync()
  const sel = target.querySelector<HTMLSelectElement>('[data-testid="context-task-instance"]')!
  expect(sel.disabled).toBe(true)
  void unmount(component)
})
```

> Note: `TaskProviderSection.load()` fetches BOTH config and context-task-instance in a `Promise.all`; the mock must return valid JSON for both GETs so the form renders. Read the existing test file — it already builds these fixtures; reuse them rather than inventing new ones.

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: FAIL — `sel.disabled` is `false`.

- [ ] **Step 3: Wire `disabled={binding}`**

In `client/settings/sections/TaskProviderSection.svelte`, the `<Select>` at `:126` currently reads:

```svelte
              <Select
                value={selectedInstanceId}
                options={instanceData.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
                onChange={(v) => (selectedInstanceId = v)}
                testid="context-task-instance" />
```

Add `disabled={binding}` (the `binding` state exists at `:39`):

```svelte
              <Select
                value={selectedInstanceId}
                options={instanceData.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
                onChange={(v) => (selectedInstanceId = v)}
                disabled={binding}
                testid="context-task-instance" />
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, format, commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "fix(settings): lock TaskProvider Select during bind"
```

---

## Task 5: Add a `creating` flag to `AdminInstancesSection` and lock its create Selects

`AdminInstancesSection` create flows (`createPlatform` `:133`, `createTask` `:148`) have no busy flag — only `loading`/`deleting`/`stopping` exist. Add a `creating` flag and bind it to the two create-form Selects.

**Files:**

- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte`

- [ ] **Step 1: Add the `creating` state and set it around both create calls**

Read `createPlatform` (`:133`) and `createTask` (`:148`). Add near the other boolean state (`:51`/`:56`):

```svelte
  let creating = $state(false)
```

Wrap each create body in `creating = true` / `finally { creating = false }`, mirroring how `deleting`/`stopping` are used elsewhere in the file. For example `createPlatform` becomes:

```svelte
  async function createPlatform(): Promise<void> {
    creating = true
    try {
      // …existing body (create call + await load())…
    } finally {
      creating = false
    }
  }
```

Do the same for `createTask`.

- [ ] **Step 2: Wire `disabled={creating}` on both create Selects**

`:311` (platform type):

```svelte
          <Select value={platformType} options={platformTypes.map((t) => ({ value: t.type, label: t.displayName }))} onChange={(v) => (platformType = v)} disabled={creating} />
```

`:365` (task type):

```svelte
          <Select value={taskType} options={taskTypes.map((t) => ({ value: t.type, label: t.displayName }))} onChange={(v) => (taskType = v)} disabled={creating} />
```

- [ ] **Step 3: Typecheck + format**

Run: `bun run typecheck` (expect clean) then `bun run format`.

- [ ] **Step 4: Verify the admin test suite still passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/` (or the full `bun run test:client`).
Expected: no new failures (only the 2 pre-existing `MemorySection` failures). AdminInstances has no dedicated section test today; this task is a low-risk enhancement covered by typecheck + suite-green. If `tests/client/settings/admin/` contains an AdminInstances test, add a `disabled`-during-create assertion mirroring Task 2.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminInstancesSection.svelte
git commit -m "fix(settings): add creating flag and lock AdminInstances create Selects"
```

---

## Final verification

- [ ] Run `bun run test:client` — only the 2 pre-existing `MemorySection` failures remain.
- [ ] Run `bun run typecheck` — clean.
- [ ] `git status --short` — clean (all tasks committed).
