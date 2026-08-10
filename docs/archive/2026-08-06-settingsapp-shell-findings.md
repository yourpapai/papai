<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# SettingsApp Shell Findings Close-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 14 open findings in `docs/ux-reviews/SettingsApp.md` against the settings shell.

**Architecture:** Two structural moves carry the work. (1) The navigation model moves out of `SettingsApp.svelte` into `client/settings/nav.svelte.ts`, replacing four hardcoded singletons with one group model that makes Admin collapsible for free. (2) The scroll boundary moves from `Shell`'s body into the settings grid, so the sidebar and the main column each scroll inside a contained full-height layout instead of a sticky `100vh` box overshooting its scrollport. Everything else — the `failed` session status, the shared gate component, the `Select` group support, the 900px breakpoint, the focus-ring token — attaches to those two.

**Tech Stack:** Bun, Svelte 5 (runes: `$props`, `$state`, `$derived`, `$effect`, `untrack`; snippets), strict TypeScript, Zod v4, `bun:test` + happy-dom for unit tests, Storybook + `@crvy/strybk` + Playwright for visual states.

**Spec:** `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md`

## Global Constraints

- Runtime **Bun**; **Svelte 5 runes**; strict TypeScript; **use the `.js` extension in all import paths** (even for `.ts` sources).
- Formatter is **oxfmt**, run via `bun run format`. Not prettier. Never run `prettier`.
- **Never add lint-disable or type-ignore comments** — a repo hook blocks them. Fix the underlying issue.
- A `max-lines` / `max-lines-per-function` lint failure is a **design signal**: split the file or extract a function. Never delete blank lines or compress formatting to get under the limit.
- **Never log the settings auth code, the CSRF token, or session cookies.** The code retained in `session.svelte.ts` module scope must never reach a `console.*` or logger call.
- Never pass `--no-verify` to `git commit`. The pre-commit hook runs lint, typecheck, format:check, and license-headers on staged files; all four must pass.
- New files need the BUSL-1.1 header. Run `bun license:headers` to stamp; `.ts` uses `//` comments, `.svelte` uses `<!-- -->`, `.css` uses `/* */`, `.md` uses an HTML comment block.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- **Client tests must be run with the browser condition and the client preload:**
  `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`.
  A bare `bun test tests/client/...` matches nothing and **reports success without executing**. `bun run test:client` hardcodes `tests/client/` (`package.json:49`), so an appended path narrows rather than replaces it.
- `bun shoot` rewrites **every** baseline in the repo. Always scope it: `bun shoot -g SettingsApp`. It requires Storybook running (`bun storybook`) and `bunx playwright install chromium` done once.
- `bun run shoot:gen` regenerates the `@generated-begin auto-screenshots` … `@generated-end auto-screenshots` region of visual specs from the story files. **Never hand-edit inside that region.** Manual states go below `@generated-end`.
- `docs/ux-reviews/_BACKLOG.md` is generated — **never hand-edit**. Regenerate with `bun run ux:backlog`.
- Findings in `docs/ux-reviews/SettingsApp.md` carry `**Id:**` and `**Status:**` as their first two bullets. Ids are never reused and never renamed. Status is one of `open | fixed | superseded | wont-fix | deferred`; anything other than `open` requires a `- **Resolved:**` line. **There is no `partial` status.**
- `Shell.svelte` and `Select.svelte` are shared primitives consumed by DebugApp and every settings section. **Every change to them must be backward-compatible with existing call sites**, and each task that touches them re-runs the existing test file to prove it.
- Mutation testing is a blocking per-file ratchet in CI. After a task that adds or substantially changes a file, run `bun test:mutate:file <path>` and make assertions real (assert values, not existence) rather than chasing the score.

---

## File Structure

**Create**

| Path                                                    | Responsibility                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `client/settings/nav.svelte.ts`                         | Nav group model, collapse state, deep-link expansion, mounted-id + hint derivation |
| `client/settings/components/SettingsGate.svelte`        | The three non-`ready` session screens (loading / unauthenticated / failed)        |
| `client/settings/components/SettingsGroupToggle.svelte` | Shared inline disclosure button for Advanced and Admin                            |
| `tests/client/settings/nav.test.ts`                     | Unit tests for the nav model                                                      |
| `tests/client/settings/components/SettingsGate.test.ts` | Unit tests for the gate component                                                 |
| `tests/client/settings/components/SettingsGroupToggle.test.ts` | Unit tests for the toggle                                                    |

**Modify**

| Path                                                        | Change                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `client/settings/session.svelte.ts`                         | `failed` status, 401 branch, `failureMessage`, `retryBootstrap`             |
| `client/settings/index.ts`                                  | Mount before bootstrap                                                     |
| `client/settings/SettingsApp.svelte`                        | Consume nav model + gate + toggle; gate admin mounts; drop history rewrite  |
| `client/settings/scrollspy.ts`                              | `root` parameter                                                           |
| `client/settings/settings.css`                              | Contained-height layout, 900px breakpoint, focus-ring token + scope         |
| `client/settings/components/SettingsSidebar.svelte`         | Drop sticky box, `key` on the group, spacing tokens, 900px                  |
| `client/settings/components/SettingsJumpMenu.svelte`        | Shared `Select`, honour collapse, 900px                                     |
| `client/shared/ui/Shell.svelte`                             | `bodyScroll` prop                                                          |
| `client/shared/ui/Select.svelte`                            | `groups`, `block`, focus-ring token                                        |
| `client/settings/sections/admin/AdminAnalyticsSection.svelte` | Title → "Analytics policy"                                               |
| `client/settings/sections/admin/AdminByokSection.svelte`    | Title → "BYOK keys"                                                        |
| `client/stories/decorators/withFixtures.ts`                 | `settingsGate` fixture mode, nav-collapse reset                            |
| `client/settings/SettingsApp.stories.svelte`                | Unauthenticated + Failed stories                                           |
| `tests/visual/settings/SettingsApp.spec.ts`                 | Regenerated + updated manual states                                        |
| `tests/client/settings/session.svelte.test.ts`              | `failed` mapping + retry coverage                                          |
| `tests/client/settings/SettingsApp.test.ts`                 | Admin-collapsed expectations, gate copy                                    |
| `tests/client/settings/index.test.ts`                       | Mount-before-bootstrap ordering                                            |
| `tests/client/settings/scrollspy.test.ts`                   | `root` forwarding                                                          |
| `tests/client/settings/settings-css.test.ts`                | Focus-ring token, 900px, contained scroll                                  |
| `tests/client/shared/ui/Select.test.ts`                     | Group + block coverage, flat-caller regression                             |
| `tests/client/settings/components/SettingsJumpMenu.test.ts` | Collapse-aware options                                                     |
| `docs/ux-reviews/SettingsApp.md`                            | Statuses, corrections, new deferred finding                                |
| `docs/ux-reviews/_BACKLOG.md`                               | Regenerated                                                                |

---

### Task 1: Session `failed` status and retry

Closes `settings-app-unauthenticated-dead-end` (High). Today `bootstrapSession` swallows every failure into `unauthenticated`, so a 503 or a dropped connection is reported to the user as an expired link on a screen with no action. The server makes the distinction unambiguous: `src/debug/settings-routes.ts:102` returns 401 for an invalid or expired code, `:125` returns 401 for an unauthenticated bootstrap, `:83` returns 429 when rate-limited. `FetchError` already carries `status`.

**Files:**

- Modify: `client/settings/session.svelte.ts`
- Test: `tests/client/settings/session.svelte.test.ts`

**Interfaces:**

- Consumes: `FetchError` from `client/shared/fetcher-helpers.ts` — `class FetchError extends Error { readonly status: number; readonly field: string | undefined }`.
- Produces:
  - `settingsSession.status: 'loading' | 'ready' | 'unauthenticated' | 'failed'`
  - `settingsSession.failureMessage: string` (empty unless `status === 'failed'`)
  - `export async function retryBootstrap(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('session store', …)` block in `tests/client/settings/session.svelte.test.ts`, after the `'a failed exchange (non-empty code + 401) marks the session unauthenticated'` test:

```typescript
  test('a 500 marks the session failed and keeps the server message', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'database unavailable' }, 500)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('failed')
    expect(settingsSession.failureMessage).toBe('database unavailable')
  })

  test('a 429 marks the session failed, not unauthenticated', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'too many requests' }, 429)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('failed')
  })

  test('a transport error marks the session failed', async () => {
    setMockFetch(() => Promise.reject(new Error('network down')))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('failed')
    expect(settingsSession.failureMessage).toBe('network down')
  })

  test('a 200 with an unparseable body marks the session failed', async () => {
    setMockFetch(() => Promise.resolve(json({ nonsense: true })))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('failed')
  })

  test('a 401 clears any previous failure message', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'boom' }, 500)))
    await bootstrapSession(null)
    expect(settingsSession.failureMessage).toBe('boom')
    setMockFetch(() => Promise.resolve(json({ error: 'unauthenticated' }, 401)))
    await bootstrapSession(null)
    expect(settingsSession.status).toBe('unauthenticated')
    expect(settingsSession.failureMessage).toBe('')
  })

  test('retryBootstrap replays the same code and can reach ready', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'gateway timeout' }, 504)))
    await bootstrapSession('CODE')
    expect(settingsSession.status).toBe('failed')

    const calledUrls: string[] = []
    setMockFetch((url) => {
      calledUrls.push(url)
      return Promise.resolve(json(bootstrapPayload))
    })
    await retryBootstrap()
    expect(calledUrls.some((u) => u.includes('/settings/auth/exchange'))).toBe(true)
    expect(settingsSession.status).toBe('ready')
    expect(settingsSession.failureMessage).toBe('')
  })

  test('retryBootstrap after a codeless bootstrap replays the bootstrap endpoint', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'boom' }, 500)))
    await bootstrapSession(null)

    const calledUrls: string[] = []
    setMockFetch((url) => {
      calledUrls.push(url)
      return Promise.resolve(json(bootstrapPayload))
    })
    await retryBootstrap()
    expect(calledUrls.some((u) => u.includes('/settings/api/bootstrap'))).toBe(true)
    expect(settingsSession.status).toBe('ready')
  })
```

Add `retryBootstrap` to the existing import from `session.svelte.js` (the list becomes `activeContext, bootstrapSession, registerExpiryHandler, retryBootstrap, setActiveContext, settingsSession`), and add one line to the existing `afterEach` so the message never leaks between tests:

```typescript
  settingsSession.failureMessage = ''
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/session.svelte.test.ts
```

Expected: FAIL. TypeScript/runtime error on the missing `retryBootstrap` export, and the status assertions report `"unauthenticated"` where `"failed"` is expected.

- [ ] **Step 3: Implement the status split**

In `client/settings/session.svelte.ts`, add the `FetchError` import next to the existing imports:

```typescript
import { FetchError } from '../shared/fetcher-helpers.js'
```

Change the `Status` type and the state object (lines 9-18) to:

```typescript
type Status = 'loading' | 'ready' | 'unauthenticated' | 'failed'

export const settingsSession = $state({
  status: 'loading' as Status,
  /** Non-empty only while status is 'failed': what stopped the bootstrap. */
  failureMessage: '',
  display: '',
  isBotAdmin: false,
  isSuperAdmin: false,
  contexts: [] as AvailableContext[],
  activeContextId: '',
})
```

Add one line to `applyBootstrap`, just above `settingsSession.status = 'ready'`:

```typescript
  settingsSession.failureMessage = ''
```

Replace `bootstrapSession` (lines 41-48) with:

```typescript
/**
 * The code from the settings link, retained so retryBootstrap() can replay an
 * exchange whose transport failed — the server never consumed it, and index.ts
 * has already stripped it from the URL. Never logged.
 */
let lastCode: string | null = null

export async function bootstrapSession(code: string | null): Promise<void> {
  lastCode = code
  try {
    const data = code !== null && code.length > 0 ? await exchangeCode(code) : await fetchBootstrap()
    applyBootstrap(data)
  } catch (error) {
    // 401 is the server's only "this session cannot be recovered" answer: an invalid or
    // expired code, or a bootstrap with no cookie. Everything else -- 5xx, 429, a dropped
    // connection, a body that fails the schema -- is transient enough that a retry can win.
    if (error instanceof FetchError && error.status === 401) {
      settingsSession.failureMessage = ''
      settingsSession.status = 'unauthenticated'
      return
    }
    settingsSession.failureMessage = error instanceof Error ? error.message : String(error)
    settingsSession.status = 'failed'
  }
}

export async function retryBootstrap(): Promise<void> {
  settingsSession.status = 'loading'
  settingsSession.failureMessage = ''
  await bootstrapSession(lastCode)
}
```

