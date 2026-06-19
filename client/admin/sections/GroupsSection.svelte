<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details -->

<script lang="ts">
  import type { AuthorizedGroupEntry } from '../../shared/api-types.js'
  import { formatDateTime } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import { fetchAdminGroups } from '../fetchers.js'

  let groups: AuthorizedGroupEntry[] = $state([])
  let loading = $state(false)
  let error: string | null = $state(null)
  let hasLoaded = $state(false)
  let rootEl: HTMLElement | undefined = $state()
  let loaded = $state(false)

  async function loadGroups(): Promise<void> {
    loading = true
    error = null
    try {
      groups = await fetchAdminGroups()
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      groups = []
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function loadInitial(): Promise<void> {
    if (loaded) return
    loaded = true
    await loadGroups()
  }

  async function revoke(groupId: string): Promise<void> {
    try {
      await fetch(`/auth/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' })
      await loadGroups()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    if (rootEl === undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadInitial()
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '0px' },
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  })

  interface GroupRow {
    group_id: string
    added_by: string
    added_at: string
    added_at_raw: string
  }

  const groupRows = $derived<GroupRow[]>(
    groups.map((g) => ({
      group_id: g.group_id,
      added_by: g.added_by,
      added_at: formatDateTime(g.added_at),
      added_at_raw: g.added_at,
    })),
  )

  const columns = [
    { key: 'group_id' as const, label: 'Group', sortable: true },
    { key: 'added_by' as const, label: 'Added by', sortable: true },
    {
      key: 'added_at' as const,
      label: 'Added at (UTC)',
      sortable: true,
      sortAccessor: (r: GroupRow) => r.added_at_raw,
    },
    { key: 'action' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="groups" class="admin-data-section admin-section" bind:this={rootEl}>
  <Panel title="authorized groups" count={groups.length}>
    {#snippet action()}
      <Btn variant="secondary" size="sm" onClick={() => { void loadGroups() }} disabled={loading}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
    {#snippet body()}
      <div class="groups__body">
        {#if error !== null}
          <p class="status-error">{error}</p>
        {:else if hasLoaded && groups.length === 0}
          <p class="placeholder">No authorized groups found</p>
        {:else if groups.length > 0}
          {#snippet cell(row: GroupRow, col: { key: string; label: string })}
            {#if col.key === 'action'}
              <Btn variant="danger" size="sm" onClick={() => { void revoke(row.group_id) }}>
                {#snippet children()}revoke{/snippet}
              </Btn>
            {:else}
              {String(row[col.key as keyof GroupRow] ?? '')}
            {/if}
          {/snippet}
          <DataTable
            {columns}
            rows={groupRows}
            {cell}
            rowKey="group_id"
            defaultSort={{ key: 'added_at', dir: 'desc' }} />
        {/if}
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }

  .groups__body {
    padding: 0;
  }

  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }

  .status-error {
    margin: 0;
    padding: 12px;
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
