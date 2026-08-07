<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# CodingMcpSection Open Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the nine in-scope UX findings on `CodingMcpSection` from [`docs/ux-reviews/CodingMcpSection.md`](../../ux-reviews/CodingMcpSection.md), per [`the design spec`](../specs/2026-08-07-coding-mcp-open-findings-design.md).

**Architecture:** One Svelte component (`client/settings/sections/CodingMcpSection.svelte`) plus a new client test file and edits to its existing visual spec. The centrepiece is a single derived per-row problem list that replaces the current `hasEmptyServer` gate and closes both High findings at once; the rest are localised prop, copy, and CSS corrections. No backend, schema, or shared-primitive changes.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`), TypeScript (strict), Bun test runner with `happy-dom` via `tests/client-setup.ts`, Playwright visual specs via `@crvy/strybk`.

## Global Constraints

- Runtime is **Bun**. Validation is **Zod v4**. Strict TypeScript.
- **Use the `.js` extension in import paths**, including for `.ts` sources.
- **Never add lint-disable or type-ignore comments** — hook policy blocks them; fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a **design signal**: split the file or extract functions; do not game the limit by deleting blank lines or compressing formatting.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Client tests are invisible to a plain `bun test`. Always run them with:
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`
- Fetch mocks must be typed `(url: string, init: RequestInit)`. Do **not** use `RequestInfo | URL` with `String(input)` — it trips `typescript(no-base-to-string)`.
- No conditional expressions in test bodies (`no-conditional-in-test`): no `?? ''`, no `?.` in assertions. Use a non-null assertion (`!`) as the sibling suites do.
- Promise executors must be block-bodied (`no-promise-executor-return`): write `new Promise<Response>(() => {})`, never `new Promise((r) => r(x))` in expression form.
- Do not touch `src/coding-credentials/**`. The backend is correct; the client is what saves states it rejects.
- Copy strings are exact. Do not paraphrase them.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `client/settings/sections/CodingMcpSection.svelte` | The whole section: state, validation, markup, scoped CSS | Modify (all six tasks) |
| `tests/client/settings/sections/CodingMcpSection.test.ts` | Behavioural coverage for validation, cap, in-flight state, error state | **Create** (Task 1), extend (Tasks 2–4) |
| `tests/visual/settings/sections/CodingMcpSection.spec.ts` | Playwright screenshots + DOM assertions | Modify (Task 6) |
| `docs/ux-reviews/CodingMcpSection.md` | The review being closed out | Modify (Task 6) |

The component is 331 lines today and grows by roughly 40. That stays under the `max-lines` ceiling, so no split is planned. If a task trips `max-lines`, extract the validation helpers into `client/settings/sections/coding-mcp-validation.ts` and import them — do not compress formatting.

---

## Task 1: Row validation — blank and duplicate servers

Closes `coding-mcp-blank-row-blocks-save-silently` and `coding-mcp-duplicate-server-saves-silently` (both High).

Today `hasEmptyServer` (`:58`) gates Save but explains nothing, and duplicates are not checked at all — so the UI saves a selection that `resolveMcpServers` refuses fail-closed, costing the context *every* MCP server.

