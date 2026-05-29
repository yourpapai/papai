<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let fields: ConfigField[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)

  const visible = $derived(
    fields.filter((field) => field.kind === 'preference' && field.storageKey !== 'mcp_endpoints'),
  )

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      fields = (await fetchConfig(id)).fields
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="profile" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Personal</p>
      <h2>Profile</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  {#if visible.length === 0}
    <p class="placeholder">No editable profile settings for this context.</p>
  {:else}
    <div class="settings-field-list">
      {#each visible as field (field.key)}
        <ConfigFieldRow {contextId} {field} onSaved={() => void load(contextId)} />
      {/each}
    </div>
  {/if}
</section>

<style>
  .settings-field-list {
    display: grid;
    gap: 12px;
  }
</style>
