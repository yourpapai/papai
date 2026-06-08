<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `/settings` Svelte SPA into a navigable, grouped, semantically-consistent surface (hierarchy + danger-zone + usable data tables) while preserving the existing dark terminal/monospace aesthetic.

**Architecture:** The settings UI is a Svelte 5 (runes) SPA under `client/settings/`, bundled by a custom Bun pipeline (no Vite/`svelte.config.js`). Design tokens live in `client/shared/tokens.css` and are **shared** by the debug and admin SPAs. Shared UI primitives live in `client/shared/ui/`. This plan is **gap-driven**: a left rail (`SettingsSidebar.svelte`), scroll-spy (`scrollspy.ts`), a 5-variant `Btn`, a `DataTable`, `Pill`/`StatusPill`/`Dot`, and `Confirm`/`Modal` **already exist** — we extend and re-wire them rather than rebuild. Token names are renamed to the spec's vocabulary with **legacy aliases** kept so the debug/admin SPAs keep rendering.

**Tech Stack:** Svelte 5 runes, TypeScript (strict, `.js` import extensions), `bun:test` + `happy-dom`, Zod v4 fetchers. No new component libraries or icon packs (Unicode glyphs only, matching the codebase).

---

## Reality reconciliation (read before starting)

The spec (`§1`) describes a greenfield that does not match the code. Confirmed against the repo:

| Spec claim ("Current")        | Actual state in code                                                                                                                                             | Plan impact                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| "no navigation"               | `client/settings/components/SettingsSidebar.svelte` (sticky rail, active highlight) + `client/settings/scrollspy.ts` exist and are wired in `SettingsApp.svelte` | **Extend** rail (grouping, `aria-current`, mobile menu); do **not** rebuild |
| "no shared components"        | `client/shared/ui/` has `Btn`, `DataTable`, `Pill`, `StatusPill`, `Dot`, `Input`, `Field`, `Select`, `Secret`, `PageHeader`, `Caption`, plus `Confirm`/`Modal`   | Re-wire and add only `SegmentedControl`, `CopyButton`, `SettingsTable`      |
| "no grouping"                 | Sections have ad-hoc eyebrows ("Personal", "Admin · System") via `PageHeader`                                                                                    | Promote eyebrows into real groups                                           |
| green = 4 meanings            | `StatusPill` already uses dot+tone (not solid fill); `Pill` accent is soft-bg not solid                                                                          | Mostly an audit + `Btn` discipline, not a rebuild                           |
| destructive fires immediately | True — `AdminUsersSection.remove()`, instances delete fire with no confirm; `Confirm.svelte` exists but is unused here                                           | Wire `Confirm` in                                                           |
| tokens absent                 | `client/shared/tokens.css` exists, shared by 3 SPAs                                                                                                              | **Rename + alias**, do not duplicate                                        |

**Decisions locked with product (see plan author's Q&A):**

1. **Tokens:** full rename to spec names/values, **plus** legacy aliases so debug/admin SPAs survive.
2. **Tool permissions:** keep the existing **3-state** model (`allow`/`ask`/`deny` — `ask` is wired to real per-call gating in the tool pipeline); replace the 3 plain buttons with a **segmented control** (the affordance intent of §6.4). Do **not** collapse to a binary switch.
3. **Scope:** one plan, all 4 phases, gap-driven.
4. Admin is already gated server-side (`src/debug/settings/admin/admin-guard.ts`) and hidden client-side via `settingsSession.isBotAdmin`/`isSuperAdmin` — spec Q1 resolved, no server work needed.
5. Users/Groups search + pagination are **client-side** (spec §8.2 "filters visible rows live"); server-side paging is a future swap, out of scope.
6. `Provision Kaneo` is treated as non-destructive (creation) — primary button, no confirm step (spec Q4).

---

## Conventions for every task

- **Test runner:** `bun test:client` runs the whole client suite. For a single file:
  ```bash
  bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/path/to/File.test.ts
  ```
- **Test file mirror:** `client/settings/X.svelte` → `tests/client/settings/X.test.ts`; `client/shared/ui/X.svelte` → `tests/client/shared/ui/X.test.ts`.
- **Svelte 5 test harness** (copy this header into every new component test):

  ```ts
  import { afterEach, describe, expect, test } from 'bun:test'
  import { flushSync, mount, unmount } from 'svelte'
  import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js' // depth varies

  const drain = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
  }
  afterEach(() => {
    restoreFetch()
  })
  ```

- **TDD hook:** every `Write`/`Edit` on a `src/`/`client/` impl file requires its paired test to pass first. Write the test, watch it fail, implement, watch it pass — the hook enforces this. Never add `eslint-disable`/`@ts-ignore`.
- **Imports:** `.js` extension in TS paths; `.svelte` for components. Every new file starts with the 4-line BUSL SPDX header block (copy from any existing file).
- **Commit cadence:** one commit per task (after its tests pass).

---

# Phase 1 — Structure

## Task 1: Token set — rename to spec vocabulary + add missing tokens

**Files:**

- Modify: `client/shared/tokens.css`
- Test: `tests/client/shared/tokens.test.ts` (create)

The spec's color names become canonical; legacy names (`--surface`, `--raised`, `--fg2`, `--s4`…) remain as aliases so `client/debug/` and `client/admin/` keep working unchanged.

- [ ] **Step 1: Write the failing test**

`tests/client/shared/tokens.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

describe('design tokens', () => {
  test('defines spec-named semantic color tokens', () => {
    for (const t of [
      '--surface-1',
      '--surface-2',
      '--surface-hover',
      '--text',
      '--text-muted',
      '--text-dim',
      '--accent-fg',
      '--state-active',
      '--danger-surface',
    ]) {
      expect(css).toContain(`${t}:`)
    }
  })
  test('defines layout + sizing tokens', () => {
    for (const t of [
      '--content-max',
      '--table-max',
      '--gap-group',
      '--gap-section',
      '--gap-field',
      '--gap-inline',
      '--radius',
      '--radius-pill',
      '--row-h',
    ]) {
      expect(css).toContain(`${t}:`)
    }
  })
  test('keeps legacy aliases so debug/admin SPAs still resolve', () => {
    for (const t of ['--surface:', '--raised:', '--fg2:', '--s4:']) {
      expect(css).toContain(t)
    }
  })
  test('adopts the spec accent value', () => {
    expect(css).toContain('#52e08a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/tokens.test.ts`
Expected: FAIL — `--surface-1` / `--content-max` / `#52e08a` not found.

- [ ] **Step 3: Rewrite `client/shared/tokens.css`**

Replace the entire `:root { … }` block (keep the 4-line SPDX header) with:

```css
:root {
  /* ---- canvas & surfaces (spec names canonical) ---- */
  --bg: #0a0c0a;
  --surface-1: #111512;
  --surface-2: #171c18;
  --surface-hover: #1c221d;
  --inset: #0e1214;

  /* ---- borders ---- */
  --border: #222a24;
  --strong: #3a464d;

  /* ---- foreground ---- */
  --text: #e6efe8;
  --text-muted: #9aa79d;
  --text-dim: #6b766e;

  /* ---- accent + semantic ---- */
  --accent: #52e08a;
  --accent-fg: #08160d;
  --accent-soft: rgba(82, 224, 138, 0.1);
  --accent-dim: rgba(82, 224, 138, 0.55);
  --state-active: #52e08a;
  --warn: #e0b452;
  --warn-soft: rgba(224, 180, 82, 0.1);
  --danger: #ff5d5d;
  --danger-soft: rgba(255, 93, 93, 0.1);
  --danger-surface: #1d1010;
  --info: #6cb6ff;
  --info-soft: rgba(108, 182, 255, 0.1);
  --success: var(--accent); /* fixes prior undefined --success ref in settings.css */

  /* ---- type ---- */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, Menlo, monospace;

  /* ---- layout & sizing ---- */
  --content-max: 760px;
  --table-max: 1100px;
  --gap-group: 64px;
  --gap-section: 40px;
  --gap-field: 20px;
  --gap-inline: 12px;
  --radius: 6px;
  --radius-pill: 999px;
  --row-h: 44px;

  /* ---- spacing scale (4px base, legacy) ---- */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  --s7: 32px;
  --s8: 40px;
  --s9: 48px;

  /* ---- legacy aliases: debug/admin SPAs reference these names ---- */
  --surface: var(--surface-1);
  --raised: var(--surface-2);
  --hair: var(--border);
  --fg: var(--text);
  --fg2: var(--text-muted);
  --fg3: var(--text-dim);
  --fg4: var(--text-dim);
}
```

> Note: legacy `--hair` mapped to `--border`, and `--fg4` to `--text-dim` (spec has no fourth fg). `--radius` is now `6px`; legacy components hardcode `border-radius: 2px` inline so they are unaffected — only token-driven radii change.

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS (4 tests).

- [ ] **Step 5: Smoke-build the client to confirm nothing broke**

Run: `bun build:client`
Expected: exits 0; `public/settings.css`, `public/debug.css`, `public/admin.css` regenerate without error.

- [ ] **Step 6: Commit**

```bash
git add client/shared/tokens.css tests/client/shared/tokens.test.ts
git commit -m "feat(settings): rename design tokens to spec vocabulary with legacy aliases"
```

---

## Task 2: Type-scale utility classes + layout primitives in settings CSS

**Files:**

- Modify: `client/settings/settings.css`
- Test: `tests/client/settings/settings-css.test.ts` (create)

Composite type styles (size+weight+case) can't be single CSS custom properties, so they ship as utility classes. Also add the content-width cap and group/section rhythm classes, and fix the `--success`/`.status-success` reference (now defined in Task 1).

- [ ] **Step 1: Write the failing test**

`tests/client/settings/settings-css.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../../../client/settings/settings.css', import.meta.url)), 'utf8')

describe('settings.css', () => {
  test('defines the type-scale utility classes', () => {
    for (const c of ['.t-kicker', '.t-section', '.t-subhead', '.t-label', '.t-body', '.t-help', '.t-mono-data']) {
      expect(css).toContain(c)
    }
  })
  test('content column is capped at the content-max token', () => {
    expect(css).toContain('max-width: var(--content-max)')
  })
  test('group/section rhythm uses tokens not ad-hoc px', () => {
    expect(css).toContain('var(--gap-group)')
    expect(css).toContain('var(--gap-section)')
  })
  test('focus ring uses accent at reduced alpha', () => {
    expect(css).toContain(':focus-visible')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/settings-css.test.ts`
Expected: FAIL — classes/tokens not present.

- [ ] **Step 3: Replace `client/settings/settings.css` body**

Keep the SPDX header; replace the rest with:

```css
/* ---- layout shell ---- */
.settings-grid {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 0;
  min-height: 0;
}
.settings-grid__main {
  display: flex;
  flex-direction: column;
  gap: var(--gap-group);
  padding: var(--gap-section) var(--gap-section) 96px;
  min-width: 0;
}

/* group = Personal / Integrations / Admin */
.settings-group {
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  max-width: var(--content-max);
}
.settings-group--wide {
  max-width: var(--table-max);
}

.settings-section {
  scroll-margin-top: 96px;
  color: var(--text);
}

/* forms */
.settings-form {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-inline);
  align-items: end;
  margin-bottom: var(--gap-field);
}
.settings-table-wrap {
  overflow-x: auto;
}

/* ---- type scale (utility classes; composite of size+weight+case) ---- */
.t-kicker {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}
.t-section {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}
.t-subhead {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.t-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
}
.t-body {
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
}
.t-help {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-dim);
}
.t-mono-data {
  font-size: 13px;
  font-weight: 400;
  font-family: var(--font-mono);
}

/* ---- status text ---- */
.status-error {
  color: var(--danger);
}
.status-success {
  color: var(--success);
}
.placeholder {
  color: var(--text-muted);
}

.settings-gate {
  font-family: var(--font-mono);
  max-width: 540px;
  margin: 4rem auto;
  padding: 1rem;
  line-height: 1.5;
  color: var(--text);
}

/* ---- shared focus ring ---- */
.settings-grid :focus-visible {
  outline: 2px solid rgba(82, 224, 138, 0.4);
  outline-offset: 1px;
}

@media (max-width: 720px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add client/settings/settings.css tests/client/settings/settings-css.test.ts
git commit -m "feat(settings): add type-scale utilities, content-cap and rhythm layout classes"
```

---

## Task 3: Grouped sidebar rail (kickers + aria-current) + responsive jump menu

**Files:**

- Modify: `client/settings/components/SettingsSidebar.svelte`
- Create: `client/settings/components/SettingsJumpMenu.svelte`
- Test: `tests/client/settings/components/SettingsSidebar.test.ts` (modify/create)
- Test: `tests/client/settings/components/SettingsJumpMenu.test.ts` (create)

The rail must render group kickers (PERSONAL / INTEGRATIONS / ADMIN), mark the active link with `aria-current="true"`, and visually flag the Admin group as a danger zone. On narrow viewports a `<select>` jump menu replaces the rail.

- [ ] **Step 1: Write the failing test for the grouped sidebar**

`tests/client/settings/components/SettingsSidebar.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import SettingsSidebar from '../../../../client/settings/components/SettingsSidebar.svelte'
import type { SidebarGroup } from '../../../../client/settings/components/SettingsSidebar.svelte'

const groups: SidebarGroup[] = [
  {
    kicker: 'Personal',
    items: [
      { id: 'profile', label: 'Profile' },
      { id: 'tools', label: 'Tools' },
    ],
  },
  { kicker: 'Admin', danger: true, items: [{ id: 'system', label: 'System' }] },
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsSidebar', () => {
  test('renders group kickers and links', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'profile' } })
    flushSync()
    expect(target.textContent).toContain('Personal')
    expect(target.textContent).toContain('Admin')
    expect(target.querySelector('a[href="#system"]')).not.toBeNull()
    void unmount(c)
  })
  test('marks the active link with aria-current', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'tools' } })
    flushSync()
    const active = target.querySelector('a[href="#tools"]')!
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(target.querySelector('a[href="#profile"]')!.getAttribute('aria-current')).toBeNull()
    void unmount(c)
  })
  test('flags the admin group as a danger zone', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups, activeId: 'profile' } })
    flushSync()
    expect(target.querySelector('.settings-sidebar__group--danger')).not.toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsSidebar.test.ts`
Expected: FAIL — `SidebarGroup` export missing / kickers absent.

- [ ] **Step 3: Rewrite `client/settings/components/SettingsSidebar.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  export interface SidebarItem {
    id: string
    label: string
  }
  export interface SidebarGroup {
    kicker: string
    items: readonly SidebarItem[]
    danger?: boolean
  }

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()
</script>

<aside class="settings-sidebar">
  {#each groups as group (group.kicker)}
    <div class="settings-sidebar__group" class:settings-sidebar__group--danger={group.danger === true}>
      <div class="t-kicker settings-sidebar__kicker">
        {group.kicker}{#if group.danger}<span class="settings-sidebar__badge">admin</span>{/if}
      </div>
      <nav class="settings-sidebar__nav">
        {#each group.items as item (item.id)}
          <a
            class="settings-sidebar__link"
            class:settings-sidebar__link--active={activeId === item.id}
            aria-current={activeId === item.id ? 'true' : undefined}
            href={`#${item.id}`}>
            {item.label}
          </a>
        {/each}
      </nav>
    </div>
  {/each}
</aside>

<style>
  .settings-sidebar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 16px 12px;
    background: var(--surface-1);
    border-right: 1px solid var(--border);
    position: sticky;
    top: 0;
    align-self: start;
    max-height: 100vh;
    overflow-y: auto;
  }
  .settings-sidebar__group--danger {
    border-left: 2px solid var(--danger);
    padding-left: 10px;
    margin-left: -12px;
  }
  .settings-sidebar__kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .settings-sidebar__badge {
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: var(--radius-pill);
    padding: 0 6px;
    font-size: 9px;
    letter-spacing: 0.08em;
  }
  .settings-sidebar__nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .settings-sidebar__link {
    color: var(--text-muted);
    text-decoration: none;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    border-left: 2px solid transparent;
  }
  .settings-sidebar__link:hover {
    color: var(--text);
    background: var(--surface-hover);
  }
  .settings-sidebar__link--active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--surface-2);
  }
  @media (max-width: 720px) {
    .settings-sidebar { display: none; }
  }