Note `Select` already consumes `Field`'s error through `field-context.js`: passing `error` to the `Field` gives the select `ui-select--invalid` (a red border), `aria-invalid="true"`, and `aria-describedby` pointing at the message, with no change to `Select` itself.

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte:58` (replace `hasEmptyServer`), `:119` (`saveAll` guard), `:201` (server `Field`), `:266` (Save predicate)
- Test: `tests/client/settings/sections/CodingMcpSection.test.ts` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `rowProblems: (string | undefined)[]` — a `$derived` array parallel to `rows`; index `i` holds the blocking message for row `i`, or `undefined` when the row is valid.
  - `hasRowProblem: boolean` — a `$derived` flag, true when any entry of `rowProblems` is defined. Tasks 2–4 read these; nothing else in the component may reintroduce `hasEmptyServer`.
  - Test-file helpers `json`, `drain`, `mcpPayload`, and `loadedMock`, reused verbatim by Tasks 2–4.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/sections/CodingMcpSection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import CodingMcpSection from '../../../../client/settings/sections/CodingMcpSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const mcpPayload = {
  namespace: 'mcp',
  configured: true,
  complete: true,
  missing: [],
  fields: [],
  catalog: [
    { name: 'search', upstream_url: 'https://search.example/sse', default_tool_policy: 'ask' },
    { name: 'docs', upstream_url: 'https://docs.example/sse', default_tool_policy: 'ask' },
  ],
  pluginServers: [{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }],
  maxMcpServers: 3,
  selections: [{ server: 'search', hasToken: true }],
}

const loadedMock = (): Promise<Response> => Promise.resolve(json(mcpPayload))

function mountSection(): { target: HTMLElement; component: Record<string, unknown> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingMcpSection, { target, props: { contextId: 'ctx-1' } })
  return { target, component }
}

function pickServer(target: HTMLElement, index: number, value: string): void {
  const select = target.querySelector<HTMLSelectElement>(`[data-testid="coding-mcp-server-${index}"]`)!
  select.value = value
  select.dispatchEvent(new Event('change'))
}

function rowError(target: HTMLElement, index: number): string {
  const row = target.querySelector<HTMLElement>(`[data-testid="coding-mcp-row-${index}"]`)!
  return row.querySelector<HTMLElement>('.ui-field__error')!.textContent!.trim()
}

function saveButton(target: HTMLElement): HTMLButtonElement {
  return target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-save"]')!
}

describe('CodingMcpSection row validation', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a blank server row names its own blocking reason and disables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()

    expect(rowError(target, 1)).toBe('Choose an MCP server.')
    expect(saveButton(target).disabled).toBe(true)
    void unmount(component)
  })

  test('a duplicate server marks the later row, not the first, and disables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'search')
    await drain()

    expect(rowError(target, 1)).toBe('Already selected in another row.')
    expect(target.querySelector('[data-testid="coding-mcp-row-0"] .ui-field__error')).toBeNull()
    expect(saveButton(target).disabled).toBe(true)
    void unmount(component)
  })

  test('a distinct second server leaves both rows clean and enables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    expect(target.querySelector('.ui-field__error')).toBeNull()
    expect(saveButton(target).disabled).toBe(false)
    void unmount(component)
  })

  test('the duplicate check ignores surrounding whitespace', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'search')
    await drain()

    expect(rowError(target, 1)).toBe('Already selected in another row.')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: the blank-row and duplicate tests FAIL. The blank-row test fails on `rowError` — `querySelector('.ui-field__error')` returns `null`, so the non-null assertion throws — because no `error` is passed to `Field` today. The duplicate test fails the same way, and its `saveButton(...).disabled` would be `false`. The third test should already pass.

- [ ] **Step 3: Add the validation derivations**

In `client/settings/sections/CodingMcpSection.svelte`, delete the `hasEmptyServer` line at `:58` and put this in its place, above `const atCap`:

```ts
  const BLANK_SERVER_MESSAGE = 'Choose an MCP server.'
  const DUPLICATE_SERVER_MESSAGE = 'Already selected in another row.'

  // A row is invalid when it names no server, or repeats one an *earlier* row already
  // claimed. Marking the later occurrence is what lets the message point somewhere: the
  // first row is the one the user keeps. This is not cosmetic — resolveMcpServers is
  // fail-closed and all-or-nothing, so saving a duplicate costs the context every MCP
  // server, and the failure surfaces in a coding session rather than here.
  function rowProblem(all: McpRow[], row: McpRow, index: number): string | undefined {
    const server = row.server.trim()
    if (server.length === 0) return BLANK_SERVER_MESSAGE
    if (all.slice(0, index).some((earlier) => earlier.server.trim() === server)) return DUPLICATE_SERVER_MESSAGE
    return undefined
  }

  const rowProblems = $derived(rows.map((row, index) => rowProblem(rows, row, index)))
  const hasRowProblem = $derived(rowProblems.some((problem) => problem !== undefined))
```

- [ ] **Step 4: Wire the derivations into the markup and the guards**

Three edits in the same file.

At `:119`, in `saveAll`, swap the stale gate:

```ts
    if (loading || saving || loadedContextId !== contextId || hasRowProblem) return
```

At `:201`, pass the message to the `Field` (`Select` picks up the invalid styling and ARIA from `Field`'s context automatically):

```svelte
              <Field label="MCP server" error={rowProblems[index]}>
