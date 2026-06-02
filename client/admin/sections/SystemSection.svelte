<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { AdminLlmSnapshot, AdminSystemSummary } from '../../shared/api-types.js'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import CredentialsForm from '../components/CredentialsForm.svelte'
  import { fetchAdminLlm, fetchAdminSystem } from '../fetchers.js'

  let system: AdminSystemSummary | null = $state(null)
  let adminLlm: AdminLlmSnapshot | null = $state(null)
  let error: string | null = $state(null)
  let fetching = $state(false)

  const boolLabel = (value: boolean): string => (value ? 'Enabled' : 'Disabled')

  async function loadSystem(): Promise<void> {
    system = await fetchAdminSystem()
  }

  async function loadAdmin(): Promise<void> {
    adminLlm = await fetchAdminLlm()
  }

  async function refreshAll(): Promise<void> {
    error = null
    fetching = true
    try {
      await Promise.all([loadSystem(), loadAdmin()])
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      fetching = false
    }
  }

  $effect(() => {
    untrack(() => {
      void refreshAll()
    })
  })
</script>

<section id="system" class="system-section admin-section">
  <PageHeader title="System" titleTestId="admin-section-title">
    {#snippet action()}
      <button
        type="button"
        data-testid="system-refresh"
        onclick={() => {
          void refreshAll()
        }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <Panel title="system summary">
    {#snippet body()}
      <div class="system__summary">
        {#if system === null}
          <span class="placeholder">Loading...</span>
        {:else}
          <div data-testid="system-summary">
            <SummaryList
              cols={2}
              items={[
                { k: 'chat provider', v: system.chatProvider },
                { k: 'task provider', v: system.taskProvider, pill: true },
                { k: 'debug server', v: boolLabel(system.debugServer), pill: true },
                { k: 'admin user', v: system.adminUserSet ? 'Configured' : 'Missing', pill: true },
              ]} />
          </div>
        {/if}
      </div>
    {/snippet}
  </Panel>

  <Panel title="llm credentials">
    {#snippet body()}
      <CredentialsForm snapshot={adminLlm} onRefresh={loadAdmin} />
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .system__summary {
    padding: 12px;
    display: flex;
    flex-direction: column;
  }
</style>
