<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Kit Additions — Phase 1 (Kit + Helpers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 13 missing design-system components and 2 number-formatting helpers from the `backstage` prototypes into the shared Svelte kit, each with a Storybook story and a happy-dom test, with zero consumer changes.

**Architecture:** Net-new, leaf-level additions to `client/shared/ui/` plus two exported helpers. Each component matches its prototype API 1:1 but is written in the codebase's Svelte 5 idiom (`$props()`, scoped `<style>` with CSS-variable tokens, BSL header) — not the prototype's inline-style React. No existing file is refactored in this phase; section adoption is Phases 2–3.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), Storybook (`@storybook/addon-svelte-csf`), `bun:test` + happy-dom (`mount`/`unmount` from `svelte`).

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§5 Layer 1–2, §6 inventory).

**Scope note:** This plan covers spec §5 Layers 1–2 (helpers + components). The `formatBytes` consolidation (spec §5 Layer 1, replacing the 3 local copies) edits existing admin sections and is therefore executed in the **Phase 2 admin-adoption plan**, where those section files are read in full. All section refactors (findings A1, A4, A7, B1–B7, C2 and the regression guards) are Phases 2–3.

---

## Conventions (apply to every task)

- **BSL header** at the top of every new `.svelte`/`.ts` file. Component/story use the HTML-comment form; `.ts` files use the `//` form. Copy the exact 4-line header seen in existing files (e.g. `client/shared/ui/Pill.svelte`).
- **Component path → test path:** `client/shared/ui/<Name>.svelte` → `tests/client/shared/ui/<Name>.test.ts` (the TDD write-hook enforces this mapping). Helpers: `client/shared/helpers.ts` → `tests/client/shared/helpers.test.ts`.
- **Run a single test file:** `bun test:client tests/client/shared/ui/<Name>.test.ts`
- **Snippet children in tests:** build with `createRawSnippet` exactly as in `tests/client/shared/ui/Pill.test.ts`.
- **No lint-disable / ts-ignore.** If `max-lines` trips, the component is doing too much — it won't here.
- **Commit after each task** with the shown message.

A reusable test helper for snippet text (used in several tasks):

```ts
import { createRawSnippet } from 'svelte'
import type { Snippet } from 'svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<span>${text}</span>`,
  }))
}
```

---

## File Structure

Created in this phase:

| File                                                                                                    | Responsibility                                           |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `client/shared/helpers.ts` (modify)                                                                     | add `fmtNum`, `fmtBytes`                                 |
| `client/shared/ui/status-tone.ts` (create)                                                              | `statusTone(status)` string→tone map + `StatusTone` type |
| `client/shared/ui/StatusPill.svelte` (create)                                                           | status string → `Pill` with mapped tone + dot            |
| `client/shared/ui/PageHeader.svelte` (create)                                                           | eyebrow + title + sub + action header                    |
| `client/shared/ui/Field.svelte` (create)                                                                | labeled form control wrapper                             |
| `client/shared/ui/FormRow.svelte` (create)                                                              | horizontal field row + trailing action                   |
| `client/shared/ui/Toolbar.svelte` (create)                                                              | inline action cluster                                    |
| `client/shared/ui/Tag.svelte` (create)                                                                  | non-status attribute badge                               |
| `client/shared/ui/Code.svelte` (create)                                                                 | inline monospace value chip                              |
| `client/shared/ui/JsonCell.svelte` (create)                                                             | JSON → key:value chips (Code fallback)                   |
| `client/shared/ui/Secret.svelte` (create)                                                               | masked value + reveal affordance                         |
| `client/shared/ui/EmptyState.svelte` (create)                                                           | standardized empty/prompt body                           |
| `client/shared/ui/Meter.svelte` (create)                                                                | clamped ratio bar, warn on over-capacity                 |
| `client/shared/ui/Stat.svelte` (create)                                                                 | "value of total" metric, warn on over                    |
| `client/shared/ui/SummaryList.svelte` (create)                                                          | aligned key/value rows                                   |
| plus one `.stories.svelte` and one `.test.ts` per component, one `.test.ts` for helpers and status-tone |

---

## Task 1: `fmtNum` / `fmtBytes` helpers

**Files:**

- Modify: `client/shared/helpers.ts`
- Test: `tests/client/shared/helpers.test.ts`

- [ ] **Step 1: Write the failing test** (create the file, or append the `describe` block if it already exists)

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { fmtBytes, fmtNum } from '../../../client/shared/helpers'

describe('fmtNum', () => {
  test('rounds to <=2dp by default and adds thousands separators', () => {
    expect(fmtNum(11.500000000000004)).toBe('11.5')
    expect(fmtNum(15.549999999999997)).toBe('15.55')
    expect(fmtNum(1171965.2000000002, 0)).toBe('1,171,965')
  })
  test('returns em dash for null/undefined/empty/non-finite', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined)).toBe('—')
    expect(fmtNum('')).toBe('—')
    expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('—')
  })
  test('passes through non-empty strings unchanged', () => {
    expect(fmtNum('n/a')).toBe('n/a')
  })
})

describe('fmtBytes', () => {
  test('humanizes using base 1024', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(1395505)).toBe('1.3 MB')
    expect(fmtBytes(277806)).toBe('271.3 KB')
  })
  test('returns em dash for null/undefined', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(undefined)).toBe('—')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/helpers.test.ts`