Add the same message reset to `registerExpiryHandler`'s callback:

```typescript
  onUnauthorized(() => {
    settingsSession.failureMessage = ''
    settingsSession.status = 'unauthenticated'
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/session.svelte.test.ts
```

Expected: PASS, all tests in the file (7 pre-existing + 7 new).

- [ ] **Step 5: Confirm nothing else read the old two-state assumption**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/index.test.ts tests/client/settings/SettingsApp.test.ts
```

Expected: PASS. Both suites only exercise 401 paths, which still land on `unauthenticated`.

- [ ] **Step 6: Format, lint, and commit**

```bash
bun run format
git add client/settings/session.svelte.ts tests/client/settings/session.svelte.test.ts
git commit -m "feat(settings): split bootstrap failure into unauthenticated and failed"
```

---

### Task 2: Mount before bootstrap, and a real gate component

Closes `settings-app-loading-gate-unannounced` (Med) and delivers the screen Task 1's `failed` status needs. `index.ts:26-32` awaits `bootstrapSession` **before** `mount()`, so the component's `loading` branch is unreachable in production — what a real user sees during bootstrap is `settings.html`'s empty `<div id="app"></div>`, a blank page with no text at all. Mounting first makes the branch real; a shared gate component gives all three non-`ready` states brand chrome and announces the wait.

**Files:**

- Create: `client/settings/components/SettingsGate.svelte`
- Create: `tests/client/settings/components/SettingsGate.test.ts`
- Modify: `client/settings/index.ts:26-32`
- Modify: `client/settings/SettingsApp.svelte:201-208` (gate branches), imports
- Modify: `client/settings/settings.css:122-129` (`.settings-gate`)
- Test: `tests/client/settings/index.test.ts`, `tests/client/settings/SettingsApp.test.ts`

**Interfaces:**

- Consumes: `settingsSession.status`, `settingsSession.failureMessage`, `retryBootstrap()` from Task 1. `Btn` from `client/shared/ui/Btn.svelte` — props `{ children: Snippet; variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; onClick?: () => void; busy?: boolean; testid?: string }`.
- Produces: `SettingsGate.svelte`, a no-prop component rendering whichever non-`ready` state is current. `SettingsApp` renders it for every `status !== 'ready'`.

- [ ] **Step 1: Write the failing gate tests**

Create `tests/client/settings/components/SettingsGate.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsGate from '../../../../client/settings/components/SettingsGate.svelte'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const mountGate = (): ReturnType<typeof mount> => {
  document.body.innerHTML = '<div id="root"></div>'
  return mount(SettingsGate, { target: document.querySelector<HTMLElement>('#root')! })
}

afterEach(() => {
  restoreFetch()
  settingsSession.status = 'loading'
  settingsSession.failureMessage = ''
  document.body.innerHTML = ''
})

