<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Live-Region Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every status and error message in the shared field primitives, `AdminUsersSection`, and `CodingMcpSection` announce reliably by mounting its live region before the message arrives.

**Architecture:** `LiveRegion.svelte` already stays mounted and swaps text in place; it gains optional `id` and `class` props so the field primitives can point `aria-describedby` at it and keep their own styling. Ten `{#if message}<p role="alert">…</p>{/if}` sites convert to always-mounted regions. Because a zero-height grid or flex child still consumes a gap, each converted site inside a gapped container gets one CSS rule cancelling that gap while the region is empty. A file-walking guard test with an explicit allowlist stops the old pattern from spreading.

**Tech Stack:** Svelte 5 runes, TypeScript (strict), `bun:test`, `@crvy/strybk` + Playwright for screenshots, `oxfmt` formatter, `oxlint`.

**Design spec:** `docs/archive/2026-08-09-live-region-adoption-design.md`

## Global Constraints

- `oxc/no-optional-chaining` is an **error** in `client/` and `src/`. Never write `?.` in these trees. The `{@render head?.()}` snippet-call idiom is pre-existing and exempt; do not copy it into new expressions.
- `vitest(no-conditional-in-test)` is an **error**. No `if`, no ternary, no `&&` short-circuit, and **no `??`** inside a `test()` body — the rule counts every logical expression. Hoist any conditional into a module-scope helper, following the existing `routePutPending` / `routeRefresh` convention in `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`. Note that `textContent` is non-nullable under this repo's TS config, so `n.textContent` needs no `?? ''` and no `!` (precedent: `rowError` at `tests/client/settings/sections/CodingMcpSection.test.ts:54`).
- `no-unused-vars` is an **error**. Never add a helper a task does not reference.
- `explicit-function-return-type` is enforced. Every function, including arrow functions and test helpers, declares its return type.
- Never add a lint-disable or type-ignore comment. A hook blocks them. Fix the underlying issue.
- A `max-lines` or `max-lines-per-function` failure is a design signal: split the file or extract functions. Never delete blank lines or compress formatting to get under the limit.
- Import paths use the `.js` extension.
- The formatter is `oxfmt`, run via `bun run format`. Not prettier.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- `tone` keeps owning `role` and `aria-live`. No site changes how urgently it announces: an existing `role="alert"` becomes `tone="alert"`, an existing `role="status"` becomes `tone="status"`.
- Client tests are excluded from default discovery by `bunfig.toml`. Run them with:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- Non-client tests (Task 7's guard) run with plain `bun test <path>`.
- All new files need the BUSL license header. `bun run license:headers` stamps them; `scripts/check.sh` verifies.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `client/shared/ui/LiveRegion.svelte` | The one component that owns always-mounted announcement markup. Gains `id` + `class`. | 1 |
| `client/shared/ui/Field.svelte` | Generic field wrapper. Error slot becomes an always-mounted region inside a new `.ui-field__msg` box. | 2 |
| `client/settings/components/SettingsFieldShell.svelte` | Settings-card field wrapper. Same change against its own grid gap. | 3 |
| `client/settings/components/ConfigFieldRow.svelte` | Config row. The `✓ Saved` marker becomes an always-mounted region in the flex head. | 4 |
| `client/settings/sections/admin/AdminUsersSection.svelte` | Four conditional regions convert. | 5 |
| `client/settings/sections/CodingMcpSection.svelte` | Three conditional regions convert. | 6 |
| `tests/client/live-region-guard.test.ts` | New. Walks `client/**/*.svelte`, fails on unallowlisted live-region markup and on stale allowlist entries. | 7 |
| `docs/ux-reviews/AdminUsersSection.md`, `docs/ux-reviews/CodingMcpSection.md`, `docs/ux-reviews/_BACKLOG.md` | Finding bookkeeping. | 8 |

Tasks 2–6 each also migrate the existing assertions that the change makes wrong or vacuous. Those migrations belong to the task that breaks them — a task must leave the suite green.

---

### Task 1: `LiveRegion` gains `id` and `class`

**Files:**
- Modify: `client/shared/ui/LiveRegion.svelte`
- Test: `tests/client/shared/ui/LiveRegion.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LiveRegion` props `{ message: string | null; tone: 'status' | 'alert'; id?: string; class?: string; testid?: string }`. When `class` is a non-empty string it **replaces** the tone's default class (`status-error` / `status-success`); the `live-region` class is always present. Tasks 2–6 rely on this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/shared/ui/LiveRegion.test.ts`:

```ts
test('an id prop lands on the region element so aria-describedby can point at it', () => {
  const { target, component } = render({ message: null, tone: 'alert', id: 'field-err-1', testid: 'x-error' })
  const el = target.querySelector('[data-testid="x-error"]')!
  expect(el.getAttribute('id')).toBe('field-err-1')
  void unmount(component)
})

test('no id attribute is emitted when the id prop is omitted', () => {
  const { target, component } = render({ message: null, tone: 'alert', testid: 'x-error' })
  expect(target.querySelector('[data-testid="x-error"]')!.hasAttribute('id')).toBe(false)
  void unmount(component)
})

// The tone classes carry colour AND margin from settings.css. A caller class that only
// wanted to restyle the text would silently lose to, or fight with, those rules -- so the
// class replaces the tone default rather than joining it. `tone` still owns role/aria-live.
test('a class prop replaces the tone class instead of joining it', () => {
  const { target, component } = render({
    message: 'boom',
    tone: 'alert',
    class: 'ui-field__error',
    testid: 'x-error',
  })
  const el = target.querySelector('[data-testid="x-error"]')!
  expect(el.classList.contains('ui-field__error')).toBe(true)
  expect(el.classList.contains('status-error')).toBe(false)
  expect(el.classList.contains('live-region')).toBe(true)
  expect(el.getAttribute('role')).toBe('alert')
  void unmount(component)
})

test('the tone class is still applied when no class prop is given', () => {
  const { target, component } = render({ message: 'boom', tone: 'alert', testid: 'x-error' })
  const el = target.querySelector('[data-testid="x-error"]')!
  expect(el.classList.contains('status-error')).toBe(true)
  void unmount(component)
})

test('an empty class string falls back to the tone class', () => {
  const { target, component } = render({ message: 'boom', tone: 'alert', class: '', testid: 'x-error' })
  expect(target.querySelector('[data-testid="x-error"]')!.classList.contains('status-error')).toBe(true)
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/LiveRegion.test.ts
```
Expected: FAIL. The id tests fail because no `id` attribute is rendered; the class tests fail because `status-error` is still present alongside `ui-field__error`.

- [ ] **Step 3: Implement**

In `client/shared/ui/LiveRegion.svelte`, replace the `<script lang="ts">` block and the element.

Script block:

```svelte
<script lang="ts">
  interface Props {
    message: string | null
    tone: 'status' | 'alert'
    // Set when a caller needs aria-describedby to point at this region.
    id?: string
    // Replaces the tone's default class rather than joining it: `status-error` and
    // `status-success` (settings.css) carry colour AND margin, so a caller class meant
    // only to restyle the text would end up contesting both with no clear winner.
    // `tone` keeps owning role and aria-live, which is the accessibility contract.
    class?: string
    testid?: string
  }

  let { message, tone, id, class: className, testid }: Props = $props()

  const toneClass = $derived(tone === 'alert' ? 'status-error' : 'status-success')
  const visualClass = $derived(className === undefined || className === '' ? toneClass : className)
</script>
```

Element (keep the existing comment block above it untouched):

```svelte
<p
  class="live-region {visualClass}"
  {id}
  role={tone === 'alert' ? 'alert' : 'status'}
  aria-live={tone === 'alert' ? 'assertive' : 'polite'}
  data-testid={testid}
>{message ?? ''}</p>
```

Leave the `<style>` block exactly as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/LiveRegion.test.ts
```
Expected: PASS, all tests in the file, including the five pre-existing ones.

- [ ] **Step 5: Verify no existing caller regressed**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/AnalyticsPreferencesSection.test.ts
```
Expected: PASS. This is the only section already using `LiveRegion`; it passes no `id` and no `class`, so its output must be byte-identical.

- [ ] **Step 6: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/shared/ui/LiveRegion.svelte tests/client/shared/ui/LiveRegion.test.ts
git commit -m "feat(ui): LiveRegion accepts an id and a replacement class"
```

---

### Task 2: `Field` mounts its error region before the error

**Files:**
- Modify: `client/shared/ui/Field.svelte:45-52` (markup) and `:84-91` (styles)
- Test: `tests/client/shared/ui/Field.test.ts`
- Migrate assertions in: `tests/client/shared/ui/field-context.test.ts:141,155,166`, `tests/client/settings/sections/CodingIdentitySection.test.ts:142`, `tests/client/settings/sections/CodingMcpSection.test.ts:93,109`, `tests/client/settings/sections/admin/AdminInstancesSection.test.ts:950`

**Interfaces:**
- Consumes: `LiveRegion` with `id` and `class` from Task 1.
- Produces: `Field` renders exactly three grid children — `.ui-field__label`, `.ui-field__control`, `.ui-field__msg`. `.ui-field__msg` contains an always-mounted `<p class="live-region ui-field__error" role="alert">` and, only while no error is set, a `<span class="ui-field__hint">`. Tasks 3 and 7 mirror this shape; Task 6 relies on `.ui-field__error` always existing.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('Field.svelte', …)` block in `tests/client/shared/ui/Field.test.ts`:

```ts
  // The whole point of the change: a live region announces only if it existed before its
  // text did. Asserting on the mounted-with-no-error case is what pins that.
  test('the error region is in the DOM before any error exists', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', children: textSnippet('x') } })
    const err = target.querySelector<HTMLElement>('.ui-field__error')
    expect(err).not.toBeNull()
    expect(err!.getAttribute('role')).toBe('alert')
    expect(err!.getAttribute('aria-live')).toBe('assertive')
    expect(err!.textContent).toBe('')
    void unmount(c)
  })

  test('the same error element carries the message once an error arrives', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', error: 'Required', children: textSnippet('x') } })
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(err.textContent).toBe('Required')
    expect(err.id).not.toBe('')
    void unmount(c)
  })

  test('the hint is replaced by the error rather than shown alongside it', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, {
      target,
      props: { label: 'url', hint: 'https only', error: 'Required', children: textSnippet('x') },
    })
    expect(target.querySelector('.ui-field__hint')).toBeNull()
    expect(target.querySelector('.ui-field__error')!.textContent).toBe('Required')
    void unmount(c)
  })

  // subgrid with `grid-row: span 3` needs exactly three children. The message box is what
  // keeps that true now that the region and the hint can both live in the last row.
  test('the field still has exactly three grid children', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'url', hint: 'h', children: textSnippet('x') } })
    const field = target.querySelector<HTMLElement>('.ui-field')!
    expect(field.children.length).toBe(3)
    expect(field.children[2]!.classList.contains('ui-field__msg')).toBe(true)
    void unmount(c)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Field.test.ts
```
Expected: FAIL — "the error region is in the DOM before any error exists" fails because `.ui-field__error` is null with no error set.

- [ ] **Step 3: Implement the markup**

In `client/shared/ui/Field.svelte`, add the import at the top of the instance script, after the existing `field-context.js` import:

```svelte
  import LiveRegion from './LiveRegion.svelte'
```

Replace lines 50-51 (the `{#if error}…{:else if hint}…` pair) with:

```svelte
  <div class="ui-field__msg">
    <LiveRegion tone="alert" message={error ?? null} id={errorId} class="ui-field__error" />
    {#if !error && hint}<span class="ui-field__hint" id={hintId}>{hint}</span>{/if}
  </div>
```

- [ ] **Step 4: Implement the styles**

In the same file's `<style>` block, replace the `.ui-field__hint` and `.ui-field__error` rules with:

```css
  .ui-field__hint {
    font-size: 10px;
    color: var(--text-dim);
  }
  /* :global because the class is handed to LiveRegion, and a class passed to a child
     component does not pick up this component's scoped styles. Scoped to the message box
     so it stays a Field rule rather than an app-wide one. */
  .ui-field__msg :global(.ui-field__error) {
    font-size: 10px;
    color: var(--danger);
  }
  /* The region stays mounted so a screen reader can hear it change, which means it is
     still a grid child when it holds no text -- and a zero-height grid child consumes a
     full row gap. It cannot be display:none'd or visibility:hidden'd without leaving the
     accessibility tree, so cancel the gap instead of removing the box. */
  .ui-field__msg:not(:has(*:not(:empty))) {
    margin-top: -6px;
  }
```

`-6px` is the negation of `.ui-field`'s own `gap: 6px` on line 63. It is a literal because that gap is a literal; if the gap ever becomes a token, both must move together.

- [ ] **Step 5: Run the Field tests to verify they pass**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Field.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 6: Find every assertion the change invalidates**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui tests/client/settings
```
Expected: FAIL in `field-context.test.ts` (3 assertions), `CodingIdentitySection.test.ts` (1), `CodingMcpSection.test.ts` (2), and `AdminInstancesSection.test.ts` (1) — 7 failing assertions across 4 files. Steps 7-10 fix exactly those. If any other file fails, stop and report it — this list is meant to be complete.

- [ ] **Step 7: Migrate `field-context.test.ts` — three assertions**

This file has three structural assertions about `.ui-field`'s children, one per hint/error/neither case. All three move because the message box is now the third child in every case.

At `:141` (in the hint case), replace:

```ts
    expect(field.children[2]!.classList.contains('ui-field__hint')).toBe(true)
```

with:

```ts
    expect(field.children[2]!.classList.contains('ui-field__msg')).toBe(true)
    expect(field.children[2]!.querySelector('.ui-field__hint')!.textContent).toContain('https only')
```

`https only` is the hint the test mounts `FieldHintFixture` with at `:134`.

At `:155` (in the error case), replace:

```ts
    expect(field.children[2]!.classList.contains('ui-field__error')).toBe(true)
```

with:

```ts
    // The error now lives inside the message box rather than being the third child itself,
    // so that the always-mounted region and the hint can share one grid row.
    expect(field.children[2]!.classList.contains('ui-field__msg')).toBe(true)
    expect(field.children[2]!.querySelector('.ui-field__error')!.textContent).toBe('boom')
```

At `:166` (in the neither-hint-nor-error case), replace:

```ts
    expect(field.children.length).toBe(2)
```

with:

```ts
    // The message box is unconditional now — it holds the always-mounted error region even
    // when there is nothing to say, which is the whole point of the change.
    expect(field.children.length).toBe(3)
    expect(field.children[2]!.classList.contains('ui-field__msg')).toBe(true)
    expect(field.children[2]!.textContent).toBe('')
```

That test's name says the control is the "second and last child", which is no longer true. Rename it to:

```ts
  test('wraps the children slot in a single control element as the second child when neither hint nor error is set', () => {
```

- [ ] **Step 8: Migrate `CodingIdentitySection.test.ts`**

At `tests/client/settings/sections/CodingIdentitySection.test.ts:142`, replace:

```ts
    expect(target.querySelector('.ui-field__error')?.textContent).toContain('Add a group member')
```

with:

```ts
    const errorTexts = [...target.querySelectorAll('.ui-field__error')]
      .map((n) => n.textContent)
      .filter((t) => t !== '')
    expect(errorTexts.length).toBe(1)
    expect(errorTexts[0]).toContain('Add a group member')
```

`querySelector` used to find the section's only error node; now every field carries an empty region, so a bare `querySelector` would return whichever empty one comes first. Collecting the non-empty ones and asserting there is exactly one is both a correct migration and stronger than what it replaces.

- [ ] **Step 9: Migrate `CodingMcpSection.test.ts`**

At `tests/client/settings/sections/CodingMcpSection.test.ts:93`, replace:

```ts
    expect(target.querySelector('[data-testid="coding-mcp-row-0"] .ui-field__error')).toBeNull()
```

with:

```ts
    expect(target.querySelector('[data-testid="coding-mcp-row-0"] .ui-field__error')!.textContent).toBe('')
```

At `:109`, replace:

```ts
    expect(target.querySelector('.ui-field__error')).toBeNull()
```

with:

```ts
    expect([...target.querySelectorAll('.ui-field__error')].every((n) => n.textContent === '')).toBe(true)
```

Leave `rowError` (around `:54`) unchanged. Do not add a shared `errorTexts` helper to this file —
the two replacements above are self-contained, and an unreferenced module-scope helper fails
`no-unused-vars`.

- [ ] **Step 10: Migrate `AdminInstancesSection.test.ts`**

At `tests/client/settings/sections/admin/AdminInstancesSection.test.ts:950`, replace:

```ts
    const errors = [...target.querySelectorAll('.ui-field__error')].map((n) => n.textContent)
```

with:

```ts
    // Every field now carries an always-mounted region; an empty one means "no error here".
    const errors = [...target.querySelectorAll('.ui-field__error')]
      .map((n) => n.textContent)
      .filter((t) => t !== '')
```

Leave the `expect(errors).toEqual(['Required', 'Required'])` line below it unchanged.

- [ ] **Step 11: Run the whole client suite**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```
Expected: PASS, no failures.

- [ ] **Step 12: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/shared/ui/Field.svelte tests/client
git commit -m "fix(ui): Field mounts its error region before the error arrives"
```

---

### Task 3: `SettingsFieldShell` mounts its error region before the error

**Files:**
- Modify: `client/settings/components/SettingsFieldShell.svelte:73-74` (markup) and `:113-122` (styles)
- Test: `tests/client/settings/components/SettingsFieldShell.test.ts`
- Migrate assertions in: `tests/client/settings/components/SettingsFieldShell.test.ts:99,142`, `tests/client/settings/code-host-section.test.ts:741,765,789`, `tests/client/settings/coding-credentials-section.test.ts:993,1017,1065`, `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts:232`

**Interfaces:**
- Consumes: `LiveRegion` with `id` and `class` from Task 1.
- Produces: `SettingsFieldShell` renders a `.settings-field__msg` box containing an always-mounted `<p class="live-region settings-field__error" role="alert">` and, only while no error is set, a `<p class="settings-field__hint">`. Its `aria-describedby` expression is unchanged. Task 4 renders inside this component; Task 7's allowlist excludes it.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SettingsFieldShell', …)` block:

```ts
  test('the error region is in the DOM before any error exists', () => {
    const { component, target } = render({ label: 'Model' })
    flushSync()
    const err = target.querySelector<HTMLElement>('.settings-field__error')
    expect(err).not.toBeNull()
    expect(err!.getAttribute('role')).toBe('alert')
    expect(err!.getAttribute('aria-live')).toBe('assertive')
    expect(err!.textContent).toBe('')
    void unmount(component)
  })

  test('the same error element is reused when an error arrives', () => {
    const { component, target } = render({ label: 'Model', error: 'Too short.' })
    flushSync()
    const err = target.querySelector<HTMLElement>('.settings-field__error')!
    expect(err.textContent).toContain('Too short.')
    expect(err.id).not.toBe('')
    void unmount(component)
  })

  test('the hint is replaced by the error rather than shown alongside it', () => {
    const { component, target } = render({ label: 'Model', hint: 'a hint', error: 'Too short.' })
    flushSync()
    expect(target.querySelector('.settings-field__hint')).toBeNull()
    expect(target.querySelector('.settings-field__error')!.textContent).toContain('Too short.')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsFieldShell.test.ts
```
Expected: FAIL — "the error region is in the DOM before any error exists" fails because `.settings-field__error` is null with no error set.

- [ ] **Step 3: Implement the markup**

In `client/settings/components/SettingsFieldShell.svelte`, add to the imports in the instance script:

```svelte
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
```

Replace lines 73-74 with:

```svelte
  <div class="settings-field__msg">
    <LiveRegion tone="alert" message={error ?? null} id={errorId} class="settings-field__error" />
    {#if !error && hint}<p class="settings-field__hint" id={hintId}>{hint}</p>{/if}
  </div>
```

Leave line 68 — `{@render head?.(error ? errorId : hint ? hintId : undefined)}` — and its comment exactly as they are. The error node now always exists, but pointing a control at an empty node describes it with nothing, so the conditional stays correct and the comment stays true.

- [ ] **Step 4: Implement the styles**

Replace the `.settings-field__error` and `.settings-field__hint` rules in the `<style>` block with:

```css
  /* :global because the class is handed to LiveRegion, and a class passed to a child
     component does not pick up this component's scoped styles. Scoped to the message box
     so it stays a SettingsFieldShell rule rather than an app-wide one. */
  .settings-field__msg :global(.settings-field__error) {
    margin: 0;
    color: var(--danger);
    font-size: 12px;
  }
  .settings-field__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  /* The region stays mounted so a screen reader can hear it change, which means it is
     still a grid child when it holds no text -- and a zero-height grid child consumes a
     full row gap. It cannot be display:none'd or visibility:hidden'd without leaving the
     accessibility tree, so cancel the gap instead of removing the box. */
  .settings-field__msg:not(:has(*:not(:empty))) {
    margin-top: calc(-1 * var(--gap-tight));
  }
```

`.settings-field` uses `gap: var(--gap-tight)` (line 81), so the cancellation is expressed in the same token.

- [ ] **Step 5: Migrate the two assertions inside this test file**

At `:99` (in `'renders the hint when there is no error'`), replace:

```ts
    expect(target.querySelector('.settings-field__error')).toBeNull()
```

with:

```ts
    expect(target.querySelector('.settings-field__error')!.textContent).toBe('')
```

At `:142` (in `'treats an empty error string as no error, in both the markup and the context'`), replace:

```ts
    expect(target.querySelector('.settings-field__error')).toBeNull()
```

with:

```ts
    expect(target.querySelector('.settings-field__error')!.textContent).toBe('')
```

- [ ] **Step 6: Run this file to verify it passes**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsFieldShell.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 7: Migrate `code-host-section.test.ts`**

At lines 741, 765, and 789 — three separate tests, each asserting no inline field error while a banner shows — replace each occurrence of:

```ts
    expect(target.querySelector('.settings-field__error')).toBeNull()
```

with:

```ts
    expect(target.querySelector('.settings-field__error')!.textContent).toBe('')
```

- [ ] **Step 8: Migrate `coding-credentials-section.test.ts`**

At lines 993, 1017, and 1065, apply exactly the same replacement as Step 7: each

```ts
    expect(target.querySelector('.settings-field__error')).toBeNull()
```

becomes

```ts
    expect(target.querySelector('.settings-field__error')!.textContent).toBe('')
```

- [ ] **Step 9: Migrate `AnalyticsPreferencesSection.test.ts`**

At `:230-232`, replace:

```ts
    expect(
      target.querySelector('[data-testid="analytics-field-external"]')!.querySelector('.settings-field__error'),
    ).toBeNull()
```

with:

```ts
    expect(
      target.querySelector('[data-testid="analytics-field-external"]')!.querySelector('.settings-field__error')!
        .textContent,
    ).toBe('')
```

- [ ] **Step 10: Run the whole client suite**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```
Expected: PASS, no failures. If a file outside the four named in Steps 5-9 fails, stop and report it.

- [ ] **Step 11: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/settings/components/SettingsFieldShell.svelte tests/client
git commit -m "fix(settings): SettingsFieldShell mounts its error region before the error"
```

---

### Task 4: `ConfigFieldRow`'s saved marker announces from a mounted region

**Files:**
- Modify: `client/settings/components/ConfigFieldRow.svelte:150-154` (the `savedMarker` snippet) and its `<style>` block
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts`
- Migrate assertions in: `tests/client/settings/components/ConfigFieldRow.test.ts:909,947`

**Interfaces:**
- Consumes: `LiveRegion` with `class` from Task 1; renders inside `SettingsFieldShell`'s `head` snippet from Task 3.
- Produces: `[data-testid="cfg-saved-<key>"]` is always in the DOM, empty until a save succeeds, then carrying `✓ Saved`.

`justSaved` is a timed flag set at `:58` and cleared at `:61`, and the row is permanently mounted — so this is a genuine later-arriving announcement, not mount-time content.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `tests/client/settings/components/ConfigFieldRow.test.ts`:

```ts
  test('the saved marker region is mounted and empty before any save', () => {
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'timezone',
        storageKey: 'timezone',
        label: 'Timezone',
        required: true,
        sensitive: false,
        kind: 'preference',
        hasValue: true,
        value: 'UTC',
      },
      onSaved: () => {},
    })
    flushSync()
    const marker = target.querySelector<HTMLElement>('[data-testid="cfg-saved-timezone"]')
    expect(marker).not.toBeNull()
    expect(marker!.getAttribute('role')).toBe('status')
    expect(marker!.getAttribute('aria-live')).toBe('polite')
    expect(marker!.textContent).toBe('')
    void unmount(component)
  })
