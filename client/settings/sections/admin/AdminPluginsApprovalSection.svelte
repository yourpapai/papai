<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { setPluginApproval } from '../../admin-fetchers.js'
  import { fetchPlugins } from '../../fetchers.js'
  import type { PluginEntry } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'
  import StatusPill from '../../../shared/ui/StatusPill.svelte'
  import SettingsTable from '../../components/SettingsTable.svelte'

  interface Props {
    catalogContextId: string
  }

  let { catalogContextId }: Props = $props()

  let plugins: PluginEntry[] = $state([])
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      plugins = (await fetchPlugins(catalogContextId)).plugins
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function decide(pluginId: string, action: 'approve' | 'reject'): Promise<void> {
    error = null
    status = null
    try {
      const result = await setPluginApproval({ pluginId, action })
      await load()
      status = `${pluginId}: ${result.state ?? action}`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })

  interface ApprovalRow {
    id: string
    name: string
    active: boolean
  }

  const approvalRows = $derived<ApprovalRow[]>(plugins.map((p) => ({ id: p.id, name: p.name, active: p.active })))

  const approvalColumns = [
    { key: 'name' as const, label: 'Plugin' },
    { key: 'active' as const, label: 'Active' },
    { key: 'actions' as const, label: '', align: 'right' as const },
  ]
</script>

<section id="plugin-approval" class="settings-section">
  <PageHeader eyebrow="Admin · Plugins" title="Plugin approval">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="plugin-approval-refresh" />
    {/snippet}
  </PageHeader>

  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  <div class="settings-table-wrap">
    {#snippet cell(row: ApprovalRow, col: { key: string; label: string })}
      {#if col.key === 'name'}
        {row.name} <span class="placeholder">({row.id})</span>
      {:else if col.key === 'active'}
        <StatusPill status={row.active ? 'active' : 'disabled'} />
      {:else}
        <Btn variant="primary" size="sm" testid={`plugin-approve-${row.id}`} onClick={() => void decide(row.id, 'approve')}>
          {#snippet children()}Approve{/snippet}
        </Btn>
        <Btn variant="danger" size="sm" testid={`plugin-reject-${row.id}`} onClick={() => void decide(row.id, 'reject')}>
          {#snippet children()}Reject{/snippet}
        </Btn>
      {/if}
    {/snippet}
    <SettingsTable
      columns={approvalColumns}
      rows={approvalRows}
      rowKey="id"
      searchKeys={['id', 'name']}
      {cell}>
      {#snippet empty()}No plugins{/snippet}
    </SettingsTable>
  </div>
</section>