describe('SettingsGate', () => {
  test('announces the loading wait to assistive tech', () => {
    settingsSession.status = 'loading'
    const c = mountGate()
    flushSync()
    const status = document.querySelector('[data-testid="gate-loading"]')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Loading')
    void unmount(c)
  })

  test('unauthenticated points at /config and offers no retry', () => {
    settingsSession.status = 'unauthenticated'
    const c = mountGate()
    flushSync()
    expect(document.body.textContent).toContain('/config')
    expect(document.querySelector('[data-testid="gate-retry"]')).toBeNull()
    void unmount(c)
  })

  test('failed shows the reason and a retry action', () => {
    settingsSession.status = 'failed'
    settingsSession.failureMessage = 'database unavailable'
    const c = mountGate()
    flushSync()
    expect(document.body.textContent).toContain('database unavailable')
    expect(document.querySelector('[data-testid="gate-retry"]')).not.toBeNull()
    void unmount(c)
  })

  test('retry re-runs the bootstrap and reaches ready', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            csrfToken: 't',
            display: 'a',
            principal: { isBotAdmin: false, isSuperAdmin: false },
            contexts: [{ kind: 'personal', contextId: 'user:1', label: 'Personal' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    settingsSession.status = 'failed'
    settingsSession.failureMessage = 'boom'
    const c = mountGate()
    flushSync()
    document.querySelector<HTMLButtonElement>('[data-testid="gate-retry"]')!.click()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    flushSync()
    expect(settingsSession.status).toBe('ready')
    void unmount(c)
  })

  test('every gate state carries the brand chrome', () => {
    for (const status of ['loading', 'unauthenticated', 'failed'] as const) {
      settingsSession.status = status
      const c = mountGate()
      flushSync()
      expect(document.querySelector('.settings-gate__brand')).not.toBeNull()
      void unmount(c)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsGate.test.ts
```

Expected: FAIL — module not found, `client/settings/components/SettingsGate.svelte`.

- [ ] **Step 3: Create the gate component**

Create `client/settings/components/SettingsGate.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import { retryBootstrap, settingsSession } from '../session.svelte.js'

  let retrying = $state(false)

  async function retry(): Promise<void> {
    retrying = true
    await retryBootstrap()
    retrying = false
  }
</script>

<main class="settings-gate">
  <p class="t-kicker settings-gate__brand">papai · settings</p>
  {#if settingsSession.status === 'loading'}
    <p role="status" data-testid="gate-loading">Loading your settings…</p>
  {:else if settingsSession.status === 'unauthenticated'}
    <h1 class="t-section">Session expired or missing</h1>
    <p>Request a new settings link by sending <code>/config</code> to the bot.</p>
  {:else}
    <h1 class="t-section">Could not load your settings</h1>
    <p class="status-error" data-testid="gate-reason">{settingsSession.failureMessage}</p>
    <p>The link is still valid — this was a problem reaching the server.</p>
    <Btn variant="primary" busy={retrying} testid="gate-retry" onClick={() => void retry()}>
      {#snippet children()}{retrying ? 'Retrying…' : 'Try again'}{/snippet}
    </Btn>
  {/if}
</main>

<style>
  .settings-gate__brand {
    margin: 0 0 var(--gap-inline);
  }
</style>
```

- [ ] **Step 4: Run to verify the gate tests pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsGate.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Update the SettingsApp gate expectation, then swap in the component**

`tests/client/settings/SettingsApp.test.ts` currently asserts the literal string `'Loading…'`. Change that one assertion in the `'renders the loading gate when status is loading'` test to:

```typescript
    expect(document.body.textContent).toContain('Loading your settings')
```

Then in `client/settings/SettingsApp.svelte`, add the import beside the other component imports:

```typescript
  import SettingsGate from './components/SettingsGate.svelte'
```

and replace the three gate lines (`{#if settingsSession.status === 'loading'}` through `{:else}`, lines 201-208) with:

```svelte
{#if settingsSession.status !== 'ready'}
  <SettingsGate />
{:else}
```

- [ ] **Step 6: Write the failing mount-order test**

Add this test to `tests/client/settings/index.test.ts`, inside `describe('settings entry', …)`:

```typescript
  test('start mounts before bootstrap resolves, so the wait is never a blank page', async () => {
    let releaseBootstrap = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve
    })
    setMockFetch(async (url) => {
      await gate
      return json(bootstrapPayload, url.includes('/settings') ? 200 : 200)
    })
    history.replaceState(null, '', '/settings')
    document.body.innerHTML = '<div id="app"></div>'
    const target = document.querySelector<HTMLElement>('#app')!
    const started = start(target)
    await drain()
    // Bootstrap has not resolved yet: the component is mounted and showing the gate.
    expect(document.body.textContent).toContain('Loading your settings')
    releaseBootstrap()
    await started
    await drain()
    expect(settingsSession.status).toBe('ready')
    expect(document.querySelector('#profile')).not.toBeNull()
  })
```

- [ ] **Step 7: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/index.test.ts
```

Expected: FAIL on `expect(document.body.textContent).toContain('Loading your settings')` — the body is empty, because nothing has mounted yet.

- [ ] **Step 8: Reorder `start`**

In `client/settings/index.ts`, replace `start` (lines 26-32) with:

```typescript
export async function start(target: Element): Promise<void> {
  registerExpiryHandler()
  // Mount first: bootstrap is a network round trip, and until the component exists
  // the page is settings.html's empty <div id="app"> -- a blank screen with no text.
  // Mounting first puts the loading gate on screen for the whole wait.
  mount(SettingsApp, { target })
  const code = readCodeFromLocation(window.location.search)
  await bootstrapSession(code)
  if (code !== null) stripCodeFromUrl()
}
```

- [ ] **Step 9: Run the three affected suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/index.test.ts tests/client/settings/SettingsApp.test.ts tests/client/settings/components/SettingsGate.test.ts
```

Expected: PASS in all three.

- [ ] **Step 10: Format and commit**

```bash
bun run format
git add client/settings/components/SettingsGate.svelte client/settings/index.ts client/settings/SettingsApp.svelte tests/client/settings/components/SettingsGate.test.ts tests/client/settings/index.test.ts tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings): mount before bootstrap and render a real session gate"
```

---

### Task 3: `Select` gains optional groups and a block size

Closes half of `settings-app-jump-menu-bare-select` (Med). The jump menu is a bare `<select>` with none of the shared control's chrome, but `Select` as it stands takes a flat `Option[]`, is `display: inline-flex` at `font-size: 12px`, and hardcodes the focus ring. Adding an opt-in group shape and a full-width size lets the jump menu adopt it in Task 4 without flattening the nav structure or shrinking to a 12px inline pill.

**Files:**

- Modify: `client/shared/ui/Select.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`

**Interfaces:**

- Produces:
  - `interface Option { value: string; label: string }` (unchanged)
  - `interface OptionGroup { label: string; options: Option[] }`
  - `Select` props gain `groups?: OptionGroup[]` and `block?: boolean`. `options` becomes `options?: Option[]`. `options` and `groups` are mutually exclusive; when `groups` is absent, rendering is byte-identical to today.
  - `block` renders the wrapper `display: flex; width: 100%; height: var(--row-h); font-size: 14px`.
- Constraint: `tests/client/shared/control-target-size.test.ts` fails any shared primitive that hardcodes a `height: <n>px`. The block height **must** come from a token (`var(--row-h)`), never a literal.

- [ ] **Step 1: Write the failing tests**

Add these to `tests/client/shared/ui/Select.test.ts`, inside `describe('Select.svelte', …)`:

```typescript
  test('renders an optgroup per group with its options nested', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: {
        value: 'tools',
        groups: [
          {
            label: 'Personal',
            options: [
              { value: 'profile', label: 'Profile' },
              { value: 'tools', label: 'Tools' },
            ],
          },
          { label: 'Admin', options: [{ value: 'users', label: 'Users' }] },
        ],
      },
    })
    const optgroups = target.querySelectorAll('optgroup')
    expect(optgroups.length).toBe(2)
    expect(optgroups[0]!.getAttribute('label')).toBe('Personal')
    expect(optgroups[0]!.querySelectorAll('option').length).toBe(2)
    expect(optgroups[1]!.getAttribute('label')).toBe('Admin')
    expect(target.querySelector<HTMLSelectElement>('select')!.value).toBe('tools')
    void unmount(component)
  })

  test('a grouped select emits onChange with the picked value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let picked = ''
    const component = mount(Select, {
      target,
      props: {
        value: 'profile',
        groups: [{ label: 'Personal', options: [{ value: 'profile', label: 'Profile' }, { value: 'tools', label: 'Tools' }] }],
        onChange: (v: string) => {
          picked = v
        },
      },
    })
    const sel = target.querySelector<HTMLSelectElement>('select')!
    sel.value = 'tools'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(picked).toBe('tools')
    void unmount(component)
  })

  test('block adds the full-width modifier class', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: { value: 'a', options: [{ value: 'a', label: 'A' }], block: true },
    })
    expect(target.querySelector('.ui-select--block')).not.toBeNull()
    void unmount(component)
  })

  test('a flat select carries no optgroup and no block modifier', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: { value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    })
    expect(target.querySelectorAll('optgroup').length).toBe(0)
    expect(target.querySelector('.ui-select--block')).toBeNull()
    expect(target.querySelectorAll('option').length).toBe(2)
    void unmount(component)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts
```

Expected: FAIL — `optgroups.length` is 0 and `.ui-select--block` is null; the grouped mounts render an empty select because `options` is undefined.

- [ ] **Step 3: Implement groups and block**

In `client/shared/ui/Select.svelte`, replace the `<script>` interface block and destructure (lines 9-23) with:

```typescript
  interface Option {
    value: string
    label: string
  }

  /** An <optgroup>: a labelled cluster of options. Mutually exclusive with `options`. */
  interface OptionGroup {
    label: string
    options: Option[]
  }

  interface Props {
    value: string
    options?: Option[]
    groups?: OptionGroup[]
    onChange?: (value: string) => void
    testid?: string
    disabled?: boolean
    placeholder?: string
    /** Full-width control at row height, for a select that owns its line. */
    block?: boolean
  }

  let { value, options, groups, onChange, testid, disabled = false, placeholder, block = false }: Props = $props()
```

Replace the wrapper `<div>` opening tag (line 33) with:

```svelte
<div
  class="ui-select"
  class:ui-select--block={block}
  class:ui-select--disabled={disabled}
  class:ui-select--invalid={fieldError.invalid}>
```

Replace the option-rendering block (lines 43-48) with:

```svelte
    {#if placeholder}
      <option value="" disabled>{placeholder}</option>
    {/if}
    {#if groups !== undefined}
      {#each groups as group (group.label)}
        <optgroup label={group.label}>
          {#each group.options as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </optgroup>
      {/each}
    {:else}
      {#each options ?? [] as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    {/if}
```

Add the block modifier to the `<style>` block, after the `.ui-select` rule:

```css
  .ui-select--block {
    display: flex;
    width: 100%;
    height: var(--row-h);
    font-size: 14px;
  }
  .ui-select--block select {
    flex: 1;
  }
```

- [ ] **Step 4: Run the Select suite and the primitive guards**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts tests/client/shared/control-target-size.test.ts tests/client/shared/token-references.test.ts
```

Expected: PASS in all three. `control-target-size` must not list `Select.svelte` as an offender — if it does, a literal px height slipped in; use `var(--row-h)`.

- [ ] **Step 5: Prove every existing caller still works**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/ tests/client/admin/ tests/client/shared/
```

Expected: PASS. `Select`'s flat callers (`SettingsTopBar`, admin sections, field fixtures) are unchanged.

- [ ] **Step 6: Adopt the focus-ring token**

In `client/shared/ui/Select.svelte`, replace the hardcoded `:focus-within` rule (lines 66-69) with:

```css
  .ui-select:focus-within {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
```

The tokens already exist at `client/shared/tokens.css:39-40` with exactly these values, so this is a no-op visually and a real change to consistency.

- [ ] **Step 7: Re-run the token and Select suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Select.test.ts tests/client/shared/token-references.test.ts
```

Expected: PASS — `--focus-ring` and `--focus-ring-offset` both resolve to declarations in `client/shared/tokens.css`.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/shared/ui/Select.svelte tests/client/shared/ui/Select.test.ts
git commit -m "feat(ui): Select gains optional option groups, a block size, and the focus-ring token"
```

---

### Task 4: Jump menu adopts the shared `Select` and honours collapse

Closes the rest of `settings-app-jump-menu-bare-select` and `settings-app-jump-menu-ignores-collapse` (both Med/Low). Below the breakpoint the jump menu is the **only** navigation, and it currently offers every section of every group including collapsed ones — picking one navigates to a section that is not mounted.

**Files:**

- Modify: `client/settings/components/SettingsJumpMenu.svelte`
- Test: `tests/client/settings/components/SettingsJumpMenu.test.ts`

**Interfaces:**

- Consumes: `Select` with `groups: { label: string; options: { value: string; label: string }[] }[]` and `block: boolean` from Task 3. `SidebarGroup` from `SettingsSidebar.svelte` — `{ kicker: string; items: readonly SidebarItem[]; danger?: boolean; collapsible?: boolean; collapsed?: boolean }`.
- Produces: unchanged public props `{ groups: readonly SidebarGroup[]; activeId: string }`. A group with `collapsed === true` contributes no options.

- [ ] **Step 1: Write the failing tests**

Replace the whole body of `tests/client/settings/components/SettingsJumpMenu.test.ts` below the imports with:

```typescript
interface SidebarGroup {
  kicker: string
  items: readonly { id: string; label: string }[]
  danger?: boolean
  collapsible?: boolean
  collapsed?: boolean
}

const groups: SidebarGroup[] = [
  { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
  { kicker: 'Admin', danger: true, items: [{ id: 'system', label: 'System' }] },
]

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders one option per item with the active value selected', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'system' } })
  flushSync()
  const select = target.querySelector('select')!
  expect(select.value).toBe('system')
  expect(target.querySelectorAll('option').length).toBe(2)
  void unmount(c)
})

test('navigating sets the location hash', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'profile' } })
  flushSync()
  const select = target.querySelector('select')!
  select.value = 'system'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
  expect(window.location.hash).toBe('#system')
  void unmount(c)
})

test('uses the shared Select primitive rather than a bare select', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsJumpMenu, { target, props: { groups, activeId: 'profile' } })
  flushSync()
  expect(target.querySelector('.ui-select')).not.toBeNull()
  expect(target.querySelector('.ui-select--block')).not.toBeNull()
  void unmount(c)
})

test('a collapsed group contributes no options and no optgroup', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const withCollapsed: SidebarGroup[] = [
    { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
    {
      kicker: 'Advanced',
      collapsible: true,
      collapsed: true,
      items: [{ id: 'memory', label: 'Memory' }],
    },
  ]
  const c = mount(SettingsJumpMenu, { target, props: { groups: withCollapsed, activeId: 'profile' } })
  flushSync()
  expect(target.querySelectorAll('optgroup').length).toBe(1)
  expect(target.querySelector('option[value="memory"]')).toBeNull()
  void unmount(c)
})

test('an expanded collapsible group keeps its options', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const expanded: SidebarGroup[] = [
    { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
    {
      kicker: 'Advanced',
      collapsible: true,
      collapsed: false,
      items: [{ id: 'memory', label: 'Memory' }],
    },
  ]
  const c = mount(SettingsJumpMenu, { target, props: { groups: expanded, activeId: 'profile' } })
  flushSync()
  expect(target.querySelectorAll('optgroup').length).toBe(2)
  expect(target.querySelector('option[value="memory"]')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsJumpMenu.test.ts
```

Expected: FAIL — `.ui-select` is null (bare select), and the collapsed group still renders its optgroup and option.

- [ ] **Step 3: Rewrite the jump menu on top of `Select`**

Replace the whole of `client/settings/components/SettingsJumpMenu.svelte` below the licence header with:

```svelte
<script lang="ts">
  import Select from '../../shared/ui/Select.svelte'

  import type { SidebarGroup } from './SettingsSidebar.svelte'

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()

  // A collapsed group's sections are not mounted, so offering them here would
  // navigate to a fragment that does not exist on the page.
  const options = $derived(
    groups
      .filter((group) => group.collapsed !== true)
      .map((group) => ({
        label: group.kicker,
        options: group.items.map((item) => ({ value: item.id, label: item.label })),
      })),
  )

  function onChange(id: string): void {
    window.location.hash = `#${id}`
  }
</script>

<div class="settings-jump">
  <span class="t-label" id="settings-jump-label">Jump to</span>
  <Select value={activeId} groups={options} {onChange} block testid="settings-jump-select" />
</div>

<style>
  .settings-jump {
    display: none;
    flex-direction: column;
    gap: var(--gap-tight);
    padding: var(--gap-inline) var(--gap-section) 0;
  }
  @media (max-width: 900px) {
    .settings-jump {
      display: flex;
    }
  }
</style>
```

The `<label for>` becomes a `<span id>` because `Select` owns its own `<select>` element and wires `aria-labelledby` through the Field context; a `for` pointing at a wrapper `<div>` would be a dangling reference. The visible text is unchanged.

- [ ] **Step 4: Run to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsJumpMenu.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/components/SettingsJumpMenu.svelte tests/client/settings/components/SettingsJumpMenu.test.ts
git commit -m "feat(settings): jump menu uses the shared Select and skips collapsed groups"
```

---

### Task 5: Extract the nav model

The spine of the project. `SettingsApp.svelte` holds four hardcoded singletons for a single collapsible group — `ADVANCED_IDS` (`:56`), `advancedCollapsed` (`:102`), `observableSectionIds` (`:152`), and the hashchange auto-expand keyed to `ADVANCED_IDS.includes(id)` (`:173`). Adding a second collapsible group by copy-paste would duplicate all four. This task builds the model in isolation with no wiring; Task 7 consumes it.

**Files:**

- Create: `client/settings/nav.svelte.ts`
- Create: `tests/client/settings/nav.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces (exact signatures — Task 7 depends on every one):
  - `interface NavItem { id: string; label: string }`
  - `type NavGroupKey = 'personal' | 'advanced' | 'admin'`
  - `interface NavGroup { key: NavGroupKey; kicker: string; items: readonly NavItem[]; collapsible: boolean; danger: boolean }`
  - `interface NavSession { isBotAdmin: boolean; isSuperAdmin: boolean }`
  - `function buildNavGroups(session: NavSession, isGroup: boolean): NavGroup[]`
  - `function isNavGroupKey(value: string): value is NavGroupKey`
  - `function isGroupCollapsed(key: NavGroupKey): boolean`
  - `function toggleGroup(key: NavGroupKey): void`
  - `function expandGroupOwning(id: string, groups: readonly NavGroup[]): boolean`
  - `function allSectionIds(groups: readonly NavGroup[]): string[]`
  - `function mountedSectionIds(groups: readonly NavGroup[]): string[]`
  - `function groupHint(items: readonly NavItem[]): string`
  - `function resetNavCollapse(): void`

- [ ] **Step 1: Write the failing tests**

Create `tests/client/settings/nav.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  allSectionIds,
  buildNavGroups,
  expandGroupOwning,
  groupHint,
  isGroupCollapsed,
  isNavGroupKey,
  mountedSectionIds,
  resetNavCollapse,
  toggleGroup,
} from '../../../client/settings/nav.svelte.js'

const personal = { isBotAdmin: false, isSuperAdmin: false }
const botAdmin = { isBotAdmin: true, isSuperAdmin: false }
const superAdmin = { isBotAdmin: true, isSuperAdmin: true }

afterEach(() => {
  resetNavCollapse()
})

describe('buildNavGroups', () => {
  test('a personal non-admin session gets Personal and Advanced only', () => {
    const groups = buildNavGroups(personal, false)
    expect(groups.map((g) => g.key)).toEqual(['personal', 'advanced'])
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['profile', 'task-provider', 'tools', 'analytics'])
  })

  test('a group context adds the group-only sections to Personal', () => {
    const groups = buildNavGroups(personal, true)
    expect(groups[0]!.items.map((i) => i.id)).toEqual([
      'profile',
      'task-provider',
      'tools',
      'analytics',
      'members',
      'group-provider',
      'guest-mode',
      'coding-identity',
      'kaneo-access',
    ])
  })

  test('Advanced holds the ten integration sections and is collapsible', () => {
    const advanced = buildNavGroups(personal, false).find((g) => g.key === 'advanced')!
    expect(advanced.collapsible).toBe(true)
    expect(advanced.danger).toBe(false)
    expect(advanced.items.map((i) => i.id)).toEqual([
      'memory',
      'ai-output',
      'identity',
      'byok',
      'coding-credentials',
      'coding-mcp',
      'code-host',
      'repos',
      'mcp',
      'plugins',
    ])
  })

  test('a bot admin gets the 14 bot-admin entries, collapsible and flagged danger', () => {
    const admin = buildNavGroups(botAdmin, false).find((g) => g.key === 'admin')!
    expect(admin.collapsible).toBe(true)
    expect(admin.danger).toBe(true)
    expect(admin.items).toHaveLength(14)
    expect(admin.items.map((i) => i.id)).not.toContain('admins')
  })

  test('a super admin gets the two extra entries appended', () => {
    const admin = buildNavGroups(superAdmin, false).find((g) => g.key === 'admin')!
    expect(admin.items).toHaveLength(16)
    expect(admin.items.map((i) => i.id).slice(-2)).toEqual(['admins', 'plugin-approval'])
  })

  test('the renamed admin duplicates no longer collide with their personal twins', () => {
    const groups = buildNavGroups(superAdmin, false)
    const labels = groups.flatMap((g) => g.items.map((i) => i.label))
    expect(new Set(labels).size).toBe(labels.length)
    const admin = groups.find((g) => g.key === 'admin')!
    expect(admin.items.find((i) => i.id === 'analytics-admin')!.label).toBe('Analytics policy')
    expect(admin.items.find((i) => i.id === 'byok-admin')!.label).toBe('BYOK keys')
  })
})

describe('collapse state', () => {
  test('Advanced and Admin both start collapsed; Personal is never collapsed', () => {
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
    expect(isGroupCollapsed('personal')).toBe(false)
  })

  test('toggleGroup flips one group without touching the other', () => {
    toggleGroup('advanced')
    expect(isGroupCollapsed('advanced')).toBe(false)
    expect(isGroupCollapsed('admin')).toBe(true)
    toggleGroup('advanced')
    expect(isGroupCollapsed('advanced')).toBe(true)
  })

  test('resetNavCollapse restores the defaults', () => {
    toggleGroup('advanced')
    toggleGroup('admin')
    resetNavCollapse()
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
  })

  test('isNavGroupKey accepts the three keys and rejects anything else', () => {
    expect(isNavGroupKey('advanced')).toBe(true)
    expect(isNavGroupKey('admin')).toBe(true)
    expect(isNavGroupKey('personal')).toBe(true)
    expect(isNavGroupKey('Advanced')).toBe(false)
    expect(isNavGroupKey('')).toBe(false)
  })
})

describe('expandGroupOwning', () => {
  test('expands whichever collapsed group owns the id', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('memory', groups)).toBe(true)
    expect(isGroupCollapsed('advanced')).toBe(false)
    expect(isGroupCollapsed('admin')).toBe(true)

    expect(expandGroupOwning('instances', groups)).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(false)
  })

  test('an id in an already-open group is a no-op that reports false', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('profile', groups)).toBe(false)
    expect(isGroupCollapsed('advanced')).toBe(true)
  })

  test('an unknown id changes nothing', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(expandGroupOwning('not-a-section', groups)).toBe(false)
    expect(isGroupCollapsed('advanced')).toBe(true)
    expect(isGroupCollapsed('admin')).toBe(true)
  })
})

describe('section id derivation', () => {
  test('allSectionIds spans every group regardless of collapse', () => {
    const groups = buildNavGroups(superAdmin, false)
    const ids = allSectionIds(groups)
    expect(ids).toContain('profile')
    expect(ids).toContain('memory')
    expect(ids).toContain('instances')
    expect(ids).toHaveLength(4 + 10 + 16)
  })

  test('mountedSectionIds omits collapsed groups and grows as they expand', () => {
    const groups = buildNavGroups(superAdmin, false)
    expect(mountedSectionIds(groups)).toEqual(['profile', 'task-provider', 'tools', 'analytics'])
    toggleGroup('advanced')
    expect(mountedSectionIds(groups)).toContain('memory')
    expect(mountedSectionIds(groups)).not.toContain('instances')
    toggleGroup('admin')
    expect(mountedSectionIds(groups)).toContain('instances')
  })
})

describe('groupHint', () => {
  test('lists the first three labels and counts the rest', () => {
    const advanced = buildNavGroups(personal, false).find((g) => g.key === 'advanced')!
    expect(groupHint(advanced.items)).toBe('Memory, AI output, Identity + 7 more')
  })

  test('three or fewer items get no overflow count', () => {
    expect(groupHint([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }])).toBe('Alpha, Beta')
  })

  test('an empty group yields an empty hint', () => {
    expect(groupHint([])).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/nav.test.ts
```

Expected: FAIL — module not found, `client/settings/nav.svelte.js`.

- [ ] **Step 3: Create the nav model**

Create `client/settings/nav.svelte.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface NavItem {
  id: string
  label: string
}

export type NavGroupKey = 'personal' | 'advanced' | 'admin'

export interface NavGroup {
  key: NavGroupKey
  kicker: string
  items: readonly NavItem[]
  collapsible: boolean
  danger: boolean
}

/** The slice of the session the nav model needs; keeps this module DOM- and store-free. */
export interface NavSession {
  isBotAdmin: boolean
  isSuperAdmin: boolean
}

const PERSONAL_ITEMS: readonly NavItem[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'task-provider', label: 'Task provider' },
  { id: 'tools', label: 'Tools' },
  { id: 'analytics', label: 'Analytics' },
]

const GROUP_ITEMS: readonly NavItem[] = [
  { id: 'members', label: 'Members' },
  { id: 'group-provider', label: 'Group provider' },
  { id: 'guest-mode', label: 'Guest mode' },
  { id: 'coding-identity', label: 'Session identity' },
  { id: 'kaneo-access', label: 'My Kaneo access' },
]

const ADVANCED_ITEMS: readonly NavItem[] = [
  { id: 'memory', label: 'Memory' },
  { id: 'ai-output', label: 'AI output' },
  { id: 'identity', label: 'Identity' },
  { id: 'byok', label: 'BYOK LLM' },
  { id: 'coding-credentials', label: 'Coding sessions' },
  { id: 'coding-mcp', label: 'Coding MCP servers' },
  { id: 'code-host', label: 'Code host' },
  { id: 'repos', label: 'Repositories' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugins', label: 'Plugins' },
]

// 'Analytics policy' and 'BYOK keys' name what the admin section does rather than
// repeating the personal section's label; the group kicker alone did not tell the
// two apart in the jump menu, where kickers are optgroup labels.
const BOT_ADMIN_ITEMS: readonly NavItem[] = [
  { id: 'instances', label: 'Instances' },
  { id: 'llm-providers', label: 'LLM providers' },
  { id: 'llm-models', label: 'LLM models' },
  { id: 'byok-admin', label: 'BYOK keys' },
  { id: 'plugin-config', label: 'Plugin config' },
  { id: 'users', label: 'Users' },
  { id: 'tool-defaults', label: 'Tool defaults' },
  { id: 'coding-guardrails', label: 'Coding guardrails' },
  { id: 'mcp-catalog', label: 'MCP catalog' },
  { id: 'mcp-plugin-servers', label: 'MCP plugin servers' },
  { id: 'groups', label: 'Groups' },
  { id: 'announce', label: 'Announce' },
  { id: 'release-notes', label: 'Release notes' },
  { id: 'analytics-admin', label: 'Analytics policy' },
]

const SUPER_ADMIN_ITEMS: readonly NavItem[] = [
  { id: 'admins', label: 'Admins' },
  { id: 'plugin-approval', label: 'Plugin approval' },
]

const NAV_GROUP_KEYS: readonly string[] = ['personal', 'advanced', 'admin']

export function isNavGroupKey(value: string): value is NavGroupKey {
  return NAV_GROUP_KEYS.includes(value)
}

export function buildNavGroups(session: NavSession, isGroup: boolean): NavGroup[] {
  const groups: NavGroup[] = [
    {
      key: 'personal',
      kicker: 'Personal',
      collapsible: false,
      danger: false,
      items: isGroup ? [...PERSONAL_ITEMS, ...GROUP_ITEMS] : [...PERSONAL_ITEMS],
    },
    { key: 'advanced', kicker: 'Advanced', collapsible: true, danger: false, items: ADVANCED_ITEMS },
  ]

  const adminItems: NavItem[] = []
  if (session.isBotAdmin) adminItems.push(...BOT_ADMIN_ITEMS)
  // Super admins are always bot admins, so adminItems already holds the bot-admin entries.
  if (session.isSuperAdmin) adminItems.push(...SUPER_ADMIN_ITEMS)
  if (adminItems.length > 0) {
    groups.push({ key: 'admin', kicker: 'Admin', collapsible: true, danger: true, items: adminItems })
  }

  return groups
}

const DEFAULT_COLLAPSE: Record<NavGroupKey, boolean> = {
  personal: false,
  // Both collapsible groups start closed: Advanced holds ten optional integrations,
  // Admin holds sixteen sections that each fetch on mount.
  advanced: true,
  admin: true,
}

const collapse = $state<Record<NavGroupKey, boolean>>({ ...DEFAULT_COLLAPSE })

export function isGroupCollapsed(key: NavGroupKey): boolean {
  return collapse[key]
}

export function toggleGroup(key: NavGroupKey): void {
  collapse[key] = !collapse[key]
}

export function resetNavCollapse(): void {
  for (const key of NAV_GROUP_KEYS) {
    if (isNavGroupKey(key)) collapse[key] = DEFAULT_COLLAPSE[key]
  }
}

/**
 * Opens whichever collapsible group owns `id`, so a deep link, a sidebar click, or a
 * jump-menu pick lands on a mounted section. Reports whether it changed anything.
 */
export function expandGroupOwning(id: string, groups: readonly NavGroup[]): boolean {
  const owner = groups.find((group) => group.items.some((item) => item.id === id))
  if (owner === undefined || !owner.collapsible || !collapse[owner.key]) return false
  collapse[owner.key] = false
  return true
}

export function allSectionIds(groups: readonly NavGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id))
}

/** Only the sections currently on the page: a collapsed group's sections are unmounted. */
export function mountedSectionIds(groups: readonly NavGroup[]): string[] {
  return groups.filter((group) => !collapse[group.key]).flatMap((group) => group.items.map((item) => item.id))
}

/** A group's own summary line, derived from its items so it cannot drift from them. */
export function groupHint(items: readonly NavItem[]): string {
  if (items.length === 0) return ''
  const shown = items.slice(0, 3).map((item) => item.label)
  const rest = items.length - shown.length
  return rest > 0 ? `${shown.join(', ')} + ${rest} more` : shown.join(', ')
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/nav.test.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Check the mutation score on the new module**

Run:

```bash
bun test:mutate:file client/settings/nav.svelte.ts
```

Expected: a score report. If surviving mutants point at an unasserted branch (for example `expandGroupOwning`'s `!owner.collapsible` guard), add a test that asserts the actual value rather than that the call did not throw.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/settings/nav.svelte.ts tests/client/settings/nav.test.ts
git commit -m "feat(settings): extract the nav group model with per-group collapse"
```

---

### Task 6: Shared group disclosure button

Closes `settings-app-advanced-toggle-reads-as-divider` (Med). `.settings-advanced__toggle` (`SettingsApp.svelte:292`) is a full-width button whose only styling is a `border-bottom`, and there is **no `:hover` rule for it anywhere** — it reads as a section divider, not a control. Extracting it gives Advanced and Admin the same disclosure with a resting affordance and real hover/active states.

**Files:**

- Create: `client/settings/components/SettingsGroupToggle.svelte`
- Create: `tests/client/settings/components/SettingsGroupToggle.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `SettingsGroupToggle` with props `{ label: string; hint: string; collapsed: boolean; controls: string; testid: string; onToggle: () => void }`. Renders a `<button type="button">` carrying `aria-expanded={!collapsed}`, `aria-controls={controls}`, and `data-testid={testid}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/client/settings/components/SettingsGroupToggle.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsGroupToggle from '../../../../client/settings/components/SettingsGroupToggle.svelte'

const props = {
  label: 'Advanced',
  hint: 'Memory, AI output, Identity + 7 more',
  collapsed: true,
  controls: 'settings-advanced-content',
  testid: 'advanced-toggle',
  onToggle: (): void => undefined,
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsGroupToggle', () => {
  test('renders a button wired to the content it controls', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props })
    flushSync()
    const button = target.querySelector<HTMLButtonElement>('[data-testid="advanced-toggle"]')!
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('settings-advanced-content')
    void unmount(c)
  })

  test('shows the label and the derived hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props })
    flushSync()
    expect(target.textContent).toContain('Advanced')
    expect(target.textContent).toContain('Memory, AI output, Identity + 7 more')
    void unmount(c)
  })

  test('an expanded toggle reports aria-expanded true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props: { ...props, collapsed: false } })
    flushSync()
    expect(target.querySelector('[data-testid="advanced-toggle"]')!.getAttribute('aria-expanded')).toBe('true')
    void unmount(c)
  })

  test('clicking calls onToggle exactly once', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    let calls = 0
    const c = mount(SettingsGroupToggle, {
      target,
      props: {
        ...props,
        onToggle: (): void => {
          calls += 1
        },
      },
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="advanced-toggle"]')!.click()
    flushSync()
    expect(calls).toBe(1)
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsGroupToggle.test.ts
```

Expected: FAIL — module not found, `client/settings/components/SettingsGroupToggle.svelte`.

- [ ] **Step 3: Create the component**

Create `client/settings/components/SettingsGroupToggle.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    label: string
    hint: string
    collapsed: boolean
    /** id of the element this button shows and hides. */
    controls: string
    testid: string
    onToggle: () => void
  }

  let { label, hint, collapsed, controls, testid, onToggle }: Props = $props()
</script>

<button
  type="button"
  class="settings-group-toggle"
  aria-expanded={!collapsed}
  aria-controls={controls}
  data-testid={testid}
  onclick={onToggle}>
  <span class="settings-group-toggle__chevron">{collapsed ? '▸' : '▾'}</span>
  <span class="settings-group-toggle__label">{label}</span>
  <span class="settings-group-toggle__hint">{hint}</span>
</button>

<style>
  /* A resting box, not a rule: the previous toggle drew only a border-bottom and had
     no hover rule at all, which made it read as a divider rather than a control. */
  .settings-group-toggle {
    display: flex;
    align-items: center;
    gap: var(--gap-tight);
    width: 100%;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    text-align: left;
    padding: var(--s3);
    cursor: pointer;
  }
  .settings-group-toggle:hover {
    background: var(--surface-hover);
    border-color: var(--strong);
  }
  .settings-group-toggle:active {
    background: var(--surface-2);
  }
  .settings-group-toggle__hint {
    color: var(--text-muted);
    font-size: 11px;
    margin-left: auto;
    text-align: right;
  }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsGroupToggle.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/components/SettingsGroupToggle.svelte tests/client/settings/components/SettingsGroupToggle.test.ts
git commit -m "feat(settings): shared group disclosure button with real hover and active states"
```

---

### Task 7: Wire the nav model into `SettingsApp` and make Admin collapsible

Closes `settings-app-admin-nav-not-collapsible` (Med), `settings-app-advanced-hint-undercounts` (Low), and — together with Task 12 — `settings-app-duplicate-nav-labels` (Low). Admin is the longest group (16 items), the only one that cannot collapse, and its sections mount eagerly, so every admin's page load fires all 16 sections' fetches. Routing it through the same model gates the nav list and the section mounts with one mechanism.

**Files:**

- Modify: `client/settings/SettingsApp.svelte`
- Modify: `client/settings/components/SettingsSidebar.svelte:11-25` (add `key`), `:37` (emit it)
- Test: `tests/client/settings/SettingsApp.test.ts`, `tests/client/settings/components/SettingsSidebar.test.ts`

**Interfaces:**

- Consumes: every export from `client/settings/nav.svelte.ts` (Task 5) and `SettingsGroupToggle` (Task 6).
- Produces: `SidebarGroup` gains `key?: string`. `onToggle` now receives `group.key ?? group.kicker`, so existing callers that pass no `key` keep receiving the kicker.

- [ ] **Step 1: Write the failing sidebar test**

Add to `tests/client/settings/components/SettingsSidebar.test.ts`, inside `describe('SettingsSidebar collapsible group', …)`:

```typescript
  test('onToggle emits the stable key when the group carries one', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const calls: string[] = []
    const keyed = [
      { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
      {
        kicker: 'Advanced',
        key: 'advanced',
        collapsible: true,
        collapsed: true,
        items: [{ id: 'memory', label: 'Memory' }],
      },
    ]
    const c = mount(SettingsSidebar, {
      target,
      props: { groups: keyed, activeId: 'profile', onToggle: (k: string) => calls.push(k) },
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle-Advanced"]')!.click()
    flushSync()
    expect(calls).toEqual(['advanced'])
    void unmount(c)
  })
```

Add `key?: string` to the local `SidebarGroup` interface at the top of that test file.

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsSidebar.test.ts
```

Expected: FAIL — `calls` is `['Advanced']`, not `['advanced']`.

- [ ] **Step 3: Add the stable key to the sidebar**

In `client/settings/components/SettingsSidebar.svelte`, add one field to the exported interface (after `kicker`):

```typescript
  export interface SidebarGroup {
    kicker: string
    /** Stable identity for collapse state; falls back to the kicker when absent. */
    key?: string
    items: readonly SidebarItem[]
    danger?: boolean
    collapsible?: boolean
    collapsed?: boolean
  }
```

and change the toggle's click handler (line 37) to:

```svelte
          onclick={() => onToggle?.(group.key ?? group.kicker)}>
```

- [ ] **Step 4: Run to verify sidebar tests pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsSidebar.test.ts
```

Expected: PASS — the new keyed test plus the three pre-existing collapsible tests (which pass no `key` and still get the kicker).

- [ ] **Step 5: Write the failing SettingsApp tests**

In `tests/client/settings/SettingsApp.test.ts`:

Add to the imports:

```typescript
import { resetNavCollapse } from '../../../client/settings/nav.svelte.js'
```

Add `resetNavCollapse()` as the first line of the existing `afterEach`.

Replace the `'shows admin sections for a bot admin and SA-only sections for a super admin'` test and the `'hides SA-only sections for a non-super bot admin'` test with these, which account for Admin now being collapsed by default:

```typescript
  test('the admin zone starts collapsed, so its sections do not mount or fetch', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    const component = mountApp()
    await drain()
    expect(document.querySelector('[data-testid="admin-toggle"]')).not.toBeNull()
    expect(document.querySelector('#instances')).toBeNull()
    expect(document.querySelector('#admins')).toBeNull()
    void unmount(component)
  })

  test('expanding Admin mounts the bot-admin and super-admin sections', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    const component = mountApp()
    await drain()
    document.querySelector<HTMLButtonElement>('[data-testid="admin-toggle"]')!.click()
    await drain()
    for (const id of [
      'instances',
      'llm-providers',
      'llm-models',
      'byok-admin',
      'plugin-config',
      'users',
      'groups',
      'announce',
      'admins',
      'plugin-approval',
      'analytics-admin',
    ]) {
      expect(document.querySelector(`#${id}`)).not.toBeNull()
    }
    void unmount(component)
  })

  test('an expanded Admin hides SA-only sections from a non-super bot admin', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: false })
    const component = mountApp()
    await drain()
    document.querySelector<HTMLButtonElement>('[data-testid="admin-toggle"]')!.click()
    await drain()
    expect(document.querySelector('#instances')).not.toBeNull()
    expect(document.querySelector('#byok-admin')).not.toBeNull()
    expect(document.querySelector('#plugin-config')).not.toBeNull()
    expect(document.querySelector('#admins')).toBeNull()
    expect(document.querySelector('#plugin-approval')).toBeNull()
    void unmount(component)
  })

  test('a deep link to an Admin section auto-expands the Admin group', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({ isBotAdmin: true, isSuperAdmin: true })
    document.body.innerHTML = '<div id="root"></div>'
    history.replaceState(null, '', '/settings#instances')
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(SettingsApp, { target })
    await drain()
    expect(document.querySelector('#instances')).not.toBeNull()
    void unmount(component)
  })

  test('the Advanced hint is derived from its own items', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({})
    const component = mountApp()
    await drain()
    const toggle = document.querySelector<HTMLElement>('[data-testid="advanced-toggle"]')!
    expect(toggle.textContent).toContain('Memory, AI output, Identity + 7 more')
    void unmount(component)
  })
