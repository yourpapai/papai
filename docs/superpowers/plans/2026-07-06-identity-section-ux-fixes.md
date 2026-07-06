<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# IdentitySection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 findings from the IdentitySection UX review — destructive-action affordance/confirmation, in-flight feedback, first-run guidance, inline validation, and adoption of the shared state primitives.

**Architecture:** Approach B from the spec — replace the ad-hoc render ladder in `IdentitySection.svelte` with one derived, mutually-exclusive `view` (`loading | gated | loadError | form`) plus transient overlay flags (`saving`, `clearing`, `confirmingClear`, `validationError`, `saveError`, `saved`). Add a backward-compatible `error` prop to the shared `Field`/`Input` primitives so inline field validation works app-wide. Feedback is verified through the Storybook screenshot harness (this repo has no component-logic test framework for these sections).

**Tech Stack:** Svelte 5 (runes), TypeScript (`.js` import extensions), MSW story fixtures, `@crvy/strybk` Playwright screenshot harness.

**Spec:** [`docs/superpowers/specs/2026-07-06-identity-section-ux-fixes-design.md`](../specs/2026-07-06-identity-section-ux-fixes-design.md)

---

## File Structure

**Shared primitives (Task 1):**

- `client/shared/ui/field-context.ts` — add a second context channel carrying `{ errorId, invalid }` (separate `Symbol` from the label id, so `Select.svelte` is untouched).
- `client/shared/ui/Field.svelte` — new optional `error?: string`; renders the error line and publishes the error context.
- `client/shared/ui/Input.svelte` — reads the error context; wires `aria-invalid` / `aria-describedby` and a danger-border class.
- `client/shared/ui/Field.stories.svelte` — add an `Invalid` story exercising `Field` + `Input`.

**Section rework (Task 2):**

- `client/settings/sections/IdentitySection.svelte` — full rewrite to the view model.

**Gated state (Task 3):**

- `client/stories/msw/settings-handlers-personal.ts` — add `identityGatedHandlers` (HTTP 422).
- `client/stories/msw/scenarios.ts` — register `settings-identity-gated`.
- `client/settings/sections/IdentitySection.stories.svelte` — add a `Gated` story.

**Interaction screenshots (Task 4):**

- `tests/visual/settings/sections/IdentitySection.spec.ts` — manual states (validation-error, saving, clear-confirm-open).

---

## Task 1: Shared `Field` error prop

**Files:**

- Modify: `client/shared/ui/field-context.ts`
- Modify: `client/shared/ui/Field.svelte`
- Modify: `client/shared/ui/Input.svelte`
- Modify: `client/shared/ui/Field.stories.svelte`
- Screenshot: `.storybook-shots/shared/ui/Field.spec.ts/…`

- [ ] **Step 1: Add the error context channel**

Edit `client/shared/ui/field-context.ts` — keep the existing label functions, append a new channel below line 18:

```ts
const FIELD_ERROR = Symbol('field-error')

/** Reactive error state a Field publishes to its descendant control. */
export interface FieldErrorContext {
  errorId: string
  /** Getter so the control tracks the Field's live `error` prop. */
  readonly invalid: boolean
}

/** Called by Field during init to publish its error state to descendant controls. */
export function setFieldError(ctx: FieldErrorContext): void {
  setContext(FIELD_ERROR, ctx)
}

/** Called by Input/Select during init; returns the enclosing Field's error context, if any. */
export function getFieldError(): FieldErrorContext | undefined {
  return getContext<FieldErrorContext | undefined>(FIELD_ERROR)
}
```

- [ ] **Step 2: Add the `error` prop to `Field.svelte`**

Keep the existing `<script module lang="ts">` block (`let seq = 0`) at the top — `++seq` below depends on it. Replace only the `<script lang="ts">` block and the markup in `client/shared/ui/Field.svelte` with:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  import { setFieldError, setFieldLabelId } from './field-context.js'

  interface Props {
    label: string
    children: Snippet
    required?: boolean
    hint?: string
    error?: string
  }

  let { label, children, required = false, hint, error }: Props = $props()

  const uid = ++seq
  const labelId = `ui-field-${uid}`
  const errorId = `ui-field-err-${uid}`
  setFieldLabelId(labelId)
  setFieldError({
    errorId,
    get invalid() {
      return error !== undefined && error !== ''
    },
  })
