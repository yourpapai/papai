<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Shared Primitive Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four accessibility gaps that sub-projects D and E deferred because each
lives in a shared primitive rather than in any one settings section.

**Architecture:** Two components publish the field context (`Field.svelte` and
`SettingsFieldShell.svelte`) and three consume it (`Input`, `Select`, `Combobox`). The
contract in `field-context.ts` grows two facts — whether the field is required, and the id of
its hint — and both publishers supply them in the same task so the SPA is never half-migrated.
`PageHeader` becomes a real `<h2>` and the settings shell gains a visually-hidden `<h1>` to
root the outline. `Input` gains the `disabled` prop its sibling `Select` already has.

**Tech Stack:** Svelte 5 runes, TypeScript (strict, `.js` import extensions), `bun:test` with
`--conditions=browser`, Storybook + `@crvy/strybk` Playwright screenshots.

**Spec:** [`docs/superpowers/specs/2026-08-01-shared-primitive-accessibility-design.md`](../specs/2026-08-01-shared-primitive-accessibility-design.md)

## Global Constraints

- **Both publishers change together.** Any change to the `field-context.ts` contract lands in
  `Field.svelte` *and* `SettingsFieldShell.svelte` in the same task. Half-migrated is worse
  than unmigrated.
- **No visual change in Tasks 1–3.** These are semantics-only. A `bun shoot` baseline diff
  from Tasks 1–3 is a defect to fix, not a baseline to accept. Task 4 adds exactly one new
  baseline (the disabled `Input` story).
- **`PageHeader` heading level is fixed at `h2`.** Do not add a `level` prop — no render site
  needs a second level, and an untested branch is worse than a two-line change later.
- **`ConfigFieldRow.svelte` keeps its local `hintId` wiring.** Its enum branch can show hint
  *and* error simultaneously, so it needs the filtered id list it already builds
  (`ConfigFieldRow.svelte:46`–`:56`). Do not route it through the shared context.
- **Never add lint-disable or type-ignore comments** (repo hook policy). Fix the underlying
  issue.
- Strict TypeScript; **`.js` extension in import paths**.
- Run the client suite with:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <file>`

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `client/shared/ui/field-context.ts` | The publisher/consumer contract. Grows `hintId` + `hasHint` + `required`. | 1, 2 |
| `client/shared/ui/Field.svelte` | Publisher A. Mints the hint id, publishes required. | 1, 2 |
| `client/settings/components/SettingsFieldShell.svelte` | Publisher B. Same two changes. | 1, 2 |
| `client/shared/ui/Input.svelte` | Consumer. `aria-required`; new `disabled` prop. | 2, 4 |
| `client/shared/ui/Select.svelte` | Consumer. `aria-required`. | 2 |
| `client/shared/ui/Combobox.svelte` | Consumer. `aria-required`. | 2 |
| `client/shared/ui/PageHeader.svelte` | `div` → `h2`. | 3 |
| `client/settings/SettingsApp.svelte` | Hidden `h1` rooting the outline. | 3 |
| `client/settings/settings.css` | The `.settings-sr-only` utility. | 3 |
| `client/settings/sections/CodeHostSection.svelte` | The one `Input disabled` consumer. | 4 |
| `client/shared/ui/Input.stories.svelte` | Disabled story state. | 4 |

Test fixtures: `tests/client/shared/ui/FieldHintFixture.svelte` (new, Task 1) and
`tests/client/settings/components/ShellInputFixture.svelte` (gains props, Task 1).

---

### Task 1: Wire the hint into `aria-describedby`

Closes spec §2, and §0's requirement that both publishers move together.

**Files:**

- Modify: `client/shared/ui/field-context.ts` — `FieldErrorContext`, `useFieldInvalid`
- Modify: `client/shared/ui/Field.svelte` — the `setFieldError` call and the hint span
- Modify: `client/settings/components/SettingsFieldShell.svelte:37`–`:45`, `:65`
- Create: `tests/client/shared/ui/FieldHintFixture.svelte`
- Modify: `tests/client/settings/components/ShellInputFixture.svelte` — add a `hint` prop
- Test: `tests/client/shared/ui/field-context.test.ts`,
  `tests/client/settings/components/SettingsFieldShell.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `FieldErrorContext` gains `hintId: string` and a `readonly hasHint: boolean`
  getter. `FieldInvalidState.describedBy` changes meaning: error id when invalid, else hint id
  when a hint is present, else `undefined`. Task 2 extends the same two objects.

