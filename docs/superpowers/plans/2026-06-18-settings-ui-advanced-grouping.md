<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings UI Advanced Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the single-page overload of the settings SPA by keeping Profile / Task provider / Tools at the top level and moving Memory, AI output, Identity, BYOK, MCP, and Plugins into a collapsible **Advanced** group that is collapsed by default; deep links auto-expand it. Admin and group-only sections are unchanged.

**Architecture:** `SettingsApp.svelte` owns a single `advancedCollapsed` state. The sidebar (`SettingsSidebar.svelte`) gains `collapsible`/`collapsed` on its `SidebarGroup` type and an `onToggle` callback. The Advanced content in the main column is unmounted when collapsed (genuinely shorter DOM). The scroll-spy observes only currently-mounted sections via a derived `observableSectionIds`, and a `hashchange` handler auto-expands + scrolls when a hash targets an Advanced section.

**Tech Stack:** Svelte 5 (runes), TypeScript (strict, `.js` import paths), happy-dom + `bun:test` for client tests.

**Spec:** `docs/superpowers/specs/2026-06-18-settings-ui-advanced-grouping-design.md`

---

## Conventions for every task

- Client tests run with: `bun test:client <path>` (happy-dom).
- Never add lint-disable/ts-ignore comments — fix the underlying issue (hook policy blocks them).
- No backend, route, or fetcher changes — this is purely the settings SPA shell.

---

## Task 1: Collapsible support in `SettingsSidebar`

**Files:**

- Modify: `client/settings/components/SettingsSidebar.svelte`
- Test: `tests/client/settings/components/SettingsSidebar.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/settings/components/SettingsSidebar.test.ts` a collapsible describe block (the file already imports `mount`, `unmount`, `flushSync`). Note the local `SidebarGroup` interface in that test file must gain the two optional fields:

```typescript
interface SidebarGroup {
  kicker: string
  items: readonly { id: string; label: string }[]
  danger?: boolean
  collapsible?: boolean
  collapsed?: boolean
}
```

Then add:

```typescript
describe('SettingsSidebar collapsible group', () => {
  const collapsibleGroups: SidebarGroup[] = [
    { kicker: 'Personal', items: [{ id: 'profile', label: 'Profile' }] },
    {
      kicker: 'Advanced',
      collapsible: true,
      collapsed: true,
      items: [
        { id: 'memory', label: 'Memory' },
        { id: 'mcp', label: 'MCP' },
      ],
    },
  ]

  test('collapsed group renders a toggle and hides its links', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsSidebar, { target, props: { groups: collapsibleGroups, activeId: 'profile' } })
    flushSync()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle-Advanced"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(target.querySelector('a[href="#memory"]')).toBeNull()
    expect(target.querySelector('a[href="#profile"]')).not.toBeNull()
    void unmount(c)
  })

  test('expanded group shows its links with aria-expanded true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const expanded = collapsibleGroups.map((g) => (g.collapsible === true ? { ...g, collapsed: false } : g))
    const c = mount(SettingsSidebar, { target, props: { groups: expanded, activeId: 'profile' } })
    flushSync()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle-Advanced"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelector('a[href="#memory"]')).not.toBeNull()
    void unmount(c)
  })

  test('clicking the toggle calls onToggle with the kicker', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const calls: string[] = []
    const c = mount(SettingsSidebar, {
      target,
      props: { groups: collapsibleGroups, activeId: 'profile', onToggle: (k: string) => calls.push(k) },
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="sidebar-toggle-Advanced"]')!.click()
    flushSync()
    expect(calls).toEqual(['Advanced'])
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:client tests/client/settings/components/SettingsSidebar.test.ts`
Expected: FAIL — no toggle button / `onToggle` prop yet.

- [ ] **Step 3: Implement the collapsible sidebar**

Replace `client/settings/components/SettingsSidebar.svelte` with:

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
    collapsible?: boolean
    collapsed?: boolean
  }

  interface Props {
    groups: readonly SidebarGroup[]
    activeId: string
    onToggle?: (kicker: string) => void
  }

  let { groups, activeId, onToggle }: Props = $props()