</style>
```

- [ ] **Step 4: Run sidebar test to verify it passes**

Run: same as Step 2. Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the jump menu**

`tests/client/settings/components/SettingsJumpMenu.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import SettingsJumpMenu from '../../../../client/settings/components/SettingsJumpMenu.svelte'
import type { SidebarGroup } from '../../../../client/settings/components/SettingsSidebar.svelte'

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
  select.dispatchEvent(new Event('change'))
  flushSync()
  expect(window.location.hash).toBe('#system')
  void unmount(c)
})
```

- [ ] **Step 6: Run jump-menu test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsJumpMenu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `client/settings/components/SettingsJumpMenu.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { SidebarGroup } from './SettingsSidebar.svelte'

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
  }

  let { groups, activeId }: Props = $props()

  function onChange(event: Event): void {
    const id = (event.target as HTMLSelectElement).value
    window.location.hash = `#${id}`
  }
</script>

<div class="settings-jump">
  <label class="t-label" for="settings-jump-select">Jump to</label>
  <select id="settings-jump-select" value={activeId} onchange={onChange}>
    {#each groups as group (group.kicker)}
      <optgroup label={group.kicker}>
        {#each group.items as item (item.id)}
          <option value={item.id}>{item.label}</option>
        {/each}
      </optgroup>
    {/each}
  </select>
</div>

<style>
  .settings-jump {
    display: none;
    flex-direction: column;
    gap: 6px;
    padding: 12px var(--gap-section) 0;
  }
  .settings-jump select {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px;
    height: var(--row-h);
    padding: 0 10px;
  }
  @media (max-width: 720px) {
    .settings-jump { display: flex; }
  }
</style>
```

- [ ] **Step 8: Run jump-menu test to verify it passes**

Run: same as Step 6. Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add client/settings/components/SettingsSidebar.svelte client/settings/components/SettingsJumpMenu.svelte tests/client/settings/components/SettingsSidebar.test.ts tests/client/settings/components/SettingsJumpMenu.test.ts
git commit -m "feat(settings): grouped sidebar rail with aria-current + responsive jump menu"
```

---

## Task 4: Group sections into Personal / Integrations / Admin in SettingsApp

**Files:**

- Modify: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/SettingsApp.test.ts` (modify)

`SettingsApp` currently builds a flat `items: SidebarItem[]`. Convert to grouped `SidebarGroup[]` (Personal / Integrations / Admin), pass to the new `SettingsSidebar` + `SettingsJumpMenu`, wrap section runs in `.settings-group` containers, and keep scroll-spy fed by the flattened id list.

- [ ] **Step 1: Update the test to assert grouped rail + admin gating**

Open `tests/client/settings/SettingsApp.test.ts`. Add (keeping existing setup that mutates `settingsSession`):

```ts
test('renders three group kickers for an admin session', async () => {
  // existing helper that sets settingsSession.status='ready', isBotAdmin=true, isSuperAdmin=true, contexts=[...]
  setAdminSession()
  setMockFetch(() => Promise.resolve(json({ fields: [] })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsApp, { target })
  await drain()
  expect(target.textContent).toContain('Personal')
  expect(target.textContent).toContain('Integrations')
  expect(target.textContent).toContain('Admin')
  void unmount(c)
})

test('non-admin session omits the Admin group', async () => {
  setUserSession() // isBotAdmin=false, isSuperAdmin=false
  setMockFetch(() => Promise.resolve(json({ fields: [] })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsApp, { target })
  await drain()
  expect(target.textContent).not.toContain('Admin')
  void unmount(c)
})
```

> If `setAdminSession()`/`setUserSession()` helpers do not exist in the file, inline them by setting `settingsSession.status='ready'`, the role booleans, `contexts=[{ id:'user:1', kind:'user', label:'me' }]`, and `activeContextId='user:1'`, then resetting in `afterEach`. Mirror the existing pattern already used in this test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts`
Expected: FAIL — kickers not rendered (flat rail).

- [ ] **Step 3: Edit `client/settings/SettingsApp.svelte`**

Replace the `items` builder and the markup. Change the import line:

```svelte
  import SettingsSidebar from './components/SettingsSidebar.svelte'
  import type { SidebarGroup } from './components/SettingsSidebar.svelte'
  import SettingsJumpMenu from './components/SettingsJumpMenu.svelte'
```

Replace the `const items = $derived.by(...)` block with grouped builder + flattened ids:

```svelte
  const groups = $derived.by((): SidebarGroup[] => {
    const list: SidebarGroup[] = [
      {
        kicker: 'Personal',
        items: [
          { id: 'profile', label: 'Profile' },
          { id: 'task-provider', label: 'Task provider' },
          { id: 'tools', label: 'Tools' },
          { id: 'identity', label: 'Identity' },
          ...(isGroup
            ? [{ id: 'members', label: 'Members' }, { id: 'group-provider', label: 'Group provider' }]
            : []),
        ],
      },
      {
        kicker: 'Integrations',
        items: [
          { id: 'mcp', label: 'MCP' },
          { id: 'plugins', label: 'Plugins' },
        ],
      },
    ]
    const admin: SidebarGroup = { kicker: 'Admin', danger: true, items: [] }
    if (settingsSession.isBotAdmin) {
      admin.items = [
        { id: 'instances', label: 'Instances' },
        { id: 'system', label: 'System' },
        { id: 'plugin-config', label: 'Plugin config' },
        { id: 'users', label: 'Users' },
        { id: 'groups', label: 'Groups' },
        { id: 'announce', label: 'Announce' },
      ]
    }
    if (settingsSession.isSuperAdmin) {
      admin.items = [...admin.items, { id: 'admins', label: 'Admins' }, { id: 'plugin-approval', label: 'Plugin approval' }]
    }
    if (admin.items.length > 0) list.push(admin)
    return list
  })

  const sectionIds = $derived(groups.flatMap((g) => g.items.map((i) => i.id)))
```

Update the two `$effect` blocks to use `sectionIds` instead of `items.map(...)`:

```svelte
  $effect(() => {
    untrack(() => {
      if (sectionIds.length > 0 && !sectionIds.includes(activeId)) activeId = sectionIds[0]
    })
  })

  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const spy = useScrollSpy(sectionIds, (id) => {
      activeId = id
      if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`)
    })
    void tick().then(() => spy.start())
    return (): void => spy.stop()
  })