```

At `:266`, swap Save's predicate:

```svelte
              disabled={!formDirty || saving || loading || clearing || hasRowProblem}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Verify no reference to the removed derivation survives**

Run:

```bash
grep -n "hasEmptyServer" client/settings/sections/CodingMcpSection.svelte
```

Expected: no output. If anything prints, that call site still uses the deleted gate — replace it with `hasRowProblem`.

- [ ] **Step 7: Run the repo checks**

```bash
bun run format && bun run lint && bun run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte tests/client/settings/sections/CodingMcpSection.test.ts
git commit -m "fix(settings): name the reason a coding MCP row blocks Save

Replaces the silent hasEmptyServer gate with a per-row problem list covering
blank and duplicate servers. A duplicate is not cosmetic: resolveMcpServers is
fail-closed and all-or-nothing, so saving one costs the context every MCP
server, with the failure surfacing in a coding session rather than in settings."
```

---

## Task 2: Cap counter

Closes `coding-mcp-server-cap-unexplained` (Med). Measured: at the cap, `addDisabled: true`, `aria-describedby: null`, and the section's full text never mentions a limit.

The counter is persistent, not appear-on-limit, so the ceiling is knowable before the user hits it.

**The cap may be absent.** `client/settings/fetcher-schemas.ts:94` declares `maxMcpServers` optional and the component falls back to `Number.POSITIVE_INFINITY` (`:46`). The server always sends one (`src/coding-credentials/guardrails.ts:18`, `.default(3)`), but the client contract permits its absence. The counter must render only for a finite cap — never `2 of ∞`, never a bare `2` implying a limit that was not sent.

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte` (new derivation near `:59`; markup at `:239-247`; new scoped CSS)
- Test: `tests/client/settings/sections/CodingMcpSection.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `mcpPayload`, `json`, `drain`, `loadedMock`, `mountSection` from Task 1's test file.
- Produces: a `[data-testid="coding-mcp-cap"]` element, present only for a finite cap.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/sections/CodingMcpSection.test.ts`:

```ts
describe('CodingMcpSection cap counter', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a finite cap is stated as a used-of-total count', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    const cap = target.querySelector<HTMLElement>('[data-testid="coding-mcp-cap"]')!
    expect(cap.textContent!.trim()).toBe('1 of 3 servers used')
    void unmount(component)
  })

  test('the count tracks rows as they are added', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()

    expect(target.querySelector<HTMLElement>('[data-testid="coding-mcp-cap"]')!.textContent!.trim()).toBe(
      '2 of 3 servers used',
    )
    void unmount(component)
  })

  test('an absent cap renders no count rather than an infinite one', async () => {
    setCsrfToken('c')
    const { maxMcpServers: _omitted, ...uncapped } = mcpPayload
    setMockFetch(() => Promise.resolve(json(uncapped)))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector('[data-testid="coding-mcp-cap"]')).toBeNull()
    expect(target.textContent).not.toContain('∞')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: the first two FAIL (no `coding-mcp-cap` element exists, so the non-null assertion throws). The third passes vacuously — it is the regression guard that keeps the fix from rendering an infinite cap, and it only becomes load-bearing after Step 3.

- [ ] **Step 3: Add the derivation**

In `client/settings/sections/CodingMcpSection.svelte`, directly below `const atCap` (`:59`):

```ts
  // `maxMcpServers` is optional in the client schema (fetcher-schemas.ts:94) and falls back
  // to Infinity above, so guard on finiteness: a count is only meaningful against a real cap.
  const capLabel = $derived(
    Number.isFinite(maxMcpServers) ? `${rows.length} of ${maxMcpServers} servers used` : null,
  )
```

- [ ] **Step 4: Render the counter beside Add**

Replace the Add button block at `:240-247` with an Add-plus-count group. The actions row is `justify-content: space-between`, so Add and the count must share a wrapper to stay together on the left:

```svelte
          <div class="settings-mcp__add">
            <Btn
              variant="secondary"
              size="sm"
              testid="coding-mcp-add"
              disabled={saving || loading || atCap}
              onClick={addRow}>
              {#snippet children()}Add server{/snippet}
            </Btn>
            {#if capLabel !== null}
              <span class="settings-mcp__cap" data-testid="coding-mcp-cap">{capLabel}</span>
            {/if}
          </div>
```

Add to the `<style>` block:

```css
  .settings-mcp__add {
    display: flex;
    align-items: center;
    gap: var(--gap-inline);
  }
  .settings-mcp__cap {
    font-size: 10px;
    color: var(--text-dim);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Prove the infinite-cap guard is load-bearing**

Temporarily change the derivation to drop the guard:

```ts
  const capLabel = $derived(`${rows.length} of ${maxMcpServers} servers used`)
```

Re-run the command from Step 5. Expected: the "an absent cap renders no count" test FAILS, reporting a rendered `1 of Infinity servers used`. Then restore the guarded version from Step 3 and re-run to confirm PASS. Do not commit the unguarded version.

- [ ] **Step 7: Run the repo checks**

```bash
bun run format && bun run lint && bun run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte tests/client/settings/sections/CodingMcpSection.test.ts
git commit -m "feat(settings): state the coding MCP server cap beside Add

Renders a persistent used-of-total count so the ceiling is knowable before the
user reaches it and the disabled Add button has a stated cause. Guarded on a
finite cap: maxMcpServers is optional client-side, so the count is suppressed
entirely rather than rendering an infinite total."
```

---

## Task 3: In-flight control state

Closes `coding-mcp-async-actions-never-announce-busy` (Med) and `coding-mcp-remove-live-during-save` (Low). Both are the same defect class — controls whose in-flight behaviour is incomplete — so they share a task.

Measured: Save reports `aria-busy="false"` mid-flight. `Btn` forwards `busy` to `aria-busy` (`client/shared/ui/Btn.svelte:53`); Save (`:262`) and Clear (`:250`) drive only their visible label. Remove (`:228`) takes no `disabled` prop while the row's `Select` (`:206`) and Add (`:244`) both carry `disabled={saving || loading}`.

`Btn` also applies `pointer-events: none` and an opacity shift under `busy`. Both buttons are already `disabled` under the same flags, so this adds no behavioural change beyond the announcement.

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte:228` (Remove), `:250` (Clear), `:262` (Save)
- Test: `tests/client/settings/sections/CodingMcpSection.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `json`, `drain`, `mcpPayload`, `mountSection`, `pickServer`, `saveButton` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/sections/CodingMcpSection.test.ts`:

```ts
const hangingPatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/coding-credentials') && init.method === 'PATCH') {
    return new Promise<Response>(() => {})
  }
  return Promise.resolve(json(mcpPayload))
}

describe('CodingMcpSection in-flight control state', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('Save announces its in-flight state with aria-busy', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    const save = saveButton(target)
    expect(save.getAttribute('aria-busy')).toBe('false')
    save.click()
    await drain()

    expect(save.textContent!.trim()).toBe('Saving…')
    expect(save.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('Remove is disabled while a save is in flight', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    const remove = target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-remove-0"]')!
    expect(remove.disabled).toBe(false)
    saveButton(target).click()
    await drain()

    expect(remove.disabled).toBe(true)
    void unmount(component)
  })

  test('Clear announces its in-flight state with aria-busy', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    const clear = target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-clear"]')!
    expect(clear.getAttribute('aria-busy')).toBe('false')
    clear.click()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!.click()
    await drain()

    expect(clear.textContent!.trim()).toBe('Clearing…')
    expect(clear.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: all three FAIL. The Save and Clear tests fail on the `aria-busy` assertion reading `"false"` while the label already reads `Saving…` / `Clearing…` — proving the label and the announcement are independent, which is exactly the defect. The Remove test fails with `remove.disabled` still `false` mid-save.

- [ ] **Step 3: Pass the in-flight flags to the three controls**

In `client/settings/sections/CodingMcpSection.svelte`.

Remove, at `:228-234` — add the guard its siblings already carry:

```svelte
              <Btn
                variant="outline"
                size="sm"
                testid={`coding-mcp-remove-${index}`}
                disabled={saving || loading}
                onClick={() => removeRow(index)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
```

Clear, at `:250-260` — add `busy`:

```svelte
              <Btn
                variant="ghost"
                size="sm"
                testid="coding-mcp-clear"
                disabled={saving || loading || clearing}
                busy={clearing}
                onClick={() => {
                  pendingClear = true
                  clearError = null
                }}>
                {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
              </Btn>
```

Save, at `:262-269` — add `busy`:

```svelte
            <Btn
              variant="primary"
              size="sm"
              testid="coding-mcp-save"
              disabled={!formDirty || saving || loading || clearing || hasRowProblem}
              busy={saving}
              onClick={() => void saveAll()}>
              {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
            </Btn>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the repo checks**

```bash
bun run format && bun run lint && bun run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte tests/client/settings/sections/CodingMcpSection.test.ts
git commit -m "fix(settings): complete the coding MCP in-flight control state

Save and Clear changed only their visible label while saving, so the state never
reached assistive tech; both now pass their existing flag through Btn's busy
prop. Remove gains the disabled guard its sibling controls already carry, so the
row set cannot change underneath an in-flight save."
```

---

## Task 4: Error state and the empty selection state

Closes `coding-mcp-error-state-buries-what-failed` (Med) and `coding-mcp-empty-states-are-bare-prose` (Low).

`:184` passes the raw exception as `message`, rendering `Something went wrong` over a bare `boom`. `ErrorState` documents `detail` as the slot for *"Raw diagnostic text (e.g. an exception message) demoted to a collapsed disclosure"* (`client/shared/ui/ErrorState.svelte:13-14`). The component inverts its own primitive's contract.

Two dead ends are bare `.placeholder` prose: the no-catalog line (`:190`) and — the one the Empty screenshot shows — the gap where the row list would be when `rows.length === 0`, which renders nothing at all between the intro and the actions row.

**Leave the intro paragraph at `:192` alone.** `.placeholder` on *instructional* prose is house convention, matching `ByokSection` and `CodeHostSection`; the review explicitly dropped that as a finding. Only the two dead-end states change.

`EmptyState` takes `title`, optional `icon`, `hint`, and an `action` snippet (`client/shared/ui/EmptyState.svelte:9-16`). It has no `testid` prop, so preserve the existing `coding-mcp-catalog-empty` hook on a wrapper.

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte:11` (import), `:184` (ErrorState), `:190` (no-catalog), `:197` (empty rows)
- Test: `tests/client/settings/sections/CodingMcpSection.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `json`, `drain`, `mcpPayload`, `mountSection` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/sections/CodingMcpSection.test.ts`:

```ts
describe('CodingMcpSection dead-end states', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a load failure names the failed operation and demotes the exception', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector<HTMLElement>('.ui-error__message')!.textContent!.trim()).toBe(
      "Couldn't load the MCP server settings for this context.",
    )
    expect(target.querySelector('.ui-error__detail')).not.toBeNull()
    void unmount(component)
  })

  test('an empty selection offers a next step instead of a bare gap', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, configured: false, selections: [] })))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector<HTMLElement>('.ui-empty__title')!.textContent!.trim()).toBe('No MCP servers selected')
    void unmount(component)
  })

  test('an empty catalog is a titled dead end, not a dim line', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, catalog: [], pluginServers: [], selections: [] })))
    const { target, component } = mountSection()
    await drain()

    const empty = target.querySelector<HTMLElement>('[data-testid="coding-mcp-catalog-empty"]')!
    expect(empty.querySelector<HTMLElement>('.ui-empty__title')!.textContent!.trim()).toBe('No MCP servers available')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: all three FAIL. The first reports the raw exception text where the plain-language message belongs. The second and third throw on the non-null assertion — no `.ui-empty__title` exists, because `EmptyState` is not imported.

