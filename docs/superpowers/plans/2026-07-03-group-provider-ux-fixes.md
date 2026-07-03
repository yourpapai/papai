<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# GroupProviderSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every finding in the `GroupProviderSection` UX review by fixing shared UI primitives, adding a friendly instance label, and closing the section's state-handling gaps — converging its behavior with the sibling `TaskProviderSection`.

**Architecture:** Three layers, most-shared first. (A) Shared client primitives: a typed `FetchError` + a pure `formatFetchError` mapper, `Field` label association via Svelte context consumed by `Input`/`Select`, and a `:focus-within` ring on both controls. (B) One optional schema field surfaced from already-decrypted server config (`config.baseUrl`) — no DB migration. (C) The two consuming sections adopt the friendly label and (GroupProvider only) the missing loading/empty/busy/error affordances.

**Tech Stack:** Svelte 5 (runes, `mount`/`flushSync`), TypeScript, Zod v4, Bun test runner (`bun:test`), MSW story fixtures, Playwright/`@crvy/strybk` Storybook screenshots.

**Design spec:** [`docs/superpowers/specs/2026-07-03-group-provider-ux-fixes-design.md`](../specs/2026-07-03-group-provider-ux-fixes-design.md)

**Conventions for this plan:**

- Import paths use the `.js` extension (repo rule), even for `.ts`/`.svelte` sources.
- Run a single client test file with:
  `bun --conditions=browser test --preload ./tests/client-setup.ts <path>`
- Run a single server test file with: `bun test <path>`
- Typecheck with `bun run typecheck`; format with `bun run format` (oxfmt).
- Every new file needs the 4-line BUSL license header (copy from any sibling file).

---

## Task 1: Typed `FetchError` thrown by `requireOk`

**Files:**

- Modify: `client/shared/fetcher-helpers.ts:23-26`
- Test: `tests/client/shared/fetcher-helpers.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe('fetcher-helpers', …)` block in `tests/client/shared/fetcher-helpers.test.ts` (and add `FetchError` to the import on line 8):

```ts
test('requireOk throws a FetchError carrying the HTTP status', () => {
  const res = new Response(null, { status: 404 })
  try {
    requireOk(res, { error: 'missing' })
    throw new Error('expected requireOk to throw')
  } catch (err) {
    expect(err).toBeInstanceOf(FetchError)
    expect((err as FetchError).status).toBe(404)
    expect((err as FetchError).message).toBe('missing')
  }
})

test('requireOk FetchError falls back to a status message when no body error', () => {
  const res = new Response(null, { status: 503 })
  try {
    requireOk(res, null)
    throw new Error('expected requireOk to throw')
  } catch (err) {
    expect((err as FetchError).status).toBe(503)
    expect((err as FetchError).message).toBe('request failed with status 503')
  }
})
```

Update the import line to:

```ts
import { errorMessageFrom, FetchError, readBody, requireOk } from '../../../client/shared/fetcher-helpers.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/shared/fetcher-helpers.test.ts`
Expected: FAIL — `FetchError` is not exported.

- [ ] **Step 3: Implement `FetchError` and throw it from `requireOk`**

In `client/shared/fetcher-helpers.ts`, add the class above `requireOk` and update `requireOk`:

```ts
export class FetchError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'FetchError'
    this.status = status
  }
}

export const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new FetchError(res.status, errorMessageFrom(body, `request failed with status ${res.status}`))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/shared/fetcher-helpers.test.ts`
Expected: PASS (existing `.toThrow('server error')` / `.toThrow('bad request')` tests still pass — the message is unchanged).

- [ ] **Step 5: Typecheck & commit**

```bash
bun run typecheck
git add client/shared/fetcher-helpers.ts tests/client/shared/fetcher-helpers.test.ts
git commit -m "feat(client): FetchError carries HTTP status from requireOk"
```

---

## Task 2: `formatFetchError` plain-language mapper

**Files:**

- Create: `client/shared/format-error.ts`
- Test: `tests/client/shared/format-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/format-error.test.ts` (with the BUSL header):