```

The `'renders three group kickers for an admin session'` test still passes: the Admin group is present in the sidebar whether or not it is collapsed — only its links are hidden.

- [ ] **Step 6: Run to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts
```

Expected: FAIL — `[data-testid="admin-toggle"]` is null, `#instances` is present when it should be absent, and the Advanced hint still reads the hardcoded string.

- [ ] **Step 7: Rewrite the SettingsApp script to consume the model**

In `client/settings/SettingsApp.svelte`, add these imports beside the existing component imports:

```typescript
  import SettingsGroupToggle from './components/SettingsGroupToggle.svelte'
  import {
    allSectionIds,
    buildNavGroups,
    expandGroupOwning,
    groupHint,
    isGroupCollapsed,
    isNavGroupKey,
    mountedSectionIds,
    toggleGroup,
  } from './nav.svelte.js'
```

Delete `type SidebarItem = SidebarGroup['items'][number]` (line 53), the `ADVANCED_IDS` constant (lines 55-67), and the whole `buildAdminSidebarItems` function (lines 69-97).

Replace the state and derivation block (lines 99-160) with:

```typescript
  const initialHash = window.location.hash.slice(1)
  let activeId = $state(initialHash || 'profile')

  const isGroup = $derived(activeContext()?.kind === 'group')

  const navGroups = $derived(buildNavGroups(settingsSession, isGroup))

  const groups = $derived(
    navGroups.map(
      (group): SidebarGroup => ({
        key: group.key,
        kicker: group.kicker,
        items: group.items,
        danger: group.danger,
        collapsible: group.collapsible,
        collapsed: group.collapsible ? isGroupCollapsed(group.key) : undefined,
      }),
    ),
  )

  const sectionIds = $derived(allSectionIds(navGroups))
  const observableSectionIds = $derived(mountedSectionIds(navGroups))

  const advancedItems = $derived(navGroups.find((g) => g.key === 'advanced')?.items ?? [])
  const adminItems = $derived(navGroups.find((g) => g.key === 'admin')?.items ?? [])

  const ctx = $derived(settingsSession.activeContextId)

  function onSidebarToggle(key: string): void {
    if (isNavGroupKey(key)) toggleGroup(key)
  }
```