- [ ] **Step 3: Import `EmptyState`**

In `client/settings/sections/CodingMcpSection.svelte`, insert the import directly above the existing `ErrorState` import at `:11`, so the block reads:

```ts
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
```

`EmptyState` sorts before `ErrorState`, which keeps the lint rule on import order satisfied.

- [ ] **Step 4: Use `ErrorState` as its contract intends**

Replace `:184`:

```svelte
    <ErrorState
      message="Couldn't load the MCP server settings for this context."
      detail={error}
      onRetry={() => void load(contextId)} />
```

- [ ] **Step 5: Replace the no-catalog line**

Replace `:190`:

```svelte
      <div data-testid="coding-mcp-catalog-empty">
        <EmptyState
          title="No MCP servers available"
          hint="Your operator hasn't published any MCP servers for this platform instance. Ask them to add one." />
      </div>
```

- [ ] **Step 6: Fill the empty selection state**

Inside `<div class="settings-mcp">` (`:197`), above the `{#each rows ...}` block, add:

```svelte
        {#if rows.length === 0}
          <EmptyState
            title="No MCP servers selected"
            hint="Add a server to let coding sessions reach it on your behalf." />
        {/if}
```

The Add button sits directly beneath, so `EmptyState` needs no `action` snippet — one would duplicate the control a few pixels below it.

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 8: Run the repo checks**