</script>

<div class="ui-field">
  <span class="ui-field__label" id={labelId}>
    {label}{#if required}<span class="ui-field__req">*</span>{/if}
  </span>
  {@render children()}
  {#if error}<span class="ui-field__error" id={errorId} role="alert">{error}</span>{:else if hint}<span
      class="ui-field__hint">{hint}</span>{/if}
</div>
```

Then add to the `<style>` block, after `.ui-field__hint`:

```css
.ui-field__error {
  font-size: 10px;
  color: var(--danger);
}
```

- [ ] **Step 3: Wire invalid state into `Input.svelte`**

In `client/shared/ui/Input.svelte`, change the import at line 9 to also pull `getFieldError`:

```ts
import { getFieldError, getFieldLabelId } from './field-context.js'
```

Add below `const labelId = getFieldLabelId()` (line 35):

```ts
const fieldError = getFieldError()
```

Replace the wrapper `<div>` opening tag and both control elements so invalid state reaches them:

```svelte
<div
  class="ui-input"
  class:ui-input--multiline={multiline}
  class:ui-input--invalid={fieldError?.invalid}
>
  {#if multiline}
    <textarea
      {placeholder}
      {value}
      {readonly}
      {rows}
      aria-labelledby={labelId}
      aria-invalid={fieldError?.invalid ? 'true' : undefined}
      aria-describedby={fieldError?.invalid ? fieldError.errorId : undefined}
      data-testid={testid}
      oninput={handleInput}
    ></textarea>
  {:else}
    {#if prefix}
      <span class="ui-input__prefix">{@render prefix()}</span>
    {/if}
    <input
      {type}
      {placeholder}
      {value}
      {readonly}
      aria-labelledby={labelId}
      aria-invalid={fieldError?.invalid ? 'true' : undefined}
      aria-describedby={fieldError?.invalid ? fieldError.errorId : undefined}
      data-testid={testid}
      oninput={handleInput} />
  {/if}
</div>
```

Add to the `<style>` block, after the `.ui-input:focus-within` rule:

```css
.ui-input--invalid {
  border-color: var(--danger);
}
```

- [ ] **Step 4: Add the `Invalid` story**

Replace `client/shared/ui/Field.stories.svelte` body with (adds an `Input` import and an `Invalid` story):

```svelte
<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Field from './Field.svelte'
  import Input from './Input.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Field',
    component: Field,
  })
</script>

<Story name="Basic" args={{ label: 'user id' }}>
  {#snippet children()}<input placeholder="auto" />{/snippet}
</Story>

<Story name="Required with hint" args={{ label: 'kaneo url', required: true, hint: 'https only' }}>
  {#snippet children()}<input placeholder="https://…" />{/snippet}
</Story>

<Story name="Invalid" args={{ label: 'user id', required: true, error: 'Provider user ID is required.' }}>
  {#snippet children()}<Input value="" placeholder="e.g. 42" />{/snippet}
</Story>
```

- [ ] **Step 5: Regenerate the screenshot spec for the new story**

Run: `bun shoot:gen`
Expected: exits 0; `tests/visual/shared/ui/Field.spec.ts` now contains an `Invalid` test in its `@generated` block (also reformats — no other functional change).

- [ ] **Step 6: Shoot the Field stories**

Run: `bun shoot -g Field`
Expected: all Field tests pass; a new baseline `settings…/shared/ui/Field.spec.ts/…Invalid-1.png` is written.

- [ ] **Step 7: Verify the Invalid screenshot**

Read the new `…Field.spec.ts/…Invalid-1.png` baseline.
Confirm: the input has a red (`--danger`) border and the red "Provider user ID is required." line renders below it (not the hint).

- [ ] **Step 8: Commit**

```bash
git add client/shared/ui/field-context.ts client/shared/ui/Field.svelte client/shared/ui/Input.svelte \
  client/shared/ui/Field.stories.svelte tests/visual/shared/ui/Field.spec.ts .storybook-shots/shared/ui/Field.spec.ts
git commit -m "feat(ui): add error prop to shared Field/Input primitives"
```

(The commit hook runs lint + typecheck + format + license — a green commit confirms types.)

---

## Task 2: Rewrite `IdentitySection.svelte` to the view model

**Files:**

- Modify (full rewrite of `<script>`/markup/`<style>`): `client/settings/sections/IdentitySection.svelte`
- Screenshots: `.storybook-shots/settings/sections/IdentitySection.spec.ts/…` (Populated, Empty, Error re-baselined)

- [ ] **Step 1: Replace the component**

Overwrite `client/settings/sections/IdentitySection.svelte` (keep the 4-line SPDX header at the top) with:

```svelte
<script lang="ts">
  import type { IdentityResponse } from '../fetcher-schemas.js'
  import { deleteIdentity, fetchIdentity, putIdentity } from '../fetchers.js'
  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let data: IdentityResponse | null = $state(null)
  let loadError: string | null = $state(null)
  let loading = $state(false)

  let providerUserId = $state('')
  let providerUserLogin = $state('')
  let displayName = $state('')

  let saving = $state(false)
  let clearing = $state(false)
  let confirmingClear = $state(false)
  let validationError: string | null = $state(null)
  let saveError: string | null = $state(null)
  let saved = $state(false)

  const providerName = $derived(data?.providerName ?? 'your task provider')
  const headerTitle = $derived(data !== null ? `Identity · ${data.providerName}` : 'Identity')
  const hasMapping = $derived(data?.mapping != null)

  const view = $derived(
    data !== null
      ? 'form'
      : loadError !== null
        ? loadError.includes('no task instance')
          ? 'gated'
          : 'loadError'
        : 'loading',
  )

  async function load(id: string): Promise<void> {
    loadError = null
    saveError = null
    validationError = null
    saved = false
    data = null
    loading = true
    try {
      const result = await fetchIdentity(id)
      data = result
      const m = result.mapping
      providerUserId = m?.providerUserId ?? ''
      providerUserLogin = m?.providerUserLogin ?? ''
      displayName = m?.displayName ?? ''
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    saveError = null
    saved = false
    if (providerUserId.trim() === '') {
      validationError = 'Provider user ID is required.'
      return
    }
    validationError = null
    saving = true
    try {
      await putIdentity({ providerUserId, providerUserLogin, displayName, contextId })
      await load(contextId)
      saved = true
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  async function confirmClear(): Promise<void> {
    clearing = true
    try {
      await deleteIdentity(contextId)
      confirmingClear = false
      await load(contextId)
    } catch (err) {
      confirmingClear = false
      saveError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="identity" class="settings-section">
  <PageHeader eyebrow="Personal" title={headerTitle}>
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load(contextId)}
        testid="identity-refresh" />
    {/snippet}
  </PageHeader>

  {#if view === 'loading'}
    <p class="placeholder">Loading…</p>
  {:else if view === 'gated'}
    <EmptyState
      title="No task provider configured"
      hint="Assign a task provider to this context before linking your identity."
    >
      {#snippet action()}
        <a class="settings-empty-link" href="#task-provider">Configure task provider →</a>
      {/snippet}
    </EmptyState>
  {:else if view === 'loadError'}
    <ErrorState message={loadError ?? ''} onRetry={() => void load(contextId)} />
  {:else}
    <p class="identity-intro">
      Link your chat account to your {providerName} account so the bot can create and assign tasks as you.
    </p>
    <form
      class="settings-form identity-form"
      onsubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <Field
        label="Provider user ID"
        required
        hint={`Your account ID in ${providerName} — from your tracker profile or user URL.`}
        error={validationError ?? undefined}
      >
        {#snippet children()}
          <Input
            value={providerUserId}
            placeholder="e.g. 42"
            onInput={(v) => (providerUserId = v)}
            testid="identity-user-id" />
        {/snippet}
      </Field>
      <Field label="Provider login" hint={`Your ${providerName} username, if different from the ID.`}>
        {#snippet children()}
          <Input value={providerUserLogin} placeholder="e.g. alice" onInput={(v) => (providerUserLogin = v)} />
        {/snippet}
      </Field>
      <Field label="Display name" hint="Name shown on tasks the bot creates for you.">
        {#snippet children()}
          <Input value={displayName} placeholder="e.g. Alice" onInput={(v) => (displayName = v)} />
        {/snippet}
      </Field>
      <div class="identity-actions">
        <Btn variant="primary" type="submit" busy={saving} disabled={saving} testid="identity-save">
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
        {#if hasMapping}
          <Btn variant="danger" testid="identity-clear" onClick={() => (confirmingClear = true)}>
            {#snippet children()}Clear{/snippet}
          </Btn>
        {/if}
      </div>
    </form>
    <div class="identity-status" aria-live="polite">
      {#if saveError !== null}<p class="status-error" data-testid="identity-save-error">{saveError}</p>{/if}
      {#if saved}<p class="status-success">Identity saved.</p>{/if}
    </div>
  {/if}
</section>

<Confirm
  open={confirmingClear}
  title="Clear identity?"
  danger
  busy={clearing}
  confirmLabel="Clear"
  onCancel={() => (confirmingClear = false)}
  onConfirm={() => void confirmClear()}
>
  {#snippet body()}
    <p>
      This removes the link between your chat account and {providerName}. The bot will stop acting as you until you set
      it again.
    </p>
  {/snippet}
</Confirm>

<style>
  .identity-intro {
    max-width: 520px;
    margin-bottom: var(--gap-field);
    color: var(--fg2);
    font-size: 12px;
  }
  .identity-form {
    max-width: 520px;
  }
  .identity-actions {
    display: flex;
    gap: var(--gap-inline);
  }
  .identity-status {
    margin-top: var(--gap-inline);
  }
</style>
```

- [ ] **Step 2: Re-shoot the existing Identity stories**

Run: `bun shoot -g IdentitySection`
Expected: Populated, Empty, Error, Loading (+ the Task-earlier manual states) pass; baselines are rewritten.

- [ ] **Step 3: Verify the re-baselined states**

Read these baselines under `.storybook-shots/settings/sections/IdentitySection.spec.ts/`:

- `…Populated-1.png` — intro line present; three hints under the inputs; **Clear renders as a red (danger) button**; Save present; form capped to ~520px (not full-bleed).
- `…Empty-1.png` — same guided form with empty inputs and placeholders; **no Clear button** (no mapping).
- `…Error-1.png` — centered `ErrorState` card ("Something went wrong" + "boom" + "Try again"); **no editable form** underneath.

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/IdentitySection.svelte .storybook-shots/settings/sections/IdentitySection.spec.ts
git commit -m "fix(settings): rework IdentitySection state model, feedback, and guidance"
```

---

## Task 3: Gated (no-task-provider) state

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal.ts`
- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/settings/sections/IdentitySection.stories.svelte`
- Modify (generated): `tests/visual/settings/sections/IdentitySection.spec.ts`

- [ ] **Step 1: Add the 422 gated handler**

In `client/stories/msw/settings-handlers-personal.ts`, immediately after the `identityHandlers` export (after line 192), add:

```ts
// Gated: context has no task instance, so identity cannot be mapped (HTTP 422).
export const identityGatedHandlers: HttpHandler[] = [
  http.get('/settings/api/identity', () =>
    HttpResponse.json({ error: 'no task instance configured for this context' }, { status: 422 }),
  ),
]
```

- [ ] **Step 2: Register the scenario**

In `client/stories/msw/scenarios.ts`, add `identityGatedHandlers` to the existing import from `./settings-handlers-personal.js` (the block that already imports `identityHandlers`), then add this line directly below `'settings-identity-loading': [...identityHandlers.loading],`:

```ts
  'settings-identity-gated': [...identityGatedHandlers],
```

- [ ] **Step 3: Add the `Gated` story**

In `client/settings/sections/IdentitySection.stories.svelte`, add below the `Loading` story (line 27):

```svelte
<!-- no task instance configured: gated empty state -->
<Story name="Gated" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-identity-gated' }} />
```

- [ ] **Step 4: Regenerate the screenshot spec**

Run: `bun shoot:gen`
Expected: exits 0; `tests/visual/settings/sections/IdentitySection.spec.ts` gains a `Gated` test inside its `@generated` block.

- [ ] **Step 5: Shoot and verify**

Run: `bun shoot -g IdentitySection`
Then Read `.storybook-shots/settings/sections/IdentitySection.spec.ts/…Gated-1.png`.
Confirm: a centered `EmptyState` ("No task provider configured" + hint) with a green "Configure task provider →" link, and **no form**.

- [ ] **Step 6: Commit**

```bash
git add client/stories/msw/settings-handlers-personal.ts client/stories/msw/scenarios.ts \
  client/settings/sections/IdentitySection.stories.svelte tests/visual/settings/sections/IdentitySection.spec.ts \
  .storybook-shots/settings/sections/IdentitySection.spec.ts
git commit -m "test(settings): add IdentitySection gated (no-task-provider) story"
```

---

## Task 4: Interaction screenshots (validation, saving, confirm)

**Files:**

- Modify: `tests/visual/settings/sections/IdentitySection.spec.ts` (manual region only)
- Screenshots: new baselines under `.storybook-shots/settings/sections/IdentitySection.spec.ts/`

- [ ] **Step 1: Replace the manual region of the spec**

In `tests/visual/settings/sections/IdentitySection.spec.ts`, replace everything **below** the `// @generated-end auto-screenshots` line with:

```ts
test.describe('settings/sections/IdentitySection — manual', () => {
  test('Populated — narrow 640', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await sharedPage.setViewportSize({ width: 640, height: 900 })
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Empty — validation error', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--empty')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('identity-save').click()
    await expect(sharedPage).toHaveScreenshot()
  })

  test('Populated — clear confirm open', async ({ sharedPage }) => {
    await switchStory(sharedPage, 'settings-sections-identitysection--populated')
    await sharedPage.setViewportSize({ width: 1280, height: 720 })
    await sharedPage.getByTestId('identity-clear').click()
    await expect(sharedPage).toHaveScreenshot()
  })
})
```

- [ ] **Step 2: Shoot the manual states**

Run: `bun shoot -g "IdentitySection — manual"`
Expected: 3 tests pass; new baselines written.

- [ ] **Step 3: Verify the screenshots**

Read the three new baselines:

- `…manual-Empty-—-validation-error-1.png` — the red "Provider user ID is required." line sits **directly under the Provider user ID input**, and that input has a red border.
- `…manual-Populated-—-clear-confirm-open-1.png` — the "Clear identity?" modal is open with a red "Clear" confirm button and the warning body copy.
- `…manual-Populated-—-narrow-640-1.png` — form reflows cleanly stacked at 640px.

- [ ] **Step 4: Commit**

```bash
git add tests/visual/settings/sections/IdentitySection.spec.ts .storybook-shots/settings/sections/IdentitySection.spec.ts
git commit -m "test(visual): add IdentitySection validation + confirm interaction states"
```

---

## Task 5: Final verification against the review

**Files:** none (verification only)

- [ ] **Step 1: Re-read the review findings**

Read `docs/ux-reviews/IdentitySection.md` and confirm each finding is addressed by the new baselines:

| Finding                       | Evidence                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| H1 Clear affordance + confirm | Populated (red Clear) + clear-confirm-open (modal)                          |
| H2 In-flight feedback         | Save wired `busy`/`disabled`; Confirm `busy={clearing}`                     |
| H3 First-run guidance         | Empty (intro + hints + placeholders)                                        |
| M1 Validation placement       | validation-error (inline under field, `required` asterisk)                  |
| M2 Shared primitives          | Error (`ErrorState`) + Gated (`EmptyState`) + Confirm                       |
| M3 Form over load error       | Error (no form under `ErrorState`)                                          |
| L1 Full-bleed inputs          | Populated (form capped ~520px)                                              |
| L2 Error/label collision      | resolved — load error no longer above the form                              |
| L3 A11y announcement          | `ErrorState role="alert"`, `Field` error `role="alert"`, status `aria-live` |
| L4 Clear when empty           | Empty (no Clear button)                                                     |

- [ ] **Step 2: Run the full check gate**

Run: `bun run typecheck && bun run lint`
Expected: both pass with no errors. (The per-task pre-commit hook already ran the staged `check.sh`; this is a broad confirmation across the whole tree.)

- [ ] **Step 3: Done** — no code changes in this task; the branch now carries the four implementation commits.
