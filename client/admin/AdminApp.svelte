<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { onMount } from 'svelte'

  import { adminState, sectionLabel, syncSectionFromLocation } from './admin.svelte.js'
  import NavSidebar from './components/NavSidebar.svelte'
  import BillingSection from './sections/BillingSection.svelte'
  import StatsSection from './sections/StatsSection.svelte'
  import SystemSection from './sections/SystemSection.svelte'

  onMount(() => {
    syncSectionFromLocation()
    window.addEventListener('hashchange', syncSectionFromLocation)
    return (): void => window.removeEventListener('hashchange', syncSectionFromLocation)
  })
</script>

<div class="admin-shell">
  <header class="admin-topbar">
    <div>
      <p class="eyebrow">papai</p>
      <h1>Admin</h1>
    </div>
  </header>

  <div class="admin-body">
    <NavSidebar currentSection={adminState.currentSection} />
    <main class="admin-pane" aria-live="polite">
      {#if adminState.currentSection === 'system'}
        <SystemSection />
      {:else if adminState.currentSection === 'billing'}
        <BillingSection />
      {:else if adminState.currentSection === 'stats'}
        <StatsSection />
      {:else}
        <section>
          <p class="eyebrow">Section</p>
          <h2 data-testid="admin-section-title">{sectionLabel(adminState.currentSection)}</h2>
        </section>
      {/if}
    </main>
  </div>
</div>