```bash
bun run format && bun run lint && bun run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte tests/client/settings/sections/CodingMcpSection.test.ts
git commit -m "fix(settings): give the coding MCP dead ends a title and a next step

The error state headlined a raw exception, inverting ErrorState's own documented
contract; it now names the failed operation and demotes the exception to the
collapsed detail slot. Both dead-end states render through EmptyState. The
instructional intro keeps its .placeholder styling -- that is house convention."
```

---

## Task 5: Layout — actions-row inset and select fill

Closes `coding-mcp-actions-row-escapes-card-alignment` (Med) and `coding-mcp-peer-field-widths-diverge` (Med). Both are CSS-only and both are verified by browser measurement, not by unit test.

**This task carries the branch's hardest-won lesson: a CSS property being present in the diff is not evidence it takes effect.** Six earlier reviews passed a `style:width` that did nothing. Step 5 is not optional.

Two traps specific to this fix:

1. `Select` has a `block` prop that looks like the obvious tool. **Do not use it.** `.ui-select--block` also forces `height: var(--row-h)` and `font-size: 14px` (`Select.svelte:105-110`), while `Input` renders 12px text at an intrinsic height (`Input.svelte:116-125`). `block` would trade the width mismatch for a type-size and height mismatch.
2. `width: 100%` on `.ui-select` alone is **not sufficient**. `.ui-select` is a flex row containing the `<select>` and a caret span, and it grants `flex: 1` to its `<select>` only under the `block` variant. Widen the wrapper without growing the child and you get a wide box with a 152px select and dead space inside it — a different bug with the same screenshot.

