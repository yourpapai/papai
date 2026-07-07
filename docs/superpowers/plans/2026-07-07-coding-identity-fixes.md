<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# CodingIdentitySection UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `client/settings/sections/CodingIdentitySection.svelte` to follow the established `GroupProviderSection`/`TaskProviderSection` pattern, resolving all 8 findings from the UX review.

**Architecture:** A Svelte 5 (runes) settings section. The rewrite introduces a top-level `loadError / loading / loaded` render gate so the editable form never renders during a failed or in-flight load; it swaps the hand-rolled `<select>`/label/error markup for the shared `Field`, `Select`, and `ErrorState` primitives; and it adds a busy Save label plus a `status-success` confirmation. No backend, schema, or fetcher changes — the members API already returns `user_label`.

**Tech Stack:** Svelte 5 runes, TypeScript (strict, `.js` import extensions), Bun test runner (`bun:test`) with Svelte `mount`/`flushSync` for component DOM tests, `@crvy/strybk` + Playwright for Storybook screenshots, `oxfmt`/`oxlint` via `bun run check`.

**Source spec:** [`docs/superpowers/specs/2026-07-07-coding-identity-fixes-design.md`](../specs/2026-07-07-coding-identity-fixes-design.md)
**Source review:** [`docs/ux-reviews/CodingIdentitySection.md`](../../ux-reviews/CodingIdentitySection.md)

---

## File Structure

| File                                                           | Responsibility                                                                 | Change   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| `client/settings/sections/CodingIdentitySection.svelte`        | The section component — rewritten to the sibling pattern                       | Modify   |
| `tests/client/settings/sections/CodingIdentitySection.test.ts` | Component DOM tests (loading/loaded/labels/validation/error/success/busy)      | Create   |
| `client/stories/msw/settings-handlers-group.ts`                | Fix the Populated coding-identity fixture so it exercises the member dropdown  | Modify   |
| `tests/visual/settings/sections/CodingIdentitySection.spec.ts` | Visual states (already extended during the review) — refresh baselines, commit | Modify\* |

`*` The visual spec already has the manual states added during the review; this plan commits that pending change and refreshes its (gitignored) baselines.

### Reference files (read, do not modify)

- Pattern to mirror: `client/settings/sections/GroupProviderSection.svelte` (loadError/loading gate, `Field`+`Select`, busy Save, `status-success`).
- Test harness to mirror: `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts`.
- Primitives: `client/shared/ui/Field.svelte`, `client/shared/ui/Select.svelte`, `client/shared/ui/ErrorState.svelte`, `client/shared/ui/Btn.svelte`, `client/shared/format-error.js`.

---

## Task 1: Component DOM tests (red)

Write the full test suite first. All tests are expected to FAIL against the current
component (which shows no `.placeholder` during load, renders a raw `<select>` with no
`.ui-select` wrapper, shows raw member ids, has no `ErrorState`, no busy label, and no
success message).

**Files:**

- Create: `tests/client/settings/sections/CodingIdentitySection.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/client/settings/sections/CodingIdentitySection.test.ts` with exactly:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import CodingIdentitySection from '../../../../client/settings/sections/CodingIdentitySection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const CTX = 'ctx-group-1'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const identity = (value: string): Response => json({ contextId: CTX, identity: value })
const membersPayload = (members: unknown[]): Response => json({ contextId: CTX, members })

const ALICE = {
  user_id: 'u1',
  added_by: 'admin',
  added_at: '2026-05-01T00:00:00Z',
  user_label: 'Alice (@alice)',
  added_by_label: 'Admin',
}
const BOB = { user_id: 'u2', added_by: 'u1', added_at: '2026-05-02T00:00:00Z', user_label: null, added_by_label: null }

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(CodingIdentitySection, { target, props: { contextId: CTX } }) }
}

