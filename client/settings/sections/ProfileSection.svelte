<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import ConfigFieldRow from '../components/ConfigFieldRow.svelte'
  import type { ConfigField } from '../fetcher-schemas.js'
  import { fetchConfig } from '../fetchers.js'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

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
  <PageHeader eyebrow="Personal" title="Profile">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="profile-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {:else if visible.length === 0}
    <EmptyState title="No profile settings" hint="This context has no editable profile settings." />
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
