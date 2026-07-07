<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# McpSection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 10 findings from the McpSection UX review by fixing the endpoint-editor layout/validation/empty-state locally and adding two shared primitives (a themed `Checkbox` and a legible `--fg-hint` token).

**Architecture:** Two shared, reusable units land in `client/shared/ui/` (a themed `Checkbox.svelte` and an `onBlur` hook on `Input.svelte`) plus a `--fg-hint` design token; one pure, unit-tested helper (`validateMcpEndpoint`) becomes the single source of truth for endpoint validity; and `McpSection.svelte` is rewritten to consume all of them (growing URL field, pinned trailing controls, `fieldset` groups, empty state, blur-triggered inline errors, disabled Save). The server is unchanged — the client mirrors `mcpEndpointConfigSchema`.

**Tech Stack:** Svelte 5 (runes: `$state`/`$derived`/`$props`/snippets), TypeScript (strict, `.js` import paths), Bun test runner (`bun:test`), Storybook + `@crvy/strybk` Playwright screenshots, oxfmt/oxlint via the commit `check.sh` hook.

**Spec:** [`docs/superpowers/specs/2026-07-08-mcpsection-ux-fixes-design.md`](../specs/2026-07-08-mcpsection-ux-fixes-design.md)

**Planning correction vs spec:** The spec said to repoint _both_ `Field` and `EmptyState` hints at `--fg-hint`. On inspection, `EmptyState`'s hint already uses `--fg2` (legible ~7:1); only its decorative _icon_ uses `--fg4`. So **only `Field`'s hint changes** — `EmptyState` is left alone.

---

## File map

| File                                                      | Action  | Responsibility                                     |
| --------------------------------------------------------- | ------- | -------------------------------------------------- |
| `client/shared/tokens.css`                                | Modify  | Add `--fg-hint` token                              |
| `client/shared/ui/Field.svelte`                           | Modify  | Repoint `.ui-field__hint` color to `--fg-hint`     |
| `client/shared/ui/Checkbox.svelte`                        | Create  | Themed boolean control (accent check, mono label)  |
| `client/shared/ui/Checkbox.stories.svelte`                | Create  | on / off / disabled stories                        |
| `client/shared/ui/Input.svelte`                           | Modify  | Add `onBlur?` prop, wire to `<input>`/`<textarea>` |
| `client/settings/lib/validate-mcp-endpoint.ts`            | Create  | Pure endpoint URL validator                        |
| `tests/client/settings/lib/validate-mcp-endpoint.test.ts` | Create  | Unit tests for the validator                       |
| `client/settings/sections/McpSection.svelte`              | Rewrite | Layout, checkbox, empty state, validation wiring   |
| `tests/visual/settings/sections/McpSection.spec.ts`       | Modify  | Add "invalid url touched" manual screenshot state  |

---

## Task 1: Add `--fg-hint` token and repoint `Field` hint

Fixes finding **L3** (low-contrast hint). `Field`'s hint uses `--fg4` (`#3a4248`, ~1.8:1 on the card surface `--surface-1: #111512`). Raising `--fg4` itself is wrong (~23 unrelated uses). Add a dedicated token at ~6:1 and point only the `Field` hint at it.

**Files:**

- Modify: `client/shared/tokens.css:76` (the `--fg4` line — add `--fg-hint` right after)
- Modify: `client/shared/ui/Field.svelte:75` (`.ui-field__hint` color)

- [ ] **Step 1: Add the token**

In `client/shared/tokens.css`, the current lines read:

```css
--fg3: var(--text-dim);
--fg4: #3a4248;
```

Change to:

```css
--fg3: var(--text-dim);
--fg4: #3a4248;
--fg-hint: #8b978c; /* instructional hint text — ≥4.5:1 on --surface-1/-2 (measures ~6:1) */
```

- [ ] **Step 2: Repoint the `Field` hint**

In `client/shared/ui/Field.svelte`, the `.ui-field__hint` rule currently reads:

```css
.ui-field__hint {
  font-size: 10px;
  color: var(--fg4);
}
```

Change the color:

```css
.ui-field__hint {
  font-size: 10px;
  color: var(--fg-hint);
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors (CSS-only change; screenshots are re-baselined in Task 6).

- [ ] **Step 4: Commit**

```bash
git add client/shared/tokens.css client/shared/ui/Field.svelte
git commit -m "fix(ui): add --fg-hint token so Field hints meet WCAG AA"
```

Expected: the pre-commit `check.sh` reports `lint`, `typecheck`, `format:check`, `license-headers` all pass.

---

## Task 2: Create the themed `Checkbox` primitive

Fixes finding **M1** (native blue checkbox). No shared boolean control exists today. Build one with an accent-green check and a mono uppercase label matching `Field` labels.

**Files:**

- Create: `client/shared/ui/Checkbox.svelte`
- Create: `client/shared/ui/Checkbox.stories.svelte`

- [ ] **Step 1: Create `Checkbox.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    checked: boolean
    label: string
    onChange: (checked: boolean) => void
    disabled?: boolean
    testid?: string
  }

  let { checked, label, onChange, disabled = false, testid }: Props = $props()

  function handleChange(event: Event): void {
    onChange((event.target as HTMLInputElement).checked)
  }
</script>

<label class="ui-checkbox" class:ui-checkbox--disabled={disabled}>
  <span class="ui-checkbox__label">{label}</span>
  <input type="checkbox" {checked} {disabled} data-testid={testid} onchange={handleChange} />
</label>

<style>
  .ui-checkbox {
    display: inline-flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }
  .ui-checkbox--disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .ui-checkbox__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-checkbox input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--accent);
    cursor: inherit;
  }
  .ui-checkbox input:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
</style>
```

- [ ] **Step 2: Create `Checkbox.stories.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Checkbox from './Checkbox.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Checkbox',
    component: Checkbox,
    args: { label: 'Enabled', checked: true, onChange: () => {} },
  })
</script>

<Story name="On" args={{ checked: true }} />

<Story name="Off" args={{ checked: false }} />

<Story name="Disabled" args={{ checked: true, disabled: true }} />
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit** (screenshots baselined in Task 6)

```bash
git add client/shared/ui/Checkbox.svelte client/shared/ui/Checkbox.stories.svelte
git commit -m "feat(ui): add themed Checkbox primitive"
```

Expected: pre-commit checks pass.

---

## Task 3: Add an `onBlur` hook to `Input`

Enables blur-triggered validation (finding **M2**). `Input` exposes `onInput` but no blur hook.

**Files:**

- Modify: `client/shared/ui/Input.svelte` (Props interface, destructure, both `<textarea>` and `<input>`)

- [ ] **Step 1: Add `onBlur` to the Props interface**

The interface currently is:

```ts
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
```

Add one line:

```ts
interface Props {
  value: string
  placeholder?: string
  prefix?: Snippet
  onInput?: (value: string) => void
  onBlur?: () => void
  type?: 'text' | 'search' | 'password'
  readonly?: boolean
  testid?: string
  multiline?: boolean
  rows?: number
}
```

- [ ] **Step 2: Destructure it**

The destructure currently is:

```ts
let {
  value,
  placeholder,
  prefix,
  onInput,
  type = 'text',
  readonly = false,
  testid,
  multiline = false,
  rows = 3,
}: Props = $props()
```

Add `onBlur,` after `onInput,`:

```ts
let {
  value,
  placeholder,
  prefix,
  onInput,
  onBlur,
  type = 'text',
  readonly = false,
  testid,
  multiline = false,
  rows = 3,
}: Props = $props()
```

- [ ] **Step 3: Wire it to the `<textarea>`**

Change the textarea's event line from:

```svelte
      data-testid={testid}
      oninput={handleInput}
    ></textarea>
```

to:

```svelte
      data-testid={testid}
      oninput={handleInput}
      onblur={onBlur}
    ></textarea>
```

- [ ] **Step 4: Wire it to the `<input>`**

Change the input's event line from:

```svelte
      data-testid={testid}
      oninput={handleInput} />
```

to:

```svelte
      data-testid={testid}
      oninput={handleInput}
      onblur={onBlur} />
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Input.svelte
git commit -m "feat(ui): add onBlur hook to Input"
```

Expected: pre-commit checks pass.

---

## Task 4: Create the `validateMcpEndpoint` helper (TDD)

Fixes finding **M2** (no inline validation). A pure function mirroring `mcpEndpointConfigSchema` (`src/mcp/types.ts`: `z.url()` + must start with `https://`). It is the single source of truth for both the inline error and the Save gate.

**Files:**

- Create: `client/settings/lib/validate-mcp-endpoint.ts`
- Test: `tests/client/settings/lib/validate-mcp-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/lib/validate-mcp-endpoint.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateMcpEndpoint } from '../../../../client/settings/lib/validate-mcp-endpoint.js'

describe('validateMcpEndpoint', () => {
  test('flags an empty url as required', () => {
    expect(validateMcpEndpoint({ url: '' }).url).toBe('URL is required.')
  })
  test('treats whitespace-only url as required', () => {
    expect(validateMcpEndpoint({ url: '   ' }).url).toBe('URL is required.')
  })
  test('rejects a non-https url', () => {
    expect(validateMcpEndpoint({ url: 'http://example.com' }).url).toBe('URL must start with https://')
  })
  test('rejects a non-http(s) scheme', () => {
    expect(validateMcpEndpoint({ url: 'ftp://example.com' }).url).toBe('URL must start with https://')
  })
  test('rejects unparseable text', () => {
    expect(validateMcpEndpoint({ url: 'not a url' }).url).toBe('URL must start with https://')
  })
  test('rejects a bare https scheme with no host', () => {
    expect(validateMcpEndpoint({ url: 'https://' }).url).toBe('URL must start with https://')
  })
  test('accepts a valid https url', () => {
    expect(validateMcpEndpoint({ url: 'https://mcp.example.com/sse' }).url).toBeUndefined()
  })
  test('trims before validating a valid url', () => {
    expect(validateMcpEndpoint({ url: '  https://mcp.example.com/sse  ' }).url).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/lib/validate-mcp-endpoint.test.ts`
Expected: FAIL — cannot resolve `../../../../client/settings/lib/validate-mcp-endpoint.js` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `client/settings/lib/validate-mcp-endpoint.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Field-keyed validation errors for an MCP endpoint draft. Empty object = valid. */
export interface McpEndpointErrors {
  url?: string
}

/**
 * Validate a user-entered MCP endpoint against the server contract
 * (`mcpEndpointConfigSchema`): the URL is required and must be a parseable
 * `https://` URL. Pure; no side effects.
 */