```ts
import { describe, expect, test } from 'bun:test'

import { FetchError } from '../../../client/shared/fetcher-helpers.js'
import { formatFetchError } from '../../../client/shared/format-error.js'

describe('formatFetchError', () => {
  test('401 and 403 map to an expired-link message', () => {
    const msg = 'Your settings link may have expired. Send /config to the bot for a new one.'
    expect(formatFetchError(new FetchError(401, 'x'))).toBe(msg)
    expect(formatFetchError(new FetchError(403, 'x'))).toBe(msg)
  })

  test('404 maps to a not-found message', () => {
    expect(formatFetchError(new FetchError(404, 'x'))).toBe('Not found — it may have been removed.')
  })

  test('validation statuses pass the server message through', () => {
    expect(formatFetchError(new FetchError(400, 'bad field'))).toBe('bad field')
    expect(formatFetchError(new FetchError(409, 'conflict'))).toBe('conflict')
    expect(formatFetchError(new FetchError(422, 'invalid request'))).toBe('invalid request')
  })

  test('5xx maps to a generic server message', () => {
    const msg = 'Something went wrong on the server. Try again shortly.'
    expect(formatFetchError(new FetchError(500, 'boom'))).toBe(msg)
    expect(formatFetchError(new FetchError(503, 'down'))).toBe(msg)
  })

  test('a non-FetchError (network failure) maps to a connection message', () => {
    expect(formatFetchError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
  })

  test('an unmapped status passes the underlying message through', () => {
    expect(formatFetchError(new FetchError(418, 'teapot'))).toBe('teapot')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/shared/format-error.test.ts`
Expected: FAIL — `client/shared/format-error.js` does not exist.

- [ ] **Step 3: Implement the mapper**

Create `client/shared/format-error.ts` (with the BUSL header):

```ts
import { FetchError } from './fetcher-helpers.js'

/**
 * Maps a thrown settings-API error to a short, plain-language message for the UI.
 * Validation-class statuses (400/409/422) keep the server's specific text; other
 * classes get a canned message. Non-FetchError throws are treated as connectivity
 * failures.
 */
export function formatFetchError(err: unknown): string {
  if (!(err instanceof FetchError)) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  const { status } = err
  if (status === 401 || status === 403) {
    return 'Your settings link may have expired. Send /config to the bot for a new one.'
  }
  if (status === 404) return 'Not found — it may have been removed.'
  if (status === 400 || status === 409 || status === 422) return err.message
  if (status >= 500) return 'Something went wrong on the server. Try again shortly.'
  return err.message
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/shared/format-error.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Typecheck & commit**

```bash
bun run typecheck
git add client/shared/format-error.ts tests/client/shared/format-error.test.ts
git commit -m "feat(client): formatFetchError plain-language error mapper"
```

---

## Task 3: `Field` label association via Svelte context

**Files:**

- Create: `client/shared/ui/field-context.ts`
- Modify: `client/shared/ui/Field.svelte`
- Modify: `client/shared/ui/Select.svelte:26-27`
- Modify: `client/shared/ui/Input.svelte:40-46`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts` (integration assertion)

- [ ] **Step 1: Write the failing integration test**

Append to the `describe('GroupProviderSection', …)` block in
`tests/client/settings/sections/GroupProviderSection.test.ts`:

```ts
test('associates the Select with its Field label via aria-labelledby', async () => {
  setMockFetch(capturePatchMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
  const labelledby = select.getAttribute('aria-labelledby')
  expect(labelledby).toBeTruthy()
  const label = target.querySelector(`#${labelledby}`)
  expect(label?.textContent).toContain('Task instance')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — `aria-labelledby` is null (no association yet).

- [ ] **Step 3: Create the context module**

Create `client/shared/ui/field-context.ts` (with the BUSL header):

```ts
import { getContext, setContext } from 'svelte'

const FIELD_LABEL_ID = Symbol('field-label-id')

/** Called by Field during init to publish its label element id to descendant controls. */
export function setFieldLabelId(id: string): void {
  setContext(FIELD_LABEL_ID, id)
}

/** Called by Input/Select during init; returns the enclosing Field's label id, if any. */
export function getFieldLabelId(): string | undefined {
  return getContext(FIELD_LABEL_ID) as string | undefined
}
```

