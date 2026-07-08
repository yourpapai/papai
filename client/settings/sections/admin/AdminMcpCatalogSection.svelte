<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import { fetchAdminMcpCatalog, postAdminMcpCatalog } from '../../admin-fetchers.js'
  import type { AdminMcpCatalogEntry } from '../../fetcher-schemas-mcp-catalog.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import AdminMcpCatalogEntryRow, {
    emptyDraftEntry,
    type DraftMcpCatalogEntry,
  } from './AdminMcpCatalogEntryRow.svelte'

  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let loaded = $state(false)

  let draftEntries: DraftMcpCatalogEntry[] = $state([])

  function toDraft(entry: AdminMcpCatalogEntry): DraftMcpCatalogEntry {
    return {
      name: entry.name,
      upstream_url: entry.upstream_url,
      header: entry.header ?? '',
      default_tool_policy: entry.default_tool_policy,
      toolPolicy: Object.entries(entry.tool_policy ?? {}).map(([tool, permission]) => ({ tool, permission })),
    }
  }

  function toEntry(draft: DraftMcpCatalogEntry): AdminMcpCatalogEntry {
    const entry: AdminMcpCatalogEntry = {
      name: draft.name.trim(),
      upstream_url: draft.upstream_url.trim(),
      default_tool_policy: draft.default_tool_policy,
    }
    const header = draft.header.trim()
    if (header !== '') entry.header = header
    const toolPolicy: Record<string, 'allow' | 'ask' | 'deny'> = {}
    for (const row of draft.toolPolicy) {
      const tool = row.tool.trim()
      if (tool !== '') toolPolicy[tool] = row.permission
    }
    if (Object.keys(toolPolicy).length > 0) entry.tool_policy = toolPolicy
    return entry
  }

  async function load(): Promise<void> {
    error = null
    loading = true
    try {
      const next = await fetchAdminMcpCatalog()
      draftEntries = next.entries.map(toDraft)
      loaded = true
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function addEntry(): void {
    draftEntries = [...draftEntries, emptyDraftEntry()]
  }

  function removeEntry(index: number): void {
    draftEntries = draftEntries.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const entries = draftEntries.map(toEntry)
      const next = await postAdminMcpCatalog(entries)
      draftEntries = next.entries.map(toDraft)
      status = 'Catalog saved.'
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

<section id="mcp-catalog" class="settings-section">
  <PageHeader eyebrow="Admin · Coding sessions" title="MCP catalog">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="mcp-catalog-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if loaded}
    <div class="mcp-catalog-section" data-testid="mcp-catalog-entries">
      {#if draftEntries.length === 0}
        <p class="placeholder">No MCP servers in the catalog yet.</p>
      {:else}
        {#each draftEntries as entry, index (index)}
          <AdminMcpCatalogEntryRow {entry} {index} disabled={loading} onRemove={() => removeEntry(index)} />
        {/each}
      {/if}

      <div class="mcp-catalog-section__controls">
        <Btn variant="secondary" size="sm" testid="mcp-catalog-add" disabled={loading} onClick={addEntry}>
          {#snippet children()}Add MCP server{/snippet}
        </Btn>
        <Btn variant="primary" size="sm" testid="mcp-catalog-save" disabled={loading} onClick={() => void save()}>
          {#snippet children()}{loading ? 'Saving…' : 'Save catalog'}{/snippet}
        </Btn>
      </div>
    </div>
  {:else if loading}
    <p class="placeholder">Loading…</p>
  {/if}
</section>

<style>
  .mcp-catalog-section {
    display: grid;
    gap: 16px;
  }
  .mcp-catalog-section__controls {
    display: flex;
    gap: 8px;
  }
</style>
