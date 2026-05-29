<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchPlugins, setPluginApproval } from '../../fetchers.js'
  import type { PluginEntry } from '../../fetcher-schemas.js'

  interface Props {
    catalogContextId: string
  }

  let { catalogContextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      plugins = (await fetchPlugins(catalogContextId)).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function decide(pluginId: string, action: 'approve' | 'reject'): Promise<void> {
    error = null
    status = null
    try {
      const result = await setPluginApproval({ pluginId, action })
      await load()
      status = `${pluginId}: ${result.state ?? action}`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="plugin-approval" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Admin · Plugins</p>
      <h2>Plugin approval</h2>
    </div>
    <button type="button" onclick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-table-wrap">
    <table class="settings-table">
      <thead><tr><th>Plugin</th><th>Active</th><th>Actions</th></tr></thead>
      <tbody>
        {#each plugins as plugin (plugin.id)}
          <tr>
            <td>{plugin.name} <span class="placeholder">({plugin.id})</span></td>
            <td>{plugin.active ? 'yes' : 'no'}</td>
            <td>
              <button type="button" data-testid={`plugin-approve-${plugin.id}`} onclick={() => void decide(plugin.id, 'approve')}>Approve</button>
              <button type="button" data-testid={`plugin-reject-${plugin.id}`} onclick={() => void decide(plugin.id, 'reject')}>Reject</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
