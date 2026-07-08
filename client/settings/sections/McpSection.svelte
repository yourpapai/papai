<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { McpEndpoint } from '../fetcher-schemas.js'
  import { fetchMcp, putMcp } from '../fetchers.js'
  import { validateMcpEndpoint } from '../lib/validate-mcp-endpoint.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import Checkbox from '../../shared/ui/Checkbox.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'

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
  let touched: Set<string> = $state(new Set())

  const hasErrors = $derived(rows.some((r) => validateMcpEndpoint(r.endpoint).url !== undefined))

  function markTouched(id: string): void {
    if (touched.has(id)) return
    touched = new Set(touched).add(id)
  }

  function visibleUrlError(row: EndpointState): string | undefined {
    if (!touched.has(row.endpoint.id)) return undefined
    return validateMcpEndpoint(row.endpoint).url
  }

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
      if (id !== contextId) return
      rows = data.endpoints.map(toEndpointState)
      initialLoad = false
    } catch (err) {
      if (id === contextId) {
        error = err instanceof Error ? err.message : String(err)
        initialLoad = false
      }
    } finally {
      if (id === contextId) loading = false
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
        allow !== undefined || deny !== undefined
          ? { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) }
          : undefined
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
  <PageHeader eyebrow="Integrations" title="MCP endpoints">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="mcp-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if initialLoad && loading}
    <p class="placeholder">Loading…</p>
  {:else if rows.length === 0}
    <EmptyState title="No MCP endpoints" hint="Connect an external MCP server to add its tools to this context.">
      {#snippet action()}
        <Btn variant="primary" testid="mcp-add" onClick={addRow}>
          {#snippet children()}Add endpoint{/snippet}
        </Btn>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="settings-mcp">
      {#each rows as row, index (row.endpoint.id)}
        <div class="settings-mcp__row" data-testid={`mcp-row-${row.endpoint.id}`}>
          <div class="settings-mcp__primary">
            <div class="settings-mcp__primary-fields">
              <div class="settings-mcp__field settings-mcp__field--label">
                <Field label="Label">
                  <Input value={row.endpoint.label ?? ''} onInput={(v) => (row.endpoint.label = v)} />
                </Field>
              </div>
              <div class="settings-mcp__field settings-mcp__field--url">
                <Field label="URL (https)" error={visibleUrlError(row)}>
                  <Input
                    value={row.endpoint.url}
                    onInput={(v) => (row.endpoint.url = v)}
                    onBlur={() => markTouched(row.endpoint.id)}
                    testid={`mcp-url-${row.endpoint.id}`} />
                </Field>
              </div>
            </div>
            <div class="settings-mcp__primary-trailing">
              <Checkbox
                label="Enabled"
                checked={row.endpoint.enabled}
                onChange={(c) => (row.endpoint.enabled = c)}
                testid={`mcp-enabled-${row.endpoint.id}`} />
              <Btn variant="outline" size="sm" testid={`mcp-remove-${row.endpoint.id}`} onClick={() => removeRow(index)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
            </div>
          </div>

          <fieldset class="settings-mcp__group">
            <legend class="settings-mcp__legend">Auth headers</legend>
            <div class="settings-mcp__group-body">
              {#if row.headerRows.length > 0}
                <p class="settings-mcp__group-hint">Leave a value unchanged to keep the stored secret.</p>
              {/if}
              {#each row.headerRows as headerRow, hi (hi)}
                <div class="settings-mcp__header-row">
                  <Field label="Name">
                    <Input
                      value={headerRow.name}
                      onInput={(v) => (headerRow.name = v)}
                      testid={`mcp-header-name-${row.endpoint.id}-${hi}`} />
                  </Field>
                  <Field label="Value">
                    <Input
                      value={headerRow.value}
                      onInput={(v) => (headerRow.value = v)}
                      testid={`mcp-header-value-${row.endpoint.id}-${hi}`} />
                  </Field>
                  <Btn
                    variant="ghost"
                    size="sm"
                    testid={`mcp-header-remove-${row.endpoint.id}-${hi}`}
                    onClick={() => removeHeader(index, hi)}>
                    {#snippet children()}✕{/snippet}
                  </Btn>
                </div>
              {/each}
              <div class="settings-mcp__group-action">
                <Btn
                  variant="secondary"
                  size="sm"
                  testid={`mcp-header-add-${row.endpoint.id}`}
                  onClick={() => addHeader(index)}>
                  {#snippet children()}Add header{/snippet}
                </Btn>
              </div>
            </div>
          </fieldset>

          <fieldset class="settings-mcp__group">
            <legend class="settings-mcp__legend">Tool filter</legend>
            <div class="settings-mcp__group-body">
              <Field label="Allow tools" hint="comma or newline separated">
                <Input
                  value={row.allowText}
                  onInput={(v) => (row.allowText = v)}
                  testid={`mcp-toolfilter-allow-${row.endpoint.id}`} />
              </Field>
              <Field label="Deny tools" hint="comma or newline separated">
                <Input
                  value={row.denyText}
                  onInput={(v) => (row.denyText = v)}
                  testid={`mcp-toolfilter-deny-${row.endpoint.id}`} />
              </Field>
            </div>
          </fieldset>
        </div>
      {/each}
      <div class="settings-mcp__actions">
        <Btn variant="secondary" testid="mcp-add" onClick={addRow}>
          {#snippet children()}Add endpoint{/snippet}
        </Btn>
        <Btn variant="primary" testid="mcp-save" disabled={saving || hasErrors} onClick={() => void save()}>
          {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
        </Btn>
      </div>
    </div>
  {/if}
</section>

<style>
  .settings-mcp {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-mcp__row {
    display: grid;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .settings-mcp__primary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-inline);
    align-items: end;
  }
  .settings-mcp__primary-fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-inline);
    align-items: end;
    flex: 1 1 320px;
    min-width: 0;
  }
  .settings-mcp__field {
    min-width: 0;
  }
  .settings-mcp__field--label {
    flex: 0 1 200px;
  }
  .settings-mcp__field--url {
    flex: 1 1 320px;
  }
  .settings-mcp__field :global(.ui-input) {
    width: 100%;
  }
  .settings-mcp__primary-trailing {
    display: flex;
    align-items: end;
    gap: var(--gap-inline);
    margin-left: auto;
  }
  .settings-mcp__group {
    min-width: 0;
    margin: 0;
    padding: var(--gap-tight) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .settings-mcp__legend {
    display: block;
    padding: 0;
    margin: 0 0 var(--gap-tight);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
  }
  .settings-mcp__group-body {
    display: grid;
    gap: var(--gap-tight);
  }
  .settings-mcp__group-hint {
    margin: 0;
    font-size: 10px;
    color: var(--fg-hint);
  }
  .settings-mcp__header-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-tight);
    align-items: end;
  }
  .settings-mcp__header-row :global(.ui-field) {
    flex: 1 1 160px;
    min-width: 0;
  }
  .settings-mcp__header-row :global(.ui-input) {
    width: 100%;
  }
  .settings-mcp__actions {
    display: flex;
    gap: var(--gap-inline);
  }
</style>