**Files:**

- Modify: `client/settings/sections/CodingMcpSection.svelte` (`<style>` block only — the `.settings-mcp__field :global(...)` rule at `:315` and `.settings-field__actions` at `:321`)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Widen the select and grow its inner control**

In `client/settings/sections/CodingMcpSection.svelte`, replace the rule at `:315-317`:

```css
  .settings-mcp__field :global(.ui-input),
  .settings-mcp__field :global(.ui-select) {
    width: 100%;
  }
  /* .ui-select is a flex row (select + caret) and only grants its <select> flex-grow
     under the `block` variant -- which also forces --row-h height and 14px text, a new
     mismatch against Input's 12px. Grow the select here instead, so the two peer fields
     match in width without diverging in type size. */
  .settings-mcp__field :global(.ui-select select) {
    flex: 1;
    min-width: 0;
  }
```

`min-width: 0` overrides the flex default of `auto`, which would otherwise floor the select at its intrinsic content width and reintroduce overflow at narrow viewports.

- [ ] **Step 2: Inset the actions row**

Replace the `.settings-field__actions` rule at `:321-326`:

```css
  .settings-field__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    /* Measured against *this* section's card geometry: the row cards use
       padding: var(--gap-inline) plus a 1px border, putting their content edge at 13px.
       CodingCredentialsSection.svelte and CodeHostSection.svelte use 14px because they
       measured their own, different cards. Re-measure before changing this; do not
       "unify" it with the siblings' value. */
    padding-inline: 13px;
  }
```

- [ ] **Step 3: Start Storybook**

```bash
bun run storybook
```

Wait for it to serve on `http://localhost:6006`. Leave it running for Steps 4 and 5.

- [ ] **Step 4: Re-shoot the section**

```bash
bun shoot -g CodingMcpSection
```

Read the emitted PNGs for the Populated and narrow states. Expected: the select now spans its flex item, the ~390px gap before the `CREDENTIAL` label is gone, and the actions row's left and right edges line up with the row cards above.

- [ ] **Step 5: Measure — do not trust the screenshot or the diff**

