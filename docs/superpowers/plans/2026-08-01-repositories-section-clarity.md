<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Repositories Section Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `ReposSection` onto the shared settings primitives so its two form controls
are labelled, its destructive delete is confirmed, its empty context says something, and its
spacing comes from tokens.

**Architecture:** Rendering-only changes to one Svelte component. The primitive migration
lands first because routing the raw `<select>`/`<textarea>` through `Select` and
`Input multiline` resolves the accessible-name, one-off-fill and control-height findings in
a single edit; every later task then applies to a section that already matches the design
system. No server, store, schema or route work.

**Tech Stack:** Svelte 5 (runes: `$state`, `$props`, `$effect`, snippets), Bun test runner
with `mount`/`unmount`/`flushSync` from `svelte`, Playwright + `@crvy/strybk` for visual
baselines, `oxfmt` for formatting.

**Spec:** [`docs/superpowers/specs/2026-08-01-repositories-section-clarity-design.md`](../specs/2026-08-01-repositories-section-clarity-design.md)
**Source review:** [`docs/ux-reviews/ReposSection.md`](../../ux-reviews/ReposSection.md)

## Global Constraints

- **Client tests need the browser conditions and the DOM preload.** Plain
  `bun test <path>` does not even match these files — `bunfig.toml`'s ignore patterns
  exclude `tests/client/`, and the path needs a `./` prefix. Every task in this plan uses:

  ```bash
  bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
  ```

  The whole client suite is `bun run test:client`.

- Use `.js` extensions in import paths, including for `.svelte` files' TypeScript imports.
- Never add a lint-disable or type-ignore comment; the write hook blocks them.
- Every new file needs the BUSL-1.1 license header; the commit hook checks this.
- Run `bun run format` (oxfmt, **not** prettier) before every commit.
- Error extraction stays `error instanceof Error ? error.message : String(error)` wherever
  `formatFetchError` is not the right tool.
- Do **not** modify `client/shared/ui/Field.svelte`, `Input.svelte`, `Select.svelte`,
  `PageHeader.svelte`, or `client/settings/settings.css`. Changing a shared primitive puts
  this work outside sub-project E's scope and forces a cross-SPA visual re-shoot.
- Do **not** change `--fg3` outside `ReposSection.svelte`'s own `<style>` block.
- Preserve the testids `repos-add-name`, `repos-add-url`, `repos-add-branch`,
  `repos-add-preset`, `repos-add-egress`, `repos-add-submit`, `repos-refresh`,
  `repos-row-<id>`, `repos-delete-<id>`. Existing component and visual tests select on them.
- Copy must not assert what a permission preset grants. This repo stores
  `permissionPreset` as an opaque string and forwards it to magi; only relative ordering is
  claimable.

## File Structure

| File                                                    | Responsibility                                           | Change  |
| ------------------------------------------------------- | -------------------------------------------------------- | ------- |
| `client/settings/sections/ReposSection.svelte`           | The whole feature. Markup, state, and its scoped styles. | Modify  |
| `tests/client/settings/repos-section.test.ts`            | Component behaviour: rendering, ARIA, confirm gating, error copy. | Modify |
| `tests/visual/settings/sections/ReposSection.spec.ts`    | Visual states. Manual region only, below `@generated-end`. | Modify |

No new files. The component is 287 lines and stays well inside the `max-lines` budget after
these changes, since three style rules and one `<p>` are deleted while roughly the same
volume is added.

---

### Task 1: Route the preset and egress controls through the shared primitives

Closes spec §1 in full, plus the two `Field hint` moves from §5 — the hint is an attribute of
the same element being rewritten, so splitting them would mean editing the same two `Field`
blocks twice.

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte:165-187` (the two `Field` blocks), `:262-286` (three style rules to delete), and the import block at `:7-13`
- Test: `tests/client/settings/repos-section.test.ts`

**Interfaces:**

- Consumes: `Select` (`client/shared/ui/Select.svelte`) — props `value: string`,
  `options: {value: string, label: string}[]`, `onChange?: (value: string) => void`,
  `testid?: string`. `Input` (`client/shared/ui/Input.svelte`) — already imported; adds
  `multiline?: boolean`, `rows?: number`. `Field` — adds `hint?: string`.
- Produces: `PRESET_OPTIONS`, a module-level const in the component's `<script>`, consumed by
  no other task. The `addPreset` state variable keeps its name, type (`string`) and
  `'cautious'` default, so Task 4's disable condition is unaffected.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe('ReposSection', ...)` block in
