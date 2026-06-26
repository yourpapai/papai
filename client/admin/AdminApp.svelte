<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { onMount } from 'svelte'

  import Shell from '../shared/ui/Shell.svelte'

  import { adminSections, adminState, refreshAll, setSection } from './admin.svelte.js'
  import AdminSidebarPanel from './components/AdminSidebarPanel.svelte'
  import AdminTopBar from './components/AdminTopBar.svelte'
  import { useScrollSpy } from './scrollspy.js'
  import BillingSection from './sections/BillingSection.svelte'
  import IdentitiesSection from './sections/IdentitiesSection.svelte'
  import MemosSection from './sections/MemosSection.svelte'
  import OverviewSection from './sections/OverviewSection.svelte'
  import RemindersSection from './sections/RemindersSection.svelte'
  import StatsSection from './sections/StatsSection.svelte'

  const sectionIds = adminSections.map((s) => s.id)

  onMount(() => {
    void refreshAll()
    const initial = window.location.hash.replace(/^#/u, '')
    if (sectionIds.includes(initial)) {
      const target = document.querySelector<HTMLElement>(`#${initial}`)
      if (target !== null) target.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
    const spy = useScrollSpy(sectionIds, (id) => {
      setSection(id as typeof adminState.currentSection)
      if (window.location.hash !== `#${id}`) {
        window.history.replaceState(null, '', `#${id}`)
      }
    })
    spy.start()
    return (): void => spy.stop()
  })
</script>

<Shell>
  {#snippet topBar()}
    <AdminTopBar />
  {/snippet}
  {#snippet children()}
    <div class="admin-grid">
      <AdminSidebarPanel activeId={adminState.currentSection} />
      <main class="admin-grid__main">
        <OverviewSection />
        <BillingSection />
        <StatsSection />
        <MemosSection />
        <RemindersSection />
        <IdentitiesSection />
      </main>
    </div>
  {/snippet}
</Shell>