</script>

<aside class="settings-sidebar">
  {#each groups as group (group.kicker)}
    <div class="settings-sidebar__group" class:settings-sidebar__group--danger={group.danger === true}>
      {#if group.collapsible === true}
        <button
          type="button"
          class="t-kicker settings-sidebar__kicker settings-sidebar__kicker--toggle"
          aria-expanded={group.collapsed !== true}
          data-testid={`sidebar-toggle-${group.kicker}`}
          onclick={() => onToggle?.(group.kicker)}>
          <span class="settings-sidebar__chevron">{group.collapsed === true ? '▸' : '▾'}</span>
          {group.kicker}
        </button>
      {:else}
        <div class="t-kicker settings-sidebar__kicker">
          {group.kicker}{#if group.danger}<span class="settings-sidebar__badge">admin</span>{/if}
        </div>
      {/if}
      {#if group.collapsed !== true}
        <nav class="settings-sidebar__nav">
          {#each group.items as item (item.id)}
            <a
              class="settings-sidebar__link"
              class:settings-sidebar__link--active={activeId === item.id}
              aria-current={activeId === item.id ? 'page' : undefined}
              href={`#${item.id}`}>
              {item.label}
            </a>
          {/each}
        </nav>
      {/if}
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
  .settings-sidebar__kicker--toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    text-align: left;
    width: 100%;
    font: inherit;
  }
  .settings-sidebar__chevron {
    margin-right: 2px;
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
    .settings-sidebar {
      display: none;
    }
  }
</style>
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test:client tests/client/settings/components/SettingsSidebar.test.ts`
Expected: PASS (existing 3 tests + new 3).

- [ ] **Step 5: Commit**

```bash
git add client/settings/components/SettingsSidebar.svelte tests/client/settings/components/SettingsSidebar.test.ts
git commit -m "feat(settings-ui): collapsible sidebar group support"
```

---

## Task 2: Restructure `SettingsApp` into Personal + collapsible Advanced

**Files:**

- Modify: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/SettingsApp.test.ts` (update broken assertions + add new ones)

**Behavior:** Top level = `profile`, `task-provider`, `tools` (+ group-only `members`, `group-provider`). Collapsible Advanced (collapsed by default) = `memory`, `ai-output`, `identity`, `byok`, `mcp`, `plugins`. The standalone Integrations group is folded into Advanced. A hash targeting an Advanced id (deep link, sidebar/jump click) auto-expands and scrolls.

- [ ] **Step 1: Update the existing SettingsApp tests (they assert the old layout)**

In `tests/client/settings/SettingsApp.test.ts`, make these edits:

**(a)** Replace the test `'renders the always-on user sections for a personal context'` (lines ~66–77) with a version that reflects the new top-level / Advanced split:

```typescript
test('renders top-level sections and hides Advanced sections by default', async () => {
  setMockFetch(() => Promise.resolve(new Response('{}')))
  seed({})
  const component = mountApp()
  await drain()
  for (const id of ['profile', 'task-provider', 'tools']) {
    expect(document.querySelector(`#${id}`)).not.toBeNull()
  }
  // Advanced is collapsed by default → its sections are not mounted.
  for (const id of ['memory', 'ai-output', 'byok', 'mcp', 'plugins', 'identity']) {
    expect(document.querySelector(`#${id}`)).toBeNull()
  }
  expect(document.querySelector('[data-testid="advanced-toggle"]')).not.toBeNull()
  expect(document.querySelector('#members')).toBeNull()
  expect(document.querySelector('#instances')).toBeNull()
  void unmount(component)
})
```

**(b)** In `'renders three group kickers for an admin session'` (lines ~129–141), change the expected kickers from `Personal / Integrations / Admin` to `Personal / Advanced / Admin`:

```typescript
expect(kickers[0]!.textContent).toContain('Personal')
expect(kickers[1]!.textContent).toContain('Advanced')
expect(kickers[2]!.textContent).toContain('Admin')
```

**(c)** In `'non-admin session omits the Admin group'` (lines ~143–154), change the second kicker from `Integrations` to `Advanced`:

```typescript
expect(kickers).toHaveLength(2)
expect(kickers[0]!.textContent).toContain('Personal')
expect(kickers[1]!.textContent).toContain('Advanced')
```

**(d)** Replace `'personal and integrations sections carry group eyebrows in their headers'` (lines ~156–168) — the Integrations eyebrow is no longer rendered by default (those sections are collapsed). Assert the Personal eyebrow is present:

```typescript
test('top-level sections carry the Personal eyebrow in their headers', async () => {
  setMockFetch(() => Promise.resolve(new Response('{}')))
  seed({ isBotAdmin: false, isSuperAdmin: false })
  const component = mountApp()
  await drain()
  const target = document.querySelector<HTMLElement>('#root')!
  const eyebrowText = Array.from(target.querySelectorAll('.ui-page-header .ui-caption'))
    .map((e) => e.textContent)
    .join(' ')
  expect(eyebrowText).toContain('Personal')
  void unmount(component)
})
```

- [ ] **Step 2: Add new tests for the Advanced behavior**

Add to the `describe('SettingsApp', ...)` block:

```typescript
test('expanding Advanced renders its sections', async () => {
  setMockFetch(() => Promise.resolve(new Response('{}')))
  seed({})
  const component = mountApp()
  await drain()
  expect(document.querySelector('#memory')).toBeNull()
  document.querySelector<HTMLButtonElement>('[data-testid="advanced-toggle"]')!.click()
  await drain()
  for (const id of ['memory', 'ai-output', 'identity', 'byok', 'mcp', 'plugins']) {
    expect(document.querySelector(`#${id}`)).not.toBeNull()
  }
  void unmount(component)
})

test('a deep link to an Advanced section auto-expands the group', async () => {
  setMockFetch(() => Promise.resolve(new Response('{}')))
  seed({})
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '/settings#identity')
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(SettingsApp, { target })
  await drain()
  expect(document.querySelector('#identity')).not.toBeNull()
  void unmount(component)
})

