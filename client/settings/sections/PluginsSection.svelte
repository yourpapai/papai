<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { PluginEntry } from '../fetcher-schemas.js'
  import { fetchPlugins, unsetPluginConfig } from '../fetchers.js'
  import PluginCard from '../components/PluginCard.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Confirm from '../../shared/Confirm.svelte'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let loading = $state(false)
  let pendingClearKey: { pluginId: string; key: string; required: boolean } | null = $state(null)
  let clearingKey = $state(false)
  let clearError = $state<string | null>(null)

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function load(id: string): Promise<void> {
    error = null
    loading = true
    try {
      const result = await fetchPlugins(id)
      // The context can change while this request is in flight; a stale response
      // must not overwrite the newer context's list.
      if (id !== contextId) return
      plugins = result.plugins
    } catch (err) {
      if (id === contextId) error = message(err)
    } finally {
      if (id === contextId) loading = false
    }
  }

  async function confirmClearKey(): Promise<void> {
    const p = pendingClearKey
    if (p === null || clearingKey) return
    clearError = null
    clearingKey = true
    let ok = false
    try {
      await unsetPluginConfig({ pluginId: p.pluginId, key: p.key, contextId })
      ok = true
    } catch (err) {
      clearError = message(err)
    } finally {
      clearingKey = false
    }
    if (ok) {
      pendingClearKey = null
      await load(contextId)
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="plugins" class="settings-section">
  <PageHeader eyebrow="Integrations" title="Plugins">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="plugins-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}
    <ErrorState
      message="Could not load plugins for this context."
      detail={error}
      onRetry={() => void load(contextId)} />
  {:else if loading && plugins.length === 0}
    <p class="placeholder">Loading…</p>
  {:else if plugins.length === 0}
    <EmptyState
      title="No plugins discovered"
      hint="Plugins are installed on the server by an operator. Once one is installed and approved, it appears here for you to enable." />
  {:else}
    <ul class="settings-plugins">
      {#each plugins as plugin (plugin.id)}
        <li>
          <PluginCard
            {plugin}
            {contextId}
            onChanged={() => load(contextId)}
            onRequestClear={(key, required) => {
              pendingClearKey = { pluginId: plugin.id, key, required }
              clearError = null
            }} />
        </li>
      {/each}
    </ul>
  {/if}

  <Confirm
    open={pendingClearKey !== null}
    title="Clear plugin config value"
    danger
    busy={clearingKey}
    confirmLabel="Clear"
    onCancel={() => (pendingClearKey = null)}
    onConfirm={() => void confirmClearKey()}>
    {#snippet body()}
      <p>Clear the stored value for this field?{pendingClearKey?.required ? ' This field is required — clearing it will make the plugin ineligible for this context.' : ' The field will revert to its default.'}</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-plugins {
    display: grid;
    gap: var(--gap-inline);
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
