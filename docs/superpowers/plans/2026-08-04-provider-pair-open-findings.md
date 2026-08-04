<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Provider-pair open-findings fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 5 open findings across `TaskProviderSection` and `GroupProviderSection`, taking both sections to `0 open` and the backlog from 29 to 24.

**Architecture:** Three duplicated code blocks (server option construction, client option label, client selection resolution) each collapse into one shared unit, and the shared units fix the defect while they de-duplicate. The server always emits a human-readable label; the client stops silently preselecting `available[0]` when nothing is bound; new MSW fixtures render the states nobody has ever screenshotted.

**Tech Stack:** Bun, TypeScript (strict, `noUncheckedIndexedAccess`, `.js` import extensions), Zod v4, Svelte 5 runes, MSW for Storybook fixtures, Playwright + `@crvy/strybk` for visual baselines, oxfmt for formatting.

**Spec:** [`docs/superpowers/specs/2026-08-04-provider-pair-open-findings-design.md`](../specs/2026-08-04-provider-pair-open-findings-design.md)

## Global Constraints

- Work stays on branch `ui-ux-review-01`. **Never merge to master. Never push. Never use `--no-verify`.**
- **Never add lint-disable or type-ignore comments** — the write hook blocks them; fix the underlying issue.
- Import paths use the `.js` extension even for `.ts` sources.
- Formatter is **oxfmt** (`bun run format`), not prettier.
- The label fallback rule, stated once and implemented twice (server + client), is exactly: use `baseUrl` when present and non-empty, otherwise `` `${typeLabel} instance (${id})` `` where `typeLabel` is `Kaneo` for `kaneo`, `YouTrack` for `youtrack`, and the raw `type` string otherwise.
- Placeholder copy, verbatim: `Not yet assigned — select an instance` (nothing bound) and `Assigned instance is unavailable — select another` (bound to an id absent from `available`). Both use an em dash (`—`), not a hyphen.
- The wire field stays named `name`. Do not rename it to `label`.
- `TaskInstanceOptionSchema.name` in `client/settings/fetcher-schemas.ts` stays `z.string().optional()`. The client fallback is deliberate defense at a trust boundary — do not delete it as dead code, and do not tighten the schema.
- `bun run visual:audit` is always run **unfiltered**. Never gate a task on a `-g`-filtered audit.
- Every changed PNG must be read with the Read tool and described. Re-shooting makes the audit pass by construction, so a green audit alone proves nothing.
- Visual audit case count: starts at **462**, ends at **466** (Task 4 adds 2, Task 5 adds 2).
- Any defect discovered that this plan did not anticipate is recorded as a **new `open` finding** in the relevant `docs/ux-reviews/*.md`. It is never absorbed silently, and never used to justify leaving a planned finding open.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/debug/settings/task-instance-options.ts` | The one server-side builder for active task-instance options, including the display-label fallback. |
| `client/settings/lib/task-instance-label.ts` | The one client-side option label formatter (defensive mirror of the server rule). |
| `client/settings/lib/task-instance-selection.ts` | The one client-side resolver for "which option is selected, and what placeholder does the empty state show". |
| `tests/debug/settings/task-instance-options.test.ts` | Unit tests for the server builder. |
| `tests/client/settings/lib/task-instance-label.test.ts` | Unit tests for the client label formatter. |
| `tests/client/settings/lib/task-instance-selection.test.ts` | Unit tests for the selection resolver. |

**Modified:**

| File | Change |
| --- | --- |
| `src/debug/settings/context-task-instance-routes.ts:36-46` | Delete the local `listActiveTaskInstanceOptions`; import the shared one. |
| `src/debug/settings/group-routes.ts:196-203` | Delete the inline option construction; import the shared builder. |
| `client/settings/sections/TaskProviderSection.svelte:51-55,130-135` | Use both client helpers; pass `placeholder` to `Select`. |
| `client/settings/sections/GroupProviderSection.svelte:40-44,95-100` | Same two changes. |
| `client/stories/msw/settings-handlers.ts` | Add the `taskProviderBoundHandlers` family. |
| `client/stories/msw/settings-handlers-group.ts` | Add the `groupProviderUnassigned` / `groupProviderNamelessBound` fixtures and handlers. |
| `client/stories/msw/scenarios.ts` | Register the three new fixture families. |
| `client/settings/sections/TaskProviderSection.stories.svelte` | Add the `Bound` story. |
| `client/settings/sections/GroupProviderSection.stories.svelte` | Add the `Unassigned` and `NamelessBound` stories. |
| `tests/visual/settings/sections/TaskProviderSection.spec.ts` | Regenerated header + one manual provision-reveal case. |
| `tests/visual/settings/sections/GroupProviderSection.spec.ts` | Regenerated header only. |
| `tests/debug/settings/context-task-instance-routes.test.ts` | Tighten the local schema's `name`; assert the fallback label. |
| `tests/debug/settings/group-routes.test.ts` | Assert the fallback label reaches the group response. |
| `tests/client/settings/sections/TaskProviderSection.test.ts` | Update 2 existing tests, add 2. |
| `tests/client/settings/sections/GroupProviderSection.test.ts` | Update 2 existing tests, add 1. |
| `docs/ux-reviews/TaskProviderSection.md`, `docs/ux-reviews/GroupProviderSection.md` | Task 6: flip findings, re-score, refresh the States-captured headers. |
| `docs/ux-reviews/_BACKLOG.md` | Task 6: regenerated. |

## Spec amendment you must know about (read before Task 3)

The spec says *"No existing test should need to change. If one does, that is a signal the fix altered behavior beyond the two findings — stop and report it."* That check was run while writing this plan, and **seven existing tests do change**. Every one of them asserts a behaviour a finding names as the defect, so each is a test the fix is *supposed* to invalidate. None indicates scope creep, and no test outside these seven is touched.

Server layer — all three assert that a `config: {}` instance arrives with no label:

1. `context-task-instance-routes.test.ts:214-223` → `GET surfaces config.baseUrl as the option name` — its `expect(byId['bare']?.name).toBeUndefined()` is `task-provider-raw-id-options` stated as an assertion. Updated in Task 1.
2. `group-routes.test.ts:330` → `task-instance GET only lists active task instances` — its `toEqual` omits `name`. Updated in Task 1.
3. `group-routes.test.ts:371` → `task-instance GET skips unreadable rows…` — same. Updated in Task 1.

Client layer:

4. `TaskProviderSection.test.ts` → `renders the friendly instance name in options, falling back to id when absent` — the fallback it asserts is the exact string this project replaces. Updated in Task 2.
5. `GroupProviderSection.test.ts` → `preselects the first available when no task instance is set` — **asserts the defect**. Inverted in Task 3, becoming the regression test for `group-provider-null-silently-preselected`.
6. `GroupProviderSection.test.ts` → `falls back to first available when the assigned instance is missing from available` — same, for the stale-binding sub-state. Inverted in Task 3.
7. `TaskProviderSection.test.ts` → `binding an instance PATCHes the context endpoint and re-fetches` — its fixture is unbound, so it relied on the silent preselect to have something to PATCH. Task 3 makes it select an option first, which is what a real user does.

If a test **outside this list of seven** fails during execution, the spec's original instruction applies in full: stop and report it rather than updating the assertion.

The spec's Layer B describes sharing only the *label* helper. This plan also shares the *selection* logic (`task-instance-selection.ts`), because the silently-preselecting block is duplicated byte-for-byte between the two sections and the same DRY argument the spec makes for the server builder applies to it.

The spec's Layer B also names one placeholder string. This plan uses two, because leaving the select empty for a **stale** binding while telling the user "Not yet assigned" would state something false. The second string costs one branch and one unit test, and needs no new story.

---

### Task 1: Server-side shared option builder

**Files:**
- Create: `src/debug/settings/task-instance-options.ts`
- Create: `tests/debug/settings/task-instance-options.test.ts`
- Modify: `src/debug/settings/context-task-instance-routes.ts:36-46,58`
- Modify: `src/debug/settings/group-routes.ts:196-203,207`
- Modify: `tests/debug/settings/context-task-instance-routes.test.ts:27-32`
- Modify: `tests/debug/settings/group-routes.test.ts`

**Interfaces:**
- Consumes: `listTaskInstancesSafe()` from `src/instances/task-store.js`, which returns `{ instances: TaskInstance[]; failures: { id: string }[] }` where `TaskInstance` has `{ id: string; type: string; status: string; config: Record<string, string> }`.
- Produces: `listActiveTaskInstanceOptions(): TaskInstanceOption[]` and `taskInstanceLabel(id: string, type: string, baseUrl: string | undefined): string`, exported from `src/debug/settings/task-instance-options.js`. `TaskInstanceOption` is `{ id: string; type: string; status: string; name: string }` — note `name` is **required**, unlike the client schema.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/task-instance-options.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskInstanceLabel } from '../../../src/debug/settings/task-instance-options.js'

describe('taskInstanceLabel', () => {
  test('prefers the configured base URL', () => {
    expect(taskInstanceLabel('inst_abc', 'kaneo', 'https://kaneo.example')).toBe('https://kaneo.example')
  })

  test('falls back to a friendly type label plus the id when no base URL is configured', () => {
    expect(taskInstanceLabel('inst_bare', 'youtrack', undefined)).toBe('YouTrack instance (inst_bare)')
    expect(taskInstanceLabel('inst_k', 'kaneo', undefined)).toBe('Kaneo instance (inst_k)')
  })

  test('treats an empty base URL as absent rather than rendering a blank label', () => {
    expect(taskInstanceLabel('inst_bare', 'youtrack', '')).toBe('YouTrack instance (inst_bare)')
  })

  test('uses the raw type for provider types with no friendly name', () => {
    expect(taskInstanceLabel('inst_x', 'acme', undefined)).toBe('acme instance (inst_x)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/task-instance-options.test.ts`