- [ ] **Step 4: Field generates an id, labels its span, publishes the id**

In `client/shared/ui/Field.svelte`, add a module block above the existing instance
`<script lang="ts">` and wire the id. Full new script region:

```svelte
<script module lang="ts">
  let seq = 0
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'

  import { setFieldLabelId } from './field-context.js'

  interface Props {
    label: string
    children: Snippet
    required?: boolean
    hint?: string
  }

  let { label, children, required = false, hint }: Props = $props()

  const labelId = `ui-field-${++seq}`
  setFieldLabelId(labelId)
</script>
```

Then give the label span the id (change line ~20):

```svelte
  <span class="ui-field__label" id={labelId}>
    {label}{#if required}<span class="ui-field__req">*</span>{/if}
  </span>
```

- [ ] **Step 5: Select consumes the id**

In `client/shared/ui/Select.svelte`, import the getter and apply the attribute.
Add to the instance script:

```ts
import { getFieldLabelId } from './field-context.js'

const labelId = getFieldLabelId()
```

Change the `<select>` tag (line ~27) to:

```svelte
    <select {value} onchange={handleChange} aria-labelledby={labelId} data-testid={testid}>
```

- [ ] **Step 6: Input consumes the id (both branches)**

In `client/shared/ui/Input.svelte`, add to the instance script:

```ts
import { getFieldLabelId } from './field-context.js'

const labelId = getFieldLabelId()
```

Change the `<textarea>` (line ~41) and `<input>` (line ~46) tags to include `aria-labelledby={labelId}`:

```svelte
    <textarea {placeholder} {value} {readonly} {rows} aria-labelledby={labelId} data-testid={testid} oninput={handleInput}></textarea>
```

```svelte
    <input {type} {placeholder} {value} {readonly} aria-labelledby={labelId} data-testid={testid} oninput={handleInput} />
```