```

`render` is the file's existing module-scope helper at `:25`; the field shape is the one every save test in the file already passes.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts
```
Expected: FAIL — the marker is null before a save.

- [ ] **Step 3: Implement**

In `client/settings/components/ConfigFieldRow.svelte`, add to the imports:

```svelte
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
```

Replace the `savedMarker` snippet (lines 150-154) with:

```svelte
{#snippet savedMarker()}
  <LiveRegion
    tone="status"
    message={justSaved ? '✓ Saved' : null}
    class="settings-field__saved"
    testid={`cfg-saved-${field.key}`} />
{/snippet}
```

- [ ] **Step 4: Implement the styles**

Replace the `.settings-field__saved` rule in the `<style>` block with:

```css
  /* :global because the class is handed to LiveRegion, and a class passed to a child
     component does not pick up this component's scoped styles. */
  :global(.settings-field__saved) {
    color: var(--success);
    font-size: 11px;
    white-space: nowrap;
  }
  /* The marker is the last child of .settings-field__head, a flex row with
     gap: var(--gap-tight) whose label carries margin-right: auto -- so the slack sits
     left of the controls and a trailing gap would shove them 8px inward. The marker
     stays mounted so the save can be announced, and it cannot be hidden without leaving
     the accessibility tree, so cancel the gap it claims while empty instead. */
  :global(.settings-field__saved:empty) {
    margin-left: calc(-1 * var(--gap-tight));
  }
```

