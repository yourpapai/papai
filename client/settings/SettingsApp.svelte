<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import SettingsGate from './components/SettingsGate.svelte'
  import SettingsGroupToggle from './components/SettingsGroupToggle.svelte'
  import SettingsSidebar from './components/SettingsSidebar.svelte'
  import type { SidebarGroup } from './components/SettingsSidebar.svelte'
  import SettingsJumpMenu from './components/SettingsJumpMenu.svelte'
  import SettingsTopBar from './components/SettingsTopBar.svelte'
  import { tick, untrack } from 'svelte'
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
  import { useScrollSpy } from './scrollspy.js'
  import { activeContext, settingsSession } from './session.svelte.js'
  import ProfileSection from './sections/ProfileSection.svelte'
  import AnalyticsPreferencesSection from './sections/AnalyticsPreferencesSection.svelte'
  import MemorySection from './sections/MemorySection.svelte'
  import TaskProviderSection from './sections/TaskProviderSection.svelte'
  import AiOutputSection from './sections/AiOutputSection.svelte'
  import ToolsSection from './sections/ToolsSection.svelte'
  import ByokSection from './sections/ByokSection.svelte'
  import CodingCredentialsSection from './sections/CodingCredentialsSection.svelte'
  import CodingMcpSection from './sections/CodingMcpSection.svelte'
  import CodeHostSection from './sections/CodeHostSection.svelte'
  import ReposSection from './sections/ReposSection.svelte'
  import McpSection from './sections/McpSection.svelte'
  import PluginsSection from './sections/PluginsSection.svelte'
  import IdentitySection from './sections/IdentitySection.svelte'
  import MembersSection from './sections/MembersSection.svelte'
  import GroupProviderSection from './sections/GroupProviderSection.svelte'
  import CodingIdentitySection from './sections/CodingIdentitySection.svelte'
  import GuestModeSection from './sections/GuestModeSection.svelte'
  import KaneoAccessSection from './sections/KaneoAccessSection.svelte'
  import ReleaseSubscriptionSection from './sections/ReleaseSubscriptionSection.svelte'
  import AdminInstancesSection from './sections/admin/AdminInstancesSection.svelte'
  import AdminProvidersSection from './sections/admin/AdminProvidersSection.svelte'
  import AdminModelsSection from './sections/admin/AdminModelsSection.svelte'
  import AdminByokSection from './sections/admin/AdminByokSection.svelte'
  import AdminUsersSection from './sections/admin/AdminUsersSection.svelte'
  import AdminGroupsSection from './sections/admin/AdminGroupsSection.svelte'
  import AdminAdminsSection from './sections/admin/AdminAdminsSection.svelte'
  import AdminPluginsApprovalSection from './sections/admin/AdminPluginsApprovalSection.svelte'
  import AdminPluginsConfigSection from './sections/admin/AdminPluginsConfigSection.svelte'
  import AdminAnnounceSection from './sections/admin/AdminAnnounceSection.svelte'
  import AdminReleaseNotesSection from './sections/admin/AdminReleaseNotesSection.svelte'
  import AdminCodingGuardrailsSection from './sections/admin/AdminCodingGuardrailsSection.svelte'
  import AdminMcpCatalogSection from './sections/admin/AdminMcpCatalogSection.svelte'
  import AdminMcpPluginServersSection from './sections/admin/AdminMcpPluginServersSection.svelte'
  import AdminToolDefaultsSection from './sections/admin/AdminToolDefaultsSection.svelte'
  import AdminAnalyticsSection from './sections/admin/AdminAnalyticsSection.svelte'

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

  $effect(() => {
    const ids = sectionIds
    untrack(() => {
      if (ids.length > 0 && !ids.includes(activeId)) activeId = ids[0]
    })
  })

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

{#if settingsSession.status !== 'ready'}
  <SettingsGate />
{:else}
  <Shell bodyScroll={false}>
    {#snippet topBar()}
      <SettingsTopBar />
    {/snippet}
    {#snippet children()}
      <h1 class="sr-only">Settings</h1>
      <div class="settings-shell">
        <SettingsJumpMenu {groups} {activeId} />
        <div class="settings-grid">
          <SettingsSidebar {groups} {activeId} onToggle={onSidebarToggle} />
          <main class="settings-grid__main">
            <div class="settings-group">
              <ProfileSection contextId={ctx} />
              <TaskProviderSection contextId={ctx} />
              <ToolsSection contextId={ctx} />
              <ReleaseSubscriptionSection scope="personal" contextId={ctx} />
              <AnalyticsPreferencesSection />
              {#if isGroup}
                <MembersSection contextId={ctx} />
                <GroupProviderSection contextId={ctx} />
                <GuestModeSection contextId={ctx} />
                <CodingIdentitySection contextId={ctx} />
                <ReleaseSubscriptionSection scope="group" contextId={ctx} />
                <KaneoAccessSection contextId={ctx} />
              {/if}
            </div>
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
          </main>
        </div>
      </div>
    {/snippet}
  </Shell>
{/if}
