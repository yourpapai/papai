<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { onMount } from 'svelte'

  import type { IdentityMappingEntry } from '../../shared/api-types.js'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import { fetchAdminIdentityMappings } from '../fetchers.js'

  let userId = $state('')
  let mappings: IdentityMappingEntry[] = $state([])
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)

  async function loadMappings(): Promise<void> {
    loading = true
    error = null
    try {
      mappings = await fetchAdminIdentityMappings()
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      mappings = []
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void loadMappings()
  })

  interface MappingRow {
    rowKey: string
    user: string
    provider: string
    login: string
    method: string
    conf: string
  }

  const filtered = $derived<IdentityMappingEntry[]>(
    userId.trim() === ''
      ? mappings
      : mappings.filter((m) => m.contextId.includes(userId.trim())),
  )

  const rows = $derived<MappingRow[]>(
    filtered.map((m) => ({
      rowKey: `${m.contextId}:${m.providerName}`,
      user: m.displayName ?? m.contextId,
      provider: m.providerName,
      login: m.providerUserLogin ?? '—',
      method: m.matchMethod ?? '—',
      conf: m.confidence !== null && m.confidence !== undefined ? String(m.confidence) : '—',
    })),
  )

  const columns = [
    { key: 'user' as const, label: 'User' },
    { key: 'provider' as const, label: 'Provider' },
    { key: 'login' as const, label: 'Login' },
    { key: 'method' as const, label: 'Method' },
    { key: 'conf' as const, label: 'Conf', align: 'right' as const },
  ]
</script>

<section id="identities" class="admin-data-section admin-section">
  <Panel title="identity mappings" count={filtered.length}>
    {#snippet action()}
      <form
        class="identities__filter"
        onsubmit={(e) => {
          e.preventDefault()
          void loadMappings()
        }}>
        <input
          class="identities__user-id-input"
          data-testid="identities-user-id"
          type="text"
          bind:value={userId}
          placeholder="filter by user id" />
        <button
          class="identities__reload-btn"
          data-testid="identities-load"
          type="submit"
          disabled={loading}>
          {loading ? 'Loading…' : 'Reload'}
        </button>
      </form>
    {/snippet}
    {#snippet body()}
      <div class="identities__body">
        {#if error !== null}
          <p class="status-error" data-testid="identities-error">{error}</p>
        {:else if !hasLoaded}
          <p class="placeholder">Loading…</p>
        {:else if filtered.length === 0}
          <p class="placeholder" data-testid="identities-empty">No mappings found</p>
        {:else}
          <DataTable {columns} {rows} rowKey="rowKey" />
        {/if}
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .identities__filter {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .identities__user-id-input {
    background: var(--raised);
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    outline: 0;
    padding: 4px 10px;
  }
  .identities__reload-btn {
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 2px;
    color: var(--bg);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    height: 22px;
    padding: 3px 8px;
  }
  .identities__reload-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .identities__body {
    padding: 0;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    margin: 0;
    padding: 12px;
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