test('group-only sections stay top-level while Advanced is collapsed', async () => {
  setMockFetch(() => Promise.resolve(new Response('{}')))
  seed({
    contexts: [
      { kind: 'personal', contextId: 'user:1', label: 'Personal' },
      { kind: 'group', contextId: 'group:7', label: 'Team' },
    ],
    activeContextId: 'group:7',
  })
  const component = mountApp()
  await drain()
  expect(document.querySelector('#members')).not.toBeNull()
  expect(document.querySelector('#group-provider')).not.toBeNull()
  expect(document.querySelector('#memory')).toBeNull() // still in collapsed Advanced
  void unmount(component)
})
```

(`mount` is already imported in the test file; `history.replaceState` resets the hash for the non-deep-link tests because `mountApp()` sets `/settings`.)

- [ ] **Step 3: Run to verify the suite fails**

Run: `bun test:client tests/client/settings/SettingsApp.test.ts`
Expected: FAIL — old layout still rendered (Advanced sections present, kickers say "Integrations", no `advanced-toggle`).

- [ ] **Step 4: Rewrite `SettingsApp.svelte`**

Replace `client/settings/SettingsApp.svelte` with the following. (Imports are unchanged from the current file — every section is still used; Memory/AiOutput/Byok/Mcp/Plugins/Identity now live under Advanced.)

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import SettingsSidebar from './components/SettingsSidebar.svelte'
  import type { SidebarGroup } from './components/SettingsSidebar.svelte'
  import SettingsJumpMenu from './components/SettingsJumpMenu.svelte'
  import SettingsTopBar from './components/SettingsTopBar.svelte'
  import { tick, untrack } from 'svelte'
  import { useScrollSpy } from './scrollspy.js'
  import { activeContext, settingsSession } from './session.svelte.js'
  import ProfileSection from './sections/ProfileSection.svelte'
  import MemorySection from './sections/MemorySection.svelte'
  import TaskProviderSection from './sections/TaskProviderSection.svelte'
  import AiOutputSection from './sections/AiOutputSection.svelte'
  import ToolsSection from './sections/ToolsSection.svelte'
  import ByokSection from './sections/ByokSection.svelte'
  import McpSection from './sections/McpSection.svelte'
  import PluginsSection from './sections/PluginsSection.svelte'
  import IdentitySection from './sections/IdentitySection.svelte'
  import MembersSection from './sections/MembersSection.svelte'
  import GroupProviderSection from './sections/GroupProviderSection.svelte'
  import AdminInstancesSection from './sections/admin/AdminInstancesSection.svelte'
  import AdminSystemSection from './sections/admin/AdminSystemSection.svelte'
  import AdminByokSection from './sections/admin/AdminByokSection.svelte'
  import AdminUsersSection from './sections/admin/AdminUsersSection.svelte'
  import AdminGroupsSection from './sections/admin/AdminGroupsSection.svelte'
  import AdminAdminsSection from './sections/admin/AdminAdminsSection.svelte'
  import AdminPluginsApprovalSection from './sections/admin/AdminPluginsApprovalSection.svelte'
  import AdminPluginsConfigSection from './sections/admin/AdminPluginsConfigSection.svelte'
  import AdminAnnounceSection from './sections/admin/AdminAnnounceSection.svelte'
  import AdminFeatureFlagsSection from './sections/admin/AdminFeatureFlagsSection.svelte'

  type SidebarItem = SidebarGroup['items'][number]

  /** Section ids that live under the collapsible Advanced group. */
  const ADVANCED_IDS: readonly string[] = ['memory', 'ai-output', 'identity', 'byok', 'mcp', 'plugins']

  function buildAdminSidebarItems(session: typeof settingsSession): SidebarItem[] {
    const items: SidebarItem[] = []
    if (session.isBotAdmin) {
      items.push(
        { id: 'instances', label: 'Instances' },
        { id: 'system', label: 'System' },
        { id: 'byok-admin', label: 'BYOK LLM' },
        { id: 'plugin-config', label: 'Plugin config' },
        { id: 'users', label: 'Users' },
        { id: 'groups', label: 'Groups' },
        { id: 'announce', label: 'Announce' },
      )
    }
    // super admins are always bot admins, so items already has the bot-admin entries here
    if (session.isSuperAdmin) {
      items.push(
        { id: 'admins', label: 'Admins' },
        { id: 'plugin-approval', label: 'Plugin approval' },
        { id: 'feature-flags', label: 'Feature flags' },
      )
    }
    return items
  }

  const initialHash = window.location.hash.slice(1)
  let activeId = $state(initialHash || 'profile')
  // Collapsed by default, except when a deep link targets an Advanced section.
  let advancedCollapsed = $state(!ADVANCED_IDS.includes(initialHash))

  const isGroup = $derived(activeContext()?.kind === 'group')

  const groups = $derived.by((): SidebarGroup[] => {
    const list: SidebarGroup[] = [
      {
        kicker: 'Personal',
        items: [
          { id: 'profile', label: 'Profile' },
          { id: 'task-provider', label: 'Task provider' },
          { id: 'tools', label: 'Tools' },
          ...(isGroup
            ? [
                { id: 'members', label: 'Members' },
                { id: 'group-provider', label: 'Group provider' },
              ]
            : []),
        ],
      },
      {
        kicker: 'Advanced',
        collapsible: true,
        collapsed: advancedCollapsed,
        items: [
          { id: 'memory', label: 'Memory' },
          { id: 'ai-output', label: 'AI output' },
          { id: 'identity', label: 'Identity' },
          { id: 'byok', label: 'BYOK LLM' },
          { id: 'mcp', label: 'MCP' },
          { id: 'plugins', label: 'Plugins' },
        ],
      },
    ]
    const adminItems = buildAdminSidebarItems(settingsSession)
    if (adminItems.length > 0) list.push({ kicker: 'Admin', danger: true, items: adminItems })
    return list
  })

  const sectionIds = $derived(groups.flatMap((g) => g.items.map((i) => i.id)))

  /** Only the sections currently mounted (Advanced sections unmount when collapsed). */
  const observableSectionIds = $derived(
    advancedCollapsed ? sectionIds.filter((id) => !ADVANCED_IDS.includes(id)) : sectionIds,
  )

  const ctx = $derived(settingsSession.activeContextId)

  function toggleAdvanced(): void {
    advancedCollapsed = !advancedCollapsed
  }

  $effect(() => {
    untrack(() => {
      if (sectionIds.length > 0 && !sectionIds.includes(activeId)) activeId = sectionIds[0]
    })
  })

  // Auto-expand + scroll when a hash targets an Advanced section (sidebar link, jump menu, deep link).
  $effect(() => {
    const onHash = (): void => {
      const id = window.location.hash.slice(1)
      if (!ADVANCED_IDS.includes(id)) return
      advancedCollapsed = false
      void tick().then(() => document.getElementById(id)?.scrollIntoView())
    }
    window.addEventListener('hashchange', onHash)
    return (): void => window.removeEventListener('hashchange', onHash)
  })

  // First ready render: scroll to an Advanced deep-link target (already expanded via init state).
  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const id = untrack(() => window.location.hash.slice(1))
    if (id !== '' && ADVANCED_IDS.includes(id)) {
      void tick().then(() => document.getElementById(id)?.scrollIntoView())
    }
  })

  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const spy = useScrollSpy(observableSectionIds, (id) => {
      activeId = id
      if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`)
    })
    void tick().then(() => spy.start())
    return (): void => spy.stop()
  })