Replace the two hash effects (lines 169-188) with:

```typescript
  // A hash can name a section inside a collapsed group (sidebar link, jump menu, deep link).
  // Open whichever group owns it, then scroll once the section has mounted.
  $effect(() => {
    const onHash = (): void => {
      const id = window.location.hash.slice(1)
      if (id === '') return
      expandGroupOwning(id, untrack(() => navGroups))
      void tick().then(() => document.getElementById(id)?.scrollIntoView())
    }
    window.addEventListener('hashchange', onHash)
    return (): void => window.removeEventListener('hashchange', onHash)
  })

  // First ready render: the same treatment for a hash that was present on load.
  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const id = untrack(() => window.location.hash.slice(1))
    if (id === '') return
    expandGroupOwning(id, untrack(() => navGroups))
    void tick().then(() => document.getElementById(id)?.scrollIntoView())
  })
```

- [ ] **Step 8: Rewrite the markup to use the shared toggle and gate the admin zone**

Replace the Advanced block (lines 234-260) with:

```svelte
          <div class="settings-group settings-advanced">
            <SettingsGroupToggle
              label="Advanced"
              hint={groupHint(advancedItems)}
              collapsed={isGroupCollapsed('advanced')}
              controls="settings-advanced-content"
              testid="advanced-toggle"
              onToggle={() => toggleGroup('advanced')} />
            {#if !isGroupCollapsed('advanced')}
              <div id="settings-advanced-content">
                <MemorySection contextId={ctx} />
                <AiOutputSection contextId={ctx} />
                <IdentitySection contextId={ctx} />
                <ByokSection contextId={ctx} />
                <CodingCredentialsSection contextId={ctx} />
                <CodingMcpSection contextId={ctx} />
                <CodeHostSection contextId={ctx} />
                <ReposSection contextId={ctx} />
                <McpSection contextId={ctx} />
                <PluginsSection contextId={ctx} />
              </div>
            {/if}
          </div>
```

Replace the admin zone block (lines 261-284) with:

```svelte
          {#if settingsSession.isBotAdmin || settingsSession.isSuperAdmin}
            <div class="settings-group settings-group--wide settings-admin-zone">
              <SettingsGroupToggle
                label="Admin"
                hint={groupHint(adminItems)}
                collapsed={isGroupCollapsed('admin')}
                controls="settings-admin-content"
                testid="admin-toggle"
                onToggle={() => toggleGroup('admin')} />
              {#if !isGroupCollapsed('admin')}
                <div id="settings-admin-content" class="settings-group">
                  {#if settingsSession.isBotAdmin}
                    <AdminInstancesSection />
                    <AdminProvidersSection />
                    <AdminModelsSection />
                    <AdminByokSection />
                    <AdminPluginsConfigSection />
                    <AdminUsersSection />
                    <AdminToolDefaultsSection />
                    <AdminCodingGuardrailsSection />
                    <AdminMcpCatalogSection />
                    <AdminMcpPluginServersSection />
                    <AdminGroupsSection />
                    <AdminAnnounceSection />
                    <AdminReleaseNotesSection />
                    <AdminAnalyticsSection />
                  {/if}
                  {#if settingsSession.isSuperAdmin}
                    <AdminAdminsSection />
                    <AdminPluginsApprovalSection catalogContextId={ctx} />
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
```

Change the sidebar call site (line 217) to:

```svelte
        <SettingsSidebar {groups} {activeId} onToggle={onSidebarToggle} />
```

Delete the whole `<style>` block (lines 291-311): both rules belonged to the toggle that now lives in `SettingsGroupToggle.svelte`.