```

Update the markup: pass `groups` to the sidebar, add the jump menu above the grid, and wrap the section runs in `.settings-group` containers (Personal / Integrations / Admin). Replace the `{#snippet children()}` body:

```svelte
    {#snippet children()}
      <SettingsJumpMenu {groups} {activeId} />
      <div class="settings-grid">
        <SettingsSidebar {groups} {activeId} />
        <main class="settings-grid__main">
          <div class="settings-group">
            <ProfileSection contextId={ctx} />
            <TaskProviderSection contextId={ctx} />
            <ToolsSection contextId={ctx} />
            <IdentitySection contextId={ctx} />
            {#if isGroup}
              <MembersSection contextId={ctx} />
              <GroupProviderSection contextId={ctx} />
            {/if}
          </div>
          <div class="settings-group">
            <McpSection contextId={ctx} />
            <PluginsSection contextId={ctx} />
          </div>
          {#if settingsSession.isBotAdmin || settingsSession.isSuperAdmin}
            <div class="settings-group settings-group--wide settings-admin-zone">
              {#if settingsSession.isBotAdmin}
                <AdminInstancesSection />
                <AdminSystemSection />
                <AdminPluginsConfigSection />
                <AdminUsersSection />
                <AdminGroupsSection />
                <AdminAnnounceSection />
              {/if}
              {#if settingsSession.isSuperAdmin}
                <AdminAdminsSection />
                <AdminPluginsApprovalSection catalogContextId={ctx} />
              {/if}
            </div>
          {/if}
        </main>
      </div>
    {/snippet}
```

> The `.settings-admin-zone` class is styled in Task 13 (admin danger zone). It is harmless until then.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS, including the existing tests in the file.

- [ ] **Step 5: Run the full client suite to catch regressions in section rendering**

Run: `bun test:client`
Expected: all client tests pass (sections still mount; ids unchanged).

- [ ] **Step 6: Commit**

```bash
git add client/settings/SettingsApp.svelte tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings): group sections into Personal/Integrations/Admin with grouped rail"
```

---

# Phase 2 — Semantics & components

## Task 5: Three-button discipline — collapse Refresh, normalize Provision Kaneo

**Files:**

- Create: `client/shared/ui/IconButton.svelte`
- Modify: `client/settings/sections/ToolsSection.svelte`, `client/settings/sections/admin/AdminSystemSection.svelte`, `client/settings/sections/admin/AdminUsersSection.svelte`, and every other section header currently rendering a `<Btn variant="ghost">Refresh</Btn>` (search them in Step 1)
- Modify: `client/settings/sections/TaskProviderSection.svelte` (Provision Kaneo button width)
- Test: `tests/client/shared/ui/IconButton.test.ts` (create)

The spec mandates exactly three button _roles_: Primary (solid accent), Secondary (outline), Danger. `Btn` already has 5 variants; we keep the component but **constrain usage**: per-section "Refresh" text buttons collapse into a single icon button (`⟳`) in the header; `Provision Kaneo` becomes a normal-width primary button (not full-bleed).

- [ ] **Step 1: Inventory the Refresh buttons and the Provision button**

Run:

```bash
grep -rn "Refresh" client/settings/sections
grep -rn "Provision" client/settings/sections
```

Expected: a list of `<Btn variant="ghost" ...>{loading ? 'Refreshing…' : 'Refresh'}</Btn>` occurrences (ToolsSection, AdminSystemSection, AdminUsersSection, and others) and the Provision Kaneo button in `TaskProviderSection.svelte`. Note each path — they all get the same treatment.

- [ ] **Step 2: Write the failing test for `IconButton`**

`tests/client/shared/ui/IconButton.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import IconButton from '../../../../client/shared/ui/IconButton.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders an accessible labelled icon button and fires onClick', () => {
  let clicked = 0
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(IconButton, {
    target,
    props: {
      label: 'Refresh',
      glyph: '⟳',
      onClick: () => {
        clicked++
      },
      testid: 'rf',
    },
  })
  flushSync()
  const btn = target.querySelector<HTMLButtonElement>('[data-testid="rf"]')!
  expect(btn.getAttribute('aria-label')).toBe('Refresh')
  expect(btn.getAttribute('title')).toBe('Refresh')
  btn.click()
  expect(clicked).toBe(1)
  void unmount(c)
})

test('spins while busy', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(IconButton, { target, props: { label: 'Refresh', glyph: '⟳', busy: true } })
  flushSync()
  expect(target.querySelector('.ui-iconbtn--busy')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/IconButton.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `client/shared/ui/IconButton.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    label: string
    glyph: string
    onClick?: () => void
    busy?: boolean
    testid?: string
  }
  let { label, glyph, onClick, busy = false, testid }: Props = $props()
</script>

<button
  type="button"
  class="ui-iconbtn"
  class:ui-iconbtn--busy={busy}
  aria-label={label}
  title={label}
  data-testid={testid}
  onclick={onClick}>
  {glyph}
</button>

<style>
  .ui-iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 13px;
  }
  .ui-iconbtn:hover { color: var(--text); background: var(--surface-hover); }
  .ui-iconbtn--busy { opacity: 0.6; pointer-events: none; }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 3. Expected: PASS (2 tests).

- [ ] **Step 6: Replace each Refresh `Btn` with the IconButton in section headers**

In every section identified in Step 1, change the `PageHeader` action snippet. Example for `client/settings/sections/admin/AdminUsersSection.svelte` — replace:

```svelte
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => void load()}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
```

with:

```svelte
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="users-refresh" />
    {/snippet}
```

and add the import `import IconButton from '../../../shared/ui/IconButton.svelte'` (adjust depth: sections under `admin/` use `../../../shared/ui/`, top-level sections use `../../shared/ui/`). Remove the now-unused `Btn` import **only if** no other `Btn` remains in that file. Give each `testid` a section-unique prefix (`tools-refresh`, `system-refresh`, …).

> Existing tests asserting the literal text `Refresh`/`Refreshing…` must be updated to assert the icon button by `data-testid` instead. Grep `grep -rn "Refreshing" tests/client/settings` and fix each to `expect(target.querySelector('[data-testid="<section>-refresh"]')).not.toBeNull()`.

- [ ] **Step 7: Normalize the Provision Kaneo button**

In `client/settings/sections/TaskProviderSection.svelte`, find the Provision Kaneo `Btn`. Ensure it is `variant="primary"` and **not** full-width. If a wrapping element forces full width (e.g. a class applying `width: 100%` / `display: block`), wrap the button in a left-aligned flex row so it sizes to content:

```svelte
<div class="provision-actions">
  <Btn variant="primary" testid="provision-kaneo" onClick={() => void provision()}>
    {#snippet children()}Provision Kaneo{/snippet}
  </Btn>
</div>
```

```css
.provision-actions {
  display: flex;
}
```

Remove any `width: 100%`/full-bleed style on that button.

