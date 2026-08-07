<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AdminUsersSection Open Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all seventeen open UX findings against `client/settings/sections/admin/AdminUsersSection.svelte`, extracting the reusable pieces into shared modules along the way.

**Architecture:** Most defects are *adoption* failures — the section predates `ErrorState`, `EmptyState`, `Pill`, and `role="status"`, all of which sibling sections already use. Four fixes belong outside the section (a shared touched-field helper, an `IconButton` `aria-busy` attribute, a `SettingsTable` no-match state, a `status-tone` entry) and land first so the section can consume them. The rest reshape the section itself: a three-way load state machine over `Promise.allSettled`, a five-column sortable width-pinned table with a derived Status column, a person-naming remove confirmation, and a touched-gated add form.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`, `$derived.by`, `$effect`, snippets), TypeScript strict, Bun test with `mount`/`unmount`/`flushSync`, `@crvy/strybk` + Playwright for screenshots, msw for Storybook fixtures.

## Global Constraints

- Runtime is **Bun**; the formatter is **oxfmt** (`bun run format`), never prettier; the linter is **oxlint**.
- **Use the `.js` extension in every import path**, including `.ts` sources.
- **Never add a lint-disable or type-ignore comment** — the write hook blocks them; fix the underlying issue.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- Every new file carries the four-line BUSL license header (`//` for `.ts`, `<!-- -->` for `.svelte`, matching the sibling files exactly).
- Existing tests are **updated, never deleted**, when behaviour they assert intentionally changes.
- Finding ids are fixed strings — copy them verbatim from this plan into `docs/ux-reviews/AdminUsersSection.md`; never invent, rename, or reuse one.
- `added_by` is an **open set**, not an enum. The only values the server writes are `open-access` (`src/auth.ts:217,219`), `announce-subscription` (`src/announcements/store.ts:38`), and the acting admin's raw platform user id (`src/debug/settings/admin/system-access-routes.ts:54,70`). The value `admin` is never written by anything and `open_access` (underscore) does not exist — both are fixture bugs corrected in Task 4.
- A "pending" user is one whose `platform_user_id` starts with the literal prefix `placeholder-`.
- Run `bun run format` before every commit; the pre-commit hook runs lint, typecheck, format:check, and license-headers on staged files.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `client/shared/ui/field-touched.ts` | Create | `shownError` / `markTouched` — gate a validation message on the field having been touched. Extracted from `AdminInstancesSection`, consumed by both sections. |
| `client/shared/ui/status-tone.ts` | Modify (`:8-35`) | Add `blocked: 'danger'` to `TONE_MAP`. |
| `client/shared/ui/IconButton.svelte` | Modify (`:17-26`) | Add `aria-busy`, matching `Btn.svelte:53`. |
| `client/settings/components/SettingsTable.svelte` | Modify (`:12-17`, `:50-52`) | Pass `sortable` / `sortAccessor` / `defaultSort` through to `DataTable`; render a distinct "no matches" state with a Clear-search action when a search filters everything out. |
| `client/settings/sections/admin/admin-users-presenters.ts` | Create | Pure presentation logic for the users table: `describeAddedBy`, `removeUserLabel`, `userStatus`. |
| `client/settings/sections/admin/AdminUsersSection.svelte` | Modify (whole file) | Load state machine, open-access card, five-column table, actions + confirmation, add-form validation, announcements, empty state, token-scale spacing. |
| `client/settings/sections/admin/AdminInstancesSection.svelte` | Modify (`:89-100`) | Delete the local helpers, import the shared ones. |
| `client/stories/msw/settings-handlers.ts` | Modify (`:163-215`) | Correct the `added_by` fixture values; add a long username; add an `openAccessError` scenario. |
| `client/settings/sections/admin/AdminUsersSection.stories.svelte` | Modify | Add the `OpenAccessError` story. |
| `tests/client/shared/ui/field-touched.test.ts` | Create | Unit tests for the extracted helpers. |
| `tests/client/settings/sections/admin/admin-users-presenters.test.ts` | Create | Unit tests for the three pure presenters. |
| `tests/client/shared/ui/IconButton.test.ts` | Modify | `aria-busy` assertions. |
| `tests/client/shared/ui/status-tone.test.ts` | Modify | `blocked` tone assertion. |
| `tests/client/settings/components/SettingsTable.test.ts` | Modify | No-match state, clear-search, sort pass-through. |
| `tests/client/settings/sections/admin/AdminUsersSection.test.ts` | Modify | New behaviour; two existing tests updated. |
| `tests/visual/settings/sections/admin/AdminUsersSection.spec.ts` | Modify | One new manual state below `// @generated-end auto-screenshots`. |
| `docs/ux-reviews/AdminUsersSection.md` | Modify | Flip all seventeen findings to `fixed` with a `Resolved:` line. |
| `docs/ux-reviews/_BACKLOG.md` | Regenerate | `bun run ux:backlog`. |

---

## Finding coverage

| Finding id | Sev | Task |
| --- | --- | --- |
| `admin-users-loading-reads-as-empty` | High | 5 |
| `admin-users-load-failure-renders-live-controls` | High | 5 |
| `admin-users-open-access-toggle-acts-on-unloaded-state` | High | 5 |
| `admin-users-add-blank-id-silent-noop` | High | 8 |
| `admin-users-blocked-row-unmarked` | Med | 6 |
| `admin-users-remove-confirm-names-raw-id` | Med | 7 |
| `admin-users-block-vs-remove-unexplained` | Med | 7 |
| `admin-users-add-not-guarded-against-double-submit` | Med | 8 |
| `admin-users-status-not-announced` | Med | 9 |
| `admin-users-hand-rolled-badges` | Med | 6 |
| `admin-users-raw-source-values` | Med | 6 |
| `admin-users-table-not-sortable-or-width-pinned` | Med | 6 |
| `admin-users-empty-copy-dead-end` | Low | 3 + 9 |
| `admin-users-open-access-card-offscale` | Low | 9 |
| `admin-users-username-truncates-silently` | Low | 6 |
| `admin-users-pending-id-hidden` | Low | 6 |
| `admin-users-refresh-busy-not-announced` | Low | 2 |

---

## Task 1: Shared touched-field helpers

`AdminInstancesSection.svelte:89-100` holds two helpers the users add form needs. Extract them to a shared module, generalising the "always show this message even if untouched" special case (currently hardcoded to `DUPLICATE_ID_MESSAGE`) into an optional predicate.

**Files:**
- Create: `client/shared/ui/field-touched.ts`
- Create: `tests/client/shared/ui/field-touched.test.ts`
- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte:89-100`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `shownError(errors: Readonly<Record<string, string | undefined>>, touched: readonly string[], field: string, alwaysShow?: (message: string) => boolean): string | undefined`
  - `markTouched(touched: readonly string[], field: string): string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/field-touched.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { markTouched, shownError } from '../../../../client/shared/ui/field-touched.js'

describe('shownError', () => {
  test('hides a message for an untouched field', () => {
    expect(shownError({ id: 'Required.' }, [], 'id')).toBeUndefined()
  })

  test('shows a message once the field is touched', () => {
    expect(shownError({ id: 'Required.' }, ['id'], 'id')).toBe('Required.')
  })

  test('returns undefined when the field has no error', () => {
    expect(shownError({}, ['id'], 'id')).toBeUndefined()
  })

  test('shows an always-show message even when untouched', () => {
    const alwaysShow = (m: string): boolean => m === 'That ID is already in use.'
    expect(shownError({ id: 'That ID is already in use.' }, [], 'id', alwaysShow)).toBe('That ID is already in use.')
  })

  test('still gates a non-matching message when an always-show predicate is given', () => {
    const alwaysShow = (m: string): boolean => m === 'That ID is already in use.'
    expect(shownError({ id: 'Required.' }, [], 'id', alwaysShow)).toBeUndefined()
  })
})