- [ ] **Step 5: Migrate the two assertions**

At `:909`, replace:

```ts
    expect(target.querySelector('[data-testid="cfg-saved-timezone"]')).toBeNull()
```

with:

```ts
    expect(target.querySelector('[data-testid="cfg-saved-timezone"]')!.textContent).toBe('')
```

At `:947`, apply the same replacement.

- [ ] **Step 6: Run the tests to verify they pass**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts
```
Expected: PASS, all tests. The two `?.textContent` assertions at `:918` and `:977` are unaffected — they assert the marker's text after a successful save, which is unchanged.

- [ ] **Step 7: Run the whole client suite**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```
Expected: PASS, no failures.

- [ ] **Step 8: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "fix(settings): ConfigFieldRow announces a save from a mounted region"
```

---

### Task 5: `AdminUsersSection`'s four regions mount before their messages

**Files:**
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte:218-219`, `:242-247`, `:375`
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`
- Migrate assertions in: `tests/client/settings/sections/admin/AdminUsersSection.test.ts:383,740,767`

Closes UX finding `admin-users-live-region-mounts-with-text`.

**Interfaces:**
- Consumes: `LiveRegion` from Task 1.
- Produces: nothing later tasks depend on, other than that Task 7's allowlist must not list this file.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('AdminUsersSection', …)` block in `tests/client/settings/sections/admin/AdminUsersSection.test.ts`. This file has no mount helper — every test inlines the four-line arrangement, so match it:

```ts
  test('the section status and error regions are mounted and empty on a clean load', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const err = target.querySelector<HTMLElement>('.status-error')!
    const ok = target.querySelector<HTMLElement>('.status-success')!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.getAttribute('aria-live')).toBe('assertive')
    expect(err.textContent).toBe('')
    expect(ok.getAttribute('role')).toBe('status')
    expect(ok.getAttribute('aria-live')).toBe('polite')
    expect(ok.textContent).toBe('')
    void unmount(component)
  })
```

`openAccessOffMock` and `drain` are the file's existing module-scope helpers. The top-level `afterEach` at `:281` already calls `restoreFetch()`, so the test must not.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminUsersSection.test.ts
```
Expected: FAIL — `.status-error` is null on a clean load.

- [ ] **Step 3: Implement the two section-level regions**

Add to the imports in `client/settings/sections/admin/AdminUsersSection.svelte`:

```svelte
  import LiveRegion from '../../../shared/ui/LiveRegion.svelte'
```

Replace lines 218-219:

```svelte
  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}
```

with:

```svelte
  <LiveRegion tone="alert" message={error} />
  <LiveRegion tone="status" message={status} />
```

- [ ] **Step 4: Implement the open-access region**

`openAccessError` is set by the loader at `:89` and can change on a re-load, so it is a later-arriving message, not mount-time content.

Add this derived value to the instance script, next to the other `$derived` declarations:

```svelte
  // Composed in script rather than in markup so the region carries either a complete
  // sentence or nothing -- never a bare trailing em-dash while it waits for text.
  const openAccessMessage = $derived(
    openAccessError === null ? null : `Could not read the open DM access setting — ${openAccessError}`,
  )