- [ ] **Step 8: Run the affected section tests**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/
```

Expected: PASS (with the Refresh-text assertions updated in Step 6).

- [ ] **Step 9: Commit**

```bash
git add client/shared/ui/IconButton.svelte client/settings/sections tests/client
git commit -m "feat(settings): collapse per-section Refresh to icon button; normalize Provision Kaneo"
```

---

## Task 6: One-meaning-per-green audit — status dots + approval buttons

**Files:**

- Modify: `client/settings/sections/admin/AdminPluginsApprovalSection.svelte` (approve=primary, reject=danger)
- Audit (read-only or minor): `client/settings/sections/admin/AdminInstancesSection.svelte` (uses `StatusPill` — confirm no solid-green pill)
- Test: `tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts` (modify)

`StatusPill` already renders dot+tone (no solid fill) — §6.3 is largely satisfied; this task verifies it and fixes the approval buttons so green means only "primary action".

- [ ] **Step 1: Audit status rendering**

Run:

```bash
grep -rn "Pill" client/settings/sections | grep -iv StatusPill
```

For each non-status `Pill` with `tone="accent"`, confirm it is not representing live/active _state_ (those must use `StatusPill`/`Dot`). The Tools domain-summary pill (`summaryTone` → `accent` for `allow`) is a **permission** indicator, replaced by the segmented control in Task 7 — leave it for now. Document findings in the commit message; no code change unless a solid-green _state_ pill is found.

- [ ] **Step 2: Update the approval-section test**

In `tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`, add:

```ts
test('approve is a primary button and reject is a danger button', async () => {
  setMockFetch(() => Promise.resolve(json(pendingPayload))) // existing fixture with a pending plugin
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
  await drain()
  const approve = target.querySelector('[data-testid^="plugin-approve-"]')!
  const reject = target.querySelector('[data-testid^="plugin-reject-"]')!
  expect(approve.className).toContain('ui-btn--primary')
  expect(reject.className).toContain('ui-btn--danger')
  void unmount(c)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts`
Expected: FAIL if reject currently uses `ghost`/`secondary`.

- [ ] **Step 4: Fix the approval buttons**

In `client/settings/sections/admin/AdminPluginsApprovalSection.svelte`, set the Approve button to `variant="primary"` and the Reject button to `variant="danger"`, with `testid` prefixes `plugin-approve-` / `plugin-reject-` (include the plugin id). Example:

```svelte
<Btn variant="primary" size="sm" testid={`plugin-approve-${p.id}`} onClick={() => void approve(p.id)}>
  {#snippet children()}Approve{/snippet}
</Btn>
<Btn variant="danger" size="sm" testid={`plugin-reject-${p.id}`} onClick={() => void reject(p.id)}>
  {#snippet children()}Reject{/snippet}
</Btn>
```

> Reject gets a confirmation dialog in Task 12; here we only fix the variant.

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/sections/admin/AdminPluginsApprovalSection.svelte tests/client/settings/sections/admin/AdminPluginsApprovalSection.test.ts
git commit -m "feat(settings): approve=primary, reject=danger; audit status pills for green-only-primary"
```

---

## Task 7: Segmented control for the 3-state tool permission

**Files:**

- Create: `client/shared/ui/SegmentedControl.svelte`
- Modify: `client/settings/sections/ToolsSection.svelte`
- Test: `tests/client/shared/ui/SegmentedControl.test.ts` (create)
- Test: `tests/client/settings/sections/ToolsSection.test.ts` (modify)

Keep `allow`/`ask`/`deny`. Replace the three independent `Btn`s with a `role="radiogroup"` segmented control giving a clear selected state and arrow-key/space operability.

- [ ] **Step 1: Write the failing test for `SegmentedControl`**

`tests/client/shared/ui/SegmentedControl.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import SegmentedControl from '../../../../client/shared/ui/SegmentedControl.svelte'

const options = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
]

afterEach(() => {
  document.body.innerHTML = ''
})

test('marks the selected option with aria-checked', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: { options, value: 'ask', ariaLabel: 'Permission', onChange: () => {}, testidPrefix: 'perm' },
  })
  flushSync()
  expect(target.querySelector('[role="radiogroup"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="perm-ask"]')!.getAttribute('aria-checked')).toBe('true')
  expect(target.querySelector('[data-testid="perm-allow"]')!.getAttribute('aria-checked')).toBe('false')
  void unmount(c)
})

test('clicking an option calls onChange with its value', () => {
  let got = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SegmentedControl, {
    target,
    props: {
      options,
      value: 'allow',
      ariaLabel: 'Permission',
      onChange: (v: string) => {
        got = v
      },
      testidPrefix: 'perm',
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="perm-deny"]')!.click()
  expect(got).toBe('deny')
  void unmount(c)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/SegmentedControl.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `client/shared/ui/SegmentedControl.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Option {
    value: string
    label: string
  }
  interface Props {
    options: readonly Option[]
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    testidPrefix?: string
  }
  let { options, value, ariaLabel, onChange, testidPrefix }: Props = $props()

  function onKey(event: KeyboardEvent, index: number): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = options[(index + delta + options.length) % options.length]
    if (next) onChange(next.value)
  }
</script>

<div class="ui-seg" role="radiogroup" aria-label={ariaLabel}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === opt.value ? 'true' : 'false'}
      tabindex={value === opt.value ? 0 : -1}
      class="ui-seg__opt"
      class:ui-seg__opt--on={value === opt.value}
      data-testid={testidPrefix ? `${testidPrefix}-${opt.value}` : undefined}
      onclick={() => onChange(opt.value)}
      onkeydown={(e) => onKey(e, i)}>
      {opt.label}
    </button>
  {/each}
</div>

<style>
  .ui-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .ui-seg__opt {
    background: var(--surface-2);
    border: 0;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 12px;
    height: 26px;
  }
  .ui-seg__opt:last-child { border-right: 0; }
  .ui-seg__opt:hover { color: var(--text); background: var(--surface-hover); }
  .ui-seg__opt--on {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (2 tests).

- [ ] **Step 5: Update the ToolsSection test for the segmented control**

In `tests/client/settings/sections/ToolsSection.test.ts`, replace any assertions referencing `tool-perm-allow-…`/`tool-perm-ask-…`/`tool-perm-deny-…` buttons-with-`primary`-variant with segmented-control assertions:

```ts
test('per-tool permission renders a segmented control with the active state checked', async () => {
  setMockFetch(() => Promise.resolve(json(toolsPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-task"]')!.click()
  flushSync()
  const allow = target.querySelector('[data-testid="tool-perm-create_task-allow"]')!
  expect(allow.getAttribute('aria-checked')).toBe('true')
  expect(target.querySelector('[data-testid="tool-perm-delete_task-deny"]')!.getAttribute('aria-checked')).toBe('true')
  void unmount(component)
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/ToolsSection.test.ts`
Expected: FAIL — segmented control not yet wired (old buttons present).

- [ ] **Step 7: Wire the segmented control into `ToolsSection.svelte`**

Add import: `import SegmentedControl from '../../shared/ui/SegmentedControl.svelte'`. Define the option list once in the script:

```svelte
  const PERM_OPTIONS = [
    { value: 'allow', label: 'Allow' },
    { value: 'ask', label: 'Ask' },
    { value: 'deny', label: 'Deny' },
  ] as const
```

Replace the per-tool `settings-tools__perm-group` block (the three `<Btn>`s) with:

```svelte
                  <div class="settings-tools__perm">
                    <SegmentedControl
                      options={PERM_OPTIONS}
                      value={tool.permission}
                      ariaLabel={`Permission for ${tool.name}`}
                      onChange={(p) => void onSetToolPermission(tool.name, p as ToolPermission)}
                      testidPrefix={`tool-perm-${tool.name}`} />
                  </div>
```

Add CSS:

```css
.settings-tools__perm {
  margin-left: auto;
}
```

Remove the now-unused `.settings-tools__perm-group` style. Keep the domain-level "Allow all/Ask all/Deny all" cycle `Btn` as-is (it is a single action, acceptable), or optionally also swap to a SegmentedControl driven by `onSetDomainPermission` — not required for acceptance.

- [ ] **Step 8: Run test to verify it passes**

Run: same as Step 6. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/shared/ui/SegmentedControl.svelte client/settings/sections/ToolsSection.svelte tests/client/shared/ui/SegmentedControl.test.ts tests/client/settings/sections/ToolsSection.test.ts
git commit -m "feat(settings): segmented control for 3-state tool permissions"
```

---

## Task 8: Standardize secret-field mask + secondary Replace button

**Files:**

- Create: `client/settings/lib/mask-secret.ts`
- Modify: `client/shared/ui/Secret.svelte` (apply normalized mask)
- Modify: `client/settings/components/ConfigFieldRow.svelte` (Replace = secondary, not ghost)
- Test: `tests/client/settings/lib/mask-secret.test.ts` (create)
- Test: `tests/client/settings/components/ConfigFieldRow.test.ts` (modify)

The server returns masked secrets like `****WvfQ`. Spec §5.2 wants bullet masking `••••WvfQ` and a secondary-styled Replace button.

- [ ] **Step 1: Write the failing test for `maskSecret`**

`tests/client/settings/lib/mask-secret.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { maskSecret } from '../../../../client/settings/lib/mask-secret.js'

describe('maskSecret', () => {
  test('converts leading asterisks to bullets, keeps the tail', () => {
    expect(maskSecret('****WvfQ')).toBe('••••WvfQ')
    expect(maskSecret('****d2a0')).toBe('••••d2a0')
  })
  test('replaces any asterisk run with bullets', () => {
    expect(maskSecret('ab**cd')).toBe('ab••cd')
  })
  test('passes through values with no asterisks', () => {
    expect(maskSecret('plain')).toBe('plain')
  })
  test('handles empty string', () => {
    expect(maskSecret('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/lib/mask-secret.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `client/settings/lib/mask-secret.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Normalize server-side secret masking (`****WvfQ`) to the bullet form (`••••WvfQ`). */
export function maskSecret(value: string): string {
  return value.replace(/\*/g, '•')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (4 tests).

- [ ] **Step 5: Apply the mask in `Secret.svelte`**

Edit `client/shared/ui/Secret.svelte`. Import the util and render the normalized value. Since `Secret` lives in `client/shared/ui/` but the util is settings-scoped, move the masking into the caller to avoid a shared→settings import. Instead: in `ConfigFieldRow.svelte` and `AdminSystemSection.svelte`, pass `value={maskSecret(field.value)}`. Leave `Secret.svelte` unchanged in masking logic but change its default placeholder to bullets if not already (`'••••••••'` — already correct).

> Decision: do **not** import settings code into `client/shared/`. Masking is applied at the call sites.

- [ ] **Step 6: Update `ConfigFieldRow.svelte`**

Add import `import { maskSecret } from '../lib/mask-secret.js'`. Change the `<Secret>` usage and the Replace button variant:

```svelte
    {#if field.sensitive && field.hasValue && !replacing}
      <Secret value={maskSecret(field.value)} />
      <Btn variant="secondary" size="sm" testid={`cfg-replace-${field.key}`} onClick={() => (replacing = true)}>
        {#snippet children()}Replace{/snippet}
      </Btn>
    {/if}
```

Also change the field label to the standardized class: replace `<span class="settings-field__label">` with `<span class="t-label settings-field__label">` (keeps layout class, adopts the contrast/case token).

- [ ] **Step 7: Update the ConfigFieldRow test**

In `tests/client/settings/components/ConfigFieldRow.test.ts`, add:

```ts
test('renders bullet-masked secret and a secondary Replace button', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const field = { key: 'token', label: 'Token', value: '****WvfQ', sensitive: true, hasValue: true, required: false }
  const c = mount(ConfigFieldRow, { target, props: { contextId: 'user:1', field, onSaved: () => {} } })
  flushSync()
  expect(target.textContent).toContain('••••WvfQ')
  expect(target.querySelector('[data-testid="cfg-replace-token"]')!.className).toContain('ui-btn--secondary')
  void unmount(c)
})
```

Adjust the `field` literal to match the actual `ConfigField` type shape in `client/settings/fetcher-schemas.ts` (read it first; add any required keys).

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/ConfigFieldRow.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/settings/lib/mask-secret.ts client/settings/components/ConfigFieldRow.svelte tests/client/settings/lib/mask-secret.test.ts tests/client/settings/components/ConfigFieldRow.test.ts
git commit -m "feat(settings): bullet-mask secrets and use secondary Replace button"
```

---

# Phase 3 — Density & data

## Task 9: System (LLM) compact key/value inline-edit table

**Files:**

- Create: `client/settings/components/SystemKvRow.svelte`
- Modify: `client/settings/sections/admin/AdminSystemSection.svelte`
- Test: `tests/client/settings/components/SystemKvRow.test.ts` (create)
- Test: `tests/client/settings/sections/admin/AdminSystemSection.test.ts` (modify)

Replace the five large cards (each with a standing "enter a new value" input) with a compact table: `key | current value (masked if secret) | Edit`. Edit reveals an inline input + Save/Cancel for that row only.

- [ ] **Step 1: Write the failing test for `SystemKvRow`**

`tests/client/settings/components/SystemKvRow.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import SystemKvRow from '../../../../client/settings/components/SystemKvRow.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('shows masked value for a secret key and no input until Edit', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: { keyName: 'llm_apikey', value: '****d2a0', sensitive: true, onSave: () => {} },
  })
  flushSync()
  expect(target.textContent).toContain('••••d2a0')
  expect(target.querySelector('[data-testid="system-input-llm_apikey"]')).toBeNull()
  void unmount(c)
})

test('Edit reveals an input and Save emits the draft', async () => {
  let saved = ''
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SystemKvRow, {
    target,
    props: {
      keyName: 'main_model',
      value: 'gpt',
      sensitive: false,
      onSave: (v: string) => {
        saved = v
      },
    },
  })
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-main_model"]')!.click()
  flushSync()
  const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
  input.value = 'claude'
  input.dispatchEvent(new Event('input'))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
  expect(saved).toBe('claude')
  void unmount(c)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SystemKvRow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `client/settings/components/SystemKvRow.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import { maskSecret } from '../lib/mask-secret.js'

  interface Props {
    keyName: string
    value: string | null
    sensitive: boolean
    onSave: (value: string) => void
  }
  let { keyName, value, sensitive, onSave }: Props = $props()

  let editing = $state(false)
  let draft = $state('')

  const display = $derived(value === null ? null : sensitive ? maskSecret(value) : value)

  function start(): void { editing = true; draft = '' }
  function cancel(): void { editing = false; draft = '' }
  function save(): void {
    if (draft.trim() === '') return
    onSave(draft)
    editing = false
    draft = ''
  }
</script>

<tr class="kv-row" data-testid={`system-row-${keyName}`}>
  <td class="kv-row__key t-mono-data">{keyName}</td>
  <td class="kv-row__val">
    {#if editing}
      <Input
        type={sensitive ? 'password' : 'text'}
        value={draft}
        placeholder="enter a new value"
        onInput={(v) => (draft = v)}
        testid={`system-input-${keyName}`} />
    {:else if display === null}
      <span class="placeholder">unset</span>
    {:else}
      <span class="t-mono-data">{display}</span>
    {/if}
  </td>
  <td class="kv-row__action">
    {#if editing}
      <Btn variant="primary" size="sm" testid={`system-save-${keyName}`} onClick={save}>
        {#snippet children()}Save{/snippet}
      </Btn>
      <Btn variant="secondary" size="sm" testid={`system-cancel-${keyName}`} onClick={cancel}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    {:else}
      <Btn variant="secondary" size="sm" testid={`system-edit-${keyName}`} onClick={start}>
        {#snippet children()}Edit{/snippet}
      </Btn>
    {/if}
  </td>
</tr>

<style>
  .kv-row__key { color: var(--text-muted); padding: 8px 12px; white-space: nowrap; vertical-align: middle; }
  .kv-row__val { padding: 8px 12px; vertical-align: middle; }
  .kv-row__action { padding: 8px 12px; text-align: right; white-space: nowrap; display: flex; gap: 6px; justify-content: flex-end; }
  .kv-row { border-bottom: 1px solid var(--border); }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (2 tests).

- [ ] **Step 5: Update the AdminSystemSection test**

In `tests/client/settings/sections/admin/AdminSystemSection.test.ts`, replace assertions that expect a standing per-key input (`system-input-*` always present) with the table form: assert rows render with `system-edit-*`, and that editing one row does not reveal another's input. Example:

```ts
test('renders one kv table with Edit per key and no standing inputs', async () => {
  setMockFetch(() =>
    Promise.resolve(json({ config: { main_model: { value: 'gpt' }, llm_apikey: { value: '****d2a0' } } })),
  )
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(AdminSystemSection, { target })
  await drain()
  expect(target.querySelector('[data-testid="system-edit-main_model"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="system-input-main_model"]')).toBeNull()
  target.querySelector<HTMLButtonElement>('[data-testid="system-edit-main_model"]')!.click()
  flushSync()
  expect(target.querySelector('[data-testid="system-input-main_model"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="system-input-llm_apikey"]')).toBeNull()
  void unmount(c)
})
```

Adjust the mock `config` shape to match `AdminSystemResponse` in `client/settings/fetcher-schemas.ts` (read it; the existing test already has a valid fixture to copy).

- [ ] **Step 6: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminSystemSection.test.ts`
Expected: FAIL — table not present.

- [ ] **Step 7: Rewrite the body of `AdminSystemSection.svelte`**

Keep the script's `load`/`save` logic but change `save` to accept a value param and render the table. Replace the `SENSITIVE_SYSTEM_KEYS`-driven card list with:

```svelte
<script lang="ts">
  import { fetchAdminSystem, submitAdminSystem } from '../../admin-fetchers.js'
  import type { AdminSystemResponse } from '../../fetcher-schemas.js'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import SystemKvRow from '../../components/SystemKvRow.svelte'

  const SENSITIVE_SYSTEM_KEYS = new Set<string>(['llm_apikey'])

  let config: AdminSystemResponse['config'] = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  const keys = $derived(Object.keys(config))

  async function load(): Promise<void> {
    error = null; status = null; loading = true
    try { config = (await fetchAdminSystem()).config }
    catch (err) { error = err instanceof Error ? err.message : String(err) }
    finally { loading = false }
  }

  async function save(key: string, value: string): Promise<void> {
    error = null; status = null
    try {
      await submitAdminSystem({ key, value })
      await load()
      status = `${key} updated.`
    } catch (err) { error = err instanceof Error ? err.message : String(err) }
  }

  $effect(() => { void load() })
</script>

<section id="system" class="settings-section">
  <PageHeader eyebrow="Admin · System" title="System (LLM)">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="system-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <table class="system-kv">
    <thead>
      <tr><th class="t-label">Key</th><th class="t-label">Value</th><th class="t-label system-kv__th-action">Action</th></tr>
    </thead>
    <tbody>
      {#each keys as key (key)}
        <SystemKvRow
          keyName={key}
          value={config[key]?.value ?? null}
          sensitive={SENSITIVE_SYSTEM_KEYS.has(key)}
          onSave={(v) => void save(key, v)} />
      {/each}
    </tbody>
  </table>
</section>

<style>
  .system-kv { width: 100%; border-collapse: collapse; font-family: var(--font-mono); }
  .system-kv th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .system-kv__th-action { text-align: right; }
</style>
```

- [ ] **Step 8: Run test to verify it passes**

Run: same as Step 6. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add client/settings/components/SystemKvRow.svelte client/settings/sections/admin/AdminSystemSection.svelte tests/client/settings/components/SystemKvRow.test.ts tests/client/settings/sections/admin/AdminSystemSection.test.ts
git commit -m "feat(settings): compact System (LLM) kv inline-edit table"
```

---

## Task 10: Instances — separate Add-instance card from the table

**Files:**

- Modify: `client/settings/sections/admin/AdminInstancesSection.svelte`
- Test: `tests/client/settings/sections/admin/AdminInstancesSection.test.ts` (modify)

Wrap each create form in a bordered `.instance-create` card with a subhead "Add platform instance" / "Add task instance" and a `+ Create` primary button; render the list below as a single labeled `DataTable`. The duplicate column-header confusion goes away because headers appear only on the table.

- [ ] **Step 1: Update the test**

In `tests/client/settings/sections/admin/AdminInstancesSection.test.ts`, add:

```ts
test('separates the add-instance card from the instances table', async () => {
  setMockFetch(instancesMock) // existing fixture returning instances + provider types
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(AdminInstancesSection, { target })
  await drain()
  expect(target.querySelector('[data-testid="platform-create-card"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="platform-create"]')).not.toBeNull() // + Create button
  // create card has no STATUS column header; the table does
  const card = target.querySelector('[data-testid="platform-create-card"]')!
  expect(card.textContent).not.toContain('STATUS')
  void unmount(c)
})
```

Use/adjust the file's existing instances fixture (`instancesMock`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminInstancesSection.test.ts`
Expected: FAIL — `platform-create-card` not present.

- [ ] **Step 3: Edit `AdminInstancesSection.svelte` markup**

For each of the platform and task blocks, wrap the create form in a card and add a subhead + primary `+ Create` button. Example for the platform block (mirror for task):

```svelte
  <div class="instance-create" data-testid="platform-create-card">
    <div class="t-subhead">Add platform instance</div>
    <div class="settings-form">
      <Field label="ID">
        {#snippet children()}<Input value={platformId} onInput={(v) => (platformId = v)} testid="platform-id" />{/snippet}
      </Field>
      <Field label="Type">
        {#snippet children()}
          <Select value={platformType} options={platformTypes.map((t) => ({ value: t.type, label: t.type }))} onChange={(v) => (platformType = v)} />
        {/snippet}
      </Field>
      {#each selectedPlatformType?.instanceConfigSchema ?? [] as f (f.key)}
        <Field label={f.label}>
          {#snippet children()}<Input value={platformConfig[f.key] ?? ''} onInput={(v) => (platformConfig[f.key] = v)} />{/snippet}
        </Field>
      {/each}
      <Btn variant="primary" testid="platform-create" onClick={() => void createPlatform()}>
        {#snippet children()}+ Create{/snippet}
      </Btn>
    </div>
  </div>
```

Below each create card, keep the existing `DataTable` of instances (with its `StatusPill` status column). Ensure the table has a clear subhead too: `<div class="t-subhead">Platform instances</div>` directly above the table.

Add CSS:

```css
.instance-create {
  border: 1px solid var(--border);
  background: var(--surface-1);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: var(--gap-field);
}
```

> Match the actual existing field/markup in the file — read it fully first; reuse the existing `createPlatform`/`createTask`/`collectConfig` handlers and `platformConfig`/`taskConfig` state. Only the wrapping/heading/button changes.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS. Also run the full file to confirm create/delete flows still pass.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/admin/AdminInstancesSection.svelte tests/client/settings/sections/admin/AdminInstancesSection.test.ts
git commit -m "feat(settings): separate instance create-card from instances table"
```

---

## Task 11: Reusable `SettingsTable` — search + pagination + sticky header + hover

**Files:**

- Create: `client/settings/components/SettingsTable.svelte`
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte` (adopt it)
- Test: `tests/client/settings/components/SettingsTable.test.ts` (create)

A settings-scoped wrapper over the shared `DataTable` adding a live search input, client-side pagination (page size 25), a capped-height sticky-header scroll container, and row hover. Reused by Users, Groups, Admins, Plugin approval.

- [ ] **Step 1: Write the failing test**

`tests/client/settings/components/SettingsTable.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import SettingsTable from '../../../../client/settings/components/SettingsTable.svelte'

interface Row extends Record<string, unknown> {
  id: string
  name: string
}
const columns = [
  { key: 'id' as const, label: 'ID' },
  { key: 'name' as const, label: 'Name' },
]
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `n${i}` }))

afterEach(() => {
  document.body.innerHTML = ''
})

test('paginates at the default page size of 25', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
  flushSync()
  // 25 data rows visible (header excluded)
  expect(target.querySelectorAll('tbody tr').length).toBe(25)
  expect(target.querySelector('[data-testid="settings-table-next"]')).not.toBeNull()
  void unmount(c)
})

test('search filters visible rows live', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsTable, { target, props: { columns, rows, rowKey: 'id', searchKeys: ['id', 'name'] } })
  flushSync()
  const search = target.querySelector<HTMLInputElement>('[data-testid="settings-table-search"]')!
  search.value = 'n29'
  search.dispatchEvent(new Event('input'))
  flushSync()
  expect(target.querySelectorAll('tbody tr').length).toBe(1)
  expect(target.textContent).toContain('n29')
  void unmount(c)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SettingsTable.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `client/settings/components/SettingsTable.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  import DataTable from '../../shared/ui/DataTable.svelte'
  import Input from '../../shared/ui/Input.svelte'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: 'left' | 'right' | 'center'
    width?: string
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
  }
  let { columns, rows, rowKey, searchKeys, cell, empty, pageSize = 25, searchPlaceholder = 'Search…' }: Props = $props()

  let query = $state('')
  let page = $state(0)

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)))
  })
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)))
  const clampedPage = $derived(Math.min(page, pageCount - 1))
  const pageRows = $derived(filtered.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize))

  function onSearch(v: string): void { query = v; page = 0 }