Expected: FAIL — `fmtNum`/`fmtBytes` not exported.

- [ ] **Step 3: Implement** — append to `client/shared/helpers.ts`

```ts
export function fmtNum(n: number | string | null | undefined, dp = 2): string {
  if (n === null || n === undefined || n === '') return '—'
  if (typeof n === 'string') return n
  if (!Number.isFinite(n)) return '—'
  const factor = 10 ** dp
  const r = Math.round(n * factor) / factor
  return r.toLocaleString('en-US', { maximumFractionDigits: dp })
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined) return '—'
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  let v = b
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client tests/client/shared/helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/helpers.ts tests/client/shared/helpers.test.ts
git commit -m "feat(client/ui): add fmtNum and fmtBytes formatting helpers"
```

---

## Task 2: `statusTone` mapping helper

**Files:**

- Create: `client/shared/ui/status-tone.ts`
- Test: `tests/client/shared/ui/status-tone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { statusTone } from '../../../../client/shared/ui/status-tone'

describe('statusTone', () => {
  test.each([
    ['active', 'accent'],
    ['enabled', 'accent'],
    ['auto', 'info'],
    ['pending', 'warn'],
    ['failed', 'danger'],
    ['unmatched', 'mute'],
    ['unknown', 'mute'],
  ] as const)('maps %s -> %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone)
  })
  test('is case-insensitive', () => {
    expect(statusTone('ACTIVE')).toBe('accent')
  })
  test('falls back to neutral for unrecognized values', () => {
    expect(statusTone('frobnicated')).toBe('neutral')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/status-tone.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `client/shared/ui/status-tone.ts`

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StatusTone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

const TONE_MAP: Record<string, StatusTone> = {
  active: 'accent',
  running: 'accent',
  ok: 'accent',
  connected: 'accent',
  configured: 'accent',
  enabled: 'accent',
  auto: 'info',
  scheduled: 'info',
  pending: 'warn',
  paused: 'warn',
  queued: 'warn',
  error: 'danger',
  failed: 'danger',
  stopped: 'danger',
  unmatched: 'mute',
  idle: 'mute',
  unknown: 'mute',
  disabled: 'mute',
  '—': 'mute',
}

export function statusTone(status: string): StatusTone {
  return TONE_MAP[String(status).toLowerCase()] ?? 'neutral'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/status-tone.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/status-tone.ts tests/client/shared/ui/status-tone.test.ts
git commit -m "feat(client/ui): add statusTone status-string mapping"
```

---

## Task 3: `StatusPill` component

**Files:**

- Create: `client/shared/ui/StatusPill.svelte`, `client/shared/ui/StatusPill.stories.svelte`
- Test: `tests/client/shared/ui/StatusPill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import StatusPill from '../../../../client/shared/ui/StatusPill.svelte'

function render(props: Record<string, unknown>): HTMLElement {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(StatusPill, { target, props })
  ;(globalThis as { __c?: unknown }).__c = c
  return target
}

describe('StatusPill.svelte', () => {
  test('renders the status text', () => {
    const t = render({ status: 'active' })
    expect(t.textContent).toContain('active')
    void unmount((globalThis as { __c: never }).__c)
  })
  test('maps active to the accent pill tone', () => {
    const t = render({ status: 'active' })
    expect(t.querySelector('.ui-pill--accent')).not.toBeNull()
    void unmount((globalThis as { __c: never }).__c)
  })
  test('shows a dot for active but not for mute statuses', () => {
    const t1 = render({ status: 'active' })
    expect(t1.querySelector('.ui-dot')).not.toBeNull()
    void unmount((globalThis as { __c: never }).__c)
    const t2 = render({ status: 'unknown' })
    expect(t2.querySelector('.ui-dot')).toBeNull()
    void unmount((globalThis as { __c: never }).__c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/StatusPill.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/StatusPill.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Pill from './Pill.svelte'
  import { statusTone } from './status-tone'

  interface Props {
    status: string
    dot?: boolean
  }

  let { status, dot = true }: Props = $props()

  const tone = $derived(statusTone(status))
  const showDot = $derived(dot && tone !== 'neutral' && tone !== 'mute')
</script>

<Pill {tone} dot={showDot}>{status}</Pill>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/StatusPill.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import StatusPill from './StatusPill.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/StatusPill',
    component: StatusPill,
  })
</script>

<Story name="Active" args={{ status: 'active' }} />
<Story name="Pending" args={{ status: 'pending' }} />
<Story name="Auto" args={{ status: 'auto' }} />
<Story name="Unmatched" args={{ status: 'unmatched' }} />
<Story name="Failed" args={{ status: 'failed' }} />
<Story name="Unknown" args={{ status: 'unknown' }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/StatusPill.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/StatusPill.svelte client/shared/ui/StatusPill.stories.svelte tests/client/shared/ui/StatusPill.test.ts
git commit -m "feat(client/ui): add StatusPill component"
```