- [ ] **Step 9: Run the affected suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts tests/client/settings/components/ tests/client/settings/nav.test.ts
```

Expected: PASS in all. If `SettingsApp.svelte` now trips `max-lines`, split the admin section list into its own `client/settings/components/AdminSections.svelte` component rather than compressing formatting.

- [ ] **Step 10: Lint and typecheck the whole client**

Run:

```bash
bun run lint && bun run typecheck
```

Expected: both clean. `buildAdminSidebarItems` and `ADVANCED_IDS` are gone; nothing else referenced them.

- [ ] **Step 11: Format and commit**

```bash
bun run format
git add client/settings/SettingsApp.svelte client/settings/components/SettingsSidebar.svelte tests/client/settings/SettingsApp.test.ts tests/client/settings/components/SettingsSidebar.test.ts
git commit -m "feat(settings): drive navigation from the nav model and make Admin collapsible"
```

---

### Task 8: Move the scroll boundary into the settings grid

Closes `settings-app-sidebar-tail-unreachable` (High). `Shell.svelte:35` makes `.ui-shell__body` the scroll container; the sidebar is `position: sticky; top: 0; max-height: 100vh; overflow-y: auto`. The scrollport is `100vh` minus the 48px top bar and 32px of body padding, so the sidebar's box overshoots it by roughly 80px — and because the element is sticky, the outer scroll never recovers that strip. The tail of a 16-item admin nav can be scrolled to inside the sidebar but is never painted. There is no CSS unit for "my scrollport's height", so the fix is structural.

**Files:**

- Modify: `client/shared/ui/Shell.svelte`
- Modify: `client/settings/settings.css:7-19` (grid + main), `:122-129` untouched
- Modify: `client/settings/components/SettingsSidebar.svelte:64-76`
- Modify: `client/settings/SettingsApp.svelte` (wrap the body, pass `bodyScroll={false}`)
- Test: `tests/client/shared/ui/Shell.test.ts`, `tests/client/settings/settings-css.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `Shell` props become `{ topBar: Snippet; children: Snippet; bodyScroll?: boolean }`, default `true`. When `false`, `.ui-shell__body` gains `.ui-shell__body--fixed` (`overflow: hidden; padding: 0`). DebugApp passes nothing and is unaffected.
- Produces: `.settings-shell` — a full-height flex column wrapping the jump menu and the grid.

- [ ] **Step 1: Write the failing Shell test**

Add to `tests/client/shared/ui/Shell.test.ts`, inside `describe('Shell.svelte', …)`:

```typescript
  test('the body scrolls by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Shell, {
      target,
      props: { topBar: textSnippet('TOP'), children: textSnippet('BODY') },
    })
    expect(target.querySelector('.ui-shell__body--fixed')).toBeNull()
    void unmount(component)
  })

  test('bodyScroll false hands scrolling to the page content', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Shell, {
      target,
      props: { topBar: textSnippet('TOP'), children: textSnippet('BODY'), bodyScroll: false },
    })
    const body = target.querySelector('.ui-shell__body')!
    expect(body.classList.contains('ui-shell__body--fixed')).toBe(true)
    expect(body.textContent).toContain('BODY')
    void unmount(component)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Shell.test.ts
```

Expected: FAIL on the second test — `.ui-shell__body--fixed` is absent because `Shell` ignores the unknown prop.

- [ ] **Step 3: Add the `bodyScroll` prop**

In `client/shared/ui/Shell.svelte`, replace the script block's interface and destructure (lines 9-14) with:

```typescript
  interface Props {
    topBar: Snippet
    children: Snippet
    /**
     * Whether this shell's body owns the page scroll. Set false when the page
     * content manages its own scroll regions, so nothing nests a second scroller
     * inside a box whose height it cannot express.
     */
    bodyScroll?: boolean
  }

  let { topBar, children, bodyScroll = true }: Props = $props()
```

Replace the body div (line 19) with:

```svelte
  <div class="ui-shell__body" class:ui-shell__body--fixed={!bodyScroll}>{@render children()}</div>
```

Add to the `<style>` block, after `.ui-shell__body`:

```css
  .ui-shell__body--fixed {
    overflow: hidden;
    padding: 0;
  }
```

- [ ] **Step 4: Run to verify Shell passes, including DebugApp's callers**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Shell.test.ts tests/client/debug/ tests/client/admin/
```

Expected: PASS. No existing caller passes `bodyScroll`, so all keep the scrolling body.

- [ ] **Step 5: Write the failing layout CSS tests**

Add to `tests/client/settings/settings-css.test.ts`, inside `describe('settings.css', …)`:

```typescript
  test('the settings shell is a contained full-height column, not a page scroller', () => {
    const m = css.match(/\.settings-shell \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [shell] = m!
    expect(shell).toContain('height: 100%')
    expect(shell).toContain('min-height: 0')
  })

  test('the grid fills the remaining height so its columns can scroll independently', () => {
    const m = css.match(/\.settings-grid \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [grid] = m!
    expect(grid).toContain('flex: 1 1 auto')
    expect(grid).toContain('min-height: 0')
  })

  test('the main column owns its own scroll', () => {
    const m = css.match(/\.settings-grid__main \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [main] = m!
    expect(main).toContain('overflow-y: auto')
  })
```

- [ ] **Step 6: Run to verify they fail**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/settings-css.test.ts
```

Expected: FAIL — `.settings-shell` does not exist and neither column declares `overflow-y`.

- [ ] **Step 7: Rewrite the layout rules**

In `client/settings/settings.css`, replace the layout shell block (lines 6-19) with:

```css
/* ---- layout shell ---- */
/* The shell body no longer scrolls (Shell bodyScroll={false}); this column fills it
   and hands the remaining height to the grid, so the sidebar and the main column each
   scroll inside a box whose height is real rather than an assumed 100vh. */
.settings-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.settings-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  flex: 1 1 auto;
  min-height: 0;
}
.settings-grid__main {
  display: flex;
  flex-direction: column;
  gap: var(--gap-group);
  padding: var(--gap-section) var(--gap-section) var(--s9);
  min-width: 0;
  overflow-y: auto;
}
```

Change `.settings-section`'s scroll margin (line 33) from `96px` to:

```css
  scroll-margin-top: var(--gap-inline);
```

The 96px offset compensated for a page-level scroll under a sticky top bar. With the main column as the scroller and nothing sticky inside it, that offset only pushes targets down.

- [ ] **Step 8: De-stick the sidebar**

In `client/settings/components/SettingsSidebar.svelte`, replace the `.settings-sidebar` rule (lines 64-76) with:

```css
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s4) var(--s3);
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    /* Fills its grid track and scrolls inside it. No sticky/100vh box: that box was
       taller than the scrollport it sat in, and being sticky, the outer scroll could
       never bring its tail into view. */
    height: 100%;
    overflow-y: auto;
  }
```

- [ ] **Step 9: Wrap the settings body and stop the shell scrolling**

In `client/settings/SettingsApp.svelte`, change the `Shell` open tag to `<Shell bodyScroll={false}>` and wrap the jump menu and grid in the new column. The full shape of the `children` snippet after this step — the section list inside `<main>` is unchanged from Task 7, so it is elided here as `…sections…`:

```svelte
  {#snippet children()}
    <h1 class="sr-only">Settings</h1>
    <div class="settings-shell">
      <SettingsJumpMenu {groups} {activeId} />
      <div class="settings-grid">
        <SettingsSidebar {groups} {activeId} onToggle={onSidebarToggle} />
        <main class="settings-grid__main">
          …sections…
        </main>
      </div>
    </div>
  {/snippet}
```

The only structural change is the added `<div class="settings-shell">` wrapping the jump menu and the grid, and its matching close before `{/snippet}`.

- [ ] **Step 10: Run the layout and app suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/ tests/client/shared/
```

Expected: PASS.

- [ ] **Step 11: Verify the fix visually**

With Storybook running (`bun storybook`), shoot the section and read the short-viewport shot:

```bash
bun shoot -g SettingsApp
```

Then read `.storybook-shots/settings/SettingsApp.spec.ts/SettingsApp-admin-sidebar-short-viewport-*.png` with the Read tool. Expected: with the Admin group expanded the nav list scrolls inside the rail and its last entry is reachable; the list is no longer cut mid-item after "Groups". (Task 13 updates this state to expand Admin first — until then the shot shows the collapsed rail, which is itself proof the tail no longer overflows.)

- [ ] **Step 12: Format and commit**

```bash
bun run format
git add client/shared/ui/Shell.svelte client/settings/settings.css client/settings/components/SettingsSidebar.svelte client/settings/SettingsApp.svelte tests/client/shared/ui/Shell.test.ts tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): move the scroll boundary into the grid so the sidebar tail is reachable"
```

---

### Task 9: Scrollspy observes the real scroller and stops rewriting history

Closes `settings-app-scrollspy-rewrites-history-entry` (Low) and completes Task 8: the spy's `-30% 0px -60% 0px` band is measured against the viewport (`root: null`), which is no longer the scroller. Separately, `SettingsApp.svelte:194` calls `history.replaceState` on every section crossing, overwriting the entry a sidebar click pushed — so Back lands on a hash the user never chose.

**Files:**

- Modify: `client/settings/scrollspy.ts`
- Modify: `client/settings/SettingsApp.svelte:190-198`
- Test: `tests/client/settings/scrollspy.test.ts`, `tests/client/settings/SettingsApp.test.ts`

**Interfaces:**

- Consumes: `.settings-grid__main` as the scroll root (Task 8).
- Produces: `useScrollSpy(sectionIds: readonly string[], onChange: (id: string) => void, root?: Element | null): ScrollSpyHandle`. `root` defaults to `null` (the viewport), so the existing call shape keeps working.

- [ ] **Step 1: Write the failing tests**

Replace `tests/client/settings/scrollspy.test.ts` below the licence header with:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'

import { useScrollSpy } from '../../../client/settings/scrollspy.js'

interface Recorded {
  root: Element | Document | null
  rootMargin: string | undefined
}

const observed: Recorded[] = []
const RealObserver = globalThis.IntersectionObserver

class RecordingObserver {
  constructor(_cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observed.push({ root: options?.root ?? null, rootMargin: options?.rootMargin })
  }
  observe(): void {}
  disconnect(): void {}
}

afterEach(() => {
  observed.length = 0
  globalThis.IntersectionObserver = RealObserver
  document.body.innerHTML = ''
})

describe('useScrollSpy', () => {
  test('start and stop are idempotent and return a handle', () => {
    const spy = useScrollSpy(['profile', 'tools'], () => undefined)
    expect(typeof spy.start).toBe('function')
    expect(typeof spy.stop).toBe('function')
    spy.start()
    spy.start()
    spy.stop()
    spy.stop()
  })

  test('observes the viewport when no root is given', () => {
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    useScrollSpy(['profile'], () => undefined).start()
    expect(observed).toHaveLength(1)
    expect(observed[0]!.root).toBeNull()
    expect(observed[0]!.rootMargin).toBe('-30% 0px -60% 0px')
  })

  test('observes the given element when a root is passed', () => {
    document.body.innerHTML = '<div id="scroller"></div>'
    const scroller = document.querySelector<HTMLElement>('#scroller')!
    globalThis.IntersectionObserver = RecordingObserver as unknown as typeof IntersectionObserver
    useScrollSpy(['profile'], () => undefined, scroller).start()
    expect(observed).toHaveLength(1)
    expect(observed[0]!.root).toBe(scroller)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/scrollspy.test.ts
```

Expected: FAIL on the third test — `observed[0].root` is `null` because `useScrollSpy` takes no third argument.

- [ ] **Step 3: Add the root parameter**

In `client/settings/scrollspy.ts`, replace the signature and the observer construction (lines 11-25) with:

```typescript
export const useScrollSpy = (
  sectionIds: readonly string[],
  onChange: (id: string) => void,
  /** The scroll container to measure against. null observes the viewport. */
  root: Element | null = null,
): ScrollSpyHandle => {
  let observer: IntersectionObserver | null = null

  const start = (): void => {
    if (observer !== null) return
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (sectionIds.includes(id)) onChange(id)
        }
      },
      { root, rootMargin: '-30% 0px -60% 0px' },
    )
```

- [ ] **Step 4: Write the failing history test**

Add to `tests/client/settings/SettingsApp.test.ts`, inside `describe('SettingsApp', …)`:

```typescript
  test('a sidebar click is the only thing that writes the hash', async () => {
    setMockFetch(() => Promise.resolve(new Response('{}')))
    seed({})
    const component = mountApp()
    await drain()
    expect(window.location.hash).toBe('')
    document.querySelector<HTMLAnchorElement>('a[href="#tools"]')!.click()
    await drain()
    expect(window.location.hash).toBe('#tools')
    void unmount(component)
  })
```

- [ ] **Step 5: Run to verify the suite state**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts
```

Expected: PASS or FAIL depending on whether happy-dom fires an intersection; either way the assertion pins the contract. Proceed to Step 6 and re-run.

- [ ] **Step 6: Bind the main column and stop the history rewrite**

In `client/settings/SettingsApp.svelte`, add the element ref next to the other state:

```typescript
  let mainEl = $state<HTMLElement | null>(null)
```

Bind it on the main column:

```svelte
          <main class="settings-grid__main" bind:this={mainEl}>
```

Replace the scrollspy effect (lines 190-198) with:

```typescript
  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const root = mainEl
    if (root === null) return
    // The spy drives the active marker only. It used to replaceState on every crossing,
    // which overwrote the entry a sidebar click had just pushed -- so Back landed on a
    // section the user never chose. The hash changes on explicit navigation, nothing else.
    const spy = useScrollSpy(observableSectionIds, (id) => {
      activeId = id
    }, root)
    void tick().then(() => spy.start())
    return (): void => spy.stop()
  })