Expected: FAIL — the module `src/debug/settings/task-instance-options.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `src/debug/settings/task-instance-options.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskInstancesSafe } from '../../instances/task-store.js'

/**
 * A task instance offered to the settings UI as a binding target. Unlike the
 * client schema, `name` is required: the server is the layer that guarantees a
 * human-readable label exists, so the UI never has to render a primary key.
 */
export interface TaskInstanceOption {
  id: string
  type: string
  status: string
  name: string
}

/** Friendly names for the provider types the codebase knows (src/instances/context-store.ts:19-25). */
const TYPE_LABELS: Record<string, string> = { kaneo: 'Kaneo', youtrack: 'YouTrack' }

/**
 * Display label for a task instance. `config` is a free-form decrypted blob and
 * `task_instances` has no name column, so `baseUrl` is absent for any provider
 * without a configurable URL. The fallback derives only from `type` and `id`,
 * both immutable, so a given instance's label never changes underneath a user.
 */
export function taskInstanceLabel(id: string, type: string, baseUrl: string | undefined): string {
  if (baseUrl !== undefined && baseUrl !== '') return baseUrl
  return `${TYPE_LABELS[type] ?? type} instance (${id})`
}

/** Active task instances offered as binding targets; unreadable rows are excluded. */
export function listActiveTaskInstanceOptions(): TaskInstanceOption[] {
  return listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstanceLabel(taskInstance.id, taskInstance.type, taskInstance.config['baseUrl']),
    }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/settings/task-instance-options.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Wire the per-context route to the shared builder**

In `src/debug/settings/context-task-instance-routes.ts`, delete the whole local function at lines 36-46:

```ts
/** Active task instances offered as binding targets; unreadable rows are excluded. */
function listActiveTaskInstanceOptions(): { id: string; type: string; status: string; name?: string }[] {
  return listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstance.config['baseUrl'],
    }))
}
```

Add the import (import blocks are alphabetically ordered; this goes after the `registry.js` import and before the `request-auth.js` type import):

```ts
import { listActiveTaskInstanceOptions } from './task-instance-options.js'
```

`listTaskInstancesSafe` is still used by `handlePatch` at line 75, so leave its import alone. The `handleGet` call site at line 58 is unchanged.

- [ ] **Step 6: Wire the group route to the shared builder**

In `src/debug/settings/group-routes.ts`, replace lines 196-203:

```ts
  const available = listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstance.config['baseUrl'],
    }))
```

with:

```ts
  const available = listActiveTaskInstanceOptions()
```

and add `import { listActiveTaskInstanceOptions } from './task-instance-options.js'` to the import block.

If `listTaskInstancesSafe` has no other use in `group-routes.ts` after this edit, remove its now-unused import — the lint step will fail otherwise. Check with `grep -n "listTaskInstancesSafe" src/debug/settings/group-routes.ts`.

- [ ] **Step 7: Tighten the per-context route test schema and assert the fallback**

In `tests/debug/settings/context-task-instance-routes.test.ts`, change line 30 inside `TaskInstanceGetSchema` from:

```ts
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string().optional() })),
```

to:

```ts
  // `name` is required here, not optional: this route is the layer that
  // guarantees every option carries a human-readable label.
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string() })),
```

Tightening the schema to `z.string()` is what makes every *other* test in this file assert the guarantee too: any option the route emits without a label now fails parsing.

Then update the existing test at lines 214-223, `GET surfaces config.baseUrl as the option name`. Its final assertion encodes the defect — it requires a nameless instance to arrive nameless. Rename it and replace its last two assertions. The test becomes:

```ts
  test('surfaces config.baseUrl as the option name, falling back to type and id', async () => {
    insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { baseUrl: 'https://kaneo.example' }, status: 'active' })
    insertTaskInstance({ id: 'bare', type: 'youtrack', config: {}, status: 'active' })
    const url = getReq(session)
    const res = await handleContextTaskInstanceRoutes(url, new URL(url.url))
    const body = TaskInstanceGetSchema.parse(await res.json())
    const byId = Object.fromEntries(body.available.map((a) => [a.id, a]))
    expect(byId['kaneo-a']?.name).toBe('https://kaneo.example')
    expect(byId['bare']?.name).toBe('YouTrack instance (bare)')
  })
```

- [ ] **Step 8: Update the two group-route tests that assert a nameless option**

`tests/debug/settings/group-routes.test.ts` has two tests whose `toEqual` asserts the full option object with no `name` key, because their seeded instances have `config: {}`. Both now receive a fallback label. This is the guarantee landing, not a regression.

At line 330, in `task-instance GET only lists active task instances`, change:

```ts
    expect(body.available).toEqual([{ id: 'ti-active', type: 'kaneo', status: 'active' }])
```

to:

```ts
    expect(body.available).toEqual([
      { id: 'ti-active', type: 'kaneo', status: 'active', name: 'Kaneo instance (ti-active)' },
    ])
```

At line 371, in `task-instance GET skips unreadable rows and still returns readable active instances`, make the identical change to the identical line.

Leave `task-instance GET surfaces config.baseUrl as the option name` (lines 333-354) untouched — its instance has a `baseUrl`, so its expected object is unchanged. That it still passes is the proof the named path did not regress.

- [ ] **Step 8b: Add the group-route fallback assertion**

The two edits above prove the fallback reaches the group response, but only as a side effect of tests about filtering. Add one test that says so directly, immediately after the `surfaces config.baseUrl` test:

```ts
  test('task-instance GET labels a config-less instance with its type and id', async () => {
    const contextId = seedManageableGroup()
    insertTaskInstance({ id: 'ti-bare', type: 'youtrack', config: {}, status: 'active' })

    const getUrl = new URL(`https://x/settings/api/group/task-instance?contextId=${encodeURIComponent(contextId)}`)
    const res = await handleGroupRoutes(
      new Request(getUrl, { headers: authHeaders(session) }),
      getUrl,
      '/settings/api/group/task-instance',
    )

    expect(res.status).toBe(200)
    const body = TaskInstanceGetSchema.parse(await res.json())
    expect(body.available).toEqual([
      { id: 'ti-bare', type: 'youtrack', status: 'active', name: 'YouTrack instance (ti-bare)' },
    ])
  })
```

Also tighten that file's local `TaskInstanceGetSchema`, for the same reason as Step 7. Change line 43 from:

```ts
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string().optional() })),
```

to:

```ts
  // `name` is required here, not optional: this route is the layer that
  // guarantees every option carries a human-readable label.
  available: z.array(z.object({ id: z.string(), type: z.string(), status: z.string(), name: z.string() })),
```

- [ ] **Step 9: Run the affected suites**

Run:
```bash
bun test tests/debug/settings/task-instance-options.test.ts tests/debug/settings/context-task-instance-routes.test.ts tests/debug/settings/group-routes.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 10: Format, verify, commit**

```bash
bun run format
git add src/debug/settings/task-instance-options.ts src/debug/settings/context-task-instance-routes.ts src/debug/settings/group-routes.ts tests/debug/settings/task-instance-options.test.ts tests/debug/settings/context-task-instance-routes.test.ts tests/debug/settings/group-routes.test.ts
git commit -m "fix(settings): always label task-instance options server-side"
```

The pre-commit hook runs lint, typecheck, format:check and license-headers. If it fails, fix the cause — never `--no-verify`.

---

### Task 2: Client-side shared option label

**Files:**
- Create: `client/settings/lib/task-instance-label.ts`
- Create: `tests/client/settings/lib/task-instance-label.test.ts`
- Modify: `client/settings/sections/TaskProviderSection.svelte:132`
- Modify: `client/settings/sections/GroupProviderSection.svelte:97`
- Modify: `tests/client/settings/sections/TaskProviderSection.test.ts:266-287`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime. The fallback rule is intentionally implemented twice — once server-side (Task 1) and once here — because MSW replaces the server in Storybook, so only this copy runs in the fixtures. Both copies must produce identical strings.
- Produces: `formatTaskInstanceOption(option: { id: string; type: string; status: string; name?: string }): { value: string; label: string }`, exported from `client/settings/lib/task-instance-label.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/lib/task-instance-label.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatTaskInstanceOption } from '../../../../client/settings/lib/task-instance-label.js'

describe('formatTaskInstanceOption', () => {
  test('uses the server-supplied name', () => {
    expect(formatTaskInstanceOption({ id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' })).toEqual(
      { value: 'inst_abc', label: 'https://kaneo.example (kaneo · active)' },
    )
  })

  test('falls back to a friendly type label plus the id when the name is absent', () => {
    expect(formatTaskInstanceOption({ id: 'inst_bare', type: 'youtrack', status: 'active' })).toEqual({
      value: 'inst_bare',
      label: 'YouTrack instance (inst_bare) (youtrack · active)',
    })
  })

  test('treats an empty name as absent rather than rendering a blank label', () => {
    expect(formatTaskInstanceOption({ id: 'inst_bare', type: 'kaneo', status: 'active', name: '' }).label).toBe(
      'Kaneo instance (inst_bare) (kaneo · active)',
    )
  })

  test('uses the raw type for provider types with no friendly name', () => {
    expect(formatTaskInstanceOption({ id: 'inst_x', type: 'acme', status: 'active' }).label).toBe(
      'acme instance (inst_x) (acme · active)',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/settings/lib/task-instance-label.test.ts`
Expected: FAIL — the module `client/settings/lib/task-instance-label.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `client/settings/lib/task-instance-label.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Friendly names for the provider types the codebase knows; mirrors src/debug/settings/task-instance-options.ts. */
const TYPE_LABELS: Record<string, string> = { kaneo: 'Kaneo', youtrack: 'YouTrack' }

export interface TaskInstanceOptionInput {
  id: string
  type: string
  status: string
  name?: string
}

/**
 * Select option for a task instance.
 *
 * The server always populates `name` (src/debug/settings/task-instance-options.ts),
 * so the fallback here should be unreachable in production. It is kept
 * deliberately: `TaskInstanceOptionSchema.name` stays optional because a strict
 * schema would turn one unlabeled instance into a failed fetch that blanks the
 * whole section, and showing an id beats showing nothing. The fallback also runs
 * for real in Storybook, where MSW replaces the server entirely.
 */