---

## Task 4: `PageHeader` component

**Files:**

- Create: `client/shared/ui/PageHeader.svelte`, `client/shared/ui/PageHeader.stories.svelte`
- Test: `tests/client/shared/ui/PageHeader.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import PageHeader from '../../../../client/shared/ui/PageHeader.svelte'

describe('PageHeader.svelte', () => {
  test('renders title and eyebrow without duplicating the title', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { eyebrow: 'runtime', title: 'Instances', sub: 'platform · task' } })
    expect(target.querySelector('.ui-page-header__title')?.textContent).toBe('Instances')
    expect(target.querySelector('.ui-caption')?.textContent).toContain('runtime')
    expect(target.querySelector('.ui-page-header__sub')?.textContent).toContain('platform')
    void unmount(c)
  })
  test('omits eyebrow and sub when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { title: 'System' } })
    expect(target.querySelector('.ui-caption')).toBeNull()
    expect(target.querySelector('.ui-page-header__sub')).toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/PageHeader.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/PageHeader.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Caption from './Caption.svelte'

  interface Props {
    title: string
    eyebrow?: string
    sub?: string
    action?: Snippet
  }

  let { title, eyebrow, sub, action }: Props = $props()
</script>

<div class="ui-page-header">
  <div class="ui-page-header__text">
    {#if eyebrow}<Caption>{eyebrow}</Caption>{/if}
    <div class="ui-page-header__title">{title}</div>
    {#if sub}<div class="ui-page-header__sub">{sub}</div>{/if}
  </div>
  {#if action}<div class="ui-page-header__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin: 4px 0 14px;
  }
  .ui-page-header__text {
    min-width: 0;
  }
  .ui-page-header__title {
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.02em;
  }
  .ui-page-header__sub {
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
  .ui-page-header__action {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/PageHeader.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import PageHeader from './PageHeader.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/PageHeader',
    component: PageHeader,
  })
</script>

<Story name="Eyebrow + title + sub" args={{ eyebrow: 'runtime', title: 'Instances', sub: 'platform · task · admins' }} />
<Story name="Title only" args={{ title: 'System' }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/PageHeader.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/PageHeader.svelte client/shared/ui/PageHeader.stories.svelte tests/client/shared/ui/PageHeader.test.ts
git commit -m "feat(client/ui): add PageHeader component"
```

---

## Task 5: `Field` component

**Files:**

- Create: `client/shared/ui/Field.svelte`, `client/shared/ui/Field.stories.svelte`
- Test: `tests/client/shared/ui/Field.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Field from '../../../../client/shared/ui/Field.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Field.svelte', () => {
  test('renders label, child control and hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'kaneo url', hint: 'https only', children: textSnippet('CTRL') } })
    expect(target.querySelector('.ui-field__label')?.textContent).toContain('kaneo url')
    expect(target.querySelector('.ui-field__hint')?.textContent).toContain('https only')
    expect(target.textContent).toContain('CTRL')
    void unmount(c)
  })
  test('renders a required marker when required=true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Field, { target, props: { label: 'id', required: true, children: textSnippet('x') } })
    expect(target.querySelector('.ui-field__req')).not.toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Field.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Field.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    children: Snippet
    required?: boolean
    hint?: string
  }

  let { label, children, required = false, hint }: Props = $props()
</script>

<div class="ui-field">
  <span class="ui-field__label">
    {label}{#if required}<span class="ui-field__req">*</span>{/if}
  </span>
  {@render children()}
  {#if hint}<span class="ui-field__hint">{hint}</span>{/if}
</div>

<style>
  .ui-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .ui-field__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-field__req {
    color: var(--accent);
    margin-left: 5px;
  }
  .ui-field__hint {
    font-size: 10px;
    color: var(--fg4);
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Field.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Field from './Field.svelte'

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Field.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Field.svelte client/shared/ui/Field.stories.svelte tests/client/shared/ui/Field.test.ts
git commit -m "feat(client/ui): add Field labeled-control component"
```

---

## Task 6: `FormRow` component

**Files:**

- Create: `client/shared/ui/FormRow.svelte`, `client/shared/ui/FormRow.stories.svelte`
- Test: `tests/client/shared/ui/FormRow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import FormRow from '../../../../client/shared/ui/FormRow.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('FormRow.svelte', () => {
  test('renders children', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FormRow, { target, props: { children: snip('FIELDS') } })
    expect(target.textContent).toContain('FIELDS')
    expect(target.querySelector('.ui-form-row__action')).toBeNull()
    void unmount(c)
  })
  test('renders the action slot when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FormRow, { target, props: { children: snip('F'), action: snip('SUBMIT') } })
    expect(target.querySelector('.ui-form-row__action')?.textContent).toContain('SUBMIT')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/FormRow.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/FormRow.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    action?: Snippet
  }

  let { children, action }: Props = $props()
</script>

<div class="ui-form-row">
  {@render children()}
  {#if action}<div class="ui-form-row__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-form-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ui-form-row__action {
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/FormRow.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import FormRow from './FormRow.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/FormRow',
    component: FormRow,
  })
</script>

<Story name="Fields + action">
  {#snippet children()}<input placeholder="id" /><input placeholder="url" />{/snippet}
  {#snippet action()}<button>create</button>{/snippet}
</Story>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/FormRow.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/FormRow.svelte client/shared/ui/FormRow.stories.svelte tests/client/shared/ui/FormRow.test.ts
git commit -m "feat(client/ui): add FormRow component"
```