```

- [ ] **Step 7: Run both suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/scrollspy.test.ts tests/client/settings/SettingsApp.test.ts
```

Expected: PASS in both.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/settings/scrollspy.ts client/settings/SettingsApp.svelte tests/client/settings/scrollspy.test.ts tests/client/settings/SettingsApp.test.ts
git commit -m "fix(settings): scrollspy observes the main column and no longer rewrites history"
```

---

### Task 10: Raise the breakpoint to 900px

Closes `settings-app-breakpoint-keys-off-viewport` (Med). The 720px cutover leaves a squeeze band: at 760px the sidebar takes its full fixed 220px track while the single-column affordances are already off, leaving the main column ~492px — **less than the 640px "narrow" viewport gives it**.

| viewport | sidebar | main column |         |
| -------- | ------- | ----------- | ------- |
| 640px    | hidden  | 608px       | ok      |
| 720px    | hidden  | 688px       | ok      |
| 760px    | 220px   | 492px       | squeeze |
| 860px    | 220px   | 592px       | squeeze |
| 900px    | 220px   | 632px       | ok      |
| 1280px   | 220px   | 1012px      | ok      |

**Files:**

- Modify: `client/settings/settings.css:137-141`
- Modify: `client/settings/components/SettingsSidebar.svelte` (the `@media` at the end of `<style>`)
- Test: `tests/client/settings/settings-css.test.ts`

`SettingsJumpMenu.svelte` already moved to 900px in Task 4.

**Interfaces:**

- Consumes: the layout from Task 8.
- Produces: one breakpoint value, `900px`, in all three files.

- [ ] **Step 1: Write the failing test**

Add to `tests/client/settings/settings-css.test.ts`:

```typescript
  test('the single-column cutover happens at 900px, above the squeeze band', () => {
    expect(css).toContain('@media (max-width: 900px)')
    expect(css).not.toContain('@media (max-width: 720px)')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/settings-css.test.ts
```

Expected: FAIL — the stylesheet still declares `@media (max-width: 720px)`.

- [ ] **Step 3: Move both media queries**

In `client/settings/settings.css`, replace the media block (lines 137-141) with:

```css
/* Below this the sidebar hides and the jump menu takes over. 900px, not 720px: with a
   fixed 220px rail, a 760px viewport leaves the content column ~492px -- narrower than
   the 608px it gets at 640px, where the rail is already gone. */
@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
```

In `client/settings/components/SettingsSidebar.svelte`, change the media query at the end of the `<style>` block to:

```css
  @media (max-width: 900px) {
    .settings-sidebar {
      display: none;
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/settings-css.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm all three files agree**

Run:

```bash
grep -rn "max-width: 720px\|max-width: 900px" client/settings/
```

Expected: exactly three `900px` lines — `settings.css`, `SettingsSidebar.svelte`, `SettingsJumpMenu.svelte` — and no `720px`.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/settings/settings.css client/settings/components/SettingsSidebar.svelte tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): raise the single-column breakpoint to 900px"
```

---

### Task 11: Focus-ring token and scope; spacing tokens in the shell chrome

Closes `settings-app-focus-ring-scoped-to-grid` (Med) and `settings-app-hardcoded-px-in-shell-chrome` (Low, narrowed to spacing — see the spec's Corrections: there are 218 hardcoded `font-size` values across 85 files and no shared type scale, so font size is out of scope and filed separately in Task 14).

`settings.css:132` scopes the ring to `.settings-grid`, but the top bar, the jump menu, and all three gates render outside it — so the context switcher, sign-out, the small-screen navigation, and every gate fall back to the UA default. The tokens it should use already exist at `tokens.css:39-40`.

**Files:**

- Modify: `client/settings/settings.css:131-135`
- Modify: `client/settings/components/SettingsSidebar.svelte` (spacing values)
- Modify: `client/settings/components/SettingsTopBar.svelte:41-59` (spacing values)
- Test: `tests/client/settings/settings-css.test.ts`, `tests/client/shared/token-references.test.ts`

**Interfaces:**

- Consumes: `--focus-ring: 2px solid rgba(82, 224, 138, 0.4)` and `--focus-ring-offset: 1px` from `client/shared/tokens.css:39-40`.
- Produces: a focus ring covering `.ui-shell` (top bar, jump menu, sidebar, main) and `.settings-gate`.

- [ ] **Step 1: Write the failing test**

Replace the existing `'focus ring uses accent at reduced alpha'` test in `tests/client/settings/settings-css.test.ts` with:

```typescript
  test('the focus ring uses the shared tokens rather than a copied literal', () => {
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    expect(m).not.toBeNull()
    const [rule] = m!
    expect(rule).toContain('outline: var(--focus-ring)')
    expect(rule).toContain('outline-offset: var(--focus-ring-offset)')
    expect(css).not.toContain('rgba(82, 224, 138, 0.4)')
  })

  test('the focus ring covers the chrome outside the grid, not just the grid', () => {
    const m = css.match(/[^}]*:focus-visible \{[^}]*\}/u)
    const [rule] = m!
    expect(rule).toContain('.ui-shell')
    expect(rule).toContain('.settings-gate')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/settings-css.test.ts
```

Expected: FAIL — the rule is scoped to `.settings-grid` and still carries the raw `rgba(82, 224, 138, 0.4)`.

- [ ] **Step 3: Re-scope and tokenize the ring**

In `client/settings/settings.css`, replace the focus-ring block (lines 131-135) with:

```css
/* ---- shared focus ring ---- */
/* .ui-shell rather than .settings-grid: the top bar, the jump menu, and the gates all
   render outside the grid, so scoping there left the context switcher, sign-out, and
   the only small-screen navigation with the UA default ring. */
.ui-shell :focus-visible,
.settings-gate :focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 4: Move the shell chrome onto the spacing scale**

In `client/settings/components/SettingsSidebar.svelte`, apply these replacements inside `<style>`:

- `.settings-sidebar__group--danger`: `padding-left: 10px; margin-left: -12px` → `padding-left: var(--s3); margin-left: calc(-1 * var(--s3))`. The 10/-12 pair was asymmetric, which pulled the danger group 2px left of its siblings; matching them aligns it.
- `.settings-sidebar__kicker`: `gap: 6px; margin-bottom: 6px` → `gap: var(--s2); margin-bottom: var(--s2)`.
- `.settings-sidebar__badge`: `padding: 0 6px` → `padding: 0 var(--s2)`.
- `.settings-sidebar__link`: `padding: 6px 8px` → `padding: var(--s2)`.

Leave `.settings-sidebar__chevron`'s `margin-right: 2px` and `.settings-sidebar__nav`'s `gap: 2px` as literals, and add this comment above the nav rule:

```css
  /* 2px is below the 4px scale on purpose: at --s1 (4px) a 16-item admin nav grows by
     14px, which is what pushes its tail out of a short viewport. */
```

In `client/settings/components/SettingsTopBar.svelte`, apply:

- `.settings-topbar__status`: `gap: 12px` → `gap: var(--s3)`.
- `.settings-topbar__ctx`: `gap: 6px` → `gap: var(--s2)`.

- [ ] **Step 5: Run the CSS and token suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/ tests/client/shared/token-references.test.ts tests/client/shared/tokens.test.ts
```

Expected: PASS. `token-references` proves every `var(--x)` still resolves.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add client/settings/settings.css client/settings/components/SettingsSidebar.svelte client/settings/components/SettingsTopBar.svelte tests/client/settings/settings-css.test.ts
git commit -m "fix(settings): focus ring uses the shared tokens and covers the whole shell"
```

---

### Task 12: Rename the duplicated admin sections

Completes `settings-app-duplicate-nav-labels` (Low). "Analytics" and "BYOK LLM" each appear twice in the nav with nothing but the group kicker to tell them apart — and in the jump menu the kicker is an `optgroup` label, which several screen readers do not announce per option. Task 5 already renamed the nav labels; this task renames the section titles to match, so the nav and its destination agree.

| id                | nav label        | section title              | what it is                                |
| ----------------- | ---------------- | -------------------------- | ----------------------------------------- |
| `analytics`       | Analytics        | Personal · Analytics       | unchanged                                 |
| `analytics-admin` | Analytics policy | Admin · Analytics policy   | collection mode, kill switch, egress      |
| `byok`            | BYOK LLM         | Personal · BYOK LLM        | unchanged                                 |
| `byok-admin`      | BYOK keys        | Admin · System · BYOK keys | read-only table of every context's status |

**Files:**

- Modify: `client/settings/sections/admin/AdminAnalyticsSection.svelte:221`
- Modify: `client/settings/sections/admin/AdminByokSection.svelte:74`
- Test: `tests/client/settings/nav.test.ts` (already asserts the nav labels, from Task 5)

**Interfaces:**

- Consumes: the labels defined in `BOT_ADMIN_ITEMS` (Task 5).
- Produces: no API change; copy only.

- [ ] **Step 1: Rename the admin analytics title**

In `client/settings/sections/admin/AdminAnalyticsSection.svelte`, change line 221 from:

```svelte
  <PageHeader eyebrow="Admin" title="Analytics" />
```

to:

```svelte
  <PageHeader eyebrow="Admin" title="Analytics policy" />
```

- [ ] **Step 2: Rename the admin BYOK title**

In `client/settings/sections/admin/AdminByokSection.svelte`, change line 74 from:

```svelte
  <PageHeader eyebrow="Admin · System" title="BYOK LLM">
```

to:

```svelte
  <PageHeader eyebrow="Admin · System" title="BYOK keys">
```

- [ ] **Step 3: Find any test that pinned the old titles**

Run:

```bash
grep -rn "BYOK LLM\|title=\"Analytics\"" tests/ client/ tests/stories/
```

Expected: the only remaining `BYOK LLM` occurrences are the **personal** section (`client/settings/sections/ByokSection.svelte`) and the personal nav label in `client/settings/nav.svelte.ts`. If an admin-section test asserts the old title, update that assertion to the new one.

- [ ] **Step 4: Run the admin section suites**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/
```

Expected: PASS, including `nav.test.ts`'s `'the renamed admin duplicates no longer collide with their personal twins'`.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add client/settings/sections/admin/AdminAnalyticsSection.svelte client/settings/sections/admin/AdminByokSection.svelte
git commit -m "fix(settings): rename the duplicated admin sections to what they do"
```

---

### Task 13: Fixtures, stories, and visual states

Closes `settings-app-unauthenticated-state-uncaptured` (Low) and provides the visual proof for both Highs. The story fixtures can currently produce only `loading` and `ready`, so the `unauthenticated` gate — and now `failed` — cannot be shot at all.

**Files:**

- Modify: `client/stories/decorators/withFixtures.ts`
- Modify: `client/settings/SettingsApp.stories.svelte`
- Modify: `tests/visual/settings/SettingsApp.spec.ts`

**Interfaces:**

- Consumes: `settingsSession.failureMessage` (Task 1), `resetNavCollapse()` (Task 5), `data-testid="admin-toggle"` and `data-testid="advanced-toggle"` (Tasks 6-7).
- Produces: story parameter `settingsGate: 'unauthenticated' | 'failed'`.

- [ ] **Step 1: Teach the fixtures loader the gate modes**

In `client/stories/decorators/withFixtures.ts`, add the nav import beside the session import:

```typescript
import { resetNavCollapse } from '../../settings/nav.svelte.js'
```

Add two lines to `resetSettingsSession` (after `settingsSession.status = 'loading'`):

```typescript
  settingsSession.failureMessage = ''
  resetNavCollapse()
```

Add this function after `applyReadySettingsSession`:

```typescript
// A non-ready gate: the screens a user hits before or instead of the shell.
export function applyGateSettingsSession(gate: 'unauthenticated' | 'failed'): void {
  settingsSession.status = gate
  settingsSession.failureMessage = gate === 'failed' ? 'request failed with status 503' : ''
}
```

And wire it in `fixturesLoader`, immediately after the `settingsReady` branch:

```typescript
    const gate = context.parameters['settingsGate']
    if (gate === 'unauthenticated' || gate === 'failed') applyGateSettingsSession(gate)
```

- [ ] **Step 2: Add the gate stories**

Append to `client/settings/SettingsApp.stories.svelte`:

```svelte
<!-- The 401 gate: an expired or already-used settings link. No retry, because retrying cannot help. -->
<Story
  name="Unauthenticated"
  parameters={{ fixtures: 'settings-shell-ready', settingsGate: 'unauthenticated' }} />

<!-- Everything that is not a 401 -- 5xx, 429, a dropped connection. The link is still good, so this one retries. -->
<Story name="Failed" parameters={{ fixtures: 'settings-shell-ready', settingsGate: 'failed' }} />
```

- [ ] **Step 3: Regenerate the generated screenshot region**

Run:

```bash
bun run shoot:gen
```

Expected: `tests/visual/settings/SettingsApp.spec.ts`'s `@generated-begin auto-screenshots` region grows from 4 tests to 6 — `Personal ready`, `Group ready`, `Admin ready`, `Loading`, `Unauthenticated`, `Failed`. Do not hand-edit inside that region.

- [ ] **Step 4: Update the manual states below `@generated-end`**

Three existing manual states break under the new defaults, and two need new viewports. Replace everything below `pinDefaultViewport()` in `tests/visual/settings/SettingsApp.spec.ts` with:

```typescript
// ---- depth-B review states (dims 6, 7, 8, 9) ----

// The sidebar is display:none below 900px and the jump <select> takes over, so
// narrow is the only viewport where the shell's whole navigation model is visible.
test('SettingsApp — personal, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 900px is the exact breakpoint edge: sidebar and jump menu both flip here.
test('SettingsApp — personal, breakpoint edge', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 900, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 940px is the first width above the breakpoint: the rail is back and the main
// column has room. This is the state that used to squeeze at 760px.
test('SettingsApp — just above breakpoint', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 940, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// 760px used to sit above the old 720px cutover with a 220px rail and a ~492px
// content column. It is now single-column; this state pins that.
test('SettingsApp — former squeeze band', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.setViewportSize({ width: 760, height: 900 })
  await expect(sharedPage).toHaveScreenshot()
})

// Advanced is collapsed by default, so its ten sections and the expanded
// toggle state never appear in the generated set.
test('SettingsApp — advanced expanded', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.getByTestId('advanced-toggle').click()
  await expect(sharedPage).toHaveScreenshot()
})

// Hover on a sidebar link — the only affordance signalling the nav is interactive.
test('SettingsApp — sidebar link hover', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--personal-ready')
  await sharedPage.getByRole('link', { name: 'Tools' }).hover()
  await expect(sharedPage).toHaveScreenshot()
})

// The Admin group is collapsed by default: this is what an admin now lands on,
// with sixteen sections behind one disclosure instead of mounted and fetching.
test('SettingsApp — admin zone collapsed', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await expect(sharedPage).toHaveScreenshot()
})

// The admin zone's danger framing at narrow width, where its wide max-width
// and the ADMIN cutout label have the least room. Expanded and scrolled into
// view — the zone sits far below the fold behind every personal section.
test('SettingsApp — admin zone, narrow', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 640, height: 900 })
  await sharedPage.getByTestId('admin-toggle').click()
  await sharedPage.locator('#instances').scrollIntoViewIfNeeded()
  await expect(sharedPage).toHaveScreenshot()
})

// The admin sidebar expanded is the tallest nav the shell ever renders (16 links).
// At a short viewport its tail used to be clipped by a sticky max-height:100vh box
// taller than the scrollport; the rail now scrolls inside its own grid track.
test('SettingsApp — admin sidebar, short viewport', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'settings-settingsapp--admin-ready')
  await sharedPage.setViewportSize({ width: 1280, height: 600 })
  await sharedPage.getByTestId('sidebar-toggle-Admin').click()
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 5: Shoot the section**

With Storybook running (`bun storybook`):

```bash
bun shoot -g SettingsApp
```

Expected: 15 baselines written under `.storybook-shots/settings/SettingsApp.spec.ts/` (6 generated + 9 manual). `.storybook-shots/` is gitignored — the baselines are local evidence, not committed artefacts.

- [ ] **Step 6: Read the shots and confirm each claim**

Read these PNGs with the Read tool and confirm what each was added to prove:

- `SettingsApp-Unauthenticated-*.png` and `SettingsApp-Failed-*.png` — both carry the brand kicker; only Failed shows a reason and a **Try again** button.
- `SettingsApp-Loading-*.png` — the brand kicker plus "Loading your settings…", not a blank field.
- `SettingsApp-admin-sidebar-short-viewport-*.png` — the expanded 16-item rail scrolls inside its track; the last entry is reachable, not cut mid-item after "Groups".
- `SettingsApp-just-above-breakpoint-*.png` — at 940px the content column has room; no control collides with its neighbour.

If any shot contradicts its claim, fix the implementation — do not soften the comment.

- [ ] **Step 7: Run the client suites once more**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/
```

Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add client/stories/decorators/withFixtures.ts client/settings/SettingsApp.stories.svelte tests/visual/settings/SettingsApp.spec.ts
git commit -m "test(settings): capture the session gates and the fixed layout states"
```

---

### Task 14: Close the findings and regenerate the backlog

The review document is the project's record; leaving it at 14 `open` after the work lands is the failure mode this task exists to prevent. Two findings need their **text corrected first** (see the spec's Corrections section) — a wrong finding closed as `fixed` is worse than an open one.

**Files:**

- Modify: `docs/ux-reviews/SettingsApp.md`
- Modify: `docs/ux-reviews/_BACKLOG.md` (generated — never hand-edited)

**Interfaces:**

- Consumes: the commits from Tasks 1-13.
- Produces: 14 findings at `Status: fixed`, plus one new finding at `Status: deferred`.

- [ ] **Step 1: Correct the two findings whose text was wrong**

In `docs/ux-reviews/SettingsApp.md`, replace the two findings' bodies with the text below. Both keep their id, dimension, and severity; only the `**Where visible:**`, `**Source:**`, and `**Fix:**` lines change. The heading changes too, because in both cases it named the wrong thing.

Replace the `settings-app-loading-gate-unannounced` finding with:

```markdown
### [Med] The bootstrap wait is a blank page, not a loading state

- **Id:** settings-app-loading-gate-unannounced
- **Status:** fixed
- **Dimension:** 4 — feedback & state
- **Where visible:** not capturable before this fix — the state had no DOM to shoot. The `Loading` story exercised a branch real users never reached.
- **Source:** `client/settings/index.ts:26-32` awaited `bootstrapSession(code)` **before** `mount(SettingsApp, { target })`, so the component's `loading` branch could not render in production. What a user saw for the length of the bootstrap round trip was `client/settings/settings.html`'s empty `<div id="app"></div>` — a blank page with no text, no brand mark, and nothing announced to assistive tech.
- **Fix:** mount first and let the component own the wait, with the loading copy in a `role="status"` region.
```

Replace the `settings-app-hardcoded-px-in-shell-chrome` finding with:

```markdown
### [Low] Shell chrome spacing is hardcoded px beside a spacing scale

- **Id:** settings-app-hardcoded-px-in-shell-chrome
- **Status:** fixed
- **Dimension:** 8 — spacing, alignment & sizing
- **Where visible:** every SettingsApp screenshot; the danger group in the sidebar sits 2px left of its siblings.
- **Source:** `client/settings/components/SettingsSidebar.svelte` and `client/settings/components/SettingsTopBar.svelte` set gaps and padding as literals (20px, 16px, 12px, 10px, 6px) while `client/shared/tokens.css:44-52` declares `--s1`..`--s9` on a 4px scale. The danger group's `padding-left: 10px` against `margin-left: -12px` is the visible symptom.
- **Fix:** move the values that land on the 4px scale onto `--s*`. Scoped to **spacing**: font size is excluded deliberately — the codebase carries 218 hardcoded `font-size` declarations across 85 files and no shared type scale exists to move them onto, which makes it a cross-cutting migration rather than a shell fix. Filed separately as `settings-app-no-shared-type-scale`.
```

- [ ] **Step 2: Set every finding to `fixed` with a `Resolved:` line**

For each of the 14 findings, change `- **Status:** open` to `- **Status:** fixed` and add, as the last bullet:

```markdown
- **Resolved:** sub-project `docs/superpowers/specs/2026-08-05-settingsapp-shell-findings-design.md` (branch `ui-ux-review-02`)
```

The 14 ids, and the task that closed each:

| Id                                              | Closed by |
| ----------------------------------------------- | --------- |
| `settings-app-sidebar-tail-unreachable`         | Task 8    |
| `settings-app-unauthenticated-dead-end`         | Task 1    |
| `settings-app-loading-gate-unannounced`         | Task 2    |
| `settings-app-focus-ring-scoped-to-grid`        | Task 11   |
| `settings-app-jump-menu-bare-select`            | Tasks 3-4 |
| `settings-app-advanced-toggle-reads-as-divider` | Task 6    |
| `settings-app-admin-nav-not-collapsible`        | Task 7    |
| `settings-app-breakpoint-keys-off-viewport`     | Task 10   |
| `settings-app-advanced-hint-undercounts`        | Task 7    |
| `settings-app-duplicate-nav-labels`             | Tasks 5, 12 |
| `settings-app-scrollspy-rewrites-history-entry` | Task 9    |
| `settings-app-hardcoded-px-in-shell-chrome`     | Task 11   |
| `settings-app-unauthenticated-state-uncaptured` | Task 13   |
| `settings-app-jump-menu-ignores-collapse`       | Task 4    |

- [ ] **Step 3: File the type-scale finding**

Add a new finding to `docs/ux-reviews/SettingsApp.md` in the same format as its neighbours, at Low severity under dimension 3 (design-system consistency):

```markdown
### [Low] No shared type scale, so every component invents its own font sizes

- **Id:** settings-app-no-shared-type-scale
- **Status:** deferred
- **Dimension:** 3 — design-system consistency
- **Where visible:** every settings screenshot; the shell chrome's 13px/12px/11px sit beside `.t-*` utilities that declare their own sizes.
- **Source:** `client/shared/tokens.css:39-77` declares colour, focus, spacing, radius, and control-height tokens but no type scale; `client/settings/settings.css:62-101` defines `.t-*` utilities that are settings-scoped, not shared.
- **Fix:** introduce shared font-size tokens and migrate the 218 hardcoded `font-size` declarations across 85 files onto them.
- **Resolved:** deferred — a cross-cutting migration touching every section and both apps, out of scope for the shell sub-project. Filed here so the gap stays visible in the Deferred backlog.
```

Update the document's `**Date:**` line to the date the work lands, and its scorecard for dimensions 4 and 7 from `fail` to `pass` (the two Highs and both dim-4 Meds are closed).

- [ ] **Step 4: Regenerate the backlog**

Run:

```bash
bun run ux:backlog
```

Expected: `wrote docs/ux-reviews/_BACKLOG.md (…)`. Never edit that file by hand.

- [ ] **Step 5: Confirm no SettingsApp finding is still open**

Run:

```bash
grep -n "settings-app-" docs/ux-reviews/_BACKLOG.md
```

Expected: `settings-app-no-shared-type-scale` appears under Deferred, and no `settings-app-*` id appears under Open.

- [ ] **Step 6: Run the full client suite and the checks**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/
bun run lint && bun run typecheck && bun run format:check
```

Expected: PASS in all.

- [ ] **Step 7: Check the mutation ratchet on the changed files**

Run:

```bash
bun test:mutate:changed
```

Expected: no per-file score below its floor in `scripts/mutation/baseline.json`. If a changed file regresses, strengthen its assertions — assert the value, not that the call happened.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add docs/ux-reviews/SettingsApp.md docs/ux-reviews/_BACKLOG.md
git commit -m "docs(ux): close the 14 SettingsApp shell findings and file the type-scale gap"
```

---

## Out of Scope

Filed, not folded in:

- `plugins-inactive-copy-overclaims-approval` — server-side eligibility reasons in `src/plugins/registry-context-eligibility.ts`. A different subsystem with its own cycle.
- Sub-grouping the 16 admin sections into labelled clusters — needs a nested group model in both the sidebar and the jump menu. The collapse fix in Task 7 addresses the finding as written.
- An app-wide type scale — filed as `settings-app-no-shared-type-scale` (deferred) in Task 14.
