<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import Confirm from '../../shared/Confirm.svelte'
  import Btn from '../../shared/ui/Btn.svelte'
  import EmptyState from '../../shared/ui/EmptyState.svelte'
  import ErrorState from '../../shared/ui/ErrorState.svelte'
  import Field from '../../shared/ui/Field.svelte'
  import IconButton from '../../shared/ui/IconButton.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import LiveRegion from '../../shared/ui/LiveRegion.svelte'
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

  const UNREADABLE_TEXT = 'Stored credentials are unreadable. Re-enter your credentials to repair this context.'

  const BLANK_SERVER_MESSAGE = 'Choose an MCP server.'
  const DUPLICATE_SERVER_MESSAGE = 'Already selected in another row.'

  // A row is invalid when it names no server, or repeats one an *earlier* row already
  // claimed. Marking the later occurrence is what lets the message point somewhere: the
  // first row is the one the user keeps. This is not cosmetic — resolveMcpServers is
  // fail-closed and all-or-nothing, so saving a duplicate costs the context every MCP
  // server, and the failure surfaces in a coding session rather than here.
  function rowProblem(all: McpRow[], row: McpRow, index: number): string | undefined {
    if (row.server.length === 0) return BLANK_SERVER_MESSAGE
    if (all.slice(0, index).some((earlier) => earlier.server === row.server)) return DUPLICATE_SERVER_MESSAGE
    return undefined
  }

  const rowProblems = $derived(rows.map((row, index) => rowProblem(rows, row, index)))
  const hasRowProblem = $derived(rowProblems.some((problem) => problem !== undefined))
  const atCap = $derived(rows.length >= maxMcpServers)

  // Removing every row on a context that already has stored servers makes Save an
  // unconfirmed alias for Clear: hasRowProblem is vacuously false on an empty list, so
  // Save would PATCH servers: [] without the danger-styled confirm dialog Clear requires.
  // Disabling Save here leaves Clear as the one confirmed entrance to that outcome.
  const wouldSilentlyClear = $derived(rows.length === 0 && currentData?.configured === true)

  // `maxMcpServers` is optional in the client schema (fetcher-schemas.ts:94) and falls back
  // to Infinity above, so guard on finiteness: a count is only meaningful against a real cap.
  const capLabel = $derived(
    Number.isFinite(maxMcpServers) ? `${rows.length} of ${maxMcpServers} servers used` : null,
  )

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
    if (loading || saving || loadedContextId !== contextId || hasRowProblem) return
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

  <!-- The `currentData !== null` guard moves from the markup into the message: before data
       exists the failure is shown by ErrorState below, but the region itself must already
       be mounted so a later failure can be announced rather than appearing with its text. -->
  <LiveRegion tone="alert" message={currentData === null ? null : error} />
  <LiveRegion tone="status" message={status} />

  {#if currentData === null && loading}
    <p class="placeholder">Loading…</p>
  {:else if currentData === null && error !== null}
    <ErrorState
      message="Couldn't load the MCP server settings for this context."
      detail={error}
      onRetry={() => void load(contextId)} />
  {:else if currentData !== null}
    <LiveRegion tone="alert" message={unreadableError === null ? null : UNREADABLE_TEXT} />
    {#if noServersAvailable}
      <div data-testid="coding-mcp-catalog-empty">
        <EmptyState
          title="No MCP servers available"
          hint="Your operator hasn't published any MCP servers for this platform instance. Ask them to add one." />
      </div>
    {:else}
      <p class="placeholder">
        Coding sessions can reach MCP servers on your behalf. Add a server per row — external servers need a credential;
        operator-hosted servers don't.
      </p>

      <div class="settings-mcp">
        {#if rows.length === 0}
          <EmptyState
            title="No MCP servers selected"
            hint="Add a server to let coding sessions reach it on your behalf." />
        {/if}
        {#each rows as row, index (index)}
          <div class="settings-mcp__row" data-testid={`coding-mcp-row-${index}`}>
            <div class="settings-mcp__field settings-mcp__field--server">
              <Field label="MCP server" error={rowProblems[index]}>
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
                disabled={saving || loading}
                onClick={() => removeRow(index)}>
                {#snippet children()}Remove{/snippet}
              </Btn>
            </div>
          </div>
        {/each}

        <div class="settings-field__actions">
          <div class="settings-mcp__add">
            <Btn
              variant="secondary"
              size="sm"
              testid="coding-mcp-add"
              disabled={saving || loading || atCap}
              onClick={addRow}>
              {#snippet children()}Add server{/snippet}
            </Btn>
            {#if capLabel !== null}
              <span class="settings-mcp__cap" data-testid="coding-mcp-cap">{capLabel}</span>
            {/if}
          </div>
          <div class="settings-field__actions-trailing">
            {#if currentData.configured}
              <Btn
                variant="ghost"
                size="sm"
                testid="coding-mcp-clear"
                disabled={saving || loading || clearing}
                busy={clearing}
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
              disabled={!formDirty || saving || loading || clearing || hasRowProblem || wouldSilentlyClear}
              busy={saving}
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
    background: var(--surface-1);
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
  .settings-mcp__field :global(.ui-input),
  .settings-mcp__field :global(.ui-select) {
    width: 100%;
  }
  /* .ui-select is a flex row (select + caret) and only grants its <select> flex-grow
     under the `block` variant -- which also forces --row-h height and 14px text, a new
     mismatch against Input's 12px. Grow the select here instead, so the two peer fields
     match in width without diverging in type size. */
  .settings-mcp__field :global(.ui-select select) {
    flex: 1;
    min-width: 0;
  }
  .settings-mcp__trailing {
    margin-left: auto;
  }
  .settings-field__actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-inline);
    /* Measured against *this* section's card geometry: the row cards use
       padding: var(--gap-inline) plus a 1px border, putting their content edge at 13px.
       CodingCredentialsSection.svelte and CodeHostSection.svelte use 14px because they
       measured their own, different cards. Re-measure before changing this; do not
       "unify" it with the siblings' value. */
    padding-inline: 13px;
  }
  .settings-mcp__add {
    display: flex;
    align-items: center;
    gap: var(--gap-inline);
  }
  .settings-mcp__cap {
    font-size: 10px;
    color: var(--text-dim);
  }
  .settings-field__actions-trailing {
    display: flex;
    gap: var(--gap-inline);
  }
</style>