---

## Task 7: `Toolbar` component

**Files:**

- Create: `client/shared/ui/Toolbar.svelte`, `client/shared/ui/Toolbar.stories.svelte`
- Test: `tests/client/shared/ui/Toolbar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Toolbar from '../../../../client/shared/ui/Toolbar.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Toolbar.svelte', () => {
  test('wraps children in a toolbar container', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Toolbar, { target, props: { children: snip('ACTIONS') } })
    expect(target.querySelector('.ui-toolbar')?.textContent).toContain('ACTIONS')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Toolbar.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Toolbar.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div class="ui-toolbar">{@render children()}</div>

<style>
  .ui-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Toolbar.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Toolbar from './Toolbar.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Toolbar',
    component: Toolbar,
  })
</script>

<Story name="Action cluster">
  {#snippet children()}<input placeholder="user id" /><button>load</button>{/snippet}
</Story>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Toolbar.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Toolbar.svelte client/shared/ui/Toolbar.stories.svelte tests/client/shared/ui/Toolbar.test.ts
git commit -m "feat(client/ui): add Toolbar component"
```

---

## Task 8: `Tag` component

**Files:**

- Create: `client/shared/ui/Tag.svelte`, `client/shared/ui/Tag.stories.svelte`
- Test: `tests/client/shared/ui/Tag.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Tag from '../../../../client/shared/ui/Tag.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

type TagTone = 'neutral' | 'required' | 'optional' | 'info'

describe('Tag.svelte', () => {
  test('renders content', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Tag, { target, props: { children: snip('required') } })
    expect(target.textContent).toContain('required')
    void unmount(c)
  })
  test.each<TagTone>(['neutral', 'required', 'optional', 'info'])('applies the ui-tag--%s tone class', (tone) => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Tag, { target, props: { children: snip('x'), tone } })
    expect(target.querySelector(`.ui-tag--${tone}`)).not.toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Tag.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Tag.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'neutral' | 'required' | 'optional' | 'info'

  interface Props {
    children: Snippet
    tone?: Tone
  }

  let { children, tone = 'neutral' }: Props = $props()
</script>

<span class="ui-tag ui-tag--{tone}">{@render children()}</span>

<style>
  .ui-tag {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 2px;
    line-height: 1.6;
    border: 1px solid var(--hair);
    color: var(--fg3);
  }
  .ui-tag--required {
    color: var(--accent);
    border-color: rgba(93, 217, 122, 0.3);
  }
  .ui-tag--optional {
    color: var(--fg3);
    border-color: var(--hair);
  }
  .ui-tag--info {
    color: var(--info);
    border-color: rgba(108, 182, 255, 0.3);
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Tag.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Tag from './Tag.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Tag',
    component: Tag,
  })
</script>

<Story name="Required" args={{ tone: 'required' }}>required</Story>
<Story name="Optional" args={{ tone: 'optional' }}>optional</Story>
<Story name="Neutral">env</Story>
<Story name="Info" args={{ tone: 'info' }}>auto</Story>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Tag.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Tag.svelte client/shared/ui/Tag.stories.svelte tests/client/shared/ui/Tag.test.ts
git commit -m "feat(client/ui): add Tag attribute-badge component"
```

---

## Task 9: `Code` component

**Files:**

- Create: `client/shared/ui/Code.svelte`, `client/shared/ui/Code.stories.svelte`
- Test: `tests/client/shared/ui/Code.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Code from '../../../../client/shared/ui/Code.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('Code.svelte', () => {
  test('renders content and truncates by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Code, { target, props: { children: snip('hf:zai-org/GLM-5.1') } })
    const el = target.querySelector('.ui-code')
    expect(el?.textContent).toContain('hf:zai-org/GLM-5.1')
    expect(el?.classList.contains('ui-code--truncate')).toBe(true)
    void unmount(c)
  })
  test('does not truncate when truncate=false', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Code, { target, props: { children: snip('x'), truncate: false } })
    expect(target.querySelector('.ui-code')?.classList.contains('ui-code--truncate')).toBe(false)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Code.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Code.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    truncate?: boolean
    max?: number
  }

  let { children, truncate = true, max = 320 }: Props = $props()
</script>

<span
  class="ui-code"
  class:ui-code--truncate={truncate}
  style:max-width={truncate ? `${max}px` : null}
>{@render children()}</span>

<style>
  .ui-code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    background: var(--inset);
    border: 1px solid var(--hair);
    padding: 3px 8px;
    border-radius: 2px;
    display: inline-block;
  }
  .ui-code--truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Code.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Code from './Code.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Code',
    component: Code,
  })
</script>

<Story name="Inline value">hf:zai-org/GLM-5.1</Story>
<Story name="No truncate" args={{ truncate: false }}>http://kaneo:5173</Story>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Code.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Code.svelte client/shared/ui/Code.stories.svelte tests/client/shared/ui/Code.test.ts
git commit -m "feat(client/ui): add Code value-chip component"
```

