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
  import CodingCredentialsSection from './sections/CodingCredentialsSection.svelte'
  import McpSection from './sections/McpSection.svelte'
  import PluginsSection from './sections/PluginsSection.svelte'
  import IdentitySection from './sections/IdentitySection.svelte'
  import MembersSection from './sections/MembersSection.svelte'
  import GroupProviderSection from './sections/GroupProviderSection.svelte'
  import GuestModeSection from './sections/GuestModeSection.svelte'
  import KaneoAccessSection from './sections/KaneoAccessSection.svelte'
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
  import AdminToolDefaultsSection from './sections/admin/AdminToolDefaultsSection.svelte'

  type SidebarItem = SidebarGroup['items'][number]

  /** Section ids that live under the collapsible Advanced group. */
  const ADVANCED_IDS: readonly string[] = ['memory', 'ai-output', 'identity', 'byok', 'coding-credentials', 'mcp', 'plugins']

  function buildAdminSidebarItems(session: typeof settingsSession): SidebarItem[] {
    const items: SidebarItem[] = []
    if (session.isBotAdmin) {
      items.push(
        { id: 'instances', label: 'Instances' },
        { id: 'system', label: 'System' },
        { id: 'byok-admin', label: 'BYOK LLM' },
        { id: 'plugin-config', label: 'Plugin config' },
        { id: 'users', label: 'Users' },
        { id: 'tool-defaults', label: 'Tool defaults' },
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
                { id: 'guest-mode', label: 'Guest mode' },
                { id: 'kaneo-access', label: 'My Kaneo access' },
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
          { id: 'coding-credentials', label: 'Coding sessions' },
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
    const ids = sectionIds
    untrack(() => {
      if (ids.length > 0 && !ids.includes(activeId)) activeId = ids[0]
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
              <GuestModeSection contextId={ctx} />
              <KaneoAccessSection contextId={ctx} />
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
                <CodingCredentialsSection contextId={ctx} />
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
                <AdminToolDefaultsSection />
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