**Note for the implementer:** `Input`, `Select` and `Combobox` already render
`aria-describedby={fieldError.describedBy}`. You are changing what that getter returns, so the
three consumers need **no edit** in this task. Resist touching them.

The existing assertions at `SettingsFieldShell.test.ts:131` and `:152` expect
`aria-describedby` to be `null`. They must keep passing: `ShellInputFixture` renders no hint
unless you pass one, so those cases still have neither error nor hint. Do not change those
tests.

- [ ] **Step 1: Create the hint fixture**

Create `tests/client/shared/ui/FieldHintFixture.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Field from '../../../../client/shared/ui/Field.svelte'
  import Input from '../../../../client/shared/ui/Input.svelte'

  interface Props {
    hint?: string
    error?: string
    required?: boolean
  }

  let { hint, error, required = false }: Props = $props()
</script>

<Field label="Kaneo URL" {hint} {error} {required}>
  <Input value="" testid="hint-input" />
</Field>
```

- [ ] **Step 2: Add the `hint` prop to the shell fixture**

In `tests/client/settings/components/ShellInputFixture.svelte`, replace:

```svelte
  interface Props {
    error?: string
  }

  let { error }: Props = $props()
</script>

<SettingsFieldShell label="Instance URL" {error}>
```

with:

```svelte
  interface Props {
    error?: string
    hint?: string
    required?: boolean
  }

  let { error, hint, required = false }: Props = $props()
</script>

<SettingsFieldShell label="Instance URL" {error} {hint} {required}>
```

(The `required` prop is unused until Task 2; adding it now avoids touching this fixture twice.)

- [ ] **Step 3: Write the failing tests**

Append inside the `describe('field-context', ...)` block in
`tests/client/shared/ui/field-context.test.ts`:

```typescript
  test('points aria-describedby at the hint when the field is valid', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { hint: 'https only' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    const hint = target.querySelector<HTMLElement>('.ui-field__hint')!
    expect(hint.id).toBeTruthy()
    expect(hint.textContent).toContain('https only')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
    void unmount(c)
  })

  test('points aria-describedby at the error when both an error and a hint are set', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { hint: 'https only', error: 'not reachable' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(target.querySelector('.ui-field__hint')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBe(err.id)
    void unmount(c)
  })

  test('omits aria-describedby when the field has neither hint nor error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-describedby')).toBeNull()
    void unmount(c)
  })
```

Add the fixture import to that file's import block, after the `Select` import:

```typescript
import FieldHintFixture from './FieldHintFixture.svelte'
```

Append inside the `describe` block in
`tests/client/settings/components/SettingsFieldShell.test.ts`:

```typescript
  test('points aria-describedby at the hint paragraph when the shell is valid', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ShellInputFixture, { target, props: { hint: 'Needed for self-hosted hosts.' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    const hint = target.querySelector<HTMLElement>('.settings-field__hint')!
    expect(hint.id).toBeTruthy()
    expect(hint.textContent).toContain('Needed for self-hosted hosts.')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
    void unmount(c)
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/field-context.test.ts ./tests/client/settings/components/SettingsFieldShell.test.ts
```

Expected: 2 failures — the two hint tests fail on `hint.id` being `''` (the hint elements
carry no id) and on `aria-describedby` being `null`. The error test and the neither test pass
already; they pin behaviour that must survive the change.

- [ ] **Step 5: Extend the context contract**

In `client/shared/ui/field-context.ts`, replace the `FieldErrorContext` interface:

```typescript
/** Reactive error state a Field publishes to its descendant control. */
export interface FieldErrorContext {
  errorId: string
  /** Getter so the control tracks the Field's live `error` prop. */
  readonly invalid: boolean
}
```

with:

```typescript
/** Reactive field state a Field publishes to its descendant control. */
export interface FieldErrorContext {
  errorId: string
  hintId: string
  /** Getter so the control tracks the Field's live `error` prop. */
  readonly invalid: boolean
  /** Getter so the control tracks a `hint` that appears or disappears after init. */
  readonly hasHint: boolean
}
```

Then replace the `describedBy` getter inside `useFieldInvalid`:

```typescript
    get describedBy() {
      return ctx?.invalid === true ? ctx.errorId : undefined
    },
```

with:

```typescript
    // The error and the hint render in exclusive branches of one {#if}, so exactly one
    // id is ever live and aria-describedby never needs a space-separated list.
    get describedBy() {
      if (ctx === undefined) return undefined
      if (ctx.invalid) return ctx.errorId
      return ctx.hasHint ? ctx.hintId : undefined
    },
```