---

## Task 10: `JsonCell` component

**Files:**

- Create: `client/shared/ui/JsonCell.svelte`, `client/shared/ui/JsonCell.stories.svelte`
- Test: `tests/client/shared/ui/JsonCell.test.ts`
- Depends on: Task 9 (`Code`).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import JsonCell from '../../../../client/shared/ui/JsonCell.svelte'

describe('JsonCell.svelte', () => {
  test('renders one chip per key for a JSON object string', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, {
      target,
      props: { value: '{"baseUrl":"https://kaneo.drowbridge.uk","internalUrl":"http://kaneo:5173"}' },
    })
    expect(target.querySelectorAll('.ui-jsoncell__chip').length).toBe(2)
    expect(target.textContent).toContain('baseUrl')
    expect(target.textContent).toContain('https://kaneo.drowbridge.uk')
    void unmount(c)
  })
  test('falls back to a Code chip for non-object strings', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, { target, props: { value: 'not json' } })
    expect(target.querySelector('.ui-jsoncell__chip')).toBeNull()
    expect(target.querySelector('.ui-code')?.textContent).toContain('not json')
    void unmount(c)
  })
  test('accepts an object value directly', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, { target, props: { value: { a: 1, b: 'two' } } })
    expect(target.querySelectorAll('.ui-jsoncell__chip').length).toBe(2)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/JsonCell.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/JsonCell.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Code from './Code.svelte'

  interface Props {
    value: string | Record<string, unknown>
  }

  let { value }: Props = $props()

  function safeParse(s: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(s)
      return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  const obj = $derived(typeof value === 'string' ? safeParse(value) : value)
  const entries = $derived(obj !== null && typeof obj === 'object' ? Object.entries(obj) : null)
</script>

{#if entries}
  <div class="ui-jsoncell">
    {#each entries as [k, v] (k)}
      <span class="ui-jsoncell__chip">
        <span class="ui-jsoncell__key">{k}</span>
        <span class="ui-jsoncell__val">{String(v)}</span>
      </span>
    {/each}
  </div>
{:else}
  <Code>{String(value)}</Code>
{/if}

<style>
  .ui-jsoncell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ui-jsoncell__chip {
    font-family: var(--font-mono);
    font-size: 11px;
    display: inline-flex;
    border: 1px solid var(--hair);
    border-radius: 2px;
    overflow: hidden;
  }
  .ui-jsoncell__key {
    background: var(--inset);
    color: var(--fg3);
    padding: 2px 7px;
  }
  .ui-jsoncell__val {
    background: var(--raised);
    color: var(--fg);
    padding: 2px 7px;
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/JsonCell.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import JsonCell from './JsonCell.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/JsonCell',
    component: JsonCell,
  })
</script>

<Story name="Config object" args={{ value: '{"baseUrl":"https://kaneo.drowbridge.uk","internalUrl":"http://kaneo:5173"}' }} />
<Story name="Fallback" args={{ value: 'plain string' }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/JsonCell.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/JsonCell.svelte client/shared/ui/JsonCell.stories.svelte tests/client/shared/ui/JsonCell.test.ts
git commit -m "feat(client/ui): add JsonCell key-value chip component"
```

---

## Task 11: `Secret` component

**Files:**

- Create: `client/shared/ui/Secret.svelte`, `client/shared/ui/Secret.stories.svelte`
- Test: `tests/client/shared/ui/Secret.test.ts`
- Depends on: `Btn` (existing).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Secret from '../../../../client/shared/ui/Secret.svelte'

describe('Secret.svelte', () => {
  test('renders the masked value and a reveal button', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Secret, { target, props: { value: '••••d2a0', hint: '(hidden)' } })
    expect(target.querySelector('.ui-secret__value')?.textContent).toContain('••••d2a0')
    expect(target.querySelector('.ui-secret__hint')?.textContent).toContain('(hidden)')
    expect(target.querySelector('.ui-btn')?.textContent).toContain('reveal')
    void unmount(c)
  })
  test('fires onReveal when the reveal button is clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let called = false
    const c = mount(Secret, {
      target,
      props: {
        value: '••••',
        onReveal: () => {
          called = true
        },
      },
    })
    target.querySelector<HTMLButtonElement>('.ui-btn')!.click()
    expect(called).toBe(true)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Secret.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Secret.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from './Btn.svelte'

  interface Props {
    value?: string
    hint?: string
    onReveal?: () => void
  }

  let { value = '••••••••', hint, onReveal }: Props = $props()
</script>

<span class="ui-secret">
  <span class="ui-secret__value">{value}</span>
  {#if hint}<span class="ui-secret__hint">{hint}</span>{/if}
  <Btn size="sm" variant="ghost" onClick={onReveal}>reveal</Btn>
</span>

<style>
  .ui-secret {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .ui-secret__value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg2);
    letter-spacing: 0.1em;
    background: var(--inset);
    border: 1px solid var(--hair);
    padding: 3px 10px;
    border-radius: 2px;
  }
  .ui-secret__hint {
    font-size: 10px;
    color: var(--fg4);
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Secret.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Secret from './Secret.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Secret',
    component: Secret,
  })
</script>

<Story name="Masked with hint" args={{ value: '••••d2a0', hint: '(hidden)' }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Secret.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Secret.svelte client/shared/ui/Secret.stories.svelte tests/client/shared/ui/Secret.test.ts
git commit -m "feat(client/ui): add Secret masked-value component"
```

---

## Task 12: `EmptyState` component

**Files:**

- Create: `client/shared/ui/EmptyState.svelte`, `client/shared/ui/EmptyState.stories.svelte`
- Test: `tests/client/shared/ui/EmptyState.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import EmptyState from '../../../../client/shared/ui/EmptyState.svelte'

function snip(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<span>${text}</span>` }))
}