describe('markTouched', () => {
  test('appends a field that is not yet touched', () => {
    expect(markTouched([], 'id')).toEqual(['id'])
  })

  test('returns the same array reference when already touched', () => {
    const touched = ['id']
    expect(markTouched(touched, 'id')).toBe(touched)
  })

  test('does not mutate the input array', () => {
    const touched: string[] = []
    markTouched(touched, 'id')
    expect(touched).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/field-touched.test.ts`
Expected: FAIL — `Cannot find module '.../client/shared/ui/field-touched.js'`

- [ ] **Step 3: Write minimal implementation**

Create `client/shared/ui/field-touched.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Resolve the validation message a field should currently display.
 *
 * A message is withheld until the user has touched the field, so a pristine
 * form does not open covered in errors. `alwaysShow` opts a message out of that
 * gate — use it for server-confirmed problems (e.g. a duplicate id) that are
 * true regardless of whether the user has visited the field.
 */
export function shownError(
  errors: Readonly<Record<string, string | undefined>>,
  touched: readonly string[],
  field: string,
  alwaysShow?: (message: string) => boolean,
): string | undefined {
  const message = errors[field]
  if (message === undefined) return undefined
  if (alwaysShow?.(message) === true) return message
  return touched.includes(field) ? message : undefined
}

/** Add `field` to `touched`, returning the original array when nothing changes. */
export function markTouched(touched: readonly string[], field: string): string[] {
  return touched.includes(field) ? (touched as string[]) : [...touched, field]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/field-touched.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Rewire AdminInstancesSection onto the shared helpers**

In `client/settings/sections/admin/AdminInstancesSection.svelte`, delete lines 89-100 (the local `shownError` and `markTouched` definitions) and add the import beside the other `client/shared/ui` imports:

```ts
  import { markTouched, shownError } from '../../../shared/ui/field-touched.js'
```

Then update every local call site to pass the predicate that the deleted code hardcoded. Find them with:

```bash
grep -n "shownError(" client/settings/sections/admin/AdminInstancesSection.svelte
```

Each call of the form `shownError(<errors>, <touched>, 'id')` becomes:

```ts
shownError(<errors>, <touched>, 'id', (m) => m === DUPLICATE_ID_MESSAGE)
```

Leave `DUPLICATE_ID_MESSAGE` and every `markTouched(...)` call site exactly as they are — `markTouched`'s signature is unchanged.

- [ ] **Step 6: Run the instances suite to verify nothing regressed**

Run: `bun test tests/client/settings/sections/admin/AdminInstancesSection.test.ts`
Expected: PASS — same count as before the edit, zero failures.

- [ ] **Step 7: Typecheck and format**

Run: `bun run typecheck && bun run format`
Expected: no errors; oxfmt may rewrite whitespace.

- [ ] **Step 8: Commit**

```bash
git add client/shared/ui/field-touched.ts tests/client/shared/ui/field-touched.test.ts client/settings/sections/admin/AdminInstancesSection.svelte
git commit -m "refactor(ui): extract shownError and markTouched into a shared module"
```

---

## Task 2: `IconButton` announces its busy state

Closes `admin-users-refresh-busy-not-announced`. `Btn.svelte:53` already sets `aria-busy={busy}`; `IconButton` styles a busy state but never exposes it, so a screen-reader user hears nothing while Refresh is in flight.

**Files:**
- Modify: `client/shared/ui/IconButton.svelte:17-26`
- Test: `tests/client/shared/ui/IconButton.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IconButton` renders `aria-busy="true"` when `busy` is `true` and omits the attribute otherwise. Props are unchanged: `{ label: string; glyph: string; onClick?: () => void; busy?: boolean; testid?: string }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/IconButton.test.ts`, inside the existing `describe('IconButton', ...)` block:

```ts
  test('marks the button aria-busy while busy', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(IconButton, { target, props: { label: 'Refresh', glyph: '⟳', busy: true } })
    flushSync()
    expect(target.querySelector('button')!.getAttribute('aria-busy')).toBe('true')
    void unmount(c)
  })

  test('omits aria-busy when not busy', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(IconButton, { target, props: { label: 'Refresh', glyph: '⟳' } })
    flushSync()
    expect(target.querySelector('button')!.hasAttribute('aria-busy')).toBe(false)
    void unmount(c)
  })
```

If `flushSync` is not already imported in that file, extend the existing svelte import to `import { flushSync, mount, unmount } from 'svelte'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/IconButton.test.ts`
Expected: FAIL — `expect(null).toBe("true")` on the first new test.

- [ ] **Step 3: Write minimal implementation**

In `client/shared/ui/IconButton.svelte`, replace the `<button>` open tag (lines 17-24) with:

```svelte
<button
  type="button"
  class="ui-iconbtn"
  class:ui-iconbtn--busy={busy}
  aria-label={label}
  aria-busy={busy ? 'true' : undefined}
  title={label}
  data-testid={testid}
  onclick={onClick}>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/IconButton.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/shared/ui/IconButton.svelte tests/client/shared/ui/IconButton.test.ts
git commit -m "fix(ui): announce IconButton's busy state with aria-busy"
```

---

## Task 3: `SettingsTable` sorts, and says when a search matched nothing

Half of `admin-users-empty-copy-dead-end` (the search-miss half; the section's own empty copy is Task 9) plus the pass-through `admin-users-table-not-sortable-or-width-pinned` needs. `SettingsTable`'s local `Column` type drops `sortable`/`sortAccessor` before reaching `DataTable`, and it hands the consumer's `empty` snippet to `DataTable` whether the list is genuinely empty or a search filtered it out — so "No users" appears while three users exist.

**Files:**
- Modify: `client/settings/components/SettingsTable.svelte:12-17` (Column type + `defaultSort` prop), `:50-52` (the scroll body)
- Test: `tests/client/settings/components/SettingsTable.test.ts`

**Interfaces:**
- Consumes: `EmptyState` (`{ title: string; icon?: string; hint?: string; action?: Snippet }`), `Btn`.
- Produces: `SettingsTable` gains two optional passthroughs on each column — `sortable?: boolean` and `sortAccessor?: (row: Row) => string | number` — and a new optional prop `defaultSort?: { key: keyof Row & string; dir: 'asc' | 'desc' }`. When `rows.length > 0` and the search filters everything out it renders an `EmptyState` titled `No matches` with a `data-testid="settings-table-clear-search"` button instead of the table.

- [ ] **Step 1: Write the failing test**

Append to `tests/client/settings/components/SettingsTable.test.ts`, inside the existing `describe('SettingsTable', ...)` block:

```ts
  test('shows a no-matches state instead of the empty snippet when a search filters everything out', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
    search.value = 'zzzz'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(target.textContent).toContain('No matches')
    expect(target.textContent).toContain('zzzz')
    expect(target.querySelector('tbody')).toBeNull()
    void unmount(c)
  })

  test('clear search restores every row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
    search.value = 'zzzz'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="settings-table-clear-search"]')!.click()
    flushSync()
    expect(target.querySelectorAll('tbody tr').length).toBe(25)
    void unmount(c)
  })

  test('an empty row set still renders the consumer empty snippet, not the no-matches state', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsTable, { target, props: { columns, rows: [], rowKey: 'id', searchKeys: ['id', 'name'] } })
    flushSync()
    expect(target.textContent).not.toContain('No matches')
    void unmount(c)
  })

  test('passes sortable columns and defaultSort through to the table', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const sortableColumns = [
      { key: 'id' as const, label: 'ID' },
      { key: 'name' as const, label: 'Name', sortable: true },
    ]
    const three: Row[] = [
      { id: '1', name: 'charlie' },
      { id: '2', name: 'alice' },
      { id: '3', name: 'bob' },
    ]
    const c = mount(SettingsTable, {
      target,
      props: {
        columns: sortableColumns,
        rows: three,
        rowKey: 'id',
        searchKeys: ['id', 'name'],
        defaultSort: { key: 'name' as const, dir: 'asc' as const },
      },
    })
    flushSync()
    const firstRow = target.querySelectorAll('tbody tr')[0]!
    expect(firstRow.textContent).toContain('alice')
    void unmount(c)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/settings/components/SettingsTable.test.ts`
Expected: FAIL — the no-matches test fails on `expect("").toContain("No matches")`, and the sort test fails because `charlie` renders first.

- [ ] **Step 3: Write minimal implementation**

In `client/settings/components/SettingsTable.svelte`, add the two imports beside the existing ones:

```ts
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
```

Replace the `Column` interface and `Props` interface (lines 12-28) with:

```ts
  type SortDir = 'asc' | 'desc'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: 'left' | 'right' | 'center'
    width?: string
    sortable?: boolean
    sortAccessor?: (row: R) => string | number
  }
  interface Props {
    columns: Column<Row>[]
    rows: Row[]
    rowKey: keyof Row & string
    searchKeys: (keyof Row & string)[]
    cell?: Snippet<[Row, Column<Row>]>
    empty?: Snippet
    pageSize?: number
    searchPlaceholder?: string
    defaultSort?: { key: keyof Row & string; dir: SortDir }
  }
  let {
    columns,
    rows,
    rowKey,
    searchKeys,
    cell,
    empty,
    pageSize = 25,
    searchPlaceholder = 'Search…',
    defaultSort,
  }: Props = $props()
```

Add a `clearSearch` function next to `onSearch` (line 42):

```ts
  function onSearch(v: string): void { query = v; page = 0 }
  function clearSearch(): void { query = ''; page = 0 }

  const noMatches = $derived(rows.length > 0 && filtered.length === 0)
```

Replace the scroll body (lines 50-52) with:

```svelte
  <div class="settings-table__scroll">
    {#if noMatches}
      <EmptyState title="No matches" icon="⌕" hint={`Nothing matches “${query.trim()}”.`}>
        {#snippet action()}
          <Btn variant="outline" size="sm" onClick={clearSearch} testid="settings-table-clear-search">
            {#snippet children()}Clear search{/snippet}
          </Btn>
        {/snippet}
      </EmptyState>
    {:else}
      <DataTable {columns} rows={pageRows} {cell} {rowKey} {empty} {defaultSort} />
    {/if}
  </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/components/SettingsTable.test.ts`
Expected: PASS — all tests, old and new.

- [ ] **Step 5: Run the other four SettingsTable consumers**

Run:
```bash
bun test tests/client/settings/sections/admin/
```
Expected: PASS. `AdminAdminsSection`, `AdminByokSection`, `AdminPluginsApprovalSection`, and `AdminGroupsSection` pass no `defaultSort` and no `sortable` columns, so their behaviour is unchanged.

- [ ] **Step 6: Commit**

```bash
bun run format
git add client/settings/components/SettingsTable.svelte tests/client/settings/components/SettingsTable.test.ts
git commit -m "feat(settings): give SettingsTable a no-match state and sort passthrough"
```

---

## Task 4: Correct the Storybook users fixture

The Storybook fixture at `client/stories/msw/settings-handlers.ts:163-215` is wrong in two ways: `added_by: 'admin'` is a value the server never writes, and `added_by: 'open_access'` (underscore) does not exist — the real value is `open-access`. Every later screenshot would encode the wrong data. This task also adds a long username so the truncation fix in Task 6 has something to truncate, and an `openAccessError` scenario so Task 5's partial-failure branch is shootable.

**Files:**
- Modify: `client/stories/msw/settings-handlers.ts:163-215`
- Modify: `client/settings/sections/admin/AdminUsersSection.stories.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces: the `populated` scenario serves four users — `123456789`/`alice_tg`/`added_by: '555000111'`, `placeholder-@bob_handle`/`@bob_handle`/`added_by: '555000111'`, `987654321`/`charlie`/`added_by: 'open-access'`/blocked, and `246813579`/`a_very_long_telegram_username_that_will_not_fit` /`added_by: 'announce-subscription'`. A new `openAccessError` scenario serves the users list normally while `/settings/api/admin/open-access` 500s, exposed as the `OpenAccessError` story with id `settings-sections-admin-adminuserssection--open-access-error`.

- [ ] **Step 1: Correct and extend the sample**

Replace `client/stories/msw/settings-handlers.ts:163-188` (the `adminUsersSample` constant) with:

```ts
const adminUsersSample = {
  users: [
    {
      platform_user_id: '123456789',
      platform_instance_id: 'tg-main',
      username: 'alice_tg',
      added_by: '555000111',
      blocked_at: null,
    },
    {
      platform_user_id: 'placeholder-@bob_handle',
      platform_instance_id: 'tg-main',
      username: '@bob_handle',
      added_by: '555000111',
      blocked_at: null,
    },
    {
      platform_user_id: '987654321',
      platform_instance_id: 'tg-main',
      username: 'charlie',
      added_by: 'open-access',
      blocked_at: '2026-01-15T10:00:00Z',
    },
    {
      platform_user_id: '246813579',
      platform_instance_id: 'tg-main',
      username: 'a_very_long_telegram_username_that_will_not_fit',
      added_by: 'announce-subscription',
      blocked_at: null,
    },
  ],
}
```

- [ ] **Step 2: Add the openAccessError scenario**

In the `adminUsersHandlers` object (from line 196), add a new key after `populated`:

```ts
  openAccessError: [
    http.get('/settings/api/admin/users', () => HttpResponse.json(adminUsersSample)),
    http.get('/settings/api/admin/open-access', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    ...adminUsersWrites,
  ],
```

- [ ] **Step 3: Add the story**

In `client/settings/sections/admin/AdminUsersSection.stories.svelte`, add a story mirroring the existing `Error` story's shape but naming the new scenario. Read the existing stories first:

```bash
cat client/settings/sections/admin/AdminUsersSection.stories.svelte
```

Copy the `Error` story block verbatim, rename it `OpenAccessError`, and change its msw scenario name from `error` to `openAccessError`. Do not change any other story.

- [ ] **Step 4: Verify the story renders**

Run: `bun run typecheck`
Expected: no errors.

With Storybook running (`bun storybook`), confirm the story appears at `settings-sections-admin-adminuserssection--open-access-error`. If Storybook is not running, skip the visual check — Task 10 re-shoots everything.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/stories/msw/settings-handlers.ts client/settings/sections/admin/AdminUsersSection.stories.svelte
git commit -m "fix(stories): use real added_by values in the admin users fixture"
```

---

## Task 5: The load state machine

Closes `admin-users-loading-reads-as-empty`, `admin-users-load-failure-renders-live-controls`, and `admin-users-open-access-toggle-acts-on-unloaded-state`.

Today `load()` runs `Promise.all([fetchAdminUsers(), fetchOpenAccess()])` inside one try/catch: either failure loses both results, sets a thin `<p class="status-error">`, and leaves the table rendering "No users" beneath a full set of live controls. And `openDmAccess` defaults to `false`, so if the open-access fetch fails the toggle reads "Enable" and `toggleAccess()` computes `enabling = true` — pressing it could grant open DM access to a bot that already has it, or re-enable it after someone disabled it.

The fix splits the two fetches: the user list is fatal (`ErrorState` replaces the whole body, with retry), the open-access setting is non-fatal (inline error on its own card, toggle disabled until loaded). A separate `initialLoad` flag distinguishes the first load — which shows `Loading…` — from a Refresh, which leaves the current data on screen.

**Files:**
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte:25-52` (state + `load`), `:54-68` (`toggleAccess`), `:159-177` (markup)
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

**Interfaces:**
- Consumes: `ErrorState` (`{ message, title?, icon?, detail?, onRetry?, retryLabel? }`), `Pill` (`{ children: Snippet, tone?, dot?, id? }`).
- Produces: the section's new reactive state, relied on by Tasks 6-9 —
  - `usersLoadError: string | null` — fatal; when non-null the body is an `ErrorState`
  - `openAccessError: string | null` — non-fatal; inline on the card
  - `openAccessLoaded: boolean` — false until `fetchOpenAccess()` has succeeded at least once in the current load
  - `initialLoad: boolean` — true until the first `load()` settles
  - `errorMessage(err: unknown): string` — the shared extraction helper

- [ ] **Step 1: Write the failing tests**

Add these mocks near the other mock definitions at the top of `tests/client/settings/sections/admin/AdminUsersSection.test.ts`:

```ts
const usersFailMock = (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input)
  if (url.includes('/open-access')) return Promise.resolve(json(openAccessOn))
  return Promise.resolve(new Response(JSON.stringify({ error: 'users boom' }), { status: 500 }))
}

const openAccessFailMock = (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input)
  if (url.includes('/open-access')) {
    return Promise.resolve(new Response(JSON.stringify({ error: 'access boom' }), { status: 500 }))
  }
  return Promise.resolve(json(usersPayload))
}

const neverResolvingMock = (): Promise<Response> => new Promise<Response>(() => {})
```

Then add these tests inside `describe('AdminUsersSection', ...)`:

```ts
  test('a failed user list replaces the body with a retryable error state', async () => {
    setMockFetch(usersFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('tbody')).toBeNull()
    expect(target.querySelector('[data-testid="user-add"]')).toBeNull()
    void unmount(component)
  })

  test('a failed open-access read keeps the user list and disables the toggle', async () => {
    setMockFetch(openAccessFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('jane')
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="open-access-toggle"]')!
    expect(toggle.disabled).toBe(true)
    expect(toggle.textContent).toContain('Unavailable')
    expect(target.querySelector('[data-testid="open-access-error"]')).not.toBeNull()
    void unmount(component)
  })

  test('the open-access state pill is hidden until the value loads', async () => {
    setMockFetch(openAccessFailMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="open-access-state"]')).toBeNull()
    void unmount(component)
  })

  test('a loaded open-access setting shows an enabled pill', async () => {
    setMockFetch(openAccessOnMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="open-access-state"]')!.textContent).toContain('enabled')
    void unmount(component)
  })

  test('the first load shows a loading placeholder rather than an empty table', async () => {
    setMockFetch(neverResolvingMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('Loading…')
    expect(target.textContent).not.toContain('No users')
    void unmount(component)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — five failures; the first reports `expect(null).not.toBeNull()` for `.ui-error`.

- [ ] **Step 3: Write the state machine**

In `client/settings/sections/admin/AdminUsersSection.svelte`, add the imports:

```ts
  import ErrorState from '../../../shared/ui/ErrorState.svelte'
  import Pill from '../../../shared/ui/Pill.svelte'
```

Replace the state block (lines 25-37) with:

```ts
  let users: AdminUserRow[] = $state([])
  let openDmAccess = $state(false)
  let openAccessLoaded = $state(false)
  let togglingAccess = $state(false)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let usersLoadError: string | null = $state(null)
  let openAccessError: string | null = $state(null)
  let loading = $state(false)
  let initialLoad = $state(true)
  let newUserId = $state('')
  let newUsername = $state('')
  let pendingRemoval: string | null = $state(null)
  let blocking: string | null = $state(null)
  let removing = $state(false)
  let removeError = $state<string | null>(null)

  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
```

Replace `load()` (lines 39-52) with:

```ts
  async function load(): Promise<void> {
    error = null
    status = null
    usersLoadError = null
    openAccessError = null
    loading = true
    const [usersResult, accessResult] = await Promise.allSettled([fetchAdminUsers(), fetchOpenAccess()])
    if (usersResult.status === 'fulfilled') {
      users = usersResult.value.users
    } else {
      users = []
      usersLoadError = errorMessage(usersResult.reason)
    }
    if (accessResult.status === 'fulfilled') {
      openDmAccess = accessResult.value.openDmAccess
      openAccessLoaded = true
    } else {
      openAccessLoaded = false
      openAccessError = errorMessage(accessResult.reason)
    }
    loading = false
    initialLoad = false
  }
```

Guard `toggleAccess()` (line 54) against acting on an unloaded value by inserting one line at the top of the body:

```ts
  async function toggleAccess(): Promise<void> {
    if (!openAccessLoaded) return
    error = null
    status = null
    togglingAccess = true
    const enabling = !openDmAccess
```

Replace every remaining `err instanceof Error ? err.message : String(err)` in `toggleAccess`, `add`, `confirmRemove`, and `toggleBlock` with `errorMessage(err)`.

- [ ] **Step 4: Write the markup**

Replace lines 159-177 (the two status lines and the open-access card) with:

```svelte
  {#if error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if usersLoadError !== null}
    <ErrorState
      message="Could not load the user list."
      detail={usersLoadError}
      onRetry={() => void load()} />
  {:else if loading && initialLoad}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="open-access-card" data-testid="open-access-card">
      <div>
        <div class="open-access-title">
          <strong>Open DM access</strong>
          {#if openAccessLoaded}
            <Pill tone={openDmAccess ? 'accent' : 'mute'} dot>
              {#snippet children()}<span data-testid="open-access-state">{openDmAccess ? 'enabled' : 'disabled'}</span>{/snippet}
            </Pill>
          {/if}
        </div>
        <p class="open-access-hint">
          Anyone can DM this bot. New users are added automatically and listed below; block individuals to revoke.
        </p>
        {#if openAccessError !== null}
          <p class="status-error" role="alert" data-testid="open-access-error">
            Could not read the open DM access setting — {openAccessError}
          </p>
        {/if}
      </div>
      <Btn
        variant={openDmAccess ? 'danger' : 'primary'}
        size="sm"
        testid="open-access-toggle"
        disabled={togglingAccess || !openAccessLoaded}
        onClick={() => void toggleAccess()}>
        {#snippet children()}
          {!openAccessLoaded ? 'Unavailable' : togglingAccess ? 'Saving…' : openDmAccess ? 'Disable' : 'Enable'}
        {/snippet}
      </Btn>
    </div>
```

Then close the `{:else}` branch: add `{/if}` on its own line immediately **before** the `<Confirm` element (currently line 247), so the form, the table wrap, and the card all sit inside the else branch and the confirmation dialog sits outside it.

Add the two new style rules to the `<style>` block:

```css
  .open-access-title {
    display: flex;
    align-items: center;
    gap: var(--gap-inline);
  }
  .placeholder {
    color: var(--text-muted);
    font-size: 12px;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS — all tests including the five new ones.

- [ ] **Step 6: Commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(settings): separate the users and open-access load failures"
```

---

## Task 6: The table presenters and the five-column table

Closes `admin-users-blocked-row-unmarked`, `admin-users-hand-rolled-badges`, `admin-users-raw-source-values`, `admin-users-table-not-sortable-or-width-pinned`, `admin-users-username-truncates-silently`, and `admin-users-pending-id-hidden`.

The presentation logic — deriving a status from `blocked_at` plus the id prefix, and turning an open-set `added_by` into readable text — is pure and belongs in its own tested module rather than inline in the template. The table then grows a real Status column rendered through `Pill` (killing both hand-rolled badge classes), pins every column's width, makes four of the five sortable, and stops hiding a pending user's identifier behind a bare "pending" badge.

**Files:**
- Create: `client/settings/sections/admin/admin-users-presenters.ts`
- Create: `tests/client/settings/sections/admin/admin-users-presenters.test.ts`
- Modify: `client/shared/ui/status-tone.ts:8-35`
- Modify: `tests/client/shared/ui/status-tone.test.ts`
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte:128-149` (row shape + columns), `:203-244` (cell snippet + table), `:262-286` (styles)
- Modify: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

**Interfaces:**
- Consumes: `errorMessage`, the load-state fields from Task 5; `Pill`; `IdCell` (`{ value: string; head?: number; tail?: number }`); the `sortable`/`sortAccessor`/`defaultSort` passthrough from Task 3.
- Produces:
  - `export type UserStatus = 'active' | 'blocked' | 'pending'`
  - `export function userStatus(input: { userId: string; blocked: boolean }): UserStatus`
  - `export type AddedBy = { kind: 'label'; text: string } | { kind: 'id'; value: string } | { kind: 'none' }`
  - `export function describeAddedBy(raw: string): AddedBy`
  - `export function removeUserLabel(input: { username: string; userId: string }): string` — used by Task 7
  - the section's `UserRow` shape: `{ platform_user_id: string; username: string; status: UserStatus; added_by: string; blocked: boolean }`

- [ ] **Step 1: Write the failing presenter tests**

Create `tests/client/settings/sections/admin/admin-users-presenters.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  describeAddedBy,
  removeUserLabel,
  userStatus,
} from '../../../../../client/settings/sections/admin/admin-users-presenters.js'

describe('userStatus', () => {
  test('a blocked user is blocked even when pending', () => {
    expect(userStatus({ userId: 'placeholder-@bob', blocked: true })).toBe('blocked')
  })

  test('a placeholder id is pending', () => {
    expect(userStatus({ userId: 'placeholder-@bob', blocked: false })).toBe('pending')
  })

  test('a real id is active', () => {
    expect(userStatus({ userId: '123456789', blocked: false })).toBe('active')
  })
})

describe('describeAddedBy', () => {
  test('open-access reads as a label', () => {
    expect(describeAddedBy('open-access')).toEqual({ kind: 'label', text: 'Open access' })
  })

  test('announce-subscription reads as a label', () => {
    expect(describeAddedBy('announce-subscription')).toEqual({ kind: 'label', text: 'Announcement signup' })
  })

  test('any other value is an admin id', () => {
    expect(describeAddedBy('555000111')).toEqual({ kind: 'id', value: '555000111' })
  })

  test('an empty value has nothing to show', () => {
    expect(describeAddedBy('')).toEqual({ kind: 'none' })
  })
})

describe('removeUserLabel', () => {
  test('names an active user and their id', () => {
    expect(removeUserLabel({ username: 'alice_tg', userId: '123456789' })).toBe('alice_tg (123456789)')
  })

  test('names a pending user without exposing the placeholder id', () => {
    expect(removeUserLabel({ username: '@bob_handle', userId: 'placeholder-@bob_handle' })).toBe(
      '@bob_handle (pending)',
    )
  })

  test('falls back to the id when there is no username', () => {
    expect(removeUserLabel({ username: '—', userId: '123456789' })).toBe('123456789')
  })

  test('falls back to a description when there is neither', () => {
    expect(removeUserLabel({ username: '', userId: 'placeholder-x' })).toBe('this pending user')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/admin/admin-users-presenters.test.ts`
Expected: FAIL — `Cannot find module '.../admin-users-presenters.js'`

- [ ] **Step 3: Write the presenters**

Create `client/settings/sections/admin/admin-users-presenters.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Ids the server issues for a user who has not messaged the bot yet carry this prefix. */
const PENDING_PREFIX = 'placeholder-'

export type UserStatus = 'active' | 'blocked' | 'pending'

export function userStatus(input: { userId: string; blocked: boolean }): UserStatus {
  if (input.blocked) return 'blocked'
  return input.userId.startsWith(PENDING_PREFIX) ? 'pending' : 'active'
}

/**
 * How a user came to be authorized. The column is an open set: the server writes
 * two literal provenance markers, and otherwise the platform user id of the admin
 * who added the row.
 */
export type AddedBy = { kind: 'label'; text: string } | { kind: 'id'; value: string } | { kind: 'none' }

const ADDED_BY_LABELS: Record<string, string> = {
  'open-access': 'Open access',
  'announce-subscription': 'Announcement signup',
}

export function describeAddedBy(raw: string): AddedBy {
  if (raw === '') return { kind: 'none' }
  const label = ADDED_BY_LABELS[raw]
  if (label !== undefined) return { kind: 'label', text: label }
  return { kind: 'id', value: raw }
}

/** Name the subject of the remove confirmation as a person wherever the data allows. */
export function removeUserLabel(input: { username: string; userId: string }): string {
  const hasName = input.username !== '' && input.username !== '—'
  const pending = input.userId.startsWith(PENDING_PREFIX)
  if (hasName && !pending) return `${input.username} (${input.userId})`
  if (hasName) return `${input.username} (pending)`
  if (!pending) return input.userId
  return 'this pending user'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/admin-users-presenters.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Write the failing status-tone test**

`TONE_MAP` has `active` and `pending` but no `blocked`, so a blocked pill would render `neutral`. Append to `tests/client/shared/ui/status-tone.test.ts` inside its existing describe block:

```ts
  test('blocked reads as danger', () => {
    expect(statusTone('blocked')).toBe('danger')
  })
```

Run: `bun test tests/client/shared/ui/status-tone.test.ts`
Expected: FAIL — `expect("neutral").toBe("danger")`

- [ ] **Step 6: Add the tone**

In `client/shared/ui/status-tone.ts`, add one entry to `TONE_MAP` beside the other danger tones:

```ts
  blocked: 'danger',
```

Run: `bun test tests/client/shared/ui/status-tone.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing table tests**

In `tests/client/settings/sections/admin/AdminUsersSection.test.ts`, **update** these two existing tests rather than deleting them — the behaviour they cover is intentionally changing.

Replace the existing `renders a pending badge instead of the placeholder id` test with:

```ts
  test('a pending user shows a pending status pill and keeps a readable handle', async () => {
    setMockFetch(pendingPayloadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const pill = target.querySelector('[data-testid="user-status-placeholder-@ghost"]')!
    expect(pill.textContent).toContain('pending')
    expect(target.textContent).toContain('ghost')
    // the placeholder prefix is machinery, not an identifier — it is not shown
    expect(target.querySelector('tbody')!.textContent).not.toContain('placeholder-')
    void unmount(component)
  })
```

Replace the existing `a user row with added_by open-access shows a source badge` test with:

```ts
  test('added_by open-access reads as a labelled provenance, not a raw value', async () => {
    setMockFetch(openAccessUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const cell = target.querySelector('[data-testid="user-added-by-99"]')!
    expect(cell.textContent).toContain('Open access')
    expect(cell.textContent).not.toContain('open-access')
    void unmount(component)
  })
```

Then add these new tests:

```ts
  test('a blocked user gets a danger status pill', async () => {
    setMockFetch(blockedUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const pill = target.querySelector('.ui-pill--danger')!
    expect(pill.textContent).toContain('blocked')
    void unmount(component)
  })

  test('an active user gets an accent status pill', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-pill--accent')!.textContent).toContain('active')
    void unmount(component)
  })

  test('the username cell carries a title so a truncated name is readable', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="user-username-42"]')!.getAttribute('title')).toBe('jane')
    void unmount(component)
  })

  test('every column is width-pinned and the data columns sort', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const headers = target.querySelectorAll('thead th')
    expect(headers.length).toBe(5)
    for (const th of headers) expect(th.getAttribute('style') ?? '').toContain('width')
    void unmount(component)
  })
```

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — six failures.

- [ ] **Step 8: Reshape the row and columns**

In `client/settings/sections/admin/AdminUsersSection.svelte`, add the import:

```ts
  import { describeAddedBy, userStatus } from './admin-users-presenters.js'
  import type { UserStatus } from './admin-users-presenters.js'
  import { statusTone } from '../../../shared/ui/status-tone.js'
```

Replace the `UserRow` interface, `userRows`, and `userColumns` (lines 128-149) with:

```ts
  interface UserRow {
    platform_user_id: string
    username: string
    status: UserStatus
    added_by: string
    blocked: boolean
  }

  const userRows = $derived<UserRow[]>(
    users.map((u) => {
      const blocked = u.blocked_at != null
      return {
        platform_user_id: u.platform_user_id,
        username: u.username ?? '—',
        status: userStatus({ userId: u.platform_user_id, blocked }),
        added_by: u.added_by ?? '',
        blocked,
      }
    }),
  )

  const userColumns = [
    { key: 'platform_user_id' as const, label: 'User ID', width: '25%', sortable: true },
    { key: 'username' as const, label: 'Username', width: '25%', sortable: true },
    { key: 'status' as const, label: 'Status', width: '15%', sortable: true },
    { key: 'added_by' as const, label: 'Added by', width: '15%', sortable: true },
    { key: 'actions' as const, label: 'Actions', align: 'right' as const, width: '20%' },
  ]
```

- [ ] **Step 9: Rewrite the cell snippet's data branches**

Replace the three non-`actions` branches of the cell snippet (lines 224-234) with:

```svelte
      {:else if col.key === 'platform_user_id'}
        {#if row.status === 'pending'}
          <span class="t-mono-data pending-id" title={row.username}>{row.username}</span>
        {:else}
          <IdCell value={row.platform_user_id} />
        {/if}
      {:else if col.key === 'username'}
        <span class="cell-text" data-testid={`user-username-${row.platform_user_id}`} title={row.username}>
          {row.username}
        </span>
      {:else if col.key === 'status'}
        <Pill tone={statusTone(row.status)}>
          {#snippet children()}<span data-testid={`user-status-${row.platform_user_id}`}>{row.status}</span>{/snippet}
        </Pill>
      {:else if col.key === 'added_by'}
        {@const addedBy = describeAddedBy(row.added_by)}
        <span data-testid={`user-added-by-${row.platform_user_id}`}>
          {#if addedBy.kind === 'label'}
            <Pill tone="neutral">{#snippet children()}{addedBy.text}{/snippet}</Pill>
          {:else if addedBy.kind === 'id'}
            <IdCell value={addedBy.value} head={4} tail={4} />
          {:else}
            <span class="t-dim">—</span>
          {/if}
        </span>
      {:else}
        {String(row[col.key as keyof UserRow] ?? '')}
      {/if}
```

Update the `SettingsTable` call (line 236) to search the status text too and to sort by username on arrival:

```svelte
    <SettingsTable
      columns={userColumns}
      rows={userRows}
      rowKey="platform_user_id"
      searchKeys={['platform_user_id', 'username', 'status', 'added_by']}
      defaultSort={{ key: 'username', dir: 'asc' }}
      {cell}
      searchPlaceholder="Search users by ID, name, or status…">
```

Also widen the `cell` snippet's column parameter type so `col.key` narrows against the new keys — change line 203 to:

```svelte
    {#snippet cell(row: UserRow, col: { key: string; label: string })}
```

(unchanged; it is already this shape — confirm it, don't edit it.)

- [ ] **Step 10: Replace the hand-rolled badge styles**

In the `<style>` block, delete the `.pending-badge, .source-badge` rule entirely and add:

```css
  .pending-id {
    color: var(--text-muted);
  }
  .cell-text {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS.

- [ ] **Step 12: Confirm nothing else referenced the deleted testids**

Run:
```bash
grep -rn "user-pending-badge\|user-source-" tests/ client/ || echo "clean"
```
Expected: `clean`. If a match survives, update it to the new testids (`user-status-<id>` / `user-added-by-<id>`).

- [ ] **Step 13: Commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/admin/admin-users-presenters.ts tests/client/settings/sections/admin/admin-users-presenters.test.ts client/shared/ui/status-tone.ts tests/client/shared/ui/status-tone.test.ts client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "feat(settings): give the users table a status column, sorting, and pinned widths"
```

---

## Task 7: Actions that explain themselves

Closes `admin-users-remove-confirm-names-raw-id` and `admin-users-block-vs-remove-unexplained`.

The confirmation currently reads `Remove user placeholder-@bob_handle? This cannot be undone.` — it names a storage key, not a person, and the sentence stutters ("Remove user … Remove"). Separately, Block and Remove sit adjacent with equal `danger` weight and no explanation of how they differ, which is exactly the pair where a wrong click is unrecoverable. Reweight Block to `secondary` (it is reversible) and explain the difference where the decision is made: in each confirm.

**Files:**
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte:203-223` (action buttons), `:247-259` (Confirm)
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

**Interfaces:**
- Consumes: `removeUserLabel` from Task 6.
- Produces: `pendingRemovalRow: UserRow | null` replaces the old `pendingRemoval: string | null`; `pendingRemovalLabel` is derived through `removeUserLabel`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/sections/admin/AdminUsersSection.test.ts`:

```ts
  test('the remove confirmation names the person, not the storage id', async () => {
    setMockFetch(pendingPayloadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-placeholder-@ghost"]')!.click()
    flushSync()
    const dialog = document.body.textContent ?? ''
    expect(dialog).toContain('@ghost (pending)')
    expect(dialog).not.toContain('placeholder-@ghost?')
    void unmount(component)
  })

  test('the remove confirmation contrasts removal with blocking', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
    flushSync()
    expect(document.body.textContent).toContain('Block')
    void unmount(component)
  })

  test('block is weighted below remove', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const block = target.querySelector('[data-testid="user-block-42"]')!
    const remove = target.querySelector('[data-testid="user-remove-42"]')!
    expect(block.className).not.toContain('danger')
    expect(remove.className).toContain('danger')
    void unmount(component)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — three failures.

- [ ] **Step 3: Reshape the pending-removal state**

In `client/settings/sections/admin/AdminUsersSection.svelte`, add the import to the existing presenters import:

```ts
  import { describeAddedBy, removeUserLabel, userStatus } from './admin-users-presenters.js'
```

Replace the `pendingRemoval` declaration and its derived label with:

```ts
  let pendingRemovalRow: UserRow | null = $state(null)
  const pendingRemovalLabel = $derived(
    pendingRemovalRow === null
      ? ''
      : removeUserLabel({ username: pendingRemovalRow.username, userId: pendingRemovalRow.platform_user_id }),
  )
```

Because `UserRow` is declared below the state block today, move the `interface UserRow { … }` declaration up so it sits immediately above the state block. Interfaces are hoisted at type level but keeping the reading order sane matters here.

Update `confirmRemove()` to read the id off the row:

```ts
  async function confirmRemove(): Promise<void> {
    const userId = pendingRemovalRow?.platform_user_id
    if (userId === undefined || removing) return
    removeError = null
    removing = true
    let ok = false
    try {
      await removeAdminUser({ userId })
      ok = true
    } catch (err) {
      removeError = errorMessage(err)
    } finally {
      removing = false
    }
    if (ok) {
      pendingRemovalRow = null
      await load()
      status = 'User removed.'
    }
  }
```

- [ ] **Step 4: Reweight the actions and set the row**

Replace the `actions` branch of the cell snippet with:

```svelte
      {#if col.key === 'actions'}
        <Btn
          variant="secondary"
          size="sm"
          testid={`user-block-${row.platform_user_id}`}
          disabled={blocking === row.platform_user_id}
          onClick={() => void toggleBlock(row.platform_user_id, !row.blocked)}>
          {#snippet children()}{row.blocked ? 'Unblock' : 'Block'}{/snippet}
        </Btn>
        <Btn
          variant="danger"
          size="sm"
          testid={`user-remove-${row.platform_user_id}`}
          disabled={blocking === row.platform_user_id}
          onClick={() => {
            removeError = null
            pendingRemovalRow = row
          }}>
          {#snippet children()}Remove{/snippet}
        </Btn>
```

- [ ] **Step 5: Rewrite the confirmation**

Replace the `<Confirm>` element with:

```svelte
  <Confirm
    open={pendingRemovalRow !== null}
    title="Remove user"
    danger
    busy={removing}
    confirmLabel="Remove"
    onCancel={() => (pendingRemovalRow = null)}
    onConfirm={() => void confirmRemove()}>
    {#snippet body()}
      <p>Remove {pendingRemovalLabel}?</p>
      <p class="confirm-hint">
        They lose access entirely and drop off this list. To keep the record and revoke access reversibly, Block them
        instead.
      </p>
      {#if removeError !== null}<p class="status-error" role="alert">{removeError}</p>{/if}
    {/snippet}
  </Confirm>
```

Add the style:

```css
  .confirm-hint {
    font-size: 12px;
    color: var(--text-muted);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS. If a pre-existing removal test referenced `pendingRemoval`, it referenced it only through the DOM — no test reads the variable directly.

- [ ] **Step 7: Commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(settings): name the person in the remove confirm and reweight Block"
```

---

## Task 8: The add form validates and cannot double-fire

Closes `admin-users-add-blank-id-silent-noop` and `admin-users-add-not-guarded-against-double-submit`.

`add()` returns on line 74 when the trimmed id is empty, setting no message: pressing "Add user" on a blank form does visibly nothing. And nothing guards the in-flight window, so a double-click fires two POSTs — for a Telegram `@username` that means two pending rows.

**Files:**
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte:70-86` (`add`), `:179-200` (the form)
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

**Interfaces:**
- Consumes: `shownError` / `markTouched` from Task 1; `Field`'s `error` prop.
- Produces: `adding: boolean` (in-flight flag), `userTouched: string[]`, `userErrors: Record<string, string | undefined>`, `addBlocked: boolean`.

- [ ] **Step 1: Confirm Field accepts an error prop**

Run:
```bash
grep -n "error" client/shared/ui/Field.svelte
```
Expected: an `error?: string` entry in `Props`. If Field takes a different prop name for the inline message, use that name throughout this task instead of `error`.

- [ ] **Step 2: Write the failing tests**

Add a counting mock beside the other mocks:

```ts
let addPostCount = 0
const countingAddMock = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  if (url.includes('/open-access')) return Promise.resolve(json(openAccessOff))
  if (init?.method === 'POST') {
    addPostCount += 1
    return new Promise<Response>((resolve) => setTimeout(() => resolve(json({ ok: true, pending: false })), 5))
  }
  return Promise.resolve(json(usersPayload))
}
```

and reset it in the existing `afterEach` alongside the other counters:

```ts
  addPostCount = 0
```

Then add the tests:

```ts
  test('submitting a blank id explains why nothing happened', async () => {
    setCsrfToken('c')
    setMockFetch(countingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.textContent).toContain('Enter a numeric user ID or an @username.')
    expect(addPostCount).toBe(0)
    void unmount(component)
  })

  test('the add button is disabled while the id is blank', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.disabled).toBe(true)
    void unmount(component)
  })

  test('a pristine form shows no validation error', async () => {
    setMockFetch(openAccessOffMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).not.toContain('Enter a numeric user ID or an @username.')
    void unmount(component)
  })

  test('a double submit posts once', async () => {
    setCsrfToken('c')
    setMockFetch(countingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const button = target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!
    button.click()
    button.click()
    await drain()
    expect(addPostCount).toBe(1)
    void unmount(component)
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — four failures; the double-submit test reports `expect(2).toBe(1)`.

- [ ] **Step 4: Add the validation state**

In `client/settings/sections/admin/AdminUsersSection.svelte`, add the import:

```ts
  import { markTouched, shownError } from '../../../shared/ui/field-touched.js'
```

Add to the state block:

```ts
  let adding = $state(false)
  let userTouched: string[] = $state([])

  const userErrors = $derived<Record<string, string | undefined>>(
    newUserId.trim() === '' ? { userId: 'Enter a numeric user ID or an @username.' } : {},
  )
  const addBlocked = $derived(userErrors.userId !== undefined)
```

- [ ] **Step 5: Guard `add()`**

Replace `add()` with:

```ts
  async function add(): Promise<void> {
    userTouched = markTouched(userTouched, 'userId')
    if (addBlocked || adding) return
    error = null
    status = null
    adding = true
    const userId = newUserId.trim()
    try {
      const username = newUsername.trim()
      const result = await addAdminUser(username === '' ? { userId } : { userId, username })
      newUserId = ''
      newUsername = ''
      userTouched = []
      await load()
      status =
        result.pending === true ? "User added — they'll be authorized when they first message the bot." : 'User added.'
    } catch (err) {
      error = errorMessage(err)
    } finally {
      adding = false
    }
  }
```

- [ ] **Step 6: Wire the form**

Replace the first `<Field>` and the submit button in the form:

```svelte
    <Field
      label="User ID or @username"
      error={shownError(userErrors, userTouched, 'userId')}
      hint="For Telegram, @username adds a pending entry that activates when the user first messages the bot">
      {#snippet children()}
        <Input
          value={newUserId}
          onInput={(v) => {
            newUserId = v
            userTouched = markTouched(userTouched, 'userId')
          }}
          testid="user-add-input"
          placeholder="123456789 or @username" />
      {/snippet}
    </Field>
```

```svelte
    <Btn variant="primary" type="submit" testid="user-add" disabled={addBlocked || adding} busy={adding}>
      {#snippet children()}{adding ? 'Adding…' : 'Add user'}{/snippet}
    </Btn>
```

Note the `disabled` on the button means the blank-submit test cannot reach `add()` through a click. Keep the `onsubmit` handler as-is and additionally invoke validation on form submit so a keyboard `Enter` in the input still surfaces the message — the `Input` is inside a `<form>`, so `Enter` fires `submit` even with the button disabled.

- [ ] **Step 7: Reconcile the disabled-button test**

The blank-submit test clicks a now-disabled button, which dispatches nothing. Change that test to submit the form directly, which is what `Enter` does:

```ts
  test('submitting a blank id explains why nothing happened', async () => {
    setCsrfToken('c')
    setMockFetch(countingAddMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLFormElement>('form.settings-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    )
    await drain()
    expect(target.textContent).toContain('Enter a numeric user ID or an @username.')
    expect(addPostCount).toBe(0)
    void unmount(component)
  })
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS — including the pre-existing `adding a user posts userId` test, which fills the input first and so is never blocked.

- [ ] **Step 9: Commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(settings): validate the add-user form and guard against double submit"
```

---

## Task 9: Announcements, empty state, and the token scale

Closes `admin-users-status-not-announced`, `admin-users-empty-copy-dead-end` (the section half), and `admin-users-open-access-card-offscale`.

The `role="alert"` / `role="status"` attributes landed in Task 5; this task verifies them under test, replaces the bare `No users` text with an `EmptyState` that says what to do next, and moves the open-access card's four hardcoded pixel values onto the shared token scale (`border-radius: 4px` → `var(--radius)`, `gap: 12px` → `var(--gap-inline)`, `padding: 10px 12px` → `var(--s2) var(--s3)`, `margin-bottom: 12px` → `var(--s3)`).

**Files:**
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte` (empty snippet, styles)
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts`

**Interfaces:**
- Consumes: `EmptyState`.
- Produces: nothing new consumed downstream.

- [ ] **Step 1: Confirm the spacing tokens exist**

Run:
```bash
grep -n -- "--s2\|--s3\|--gap-inline\|--radius:" client/shared/tokens.css
```
Expected: `--radius: 6px`, `--gap-inline: 12px`, `--s3: 12px`, and an `--s2` entry. If `--s2` is absent, use `var(--s3)` for the vertical padding too and note it in the commit message.

- [ ] **Step 2: Write the failing tests**

```ts
  test('the status line is announced politely', async () => {
    setCsrfToken('c')
    setMockFetch(unblockUserMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-block-77"]')!.click()
    await drain()
    const line = target.querySelector('.status-success')!
    expect(line.getAttribute('role')).toBe('status')
    void unmount(component)
  })

  test('the error line is announced assertively', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')!.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('an empty list points at the add form instead of dead-ending', async () => {
    setMockFetch((input: RequestInfo | URL) =>
      String(input).includes('/open-access')
        ? Promise.resolve(json(openAccessOff))
        : Promise.resolve(json({ users: [] })),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.textContent).toContain('No users yet')
    expect(target.textContent).toContain('Add one above')
    void unmount(component)
  })
```

Adjust `unblockUserMock`'s user id in the first test to match whatever id that fixture already uses — check with `grep -n "unblockUserMock" -A 12 tests/client/settings/sections/admin/AdminUsersSection.test.ts` and use its `platform_user_id`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: FAIL — the empty-state test fails on `expect(...).toContain("No users yet")`. The two role tests may already pass from Task 5; that is fine — they are the regression guard.

- [ ] **Step 4: Replace the empty snippet**

Add the import:

```ts
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
```

Replace `{#snippet empty()}No users{/snippet}` with:

```svelte
      {#snippet empty()}
        <EmptyState
          title="No users yet"
          hint="Add one above by numeric ID, or by @username to create a pending entry that activates on their first message." />
      {/snippet}
```

The visible hint contains "Add one above", satisfying the test.

- [ ] **Step 5: Move the card onto the token scale**

Replace the `.open-access-card` rule:

```css
  .open-access-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--s2) var(--s3);
    margin-bottom: var(--s3);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/client/settings/sections/admin/AdminUsersSection.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole client suite**

Run: `bun test tests/client/`
Expected: PASS — zero failures across every client test.

- [ ] **Step 8: Commit**

```bash
bun run typecheck && bun run format
git add client/settings/sections/admin/AdminUsersSection.svelte tests/client/settings/sections/admin/AdminUsersSection.test.ts
git commit -m "fix(settings): announce status lines, give the empty list a next step, use tokens"
```

---

## Task 10: Re-shoot, re-score, close the backlog

The review document is the record; leaving it stale is the same failure as leaving the code broken. Every finding gets `Status: fixed` and a `Resolved:` line, the scorecard is re-derived from what the section now does, and the backlog is regenerated.

**Files:**
- Modify: `tests/visual/settings/sections/admin/AdminUsersSection.spec.ts` (below `// @generated-end auto-screenshots`)
- Modify: `docs/ux-reviews/AdminUsersSection.md`
- Regenerate: `docs/ux-reviews/_BACKLOG.md`

**Interfaces:**
- Consumes: the `OpenAccessError` story from Task 4 (`settings-sections-admin-adminuserssection--open-access-error`).
- Produces: nothing downstream.

- [ ] **Step 1: Add the open-access-failure screenshot**

Append to `tests/visual/settings/sections/admin/AdminUsersSection.spec.ts`, below the existing manual tests:

```ts
test('AdminUsersSection — open-access read failed', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-admin-adminuserssection--open-access-error')
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Re-shoot every state**

With Storybook running (`bun storybook` in another shell):

```bash
bun shoot -g AdminUsersSection
```

Expected: the four generated shots plus the seven manual ones update. New baselines are written under `.storybook-shots/` (gitignored).

- [ ] **Step 3: Read the shots and confirm each fix landed visually**

Read the PNGs under `.storybook-shots/settings/sections/admin/AdminUsersSection.spec.ts/` with the Read tool. Confirm, shot by shot:

| Shot | What to confirm |
| --- | --- |
| Populated | five columns, pinned widths, status pills (one danger, three others), "Open access"/"Announcement signup" pills, an aligned Actions column |
| Empty | "No users yet" with the hint, not a bare "No users" |
| Error | a centred `ErrorState` with a Try again button, no live form or table below it |
| Loading | "Loading…", never "No users" |
| OpenAccessError | the user list intact, the toggle reading "Unavailable" and greyed, an inline error on the card |
| populated, narrow | no horizontal overflow at 640px; the long username truncates with an ellipsis |
| remove confirm open | "Remove alice_tg (123456789)?" plus the Block-instead sentence |
| search with no matches | "No matches" with a Clear search button, not "No users" |
| add submitted with blank id | the inline validation message under the User ID field |

If any shot contradicts the table, fix the code and re-shoot before continuing. Do not proceed with a mismatch.

- [ ] **Step 4: Close every finding**

In `docs/ux-reviews/AdminUsersSection.md`, for each of the seventeen findings set `**Status:** fixed` and add a `**Resolved:**` bullet immediately after it naming the commit from the task that closed it (per the Finding coverage table above). Use `git log --oneline` to read the short SHAs.

Set the header's `**Date:**` to the date of this pass.

Re-score all nine rubric dimensions from the new screenshots and source — not from the old scorecard. Every dimension that scored `fail` or `warn` for a reason this plan addressed should now read `pass`; leave a dimension at `warn` only if you can name what still falls short in its rationale line.

- [ ] **Step 5: Regenerate the backlog**

```bash
bun run ux:backlog
```

Expected: the summary row reads `| AdminUsersSection | 0 | 17 | 0 | 0 | 0 | <today> |` and the total open count drops from 21 to 4.

- [ ] **Step 6: Full verification**

```bash
bun run typecheck && bun run lint && bun run format && bun test tests/client/
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/visual/settings/sections/admin/AdminUsersSection.spec.ts docs/ux-reviews/AdminUsersSection.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close the AdminUsersSection findings"
```

---

## Self-review notes

- **Spec coverage** — every section of `docs/superpowers/specs/2026-08-07-admin-users-open-findings-design.md` maps to a task: `field-touched.ts` → 1, `IconButton` → 2, `SettingsTable` → 3, the fixture correction the spec added with the `added_by` finding → 4, Load state machine + Open-access card → 5, Table → 6, Actions and confirmation → 7, Add form → 8, Announcements + Empty state + spacing → 9, Testing/visual → 10.
- **Ordering** — Tasks 1-4 produce everything Tasks 5-9 consume; Task 6 depends on Task 3's sort passthrough; Task 7 depends on Task 6's `UserRow` and `removeUserLabel`; Task 8 depends on Task 1.
- **Naming consistency** — `errorMessage` (Task 5) is used in Tasks 7 and 8; `userStatus`/`describeAddedBy`/`removeUserLabel` are defined once in Task 6 and referenced by exact name in Task 7; `pendingRemovalRow` replaces `pendingRemoval` in Task 7 and appears nowhere earlier.
- **Two known soft spots** flagged rather than assumed: `Field`'s error prop name (Task 8 Step 1 verifies it) and the existence of `--s2` (Task 9 Step 1 verifies it).
