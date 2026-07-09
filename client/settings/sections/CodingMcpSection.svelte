<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import PageHeader from '../../shared/ui/PageHeader.svelte'
  import Select from '../../shared/ui/Select.svelte'
  import type { CodingCredentialsResponse } from '../fetcher-schemas.js'
  import { clearCodingCredentials, fetchCodingCredentials, patchCodingCredentials } from '../coding-credentials-fetchers.js'

  const NAMESPACE = 'mcp'

  interface Props {
    contextId: string
  }
  let { contextId }: Props = $props()

  interface McpRow {
    server: string
    token: string
    hadToken: boolean
  }

  let data: CodingCredentialsResponse | null = $state(null)
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let saving = $state(false)
  let rows: McpRow[] = $state([])
  let initialRowsSnapshot = $state('[]')
  let loadedContextId: string | null = $state(null)

  const currentData = $derived(loadedContextId === contextId ? data : null)
  const unreadableError = $derived(currentData?.unreadable === true ? currentData.error : null)
  const catalog = $derived(currentData?.catalog ?? [])
  const pluginServers = $derived(currentData?.pluginServers ?? [])
  const maxMcpServers = $derived(currentData?.maxMcpServers ?? Number.POSITIVE_INFINITY)
  const noServersAvailable = $derived(currentData !== null && catalog.length === 0 && pluginServers.length === 0)

  const serverOptions = $derived([
    ...catalog.map((entry) => ({ value: entry.name, label: entry.name })),
    ...pluginServers.map((entry) => ({ value: entry.name, label: entry.label })),
  ])

  function selectedIsInternal(row: McpRow): boolean {
    return row.server.startsWith('plugin:') || pluginServers.some((p) => p.name === row.server)
  }

  const hasEmptyServer = $derived(rows.some((r) => r.server.trim().length === 0))
  const atCap = $derived(rows.length >= maxMcpServers)

  function snapshotRows(rs: McpRow[]): string {
    return JSON.stringify(rs.map((r) => ({ server: r.server, token: r.token })))
  }
  const formDirty = $derived(snapshotRows(rows) !== initialRowsSnapshot)

  function initialRows(next: CodingCredentialsResponse): McpRow[] {
    return (next.selections ?? []).map((s) => ({ server: s.server, token: '', hadToken: s.hasToken }))
  }

  async function load(id: string): Promise<boolean> {
    error = null
    status = null
    loading = true
    try {
      const next = await fetchCodingCredentials(id, NAMESPACE)
      if (id !== contextId) return false
      data = next
      loadedContextId = id
      rows = initialRows(next)
      initialRowsSnapshot = snapshotRows(rows)
      return true
    } catch (err) {
      if (id === contextId) error = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      if (id === contextId) loading = false
    }
  }

  function addRow(): void {
    if (atCap) return
    rows = [...rows, { server: '', token: '', hadToken: false }]
  }

  function removeRow(index: number): void {
    rows = rows.filter((_, i) => i !== index)
  }

  function updateRowServer(index: number, server: string): void {
    const original = currentData?.selections?.find((s) => s.server === server)
    rows = rows.map((r, i) => (i === index ? { server, token: '', hadToken: original?.hasToken ?? false } : r))
  }

  function updateRowToken(index: number, token: string): void {
    rows = rows.map((r, i) => (i === index ? { ...r, token } : r))
  }

  // For internal (plugin:) rows papai mints the credential — never persist a token. For external
  // rows, a blank token means "keep whatever is stored server-side"; the route merges it in.
  function buildPayload(): { server: string; upstream_token?: string }[] {
    return rows.map((row) => {
      if (selectedIsInternal(row)) return { server: row.server }
      const token = row.token.trim()
      return token.length > 0 ? { server: row.server, upstream_token: token } : { server: row.server }
    })
  }

  async function saveAll(): Promise<void> {
    if (loading || saving || loadedContextId !== contextId || hasEmptyServer) return
    error = null
    status = null
    saving = true
    try {
      await patchCodingCredentials({
        contextId,
        namespace: NAMESPACE,
        values: { servers: JSON.stringify(buildPayload()) },
      })
      const ok = await load(contextId)
      if (ok) status = 'Coding MCP servers saved.'
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  let pendingClear = $state(false)
  let clearing = $state(false)
  let clearError = $state<string | null>(null)

  async function confirmClear(): Promise<void> {
    if (clearing || loadedContextId !== contextId) return
    clearError = null
    status = null
    clearing = true
    let ok = false
    try {
      await clearCodingCredentials({ contextId, namespace: NAMESPACE })
      ok = true
    } catch (err) {
      clearError = err instanceof Error ? err.message : String(err)
    } finally {
      clearing = false
    }
    if (ok) {
      pendingClear = false
      const reloaded = await load(contextId)
      if (reloaded) status = 'Coding MCP server selections cleared.'
    }
  }

  $effect(() => {
    const id = contextId
    untrack(() => {
      void load(id)
    })
  })
</script>

<section id="coding-mcp" class="settings-section">
  <PageHeader eyebrow="Coding sessions" title="Coding MCP servers">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load(contextId)} testid="coding-mcp-refresh" />
    {/snippet}
  </PageHeader>

  {#if currentData !== null && error !== null}<p class="status-error" role="alert">{error}</p>{/if}
  {#if status !== null}<p class="status-success" role="status">{status}</p>{/if}

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState message={error} onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    {#if unreadableError !== null}
      <p class="status-error" role="alert">Stored credentials are unreadable. Re-enter your credentials to repair this context.</p>
    {/if}
    {#if noServersAvailable}
      <p class="placeholder" data-testid="coding-mcp-catalog-empty">No MCP servers available — ask your operator.</p>
    {:else}
      <p class="placeholder">
        Coding sessions can reach MCP servers on your behalf. Add a server per row — external servers need a credential;
        operator-hosted servers don't.
      </p>

      <div class="settings-mcp">
        {#each rows as row, index (index)}
          <div class="settings-mcp__row" data-testid={`coding-mcp-row-${index}`}>
            <div class="settings-mcp__field settings-mcp__field--server">
              <Field label="MCP server">
                <Select
                  value={row.server}
                  options={serverOptions}
                  onChange={(v) => updateRowServer(index, v)}
                  disabled={saving || loading}
                  placeholder="Select an MCP server…"
                  testid={`coding-mcp-server-${index}`} />
              </Field>
            </div>
            {#if !selectedIsInternal(row)}
              <div class="settings-mcp__field settings-mcp__field--token">
                <Field
                  label="Credential"
                  hint={row.hadToken && row.token.trim().length === 0
                    ? 'Blank keeps the stored credential.'
                    : undefined}>
                  <Input
                    type="password"
                    value={row.token}
                    placeholder={row.hadToken ? 'unchanged — keeps stored credential' : 'enter a credential'}
                    onInput={(v) => updateRowToken(index, v)}
                    testid={`coding-mcp-token-${index}`} />
                </Field>
              </div>
            {/if}
            <div class="settings-mcp__trailing">
              <Btn
                variant="outline"
                size="sm"
                testid={`coding-mcp-remove-${index}`}
                onClick={() => removeRow(index)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
            </div>
          </div>
        {/each}

        <div class="settings-field__actions">
          <Btn
            variant="secondary"
            size="sm"
            testid="coding-mcp-add"
            disabled={saving || loading || atCap}
            onClick={addRow}>
            {#snippet children()}Add server{/snippet}
          </Btn>
          <div class="settings-field__actions-trailing">
            {#if currentData.configured}
              <Btn
                variant="ghost"
                size="sm"
                testid="coding-mcp-clear"
                disabled={saving || loading || clearing}
                onClick={() => {
                  pendingClear = true
                  clearError = null
                }}>
                {#snippet children()}{clearing ? 'Clearing…' : 'Clear'}{/snippet}
              </Btn>
            {/if}
            <Btn
              variant="primary"
              size="sm"
              testid="coding-mcp-save"
              disabled={!formDirty || saving || loading || clearing || hasEmptyServer}
              onClick={() => void saveAll()}>
              {#snippet children()}{saving ? 'Saving…' : 'Save'}{/snippet}
            </Btn>
          </div>
        </div>
      </div>
    {/if}
  {/if}

  <Confirm
    open={pendingClear}
    title="Clear coding MCP server selections"
    danger
    busy={clearing}
    confirmLabel="Clear"
    onCancel={() => (pendingClear = false)}
    onConfirm={() => void confirmClear()}>
    {#snippet body()}
      <p>Remove all stored MCP server selections and credentials for this context? This cannot be undone.</p>
      {#if clearError !== null}<p class="status-error">{clearError}</p>{/if}
    {/snippet}
  </Confirm>
</section>

<style>
  .settings-mcp {
    display: grid;
    gap: var(--gap-inline);
  }
  .settings-mcp__row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--gap-inline);
    padding: var(--gap-inline);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .settings-mcp__field {
    min-width: 0;
  }
  .settings-mcp__field--server {
    flex: 1 1 220px;
  }
  .settings-mcp__field--token {
    flex: 1 1 260px;
  }
  .settings-mcp__field :global(.ui-input) {
    width: 100%;
  }
  .settings-mcp__trailing {
    margin-left: auto;
  }
  .settings-field__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
  }
  .settings-field__actions-trailing {
    display: flex;
    gap: var(--gap-inline);
  }
</style>
