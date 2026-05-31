<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { McpEndpoint } from '../fetcher-schemas.js'
  import { fetchMcp, putMcp } from '../fetchers.js'

  interface HeaderRow {
    name: string
    value: string
  }

  interface EndpointState {
    endpoint: McpEndpoint
    headerRows: HeaderRow[]
    allowText: string
    denyText: string
  }

  interface Props {
    contextId: string
  }

  let { contextId }: Props = $props()

  let rows: EndpointState[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let initialLoad = $state(true)

  function toHeaderRows(headers: Record<string, string> | undefined): HeaderRow[] {
    if (headers === undefined) return []
    return Object.entries(headers).map(([name, value]) => ({ name, value }))
  }

  function fromHeaderRows(headerRows: HeaderRow[]): Record<string, string> | undefined {
    const entries = headerRows.filter((r) => r.name.trim().length > 0)
    if (entries.length === 0) return undefined
    return Object.fromEntries(entries.map((r) => [r.name, r.value]))
  }

  function toText(arr: string[] | undefined): string {
    return arr === undefined || arr.length === 0 ? '' : arr.join(', ')
  }

  function fromText(text: string): string[] | undefined {
    const parts = text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return parts.length === 0 ? undefined : parts
  }

  function toEndpointState(endpoint: McpEndpoint): EndpointState {
    return {
      endpoint: { ...endpoint },
      headerRows: toHeaderRows(endpoint.headers),
      allowText: toText(endpoint.toolFilter?.allow),
      denyText: toText(endpoint.toolFilter?.deny),
    }
  }

  async function load(id: string): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const data = await fetchMcp(id)
      rows = data.endpoints.map(toEndpointState)
      initialLoad = false
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      initialLoad = false
    } finally {
      loading = false
    }
  }

  function addRow(): void {
    const existing = new Set(rows.map((r) => r.endpoint.id))
    let n = 1
    while (existing.has(`srv-${n}`)) n += 1
    rows = [
      ...rows,
      {
        endpoint: { id: `srv-${n}`, url: '', label: '', enabled: true },
        headerRows: [],
        allowText: '',
        denyText: '',
      },
    ]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  function addHeader(rowIndex: number): void {
    rows = rows.map((r, i) => (i === rowIndex ? { ...r, headerRows: [...r.headerRows, { name: '', value: '' }] } : r))
  }

  function removeHeader(rowIndex: number, headerIndex: number): void {
    rows = rows.map((r, i) =>
      i === rowIndex ? { ...r, headerRows: r.headerRows.filter((_, j) => j !== headerIndex) } : r,
    )
  }

  function buildPayload(): McpEndpoint[] {
    return rows.map((r) => {
      const headers = fromHeaderRows(r.headerRows)
      const allow = fromText(r.allowText)
      const deny = fromText(r.denyText)
      const toolFilter =
        allow !== undefined || deny !== undefined ? { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) } : undefined
      return { ...r.endpoint, headers, toolFilter }
    })
  }

  async function save(): Promise<void> {
    error = null
    status = null
    saving = true
    try {
      const endpoints = buildPayload()
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
      {#each rows as row, index (row.endpoint.id)}
        <div class="settings-mcp__row" data-testid={`mcp-row-${row.endpoint.id}`}>
          <label>
            <span>Label</span>
            <input
              value={row.endpoint.label ?? ''}
              oninput={(e) => (row.endpoint.label = (e.target as HTMLInputElement).value)} />
          </label>
          <label>
            <span>URL (https)</span>
            <input value={row.endpoint.url} oninput={(e) => (row.endpoint.url = (e.target as HTMLInputElement).value)} />
          </label>
          <label class="settings-mcp__enabled">
            <input
              type="checkbox"
              checked={row.endpoint.enabled}
              onchange={(e) => (row.endpoint.enabled = (e.target as HTMLInputElement).checked)} />
            <span>Enabled</span>
          </label>
          <button type="button" data-testid={`mcp-remove-${row.endpoint.id}`} onclick={() => removeRow(index)}>
            Remove
          </button>

          <div class="settings-mcp__headers">
            <p class="settings-mcp__subsection-label">Auth headers</p>
            {#each row.headerRows as headerRow, hi (hi)}
              <div class="settings-mcp__header-row">
                <label>
                  <span>Name</span>
                  <input
                    data-testid={`mcp-header-name-${row.endpoint.id}-${hi}`}
                    value={headerRow.name}
                    oninput={(e) => (headerRow.name = (e.target as HTMLInputElement).value)} />
                </label>
                <label>
                  <span>Value <span class="settings-mcp__hint">(leave unchanged to keep stored value)</span></span>
                  <input
                    data-testid={`mcp-header-value-${row.endpoint.id}-${hi}`}
                    value={headerRow.value}
                    oninput={(e) => (headerRow.value = (e.target as HTMLInputElement).value)} />
                </label>
                <button
                  type="button"
                  data-testid={`mcp-header-remove-${row.endpoint.id}-${hi}`}
                  onclick={() => removeHeader(index, hi)}>
                  ✕
                </button>
              </div>
            {/each}
            <button type="button" data-testid={`mcp-header-add-${row.endpoint.id}`} onclick={() => addHeader(index)}>
              Add header
            </button>
          </div>

          <div class="settings-mcp__toolfilter">
            <p class="settings-mcp__subsection-label">Tool filter</p>
            <label>
              <span>Allow tools <span class="settings-mcp__hint">(comma or newline separated)</span></span>
              <input
                data-testid={`mcp-toolfilter-allow-${row.endpoint.id}`}
                value={row.allowText}
                oninput={(e) => (row.allowText = (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              <span>Deny tools <span class="settings-mcp__hint">(comma or newline separated)</span></span>
              <input
                data-testid={`mcp-toolfilter-deny-${row.endpoint.id}`}
                value={row.denyText}
                oninput={(e) => (row.denyText = (e.target as HTMLInputElement).value)} />
            </label>
          </div>
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
  .settings-mcp__headers,
  .settings-mcp__toolfilter {
    width: 100%;
    display: grid;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .settings-mcp__subsection-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
    margin: 0;
  }
  .settings-mcp__header-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
  }
  .settings-mcp__hint {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.75;
  }
</style>