(When there is no enclosing `Field`, `labelId` is `undefined` and Svelte omits the attribute.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS. Then run the shared UI suite to confirm no regression:
`bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/shared/ui`
Expected: PASS.

- [ ] **Step 8: Typecheck & commit**

```bash
bun run typecheck
git add client/shared/ui/field-context.ts client/shared/ui/Field.svelte client/shared/ui/Select.svelte client/shared/ui/Input.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "feat(ui): associate Field label with Input/Select via context (aria-labelledby)"
```

---

## Task 4: Keyboard focus ring on `Input` and `Select`

**Files:**

- Modify: `client/shared/ui/Input.svelte` (style block)
- Modify: `client/shared/ui/Select.svelte` (style block)
- Verify: Storybook screenshot (no unit test — focus ring is a visual/CSS concern)

- [ ] **Step 1: Add the `:focus-within` ring to `.ui-input`**

In `client/shared/ui/Input.svelte`, add to the `<style>` block, immediately after the
`.ui-input { … }` rule:

```css
.ui-input:focus-within {
  outline: 2px solid rgba(82, 224, 138, 0.4);
  outline-offset: 1px;
}
```

- [ ] **Step 2: Add the `:focus-within` ring to `.ui-select`**

In `client/shared/ui/Select.svelte`, add to the `<style>` block, immediately after the
`.ui-select { … }` rule:

```css
.ui-select:focus-within {
  outline: 2px solid rgba(82, 224, 138, 0.4);
  outline-offset: 1px;
}
```

(These match the ring `Btn.svelte:74-77` already uses.)

- [ ] **Step 3: Capture the focused-state screenshot**

Ensure Storybook is running (`bun storybook`). The manual focus state already exists in
`tests/visual/settings/sections/GroupProviderSection.spec.ts` ("select focused"). Re-shoot:

Run: `bun shoot -g GroupProviderSection`
Expected: all shots pass; the `GroupProviderSection-—-select-focused-1.png` baseline is rewritten.

- [ ] **Step 4: Verify the ring renders**

Read `.storybook-shots/settings/sections/GroupProviderSection.spec.ts/GroupProviderSection-—-select-focused-1.png`
and confirm a green focus outline is now visible around the select (it was absent in the review).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Input.svelte client/shared/ui/Select.svelte
git commit -m "feat(ui): add keyboard focus-within ring to Input and Select"
```

---

## Task 5: Add optional `name` to the task-instance option schema

**Files:**

- Modify: `client/settings/fetcher-schemas.ts:187`
- Test: `tests/client/settings/fetcher-schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/settings/fetcher-schemas.test.ts` (import
`TaskInstanceOptionSchema` from `../../../client/settings/fetcher-schemas.js` if not already
imported):

```ts
test('TaskInstanceOptionSchema accepts an optional name', () => {
  expect(TaskInstanceOptionSchema.parse({ id: 'i', type: 'kaneo', status: 'active' }).name).toBeUndefined()
  expect(
    TaskInstanceOptionSchema.parse({ id: 'i', type: 'kaneo', status: 'active', name: 'https://k.example' }).name,
  ).toBe('https://k.example')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts`
Expected: FAIL — `.name` is stripped (unknown key) so the second assertion is `undefined`, or the symbol is not imported.

- [ ] **Step 3: Add the field**

In `client/settings/fetcher-schemas.ts`, change line 187 to:

```ts
export const TaskInstanceOptionSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  name: z.string().optional(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/fetcher-schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck & commit**

```bash
bun run typecheck
git add client/settings/fetcher-schemas.ts tests/client/settings/fetcher-schemas.test.ts
git commit -m "feat(settings): add optional name to TaskInstanceOptionSchema"
```

---

## Task 6: Surface `config.baseUrl` as the option `name` on both routes

**Files:**

- Modify: `src/debug/settings/group-routes.ts:180-182`
- Modify: `src/debug/settings/context-task-instance-routes.ts:36-40`
- Test: `tests/debug/settings/context-task-instance-routes.test.ts`
- Test: `tests/debug/settings/group-routes.test.ts`

- [ ] **Step 1: Write the failing server test (context route)**

In `tests/debug/settings/context-task-instance-routes.test.ts`, first extend the local
`TaskInstanceGetSchema` (line 27-32) so `available` allows `name`:

```ts
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string().optional() })),
```

Then add a test inside `describe('settings context task-instance routes', …)`:

```ts
test('GET surfaces config.baseUrl as the option name', async () => {
  insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { baseUrl: 'https://kaneo.example' }, status: 'active' })
  insertTaskInstance({ id: 'bare', type: 'youtrack', config: {}, status: 'active' })
  const url = getReq(session)
  const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
  const body = TaskInstanceGetSchema.parse(await res.json())
  const byId = Object.fromEntries(body.available.map((a) => [a.id, a]))
  expect(byId['kaneo-a']?.name).toBe('https://kaneo.example')
  expect(byId['bare']?.name).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/context-task-instance-routes.test.ts`
Expected: FAIL — `name` is `undefined` for `kaneo-a`.

- [ ] **Step 3: Include `name` in the context route options**

In `src/debug/settings/context-task-instance-routes.ts`, change `listActiveTaskInstanceOptions`
(lines 36-40) to:

```ts
/** Active task instances offered as binding targets; unreadable rows are excluded. */
function listActiveTaskInstanceOptions(): { id: string; type: string; status: string; name?: string }[] {
  return listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstance.config.baseUrl,
    }))
}
```

- [ ] **Step 4: Include `name` in the group route options**

In `src/debug/settings/group-routes.ts`, change the `available` map (lines 180-182) to:

```ts
const available = listTaskInstancesSafe()
  .instances.filter((taskInstance) => taskInstance.status === 'active')
  .map((taskInstance) => ({
    id: taskInstance.id,
    type: taskInstance.type,
    status: taskInstance.status,
    name: taskInstance.config.baseUrl,
  }))
```

- [ ] **Step 5: Add the group-route server test**

In `tests/debug/settings/group-routes.test.ts`, extend the local `TaskInstanceGetSchema`
(line 43) so `available` allows `name`:

```ts
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string().optional() })),
```

Then add a test inside the same `describe` block, modeled on the existing
`'task-instance GET only lists active task instances'` test (lines 316-331):

```ts
test('task-instance GET surfaces config.baseUrl as the option name', async () => {
  const contextId = seedManageableGroup()
  insertTaskInstance({ id: 'ti-active', type: 'kaneo', config: { baseUrl: 'https://kaneo.example' }, status: 'active' })

  const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
  const res = await handleGroupRoutes(
    new Request(getUrl, { headers: authHeaders(session) }),
    getUrl,
    '/settings/api/group/task-instance',
  )

  expect(res.status).toBe(200)
  const body = TaskInstanceGetSchema.parse(await res.json())
  expect(body.available).toEqual([{ id: 'ti-active', type: 'kaneo', status: 'active', name: 'https://kaneo.example' }])
})
```

Note the existing `toEqual([{ id, type, status }])` assertions on empty-`config` instances still
pass — `config.baseUrl` is `undefined` there, so `JSON.stringify` omits the `name` key entirely.

- [ ] **Step 6: Run both server test files to verify they pass**

Run: `bun test tests/debug/settings/context-task-instance-routes.test.ts tests/debug/settings/group-routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck & commit**

```bash
bun run typecheck
git add src/debug/settings/context-task-instance-routes.ts src/debug/settings/group-routes.ts tests/debug/settings/context-task-instance-routes.test.ts tests/debug/settings/group-routes.test.ts
git commit -m "feat(settings): expose instance baseUrl as option name in task-instance pickers"
```

---

## Task 7: `GroupProviderSection` — friendly label + state affordances

**Files:**

- Modify: `client/settings/sections/GroupProviderSection.svelte`
- Test: `tests/client/settings/sections/GroupProviderSection.test.ts`

- [ ] **Step 1: Update the empty-state test and add load-error + busy tests**

In `tests/client/settings/sections/GroupProviderSection.test.ts`:

(a) Change the empty-state assertion (currently line 123) to the new copy:

```ts
expect(target.textContent).toContain('No active task instances available. Ask an admin to create one.')
```

(b) Add a load-error test:

```ts
test('a failed load shows an error state with a retry button and hides the form', async () => {
  setMockFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'nope' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
    ),
  )
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  expect(target.querySelector('.ui-error')).not.toBeNull()
  expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="group-task-instance"]')).toBeNull()
  void unmount(component)
})
```

(c) Add a busy-save test (deterministic via a pending PATCH):

```ts
test('disables and marks the Save button busy while saving', async () => {
  setCsrfToken('c')
  let releasePatch: (() => void) | undefined
  setMockFetch((url, init) => {
    if (url.includes('/group/task-instance') && init.method === 'PATCH') {
      return new Promise<Response>((resolve) => {
        releasePatch = () => resolve(json({ ok: true, contextId: 'group:7' }))
      })
    }
    return Promise.resolve(json(payload))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!.click()
  flushSync()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!
  expect(btn.disabled).toBe(true)
  expect(btn.classList.contains('ui-btn--busy')).toBe(true)
  expect(btn.textContent).toContain('Saving')
  releasePatch?.()
  await drain()
  expect(btn.disabled).toBe(false)
  void unmount(component)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: FAIL — new copy not present, `.ui-error` absent on load failure, Save not disabled/busy.

- [ ] **Step 3: Rewrite the section script for split load/save state + saving flag**

In `client/settings/sections/GroupProviderSection.svelte`, replace the imports/state and
`load`/`save` functions. New `<script>` body (keep the existing license header comments and
`interface Props`):

```svelte
<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import { fetchGroupTaskInstance, patchGroupTaskInstance } from '../fetchers.js'
  import type { GroupTaskInstanceResponse } from '../fetcher-schemas.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: GroupTaskInstanceResponse | null = $state(null)
  let selected = $state('')
  let loadError: unknown = $state(null)
  let saveError: unknown = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)

  async function load(id: string): Promise<void> {
    loadError = null
    saveError = null
    status = null
    loading = true
    try {
      const result = await fetchGroupTaskInstance(id)
      data = result
      const currentId = result.taskInstanceId
      selected =
        currentId !== null && result.available.some((a) => a.id === currentId)
          ? currentId
          : (result.available[0]?.id ?? '')
    } catch (err) {
      loadError = err
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    saveError = null
    status = null
    if (selected === '') return
    saving = true
    try {
      await patchGroupTaskInstance({ taskInstanceId: selected, contextId })
      await load(contextId)
      status = 'Task instance updated.'
    } catch (err) {
      saveError = err
    } finally {
      saving = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>
```

- [ ] **Step 4: Rewrite the section markup for error/loading/empty/busy + friendly label**

Replace the markup below `</script>` (the `<section …>` block, current lines 64-90) with:

```svelte
<section id="group-provider" class="settings-section">
  <PageHeader eyebrow="Group" title="Group task provider">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="group-provider-refresh" />
    {/snippet}
  </PageHeader>

  {#if loadError !== null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && data === null}
    <p class="placeholder">Loading…</p>
  {:else if data !== null}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    {#if saveError !== null}<p class="status-error">{formatFetchError(saveError)}</p>{/if}
    {#if data.available.length === 0}
      <p class="placeholder">No active task instances available. Ask an admin to create one.</p>
    {:else}
      <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
        <Field label="Task instance">
          <Select
            value={selected}
            options={data.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
            onChange={(v) => (selected = v)}
            testid="group-task-instance" />
        </Field>
        <Btn variant="primary" type="submit" disabled={saving} busy={saving} testid="group-task-instance-save">
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </form>
    {/if}
  {/if}
</section>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/GroupProviderSection.test.ts`
Expected: PASS — including the existing save/select tests, the updated empty copy, the new
load-error test, the busy-save test, and the Task-3 aria-labelledby test.

- [ ] **Step 6: Typecheck & commit**

```bash
bun run typecheck
git add client/settings/sections/GroupProviderSection.svelte tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "fix(settings): GroupProvider loading/empty/error/busy states + friendly instance label"
```

---

## Task 8: `TaskProviderSection` convergence

**Files:**

- Modify: `client/settings/sections/TaskProviderSection.svelte`
- Test: `tests/client/settings/sections/TaskProviderSection.test.ts`

- [ ] **Step 1: Route all three error paths through `formatFetchError` and adopt the friendly label**

In `client/settings/sections/TaskProviderSection.svelte`:

(a) Add the import near the other shared imports:

```ts
import { formatFetchError } from '../../shared/format-error.js'
```

(b) Change the three catch blocks to store the raw error instead of `.message`:

- line ~54: `error = err` (was `error = err instanceof Error ? err.message : String(err)`)
- line ~70: `bindError = err`
- line ~85: `provisionError = err`

Change the three state declarations to `unknown`:

- `let error: unknown = $state(null)`
- `let bindError: unknown = $state(null)`
- `let provisionError: unknown = $state(null)`

(c) Change the three render sites to format the error:

- `<ErrorState message={formatFetchError(error)} onRetry={() => void load(contextId)} />` (line ~112)
- `{#if bindError !== null}<p class="status-error">{formatFetchError(bindError)}</p>{/if}` (line ~118)
- `{#if provisionError !== null}<p class="status-error">{formatFetchError(provisionError)}</p>{/if}` (line ~159-160)

(d) Change the option label (line ~126-127) to prefer the name:

```ts
                options={instanceData.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
```

- [ ] **Step 2: Run the sibling tests to verify no regression**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/sections/TaskProviderSection.test.ts`
Expected: PASS. The existing tests assert `.ui-error` + `error-retry` presence (still rendered),
the empty hint text (unchanged), and select values (unchanged) — none assert raw error strings or
option label text, so they pass unchanged. If any assertion checks a raw message, update it to the
matching `formatFetchError` output (e.g. a 500 → "Something went wrong on the server. Try again shortly.").

- [ ] **Step 3: Typecheck & commit**

```bash
bun run typecheck
git add client/settings/sections/TaskProviderSection.svelte tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "fix(settings): TaskProvider friendly errors + instance label (sibling convergence)"
```

---

## Task 9: Story fixtures + visual re-shoot

**Files:**

- Modify: `client/stories/msw/settings-handlers-group.ts:81-86`
- Modify: `client/stories/msw/settings-handlers.ts:212-217`
- Verify: Storybook screenshots for both siblings

- [ ] **Step 1: Add `name` to the populated group fixture**

In `client/stories/msw/settings-handlers-group.ts`, change `groupProviderPopulated.available`
(line 84) to include a friendly name plus a second id-only option (exercises the `?? id` fallback):

```ts
const groupProviderPopulated = {
  contextId: 'ctx-group-1',
  taskInstanceId: 'inst_abc',
  available: [
    { id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' },
    { id: 'inst_bare', type: 'youtrack', status: 'active' },
  ],
  canProvision: false,
}
```

- [ ] **Step 2: Add `name` to the populated context (task-provider) fixture**

In `client/stories/msw/settings-handlers.ts`, change the `/settings/api/context/task-instance`
handler's `available` (line 216) to:

```ts
      available: [{ id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' }],
```

- [ ] **Step 3: Re-shoot both siblings**

Ensure Storybook is running (`bun storybook`), then:

Run: `bun shoot -g GroupProviderSection`
Run: `bun shoot -g TaskProviderSection`
Expected: all shots pass; baselines rewritten for the intended states (GroupProvider
Populated/Empty/Error/Loading + focused/narrow/hover; TaskProvider Populated/Error).

- [ ] **Step 4: Verify the intended visual changes**

Read these PNGs and confirm the changes match the design:

- `.storybook-shots/settings/sections/GroupProviderSection.spec.ts/settings-sections-GroupProviderSection-Populated-1.png` — option shows `https://kaneo.example (kaneo · active)`, not the raw id.
- `…-Empty-1.png` — muted "No active task instances available. Ask an admin to create one."
- `…-Error-1.png` — the `ErrorState` card ("Something went wrong on the server. Try again shortly.") with a "Try again" button, not a bare red word.
- `…-Loading-1.png` — a "Loading…" placeholder in the body.
- `…GroupProviderSection-—-select-focused-1.png` — green focus ring on the select (from Task 4).

- [ ] **Step 5: Commit**

```bash
git add client/stories/msw/settings-handlers-group.ts client/stories/msw/settings-handlers.ts
git commit -m "test(settings): story fixtures for friendly instance labels + re-shoot siblings"
```

Note: `.storybook-shots/` is gitignored — baseline PNGs are not committed; only the fixture
changes are.

---

## Final verification

- [ ] **Run the full client suite:**

Run: `bun test:client`
Expected: PASS.

- [ ] **Run the touched server tests:**

Run: `bun test tests/debug/settings/context-task-instance-routes.test.ts tests/debug/settings/group-routes.test.ts`
Expected: PASS.

- [ ] **Typecheck the whole project:**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Format:**

Run: `bun run format`
Expected: clean (commit any formatting-only changes if produced).

---

## Coverage check (plan ↔ spec)

| Spec item                                                       | Task       |
| --------------------------------------------------------------- | ---------- |
| A1 Field label via context                                      | Task 3     |
| A2 Focus ring on Input + Select                                 | Task 4     |
| A3 FetchError + formatFetchError                                | Tasks 1, 2 |
| B1 Optional `name` on option schema                             | Task 5     |
| B2 Server surfaces `config.baseUrl` (both routes)               | Task 6     |
| C1 GroupProvider save-busy / ErrorState+retry / loading / empty | Task 7     |
| C2 Friendly option label (both siblings)                        | Tasks 7, 8 |
| C3 TaskProvider error-path convergence                          | Task 8     |
| Story fixtures + visual re-shoot                                | Task 9     |

</content>