</script>

{#if settingsSession.status === 'loading'}
  <main class="settings-gate"><p>Loading…</p></main>
{:else if settingsSession.status === 'unauthenticated'}
  <main class="settings-gate">
    <h1>Session expired or missing</h1>
    <p>Request a new settings link by sending <code>/config</code> to the bot.</p>
  </main>
{:else}
  <Shell>
    {#snippet topBar()}
      <SettingsTopBar />
    {/snippet}
    {#snippet children()}
      <SettingsJumpMenu {groups} {activeId} />
      <div class="settings-grid">
        <SettingsSidebar {groups} {activeId} onToggle={toggleAdvanced} />
        <main class="settings-grid__main">
          <div class="settings-group">
            <ProfileSection contextId={ctx} />
            <TaskProviderSection contextId={ctx} />
            <ToolsSection contextId={ctx} />
            {#if isGroup}
              <MembersSection contextId={ctx} />
              <GroupProviderSection contextId={ctx} />
            {/if}
          </div>
          <div class="settings-group settings-advanced">
            <button
              type="button"
              class="settings-advanced__toggle"
              aria-expanded={!advancedCollapsed}
              aria-controls="settings-advanced-content"
              data-testid="advanced-toggle"
              onclick={toggleAdvanced}>
              <span class="settings-advanced__chevron">{advancedCollapsed ? '▸' : '▾'}</span>
              Advanced
              <span class="settings-advanced__hint">Memory, AI output, identity, BYOK, integrations</span>
            </button>
            {#if !advancedCollapsed}
              <div id="settings-advanced-content">
                <MemorySection contextId={ctx} />
                <AiOutputSection contextId={ctx} />
                <IdentitySection contextId={ctx} />
                <ByokSection contextId={ctx} />
                <McpSection contextId={ctx} />
                <PluginsSection contextId={ctx} />
              </div>
            {/if}
          </div>
          {#if settingsSession.isBotAdmin || settingsSession.isSuperAdmin}
            <div class="settings-group settings-group--wide settings-admin-zone">
              {#if settingsSession.isBotAdmin}
                <AdminInstancesSection />
                <AdminSystemSection />
                <AdminByokSection />
                <AdminPluginsConfigSection />
                <AdminUsersSection />
                <AdminGroupsSection />
                <AdminAnnounceSection />
              {/if}
              {#if settingsSession.isSuperAdmin}
                <AdminAdminsSection />
                <AdminPluginsApprovalSection catalogContextId={ctx} />
                <AdminFeatureFlagsSection />
              {/if}
            </div>
          {/if}
        </main>
      </div>
    {/snippet}
  </Shell>
{/if}

<style>
  .settings-advanced__toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    text-align: left;
    padding: 10px 4px;
    cursor: pointer;
  }
  .settings-advanced__hint {
    color: var(--text-muted);
    font-size: 11px;
  }
</style>
```

- [ ] **Step 5: Run the SettingsApp test to verify it passes**

Run: `bun test:client tests/client/settings/SettingsApp.test.ts`
Expected: PASS (updated + new tests).

- [ ] **Step 6: Run the sidebar + scrollspy tests to confirm no regression**

Run: `bun test:client tests/client/settings/components/SettingsSidebar.test.ts tests/client/settings/scrollspy.test.ts`
Expected: PASS (scrollspy.ts is unchanged).

- [ ] **Step 7: Commit**

```bash
git add client/settings/SettingsApp.svelte tests/client/settings/SettingsApp.test.ts
git commit -m "feat(settings-ui): collapsible Advanced group; Personal stays minimal"
```

---

## Task 3: Full verification

- [ ] **Step 1: Build clients**

Run: `bun build:client`
Expected: bundles written to `public/`.

- [ ] **Step 2: Client suite**

Run: `bun test:client`
Expected: all pass (especially `SettingsApp`, `SettingsSidebar`, `scrollspy`).

- [ ] **Step 3: Full check**

Run: `bun check:full`
Expected: lint + typecheck + format + license-headers all pass.

- [ ] **Step 4: Manual smoke (optional)**

Open the settings UI via `/config`:

- Default view shows only Profile, Task provider, Tools (plus Members / Group provider in a group context) and a collapsed **Advanced** header. The sidebar shows `Personal` and a collapsible `Advanced` kicker.
- Click the Advanced toggle (sidebar kicker or the main-column header) → Memory, AI output, Identity, BYOK, MCP, Plugins appear; toggling again hides them.
- Visit `…/settings#identity` directly (or pick Identity from the mobile Jump menu) → Advanced auto-expands and scrolls to Identity.
- Admin/super-admin sessions still show the full Admin zone unchanged.

- [ ] **Step 5: Final commit (if any cleanup remains)**

```bash
git add -A
git commit -m "test: client suite green for settings Advanced grouping"
```

---

## Self-review notes (addressed)

- **Spec coverage:** top-level vs Advanced split (T2 groups + template), collapsible sidebar (T1), collapsed-by-default unmounted content (T2 template `{#if !advancedCollapsed}`), deep-link auto-expand + scroll (T2 `hashchange` + first-ready effects), mobile jump menu unchanged (no edit — it already lists all groups and selecting fires `hashchange` → auto-expand), admin zone unchanged (T2 template). All spec sections map to a task.
- **Existing-test breakage handled:** the reorg invalidates three `SettingsApp.test.ts` assertions (kicker names, "always-on sections", Integrations eyebrow); T2 Step 1 updates them rather than leaving them red.
- **Scroll-spy correctness:** `observableSectionIds` (derived on `advancedCollapsed`) drives `useScrollSpy`, so the observer re-establishes over newly-mounted Advanced sections when expanded and never tries to observe unmounted ones — `scrollspy.ts` itself is untouched.
- **No hash loop:** scroll-spy writes the hash with `history.replaceState` (no `hashchange` event), so it never re-triggers the auto-expand handler.
- **Type consistency:** `SidebarGroup` gains `collapsible?`/`collapsed?`; `onToggle?: (kicker: string) => void` matches the no-arg `toggleAdvanced` (fewer params is assignable); `ADVANCED_IDS` is the single source for both the group items, the unmount condition, the `observableSectionIds` filter, and the deep-link checks.