`tests/client/settings/repos-section.test.ts`, before its closing `})`:

```typescript
  test('the preset control renders through the shared Select primitive and is labelled', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const preset = target.querySelector<HTMLSelectElement>('[data-testid="repos-add-preset"]')!
    expect(preset.closest('.ui-select')).not.toBeNull()
    expect(preset.getAttribute('aria-labelledby')).not.toBeNull()
    void unmount(component)
  })

  test('the egress control renders through the shared multiline Input and is labelled', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const egress = target.querySelector<HTMLTextAreaElement>('[data-testid="repos-add-egress"]')!
    expect(egress.closest('.ui-input--multiline')).not.toBeNull()
    expect(egress.getAttribute('aria-labelledby')).not.toBeNull()
    void unmount(component)
  })

  test('preset options run from most to least restricted', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const preset = target.querySelector<HTMLSelectElement>('[data-testid="repos-add-preset"]')!
    expect([...preset.options].map((o) => o.value)).toEqual(['readonly', 'cautious', 'autonomous'])
    expect(preset.value).toBe('cautious')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: 3 failures. The two labelling tests fail on `expect(received).not.toBeNull()`
because `closest('.ui-select')` / `closest('.ui-input--multiline')` return `null` — the raw
controls have no primitive wrapper. The ordering test fails because the options are
currently `['autonomous', 'cautious', 'readonly']`.

- [ ] **Step 3: Add the Select import and the options constant**

In `client/settings/sections/ReposSection.svelte`, add to the import block (keep the
existing alphabetical order — `Select` goes after `PageHeader`):

```svelte
  import Select from '../../shared/ui/Select.svelte'
```

Then add this const to the `<script>` block, directly above `const parseEgress`:

```svelte
  const PRESET_OPTIONS = [
    { value: 'readonly', label: 'readonly' },
    { value: 'cautious', label: 'cautious' },
    { value: 'autonomous', label: 'autonomous' },
  ]
```

- [ ] **Step 4: Replace the two raw controls**

Replace the entire `Permission preset` and `Additional egress domains` `Field` blocks
(`:165-187`) with:

```svelte
        <Field label="Permission preset" hint="readonly is the most restricted, autonomous the least.">
          <Select
            value={addPreset}
            options={PRESET_OPTIONS}
            onChange={(v) => (addPreset = v)}
            testid="repos-add-preset" />
        </Field>
        <Field
          label="Additional egress domains"
          hint="Extra domains this project's sessions may reach, added to the defaults. One per line or comma-separated. A domain may still be blocked if your operator's egress policy doesn't include it.">
          <Input
            value={addEgress}
            onInput={(v) => (addEgress = v)}
            multiline={true}
            rows={3}
            placeholder="pypi.org, files.pythonhosted.org"
            testid="repos-add-egress" />
        </Field>
```

- [ ] **Step 5: Delete the three obsolete style rules**

Delete `.settings-repos__preset-select`, `.settings-repos__egress-input`, and
`.settings-repos__egress-help` from the `<style>` block — they are the last three rules in
it. After this the block ends with the `.settings-repos__add-form :global(.ui-field)` rule.
Leaving them in place is a Svelte "unused CSS selector" warning, not an error, so verify by
eye that all three are gone:

```bash
grep -c "settings-repos__preset-select\|settings-repos__egress-input\|settings-repos__egress-help" client/settings/sections/ReposSection.svelte
```

Expected: `0`.

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: PASS, all tests including the pre-existing ones. Two pre-existing tests exercise
these controls and must still pass without modification — `add form POSTs to the repos
endpoint with the form values` sets `presetSelect.value` and dispatches `change`, which
`Select`'s `handleChange` reads the same way the raw handler did; `add form parses
newline/comma domains` dispatches `input` on the textarea, which `Input`'s `handleInput`
reads identically. If either fails, the migration changed behaviour and must be fixed rather
than the test relaxed.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/settings/sections/ReposSection.svelte tests/client/settings/repos-section.test.ts
git commit -m "refactor(settings): route the repo preset and egress fields through shared primitives

Both controls were raw markup with one-off CSS, so they sat outside
Field's labelling contract and reached a screen reader unnamed. Select
and Input multiline carry aria-labelledby, the --raised fill and the
shared control height, which also settles the ragged label row.

Preset options now run most to least restricted so the new ordering
hint is verifiable by scanning."
```

