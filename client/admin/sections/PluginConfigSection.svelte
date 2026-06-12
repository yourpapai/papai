<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { AdminPluginConfigSnapshot } from '../../shared/api-types.js'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import PluginConfigForm from '../components/PluginConfigForm.svelte'
  import { fetchAdminPluginConfig } from '../plugin-config-fetchers.js'

  let snapshot: AdminPluginConfigSnapshot | null = $state(null)
  let error: string | null = $state(null)
  let fetching = $state(false)

  async function load(): Promise<void> {
    error = null
    fetching = true
    try {
      snapshot = await fetchAdminPluginConfig()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      fetching = false
    }
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })
</script>

<section id="plugin-config" class="plugin-config-section admin-section">
  <PageHeader eyebrow="Plugins" title="Plugin Config" titleTestId="admin-section-title">
    {#snippet action()}
      <button
        type="button"
        data-testid="plugin-config-refresh"
        onclick={() => {
          void load()
        }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <PluginConfigForm {snapshot} onRefresh={load} />
</section>