With Storybook still running, measure the two claims directly. Save this to the scratchpad as `measure.mjs` and run it with `node measure.mjs`:

```js
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:6006/iframe.html?id=settings-sections-codingmcpsection--populated')
await page.waitForSelector('[data-testid="coding-mcp-row-0"]')

const result = await page.evaluate(() => {
  const card = document.querySelector('.settings-mcp__row').getBoundingClientRect()
  const add = document.querySelector('[data-testid="coding-mcp-add"]').getBoundingClientRect()
  const save = document.querySelector('[data-testid="coding-mcp-save"]').getBoundingClientRect()
  const select = document.querySelector('[data-testid="coding-mcp-server-0"]').getBoundingClientRect()
  const selectField = document.querySelector('.settings-mcp__field--server').getBoundingClientRect()
  return {
    cardLeft: card.left,
    cardRight: card.right,
    addLeft: add.left,
    saveRight: save.right,
    selectWidth: select.width,
    selectFieldWidth: selectField.width,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  }
})
console.log(result)
await browser.close()
```

Expected, and each is a gate:

- `addLeft` equals `cardLeft` (within 1px) and `saveRight` equals `cardRight` (within 1px). If `addLeft` is still `0`, the `padding-inline` is not taking effect — find out why rather than nudging the number.
- `selectWidth` is close to `selectFieldWidth`, not the old 152.0. **If `selectWidth` is still ~152 while the wrapper widened, the `flex: 1` on the inner `select` is missing or not matching** — this is trap 2 above, and it is the failure mode that looks correct in a diff.
- `docScrollWidth === docClientWidth` — no horizontal overflow introduced.

Repeat the run with `{ width: 640, height: 900 }` and confirm `docScrollWidth === docClientWidth` still holds at the narrow viewport.

- [ ] **Step 6: Run the repo checks**

```bash
bun run format && bun run lint && bun run typecheck
```

Expected: all pass.

- [ ] **Step 7: Run the client tests to confirm no behavioural regression**

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/CodingMcpSection.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/CodingMcpSection.svelte
git commit -m "fix(settings): align the coding MCP actions row and match its peer fields

Measured at 1280px: the actions row sat 13px outside the card content edge on
both sides, with Save's right edge flush against the viewport, and the server
select held its 152px intrinsic width inside a 566px flex item. Insets the row
to this section's own measured 13px, and grows the select's inner control --
the wrapper's width alone does nothing, since .ui-select only grants flex-grow
under a block variant that would force a mismatched type size."
```

---

## Task 6: Visual coverage and review close-out

Adds the duplicate-selection screenshot the new validation deserves, refreshes the baselines the layout change invalidates, and records the outcome on the review.

Every state can be driven by interaction from an existing story, exactly as the at-cap and blank-row states already are — no new story or MSW fixture is needed.

**Files:**

- Modify: `tests/visual/settings/sections/CodingMcpSection.spec.ts` (append below the generated region — never edit inside `@generated-begin`/`@generated-end`)
- Modify: `docs/ux-reviews/CodingMcpSection.md` (scorecard + finding statuses)

**Interfaces:**

- Consumes: the completed behaviour from Tasks 1–5.
- Produces: the closed-out review.

- [ ] **Step 1: Add the duplicate-selection visual state**

Append to `tests/visual/settings/sections/CodingMcpSection.spec.ts`, after the existing manual tests:

```ts
test('CodingMcp — a duplicate server marks the later row and blocks Save', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
  await sharedPage.getByTestId('coding-mcp-add').click()
  await sharedPage.getByTestId('coding-mcp-server-2').selectOption('search')
  await expect(sharedPage.getByTestId('coding-mcp-save')).toBeDisabled()
  await expect(sharedPage).toHaveScreenshot()
})