export function validateMcpEndpoint(endpoint: { url: string }): McpEndpointErrors {
  const url = endpoint.url.trim()
  if (url === '') return { url: 'URL is required.' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { url: 'URL must start with https://' }
  }
  if (parsed.protocol !== 'https:') return { url: 'URL must start with https://' }
  return {}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts tests/client/settings/lib/validate-mcp-endpoint.test.ts`
Expected: PASS — 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add client/settings/lib/validate-mcp-endpoint.ts tests/client/settings/lib/validate-mcp-endpoint.test.ts
git commit -m "feat(settings): add validateMcpEndpoint helper"
```

Expected: pre-commit checks pass.

---

## Task 5: Rewrite `McpSection.svelte`

Fixes findings **H1** (grow URL), **H2** (empty state), **M1** (checkbox), **M2** (inline error + disabled Save), **M3** (header-row baseline), **M4** (Remove affordance), **L1** (spacing tokens), **L2** (Add-header width), **L4** (radius + semantic groups). All are intertwined in the same markup/style block, so this task replaces the file wholesale.

**Files:**

- Rewrite: `client/settings/sections/McpSection.svelte`

Key structural decisions realized here:

- **H1/M4:** primary line splits into a growing fields group (`Label` fixed-ish, `URL` grows) and a right-pinned trailing group (`Checkbox` + `outline` Remove).
- **M3:** the repeated per-Value hint moves to a single group caption, so `Name`/`Value` fields are equal height and bottom-align cleanly (no `align-items` baseline drift).
- **L2:** `Add header` is wrapped in a block `div` so it renders at natural width instead of stretching as a grid item.
- **L4:** each group is a `<fieldset>` with a block-styled `<legend>` and `border-radius: var(--radius)` on the card.
- **H2:** zero endpoints → `EmptyState` with a primary Add and no bottom Save bar.
- **M2:** `visibleUrlError(row)` shows the error only for touched rows; `hasErrors` gates Save.

- [ ] **Step 1: Replace the entire file with this content**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { McpEndpoint } from '../fetcher-schemas.js'
  import { fetchMcp, putMcp } from '../fetchers.js'
  import { validateMcpEndpoint } from '../lib/validate-mcp-endpoint.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Checkbox from '../../shared/ui/Checkbox.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

  interface HeaderRow {
    name: string
    value: string
  }

  interface EndpointState {
    endpoint: McpEndpoint
    headerRows: HeaderRow[]
    allowText: string
    denyText: string
  }

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let rows: EndpointState[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let initialLoad = $state(true)
  let touched: Set<string> = $state(new Set())

  const hasErrors = $derived(rows.some((r) => validateMcpEndpoint(r.endpoint).url !== undefined))

  function markTouched(id: string): void {
    if (touched.has(id)) return
    touched = new Set(touched).add(id)
  }

  function visibleUrlError(row: EndpointState): string | undefined {
    if (!touched.has(row.endpoint.id)) return undefined
    return validateMcpEndpoint(row.endpoint).url
  }

  function toHeaderRows(headers: Record<string, string> | undefined): HeaderRow[] {
    if (headers === undefined) return []
    return Object.entries(headers).map(([name, value]) => ({ name, value }))
  }

  function fromHeaderRows(headerRows: HeaderRow[]): Record<string, string> | undefined {
    const entries = headerRows.filter((r) => r.name.trim().length > 0)
    if (entries.length === 0) return undefined
    return Object.fromEntries(entries.map((r) => [r.name, r.value]))
  }

  function toText(arr: string[] | undefined): string {
    return arr === undefined || arr.length === 0 ? '' : arr.join(', ')
  }

  function fromText(text: string): string[] | undefined {
    const parts = text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return parts.length === 0 ? undefined : parts
  }

  function toEndpointState(endpoint: McpEndpoint): EndpointState {
    return {
      endpoint: { ...endpoint },
      headerRows: toHeaderRows(endpoint.headers),
      allowText: toText(endpoint.toolFilter?.allow),
      denyText: toText(endpoint.toolFilter?.deny),
    }
  }

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const data = await fetchMcp(id)
      if (id !== contextId) return
      rows = data.endpoints.map(toEndpointState)
      initialLoad = false
    } catch (err) {
      if (id === contextId) {
        error = err instanceof Error ? err.message : String(err)
        initialLoad = false
      }
    } finally {
      if (id === contextId) loading = false
    }
  }

  function addRow(): void {
    const existing = new Set(rows.map((r) => r.endpoint.id))
    let n = 1
    while (existing.has(`srv-${n}`)) n += 1
    rows = [
      ...rows,
      {
        endpoint: { id: `srv-${n}`, url: '', label: '', enabled: true },
        headerRows: [],
        allowText: '',
        denyText: '',
      },
    ]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  function addHeader(rowIndex: number): void {
    rows = rows.map((r, i) => (i === rowIndex ? { ...r, headerRows: [...r.headerRows, { name: '', value: '' }] } : r))
  }

  function removeHeader(rowIndex: number, headerIndex: number): void {
    rows = rows.map((r, i) =>
      i === rowIndex ? { ...r, headerRows: r.headerRows.filter((_, j) => j !== headerIndex) } : r,
    )
  }

  function buildPayload(): McpEndpoint[] {
    return rows.map((r) => {
      const headers = fromHeaderRows(r.headerRows)
      const allow = fromText(r.allowText)
      const deny = fromText(r.denyText)
      const toolFilter =
        allow !== undefined || deny !== undefined
          ? { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) }
          : undefined
      return { ...r.endpoint, headers, toolFilter }
    })
  }

  async function save(): Promise<void> {
    error = null
    status = null
    saving = true
    try {
      const endpoints = buildPayload()
      await putMcp({ endpoints, contextId })
      await load(contextId)
      status = 'Saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="mcp" class="settings-section">
  <PageHeader eyebrow="Integrations" title="MCP endpoints">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="mcp-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if rows.length === 0}
    <EmptyState title="No MCP endpoints" hint="Connect an external MCP server to add its tools to this context.">
      {#snippet action()}
        <Btn variant="primary" testid="mcp-add" onClick={addRow}>
          {#snippet children()}Add endpoint{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="settings-mcp">
      {#each rows as row, index (row.endpoint.id)}
        <div class="settings-mcp__row" data-testid={`mcp-row-${row.endpoint.id}`}>
          <div class="settings-mcp__primary">
            <div class="settings-mcp__primary-fields">
              <div class="settings-mcp__field settings-mcp__field--label">
                <Field label="Label">
                  <Input value={row.endpoint.label ?? ''} onInput={(v) => (row.endpoint.label = v)} />
                </Field>
              </div>
              <div class="settings-mcp__field settings-mcp__field--url">
                <Field label="URL (https)" error={visibleUrlError(row)}>
                  <Input
                    value={row.endpoint.url}
                    onInput={(v) => (row.endpoint.url = v)}
                    onBlur={() => markTouched(row.endpoint.id)}
                    testid={`mcp-url-${row.endpoint.id}`} />
                </Field>
              </div>
            </div>
            <div class="settings-mcp__primary-trailing">
              <Checkbox
                label="Enabled"
                checked={row.endpoint.enabled}
                onChange={(c) => (row.endpoint.enabled = c)}
                testid={`mcp-enabled-${row.endpoint.id}`} />
              <Btn variant="outline" size="sm" testid={`mcp-remove-${row.endpoint.id}`} onClick={() => removeRow(index)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
            </div>
          </div>

          <fieldset class="settings-mcp__group">
            <legend class="settings-mcp__legend">Auth headers</legend>
            <div class="settings-mcp__group-body">
              {#if row.headerRows.length > 0}
                <p class="settings-mcp__group-hint">Leave a value unchanged to keep the stored secret.</p>
              {/if}
              {#each row.headerRows as headerRow, hi (hi)}
                <div class="settings-mcp__header-row">
                  <Field label="Name">
                    <Input
                      value={headerRow.name}
                      onInput={(v) => (headerRow.name = v)}
                      testid={`mcp-header-name-${row.endpoint.id}-${hi}`} />
                  </Field>
                  <Field label="Value">
                    <Input
                      value={headerRow.value}
                      onInput={(v) => (headerRow.value = v)}
                      testid={`mcp-header-value-${row.endpoint.id}-${hi}`} />
                  </Field>
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`mcp-header-remove-${row.endpoint.id}-${hi}`}
                    onClick={() => removeHeader(index, hi)}>
                    {#snippet children()}✕{/snippet}
                  </Btn>
                </div>
              {/each}
              <div class="settings-mcp__group-action">
                <Btn
                  variant="secondary"
                  size="sm"
                  testid={`mcp-header-add-${row.endpoint.id}`}
                  onClick={() => addHeader(index)}>
                  {#snippet children()}Add header{/snippet}
                </Btn>
              </div>
            </div>
          </fieldset>

          <fieldset class="settings-mcp__group">
            <legend class="settings-mcp__legend">Tool filter</legend>
            <div class="settings-mcp__group-body">
              <Field label="Allow tools" hint="comma or newline separated">
                <Input
                  value={row.allowText}
                  onInput={(v) => (row.allowText = v)}
                  testid={`mcp-toolfilter-allow-${row.endpoint.id}`} />
              </Field>
              <Field label="Deny tools" hint="comma or newline separated">
                <Input
                  value={row.denyText}
                  onInput={(v) => (row.denyText = v)}
                  testid={`mcp-toolfilter-deny-${row.endpoint.id}`} />
              </Field>
            </div>
          </fieldset>
        </div>
      {/each}
      <div class="settings-mcp__actions">
        <Btn variant="secondary" testid="mcp-add" onClick={addRow}>
          {#snippet children()}Add endpoint{/snippet}
        </Btn>
        <Btn variant="primary" testid="mcp-save" disabled={saving || hasErrors} onClick={() => void save()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}
</section>

<style>
  .settings-mcp {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-mcp__row {
    display: grid;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .settings-mcp__primary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-inline);
    align-items: end;
  }
  .settings-mcp__primary-fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-inline);
    align-items: end;
    flex: 1 1 320px;
    min-width: 0;
  }
  .settings-mcp__field {
    min-width: 0;
  }
  .settings-mcp__field--label {
    flex: 0 1 200px;
  }
  .settings-mcp__field--url {
    flex: 1 1 320px;
  }
  .settings-mcp__field :global(.ui-input) {
    width: 100%;
  }
  .settings-mcp__primary-trailing {
    display: flex;
    align-items: end;
    gap: var(--gap-inline);
    margin-left: auto;
  }
  .settings-mcp__group {
    min-width: 0;
    margin: 0;
    padding: var(--gap-tight) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .settings-mcp__legend {
    display: block;
    padding: 0;
    margin: 0 0 var(--gap-tight);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
  }
  .settings-mcp__group-body {
    display: grid;
    gap: var(--gap-tight);
  }
  .settings-mcp__group-hint {
    margin: 0;
    font-size: 10px;
    color: var(--fg-hint);
  }
  .settings-mcp__header-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-tight);
    align-items: end;
  }
  .settings-mcp__header-row :global(.ui-field) {
    flex: 1 1 160px;
    min-width: 0;
  }
  .settings-mcp__header-row :global(.ui-input) {
    width: 100%;
  }
  .settings-mcp__actions {
    display: flex;
    gap: var(--gap-inline);
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Format**

Run: `bun run format`
Expected: file reformatted (idempotent); no manual fixes needed.

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/McpSection.svelte
git commit -m "feat(settings): rework McpSection layout, empty state, and URL validation"
```

Expected: pre-commit checks pass (`lint`, `typecheck`, `format:check`, `license-headers`).

---

## Task 6: Screenshot states, re-baseline, and verification

Baselines the new `Checkbox` story, adds a "touched-invalid URL" state to McpSection's visual spec, and re-baselines every story affected by the `--fg-hint` and layout changes. **Storybook must be running** (`bun storybook` in a separate terminal). Because `tokens.css` changed, the concatenated public CSS must be rebuilt first.

**Files:**

- Modify: `tests/visual/settings/sections/McpSection.spec.ts` (add one manual state below `// @generated-end auto-screenshots`)

- [ ] **Step 1: Rebuild the concatenated Storybook CSS (picks up `--fg-hint`)**

Run: `bun run storybook:prepare`
Expected: regenerates `public/storybook-*.css`. If Storybook is running it serves the new files on the next request.

- [ ] **Step 2: Add the touched-invalid manual screenshot state**

In `tests/visual/settings/sections/McpSection.spec.ts`, append below the existing manual states (which already cover narrow/expanded/long-content/hover from the review session):

```ts
test('McpSection — invalid url touched', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-mcpsection--populated')
  const url = sharedPage.getByTestId('mcp-url-e1')
  await url.fill('http://insecure.example.com')
  await url.blur()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 3: Regenerate specs (creates the Checkbox spec; preserves McpSection manual states)**

Run: `bun run shoot:gen`
Expected: creates `tests/visual/shared/ui/Checkbox.spec.ts` and refreshes generated blocks; the manual state added in Step 2 (below `@generated-end`) is preserved. Also runs `format` + `license:headers`.

- [ ] **Step 4: Shoot everything to re-baseline**

Run: `bun run shoot`
Expected: PASS; snapshots updated for `Checkbox`, `McpSection` (all states), and any story showing a `Field` hint (sibling sections re-baseline due to `--fg-hint`). This is the accepted app-wide re-baseline.

- [ ] **Step 5: Visually verify the key McpSection PNGs**

Read these files and confirm the described result:

- `.storybook-shots/shared/ui/Checkbox.spec.ts/shared-ui-Checkbox-On-1.png` — green-filled checked box under an "ENABLED" mono label.
- `.storybook-shots/settings/sections/McpSection.spec.ts/settings-sections-McpSection-Populated-1.png` — URL field now fills the row width; "Enabled" checkbox is green; "Remove" is an outlined button pinned right; card has rounded corners.
- `.storybook-shots/settings/sections/McpSection.spec.ts/settings-sections-McpSection-Empty-1.png` — `EmptyState` ("No MCP endpoints" + hint) with a single primary "Add endpoint"; no bottom Save bar.
- `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-invalid-url-touched-1.png` — red-bordered URL field with "URL must start with https://" and a dimmed (disabled) Save.
- `.storybook-shots/settings/sections/McpSection.spec.ts/McpSection-—-header-row-new-endpoint-expanded-1.png` — Name/Value inputs share a baseline; a single "Leave a value unchanged…" caption; "Add header" is natural width (not a full-width bar).

Expected: all as described. If the `<legend>` renders on top of the separator line instead of as a label below it, confirm `.settings-mcp__legend { display: block }` is present (Step 1 of Task 5's style block).

- [ ] **Step 6: Run the full client test suite for the new helper**

Run: `bun run test:client`
Expected: PASS, including `validate-mcp-endpoint.test.ts` (8 tests).

- [ ] **Step 7: Commit**

```bash
git add tests/visual/settings/sections/McpSection.spec.ts tests/visual/shared/ui/Checkbox.spec.ts .storybook-shots
git commit -m "test(ui): baseline Checkbox and re-baseline McpSection UX-fix screenshots"
```

Expected: pre-commit checks pass.

---

## Self-review

**Spec coverage** — every finding maps to a task:

| Finding                  | Task                                       |
| ------------------------ | ------------------------------------------ |
| H1 cramped URL           | 5 (`--url` flex-grow)                      |
| H2 empty state           | 5 (EmptyState branch, Save bar hidden)     |
| M1 blue checkbox         | 2 + 5 (Checkbox primitive + usage)         |
| M2 no inline validation  | 3 + 4 + 5 (Input.onBlur + helper + wiring) |
| M3 header-row baseline   | 5 (equal-height fields + group caption)    |
| M4 Remove affordance     | 5 (`outline` + pinned trailing)            |
| L1 hardcoded spacing     | 5 (gap tokens)                             |
| L2 stretched Add header  | 5 (wrapped block button)                   |
| L3 low-contrast hint     | 1 (`--fg-hint`)                            |
| L4 no radius / semantics | 5 (`--radius` + fieldset/legend)           |

Shared-layer decision honored (Tasks 1–3); themed checkbox (Task 2); inline-error + disabled-Save with blur reveal (Tasks 3–5); Approach C (helper + Checkbox extracted, row inline) — all present.

**Placeholder scan** — no TBD/TODO; every code step contains complete content; every referenced symbol (`validateMcpEndpoint`, `visibleUrlError`, `markTouched`, `hasErrors`, `onBlur`, testids `mcp-url-*`/`mcp-enabled-*`/`mcp-add`/`mcp-save`) is defined in this plan.

**Type/name consistency** — `validateMcpEndpoint({ url: string }): McpEndpointErrors` is defined in Task 4 and consumed identically in Task 5 (`.url`); `onBlur?: () => void` defined in Task 3, used in Task 5; `Checkbox` props (`checked`/`label`/`onChange`/`disabled`/`testid`) defined in Task 2, used in Task 5; testids used in Task 6 (`mcp-url-e1`) match those emitted in Task 5.

**Notes / accepted risks**

- `EmptyState` is intentionally **not** changed (its hint already uses `--fg2`); only `Field`'s hint moves to `--fg-hint`.
- `bun run shoot` re-baselines many sibling stories via `--fg-hint`; this is the agreed app-wide fix, reviewed by reading the PNGs.
- Migrating `AdminCodingGuardrailsSection`'s raw checkboxes to `Checkbox` is out of scope (follow-up).
