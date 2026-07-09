<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import { fetchAdminMcpPluginServers, postAdminMcpPluginServers } from '../../admin-fetchers.js'
  import type {
    AdminMcpPluginServerAvailable,
    AdminMcpPluginServerConfig,
  } from '../../fetcher-schemas-mcp-plugin-servers.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

  type ToolPolicy = 'allow' | 'ask' | 'deny'

  interface DraftRow {
    plugin: AdminMcpPluginServerAvailable
    enabled: boolean
    default_tool_policy: ToolPolicy
  }

  const POLICIES: readonly ToolPolicy[] = ['allow', 'ask', 'deny']

  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let loaded = $state(false)

  let available: AdminMcpPluginServerAvailable[] = $state([])
  let draftRows: DraftRow[] = $state([])

  function toDraftRows(
    plugins: AdminMcpPluginServerAvailable[],
    configs: AdminMcpPluginServerConfig[],
  ): DraftRow[] {
    return plugins.map((plugin) => {
      const config = configs.find((c) => c.plugin_id === plugin.pluginId)
      return {
        plugin,
        enabled: config?.enabled ?? false,
        default_tool_policy: config?.default_tool_policy ?? 'deny',
      }
    })
  }

  function toConfigs(rows: DraftRow[]): AdminMcpPluginServerConfig[] {
    return rows.map((row) => ({
      plugin_id: row.plugin.pluginId,
      enabled: row.enabled,
      default_tool_policy: row.default_tool_policy,
    }))
  }

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const next = await fetchAdminMcpPluginServers()
      available = next.available
      draftRows = toDraftRows(next.available, next.configs)
      loaded = true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const configs = toConfigs(draftRows)
      const next = await postAdminMcpPluginServers(configs)
      available = next.available
      draftRows = toDraftRows(next.available, next.configs)
      status = 'Plugin server settings saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  $effect(() => {
    untrack(() => {
      void load()
    })
  })
</script>

<section id="mcp-plugin-servers" class="settings-section">
  <PageHeader eyebrow="Admin · Coding sessions" title="MCP plugin servers">
    {#snippet action()}
      <IconButton
        label="Refresh"
        glyph="⟳"
        busy={loading}
        onClick={() => void load()}
        testid="admin-mcp-plugin-servers-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if loaded}
    <div class="mcp-plugin-servers-section" data-testid="admin-mcp-plugin-servers-rows">
      {#if available.length === 0}
        <p class="placeholder">No plugins expose an MCP server.</p>
      {:else}
        {#each draftRows as row (row.plugin.pluginId)}
          <div class="mcp-plugin-servers-row" data-testid={`admin-mcp-plugin-servers-row-${row.plugin.pluginId}`}>
            <div class="mcp-plugin-servers-row__info">
              <div class="mcp-plugin-servers-row__name">{row.plugin.name}</div>
              <div class="mcp-plugin-servers-row__description">{row.plugin.description}</div>
              <div class="mcp-plugin-servers-row__tools" data-testid={`admin-mcp-plugin-servers-tools-${row.plugin.pluginId}`}>
                {#if row.plugin.tools.length === 0}
                  <span class="mcp-plugin-servers-row__tools-empty">No tools declared</span>
                {:else}
                  {row.plugin.tools.join(', ')}
                {/if}
              </div>
            </div>
            <div class="mcp-plugin-servers-row__controls">
              <label class="mcp-plugin-servers-row__field">
                <input
                  type="checkbox"
                  data-testid={`admin-mcp-plugin-servers-enabled-${row.plugin.pluginId}`}
                  checked={row.enabled}
                  disabled={loading}
                  onchange={(e) => {
                    row.enabled = (e.currentTarget as HTMLInputElement).checked
                  }} />
                Enabled
              </label>
              <label class="mcp-plugin-servers-row__field">
                Default tool policy
                <select
                  data-testid={`admin-mcp-plugin-servers-policy-${row.plugin.pluginId}`}
                  value={row.default_tool_policy}
                  disabled={loading}
                  onchange={(e) => {
                    row.default_tool_policy = (e.currentTarget as HTMLSelectElement).value as ToolPolicy
                  }}>
                  {#each POLICIES as p (p)}
                    <option value={p}>{p}</option>
                  {/each}
                </select>
              </label>
            </div>
          </div>
        {/each}
      {/if}

      <div class="mcp-plugin-servers-section__controls">
        <Btn
          variant="primary"
          size="sm"
          testid="admin-mcp-plugin-servers-save"
          disabled={loading || available.length === 0}
          onClick={() => void save()}>
          {#snippet children()}{loading ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {/if}
</section>

<style>
  .mcp-plugin-servers-section {
    display: grid;
    gap: 16px;
  }
  .mcp-plugin-servers-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-control, 4px);
    align-items: start;
  }
  .mcp-plugin-servers-row__info {
    display: grid;
    gap: 4px;
  }
  .mcp-plugin-servers-row__name {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
  }
  .mcp-plugin-servers-row__description {
    font-size: 12px;
    color: var(--fg2);
  }
  .mcp-plugin-servers-row__tools {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
  }
  .mcp-plugin-servers-row__tools-empty {
    font-style: italic;
  }
  .mcp-plugin-servers-row__controls {
    display: grid;
    gap: 8px;
    justify-items: end;
  }
  .mcp-plugin-servers-row__field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }
  .mcp-plugin-servers-row__field select {
    background: var(--surface);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .mcp-plugin-servers-section__controls {
    display: flex;
    gap: 8px;
  }
</style>