test('CodingMcp — the server cap is stated beside Add', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-codingmcpsection--populated')
  await expect(sharedPage.getByTestId('coding-mcp-cap')).toHaveText('2 of 3 servers used')
})
```

The Populated fixture (`client/stories/msw/settings-handlers-personal-2.ts:129-142`) seeds `plugin:synthetic-web-search` and `search` against `maxMcpServers: 3`. So the added row is index 2, and selecting `search` there duplicates row 1 — the later row is the one that must carry the error. Do not modify the fixture; it already produces every state these tests need.

- [ ] **Step 2: Re-shoot every state**

```bash
bun shoot -g CodingMcpSection
```

Note `shoot` is `playwright test --update-snapshots=all` and its output lands in `.storybook-shots/`, which is gitignored. There is no baseline to accept or commit — the PNGs are an agent feedback loop, so the only gate is you reading them.

- [ ] **Step 3: Read every emitted PNG**

The inset and select-width changes move the layout, so every state's image changes. Open each one under `.storybook-shots/tests/visual/settings/sections/CodingMcpSection.spec.ts/` and confirm the differences are only these:

- the actions row shifted inward on both edges, its ends aligned with the row cards above
- the server select filled its column, with the ~390px gap before the `CREDENTIAL` label gone
- the cap count present beside Add
- in the two dead-end states, an `EmptyState` block with a title in place of the bare prose
- in the new duplicate state, an error message under the later row's select and a disabled Save

Anything else is a regression to investigate before committing. Since the images are regenerated rather than compared, nothing fails the run for you — an unnoticed regression here simply ships.

- [ ] **Step 4: Update the review scorecard and finding statuses**

In `docs/ux-reviews/CodingMcpSection.md`:

- Set `status` to `fixed` on all nine in-scope findings. Leave `coding-mcp-live-region-mounts-with-text` as `open`.
- Dimension 4 (Feedback & state): `fail` → `pass`. Rationale: duplicate and blank rows are both blocked with the reason named on the offending row, and the cap is stated beside Add.
- Dimension 8 (Spacing, alignment & sizing): `fail` → `pass`. Rationale: measured — actions row aligns to the card content edge on both sides, peer fields match in width.
- Dimension 3 (Consistency): `warn` → `pass`. Rationale: `EmptyState` now used; `.settings-field__actions` carries a measured inset with its divergence from the siblings documented.
- Dimension 5 (Content & language): `warn` → `pass`. Rationale: error state names the failed operation; both dead ends carry a title and a next step.
- Dimension 9 (Interaction & micro-states): `warn` → `pass`. Rationale: both async actions announce via `aria-busy`; Remove locks with its siblings.
- Dimension 6 (Accessibility): stays `warn`. Rewrite the rationale so it rests **only** on the deferred live-region finding — the `aria-busy` half of the original rationale is now fixed and must not be left implying an open defect.

- [ ] **Step 5: Stage, then run the check suite**

`bun run check` is `./scripts/check.sh --staged`, so it only inspects staged files. Stage first:

```bash
git add tests/visual/settings/sections/CodingMcpSection.spec.ts docs/ux-reviews/CodingMcpSection.md
bun run check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git commit -m "test(visual): cover the coding MCP duplicate state and close the review

Adds a duplicate-selection screenshot and a cap-count assertion, refreshes the
baselines the alignment and select-width fixes invalidate, and re-scores the
review: dimensions 3, 4, 5, 8 and 9 reach pass. Dimension 6 stays warn on the
deferred cross-section live-region finding alone."
```

---

## Self-Review

**Spec coverage.** Each of the design's six sections maps to a task: validation model → Task 1; cap counter → Task 2; actions-row inset and select fill → Task 5; the four state/feedback corrections → Tasks 3 (busy, Remove guard) and 4 (error state, empty states); testing → distributed across every task plus Task 6. The design's three out-of-scope items produce no task, as intended. The design's "Testing" section also calls for a re-score, which is Task 6 Step 4.

**Type and name consistency.** `rowProblems` and `hasRowProblem` are introduced in Task 1 and referenced under those exact names in Task 3's Save predicate. `hasEmptyServer` is deleted in Task 1 and Step 6 of that task greps to prove no call site survives. `capLabel` is used only within Task 2. Test helpers `json`, `drain`, `mcpPayload`, `loadedMock`, `mountSection`, `pickServer`, `rowError`, and `saveButton` are all defined in Task 1's file creation and reused by name in Tasks 2–4.

**Deliberate deviation from strict TDD.** Task 5 has no failing unit test, because CSS geometry is not unit-testable here; its Step 5 browser measurement is the gate, with explicit expected values and a named failure mode. Task 2 Step 6 and Task 5 Step 5 both exist specifically to prove a change is load-bearing rather than merely present.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-08-coding-mcp-open-findings.md`.**