export function formatTaskInstanceOption(option: TaskInstanceOptionInput): { value: string; label: string } {
  const name =
    option.name !== undefined && option.name !== ''
      ? option.name
      : `${TYPE_LABELS[option.type] ?? option.type} instance (${option.id})`
  return { value: option.id, label: `${name} (${option.type} · ${option.status})` }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/settings/lib/task-instance-label.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use the helper in TaskProviderSection**

In `client/settings/sections/TaskProviderSection.svelte`, add to the import block (after the `formatFetchError` import):

```ts
  import { formatTaskInstanceOption } from '../lib/task-instance-label.js'
```

Then replace line 132:

```svelte
                options={instanceData.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
```

with:

```svelte
                options={instanceData.available.map(formatTaskInstanceOption)}
```

- [ ] **Step 6: Use the helper in GroupProviderSection**

In `client/settings/sections/GroupProviderSection.svelte`, add to the import block (after the `formatFetchError` import):

```ts
  import { formatTaskInstanceOption } from '../lib/task-instance-label.js'
```

Then replace line 97:

```svelte
            options={data.available.map((o) => ({ value: o.id, label: `${o.name ?? o.id} (${o.type} · ${o.status})` }))}
```

with:

```svelte
            options={data.available.map(formatTaskInstanceOption)}
```

- [ ] **Step 7: Update the existing label test**

In `tests/client/settings/sections/TaskProviderSection.test.ts`, the test named `renders the friendly instance name in options, falling back to id when absent` asserts the exact fallback this task replaces. Rename it and update its final assertion. Change the test name to:

```ts
  test('renders the friendly instance name in options, falling back to a type-and-id label when absent', async () => {
```

and change:

```ts
    expect(options).toContain('yt-default (youtrack · active)')
```

to:

```ts
    expect(options).toContain('YouTrack instance (yt-default) (youtrack · active)')
```

Leave the `https://kaneo.example (kaneo · active)` assertion above it untouched — the named path is unchanged by design.

- [ ] **Step 8: Run the affected suites**

Run:
```bash
bun test tests/client/settings/lib/task-instance-label.test.ts tests/client/settings/sections/TaskProviderSection.test.ts tests/client/settings/sections/GroupProviderSection.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 9: Confirm no baseline changed**

Every option in every existing fixture that is *rendered as the selected value* already carries a `name`, so this task should change no pixels.

Run: `bun run visual:audit`
Expected: 462 passed, 0 failed — **without** re-shooting.

If any case fails, do **not** re-shoot to make it green. Read the diff PNG, work out which fixture exposed an unnamed instance, and report it before continuing.

- [ ] **Step 10: Format and commit**

```bash
bun run format
git add client/settings/lib/task-instance-label.ts client/settings/sections/TaskProviderSection.svelte client/settings/sections/GroupProviderSection.svelte tests/client/settings/lib/task-instance-label.test.ts tests/client/settings/sections/TaskProviderSection.test.ts
git commit -m "fix(settings): share one task-instance option label across the provider pair"
```

---

### Task 3: Stop silently preselecting the first instance

**Files:**
- Create: `client/settings/lib/task-instance-selection.ts`
- Create: `tests/client/settings/lib/task-instance-selection.test.ts`
- Modify: `client/settings/sections/TaskProviderSection.svelte:36,51-55,130-135`
- Modify: `client/settings/sections/GroupProviderSection.svelte:24,40-44,95-100`
- Modify: `tests/client/settings/sections/TaskProviderSection.test.ts`
- Modify: `tests/client/settings/sections/GroupProviderSection.test.ts`

**Interfaces:**
- Consumes: `formatTaskInstanceOption` from Task 2 is already wired into both sections' `options` props; do not touch those lines.
- Produces: `resolveTaskInstanceSelection(taskInstanceId: string | null, available: readonly { id: string }[]): { selected: string; placeholder: string }`, plus the exported constants `UNASSIGNED_PLACEHOLDER` and `UNAVAILABLE_PLACEHOLDER`, from `client/settings/lib/task-instance-selection.js`.

**Background you need:** `Select` already renders `{#if placeholder}<option value="" disabled>{placeholder}</option>{/if}` (`client/shared/ui/Select.svelte:43-45`). Passing an empty string renders no placeholder option at all, which is exactly what a bound select wants. **Do not modify `Select.svelte`** — a shared-primitive change would churn baselines across all 18 settings sections.

**Also do not add a submit guard.** Both sections already return early on an empty selection (`GroupProviderSection.svelte:55`, `TaskProviderSection.svelte:66`), and the placeholder option is `disabled` so it cannot be re-chosen. A second guard would be redundant.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/lib/task-instance-selection.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  UNASSIGNED_PLACEHOLDER,
  UNAVAILABLE_PLACEHOLDER,
  resolveTaskInstanceSelection,
} from '../../../../client/settings/lib/task-instance-selection.js'

const available = [{ id: 'inst_a' }, { id: 'inst_b' }]

describe('resolveTaskInstanceSelection', () => {
  test('selects the bound instance with no placeholder', () => {
    expect(resolveTaskInstanceSelection('inst_b', available)).toEqual({ selected: 'inst_b', placeholder: '' })
  })

  test('selects nothing when no instance is bound, rather than the first available', () => {
    const result = resolveTaskInstanceSelection(null, available)
    expect(result.selected).toBe('')
    expect(result.selected).not.toBe('inst_a')
    expect(result.placeholder).toBe(UNASSIGNED_PLACEHOLDER)
  })

  test('selects nothing when the bound instance is missing from the available list', () => {
    const result = resolveTaskInstanceSelection('gone', available)
    expect(result.selected).toBe('')
    expect(result.selected).not.toBe('inst_a')
    expect(result.placeholder).toBe(UNAVAILABLE_PLACEHOLDER)
  })

  test('selects nothing when there are no instances at all', () => {
    expect(resolveTaskInstanceSelection(null, [])).toEqual({ selected: '', placeholder: UNASSIGNED_PLACEHOLDER })
  })

  test('distinguishes the unbound and stale placeholders', () => {
    expect(UNASSIGNED_PLACEHOLDER).not.toBe(UNAVAILABLE_PLACEHOLDER)
  })
})
```

The `not.toBe('inst_a')` assertions are the point of this suite: an assertion that merely checked "a placeholder exists" would also pass against the unfixed code.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/client/settings/lib/task-instance-selection.test.ts`
Expected: FAIL — the module `client/settings/lib/task-instance-selection.js` does not resolve.

- [ ] **Step 3: Write the implementation**

Create `client/settings/lib/task-instance-selection.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Shown when the context has no task instance bound at all. */
export const UNASSIGNED_PLACEHOLDER = 'Not yet assigned — select an instance'
/** Shown when the context is bound to an instance that is gone or no longer active. */
export const UNAVAILABLE_PLACEHOLDER = 'Assigned instance is unavailable — select another'

export interface TaskInstanceSelection {
  /** The `Select` value; `''` means nothing is chosen. */
  selected: string
  /** Placeholder copy for the empty state; `''` renders no placeholder option. */
  placeholder: string
}

/**
 * Resolve which task-instance option a context's `Select` should show.
 *
 * Both provider sections previously fell back to `available[0]`, making "not yet
 * configured" pixel-identical to "bound to the first instance" — an admin could
 * read an unset context as already routed. Leaving the control empty makes the
 * unset state visible in the control itself, not just in adjacent copy.
 */
export function resolveTaskInstanceSelection(
  taskInstanceId: string | null,
  available: readonly { id: string }[],
): TaskInstanceSelection {
  if (taskInstanceId !== null && available.some((option) => option.id === taskInstanceId)) {
    return { selected: taskInstanceId, placeholder: '' }
  }
  return {
    selected: '',
    placeholder: taskInstanceId === null ? UNASSIGNED_PLACEHOLDER : UNAVAILABLE_PLACEHOLDER,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/client/settings/lib/task-instance-selection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire GroupProviderSection**

In `client/settings/sections/GroupProviderSection.svelte`, add to the import block (after the `formatTaskInstanceOption` import added in Task 2):

```ts
  import { resolveTaskInstanceSelection } from '../lib/task-instance-selection.js'
```

Add a state declaration after line 24 (`let selected = $state('')`):

```ts
  let selectPlaceholder = $state('')
```

Replace lines 40-44:

```ts
      const currentId = result.taskInstanceId
      selected =
        currentId !== null && result.available.some((a) => a.id === currentId)
          ? currentId
          : (result.available[0]?.id ?? '')
```

with:

```ts
      const selection = resolveTaskInstanceSelection(result.taskInstanceId, result.available)
      selected = selection.selected
      selectPlaceholder = selection.placeholder
```

Then pass the placeholder to `Select` — the element currently reads:

```svelte
          <Select
            value={selected}
            options={data.available.map(formatTaskInstanceOption)}
            onChange={(v) => (selected = v)}
            disabled={saving}
            testid="group-task-instance" />
```

Add one prop:

```svelte
          <Select
            value={selected}
            options={data.available.map(formatTaskInstanceOption)}
            placeholder={selectPlaceholder}
            onChange={(v) => (selected = v)}
            disabled={saving}
            testid="group-task-instance" />
```

- [ ] **Step 6: Wire TaskProviderSection**

In `client/settings/sections/TaskProviderSection.svelte`, add to the import block (after the `formatTaskInstanceOption` import added in Task 2):

```ts
  import { resolveTaskInstanceSelection } from '../lib/task-instance-selection.js'
```

Add a state declaration after line 36 (`let selectedInstanceId = $state('')`):

```ts
  let selectPlaceholder = $state('')
```

Replace lines 51-55:

```ts
      const currentId = instance.taskInstanceId
      selectedInstanceId =
        currentId !== null && instance.available.some((a) => a.id === currentId)
          ? currentId
          : (instance.available[0]?.id ?? '')
```

with:

```ts
      const selection = resolveTaskInstanceSelection(instance.taskInstanceId, instance.available)
      selectedInstanceId = selection.selected
      selectPlaceholder = selection.placeholder
```

Then add the `placeholder` prop to the `Select`, which becomes:

```svelte
              <Select
                value={selectedInstanceId}
                options={instanceData.available.map(formatTaskInstanceOption)}
                placeholder={selectPlaceholder}
                onChange={(v) => (selectedInstanceId = v)}
                disabled={binding}
                testid="context-task-instance" />
```

- [ ] **Step 7: Invert the two GroupProviderSection tests that assert the defect**

In `tests/client/settings/sections/GroupProviderSection.test.ts`, replace the test named `preselects the first available when no task instance is set` in its entirety with:

```ts
  test('selects nothing and shows the unassigned placeholder when no task instance is set', async () => {
    const noInstancePayload = {
      contextId: 'group:7',
      taskInstanceId: null,
      available: [
        { id: 'kaneo-a', type: 'kaneo', status: 'active' },
        { id: 'kaneo-b', type: 'kaneo', status: 'active' },
      ],
      canProvision: false,
    }
    setMockFetch(() => Promise.resolve(json(noInstancePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('')
    expect(select.value).not.toBe('kaneo-a')
    expect(target.textContent).toContain('Not yet assigned — select an instance')
    void unmount(component)
  })
```

Then replace the test named `falls back to first available when the assigned instance is missing from available` in its entirety with:

```ts
  test('selects nothing and flags the stale binding when the assigned instance is missing from available', async () => {
    const stalePayload = {
      contextId: 'group:7',
      taskInstanceId: 'gone',
      available: [
        { id: 'kaneo-a', type: 'kaneo', status: 'active' },
        { id: 'kaneo-b', type: 'kaneo', status: 'active' },
      ],
      canProvision: false,
    }
    setMockFetch(() => Promise.resolve(json(stalePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('')
    expect(select.value).not.toBe('kaneo-a')
    expect(target.textContent).toContain('Assigned instance is unavailable — select another')
    void unmount(component)
  })
```

- [ ] **Step 8: Add the bound-state regression test to GroupProviderSection**

Add this test to the same `describe` block:

```ts
  test('shows no placeholder option when an instance is genuinely bound', async () => {
    setMockFetch(() => Promise.resolve(json(payload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('kaneo-a')
    expect(target.textContent).not.toContain('Not yet assigned')
    void unmount(component)
  })
```

`payload` is the module-level fixture already defined at the top of that file (bound to `kaneo-a`).

- [ ] **Step 9: Fix the TaskProviderSection bind test to select before submitting**

In `tests/client/settings/sections/TaskProviderSection.test.ts`, the test `binding an instance PATCHes the context endpoint and re-fetches` uses `routeBindingMock`, whose GET returns `unboundInstancePayload` (`taskInstanceId: null`). It relied on the silent preselect to have a value to PATCH; with the fix, `bindInstance()` now correctly returns early and no PATCH is sent.

Replace the body between `await drain()` and the `const patched = sink.value` line. The test currently reads:

```ts
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="context-task-instance-save"]')!.click()
    await drain()
```

Change it to:

```ts
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="context-task-instance"]')!
    expect(select.value).toBe('')
    select.value = 'yt-default'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="context-task-instance-save"]')!.click()
    await drain()
```

The remaining assertions (`patched!.method === 'PATCH'`, body `{ taskInstanceId: 'yt-default', contextId: 'user:1' }`) are unchanged — the test now proves a *user-chosen* value is what gets bound. `flushSync` is already imported at the top of that file.

- [ ] **Step 10: Add the two TaskProviderSection placeholder tests**

Add these to the same `describe` block. `unboundInstancePayload` and `boundNonProvisionablePayload` are module-level fixtures already defined at the top of that file:

```ts
  test('selects nothing and shows the unassigned placeholder when no instance is bound', async () => {
    setMockFetch(routeMock(unboundInstancePayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="context-task-instance"]')!
    expect(select.value).toBe('')
    expect(select.value).not.toBe('yt-default')
    expect(target.textContent).toContain('Not yet assigned — select an instance')
    void unmount(component)
  })

  test('shows no placeholder option when an instance is genuinely bound', async () => {
    setMockFetch(routeMock(boundNonProvisionablePayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="context-task-instance"]')!
    expect(select.value).toBe('yt-default')
    expect(target.textContent).not.toContain('Not yet assigned')
    void unmount(component)
  })
```

- [ ] **Step 11: Run the affected suites**

Run:
```bash
bun test tests/client/settings/lib/task-instance-selection.test.ts tests/client/settings/sections/TaskProviderSection.test.ts tests/client/settings/sections/GroupProviderSection.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 12: Re-shoot the baselines this change moves**

The `settings-shell-ready` fixture family returns `taskInstanceId: null`, so `TaskProviderSection--Populated` now renders the placeholder instead of a false binding. That family also backs the composed `SettingsApp` stories, so `SettingsApp-Personal-ready` moves too.

Run:
```bash
bun shoot -g TaskProviderSection
bun shoot -g SettingsApp
```

- [ ] **Step 13: Read every changed PNG**

Find what actually changed:

```bash
find .storybook-shots -name '*.png' -newermt '-10 minutes' | sort
```

Read each listed PNG with the Read tool and write one human-readable sentence per file describing what changed. You are looking for:
- the `Select` now showing `Not yet assigned — select an instance` rather than `https://kaneo.example (kaneo · active)`;
- no clipping or overflow of the longer placeholder string, including in the `TaskProvider — narrow` 640px case;
- nothing else moving in `SettingsApp-Personal-ready` beyond that one control.

This step is the load-bearing one. Re-shooting makes the audit pass by construction, so the audit below proves nothing on its own. If a PNG shows something this plan did not predict, stop and report it rather than continuing.

- [ ] **Step 14: Run the full audit**

Run: `bun run visual:audit`
Expected: 462 passed, 0 failed.

Unfiltered, deliberately: the fixture family this task touches is shell-wide, so the blast radius provably exceeds the two sections under work.

- [ ] **Step 15: Format and commit**

```bash
bun run format
git add client/settings/lib/task-instance-selection.ts client/settings/sections/TaskProviderSection.svelte client/settings/sections/GroupProviderSection.svelte tests/client/settings/lib/task-instance-selection.test.ts tests/client/settings/sections/TaskProviderSection.test.ts tests/client/settings/sections/GroupProviderSection.test.ts
git commit -m "fix(settings): show an unassigned placeholder instead of preselecting the first instance"
```

---

### Task 4: TaskProviderSection bound-state fixtures and stories

**Files:**
- Modify: `client/stories/msw/settings-handlers.ts`
- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/settings/sections/TaskProviderSection.stories.svelte`
- Modify: `tests/visual/settings/sections/TaskProviderSection.spec.ts`

**Interfaces:**
- Consumes: the placeholder behaviour from Task 3 and the label helper from Task 2 — both already in the components.
- Produces: the fixture family name `settings-task-provider-bound` and the story id `settings-sections-taskprovidersection--bound`, both referenced by Task 6's documentation updates.

**Background:** this closes `task-provider-states-unverified`, which names three never-screenshotted states. One story covers two of them: `canProvision` is only ever `true` for a bound, active Kaneo instance, so the credential field list (`TaskProviderSection.svelte:145-150`) and the provision CTA (`:156-164`) co-occur in reality. Splitting them would fabricate a state the server cannot produce. The third state, the post-provision secret reveal (`:168-180`), is reachable only by clicking, so it is a manual interaction case.

The section fetches three endpoints: `/settings/api/config`, `/settings/api/context/task-instance`, and (on click) `/settings/api/provision/kaneo`. The new family must supply all three.

- [ ] **Step 1: Add the fixture family**

In `client/stories/msw/settings-handlers.ts`, add near the other exported handler groups:

```ts
// --- Task provider, bound state (config + context/task-instance + provision/kaneo) ---
// Covers the three states task-provider-states-unverified names: the bound-instance
// credential list, the Kaneo provision CTA, and the post-provision secret reveal.

const taskProviderBoundInstance = {
  contextId: 'ctx-personal-1',
  taskInstanceId: 'inst_abc',
  available: [{ id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' }],
  canProvision: true,
}

const taskProviderBoundConfig = {
  contextId: 'ctx-personal-1',
  fields: [
    {
      key: 'kaneo_apikey',
      label: 'Kaneo API key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '',
      storageKey: 'kaneo_apikey',
      kind: 'provider-context',
      control: 'text',
    },
    {
      key: 'kaneo_workspace',
      label: 'Kaneo workspace',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'acme-workspace',
      storageKey: 'kaneo_workspace',
      kind: 'provider-context',
      control: 'text',
    },
  ],
}

// Obvious dummy credentials: Secret renders a masked value, and no real secret
// may ever enter a fixture.
const taskProviderProvisionResult = {
  status: 'provisioned',
  contextId: 'ctx-personal-1',
  email: 'demo-user@example.invalid',
  password: 'example-password-not-real',
  kaneoUrl: 'https://kaneo.example',
  workspaceId: 'ws-demo-1',
}

export const taskProviderBoundHandlers: HttpHandler[] = [
  http.get('/settings/api/config', () => HttpResponse.json(taskProviderBoundConfig)),
  http.get('/settings/api/context/task-instance', () => HttpResponse.json(taskProviderBoundInstance)),
  http.post('/settings/api/provision/kaneo', () => HttpResponse.json(taskProviderProvisionResult)),
]
```

If `HttpHandler` is not already imported in that file, add it: `import type { HttpHandler } from 'msw'`. Check with `grep -n "HttpHandler" client/stories/msw/settings-handlers.ts`.

- [ ] **Step 2: Register the family**

In `client/stories/msw/scenarios.ts`, add `taskProviderBoundHandlers` to the import from `./settings-handlers.js`, then add this entry alongside the other `settings-*` entries:

```ts
  'settings-task-provider-bound': [...taskProviderBoundHandlers],
```

- [ ] **Step 3: Add the story**

In `client/settings/sections/TaskProviderSection.stories.svelte`, add after the existing `Populated` story:

```svelte
<!-- bound Kaneo instance: credential field list + auto-provision CTA both visible -->
<Story name="Bound" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-task-provider-bound' }} />
```

- [ ] **Step 4: Regenerate the spec's generated region**

Run: `bun shoot:gen`

This rewrites the block between `// @generated-begin auto-screenshots` and `// @generated-end auto-screenshots` in `tests/visual/settings/sections/TaskProviderSection.spec.ts` to include a `Bound` case. Verify with `git diff tests/visual/settings/sections/TaskProviderSection.spec.ts` that only the generated region changed and the manual cases below it are intact.

- [ ] **Step 5: Add the provision-reveal manual case**

Append to `tests/visual/settings/sections/TaskProviderSection.spec.ts`, below the existing manual cases:

```ts
test('TaskProvider — provision reveal', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-taskprovidersection--bound')
  await sharedPage.getByTestId('provision-kaneo').click()
  await expect(sharedPage.getByTestId('provision-result')).toBeVisible()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 6: Shoot the new cases**

Run: `bun shoot -g TaskProviderSection`

- [ ] **Step 7: Read every new PNG**

```bash
find .storybook-shots -name '*.png' -newermt '-10 minutes' | sort
```

Read each with the Read tool. These states have **never been rendered at any viewport**, so read them as a first review, not a diff check. Describe:
- whether the `ConfigFieldRow` credential list aligns with the field above it;
- whether the `Kaneo auto-provision` block's heading, copy and CTA have sane spacing against the `border-top` divider;
- whether the revealed secret block (`Password` label plus masked `Secret`) is legible and unclipped;
- whether the masked value is genuinely masked in the pixels.

The spec predicts this story may expose defects nobody has seen. **Anything you find is a new `open` finding** to record in `docs/ux-reviews/TaskProviderSection.md` during Task 6 — not something to fix here, and not a reason to leave a planned finding open.

- [ ] **Step 8: Run the full audit**

Run: `bun run visual:audit`
Expected: 464 passed, 0 failed. (462 + the generated `Bound` case + the manual provision-reveal case.)

If the count is not 464, the story or the manual case did not register — investigate before committing.

- [ ] **Step 9: Format and commit**

```bash
bun run format
git add client/stories/msw/settings-handlers.ts client/stories/msw/scenarios.ts client/settings/sections/TaskProviderSection.stories.svelte tests/visual/settings/sections/TaskProviderSection.spec.ts
git commit -m "test(visual): cover the TaskProvider bound, provisionable and reveal states"
```

---

### Task 5: GroupProviderSection unassigned and nameless-instance fixtures

**Files:**
- Modify: `client/stories/msw/settings-handlers-group.ts`
- Modify: `client/stories/msw/scenarios.ts`
- Modify: `client/settings/sections/GroupProviderSection.stories.svelte`
- Modify: `tests/visual/settings/sections/GroupProviderSection.spec.ts`

**Interfaces:**
- Consumes: the placeholder behaviour from Task 3 and the label helper from Task 2.
- Produces: the fixture family names `settings-group-provider-unassigned` and `settings-group-provider-nameless-bound`, and the story ids `settings-sections-groupprovidersection--unassigned` and `settings-sections-groupprovidersection--nameless-bound`, referenced by Task 6.

**Background:** unlike its sibling, this section's `Populated` fixture is genuinely bound (`taskInstanceId: 'inst_abc'`), so it needs its own null fixture to render the unassigned state. And a `<select>` displays only its chosen option, so the existing nameless `inst_bare` entry has never been drawn — binding it is the only way to put the fallback label on screen, which is what turns both `*-raw-id-options` findings from source-only claims into visually verified ones.

- [ ] **Step 1: Add the fixtures**

In `client/stories/msw/settings-handlers-group.ts`, add after the existing `groupProviderEmpty` constant:

```ts
// taskInstanceId: null with a non-empty available list — the "not yet assigned"
// sub-state, which no fixture rendered before (group-provider-null-silently-preselected).
const groupProviderUnassigned = {
  contextId: 'ctx-group-1',
  taskInstanceId: null,
  available: [
    { id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' },
    { id: 'inst_bare', type: 'youtrack', status: 'active' },
  ],
  canProvision: false,
}

// Bound to the nameless instance. A <select> renders only its chosen option, so
// this is the only way the type-and-id fallback label appears on screen
// (group-provider-raw-id-options).
const groupProviderNamelessBound = {
  contextId: 'ctx-group-1',
  taskInstanceId: 'inst_bare',
  available: [
    { id: 'inst_abc', type: 'kaneo', status: 'active', name: 'https://kaneo.example' },
    { id: 'inst_bare', type: 'youtrack', status: 'active' },
  ],
  canProvision: false,
}
```

Then add the two handler arrays after the existing `groupProviderHandlers` export:

```ts
export const groupProviderUnassignedHandlers: HttpHandler[] = [
  http.get('/settings/api/group/task-instance', () => HttpResponse.json(groupProviderUnassigned)),
]

export const groupProviderNamelessBoundHandlers: HttpHandler[] = [
  http.get('/settings/api/group/task-instance', () => HttpResponse.json(groupProviderNamelessBound)),
]
```

These are standalone arrays rather than `HandlerFamily` members because `HandlerFamily` is fixed at `{ populated, empty, error, loading }` and neither state is one of those four. Do not widen that interface.

- [ ] **Step 2: Register the families**

In `client/stories/msw/scenarios.ts`, add both to the import from `./settings-handlers-group.js`, then add alongside the existing `settings-group-provider-*` entries:

```ts
  'settings-group-provider-unassigned': [...groupProviderUnassignedHandlers],
  'settings-group-provider-nameless-bound': [...groupProviderNamelessBoundHandlers],
```

- [ ] **Step 3: Add the stories**

In `client/settings/sections/GroupProviderSection.stories.svelte`, add after the existing `Populated` story:

```svelte
<!-- no instance bound yet: the Select shows the placeholder, not available[0] -->
<Story name="Unassigned" args={{ contextId: CONTEXT_ID }} parameters={{ fixtures: 'settings-group-provider-unassigned' }} />

<!-- bound to an instance with no baseUrl: renders the type-and-id fallback label -->
<Story
  name="NamelessBound"
  args={{ contextId: CONTEXT_ID }}
  parameters={{ fixtures: 'settings-group-provider-nameless-bound' }} />
```

- [ ] **Step 4: Regenerate the spec's generated region**

Run: `bun shoot:gen`

Verify with `git diff tests/visual/settings/sections/GroupProviderSection.spec.ts` that only the block between `@generated-begin auto-screenshots` and `@generated-end auto-screenshots` changed, that it now holds `Unassigned` and `NamelessBound` cases, and that the three manual cases below it are intact.

- [ ] **Step 5: Shoot the new cases**

Run: `bun shoot -g GroupProviderSection`

- [ ] **Step 6: Read every new PNG**

```bash
find .storybook-shots -name '*.png' -newermt '-10 minutes' | sort
```

Read each with the Read tool. Confirm specifically:
- `Unassigned` shows `Not yet assigned — select an instance` in the `Select`, and does **not** show `https://kaneo.example (kaneo · active)`;
- `NamelessBound` shows exactly `YouTrack instance (inst_bare) (youtrack · active)` — this is the pixel evidence for both `*-raw-id-options` findings, so read the string character by character rather than glancing at it;
- neither label overflows or clips its control.

The `NamelessBound` label is roughly double the usual option length. **If it overflows, that is a real finding — record it in Task 6. Do not shorten the fixture id to hide it.**

- [ ] **Step 7: Run the full audit**

Run: `bun run visual:audit`
Expected: 466 passed, 0 failed. (464 + the two new generated cases.)

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/stories/msw/settings-handlers-group.ts client/stories/msw/scenarios.ts client/settings/sections/GroupProviderSection.stories.svelte tests/visual/settings/sections/GroupProviderSection.spec.ts
git commit -m "test(visual): cover the GroupProvider unassigned and nameless-instance states"
```

---

### Task 6: Close the loop in the review documents

**Files:**
- Modify: `docs/ux-reviews/TaskProviderSection.md`
- Modify: `docs/ux-reviews/GroupProviderSection.md`
- Modify: `docs/ux-reviews/_BACKLOG.md` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: the commit hashes from Tasks 1-5, the story ids from Tasks 4-5, and every PNG description written during Tasks 3-5.

**Background:** the backlog parser enforces three statuses only — `open`, `fixed`, `superseded`. A non-`open` status **requires** a `- **Resolved:**` line citing a real commit hash, or the parser fails loud. There is no `partial`: a partially-fixed finding stays `open` with its text narrowed to the residue.

**Do this task only after Tasks 1-5 are committed**, because `Resolved:` must cite hashes that exist.

- [ ] **Step 1: Collect the commit hashes**

```bash
git log --oneline -8
```

Record which hash corresponds to which fix. You will cite the Task 1 hash for the server half of the raw-id findings, Task 2 for the client half, Task 3 for both null findings, and Tasks 4-5 for the fixture finding.

- [ ] **Step 2: Flip the three TaskProviderSection findings**

In `docs/ux-reviews/TaskProviderSection.md`, for each of `task-provider-null-silently-preselected`, `task-provider-raw-id-options` and `task-provider-states-unverified`: change `- **Status:** open` to `- **Status:** fixed`, delete the `- **Where visible:**`, `- **Source:**` and `- **Suggested fix:**` lines, and add a `- **Resolved:**` line in their place.

Follow the shape the already-`fixed` findings in that same file use: cite the `file:line` of the code that now implements the fix, quote the decisive expression, name the commit hash and its subject line, and state what the screenshot now shows. For example, for the null finding:

```markdown
- **Status:** fixed
- **Resolved:** `client/settings/sections/TaskProviderSection.svelte:51-53` now delegates to
  `resolveTaskInstanceSelection(instance.taskInstanceId, instance.available)`
  (`client/settings/lib/task-instance-selection.ts:31-42`), which returns `selected: ''` and the
  placeholder `Not yet assigned — select an instance` whenever nothing is bound, instead of
  falling back to `available[0]`. Landed in `<task-3-hash>` ("fix(settings): show an unassigned
  placeholder instead of preselecting the first instance"). Confirmed visually in
  `settings-sections-TaskProviderSection-Populated-1.png`, whose fixture has `taskInstanceId:
  null` and which now renders the placeholder rather than "https://kaneo.example (kaneo ·
  active)".
```

Write the other two in the same shape from your own Task 4 and Task 2 evidence. Do not copy this example's wording for findings it does not describe.

- [ ] **Step 3: Flip the two GroupProviderSection findings**

Do the same in `docs/ux-reviews/GroupProviderSection.md` for `group-provider-null-silently-preselected` and `group-provider-raw-id-options`, citing the Task 3 and Task 1/2 hashes and the `Unassigned` / `NamelessBound` screenshots.

- [ ] **Step 4: Refresh both States-captured headers**

Both documents' **States captured** paragraphs currently assert the very gaps this project closes. In `TaskProviderSection.md` that is lines 12-26 (which claim three states "remain unexercised by any story"); in `GroupProviderSection.md` it is lines 12-20 (which claim "no fixture exercises `taskInstanceId: null` with a non-empty `available` list").

Rewrite both to describe the current story set, name the new stories, and give the new per-section audit counts. Leaving a header that contradicts the findings below it is a documentation defect even though the parser would not catch it.

- [ ] **Step 5: Re-score both scorecards**

In `TaskProviderSection.md`, dimensions 4 and 5 are `warn` with rationales that name exactly the residues this project removed; in `GroupProviderSection.md`, the same two. Move each to `pass` **only if** its rationale no longer describes a real residue, and rewrite the rationale to say what is now true.

If a rationale still describes a genuine residue, the dimension keeps its `warn` and the corresponding finding stays `open` with its text narrowed. A `0 open` result obtained by declaring a residual defect fixed is a project failure, however green the audit is.

- [ ] **Step 6: Record any new findings**

If Task 4's or Task 5's PNG reads surfaced defects — most plausibly in the never-rendered `Bound` states, or the long `NamelessBound` label overflowing — add them now as new `open` findings in the appropriate document, in the same format as the existing ones: id, status, dimension, where visible, source anchor (`file:line`), one-line suggested fix.

New findings raise the final open count above 24. That is the honest result; report it as such.

- [ ] **Step 7: Regenerate the backlog**

```bash
bun run ux:backlog
```

Never hand-edit `_BACKLOG.md`.

- [ ] **Step 8: Verify the counts**

```bash
grep -n "TaskProviderSection\|GroupProviderSection\|Total" docs/ux-reviews/_BACKLOG.md
```

Expected, if no new findings were recorded: `TaskProviderSection | 0 | 6 | 0`, `GroupProviderSection | 0 | 7 | 0`, `Total | 24 | 145 | 3`.

If new findings were recorded in Step 6, the open counts are correspondingly higher. **Report the actual numbers.** Do not adjust findings to hit the projected total.

- [ ] **Step 9: Run the currency gate**

```bash
bun run format
bun test tests/scripts/ux-backlog.test.ts
```
Expected: PASS. This gate fails if `_BACKLOG.md` is stale relative to the section documents.

- [ ] **Step 10: Run the full suite and audit one final time**

```bash
bun test
bun run visual:audit
bun security
```
Expected: `bun test` 0 failures; audit 466 passed, 0 failed; security clean.

- [ ] **Step 11: Commit**

```bash
git add docs/ux-reviews/
git commit -m "docs(ux): close the provider-pair findings and re-score both sections"
```

---

## Adversarial verification (after Task 6)

Dispatch a **fresh agent with no prior context** to re-derive every `fixed` claim against current source and current screenshots. Whoever wrote a fix does not certify it.

That agent must be told explicitly:
- a passing test suite and a green visual audit are **not** evidence — re-shooting makes the audit pass by construction;
- it must read the actual PNGs and the actual source, not the reports;
- it must not commission its own sub-reviewer. In the predecessor project an implementer nested a reviewer it had commissioned itself, and that review was worthless; the independent pass then found defects the nested one missed.

Any `fixed` claim it cannot substantiate goes back to `open` with its text narrowed to the residue.