---

### Task 2: Confirm-gate the destructive delete

Closes spec §2.

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte` — import block, `<script>` state, the row `Btn` at `:128-135`, and the end of the `<section>`
- Test: `tests/client/settings/repos-section.test.ts:165-180` (rewrite) plus two new tests

**Interfaces:**

- Consumes: `Confirm` (`client/shared/Confirm.svelte`) — props `open: boolean`,
  `title: string`, `onCancel: () => void`, `onConfirm: () => void`, `body: Snippet`,
  `danger?: boolean`, `busy?: boolean`, `confirmLabel?: string`. Renders a `.modal` with the
  confirm action as `.ui-btn--danger` when `danger` is set.
- Produces: `pendingDeleteId: string | null` state. Task 3 and later tasks do not read it.

**Note for the implementer:** `Confirm` gives its buttons no testid, so the established
selector in this codebase is `.modal .ui-btn--danger` (see
`tests/client/settings/code-host-section.test.ts:535`). Use it; do not add a testid to the
shared component.

- [ ] **Step 1: Rewrite the existing delete test and add two more**

Replace the whole existing `test('delete button issues DELETE with repoId', ...)` block
(`:165-180`) with these three tests:

```typescript
  test('the row delete button opens a confirm dialog without issuing DELETE', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()

    const modal = target.querySelector<HTMLElement>('.modal')!
    expect(modal.textContent).toContain('Delete repository')
    expect(modal.textContent).toContain('demo')
    expect(capturedDeleteUrl).toBe('')
    void unmount(component)
  })

  test('confirming the dialog issues DELETE with repoId', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()

    expect(capturedDeleteUrl).toContain('repoId=r1')
    expect(capturedDeleteUrl).toContain('contextId=pi%3Atelegram%3Actx%3Au1')
    expect(target.querySelector('.modal')).toBeNull()
    void unmount(component)
  })

  test('cancelling the dialog leaves the repository in place', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="repos-delete-r1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--secondary')!.click()
    await drain()

    expect(capturedDeleteUrl).toBe('')
    expect(target.querySelector('.modal')).toBeNull()
    expect(target.querySelector('[data-testid="repos-row-r1"]')).not.toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: 3 failures. All fail on `target.querySelector('.modal')` being `null` — clicking
the row button currently deletes immediately, so no dialog is ever rendered. The first test
additionally fails on `expect(capturedDeleteUrl).toBe('')`, because the DELETE already fired.

- [ ] **Step 3: Add the Confirm import and the pending state**

Add to the import block (before the `Btn` import, matching the path-depth grouping used by
sibling sections):

```svelte
  import Confirm from '../../shared/Confirm.svelte'
```

Add to the `<script>` state block, directly after `let deletingId: string | null = $state(null)`:

```svelte
  let pendingDeleteId: string | null = $state(null)
```

- [ ] **Step 4: Clear the pending id when the delete resolves**

In `handleDelete`, change the `finally` block from:

```svelte
    } finally {
      deletingId = null
    }
```

to:

```svelte
    } finally {
      deletingId = null
      pendingDeleteId = null
    }
```

- [ ] **Step 5: Re-point and re-weight the row button**

Replace the row `Btn` (`:128-135`) with:

```svelte
          <Btn
            variant="danger"
            size="sm"
            testid={`repos-delete-${repo.repoId}`}
            disabled={deletingId === repo.repoId}
            onClick={() => (pendingDeleteId = repo.repoId)}>
            {#snippet children()}{deletingId === repo.repoId ? 'Removing…' : 'Delete'}{/snippet}
          </Btn>
```

- [ ] **Step 6: Render the dialog**

Add this immediately before the closing `</section>` tag, after the `{/if}` that closes the
loading branch:

```svelte
  <Confirm
    open={pendingDeleteId !== null}
    title="Delete repository"
    danger
    busy={deletingId !== null}
    confirmLabel="Delete"
    onCancel={() => {
      pendingDeleteId = null
    }}
    onConfirm={() => {
      if (pendingDeleteId !== null) void handleDelete(pendingDeleteId)
    }}>
    {#snippet body()}
      <p>
        Delete {repos.find((r) => r.repoId === pendingDeleteId)?.name ?? 'this repository'}? Coding sessions in this
        context will no longer be able to use it.
      </p>
    {/snippet}
  </Confirm>
```

The body deliberately says nothing about what happens to sessions that already exist — magi
owns that behaviour, not this repo.

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: PASS, all tests.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/settings/sections/ReposSection.svelte tests/client/settings/repos-section.test.ts
git commit -m "feat(settings): confirm repository deletion and weight the row action

Deleting a repository was one unconfirmed click on the least prominent
control in the row — a borderless ghost button in muted text. It now
opens the shared Confirm dialog naming the repository, and the trigger
carries the danger variant, matching how nine sibling sections present
destructive actions.

The 24px sm size is kept: that is --control-h-sm, the target-size floor
sub-project C established."
```

---

### Task 3: Give an empty context something to say

Closes spec §3.

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte` — import block and the `{#each}` at `:119-138`
- Test: `tests/client/settings/repos-section.test.ts`

**Interfaces:**

- Consumes: `EmptyState` (`client/shared/ui/EmptyState.svelte`) — props `title: string`,
  `icon?: string`, `hint?: string`, `action?: Snippet`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block:

```typescript
  test('a context with no repositories renders an empty state', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.ui-empty')).not.toBeNull()
    expect(target.textContent).toContain('No repositories connected')
    void unmount(component)
  })

  test('a populated context renders no empty state', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.ui-empty')).toBeNull()
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: 1 failure — `a context with no repositories renders an empty state` fails on
`.ui-empty` being `null`. The second test passes already (there is no empty state to render
in either branch); it is there to pin the negative case so a future `{:else}` cannot leak
into the populated branch.

- [ ] **Step 3: Add the import and the else branch**

Add to the import block, after the `Btn` import:

```svelte
  import EmptyState from '../../shared/ui/EmptyState.svelte'
```

Then add an `{:else}` to the existing `{#each}`, immediately before its `{/each}`:

```svelte
      {:else}
        <EmptyState
          title="No repositories connected"
          hint="Add one below to make it available to coding sessions in this context." />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: PASS, all tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/sections/ReposSection.svelte tests/client/settings/repos-section.test.ts
git commit -m "feat(settings): give an empty repository list an empty state

A context with no repositories rendered nothing between the header and
the add form, so a successful fetch of zero rows was indistinguishable
from a section that had not loaded."
```

---

### Task 4: Mark the required fields, announce the status channel, frame the errors

Closes spec §4.

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte:52`, `:76`, `:96` (error extraction), `:112-113` (status paragraphs), `:144-163` (three `Field` labels), and the import block
- Test: `tests/client/settings/repos-section.test.ts`

**Interfaces:**

- Consumes: `formatFetchError` (`client/shared/format-error.ts:14`) — signature
  `(err: unknown) => string`. Returns the server's own message for 400/409/422, canned copy
  otherwise; a non-`FetchError` throw becomes "Couldn't reach the server. Check your
  connection and try again." `requireOk` (`client/shared/fetcher-helpers.ts:40`) throws
  `FetchError` on any non-ok response, and both `fetchRepos` and `writeJson` call it, so all
  three catch blocks receive a `FetchError` for HTTP failures.
- Produces: nothing consumed by later tasks.

**Note for the implementer:** `Field`'s `required` renders a `*` with no text alternative,
and the control receives no `aria-required`. That is a known gap in the shared primitive
which sub-project D deferred; do **not** fix it here, and do not assert on it in a test.

Two things the source review asked for that the spec deliberately declined — do not add
them back. No retry button beside the load error: `PageHeader`'s Refresh action is already
in this section. No second status channel next to the Add button, and no timeout on the
success message: it is a confirmation, not a toast, and `role="status"` is the actual fix
for the announcement gap regardless of where the message sits.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```typescript
  test('the three mandatory fields are marked required and the optional ones are not', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const labelFor = (testid: string): HTMLElement =>
      target.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.closest('.ui-field')!
        .querySelector<HTMLElement>('.ui-field__label')!

    expect(labelFor('repos-add-name').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-url').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-branch').querySelector('.ui-field__req')).not.toBeNull()
    expect(labelFor('repos-add-preset').querySelector('.ui-field__req')).toBeNull()
    expect(labelFor('repos-add-egress').querySelector('.ui-field__req')).toBeNull()
    void unmount(component)
  })

  test('a failed load renders framed copy in an announced alert', async () => {
    setMockFetch(() => Promise.resolve(new Response('{"error":"boom"}', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const alert = target.querySelector<HTMLElement>('.status-error')!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('Something went wrong on the server')
    expect(alert.textContent).not.toContain('boom')
    void unmount(component)
  })

  test('a successful add announces its status', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const set = (testid: string, value: string): void => {
      const el = target.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('repos-add-name', 'my-project')
    set('repos-add-url', 'https://github.com/acme/my-project.git')
    set('repos-add-branch', 'main')

    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="repos-add-submit"]')!.click()
    await drain()

    const status = target.querySelector<HTMLElement>('.status-success')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Repository added.')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: 3 failures. The required test fails on the first `.ui-field__req` being `null`.
The load test fails on `role` being `null` and on the text containing the raw `boom` rather
than the framed copy. The status test fails on `role` being `null`.

- [ ] **Step 3: Add the formatFetchError import**

Add to the import block, above the `RepoRecord` type import:

```svelte
  import { formatFetchError } from '../../shared/format-error.js'
```

- [ ] **Step 4: Frame all three error paths**

In `load`, replace:

```svelte
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
```

with:

```svelte
      if (id === contextId) error = formatFetchError(err)
```

In `handleAdd` and `handleDelete`, replace both occurrences of:

```svelte
      error = err instanceof Error ? err.message : String(err)
```

with:

```svelte
      error = formatFetchError(err)
```

- [ ] **Step 5: Announce the status channel**

Replace `:112-113` with:

```svelte
  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}
```

- [ ] **Step 6: Mark the three mandatory fields**

Change the three opening tags in the add form — leave the `Permission preset` and
`Additional egress domains` fields alone:

```svelte
        <Field label="Name" required>
        <Field label="Repository URL (https)" required>
        <Field label="Base branch" required>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: PASS, all tests.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/settings/sections/ReposSection.svelte tests/client/settings/repos-section.test.ts
git commit -m "feat(settings): mark the required repo fields and announce the status channel

The primary action was disabled until three of five fields were filled
with nothing marking which three. The status and error paragraphs were
also the only ones in the settings SPA without role=status/alert, so
neither outcome reached a screen reader.

Load, add and delete failures now run through formatFetchError instead
of surfacing the raw server string."
```

---

### Task 5: Adopt the shared form layout, the spacing tokens and the hint colour

Closes spec §5 (layout and table rows) and §6.

**Files:**

- Modify: `client/settings/sections/ReposSection.svelte` — the add-panel markup and the whole `<style>` block
- Test: `tests/client/settings/repos-section.test.ts`

**Interfaces:**

- Consumes: `.settings-form` from `client/settings/settings.css:36-45` — supplies
  `display: flex`, `flex-wrap: wrap`, `gap: var(--gap-inline)`, `align-items: end`,
  `margin-bottom: var(--gap-field)`.
- Produces: nothing consumed by later tasks.

**Note for the implementer:** Svelte scopes component styles, so `#repos .settings-form`
compiles to a selector carrying this component's scope class and cannot affect the nine
other sections that use `.settings-form`. Its specificity (two classes plus an id) also
beats the global rule regardless of stylesheet order, so the `margin-bottom: 0` override
lands without `!important`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block:

```typescript
  test('the add form uses the shared settings-form layout and states what is fixed at creation', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReposSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.settings-form')).not.toBeNull()
    expect(target.querySelector('.settings-repos__add-form')).toBeNull()
    expect(target.textContent).toContain('fixed when a repository is added')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: FAIL on `.settings-form` being `null` — the form still carries the local
`settings-repos__add-form` class.

- [ ] **Step 3: Swap the form class and add the creation note**

Replace the opening of the add panel:

```svelte
    <div class="settings-repos__add">
      <p class="settings-repos__add-label">Add repository</p>
      <div class="settings-repos__add-form">
```

with:

```svelte
    <div class="settings-repos__add">
      <div class="settings-repos__add-head">
        <p class="settings-repos__add-label">Add repository</p>
        <p class="settings-repos__add-note">
          Branch, preset and egress domains are fixed when a repository is added — change them by removing and re-adding
          it.
        </p>
      </div>
      <div class="settings-form">
```

- [ ] **Step 4: Replace the whole style block**

Replace everything between `<style>` and `</style>` with:

```css
  .settings-repos {
    display: grid;
    gap: var(--gap-tight);
    margin-bottom: var(--gap-field);
  }
  .settings-repos__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    padding: var(--gap-tight) var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .settings-repos__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .settings-repos__name {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg1);
    font-weight: 600;
  }
  .settings-repos__url {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .settings-repos__meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
  }
  .settings-repos__add {
    display: grid;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .settings-repos__add-head {
    display: grid;
    gap: var(--s1);
  }
  .settings-repos__add-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
    margin: 0;
  }
  .settings-repos__add-note {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-hint);
    margin: 0;
  }
  #repos .settings-form {
    margin-bottom: 0;
  }
  #repos .settings-form :global(.ui-field) {
    flex: 1 1 180px;
  }