const submitForm = (target: HTMLElement): void => {
  target
    .querySelector<HTMLFormElement>('form.settings-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** Route reads by URL and writes by method; identity read uses the given sequence of responses. */
const route = (opts: {
  identitySeq?: Response[]
  identity?: Response
  members?: Response
  patch?: Response | 'never'
}): ((url: string, init: RequestInit) => Promise<Response>) => {
  let identityCall = 0
  return (url, init) => {
    if ((init.method ?? 'GET').toUpperCase() === 'PATCH') {
      if (opts.patch === 'never') return new Promise<Response>(() => {})
      return Promise.resolve(opts.patch ?? json({}))
    }
    if (url.includes('/coding-identity')) {
      if (opts.identitySeq) return Promise.resolve(opts.identitySeq[identityCall++] ?? opts.identitySeq.at(-1)!)
      return Promise.resolve(opts.identity ?? identity('shared'))
    }
    if (url.includes('/members')) return Promise.resolve(opts.members ?? membersPayload([ALICE]))
    return Promise.resolve(json({}, 404))
  }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('CodingIdentitySection', () => {
  test('shows a Loading placeholder and no policy select while state is unknown', () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('.placeholder')?.textContent).toContain('Loading…')
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).toBeNull()
    void unmount(component)
  })

  test('renders the policy control via the shared Select once loaded', async () => {
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE, BOB]) }))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    expect(target.querySelector('.ui-select')).not.toBeNull()
    expect(target.querySelector('.settings-section__caption')).not.toBeNull()
    void unmount(component)
  })

  test('lists members by label, not raw id, under the Designated policy', async () => {
    setMockFetch(route({ identity: identity('designated:u1'), members: membersPayload([ALICE, BOB]) }))
    const { target, component } = render()
    await drain()
    const memberSelect = target.querySelector('[data-testid="coding-identity-member"]')
    expect(memberSelect).not.toBeNull()
    const optionText = Array.from(memberSelect!.querySelectorAll('option')).map((o) => o.textContent)
    expect(optionText).toContain('Alice (@alice)')
    expect(optionText).not.toContain('u1')
    void unmount(component)
  })

  test('disables Save and shows a hint when Designated has no member', async () => {
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([]) }))
    const { target, component } = render()
    await drain()
    const policy = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')!
    policy.value = 'designated'
    policy.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-identity-save"]')!
    expect(save.disabled).toBe(true)
    expect(target.querySelector('.ui-field__error')?.textContent).toContain('Add a group member')
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry and no form', async () => {
    setMockFetch(route({ identitySeq: [json({ error: 'boom' }, 500), identity('shared')] }))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).toBeNull()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!
    expect(retry).not.toBeNull()
    retry.click()
    await drain()
    expect(target.querySelector('.ui-error')).toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows a success message after a successful Save', async () => {
    setCsrfToken('t')
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE]) }))
    const { target, component } = render()
    await drain()
    submitForm(target)
    await drain()
    expect(target.querySelector('.status-success')?.textContent).toContain('Saved.')
    void unmount(component)
  })

  test('shows a busy Save label and aria-busy while saving', async () => {
    setCsrfToken('t')
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE]), patch: 'never' }))
    const { target, component } = render()
    await drain()
    submitForm(target)
    flushSync()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-identity-save"]')!
    expect(save.textContent).toContain('Saving…')
    expect(save.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('a failed Save shows an inline alert and keeps the form', async () => {
    setCsrfToken('t')
    setMockFetch(
      route({ identity: identity('shared'), members: membersPayload([ALICE]), patch: json({ error: 'nope' }, 500) }),
    )
    const { target, component } = render()
    await drain()
    submitForm(target)
    await drain()
    const alert = target.querySelector('[data-testid="coding-identity-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('role')).toBe('alert')
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: FAIL. The current component renders no `.placeholder` while loading, uses a raw
`<select>` (no `.ui-select`), shows raw ids, renders no `.ui-error`/`error-retry`, has a
static "Save" label, and no `.status-success` — so most or all of the 8 tests fail.

Do **not** commit yet — the component is implemented in Task 2 and both are committed together.

---

## Task 2: Rewrite the component (green)

**Files:**

- Modify: `client/settings/sections/CodingIdentitySection.svelte` (full replacement)
- Test: `tests/client/settings/sections/CodingIdentitySection.test.ts`

- [ ] **Step 1: Replace the component with the new implementation**

Overwrite `client/settings/sections/CodingIdentitySection.svelte` with exactly:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import { formatFetchError } from '../../shared/format-error.js'
  import type { GroupMembersResponse } from '../fetcher-schemas.js'
  import { fetchGroupCodingIdentity, fetchGroupMembers, patchGroupCodingIdentity } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  type PolicyKind = 'initiator' | 'shared' | 'designated'
  type Member = GroupMembersResponse['members'][number]

  const POLICY_OPTIONS = [
    { value: 'initiator', label: "Initiator — each user's own credentials" },
    { value: 'shared', label: 'Shared — group vault credentials' },
    { value: 'designated', label: "Designated — a specific member's credentials" },
  ]

  /** Parse the raw identity string into a policy kind + optional designated userId. */
  function parseIdentity(identity: string): { kind: PolicyKind; designatedUserId: string } {
    if (identity.startsWith('designated:')) {
      return { kind: 'designated', designatedUserId: identity.slice('designated:'.length) }
    }
    if (identity === 'shared') return { kind: 'shared', designatedUserId: '' }
    return { kind: 'initiator', designatedUserId: '' }
  }

  let policyKind = $state<PolicyKind>('initiator')
  let designatedUserId = $state('')
  let members = $state<Member[]>([])
  let loading = $state(false)
  let saving = $state(false)
  let loaded = $state(false)
  let loadError: unknown = $state(null)
  let saveError: unknown = $state(null)
  let status: string | null = $state(null)

  const memberOptions = $derived(members.map((m) => ({ value: m.user_id, label: m.user_label ?? m.user_id })))
  const designatedEmpty = $derived(policyKind === 'designated' && designatedUserId === '')

  async function load(id: string): Promise<void> {
    loadError = null
    loading = true
    try {
      const [identityResult, membersResult] = await Promise.all([fetchGroupCodingIdentity(id), fetchGroupMembers(id)])
      const parsed = parseIdentity(identityResult.identity)
      policyKind = parsed.kind
      designatedUserId = parsed.designatedUserId || (membersResult.members[0]?.user_id ?? '')
      members = membersResult.members
      loaded = true
    } catch (err) {
      loadError = err
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    saveError = null
    status = null
    if (designatedEmpty) return
    saving = true
    try {
      const identity = policyKind === 'designated' ? `designated:${designatedUserId}` : policyKind
      await patchGroupCodingIdentity({ contextId, identity })
      await load(contextId)
      status = 'Saved.'
    } catch (err) {
      saveError = err
    } finally {
      saving = false
    }
  }

  function onPolicyChange(value: string): void {
    policyKind = value as PolicyKind
    status = null
    saveError = null
    designatedUserId = policyKind === 'designated' ? (members[0]?.user_id ?? '') : ''
  }

  function onMemberChange(value: string): void {
    designatedUserId = value
    status = null
    saveError = null
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="coding-identity" class="settings-section">
  <PageHeader eyebrow="Group" title="Coding session identity" />

  {#if loadError !== null}
    <ErrorState message={formatFetchError(loadError)} onRetry={() => void load(contextId)} />
  {:else if loading && !loaded}
    <p class="placeholder">Loading…</p>
  {:else}
    {#if status !== null}<p class="status-success">{status}</p>{/if}
    {#if saveError !== null}
      <p class="status-error" role="alert" data-testid="coding-identity-error">{formatFetchError(saveError)}</p>
    {/if}

    <form class="settings-form" onsubmit={(event) => { event.preventDefault(); void save() }}>
      <Field label="Policy">
        <Select value={policyKind} options={POLICY_OPTIONS} onChange={onPolicyChange} testid="coding-identity-policy" />
      </Field>

      {#if policyKind === 'designated'}
        <Field label="Member" error={designatedEmpty ? 'Add a group member to use the Designated policy.' : undefined}>
          <Select value={designatedUserId} options={memberOptions} onChange={onMemberChange} testid="coding-identity-member" />
        </Field>
      {/if}

      <Btn variant="primary" type="submit" disabled={saving || designatedEmpty} busy={saving} testid="coding-identity-save">
        {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
      </Btn>
    </form>

    <p class="settings-section__caption">
      Controls whose coding credentials (AI provider key, code host token, agent) are used for sessions started in this
      group. <strong>Initiator</strong> (default): the user who runs
      <code>/acp start</code> must have their own credentials configured. <strong>Shared</strong>: the group vault is
      used for everyone. <strong>Designated</strong>: a specific member's credentials are always used.
    </p>
  {/if}
</section>

<style>
  .settings-section__caption {
    margin: 0;
    font-size: 12px;
    color: var(--fg3);
    line-height: 1.45;
  }
</style>
```

- [ ] **Step 2: Run the component tests to verify they pass**

Run: `bun test tests/client/settings/sections/CodingIdentitySection.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (Watch for the `Member`/`GroupMembersResponse` import and that
`Select`'s `options`/`onChange` types line up — both mirror `GroupProviderSection`.)

- [ ] **Step 4: Format**

Run: `bun run format`
Expected: files reformatted in place, exit 0.

- [ ] **Step 5: Commit the test + component together**

```bash
git add client/settings/sections/CodingIdentitySection.svelte tests/client/settings/sections/CodingIdentitySection.test.ts
git commit -m "fix(settings): align CodingIdentitySection with sibling pattern

Rewrite to the GroupProviderSection pattern: loadError/loading/loaded
render gate (ErrorState + retry, Loading placeholder), shared Field +
Select primitives, formatFetchError, busy Save label, status-success,
and a member-label dropdown that no longer exposes raw user ids. Disable
Save with an inline hint when Designated has no member. Resolves all 8
CodingIdentitySection UX-review findings.

Ref: docs/ux-reviews/CodingIdentitySection.md"
```

Expected: pre-commit `check` runs lint + typecheck + format:check + license-headers, all pass.

---

## Task 3: Fix the Populated fixture and refresh visual baselines

The Populated story currently loads `identity: 'alice'`, which silently parses to
"Initiator" and never exercises the member dropdown. Point it at a valid designated value so
the Populated screenshot shows the member label list.

**Files:**

- Modify: `client/stories/msw/settings-handlers-group.ts` (the `codingIdentityPopulated` object)
- Modify: `tests/visual/settings/sections/CodingIdentitySection.spec.ts` (already has the review's manual states; commit it)

- [ ] **Step 1: Point the Populated fixture at a real designated identity**

In `client/stories/msw/settings-handlers-group.ts`, change the `codingIdentityPopulated`
object (around line 114) from:

```typescript
const codingIdentityPopulated = {
  contextId: 'ctx-group-1',
  identity: 'alice',
}
```

to:

```typescript
const codingIdentityPopulated = {
  contextId: 'ctx-group-1',
  identity: 'designated:u1',
}
```

(`groupMembersPopulated` already includes `u1` with `user_label: 'Alice (@alice)'`, so the
Populated story now renders the Member dropdown showing the label.)

- [ ] **Step 2: Re-shoot the section's stories and states**

Run: `bun shoot -g CodingIdentitySection`
Expected: 8 shots pass and baselines are (re)written under
`.storybook-shots/settings/sections/CodingIdentitySection.spec.ts/` (baselines are
gitignored; this step just refreshes them for visual confirmation).

- [ ] **Step 3: Read the refreshed PNGs and confirm each finding visually**

Read these with the Read tool and confirm:

- `settings-sections-CodingIdentitySection-Populated-1.png` — Policy = "Designated", a
  Member dropdown shows **Alice (@alice)** (not `u1`). (High-2)
- `settings-sections-CodingIdentitySection-Error-1.png` — a centered `ErrorState` panel with
  a "Try again" button, and **no** policy select / Save. (High-1, Med-1, Low-1)
- `settings-sections-CodingIdentitySection-Loading-1.png` — a plain "Loading…" placeholder,
  not a defaulted form. (Med-1)
- `CodingIdentity-—-policy-select-focused-1.png` — a **green** focus ring on the select
  (from the shared `Select`), not the blue UA outline. (Med-2, Low-2)

If any differ, revisit Task 2 before continuing.

- [ ] **Step 4: Commit the fixture + visual spec**

```bash
git add client/stories/msw/settings-handlers-group.ts tests/visual/settings/sections/CodingIdentitySection.spec.ts
git commit -m "test(settings): realistic CodingIdentity Populated fixture + visual states

Point the Populated MSW fixture at 'designated:u1' so the story exercises
the member dropdown, and commit the interaction/narrow-viewport visual
states added during the UX review."
```

Expected: pre-commit `check` passes (fixture + spec are lint/format/license clean).

---

## Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full settings section test suite**

Run: `bun test tests/client/settings/sections/`
Expected: PASS, including the new `CodingIdentitySection.test.ts` and the untouched sibling
tests (e.g. `ReleaseSubscriptionSection`, `ProfileSection`).

- [ ] **Step 2: Typecheck the whole project**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the working tree is clean**

Run: `git status --short`
Expected: empty (all changes committed across Tasks 2 and 3). The gitignored
`.storybook-shots/` baselines will not appear.

---

## Notes / out of scope (do not implement here)

- Hardening `parseIdentity` against arbitrary unknown identity strings (data concern).
- Any backend / schema / fetcher change.
- The other coding sections that share the raw-`<select>` pattern (`ReposSection`,
  `CodeHostSection`, `CodingCredentialsSection`, `admin/AdminCodingGuardrailsSection`) — a
  separate consistency sweep.
- Adding a header `Refresh` IconButton (optional future consistency add; `ErrorState`'s
  retry already covers the failure path).
