<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AI Output UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 7 findings from the `AiOutputSection` UX review by correcting the shared primitives that carry the defects (`SegmentedControl`, `ConfigFieldRow`, `IconButton`, `Input`) plus one AiOutput-local rewire.

**Architecture:** Front-end only, no server/schema changes. A new `--focus-ring` token in `tokens.css` unifies focus styling; `SegmentedControl` gains a `disabled` and an `ariaDescribedBy` prop; `ConfigFieldRow` gains a `hint` prop that renders inside the card and wires `aria-describedby` on the enum control, brightens the field label, and drops legacy token aliases; `AiOutputSection` stops rendering its own hint `<p>` and passes the copy as a prop.

**Tech Stack:** Svelte 5 (runes: `$props`, `$state`, `$derived`), Bun test runner (`bun:test`) with `svelte`'s `mount`/`flushSync`/`unmount`, `@crvy/strybk` + Playwright for Storybook screenshots, `oxfmt` formatter.

**Spec:** [`docs/superpowers/specs/2026-07-06-ai-output-ux-fixes-design.md`](../specs/2026-07-06-ai-output-ux-fixes-design.md)

---

## Conventions for this plan

- **`.js` import extensions** in TS/Svelte imports (repo rule), even for `.ts` files.
- **No `eslint-disable` / `@ts-ignore`** — the write-hook blocks them.
- Run `bun run format` before committing (formatter is `oxfmt`, not prettier).
- Component unit tests live under `tests/client/**` and mount components with `mount`/`flushSync`/`unmount` from `svelte`. Follow the existing files edited below verbatim.
- Pure-CSS changes cannot be asserted in jsdom; their verification gate is `bun run typecheck`, the existing unit tests still passing, and the Storybook re-shoot in Task 6.

---

## Task 1: Add `--focus-ring` token and adopt it everywhere

Extract the repeated focus-outline literal (`2px solid rgba(82, 224, 138, 0.4)` / `outline-offset: 1px`) into one token and use it in `Btn`, `IconButton`, `SegmentedControl`, and `Input`.

**Files:**

- Modify: `client/shared/tokens.css:36` (add token after the `--success` line)
- Modify: `client/shared/ui/Btn.svelte:74-77`
- Modify: `client/shared/ui/Input.svelte:89-92`
- Modify: `client/shared/ui/IconButton.svelte:42-44` (add rule after `:hover`)
- Modify: `client/shared/ui/SegmentedControl.svelte:63-64` (add rule after `:hover`)

- [ ] **Step 1: Add the token to `tokens.css`**

Insert after line 36 (`--success: var(--accent); ...`), before the `/* ---- type ---- */` comment:

```css
/* ---- focus ---- */
--focus-ring: 2px solid rgba(82, 224, 138, 0.4);
--focus-ring-offset: 1px;
```

- [ ] **Step 2: Point `Btn` at the token**

Replace the existing rule at `client/shared/ui/Btn.svelte:74-77`:

```css
.ui-btn:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 3: Point `Input` at the token**

Replace the existing rule at `client/shared/ui/Input.svelte:89-92`:

```css
.ui-input:focus-within {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 4: Add a focus rule to `IconButton`**

In `client/shared/ui/IconButton.svelte`, add immediately after the `.ui-iconbtn:hover { ... }` line (currently line 43):

```css
.ui-iconbtn:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 5: Add a focus rule to `SegmentedControl`**

In `client/shared/ui/SegmentedControl.svelte`, add immediately after the `.ui-seg__opt:last-child { border-right: 0; }` line (currently line 63). Use a negative offset because `.ui-seg` sets `overflow: hidden`, which would clip a positive outline offset:

```css
.ui-seg__opt:focus-visible {
  outline: var(--focus-ring);
  outline-offset: -2px;
}
```

- [ ] **Step 6: Verify typecheck and existing tests pass**

Run: `bun run typecheck && bun test tests/client/shared/ui/`
Expected: typecheck clean; all existing `Btn`/`Input`/`IconButton`/`SegmentedControl`/`Dot`/`StatusPill`/`ErrorState` tests PASS (no behavioral change, only CSS).

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/shared/tokens.css client/shared/ui/Btn.svelte client/shared/ui/Input.svelte client/shared/ui/IconButton.svelte client/shared/ui/SegmentedControl.svelte
git commit -m "refactor(ui): add --focus-ring token and adopt in shared controls"
```

---

## Task 2: SegmentedControl visual polish (contrast + height/radius)

Lift the resting option color off the too-dim `--text-dim`, and shrink the control to match the `sm` button height and control radius so it aligns with the Clear button beside it.

**Files:**

- Modify: `client/shared/ui/SegmentedControl.svelte:45-70` (the `<style>` block)

- [ ] **Step 1: Replace the `.ui-seg` and `.ui-seg__opt` base rules**

In `client/shared/ui/SegmentedControl.svelte`, change `.ui-seg`'s radius from `var(--radius)` to `var(--radius-control)`, and in `.ui-seg__opt` change `color: var(--text-dim)` → `color: var(--text-muted)`, `padding: 4px 12px` → `padding: 0 10px`, and `height: 26px` → `height: 22px`. Also guard the hover rule so disabled options (added in Task 3) don't highlight. The full resulting `<style>` block (including the focus rule from Task 1) is:

```css
<style>
  .ui-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    overflow: hidden;
  }
  .ui-seg__opt {
    background: var(--surface-2);
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 0 10px;
    height: 22px;
  }
  .ui-seg__opt:last-child { border-right: 0; }
  .ui-seg__opt:focus-visible {
    outline: var(--focus-ring);
    outline-offset: -2px;
  }
  .ui-seg__opt:hover:not(:disabled) { color: var(--text); background: var(--surface-hover); }
  .ui-seg__opt--on {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }
</style>
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bun test tests/client/shared/ui/SegmentedControl.test.ts`
Expected: all 6 existing tests PASS (they assert roles/aria/onChange, none assert color or size).

- [ ] **Step 3: Format and commit**

```bash
bun run format
git add client/shared/ui/SegmentedControl.svelte
git commit -m "fix(ui): raise SegmentedControl contrast and align height/radius to sm controls"
```

---

## Task 3: SegmentedControl gains `disabled` and `ariaDescribedBy` props

Add a `disabled` prop (freezes the control during an in-flight save) and an `ariaDescribedBy` prop (associates the radiogroup with a description). TDD.

**Files:**

- Modify: `client/shared/ui/SegmentedControl.svelte:6-43` (props + `onKey` + markup)
- Test: `tests/client/shared/ui/SegmentedControl.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/shared/ui/SegmentedControl.test.ts` (the file already imports `mount`, `flushSync`, `unmount`, and defines `options`):

```ts
test('disabled options render the native disabled attribute', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm', disabled: true },
  })
  flushSync()
  expect(target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!.disabled).toBe(true)
  void unmount(c)
})

test('clicking a disabled option does not call onChange', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: () => {
        calls++
      },
      testidPrefix: 'perm',
      disabled: true,
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="perm-deny"]')!.click()
  expect(calls).toBe(0)
  void unmount(c)
})

test('ArrowRight on a disabled control does not call onChange', () => {
  let calls = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: () => {
        calls++
      },
      testidPrefix: 'perm',
      disabled: true,
    },
  })
  flushSync()
  const allow = target.querySelector<HTMLButtonElement>('[data-testid="perm-allow"]')!
  allow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  expect(calls).toBe(0)
  void unmount(c)
})

test('sets aria-describedby on the radiogroup when ariaDescribedBy is provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'ask',
      ariaLabel: 'Permission',
      onChange: () => {},
      testidPrefix: 'perm',
      ariaDescribedBy: 'hint-1',
    },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBe('hint-1')
  void unmount(c)
})

test('omits aria-describedby when ariaDescribedBy is not provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/shared/ui/SegmentedControl.test.ts`
Expected: the 5 new tests FAIL (the `disabled` attribute is not set / `aria-describedby` is absent), existing 6 PASS.

- [ ] **Step 3: Implement the props**

In `client/shared/ui/SegmentedControl.svelte`, replace the props block (`interface Props { ... }` and the `let { ... } = $props()` at lines 11-18) with:

```svelte
  interface Props {
    options: readonly Option[]
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    testidPrefix?: string
    disabled?: boolean
    ariaDescribedBy?: string
  }
  let { options, value, ariaLabel, onChange, testidPrefix, disabled = false, ariaDescribedBy }: Props = $props()
```

Guard `onKey` so a dispatched keydown on a disabled control is a no-op. Change the function body (lines 20-25) to:

```svelte
  function onKey(event: KeyboardEvent, index: number): void {
    if (disabled) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    onChange(options[(index + delta + options.length) % options.length]!.value)
  }
```

Update the markup (lines 28-43) to set `aria-describedby` on the group and `disabled` on each option button:

```svelte
<div class="ui-seg" role="radiogroup" aria-label={ariaLabel} aria-describedby={ariaDescribedBy}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value ? 'true' : 'false'}
      tabindex={value === opt.value ? 0 : -1}
      class="ui-seg__opt"
      class:ui-seg__opt--on={value === opt.value}
      {disabled}
      data-testid={testidPrefix ? `${testidPrefix}-${opt.value}` : undefined}
      onclick={() => onChange(opt.value)}
      onkeydown={(e) => onKey(e, i)}>
      {opt.label}
    </button>
  {/each}
</div>
```

Add a disabled style rule inside `<style>`, after the `.ui-seg__opt:hover:not(:disabled)` rule:

```css
.ui-seg__opt:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/client/shared/ui/SegmentedControl.test.ts`
Expected: all 11 tests PASS.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/shared/ui/SegmentedControl.svelte tests/client/shared/ui/SegmentedControl.test.ts
git commit -m "feat(ui): add disabled and ariaDescribedBy props to SegmentedControl"
```

---

## Task 4: ConfigFieldRow — hint, aria wiring, in-flight disable, label + alias

Add a `hint` prop that renders inside the card, wire `aria-describedby` on the enum control, freeze the enum control while a save is in flight, brighten the label, and drop the legacy `--surface` alias. TDD for the three behavioral changes; the label/alias changes are CSS in the same file.

**Files:**

- Modify: `client/settings/components/ConfigFieldRow.svelte` (props `:18-24`, enum branch `:107-126`, text branch `:127-166`, styles `:179-208`)
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/components/ConfigFieldRow.test.ts` (inside the `describe('ConfigFieldRow', ...)` block, before its closing `})`). The file already defines `render`, `drain`, `json`, `setMockFetch`, `setCsrfToken`:

```ts
test('renders the hint paragraph with a stable id and wires aria-describedby when hint is provided', () => {
  setMockFetch(() => Promise.resolve(json({})))
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Standard' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: 'sanitized',
    },
    hint: 'Raw detail shows unredacted tool inputs/outputs and reasoning in chat.',
    onSaved: () => undefined,
  })
  flushSync()
  const hintEl = target.querySelector('#cfg-hint-ai_output_detail_level')
  expect(hintEl).not.toBeNull()
  expect(hintEl!.textContent).toContain('unredacted')
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBe(
    'cfg-hint-ai_output_detail_level',
  )
  void unmount(component)
})

test('omits the hint paragraph and aria-describedby when no hint is provided', () => {
  setMockFetch(() => Promise.resolve(json({})))
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Standard' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: 'sanitized',
    },
    onSaved: () => undefined,
  })
  flushSync()
  expect(target.querySelector('#cfg-hint-ai_output_detail_level')).toBeNull()
  expect(target.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')).toBeNull()
  void unmount(component)
})

test('disables the segmented control while an enum save is in flight', async () => {
  setCsrfToken('c')
  let release!: (r: Response) => void
  setMockFetch(
    () =>
      new Promise<Response>((res) => {
        release = res
      }),
  )
  const { component, target } = render({
    contextId: 'user:1',
    field: {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Standard' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: 'sanitized',
    },
    onSaved: () => undefined,
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_output_detail_level-raw"]')!.click()
  await drain()
  const rawBtn = target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_output_detail_level-raw"]')!
  expect(rawBtn.disabled).toBe(true)
  release(json({ ok: true, contextId: 'user:1' }))
  await drain()
  expect(rawBtn.disabled).toBe(false)
  void unmount(component)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: the 3 new tests FAIL (no `hint` rendering, no `aria-describedby`, control not disabled mid-save); all pre-existing tests PASS.

- [ ] **Step 3: Add the `hint` prop and a derived hint id**

In `client/settings/components/ConfigFieldRow.svelte`, extend the `Props` interface and destructure (lines 18-24). Result:

```svelte
  interface Props {
    contextId: string
    field: ConfigField
    onSaved: () => void
    hint?: string
  }

  let { contextId, field, onSaved, hint }: Props = $props()
```

Add a derived id near the other `$derived` declarations (e.g. after the `editorOpen` derived at line 37):

```svelte
  const hintId = $derived(`cfg-hint-${field.key}`)
```

- [ ] **Step 4: Wire the enum branch (disabled + aria-describedby + hint paragraph)**

Replace the enum branch (`{#if isEnum} ... {/if}` before the `{:else}`, lines 107-126) with:

```svelte
{#if isEnum}
  <div class="settings-field" data-testid={`cfg-row-${field.key}`}>
    <div class="settings-field__head">
      <span class="t-label settings-field__label">{field.label}</span>
      <SegmentedControl
        options={field.options ?? []}
        value={current}
        ariaLabel={field.label}
        ariaDescribedBy={hint ? hintId : undefined}
        disabled={saving}
        onChange={(v) => void saveEnum(v)}
        testidPrefix={`cfg-seg-${field.key}`} />
      {#if field.hasValue}
        <Btn variant="outline" size="sm" disabled={saving} testid={`cfg-clear-${field.key}`} onClick={() => (pendingClear = true)}>
          {#snippet children()}Clear{/snippet}
        </Btn>
      {/if}
    </div>
    {#if error !== null}
      <p class="status-error">{error}</p>
    {/if}
    {#if hint}
      <p class="settings-field__hint" id={hintId}>{hint}</p>
    {/if}
  </div>
{:else}
```

- [ ] **Step 5: Render the hint in the text branch too**

In the text branch (`{:else}` ... `{/if}`), add the hint paragraph just before the closing `</div>` of `.settings-field` (i.e. after the existing `{#if error !== null}...{/if}` block near line 165). Note: for text fields the hint renders but is not programmatically associated with the input, because `Input` derives its own `aria-describedby` from field-error state and takes no external describedby prop; this is out of scope for this pass (the AiOutput field is an enum). Add:

```svelte
    {#if hint}
      <p class="settings-field__hint" id={hintId}>{hint}</p>
    {/if}
```

- [ ] **Step 6: Update styles — label color, surface alias, hint style**

In the `<style>` block: change `.settings-field` background from `var(--surface)` to `var(--surface-1)`; change `.settings-field__label` color from `var(--fg2)` to `var(--text)`; and add a `.settings-field__hint` rule. The relevant rules become:

```css
.settings-field {
  display: grid;
  gap: var(--gap-tight);
  padding: var(--gap-inline);
  border: 1px solid var(--border);
  background: var(--surface-1);
}
.settings-field__label {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  margin-right: auto;
}
.settings-field__hint {
  color: var(--text-muted);
  font-size: 12px;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/client/settings/components/ConfigFieldRow.test.ts`
Expected: all tests PASS (new 3 + all pre-existing).

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/settings/components/ConfigFieldRow.svelte tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "feat(settings): ConfigFieldRow hint prop, aria wiring, in-flight disable, brighter label"
```

---

## Task 5: AiOutputSection — relocate the hint into the card via the prop

Stop rendering the standalone hint `<p>` and pass the copy to `ConfigFieldRow` so it renders inside the card and is wired for accessibility.

**Files:**

- Modify: `client/settings/sections/AiOutputSection.svelte:71-92` (the field-list block + `<style>`)

- [ ] **Step 1: Pass the hint through `ConfigFieldRow` and remove the standalone paragraph**

Replace the field-list block (lines 71-80, from `{:else}` through the closing `{/if}` of the state machine) with:

```svelte
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow
          {contextId}
          {field}
          hint={field.key === 'ai_output_detail_level'
            ? 'Raw detail shows unredacted tool inputs/outputs and reasoning in chat.'
            : undefined}
          onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}
```

- [ ] **Step 2: Remove the now-unused `.ai-output-hint` style**

In the `<style>` block, delete the `.ai-output-hint` rule (lines 88-91), leaving only `.settings-field-list`:

```svelte
<style>
  .settings-field-list {
    display: grid;
    gap: var(--gap-inline);
  }
</style>
```

- [ ] **Step 3: Verify no dangling reference and typecheck**

Run: `grep -n "ai-output-hint" client/settings/sections/AiOutputSection.svelte; bun run typecheck`
Expected: `grep` prints nothing (class fully removed); typecheck clean.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add client/settings/sections/AiOutputSection.svelte
git commit -m "fix(settings): render AiOutput hint inside the field card via ConfigFieldRow"
```

---

## Task 6: Re-shoot affected Storybook sections and run the full check

The CSS/markup changes ripple to every section using `SegmentedControl`/`ConfigFieldRow`. Re-shoot their baselines and run the repo check gate.

**Files:**

- Update baselines under: `.storybook-shots/settings/sections/{AiOutputSection,ToolsSection,TaskProviderSection,ProfileSection}.spec.ts/`

- [ ] **Step 1: Ensure Storybook is running**

Run (in a separate terminal, kept warm): `bun storybook`
Expected: serves on `http://localhost:6006`. Confirm with `curl -s -o /dev/null -w "%{http_code}" http://localhost:6006/` → `200`.

- [ ] **Step 2: Re-shoot the four affected sections**

Run: `bun shoot -g AiOutputSection && bun shoot -g ToolsSection && bun shoot -g TaskProviderSection && bun shoot -g ProfileSection`
Expected: PASS; baseline PNGs re-generated for each spec.

- [ ] **Step 3: Eyeball the new baselines**

Read these PNGs and confirm the fixes landed:

- `.storybook-shots/settings/sections/AiOutputSection.spec.ts/settings-sections-AiOutputSection-Populated-1.png` — the "Raw" segment label is clearly readable (not near-invisible); the "Output detail level" label reads brighter than the hint; segment height/radius match the Clear button; the hint sits inside the field card.
- `.storybook-shots/settings/sections/ToolsSection.spec.ts/...` and `.../TaskProviderSection.spec.ts/...` and `.../ProfileSection.spec.ts/...` — no unintended visual regressions; segmented controls and config rows look consistent.

- [ ] **Step 4: Run the full check gate**

Run: `bun run check`
Expected: lint, typecheck, format:check, license-headers, and tests all PASS.

- [ ] **Step 5: Commit the updated baselines**

```bash
git add .storybook-shots/settings/sections/AiOutputSection.spec.ts .storybook-shots/settings/sections/ToolsSection.spec.ts .storybook-shots/settings/sections/TaskProviderSection.spec.ts .storybook-shots/settings/sections/ProfileSection.spec.ts
git commit -m "test(visual): re-shoot settings sections after AiOutput UX fixes"
```

---

## Verification checklist (map to spec findings)

- **Finding 1 (contrast):** Task 2 — resting segment color `--text-muted`; verified visually in Task 6.3.
- **Finding 2 (aria-describedby):** Task 3 + Task 4 — `ariaDescribedBy` prop + hint wiring; unit-tested.
- **Finding 3 (in-flight):** Task 3 (`disabled` prop) + Task 4 (`disabled={saving}`); unit-tested.
- **Finding 4 (height/radius):** Task 2 — 22px height, `--radius-control`; verified visually.
- **Finding 5 (hierarchy):** Task 4 — label → `--text`; verified visually.
- **Finding 6 (focus rings):** Task 1 — `--focus-ring` on SegmentedControl + IconButton (and Btn/Input).
- **Finding 7 (legacy aliases):** Task 4 — `--surface` → `--surface-1`, `--fg2` label → `--text`.

## Non-goals (carried from the spec)

- No repo-wide legacy-alias migration; only `ConfigFieldRow` is touched.
- No `ConfigField` schema/fetcher change; the hint is a component prop.
- Text-field hint→input `aria-describedby` association is not wired (AiOutput is enum-only); the hint still renders for text fields.
