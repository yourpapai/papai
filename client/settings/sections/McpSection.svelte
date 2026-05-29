<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { McpEndpoint } from '../fetcher-schemas.js'
  import { fetchMcp, putMcp } from '../fetchers.js'

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let endpoints: McpEndpoint[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let initialLoad = $state(true)

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      endpoints = (await fetchMcp(id)).endpoints.map((endpoint) => ({ ...endpoint }))
      initialLoad = false
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      initialLoad = false
    } finally {
      loading = false
    }
  }

  function addRow(): void {
    const existing = new Set(endpoints.map((e) => e.id))
    let n = 1
    while (existing.has(`srv-${n}`)) n += 1
    endpoints = [...endpoints, { id: `srv-${n}`, url: '', label: '', enabled: true }]
  }

  function removeRow(index: number): void {
    endpoints = endpoints.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    error = null
    status = null
    saving = true
    try {
      await putMcp({ endpoints, contextId })
      await load(contextId)
      status = 'Saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  $effect(() => {
    void load(contextId)
  })
</script>

<section id="mcp" class="settings-section">
  <header class="settings-section-header">
    <div>
      <p class="eyebrow">Integrations</p>
      <h2>MCP endpoints</h2>
    </div>
    <button type="button" onclick={() => void load(contextId)}>{loading ? 'Refreshing…' : 'Refresh'}</button>
  </header>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else}
    <div class="settings-mcp">
      {#each endpoints as endpoint, index (endpoint.id)}
        <div class="settings-mcp__row" data-testid={`mcp-row-${endpoint.id}`}>
          <label>
            <span>Label</span>
            <input value={endpoint.label ?? ''} oninput={(e) => (endpoint.label = (e.target as HTMLInputElement).value)} />
          </label>
          <label>
            <span>URL (https)</span>
            <input value={endpoint.url} oninput={(e) => (endpoint.url = (e.target as HTMLInputElement).value)} />
          </label>
          <label class="settings-mcp__enabled">
            <input
              type="checkbox"
              checked={endpoint.enabled}
              onchange={(e) => (endpoint.enabled = (e.target as HTMLInputElement).checked)} />
            <span>Enabled</span>
          </label>
          <button type="button" data-testid={`mcp-remove-${endpoint.id}`} onclick={() => removeRow(index)}>Remove</button>
        </div>
      {/each}
      <div class="settings-mcp__actions">
        <button type="button" data-testid="mcp-add" onclick={addRow}>Add endpoint</button>
        <button type="button" data-testid="mcp-save" disabled={saving} onclick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .settings-mcp {
    display: grid;
    gap: 12px;
  }
  .settings-mcp__row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: end;
    padding: 12px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .settings-mcp__row label {
    display: grid;
    gap: 6px;
    min-width: 200px;
  }
  .settings-mcp__row span {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .settings-mcp__row input[type='text'],
  .settings-mcp__row input:not([type]) {
    background: var(--raised);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 10px;
    border-radius: 2px;
  }
  .settings-mcp__enabled {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    min-width: auto;
  }
  .settings-mcp__row button,
  .settings-mcp__actions button {
    border: 1px solid var(--strong);
    background: var(--bg);
    color: var(--fg);
    padding: 8px 12px;
    border-radius: 2px;
  }
  .settings-mcp__actions {
    display: flex;
    gap: 12px;
  }
</style>