```

Replace lines 242-247:

```svelte
        {#if openAccessError !== null}
          <p class="status-error" role="alert" data-testid="open-access-error">
            Could not read the open DM access setting — {openAccessError}
          </p>
        {/if}
```

with:

```svelte
        <LiveRegion tone="alert" message={openAccessMessage} testid="open-access-error" />
```

- [ ] **Step 5: Implement the confirm-dialog region**

The dialog mounts on open and `removeError` arrives only from a failed confirm after that, so mounting the region with the dialog is correct — no hoisting to a section-level region is needed.

Replace line 375:

```svelte
      {#if removeError !== null}<p class="status-error" role="alert">{removeError}</p>{/if}
```

with:

```svelte
      <LiveRegion tone="alert" message={removeError} />
```

- [ ] **Step 6: Migrate the three assertions**

At `:383`, replace:

```ts
    expect(target.querySelector('.status-error')).not.toBeNull()
```

with:

```ts
    expect(target.querySelector('.status-error')!.textContent).not.toBe('')
```

At `:740`, replace:

```ts
    expect(target.querySelector('.modal .status-error')).not.toBeNull()
```

with:

```ts
    expect(target.querySelector('.modal .status-error')!.textContent).not.toBe('')
```

At `:767`, replace:

```ts
    expect(target.querySelector('[data-testid="open-access-error"]')).not.toBeNull()
```

with:

```ts
    expect(target.querySelector('[data-testid="open-access-error"]')!.textContent).toContain(
      'Could not read the open DM access setting',
    )
```

Each of these was an existence assertion that the change makes vacuous — the node is now always present. Asserting on text is what keeps the test meaningful.

- [ ] **Step 7: Run the tests to verify they pass**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminUsersSection.test.ts
```
Expected: PASS, all tests. The assertions at `:475`, `:556`, and `:573` already read text and need
no change.

`:907` and `:925` do need one. Both read only `getAttribute('role')`, which used to imply the node
existed at all — the `{#if}` paragraph was absent until the action produced a message, so the `!`
would have thrown. Once the region is always mounted, `role` is hard-coded by `tone` and both tests
pass even if the action stops producing any text. Add a text assertion beside each role assertion:
`expect(line.textContent).toContain('User unblocked.')` at `:907`, and
`expect(line.textContent).not.toBe('')` at `:925`, where the expected message is not fixed.

- [ ] **Step 8: Run the whole client suite**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```
Expected: PASS, no failures.

- [ ] **Step 9: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(admin): AdminUsersSection mounts its live regions before their messages"
```

---

### Task 6: `CodingMcpSection`'s three regions mount before their messages

**Files:**
- Modify: `client/settings/sections/CodingMcpSection.svelte:206-207`, `:217-219`
- Test: `tests/client/settings/sections/CodingMcpSection.test.ts`

Closes UX finding `coding-mcp-live-region-mounts-with-text`.

**Interfaces:**
- Consumes: `LiveRegion` from Task 1. This test file has no shared `errorTexts` helper — Task 2
  migrated its two affected assertions inline. Collect non-empty error text inline where needed.
- Produces: nothing later tasks depend on, other than that Task 7's allowlist must not list this file.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('CodingMcpSection dead-end states', …)` (`:277`) — that block's `afterEach` already calls `restoreFetch()`, so the test must not:

```ts
  test('the section status and error regions are mounted and empty once data has loaded', async () => {
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()
    const err = target.querySelector<HTMLElement>('.status-error')!
    const ok = target.querySelector<HTMLElement>('.status-success')!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.getAttribute('aria-live')).toBe('assertive')
    expect(err.textContent).toBe('')
    expect(ok.getAttribute('role')).toBe('status')
    expect(ok.getAttribute('aria-live')).toBe('polite')
    expect(ok.textContent).toBe('')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```
Expected: FAIL — `.status-error` is null after a clean load.

- [ ] **Step 3: Implement the two section-level regions**

Add to the imports in `client/settings/sections/CodingMcpSection.svelte`:

```svelte
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
```

Replace lines 206-207:

```svelte
  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}
```

with:

```svelte
  <!-- The `currentData !== null` guard moves from the markup into the message: before data
       exists the failure is shown by ErrorState below, but the region itself must already
       be mounted so a later failure can be announced rather than appearing with its text. -->
  <LiveRegion tone="alert" message={currentData === null ? null : error} />
  <LiveRegion tone="status" message={status} />
```

- [ ] **Step 4: Implement the unreadable-credentials region**

`unreadableError` is `$derived(currentData…)` at `:44`, so a refresh can flip it to non-null while the `{:else if currentData !== null}` branch stays mounted. It is a later-arriving message, not mount-time content.

Add this constant to the instance script, above the markup:

```svelte
  const UNREADABLE_TEXT = 'Stored credentials are unreadable. Re-enter your credentials to repair this context.'
```

Replace lines 217-219:

```svelte
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your credentials to repair this context.</p>
    {/if}
```

with:

```svelte
    <LiveRegion tone="alert" message={unreadableError === null ? null : UNREADABLE_TEXT} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```
Expected: PASS, all tests.

- [ ] **Step 6: Run the whole client suite**

Run:
```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client
```
Expected: PASS, no failures.

- [ ] **Step 7: Format, lint, commit**

```bash
bun run format
bun run lint
git add client/settings/sections/CodingMcpSection.svelte tests/client/settings/sections/CodingMcpSection.test.ts
git commit -m "fix(settings): CodingMcpSection mounts its live regions before their messages"
```

---

### Task 7: The guard test and its allowlist

**Files:**
- Create: `tests/client/live-region-guard.test.ts`

This file reads source text; it does not mount components, so it runs under plain `bun test` despite living under `tests/client/`. `bunfig.toml` excludes `tests/client/**` from default discovery, so it must be named explicitly on the command line — the same as every other test in that tree.

**Interfaces:**
- Consumes: the converted files from Tasks 2-6 (they must not appear in the allowlist).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `tests/client/live-region-guard.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { Glob } from 'bun'

// A live region announces a change only if the element existed before the text arrived.
// LiveRegion.svelte is the one component allowed to build that markup; everywhere else,
// `role="alert"` / `role="status"` / `aria-live` means a hand-rolled region that is almost
// certainly mounted together with its message.
//
// These files are knowingly still on the old shape. The list is the checked-in form of a
// deliberate scope decision, not a backlog of unknowns -- it shrinks as sections convert.
// See docs/archive/2026-08-09-live-region-adoption-design.md.
const ALLOWLIST = [
  'debug/DebugApp.svelte',
  'settings/components/PluginCard.svelte',
  'settings/components/SettingsGate.svelte',
  'settings/sections/ByokSection.svelte',
  'settings/sections/CodeHostSection.svelte',
  'settings/sections/CodingCredentialsSection.svelte',
  'settings/sections/CodingIdentitySection.svelte',
  'settings/sections/GroupProviderSection.svelte',
  'settings/sections/GuestModeSection.svelte',
  'settings/sections/IdentitySection.svelte',
  'settings/sections/ReleaseSubscriptionSection.svelte',
  'settings/sections/ReposSection.svelte',
  'settings/sections/TaskProviderSection.svelte',
  'settings/sections/admin/AdminAnalyticsSection.svelte',
  'settings/sections/admin/AdminInstancesSection.svelte',
  'settings/sections/admin/AdminModelsSection.svelte',
  'settings/sections/admin/AdminPluginsConfigSection.svelte',
  'shared/ui/ErrorState.svelte',
  'transcript/TranscriptView.svelte',
  'transcript/components/StatusBanner.svelte',
]

const OWNER = 'shared/ui/LiveRegion.svelte'
const PATTERN = /role="(?:alert|status)"|aria-live/u

const offenders = async (): Promise<string[]> => {
  const found: string[] = []
  for await (const path of new Glob('**/*.svelte').scan({ cwd: 'client' })) {
    const normalized = path.replaceAll('\\', '/')
    if (normalized === OWNER) continue
    const source = await Bun.file(`client/${normalized}`).text()
    if (PATTERN.test(source)) found.push(normalized)
  }
  return found.sort()
}

describe('live-region guard', () => {
  test('no file outside the allowlist hand-rolls live-region markup', async () => {
    const unexpected = (await offenders()).filter((p) => !ALLOWLIST.includes(p))
    expect(unexpected).toEqual([])
  })

  // Without this, a converted file could sit on the list forever and the list would stop
  // describing anything real.
  test('every allowlist entry still hand-rolls live-region markup', async () => {
    const found = await offenders()
    const stale = ALLOWLIST.filter((p) => !found.includes(p))
    expect(stale).toEqual([])
  })

  test('the allowlist is sorted and free of duplicates', () => {
    expect(ALLOWLIST).toEqual([...new Set(ALLOWLIST)].sort())
  })
})
```

- [ ] **Step 2: Run the test**

Run:
```bash
bun test tests/client/live-region-guard.test.ts
```
Expected: PASS, 3 tests. If "no file outside the allowlist" fails, one of Tasks 2-6 did not fully convert its file — fix the component, not the allowlist. If "every allowlist entry still hand-rolls" fails, remove the named entries from `ALLOWLIST`.

- [ ] **Step 3: Prove the guard actually catches a regression**

Temporarily add this line inside the `<section>` of `client/settings/sections/CodingMcpSection.svelte`:

```svelte
  <p role="alert">temporary</p>
```

Run:
```bash
bun test tests/client/live-region-guard.test.ts
```
Expected: FAIL, with `settings/sections/CodingMcpSection.svelte` listed in the received array.

Then revert that line — `git checkout` is blocked by a repo hook, so remove it with an edit — and re-run to confirm PASS.

- [ ] **Step 4: Format, lint, license, commit**

```bash
bun run format
bun run lint
bun run license:headers
git add tests/client/live-region-guard.test.ts
git commit -m "test(client): guard against hand-rolled live regions outside LiveRegion"
```

---

### Task 8: Visual verification and finding bookkeeping

**Files:**
- Modify: `docs/ux-reviews/AdminUsersSection.md`, `docs/ux-reviews/CodingMcpSection.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**
- Consumes: the commits from Tasks 2-6 (their SHAs go in the `Resolved:` lines).
- Produces: nothing.

`.storybook-shots/` is gitignored and `bun shoot` runs Playwright with `--update-snapshots=all`, so there is no committed baseline to diff against. Verification is done by reading the PNGs.

- [ ] **Step 1: Shoot the two converted sections**

Storybook must be running (`bun storybook` in another terminal).

```bash
bun shoot -g AdminUsersSection
bun shoot -g CodingMcpSection
```
Expected: Playwright reports all tests passed and writes PNGs under `.storybook-shots/`.

- [ ] **Step 2: Shoot two sections that render through the primitives**

```bash
bun shoot -g AnalyticsPreferencesSection
bun shoot -g AdminInstancesSection
bun shoot -g ProfileSection
```
`AnalyticsPreferencesSection` exercises `SettingsFieldShell`; `AdminInstancesSection` exercises `Field`; `ProfileSection` exercises `ConfigFieldRow` and is the only one of the three that shows the flex-row saved marker from Task 4.

- [ ] **Step 3: Read the frames and confirm no spacing drift**

Read these PNGs with the Read tool:

- `.storybook-shots/settings/sections/AnalyticsPreferencesSection.spec.ts/AggregateDefault-*.png` — no error anywhere; the gap-cancellation rule is what keeps this identical to before.
- `.storybook-shots/settings/sections/AnalyticsPreferencesSection.spec.ts/AnalyticsPreferences-a-failed-preference-save-*.png` — the local lane shows its error, the external lane does not.
- `.storybook-shots/settings/sections/CodingMcpSection.spec.ts/*.png` and `.storybook-shots/settings/sections/admin/AdminUsersSection.spec.ts/*.png` — the sections' own frames.
- `.storybook-shots/settings/sections/ProfileSection.spec.ts/*.png` — the config rows' head, where the empty saved marker sits at the right edge.

What you are checking for: no extra vertical gap under any field that has neither an error nor a hint; no gap under the section header where the two empty section-level regions now sit; and the config rows' right-hand controls flush to the row edge, not inset by 8px. **Any spacing change is a bug in the gap-cancellation rules from Tasks 2-4**, to be fixed there — not accepted.

- [ ] **Step 4: Mark the AdminUsersSection finding fixed**

In `docs/ux-reviews/AdminUsersSection.md`, find the finding whose `- **Id:** admin-users-live-region-mounts-with-text`. Change its `- **Status:** open` to `- **Status:** fixed` and add immediately below the Status line:

```markdown
- **Resolved:** live-region adoption, commit <task-5-sha>
```

Substitute the actual short SHA of the Task 5 commit (`git log --oneline -- client/settings/sections/admin/AdminUsersSection.svelte | head -1`).

- [ ] **Step 5: Mark the CodingMcpSection finding fixed**

In `docs/ux-reviews/CodingMcpSection.md`, find the finding whose `- **Id:** coding-mcp-live-region-mounts-with-text`. Change its `- **Status:** open` to `- **Status:** fixed` and add immediately below the Status line:

```markdown
- **Resolved:** live-region adoption, commit <task-6-sha>
```

Substitute the actual short SHA of the Task 6 commit.

- [ ] **Step 6: Regenerate the backlog**

```bash
bun run ux:backlog
bun run format
```
Expected: `docs/ux-reviews/_BACKLOG.md` now reports 4 open findings across 26 sections, with `AdminUsersSection` and `CodingMcpSection` both at 0 open.

- [ ] **Step 7: Verify the backlog test still passes**

```bash
bun test tests/scripts/ux-backlog.test.ts
```
Expected: PASS. The `'is current — regenerating in memory reproduces it exactly'` test is what catches a hand-edited or unregenerated backlog.

- [ ] **Step 8: Run the full check**

```bash
bun run check
```
Expected: all checks pass.

- [ ] **Step 9: Commit**

```bash
git add docs/ux-reviews
git commit -m "docs(ux-reviews): close the two live-region findings"
```
