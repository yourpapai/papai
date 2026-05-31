<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details -->

<script lang="ts">
  import type { AuthorizedGroupEntry } from '../../shared/api-types.js'
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
  }

  const groupRows = $derived<GroupRow[]>(
    groups.map((g) => ({
      group_id: g.group_id,
      added_by: g.added_by,
      added_at: g.added_at,
    })),
  )

  const columns = [
    { key: 'group_id' as const, label: 'Group' },
    { key: 'added_by' as const, label: 'Added by' },
    { key: 'added_at' as const, label: 'Added at' },
    { key: 'action' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="groups" class="admin-data-section admin-section" bind:this={rootEl}>
  <Panel title="authorized groups" count={groups.length}>
    {#snippet action()}
      <button
        class="groups__refresh-btn"
        type="button"
        onclick={() => {
          void loadGroups()
        }}
        disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
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
              <button
                class="groups__revoke-btn"
                type="button"
                onclick={() => {
                  void revoke(row.group_id)
                }}>
                revoke
              </button>
            {:else}
              {String(row[col.key as keyof GroupRow] ?? '')}
            {/if}
          {/snippet}
          <DataTable {columns} rows={groupRows} {cell} rowKey="group_id" />
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

  .groups__refresh-btn {
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 2px;
    color: var(--bg);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    height: 22px;
    padding: 3px 8px;
  }

  .groups__refresh-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .groups__revoke-btn {
    background: transparent;
    border: 1px solid var(--danger);
    border-radius: 2px;
    color: var(--danger);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
  }

  .groups__revoke-btn:hover {
    background: var(--danger);
    color: var(--bg);
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