describe('EmptyState.svelte', () => {
  test('renders title and hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(EmptyState, {
      target,
      props: { title: 'No recurring reminders', hint: 'Enter a user ID and click Load.' },
    })
    expect(target.querySelector('.ui-empty__title')?.textContent).toContain('No recurring reminders')
    expect(target.querySelector('.ui-empty__hint')?.textContent).toContain('Enter a user ID')
    void unmount(c)
  })
  test('renders the action slot when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(EmptyState, { target, props: { title: 'Empty', action: snip('LOAD') } })
    expect(target.querySelector('.ui-empty__action')?.textContent).toContain('LOAD')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/EmptyState.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/EmptyState.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    icon?: string
    hint?: string
    action?: Snippet
  }

  let { title, icon = '∅', hint, action }: Props = $props()
</script>

<div class="ui-empty">
  <div class="ui-empty__icon">{icon}</div>
  <div class="ui-empty__title">{title}</div>
  {#if hint}<div class="ui-empty__hint">{hint}</div>{/if}
  {#if action}<div class="ui-empty__action">{@render action()}</div>{/if}
</div>

<style>
  .ui-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 36px 24px;
    text-align: center;
    min-height: 120px;
  }
  .ui-empty__icon {
    font-size: 22px;
    color: var(--fg4);
    line-height: 1;
  }
  .ui-empty__title {
    font-size: 13px;
    color: var(--fg2);
  }
  .ui-empty__hint {
    font-size: 11px;
    color: var(--fg3);
    max-width: 320px;
  }
  .ui-empty__action {
    margin-top: 6px;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/EmptyState.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import EmptyState from './EmptyState.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/EmptyState',
    component: EmptyState,
  })
</script>

<Story name="No data" args={{ title: 'No recurring reminders', hint: 'Enter a user ID and click Load.' }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/EmptyState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/EmptyState.svelte client/shared/ui/EmptyState.stories.svelte tests/client/shared/ui/EmptyState.test.ts
git commit -m "feat(client/ui): add EmptyState component"
```

---

## Task 13: `Meter` component

**Files:**

- Create: `client/shared/ui/Meter.svelte`, `client/shared/ui/Meter.stories.svelte`
- Test: `tests/client/shared/ui/Meter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Meter from '../../../../client/shared/ui/Meter.svelte'

function fillEl(target: HTMLElement): HTMLElement {
  return target.querySelector<HTMLElement>('.ui-meter__fill')!
}

describe('Meter.svelte', () => {
  test('fills proportionally when value < total', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'recurring', value: 2, total: 4 } })
    expect(fillEl(target).style.width).toBe('50%')
    void unmount(c)
  })
  test('clamps to 100% and turns warn when value > total', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'deferred', value: 6, total: 4 } })
    expect(fillEl(target).style.width).toBe('100%')
    expect(target.querySelector('.ui-meter__fill--warn')).not.toBeNull()
    void unmount(c)
  })
  test('renders 0% for a zero total without overflowing', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Meter, { target, props: { label: 'x', value: 3, total: 0 } })
    expect(fillEl(target).style.width).toBe('0%')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Meter.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Meter.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  type Tone = 'accent' | 'warn' | 'danger' | 'info'

  interface Props {
    label: string
    value: number
    total: number
    suffix?: string
    tone?: Tone
  }

  let { label, value, total, suffix, tone = 'accent' }: Props = $props()

  const safeTotal = $derived(total > 0 ? total : 0)
  const over = $derived(safeTotal > 0 && value > safeTotal)
  const pct = $derived(safeTotal > 0 ? Math.max(0, Math.min(100, (value / safeTotal) * 100)) : 0)
  const fillTone = $derived(over ? 'warn' : tone)
  const suffixText = $derived(suffix !== undefined ? suffix : safeTotal ? `/${safeTotal}` : '')
