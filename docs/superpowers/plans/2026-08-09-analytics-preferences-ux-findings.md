<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# AnalyticsPreferencesSection UX Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the fifteen open UX findings against `AnalyticsPreferencesSection` plus the two shared-primitive defects they force, so the section's consent controls are keyboard-reachable, honestly labelled, and consistent with the rest of the settings UI.

**Architecture:** Bottom-up in three layers. First the shared primitives (`SegmentedControl` roving tabindex, a new `LiveRegion`, a one-line `SettingsFieldShell` describedby fallback) — each independently testable and consumed by nobody yet. Then a pure copy module that turns preference state into user-facing sentences, so the tricky legitimate-interest branch is unit-testable without mounting Svelte. Then the section itself: structure first (real `SettingsFieldShell` rows, a header with a sub and a refresh), behaviour second (rights gating, error routing, delete-status mapping, busy). Storybook fixtures, visual states, and the review-doc bookkeeping land last, once there is something to shoot.

**Tech Stack:** Bun test runner (`bun:test`), Svelte 5 runes, `svelte`'s `mount`/`flushSync`/`unmount` for component tests, Zod v4 schemas, msw for Storybook fixtures, `@crvy/strybk` + Playwright for visual states.

**Spec:** `docs/superpowers/specs/2026-08-09-analytics-preferences-ux-findings-design.md`

## Global Constraints

- Runtime is **Bun**. Tests are `bun:test`. No Jest, no Vitest.
- Strict TypeScript. **Every relative import path ends in `.js`** — `import/extensions: ["error", "always"]`.
- **`oxc/no-optional-chaining` is an error.** Never write `a?.b` in `client/` or `src/`. Use `!== null` / `!== undefined` guards or `??`.
- **Never add a lint-disable or type-ignore comment.** A hook blocks them.
- Error text for the user comes from `formatFetchError` (`client/shared/format-error.ts:14`). Never surface `err.message` raw.
- The formatter is **`oxfmt`**: `bun run format`. Not prettier.
- The TDD hook fires on `Write`/`Edit` of `.ts`/`.js` under `client/`/`src/` and demands the matching test file exist first. It does **not** fire on `.svelte`. Every `.ts` file this plan creates therefore has its test written and run in a prior step.
- The shell is **fish**. Wrap any compound shell construct in `bash -c '...'`.
- Every new file starts with the four-line BUSL header used by its neighbours (`<!-- -->` in `.svelte`, `//` in `.ts`).
- Commit messages follow the repo's conventional-commit style, lowercase scope in parens.
- Storybook must be running on port 6006 for any `bun shoot` step.

---

### Task 1: SegmentedControl — a group with no selection keeps one tab stop

**Files:**

- Modify: `client/shared/ui/SegmentedControl.svelte:53`
- Test: `tests/client/shared/ui/SegmentedControl.test.ts` (exists, 283 lines — append)

**Interfaces:**

- Consumes: nothing.
- Produces: no API change. `SegmentedControl`'s props stay `{ options, value, ariaLabel, onChange, testidPrefix?, disabled?, ariaDescribedBy?, busy? }`. Only the rendered `tabindex` changes.

Today `tabindex={value === opt.value ? 0 : -1}` gives **every** option `-1` when `value` matches no option — the whole radiogroup drops out of the tab order. `value` is `'unknown'` for an unrecorded analytics choice, so both consent groups are unreachable by keyboard.

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/shared/ui/SegmentedControl.test.ts`:

```ts
test('an unmatched value leaves exactly one tab stop, on the first option', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'unknown', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  const tabIndexes = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__opt')).map((b) => b.tabIndex)
  expect(tabIndexes).toEqual([0, -1, -1])
  void unmount(c)
})

test('an unmatched value still marks no option as checked', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'unknown', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  const checked = Array.from(target.querySelectorAll('.ui-seg__opt')).map((b) => b.getAttribute('aria-checked'))
  expect(checked).toEqual(['false', 'false', 'false'])
  void unmount(c)
})