- [ ] **Step 6: Mint the hint id in `Field`**

In `client/shared/ui/Field.svelte`, replace:

```svelte
  const errorId = `ui-field-err-${uid}`
  setFieldLabelId(labelId)
  setFieldError({
    errorId,
    get invalid() {
      return error !== undefined && error !== ''
    },
  })
```

with:

```svelte
  const errorId = `ui-field-err-${uid}`
  const hintId = `ui-field-hint-${uid}`
  setFieldLabelId(labelId)
  setFieldError({
    errorId,
    hintId,
    get invalid() {
      return error !== undefined && error !== ''
    },
    get hasHint() {
      return hint !== undefined && hint !== ''
    },
  })
```

Then put the id on the hint span — replace:

```svelte
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint">{hint}</span>{/if}
```

with:

```svelte
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint" id={hintId}>{hint}</span>{/if}
```

- [ ] **Step 7: Mint the hint id in `SettingsFieldShell`**

In `client/settings/components/SettingsFieldShell.svelte`, replace:

```svelte
  const errorId = `settings-field-err-${uid}`
  setFieldLabelId(labelId)
  // Getter, not a snapshot: this is what makes the descendant control track the live
  // `error` prop rather than its value at init.
  setFieldError({
    errorId,
    get invalid() {
      return error !== undefined && error !== ''
    },
  })
```

with:

```svelte
  const errorId = `settings-field-err-${uid}`
  const hintId = `settings-field-hint-${uid}`
  setFieldLabelId(labelId)
  // Getter, not a snapshot: this is what makes the descendant control track the live
  // `error` prop rather than its value at init.
  setFieldError({
    errorId,
    hintId,
    get invalid() {
      return error !== undefined && error !== ''
    },
    get hasHint() {
      return hint !== undefined && hint !== ''
    },
  })
```

Then replace:

```svelte
  {:else if hint}<p class="settings-field__hint">{hint}</p>{/if}
```

with:

```svelte
  {:else if hint}<p class="settings-field__hint" id={hintId}>{hint}</p>{/if}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/field-context.test.ts ./tests/client/settings/components/SettingsFieldShell.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 9: Run the sections that consume both publishers**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/settings/
```

Expected: PASS. `ConfigFieldRow.test.ts` is the one to watch — it builds its own id list and
must be unaffected.

- [ ] **Step 10: Format and commit**

```bash
bun run format
git add client/shared/ui/field-context.ts client/shared/ui/Field.svelte client/settings/components/SettingsFieldShell.svelte tests/client/shared/ui/FieldHintFixture.svelte tests/client/shared/ui/field-context.test.ts tests/client/settings/components/ShellInputFixture.svelte tests/client/settings/components/SettingsFieldShell.test.ts
git commit -m "fix(a11y): associate a Field hint with the control it explains

describedBy returned the error id only when invalid, and the hint
rendered in an {:else} branch carrying no id at all, so none of the 27
hints in the settings SPA was ever programmatically associated with its
control. The error and hint are exclusive branches of one {#if}, so
exactly one id is live and no space-separated list is needed.

SettingsFieldShell publishes the same context for the sections using the
head/editor/footer layout and had the identical defect; both publishers
move together so the SPA is never half-migrated."
```

---

### Task 2: Convey required through ARIA, not through a glyph

Closes spec §1.

**Files:**

- Modify: `client/shared/ui/field-context.ts` — `FieldErrorContext`, `FieldInvalidState`, `useFieldInvalid`
- Modify: `client/shared/ui/Field.svelte` — the `setFieldError` call and the `*` span
- Modify: `client/settings/components/SettingsFieldShell.svelte` — the same two places
- Modify: `client/shared/ui/Input.svelte`, `client/shared/ui/Select.svelte`, `client/shared/ui/Combobox.svelte`
- Test: `tests/client/shared/ui/field-context.test.ts`,
  `tests/client/settings/components/SettingsFieldShell.test.ts`

**Interfaces:**

- Consumes: `FieldErrorContext` and `FieldInvalidState` as Task 1 left them; the
  `FieldHintFixture` and `ShellInputFixture` fixtures, which already accept a `required` prop.
- Produces: `FieldInvalidState` gains `readonly required: boolean`. No later task consumes it.

**Note for the implementer:** the `*` becomes `aria-hidden="true"` **and** the control gains
`aria-required` — the two halves are one change. Marking the glyph hidden alone would remove
information; adding `aria-required` alone would leave the glyph inside the accessible name.