</script>

<div class="settings-table">
  <div class="settings-table__toolbar">
    <Input type="search" value={query} placeholder={searchPlaceholder} onInput={onSearch} testid="settings-table-search" />
    <span class="t-help">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
  </div>
  <div class="settings-table__scroll">
    <DataTable {columns} rows={pageRows} {cell} {rowKey} {empty} />
  </div>
  {#if pageCount > 1}
    <div class="settings-table__pager">
      <button type="button" data-testid="settings-table-prev" disabled={clampedPage === 0} onclick={() => (page = clampedPage - 1)}>‹ Prev</button>
      <span class="t-help">Page {clampedPage + 1} / {pageCount}</span>
      <button type="button" data-testid="settings-table-next" disabled={clampedPage >= pageCount - 1} onclick={() => (page = clampedPage + 1)}>Next ›</button>
    </div>
  {/if}
</div>

<style>
  .settings-table { display: flex; flex-direction: column; gap: 10px; }
  .settings-table__toolbar { display: flex; align-items: center; gap: 12px; }
  .settings-table__toolbar :global(.ui-input) { flex: 1; max-width: 320px; }
  .settings-table__scroll { max-height: 560px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  .settings-table__scroll :global(thead th) {
    position: sticky; top: 0; z-index: 1;
    background: var(--surface-2);
  }
  .settings-table__scroll :global(tbody tr:hover) { background: var(--surface-hover); }
  .settings-table__pager { display: flex; align-items: center; gap: 12px; }
  .settings-table__pager button {
    background: transparent; border: 1px solid var(--border); border-radius: var(--radius);
    color: var(--text); font-family: var(--font-mono); font-size: 12px; padding: 4px 10px; cursor: pointer;
  }
  .settings-table__pager button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (2 tests).

- [ ] **Step 5: Adopt `SettingsTable` in `AdminUsersSection.svelte`**

Replace the `<DataTable …>` block (inside `.settings-table-wrap`) with `SettingsTable`, keeping the existing `cell` snippet and `userColumns`/`userRows`:

```svelte
  <SettingsTable
    columns={userColumns}
    rows={userRows}
    rowKey="platform_user_id"
    searchKeys={['platform_user_id', 'username']}
    {cell}
    searchPlaceholder="Search users by ID or name…">
    {#snippet empty()}No users{/snippet}
  </SettingsTable>
```

Add import `import SettingsTable from '../../components/SettingsTable.svelte'`; remove the now-unused `DataTable` import if nothing else uses it.

- [ ] **Step 6: Update the Users test**

In `tests/client/settings/sections/admin/AdminUsersSection.test.ts`, add an assertion that a search box renders (`[data-testid="settings-table-search"]`). Existing "lists users" test still passes (single user fits on page 1).

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminUsersSection.test.ts tests/client/settings/components/SettingsTable.test.ts
```

Expected: PASS.

- [ ] **Step 8: Apply `SettingsTable` to Groups, Admins, Plugin approval**

Repeat Step 5 for `AdminGroupsSection.svelte`, `AdminAdminsSection.svelte`, and `AdminPluginsApprovalSection.svelte` wherever a raw `DataTable` lists rows. Use appropriate `searchKeys` (group key/label; admin id; plugin id/name). Update each section's test to assert the search box renders. Commit-blocking only if those sections currently use `DataTable`; if a section uses a bespoke list, convert it to `SettingsTable` with a matching `columns` definition.

- [ ] **Step 9: Commit**

```bash
git add client/settings/components/SettingsTable.svelte client/settings/sections/admin tests/client/settings
git commit -m "feat(settings): reusable SettingsTable with search, pagination, sticky header, hover"
```

---

## Task 12: Destructive confirmations + long-ID truncation/copy

**Files:**

- Create: `client/settings/lib/truncate-middle.ts`
- Create: `client/shared/ui/CopyButton.svelte`
- Create: `client/settings/components/IdCell.svelte`
- Modify: `client/shared/Confirm.svelte` (danger-styled confirm button)
- Modify: `client/settings/sections/admin/AdminUsersSection.svelte` (confirm before remove; IdCell for the ID column)
- Modify: other destructive call sites (instances delete/stop, plugin reject, groups/admins remove)
- Test: `tests/client/settings/lib/truncate-middle.test.ts`, `tests/client/shared/ui/CopyButton.test.ts`, `tests/client/settings/components/IdCell.test.ts` (create)
- Test: `tests/client/settings/sections/admin/AdminUsersSection.test.ts` (modify)

- [ ] **Step 1: Write the failing test for `truncateMiddle`**

`tests/client/settings/lib/truncate-middle.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { truncateMiddle } from '../../../../client/settings/lib/truncate-middle.js'

describe('truncateMiddle', () => {
  test('keeps short values intact', () => {
    expect(truncateMiddle('short', 8, 8)).toBe('short')
  })
  test('middle-truncates long values with an ellipsis', () => {
    // 27-char id, head=6 ('psid0Y') + '…' + tail=6 ('nQshTg')
    expect(truncateMiddle('psid0YeZWdyYW0tZGVv2MnQshTg', 6, 6)).toBe('psid0Y…nQshTg')
  })
  test('uses default head/tail of 8', () => {
    const v = 'placeholder-4d1e563d-0190-aaaa-bbbb-cccccccccccc'
    const out = truncateMiddle(v)
    expect(out.startsWith('placehol')).toBe(true)
    expect(out.includes('…')).toBe(true)
    expect(out.endsWith('cccccccc')).toBe(true)
  })
})
```

> The second assertion encodes the exact rule head=6/tail=6 over the 27-char id: `psid0Y` + `…` + `nQshTg`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/lib/truncate-middle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `client/settings/lib/truncate-middle.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Middle-truncate a long identifier: keep `head` leading and `tail` trailing chars, join with an ellipsis. */
export function truncateMiddle(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2. Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `CopyButton`**

`tests/client/shared/ui/CopyButton.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import CopyButton from '../../../../client/shared/ui/CopyButton.svelte'

let copied: string | null = null
const originalClipboard = navigator.clipboard

afterEach(() => {
  copied = null
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true })
  document.body.innerHTML = ''
})

test('copies the value to the clipboard on click', () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (v: string) => {
        copied = v
        return Promise.resolve()
      },
    },
    configurable: true,
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(CopyButton, { target, props: { value: 'full-secret-id', label: 'Copy ID' } })
  flushSync()
  target.querySelector<HTMLButtonElement>('button')!.click()
  expect(copied).toBe('full-secret-id')
  void unmount(c)
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/CopyButton.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Create `client/shared/ui/CopyButton.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    value: string
    label?: string
  }
  let { value, label = 'Copy' }: Props = $props()
  let done = $state(false)

  function copy(): void {
    void navigator.clipboard?.writeText(value)
    done = true
  }
</script>

<button type="button" class="ui-copy" aria-label={label} title={label} onclick={copy}>
  {done ? '✓' : '⧉'}
</button>

<style>
  .ui-copy {
    background: transparent; border: 0; cursor: pointer;
    color: var(--text-dim); font-family: var(--font-mono); font-size: 12px; padding: 2px 4px;
  }
  .ui-copy:hover { color: var(--text); }
</style>
```

- [ ] **Step 8: Run test to verify it passes**

Run: same as Step 6. Expected: PASS.

- [ ] **Step 9: Write the failing test for `IdCell`**

`tests/client/settings/components/IdCell.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'
import IdCell from '../../../../client/settings/components/IdCell.svelte'

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders truncated text with the full value in title and a copy button', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const full = 'placeholder-4d1e563d-0190-aaaa-bbbb-cccccccccccc'
  const c = mount(IdCell, { target, props: { value: full } })
  flushSync()
  const span = target.querySelector('.id-cell__value')!
  expect(span.getAttribute('title')).toBe(full)
  expect(span.textContent).toContain('…')
  expect(target.querySelector('.ui-copy')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/IdCell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 11: Create `client/settings/components/IdCell.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import CopyButton from '../../shared/ui/CopyButton.svelte'
  import { truncateMiddle } from '../lib/truncate-middle.js'

  interface Props {
    value: string
    head?: number
    tail?: number
  }
  let { value, head = 8, tail = 8 }: Props = $props()
  const shown = $derived(truncateMiddle(value, head, tail))
</script>

<span class="id-cell">
  <span class="id-cell__value t-mono-data" title={value}>{shown}</span>
  <CopyButton {value} label="Copy ID" />
</span>

<style>
  .id-cell { display: inline-flex; align-items: center; gap: 6px; }
  .id-cell__value { color: var(--text-muted); }
</style>
```

- [ ] **Step 12: Run test to verify it passes**

Run: same as Step 10. Expected: PASS.

- [ ] **Step 13: Add a `danger` prop to `Confirm.svelte`**

Edit `client/shared/Confirm.svelte` to render the confirm button via `Btn` with a `danger` variant when `danger` is set. Add `danger?: boolean` to `Props` (default false) and replace the footer:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Btn from './ui/Btn.svelte'
  import Modal from './Modal.svelte'

  interface Props {
    open: boolean
    title: string
    onCancel: () => void
    onConfirm: () => void
    body: Snippet
    cancelLabel?: string
    confirmLabel?: string
    danger?: boolean
  }
  let { open, title, onCancel, onConfirm, body, cancelLabel, confirmLabel, danger = false }: Props = $props()
  const resolvedCancelLabel = $derived(cancelLabel ?? 'Cancel')
  const resolvedConfirmLabel = $derived(confirmLabel ?? 'Confirm')
</script>

<Modal {open} {title} onClose={onCancel} {body} size="sm">
  {#snippet footer()}
    <Btn variant="secondary" onClick={onCancel}>{#snippet children()}{resolvedCancelLabel}{/snippet}</Btn>
    <Btn variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{#snippet children()}{resolvedConfirmLabel}{/snippet}</Btn>
  {/snippet}
</Modal>
```

Check existing callers of `Confirm` (`grep -rn "Confirm" client`) — `cancelLabel`/`confirmLabel` are now optional; any caller passing `undefined` explicitly still works. Update `tests/client/shared/Confirm.test.ts` if it asserts raw `<button>` elements — switch to asserting `.ui-btn--danger` when `danger` is passed.

- [ ] **Step 14: Wire confirmation + IdCell into `AdminUsersSection.svelte`**

Add confirm state and the `Confirm` dialog; route `remove` through it; render the ID column with `IdCell`.

Script additions:

```svelte
  import Confirm from '../../../shared/Confirm.svelte'
  import IdCell from '../../components/IdCell.svelte'

  let pendingRemoval: string | null = $state(null)

  function confirmRemove(userId: string): void { pendingRemoval = userId }
  async function doRemove(): Promise<void> {
    const id = pendingRemoval
    pendingRemoval = null
    if (id === null) return
    await remove(id) // existing remove()
  }
```

In the `cell` snippet, render the ID column via `IdCell` and route the action button to `confirmRemove`:

```svelte
    {#snippet cell(row: UserRow, col: { key: string; label: string })}
      {#if col.key === 'actions'}
        <Btn variant="danger" size="sm" testid={`user-remove-${row.platform_user_id}`} onClick={() => confirmRemove(row.platform_user_id)}>
          {#snippet children()}Remove{/snippet}
        </Btn>
      {:else if col.key === 'platform_user_id'}
        <IdCell value={row.platform_user_id} />
      {:else}
        {String(row[col.key as keyof UserRow] ?? '')}
      {/if}
    {/snippet}
```

After the table, add the dialog:

```svelte
  <Confirm
    open={pendingRemoval !== null}
    title="Remove user"
    danger
    confirmLabel="Remove"
    onCancel={() => (pendingRemoval = null)}
    onConfirm={() => void doRemove()}>
    {#snippet body()}<p>Remove user {pendingRemoval}? This cannot be undone.</p>{/snippet}
  </Confirm>
```

- [ ] **Step 15: Update the Users test for confirmation**

In `tests/client/settings/sections/admin/AdminUsersSection.test.ts`, change the remove test: clicking `user-remove-…` must **not** fire the DELETE immediately; it opens the dialog; only the dialog's confirm triggers DELETE.

```ts
test('remove requires confirmation before DELETE fires', async () => {
  setCsrfToken('c')
  setMockFetch(captureUsersMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(AdminUsersSection, { target })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
  flushSync()
  expect(capturedDeleteBody).toBeUndefined() // not yet
  // confirm dialog open → click the danger confirm button
  const confirm = target.querySelector<HTMLButtonElement>('.ui-btn--danger')!
  confirm.click()
  await drain()
  expect(capturedDeleteBody).toContain('42')
  void unmount(c)
})
```

> The first matched `.ui-btn--danger` may be the row Remove button; scope the confirm-button query to the modal: `target.querySelector('.modal .ui-btn--danger')`.

- [ ] **Step 16: Run tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/lib/truncate-middle.test.ts tests/client/shared/ui/CopyButton.test.ts tests/client/settings/components/IdCell.test.ts tests/client/settings/sections/admin/AdminUsersSection.test.ts tests/client/shared/Confirm.test.ts
```

Expected: PASS.

- [ ] **Step 17: Apply the same confirm + IdCell pattern to remaining destructive sites**

For each destructive action, route through `Confirm danger` and render long ids via `IdCell`:

- `AdminInstancesSection.svelte`: delete platform/task instance, and the stop action (status → stopped).
- `AdminPluginsApprovalSection.svelte`: Reject (already danger variant from Task 6) → confirm dialog.
- `AdminGroupsSection.svelte`, `AdminAdminsSection.svelte`: remove actions.
  Add/extend each section's test with a "requires confirmation" assertion mirroring Step 15.

- [ ] **Step 18: Commit**

```bash
git add client/settings/lib/truncate-middle.ts client/shared/ui/CopyButton.svelte client/settings/components/IdCell.svelte client/shared/Confirm.svelte client/settings/sections/admin tests/client
git commit -m "feat(settings): destructive confirmations + middle-truncated copyable IDs"
```

---

# Phase 4 — Admin gating & polish

## Task 13: Admin danger zone + confirm steps for Announce and secret keys

**Files:**

- Modify: `client/settings/settings.css` (`.settings-admin-zone` styling)
- Modify: `client/settings/sections/admin/AdminAnnounceSection.svelte` (confirm before broadcast)
- Modify: `client/settings/components/SystemKvRow.svelte` (confirm before saving a secret key)
- Test: `tests/client/settings/sections/admin/AdminAnnounceSection.test.ts` (modify)
- Test: `tests/client/settings/components/SystemKvRow.test.ts` (modify)

The Admin group already lives in a `.settings-admin-zone` wrapper (Task 4) and carries the rail danger badge (Task 3). Now add the visual danger divider and require confirmation for the two highest-blast-radius actions.

- [ ] **Step 1: Add the danger-zone style**

Append to `client/settings/settings.css`:

```css
.settings-admin-zone {
  position: relative;
  padding-top: var(--gap-section);
  border-top: 1px solid var(--danger);
}
.settings-admin-zone::before {
  content: 'ADMIN';
  position: absolute;
  top: -10px;
  left: 0;
  background: var(--bg);
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 0 8px;
}
```

No test needed for static CSS beyond the existing `settings-css.test.ts`; add one assertion there:

```ts
test('admin zone has a danger divider', () => {
  expect(css).toContain('.settings-admin-zone')
})
```

Run `tests/client/settings/settings-css.test.ts` → PASS.

- [ ] **Step 2: Write the failing test for Announce confirmation**

In `tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`:

```ts
test('announce requires confirmation before sending', async () => {
  setCsrfToken('c')
  let posted = false
  setMockFetch((url: string, init: RequestInit) => {
    if (url.includes('/admin/announce') && init.method === 'POST') {
      posted = true
      return Promise.resolve(json({ successCount: 1, failCount: 0, totalUsers: 1 }))
    }
    return Promise.resolve(json({}))
  })
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(AdminAnnounceSection, { target })
  await drain()
  const input = target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!
  input.value = 'hello all'
  input.dispatchEvent(new Event('input'))
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="announce-send"]')!.click()
  flushSync()
  expect(posted).toBe(false) // dialog first
  target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
  await drain()
  expect(posted).toBe(true)
  void unmount(c)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/sections/admin/AdminAnnounceSection.test.ts`
Expected: FAIL — broadcast fires immediately.

- [ ] **Step 4: Add the confirm step to `AdminAnnounceSection.svelte`**

The form submit now opens a confirm dialog; the dialog's confirm calls `send()`. Add:

```svelte
  import Confirm from '../../../shared/Confirm.svelte'

  let confirming = $state(false)

  function requestSend(): void {
    if (message.trim() === '') return
    confirming = true
  }
  async function confirmedSend(): Promise<void> {
    confirming = false
    await send() // existing send()
  }
```

Change the form `onsubmit` to `requestSend()` instead of `send()`, and add the dialog:

```svelte
  <Confirm
    open={confirming}
    title="Broadcast to all users"
    danger
    confirmLabel="Send to everyone"
    onCancel={() => (confirming = false)}
    onConfirm={() => void confirmedSend()}>
    {#snippet body()}<p>This sends the message to every user. Continue?</p>{/snippet}
  </Confirm>
```

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 3. Expected: PASS.

- [ ] **Step 6: Add confirmation for secret-key saves in `SystemKvRow.svelte`**

Gate `save()` behind a confirm dialog **only when `sensitive`**. Add a `confirming` flag and a `Confirm`:

```svelte
  import Confirm from '../../shared/Confirm.svelte'

  let confirming = $state(false)

  function requestSave(): void {
    if (draft.trim() === '') return
    if (sensitive) { confirming = true; return }
    commit()
  }
  function commit(): void {
    confirming = false
    onSave(draft)
    editing = false
    draft = ''
  }
```

Point the Save button's `onClick` at `requestSave`, and add the dialog inside the row (render it in an extra `<td>` or after the row via a sibling — simplest: render `Confirm` unconditionally; it only shows when `open`):

```svelte
<Confirm
  open={confirming}
  title="Change secret key"
  danger
  confirmLabel="Save secret"
  onCancel={() => (confirming = false)}
  onConfirm={commit}>
  {#snippet body()}<p>Update <code>{keyName}</code>? The new secret takes effect immediately.</p>{/snippet}
</Confirm>
```

> Place `<Confirm>` outside the `<tr>` to keep table markup valid — render it adjacent to the row in the parent, or wrap the row component's output in a fragment. Since a Svelte component can return multiple roots, emit the `<tr>` and the `<Confirm>` as siblings (the modal portals to a fixed overlay, so DOM nesting is cosmetic).

Update `tests/client/settings/components/SystemKvRow.test.ts`: the non-secret Save still emits immediately (existing test stays green); add a secret-key test asserting Save opens the dialog and only the dialog confirm emits `onSave`.

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/components/SystemKvRow.test.ts tests/client/settings/sections/admin/AdminAnnounceSection.test.ts tests/client/settings/settings-css.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add client/settings/settings.css client/settings/sections/admin/AdminAnnounceSection.svelte client/settings/components/SystemKvRow.svelte tests/client/settings
git commit -m "feat(settings): admin danger zone + confirm steps for announce and secret keys"
```

---

## Task 14: Type-scale + contrast + focus pass

**Files:**

- Modify: section components missing eyebrows/labels (`TaskProviderSection.svelte`, `ToolsSection.svelte`, `McpSection.svelte`, `PluginsSection.svelte`, `IdentitySection.svelte`)
- Modify: any field label still using the low-contrast inline style → `t-label`
- Test: `tests/client/settings/SettingsApp.test.ts` (assert eyebrows present)

Final consistency sweep: every section header carries its group eyebrow; labels use `t-label`; focus rings are present (added in Task 2). This is mostly applying tokens already defined.

- [ ] **Step 1: Add the failing eyebrow assertions**

In `tests/client/settings/SettingsApp.test.ts`:

```ts
test('every personal section header carries an eyebrow', async () => {
  setUserSession()
  setMockFetch(() => Promise.resolve(json({ fields: [], domains: [] })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const c = mount(SettingsApp, { target })
  await drain()
  // Task provider / Tools / Identity now show their group eyebrow
  const caps = Array.from(target.querySelectorAll('.ui-caption')).map((e) => e.textContent?.trim())
  expect(caps).toContain('Personal')
  expect(caps).toContain('Integrations')
  void unmount(c)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/settings/SettingsApp.test.ts`
Expected: FAIL — sections without eyebrows.

- [ ] **Step 3: Add eyebrows to the section `PageHeader`s**

In each listed section, add the matching `eyebrow` prop to `PageHeader`:

- `TaskProviderSection.svelte`, `ToolsSection.svelte`, `IdentitySection.svelte` → `eyebrow="Personal"`
- `McpSection.svelte`, `PluginsSection.svelte` → `eyebrow="Integrations"`

Example for `ToolsSection.svelte`:

```svelte
  <PageHeader eyebrow="Personal" title="Tools">
```

> `ProfileSection` already has `eyebrow="Personal"` per the existing code; keep it. Admin sections already carry `Admin · …` eyebrows.

- [ ] **Step 4: Standardize remaining field labels**

Grep for low-contrast inline labels and adopt `t-label`:

```bash
grep -rn "settings-field__label" client/settings
```

For each, ensure the class list includes `t-label` (done for `ConfigFieldRow` in Task 8; apply to any other field-label spans). No behavior change; visual contrast only.

- [ ] **Step 5: Run test to verify it passes**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 6: Run the full client suite + build**

Run:

```bash
bun test:client
bun build:client
```

Expected: all client tests pass; bundles build clean.

- [ ] **Step 7: Run the project check gate**

Run: `bun check:full`
Expected: lint/typecheck/format pass. Fix any `max-lines`/`max-lines-per-function` failures by extracting a sub-component (e.g. split a large admin section), never by compressing formatting.

- [ ] **Step 8: Commit**

```bash
git add client/settings tests/client/settings
git commit -m "feat(settings): eyebrow/contrast/focus consistency pass"
```

---

## Definition of done verification

After Task 14, walk the spec §10 checklist against the implementation:

- [ ] Every section reachable via the rail; scroll-spy works; keyboard accessible — Tasks 3, 4 (rail groups, `aria-current`, jump menu; scroll-spy pre-existing).
- [ ] No full-bleed forms; content capped at `--content-max` — Task 2 (`.settings-group` cap), Task 4 (wrappers).
- [ ] Solid green only on primary buttons; status = dot, permissions = segmented control, danger consistent — Tasks 5, 6, 7.
- [ ] All destructive actions confirm — Task 12 (+ Task 17 sweep), Task 13 (announce/secret).
- [ ] Users/Groups tables searchable, paginated, hover, truncated+copyable IDs — Tasks 11, 12.
- [ ] System (LLM) is a compact inline-edit table — Task 9.
- [ ] Admin group visually separated + gated; Announce + secret changes confirm — Tasks 3, 4, 13.
- [ ] No new colors/fonts beyond the token set; terminal aesthetic preserved — Task 1 (rename, no new families; `--radius` 6px is the only roundness shift, applied to settings components only).

---

## Notes / residual open items (non-blocking)

- **Token radius shift:** `--radius` is now `6px` (spec value). Legacy debug/admin components hardcode `border-radius: 2px` inline and are unaffected; settings components that adopt `var(--radius)` become slightly rounder. If product wants the old crispness, override `--radius: 2px` — single-line change.
- **Server-side pagination:** Users/Groups search/paging is client-side (spec §8.2). If the roster grows into the thousands (spec Q2), swap `SettingsTable`'s `filtered`/`pageRows` for a server-backed fetcher — the component API can stay the same.
- **Domain-level Tools control:** left as a single cycle button (acceptable per §6.4 acceptance); can be upgraded to a `SegmentedControl` later for symmetry.