</script>

<div class="ui-meter">
  <div class="ui-meter__head">
    <span class="ui-meter__label">{label}</span>
    <span class="ui-meter__value" class:ui-meter__value--over={over}>
      {value}<span class="ui-meter__suffix">{suffixText}</span>
    </span>
  </div>
  <div class="ui-meter__track">
    <div class="ui-meter__fill ui-meter__fill--{fillTone}" style:width="{pct}%"></div>
  </div>
</div>

<style>
  .ui-meter__head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 5px;
  }
  .ui-meter__label {
    font-size: 12px;
    color: var(--fg2);
  }
  .ui-meter__value {
    font-size: 12px;
    color: var(--fg);
  }
  .ui-meter__value--over {
    color: var(--warn);
  }
  .ui-meter__suffix {
    color: var(--fg3);
  }
  .ui-meter__track {
    height: 5px;
    background: var(--inset);
    position: relative;
    overflow: hidden;
  }
  .ui-meter__fill {
    position: absolute;
    inset: 0;
    width: 0;
  }
  .ui-meter__fill--accent {
    background: var(--accent);
  }
  .ui-meter__fill--warn {
    background: var(--warn);
  }
  .ui-meter__fill--danger {
    background: var(--danger);
  }
  .ui-meter__fill--info {
    background: var(--info);
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Meter.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Meter from './Meter.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Meter',
    component: Meter,
  })
</script>