That name effect is the point: the label span is what `aria-labelledby` points at, so today
the control's accessible name is "Kaneo URL*" and a screen reader announces the asterisk.
With `aria-hidden` on the glyph, accessible-name computation skips it and the name becomes
"Kaneo URL", with required carried as a state.

Do **not** add a visually-hidden "(required)" text node to the label. Because the label is
referenced by `aria-labelledby`, that text would fold into the *name*, and the control would
announce "Kaneo URL required" as its name and then "required" again as its state. The spec
records this decision in §1.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('field-context', ...)` block in
`tests/client/shared/ui/field-context.test.ts`:

```typescript
  test('sets aria-required on the control when the Field is required', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { required: true } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    void unmount(c)
  })

  test('omits aria-required when the Field is optional', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-required')).toBeNull()
    void unmount(c)
  })

  test('hides the required glyph from the accessibility tree', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { required: true } })
    expect(target.querySelector('.ui-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(c)
  })
```

Append inside the `describe` block in
`tests/client/settings/components/SettingsFieldShell.test.ts`:

```typescript
  test('sets aria-required on the editor control and hides the required glyph', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ShellInputFixture, { target, props: { required: true } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(target.querySelector('.settings-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(c)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/field-context.test.ts ./tests/client/settings/components/SettingsFieldShell.test.ts
```

Expected: 3 failures — both `aria-required` tests fail on `null`, both `aria-hidden` tests
fail on `null`. The "omits aria-required when optional" test passes already; it pins the
negative case.

- [ ] **Step 3: Publish `required` on the context**

In `client/shared/ui/field-context.ts`, add to `FieldErrorContext`, after `hasHint`:

```typescript
  /** Getter so the control tracks a `required` prop that changes after init. */
  readonly required: boolean
```

Add to `FieldInvalidState`, after `describedBy`:

```typescript
  readonly required: boolean
```

Add to the object `useFieldInvalid` returns, after the `describedBy` getter:

```typescript
    get required() {
      return ctx?.required ?? false
    },
```

- [ ] **Step 4: Publish `required` from both publishers**

In `client/shared/ui/Field.svelte`, add to the `setFieldError` object, after the `hasHint`
getter:

```svelte
    get required() {
      return required
    },
```

Then replace the label span's marker:

```svelte
    {label}{#if required}<span class="ui-field__req">*</span>{/if}
```

with:

```svelte
    {label}{#if required}<span class="ui-field__req" aria-hidden="true">*</span>{/if}
```

In `client/settings/components/SettingsFieldShell.svelte`, add the identical `required` getter
to its `setFieldError` object, then replace:

```svelte
    <span class="settings-field__label" id={labelId}>{label}{#if required}<span class="settings-field__req">*</span>{/if}</span>
```

with:

```svelte
    <span class="settings-field__label" id={labelId}>{label}{#if required}<span class="settings-field__req" aria-hidden="true">*</span>{/if}</span>
```

- [ ] **Step 5: Render `aria-required` on all three consumers**

In `client/shared/ui/Input.svelte`, add the attribute to **both** the `textarea` and the
`input`, immediately after their `aria-invalid` line:

```svelte
      aria-required={fieldError.required ? 'true' : undefined}
```

In `client/shared/ui/Select.svelte`, add the same line to the `select`, after its
`aria-invalid` line.

In `client/shared/ui/Combobox.svelte`, add the same line after its `aria-invalid` line
(`Combobox.svelte:46`).

- [ ] **Step 6: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/ ./tests/client/settings/components/
```

Expected: PASS, all tests.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/shared/ui/field-context.ts client/shared/ui/Field.svelte client/shared/ui/Input.svelte client/shared/ui/Select.svelte client/shared/ui/Combobox.svelte client/settings/components/SettingsFieldShell.svelte tests/client/shared/ui/field-context.test.ts tests/client/settings/components/SettingsFieldShell.test.ts
git commit -m "fix(a11y): convey a required field through aria-required

The required marker was a bare asterisk inside the label span, so a
mandatory field and an optional one announced identically apart from the
glyph — which, because the span is what aria-labelledby points at, was
itself read as part of the accessible name.

The glyph becomes decorative and the meaning moves to aria-required on
the control. A visually-hidden \"(required)\" in the label was the other
option and is wrong here: it would fold into the name and double-announce
alongside the state."
```

---

### Task 3: Give the settings document a heading outline

Closes spec §3.

**Files:**

- Modify: `client/shared/ui/PageHeader.svelte:25` and the `.ui-page-header__title` rule
- Modify: `client/settings/SettingsApp.svelte` — the `children` snippet
- Modify: `client/settings/settings.css` — new `.settings-sr-only` utility
- Test: `tests/client/shared/ui/PageHeader.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing consumed by later tasks.

**Note for the implementer:** `PageHeader` is rendered by 30 files. The existing
`.ui-page-header__title` rule already sets `font-family`, `font-size: 20px`,
`font-weight: 700`, `color` and `letter-spacing`, so an `h2` inherits none of the UA heading
type — but it *does* inherit the UA margin, which is why `margin: 0` is part of this change
and not optional. Nothing else about the rendering moves.

The existing test at `PageHeader.test.ts:20` asserts on `.ui-page-header__title` by class, so
it keeps passing across the tag change. Do not rewrite it.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('PageHeader.svelte', ...)` block:

```typescript
  test('renders the title as an h2 so sections form a document outline', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { title: 'Repositories' } })
    const heading = target.querySelector<HTMLElement>('h2')!
    expect(heading.textContent).toBe('Repositories')
    expect(heading.classList.contains('ui-page-header__title')).toBe(true)
    void unmount(c)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/PageHeader.test.ts
```

Expected: FAIL — `target.querySelector('h2')` is `null`, so the non-null assertion throws.

- [ ] **Step 3: Promote the title to a heading**

In `client/shared/ui/PageHeader.svelte`, replace:

```svelte
    <div class="ui-page-header__title" data-testid={titleTestId}>{title}</div>
```

with:

```svelte
    <h2 class="ui-page-header__title" data-testid={titleTestId}>{title}</h2>
```

Then add `margin: 0;` as the first declaration of the `.ui-page-header__title` rule:

```css
  .ui-page-header__title {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.02em;
  }
```

- [ ] **Step 4: Add the visually-hidden utility**

Append to the `/* ---- layout shell ---- */` block in `client/settings/settings.css`, after
the `.settings-section` rule:

```css
/* Roots the settings document outline. Every section's PageHeader renders an h2, so
   without an h1 the outline would start at level 2. Visually absent by design. */
.settings-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Root the outline in the shell**

In `client/settings/SettingsApp.svelte`, replace:

```svelte
    {#snippet children()}
      <SettingsJumpMenu {groups} {activeId} />
```

with:

```svelte
    {#snippet children()}
      <h1 class="settings-sr-only">Settings</h1>
      <SettingsJumpMenu {groups} {activeId} />
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/PageHeader.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 7: Confirm the change is invisible**

Storybook must be running (`bun storybook`); verify with
`curl -s -o /dev/null -w "%{http_code}" http://localhost:6006`, which must print `200`.

```bash
git checkout HEAD~1 -- client/ && sleep 2 && bun shoot -g PageHeader
git checkout HEAD -- client/ && sleep 2 && bunx playwright test -g PageHeader
```

Expected: the second command passes. It rebuilds the PageHeader baselines from the pre-task
code, then compares this task's render against them in **strict** mode. A failure means the UA
heading margin leaked through — fix `margin: 0` rather than accepting the baseline.

Note what is *not* used here: `git status --short .storybook-shots/`. That directory is
gitignored and wholly untracked, so the command is always empty and proves nothing. And note
the absent flag — `bunx playwright test`, not `bun shoot`, because `bun shoot` passes
`--update-snapshots` and would rewrite the evidence instead of failing on it.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/shared/ui/PageHeader.svelte client/settings/SettingsApp.svelte client/settings/settings.css tests/client/shared/ui/PageHeader.test.ts
git commit -m "fix(a11y): render section titles as headings

Every settings section renders stacked into one scrolling main, so each
PageHeader title is a section heading in a single document — but all 30
of them were divs, leaving the SPA with no outline at all and the eleven
h3s that sections already render sitting under nothing.

The title becomes an h2 (margin zeroed, so nothing moves) and the shell
gains a visually-hidden h1 to root the outline. The level is fixed: no
render site needs a second one, and an untested branch would be worse
than adding a prop later."
```

---

### Task 4: Give `Input` the disabled state `Select` already has

Closes spec §4.

**Files:**

- Modify: `client/shared/ui/Input.svelte` — `Props`, both control branches, the wrapper class, the style block
- Modify: `client/shared/ui/Input.stories.svelte` — new story
- Modify: `client/settings/sections/CodeHostSection.svelte:312`–`:317`
- Test: `tests/client/shared/ui/Input.test.ts`, `tests/client/settings/code-host-section.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `Input` gains `disabled?: boolean` (default `false`).

**Note for the implementer:** this is a real bug, not a hypothetical gap.
`CodeHostSection.svelte:309` already passes `disabled={saving || loading}` to its `Select`
while the sibling `Input` on line 312 gets nothing, because the prop did not exist. `saveAll`
reloads on success and `load` replaces `drafts` wholesale, so keystrokes typed during a save
are silently discarded.

Disabled controls are exempt from the WCAG contrast floor and from SC 2.5.8, so `opacity: 0.6`
here needs no token work — it mirrors `.ui-select--disabled` at `Select.svelte:82`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('Input.svelte', ...)` block in
`tests/client/shared/ui/Input.test.ts`:

```typescript
  test('renders a disabled input that emits no onInput', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let seen = ''
    const c = mount(Input, {
      target,
      props: {
        value: '',
        disabled: true,
        testid: 'locked',
        onInput: (v: string) => {
          seen = v
        },
      },
    })
    const input = target.querySelector<HTMLInputElement>('[data-testid="locked"]')!
    expect(input.disabled).toBe(true)
    input.value = 'typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(seen).toBe('')
    void unmount(c)
  })

  test('marks the multiline wrapper disabled too', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Input, { target, props: { value: '', multiline: true, disabled: true } })
    expect(target.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
    expect(target.querySelector('.ui-input--disabled')).not.toBeNull()
    void unmount(c)
  })
```

In `tests/client/settings/code-host-section.test.ts`, add a module-level deferred-save mock
beside the existing `routeCodeHostMock` (around `:251`), matching that file's established
shape — the handler signature is `(url: string, init: RequestInit) => Promise<Response>`
(`tests/utils/test-helpers.ts:1112`), and these mocks live at module level so no `if` appears
inside a test body:

```typescript
let releaseSave: (() => void) | null = null

const routeCodeHostMockDeferredSave = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    return new Promise<Response>((resolve) => {
      releaseSave = (): void => resolve(json({ ok: true }))
    })
  }
  return Promise.resolve(json(unconfiguredPayload))
}
```

Then append inside the top-level `describe` block:

```typescript
  test('locks the text inputs while a save is in flight', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockDeferredSave)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const field = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    field.value = 'ghp_secret'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    expect(target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!.disabled).toBe(true)

    releaseSave?.()
    await drain()
    void unmount(component)
  })
```

The names are verified against live source: the Save button is `code-host-save`
(`CodeHostSection.svelte:346`), the input testid is `coding-input-${field.key}` (`:317`) and
`unconfiguredPayload`'s single field key is `forge_token`. `releaseSave` resolves the pending
PATCH so the component is not left mid-save when the test unmounts.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/Input.test.ts ./tests/client/settings/code-host-section.test.ts
```

Expected: 3 failures. Both `Input` tests fail on `disabled` being `false` (the prop is
ignored). The CodeHostSection test fails on the input still being enabled mid-save.

- [ ] **Step 3: Add the prop**

In `client/shared/ui/Input.svelte`, add to the `Props` interface, after `readonly`:

```typescript
    disabled?: boolean
```

Add to the destructuring, after `readonly = false`:

```typescript
    disabled = false,
```

- [ ] **Step 4: Apply it to the wrapper and both controls**

Replace the wrapper's opening tag:

```svelte
<div
  class="ui-input"
  class:ui-input--multiline={multiline}
  class:ui-input--invalid={fieldError.invalid}
>
```

with:

```svelte
<div
  class="ui-input"
  class:ui-input--multiline={multiline}
  class:ui-input--disabled={disabled}
  class:ui-input--invalid={fieldError.invalid}
>
```

Add `{disabled}` to the `textarea`, immediately after its `{readonly}` line, and to the
`input`, immediately after its `{readonly}` line.

- [ ] **Step 5: Add the disabled styling**

Append to the style block, after the `.ui-input--invalid` rule:

```css
  .ui-input--disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
```

- [ ] **Step 6: Wire the one consumer**

In `client/settings/sections/CodeHostSection.svelte`, replace:

```svelte
                  <Input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[field.key] ?? ''}
                    placeholder={placeholderFor(field)}
                    onInput={(value) => updateDraft(field.key, value)}
                    testid={`coding-input-${field.key}`} />
```

with:

```svelte
                  <Input
                    type={field.sensitive ? 'password' : 'text'}
                    value={drafts[field.key] ?? ''}
                    placeholder={placeholderFor(field)}
                    onInput={(value) => updateDraft(field.key, value)}
                    disabled={saving || loading}
                    testid={`coding-input-${field.key}`} />
```

- [ ] **Step 7: Add the story state**

Append to `client/shared/ui/Input.stories.svelte`:

```svelte
<Story name="Disabled" args={{ value: 'tg:1001', disabled: true }} />
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/shared/ui/Input.test.ts ./tests/client/settings/code-host-section.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add client/shared/ui/Input.svelte client/shared/ui/Input.stories.svelte client/settings/sections/CodeHostSection.svelte tests/client/shared/ui/Input.test.ts tests/client/settings/code-host-section.test.ts
git commit -m "fix(settings): lock the code-host inputs while a save is in flight

CodeHostSection already passed disabled to its Select and could not pass
it to the sibling Inputs, because Input exposed no such prop. saveAll
reloads on success and load replaces drafts wholesale, so anything typed
during a save was silently discarded.

Input gains disabled, mirroring .ui-select--disabled. CodeHostSection is
the only consumer wired here; other sections adopt it when their own
reviews call for it."
```

---

### Task 5: Prove Tasks 1–3 moved no pixels, and baseline the one state that should

Closes the spec's Testing section.

**Files:**

- Regenerate: `tests/visual/shared/ui/Input.spec.ts` — generated region only
- Regenerate: `.storybook-shots/**` — local, gitignored verification artifacts

**Interfaces:**

- Consumes: the `Disabled` story added by Task 4.
- Produces: nothing.

**Prerequisite:** Storybook must be running. Verify with
`curl -s -o /dev/null -w "%{http_code}" http://localhost:6006`, which must print `200`.

---

**Read this before you start — the original gate for this task was wrong.**

The plan told you to run `git status --short .storybook-shots/` and expect one added file and
zero modified ones. That check is inert: `.storybook-shots/` is gitignored *and* entirely
untracked (`git ls-files .storybook-shots/ | wc -l` returns `0`), so that command prints
nothing no matter what changed. It cannot fail, which means it cannot pass either.

Worse, `bun shoot` is `playwright test --update-snapshots`: it silently rewrites any baseline
that differs instead of failing. Together those two facts mean the original procedure would
have reported success against arbitrary visual regressions.

The gate below replaces it. It works by building a reference baseline from the pre-sub-project
code, then comparing the current code against it in **strict** mode (no `--update-snapshots`),
so a moved pixel is a test failure rather than a silent rewrite.

`BASE` for this task is `a1b418f23` — the commit before Task 1, i.e. the last state without
any of sub-project F.

---

- [ ] **Step 1: Revert the sub-project's client code in the working tree**

Do not commit anything in this step and do not touch `tests/`.

```bash
git checkout a1b418f23 -- client/
git status --short
```

Expected: the `client/` files sub-project F touched are listed as modified (staged), and
nothing under `tests/` appears. Give Vite two seconds to pick the change up before shooting.

- [ ] **Step 2: Build the reference baseline from the pre-F code**

```bash
rm -rf .storybook-shots/test-results
bun shoot
```

Expected: all specs pass. This rewrites every baseline PNG to what the code looked like
*before* sub-project F. That is the reference the next step compares against.

Note that `tests/visual/shared/ui/Input.spec.ts` has no `Disabled` test yet — `shoot:gen` has
not run — so the reverted `Input.stories.svelte` lacking that story is consistent, not a
problem.

- [ ] **Step 3: Restore the sub-project's code**

```bash
git checkout HEAD -- client/
git status --short
```

Expected: clean. Again give Vite a moment.

- [ ] **Step 4: The gate — strict comparison, no snapshot updating**

```bash
bunx playwright test
```

Expected: **all specs pass.** Tasks 1–3 changed only semantics — an `id`, two ARIA
attributes, a `div`→`h2` with `margin: 0`, and an absolutely-positioned hidden `h1` — so every
baseline built in Step 2 must still match.

Note the flag that is deliberately absent: this is `bunx playwright test`, not `bun shoot`.
Without `--update-snapshots` a difference fails the run instead of overwriting the evidence.

If anything fails, it is a defect in Tasks 1–3, not a baseline to accept:

- Read the `*-diff.png` and `*-actual.png` Playwright writes under
  `.storybook-shots/test-results/` to see what moved.
- The two likely causes, in order: the UA heading margin leaking through (check
  `margin: 0` really is on `.ui-page-header__title` in `client/shared/ui/PageHeader.svelte`),
  and the hidden `<h1>` taking layout space (check `.settings-sr-only` in
  `client/settings/settings.css` is absolutely positioned and 1×1px).
- Fix the source, then re-run this step. Do **not** re-run `bun shoot` to make it go away —
  that overwrites the reference and destroys the gate.
- Report what you found and what you changed. A failure here is a genuine finding and is more
  valuable than a clean run; do not hide it.

Also expect `Input.spec.ts` to run only its pre-existing tests here — the `Disabled` test is
added in the next step.

- [ ] **Step 5: Generate the Disabled test into the Input spec**

```bash
bun shoot:gen
git diff --stat tests/visual/
```

Expected: `tests/visual/shared/ui/Input.spec.ts` gains a `Disabled` test inside the
`@generated-begin` / `@generated-end` region, and **no other spec file changes**. If another
spec changed, a story elsewhere was touched by mistake — investigate before continuing.

- [ ] **Step 6: Shoot the one new baseline**

```bash
bun shoot -g Input
```

Expected: all Input specs pass, and the new file
`.storybook-shots/shared/ui/Input.spec.ts/shared-ui-Input-Disabled-1.png` exists. Confirm with
`ls .storybook-shots/shared/ui/Input.spec.ts/`.

- [ ] **Step 7: Read the new baseline**

Read `.storybook-shots/shared/ui/Input.spec.ts/shared-ui-Input-Disabled-1.png` with the Read
tool and confirm it shows a visibly dimmed input — distinct from the `Filled` baseline beside
it, and reading as the same state `Select`'s disabled story shows. Say what you actually see;
if it does not look disabled, that is a Task 4 defect worth reporting.

- [ ] **Step 8: Commit**

`.storybook-shots/` is gitignored, so the PNGs are local-only and **only the spec file is
committed**. Do not force-add a PNG and do not edit `.gitignore`; sub-project E hit exactly
this and recorded it in its ledger.

```bash
bun run format
git add tests/visual/shared/ui/Input.spec.ts
git commit -m "test(visual): cover the disabled Input state

The only new baseline this sub-project produces. Tasks 1-3 were
semantics-only, verified by rebuilding every baseline from the pre-F
code and re-running Playwright in strict mode against it."
```

---

## Acceptance

Run from the repository root with Storybook up:

1. `bun run check:full` — lint, typecheck, format, knip and the full test suite pass.
2. The full client suite passes:
   `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' ./tests/client/`
3. The Step 4 strict Playwright run passed with no baseline updated.

Then verify against the spec's own claims:

- Both publishers satisfy the same contract:
  `grep -c "hintId" client/shared/ui/Field.svelte client/settings/components/SettingsFieldShell.svelte`
  returns a non-zero count for each.
- All three consumers render `aria-required`:
  `grep -l "aria-required" client/shared/ui/Input.svelte client/shared/ui/Select.svelte client/shared/ui/Combobox.svelte`
  lists all three.
- Both required glyphs are hidden:
  `grep -c 'ui-field__req" aria-hidden\|settings-field__req" aria-hidden' client/shared/ui/Field.svelte client/settings/components/SettingsFieldShell.svelte`
  returns `1` for each.
- `grep -c '<h2 class="ui-page-header__title"' client/shared/ui/PageHeader.svelte` returns `1`,
  and `grep -rn "ui-page-header__title" client/ --include='*.svelte'` lists only
  `PageHeader.svelte` — no render site bypasses the primitive.
- `ConfigFieldRow.svelte` is untouched **by this sub-project**:
  `git diff a1b418f23..HEAD --stat -- client/settings/components/ConfigFieldRow.svelte`
  is empty. (It was legitimately modified earlier on this branch by sub-project E, so a
  `master...HEAD` diff is *not* the right check.)
- No `level` prop was added to `PageHeader`.

## Not in this plan

Carried forward from the spec's Out-of-scope section, so a reviewer does not read these as
misses:

1. `--fg3` → `--fg-hint` across the settings files and both admin SPAs (54 files reference the
   token) — its own cycle, with the visual re-baseline that implies.
2. A PATCH route for coding repos and the per-row edit affordance it enables (sub-project E's
   deferred item 4).
3. The test-quality minors in E's ledger: the weak `Boolean(errorEl.textContent)` assertion,
   the inert duplicate `drain()`, the brittle `ui-btn--danger` class assertion, the
   `tokens.css` comment overstating its WCAG guarantee, and `SettingsFieldShell.spec.ts`
   missing `pinDefaultViewport()`.
4. `Btn`, which already implements `disabled` and `busy` correctly.
5. Adopting `Input disabled` in sections other than `CodeHostSection`.