```

Three things changed beyond token substitution, each deliberate: the row and panel gain
`--radius-control` so they stop being the only square surfaces beside rounded inputs; the
row's vertical padding drops from 10px to `--gap-tight`, which lands the row on the 44px
`--row-h`; and `min-width: 180px` becomes `flex: 1 1 180px`, so wrapped fields fill their
row instead of truncating at 640px with unused width beside them. `.settings-repos__info`
keeps its 2px gap — there is no 2px token, and it is intra-element leading rather than
layout spacing.

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/repos-section.test.ts
```


Expected: PASS, all tests.

- [ ] **Step 6: Confirm no dead selectors survived**

`bun run build:client` bundles silently and will not report unused selectors, so check by
name instead:

```bash
grep -n "settings-repos__preset-select\|settings-repos__egress-input\|settings-repos__egress-help\|settings-repos__add-form" client/settings/sections/ReposSection.svelte || echo "no dead selectors"
```

Expected: `no dead selectors`. A hit means a rule survived whose class is no longer in the
markup — delete the rule rather than re-adding the class.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/settings/sections/ReposSection.svelte tests/client/settings/repos-section.test.ts
git commit -m "refactor(settings): put the repo add form on the shared layout and tokens

The add form hand-rolled the flex-wrap layout nine sections already get
from .settings-form, and every gap, padding and radius in the section
was a literal px value off the scale. Wrapped fields now grow to fill
their row rather than truncating at 640px beside unused width.

