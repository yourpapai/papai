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
  import TaskProviderSection from './sections/TaskProviderSection.svelte'
  import ToolsSection from './sections/ToolsSection.svelte'
  import McpSection from './sections/McpSection.svelte'
  import PluginsSection from './sections/PluginsSection.svelte'
  import IdentitySection from './sections/IdentitySection.svelte'
  import MembersSection from './sections/MembersSection.svelte'
  import GroupProviderSection from './sections/GroupProviderSection.svelte'
  import AdminInstancesSection from './sections/admin/AdminInstancesSection.svelte'
  import AdminSystemSection from './sections/admin/AdminSystemSection.svelte'
  import AdminUsersSection from './sections/admin/AdminUsersSection.svelte'
  import AdminGroupsSection from './sections/admin/AdminGroupsSection.svelte'
  import AdminAdminsSection from './sections/admin/AdminAdminsSection.svelte'
  import AdminPluginsApprovalSection from './sections/admin/AdminPluginsApprovalSection.svelte'
  import AdminPluginsConfigSection from './sections/admin/AdminPluginsConfigSection.svelte'
  import AdminAnnounceSection from './sections/admin/AdminAnnounceSection.svelte'

  let activeId = $state(window.location.hash.slice(1) || 'profile')

  const isGroup = $derived(activeContext()?.kind === 'group')

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
            ? [
                { id: 'members', label: 'Members' },
                { id: 'group-provider', label: 'Group provider' },
              ]
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
    // super admins are always bot admins, so admin.items already has the bot-admin entries here
    if (settingsSession.isSuperAdmin) {
      admin.items = [...admin.items, { id: 'admins', label: 'Admins' }, { id: 'plugin-approval', label: 'Plugin approval' }]
    }
    if (admin.items.length > 0) list.push(admin)
    return list
  })

  const sectionIds = $derived(groups.flatMap((g) => g.items.map((i) => i.id)))

  const ctx = $derived(settingsSession.activeContextId)

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
  </Shell>
{/if}
