<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { AdminLlmSnapshot, AdminSystemSummary } from '../../shared/api-types.js'
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
  <header class="system-header">
    <div>
      <p class="eyebrow">System</p>
      <h2 data-testid="admin-section-title">System</h2>
    </div>
    <button
      type="button"
      data-testid="system-refresh"
      onclick={() => {
        void refreshAll()
      }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <section class="system-summary" aria-label="System summary">
    <h3>Environment summary</h3>
    {#if system === null}
      <span class="placeholder">Loading...</span>
    {:else}
      <dl data-testid="system-summary">
        <div><dt>Chat provider</dt><dd>{system.chatProvider}</dd></div>
        <div><dt>Task provider</dt><dd>{system.taskProvider}</dd></div>
        <div><dt>Debug server</dt><dd>{boolLabel(system.debugServer)}</dd></div>
        <div><dt>Admin user</dt><dd>{system.adminUserSet ? 'Configured' : 'Missing'}</dd></div>
      </dl>
    {/if}
  </section>

  <p class="admin-system__note">POST /admin/llm requires DEBUG_TOKEN</p>
  <CredentialsForm snapshot={adminLlm} onRefresh={loadAdmin} />
</section>

<style>
  .admin-system__note {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 8px 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