The 11px meta and label text moves from --fg3 to --fg-hint: --fg3 on
--surface-1 measures ~3.96:1, under the AA floor, and --fg-hint is the
token documented for exactly this text. Scoped to this file; the sweep
across the other settings sections stays deferred.

A note under the form states that branch, preset and egress are fixed
at creation, so delete-and-re-add is signposted rather than discovered
by hunting for an edit control."
```

---

### Task 6: Refresh the visual baselines and cover the dialog

Closes the spec's Testing section.

**Files:**

- Modify: `tests/visual/settings/sections/ReposSection.spec.ts` — manual region only, below `// @generated-end auto-screenshots`
- Regenerate: `.storybook-shots/settings/sections/ReposSection.spec.ts/*.png`

**Interfaces:**

- Consumes: `switchStory` and the `sharedPage` fixture from `@crvy/strybk`;
  `pinDefaultViewport` from `tests/visual/support/viewport.js`, already imported at the top
  of this spec.
- Produces: nothing consumed by later tasks.

**Prerequisite:** Storybook must be running (`bun storybook`). Verify with
`curl -s -o /dev/null -w "%{http_code}" http://localhost:6006`, which must print `200`.

- [ ] **Step 1: Add the confirm-dialog state**

Append to the end of `tests/visual/settings/sections/ReposSection.spec.ts`:

```typescript
test('ReposSection — delete confirm dialog', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-repossection--populated')
  await sharedPage.getByTestId('repos-delete-repo_abc123').click()
  await expect(sharedPage.getByText('Delete repository')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Re-shoot every baseline**

Run: `bun shoot -g ReposSection`

Expected: `15 passed`. Fourteen existing baselines are rewritten and
`ReposSection-—-delete-confirm-dialog-1.png` is written for the first time. No test should
fail — `bun shoot` passes `--update-snapshots`, so a changed baseline is rewritten, not
reported.

- [ ] **Step 3: Read the changed shots and verify the intended differences**

Read these five PNGs under
`.storybook-shots/settings/sections/ReposSection.spec.ts/` and confirm each intended change
landed. This is the acceptance check for Tasks 1–5; do not skip it.

| File                                                     | Must show                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `settings-sections-ReposSection-Empty-1.png`              | the empty state above the form; three labels carrying `*`                        |
| `settings-sections-ReposSection-Populated-1.png`          | preset control matching the inputs' fill and height; Delete bordered in the danger colour; rounded rows |
| `ReposSection-—-preset-select-focused-1.png`              | the green `--focus-ring`, **not** the UA blue ring the old baseline had          |
| `ReposSection-—-long-content-in-the-add-form-narrow-1.png` | inputs filling the row rather than truncating at 180px                          |
| `ReposSection-—-delete-confirm-dialog-1.png`              | the dialog naming `my-project`                                                    |

If any of these is wrong, fix the component rather than accepting the baseline.

- [ ] **Step 4: Commit**

```bash
bun run format
git add tests/visual/settings/sections/ReposSection.spec.ts .storybook-shots/settings/sections/ReposSection.spec.ts
git commit -m "test(visual): re-baseline ReposSection and cover the delete dialog"
```

---

## Acceptance

Run from the repository root with Storybook up:

1. The component suite — all tests pass, including the
   seven pre-existing ones. The only pre-existing test that changed shape is the delete
   test, which Task 2 split into open / confirm / cancel.
2. `bun shoot -g ReposSection` — 15 pass, and re-running it a second time produces no
   further diff.
3. `bun run check:full` — lint, typecheck, format, knip and the full test suite pass.

Then verify against the spec's own claims:

- The preset `<select>` and egress `<textarea>` both sit inside a shared primitive wrapper
  and carry `aria-labelledby`.
- No row can be deleted without the dialog.
- `grep -c "fg3" client/settings/sections/ReposSection.svelte` returns `0`.
- `grep -rn "settings-repos__preset-select\|settings-repos__egress-input\|settings-repos__egress-help\|settings-repos__add-form" client/` returns nothing.
- No file outside `client/settings/sections/ReposSection.svelte`,
  `tests/client/settings/repos-section.test.ts`,
  `tests/visual/settings/sections/ReposSection.spec.ts` and the `.storybook-shots` baselines
  is modified. `git diff --stat master...HEAD` for these six commits should list exactly
  those paths.

## Not in this plan

Carried forward from the spec's deferred list, so a reviewer does not read these as misses:

1. `--fg3` → `--fg-hint` across the remaining 17 settings files and both admin SPAs.
2. `PageHeader`'s title as a real heading, a `disabled`/busy prop on `Input`, and a text
   alternative for `Field`'s required `*` with `aria-required` on the control.
3. `Field` hint-describedby wiring.
4. A PATCH route for coding repos and the per-row edit affordance it would enable.