<Story name="Half" args={{ label: 'recurring', value: 2, total: 4 }} />
<Story name="Full" args={{ label: 'memos', value: 4, total: 4 }} />
<Story name="Over capacity" args={{ label: 'deferred', value: 6, total: 4 }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Meter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Meter.svelte client/shared/ui/Meter.stories.svelte tests/client/shared/ui/Meter.test.ts
git commit -m "feat(client/ui): add Meter clamped ratio-bar component"
```

---

## Task 14: `Stat` component

**Files:**

- Create: `client/shared/ui/Stat.svelte`, `client/shared/ui/Stat.stories.svelte`
- Test: `tests/client/shared/ui/Stat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Stat from '../../../../client/shared/ui/Stat.svelte'

describe('Stat.svelte', () => {
  test('renders label, value and "of total"', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Stat, { target, props: { label: '7d', value: 9, of: 36 } })
    expect(target.querySelector('.ui-stat__value')?.textContent).toContain('9')
    expect(target.querySelector('.ui-stat__of')?.textContent).toContain('of 36')
    void unmount(c)
  })
  test('flags over-total values with warn styling and note', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Stat, { target, props: { label: '30d', value: 13, of: 4 } })
    expect(target.querySelector('.ui-stat__value--over')).not.toBeNull()
    expect(target.querySelector('.ui-stat__of')?.textContent).toContain('exceeds total')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/Stat.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/Stat.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Caption from './Caption.svelte'

  interface Props {
    label: string
    value: number | string
    of?: number
  }

  let { label, value, of }: Props = $props()

  const over = $derived(typeof value === 'number' && typeof of === 'number' && value > of)
</script>

<div class="ui-stat">
  <Caption>{label}</Caption>
  <div class="ui-stat__value" class:ui-stat__value--over={over}>{value}</div>
  {#if of !== undefined}
    <div class="ui-stat__of" class:ui-stat__of--over={over}>of {of}{#if over} · exceeds total{/if}</div>
  {/if}
</div>

<style>
  .ui-stat {
    padding: 14px 16px;
  }
  .ui-stat__value {
    font-size: 26px;
    font-weight: 600;
    color: var(--fg);
    margin-top: 6px;
    letter-spacing: -0.02em;
  }
  .ui-stat__value--over {
    color: var(--warn);
  }
  .ui-stat__of {
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
  .ui-stat__of--over {
    color: var(--warn);
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/Stat.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import Stat from './Stat.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/Stat',
    component: Stat,
  })
</script>

<Story name="Within total" args={{ label: '7d', value: 9, of: 36 }} />
<Story name="Exceeds total" args={{ label: '30d', value: 13, of: 4 }} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/Stat.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Stat.svelte client/shared/ui/Stat.stories.svelte tests/client/shared/ui/Stat.test.ts
git commit -m "feat(client/ui): add Stat value-of-total component"
```

---

## Task 15: `SummaryList` component

**Files:**

- Create: `client/shared/ui/SummaryList.svelte`, `client/shared/ui/SummaryList.stories.svelte`
- Test: `tests/client/shared/ui/SummaryList.test.ts`
- Depends on: Task 3 (`StatusPill`).

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SummaryList from '../../../../client/shared/ui/SummaryList.svelte'

describe('SummaryList.svelte', () => {
  test('renders one row per item with key and value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SummaryList, {
      target,
      props: {
        items: [
          { k: 'chat provider', v: 'telegram' },
          { k: 'debug server', v: 'enabled', pill: true },
        ],
      },
    })
    expect(target.querySelectorAll('.ui-summary__row').length).toBe(2)
    expect(target.textContent).toContain('chat provider')
    expect(target.textContent).toContain('telegram')
    void unmount(c)
  })
  test('renders a StatusPill for pill items', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SummaryList, { target, props: { items: [{ k: 'debug server', v: 'enabled', pill: true }] } })
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/SummaryList.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement component** — `client/shared/ui/SummaryList.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import StatusPill from './StatusPill.svelte'

  interface Item {
    k: string
    v: string
    pill?: boolean
    vColor?: string
  }

  interface Props {
    items: Item[]
    cols?: number
  }

  let { items, cols = 1 }: Props = $props()
</script>

<div class="ui-summary" style:grid-template-columns="repeat({cols}, 1fr)">
  {#each items as it (it.k)}
    <div class="ui-summary__row">
      <span class="ui-summary__k">{it.k}</span>
      <span class="ui-summary__v" style:color={it.vColor ?? null}>
        {#if it.pill}<StatusPill status={it.v} />{:else}{it.v}{/if}
      </span>
    </div>
  {/each}
</div>

<style>
  .ui-summary {
    display: grid;
    column-gap: 32px;
  }
  .ui-summary__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px solid var(--hair);
  }
  .ui-summary__k {
    font-size: 12px;
    color: var(--fg3);
  }
  .ui-summary__v {
    font-size: 12px;
    color: var(--fg);
    text-align: right;
  }
</style>
```

- [ ] **Step 4: Implement story** — `client/shared/ui/SummaryList.stories.svelte`

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import SummaryList from './SummaryList.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/SummaryList',
    component: SummaryList,
  })
</script>

<Story
  name="System summary"
  args={{
    cols: 2,
    items: [
      { k: 'chat provider', v: 'telegram' },
      { k: 'task provider', v: 'unknown', pill: true },
      { k: 'debug server', v: 'enabled', pill: true },
      { k: 'admin user', v: 'configured', pill: true },
    ],
  }}
/>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/shared/ui/SummaryList.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/SummaryList.svelte client/shared/ui/SummaryList.stories.svelte tests/client/shared/ui/SummaryList.test.ts
git commit -m "feat(client/ui): add SummaryList key-value component"
```

---

## Task 16: Full-suite gate + bundle isolation

**Files:** none (verification only).

- [ ] **Step 1: Run the full client test suite**

Run: `bun test:client`
Expected: PASS, including all 14 new test files.

- [ ] **Step 2: Verify the dev-only story harness did not leak into production bundles**

Run: `bun check:bundle-isolation`
Expected: PASS — `client/stories/**` and `*.stories.svelte` are excluded from the debug/admin/settings prod bundles.

- [ ] **Step 3: Run the staged-file check gate**

Run: `bun check`
Expected: lint, typecheck, format all PASS for the new files.

- [ ] **Step 4: Build the clients to confirm no compile regressions**

Run: `bun build:client`
Expected: bundles build with no errors. (New components have no consumers yet, so output is unchanged aside from being tree-shaken out.)

- [ ] **Step 5: (optional) Visual confirmation in Storybook**

Run: `bun storybook`
Expected: the new stories appear under `shared/ui/*` and render against the dark telemetry tokens.

There is no separate commit for this task — it is a gate over the work already committed in Tasks 1–15.

---

## Self-Review (completed during authoring)

- **Spec coverage:** Spec §5 Layer 1 (`fmtNum`/`fmtBytes`) → Task 1; §5 Layer 2 + §6 inventory (13 components) → Tasks 2–15. `statusTone` (§6 note) → Task 2. The `formatBytes` consolidation and all section refactors (§7) are explicitly deferred to the Phase 2/3 plans (stated in Scope note) — not a gap, a decomposition.
- **Placeholder scan:** no TBD/TODO; every step shows complete code or an exact command + expected result.
- **Type consistency:** `statusTone` returns `StatusTone` (Task 2) and is consumed by `StatusPill` (Task 3) and `SummaryList` (Task 15); `Code` (Task 9) is consumed by `JsonCell` (Task 10); `Btn` props (`size`, `variant`, `onClick`) match the existing `Btn.svelte` signature used by `Secret` (Task 11); `Caption` (existing) is consumed by `PageHeader` (Task 4) and `Stat` (Task 14). Test selectors (`.ui-*`) match the class names emitted by each component.

## Phase 2 / Phase 3 preview (authored as separate plans after this phase lands)

- **Phase 2 — `/admin` adoption:** consolidate the 3 local `formatBytes` onto `fmtBytes` (confirm base-1024 shift); apply A1, A4, A7, B1, B2, B3, B4, B5, B6, B7, C2 across `client/admin/` sections; add regression guards for A2, A3, A5, A6, C1, C3, D1; read-only `/stats/*` aggregation verification.
- **Phase 3 — `/debug` + `/settings` sweep:** adopt the new components wherever the identical anti-pattern (raw `<button>`/`<input>`, `JSON.stringify` cell, plain-text status, stacked KV) exists in `client/debug/` and `client/settings/`.
