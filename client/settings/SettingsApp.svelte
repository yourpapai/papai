<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import SettingsSidebar from './components/SettingsSidebar.svelte'
  import type { SidebarItem } from './components/SettingsSidebar.svelte'
  import SettingsTopBar from './components/SettingsTopBar.svelte'
  import { untrack } from 'svelte'
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
  import AdminAnnounceSection from './sections/admin/AdminAnnounceSection.svelte'

  let activeId = $state(window.location.hash.slice(1) || 'profile')

  const isGroup = $derived(activeContext()?.kind === 'group')

  const items = $derived.by((): SidebarItem[] => {
    const list: SidebarItem[] = [
      { id: 'profile', label: 'Profile' },
      { id: 'task-provider', label: 'Task provider' },
      { id: 'tools', label: 'Tools' },
      { id: 'mcp', label: 'MCP' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'identity', label: 'Identity' },
    ]
    if (isGroup) {
      list.push({ id: 'members', label: 'Members' }, { id: 'group-provider', label: 'Group provider' })
    }
    if (settingsSession.isBotAdmin) {
      list.push(
        { id: 'instances', label: 'Instances' },
        { id: 'system', label: 'System' },
        { id: 'users', label: 'Users' },
        { id: 'groups', label: 'Groups' },
        { id: 'announce', label: 'Announce' },
      )
    }
    if (settingsSession.isSuperAdmin) {
      list.push({ id: 'admins', label: 'Admins' }, { id: 'plugin-approval', label: 'Plugin approval' })
    }
    return list
  })

  const ctx = $derived(settingsSession.activeContextId)

  $effect(() => {
    const ids = items.map((item) => item.id)
    untrack(() => {
      if (ids.length > 0 && !ids.includes(activeId)) activeId = ids[0]
    })
  })

  $effect(() => {
    if (settingsSession.status !== 'ready') return
    const ids = items.map((item) => item.id)
    const spy = useScrollSpy(ids, (id) => {
      activeId = id
      if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`)
    })
    spy.start()
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
      <div class="settings-grid">
        <SettingsSidebar {items} {activeId} />
        <main class="settings-grid__main">
          <ProfileSection contextId={ctx} />
          <TaskProviderSection contextId={ctx} />
          <ToolsSection contextId={ctx} />
          <McpSection contextId={ctx} />
          <PluginsSection contextId={ctx} />
          <IdentitySection contextId={ctx} />
          {#if isGroup}
            <MembersSection contextId={ctx} />
            <GroupProviderSection contextId={ctx} />
          {/if}
          {#if settingsSession.isBotAdmin}
            <AdminInstancesSection />
            <AdminSystemSection />
            <AdminUsersSection />
            <AdminGroupsSection />
            <AdminAnnounceSection />
          {/if}
          {#if settingsSession.isSuperAdmin}
            <AdminAdminsSection />
            <AdminPluginsApprovalSection catalogContextId={ctx} />
          {/if}
        </main>
      </div>
    {/snippet}
  </Shell>
{/if}