test('a matched value keeps the tab stop on the selected option', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'deny', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  const tabIndexes = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__opt')).map((b) => b.tabIndex)
  expect(tabIndexes).toEqual([-1, -1, 0])
  void unmount(c)
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `bun test tests/client/shared/ui/SegmentedControl.test.ts`
Expected: FAIL — `an unmatched value leaves exactly one tab stop, on the first option` reports `[-1, -1, -1]` received, `[0, -1, -1]` expected. The other two pass already.

- [ ] **Step 3: Add the derived active index**

In `client/shared/ui/SegmentedControl.svelte`, after the `$props()` destructuring (below line 30) add:

```svelte
  // A value matching no option (e.g. an unrecorded analytics choice) must still leave the
  // group in the tab order — otherwise no keyboard can reach it. Fall back to the first
  // option as the roving tab stop; `aria-checked` stays false everywhere, so nothing is
  // wrongly announced as selected.
  const activeIndex = $derived(Math.max(0, options.findIndex((opt) => opt.value === value)))
```

- [ ] **Step 4: Key the tabindex off it**

Replace line 53:

```svelte
        tabindex={value === opt.value ? 0 : -1}
```

with:

```svelte
        tabindex={i === activeIndex ? 0 : -1}
```

Leave `aria-checked` and `class:ui-seg__opt--on` keyed off `value === opt.value` — they are correct as they are.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `bun test tests/client/shared/ui/SegmentedControl.test.ts`
Expected: PASS, 16 tests. The pre-existing arrow-key, disabled, and busy tests must all stay green.

- [ ] **Step 6: Check the other two consumers still typecheck**

Run: `bun run lint && bun run typecheck`
Expected: both pass. `ConfigFieldRow` and `ToolsSection` pass no new props; this is a render-only change.

- [ ] **Step 7: Commit**

```bash
git add client/shared/ui/SegmentedControl.svelte tests/client/shared/ui/SegmentedControl.test.ts
git commit -m "fix(ui): a segmented control with no matching option stays reachable"
```

---

### Task 2: LiveRegion — an always-mounted announcement target

**Files:**

- Create: `client/shared/ui/LiveRegion.svelte`
- Test: `tests/client/shared/ui/LiveRegion.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  interface Props {
    message: string | null
    tone: 'status' | 'alert'
    testid?: string
  }
  ```
  Renders a single `<p>` that is **always** in the DOM. `tone: 'status'` → `role="status" aria-live="polite" class="live-region status-success"`. `tone: 'alert'` → `role="alert" aria-live="assertive" class="live-region status-error"`. Text content is `message ?? ''`.

A region created in the same tick as its text is frequently not announced; the region must pre-exist and have its text swapped. `.status-success` / `.status-error` are existing global settings classes and stay unscoped here.

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/LiveRegion.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import LiveRegion from '../../../../client/shared/ui/LiveRegion.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

const render = (props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(LiveRegion, { target, props })
  flushSync()
  return { target, component }
}

test('a status region is present and polite even with no message', () => {
  const { target, component } = render({ message: null, tone: 'status', testid: 'x-success' })
  const el = target.querySelector('[data-testid="x-success"]')
  expect(el).not.toBeNull()
  expect(el!.getAttribute('role')).toBe('status')
  expect(el!.getAttribute('aria-live')).toBe('polite')
  expect(el!.textContent).toBe('')
  void unmount(component)
})

test('a status region carries the success class and its message', () => {
  const { target, component } = render({ message: 'Preference saved.', tone: 'status', testid: 'x-success' })
  const el = target.querySelector('[data-testid="x-success"]')!
  expect(el.classList.contains('status-success')).toBe(true)
  expect(el.textContent).toBe('Preference saved.')
  void unmount(component)
})

test('an alert region is assertive and carries the error class', () => {
  const { target, component } = render({ message: 'It failed.', tone: 'alert', testid: 'x-error' })
  const el = target.querySelector('[data-testid="x-error"]')!
  expect(el.getAttribute('role')).toBe('alert')
  expect(el.getAttribute('aria-live')).toBe('assertive')
  expect(el.classList.contains('status-error')).toBe(true)
  expect(el.textContent).toBe('It failed.')
  void unmount(component)
})

test('an empty region stays in the document rather than unmounting', () => {
  const { target, component } = render({ message: '', tone: 'alert', testid: 'x-error' })
  expect(target.querySelectorAll('[data-testid="x-error"]').length).toBe(1)
  void unmount(component)
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test tests/client/shared/ui/LiveRegion.test.ts`
Expected: FAIL at import — `Cannot find module '.../client/shared/ui/LiveRegion.svelte'`.

- [ ] **Step 3: Write the component**

Create `client/shared/ui/LiveRegion.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    message: string | null
    tone: 'status' | 'alert'
    testid?: string
  }

  let { message, tone, testid }: Props = $props()
</script>

<!-- Always mounted, text swapped in place. A live region created in the same tick as its
     text is routinely missed by screen readers, so the element must pre-exist the
     announcement. Empty it collapses to zero height rather than unmounting, which keeps
     it in the accessibility tree. -->
{#if tone === 'alert'}
  <p class="live-region status-error" role="alert" aria-live="assertive" data-testid={testid}>{message ?? ''}</p>
{:else}
  <p class="live-region status-success" role="status" aria-live="polite" data-testid={testid}>{message ?? ''}</p>
{/if}

<style>
  .live-region {
    margin: 0;
  }
  .live-region:empty {
    height: 0;
    overflow: hidden;
  }
</style>
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun test tests/client/shared/ui/LiveRegion.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Format, lint, typecheck**

Run: `bun run format && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/LiveRegion.svelte tests/client/shared/ui/LiveRegion.test.ts
git commit -m "feat(ui): a live region that exists before it has anything to say"
```

---

### Task 3: SettingsFieldShell — describe a head control by its hint when there is no error

**Files:**

- Modify: `client/settings/components/SettingsFieldShell.svelte:61-67`
- Test: `tests/client/settings/components/SettingsFieldShell.test.ts` (append if it exists; create with the standard four-line `//` BUSL header, `import { afterEach, expect, test } from 'bun:test'`, `import { createRawSnippet, flushSync, mount, unmount } from 'svelte'`, and `import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'` if it does not — check first with `ls tests/client/settings/components/`)

**Interfaces:**

- Consumes: nothing.
- Produces: the `head` snippet's single parameter changes meaning from *"the error id, or undefined"* to *"the id of whichever of error/hint is rendered, or undefined"*. Signature is unchanged: `head?: Snippet<[string | undefined]>`.

`SegmentedControl` sits in the `head` slot and cannot read the field-error context (Svelte context published in the shell is not visible in the parent's snippet scope), so the shell hands the id down explicitly. It currently only ever hands down the error id, which is why Task 6 could not point `ariaDescribedBy` at a lane's status line. `ConfigFieldRow` — the only consumer that reads this parameter — passes no `hint` prop, so its behaviour is unchanged.

- [ ] **Step 1: Write the failing test**

Add to the shell's test file (see the Files block above for the header and imports if it does not yet exist):

A snippet can be handed to `mount()` with `createRawSnippet`, so the parameter is directly assertable — no need to defer the proof to Task 6. Add `createRawSnippet` to the `svelte` import.

```ts
const probeHead = createRawSnippet<[string | undefined]>((describedBy) => ({
  render: () => `<span data-testid="probe" data-got="${describedBy() ?? 'none'}"></span>`,
}))

test('the head snippet receives the hint id when there is no error', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsFieldShell, {
    target,
    props: { label: 'Lane', hint: 'Allowed since 2027-01-15 08:00', head: probeHead },
  })
  flushSync()
  const hintId = target.querySelector('.settings-field__hint')!.id
  expect(hintId).not.toBe('')
  expect(target.querySelector('[data-testid="probe"]')!.getAttribute('data-got')).toBe(hintId)
  void unmount(c)
})

test('the head snippet still receives the error id when there is an error', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsFieldShell, {
    target,
    props: { label: 'Lane', hint: 'Allowed.', error: 'Nope.', head: probeHead },
  })
  flushSync()
  const errorId = target.querySelector('.settings-field__error')!.id
  expect(errorId).not.toBe('')
  expect(target.querySelector('[data-testid="probe"]')!.getAttribute('data-got')).toBe(errorId)
  void unmount(c)
})

test('the head snippet receives nothing when there is neither error nor hint', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsFieldShell, { target, props: { label: 'Lane', head: probeHead } })
  flushSync()
  expect(target.querySelector('[data-testid="probe"]')!.getAttribute('data-got')).toBe('none')
  void unmount(c)
})
```

- [ ] **Step 2: Run the tests and watch the first one fail**

Run: `bun test tests/client/settings/components/SettingsFieldShell.test.ts`
Expected: FAIL, 1 test — `the head snippet receives the hint id when there is no error` gets `"none"` where the hint id was expected. The other two pass already and must keep passing.

- [ ] **Step 3: Change the id handed to the head snippet**

In `client/settings/components/SettingsFieldShell.svelte`, replace line 67:

```svelte
    {@render head?.(error ? errorId : undefined)}
```

with:

```svelte
    {@render head?.(error ? errorId : hint ? hintId : undefined)}
```

and extend the comment above it (lines 61-66) by appending this sentence to the existing block:

```
         When no error is showing, hand down the hint id instead, so a head control is
         described by the field's own status line rather than by nothing.
```

- [ ] **Step 4: Verify no consumer regressed**

Run: `bun test tests/client/settings/ && bun run typecheck`
Expected: PASS. `ConfigFieldRow`'s tests must stay green — it renders its hint through `footer`, never through the shell's `hint` prop, so it still receives `undefined`.

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/SettingsFieldShell.svelte tests/client/settings/components/SettingsFieldShell.test.ts
git commit -m "fix(settings): a field's head control is described by its hint, not by nothing"
```

---

### Task 4: The analytics copy module

**Files:**

- Create: `client/settings/sections/analytics-preferences-copy.ts`
- Test: `tests/client/settings/sections/analytics-preferences-copy.test.ts` (create)

**Interfaces:**

- Consumes: `formatDateTime` from `client/shared/helpers.ts:41` (returns `YYYY-MM-DD HH:MM` in UTC, or `—` for invalid input).
- Produces:
  ```ts
  export type AnalyticsLane = 'localLongitudinal' | 'externalPseudonymous'
  export type AnalyticsChoice = 'allow' | 'deny' | 'unknown'
  export type LawfulBasisMode = 'consent' | 'legitimate_interest'
  export type DeleteStatus = 'completed' | 'in_progress' | 'failed' | 'requested'

  export interface LaneHintInput {
    lane: AnalyticsLane
    value: AnalyticsChoice
    effectiveAtMs: number | null
    lawfulBasisMode: LawfulBasisMode | null
    policyEffectiveAtMs: number | null
    nowMs: number
  }

  export function laneHint(input: LaneHintInput): string
  export function deleteStatusMessage(status: DeleteStatus): { tone: 'status' | 'alert'; text: string }
  export const RIGHTS_UNAVAILABLE_TEXT: string
  ```

Why a separate module: the unset-state rule is not "unset means off". `src/analytics/governance/eligibility.ts:99-107` admits collection on the **local** lane when the lawful basis is `legitimate_interest` and the policy's effective date has passed; the **external** lane denies on unset unconditionally (`eligibility.ts:111`). A pure function makes that branch testable without mounting Svelte and keeps the copy out of the template.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/sections/analytics-preferences-copy.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deleteStatusMessage,
  laneHint,
  RIGHTS_UNAVAILABLE_TEXT,
} from '../../../../client/settings/sections/analytics-preferences-copy.js'
import type { LaneHintInput } from '../../../../client/settings/sections/analytics-preferences-copy.js'

const base: LaneHintInput = {
  lane: 'localLongitudinal',
  value: 'unknown',
  effectiveAtMs: null,
  lawfulBasisMode: 'consent',
  policyEffectiveAtMs: null,
  nowMs: 1_800_000_000_000,
}

describe('laneHint', () => {
  test('an allowed lane names the date the choice took effect', () => {
    expect(laneHint({ ...base, value: 'allow', effectiveAtMs: 1_800_000_000_000 })).toBe(
      'Allowed since 2027-01-15 08:00.',
    )
  })

  test('a denied lane names the date the choice took effect', () => {
    expect(laneHint({ ...base, value: 'deny', effectiveAtMs: 1_800_000_000_000 })).toBe(
      'Denied since 2027-01-15 08:00.',
    )
  })

  test('a recorded choice with no timestamp omits the date', () => {
    expect(laneHint({ ...base, value: 'allow', effectiveAtMs: null })).toBe('Allowed.')
    expect(laneHint({ ...base, value: 'deny', effectiveAtMs: null })).toBe('Denied.')
  })

  test('an unset external lane is always off until allowed', () => {
    expect(laneHint({ ...base, lane: 'externalPseudonymous', value: 'unknown' })).toBe(
      'No choice recorded — external analytics stay off until you allow them.',
    )
  })

  test('an unset external lane stays off even under legitimate interest', () => {
    expect(
      laneHint({
        ...base,
        lane: 'externalPseudonymous',
        lawfulBasisMode: 'legitimate_interest',
        policyEffectiveAtMs: 1_700_000_000_000,
      }),
    ).toBe('No choice recorded — external analytics stay off until you allow them.')
  })

  test('an unset local lane under consent stays off', () => {
    expect(laneHint(base)).toBe('No choice recorded — local analytics stay off until you allow them.')
  })

  test('an unset local lane under legitimate interest before the effective date stays off', () => {
    expect(
      laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: 1_900_000_000_000 }),
    ).toBe('No choice recorded — local analytics stay off until you allow them.')
  })

  test('an unset local lane under legitimate interest with no effective date stays off', () => {
    expect(laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: null })).toBe(
      'No choice recorded — local analytics stay off until you allow them.',
    )
  })

  test('an unset local lane under legitimate interest past the effective date is collected', () => {
    expect(
      laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: 1_700_000_000_000 }),
    ).toBe('No choice recorded — local analytics are collected until you deny them.')
  })

  test('an unset local lane with no lawful basis published stays off', () => {
    expect(laneHint({ ...base, lawfulBasisMode: null, policyEffectiveAtMs: 1_700_000_000_000 })).toBe(
      'No choice recorded — local analytics stay off until you allow them.',
    )
  })
})

describe('deleteStatusMessage', () => {
  test('a completed deletion is a success announcement', () => {
    expect(deleteStatusMessage('completed')).toEqual({
      tone: 'status',
      text: 'Your analytics data has been deleted. Analytics stores only.',
    })
  })

  test('an in-progress deletion is a success announcement', () => {
    expect(deleteStatusMessage('in_progress')).toEqual({
      tone: 'status',
      text: 'Deletion is under way. Analytics stores only.',
    })
  })

  test('a requested deletion is a success announcement', () => {
    expect(deleteStatusMessage('requested')).toEqual({
      tone: 'status',
      text: 'Deletion has been requested. Analytics stores only.',
    })
  })

  test('a failed deletion is an alert, not a success', () => {
    expect(deleteStatusMessage('failed')).toEqual({
      tone: 'alert',
      text: 'Deletion failed — your analytics data was not removed. Try again shortly.',
    })
  })
})

test('the rights-unavailable text blames the deployment and does not claim nothing is collected', () => {
  expect(RIGHTS_UNAVAILABLE_TEXT).toContain('operator')
  expect(RIGHTS_UNAVAILABLE_TEXT).toContain('aggregate')
  expect(RIGHTS_UNAVAILABLE_TEXT).not.toContain('nothing is collected')
})
```

Note on the expected date strings: `formatDateTime` renders UTC, so `1_800_000_000_000` is `2027-01-15 08:00`. If a run disagrees, trust `formatDateTime` and correct the literal — do not change the function.

- [ ] **Step 2: Run the test and watch it fail**

Run: `bun test tests/client/settings/sections/analytics-preferences-copy.test.ts`
Expected: FAIL at import — `Cannot find module '.../analytics-preferences-copy.js'`.

- [ ] **Step 3: Write the module**

Create `client/settings/sections/analytics-preferences-copy.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDateTime } from '../../shared/helpers.js'

export type AnalyticsLane = 'localLongitudinal' | 'externalPseudonymous'
export type AnalyticsChoice = 'allow' | 'deny' | 'unknown'
export type LawfulBasisMode = 'consent' | 'legitimate_interest'
export type DeleteStatus = 'completed' | 'in_progress' | 'failed' | 'requested'

export interface LaneHintInput {
  lane: AnalyticsLane
  value: AnalyticsChoice
  effectiveAtMs: number | null
  lawfulBasisMode: LawfulBasisMode | null
  policyEffectiveAtMs: number | null
  nowMs: number
}

/**
 * Whether an unrecorded choice admits collection on this lane. Mirrors
 * `src/analytics/governance/eligibility.ts:99-111`: the external lane denies on unset
 * unconditionally, while the local lane admits it under legitimate interest once the
 * published policy's effective date has passed. Saying "off until you choose" here would
 * be false on exactly that deployment.
 */
function unsetAdmitsCollection(input: LaneHintInput): boolean {
  if (input.lane !== 'localLongitudinal') return false
  if (input.lawfulBasisMode !== 'legitimate_interest') return false
  if (input.policyEffectiveAtMs === null) return false
  return input.nowMs >= input.policyEffectiveAtMs
}

function since(effectiveAtMs: number | null): string {
  return effectiveAtMs === null ? '.' : ` since ${formatDateTime(effectiveAtMs)}.`
}

export function laneHint(input: LaneHintInput): string {
  if (input.value === 'allow') return `Allowed${since(input.effectiveAtMs)}`
  if (input.value === 'deny') return `Denied${since(input.effectiveAtMs)}`
  const noun = input.lane === 'localLongitudinal' ? 'local' : 'external'
  return unsetAdmitsCollection(input)
    ? `No choice recorded — ${noun} analytics are collected until you deny them.`
    : `No choice recorded — ${noun} analytics stay off until you allow them.`
}

const DELETE_MESSAGES: Record<DeleteStatus, { tone: 'status' | 'alert'; text: string }> = {
  completed: { tone: 'status', text: 'Your analytics data has been deleted. Analytics stores only.' },
  in_progress: { tone: 'status', text: 'Deletion is under way. Analytics stores only.' },
  requested: { tone: 'status', text: 'Deletion has been requested. Analytics stores only.' },
  failed: { tone: 'alert', text: 'Deletion failed — your analytics data was not removed. Try again shortly.' },
}

export function deleteStatusMessage(status: DeleteStatus): { tone: 'status' | 'alert'; text: string } {
  return DELETE_MESSAGES[status]
}

/**
 * Shown when the operator has not configured the governance keyring. Deliberately does not
 * claim nothing is recorded: `eligibility.ts:136` short-circuits aggregate lanes before the
 * governance-readiness check, so aggregate counting continues regardless.
 */
export const RIGHTS_UNAVAILABLE_TEXT =
  'Your operator has not finished configuring analytics governance, so per-account choices, ' +
  'export and deletion are unavailable here. Aggregate analytics that never identify you may ' +
  'still be counted.'
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `bun test tests/client/settings/sections/analytics-preferences-copy.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Format, lint, typecheck**

Run: `bun run format && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/analytics-preferences-copy.ts tests/client/settings/sections/analytics-preferences-copy.test.ts
git commit -m "feat(settings): analytics consent copy is a pure, testable function"
```

---

### Task 5: The section's structure — real settings fields and a real header

**Files:**

- Modify: `client/settings/sections/AnalyticsPreferencesSection.svelte` (template + style; the script keeps `messageFrom` and the old error handling until Task 6)
- Test: `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts:163,185` (two assertions reference `analytics-effective`, which this task deletes)

**Interfaces:**

- Consumes: `SettingsFieldShell` from `../components/SettingsFieldShell.svelte`, `IconButton` from `../../shared/ui/IconButton.svelte`, `laneHint` from `./analytics-preferences-copy.js` (Task 4), `SegmentedControl`'s Task 1 behaviour.
- Produces: new test ids `analytics-field-local`, `analytics-field-external`, `analytics-refresh`. Removes `analytics-effective`. Keeps `analytics-notice`, `analytics-explanation`, `analytics-local-*`, `analytics-external-*`, `analytics-export`, `analytics-withdraw`, `analytics-delete`, `analytics-error`, `analytics-success`, `analytics-loading`.

- [ ] **Step 1: Update the two tests that assert the removed summary line**

In `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`, replace line 163:

```ts
    expect(target.querySelector('[data-testid="analytics-effective"]')!.textContent).toContain('unknown')
```

with:

```ts
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).toContain('No choice recorded')
    expect(target.querySelector('[data-testid="analytics-field-external"]')!.textContent).toContain(
      'external analytics stay off',
    )
```

and replace line 185:

```ts
    expect(target.querySelector('[data-testid="analytics-effective"]')!.textContent).toContain('allow')
```

with:

```ts
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).toContain('Allowed since')
```

(The PUT fixture at line 62 returns `localLongitudinal: 'allow', effectiveAtMs: 5`, so the hint becomes `Allowed since 1970-01-01 00:00.`)

- [ ] **Step 2: Run the tests and watch them fail**

Run: `bun test tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
Expected: FAIL, 2 tests — `renders notice, explanation, and both actor-only choices once loaded` and `choosing a lane PUTs only that lane for the signed-in actor`, both with `null is not an object` on the new test ids.

- [ ] **Step 3: Add the new imports and drop `effectiveText`**

In `client/settings/sections/AnalyticsPreferencesSection.svelte`, add to the import block (keeping the existing alphabetical-ish grouping):

```svelte
  import SettingsFieldShell from '../components/SettingsFieldShell.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import { laneHint } from './analytics-preferences-copy.js'
```

Delete the whole `effectiveText` `$derived` block (lines 106-113) and add, next to the other state declarations:

```svelte
  // Captured once per mount: the hint's legitimate-interest branch compares against the
  // policy's effective date, which does not move while the section is open.
  const nowMs = Date.now()
```

- [ ] **Step 4: Replace the header**

Replace line 121:

```svelte
  <PageHeader eyebrow="Personal" title="Analytics" />
```

with:

```svelte
  <PageHeader
    eyebrow="Personal"
    title="Analytics"
    sub="These choices apply to your own account only — never to a group or another member.">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={data === null && loadError === null}
        onClick={() => void load()}
        testid="analytics-refresh" />
    {/snippet}
  </PageHeader>
```

- [ ] **Step 5: Replace the two bespoke field rows and delete the summary paragraph**

Delete the standalone account-scope caption (line 133) — it is now the header's `sub`. Replace lines 135-159 (both `.settings-field` divs and the `analytics-effective` paragraph) with:

```svelte
    <SettingsFieldShell
      label="Local longitudinal analytics"
      editorOpen={false}
      testid="analytics-field-local"
      hint={laneHint({
        lane: 'localLongitudinal',
        value: data.preference.localLongitudinal,
        effectiveAtMs: data.preference.effectiveAtMs,
        lawfulBasisMode: data.notice.lawfulBasisMode,
        policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
        nowMs,
      })}>
      {#snippet head(describedBy)}
        <SegmentedControl
          options={CHOICE_OPTIONS}
          value={data.preference.localLongitudinal}
          ariaLabel="Local longitudinal analytics"
          ariaDescribedBy={describedBy}
          testidPrefix="analytics-local"
          disabled={busy || !data.subjectRightsAvailable}
          onChange={(value) => void choose('localLongitudinal', value)} />
      {/snippet}
    </SettingsFieldShell>

    <SettingsFieldShell
      label="External pseudonymous analytics"
      editorOpen={false}
      testid="analytics-field-external"
      hint={laneHint({
        lane: 'externalPseudonymous',
        value: data.preference.externalPseudonymous,
        effectiveAtMs: data.preference.effectiveAtMs,
        lawfulBasisMode: data.notice.lawfulBasisMode,
        policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
        nowMs,
      })}>
      {#snippet head(describedBy)}
        <SegmentedControl
          options={CHOICE_OPTIONS}
          value={data.preference.externalPseudonymous}
          ariaLabel="External pseudonymous analytics"
          ariaDescribedBy={describedBy}
          testidPrefix="analytics-external"
          disabled={busy || !data.subjectRightsAvailable}
          onChange={(value) => void choose('externalPseudonymous', value)} />
      {/snippet}
    </SettingsFieldShell>
```

Two things this closes on its own: `ariaDescribedBy` no longer repeats `ariaLabel` (the group is announced once, then its status line), and the `id="analytics-local-label"` / `id="analytics-external-label"` spans are gone — `SettingsFieldShell` owns the label and its id now.

- [ ] **Step 6: Add spacing between the fields and drop the dead styles**

Replace the whole `<style>` block (lines 218-235) with:

```svelte
<style>
  .settings-section__caption {
    margin: 0 0 var(--gap-inline);
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.45;
  }
  :global(.settings-section#analytics [data-testid^='analytics-field-']) {
    margin-bottom: var(--gap-inline);
  }
  /* The caption block and the first field are two different things; separate them on the
     section rhythm (--gap-field), not the within-block one (--gap-inline). */
  :global(.settings-section#analytics [data-testid='analytics-field-local']) {
    margin-top: var(--gap-field);
  }
</style>
```

`.settings-field` and `.settings-field__label` are deleted: the shell brings its own, and the old rules were the source of the far-edge stranding at wide viewports (`justify-content: space-between`), the off-scale `13px` label, and the literal `12px` gap.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `bun test tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Format, lint, typecheck**

Run: `bun run format && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add client/settings/sections/AnalyticsPreferencesSection.svelte tests/client/settings/sections/AnalyticsPreferencesSection.test.ts
git commit -m "refactor(settings): analytics consent rows become real settings fields"
```

---

### Task 6: The section's behaviour — gating, error routing, live regions, busy

**Files:**

- Modify: `client/settings/sections/AnalyticsPreferencesSection.svelte` (script + the action/status region of the template)
- Test: `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts` (modify two existing tests, append five)

**Interfaces:**

- Consumes: `LiveRegion` (Task 2), `deleteStatusMessage` / `RIGHTS_UNAVAILABLE_TEXT` (Task 4), `SettingsFieldShell`'s `error` prop and Task 3's describedby fallback, `formatFetchError` from `../../shared/format-error.js`.
- Produces: new test ids `analytics-rights-unavailable`. `analytics-error` and `analytics-success` become permanent elements rather than conditional ones.

- [ ] **Step 1: Write the failing tests**

In `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`, first add these fixtures next to the existing ones near the top:

```ts
const rightsUnavailablePayload = {
  ...preferencesPayload,
  preference: { localLongitudinal: 'unknown', externalPseudonymous: 'unknown', effectiveAtMs: null },
  subjectRightsAvailable: false,
} as const

const deleteFailedPayload = { status: 'failed', coverage: 'analytics_only' } as const

const routeDeleteFailed = (url: string, init: RequestInit): Promise<Response> => {
  if (init.method === 'POST' && url.endsWith('/delete')) return Promise.resolve(json(deleteFailedPayload))
  return Promise.resolve(getBody())
}
```

Then change the existing test `a failed choice renders an error summary alert` (lines 190-201) to assert the new routing:

```ts
  test('a failed choice reports under the lane it failed on and says nothing changed', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutFailure)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-deny"]')!.click()
    await drain()
    const field = target.querySelector('[data-testid="analytics-field-local"]')!
    const fieldError = field.querySelector('.settings-field__error')
    expect(fieldError).not.toBeNull()
    expect(fieldError!.getAttribute('role')).toBe('alert')
    expect(fieldError!.textContent).toContain('The setting was not changed.')
    expect(target.querySelector('[data-testid="analytics-field-external"]')!.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })
```

Change the existing test `delete requires destructive confirmation and reports the queued status` (line 247) to assert the mapped sentence instead of the raw enum:

```ts
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toContain('has been deleted')
```

Then append:

```ts
  test('the live regions exist before there is anything to announce', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    const success = target.querySelector('[data-testid="analytics-success"]')
    const error = target.querySelector('[data-testid="analytics-error"]')
    expect(success).not.toBeNull()
    expect(error).not.toBeNull()
    expect(success!.textContent).toBe('')
    expect(error!.textContent).toBe('')
    expect(success!.getAttribute('aria-live')).toBe('polite')
    expect(error!.getAttribute('aria-live')).toBe('assertive')
    void unmount(component)
  })

  test('a failed deletion is announced as an alert, not as a success', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routeDeleteFailed)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-delete"]')!.click()
    await drain()
    clickConfirmButton('Delete my analytics data')
    await drain()
    expect(target.querySelector('[data-testid="analytics-error"]')!.textContent).toContain('Deletion failed')
    expect(target.querySelector('[data-testid="analytics-success"]')!.textContent).toBe('')
    void unmount(component)
  })

  test('unavailable subject rights disable export alongside withdraw and delete', async () => {
    setMockFetch(() => Promise.resolve(json(rightsUnavailablePayload)))
    const { target, component } = render()
    await drain()
    for (const id of ['analytics-export', 'analytics-withdraw', 'analytics-delete']) {
      expect(target.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.disabled, id).toBe(true)
    }
    void unmount(component)
  })

  test('unavailable subject rights explain the deployment without claiming nothing is collected', async () => {
    setMockFetch(() => Promise.resolve(json(rightsUnavailablePayload)))
    const { target, component } = render()
    await drain()
    const notice = target.querySelector('[data-testid="analytics-rights-unavailable"]')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain('operator')
    expect(notice!.textContent).toContain('Aggregate analytics')
    expect(target.querySelector('[data-testid="analytics-field-local"]')!.textContent).not.toContain(
      'No choice recorded',
    )
    void unmount(component)
  })

  test('the local lane radiogroup is described by its own status line', async () => {
    setMockFetch(() => Promise.resolve(getBody()))
    const { target, component } = render()
    await drain()
    const field = target.querySelector('[data-testid="analytics-field-local"]')!
    const describedBy = field.querySelector('[role="radiogroup"]')!.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(field.querySelector(`#${describedBy}`)!.textContent).toContain('No choice recorded')
    void unmount(component)
  })

  test('an in-flight save marks the radiogroup busy', async () => {
    setCsrfToken('csrf-an')
    setMockFetch(routePutPending)
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="analytics-local-allow"]')!.click()
    flushSync()
    const group = target.querySelector('[data-testid="analytics-field-local"]')!.querySelector('[role="radiogroup"]')!
    expect(group.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `bun test tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
Expected: FAIL, 7 tests — the new ids and behaviours do not exist yet.

- [ ] **Step 3: Rewrite the script's error and action handling**

In `client/settings/sections/AnalyticsPreferencesSection.svelte`, add to the imports:

```svelte
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import { deleteStatusMessage, laneHint, RIGHTS_UNAVAILABLE_TEXT } from './analytics-preferences-copy.js'
```

(replacing the Task 5 `laneHint`-only import line).

Delete `messageFrom` (lines 33-35). Add a per-lane error store next to the other state:

```svelte
  let laneErrors = $state<{ localLongitudinal: string | null; externalPseudonymous: string | null }>({
    localLongitudinal: null,
    externalPseudonymous: null,
  })
```

Replace `load`, `run`, `choose`, and `confirmDelete` with:

```svelte
  async function load(): Promise<void> {
    loadError = null
    actionError = null
    try {
      data = await fetchAnalyticsPreferences()
    } catch (err) {
      loadError = formatFetchError(err)
    }
  }

  async function run(action: () => Promise<string>): Promise<void> {
    if (busy) return
    actionError = null
    announcement = null
    busy = true
    try {
      announcement = await action()
    } catch (err) {
      actionError = formatFetchError(err)
    } finally {
      busy = false
    }
  }

  // Not routed through `run`: a failed save belongs under the control that failed, not in
  // the shared alert below the destructive actions, and the control silently snaps back to
  // its stored value — so the message has to say the setting did not change.
  async function choose(lane: 'localLongitudinal' | 'externalPseudonymous', value: string): Promise<void> {
    if (value !== 'allow' && value !== 'deny') return
    if (busy) return
    laneErrors = { ...laneErrors, [lane]: null }
    actionError = null
    announcement = null
    busy = true
    try {
      const preference = await putAnalyticsPreferences({ [lane]: value })
      if (data !== null) data = { ...data, preference }
      announcement = 'Preference saved.'
    } catch (err) {
      laneErrors = { ...laneErrors, [lane]: `${formatFetchError(err)} The setting was not changed.` }
    } finally {
      busy = false
    }
  }

  async function confirmDelete(): Promise<void> {
    if (busy) return
    actionError = null
    announcement = null
    busy = true
    try {
      const result = await deleteAnalyticsData()
      confirming = null
      const message = deleteStatusMessage(result.status)
      if (message.tone === 'alert') actionError = message.text
      else announcement = message.text
    } catch (err) {
      actionError = formatFetchError(err)
    } finally {
      busy = false
    }
  }
```

`exportData` and `confirmWithdraw` keep using `run` unchanged.

- [ ] **Step 4: Wire the template — gating, per-lane error, busy, live regions**

Add the rights-unavailable paragraph immediately after the `analytics-explanation` caption:

```svelte
    {#if !data.subjectRightsAvailable}
      <p class="settings-section__caption" data-testid="analytics-rights-unavailable">{RIGHTS_UNAVAILABLE_TEXT}</p>
    {/if}
```

On **both** `SettingsFieldShell` blocks from Task 5, add an `error` prop and make the hint conditional — when rights are unavailable the per-lane hints are replaced by the single paragraph above, because a lane's status is meaningless on a deployment that cannot record one:

```svelte
    <SettingsFieldShell
      label="Local longitudinal analytics"
      editorOpen={false}
      testid="analytics-field-local"
      error={laneErrors.localLongitudinal ?? undefined}
      hint={data.subjectRightsAvailable
        ? laneHint({
            lane: 'localLongitudinal',
            value: data.preference.localLongitudinal,
            effectiveAtMs: data.preference.effectiveAtMs,
            lawfulBasisMode: data.notice.lawfulBasisMode,
            policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
            nowMs,
          })
        : undefined}>
```

and, for the second shell:

```svelte
    <SettingsFieldShell
      label="External pseudonymous analytics"
      editorOpen={false}
      testid="analytics-field-external"
      error={laneErrors.externalPseudonymous ?? undefined}
      hint={data.subjectRightsAvailable
        ? laneHint({
            lane: 'externalPseudonymous',
            value: data.preference.externalPseudonymous,
            effectiveAtMs: data.preference.effectiveAtMs,
            lawfulBasisMode: data.notice.lawfulBasisMode,
            policyEffectiveAtMs: data.notice.policyEffectiveAtMs,
            nowMs,
          })
        : undefined}>
```

Both `{#snippet head(describedBy)}` bodies from Task 5 stay exactly as they are, apart from the `busy` prop added below.

On both `SegmentedControl`s add:

```svelte
          busy={busy}
```

Gate export like its siblings — line 162's `disabled={busy}` becomes:

```svelte
      <Btn
        variant="outline"
        size="sm"
        disabled={busy || !data.subjectRightsAvailable}
        testid="analytics-export"
        onClick={() => void exportData()}>
```

`handleExport` already calls `requireGovernanceKeyring` (`src/debug/settings/analytics-routes.ts:175`) and 503s, so an enabled button here could only ever fail.

Replace the two conditional status paragraphs (lines 183-188) with:

```svelte
    <LiveRegion tone="alert" message={actionError} testid="analytics-error" />
    <LiveRegion tone="status" message={announcement} testid="analytics-success" />
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `bun test tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Run the whole client suite**

Run: `bun test tests/client/`
Expected: PASS. Nothing outside this section consumes the changed pieces except `ConfigFieldRow` (Tasks 1 and 3), already covered.

- [ ] **Step 7: Format, lint, typecheck**

Run: `bun run format && bun run lint && bun run typecheck`
Expected: all pass. Watch for `oxc/no-optional-chaining` — none of the code above uses `?.`.

- [ ] **Step 8: Commit**

```bash
git add client/settings/sections/AnalyticsPreferencesSection.svelte tests/client/settings/sections/AnalyticsPreferencesSection.test.ts
git commit -m "fix(settings): analytics consent says what it did and why it can't"
```

---

### Task 7: Fixtures, stories, and visual proof

**Files:**

- Modify: `client/stories/msw/settings-handlers-personal-2.ts:260` (append two handler exports)
- Modify: `client/stories/msw/scenarios.ts:57-58,288` (import and register two scenarios)
- Modify: `tests/client/stories/msw/settings-handlers-personal-2.test.ts` (append two tests)
- Modify: `client/settings/sections/AnalyticsPreferencesSection.stories.svelte` (append two stories)
- Modify: `tests/visual/settings/sections/AnalyticsPreferencesSection.spec.ts` (regenerate the auto region; add two manual states)

**Interfaces:**

- Consumes: nothing from earlier tasks at runtime; the stories exercise Task 6's rendering.
- Produces: scenario keys `settings-analytics-rights-unavailable` and `settings-analytics-legitimate-interest-unset`; story ids `settings-sections-analyticspreferencessection--rights-unavailable` and `--legitimate-interest-unset`.

Neither state can be shot today: no fixture sets `subjectRightsAvailable: false`, and none sets `lawfulBasisMode: 'legitimate_interest'` with a past `policyEffectiveAtMs`. The review recorded both as "States not captured".

- [ ] **Step 1: Write the failing handler tests**

Append to `tests/client/stories/msw/settings-handlers-personal-2.test.ts`, inside the existing `describe`, and add the two names to the import block at line 11:

```ts
  test('analyticsRightsUnavailableHandlers covers the preferences GET', () => {
    expect(pathsOf(analyticsRightsUnavailableHandlers).some((p) => p.includes('/settings/api/analytics/preferences'))).toBe(
      true,
    )
  })

  test('analyticsLegitimateInterestHandlers covers the preferences GET', () => {
    expect(
      pathsOf(analyticsLegitimateInterestHandlers).some((p) => p.includes('/settings/api/analytics/preferences')),
    ).toBe(true)
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test tests/client/stories/msw/settings-handlers-personal-2.test.ts`
Expected: FAIL — the two exports do not exist.

- [ ] **Step 3: Add the handlers**

Append to `client/stories/msw/settings-handlers-personal-2.ts` after `analyticsWithdrawalInProgressHandlers`:

```ts
// The operator has not configured the governance keyring: every subject right 503s, and the
// per-lane hints are replaced by one paragraph. Aggregate collection continues regardless
// (src/analytics/governance/eligibility.ts:136), so the copy must not claim otherwise.
export const analyticsRightsUnavailableHandlers: HttpHandler[] = [
  http.get('/settings/api/analytics/preferences', () =>
    HttpResponse.json({ ...analyticsPreferencesPopulated, subjectRightsAvailable: false }),
  ),
]

// Legitimate interest, past its effective date, with no recorded choice: the local lane is
// collected until denied, while the external lane still stays off until allowed.
export const analyticsLegitimateInterestHandlers: HttpHandler[] = [
  http.get('/settings/api/analytics/preferences', () =>
    HttpResponse.json({
      ...analyticsPreferencesPopulated,
      notice: {
        ...analyticsPreferencesPopulated.notice,
        lawfulBasisMode: 'legitimate_interest',
        policyEffectiveAtMs: 1_700_000_000_000,
      },
    }),
  ),
]
```

- [ ] **Step 4: Register the scenarios**

In `client/stories/msw/scenarios.ts`, add `analyticsLegitimateInterestHandlers,` and `analyticsRightsUnavailableHandlers,` to the import block at lines 57-58 (keeping alphabetical order), then after line 288 add:

```ts
  'settings-analytics-rights-unavailable': [...analyticsRightsUnavailableHandlers],
  'settings-analytics-legitimate-interest-unset': [...analyticsLegitimateInterestHandlers],
```

- [ ] **Step 5: Run the msw tests and watch them pass**

Run: `bun test tests/client/stories/msw/`
Expected: PASS. `scenarios.test.ts` must stay green — it asserts over the registry as a whole.

- [ ] **Step 6: Add the stories**

Append to `client/settings/sections/AnalyticsPreferencesSection.stories.svelte`:

```svelte
<!-- the operator has not configured governance: every right is unavailable -->
<Story name="RightsUnavailable" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-rights-unavailable' }} />

<!-- legitimate interest past its effective date: unset does not mean off on the local lane -->
<Story name="LegitimateInterestUnset" args={{ contextId: CONTEXT_ID, scope: 'personal' }} parameters={{ fixtures: 'settings-analytics-legitimate-interest-unset' }} />
```

- [ ] **Step 7: Regenerate the visual spec's auto region**

Make sure Storybook is up (`bun storybook`, port 6006), then run: `bun shoot:gen`
Expected: `tests/visual/settings/sections/AnalyticsPreferencesSection.spec.ts`'s `@generated-begin auto-screenshots` region gains `RightsUnavailable` and `LegitimateInterestUnset` tests. The manual region below `@generated-end` is untouched.

- [ ] **Step 8: Add the two manual states the new fixtures unlock**

Append to the manual region of `tests/visual/settings/sections/AnalyticsPreferencesSection.spec.ts`:

```ts
test('AnalyticsPreferences — rights unavailable, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--rights-unavailable')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

test('AnalyticsPreferences — keyboard focus lands on the first choice of the first lane', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-sections-analyticspreferencessection--legitimate-interest-unset')
  await sharedPage.getByTestId('analytics-notice').click()
  await sharedPage.keyboard.press('Tab')
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})
```

The second is the proof for Task 1: before the fix, Tab from the notice skipped both radiogroups and landed on Export.

- [ ] **Step 9: Re-shoot every state**

Run: `bun shoot -g AnalyticsPreferences`
Expected: all baselines rewritten under `.storybook-shots/tests/visual/settings/sections/AnalyticsPreferencesSection.spec.ts/`.

- [ ] **Step 10: Read the frames — do not trust the diff**

Read these PNGs with the Read tool and check each claim:

| Frame                                                          | What must be true                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `AnalyticsPreferences-aggregate-default-narrow-1.png`           | Two bordered field cards; label left, segments right; status line under each      |
| `AnalyticsPreferences-keyboard-focus-lands-on-the-first-choice-of-the-first-lane-1.png` | The focus ring sits on the local lane's **Allow**, not on Export |
| `AnalyticsPreferences-rights-unavailable-narrow-1.png`          | One explanation paragraph, no per-lane status lines, all three buttons dimmed     |
| `LegitimateInterestUnset-1.png`                                 | Local says "are collected until you deny them"; external says "stay off"          |
| `AnalyticsPreferences-a-failed-preference-save-1.png`           | The error sits inside the local field card, and says the setting was not changed  |
| `AnalyticsPreferences-after-a-queued-deletion-1.png`            | Exactly one status line; **no phantom empty gap** above it from the idle alert region |

That last row is Task 2's open risk. If an empty `LiveRegion` leaves a visible gap, fix it in `LiveRegion.svelte`'s `:empty` rule — not by unmounting the region, which would undo the point of the primitive — and re-shoot.

- [ ] **Step 11: Format and commit**

```bash
bun run format
git add client/stories/msw/settings-handlers-personal-2.ts client/stories/msw/scenarios.ts \
  tests/client/stories/msw/settings-handlers-personal-2.test.ts \
  client/settings/sections/AnalyticsPreferencesSection.stories.svelte \
  tests/visual/settings/sections/AnalyticsPreferencesSection.spec.ts .storybook-shots/
git commit -m "test(stories): capture unavailable rights and legitimate-interest consent"
```

---

### Task 8: Close the findings

**Files:**

- Modify: `docs/ux-reviews/AnalyticsPreferencesSection.md`
- Modify: `docs/ux-reviews/_BACKLOG.md` (generated — never hand-edited)

**Interfaces:**

- Consumes: the commit hashes produced by Tasks 1-7.
- Produces: nothing consumed by code.

Statuses are `open` / `fixed` / `superseded` / `wont-fix` / `deferred`. There is no `partial`: a part-fixed finding stays `open` with its text **narrowed to the residue**, keeping its id. Ids are never reused and never derived from headings.

- [ ] **Step 1: Collect the hashes**

Run: `bash -c 'git log --oneline -8'`
Note the hash for each of the seven commits; each `Resolved:` line names the one that actually closed the finding.

- [ ] **Step 2: Mark the fixed findings**

Set `**Status:** fixed` and add a `- **Resolved:** <hash> — <one line>` bullet to each of these fourteen ids:

| Id                                              | Closed by                                                  |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `analytics-prefs-radiogroup-unreachable-when-unset` | Task 1 — roving tabindex falls back to the first option |
| `analytics-prefs-disabled-rights-unexplained`   | Task 6 — the rights-unavailable paragraph                  |
| `analytics-prefs-failed-save-silently-reverts`  | Task 6 — per-lane error saying the setting did not change  |
| `analytics-prefs-bespoke-field-layout`          | Task 5 — `SettingsFieldShell` replaces the bespoke rows     |
| `analytics-prefs-no-inflight-signal`            | Task 6 — `busy` reaches the radiogroups and the buttons     |
| `analytics-prefs-raw-status-enum-copy`          | Task 4/6 — `deleteStatusMessage`                            |
| `analytics-prefs-raw-fetch-errors`              | Task 6 — `formatFetchError` replaces `messageFrom`          |
| `analytics-prefs-unknown-state-unlabelled`      | Task 4/5 — `laneHint` names the unrecorded state            |
| `analytics-prefs-live-regions-mount-with-text`  | Task 2/6 — `LiveRegion` is always mounted                   |
| `analytics-prefs-header-sub-and-refresh-unused` | Task 5 — header gains `sub` and a refresh action            |
| `analytics-prefs-field-row-unbounded-width`     | Task 5 — the `space-between` row is gone                    |
| `analytics-prefs-duplicate-aria-naming`         | Task 3/5 — `ariaDescribedBy` points at the hint             |
| `analytics-prefs-export-not-rights-gated`       | Task 6 — export joins withdraw and delete behind the flag   |
| `analytics-prefs-effective-timestamp-raw-locale`| Task 4 — `formatDateTime` replaces `toLocaleString()`       |

- [ ] **Step 3: Correct and close the spacing finding**

`analytics-prefs-off-scale-spacing-and-type` becomes `**Status:** fixed`, but its text needs correcting first — it claimed the 12px caption was off-scale, and that claim is wrong: `.settings-section__caption` is declared identically (12px, `--text-dim`) in three sibling sections, so 12px **is** the house convention. Rewrite the body to the two claims that were true, then resolve:

```markdown
- **Suggested fix:** The off-scale 13px field label and the literal `12px` row gap should come
  from the shared scale, and the caption block should be separated from the fields on the
  section rhythm rather than the within-block one.
- **Resolved:** <hash> — the bespoke row is gone with `SettingsFieldShell` (13px label and the
  `12px` gap with it), and the caption-to-field separation is now `--gap-field`. The original
  finding also claimed the 12px caption was off-scale; that was wrong and has been struck.
```

- [ ] **Step 4: Add the two findings the review missed**

Append with fresh ids, both `**Status:** fixed`:

```markdown
### [High] An unrecorded choice was presented as "off" on a deployment where it is not

- **Id:** analytics-prefs-unset-not-always-off
- **Status:** fixed
- **Dimension:** 5. Content & language
- **Where visible:** LegitimateInterestUnset story, desktop
- **Source:** `src/analytics/governance/eligibility.ts:99-107`
- **Suggested fix:** Make the unset copy a function of the published lawful basis — under
  legitimate interest past the policy's effective date the local lane is collected until denied.
- **Resolved:** <hash> — `laneHint` branches on `lawfulBasisMode` and `policyEffectiveAtMs`.

### [Med] A failed deletion was announced through the success region

- **Id:** analytics-prefs-failed-deletion-announced-as-success
- **Status:** fixed
- **Dimension:** 4. Feedback & state
- **Where visible:** delete confirmation, `status: 'failed'` response
- **Source:** `client/settings/fetcher-schemas-analytics.ts:75`
- **Suggested fix:** Map each of the four delete statuses to its own sentence and route the
  failure to the alert region.
- **Resolved:** <hash> — `deleteStatusMessage` returns a tone alongside the text.
```

- [ ] **Step 5: Set the review date**

Change the doc's `**Date:**` to today — it means *last reviewed*, and update `**States captured:**` to mention the rights-unavailable and legitimate-interest states.

- [ ] **Step 6: Regenerate the backlog**

Run: `bun run ux:backlog && bun run format`
Expected: `_BACKLOG.md`'s `AnalyticsPreferencesSection` row goes from `15 | 0` open/fixed to `0 | 17`, and the total open count drops from 21 to 6. If the row still shows an open finding, a `Status:` line was missed — find it before committing.

- [ ] **Step 7: Commit**

```bash
git add docs/ux-reviews/AnalyticsPreferencesSection.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux-review): close the analytics consent findings"
```

- [ ] **Step 8: Full check before handing back**

Run: `bun run check` (or `bun run check:full` if the repo defines it)
Expected: lint, typecheck, format, license headers, and the test suite all pass.

---

## Notes on where this plan refines the spec

Three places where writing it out forced a decision the spec left open. None change what ships.

1. **The spec's "commit 1" is two commits here** (Tasks 1 and 2). Both primitives are independently testable and independently rejectable; bundling them would only make the review harder. The ordering the user approved — primitives before structure before behaviour — is unchanged.
2. **`SettingsFieldShell` needed a one-line change** (Task 3) that the spec did not anticipate. The spec says `ariaDescribedBy` should point at the hint; the shell only ever handed its `head` snippet the *error* id, so there was no way to reach the hint id from a `head`-slotted `SegmentedControl`. Task 3 is the smallest change that makes the spec's sentence true, and no existing consumer is affected.
3. **`analytics-prefs-off-scale-spacing-and-type` closes rather than staying open.** The spec kept it open, narrowed to the label and the gap, on the assumption that the caption-to-field rhythm would go unaddressed. Task 5's style block fixes that too, so nothing is left to narrow to — the finding's wrong caption claim is struck and the finding resolves.
4. **The per-lane hint is suppressed when rights are unavailable**, replaced by the single explanatory paragraph. The spec implied this; the plan states it, because the alternative — showing "No choice recorded — stays off until you allow" next to a control nobody can operate — is worse than saying nothing.
